import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  DiscoveryProgress,
  DiscoverySummary,
  LeadQuery,
  MirrorHealth,
  PipelineStage,
  ProgressEvent,
  PublicSettings,
  ServerStatus,
  SiteState,
  SocialPlatform,
  TaskChannel,
  TaskStatus,
} from '@outreach/shared';
import { CATEGORIES, SITE_STATE_LABELS, SOCIAL_PLATFORMS, PIPELINE_STAGES } from '@outreach/shared';
import type { Db } from '../db/client.ts';
import { dataDir, readSettings, writeSettings } from '../db/client.ts';
import type { BusinessRepo } from '../db/businesses.ts';
import { getLeadDetail, listLeads } from '../db/businesses.ts';
import type { JobQueue } from '../db/jobs.ts';
import type { TaskRepo } from '../db/tasks.ts';
import type { StatsRepo } from '../db/stats.ts';
import type { DiscoveryService } from '../discovery/run.ts';
import type { OverpassClient } from '../providers/overpass.ts';
import type { Settings } from '../settings.ts';
import { isDiscoveryReady, userAgent } from '../settings.ts';
import { localDay, addDays } from '../lib/urls.ts';

export interface RouteContext {
  db: Db;
  repo: BusinessRepo;
  tasks: TaskRepo;
  stats: StatsRepo;
  jobs: JobQueue;
  discovery: DiscoveryService;
  overpass: OverpassClient;
  settings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => Settings;
  emit: (event: ProgressEvent) => void;
  subscribe: (fn: (event: ProgressEvent) => void) => () => void;
  queue: { pending: () => number; inFlight: () => number };
}

const ATTRIBUTION = {
  text: '© OpenStreetMap contributors, available under the Open Database License (ODbL)',
  url: 'https://www.openstreetmap.org/copyright',
};

function toPublicSettings(s: Settings): PublicSettings {
  return {
    displayName: s.displayName,
    contactEmail: s.contactEmail,
    primaryOffer: s.primaryOffer,
    geocoderBaseUrl: s.geocoderBaseUrl,
    overpassMirrors: s.overpassMirrors,
    globalConcurrency: s.globalConcurrency,
    perDomainConcurrency: s.perDomainConcurrency,
    perDomainDelayMs: s.perDomainDelayMs,
    maxPagesPerSite: s.maxPagesPerSite,
    respectRobots: s.respectRobots,
    fetchTimeoutMs: s.fetchTimeoutMs,
    maxBodyBytes: s.maxBodyBytes,
    notifications: s.notifications,
    ttlSeconds: s.ttlSeconds as unknown as Record<string, number>,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function registerRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, repo, tasks, stats, jobs, discovery } = ctx;

  app.get('/api/status', async (): Promise<ServerStatus> => {
    const settings = ctx.settings();
    const readiness = isDiscoveryReady(settings);
    const today = localDay();
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM business) AS leads,
                (SELECT COUNT(*) FROM outreach_task WHERE status = 'open' AND due_date <= ?) AS tasksOpen,
                (SELECT COUNT(*) FROM outreach_task WHERE status = 'open' AND due_date < ?) AS tasksOverdue`,
      )
      .get(today, today) as { leads: number; tasksOpen: number; tasksOverdue: number };
    const lastBase = db
      .prepare("SELECT osm_base FROM discovery_query WHERE osm_base IS NOT NULL ORDER BY id DESC LIMIT 1")
      .get() as { osm_base: string } | undefined;

    return {
      version: '0.1.0',
      discoveryReady: readiness.ready,
      warning: readiness.reason ?? null,
      contactEmailSet: !!settings.contactEmail.trim(),
      queue: { pending: ctx.queue.pending(), inFlight: ctx.queue.inFlight() },
      counts: { leads: counts.leads, tasksOpen: counts.tasksOpen, tasksOverdue: counts.tasksOverdue },
      attribution: { ...ATTRIBUTION, osmBase: lastBase?.osm_base ?? null },
      dataDir,
    };
  });

  app.get('/api/settings', async (): Promise<PublicSettings> => toPublicSettings(ctx.settings()));

  app.put('/api/settings', async (req, reply) => {
    const body = req.body as Partial<Settings> | undefined;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Expected a settings object' });
    }
    const allowed: Partial<Settings> = {};
    const keys: (keyof Settings)[] = [
      'displayName', 'contactEmail', 'primaryOffer', 'geocoderBaseUrl', 'overpassMirrors',
      'globalConcurrency', 'perDomainConcurrency', 'perDomainDelayMs', 'maxPagesPerSite',
      'respectRobots', 'fetchTimeoutMs', 'maxBodyBytes', 'notifications', 'ttlSeconds',
    ];
    for (const key of keys) {
      if (key in body) (allowed as Record<string, unknown>)[key] = body[key];
    }
    if (allowed.overpassMirrors) {
      allowed.overpassMirrors = allowed.overpassMirrors
        .map((m) => m.trim())
        .filter((m) => /^https?:\/\//i.test(m));
    }
    if (allowed.primaryOffer && !['websites', 'social_media', 'balanced'].includes(allowed.primaryOffer)) {
      allowed.primaryOffer = 'websites';
    }
    const updated = ctx.updateSettings(allowed);
    // A new offer preset re-ranks everything, so queue a full rescore.
    if (allowed.primaryOffer) jobs.enqueue({ type: 'rescore', payload: {}, dedupeKey: `rescore:preset:${Date.now()}` });
    return toPublicSettings(updated);
  });

  app.get('/api/health/mirrors', async (): Promise<MirrorHealth[]> => {
    const now = Date.now();
    return ctx.overpass.health().map((m) => ({
      url: m.url,
      host: m.host,
      ok: m.ok,
      failures: m.failures,
      avgMs: m.avgMs,
      lastElementCount: m.lastElementCount,
      unhealthyUntil: m.unhealthyUntil && m.unhealthyUntil > now ? m.unhealthyUntil : null,
      lastError: m.lastError,
    }));
  });

  // ------------------------------------------------------------------ discovery
  app.post('/api/discovery', async (req, reply) => {
    const body = req.body as { location?: string; categories?: string[]; keyword?: string } | undefined;
    const readiness = isDiscoveryReady(ctx.settings());
    if (!readiness.ready) {
      return reply.code(400).send({ error: readiness.reason, code: 'contact_email_required' });
    }
    if (!body?.location?.trim()) {
      return reply.code(400).send({ error: 'Enter a location to search.' });
    }
    const result = await discovery.create({
      location: body.location,
      categories: body.categories,
      keyword: body.keyword,
    });
    if (!result.ok) return reply.code(422).send({ error: result.error });
    return { queryId: result.queryId };
  });

  app.get('/api/discovery', async () => {
    const rows = db
      .prepare('SELECT * FROM discovery_query ORDER BY created_at DESC LIMIT 25')
      .all() as Record<string, unknown>[];
    return rows.map(
      (r): DiscoverySummary => ({
        id: r.id as number,
        locationText: r.location_text as string,
        displayName: (r.display_name as string | null) ?? null,
        categories: JSON.parse((r.categories as string) ?? '[]') as string[],
        keyword: (r.keyword as string | null) ?? null,
        status: r.status as string,
        poisFound: r.pois_found as number,
        tilesDone: r.tiles_done as number,
        tilesTotal: r.tiles_total as number,
        createdAt: r.created_at as number,
        usedAreaFilter: r.used_area_filter === 1,
        coverageVerified: r.coverage_verified === 1,
        mirror: (r.mirror as string | null) ?? null,
        osmBase: (r.osm_base as string | null) ?? null,
        error: (r.error as string | null) ?? null,
      }),
    );
  });

  app.get('/api/discovery/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare('SELECT * FROM discovery_query WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'Discovery run not found' });

    const tiles = db
      .prepare('SELECT * FROM discovery_tile WHERE query_id = ? ORDER BY depth ASC, tile_index ASC')
      .all(id) as Record<string, unknown>[];
    const enrichment = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM business b JOIN business_discovery d ON d.business_id = b.id
              WHERE d.discovery_query_id = ? AND b.enrichment_state = 'pending') AS queued,
           (SELECT COUNT(*) FROM business b JOIN business_discovery d ON d.business_id = b.id
              WHERE d.discovery_query_id = ? AND b.enrichment_state = 'running') AS running,
           (SELECT COUNT(*) FROM business b JOIN business_discovery d ON d.business_id = b.id
              WHERE d.discovery_query_id = ? AND b.enrichment_stage = 'done') AS done,
           (SELECT COUNT(*) FROM business b JOIN business_discovery d ON d.business_id = b.id
              WHERE d.discovery_query_id = ? AND b.enrichment_state = 'failed') AS failed`,
      )
      .get(id, id, id, id) as { queued: number; running: number; done: number; failed: number };

    return {
      id: row.id as number,
      locationText: row.location_text as string,
      displayName: (row.display_name as string | null) ?? null,
      categories: JSON.parse((row.categories as string) ?? '[]') as string[],
      keyword: (row.keyword as string | null) ?? null,
      status: row.status as string,
      poisFound: row.pois_found as number,
      tilesDone: row.tiles_done as number,
      tilesTotal: row.tiles_total as number,
      createdAt: row.created_at as number,
      usedAreaFilter: row.used_area_filter === 1,
      coverageVerified: row.coverage_verified === 1,
      mirror: (row.mirror as string | null) ?? null,
      osmBase: (row.osm_base as string | null) ?? null,
      error: (row.error as string | null) ?? null,
      tiles: tiles.map((t) => ({
        index: t.tile_index as number,
        depth: t.depth as number,
        status: t.status as string,
        elementCount: t.element_count as number,
        durationMs: (t.duration_ms as number | null) ?? null,
        mirror: (t.overpass_mirror as string | null) ?? null,
        error: (t.error as string | null) ?? null,
      })),
      enrichment,
    } satisfies DiscoveryProgress;
  });

  app.post('/api/discovery/:id/cancel', async (req) => {
    discovery.cancel(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ------------------------------------------------------------------ leads
  app.get('/api/leads', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const siteStates = (q.siteStates ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as SiteState[];
    const query: LeadQuery = {
      category: q.category,
      siteStates: siteStates.length ? siteStates : undefined,
      hasEmail: q.hasEmail === '1' || q.hasEmail === 'true',
      hasPhone: q.hasPhone === '1' || q.hasPhone === 'true',
      hasSocial: q.hasSocial === '1' || q.hasSocial === 'true',
      noWebsite: q.noWebsite === '1' || q.noWebsite === 'true',
      minScore: q.minScore ? Number(q.minScore) : undefined,
      stage: q.stage as PipelineStage | undefined,
      q: q.q,
      sort: (q.sort as LeadQuery['sort']) ?? 'score',
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 25,
    };
    return listLeads(db, repo, query);
  });

  app.get('/api/leads/duplicates', async () => {
    return db
      .prepare(
        `SELECT business_a, business_b, reason, name_a, name_b, domain_a, domain_b, score_a, score_b
         FROM possible_duplicate LIMIT 200`,
      )
      .all() as Record<string, unknown>[];
  });

  app.post('/api/leads/merge', async (req, reply) => {
    const body = req.body as { keepId?: number; dropId?: number } | undefined;
    if (!body?.keepId || !body.dropId || body.keepId === body.dropId) {
      return reply.code(400).send({ error: 'keepId and dropId must be two different businesses' });
    }
    const keep = body.keepId;
    const drop = body.dropId;

    db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO business_phone (business_id, raw, e164, is_whatsapp, is_mobile, extension, source, source_url, confidence, reject_reason, created_at)
         SELECT ?, raw, e164, is_whatsapp, is_mobile, extension, source, source_url, confidence, reject_reason, created_at
         FROM business_phone WHERE business_id = ?`,
      ).run(keep, drop);
      db.prepare(
        `INSERT OR IGNORE INTO business_email (business_id, address, domain, kind, source, source_url, confidence, created_at)
         SELECT ?, address, domain, kind, source, source_url, confidence, created_at
         FROM business_email WHERE business_id = ?`,
      ).run(keep, drop);
      db.prepare(
        `INSERT OR IGNORE INTO social_account (business_id, platform, url, handle, handle_normalized, followers, followers_state,
             followers_reason, followers_source, manual_override, manual_override_at, has_video, last_checked_at, check_status, discovery_source, created_at, updated_at)
         SELECT ?, platform, url, handle, handle_normalized, followers, followers_state, followers_reason,
             followers_source, manual_override, manual_override_at, has_video, last_checked_at, check_status, discovery_source, created_at, updated_at
         FROM social_account WHERE business_id = ?`,
      ).run(keep, drop);
      db.prepare('UPDATE outreach_task SET business_id = ? WHERE business_id = ?').run(keep, drop);
      db.prepare('UPDATE pipeline_event SET business_id = ? WHERE business_id = ?').run(keep, drop);
      db.prepare(
        `INSERT OR IGNORE INTO business_discovery (business_id, discovery_query_id, first_seen_at)
         SELECT ?, discovery_query_id, first_seen_at FROM business_discovery WHERE business_id = ?`,
      ).run(keep, drop);
      db.prepare("INSERT INTO business_fts (business_fts, rowid, name, address_line) VALUES('delete', ?, (SELECT name FROM business WHERE id = ?), (SELECT address_line FROM business WHERE id = ?))").run(drop, drop, drop);
      db.prepare('DELETE FROM business WHERE id = ?').run(drop);
    })();
    repo.refreshDenorm(keep, Date.now());
    repo.rescore(keep, Date.now());
    return { ok: true };
  });

  app.get('/api/leads/:id', async (req, reply) => {
    const detail = getLeadDetail(db, repo, Number((req.params as { id: string }).id));
    if (!detail) return reply.code(404).send({ error: 'Lead not found' });
    return detail;
  });

  app.patch('/api/leads/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as
      | { pipelineStage?: PipelineStage; notes?: string | null; assignee?: string | null }
      | undefined;
    if (!repo.get(id)) return reply.code(404).send({ error: 'Lead not found' });

    if (body?.pipelineStage && (PIPELINE_STAGES as readonly string[]).includes(body.pipelineStage)) {
      tasks.setStage(id, body.pipelineStage);
    }
    if (body && 'notes' in body) {
      db.prepare('UPDATE business SET notes = ?, updated_at = ? WHERE id = ?').run(
        body.notes ?? null,
        Date.now(),
        id,
      );
    }
    if (body && 'assignee' in body) {
      db.prepare('UPDATE business SET assignee = ?, updated_at = ? WHERE id = ?').run(
        body.assignee ?? null,
        Date.now(),
        id,
      );
    }
    return getLeadDetail(db, repo, id);
  });

  app.delete('/api/leads/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const row = repo.get(id);
    if (row) {
      db.prepare("INSERT INTO business_fts (business_fts, rowid, name, address_line) VALUES('delete', ?, ?, ?)").run(
        id,
        row.name as string,
        (row.address_line as string | null) ?? '',
      );
    }
    db.prepare('DELETE FROM business WHERE id = ?').run(id);
    return { ok: true };
  });

  app.post('/api/leads/:id/enrich', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { stage?: string } | undefined;
    if (!repo.get(id)) return reply.code(404).send({ error: 'Lead not found' });

    let queued = 0;
    if (!body?.stage || body.stage === 'all' || body.stage === 'website') {
      jobs.enqueue({ type: 'probe_site', payload: { businessId: id }, dedupeKey: `probe:${id}:${Date.now()}` });
      queued++;
    }
    if (body?.stage === 'all' || body?.stage === 'socials') {
      for (const social of repo.socialsFor(id)) {
        jobs.enqueue({
          type: 'check_social',
          payload: { businessId: id, platform: social.platform, handle: social.handle ?? social.url },
          dedupeKey: `social:${id}:${social.platform}:${social.handle ?? social.url}:${Date.now()}`,
        });
        queued++;
      }
    }
    db.prepare("UPDATE business SET enrichment_state = 'pending', last_error = NULL, updated_at = ? WHERE id = ?").run(
      Date.now(),
      id,
    );
    return { queued };
  });

  app.put('/api/leads/:id/socials/:socialId', async (req, reply) => {
    const { id: rawId, socialId: rawSocialId } = req.params as { id: string; socialId: string };
    const id = Number(rawId);
    const socialId = Number(rawSocialId);
    const body = req.body as { manualOverride?: number | null } | undefined;
    const value = body?.manualOverride;

    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0)) {
      return reply.code(400).send({ error: 'Follower count must be a positive number, or null to clear it' });
    }
    const info = db
      .prepare(
        `UPDATE social_account SET manual_override = ?, manual_override_at = ?, followers_state = ?, followers_reason = ?, updated_at = ?
         WHERE id = ? AND business_id = ?`,
      )
      .run(
        value ?? null,
        value === null || value === undefined ? null : Date.now(),
        value === null || value === undefined ? 'unknown' : 'known',
        value === null || value === undefined ? null : 'manual',
        Date.now(),
        socialId,
        id,
      );
    if (!info.changes) return reply.code(404).send({ error: 'Social account not found' });

    repo.refreshDenorm(id, Date.now());
    repo.rescore(id, Date.now());
    return getLeadDetail(db, repo, id);
  });

  // ------------------------------------------------------------------ tasks
  app.get('/api/tasks', async (req) => {
    const date = ((req.query as { date?: string }).date ?? localDay()).slice(0, 10);
    const lists = tasks.forDay(date);
    // Overdue work is due, so surface it in the day's working list too.
    return { date, ...lists, dueToday: lists.open };
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = req.body as
      | { title?: string; businessId?: number | null; note?: string; dueDate?: string; channel?: TaskChannel }
      | undefined;
    if (!body?.title?.trim()) return reply.code(400).send({ error: 'A task needs a title' });
    if (body.businessId && !repo.get(body.businessId)) {
      return reply.code(404).send({ error: 'That lead no longer exists' });
    }
    return tasks.create({
      businessId: body.businessId ?? null,
      title: body.title,
      note: body.note ?? null,
      dueDate: body.dueDate,
      channel: body.channel ?? null,
    });
  });

  app.patch('/api/tasks/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as
      | { status?: TaskStatus; title?: string; note?: string | null; dueDate?: string; channel?: TaskChannel | null; snoozeUntil?: number | null }
      | undefined;
    if (!body) return reply.code(400).send({ error: 'Nothing to update' });
    if (body.status && !['open', 'done', 'cancelled', 'snoozed'].includes(body.status)) {
      return reply.code(400).send({ error: 'Unknown task status' });
    }
    const updated = tasks.update(id, body);
    if (!updated) return reply.code(404).send({ error: 'Task not found' });
    return updated;
  });

  app.delete('/api/tasks/:id', async (req) => {
    tasks.remove(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ------------------------------------------------------------------ stats
  app.get('/api/stats/summary', async () => stats.summary());

  app.get('/api/stats/daily', async (req) => {
    const q = req.query as { from?: string; to?: string };
    const to = (q.to ?? localDay()).slice(0, 10);
    const from = (q.from ?? addDays(to, -29)).slice(0, 10);
    return stats.daily(from, to);
  });

  // ------------------------------------------------------------------ export
  app.get('/api/export/leads.csv', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const result = listLeads(db, repo, {
      category: q.category,
      noWebsite: q.noWebsite === '1',
      hasEmail: q.hasEmail === '1',
      hasPhone: q.hasPhone === '1',
      hasSocial: q.hasSocial === '1',
      q: q.q,
      sort: (q.sort as LeadQuery['sort']) ?? 'score',
      page: 1,
      pageSize: 100,
    });

    const header = [
      'Name', 'Category', 'Score', 'Website state', 'Website', 'Email', 'Phone',
      'Followers', 'Socials', 'City', 'Country', 'Pipeline', 'First seen',
    ];
    const lines = [header.join(',')];
    let page = 1;
    let rows = result.rows;
    while (rows.length) {
      for (const row of rows) {
        lines.push(
          [
            csvCell(row.name),
            csvCell(row.categoryLabel ?? row.category),
            csvCell(row.score),
            csvCell(SITE_STATE_LABELS[row.siteState] ?? row.siteState),
            csvCell(row.websiteUrl),
            csvCell(row.email),
            csvCell(row.phone),
            csvCell(row.followersTotal),
            csvCell(row.socials.map((s) => s.platform).join(' ')),
            csvCell(row.city),
            csvCell(row.countryCode?.toUpperCase()),
            csvCell(row.pipelineStage),
            csvCell(new Date(row.firstSeenAt).toISOString().slice(0, 10)),
          ].join(','),
        );
      }
      if (rows.length < 100) break;
      page++;
      if (page > 50) break;
      rows = listLeads(db, repo, { ...query(q), page, pageSize: 100 }).rows;
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="outreach-leads-${localDay()}.csv"`);
    // Excel needs a BOM to read UTF-8 accents correctly.
    return `\uFEFF${lines.join('\r\n')}`;
  });

  // ------------------------------------------------------------------ meta
  app.get('/api/meta', async () => ({
    categories: CATEGORIES,
    siteStates: Object.entries(SITE_STATE_LABELS).map(([value, label]) => ({ value, label })),
    platforms: SOCIAL_PLATFORMS,
    stages: PIPELINE_STAGES,
    userAgent: userAgent(ctx.settings()),
  }));

  // ------------------------------------------------------------------ events
  app.get('/api/events', (req, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: ProgressEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: 'hello', at: Date.now() });

    const unsubscribe = ctx.subscribe(send);
    const ping = setInterval(() => send({ type: 'ping', at: Date.now() }), 25_000);

    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
    return reply;
  });
}

function query(q: Record<string, string | undefined>): LeadQuery {
  return {
    category: q.category,
    noWebsite: q.noWebsite === '1',
    hasEmail: q.hasEmail === '1',
    hasPhone: q.hasPhone === '1',
    hasSocial: q.hasSocial === '1',
    q: q.q,
    sort: (q.sort as LeadQuery['sort']) ?? 'score',
  };
}

export type { SocialPlatform };
