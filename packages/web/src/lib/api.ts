/**
 * Typed client for the Outreach OS API.
 *
 * Everything in here talks to `/api/*` (proxied to the Fastify server by Vite) and
 * returns the exact types from `@outreach/shared` — those are imported, never redeclared.
 *
 * Responses are normalised through small runtime guards: if the backend is an older build
 * and a field is missing, the field is replaced with a safe default rather than blowing up
 * the page. The app is expected to render even when an endpoint 404s.
 */
import type {
  CreateDiscoveryRequest,
  DailyStat,
  DiscoveryProgress,
  DiscoverySummary,
  EmailRef,
  LeadDetail,
  LeadQuery,
  LeadRow,
  Paged,
  PhoneRef,
  PipelineStage,
  PublicSettings,
  ServerStatus,
  SocialRef,
  StatsSummary,
  TaskChannel,
  TaskRow,
  TaskStatus,
  TasksForDay,
} from '@outreach/shared';
import {
  FOLLOWERS_STATES,
  PIPELINE_STAGES,
  SITE_STATES,
  SOCIAL_PLATFORMS,
  TASK_CHANNELS,
  TASK_STATUSES,
} from '@outreach/shared';

const BASE = '/api';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Turn anything thrown by a query/mutation into something a human can read. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'Could not reach the API server on port 4317.';
    if (error.status === 404) {
      return 'This endpoint is not live on the server yet (404). It will fill in once the API ships.';
    }
    if (error.status === 400 || error.status === 422) return error.message;
    if (error.status >= 500) return `The server failed on that request (${error.status}). Try again in a moment.`;
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

/* ------------------------------------------------------------------ *
 * Runtime guards / normalisers
 * ------------------------------------------------------------------ */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return asArray(value).filter(isRecord);
}

function num(value: unknown, fallback = 0): number {
  return asNumber(value) ?? fallback;
}

function str(value: unknown, fallback = ''): string {
  return asString(value) ?? fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return asBoolean(value) ?? fallback;
}

export function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null;
}

function strings(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

type LeadSocialChip = LeadRow['socials'][number];

const EMAIL_KIND_VALUES: readonly EmailRef['kind'][] = ['role', 'personal', 'noreply'];

function normalizeSocialChip(input: unknown): LeadSocialChip | null {
  if (!isRecord(input)) return null;
  const platform = oneOf(SOCIAL_PLATFORMS, input.platform);
  if (!platform) return null;
  return {
    id: num(input.id, -1),
    platform,
    url: str(input.url),
    followers: asNumber(input.followers),
    followersState: oneOf(FOLLOWERS_STATES, input.followersState) ?? 'not_attempted',
    manualOverride: asNumber(input.manualOverride),
  };
}

export function normalizeSocialRef(input: unknown): SocialRef | null {
  if (!isRecord(input)) return null;
  const platform = oneOf(SOCIAL_PLATFORMS, input.platform);
  if (!platform) return null;
  return {
    id: num(input.id, -1),
    platform,
    url: str(input.url),
    handle: asString(input.handle),
    followers: asNumber(input.followers),
    followersState: oneOf(FOLLOWERS_STATES, input.followersState) ?? 'not_attempted',
    followersReason: asString(input.followersReason),
    followersSource: asString(input.followersSource),
    manualOverride: asNumber(input.manualOverride),
    hasVideo: bool(input.hasVideo),
    discoverySource: oneOf(['site', 'osm', 'manual'] as const, input.discoverySource) ?? 'site',
    lastCheckedAt: asNumber(input.lastCheckedAt),
  };
}

function normalizeEmail(input: unknown): EmailRef | null {
  if (!isRecord(input)) return null;
  const address = asString(input.address);
  if (!address) return null;
  return {
    id: num(input.id, -1),
    address,
    kind: oneOf(EMAIL_KIND_VALUES, input.kind) ?? 'role',
    source: str(input.source, 'unknown'),
    sourceUrl: asString(input.sourceUrl),
    confidence: num(input.confidence, 0),
  };
}

function normalizePhone(input: unknown): PhoneRef | null {
  if (!isRecord(input)) return null;
  const raw = asString(input.raw);
  if (!raw) return null;
  return {
    id: num(input.id, -1),
    raw,
    e164: asString(input.e164),
    isWhatsapp: bool(input.isWhatsapp),
    isMobile: bool(input.isMobile),
    source: str(input.source, 'unknown'),
    confidence: num(input.confidence, 0),
    rejectReason: asString(input.rejectReason),
  };
}

export function normalizeTaskRow(input: unknown): TaskRow | null {
  if (!isRecord(input)) return null;
  const id = asNumber(input.id);
  if (id === null) return null;
  return {
    id,
    businessId: asNumber(input.businessId),
    businessName: asString(input.businessName),
    businessScore: asNumber(input.businessScore),
    businessSiteState: oneOf(SITE_STATES, input.businessSiteState),
    title: str(input.title, 'Untitled task'),
    note: asString(input.note),
    dueDate: str(input.dueDate),
    status: oneOf(TASK_STATUSES, input.status) ?? 'open',
    channel: oneOf(TASK_CHANNELS, input.channel),
    doneAt: asNumber(input.doneAt),
    snoozeUntil: asNumber(input.snoozeUntil),
    createdAt: num(input.createdAt, Date.now()),
  };
}

export function normalizeLeadRow(input: unknown): LeadRow {
  const row = isRecord(input) ? input : {};
  const hasWebsite = bool(row.hasWebsite, asString(row.websiteUrl) !== null);
  return {
    id: num(row.id, -1),
    name: str(row.name, 'Unnamed business'),
    category: str(row.category, 'other'),
    categoryLabel: asString(row.categoryLabel),
    city: asString(row.city),
    countryCode: asString(row.countryCode),
    score: num(row.score, 0),
    confidenceFactor: num(row.confidenceFactor, 1),
    siteState: oneOf(SITE_STATES, row.siteState) ?? 'unknown',
    websiteUrl: asString(row.websiteUrl),
    websiteDomain: asString(row.websiteDomain),
    hasWebsite,
    hasSsl: bool(row.hasSsl),
    phone: asString(row.phone),
    email: asString(row.email),
    hasPhone: bool(row.hasPhone, asString(row.phone) !== null),
    hasEmail: bool(row.hasEmail, asString(row.email) !== null),
    hasSocial: bool(row.hasSocial),
    followersTotal: asNumber(row.followersTotal),
    followersKnown: num(row.followersKnown, 0),
    hasVideo: bool(row.hasVideo),
    pipelineStage: oneOf(PIPELINE_STAGES, row.pipelineStage) ?? 'new',
    enrichmentState: str(row.enrichmentState, 'unknown'),
    socials: records(row.socials)
      .map(normalizeSocialChip)
      .filter((social): social is LeadSocialChip => social !== null),
    firstSeenAt: num(row.firstSeenAt, 0),
  };
}

export function normalizeLeadDetail(input: unknown): LeadDetail {
  const row = isRecord(input) ? input : {};
  const base = normalizeLeadRow(row);
  return {
    ...base,
    osmKey: str(row.osmKey),
    osmType: str(row.osmType),
    lat: asNumber(row.lat),
    lon: asNumber(row.lon),
    addressLine: asString(row.addressLine),
    street: asString(row.street),
    houseNumber: asString(row.houseNumber),
    postcode: asString(row.postcode),
    state: asString(row.state),
    phoneRaw: asString(row.phoneRaw),
    emailState: str(row.emailState, 'unknown'),
    finalUrl: asString(row.finalUrl),
    httpStatus: asNumber(row.httpStatus),
    siteTitle: asString(row.siteTitle),
    platform: asString(row.platform),
    parkingEvidence: strings(row.parkingEvidence),
    scoreReasons: strings(row.scoreReasons),
    enrichmentStage: str(row.enrichmentStage, 'none'),
    enrichmentError: asString(row.enrichmentError),
    lastErrorStage: asString(row.lastErrorStage),
    notes: asString(row.notes),
    assignee: asString(row.assignee),
    scoredAt: asNumber(row.scoredAt),
    enrichedAt: asNumber(row.enrichedAt),
    osmTags: isRecord(row.osmTags) ? Object.fromEntries(Object.entries(row.osmTags).map(([k, v]) => [k, String(v)])) : {},
    emails: records(row.emails)
      .map(normalizeEmail)
      .filter((email): email is EmailRef => email !== null),
    phones: records(row.phones)
      .map(normalizePhone)
      .filter((phone): phone is PhoneRef => phone !== null),
    socialDetails: records(row.socialDetails)
      .map(normalizeSocialRef)
      .filter((social): social is SocialRef => social !== null),
    tasks: records(row.tasks)
      .map(normalizeTaskRow)
      .filter((task): task is TaskRow => task !== null),
  };
}

export function normalizeTasksForDay(input: unknown): TasksForDay {
  const bareList = Array.isArray(input) ? input : null;
  const rec = isRecord(input) ? input : {};
  const pick = (key: 'open' | 'done' | 'overdue' | 'upcoming'): TaskRow[] =>
    records(bareList && key === 'open' ? bareList : rec[key])
      .map(normalizeTaskRow)
      .filter((task): task is TaskRow => task !== null);

  return {
    date: str(rec.date, new Date().toISOString().slice(0, 10)),
    open: pick('open'),
    done: pick('done'),
    overdue: pick('overdue'),
    upcoming: pick('upcoming'),
  };
}

function normalizeDailyStat(input: unknown): DailyStat {
  const rec = isRecord(input) ? input : {};
  return {
    day: str(rec.day),
    tasksDone: num(rec.tasksDone),
    tasksCreated: num(rec.tasksCreated),
    leadsFound: num(rec.leadsFound),
    contacted: num(rec.contacted),
    replied: num(rec.replied),
    won: num(rec.won),
  };
}

function stageCounts(input: unknown): Record<PipelineStage, number> {
  const rec = isRecord(input) ? input : {};
  const counts: Record<PipelineStage, number> = {
    new: 0,
    contacted: 0,
    replied: 0,
    won: 0,
    lost: 0,
  };
  for (const stage of PIPELINE_STAGES) counts[stage] = num(rec[stage]);
  return counts;
}

export function normalizeStats(input: unknown): StatsSummary {
  const rec = isRecord(input) ? input : {};
  const today = isRecord(rec.today) ? rec.today : {};
  const week = isRecord(rec.week) ? rec.week : {};
  const totals = isRecord(rec.totals) ? rec.totals : {};
  const followers = isRecord(rec.followers) ? rec.followers : {};

  return {
    today: {
      date: str(today.date, new Date().toISOString().slice(0, 10)),
      leadsFound: num(today.leadsFound),
      tasksDone: num(today.tasksDone),
      tasksOpen: num(today.tasksOpen),
      tasksOverdue: num(today.tasksOverdue),
    },
    week: {
      days: records(week.days).map(normalizeDailyStat),
      tasksDone: num(week.tasksDone),
      leadsFound: num(week.leadsFound),
      deltaPct: asNumber(week.deltaPct),
    },
    streak: num(rec.streak),
    points: num(rec.points),
    totals: {
      leads: num(totals.leads),
      noWebsite: num(totals.noWebsite),
      deadSite: num(totals.deadSite),
      socialOnly: num(totals.socialOnly),
      withEmail: num(totals.withEmail),
      withPhone: num(totals.withPhone),
      withSocial: num(totals.withSocial),
      scoredToday: num(totals.scoredToday),
    },
    pipeline: stageCounts(rec.pipeline),
    followers: {
      known: num(followers.known),
      unknown: num(followers.unknown),
      blocked: num(followers.blocked),
    },
  };
}

export function normalizeStatus(input: unknown): ServerStatus {
  const rec = isRecord(input) ? input : {};
  const queue = isRecord(rec.queue) ? rec.queue : {};
  const counts = isRecord(rec.counts) ? rec.counts : {};
  const attribution = isRecord(rec.attribution) ? rec.attribution : {};
  return {
    version: str(rec.version, 'unknown'),
    discoveryReady: bool(rec.discoveryReady),
    warning: asString(rec.warning),
    contactEmailSet: bool(rec.contactEmailSet),
    queue: { pending: num(queue.pending), inFlight: num(queue.inFlight) },
    counts: {
      leads: num(counts.leads),
      tasksOpen: num(counts.tasksOpen),
      tasksOverdue: num(counts.tasksOverdue),
    },
    attribution: {
      text: str(
        attribution.text,
        '© OpenStreetMap contributors — data licensed under the Open Database License (ODbL).',
      ),
      url: str(attribution.url, 'https://www.openstreetmap.org/copyright'),
      osmBase: asString(attribution.osmBase),
    },
    dataDir: str(rec.dataDir, 'not reported by the server'),
  };
}

export function normalizeSettings(input: unknown): PublicSettings {
  const rec = isRecord(input) ? input : {};
  const ttl = isRecord(rec.ttlSeconds) ? rec.ttlSeconds : {};
  const ttlSeconds: Record<string, number> = { homepage: num(ttl.homepage, 86_400), contactPage: num(ttl.contactPage, 604_800), social: num(ttl.social, 604_800), robots: num(ttl.robots, 86_400), followers: num(ttl.followers, 604_800) };
  // Keep any additional TTL keys the server ships, so saving never silently drops them.
  for (const [key, value] of Object.entries(ttl)) {
    if (!(key in ttlSeconds)) ttlSeconds[key] = num(value);
  }

  return {
    displayName: str(rec.displayName, 'there'),
    contactEmail: str(rec.contactEmail),
    primaryOffer: str(rec.primaryOffer, 'websites'),
    geocoderBaseUrl: str(rec.geocoderBaseUrl, 'https://nominatim.openstreetmap.org'),
    overpassMirrors: strings(rec.overpassMirrors),
    globalConcurrency: num(rec.globalConcurrency, 8),
    perDomainConcurrency: num(rec.perDomainConcurrency, 1),
    perDomainDelayMs: num(rec.perDomainDelayMs, 1200),
    maxPagesPerSite: num(rec.maxPagesPerSite, 5),
    respectRobots: bool(rec.respectRobots, true),
    fetchTimeoutMs: num(rec.fetchTimeoutMs, 10_000),
    maxBodyBytes: num(rec.maxBodyBytes, 2 * 1024 * 1024),
    notifications: bool(rec.notifications, true),
    ttlSeconds,
  };
}

export function normalizeDiscoverySummary(input: unknown): DiscoverySummary | null {
  if (!isRecord(input)) return null;
  const id = asNumber(input.id);
  if (id === null) return null;
  return {
    id,
    locationText: str(input.locationText),
    displayName: asString(input.displayName),
    categories: strings(input.categories),
    keyword: asString(input.keyword),
    status: str(input.status, 'unknown'),
    poisFound: num(input.poisFound),
    tilesDone: num(input.tilesDone),
    tilesTotal: num(input.tilesTotal),
    createdAt: num(input.createdAt, 0),
    usedAreaFilter: bool(input.usedAreaFilter),
    coverageVerified: bool(input.coverageVerified),
    mirror: asString(input.mirror),
    osmBase: asString(input.osmBase),
    error: asString(input.error),
  };
}

export function normalizeDiscoveryProgress(input: unknown): DiscoveryProgress | null {
  const summary = normalizeDiscoverySummary(input);
  if (!summary || !isRecord(input)) return null;
  const enrichment = isRecord(input.enrichment) ? input.enrichment : {};
  return {
    ...summary,
    tiles: records(input.tiles).map((tile) => ({
      index: num(tile.index, -1),
      depth: num(tile.depth, 0),
      status: str(tile.status, 'unknown'),
      elementCount: num(tile.elementCount),
      durationMs: asNumber(tile.durationMs),
      mirror: asString(tile.mirror),
      error: asString(tile.error),
    })),
    enrichment: {
      queued: num(enrichment.queued),
      running: num(enrichment.running),
      done: num(enrichment.done),
      failed: num(enrichment.failed),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

function serverMessage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const message = asString(parsed.message) ?? asString(parsed.error);
      if (message) return message;
    }
  } catch {
    // Not JSON — fall through and use the raw text.
  }
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('Could not reach the API server on port 4317.', 0);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim();
    try {
      message = serverMessage(await response.text()) ?? message;
    } catch {
      // Body already consumed / unreadable — keep the status line.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as unknown as T;
  const text = await response.text();
  if (!text.trim()) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // A non-JSON success body is not usable; let the caller fall back to defaults.
    return undefined as unknown as T;
  }
}

/** Serialise a LeadQuery into the query-string shape the API expects. */
export function leadQueryString(query: LeadQuery): string {
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.siteStates && query.siteStates.length > 0) params.set('siteStates', query.siteStates.join(','));
  if (query.hasEmail !== undefined) params.set('hasEmail', query.hasEmail ? 'true' : 'false');
  if (query.hasPhone !== undefined) params.set('hasPhone', query.hasPhone ? 'true' : 'false');
  if (query.hasSocial !== undefined) params.set('hasSocial', query.hasSocial ? 'true' : 'false');
  if (query.noWebsite !== undefined) params.set('noWebsite', query.noWebsite ? 'true' : 'false');
  if (query.minScore !== undefined) params.set('minScore', String(query.minScore));
  if (query.stage) params.set('stage', query.stage);
  if (query.q && query.q.trim()) params.set('q', query.q.trim());
  if (query.sort) params.set('sort', query.sort);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 20));
  return params.toString();
}

/* ------------------------------------------------------------------ *
 * Endpoints
 * ------------------------------------------------------------------ */

export async function getStats(): Promise<StatsSummary> {
  return normalizeStats(await request<unknown>('/stats/summary'));
}

export async function getStatus(): Promise<ServerStatus> {
  return normalizeStatus(await request<unknown>('/status'));
}

export async function listLeads(query: LeadQuery = {}): Promise<Paged<LeadRow>> {
  const raw = await request<unknown>(`/leads?${leadQueryString(query)}`);
  const rec = isRecord(raw) ? raw : {};
  const rows = (Array.isArray(raw) ? raw : asArray(rec.rows)).filter(isRecord).map(normalizeLeadRow);
  return {
    rows,
    total: asNumber(rec.total) ?? rows.length,
    page: asNumber(rec.page) ?? query.page ?? 1,
    pageSize: asNumber(rec.pageSize) ?? query.pageSize ?? rows.length,
  };
}

export async function getLead(id: number, signal?: AbortSignal): Promise<LeadDetail> {
  return normalizeLeadDetail(await request<unknown>(`/leads/${id}`, { signal }));
}

export interface UpdateLeadRequest {
  pipelineStage?: PipelineStage;
  notes?: string | null;
  assignee?: string | null;
  snoozeUntil?: number | null;
}

export async function updateLead(id: number, patch: UpdateLeadRequest): Promise<LeadDetail> {
  return normalizeLeadDetail(await request<unknown>(`/leads/${id}`, { method: 'PATCH', body: patch }));
}

/**
 * Set (or clear) a hand-entered follower count for one social account.
 * `null` clears the override and falls back to the scraped/unknown state.
 */
export async function setSocialFollowerOverride(
  leadId: number,
  socialId: number,
  manualOverride: number | null,
): Promise<unknown> {
  return request<unknown>(`/leads/${leadId}/socials/${socialId}`, {
    method: 'PUT',
    body: { manualOverride },
  });
}

export async function getTasksForDay(date: string): Promise<TasksForDay> {
  return normalizeTasksForDay(await request<unknown>(`/tasks?date=${encodeURIComponent(date)}`));
}

export interface CreateTaskRequest {
  title: string;
  businessId?: number | null;
  note?: string | null;
  dueDate?: string;
  channel?: TaskChannel | null;
}

export async function createTask(body: CreateTaskRequest): Promise<TaskRow | null> {
  return normalizeTaskRow(await request<unknown>('/tasks', { method: 'POST', body }));
}

export interface UpdateTaskRequest {
  status?: TaskStatus;
  title?: string;
  note?: string | null;
  dueDate?: string;
}

export async function updateTask(id: number, patch: UpdateTaskRequest): Promise<TaskRow | null> {
  return normalizeTaskRow(await request<unknown>(`/tasks/${id}`, { method: 'PATCH', body: patch }));
}

export interface StartDiscoveryResult {
  /** Query id reported by the server, when it reports one at all. */
  id: number | null;
  summary: DiscoverySummary | null;
}

/**
 * Kick off a discovery run. The contract does not pin the response body, so accept both
 * a `DiscoverySummary` (`id`) and a progress envelope (`queryId`).
 */
export async function startDiscovery(body: CreateDiscoveryRequest): Promise<StartDiscoveryResult> {
  const raw = await request<unknown>('/discovery', { method: 'POST', body });
  const summary = normalizeDiscoverySummary(raw);
  if (summary) return { id: summary.id, summary };
  const queryId = isRecord(raw) ? asNumber(raw.queryId) ?? asNumber(raw.id) : null;
  return { id: queryId, summary: null };
}

export async function listDiscoveries(): Promise<DiscoverySummary[]> {
  const raw = await request<unknown>('/discovery');
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? asArray(raw.rows).concat(asArray(raw.discoveries)) : [];
  return list
    .map(normalizeDiscoverySummary)
    .filter((entry): entry is DiscoverySummary => entry !== null);
}

/** Per-tile progress for one run. Not required for the page to work — failures are ignored. */
export async function getDiscovery(id: number): Promise<DiscoveryProgress | null> {
  return normalizeDiscoveryProgress(await request<unknown>(`/discovery/${id}`));
}

export async function getSettings(): Promise<PublicSettings> {
  return normalizeSettings(await request<unknown>('/settings'));
}

export async function saveSettings(settings: PublicSettings): Promise<PublicSettings> {
  return normalizeSettings(await request<unknown>('/settings', { method: 'PUT', body: settings }));
}

export const LEAD_EXPORT_URL = '/api/export/leads.csv';
