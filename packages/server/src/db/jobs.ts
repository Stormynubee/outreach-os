import type { Db } from './client.ts';

export type JobType =
  | 'probe_site'
  | 'scrape_site'
  | 'check_social'
  | 'rescore'
  | 'discovery';

export const JOB_PRIORITY: Record<JobType, number> = {
  // Lower runs first. This ordering is the most important scheduling decision:
  // slow, rate-limited, low-yield social work must never starve website probing.
  discovery: 0,
  probe_site: 1,
  scrape_site: 2,
  check_social: 3,
  rescore: 4,
};

export interface JobRow {
  id: number;
  type: JobType;
  payload: string;
  status: string;
  priority: number;
  run_at: number;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_at: number | null;
  locked_by: string | null;
  dedupe_key: string | null;
}

export interface EnqueueInput {
  type: JobType;
  payload: Record<string, unknown>;
  runAt?: number;
  dedupeKey?: string | null;
  maxAttempts?: number;
}

export function createJobQueue(db: Db) {
  // The dedupe index is partial, so the conflict target must repeat its WHERE
  // clause — SQLite will not match a partial unique index without it.
  const enqueueStmt = db.prepare(`
    INSERT INTO job (type, payload, status, priority, run_at, attempts, max_attempts, dedupe_key, created_at, updated_at)
    VALUES (@type, @payload, 'queued', @priority, @run_at, 0, @max_attempts, @dedupe_key, @now, @now)
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`);

  const claimStmt = db.prepare(`
    UPDATE job SET status = 'running', locked_at = @now, locked_by = @worker,
                   attempts = attempts + 1, updated_at = @now
    WHERE id = (
      SELECT id FROM job
      WHERE status = 'queued' AND run_at <= @now
      ORDER BY priority ASC, run_at ASC
      LIMIT 1
    )
    RETURNING *`);

  const completeStmt = db.prepare(
    "UPDATE job SET status = 'done', locked_at = NULL, locked_by = NULL, updated_at = ? WHERE id = ?",
  );
  const failStmt = db.prepare(`
    UPDATE job SET status = @status, run_at = @run_at, last_error = @last_error,
                   locked_at = NULL, locked_by = NULL, updated_at = @now
    WHERE id = @id`);
  const reclaimStmt = db.prepare(`
    UPDATE job SET status = 'queued', locked_at = NULL, locked_by = NULL
    WHERE status = 'running' AND locked_at < ?`);
  const pendingForBusiness = db.prepare(
    "SELECT COUNT(*) AS n FROM job WHERE status = 'queued' AND payload LIKE ?",
  );
  const countsStmt = db.prepare(`
    SELECT status, COUNT(*) AS n FROM job WHERE type <> 'discovery' GROUP BY status`);

  return {
    enqueue(input: EnqueueInput): number | null {
      const now = Date.now();
      const info = enqueueStmt.run({
        type: input.type,
        payload: JSON.stringify(input.payload),
        priority: JOB_PRIORITY[input.type],
        run_at: input.runAt ?? now,
        max_attempts: input.maxAttempts ?? 3,
        dedupe_key: input.dedupeKey ?? null,
        now,
      });
      return info.changes ? Number(info.lastInsertRowid) : null;
    },
    claim(worker: string, now = Date.now()): JobRow | null {
      return (claimStmt.get({ now, worker }) as JobRow | undefined) ?? null;
    },
    complete(id: number, now = Date.now()): void {
      completeStmt.run(now, id);
    },
    /**
     * A queue is persistent, so retries are scheduled via run_at rather than by
     * sleeping a worker — a sleeping worker is a wasted worker.
     */
    fail(id: number, error: string, attempts: number, maxAttempts: number, now = Date.now()): 'queued' | 'dead' {
      const dead = attempts >= maxAttempts;
      const ceiling = Math.min(60_000, 2000 * 2 ** Math.max(0, attempts - 1));
      const delay = dead ? 0 : Math.floor(Math.random() * ceiling);
      failStmt.run({
        id,
        status: dead ? 'dead' : 'queued',
        run_at: now + delay,
        last_error: error.slice(0, 500),
        now,
      });
      return dead ? 'dead' : 'queued';
    },
    reclaimStale(timeoutMs = 5 * 60_000, now = Date.now()): number {
      return reclaimStmt.run(now - timeoutMs).changes;
    },
    counts(now = Date.now()) {
      const rows = countsStmt.all() as { status: string; n: number }[];
      const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
      return {
        queued: by.queued ?? 0,
        running: by.running ?? 0,
        done: by.done ?? 0,
        dead: by.dead ?? 0,
      };
    },
    hasPendingForBusiness(businessId: number): boolean {
      const n = (pendingForBusiness.get(`%"businessId":${businessId}%`) as { n: number }).n;
      return n > 0;
    },
    clearDiscoveryJobs(): number {
      return db.prepare("DELETE FROM job WHERE type = 'discovery' AND status IN ('queued','running')").run().changes;
    },
  };
}

export type JobQueue = ReturnType<typeof createJobQueue>;
