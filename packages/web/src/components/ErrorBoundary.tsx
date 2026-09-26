import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { EmptyState } from './EmptyState';
import { IconAlert } from './icons';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last line of defence: a render-time crash shows a readable card (with a reload
 * button) instead of a blank white page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Outreach OS] render error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="shell pt-12">
        <EmptyState
          tone="error"
          icon={<IconAlert className="h-5 w-5" />}
          title="Something broke while rendering"
          body={error.message || 'An unexpected error stopped this page from drawing.'}
          action={
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }
}
