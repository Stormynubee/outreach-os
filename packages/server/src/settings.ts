import type { OfferPreset } from '@outreach/shared';

export interface Settings {
  displayName: string;
  /** Required by both OSM usage policies: the User-Agent must identify the app and a contact. */
  contactEmail: string;
  primaryOffer: OfferPreset;
  /** Swappable without a software update — required by the Nominatim policy. */
  geocoderBaseUrl: string;
  overpassMirrors: string[];
  globalConcurrency: number;
  perDomainConcurrency: number;
  perDomainDelayMs: number;
  maxPagesPerSite: number;
  respectRobots: boolean;
  fetchTimeoutMs: number;
  overpassTimeoutMs: number;
  maxBodyBytes: number;
  notifications: boolean;
  ttlSeconds: {
    homepage: number;
    contactPage: number;
    social: number;
    robots: number;
    followers: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: 'there',
  contactEmail: '',
  primaryOffer: 'websites',
  geocoderBaseUrl: 'https://nominatim.openstreetmap.org',
  overpassMirrors: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ],
  globalConcurrency: 8,
  perDomainConcurrency: 1,
  perDomainDelayMs: 1200,
  maxPagesPerSite: 5,
  respectRobots: true,
  fetchTimeoutMs: 10_000,
  // Must exceed the [timeout:60] inside the generated query, otherwise the client
  // gives up before the server has a chance to answer.
  overpassTimeoutMs: 75_000,
  maxBodyBytes: 2 * 1024 * 1024,
  notifications: true,
  ttlSeconds: {
    homepage: 24 * 3600,
    contactPage: 7 * 24 * 3600,
    social: 7 * 24 * 3600,
    robots: 24 * 3600,
    followers: 7 * 24 * 3600,
  },
};

export const APP_VERSION = '0.1.0';

/** Honest, self-identifying UA. We never spoof a browser — it gets blocked harder once detected. */
export function userAgent(s: Settings): string {
  const contact = s.contactEmail.trim() || 'contact-not-configured';
  return `LeadOutreachBot/${APP_VERSION} (+contact: ${contact})`;
}

/**
 * Nominatim returns "403 Access denied" for placeholder contacts, so the app
 * rejects them up front with an explanation rather than letting the user hit a
 * bare HTTP 403 later.
 */
const PLACEHOLDER_CONTACT =
  /(^|[@./-])(example\.(com|org|net)|test\.(com|org|net)|localhost|invalid|domain\.com|email\.com|yourdomain\.[a-z]+|foo\.com|bar\.com)($|[/.]|$)/i;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export function isDiscoveryReady(s: Settings): { ready: boolean; reason?: string } {
  const value = s.contactEmail.trim();

  if (!value) {
    return {
      ready: false,
      reason:
        "Set a contact email in Settings first. OpenStreetMap's usage policy requires every request to identify a real contact, and clients that do not are blocked.",
    };
  }
  if (PLACEHOLDER_CONTACT.test(value)) {
    return {
      ready: false,
      reason:
        'OpenStreetMap rejects placeholder contacts such as example.com with a 403. Use an address you can actually be reached at, or a link to your project.',
    };
  }
  if (EMAIL_RE.test(value) || URL_RE.test(value) || value.length >= 4) {
    return { ready: true };
  }
  return { ready: false, reason: 'The contact in Settings does not look usable. Enter an email address or a URL.' };
}

/** Surfaced in Settings so the user knows whether they are fully policy-compliant. */
export function contactQuality(s: Settings): 'missing' | 'placeholder' | 'identifier' | 'email' | 'url' {
  const value = s.contactEmail.trim();
  if (!value) return 'missing';
  if (PLACEHOLDER_CONTACT.test(value)) return 'placeholder';
  if (EMAIL_RE.test(value)) return 'email';
  if (URL_RE.test(value)) return 'url';
  return 'identifier';
}
