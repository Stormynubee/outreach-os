import type { ReactElement } from 'react';

import { NO_SITE_STATES, SITE_STATE_LABELS, type SiteState } from '@outreach/shared';

import { cx } from '../lib/cx';

export interface StatusPillProps {
  state: SiteState | null | undefined;
  className?: string;
  size?: 'sm' | 'md';
}

/** States that mean "no working website" — the core sales signal — read as lime. */
const WARM_STATES: SiteState[] = [
  'live_weak',
  'live_insecure',
  'server_error',
  'timeout',
  'too_many_redirects',
  'blocked',
];

function toneFor(state: SiteState | null | undefined): string {
  if (!state) return 'bg-ink/[0.05] text-muted';
  if (NO_SITE_STATES.includes(state)) return 'bg-lime text-ink';
  if (state === 'live') return 'bg-sage/70 text-ink';
  if (WARM_STATES.includes(state)) return 'bg-teal/45 text-ink';
  return 'bg-ink/[0.05] text-muted';
}

export function StatusPill({ state, className, size = 'md' }: StatusPillProps): ReactElement {
  const label = state ? SITE_STATE_LABELS[state] : 'Unknown';
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-pill font-bold',
        size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]',
        toneFor(state),
        className,
      )}
    >
      {label}
    </span>
  );
}
