import type { ReactElement } from 'react';

import { FOLLOWERS_REASONS, SOCIAL_PLATFORMS, type FollowersState, type SocialPlatform } from '@outreach/shared';

import { oneOf } from '../lib/api';
import { cx } from '../lib/cx';
import { formatCompact } from '../lib/format';
import { SOCIAL_GLYPHS, SOCIAL_LABELS } from '../lib/labels';

export interface SocialBadgeProps {
  platform: SocialPlatform | string | null | undefined;
  followers?: number | null;
  followersState?: FollowersState | null;
  followersReason?: string | null;
  /** A hand-entered count always wins, and is badged as such. */
  manualOverride?: number | null;
  url?: string | null;
  /** Hide the muted explanation (keeps rows tight in list views). */
  showReason?: boolean;
  className?: string;
}

export function SocialBadge({
  platform,
  followers,
  followersState,
  followersReason,
  manualOverride,
  url,
  showReason = true,
  className,
}: SocialBadgeProps): ReactElement {
  const known = oneOf(SOCIAL_PLATFORMS, platform);
  const label = known ? SOCIAL_LABELS[known] : 'Social';
  const glyph = known ? SOCIAL_GLYPHS[known] : '··';

  const override = typeof manualOverride === 'number' && Number.isFinite(manualOverride) ? manualOverride : null;
  const scraped = typeof followers === 'number' && Number.isFinite(followers) ? followers : null;
  const count = override ?? scraped;

  const reasonKey = followersReason ?? followersState ?? null;
  const reason = reasonKey ? FOLLOWERS_REASONS[reasonKey] ?? null : null;

  const body = (
    <>
      <span
        aria-hidden="true"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-[7px] bg-ink text-[9px] font-extrabold tracking-tight text-white"
      >
        {glyph}
      </span>
      {count !== null ? (
        <span className="text-[12px] font-extrabold tabular-nums text-ink">{formatCompact(count)}</span>
      ) : (
        <span className="max-w-[180px] truncate text-[11px] font-semibold text-muted">
          {showReason ? reason ?? 'Follower count unknown' : 'unknown'}
        </span>
      )}
      {override !== null ? (
        <span className="rounded-pill bg-lime px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-ink uppercase">
          manual
        </span>
      ) : null}
    </>
  );

  const classes = cx(
    'inline-flex max-w-full items-center gap-2 rounded-pill bg-ink/[0.045] px-2.5 py-1.5',
    url && 'transition-colors hover:bg-ink/10',
    className,
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className={classes}
        aria-label={`${label} profile${count !== null ? `, ${count} followers` : ''}`}
      >
        {body}
      </a>
    );
  }

  return (
    <span className={classes} title={reason ?? label}>
      {body}
    </span>
  );
}
