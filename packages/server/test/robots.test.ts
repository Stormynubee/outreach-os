import { describe, expect, it } from 'vitest';
import { evaluate, parseRobots, parseSitemapUrls, selectGroups } from '../src/lib/robots.ts';

const TOKEN = 'leadoutreachbot';

const evalFor = (text: string, path: string) => evaluate(parseRobots(text), TOKEN, path);

describe('robots.txt parsing and evaluation', () => {
  it('allows everything when there are no rules', () => {
    expect(evalFor('', '/').allowed).toBe(true);
    expect(evalFor('# just a comment', '/contact').allowed).toBe(true);
  });

  it('treats an empty Disallow as allow-all', () => {
    const text = 'User-agent: *\nDisallow:';
    expect(evalFor(text, '/anything').allowed).toBe(true);
  });

  it('honours Disallow: /', () => {
    expect(evalFor('User-agent: *\nDisallow: /', '/').allowed).toBe(false);
    expect(evalFor('User-agent: *\nDisallow: /', '/contact').allowed).toBe(false);
  });

  it("prefers the most specific group over '*'", () => {
    const text = `
User-agent: *
Disallow: /

User-agent: LeadOutreachBot
Disallow: /private
`;
    expect(evalFor(text, '/').allowed).toBe(true);
    expect(evalFor(text, '/private/x').allowed).toBe(false);
    expect(selectGroups(parseRobots(text), TOKEN).map((g) => g.agents)).toEqual([['leadoutreachbot']]);
  });

  it('uses the longest matching path, and lets Allow win a tie', () => {
    const text = `
User-agent: *
Disallow: /shop
Allow: /shop/public
`;
    expect(evalFor(text, '/shop/private').allowed).toBe(false);
    expect(evalFor(text, '/shop/public/thing').allowed).toBe(true);

    const tie = 'User-agent: *\nDisallow: /x\nAllow: /x';
    expect(evalFor(tie, '/x').allowed).toBe(true);
  });

  it('supports * wildcards and $ anchors', () => {
    expect(evalFor('User-agent: *\nDisallow: /*.pdf$', '/docs/a.pdf').allowed).toBe(false);
    expect(evalFor('User-agent: *\nDisallow: /*.pdf$', '/docs/a.pdf?x=1').allowed).toBe(true);
    expect(evalFor('User-agent: *\nDisallow: /tmp/*/cache', '/tmp/a/cache').allowed).toBe(false);
  });

  it('reads Crawl-delay into milliseconds', () => {
    const text = 'User-agent: *\nCrawl-delay: 2.5\nDisallow: /a';
    expect(evalFor(text, '/b').crawlDelayMs).toBe(2500);
  });

  it('collects Sitemap entries regardless of group', () => {
    const text = 'Sitemap: https://example.com/sitemap.xml\nUser-agent: *\nDisallow: /a';
    expect(evalFor(text, '/b').sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('combines rules from every matching group', () => {
    const text = `
User-agent: *
Disallow: /a

User-agent: someoneelse
Disallow: /b

User-agent: *
Disallow: /c
`;
    // RFC 9309: multiple '*' groups merge, so both /a and /c apply to us.
    expect(evalFor(text, '/a').allowed).toBe(false);
    expect(evalFor(text, '/c').allowed).toBe(false);
    expect(evalFor(text, '/b').allowed).toBe(true);
  });
});

describe('sitemap parsing', () => {
  it('extracts loc entries from a urlset and decodes entities', () => {
    const xml = `<urlset><url><loc>https://a.test/contact</loc></url>
      <url><loc>https://a.test/about?a=1&amp;b=2</loc></url></urlset>`;
    expect(parseSitemapUrls(xml)).toEqual(['https://a.test/contact', 'https://a.test/about?a=1&b=2']);
  });

  it('reads a sitemap index too', () => {
    const xml = `<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemapUrls(xml)).toEqual(['https://a.test/s1.xml']);
  });
});
