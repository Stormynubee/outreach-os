import type { ReactElement, ReactNode } from 'react';

import { cx } from '../lib/cx';

export interface HeadlineProps {
  /** Line 1 — small, grey, regular weight. */
  label: string;
  /** Line 2 — very large, near-black, tight tracking. */
  value: ReactNode;
  /** Small raised count in parentheses, e.g. 13 ⁽⁵⁰⁾. */
  superscript?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}

/** The signature two-line stat header from the reference. */
export function Headline({
  label,
  value,
  superscript,
  size = 'lg',
  className,
}: HeadlineProps): ReactElement {
  const hasSup = superscript !== undefined && superscript !== null && superscript !== '';

  return (
    <div className={cx('min-w-0', className)}>
      <p className="text-[13px] font-medium tracking-[-0.01em] text-muted">{label}</p>
      {/*
        Not a <sup>: its default vertical-align lifts it clean out of the line box,
        which made the count collide with the label above. Everything is sized in em
        so the count scales with the fluid numeral instead of being a fixed 15px.
      */}
      <p
        className={cx(
          'flex items-start font-extrabold tabular-nums text-ink',
          size === 'lg' ? 'text-stat' : 'text-[34px] leading-[0.94] tracking-[-0.035em]',
        )}
      >
        <span className={size === 'lg' ? 'mt-[0.06em]' : undefined}>{value}</span>
        {hasSup ? (
          <span className="mt-[0.16em] ml-[0.22em] text-[0.32em] leading-none font-bold tracking-normal text-muted">
            ({superscript})
          </span>
        ) : null}
      </p>
    </div>
  );
}