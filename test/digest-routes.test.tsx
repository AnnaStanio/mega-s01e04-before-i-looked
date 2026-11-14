import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const line = (job: string, status: string, at: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at, job, status, owner: 'rook', ...extra });

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(
    join(runsDir, '2026-10-28.jsonl'),
    [
      line('lane/sync', 'ok', '2026-10-28T01:00:00+01:00'),
      line('digest/render', 'retry', '2026-10-28T01:05:00+01:00', { error: 'timeout' }),
      line('digest/render', 'fail', '2026-10-28T01:10:00+01:00', { error: 'boom' }),
      '',
    ].join('\n'),
  );
  writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-10-30.jsonl'),
    [
      line('notes/backup', 'ok', '2026-10-30T02:00:00+01:00'),
      'this is not json',
      line('lane/sync', 'ok', '2026-10-30T02:30:00+01:00'),
    ].join('\n'),
  );

  const config: RigConfig = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
  app = createApp(config);
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('200 with the job names for a night with a file', async () => {
    const res = await app.request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest · 2026-10-28');
    expect(html).toContain('lane/sync');
    expect(html).toContain('digest/render');
    expect(html).toContain('boom');
    expect(html).not.toContain('nothing ran');
  });

  it('404 for a night with no file', async () => {
    const res = await app.request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for that night');
  });

  it('the empty night says nothing ran', async () => {
    const res = await app.request('/digest/2026-10-29');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('did not parse');
  });

  it('a bad line is counted, the other rows still render', async () => {
    const res = await app.request('/digest/2026-10-30');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line did not parse');
    expect(html).toContain('notes/backup');
    expect(html).toContain('lane/sync');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with one row per job for a night with a file', async () => {
    const res = await app.request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      night: string;
      rows: { job: string; runs: number; retries: number; fails: number; lastStatus: string }[];
      badLines: number;
      counts: Record<string, number>;
    };
    expect(body.night).toBe('2026-10-28');
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 1, retry: 1, fail: 1 });
    expect(body.rows.map((r) => r.job)).toEqual(['digest/render', 'lane/sync']);
    expect(body.rows[0]).toMatchObject({ runs: 2, retries: 1, fails: 1, lastStatus: 'fail' });
  });

  it('404 with an error body for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-11-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log for 2026-11-01' });
  });

  it('the empty night has rows []', async () => {
    const res = await app.request('/api/digest/2026-10-29');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; badLines: number };
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('a bad line gives badLines 1 and keeps the other rows', async () => {
    const res = await app.request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { job: string }[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'notes/backup']);
  });
});
