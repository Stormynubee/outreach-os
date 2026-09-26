import type { ReactElement, ReactNode } from 'react';

import { cx } from '../lib/cx';
import { formatNumber, percentOf } from '../lib/format';

export interface ProgressBarProps {
  value: number | null | undefined;
  max: number | null | undefined;
  label?: ReactNode;
  caption?: ReactNode;
  tone?: 'lime' | 'ink' | 'white';
  animated?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max,
  label,
  caption,
  tone = 'lime',
  animated = false,
  className,
}: ProgressBarProps): ReactElement {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeMax = typeof max === 'number' && Number.isFinite(max) ? max : 0;
  const ratio = percentOf(safeValue, safeMax);
  const pct = Math.round(ratio * 100);

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px] font-bold">
        <span className="truncate text-muted">{label}</span>
        <span className="tabular-nums text-ink">
          {formatNumber(safeValue)} / {formatNumber(safeMax)}
        </span>
      </div>
      <div
        className={cx('h-2.5 w-full overflow-hidden rounded-pill', tone === 'white' ? 'bg-white/20' : 'bg-ink/[0.07]')}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === 'string' ? label : 'Progress'}
      >
        <div
          className={cx(
            'h-full rounded-pill transition-[width] duration-500 ease-soft',
            tone === 'lime' && 'bg-lime',
            tone === 'ink' && 'bg-ink',
            tone === 'white' && 'bg-white',
          )}
          style={{ width: `${pct}%` }}
        >
          {animated ? <div className="shimmer h-full w-full" /> : null}
        </div>
      </div>
      {caption ? <p className="mt-1.5 text-[11px] font-semibold text-muted">{caption}</p> : null}
    </div>
  );
}
