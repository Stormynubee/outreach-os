export const SITE_STATES = [
  'unknown',
  'no_tag',
  'social_only',
  'has_tag_unprobed',
  'live',
  'live_weak',
  'live_insecure',
  'blocked',
  'dead',
  'parked',
  'server_down',
  'server_error',
  'timeout',
  'too_many_redirects',
  'robots_disallowed',
] as const;

export type SiteState = (typeof SITE_STATES)[number];

export const PIPELINE_STAGES = ['new', 'contacted', 'replied', 'won', 'lost'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const SOCIAL_PLATFORMS = [
  'youtube',
  'tiktok',
  'facebook',
  'instagram',
  'twitter',
  'linkedin',
  'pinterest',
  'threads',
  'telegram',
  'whatsapp',
  /** Link-in-bio hubs (linktr.ee etc). Proof of digital spend, not a real website. */
  'linkinbio',
  'other',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const FOLLOWERS_STATES = [
  'known',
  'unknown',
  'blocked',
  'rate_limited',
  'not_attempted',
  'unsupported',
] as const;
export type FollowersState = (typeof FOLLOWERS_STATES)[number];

export type EmailKind = 'role' | 'personal' | 'noreply';
export type EnrichmentStage = 'none' | 'probe' | 'scrape' | 'contacts' | 'socials' | 'done';

export const TASK_STATUSES = ['open', 'done', 'cancelled', 'snoozed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_CHANNELS = ['call', 'email', 'dm', 'visit', 'other'] as const;
export type TaskChannel = (typeof TASK_CHANNELS)[number];

/** Honest, user-facing explanations for why a follower count is missing. */
export const FOLLOWERS_REASONS: Record<string, string> = {
  platform_requires_auth: 'Platform hides this behind a login wall',
  platform_tos_blocked: 'Platform terms forbid automated collection',
  blocked_by_waf: 'Request was blocked by the site firewall',
  no_count_in_markup: 'Profile is reachable but shows no follower count',
  rate_limited: 'Rate limited — will retry later',
  not_attempted: 'Not checked yet',
  manual: 'Entered by hand',
};

export const SITE_STATE_LABELS: Record<SiteState, string> = {
  unknown: 'Unknown',
  no_tag: 'No website',
  social_only: 'Social only',
  has_tag_unprobed: 'Site unchecked',
  live: 'Live site',
  live_weak: 'Thin site',
  live_insecure: 'No SSL',
  blocked: 'Blocked',
  dead: 'Dead site',
  parked: 'Parked domain',
  server_down: 'Server down',
  server_error: 'Server error',
  timeout: 'Timed out',
  too_many_redirects: 'Redirect loop',
  robots_disallowed: 'Opted out',
};

/** States that mean "this business has no working website" — the core sales signal. */
export const NO_SITE_STATES: SiteState[] = ['no_tag', 'social_only', 'dead', 'parked', 'server_down'];
