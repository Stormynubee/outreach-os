import type { ReactElement } from 'react';

import { Link, useLocation } from 'wouter';

import { cx } from '../lib/cx';
import { useSettings, useStats } from '../lib/queries';
import { Avatar } from './Avatar';
import { PointsChip } from './PointsChip';
import { IconCompass, IconHome, IconInfo, IconLeads, IconSend, IconSliders } from './icons';

interface NavItem {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => ReactElement;
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', Icon: IconHome },
  { href: '/discover', label: 'Discover', Icon: IconCompass },
  { href: '/leads', label: 'Leads', Icon: IconLeads },
  { href: '/outreach', label: 'Outreach', Icon: IconSend },
  { href: '/settings', label: 'Settings', Icon: IconSliders },
];

/**
 * Site header. The reference's pill language carried over to a website nav: the
 * active destination is a solid black pill, the rest are quiet text links.
 */
export function SiteHeader({ onOpenGuide }: { onOpenGuide: () => void }): ReactElement {
  const [location] = useLocation();
  const stats = useStats();
  const settings = useSettings();

  const isActive = (href: string): boolean =>
    href === '/' ? location === '/' : location === href || location.startsWith(`${href}/`);

  const displayName = settings.data?.displayName?.trim() || 'there';

  return (
    <header className="sticky top-0 z-40 border-b border-ink/[0.07] bg-page/85 backdrop-blur-md">
      <div className="shell flex h-16 items-center gap-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Outreach OS home">
          <span
            className="grid h-8 w-8 place-items-center rounded-[11px] bg-ink text-lime"
            aria-hidden="true"
          >
            <span className="h-2.5 w-2.5 rounded-pill bg-lime" />
          </span>
          <span className="text-[15px] font-extrabold tracking-[-0.03em] text-ink">
            Outreach<span className="text-muted"> OS</span>
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                to={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'inline-flex items-center gap-2 rounded-pill px-3.5 py-2 text-[13px] font-bold transition-colors duration-150',
                  active ? 'bg-ink text-white' : 'text-muted hover:bg-ink/[0.05] hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <PointsChip points={stats.data?.points} />
          <button
            type="button"
            onClick={onOpenGuide}
            aria-label="Open the guide"
            className="inline-flex items-center gap-2 rounded-pill bg-card px-3 py-2 text-[13px] font-bold text-ink shadow-card transition-colors hover:bg-lime"
          >
            <IconInfo className="h-4 w-4" />
            <span className="hidden lg:inline">Guide</span>
          </button>
          <Link
            to="/discover"
            className="hidden items-center gap-2 rounded-pill bg-lime px-4 py-2 text-[13px] font-extrabold text-ink sm:inline-flex"
          >
            <IconCompass className="h-4 w-4" />
            New search
          </Link>
          <Avatar name={displayName} />
        </div>
      </div>

      {/* Small screens: the same nav as a scrollable pill row under the brand. */}
      <nav aria-label="Main" className="shell pb-3 md:hidden">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                to={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] font-bold',
                  active ? 'bg-ink text-white' : 'bg-card text-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
