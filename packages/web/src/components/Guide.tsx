import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { Link } from 'wouter';

import { cx } from '../lib/cx';
import { IconChevronRight, IconClose } from './icons';

export interface GuideStep {
  emoji: string;
  eyebrow: string;
  title: string;
  body: string;
  points?: string[];
  action?: { label: string; to: string };
}

/**
 * The whole product in nine steps, written for someone who has never seen it.
 * Ordered the way a new user actually meets the app: contact → discover → read
 * a lead → work it.
 */
export const GUIDE_STEPS: GuideStep[] = [
  {
    emoji: '👋',
    eyebrow: 'Welcome',
    title: 'This finds businesses that need you',
    body: 'Outreach OS searches any location in the world for local businesses, works out which ones have no working website, and collects the contact details you need to reach them.',
    points: [
      'Runs entirely on this machine — no accounts, no cloud, no API keys',
      'Built on free OpenStreetMap services, so nothing to pay for',
      'It never sends messages. It gives you a list and a to-do list.',
    ],
  },
  {
    emoji: '🔑',
    eyebrow: 'Do this first',
    title: 'Set your contact before anything else',
    body: 'OpenStreetMap refuses requests that do not identify a real contact, and it answers placeholder addresses like example.com with a bare “403 Access denied”. The app blocks that up front so you never see a mystery error.',
    points: [
      'Settings → Contact — use an email you can be reached at, or a link to your project',
      'Until it is set, discovery stays switched off and the dashboard tells you so',
      'It is only sent as part of a polite, honest browser identifier',
    ],
    action: { label: 'Open settings', to: '/settings' },
  },
  {
    emoji: '🔍',
    eyebrow: 'Step 1',
    title: 'Search a place',
    body: 'On Discover, type a town, city or postcode, tick the categories you sell to, and press Find. The area is divided into tiles and each one is queried in turn, so a dense city does not get truncated.',
    points: [
      'One request per submit — there is deliberately no autocomplete, because the geocoding service forbids it',
      'Recent searches are remembered; clicking one just refills the form',
      'Progress streams live: tiles covered, businesses found, and which mirror answered',
    ],
    action: { label: 'Go to Discover', to: '/discover' },
  },
  {
    emoji: '📊',
    eyebrow: 'How it thinks',
    title: 'Why the best leads sit at the top',
    body: 'Every business gets a 0–100 score. The weights are tuned so a business verified as having no website always outranks one with a working site, and so a business we could not fully check can never outrank one we did.',
    points: [
      'Biggest signals: no website, a dead or parked site, or social media standing in for a website',
      'Contactability matters — a lead you cannot contact is not a lead',
      'Any lead’s exact reasons are listed on its page, so a ranking is never a mystery',
    ],
  },
  {
    emoji: '📇',
    eyebrow: 'Step 2',
    title: 'Read a lead properly',
    body: 'A lead page shows the contacts that were found and where each one came from, a website audit, and the social accounts attached to the business.',
    points: [
      'Emails and phone numbers carry a source and a confidence score',
      'Automated addresses (noreply@) are kept but greyed out, never silently used',
      'The website audit shows whether a site is live, dead, parked or missing, with the evidence',
    ],
    action: { label: 'Browse leads', to: '/leads' },
  },
  {
    emoji: '📵',
    eyebrow: 'Honest limits',
    title: 'What follower counts can and cannot do',
    body: 'Some platforms simply cannot be read from a server, and pretending otherwise would give you numbers you cannot trust. Where a count is unobtainable the app says so and tells you why.',
    points: [
      'YouTube is reliable. TikTok and Facebook work sometimes. Instagram rarely.',
      'X and LinkedIn are never attempted — one is login-walled, the other forbids it',
      'Every social has a manual override you can type yourself, and a later scrape can never overwrite it',
    ],
  },
  {
    emoji: '✅',
    eyebrow: 'Step 3',
    title: 'Work the list',
    body: 'Outreach is your to-do list. Add a task from any lead, then tick it off as you call or email people. The counters and the weekly chart are derived from the list itself.',
    points: [
      'Ticking and un-ticking adjusts the day’s numbers exactly — no drift',
      'Tasks are grouped into overdue, today, done today, and upcoming',
      'The pipeline stage (new → contacted → replied → won/lost) tracks each business',
    ],
    action: { label: 'Open Outreach', to: '/outreach' },
  },
  {
    emoji: '📤',
    eyebrow: 'Useful to know',
    title: 'Export and tune',
    body: 'Leads export to CSV for a spreadsheet, and Settings exposes the politeness controls that keep you from being blocked.',
    points: [
      'Export CSV on the Leads page respects whatever filters you have applied',
      'Settings → offer preset re-ranks everything: pick “social media” if that is what you sell instead of websites',
      'Concurrency, delays, cache lifetimes and the mirror list are all adjustable',
    ],
  },
  {
    emoji: '🤝',
    eyebrow: 'Fair use',
    title: 'How it stays welcome',
    body: 'Free mapping services are donated infrastructure, so the app is deliberately a good citizen — and it says so in the interface.',
    points: [
      'One request at a time per website, with a polite gap between them',
      'robots.txt is fetched and obeyed, including crawl delays',
      'Data is © OpenStreetMap contributors under the ODbL — attribution sits in the footer',
    ],
  },
];

export interface GuideProps {
  open: boolean;
  onClose: () => void;
}

/** Guided walkthrough. Opens itself on a first visit, then only on request. */
export function Guide({ open, onClose }: GuideProps): ReactElement | null {
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = 'guide-heading';

  const step = GUIDE_STEPS[index] ?? GUIDE_STEPS[0]!;
  const isLast = index === GUIDE_STEPS.length - 1;

  const go = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(GUIDE_STEPS.length - 1, next)));
    },
    [],
  );

  // Escape closes, and the arrow keys move between steps.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') go(index + 1);
      if (event.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, go, onClose]);

  // Lock the page behind the overlay and move focus into the panel.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        // Click the backdrop to dismiss, but not a drag that started inside.
        if (event.target === event.currentTarget) onClose();
      }}
      style={{ animation: 'guide-fade 180ms ease-out' }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        // Exposed so automated UI checks can assert which step is showing.
        data-step={index}
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-card-lg bg-card shadow-float outline-none md:max-h-[86dvh] md:flex-row"
        style={{ animation: 'guide-rise 220ms cubic-bezier(0.32, 0.72, 0, 1)' }}
      >
        {/* Step rail — the whole tour is visible at a glance on a wide screen. */}
        <div className="hidden w-64 shrink-0 flex-col border-r border-ink/[0.07] bg-page/70 p-5 md:flex">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-muted">
            Guide · {GUIDE_STEPS.length} steps
          </p>
          <ol className="mt-4 flex-1 space-y-1 overflow-y-auto">
            {GUIDE_STEPS.map((item, i) => (
              <li key={item.title}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === index ? 'step' : undefined}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-[12px] font-bold transition-colors',
                    i === index ? 'bg-ink text-white' : 'text-muted hover:bg-ink/[0.05] hover:text-ink',
                  )}
                >
                  <span aria-hidden="true">{item.emoji}</span>
                  <span className="min-w-0 truncate">{item.eyebrow}</span>
                </button>
              </li>
            ))}
          </ol>
          <Link
            to="/discover"
            onClick={onClose}
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-pill bg-lime px-3.5 py-2 text-[12px] font-extrabold text-ink"
          >
            Start searching
            <IconChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 p-6 pb-0 lg:p-8 lg:pb-0">
            <div className="flex items-center gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-lime text-[20px]"
                aria-hidden="true"
              >
                {step.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-muted">
                  {step.eyebrow} · {index + 1} of {GUIDE_STEPS.length}
                </p>
                <span className="hidden">{step.title}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close the guide"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-ink/[0.06] text-ink transition-colors hover:bg-ink/10"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-8">
            <h2 id={headingId} className="text-section text-ink lg:text-[28px]">
              {step.title}
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] font-medium text-muted">{step.body}</p>

            {step.points ? (
              <ul className="mt-5 space-y-2.5">
                {step.points.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-pill bg-lime"
                      aria-hidden="true"
                    />
                    <span className="text-[13px] font-semibold text-ink">{point}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {step.action ? (
              <Link
                to={step.action.to}
                onClick={onClose}
                className="mt-6 inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2.5 text-[13px] font-extrabold text-white"
              >
                {step.action.label}
                <IconChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.07] p-5 lg:px-8">
            <div className="flex items-center gap-1.5 md:hidden" aria-hidden="true">
              {GUIDE_STEPS.map((item, i) => (
                <span
                  key={item.title}
                  className={cx('h-1.5 rounded-pill transition-all', i === index ? 'w-5 bg-ink' : 'w-1.5 bg-ink/20')}
                />
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="text-[13px] font-extrabold text-muted underline hover:text-ink"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => go(index - 1)}
                disabled={index === 0}
                className={cx(
                  'rounded-pill bg-ink/[0.06] px-4 py-2.5 text-[13px] font-extrabold text-ink',
                  index === 0 && 'cursor-not-allowed opacity-40',
                )}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => (isLast ? onClose() : go(index + 1))}
                className="rounded-pill bg-lime px-5 py-2.5 text-[13px] font-extrabold text-ink"
              >
                {isLast ? 'Got it' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
