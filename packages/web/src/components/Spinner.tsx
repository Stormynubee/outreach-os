import type { ReactElement } from 'react';

import { cx } from '../lib/cx';

export interface SpinnerProps {
  className?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

export function Spinner({ className, label = 'Loading', size = 'md' }: SpinnerProps): ReactElement {
  return (
    <span
      role="status"
      aria-label={label}
      className={cx(
        'inline-block animate-spin rounded-pill border-ink/15 border-t-ink align-[-0.15em]',
        SIZES[size],
        className,
      )}
    />
  );
}
