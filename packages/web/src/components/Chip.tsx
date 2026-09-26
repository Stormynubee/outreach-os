import type { ReactElement, ReactNode } from 'react';

import { cx } from '../lib/cx';

export interface ChipProps {
  children: ReactNode;
  /** Lime when selected, grey-100 when not. */
  selected?: boolean;
  onClick?: () => void;
  title?: string;
  count?: number | string | null;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}

export function Chip({
  children,
  selected = false,
  onClick,
  title,
  count,
  disabled = false,
  className,
  type = 'button',
}: ChipProps): ReactElement {
  const classes = cx(
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 py-2 text-[13px] font-bold transition-colors',
    selected ? 'bg-lime text-ink' : 'bg-ink/[0.055] text-ink/70',
    onClick && !disabled && (selected ? 'hover:bg-lime/80' : 'hover:bg-ink/10'),
    disabled && 'cursor-not-allowed opacity-45',
    className,
  );

  const content = (
    <>
      {children}
      {count !== undefined && count !== null ? (
        <span
          className={cx(
            'rounded-pill px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums',
            selected ? 'bg-ink/10 text-ink' : 'bg-white text-muted',
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );

  if (!onClick) {
    return (
      <span className={classes} title={title}>
        {content}
      </span>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={selected}
      className={classes}
    >
      {content}
    </button>
  );
}
