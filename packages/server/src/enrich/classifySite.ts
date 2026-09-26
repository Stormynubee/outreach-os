import type { SiteState } from '@outreach/shared';
import { normalizeHost } from '../lib/urls.ts';
import type { ErrorKind } from '../lib/http.ts';

export interface SiteSignals {
  status: number | null;
  finalUrl: string;
  contentType: string | null;
  serverHeader: string | null;
  redirectHosts: string[];
  body: string | null;
  errorKind: ErrorKind | null;
  robotsBlocked: boolean;
  hasSsl: boolean;
}

export interface SiteVerdict {
  siteState: SiteState;
  platform: string | null;
  parkingEvidence: string[];
  title: string | null;
  hasVideo: boolean;
  thin: boolean;
}

/** Hosts that only ever appear when a domain has lapsed or is listed for sale. */
const PARKING_HOSTS = [
  'sedo.com', 'sedoparking.com', 'afternic.com', 'dan.com', 'hugedomains.com',
  'forsale.godaddy.com', 'parking.godaddy.com', 'namecheap.com', 'bodis.com',
  'parkingcrew.net', 'above.com', 'domainmarket.com', 'brandbucket.com',
  'undeveloped.com', 'squadhelp.com', 'buydomains.com', 'registry.google',
];

/** Each marker carries a human-readable label, because the evidence is shown in the UI. */
const PARKING_TEXT: Array<[RegExp, string]> = [
  [/this domain (?:is|may be) for sale/i, 'page says the domain is for sale'],
  [/buy this domain/i, 'page offers the domain for sale'],
  [/this domain is parked/i, 'page says the domain is parked'],
  [/domain (?:is )?parked (?:free )?(?:at|by)/i, 'page mentions a parking service'],
  [/parked (?:free )?(?:at|by|courtesy of) /i, 'page mentions a parking service'],
  [/future home of/i, 'page says "future home of"'],
  [/website coming soon/i, 'page says the site is coming soon'],
  [/site (?:is )?not published/i, 'page says it is not published'],
  [/this site is under construction/i, 'page says it is under construction'],
  [/default web page/i, 'placeholder default page'],
  [/apache2 ubuntu default page/i, 'unconfigured Apache default page'],
  [/welcome to nginx/i, 'unconfigured nginx default page'],
  [/index of \//i, 'bare directory listing'],
  [/domain has expired/i, 'page says the domain has expired'],
  [/renew (?:your|this) domain/i, 'page asks to renew the domain'],
  [/this page is used to test/i, 'placeholder test page'],
];

const PLATFORMS: Array<[string, RegExp]> = [
  ['Shopify', /cdn\.shopify\.com|shopify\.theme|myshopify\.com|x-shopid/i],
  ['WordPress', /wp-content|wp-includes|wp-json/i],
  ['WooCommerce', /woocommerce/i],
  ['Squarespace', /static1\.squarespace\.com|squarespace-cdn|sqs-block/i],
  ['Wix', /wixstatic\.com|parastorage\.com/i],
  ['Webflow', /website-files\.com|webflow\.io/i],
  ['GoDaddy', /img1\.wsimg\.com|godaddysites\.com/i],
  ['Weebly', /weebly\.com|editmysite\.com/i],
  ['Joomla', /\/media\/jui\/|\/components\/com_content/i],
  ['Drupal', /drupal\.js|sites\/(?:all|default)\/(?:files|themes)/i],
  ['PrestaShop', /prestashop/i],
  ['Magento', /mage\/cookies|\/static\/version\d+\/frontend|magento/i],
  ['BigCommerce', /bigcommerce\.com|bc-sf-filter/i],
  ['HubSpot', /hs-scripts\.com|hubspot/i],
  ['Duda', /dudamobile|dudaone|duda\.co/i],
  ['Jimdo', /jimdo(?:cdn|\.com)/i],
  ['Strikingly', /strikingly(?:cdn|\.com)/i],
  ['Tilda', /tildacdn|tilda\.cc/i],
  ['Webnode', /webnode/i],
  ['Blogger', /blogger\.com|blogspot\.com/i],
  ['Next.js', /\/_next\/static/i],
];

const VIDEO_MARKERS = [
  /youtube\.com\/embed|youtube-nocookie\.com\/embed|youtu\.be\//i,
  /player\.vimeo\.com|vimeo\.com\/video/i,
  /tiktok\.com\/embed/i,
  /<video[\s>]/i,
  /og:video/i,
  /wistia\.(?:com|net)/i,
];

function detectPlatform(html: string, serverHeader: string | null): string | null {
  for (const [name, re] of PLATFORMS) {
    if (re.test(html)) return name;
  }
  const server = serverHeader ?? '';
  if (/cloudflare/i.test(server)) return 'Cloudflare';
  if (/nginx/i.test(server)) return 'nginx';
  if (/apache/i.test(server)) return 'Apache';
  return null;
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  if (!match?.[1]) return null;
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 200) || null;
}

/**
 * Parked detection needs at least two independent signals before we claim it.
 * A false "parked" on a legitimately tiny site is the most likely error here,
 * so every matched signal is recorded and shown in the UI for a human to audit.
 */
export function classifySite(signals: SiteSignals): SiteVerdict {
  const evidence: string[] = [];
  const body = signals.body ?? '';
  const platform = body ? detectPlatform(body, signals.serverHeader) : null;
  const title = body ? extractTitle(body) : null;
  const hasVideo = body ? VIDEO_MARKERS.some((re) => re.test(body)) : false;

  const base: SiteVerdict = {
    siteState: 'unknown',
    platform,
    parkingEvidence: evidence,
    title,
    hasVideo,
    thin: false,
  };

  if (signals.robotsBlocked) return { ...base, siteState: 'robots_disallowed' };

  const redirectParked = signals.redirectHosts.find((host) =>
    PARKING_HOSTS.some((p) => host === p || host.endsWith(`.${p}`)),
  );
  if (redirectParked) evidence.push(`redirected to parking host ${redirectParked}`);

  if (!signals.status && signals.errorKind) {
    switch (signals.errorKind) {
      case 'dns_fail':
        return { ...base, siteState: 'dead', parkingEvidence: [...evidence, 'domain does not resolve'] };
      case 'refused':
        return { ...base, siteState: 'server_down', parkingEvidence: evidence };
      case 'timeout':
        return { ...base, siteState: 'timeout', parkingEvidence: evidence };
      case 'too_many_redirects':
        return { ...base, siteState: 'too_many_redirects', parkingEvidence: evidence };
      default:
        return { ...base, siteState: 'dead', parkingEvidence: evidence };
    }
  }

  const status = signals.status ?? 0;

  // A redirect we did not follow is still meaningful evidence on its own.
  if (redirectParked && status >= 300 && status < 400) {
    return { ...base, siteState: 'parked', parkingEvidence: evidence };
  }
  if (signals.errorKind === 'too_many_redirects') {
    return { ...base, siteState: 'too_many_redirects', parkingEvidence: evidence };
  }

  if (status === 401 || status === 403 || status === 429) {
    return { ...base, siteState: 'blocked', parkingEvidence: evidence };
  }
  if (status === 404 || status === 410) {
    return { ...base, siteState: 'dead', parkingEvidence: evidence };
  }
  if (status >= 500) {
    return { ...base, siteState: 'server_error', parkingEvidence: evidence };
  }
  if (status < 200 || status >= 300) {
    return { ...base, siteState: 'dead', parkingEvidence: evidence };
  }

  if (!body) return { ...base, siteState: 'unknown', parkingEvidence: evidence };

  const lower = body.toLowerCase();
  for (const [re, label] of PARKING_TEXT) {
    if (re.test(lower)) evidence.push(label);
  }
  if (/parking/i.test(signals.serverHeader ?? '')) {
    evidence.push(`server header reports "${signals.serverHeader}"`);
  }

  const ownDomain = normalizeHost(new URL(signals.finalUrl).hostname);
  const linkMatches = [...body.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)]
    .map((m) => {
      try {
        return normalizeHost(new URL(m[1]!).hostname);
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  const hasOwnLinks = linkMatches.some((h) => h === ownDomain);

  const thin = body.length < 12_000;
  if (thin && !hasOwnLinks) {
    evidence.push(`page is only ${Math.max(1, Math.round(body.length / 1024))} KB and links to no page of its own`);
  }

  if (evidence.length >= 2) {
    return { ...base, siteState: 'parked', parkingEvidence: evidence, thin };
  }

  if (!signals.hasSsl) return { ...base, siteState: 'live_insecure', parkingEvidence: evidence, thin };

  if (thin || !hasOwnLinks) {
    return { ...base, siteState: 'live_weak', parkingEvidence: evidence, thin };
  }

  return { ...base, siteState: 'live', parkingEvidence: evidence, thin };
}

export const PARKING_TEXT_PATTERNS = PARKING_TEXT;
