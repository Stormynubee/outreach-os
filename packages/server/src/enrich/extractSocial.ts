import type { CheerioAPI } from 'cheerio';
import type { SocialPlatform } from '@outreach/shared';
import { normalizeUrl } from '../lib/urls.ts';

export interface FoundSocial {
  platform: SocialPlatform;
  url: string;
  handle: string | null;
  discoverySource: 'site' | 'osm';
}

function collectJsonLd(value: unknown, out: string[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, out);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sameAs = obj.sameAs;
    if (typeof sameAs === 'string') out.push(sameAs);
    else if (Array.isArray(sameAs)) for (const entry of sameAs) if (typeof entry === 'string') out.push(entry);
    for (const key of Object.keys(obj)) collectJsonLd(obj[key], out);
  }
}

/**
 * Harvest social profiles from a page. Share/intent widgets are filtered out by
 * normalizeUrl — without that, every page with a "share on Twitter" button would
 * attach Twitter's own URL to thousands of unrelated businesses.
 */
export function extractSocials($: CheerioAPI): FoundSocial[] {
  const out = new Map<string, FoundSocial>();

  const consider = (href: string, source: 'site' | 'osm') => {
    const norm = normalizeUrl(href);
    if (!norm) return;
    if (!norm.isSocial && !norm.isAggregator) return;
    if (norm.shareWidget) return;

    const platform: SocialPlatform = norm.isAggregator ? 'linkinbio' : (norm.platform ?? 'other');
    if (platform === 'other') return;

    const handle = norm.handle ?? norm.url.toLowerCase();
    const key = `${platform}:${handle}`;
    if (out.has(key)) return;
    out.set(key, { platform, url: norm.url, handle: norm.handle, discoverySource: source });
  };

  $('a[href]').each((_, el) => {
    consider($(el).attr('href') ?? '', 'site');
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const urls: string[] = [];
      collectJsonLd(JSON.parse(raw) as unknown, urls);
      for (const url of urls) consider(url, 'site');
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  // Plain-text mentions catch profiles that are only written out, not linked.
  const text = $('body').text() ?? '';
  for (const match of text.matchAll(
    /(?:https?:\/\/)?(?:www\.)?(instagram\.com|facebook\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com)\/[A-Za-z0-9_.@\-/]{2,60}/g,
  )) {
    consider(`https://${match[0]}`, 'site');
  }

  return [...out.values()];
}

export interface LinkCandidate {
  href: string;
  text: string;
  score: number;
}

const CONTACT_WORDS =
  /(contact|about|impressum|kontakt|contacto|contatti|contatte|fale-conosco|iletisim|iletis|reach|team|company|support|legal|privacy|nosotros|sobre|acerca|quienes|ueber-uns|uber-uns|nous|chi-siamo|kontakta|yhteystiedot|ov(?:er)?-?ons|informatie|om-oss|meista|khteer|اتصل|تواصل|联系我们|关于|会社概要|お問い合わせ|문의)/i;

const HARD_NOISE =
  /\.(?:pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|webm|css|js|xml|rss|ico)$/i;

/**
 * Rank same-site pages by how likely they are to hold contact details. This is
 * what keeps the crawl to ~5 requests per business instead of the whole site.
 */
export function rankContactLinks($: CheerioAPI, pageUrl: string, max = 3): LinkCandidate[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const candidates = new Map<string, LinkCandidate>();

  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href');
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      return;
    }
    if (url.origin !== origin) return;
    if (HARD_NOISE.test(url.pathname)) return;

    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^fbclid$|^gclid$/.test(key)) url.searchParams.delete(key);
    }
    const href = url.toString();

    const text = ($(el).text() || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const haystack = `${url.pathname} ${text}`;
    if (!CONTACT_WORDS.test(haystack)) return;

    let score = 0;
    if (CONTACT_WORDS.test(url.pathname)) score += 3;
    if (CONTACT_WORDS.test(text)) score += 2;
    const depth = url.pathname.split('/').filter(Boolean).length;
    score += Math.max(0, 2 - depth);
    if (/^contact/i.test(url.pathname.replace(/^\//, ''))) score += 2;

    const existing = candidates.get(href);
    if (!existing || existing.score < score) candidates.set(href, { href, text, score });
  });

  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

/** Last-resort guesses when the homepage exposed nothing to follow. */
export function guessContactUrls(pageUrl: string): string[] {
  try {
    const origin = new URL(pageUrl).origin;
    return ['/contact', '/contact-us', '/about', '/contact.html'].map((p) => `${origin}${p}`);
  } catch {
    return [];
  }
}
