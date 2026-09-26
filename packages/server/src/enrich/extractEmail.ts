import type { CheerioAPI } from 'cheerio';
import type { EmailKind } from '@outreach/shared';

/**
 * Cloudflare replaces addresses with a XOR-obfuscated hex blob in a data-cfemail
 * attribute. Decoding it is public, well-documented and entirely legitimate —
 * it is how the address is meant to be displayed to a browser.
 */
export function decodeCloudflare(encoded: string): string | null {
  const hex = encoded.trim();
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16) ^ key;
    if (code === 0) return null;
    out += String.fromCharCode(code);
  }
  return out.includes('@') ? out : null;
}

const ROLE_LOCALS = new Set([
  'info', 'hello', 'hi', 'contact', 'contactus', 'sales', 'enquiries', 'enquiry', 'inquiries',
  'inquiry', 'admin', 'adminstration', 'administration', 'office', 'support', 'bookings',
  'booking', 'team', 'mail', 'reception', 'hola', 'bonjour', 'kontakt', 'service', 'help',
  'orders', 'accounts', 'billing', 'marketing', 'press', 'media', 'careers', 'jobs', 'shop',
  'store', 'general', 'ask', 'cs', 'customercare', 'customerservice', 'clinic', 'studio',
  'academy', 'school', 'frontdesk', 'reservations', 'reservation', 'events', 'partners',
]);

const NOREPLY_LOCALS = /^(no-?reply|donotreply|do-not-reply|postmaster|abuse|mailer-daemon|bounce|notifications?|automated|system|daemon)/i;

export function classifyEmail(address: string): EmailKind {
  const local = address.split('@')[0]?.toLowerCase() ?? '';
  if (NOREPLY_LOCALS.test(local)) return 'noreply';
  if (ROLE_LOCALS.has(local)) return 'role';
  if (/^(info|hello|contact|sales|office|admin|team|support|book)[._-]/i.test(local)) return 'role';
  return 'personal';
}

/** Addresses that are never a business's real contact. */
const REJECT_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'domain.com', 'yourdomain.com',
  'email.com', 'sentry.io', 'sentry-next.wixpress.com', 'wixpress.com', 'wix.com',
  'godaddy.com', 'cloudflare.com', 'squarespace.com', 'wordpress.com', 'localhost',
  'schema.org', 'w3.org', 'googlemail.co', 'mail.com',
]);

const HAS_FILE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|css|js|mjs|json|woff2?|ttf|eot|ico|pdf|mp4|webm|zip)$/i;
const LOOKS_LIKE_HASH = /^[0-9a-f]{16,}$/i;

export function isPlausibleEmail(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();

  if (local.length > 64 || domain.length > 253) return false;
  if (REJECT_DOMAINS.has(domain)) return false;
  if (HAS_FILE_EXTENSION.test(domain) || HAS_FILE_EXTENSION.test(address)) return false;
  if (LOOKS_LIKE_HASH.test(local)) return false;
  if (/^\d+$/.test(local)) return false;
  if (!/^[a-z0-9._%+-]+$/i.test(local)) return false;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) return false;
  if (domain.split('.').pop()!.length < 2) return false;
  return true;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Repair "name (at) domain (dot) com" style obfuscation, targeted at address-shaped text only. */
export function deobfuscate(text: string): string {
  return text
    .replace(/&#0*64;|&commat;/gi, '@')
    .replace(/&#0*46;|&period;/gi, '.')
    .replace(
      /([a-z0-9._%+-]+)\s*(?:\(|\[|\{|\s)?\s*(?:at|@|＠)\s*(?:\)|\]|\}|\s)?\s*([a-z0-9-]+(?:\s*(?:\(|\[|\{)?\s*(?:dot|\.)\s*(?:\)|\]|\})?\s*[a-z0-9-]+)+)/gi,
      (_m, local: string, rest: string) => ` ${local}@${rest.replace(/\s*(?:\(|\[|\{)?\s*(?:dot|\.)\s*(?:\)|\]|\})?\s*/gi, '.')} `,
    )
    .replace(/\s+@\s+/g, '@')
    .replace(/\s+\.\s+/g, '.');
}

export function findEmails(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(EMAIL_RE)) {
    const address = match[0].toLowerCase().replace(/[.,;:]+$/, '');
    if (isPlausibleEmail(address)) found.add(address);
  }
  return [...found];
}

export interface ExtractedEmail {
  address: string;
  kind: EmailKind;
  source: 'mailto' | 'text' | 'jsonld' | 'cf-decode';
  sourceUrl: string;
  confidence: number;
}

function collectJsonLdEmails(value: unknown, out: string[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdEmails(item, out);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.email === 'string') out.push(obj.email.replace(/^mailto:/i, ''));
    for (const key of Object.keys(obj)) collectJsonLdEmails(obj[key], out);
  }
}

/**
 * Sources are ranked by precision: mailto: hrefs first (deliberate, structured),
 * then JSON-LD, then visible text, then de-obfuscation as a last resort.
 */
export function extractEmails($: CheerioAPI, pageUrl: string): ExtractedEmail[] {
  const out: ExtractedEmail[] = [];
  const seen = new Set<string>();

  const push = (address: string, source: ExtractedEmail['source'], confidence: number) => {
    const clean = address.trim().toLowerCase().replace(/^mailto:/i, '').split('?')[0]!;
    if (!isPlausibleEmail(clean) || seen.has(clean)) return;
    seen.add(clean);
    out.push({ address: clean, kind: classifyEmail(clean), source, sourceUrl: pageUrl, confidence });
  };

  $('a[href^="mailto:" i]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      /* keep raw */
    }
    for (const address of findEmails(decoded)) push(address, 'mailto', 0.95);
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const collected: string[] = [];
      collectJsonLdEmails(parsed, collected);
      for (const value of collected) for (const address of findEmails(value)) push(address, 'jsonld', 0.9);
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  });

  $('[data-cfemail]').each((_, el) => {
    const decoded = decodeCloudflare($(el).attr('data-cfemail') ?? '');
    if (decoded) push(decoded, 'cf-decode', 0.85);
  });

  const text = $('body').length ? ($('body').text() ?? '') : ($.root().text() ?? '');
  for (const address of findEmails(text)) push(address, 'text', 0.8);
  for (const address of findEmails(deobfuscate(text))) push(address, 'text', 0.6);

  return out;
}

export const EMAIL_ROLE = ROLE_LOCALS;
