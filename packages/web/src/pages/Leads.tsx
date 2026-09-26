import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { CATEGORIES, type LeadQuery, type LeadRow, type SiteState } from '@outreach/shared';
import { Link, useLocation, useSearch } from 'wouter';

import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';
import { Select, inputClass, type SelectOption } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { ScoreRing } from '../components/ScoreRing';
import { SocialBadge } from '../components/SocialBadge';
import { StatusPill } from '../components/StatusPill';
import {
  IconChevronRight,
  IconDownload,
  IconGlobe,
  IconMail,
  IconPhone,
  IconSearch,
} from '../components/icons';
import { describeError, downloadLeadsCsv } from '../lib/api';
import { cx } from '../lib/cx';
import { formatCompact, formatNumber, relativeTime } from '../lib/format';
import { ALL_CATEGORIES, readCategoryPref, writeCategoryPref } from '../lib/prefs';
import { useLeads } from '../lib/queries';
import { useDebouncedValue } from '../lib/useDebouncedValue';

type SortKey = NonNullable<LeadQuery['sort']>;

const PAGE_SIZE = 12;

interface LeadFilter {
  key: string;
  label: string;
  siteStates?: SiteState[];
  noWebsite?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasSocial?: boolean;
}

const FILTERS: LeadFilter[] = [
  { key: 'no_website', label: 'No website', noWebsite: true },
  { key: 'dead', label: 'Dead site', siteStates: ['dead'] },
  { key: 'social_only', label: 'Social only', siteStates: ['social_only'] },
  { key: 'has_email', label: 'Has email', hasEmail: true },
  { key: 'has_phone', label: 'Has phone', hasPhone: true },
  { key: 'has_social', label: 'Has social', hasSocial: true },
];

const SORTS: readonly SelectOption<SortKey>[] = [
  { value: 'score', label: 'Best score first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'recent', label: 'Newest first' },
  { value: 'followers', label: 'Most followers' },
];

function mergeFilters(active: string[], base: LeadQuery): LeadQuery {
  const query: LeadQuery = { ...base };
  const siteStates: SiteState[] = [];
  for (const filter of FILTERS) {
    if (!active.includes(filter.key)) continue;
    if (filter.siteStates) siteStates.push(...filter.siteStates);
    if (filter.noWebsite) query.noWebsite = true;
    if (filter.hasEmail) query.hasEmail = true;
    if (filter.hasPhone) query.hasPhone = true;
    if (filter.hasSocial) query.hasSocial = true;
  }
  if (siteStates.length > 0) query.siteStates = siteStates;
  return query;
}

export default function Leads(): ReactElement {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const urlCategory = new URLSearchParams(search).get('category');
  const category = urlCategory ?? readCategoryPref();

  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('score');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(searchInput, 350);

  const query = useMemo(
    () =>
      mergeFilters(activeFilters, {
        sort,
        q: debouncedSearch.trim() ? debouncedSearch.trim() : undefined,
        page,
        pageSize: PAGE_SIZE,
        category: category === ALL_CATEGORIES ? undefined : category,
      }),
    [activeFilters, sort, debouncedSearch, page, category],
  );

  const leads = useLeads(query);

  // Any change to the filter set starts the list over.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sort, category, activeFilters]);

  const rows = leads.data?.rows ?? [];
  const total = leads.data?.total ?? 0;
  const pageSize = leads.data?.pageSize && leads.data.pageSize > 0 ? leads.data.pageSize : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (leads.data?.page ?? page) * pageSize - pageSize + 1;
  const lastRow = Math.min(total, firstRow + rows.length - 1);
  const activeCategoryLabel =
    category === ALL_CATEGORIES
      ? 'all categories'
      : CATEGORIES.find((item) => item.key === category)?.label ?? category;

  const toggleFilter = (key: string): void => {
    setActiveFilters((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const applyCategory = (key: string): void => {
    writeCategoryPref(key);
    setLocation(key === ALL_CATEGORIES ? '/leads' : `/leads?category=${encodeURIComponent(key)}`);
    setPage(1);
  };

  const clearAll = (): void => {
    setActiveFilters([]);
    setSearchInput('');
    setSort('score');
    applyCategory(ALL_CATEGORIES);
  };

  // Exporting goes through fetch rather than a plain link so it carries the engine
  // token, and it reuses the active filters so the file matches what is on screen.
  const onExport = (): void => {
    setExportError(null);
    setExporting(true);
    downloadLeadsCsv(query)
      .catch((error: unknown) => setExportError(describeError(error)))
      .finally(() => setExporting(false));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Leads"
        description={
          leads.isLoading
            ? 'Loading leads…'
            : `${formatNumber(total)} business${total === 1 ? '' : 'es'} · ${activeCategoryLabel}`
        }
        actions={
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className={cx(
              'inline-flex items-center gap-2 rounded-pill bg-card px-4 py-2.5 text-[13px] font-bold text-ink shadow-card',
              exporting && 'opacity-60',
            )}
          >
            <IconDownload className="h-4 w-4" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />

      {exportError ? (
        <p role="alert" className="text-[13px] font-bold text-ink">
          {exportError}
        </p>
      ) : null}

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <label htmlFor="lead-search" className="sr-only">
              Search leads
            </label>
            <IconSearch
              className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              id="lead-search"
              name="lead-search"
              type="search"
              autoComplete="off"
              placeholder="Search by name, city or domain"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className={cx(inputClass, 'pl-11')}
            />
          </div>

          <div className="flex items-center gap-3">
            <Select
              name="lead-sort"
              ariaLabel="Sort leads"
              value={sort}
              onValueChange={(next) => setSort(next)}
              options={SORTS}
              className="w-[200px]"
            />
            <button
              type="button"
              onClick={clearAll}
              className="shrink-0 text-[13px] font-extrabold text-muted underline hover:text-ink"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-ink/[0.07] pt-4">
          {FILTERS.map((filter) => (
            <Chip
              key={filter.key}
              selected={activeFilters.includes(filter.key)}
              onClick={() => toggleFilter(filter.key)}
            >
              {filter.label}
            </Chip>
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <Chip selected={category === ALL_CATEGORIES} onClick={() => applyCategory(ALL_CATEGORIES)}>
            All categories
          </Chip>
          {CATEGORIES.map((item) => (
            <Chip key={item.key} selected={category === item.key} onClick={() => applyCategory(item.key)}>
              <span aria-hidden="true">{item.emoji}</span>
              {item.label}
            </Chip>
          ))}
        </div>
      </Card>

      {leads.isLoading ? (
        <LoadingState label="Loading leads" rows={4} />
      ) : leads.isError ? (
        <ErrorState
          title="Leads could not be loaded"
          error={leads.error}
          onRetry={() => {
            void leads.refetch();
          }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconSearch className="h-5 w-5" />}
          title="No leads match these filters"
          body="Try widening the filters, or run a discovery for a new area."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={clearAll}
                className="rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white"
              >
                Reset filters
              </button>
              <Link
                to="/discover"
                className="rounded-pill bg-ink/[0.06] px-4 py-2 text-[13px] font-bold text-ink"
              >
                Open Discover
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {rows.map((row) => (
              <LeadCard key={row.id} row={row} />
            ))}
          </ul>

          <nav
            aria-label="Pagination"
            className="flex flex-wrap items-center justify-between gap-4 border-t border-ink/[0.07] pt-5"
          >
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              className={cx(
                'rounded-pill bg-card px-4 py-2 text-[13px] font-bold text-ink shadow-card',
                page <= 1 && 'cursor-not-allowed opacity-40',
              )}
            >
              Previous
            </button>
            <p className="text-[13px] font-semibold text-muted tabular-nums" aria-live="polite">
              {formatNumber(firstRow)}–{formatNumber(lastRow)} of {formatNumber(total)} · page{' '}
              {formatNumber(leads.data?.page ?? page)} / {formatNumber(pageCount)}
            </p>
            <button
              type="button"
              onClick={() => setPage((prev) => prev + 1)}
              disabled={page >= pageCount}
              className={cx(
                'rounded-pill bg-card px-4 py-2 text-[13px] font-bold text-ink shadow-card',
                page >= pageCount && 'cursor-not-allowed opacity-40',
              )}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

function LeadCard({ row }: { row: LeadRow }): ReactElement {
  const followerLabel =
    row.followersTotal === null
      ? 'followers unknown'
      : `${formatCompact(row.followersTotal)} followers (${formatNumber(row.followersKnown)} known)`;

  return (
    <Card as="li" className="p-4">
      <div className="flex items-start gap-3">
        <ScoreRing score={row.score} size={54} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              to={`/leads/${row.id}`}
              className="truncate text-[15px] font-extrabold tracking-[-0.02em] text-ink"
            >
              {row.name}
            </Link>
            <StatusPill state={row.siteState} size="sm" />
          </div>

          <p className="mt-0.5 truncate text-[12px] font-medium text-muted">
            {[row.categoryLabel ?? row.category, row.city, row.countryCode]
              .filter((part): part is string => Boolean(part))
              .join(' · ')}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Tag
              icon={<IconMail className="h-3.5 w-3.5" />}
              label={row.email ?? 'no email'}
              muted={!row.hasEmail}
            />
            <Tag
              icon={<IconPhone className="h-3.5 w-3.5" />}
              label={row.phone ?? 'no phone'}
              muted={!row.hasPhone}
            />
            <Tag
              icon={<IconGlobe className="h-3.5 w-3.5" />}
              label={followerLabel}
              muted={row.followersTotal === null}
            />
          </div>

          {row.socials.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {row.socials.slice(0, 3).map((social) => (
                <SocialBadge
                  key={social.id}
                  platform={social.platform}
                  followers={social.followers}
                  followersState={social.followersState}
                  manualOverride={social.manualOverride}
                  showReason={false}
                />
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-muted">
              seen {relativeTime(row.firstSeenAt, 'recently')}
            </span>
            <Link
              to={`/leads/${row.id}`}
              aria-label={`Open ${row.name}`}
              className="inline-flex items-center gap-1 rounded-pill bg-ink/[0.06] px-2.5 py-1.5 text-[11px] font-extrabold text-ink"
            >
              Open
              <IconChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Tag({
  icon,
  label,
  muted,
}: {
  icon: ReactNode;
  label: string;
  muted: boolean;
}): ReactElement {
  return (
    <span
      className={cx(
        'inline-flex max-w-[190px] items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-bold',
        muted ? 'bg-ink/[0.04] text-muted' : 'bg-page text-ink',
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
