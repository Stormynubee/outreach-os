import type {
  EmailRef,
  LeadDetail,
  LeadQuery,
  LeadRow,
  Paged,
  PhoneRef,
  PipelineStage,
  SiteState,
  SocialRef,
  TaskRow,
} from '@outreach/shared';
import { SCORE_VERSION } from '@outreach/shared';
import type { Db } from './client.ts';
import type { NormalizedPoi } from '../discovery/normalize.ts';
import { RESCORE_ALL_SQL, RESCORE_ONE_SQL } from '../scoring/score-sql.ts';
import type { OfferPreset } from '@outreach/shared';
import { sitePoints } from '@outreach/shared';
import { normalizePhone } from '../enrich/extractPhone.ts';

/**
 * A follower count is "known" only when the platform confirmed it, or a human
 * typed it in. A manual override always beats a scraped value.
 */
const KNOWN_FOLLOWERS = `COALESCE(s.manual_override, (CASE WHEN s.followers_state = 'known' THEN s.followers END))`;

interface SocialRow {
  id: number;
  business_id: number;
  platform: string;
  url: string;
  handle: string | null;
  followers: number | null;
  followers_state: string;
  followers_reason: string | null;
  followers_source: string | null;
  manual_override: number | null;
  has_video: number;
  discovery_source: string;
  last_checked_at: number | null;
}

function mapSocial(s: SocialRow): SocialRef {
  return {
    id: s.id,
    platform: s.platform as SocialRef['platform'],
    url: s.url,
    handle: s.handle,
    followers: s.followers,
    followersState: s.followers_state as SocialRef['followersState'],
    followersReason: s.followers_reason,
    followersSource: s.followers_source,
    manualOverride: s.manual_override,
    hasVideo: s.has_video === 1,
    discoverySource: s.discovery_source as SocialRef['discoverySource'],
    lastCheckedAt: s.last_checked_at,
  };
}

function mapTask(t: Record<string, unknown>): TaskRow {
  return {
    id: t.id as number,
    businessId: (t.business_id as number | null) ?? null,
    businessName: (t.business_name as string | null) ?? null,
    businessScore: (t.business_score as number | null) ?? null,
    businessSiteState: (t.business_site_state as SiteState | null) ?? null,
    title: t.title as string,
    note: (t.note as string | null) ?? null,
    dueDate: t.due_date as string,
    status: t.status as TaskRow['status'],
    channel: (t.channel as TaskRow['channel']) ?? null,
    doneAt: (t.done_at as number | null) ?? null,
    snoozeUntil: (t.snooze_until as number | null) ?? null,
    createdAt: t.created_at as number,
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === 'string' ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function toLeadRow(row: Record<string, unknown>, socials: SocialRef[]): LeadRow {
  return {
    id: row.id as number,
    name: row.name as string,
    category: row.category as string,
    categoryLabel: (row.category_label as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    countryCode: (row.country_code as string | null) ?? null,
    score: row.score as number,
    confidenceFactor: row.confidence_factor as number,
    siteState: row.site_state as SiteState,
    websiteUrl: (row.website_url as string | null) ?? null,
    websiteDomain: (row.website_domain as string | null) ?? null,
    hasWebsite: row.has_website === 1,
    hasSsl: row.has_ssl === 1,
    phone: (row.phone_e164 as string | null) ?? (row.phone_raw as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    hasPhone: row.has_phone === 1,
    hasEmail: row.has_email === 1,
    hasSocial: row.has_social === 1,
    followersTotal: (row.followers_total as number | null) ?? null,
    followersKnown: (row.followers_known as number) ?? 0,
    hasVideo: ((row.video_platforms as number) ?? 0) > 0,
    pipelineStage: row.pipeline_stage as PipelineStage,
    enrichmentState: row.enrichment_state as string,
    socials,
    firstSeenAt: row.first_seen_at as number,
  };
}

/** States that mean "no working website" — the core sales signal. */
const NO_WEBSITE_STATES: SiteState[] = ['no_tag', 'social_only', 'dead', 'parked', 'server_down'];

/** Sanitize input for fts5 MATCH, which has its own query syntax. */
function ftsQuery(q: string): string | null {
  const cleaned = q.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!cleaned) return null;
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(' ');
}

export interface UpsertResult {
  id: number;
  isNew: boolean;
}

export function createBusinessRepo(db: Db) {
  let offerPreset: OfferPreset = 'websites';

  /** Preset values feed straight into the SQL scorer, so flipping it re-ranks everything. */
  const presetParams = () => ({
    p_no_tag: sitePoints('no_tag', offerPreset),
    p_social_only: sitePoints('social_only', offerPreset),
  });

  const upsertStmt = db.prepare(`
    INSERT INTO business (
      osm_key, osm_type, osm_id, name, name_normalized, category, category_label, osm_tags,
      lat, lon, country_code, address_line, street, house_number, city, postcode, state,
      phone_raw, website_url, website_domain, dedupe_key,
      site_state, enrichment_stage, enrichment_state,
      first_seen_at, last_seen_at, updated_at
    ) VALUES (
      @osm_key, @osm_type, @osm_id, @name, @name_normalized, @category, @category_label, @osm_tags,
      @lat, @lon, @country_code, @address_line, @street, @house_number, @city, @postcode, @state,
      @phone_raw, @website_url, @website_domain, @dedupe_key,
      @site_state, 'none', 'pending',
      @now, @now, @now
    )
    ON CONFLICT(osm_key) DO UPDATE SET
      name = excluded.name,
      name_normalized = excluded.name_normalized,
      category = excluded.category,
      category_label = excluded.category_label,
      osm_tags = excluded.osm_tags,
      lat = COALESCE(excluded.lat, business.lat),
      lon = COALESCE(excluded.lon, business.lon),
      country_code = COALESCE(excluded.country_code, business.country_code),
      address_line = COALESCE(excluded.address_line, business.address_line),
      city = COALESCE(excluded.city, business.city),
      postcode = COALESCE(excluded.postcode, business.postcode),
      state = COALESCE(excluded.state, business.state),
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at
    RETURNING id`);

  const ftsInsert = db.prepare(
    'INSERT OR REPLACE INTO business_fts (rowid, name, address_line) VALUES (?, ?, ?)',
  );
  const ftsDelete = db.prepare(
    "INSERT INTO business_fts (business_fts, rowid, name, address_line) VALUES('delete', ?, ?, ?)",
  );
  // Existence is checked before the upsert rather than inferred from a timestamp:
  // two upserts of the same POI inside one millisecond would otherwise both look
  // new and collide in the search index.
  const idByOsm = db.prepare('SELECT id FROM business WHERE osm_key = ?');
  const linkStmt = db.prepare(
    'INSERT OR IGNORE INTO business_discovery (business_id, discovery_query_id, first_seen_at) VALUES (?, ?, ?)',
  );
  const existingForFts = db.prepare('SELECT name, address_line FROM business WHERE id = ?');
  const phoneInsert = db.prepare(`
    INSERT OR IGNORE INTO business_phone (business_id, raw, e164, is_whatsapp, is_mobile, extension, source, source_url, confidence, reject_reason, created_at)
    VALUES (@business_id, @raw, @e164, @is_whatsapp, @is_mobile, @extension, @source, @source_url, @confidence, @reject_reason, @created_at)`);
  const emailInsert = db.prepare(`
    INSERT OR IGNORE INTO business_email (business_id, address, domain, kind, source, source_url, confidence, created_at)
    VALUES (@business_id, @address, @domain, @kind, @source, @source_url, @confidence, @created_at)`);
  const socialInsert = db.prepare(`
    INSERT INTO social_account (business_id, platform, url, handle, handle_normalized, followers, followers_state,
                                followers_reason, followers_source, has_video, check_status, discovery_source, created_at, updated_at)
    VALUES (@business_id, @platform, @url, @handle, @handle_normalized, NULL, 'not_attempted',
            NULL, NULL, 0, NULL, @discovery_source, @created_at, @created_at)
    ON CONFLICT(business_id, platform, handle_normalized) DO UPDATE SET
      url = excluded.url,
      handle = COALESCE(excluded.handle, social_account.handle),
      updated_at = excluded.updated_at`);

  /**
   * Recompute every denormalized scoring input from the child tables, then rescore.
   * One statement per business, so the ranking can never be stale relative to the data.
   */
  const refreshDenorm = db.prepare(`
    UPDATE business SET
      has_phone = (CASE WHEN EXISTS (SELECT 1 FROM business_phone p WHERE p.business_id = business.id AND p.e164 IS NOT NULL) THEN 1 ELSE 0 END),
      has_email = (CASE WHEN EXISTS (SELECT 1 FROM business_email e WHERE e.business_id = business.id AND e.kind <> 'noreply') THEN 1 ELSE 0 END),
      email = (SELECT e.address FROM business_email e WHERE e.business_id = business.id
               ORDER BY (CASE e.kind WHEN 'role' THEN 0 WHEN 'personal' THEN 1 ELSE 2 END), e.confidence DESC LIMIT 1),
      phone_e164 = (SELECT p.e164 FROM business_phone p WHERE p.business_id = business.id AND p.e164 IS NOT NULL ORDER BY p.confidence DESC LIMIT 1),
      phone_raw = (SELECT p.raw FROM business_phone p WHERE p.business_id = business.id ORDER BY p.confidence DESC LIMIT 1),
      has_social = (CASE WHEN EXISTS (SELECT 1 FROM social_account s WHERE s.business_id = business.id) THEN 1 ELSE 0 END),
      followers_known = (SELECT COUNT(*) FROM social_account s WHERE s.business_id = business.id AND ${KNOWN_FOLLOWERS} IS NOT NULL),
      followers_total = (SELECT SUM(${KNOWN_FOLLOWERS}) FROM social_account s WHERE s.business_id = business.id AND ${KNOWN_FOLLOWERS} IS NOT NULL),
      video_platforms = (SELECT COUNT(*) FROM social_account s WHERE s.business_id = business.id AND s.has_video = 1),
      social_magnitude_tier = (CASE
        WHEN (SELECT COUNT(*) FROM social_account s WHERE s.business_id = business.id AND ${KNOWN_FOLLOWERS} IS NOT NULL) = 0 THEN 'unknown'
        WHEN (SELECT MAX(${KNOWN_FOLLOWERS}) FROM social_account s WHERE s.business_id = business.id) < 500 THEN 'under500'
        WHEN (SELECT MAX(${KNOWN_FOLLOWERS}) FROM social_account s WHERE s.business_id = business.id) < 2000 THEN 'under2k'
        WHEN (SELECT MAX(${KNOWN_FOLLOWERS}) FROM social_account s WHERE s.business_id = business.id) < 10000 THEN 'under10k'
        ELSE 'atLeast10k' END),
      has_website = (CASE WHEN website_url IS NOT NULL AND site_state NOT IN ('no_tag','social_only') THEN 1 ELSE 0 END),
      updated_at = :now
    WHERE id = :id`);

  const rescoreOne = db.prepare(RESCORE_ONE_SQL);

  function rescore(id: number, now: number): void {
    rescoreOne.run({ id, now, score_version: SCORE_VERSION, ...presetParams() });
  }

  const byIdStmt = db.prepare('SELECT * FROM business WHERE id = ?');
  const socialsForStmt = db.prepare('SELECT * FROM social_account WHERE business_id = ? ORDER BY platform ASC');
  const socialsForManyStmt = db.prepare(
    'SELECT * FROM social_account WHERE business_id IN (SELECT value FROM json_each(?)) ORDER BY platform ASC',
  );
  const emailsForStmt = db.prepare(
    'SELECT id, address, kind, source, source_url, confidence FROM business_email WHERE business_id = ? ORDER BY confidence DESC, id ASC',
  );
  const phonesForStmt = db.prepare(
    'SELECT id, raw, e164, is_whatsapp, is_mobile, source, confidence, reject_reason FROM business_phone WHERE business_id = ? ORDER BY confidence DESC, id ASC',
  );
  const tasksForStmt = db.prepare(
    `SELECT t.id, t.business_id, t.title, t.note, t.due_date, t.status, t.channel, t.done_at, t.snooze_until, t.created_at,
            b.name AS business_name, b.score AS business_score, b.site_state AS business_site_state
     FROM outreach_task t LEFT JOIN business b ON b.id = t.business_id
     WHERE t.business_id = ? ORDER BY t.created_at DESC LIMIT 50`,
  );

  return {
    setPreset: (preset: OfferPreset) => {
      offerPreset = preset;
    },
    upsertPoi(poi: NormalizedPoi, queryId: number | null, now: number, countryHint?: string | null): UpsertResult {
      const norm = poi.websiteNormalized;
      const isRealSite = !!norm && !norm.isSocial && !norm.isAggregator;
      const siteState: SiteState = isRealSite
        ? 'has_tag_unprobed'
        : norm?.isSocial || poi.socials.length > 0
          ? 'social_only'
          : 'no_tag';

      const existed = idByOsm.get(poi.osmKey) as { id: number } | undefined;

      const row = upsertStmt.get({
        osm_key: poi.osmKey,
        osm_type: poi.osmType,
        osm_id: poi.osmId,
        name: poi.name,
        name_normalized: poi.nameNormalized,
        category: poi.category,
        category_label: poi.categoryLabel,
        osm_tags: JSON.stringify(poi.osmTags),
        lat: poi.lat,
        lon: poi.lon,
        country_code: poi.countryCode,
        address_line: poi.addressLine,
        street: poi.street,
        house_number: poi.houseNumber,
        city: poi.city,
        postcode: poi.postcode,
        state: poi.state,
        phone_raw: poi.phones[0] ?? null,
        // A social URL in the website tag is common in OSM and must never be
        // recorded as a website — it is one of the strongest lead signals we have.
        website_url: isRealSite ? norm.url : null,
        website_domain: isRealSite ? norm.domain : null,
        dedupe_key: norm ? norm.dedupeKey : poi.addressLine ?? poi.nameNormalized,
        site_state: siteState,
        now,
      }) as { id: number } | undefined;

      if (!row) throw new Error(`failed to upsert business ${poi.osmKey}`);
      const isNew = existed === undefined;

      if (isNew) {
        ftsInsert.run(row.id, poi.name, poi.addressLine ?? '');
      } else {
        const existing = existingForFts.get(row.id) as { name: string; address_line: string | null } | undefined;
        if (existing && (existing.name !== poi.name || (existing.address_line ?? '') !== (poi.addressLine ?? ''))) {
          ftsDelete.run(row.id, existing.name, existing.address_line ?? '');
          ftsInsert.run(row.id, poi.name, poi.addressLine ?? '');
        }
      }

      if (queryId !== null) linkStmt.run(row.id, queryId, now);

      // OSM contact tags land immediately, so the list is useful before any scraping.
      // Numbers are normalized here rather than left raw: a phone that never becomes
      // E.164 does not count towards contactability, and would silently cost the
      // highest-value leads their contact points.
      const phoneCountry = countryHint ?? poi.countryCode ?? null;
      for (const raw of poi.phones) {
        const normalized = normalizePhone(raw, phoneCountry);
        phoneInsert.run({
          business_id: row.id,
          raw,
          e164: normalized.e164,
          is_whatsapp: 0,
          is_mobile: normalized.isMobile ? 1 : 0,
          extension: null,
          source: 'osm',
          source_url: null,
          confidence: normalized.e164 ? 0.7 : 0.5,
          reject_reason: normalized.rejectReason,
          created_at: now,
        });
      }
      for (const address of poi.emails) {
        emailInsert.run({
          business_id: row.id, address: address.toLowerCase(), domain: address.split('@')[1]?.toLowerCase() ?? null,
          kind: 'role', source: 'osm', source_url: null, confidence: 0.6, created_at: now,
        });
      }
      const socialsToAdd = [...poi.socials];
      if (norm?.isSocial && norm.platform) {
        socialsToAdd.push({ platform: norm.platform, url: norm.url, handle: norm.handle, dedupeKey: norm.dedupeKey });
      }
      for (const social of socialsToAdd) {
        socialInsert.run({
          business_id: row.id,
          platform: social.platform,
          url: social.url,
          handle: social.handle,
          handle_normalized: social.handle ?? social.url.toLowerCase(),
          discovery_source: 'osm',
          created_at: now,
        });
      }

      refreshDenorm.run({ id: row.id, now });
      rescore(row.id, now);
      return { id: row.id, isNew };
    },
    addPhone(businessId: number, input: Omit<PhoneRef, 'id'> & { sourceUrl?: string | null }, now: number) {
      phoneInsert.run({
        business_id: businessId,
        raw: input.raw,
        e164: input.e164,
        is_whatsapp: input.isWhatsapp ? 1 : 0,
        is_mobile: input.isMobile ? 1 : 0,
        extension: null,
        source: input.source,
        source_url: input.sourceUrl ?? null,
        confidence: input.confidence,
        reject_reason: input.rejectReason,
        created_at: now,
      });
    },
    addEmail(businessId: number, input: Omit<EmailRef, 'id'> & { sourceUrl?: string | null }, now: number) {
      emailInsert.run({
        business_id: businessId,
        address: input.address.toLowerCase(),
        domain: input.address.split('@')[1]?.toLowerCase() ?? null,
        kind: input.kind,
        source: input.source,
        source_url: input.sourceUrl ?? null,
        confidence: input.confidence,
        created_at: now,
      });
    },
    addSocial(
      businessId: number,
      social: { platform: string; url: string; handle: string | null; discoverySource: string },
      now: number,
    ) {
      socialInsert.run({
        business_id: businessId,
        platform: social.platform,
        url: social.url,
        handle: social.handle,
        handle_normalized: social.handle ?? social.url.toLowerCase(),
        discovery_source: social.discoverySource,
        created_at: now,
      });
    },
    refreshDenorm: (id: number, now: number) => refreshDenorm.run({ id, now }),
    rescore,
    rescoreAll(now: number, chunk = 500): number {
      const stmt = db.prepare(RESCORE_ALL_SQL);
      let offset = 0;
      let total = 0;
      for (;;) {
        const info = stmt.run({ now, limit: chunk, offset, score_version: SCORE_VERSION, ...presetParams() });
        total += info.changes;
        if (info.changes < chunk) break;
        offset += chunk;
      }
      return total;
    },
    get: (id: number) => byIdStmt.get(id) as Record<string, unknown> | undefined,
    socialsFor: (id: number) => (socialsForStmt.all(id) as SocialRow[]).map(mapSocial),
    emailsFor: (id: number) => emailsForStmt.all(id) as EmailRef[],
    phonesFor: (id: number) => phonesForStmt.all(id) as PhoneRef[],
    tasksFor: (id: number) => (tasksForStmt.all(id) as Record<string, unknown>[]).map(mapTask),
    socialsForMany(ids: number[]): Map<number, SocialRef[]> {
      const out = new Map<number, SocialRef[]>();
      if (!ids.length) return out;
      const rows = socialsForManyStmt.all(JSON.stringify(ids)) as SocialRow[];
      for (const row of rows) {
        const list = out.get(row.business_id) ?? [];
        list.push(mapSocial(row));
        out.set(row.business_id, list);
      }
      return out;
    },
  };
}

export type BusinessRepo = ReturnType<typeof createBusinessRepo>;

export function listLeads(db: Db, repo: BusinessRepo, query: LeadQuery): Paged<LeadRow> {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.category && query.category !== 'all') {
    where.push('b.category = :category');
    params.category = query.category;
  }
  if (query.siteStates?.length) {
    where.push(`b.site_state IN (${query.siteStates.map((_, i) => `:state${i}`).join(',')})`);
    query.siteStates.forEach((s, i) => (params[`state${i}`] = s));
  }
  if (query.noWebsite) {
    where.push(`b.site_state IN (${NO_WEBSITE_STATES.map((_, i) => `:nw${i}`).join(',')})`);
    NO_WEBSITE_STATES.forEach((s, i) => (params[`nw${i}`] = s));
  }
  if (query.hasEmail) where.push('b.has_email = 1');
  if (query.hasPhone) where.push('b.has_phone = 1');
  if (query.hasSocial) where.push('b.has_social = 1');
  if (typeof query.minScore === 'number') {
    where.push('b.score >= :minScore');
    params.minScore = query.minScore;
  }
  if (query.stage) {
    where.push('b.pipeline_stage = :stage');
    params.stage = query.stage;
  }

  let ftsJoin = '';
  if (query.q?.trim()) {
    const match = ftsQuery(query.q);
    if (match) {
      // LEFT UNALIASED on purpose: fts5's MATCH operator needs the table name, and
      // an alias makes SQLite report "no such column".
      ftsJoin = 'JOIN business_fts ON business_fts.rowid = b.id';
      where.push('business_fts MATCH :match');
      params.match = match;
    } else {
      where.push('b.name LIKE :like');
      params.like = `%${query.q.trim()}%`;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortMap: Record<string, string> = {
    score: 'b.score DESC, (b.has_phone + b.has_email) DESC, b.name ASC',
    name: 'b.name ASC',
    recent: 'b.first_seen_at DESC',
    followers: 'b.followers_total IS NULL, b.followers_total DESC, b.score DESC',
  };
  const orderBy = sortMap[query.sort ?? 'score'] ?? sortMap.score!;

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM business b ${ftsJoin} ${whereSql}`).get(params) as { n: number }
  ).n;

  const rows = db
    .prepare(`SELECT b.* FROM business b ${ftsJoin} ${whereSql} ORDER BY ${orderBy} LIMIT :limit OFFSET :offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[];

  const socials = repo.socialsForMany(rows.map((r) => r.id as number));

  return {
    rows: rows.map((r) => toLeadRow(r, socials.get(r.id as number) ?? [])),
    total,
    page,
    pageSize,
  };
}

export function getLeadDetail(db: Db, repo: BusinessRepo, id: number): LeadDetail | null {
  const row = repo.get(id);
  if (!row) return null;
  const socials = repo.socialsFor(id);

  return {
    ...toLeadRow(row, socials),
    osmKey: row.osm_key as string,
    osmType: row.osm_type as string,
    lat: (row.lat as number | null) ?? null,
    lon: (row.lon as number | null) ?? null,
    addressLine: (row.address_line as string | null) ?? null,
    street: (row.street as string | null) ?? null,
    houseNumber: (row.house_number as string | null) ?? null,
    postcode: (row.postcode as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    phoneRaw: (row.phone_raw as string | null) ?? null,
    emailState: row.email_state as string,
    finalUrl: (row.final_url as string | null) ?? null,
    httpStatus: (row.http_status as number | null) ?? null,
    siteTitle: (row.site_title as string | null) ?? null,
    platform: (row.platform as string | null) ?? null,
    parkingEvidence: parseJson<string[]>(row.parking_evidence, []),
    scoreReasons: parseJson<string[]>(row.score_reasons, []),
    enrichmentStage: row.enrichment_stage as string,
    enrichmentError: (row.last_error as string | null) ?? null,
    lastErrorStage: (row.last_error_stage as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    assignee: (row.assignee as string | null) ?? null,
    scoredAt: (row.scored_at as number | null) ?? null,
    enrichedAt: (row.enriched_at as number | null) ?? null,
    osmTags: parseJson<Record<string, string>>(row.osm_tags, {}),
    emails: repo.emailsFor(id),
    phones: repo.phonesFor(id),
    socialDetails: socials,
    tasks: repo.tasksFor(id),
  };
}

export { NO_WEBSITE_STATES, mapTask, mapSocial };
export type { SocialRow };
