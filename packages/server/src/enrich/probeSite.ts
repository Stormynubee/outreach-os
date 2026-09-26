import type { Db } from '../db/client.ts';
import type { BusinessRepo } from '../db/businesses.ts';
import type { JobQueue } from '../db/jobs.ts';
import type { HttpClient } from '../lib/http.ts';
import { classifySite, type SiteSignals } from './classifySite.ts';
import { SCORE_VERSION } from '@outreach/shared';

export interface ProbeDeps {
  db: Db;
  repo: BusinessRepo;
  jobs: JobQueue;
  http: HttpClient;
}

export interface StageOutcome {
  ok: boolean;
  stage: string;
  detail: string;
  retryable: boolean;
}

const MAX_REDIRECT_HOPS = 5;

/**
 * One streaming GET with manual redirect handling. Automatic redirects would
 * destroy the parked-domain signal, because "302 to forsale.godaddy.com" is
 * itself the evidence we are looking for.
 */
export function createSiteProbe(deps: ProbeDeps) {
  const { db, repo, jobs, http } = deps;

  const setStage = db.prepare(`
    UPDATE business SET enrichment_stage = @stage, enrichment_state = @state,
      last_error_stage = @error_stage, last_error = @error, next_retry_at = @retry_at,
      enriched_at = @now, updated_at = @now
    WHERE id = @id`);

  const setSite = db.prepare(`
    UPDATE business SET
      site_state = @site_state, http_status = @http_status, final_url = @final_url,
      has_ssl = @has_ssl, platform = @platform, parking_evidence = @parking_evidence,
      site_title = @site_title, has_video = @has_video, updated_at = @now
    WHERE id = @id`);

  return async function probeSite(businessId: number): Promise<StageOutcome> {
    const now = Date.now();
    const row = repo.get(businessId);
    if (!row) return { ok: false, stage: 'probe', detail: 'business not found', retryable: false };

    const websiteUrl = row.website_url as string | null;
    const socialCount = repo.socialsFor(businessId).length;

    const finish = (outcome: StageOutcome, nextStage: string | null) => {
      setStage.run({
        id: businessId,
        stage: outcome.ok ? (nextStage ?? 'probe') : 'probe',
        state: outcome.ok ? 'done' : outcome.retryable ? 'retry' : 'failed',
        error_stage: outcome.ok ? null : outcome.stage,
        error: outcome.ok ? null : outcome.detail,
        retry_at: outcome.ok || !outcome.retryable ? null : now + 15 * 60_000,
        now,
      });
      repo.refreshDenorm(businessId, now);
      repo.rescore(businessId, now);
      return outcome;
    };

    // No website at all: nothing to probe. The state already landed at discovery
    // time (no_tag / social_only), so move straight on to what we can still check.
    if (!websiteUrl) {
      setSite.run({
        id: businessId,
        site_state: socialCount > 0 ? 'social_only' : 'no_tag',
        http_status: null,
        final_url: null,
        has_ssl: 0,
        platform: null,
        parking_evidence: JSON.stringify([]),
        site_title: null,
        has_video: 0,
        now,
      });
      // Socials carried over from OSM tags still deserve a follower check; without
      // this, the most valuable leads (social-only) would never get measured.
      for (const social of repo.socialsFor(businessId)) {
        jobs.enqueue({
          type: 'check_social',
          payload: { businessId, platform: social.platform, handle: social.handle ?? social.url },
          dedupeKey: `social:${businessId}:${social.platform}:${social.handle ?? social.url}`,
        });
      }
      return finish({ ok: true, stage: 'probe', detail: 'no website to probe', retryable: false }, 'contacts');
    }

    let currentUrl = websiteUrl;
    const redirectHosts: string[] = [];
    let redirects = 0;
    let result = await http.fetchPage(currentUrl, { kind: 'page' });
    let hasSsl = currentUrl.startsWith('https://');

    while (!result.ok && result.status !== null && result.status >= 300 && result.status < 400 && redirects < MAX_REDIRECT_HOPS) {
      const next = result.redirects[1];
      if (!next) break;
      redirects++;
      try {
        redirectHosts.push(new URL(next).hostname.toLowerCase().replace(/^www\./, ''));
      } catch {
        break;
      }
      currentUrl = next;
      if (currentUrl.startsWith('https://')) hasSsl = true;
      result = await http.fetchPage(currentUrl, { kind: 'page' });
    }

    if (redirects >= MAX_REDIRECT_HOPS) {
      setSite.run({
        id: businessId,
        site_state: 'too_many_redirects',
        http_status: result.status,
        final_url: currentUrl,
        has_ssl: hasSsl ? 1 : 0,
        platform: null,
        parking_evidence: JSON.stringify([`more than ${MAX_REDIRECT_HOPS} redirects`]),
        site_title: null,
        has_video: 0,
        now,
      });
      return finish({ ok: true, stage: 'probe', detail: 'redirect loop', retryable: false }, null);
    }

    const signals: SiteSignals = {
      status: result.status,
      finalUrl: result.finalUrl || currentUrl,
      contentType: result.contentType,
      serverHeader: result.serverHeader,
      redirectHosts,
      body: result.body,
      errorKind: result.errorKind,
      robotsBlocked: result.robotsBlocked,
      hasSsl,
    };

    const verdict = classifySite(signals);

    setSite.run({
      id: businessId,
      site_state: verdict.siteState,
      http_status: result.status,
      final_url: result.finalUrl || currentUrl,
      has_ssl: hasSsl ? 1 : 0,
      platform: verdict.platform,
      parking_evidence: JSON.stringify(verdict.parkingEvidence),
      site_title: verdict.title,
      has_video: verdict.hasVideo ? 1 : 0,
      now,
    });

    const scrapeable: string[] = ['live', 'live_weak', 'live_insecure'];
    const nextStage = scrapeable.includes(verdict.siteState) ? 'scrape' : 'socials';

    if (verdict.siteState === 'server_error' || verdict.siteState === 'timeout') {
      return finish(
        { ok: false, stage: 'probe', detail: `site returned ${verdict.siteState}`, retryable: true },
        null,
      );
    }

    return finish(
      { ok: true, stage: 'probe', detail: verdict.siteState, retryable: false },
      nextStage,
    );
  };
}
