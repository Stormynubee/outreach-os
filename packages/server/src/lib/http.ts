import { gzipSync, gunzipSync } from 'node:zlib';
import type { Settings } from '../settings.ts';
import { userAgent } from '../settings.ts';
import type { Db } from '../db/client.ts';
import { cacheKey, normalizeHost } from './urls.ts';
import { DomainScheduler } from './buckets.ts';
import { evaluate, parseRobots, type RobotsDecision, type RobotsFetchState } from './robots.ts';

export const CACHE_KINDS = ['page', 'contact', 'social', 'robots', 'other'] as const;
export type CacheKind = (typeof CACHE_KINDS)[number];

export interface FetchPhase {
  phase: 'cache' | 'dispatch' | 'done' | 'error';
  detail?: string;
}

export interface FetchResult {
  ok: boolean;
  status: number | null;
  finalUrl: string;
  body: string | null;
  contentType: string | null;
  serverHeader: string | null;
  redirects: string[];
  redirectHosts: string[];
  errorKind: ErrorKind | null;
  fromCache: boolean;
  robotsBlocked: boolean;
  robotsRule: string | null;
  bytes: number;
  durationMs: number;
  truncated: boolean;
}

export type ErrorKind =
  | 'dns_fail'
  | 'refused'
  | 'timeout'
  | 'tls'
  | 'socket'
  | 'too_many_redirects'
  | 'too_large'
  | 'unknown';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 507, 522, 524]);

function classifyError(err: unknown): ErrorKind {
  const e = err as { code?: string; cause?: { code?: string }; name?: string; message?: string };
  const code = e?.code ?? e?.cause?.code ?? '';
  const msg = `${e?.name ?? ''} ${e?.message ?? ''} ${code}`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'dns_fail';
  if (/ECONNREFUSED/i.test(msg)) return 'refused';
  if (/CERT|TLS|SSL/i.test(msg)) return 'tls';
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timed? ?out/i.test(msg)) return 'timeout';
  if (/UND_ERR_SOCKET|ECONNRESET|EPIPE/i.test(msg)) return 'socket';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
  return 'unknown';
}

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - Date.now());
}

/** Full jitter: random(0, min(60s, 2s * 2^attempt)). */
export function backoffDelay(attempt: number): number {
  const ceiling = Math.min(60_000, 2000 * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

interface HttpCacheRow {
  id: number;
  status_code: number | null;
  final_url: string | null;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  expires_at: number;
  fetch_state: string;
  error_kind: string | null;
  size_bytes: number | null;
}

export interface HttpClientOptions {
  db: Db;
  settings: () => Settings;
  scheduler: DomainScheduler;
  onPhase?: (domain: string, phase: FetchPhase) => void;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface FetchOptions {
  kind?: CacheKind;
  ttlSeconds?: number;
  /** Skip reading the cache but still write to it. */
  forceRefresh?: boolean;
  /** Social fetches get fewer retries. */
  maxRetries?: number;
  accept?: string;
}

export interface HttpClient {
  fetchPage(url: string, opts?: FetchOptions): Promise<FetchResult>;
  robotsFor(domain: string): Promise<{ decision: (path: string) => RobotsDecision; state: RobotsFetchState }>;
  stats(): SchedulerStats;
}

export interface SchedulerStats {
  pending: number;
  inFlight: number;
  unhealthyDomains: string[];
}

interface DomainHealth {
  failures: number;
  unhealthyUntil: number;
}

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const { db, scheduler, onPhase } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const health = new Map<string, DomainHealth>();

  const getCache = db.prepare(
    'SELECT id, status_code, final_url, content_type, etag, last_modified, expires_at, fetch_state, error_kind, size_bytes FROM http_cache WHERE url_key = ?',
  );
  const getBody = db.prepare('SELECT body_gz FROM http_body WHERE http_cache_id = ?');
  const upsertCache = db.prepare(`
    INSERT INTO http_cache (url_key, domain, kind, status_code, final_url, content_type, size_bytes, etag,
                            last_modified, fetch_state, error_kind, attempts, fetched_at, expires_at, ttl_seconds)
    VALUES (@url_key, @domain, @kind, @status_code, @final_url, @content_type, @size_bytes, @etag,
            @last_modified, @fetch_state, @error_kind, 1, @fetched_at, @expires_at, @ttl_seconds)
    ON CONFLICT(url_key) DO UPDATE SET
      status_code = @status_code, final_url = @final_url, content_type = @content_type,
      size_bytes = @size_bytes, etag = @etag, last_modified = @last_modified,
      fetch_state = @fetch_state, error_kind = @error_kind, attempts = http_cache.attempts + 1,
      fetched_at = @fetched_at, expires_at = @expires_at, ttl_seconds = @ttl_seconds
  `);
  const upsertBody = db.prepare(`
    INSERT INTO http_body (http_cache_id, body_gz) VALUES (?, ?)
    ON CONFLICT(http_cache_id) DO UPDATE SET body_gz = excluded.body_gz
  `);
  const touchExpiry = db.prepare('UPDATE http_cache SET expires_at = ?, fetched_at = ? WHERE id = ?');

  const getRobots = db.prepare('SELECT * FROM robots_cache WHERE domain = ?');
  const putRobots = db.prepare(`
    INSERT INTO robots_cache (domain, fetched_at, expires_at, status_code, fetch_state, crawl_delay_ms, sitemaps, rules)
    VALUES (@domain, @fetched_at, @expires_at, @status_code, @fetch_state, @crawl_delay_ms, @sitemaps, @rules)
    ON CONFLICT(domain) DO UPDATE SET
      fetched_at = @fetched_at, expires_at = @expires_at, status_code = @status_code,
      fetch_state = @fetch_state, crawl_delay_ms = @crawl_delay_ms, sitemaps = @sitemaps, rules = @rules
  `);

  function productToken(): string {
    return userAgent(opts.settings()).split('/')[0]!.toLowerCase();
  }

  function markFailure(domain: string): void {
    const h = health.get(domain) ?? { failures: 0, unhealthyUntil: 0 };
    h.failures++;
    if (h.failures >= 5) h.unhealthyUntil = now() + 30 * 60_000;
    health.set(domain, h);
  }

  function markSuccess(domain: string): void {
    health.set(domain, { failures: 0, unhealthyUntil: 0 });
  }

  function isUnhealthy(domain: string): boolean {
    const h = health.get(domain);
    return !!h && h.unhealthyUntil > now();
  }

  async function loadRobots(domain: string): Promise<{ parsed: ReturnType<typeof parseRobots>; state: RobotsFetchState; crawlDelayMs: number | null }> {
    const settings = opts.settings();
    const cached = getRobots.get(domain) as
      | { fetched_at: number; expires_at: number; fetch_state: string; status_code: number | null; rules: string; sitemaps: string; crawl_delay_ms: number | null }
      | undefined;

    if (cached && cached.expires_at > now()) {
      return {
        parsed: { groups: JSON.parse(cached.rules), sitemaps: JSON.parse(cached.sitemaps) },
        state: cached.fetch_state as RobotsFetchState,
        crawlDelayMs: cached.crawl_delay_ms,
      };
    }

    const url = `https://${domain}/robots.txt`;
    let status: number | null = null;
    let body: string | null = null;
    let state: RobotsFetchState = 'ok';

    try {
      const res = await scheduler.run(domain, () =>
        doFetch(url, {
          headers: { 'User-Agent': userAgent(settings), Accept: 'text/plain,*/*' },
          redirect: 'follow',
          signal: AbortSignal.timeout(Math.min(settings.fetchTimeoutMs, 10_000)),
        }),
      );
      status = res.status;
      if (res.status >= 500) {
        // RFC 9309: an unavailable robots.txt means "disallow all" — be conservative.
        state = 'unreachable';
      } else if (res.status === 404 || res.status === 410 || res.status === 400) {
        state = 'missing';
      } else if (res.ok) {
        body = (await res.text()).slice(0, 512 * 1024);
      } else {
        state = 'missing';
      }
    } catch {
      state = 'unreachable';
    }

    const parsed = body ? parseRobots(body) : { groups: [], sitemaps: [] };
    const crawlDelay = parsed.groups.find((g) => g.crawlDelayMs !== null)?.crawlDelayMs ?? null;

    putRobots.run({
      domain,
      fetched_at: now(),
      expires_at: now() + settings.ttlSeconds.robots * 1000,
      status_code: status,
      fetch_state: state,
      crawl_delay_ms: state === 'ok' ? crawlDelay : null,
      sitemaps: JSON.stringify(parsed.sitemaps),
      rules: JSON.stringify(parsed.groups),
    });

    return { parsed, state, crawlDelayMs: state === 'ok' ? crawlDelay : null };
  }

  async function robotsFor(domain: string) {
    const settings = opts.settings();
    if (!settings.respectRobots) {
      return { decision: () => ({ allowed: true, matchedRule: null, crawlDelayMs: null, sitemaps: [] }), state: 'missing' as RobotsFetchState };
    }
    const { parsed, state } = await loadRobots(domain);
    const token = productToken();
    // Unreachable robots.txt (5xx) is treated as disallow-all, per spec.
    const disallowAll = state === 'unreachable';
    return {
      state,
      decision: (path: string): RobotsDecision =>
        disallowAll
          ? { allowed: false, matchedRule: 'unavailable', crawlDelayMs: null, sitemaps: parsed.sitemaps }
          : evaluate(parsed, token, path),
    };
  }

  async function readCapped(res: Response, cap: number): Promise<{ text: string; truncated: boolean; bytes: number }> {
    if (!res.body) {
      const text = await res.text();
      return { text, truncated: false, bytes: text.length };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > cap) {
        chunks.push(value.subarray(0, Math.max(0, value.byteLength - (size - cap))));
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { text: merged.toString('utf8'), truncated, bytes: size };
  }

  async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
    const settings = opts.settings();
    const started = now();
    const kind = options.kind ?? 'page';
    const ttl = options.ttlSeconds ?? settings.ttlSeconds.homepage;

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return emptyResult(rawUrl, 'dns_fail', now() - started, null);
    }

    const domain = normalizeHost(url.hostname);
    const key = cacheKey(url);

    const base: Omit<FetchResult, 'ok'> = {
      status: null,
      finalUrl: url.toString(),
      body: null,
      contentType: null,
      serverHeader: null,
      redirects: [],
      redirectHosts: [],
      errorKind: null,
      fromCache: false,
      robotsBlocked: false,
      robotsRule: null,
      bytes: 0,
      durationMs: 0,
      truncated: false,
    };

    if (isUnhealthy(domain)) {
      return { ...base, ok: false, errorKind: 'refused', durationMs: now() - started };
    }

    const cached = getCache.get(key) as HttpCacheRow | undefined;
    const fresh = cached && cached.expires_at > now() && cached.fetch_state === 'ok';

    if (fresh) {
      const bodyRow = getBody.get(cached.id) as { body_gz: Buffer } | undefined;
      const text = bodyRow?.body_gz ? gunzipSync(bodyRow.body_gz).toString('utf8') : null;
      onPhase?.(domain, { phase: 'cache' });
      return {
        ...base,
        ok: true,
        status: cached.status_code,
        finalUrl: cached.final_url ?? url.toString(),
        body: text,
        contentType: cached.content_type,
        bytes: cached.size_bytes ?? 0,
        fromCache: true,
        durationMs: now() - started,
      };
    }

    const robots = await robotsFor(domain);
    const decision = robots.decision(url.pathname + url.search);
    if (!decision.allowed) {
      onPhase?.(domain, { phase: 'done', detail: 'robots' });
      return {
        ...base,
        ok: false,
        robotsBlocked: true,
        robotsRule: decision.matchedRule,
        durationMs: now() - started,
      };
    }

    const maxRetries = options.maxRetries ?? (kind === 'social' ? 1 : 3);
    let attempt = 0;
    let lastError: ErrorKind = 'unknown';
    let lastStatus: number | null = null;

    while (attempt <= maxRetries) {
      try {
        const res = await scheduler.run(domain, () =>
          doFetch(url.toString(), {
            headers: {
              'User-Agent': userAgent(settings),
              Accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en;q=0.9,*;q=0.5',
              ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
              ...(cached?.last_modified ? { 'If-Modified-Since': cached.last_modified } : {}),
            },
            // Manual redirects: a 302 into a parking host is the parked-domain signal,
            // and following it would destroy that evidence.
            redirect: 'manual',
            signal: AbortSignal.timeout(settings.fetchTimeoutMs),
          }),
        );

        lastStatus = res.status;

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) {
            lastError = 'unknown';
            break;
          }
          const next = new URL(location, url);
          const chain = [url.toString(), next.toString()];
          const nextRobots = await robotsFor(normalizeHost(next.hostname));
          const nextDecision = nextRobots.decision(next.pathname + next.search);
          if (!nextDecision.allowed) {
            return { ...base, ok: false, robotsBlocked: true, robotsRule: nextDecision.matchedRule, redirects: chain, durationMs: now() - started };
          }
          // Hand the redirect target back to the caller to classify, but cap the depth.
          if (chain.length > 5) lastError = 'too_many_redirects';
          return {
            ...base,
            ok: false,
            status: res.status,
            redirects: chain,
            redirectHosts: [normalizeHost(url.hostname), normalizeHost(next.hostname)],
            errorKind: chain.length > 5 ? 'too_many_redirects' : null,
            durationMs: now() - started,
          };
        }

        if (res.status === 304 && cached) {
          const bodyRow = getBody.get(cached.id) as { body_gz: Buffer } | undefined;
          touchExpiry.run(now() + ttl * 1000, now(), cached.id);
          markSuccess(domain);
          return {
            ...base,
            ok: true,
            status: cached.status_code,
            finalUrl: cached.final_url ?? url.toString(),
            body: bodyRow?.body_gz ? gunzipSync(bodyRow.body_gz).toString('utf8') : null,
            contentType: cached.content_type,
            bytes: cached.size_bytes ?? 0,
            fromCache: true,
            durationMs: now() - started,
          };
        }

        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
          const delay = retryAfter !== null ? Math.min(retryAfter, 120_000) : backoffDelay(attempt);
          // Overpass-style hard limits: back the whole scheduler off, not just this request.
          if (res.status === 429 || res.status === 406) scheduler.pause(Math.min(delay, 30_000));
          await new Promise((r) => setTimeout(r, Math.min(delay, 120_000)));
          attempt++;
          continue;
        }

        const contentType = res.headers.get('content-type');
        const isTextual =
          !contentType ||
          /text\/|application\/(xhtml|xml|json|javascript|ld\+json)/i.test(contentType);

        let text: string | null = null;
        let truncated = false;
        let bytes = 0;
        if (isTextual && res.status < 400) {
          const read = await readCapped(res, settings.maxBodyBytes);
          text = read.text;
          truncated = read.truncated;
          bytes = read.bytes;
        }

        const ok = res.status >= 200 && res.status < 400;
        upsertCache.run({
          url_key: key,
          domain,
          kind,
          status_code: res.status,
          final_url: url.toString(),
          content_type: contentType,
          size_bytes: bytes,
          etag: res.headers.get('etag'),
          last_modified: res.headers.get('last-modified'),
          fetch_state: ok ? 'ok' : 'error',
          error_kind: ok ? null : `http_${res.status}`,
          fetched_at: now(),
          expires_at: now() + (ok ? ttl : Math.min(ttl, 3600)) * 1000,
          ttl_seconds: ttl,
        });
        if (text !== null) {
          const idRow = getCache.get(key) as { id: number } | undefined;
          if (idRow) upsertBody.run(idRow.id, gzipSync(Buffer.from(text, 'utf8')));
        }

        if (ok) markSuccess(domain);
        else if (res.status >= 500) markFailure(domain);

        return {
          ...base,
          ok,
          status: res.status,
          finalUrl: url.toString(),
          body: text,
          contentType,
          serverHeader: res.headers.get('server'),
          bytes,
          truncated,
          errorKind: ok ? null : res.status >= 500 ? 'unknown' : null,
          durationMs: now() - started,
        };
      } catch (err) {
        lastError = classifyError(err);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
          attempt++;
          continue;
        }
        break;
      }
    }

    markFailure(domain);
    upsertCache.run({
      url_key: key,
      domain,
      kind,
      status_code: lastStatus,
      final_url: url.toString(),
      content_type: null,
      size_bytes: 0,
      etag: null,
      last_modified: null,
      fetch_state: 'error',
      error_kind: lastError,
      fetched_at: now(),
      expires_at: now() + 3600 * 1000,
      ttl_seconds: 3600,
    });

    return { ...base, ok: false, errorKind: lastError, status: lastStatus, durationMs: now() - started };
  }

  function emptyResult(url: string, kind: ErrorKind, durationMs: number, status: number | null): FetchResult {
    return {
      ok: false,
      status,
      finalUrl: url,
      body: null,
      contentType: null,
      serverHeader: null,
      redirects: [],
      redirectHosts: [],
      errorKind: kind,
      fromCache: false,
      robotsBlocked: false,
      robotsRule: null,
      bytes: 0,
      durationMs,
      truncated: false,
    };
  }

  return {
    fetchPage,
    robotsFor,
    stats: () => ({
      pending: scheduler.pending,
      inFlight: scheduler.inFlight,
      unhealthyDomains: [...health.entries()].filter(([, h]) => h.unhealthyUntil > now()).map(([d]) => d),
    }),
  };
}
