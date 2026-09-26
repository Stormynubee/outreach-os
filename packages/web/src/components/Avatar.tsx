import type { ReactElement } from 'react';

import { cx } from '../lib/cx';

export interface AvatarProps {
  name?: string | null;
  /** Lime dot = the pipeline is live / the day's work is in flight. */
  online?: boolean;
  size?: number;
  className?: string;
}

function initials(name: string | null | undefined): string {
  if (!name) return '··';
  const words = name.trim().split(/\s+/).slice(0, 2);
  if (words.length === 0) return '··';
  return words.map((word) => word.charAt(0).toUpperCase()).join('');
}

export function Avatar({ name, online = true, size = 44, className }: AvatarProps): ReactElement {
  return (
    <span className={cx('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-pill bg-ink/[0.06] font-extrabold text-ink"
        style={{ fontSize: Math.max(11, Math.round(size * 0.34)) }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {online ? (
        <span
          aria-hidden="true"
          className="absolute right-0 bottom-0 h-3.5 w-3.5 rounded-pill border-2 border-page bg-lime"
        />
      ) : null}
      <span className="sr-only">{name ? `${name}, signed in` : 'Signed in'}</span>
    </span>
  );
}
