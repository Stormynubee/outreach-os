import dns from 'node:dns';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ProgressEvent } from '@outreach/shared';

// Windows prefers AAAA records, and a host with no working IPv6 route hangs until
// the connect timeout — roughly 20s of dead time per request.
dns.setDefaultResultOrder('ipv4first');

import { readSettings, writeSettings, getDb, closeDb } from './db/client.ts';
import { createBusinessRepo } from './db/businesses.ts';
import { createJobQueue } from './db/jobs.ts';
import { createTaskRepo } from './db/tasks.ts';
import { createStatsRepo } from './db/stats.ts';
import { DomainScheduler } from './lib/buckets.ts';
import { createHttpClient } from './lib/http.ts';
import { createGeocoder, NOMINATIM_HOST } from './providers/geocode.ts';
import { createOverpassClient } from './providers/overpass.ts';
import { createDiscoveryService } from './discovery/run.ts';
import { createSiteProbe } from './enrich/probeSite.ts';
import { createSiteScraper } from './enrich/scrapeSite.ts';
import { createSocialChecker } from './enrich/checkSocial.ts';
import { createWorker } from './queue/worker.ts';
import { registerRoutes } from './routes/index.ts';
import { SCORE_VERSION } from '@outreach/shared';
import type { Settings } from './settings.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');
const PORT = Number(process.env.PORT ?? 4317);

const db = getDb();
let settings = readSettings(db);

// ------------------------------------------------------------------ event bus
type Listener = (event: ProgressEvent) => void;
const listeners = new Set<Listener>();
const emit = (event: ProgressEvent): void => {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* a broken client must not break the pipeline */
    }
  }
};
const subscribe = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// ------------------------------------------------------------------ modules
const repo = createBusinessRepo(db);
repo.setPreset(settings.primaryOffer);

const jobs = createJobQueue(db);
const tasks = createTaskRepo(db);
const stats = createStatsRepo(db);

// Platform hosts each collapse into a single domain bucket, so they get their own
// limits rather than the strict one-request-per-domain default.
const scheduler = new DomainScheduler({
  globalConcurrency: settings.globalConcurrency,
  defaultLimits: {
    concurrency: settings.perDomainConcurrency,
    delayMs: settings.perDomainDelayMs,
  },
  overrides: {
    [NOMINATIM_HOST]: { concurrency: 1, delayMs: 1100 },
    'instagram.com': { concurrency: 2, delayMs: 600 },
    'facebook.com': { concurrency: 2, delayMs: 600 },
    'tiktok.com': { concurrency: 2, delayMs: 600 },
    'youtube.com': { concurrency: 2, delayMs: 600 },
  },
});

const http = createHttpClient({ db, settings: () => settings, scheduler });
const geocoder = createGeocoder({ db, settings: () => settings, scheduler });
const overpass = createOverpassClient({ db, settings: () => settings });

const probeSite = createSiteProbe({ db, repo, jobs, http });
const scrapeSite = createSiteScraper({ db, repo, jobs, http, settings: () => settings });
const checkSocial = createSocialChecker({ db, repo, http });

const discovery = createDiscoveryService({
  db,
  repo,
  jobs,
  geocoder,
  overpass,
  emit,
  onDiscoveryComplete: (queryId, poisFound, day) => {
    tasks.log({ kind: 'discovery_done', day, meta: { queryId, poisFound } });
    tasks.rebuildDay(day);
  },
});

const worker = createWorker({
  db,
  repo,
  jobs,
  settings: () => settings,
  emit,
  probeSite,
  scrapeSite,
  checkSocial,
});

// ------------------------------------------------------------------ app
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1024 * 1024 });

registerRoutes(app, {
  db,
  repo,
  tasks,
  stats,
  jobs,
  discovery,
  overpass,
  settings: () => settings,
  updateSettings: (patch: Partial<Settings>) => {
    settings = writeSettings(db, patch);
    repo.setPreset(settings.primaryOffer);
    return settings;
  },
  emit,
  subscribe,
  queue: { pending: () => jobs.counts().queued, inFlight: () => scheduler.inFlight },
});

if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
} else {
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply
      .code(503)
      .type('text/html')
      .send(
        '<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:40px;max-width:640px;margin:auto">' +
          '<h1>Frontend not built yet</h1><p>Run <code>npm run build</code> from the project root, or use ' +
          '<code>npm run dev</code> and open <a href="http://localhost:5173">localhost:5173</a>.</p></body>',
      );
  });
}

// ------------------------------------------------------------------ boot
app.get('/api/health', async () => ({ ok: true, mirrors: overpass.stats() }));

const staleScores = (
  db.prepare('SELECT COUNT(*) AS n FROM business WHERE score_version IS NOT ? OR scored_at IS NULL').get(SCORE_VERSION) as {
    n: number;
  }
).n;

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
  app.log.info(`Outreach OS listening on http://127.0.0.1:${PORT}`);
  app.log.info(`Database: ${(await import('./db/client.ts')).dbPath}`);
  if (!settings.contactEmail.trim()) {
    app.log.warn(
      'No contact email set. OpenStreetMap requires every request to identify a real contact, so discovery is disabled until you set one in Settings.',
    );
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

worker.start();
if (staleScores > 0) {
  app.log.info(`Queueing rescore for ${staleScores} lead(s) with an outdated score version`);
  jobs.enqueue({ type: 'rescore', payload: {}, dedupeKey: `rescore:boot:${SCORE_VERSION}` });
}
discovery.resumeInterrupted();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} received, shutting down`);
  worker.stop();
  await app.close();
  closeDb();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
