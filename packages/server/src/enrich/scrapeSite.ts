import * as cheerio from 'cheerio';
import type { Db } from '../db/client.ts';
import type { BusinessRepo } from '../db/businesses.ts';
import type { JobQueue } from '../db/jobs.ts';
import type { HttpClient } from '../lib/http.ts';
import type { Settings } from '../settings.ts';
import { extractEmails } from './extractEmail.ts';
import { extractPhones } from './extractPhone.ts';
import { extractSocials, guessContactUrls, rankContactLinks } from './extractSocial.ts';
import type { StageOutcome } from './probeSite.ts';
import { parseSitemapUrls } from '../lib/robots.ts';

export interface ScrapeDeps {
  db: Db;
  repo: BusinessRepo;
  jobs: JobQueue;
  http: HttpClient;
  settings: () => Settings;
}

const SCRAPEABLE = ['live', 'live_weak', 'live_insecure'];

export function createSiteScraper(deps: ScrapeDeps) {
  const { db, repo, jobs, http } = deps;

  const setStage = db.prepare(`
    UPDATE business SET enrichment_stage = @stage, enrichment_state = @state,
      last_error_stage = @error_stage, last_error = @error, next_retry_at = @retry_at,
      enriched_at = @now, updated_at = @now
    WHERE id = @id`);
  const setEmailState = db.prepare('UPDATE business SET email_state = ?, updated_at = ? WHERE id = ?');

  return async function scrapeSite(businessId: number): Promise<StageOutcome> {
    const now = Date.now();
    const settings = deps.settings();
    const row = repo.get(businessId);
    if (!row) return { ok: false, stage: 'scrape', detail: 'business not found', retryable: false };

    // Preconditions are re-checked at execution time: the queue is persistent and
    // the probe result may have changed since this job was enqueued.
    const siteState = row.site_state as string;
    const websiteUrl = (row.final_url as string | null) ?? (row.website_url as string | null);
    if (!websiteUrl || !SCRAPEABLE.includes(siteState)) {
      setStage.run({
        id: businessId, stage: 'contacts', state: 'skipped', error_stage: null, error: null,
        retry_at: null, now,
      });
      return { ok: true, stage: 'scrape', detail: `skipped (${siteState})`, retryable: false };
    }

    const country = (row.country_code as string | null) ?? null;
    const budget = Math.max(1, settings.maxPagesPerSite - 1);
    const visited = new Set<string>();
    let emailCount = 0;
    let phoneCount = 0;
    let socialCount = 0;

    const parsePage = async (url: string): Promise<void> => {
      if (visited.has(url) || visited.size > budget) return;
      visited.add(url);
      const res = await http.fetchPage(url, { kind: visited.size === 1 ? 'page' : 'contact' });
      if (!res.ok || !res.body) return;
      if (res.contentType && !/text\/html|application\/xhtml/i.test(res.contentType)) return;

      const $ = cheerio.load(res.body);
      const pageUrl = res.finalUrl || url;

      for (const email of extractEmails($, pageUrl)) {
        repo.addEmail(businessId, email, now);
        emailCount++;
      }
      for (const phone of extractPhones($, pageUrl, country)) {
        repo.addPhone(businessId, phone, now);
        if (!phone.rejectReason) phoneCount++;
      }
      for (const social of extractSocials($)) {
        repo.addSocial(businessId, social, now);
        jobs.enqueue({
          type: 'check_social',
          payload: { businessId, platform: social.platform, handle: social.handle ?? social.url },
          dedupeKey: `social:${businessId}:${social.platform}:${social.handle ?? social.url}`,
        });
        socialCount++;
      }
    };

    await parsePage(websiteUrl);

    // Early exit once we have enough — the single biggest politeness win available.
    const satisfied = () => emailCount > 0 && phoneCount > 0 && socialCount >= 2;
    let followedLinks = 0;

    if (!satisfied()) {
      const res = await http.fetchPage(websiteUrl, { kind: 'page' });
      if (res.ok && res.body) {
        const $ = cheerio.load(res.body);
        for (const candidate of rankContactLinks($, res.finalUrl || websiteUrl, budget)) {
          if (satisfied() || followedLinks >= budget) break;
          followedLinks++;
          await parsePage(candidate.href);
        }
      }
    }

    if (!satisfied()) {
      for (const guess of guessContactUrls(websiteUrl)) {
        if (satisfied() || followedLinks >= budget) break;
        followedLinks++;
        await parsePage(guess);
      }
    }

    // Sitemap is the last resort, and only when robots.txt advertised one.
    if (!satisfied()) {
      const robots = await http.robotsFor(new URL(websiteUrl).hostname.replace(/^www\./, ''));
      const sitemap = robots.decision('/').sitemaps[0];
      if (sitemap) {
        const res = await http.fetchPage(sitemap, { kind: 'other' });
        if (res.ok && res.body) {
          const wanted = parseSitemapUrls(res.body, 200).filter((u) =>
            /contact|about|impressum|kontakt|contacto|contatti|iletisim|reach|team/i.test(u),
          );
          for (const url of wanted.slice(0, 2)) {
            if (satisfied()) break;
            await parsePage(url);
          }
        }
      }
    }

    setEmailState.run(emailCount > 0 ? 'found' : 'none_found', now, businessId);
    setStage.run({
      id: businessId, stage: 'contacts', state: 'done', error_stage: null, error: null,
      retry_at: null, now,
    });
    repo.refreshDenorm(businessId, now);
    repo.rescore(businessId, now);

    return {
      ok: true,
      stage: 'scrape',
      detail: `scanned ${visited.size} page(s): ${emailCount} email(s), ${phoneCount} phone(s), ${socialCount} social(s)`,
      retryable: false,
    };
  };
}
