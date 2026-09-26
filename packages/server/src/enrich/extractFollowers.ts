import type { FollowersState, SocialPlatform } from '@outreach/shared';
import { parseHumanNumber } from '../lib/humanize.ts';

export interface FollowerParse {
  followers: number | null;
  state: FollowersState;
  reason: string | null;
  hasVideo: boolean;
}

/**
 * Which platforms are answerable from a server at all.
 *
 * LinkedIn's terms forbid automated collection and it serves a hard bot wall;
 * X/Twitter is login-walled and its one public endpoint is being retired. We do
 * not attempt those and say so plainly rather than recording a fake number.
 */
export const PLATFORM_POLICY: Record<SocialPlatform, { attempt: boolean; reason: string | null }> = {
  youtube: { attempt: true, reason: null },
  tiktok: { attempt: true, reason: null },
  facebook: { attempt: true, reason: null },
  instagram: { attempt: true, reason: null },
  twitter: { attempt: false, reason: 'platform_requires_auth' },
  linkedin: { attempt: false, reason: 'platform_tos_blocked' },
  pinterest: { attempt: false, reason: 'unsupported' },
  threads: { attempt: false, reason: 'unsupported' },
  telegram: { attempt: false, reason: 'unsupported' },
  whatsapp: { attempt: false, reason: 'unsupported' },
  linkinbio: { attempt: false, reason: 'unsupported' },
  other: { attempt: false, reason: 'unsupported' },
};

const LOGIN_WALL =
  /(log in|login|sign in|sign up|you must log in|log into facebook|see more of|content isn't available|page isn't available)/i;

function fromMetaDescription(html: string, word: 'followers' | 'likes'): number | null {
  const re = new RegExp(`([\\d.,]+\\s*[KMB]?)\\s*${word}`, 'i');
  const og = /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og?.[1]) {
    const m = re.exec(og[1]);
    if (m?.[1]) {
      const parsed = parseHumanNumber(m[1]);
      if (parsed !== null) return parsed;
    }
  }
  const meta = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (meta?.[1]) {
    const m = re.exec(meta[1]);
    if (m?.[1]) {
      const parsed = parseHumanNumber(m[1]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

/** Best-effort, per-platform. Every branch reports why it failed rather than guessing. */
export function parseFollowers(platform: SocialPlatform, html: string): FollowerParse {
  const none = (state: FollowersState, reason: string | null, hasVideo = false): FollowerParse => ({
    followers: null,
    state,
    reason,
    hasVideo,
  });

  switch (platform) {
    case 'youtube': {
      const patterns = [
        /"subscriberCountText":\{"simpleText":"([^"]+)"/,
        /"subscriberCountText":\{[^}]*"label":"([^"]+)"/,
        /"subscriberCountText":\{"content":"([^"]+)"/,
        /"subscribers":"([\d.,KMB]+)"/i,
      ];
      for (const re of patterns) {
        const m = re.exec(html);
        if (m?.[1]) {
          const value = parseHumanNumber(m[1].replace(/subscribers?/i, ''));
          if (value !== null) {
            const hasVideo = /"videoId"|"videosCountText"|"richMetadata"/.test(html);
            return { followers: value, state: 'known', reason: null, hasVideo };
          }
        }
      }
      const itemprop = /itemprop="interactionCount"[^>]*content="(\d+)"/i.exec(html);
      if (itemprop?.[1]) {
        return { followers: Number(itemprop[1]), state: 'known', reason: null, hasVideo: false };
      }
      if (LOGIN_WALL.test(html) && html.length < 20_000) return none('blocked', 'blocked_by_waf');
      return none('unknown', 'no_count_in_markup');
    }

    case 'tiktok': {
      const m = /"followerCount":(\d+)/.exec(html) ?? /"followers?":(\d+)/.exec(html);
      if (m?.[1]) {
        const hasVideo = /"videoCount":\s*([1-9]\d*)/.test(html) || /"itemListElement"/.test(html);
        return { followers: Number(m[1]), state: 'known', reason: null, hasVideo };
      }
      if (/(verify|captcha|unusual traffic|blocked)/i.test(html) && html.length < 20_000) {
        return none('blocked', 'blocked_by_waf');
      }
      if (LOGIN_WALL.test(html) && html.length < 30_000) return none('blocked', 'platform_requires_auth');
      return none('unknown', 'no_count_in_markup');
    }

    case 'facebook': {
      const m = /"follower_count":(\d+)/.exec(html) ?? /"followerCount":(\d+)/.exec(html);
      if (m?.[1]) return { followers: Number(m[1]), state: 'known', reason: null, hasVideo: false };
      const fromMeta = fromMetaDescription(html, 'followers') ?? fromMetaDescription(html, 'likes');
      if (fromMeta !== null) return { followers: fromMeta, state: 'known', reason: null, hasVideo: false };
      if (LOGIN_WALL.test(html) && html.length < 60_000) return none('blocked', 'platform_requires_auth');
      return none('unknown', 'no_count_in_markup');
    }

    case 'instagram': {
      const m =
        /"edge_followed_by":\{"count":(\d+)\}/.exec(html) ??
        /"follower_count":(\d+)/.exec(html);
      if (m?.[1]) return { followers: Number(m[1]), state: 'known', reason: null, hasVideo: false };
      const fromMeta = fromMetaDescription(html, 'followers');
      if (fromMeta !== null) return { followers: fromMeta, state: 'known', reason: null, hasVideo: false };
      const hasVideo = /"video_view_count"|"is_video":true/.test(html);
      if (LOGIN_WALL.test(html)) return none('blocked', 'platform_requires_auth', hasVideo);
      return none('unknown', 'no_count_in_markup', hasVideo);
    }

    default: {
      const policy = PLATFORM_POLICY[platform];
      return none('unsupported', policy.reason ?? 'unsupported');
    }
  }
}

export function profileUrlFor(platform: SocialPlatform, url: string): string | null {
  if (platform === 'instagram' || platform === 'threads') return url;
  if (platform === 'facebook') {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.split('/').filter(Boolean).length === 1) {
        return `${parsed.origin}${parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`}about`;
      }
      return url;
    } catch {
      return null;
    }
  }
  return url;
}
