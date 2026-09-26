import type {
  EmailKind,
  FollowersState,
  PipelineStage,
  SiteState,
  SocialPlatform,
  TaskChannel,
  TaskStatus,
} from './types.ts';

export interface SocialRef {
  id: number;
  platform: SocialPlatform;
  url: string;
  handle: string | null;
  followers: number | null;
  followersState: FollowersState;
  followersReason: string | null;
  followersSource: string | null;
  manualOverride: number | null;
  hasVideo: boolean;
  discoverySource: 'site' | 'osm' | 'manual';
  lastCheckedAt: number | null;
}

export interface EmailRef {
  id: number;
  address: string;
  kind: EmailKind;
  source: string;
  sourceUrl: string | null;
  confidence: number;
}

export interface PhoneRef {
  id: number;
  raw: string;
  e164: string | null;
  isWhatsapp: boolean;
  isMobile: boolean;
  source: string;
  confidence: number;
  rejectReason: string | null;
}

export interface LeadRow {
  id: number;
  name: string;
  category: string;
  categoryLabel: string | null;
  city: string | null;
  countryCode: string | null;
  score: number;
  confidenceFactor: number;
  siteState: SiteState;
  websiteUrl: string | null;
  websiteDomain: string | null;
  hasWebsite: boolean;
  hasSsl: boolean;
  phone: string | null;
  email: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  hasSocial: boolean;
  followersTotal: number | null;
  followersKnown: number;
  hasVideo: boolean;
  pipelineStage: PipelineStage;
  enrichmentState: string;
  socials: Pick<SocialRef, 'id' | 'platform' | 'url' | 'followers' | 'followersState' | 'manualOverride'>[];
  firstSeenAt: number;
}

export interface LeadDetail extends LeadRow {
  osmKey: string;
  osmType: string;
  lat: number | null;
  lon: number | null;
  addressLine: string | null;
  street: string | null;
  houseNumber: string | null;
  postcode: string | null;
  state: string | null;
  phoneRaw: string | null;
  emailState: string;
  finalUrl: string | null;
  httpStatus: number | null;
  siteTitle: string | null;
  platform: string | null;
  parkingEvidence: string[];
  scoreReasons: string[];
  enrichmentStage: string;
  enrichmentError: string | null;
  lastErrorStage: string | null;
  notes: string | null;
  assignee: string | null;
  scoredAt: number | null;
  enrichedAt: number | null;
  osmTags: Record<string, string>;
  emails: EmailRef[];
  phones: PhoneRef[];
  socialDetails: SocialRef[];
  tasks: TaskRow[];
}

export interface LeadQuery {
  category?: string;
  siteStates?: SiteState[];
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasSocial?: boolean;
  noWebsite?: boolean;
  minScore?: number;
  stage?: PipelineStage;
  q?: string;
  sort?: 'score' | 'name' | 'recent' | 'followers';
  page?: number;
  pageSize?: number;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TaskRow {
  id: number;
  businessId: number | null;
  businessName: string | null;
  businessScore: number | null;
  businessSiteState: SiteState | null;
  title: string;
  note: string | null;
  dueDate: string;
  status: TaskStatus;
  channel: TaskChannel | null;
  doneAt: number | null;
  snoozeUntil: number | null;
  createdAt: number;
}

export interface TasksForDay {
  date: string;
  open: TaskRow[];
  done: TaskRow[];
  overdue: TaskRow[];
  upcoming: TaskRow[];
}

export interface DailyStat {
  day: string;
  tasksDone: number;
  tasksCreated: number;
  leadsFound: number;
  contacted: number;
  replied: number;
  won: number;
}

export interface StatsSummary {
  today: {
    date: string;
    leadsFound: number;
    tasksDone: number;
    tasksOpen: number;
    tasksOverdue: number;
  };
  week: {
    days: DailyStat[];
    tasksDone: number;
    leadsFound: number;
    deltaPct: number | null;
  };
  streak: number;
  points: number;
  totals: {
    leads: number;
    noWebsite: number;
    deadSite: number;
    socialOnly: number;
    withEmail: number;
    withPhone: number;
    withSocial: number;
    scoredToday: number;
  };
  pipeline: Record<PipelineStage, number>;
  followers: { known: number; unknown: number; blocked: number };
}

export interface MirrorHealth {
  url: string;
  host: string;
  ok: number;
  failures: number;
  avgMs: number | null;
  lastElementCount: number | null;
  unhealthyUntil: number | null;
  lastError: string | null;
}

export interface DiscoverySummary {
  id: number;
  locationText: string;
  displayName: string | null;
  categories: string[];
  keyword: string | null;
  status: string;
  poisFound: number;
  tilesDone: number;
  tilesTotal: number;
  createdAt: number;
  usedAreaFilter: boolean;
  coverageVerified: boolean;
  mirror: string | null;
  osmBase: string | null;
  error: string | null;
}

export interface DiscoveryProgress extends DiscoverySummary {
  tiles: {
    index: number;
    depth: number;
    status: string;
    elementCount: number;
    durationMs: number | null;
    mirror: string | null;
    error: string | null;
  }[];
  enrichment: { queued: number; running: number; done: number; failed: number };
}

export interface ServerStatus {
  version: string;
  discoveryReady: boolean;
  warning: string | null;
  contactEmailSet: boolean;
  queue: { pending: number; inFlight: number };
  counts: { leads: number; tasksOpen: number; tasksOverdue: number };
  attribution: { text: string; url: string; osmBase: string | null };
  dataDir: string;
}

export type ProgressEvent =
  | { type: 'hello'; at: number }
  | { type: 'discovery'; queryId: number; status: string; poisFound: number; tilesDone: number; tilesTotal: number; mirror: string | null }
  | { type: 'queue'; pending: number; inFlight: number }
  | { type: 'lead'; businessId: number; stage: string; state: string; score: number | null }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; at: number }
  | { type: 'ping'; at: number };

export interface CreateDiscoveryRequest {
  location: string;
  categories?: string[];
  keyword?: string;
}

export interface PublicSettings {
  displayName: string;
  contactEmail: string;
  primaryOffer: string;
  geocoderBaseUrl: string;
  overpassMirrors: string[];
  globalConcurrency: number;
  perDomainConcurrency: number;
  perDomainDelayMs: number;
  maxPagesPerSite: number;
  respectRobots: boolean;
  fetchTimeoutMs: number;
  maxBodyBytes: number;
  notifications: boolean;
  ttlSeconds: Record<string, number>;
}
