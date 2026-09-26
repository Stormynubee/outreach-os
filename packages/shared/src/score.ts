import type { SiteState } from './types.ts';

export const SCORE_VERSION = 1;

export type OfferPreset = 'websites' | 'social_media' | 'balanced';

/**
 * How much each website state signals an opportunity.
 * Higher = the business needs what we sell more badly.
 */
export const BASE_SITE_POINTS: Record<SiteState, number> = {
  no_tag: 55,
  social_only: 50,
  dead: 48,
  parked: 45,
  server_down: 44,
  live_insecure: 30,
  live_weak: 25,
  timeout: 25,
  too_many_redirects: 25,
  server_error: 22,
  blocked: 20,
  has_tag_unprobed: 15,
  unknown: 10,
  robots_disallowed: 10,
  live: 8,
};

/** Only these two swap between presets — everything else is offer-independent. */
const PRESET_OVERRIDES: Record<OfferPreset, Partial<Record<SiteState, number>>> = {
  websites: { no_tag: 55, social_only: 50 },
  social_media: { no_tag: 50, social_only: 55 },
  balanced: { no_tag: 53, social_only: 53 },
};

export const sitePoints = (state: SiteState, preset: OfferPreset = 'websites'): number =>
  PRESET_OVERRIDES[preset][state] ?? BASE_SITE_POINTS[state];

export const CONTACT_POINTS = { phone: 12, email: 12, social: 6 } as const;
export const CONTACT_CAP = 30;

export const PRESENCE = {
  hasSocial: 8,
  magnitude: { under500: 1, under2k: 3, under10k: 5, atLeast10k: 7 },
  cap: 15,
} as const;

/**
 * Confidence is driven by how much of the business we actually inspected,
 * never by what the values happen to say. This is what stops unprobed
 * businesses from outranking verified ones.
 */
export const CONFIDENCE = {
  floor: 0.7,
  range: 0.3,
  weights: { website: 0.5, contacts: 0.3, socials: 0.2 },
} as const;

export const MAGNITUDE_TIERS = ['unknown', 'under500', 'under2k', 'under10k', 'atLeast10k'] as const;
export type MagnitudeTier = (typeof MAGNITUDE_TIERS)[number];

export function magnitudeTier(followers: number | null, state: string): MagnitudeTier {
  if (followers === null || followers === undefined || state !== 'known') return 'unknown';
  if (followers < 500) return 'under500';
  if (followers < 2000) return 'under2k';
  if (followers < 10000) return 'under10k';
  return 'atLeast10k';
}

export function magnitudePoints(tier: MagnitudeTier): number {
  switch (tier) {
    case 'under500':
      return PRESENCE.magnitude.under500;
    case 'under2k':
      return PRESENCE.magnitude.under2k;
    case 'under10k':
      return PRESENCE.magnitude.under10k;
    case 'atLeast10k':
      return PRESENCE.magnitude.atLeast10k;
    default:
      return 0;
  }
}

export interface ScoreInput {
  siteState: SiteState;
  hasPhone: boolean;
  hasEmail: boolean;
  hasSocial: boolean;
  magnitudeTier: MagnitudeTier;
  websiteProbed: boolean;
  contactsExtracted: boolean;
  socialsChecked: boolean;
  preset?: OfferPreset;
}

export interface ScoreResult {
  score: number;
  webGap: number;
  contactability: number;
  presence: number;
  confidence: number;
  reasons: string[];
}

export function confidenceFactor(input: Pick<ScoreInput, 'websiteProbed' | 'contactsExtracted' | 'socialsChecked'>): number {
  const { weights, floor, range } = CONFIDENCE;
  const coverage =
    (input.websiteProbed ? weights.website : 0) +
    (input.contactsExtracted ? weights.contacts : 0) +
    (input.socialsChecked ? weights.socials : 0);
  return floor + range * coverage;
}

export function scoreLead(input: ScoreInput): ScoreResult {
  const preset = input.preset ?? 'websites';
  const webGap = sitePoints(input.siteState, preset);

  const contactability = Math.min(
    CONTACT_CAP,
    (input.hasPhone ? CONTACT_POINTS.phone : 0) +
      (input.hasEmail ? CONTACT_POINTS.email : 0) +
      (input.hasSocial ? CONTACT_POINTS.social : 0),
  );

  const presenceRaw = (input.hasSocial ? PRESENCE.hasSocial : 0) + magnitudePoints(input.magnitudeTier);
  const presence = Math.min(PRESENCE.cap, presenceRaw);

  const confidence = confidenceFactor(input);
  const score = Math.max(0, Math.min(100, Math.round((webGap + contactability + presence) * confidence)));

  const reasons: string[] = [];
  switch (input.siteState) {
    case 'no_tag':
      reasons.push('no website found');
      break;
    case 'social_only':
      reasons.push('social profile used instead of a website');
      break;
    case 'dead':
    case 'server_down':
      reasons.push('website is unreachable');
      break;
    case 'parked':
      reasons.push('domain is parked / for sale');
      break;
    case 'live_weak':
      reasons.push('website is live but very thin');
      break;
    case 'live_insecure':
      reasons.push('website has no valid SSL');
      break;
    case 'blocked':
      reasons.push('website blocks automated visits');
      break;
    case 'has_tag_unprobed':
      reasons.push('website listed in OSM but not yet checked');
      break;
    case 'live':
      reasons.push('has a working website');
      break;
    default:
      reasons.push('website state unknown');
  }
  if (input.hasPhone) reasons.push('phone found');
  if (input.hasEmail) reasons.push('email found');
  if (input.hasSocial) reasons.push('social presence found');
  if (input.magnitudeTier === 'unknown') reasons.push('follower count not available');
  if (confidence < 1) reasons.push(`partially checked (${Math.round(confidence * 100)}% confidence)`);

  return { score, webGap, contactability, presence, confidence, reasons };
}
