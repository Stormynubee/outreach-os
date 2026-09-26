import { describe, expect, it } from 'vitest';
import { addDays, cacheKey, isFreeHost, localDay, normalizeName, normalizeUrl } from '../src/lib/urls.ts';

const norm = (u: string) => normalizeUrl(u);

describe('url normalization', () => {
  it('adds a scheme and strips tracking params and fragments', () => {
    const r = norm('www.Example.com/?utm_source=x&fbclid=y#frag')!;
    expect(r.host).toBe('example.com');
    // The fetchable URL keeps www on purpose: plenty of small-business apex
    // domains do not resolve, so rewriting it would break those sites.
    expect(r.url).toBe('https://www.example.com/');
    expect(r.dedupeKey).toBe('example.com');
    expect(r.host).toBe('example.com');
  });

  it('uses the registrable domain so subdomains of one business collide', () => {
    expect(norm('https://shop.example.co.uk/a')!.dedupeKey).toBe('example.co.uk');
    expect(norm('https://www.example.com.br')!.dedupeKey).toBe('example.com.br');
    expect(norm('https://a.b.example.com')!.dedupeKey).toBe('example.com');
  });

  it('keeps free-host subdomains distinct — they are different businesses', () => {
    expect(isFreeHost('joes-plumbing.wixsite.com')).toBe(true);
    expect(norm('https://joes-plumbing.wixsite.com/home')!.dedupeKey).toBe('joes-plumbing.wixsite.com');
    expect(norm('https://another-shop.wixsite.com/home')!.dedupeKey).toBe('another-shop.wixsite.com');
    expect(norm('https://acme.wordpress.com')!.dedupeKey).toBe('acme.wordpress.com');
    // A business with its own domain hosted on the same platform is unaffected.
    expect(norm('https://joesplumbing.com')!.dedupeKey).toBe('joesplumbing.com');
  });

  it('detects social-as-website and extracts handles', () => {
    const fb = norm('https://www.facebook.com/JoesPlumbing')!;
    expect(fb.isSocial).toBe(true);
    expect(fb.platform).toBe('facebook');
    expect(fb.handle).toBe('joesplumbing');

    expect(norm('https://instagram.com/joes.plumbing/?igshid=abc')!.handle).toBe('joes.plumbing');
    expect(norm('https://tiktok.com/@joesplumbing')!.handle).toBe('joesplumbing');
    expect(norm('https://x.com/joesplumbing')!.platform).toBe('twitter');
    expect(norm('https://youtube.com/@joesplumbing')!.handle).toBe('@joesplumbing');
    expect(norm('https://youtube.com/channel/UC123')!.handle).toBe('channel/uc123');
    expect(norm('https://linkedin.com/company/acme-plumbing')!.handle).toBe('company/acme-plumbing');
    expect(norm('https://wa.me/441234567890')!.handle).toBe('441234567890');
  });

  it('flags share widgets so we never attach them to a business', () => {
    expect(norm('https://twitter.com/intent/tweet?url=x')!.shareWidget).toBe(true);
    expect(norm('https://facebook.com/sharer/sharer.php?u=x')!.shareWidget).toBe(true);
    expect(norm('https://facebook.com/plugins/like.php')!.shareWidget).toBe(true);
    expect(norm('https://www.facebook.com/JoesPlumbing')!.shareWidget).toBe(false);
  });

  it('flags link-in-bio hubs as not-a-website', () => {
    expect(norm('https://linktr.ee/joesplumbing')!.isAggregator).toBe(true);
    expect(norm('https://linktr.ee/joesplumbing')!.isSocial).toBe(false);
  });

  it('rejects non-http and unparseable input', () => {
    expect(norm('mailto:a@b.com')).toBeNull();
    expect(norm('tel:+441234')).toBeNull();
    expect(norm('javascript:void(0)')).toBeNull();
    expect(norm('')).toBeNull();
    expect(norm('not a url')).toBeNull();
    expect(norm('http://localhost')).toBeNull();
  });
});

describe('cache keys', () => {
  it('collapses tracking variants of the same page into one cache entry', () => {
    const a = cacheKey('https://www.Example.com/contact?utm_source=news&b=2&a=1');
    const b = cacheKey('https://example.com/contact?a=1&b=2');
    expect(a).toBe(b);
  });
});

describe('name normalization', () => {
  it('strips legal suffixes, case and accents so duplicates collapse', () => {
    expect(normalizeName('Café Rémy Ltd.')).toBe('cafe remy');
    expect(normalizeName('CAFE REMY LIMITED')).toBe('cafe remy');
    expect(normalizeName("Joe's Plumbing & Heating LLC")).toBe('joe s plumbing heating');
  });

  it('does not mangle names that merely contain suffix-like words', () => {
    expect(normalizeName('Coconut Grove')).toBe('coconut grove');
  });
});

describe('local calendar days', () => {
  it('formats and offsets days without drifting across month ends', () => {
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});
