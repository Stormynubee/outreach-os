import type { ReactElement } from 'react';

import { Link } from 'wouter';

import { useStatus } from '../lib/queries';
import { IconExternal } from './icons';

/** Site footer. Carries the OpenStreetMap attribution both OSM services require. */
export function SiteFooter({ onOpenGuide }: { onOpenGuide: () => void }): ReactElement {
  const status = useStatus();
  const attribution = status.data?.attribution;

  return (
    <footer className="mt-12 border-t border-ink/[0.07] bg-card/60">
      <div className="shell flex flex-col gap-5 py-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-ink" aria-hidden="true">
              <span className="h-2 w-2 rounded-pill bg-lime" />
            </span>
            <span className="text-[13px] font-extrabold tracking-[-0.02em] text-ink">
              Outreach OS
            </span>
          </div>
          <p className="mt-2.5 text-[12px] font-medium text-muted">
            Local business discovery and outreach tracking. Runs entirely on this machine against
            free OpenStreetMap services — no cloud, no API keys.
          </p>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:gap-12">
          <nav aria-label="Footer" className="flex flex-col gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
              Workspace
            </span>
            <Link to="/discover" className="text-[13px] font-semibold text-ink hover:text-muted">
              Discover
            </Link>
            <Link to="/leads" className="text-[13px] font-semibold text-ink hover:text-muted">
              Leads
            </Link>
            <Link to="/outreach" className="text-[13px] font-semibold text-ink hover:text-muted">
              Outreach
            </Link>
            <Link to="/settings" className="text-[13px] font-semibold text-ink hover:text-muted">
              Settings
            </Link>
            <button
              type="button"
              onClick={onOpenGuide}
              className="text-left text-[13px] font-semibold text-ink hover:text-muted"
            >
              How this works
            </button>
          </nav>

          <div className="max-w-xs">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
              Data
            </span>
            <p className="mt-2 text-[12px] font-medium text-muted">
              {attribution?.text ?? '© OpenStreetMap contributors, available under the ODbL.'}{' '}
              <a
                href={attribution?.url ?? 'https://www.openstreetmap.org/copyright'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-ink underline"
              >
                Licence
                <IconExternal className="h-3 w-3" />
              </a>
            </p>
            {attribution?.osmBase ? (
              <p className="mt-1.5 text-[11px] font-semibold text-muted tabular-nums">
                Map data as of {new Date(attribution.osmBase).toLocaleString()}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
