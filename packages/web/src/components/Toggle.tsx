import type { ReactElement, ReactNode } from 'react';

import { cx } from '../lib/cx';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label — also the switch's accessible name. */
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  /** Hide the visible label but keep it for assistive tech. */
  labelHidden?: boolean;
}

/** iOS-style switch. Black when on. Implemented as a real button with role="switch". */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  busy = false,
  className,
  labelHidden = false,
}: ToggleProps): ReactElement {
  return (
    <div className={cx('flex items-center justify-between gap-4', className)}>
      <span className={cx('min-w-0', labelHidden && 'sr-only')}>
        <span className="block text-[14px] font-bold text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] font-medium text-muted">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled || busy}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-7 w-12 shrink-0 rounded-pill transition-colors duration-200',
          checked ? 'bg-ink' : 'bg-ink/15',
          (disabled || busy) && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'absolute top-[3px] left-[3px] h-[22px] w-[22px] rounded-pill bg-white shadow-sm transition-transform duration-200',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}
