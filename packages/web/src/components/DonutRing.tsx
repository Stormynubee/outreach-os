import type { ReactElement } from 'react';

import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';

export interface DonutRingProps {
  /** Completed count (e.g. tasks done). */
  value: number | null | undefined;
  /** Total count (e.g. tasks done + open). */
  max: number | null | undefined;
  /** Small word under the percentage inside the ring. */
  label?: string;
  /** "n / m" style caption rendered under the ring. */
  caption?: string;
  size?: number;
  className?: string;
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Hand-written SVG donut: lime arc, big percentage in the middle, n / m underneath. */
export function DonutRing({
  value,
  max,
  label,
  caption,
  size = 132,
  className,
}: DonutRingProps): ReactElement {
  const total = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 0;
  const done = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const dash = (pct / 100) * CIRCUMFERENCE;

  return (
    <div className={cx('flex flex-col items-center', className)}>
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${pct}% ${label ?? 'complete'} — ${formatNumber(done)} of ${formatNumber(total)}`}
      >
        <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke="var(--color-lime-soft)"
            strokeWidth="11"
          />
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke="var(--color-lime)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            aria-hidden="true"
            className="font-extrabold tabular-nums text-ink"
            style={{ fontSize: Math.max(18, Math.round(size * 0.26)) }}
          >
            {pct}%
          </span>
          {label ? (
            <span aria-hidden="true" className="text-[11px] font-bold text-muted">
              {label}
            </span>
          ) : null}
        </div>
      </div>
      {caption ? (
        <p className="mt-2 text-[12px] font-bold tabular-nums text-muted">{caption}</p>
      ) : null}
    </div>
  );
}
