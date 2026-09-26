import type { ReactElement } from 'react';

import { cx } from '../lib/cx';

export interface ScoreRingProps {
  score: number | null | undefined;
  size?: number;
  caption?: string;
  className?: string;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function bandColor(score: number): string {
  if (score >= 70) return 'var(--color-lime)';
  if (score >= 45) return 'var(--color-teal)';
  return 'var(--color-lime-soft)';
}

/** Hand-written SVG score dial — no charting library. */
export function ScoreRing({ score, size = 64, caption, className }: ScoreRingProps): ReactElement {
  const value =
    typeof score === 'number' && Number.isFinite(score)
      ? Math.max(0, Math.min(100, Math.round(score)))
      : null;
  const dash = value === null ? 0 : (value / 100) * CIRCUMFERENCE;

  return (
    <div
      className={cx('inline-flex flex-col items-center', className)}
      role="img"
      aria-label={value === null ? 'Score not available' : `Lead score ${value} out of 100`}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="var(--color-lime-soft)"
            strokeWidth="9"
            opacity="0.7"
          />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={value === null ? 'var(--color-lime-soft)' : bandColor(value)}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center font-extrabold tabular-nums text-ink"
          style={{ fontSize: Math.max(11, Math.round(size * 0.3)) }}
        >
          {value ?? '—'}
        </span>
      </div>
      {caption ? (
        <span className="mt-1 text-[10px] font-bold tracking-[0.06em] text-muted uppercase">{caption}</span>
      ) : null}
    </div>
  );
}
