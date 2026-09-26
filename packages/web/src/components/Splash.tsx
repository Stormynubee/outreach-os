import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { cx } from '../lib/cx';

/** Honest phases — the app really is fetching leads and today's tasks behind this. */
const PHASES = ['Opening your workspace', 'Loading leads and tasks', 'Almost ready'] as const;

const VISIBLE_MS = 1150;
const FADE_MS = 320;

export interface SplashProps {
  onDone: () => void;
}

/**
 * Brief opening screen. It is short on purpose and a click skips it, because a
 * splash you cannot dismiss is the fastest way to annoy someone on every reload.
 */
export function Splash({ onDone }: SplashProps): ReactElement {
  const [phase, setPhase] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const phaseTimer = window.setInterval(() => {
      setPhase((current) => Math.min(current + 1, PHASES.length - 1));
    }, VISIBLE_MS / PHASES.length);
    const leaveTimer = window.setTimeout(() => setLeaving(true), VISIBLE_MS);
    const doneTimer = window.setTimeout(onDone, VISIBLE_MS + FADE_MS);

    return () => {
      window.clearInterval(phaseTimer);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className={cx(
        'fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink px-6 text-white transition-opacity duration-300 ease-soft',
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
      style={{ animation: 'splash-in 260ms ease-out' }}
      onClick={onDone}
      role="presentation"
    >
      <div className="flex flex-col items-center" style={{ animation: 'splash-lift 520ms cubic-bezier(0.32, 0.72, 0, 1)' }}>
        <span className="relative grid h-16 w-16 place-items-center rounded-[20px] bg-lime" aria-hidden="true">
          <span className="h-5 w-5 rounded-pill bg-ink" />
          <span className="absolute inset-0 rounded-[20px] ring-2 ring-lime/40" style={{ animation: 'splash-ring 1600ms ease-out infinite' }} />
        </span>

        <h1 className="mt-6 text-[26px] font-extrabold tracking-[-0.04em] text-white sm:text-[30px]">
          Outreach<span className="text-white/45"> OS</span>
        </h1>
        <p className="mt-2 text-[13px] font-medium text-white/50">
          Local business discovery and outreach — running on your machine
        </p>

        <div className="mt-9 h-[3px] w-56 overflow-hidden rounded-pill bg-white/12">
          <span
            className="block h-full rounded-pill bg-lime"
            style={{ animation: `splash-bar ${VISIBLE_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards` }}
          />
        </div>

        <p className="mt-4 h-4 text-[12px] font-bold text-white/45 tabular-nums" aria-live="polite">
          {PHASES[phase]}
        </p>
      </div>

      <p className="absolute bottom-8 text-[11px] font-semibold tracking-[0.08em] text-white/30 uppercase">
        No cloud · no API keys · free OpenStreetMap data
      </p>
    </div>
  );
}
