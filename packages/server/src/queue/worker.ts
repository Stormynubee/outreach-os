import type { ProgressEvent, SocialPlatform } from '@outreach/shared';
import type { Db } from '../db/client.ts';
import type { BusinessRepo } from '../db/businesses.ts';
import type { JobQueue, JobRow } from '../db/jobs.ts';
import type { Settings } from '../settings.ts';
import type { StageOutcome } from '../enrich/probeSite.ts';

export interface WorkerDeps {
  db: Db;
  repo: BusinessRepo;
  jobs: JobQueue;
  settings: () => Settings;
  emit: (event: ProgressEvent) => void;
  probeSite: (businessId: number) => Promise<StageOutcome>;
  scrapeSite: (businessId: number) => Promise<StageOutcome>;
  checkSocial: (businessId: number, platform: SocialPlatform, handle: string) => Promise<StageOutcome>;
  concurrency?: number;
  pollMs?: number;
}

export interface Worker {
  start(): void;
  stop(): void;
  running(): boolean;
}

export function createWorker(deps: WorkerDeps): Worker {
  const { db, repo, jobs, emit } = deps;
  const concurrency = deps.concurrency ?? 3;
  const pollMs = deps.pollMs ?? 750;
  const workerId = `w${process.pid}`;

  let timer: NodeJS.Timeout | null = null;
  let active = 0;
  let stopped = true;
  let lastReclaim = 0;

  const setState = db.prepare(
    'UPDATE business SET enrichment_state = ?, last_error = ?, last_error_stage = ?, updated_at = ? WHERE id = ?',
  );

  async function runJob(job: JobRow): Promise<void> {
    const payload = JSON.parse(job.payload) as Record<string, unknown>;
    const businessId = typeof payload.businessId === 'number' ? payload.businessId : null;

    try {
      let outcome: StageOutcome | null = null;

      switch (job.type) {
        case 'probe_site':
          if (businessId === null) throw new Error('probe_site requires businessId');
          outcome = await deps.probeSite(businessId);
          if (outcome.ok && outcome.stage === 'probe' && outcome.detail !== 'no website to probe') {
            const row = repo.get(businessId);
            const state = row?.site_state as string | undefined;
            if (state && ['live', 'live_weak', 'live_insecure'].includes(state)) {
              jobs.enqueue({ type: 'scrape_site', payload: { businessId }, dedupeKey: `scrape:${businessId}` });
            }
          }
          break;

        case 'scrape_site':
          if (businessId === null) throw new Error('scrape_site requires businessId');
          outcome = await deps.scrapeSite(businessId);
          break;

        case 'check_social': {
          if (businessId === null) throw new Error('check_social requires businessId');
          const platform = String(payload.platform) as SocialPlatform;
          const handle = String(payload.handle);
          outcome = await deps.checkSocial(businessId, platform, handle);
          break;
        }

        case 'rescore': {
          // Chunked and yielded: better-sqlite3 is synchronous, so a bulk update
          // would otherwise freeze the API for the whole operation.
          repo.rescoreAll(Date.now(), 500);
          outcome = { ok: true, stage: 'rescore', detail: 'all', retryable: false };
          break;
        }

        default:
          outcome = { ok: false, stage: job.type, detail: 'unknown job type', retryable: false };
      }

      if (outcome && !outcome.ok && outcome.retryable) {
        const state = jobs.fail(job.id, outcome.detail, job.attempts, job.max_attempts);
        if (businessId !== null) setState.run('retry', outcome.detail, outcome.stage, Date.now(), businessId);
        if (state === 'dead') {
          emit({
            type: 'log', level: 'warn',
            message: `Gave up on ${job.type} for business #${businessId}: ${outcome.detail}`,
            at: Date.now(),
          });
        }
        return;
      }

      jobs.complete(job.id);
      if (businessId !== null) {
        setState.run('done', null, null, Date.now(), businessId);
        emit({
          type: 'lead',
          businessId,
          stage: outcome?.stage ?? job.type,
          state: 'done',
          score: (repo.get(businessId)?.score as number | undefined) ?? null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jobs.fail(job.id, message, job.attempts, job.max_attempts);
      if (businessId !== null) setState.run('failed', message, job.type, Date.now(), businessId);
      emit({ type: 'log', level: 'error', message: `${job.type} failed: ${message}`, at: Date.now() });
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const now = Date.now();

    if (now - lastReclaim > 60_000) {
      lastReclaim = now;
      // Recover jobs whose worker died mid-flight, e.g. a hard shutdown.
      const reclaimed = jobs.reclaimStale(5 * 60_000, now);
      if (reclaimed > 0) {
        emit({ type: 'log', level: 'info', message: `Requeued ${reclaimed} interrupted job(s)`, at: now });
      }
    }

    while (active < concurrency) {
      const job = jobs.claim(workerId, Date.now());
      if (!job) break;
      active++;
      void runJob(job).finally(() => {
        active--;
        emit({ type: 'queue', pending: jobs.counts().queued, inFlight: active });
      });
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      const loop = () => {
        void tick().finally(() => {
          if (!stopped) {
            timer = setTimeout(loop, pollMs);
            timer.unref?.();
          }
        });
      };
      loop();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    running: () => !stopped,
  };
}
