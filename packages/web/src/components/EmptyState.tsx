import type { ReactElement, ReactNode } from 'react';

import { describeError } from '../lib/api';
import { cx } from '../lib/cx';
import { IconAlert, IconInfo, IconRefresh } from './icons';
import { Spinner } from './Spinner';

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'error';
  className?: string;
  /** Render without the white card chrome — for use inside a Card. */
  bare?: boolean;
}

/** Nothing to show yet — never a blank screen. */
export function EmptyState({
  title,
  body,
  icon,
  action,
  tone = 'default',
  className,
  bare = false,
}: EmptyStateProps): ReactElement {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-2 text-center',
        bare ? 'py-4' : 'rounded-card bg-card px-6 py-8 shadow-card',
        className,
      )}
    >
      <span
        className={cx(
          'grid h-11 w-11 place-items-center rounded-pill',
          tone === 'error' ? 'bg-ink text-lime' : 'bg-ink/[0.05] text-muted',
        )}
        aria-hidden="true"
      >
        {icon ?? <IconInfo className="h-5 w-5" />}
      </span>
      <h3 className="text-[15px] font-extrabold tracking-[-0.02em] text-ink">{title}</h3>
      {body ? <p className="max-w-[36ch] text-[13px] font-medium text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface LoadingStateProps {
  label?: string;
  rows?: number;
  className?: string;
  bare?: boolean;
}

export function LoadingState({
  label = 'Loading…',
  rows = 2,
  className,
  bare = false,
}: LoadingStateProps): ReactElement {
  return (
    <div
      className={cx(bare ? 'py-2' : 'rounded-card bg-card p-5 shadow-card', className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-[12px] font-bold text-muted">
        <Spinner size="sm" label={label} />
        {label}
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: Math.max(1, rows) }, (_, index) => (
          <div key={index} className="h-4 animate-pulse rounded-pill bg-ink/[0.06]" />
        ))}
      </div>
    </div>
  );
}

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
  bare?: boolean;
}

export function ErrorState({
  error,
  title = 'That did not load',
  onRetry,
  className,
  bare = false,
}: ErrorStateProps): ReactElement {
  return (
    <EmptyState
      className={className}
      bare={bare}
      tone="error"
      icon={<IconAlert className="h-5 w-5" />}
      title={title}
      body={describeError(error)}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-ink/90"
          >
            <IconRefresh className="h-4 w-4" />
            Try again
          </button>
        ) : null
      }
    />
  );
}
