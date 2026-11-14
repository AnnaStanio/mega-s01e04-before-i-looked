import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('has 5 jobs sorted by job and 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts parsed lines per status', () => {
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('builds rows from first and last lines, keeping the log offsets', () => {
    const rows = night?.rows ?? [];
    expect(rows.find((r) => r.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    const sync = rows.find((r) => r.job === 'lane/sync');
    expect(sync).toMatchObject({ runs: 8, retries: 1, fails: 0, lastStatus: 'ok' });
    expect(sync?.firstAt).toBe('2026-10-28T23:00:06+01:00');
    expect(sync?.lastAt).toBe('2026-10-29T05:00:04+01:00');
    expect(rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      fails: 1,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      owner: 'lane-07',
    });
  });

  it('keeps a row whose owner is null', () => {
    const render = night?.rows.find((r) => r.job === 'digest/render');
    expect(render).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (night: string, lines: string[]) =>
    writeFileSync(join(dir, `${night}.jsonl`), lines.join('\n'));

  it('returns null for a missing file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not a date', () => {
    expect(readNight('runs', '../runs/2026-10-28')).toBeNull();
  });

  it('reads an empty file as no rows and zero counts', () => {
    write('2026-01-02', []);
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps the row when the last line has owner null', () => {
    write('2026-01-03', [
      '{"at":"2026-01-03T01:00:00-05:00","job":"a","status":"ok","owner":"rook"}',
      '{"at":"2026-01-03T02:00:00-05:00","job":"a","status":"fail","owner":null,"error":"boom"}',
      '',
    ]);
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(0);
    expect(night?.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 2,
        retries: 0,
        fails: 1,
        lastStatus: 'fail',
        lastError: 'boom',
        firstAt: '2026-01-03T01:00:00-05:00',
        lastAt: '2026-01-03T02:00:00-05:00',
      },
    ]);
  });

  it('counts lines without a valid shape as bad, skips blank lines', () => {
    write('2026-01-04', [
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok","owner":"rook"}',
      'not json',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"done","owner":"rook"}',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok"}',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok","owner":7}',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok","owner":"x","error":1}',
      '[1,2]',
      '   ',
      '',
    ]);
    const night = readNight(dir, '2026-01-04');
    expect(night?.badLines).toBe(6);
    expect(night?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(night?.rows).toHaveLength(1);
  });
});
