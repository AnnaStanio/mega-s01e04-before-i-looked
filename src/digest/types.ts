// Plan morning-digest § 1. The contract every part of § 2 builds against (issue #1).

export type RunStatus = 'ok' | 'retry' | 'fail';

/** One parsed line of runs/<night>.jsonl. */
export type RunLine = {
  at: string; // ISO 8601 with the log's own offset; never converted
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/** One row per job for a night. Sorted by job. */
export type DigestRow = {
  job: string;
  owner: string | null; // owner on the job's last line; null renders as —
  runs: number; // lines for this job
  retries: number; // lines with status retry
  fails: number; // lines with status fail
  lastStatus: RunStatus;
  lastError: string | null; // error on the job's last line, if any
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[];
  badLines: number; // lines that did not parse: counted, never thrown
  counts: Record<RunStatus, number>; // parsed lines per status
};

/** Reads runs/<night>.jsonl. Returns null when the night has no file (→ 404). */
export type ReadNight = (runsDir: string, night: string) => Night | null;
