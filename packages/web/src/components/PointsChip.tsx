import type { ReactElement } from 'react';

import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { IconBolt } from './icons';

export interface PointsChipProps {
  points: number | null | undefined;
  label?: string;
  className?: string;
}

/** Small white pill with a lime lightning glyph and the points total. */
export function PointsChip({ points, label = 'points', className }: PointsChipProps): ReactElement {
  const value = typeof points === 'number' && Number.isFinite(points) ? points : null;

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill bg-card px-3 py-2 shadow-card',
        className,
      )}
    >
      <span className="grid h-5 w-5 place-items-center rounded-pill bg-lime text-ink" aria-hidden="true">
        <IconBolt className="h-3.5 w-3.5" />
      </span>
      <span className="text-[13px] font-extrabold tabular-nums text-ink">
        {value === null ? '—' : formatNumber(value)}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
