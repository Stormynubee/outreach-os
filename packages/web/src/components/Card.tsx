import type { ReactElement, ReactNode } from 'react';

import { cx } from '../lib/cx';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** `as` keeps the markup semantic without forcing a wrapper div everywhere. */
  as?: 'section' | 'article' | 'div' | 'li';
  padded?: boolean;
}

/** The chunky white rounded card that the whole app is built from. */
export function Card({ children, className, as = 'section', padded = true }: CardProps): ReactElement {
  const Tag = as;
  return (
    <Tag className={cx('rounded-card bg-card shadow-card', padded && 'p-5', className)}>{children}</Tag>
  );
}

export interface CardTitleProps {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardTitle({ children, hint, action, className }: CardTitleProps): ReactElement {
  return (
    <div className={cx('flex items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-[15px] font-extrabold tracking-[-0.02em] text-ink">{children}</h2>
        {hint ? <p className="mt-0.5 text-[12px] font-medium text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export interface StatRowProps {
  label: string;
  value: ReactNode;
  dot?: string;
  className?: string;
}

export function StatRow({ label, value, dot, className }: StatRowProps): ReactElement {
  return (
    <div className={cx('flex items-center justify-between gap-3', className)}>
      <span className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        {dot ? (
          <span className="h-2 w-2 rounded-pill" style={{ backgroundColor: dot }} aria-hidden="true" />
        ) : null}
        {label}
      </span>
      <span className="text-[14px] font-extrabold tabular-nums text-ink">{value}</span>
    </div>
  );
}
