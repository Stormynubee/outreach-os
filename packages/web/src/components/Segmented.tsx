import type { ReactElement } from 'react';

import { cx } from '../lib/cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (next: T) => void;
  options: readonly SegmentedOption<T>[];
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
}

/** Two-or-more option switch (This Week / Last Week, pipeline stages …). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  size = 'md',
}: SegmentedProps<T>): ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx('inline-flex items-center gap-1 rounded-pill bg-ink/[0.06] p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(option.value)}
            className={cx(
              'rounded-pill font-bold transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-[12px]',
              active ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
