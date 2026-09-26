import { createHash } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { Settings } from '../settings.ts';
import { userAgent } from '../settings.ts';
import { mergeSelectors, selectorRegex, type Category } from '@outreach/shared';
import type { BBox } from './geocode.ts';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Why a query failed, because the right response differs:
 *  - server_timeout: the Overpass server aborted the query (too big/slow) → split the tile
 *  - unavailable: the mirror is down or unreachable → do NOT split, wait instead
 *  - bad_request: the query was rejected → a bug or an unsupported server version
 */
export type FailureKind = 'ok' | 'server_timeout' | 'unavailable' | 'bad_request';

export interface OverpassQueryResult {
  ok: boolean;
  elements: OverpassElement[];
  osmBase: string | null;
  generator: string | null;
  mirror: string;
  /** Set when the server returned a 200 with an embedded error, which Overpass does. */
  remark: string | null;
  error: string | null;
  failureKind: FailureKind;
  durationMs: number;
  fromCache: boolean;
  /** True when the element count hit the query cap, so the tile must be split. */
  capped: boolean;
}

export interface MirrorState {
  url: string;
  host: string;
  ok: number;
  failures: number;
  avgMs: number | null;
  lastElementCount: number | null;
  unhealthyUntil: number | null;
  lastError: string | null;
}

export const ELEMENT_CAP = 3000;

export interface BuildQueryOptions {
  categories: Category[];
  bbox: BBox;
  areaId?: number | null;
  keyword?: string | null;
  limit?: number;
}

/**
 * One union query per tile covering every category at once — far fewer requests
 * than one query per category, which matters against a rate-limited public API.
 *
 * `center` is mandatory: most business POIs are ways/relations and simply have no
 * coordinates without it. `["name"]` halves the payload and pre-filters junk.
 */
export function buildPoiQuery(opts: BuildQueryOptions): string {
  const { south, west, north, east } = opts.bbox;
  const bbox = `(${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)})`;
  const limit = opts.limit ?? ELEMENT_CAP;

  const areaDecl = opts.areaId ? `area(${opts.areaId})->.a;\n` : '';
  const scope = opts.areaId ? '(area.a)' : '';
  const keyword = opts.keyword?.trim();

  const lines: string[] = [];
  for (const sel of mergeSelectors(opts.categories)) {
    const nameFilter = keyword
      ? `["name"~"${keyword.replace(/["\\]/g, '')}",i]`
      : '["name"]';
    lines.push(`  nwr["${sel.key}"~"${selectorRegex(sel.values)}"]${nameFilter}${scope}${bbox};`);
  }

  return `[out:json][timeout:60][maxsize:1073741824];
${areaDecl}(
${lines.join('\n')}
);
out tags center ${limit};`;
}

const FATAL_REMARK = /(runtime error|timed? ?out|out of memory|parse error)/i;

export interface ParsedOverpass {
  ok: boolean;
  elements: OverpassElement[];
  osmBase: string | null;
  generator: string | null;
  remark: string | null;
  error: string | null;
  failureKind: FailureKind;
}

/** An Overpass-generated error page identifies itself; a gateway error does not. */
const OVERPASS_ERROR_PAGE = /OSM3S Response|Overpass API/i;
/**
 * Only these mean "this specific query was too much for the server", which is the
 * one case where asking for a smaller area actually helps. A busy server reports
 * "Dispatcher ... timeout ... probably too busy", which is load, not query size —
 * splitting on that just multiplies the load.
 */
const QUERY_TOO_HEAVY = /(query timed out|query run out|out of memory)/i;

/**
 * Overpass answers a timed-out or broken query with HTTP 200 and either an HTML
 * error page or a JSON body carrying a `remark`. The status code alone is not
 * trustworthy — this is the single most common way an Overpass client silently
 * records "no businesses here" for a city that actually has thousands.
 */
export function parseOverpassBody(body: string, status: number): ParsedOverpass {
  const empty = { elements: [], osmBase: null, generator: null, remark: null };

  if (!body.trim()) {
    return { ok: false, ...empty, error: `Empty response (HTTP ${status})`, failureKind: 'unavailable' };
  }

  if (body.trimStart().startsWith('<')) {
    // Anything that is not an Overpass error page is infrastructure in the way —
    // a gateway, a captive portal, a maintenance page. Only a 4xx blames the query.
    const kind: FailureKind =
      OVERPASS_ERROR_PAGE.test(body) && QUERY_TOO_HEAVY.test(body)
        ? 'server_timeout'
        : status >= 400 && status < 500
          ? 'bad_request'
          : 'unavailable';
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      ok: false,
      ...empty,
      error: `${kind === 'server_timeout' ? 'The server aborted the query' : 'The server is too busy to answer'} (HTTP ${status}): ${text.slice(0, 180)}`,
      failureKind: kind,
    };
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { ok: false, ...empty, error: `Response was not JSON (HTTP ${status})`, failureKind: 'bad_request' };
  }

  const remark = typeof json.remark === 'string' ? json.remark : null;
  const elements = Array.isArray(json.elements) ? (json.elements as OverpassElement[]) : null;
  const osm3s = (json.osm3s ?? {}) as Record<string, string>;
  const meta = {
    osmBase: osm3s.timestamp_osm_base ?? null,
    generator: typeof json.generator === 'string' ? json.generator : null,
    remark,
  };

  if (!elements) {
    return { ok: false, ...meta, elements: [], error: 'Response had no elements array', failureKind: 'bad_request' };
  }
  if (remark && FATAL_REMARK.test(remark)) {
    return { ok: false, ...meta, elements, error: remark, failureKind: 'server_timeout' };
  }
  if (status >= 400) {
    return {
      ok: false,
      ...meta,
      elements,
      error: `HTTP ${status}`,
      failureKind: status >= 500 ? 'unavailable' : 'bad_request',
    };
  }
  if (!elements.length && status === 200) {
    // A legitimate empty result — the coverage guard in the discovery run decides
    // whether to distrust it.
    return { ok: true, ...meta, elements, error: null, failureKind: 'ok' };
  }

  return { ok: true, ...meta, elements, error: null, failureKind: 'ok' };
}

export interface OverpassClient {
  run(
    query: string,
    opts?: { allowCache?: boolean; timeoutMs?: number; exclude?: string[] },
  ): Promise<OverpassQueryResult>;
  health(): MirrorState[];
  stats(): { healthy: number; total: number };
  /**
   * Record an out-of-band failure. Used by the coverage guard when a mirror
   * answers 200 with valid JSON but silently incomplete data.
   */
  penalize(url: string, reason: string): void;
}

export interface OverpassClientOptions {
  db: Db;
  settings: () => Settings;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onMirror?: (state: MirrorState) => void;
}

const HEALTH_KEY = 'mirrorHealth';

export function createOverpassClient(opts: OverpassClientOptions): OverpassClient {
  const { db } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());

  const readHealth = db.prepare('SELECT value FROM settings WHERE key = ?');
  const writeHealth = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);

  const states = new Map<string, MirrorState>();

  function hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  function hydrate(): void {
    const row = readHealth.get(HEALTH_KEY) as { value: string } | undefined;
    if (row) {
      try {
        for (const s of JSON.parse(row.value) as MirrorState[]) states.set(s.url, s);
      } catch {
        /* ignore corrupt health blob */
      }
    }
    for (const url of opts.settings().overpassMirrors) {
      if (!states.has(url)) {
        states.set(url, {
          url,
          host: hostOf(url),
          ok: 0,
          failures: 0,
          avgMs: null,
          lastElementCount: null,
          unhealthyUntil: null,
          lastError: null,
        });
      }
    }
  }

  function persist(): void {
    writeHealth.run(HEALTH_KEY, JSON.stringify([...states.values()]), now());
  }

  hydrate();

  function ranked(): MirrorState[] {
    const all = [...states.values()];
    const t = now();
    const healthy = all.filter((s) => !s.unhealthyUntil || s.unhealthyUntil < t);
    const pool = healthy.length ? healthy : all;
    return pool.sort((a, b) => {
      const aPenalty = a.unhealthyUntil && a.unhealthyUntil > t ? 1 : 0;
      const bPenalty = b.unhealthyUntil && b.unhealthyUntil > t ? 1 : 0;
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      if (a.failures !== b.failures) return a.failures - b.failures;
      // Prefer mirrors that have actually answered, then the fastest of those.
      if (a.ok !== b.ok) return b.ok - a.ok;
      return (a.avgMs ?? 20_000) - (b.avgMs ?? 20_000);
    });
  }

  function record(state: MirrorState, ok: boolean, ms: number, elementCount: number | null, error: string | null): void {
    state.failures = ok ? 0 : state.failures + 1;
    if (ok) {
      state.ok += 1;
      state.avgMs = state.avgMs === null ? ms : Math.round(state.avgMs * 0.7 + ms * 0.3);
      state.lastElementCount = elementCount;
      state.unhealthyUntil = null;
      state.lastError = null;
    } else {
      state.lastError = error;
      // Escalating cooldown: a mirror that keeps failing is skipped for longer.
      const minutes = Math.min(30, 5 * state.failures);
      state.unhealthyUntil = now() + minutes * 60_000;
    }
    // Persist on every change, not just on total failure — otherwise a success
    // would be lost on restart and the ranking would keep starting from scratch.
    persist();
    opts.onMirror?.({ ...state });
  }

  const cacheRead = db.prepare(`
    SELECT c.id AS id, c.status_code, c.fetched_at, c.expires_at, b.body_gz
    FROM http_cache c LEFT JOIN http_body b ON b.http_cache_id = c.id
    WHERE c.url_key = ?`);
  const cacheWrite = db.prepare(`
    INSERT INTO http_cache (url_key, domain, kind, status_code, final_url, content_type, size_bytes,
                            fetch_state, error_kind, attempts, fetched_at, expires_at, ttl_seconds)
    VALUES (@url_key, @domain, @kind, @status_code, @final_url, @content_type, @size_bytes,
            @fetch_state, @error_kind, 1, @fetched_at, @expires_at, @ttl_seconds)
    ON CONFLICT(url_key) DO UPDATE SET status_code = @status_code, fetched_at = @fetched_at,
      expires_at = @expires_at, attempts = http_cache.attempts + 1, fetch_state = @fetch_state`);
  const cacheBody = db.prepare(`
    INSERT INTO http_body (http_cache_id, body_gz) VALUES (?, ?)
    ON CONFLICT(http_cache_id) DO UPDATE SET body_gz = excluded.body_gz`);

  async function run(
    query: string,
    runOpts: { allowCache?: boolean; timeoutMs?: number; exclude?: string[] } = {},
  ): Promise<OverpassQueryResult> {
    const settings = opts.settings();
    const started = now();
    const allowCache = runOpts.allowCache ?? true;
    // Hashed over the WHOLE query. Truncating the key instead would make every
    // tile of a search share one entry — the tile bbox sits at the end of the
    // query, so a short prefix is identical for all of them.
    const urlKey = `overpass:${createHash('sha256').update(query).digest('hex').slice(0, 40)}`;

    if (allowCache) {
      const hit = cacheRead.get(urlKey) as
        | { id: number; status_code: number; fetched_at: number; expires_at: number; body_gz: Buffer | null }
        | undefined;
      if (hit && hit.expires_at > started && hit.body_gz) {
        const parsed = parseOverpassBody(hit.body_gz.toString('utf8'), hit.status_code);
        if (parsed.ok) {
          return {
            ok: true,
            elements: parsed.elements,
            osmBase: parsed.osmBase,
            generator: parsed.generator,
            mirror: 'cache',
            remark: parsed.remark,
            error: null,
            failureKind: 'ok',
            durationMs: 0,
            fromCache: true,
            capped: parsed.elements.length >= ELEMENT_CAP,
          };
        }
      }
    }

    const timeoutMs = runOpts.timeoutMs ?? settings.overpassTimeoutMs;
    const excluded = new Set(runOpts.exclude ?? []);
    const candidates = ranked().filter((m) => !excluded.has(m.url));
    const errors: string[] = [];
    const kinds: FailureKind[] = [];

    for (const mirror of candidates) {
      const t0 = now();
      try {
        const res = await doFetch(mirror.url, {
          method: 'POST',
          headers: {
            'User-Agent': userAgent(settings),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(timeoutMs),
        });

        const status = res.status;
        const text = await res.text();

        // 429/406 means we are being throttled: pause the whole client for 30s
        // rather than immediately retrying another mirror, per the Overpass policy.
        if (status === 429 || status === 406) {
          record(mirror, false, now() - t0, null, `HTTP ${status} (throttled)`);
          errors.push(`${mirror.host}: HTTP ${status}`);
          kinds.push('unavailable');
          await new Promise((r) => setTimeout(r, 30_000));
          continue;
        }

        const parsed = parseOverpassBody(text, status);
        if (!parsed.ok) {
          record(mirror, false, now() - t0, null, parsed.error ?? 'unknown');
          errors.push(`${mirror.host}: ${parsed.error ?? 'unknown'}`);
          kinds.push(parsed.failureKind);
          continue;
        }

        const ms = now() - t0;
        record(mirror, true, ms, parsed.elements.length, null);

        if (allowCache) {
          const ttl = 6 * 3600;
          cacheWrite.run({
            url_key: urlKey,
            domain: mirror.host,
            kind: 'other',
            status_code: 200,
            final_url: mirror.url,
            content_type: 'application/json',
            size_bytes: Buffer.byteLength(text),
            fetch_state: 'ok',
            error_kind: null,
            fetched_at: now(),
            expires_at: now() + ttl * 1000,
            ttl_seconds: ttl,
          });
          const idRow = cacheRead.get(urlKey) as { id: number } | undefined;
          if (idRow) cacheBody.run(idRow.id, Buffer.from(text, 'utf8'));
        }

        return {
          ok: true,
          elements: parsed.elements,
          osmBase: parsed.osmBase,
          generator: parsed.generator,
          mirror: mirror.url,
          remark: parsed.remark,
          error: null,
          failureKind: 'ok',
          durationMs: ms,
          fromCache: false,
          capped: parsed.elements.length >= ELEMENT_CAP,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record(mirror, false, now() - t0, null, message.slice(0, 160));
        errors.push(`${mirror.host}: ${message.slice(0, 80)}`);
        // A connect/read failure says nothing about the size of the query.
        kinds.push('unavailable');
      }
    }

    // If any mirror told us the query itself was too heavy, splitting is the right
    // response. If they were merely unreachable, splitting would multiply the load
    // on mirrors that are already struggling.
    const failureKind: FailureKind = kinds.includes('server_timeout')
      ? 'server_timeout'
      : kinds.includes('bad_request')
        ? 'bad_request'
        : 'unavailable';

    return {
      ok: false,
      elements: [],
      osmBase: null,
      generator: null,
      mirror: '',
      remark: null,
      error: errors.length ? `All Overpass mirrors failed — ${errors.join('; ')}` : 'No Overpass mirrors configured',
      failureKind,
      durationMs: now() - started,
      fromCache: false,
      capped: false,
    };
  }

  return {
    run,
    penalize(url: string, reason: string) {
      const state = states.get(url);
      if (!state) return;
      // Treat an incomplete-data mirror as a hard failure so it drops in the ranking.
      record(state, false, 0, null, reason);
    },
    health: () => [...states.values()],
    stats: () => {
      const all = [...states.values()];
      const t = now();
      return { healthy: all.filter((s) => !s.unhealthyUntil || s.unhealthyUntil < t).length, total: all.length };
    },
  };
}
