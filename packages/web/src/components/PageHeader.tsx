import type { ReactElement, ReactNode } from 'react';

import { cx } from '../lib/cx';

export interface PageHeaderProps {
  /** Small grey line above the title, e.g. a section name. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary controls for the page, right-aligned on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/** Consistent page title block so every screen starts the same way. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps): ReactElement {
  return (
    <div
      className={cx(
        'flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[12px] font-bold uppercase tracking-[0.09em] text-muted">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1.5 text-display text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-[14px] font-medium text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}
