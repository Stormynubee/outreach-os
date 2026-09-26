import type { Db } from '../db/client.ts';
import type { BusinessRepo } from '../db/businesses.ts';
import type { HttpClient } from '../lib/http.ts';
import type { SocialPlatform } from '@outreach/shared';
import { PLATFORM_POLICY, parseFollowers, profileUrlFor } from './extractFollowers.ts';
import type { StageOutcome } from './probeSite.ts';

export interface SocialDeps {
  db: Db;
  repo: BusinessRepo;
  http: HttpClient;
}

export function createSocialChecker(deps: SocialDeps) {
  const { db, repo, http } = deps;

  const findSocial = db.prepare(`
    SELECT * FROM social_account
    WHERE business_id = ? AND platform = ? AND handle_normalized = ?`);
  const updateSocial = db.prepare(`
    UPDATE social_account SET
      followers = @followers, followers_state = @followers_state, followers_reason = @followers_reason,
      followers_source = @followers_source, has_video = @has_video,
      last_checked_at = @now, check_status = @check_status, updated_at = @now
    WHERE id = @id`);
  const setStage = db.prepare(`
    UPDATE business SET enrichment_stage = @stage, enrichment_state = @state,
      last_error_stage = @error_stage, last_error = @error, next_retry_at = @retry_at,
      enriched_at = @now, updated_at = @now
    WHERE id = @id`);
  const remainingUnchecked = db.prepare(
    'SELECT COUNT(*) AS n FROM social_account WHERE business_id = ? AND last_checked_at IS NULL',
  );

  return async function checkSocial(
    businessId: number,
    platform: SocialPlatform,
    handleNormalized: string,
  ): Promise<StageOutcome> {
    const now = Date.now();
    const social = findSocial.get(businessId, platform, handleNormalized) as
      | {
          id: number;
          url: string;
          manual_override: number | null;
          followers: number | null;
          followers_state: string;
        }
      | undefined;

    if (!social) return { ok: false, stage: 'socials', detail: 'social row not found', retryable: false };

    // A human-entered value is never overwritten by a scrape.
    if (social.manual_override !== null) {
      return { ok: true, stage: 'socials', detail: 'manual override kept', retryable: false };
    }

    const policy = PLATFORM_POLICY[platform];
    if (!policy.attempt) {
      updateSocial.run({
        id: social.id,
        followers: null,
        followers_state: policy.reason === 'platform_tos_blocked' ? 'blocked' : 'unsupported',
        followers_reason: policy.reason,
        followers_source: 'policy',
        has_video: 0,
        now,
        check_status: 'skipped',
      });
      repo.refreshDenorm(businessId, now);
      repo.rescore(businessId, now);
      return { ok: true, stage: 'socials', detail: `not attempted (${policy.reason})`, retryable: false };
    }

    const target = profileUrlFor(platform, social.url) ?? social.url;
    const res = await http.fetchPage(target, { kind: 'social' });

    if (res.robotsBlocked) {
      updateSocial.run({
        id: social.id, followers: null, followers_state: 'unknown',
        followers_reason: 'robots_disallowed', followers_source: 'robots',
        has_video: 0, now, check_status: 'robots',
      });
    } else if (res.status === 429) {
      updateSocial.run({
        id: social.id, followers: null, followers_state: 'rate_limited',
        followers_reason: 'rate_limited', followers_source: 'http',
        has_video: 0, now, check_status: '429',
      });
    } else if (!res.ok && !res.body) {
      const state = res.status === 401 || res.status === 403 ? 'blocked' : 'unknown';
      updateSocial.run({
        id: social.id, followers: null, followers_state: state,
        followers_reason: res.status === 401 || res.status === 403 ? 'blocked_by_waf' : 'platform_requires_auth',
        followers_source: 'http', has_video: 0, now, check_status: String(res.status ?? res.errorKind ?? 'error'),
      });
    } else {
      const parsed = parseFollowers(platform, res.body ?? '');
      updateSocial.run({
        id: social.id,
        followers: parsed.followers,
        followers_state: parsed.state,
        followers_reason: parsed.reason,
        followers_source: parsed.state === 'known' ? 'profile_html' : null,
        has_video: parsed.hasVideo ? 1 : 0,
        now,
        check_status: 'ok',
      });
    }

    const pending = (remainingUnchecked.get(businessId) as { n: number }).n;
    setStage.run({
      id: businessId,
      stage: pending === 0 ? 'socials' : 'contacts',
      state: 'done',
      error_stage: null,
      error: null,
      retry_at: null,
      now,
    });
    repo.refreshDenorm(businessId, now);
    repo.rescore(businessId, now);

    return { ok: true, stage: 'socials', detail: platform, retryable: false };
  };
}
