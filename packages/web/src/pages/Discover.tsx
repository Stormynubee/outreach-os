import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { CATEGORIES } from '@outreach/shared';
import type { CreateDiscoveryRequest, DiscoverySummary } from '@outreach/shared';
import { Link } from 'wouter';

import { Card, CardTitle, StatRow } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';
import { TextInput } from '../components/Field';
import { ProgressBar } from '../components/ProgressBar';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { IconAlert, IconClock, IconGlobe, IconMapPin, IconRefresh, IconSearch } from '../components/icons';
import { describeError, startDiscovery, type StartDiscoveryResult } from '../lib/api';
import { cx } from '../lib/cx';
import { formatNumber, hostFromUrl, relativeTime } from '../lib/format';
import { useProgressStream } from '../lib/events';
import { keys, useDiscoveries, useDiscoveryProgress, useStatus } from '../lib/queries';

/** Statuses that mean "the run is still going" — everything else is terminal. */
const ACTIVE_STATUSES = ['queued', 'pending', 'planning', 'running', 'fetching', 'discovering', 'enriching', 'scraping'];

function isActiveStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && ACTIVE_STATUSES.includes(status.toLowerCase());
}

export default function Discover(): ReactElement {
  const queryClient = useQueryClient();
  const status = useStatus();
  const recent = useDiscoveries();
  const stream = useProgressStream();

  const [locationText, setLocationText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [run, setRun] = useState<StartDiscoveryResult | null>(null);

  const start = useMutation({
    mutationFn: (body: CreateDiscoveryRequest) => startDiscovery(body),
    onSuccess: (result) => {
      setRun(result);
      void queryClient.invalidateQueries({ queryKey: keys.discoveries });
    },
  });

  const runId = run?.id ?? null;

  // The contract does not guarantee a per-tile endpoint; a 404 leaves the SSE
  // counters as the only source of truth and the page still works.
  const live = stream.discovery;
  const mine = live && (runId === null || live.queryId === runId) ? live : null;
  const runStatus = mine?.status ?? run?.summary?.status ?? null;
  const running = start.isPending || isActiveStatus(runStatus);
  const detail = useDiscoveryProgress(runId, running ? 3000 : false);

  const tilesDone = mine?.tilesDone ?? detail.data?.tilesDone ?? run?.summary?.tilesDone ?? 0;
  const tilesTotal = mine?.tilesTotal ?? detail.data?.tilesTotal ?? run?.summary?.tilesTotal ?? 0;
  const poisFound = mine?.poisFound ?? detail.data?.poisFound ?? run?.summary?.poisFound ?? 0;
  const mirror = mine?.mirror ?? detail.data?.mirror ?? run?.summary?.mirror ?? null;

  // Graceful gate: if /api/status 404s we cannot know, so we do not block the form.
  const gateKnown = status.data !== undefined;
  const blocked = status.data?.discoveryReady === false;
  const warning = status.data?.warning ?? null;

  const toggleCategory = (key: string): void => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const applyRecent = (entry: DiscoverySummary): void => {
    setLocationText(entry.locationText);
    setKeyword(entry.keyword ?? '');
    setSelected(entry.categories.filter((key) => CATEGORIES.some((category) => category.key === key)));
    setRun(null);
    setFormError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = locationText.trim();
    if (trimmed.length < 2) {
      setFormError('Enter a town, city or postcode so there is something to search.');
      return;
    }
    setFormError(null);
    start.mutate({
      location: trimmed,
      categories: selected.length > 0 ? selected : undefined,
      keyword: keyword.trim() ? keyword.trim() : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search"
        title="Discover"
        description="Search OpenStreetMap for local businesses by area and category. Results are enriched automatically."
      />

      {blocked ? (
        <Card className="border border-ink/10">
          <div className="flex items-start gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-pill bg-ink text-lime" aria-hidden="true">
              <IconAlert className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Discovery is disabled</h2>
              <p className="mt-1 max-w-2xl text-[13px] font-medium text-muted">
                {warning ??
                  "OpenStreetMap's usage policy requires a contact in every request. Add one in Settings to turn discovery back on."}
              </p>
              <Link
                to="/settings"
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-pill bg-lime px-3.5 py-1.5 text-[12px] font-extrabold text-ink"
              >
                Open settings
              </Link>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardTitle hint="One request per submit — nothing fires while you type">
            Find businesses
          </CardTitle>

        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          {/*
            Deliberately a plain input: NO typeahead, NO autocomplete.
            Nominatim's policy forbids per-keystroke lookups, so the app only ever
            asks the server once, when the form is submitted.
          */}
          <TextInput
            name="discovery-location"
            label="Location"
            placeholder="e.g. Porto, Portugal"
            value={locationText}
            onValueChange={setLocationText}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            hint="Town, city or postcode. Searched only when you submit."
          />

          <fieldset>
            <legend className="mb-2 text-[12px] font-bold text-ink">
              Categories <span className="font-semibold text-muted">({selected.length} selected)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <Chip
                  key={category.key}
                  selected={selected.includes(category.key)}
                  onClick={() => toggleCategory(category.key)}
                >
                  <span aria-hidden="true">{category.emoji}</span>
                  {category.label}
                </Chip>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(CATEGORIES.map((category) => category.key))}
                className="text-[12px] font-extrabold text-ink underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-[12px] font-extrabold text-muted underline"
              >
                Clear
              </button>
              <span className="text-[11px] font-medium text-muted">
                {selected.length === 0 ? 'All categories will be searched.' : 'Only the selected categories.'}
              </span>
            </div>
          </fieldset>

          <TextInput
            name="discovery-keyword"
            label="Keyword (optional)"
            placeholder="e.g. vegan, family run"
            value={keyword}
            onValueChange={setKeyword}
            autoComplete="off"
          />

          {formError ? (
            <p role="alert" className="text-[12px] font-bold text-ink">
              {formError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={blocked || start.isPending}
            className={cx(
              'inline-flex w-full items-center justify-center gap-2 rounded-pill bg-ink px-5 py-3.5 text-[14px] font-extrabold text-white transition-transform active:scale-[0.99]',
              (blocked || start.isPending) && 'cursor-not-allowed opacity-50',
            )}
          >
            {start.isPending ? <Spinner size="sm" label="Starting" className="border-white/30 border-t-lime" /> : <IconSearch className="h-4 w-4" />}
            {blocked ? 'Blocked — set a contact' : start.isPending ? 'Starting…' : 'Find businesses'}
          </button>

          {!gateKnown && !status.isLoading ? (
            <p className="text-[12px] font-medium text-muted">
              Readiness could not be checked ({status.isError ? 'the status endpoint did not answer' : 'unknown reason'}
              ). The request will be attempted anyway.
            </p>
          ) : null}

          {start.isError ? (
            <p role="alert" className="rounded-2xl bg-page px-4 py-3 text-[12px] font-semibold text-ink">
              {describeError(start.error)}
            </p>
          ) : null}
        </form>
        </Card>

        {/* ---- Live run ---- */}
        <Card className="lg:col-span-5">
          <CardTitle
            hint={runStatus ? `Status: ${runStatus}` : 'Nothing started yet'}
            action={
              <span
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-extrabold',
                  stream.connected ? 'bg-lime text-ink' : 'bg-ink/[0.06] text-muted',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx('h-1.5 w-1.5 rounded-pill', stream.connected ? 'bg-ink' : 'bg-muted')}
                />
                {stream.connected ? 'live' : 'offline'}
              </span>
            }
          >
            Discovery progress
          </CardTitle>

        {!run && !start.isPending ? (
          <EmptyState
            className="mt-3"
            bare
            icon={<IconMapPin className="h-5 w-5" />}
            title="No run in flight"
            body="Pick a location above, or tap one of your recent searches below."
          />
        ) : (
          <div className="mt-4 space-y-4">
            <ProgressBar
              label="Tiles fetched"
              value={tilesDone}
              max={tilesTotal}
              animated={running}
              caption={
                tilesTotal > 0
                  ? `${Math.round((tilesDone / tilesTotal) * 100)}% of the area covered${running ? ' — still running' : ''}`
                  : 'The server has not reported any tiles yet.'
              }
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-page/80 px-4 py-3">
                <p className="text-[11px] font-bold text-muted">Businesses found</p>
                <p className="text-[26px] font-extrabold tabular-nums text-ink">{formatNumber(poisFound)}</p>
              </div>
              <div className="rounded-2xl bg-page/80 px-4 py-3">
                <p className="text-[11px] font-bold text-muted">Tiles done</p>
                <p className="text-[26px] font-extrabold tabular-nums text-ink">
                  {formatNumber(tilesDone)}
                  <span className="text-[15px] font-bold text-muted"> / {formatNumber(tilesTotal)}</span>
                </p>
              </div>
            </div>

            <StatRow
              label="Overpass mirror in use"
              value={
                <span className="inline-flex max-w-[240px] items-center gap-1.5">
                  <IconGlobe className="h-3.5 w-3.5 text-muted" />
                  <span className="truncate" title={mirror ?? undefined}>
                    {mirror ? hostFromUrl(mirror, 'unknown mirror') : 'not reported'}
                  </span>
                </span>
              }
            />

            {detail.data?.enrichment ? (
              <div className="space-y-2">
                <p className="text-[11px] font-bold text-muted">
                  Enrichment · {formatNumber(detail.data.enrichment.running)} running ·{' '}
                  {formatNumber(detail.data.enrichment.queued)} queued ·{' '}
                  {formatNumber(detail.data.enrichment.done)} done
                  {detail.data.enrichment.failed > 0
                    ? ` · ${formatNumber(detail.data.enrichment.failed)} failed`
                    : ''}
                </p>
                {detail.data.tiles.length > 0 ? (
                  <ul className="flex flex-wrap gap-1" aria-label="Tile states">
                    {detail.data.tiles.slice(0, 48).map((tile) => (
                      <li
                        key={tile.index}
                        title={`Tile ${tile.index}: ${tile.status}${tile.elementCount ? `, ${tile.elementCount} results` : ''}`}
                        className={cx(
                          'h-3.5 w-3.5 rounded-[4px]',
                          tile.status === 'done' ? 'bg-lime' : tile.error ? 'bg-ink' : 'bg-ink/15',
                        )}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {mine ? (
              <p className="text-[11px] font-medium text-muted">
                Query #{formatNumber(mine.queryId)}
                {stream.lastEventAt ? ` · last event ${relativeTime(stream.lastEventAt)}` : ''}
              </p>
            ) : null}

            {run?.summary ? (
              <p className="text-[11px] font-medium text-muted">
                {run.summary.usedAreaFilter ? 'Area filter applied. ' : ''}
                {run.summary.coverageVerified ? 'Coverage verified.' : 'Coverage not verified yet.'}
              </p>
            ) : null}

            {!stream.connected && !stream.unavailable ? (
              <p className="text-[11px] font-medium text-muted">
                Connecting to the live event stream…
              </p>
            ) : null}

            {stream.unavailable ? (
              <p className="flex items-start gap-2 rounded-2xl bg-page px-4 py-3 text-[11px] font-medium text-muted">
                <IconClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Live updates are unavailable (the SSE stream at /api/events is not reachable). The
                numbers above refresh by polling while the run is active.
              </p>
            ) : null}

            {stream.logs.length > 0 ? (
              <ul className="space-y-1">
                {stream.logs.slice(-3).map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="text-[11px] font-medium text-muted">
                    <span className="font-bold" aria-hidden="true">
                      {entry.level === 'error' ? '✕' : entry.level === 'warn' ? '!' : '·'}
                    </span>{' '}
                    {entry.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="text-[11px] font-medium text-muted" aria-live="polite">
              {stream.connected ? 'Stream connected' : 'Stream disconnected'} ·{' '}
              {running ? 'run in progress' : runStatus ? 'run finished' : 'idle'}
            </p>
          </div>
        )}
        </Card>
      </div>

      {/* ---- Recent searches ---- */}
      <Card>
        <CardTitle
          hint="Tapping one fills the form — it does not search again"
          action={
            <button
              type="button"
              aria-label="Reload recent searches"
              onClick={() => {
                void recent.refetch();
              }}
              className="grid h-8 w-8 place-items-center rounded-pill bg-ink/[0.06] text-ink"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          }
        >
          Recent searches
        </CardTitle>

        {recent.isLoading ? (
          <LoadingState className="mt-3" bare label="Loading recent searches" rows={1} />
        ) : recent.isError ? (
          <ErrorState
            className="mt-3"
            bare
            title="Recent searches are unavailable"
            error={recent.error}
            onRetry={() => {
              void recent.refetch();
            }}
          />
        ) : (recent.data ?? []).length === 0 ? (
          <EmptyState
            className="mt-3"
            bare
            icon={<IconSearch className="h-5 w-5" />}
            title="No searches yet"
            body="Your discovery runs will show up here."
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {(recent.data ?? []).slice(0, 12).map((entry) => (
              <Chip
                key={entry.id}
                onClick={() => applyRecent(entry)}
                title={`${entry.status} · ${formatNumber(entry.poisFound)} businesses`}
              >
                <span aria-hidden="true">📍</span>
                {entry.displayName ?? entry.locationText}
                <span className="ml-1 text-[11px] font-bold text-muted">
                  {formatNumber(entry.poisFound)}
                </span>
              </Chip>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
