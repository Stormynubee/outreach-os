import type { CheerioAPI } from 'cheerio';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface ExtractedPhone {
  raw: string;
  e164: string | null;
  isMobile: boolean;
  isWhatsapp: boolean;
  source: 'tel' | 'text' | 'jsonld' | 'whatsapp';
  sourceUrl: string;
  confidence: number;
  rejectReason: string | null;
}

const PHONE_RE = /(?:\+?\d[\d\s().\-/]{5,}\d)/g;

function tidy(raw: string): string {
  return raw
    .replace(/^tel:/i, '')
    .replace(/[^\d+().\-\s/]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasEnoughDigits(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 17;
}

/** Reject things that merely look numeric: years, prices, opening hours, IDs. */
function looksLikeNoise(value: string): boolean {
  if (/^\d{4}$/.test(value.trim())) return true;
  if (/^\d{1,3}(\.\d+)?$/.test(value.trim())) return true;
  if (/^\d{1,2}[:.]\d{2}(\s*[-–]\s*\d{1,2}[:.]\d{2})?$/.test(value.trim())) return true;
  if (/\b(19|20)\d{2}\b/.test(value) && value.replace(/\D/g, '').length <= 4) return true;
  return false;
}

export interface NormalizePhoneResult {
  e164: string | null;
  country: string | null;
  isMobile: boolean;
  rejectReason: string | null;
}

/**
 * Country inference ladder. Guessing wrong produces a wrong number, which is
 * worse than an unknown, so ambiguous input is left unresolved on purpose.
 */
export function normalizePhone(raw: string, country: string | null): NormalizePhoneResult {
  const cleaned = tidy(raw);
  if (!hasEnoughDigits(cleaned)) return { e164: null, country: null, isMobile: false, rejectReason: 'too_few_digits' };
  if (looksLikeNoise(cleaned)) return { e164: null, country: null, isMobile: false, rejectReason: 'not_a_phone' };

  const hint = country ? (country.toUpperCase() as CountryCode) : undefined;
  const explicitInternational = cleaned.startsWith('+') || cleaned.startsWith('00');

  const attempts: Array<string | undefined> = [];
  if (explicitInternational) {
    attempts.push(cleaned.replace(/^00/, '+'));
  } else {
    if (hint) attempts.push(cleaned);
    attempts.push(cleaned.startsWith('+') ? cleaned : `+${cleaned}`);
  }

  for (const candidate of attempts) {
    if (!candidate) continue;
    const parsed = parsePhoneNumberFromString(candidate, hint);
    if (parsed?.isValid()) {
      const type = parsed.getType();
      // A bare NANP-shaped number only becomes +1 when the discovery country
      // actually is US/CA; otherwise we leave it unresolved rather than invent one.
      return {
        e164: parsed.number,
        country: parsed.country ?? null,
        isMobile: type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE',
        rejectReason: null,
      };
    }
  }

  if (!explicitInternational && !hint) {
    return { e164: null, country: null, isMobile: false, rejectReason: 'country_unknown' };
  }
  return { e164: null, country: null, isMobile: false, rejectReason: 'unparseable' };
}

function collectJsonLd(value: unknown, out: string[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, out);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.telephone === 'string') out.push(obj.telephone);
    if (typeof obj.phone === 'string') out.push(obj.phone);
    for (const key of Object.keys(obj)) collectJsonLd(obj[key], out);
  }
}

export function extractWhatsappLinks($: CheerioAPI): { url: string; number: string }[] {
  const out: { url: string; number: string }[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const wa = /(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\+?\d{6,})/i.exec(href);
    if (wa?.[1]) out.push({ url: href, number: wa[1] });
  });
  return out;
}

export function extractPhones($: CheerioAPI, pageUrl: string, country: string | null): ExtractedPhone[] {
  const out: ExtractedPhone[] = [];
  const seen = new Set<string>();

  const push = (
    raw: string,
    source: ExtractedPhone['source'],
    confidence: number,
    isWhatsapp = false,
  ) => {
    const value = tidy(raw);
    if (!hasEnoughDigits(value)) return;
    const norm = normalizePhone(value, country);
    const key = norm.e164 ?? value;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      raw: value,
      e164: norm.e164,
      isMobile: norm.isMobile,
      isWhatsapp,
      source,
      sourceUrl: pageUrl,
      confidence,
      rejectReason: norm.rejectReason,
    });
  };

  $('a[href^="tel:" i]').each((_, el) => push($(el).attr('href') ?? '', 'tel', 0.95));
  for (const wa of extractWhatsappLinks($)) push(wa.number, 'whatsapp', 0.9, true);

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const collected: string[] = [];
      collectJsonLd(JSON.parse(raw) as unknown, collected);
      for (const value of collected) push(value, 'jsonld', 0.85);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  const text = $('body').length ? ($('body').text() ?? '') : ($.root().text() ?? '');
  for (const match of text.matchAll(PHONE_RE)) push(match[0], 'text', 0.6);

  return out;
}
