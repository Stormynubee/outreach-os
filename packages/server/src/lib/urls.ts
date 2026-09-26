import { parse as parseTld } from 'tldts';
import type { SocialPlatform } from '@outreach/shared';

/**
 * Hosts where each subdomain is a *different business*. Without this list,
 * dedupe_key would collapse every Wix site in the world onto "wixsite.com".
 */
const FREE_HOST_SUFFIXES = [
  'wixsite.com',
  'wordpress.com',
  'blogspot.com',
  'blogger.com',
  'business.site',
  'godaddysites.com',
  'weebly.com',
  'weeblysite.com',
  'squarespace.com',
  'webnode.page',
  'webnode.com',
  'myshopify.com',
  'webflow.io',
  'netlify.app',
  'vercel.app',
  'github.io',
  'notion.site',
  'carrd.co',
  'web.app',
  'tumblr.com',
  'strikingly.com',
  'site123.me',
  'duda.co',
  'webstarts.com',
  'yolasite.com',
  'jimdofree.com',
  'bigcartel.com',
  'ecwid.com',
  'shoplazza.com',
  'square.site',
  'sites.google.com',
  'wordpress.org',
];

/** Link-in-bio hubs: not a real website, but proof they spend on digital. */
const AGGREGATOR_HOSTS = new Set([
  'linktr.ee',
  'linkin.bio',
  'beacons.ai',
  'bio.link',
  'taplink.cc',
  'milkshake.app',
  'linkr.bio',
  'campsite.bio',
  'solo.to',
  'allmylinks.com',
  'withkoji.com',
]);

const SOCIAL_HOSTS: Record<string, SocialPlatform> = {
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'fb.me': 'facebook',
  'fb.watch': 'facebook',
  'tiktok.com': 'tiktok',
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'linkedin.com': 'linkedin',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'pinterest.com': 'pinterest',
  'pin.it': 'pinterest',
  'threads.net': 'threads',
  'threads.com': 'threads',
  't.me': 'telegram',
  'telegram.me': 'telegram',
  'wa.me': 'whatsapp',
  'api.whatsapp.com': 'whatsapp',
  'whatsapp.com': 'whatsapp',
};

/**
 * Paths that are share/intent widgets, not the business's own profile.
 * Attaching these would tag thousands of unrelated businesses with Twitter's share URL.
 */
const SHARE_PATHS = [
  /^\/sharer(\.php)?(\/|$)/i,
  /^\/share/i,
  /^\/shareArticle/i,
  /^\/intent\/(tweet|like|follow)/i,
  /^\/plugins\//i,
  /^\/tr(\/|$)/i,
  /^\/v2\.0\/dialog/i,
  /^\/dialog\//i,
  /^\/explore(\/|$)/i,
  /^\/pin\/create/i,
  /^\/pin\/button/i,
  /^\/company\/share/i,
  /^\/home(\/|$)/i,
];

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^msclkid$/i,
  /^igshid$/i,
  /^mibextid$/i,
  /^_t$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^si$/i,
  /^feature$/i,
  /^source$/i,
  /^yclid$/i,
  /^mc_(cid|eid)$/i,
];

export interface NormalizedUrl {
  url: string;
  host: string;
  /** Registrable domain, or full host for free-host subdomains. */
  dedupeKey: string;
  domain: string | null;
  isSocial: boolean;
  isAggregator: boolean;
  platform: SocialPlatform | null;
  handle: string | null;
  shareWidget: boolean;
}

function stripWww(host: string): string {
  return host.replace(/^www\./i, '');
}

export function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  host = host.replace(/\.$/, '');
  host = host.replace(/:\d+$/, '');
  try {
    host = new URL(`http://${host}`).hostname;
  } catch {
    /* keep as-is */
  }
  return host;
}

export function isFreeHost(host: string): boolean {
  const h = stripWww(host);
  return FREE_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

export function detectSocial(host: string): { isSocial: boolean; platform: SocialPlatform | null } {
  let h = stripWww(host);
  // Resolve the registrable form so m.facebook.com and en-gb.facebook.com both hit.
  const reg = parseTld(h).domain ?? h;
  const direct = SOCIAL_HOSTS[h] ?? SOCIAL_HOSTS[reg];
  if (direct) return { isSocial: true, platform: direct };
  if (/\.instagram\.com$/i.test(h)) return { isSocial: true, platform: 'instagram' };
  if (/\.facebook\.com$/i.test(h)) return { isSocial: true, platform: 'facebook' };
  if (/\.tiktok\.com$/i.test(h)) return { isSocial: true, platform: 'tiktok' };
  if (/\.youtube\.com$/i.test(h)) return { isSocial: true, platform: 'youtube' };
  return { isSocial: false, platform: null };
}

export function isAggregator(host: string): boolean {
  const h = stripWww(host);
  if (AGGREGATOR_HOSTS.has(h)) return true;
  return AGGREGATOR_HOSTS.has(parseTld(h).domain ?? '');
}

function isSharePath(pathname: string): boolean {
  return SHARE_PATHS.some((re) => re.test(pathname));
}

/** Extract a stable per-platform identity so the same profile found twice dedupes. */
function extractHandle(platform: SocialPlatform | null, url: URL): string | null {
  const segs = url.pathname.split('/').filter(Boolean);
  if (!segs.length) return platform === 'youtube' ? null : null;

  switch (platform) {
    case 'instagram':
    case 'threads': {
      const first = segs[0]!;
      if (['p', 'reel', 'reels', 'explore', 'stories', 'tv'].includes(first)) return null;
      return first.toLowerCase();
    }
    case 'facebook': {
      if (['pages', 'groups', 'profile.php', 'people'].includes(segs[0]!)) return null;
      return segs[0]!.toLowerCase();
    }
    case 'tiktok':
      return segs[0]!.replace(/^@/, '').toLowerCase() || null;
    case 'twitter': {
      if (['i', 'home', 'search', 'hashtag', 'intent'].includes(segs[0]!)) return null;
      return segs[0]!.toLowerCase();
    }
    case 'linkedin': {
      if (['company', 'in', 'school', 'showcase'].includes(segs[0]!) && segs[1]) return `${segs[0]}/${segs[1]}`.toLowerCase();
      return null;
    }
    case 'youtube': {
      const first = segs[0]!;
      if (first.startsWith('@')) return first.toLowerCase();
      if (['channel', 'c', 'user'].includes(first) && segs[1]) return `${first}/${segs[1]}`.toLowerCase();
      return null;
    }
    case 'telegram':
      return segs[0]!.toLowerCase() || null;
    case 'whatsapp': {
      const digits = (segs[0] ?? url.searchParams.get('phone') ?? '').replace(/\D/g, '');
      return digits || null;
    }
    case 'pinterest':
      return segs[0]!.toLowerCase() || null;
    default:
      return null;
  }
}

export function normalizeUrl(raw: string): NormalizedUrl | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text || /^(mailto:|tel:|javascript:|#)/i.test(text)) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();

  const host = stripWww(url.hostname);
  if (!host.includes('.')) return null;

  // Strip a trailing slash on a bare path for stable cache keys.
  if (url.pathname === '/') url.pathname = '';

  const { isSocial, platform } = detectSocial(host);
  const aggregator = isAggregator(host);
  const shareWidget = isSocial && isSharePath(url.pathname);

  let dedupeKey: string;
  if (isFreeHost(host)) dedupeKey = host;
  else dedupeKey = parseTld(host).domain ?? host;

  return {
    url: url.toString(),
    host,
    dedupeKey,
    domain: parseTld(host).domain ?? null,
    isSocial,
    isAggregator: aggregator,
    platform,
    handle: isSocial ? extractHandle(platform, url) : null,
    shareWidget,
  };
}

/** Stable cache key: same page reached via different tracking links hits one row. */
export function cacheKey(url: URL | string): string {
  const u = typeof url === 'string' ? new URL(url) : url;
  const clone = new URL(u.toString());
  clone.hash = '';
  for (const key of [...clone.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) clone.searchParams.delete(key);
  }
  clone.searchParams.sort();
  clone.hostname = clone.hostname.toLowerCase().replace(/^www\./, '');
  if (clone.pathname === '/') clone.pathname = '';
  return clone.toString();
}

/** Lowercase + strip accents/punctuation so "Café Rémy Ltd." matches "cafe remy". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|llc|gmbh|bv|sarl|sa|plc|co|corp|company|pty|sl|oy|ab|as)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Local calendar day (YYYY-MM-DD). A task is a calendar-day thing, not an instant. */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + n);
  return localDay(dt);
}
