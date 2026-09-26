import { useEffect, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import type { PublicSettings } from '@outreach/shared';
import { Link } from 'wouter';

import { Card, CardTitle, StatRow } from '../components/Card';
import { EngineConnectionCard } from '../components/EngineConnection';
import { ErrorState, LoadingState } from '../components/EmptyState';
import { NumberInput, Select, TextArea, TextInput } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { Toggle } from '../components/Toggle';
import { Spinner } from '../components/Spinner';
import { IconAlert, IconCheck, IconCopy, IconExternal, IconLock } from '../components/icons';
import { describeError } from '../lib/api';
import { cx } from '../lib/cx';
import { formatBytes, formatDuration, formatMs, formatNumber, relativeTime } from '../lib/format';
import { OFFER_PRESETS, OFFER_PRESET_LABELS, toOfferPreset } from '../lib/labels';
import { useSaveSettings, useSettings, useStatus } from '../lib/queries';

const TTL_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'homepage', label: 'Homepage' },
  { key: 'contactPage', label: 'Contact page' },
  { key: 'social', label: 'Social profile' },
  { key: 'robots', label: 'robots.txt' },
  { key: 'followers', label: 'Follower counts' },
];

/** Mirrors the server's DEFAULT_SETTINGS shape — used only if /api/settings is not live yet. */
const FALLBACK_SETTINGS: PublicSettings = {
  displayName: 'there',
  contactEmail: '',
  primaryOffer: 'websites',
  geocoderBaseUrl: 'https://nominatim.openstreetmap.org',
  overpassMirrors: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ],
  globalConcurrency: 8,
  perDomainConcurrency: 1,
  perDomainDelayMs: 1200,
  maxPagesPerSite: 5,
  respectRobots: true,
  fetchTimeoutMs: 10_000,
  maxBodyBytes: 2 * 1024 * 1024,
  notifications: true,
  ttlSeconds: { homepage: 86_400, contactPage: 604_800, social: 604_800, robots: 86_400, followers: 604_800 },
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function SettingsPage(): ReactElement {
  const settings = useSettings();
  const status = useStatus();
  const save = useSaveSettings();

  const [draft, setDraft] = useState<PublicSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (settings.data && !dirty) setDraft(settings.data);
  }, [settings.data, dirty]);

  const patch = (changes: Partial<PublicSettings>): void => {
    setDraft((prev) => {
      const base = prev ?? settings.data ?? FALLBACK_SETTINGS;
      return { ...base, ...changes };
    });
    setDirty(true);
    setFlash(null);
  };

  const email = draft?.contactEmail.trim() ?? '';
  const emailValid = email.length === 0 || EMAIL_PATTERN.test(email);
  const canSave = draft !== null && emailValid && !save.isPending;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!draft || !canSave) return;
    save.mutate(draft, {
      onSuccess: () => {
        setDirty(false);
        setFlash('Settings saved.');
      },
      onError: (error) => setFlash(describeError(error)),
    });
  };

  const copyDataDir = (value: string): void => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Everything the server needs to crawl politely and stay unblocked."
      />

      {settings.isLoading ? <LoadingState label="Loading settings" rows={4} /> : null}

      <EngineConnectionCard />

      {settings.isError ? (
        <ErrorState
          title="Settings could not be loaded"
          error={settings.error}
          onRetry={() => {
            void settings.refetch();
          }}
        />
      ) : null}

      {settings.isError ? (
        <Card>
          <CardTitle hint="Only used if you press Save">Server defaults</CardTitle>
          <p className="mt-2 text-[12px] font-medium text-muted">
            The settings endpoint did not answer, so the form below starts from the built-in
            defaults. Anything you save will be written to the server.
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft(FALLBACK_SETTINGS);
              setDirty(true);
              setFlash(null);
            }}
            className="mt-3 rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white"
          >
            Fill the form with defaults
          </button>
        </Card>
      ) : null}

      {draft ? (
        <form className="grid gap-5 lg:grid-cols-2 lg:items-start" onSubmit={onSubmit}>
          <Card>
            <CardTitle hint="Who this app belongs to">Identity</CardTitle>

            <div className="mt-4 space-y-4">
              <TextInput
                name="displayName"
                label="Your name"
                value={draft.displayName}
                onValueChange={(next) => patch({ displayName: next })}
                hint="Used for the greeting on the Home screen."
                autoComplete="off"
              />

              <TextInput
                name="contactEmail"
                label="Contact email"
                type="email"
                inputMode="email"
                value={draft.contactEmail}
                onValueChange={(next) => patch({ contactEmail: next })}
                error={emailValid ? null : 'That does not look like a valid email address.'}
                autoComplete="email"
                hint="Required by the OpenStreetMap usage policy — see the note below."
              />

              <div className="rounded-2xl bg-lime-soft px-4 py-3">
                <p className="text-[12px] font-extrabold text-ink">
                  Why the contact email is not optional
                </p>
                <p className="mt-1 text-[12px] font-medium text-ink/75">
                  OpenStreetMap (Nominatim and Overpass) requires every automated request to
                  identify a real contact. Anonymous clients are blocked outright. The server puts
                  this address in its User-Agent:
                </p>
                <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 font-mono text-[11px] text-ink">
                  {`LeadOutreachBot/0.1.0 (+contact: ${email || 'contact-not-configured'})`}
                </p>
                {status.data?.contactEmailSet === false ? (
                  <p className="mt-2 text-[12px] font-bold text-ink">
                    The server reports no contact email yet — discovery stays disabled until you
                    save one.
                  </p>
                ) : null}
              </div>

              <Select
                name="primaryOffer"
                label="Primary offer"
                value={toOfferPreset(draft.primaryOffer)}
                onValueChange={(next) => patch({ primaryOffer: next })}
                options={OFFER_PRESETS.map((preset) => ({
                  value: preset,
                  label: OFFER_PRESET_LABELS[preset],
                }))}
                hint="Shifts the score slightly: which businesses look like your best fit."
              />
            </div>
          </Card>

          <Card>
            <CardTitle hint="Swappable without a software update">Discovery sources</CardTitle>

            <div className="mt-4 space-y-4">
              <TextInput
                name="geocoderBaseUrl"
                label="Geocoder base URL"
                value={draft.geocoderBaseUrl}
                onValueChange={(next) => patch({ geocoderBaseUrl: next })}
                hint="Nominatim-compatible endpoint used to resolve the location text."
                autoComplete="off"
              />

              <TextArea
                name="overpassMirrors"
                label="Overpass mirrors"
                value={draft.overpassMirrors.join('\n')}
                onValueChange={(next) =>
                  patch({
                    overpassMirrors: next
                      .split('\n')
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0),
                  })
                }
                rows={5}
                hint="One URL per line. Tried in order; failing mirrors are skipped."
                placeholder="https://overpass-api.de/api/interpreter"
              />
              <p className="text-[11px] font-semibold text-muted">
                {formatNumber(draft.overpassMirrors.length)} mirror
                {draft.overpassMirrors.length === 1 ? '' : 's'} configured
              </p>
            </div>
          </Card>

          <Card>
            <CardTitle hint="Be a good citizen — slow and predictable beats fast and banned">
              Limits &amp; politeness
            </CardTitle>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <NumberInput
                name="globalConcurrency"
                label="Global concurrency"
                min={1}
                max={64}
                value={draft.globalConcurrency}
                onValueChange={(next) => patch({ globalConcurrency: next })}
                hint="Requests in flight across all sites."
              />
              <NumberInput
                name="perDomainConcurrency"
                label="Per-domain concurrency"
                min={1}
                max={8}
                value={draft.perDomainConcurrency}
                onValueChange={(next) => patch({ perDomainConcurrency: next })}
                hint="Requests in flight against one host."
              />
              <NumberInput
                name="perDomainDelayMs"
                label="Per-domain delay"
                min={0}
                max={60_000}
                step={100}
                suffix="ms"
                value={draft.perDomainDelayMs}
                onValueChange={(next) => patch({ perDomainDelayMs: next })}
                hint={`Currently ${formatMs(draft.perDomainDelayMs)} between requests.`}
              />
              <NumberInput
                name="maxPagesPerSite"
                label="Max pages per site"
                min={1}
                max={50}
                value={draft.maxPagesPerSite}
                onValueChange={(next) => patch({ maxPagesPerSite: next })}
                hint="How deep the contact-page crawl goes."
              />
              <NumberInput
                name="fetchTimeoutMs"
                label="Fetch timeout"
                min={1000}
                max={120_000}
                step={500}
                suffix="ms"
                value={draft.fetchTimeoutMs}
                onValueChange={(next) => patch({ fetchTimeoutMs: next })}
                hint={`Currently ${formatMs(draft.fetchTimeoutMs)}.`}
              />
              <NumberInput
                name="maxBodyBytes"
                label="Max response body"
                min={1024}
                max={50 * 1024 * 1024}
                step={1024}
                value={draft.maxBodyBytes}
                onValueChange={(next) => patch({ maxBodyBytes: next })}
                hint={`Currently ${formatBytes(draft.maxBodyBytes)}.`}
              />
            </div>

            <div className="mt-4 space-y-4 border-t border-ink/[0.07] pt-4">
              <Toggle
                label="Respect robots.txt"
                hint="Never fetch a path the site disallows. Turning this off is a bad idea."
                checked={draft.respectRobots}
                onChange={(next) => patch({ respectRobots: next })}
              />
              <Toggle
                label="Notifications"
                hint="Show the daily nudge on the Home screen."
                checked={draft.notifications}
                onChange={(next) => patch({ notifications: next })}
              />
            </div>
          </Card>

          <Card>
            <CardTitle hint="Seconds before a cached value is refetched">Cache TTLs</CardTitle>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {TTL_FIELDS.map((field) => {
                const value = draft.ttlSeconds[field.key] ?? 0;
                return (
                  <NumberInput
                    key={field.key}
                    name={`ttl-${field.key}`}
                    label={field.label}
                    min={0}
                    max={31_536_000}
                    step={60}
                    suffix="s"
                    value={value}
                    onValueChange={(next) =>
                      patch({ ttlSeconds: { ...draft.ttlSeconds, [field.key]: next } })
                    }
                    hint={formatDuration(value)}
                  />
                );
              })}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
            <button
              type="submit"
              disabled={!canSave}
              className={cx(
                'inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-3 text-[14px] font-extrabold text-white',
                !canSave && 'cursor-not-allowed opacity-50',
              )}
            >
              {save.isPending ? <Spinner size="sm" label="Saving" className="border-white/30 border-t-lime" /> : <IconCheck className="h-4 w-4" />}
              Save settings
            </button>
            {dirty ? <span className="text-[12px] font-bold text-muted">Unsaved changes</span> : null}
            {flash ? (
              <span role="status" className="text-[12px] font-bold text-muted">
                {flash}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}

      <Card>
        <CardTitle hint="Reported by GET /api/status">Server &amp; data</CardTitle>

        {status.isLoading ? (
          <LoadingState className="mt-3" bare label="Reading server status" rows={2} />
        ) : status.isError ? (
          <ErrorState
            className="mt-3"
            bare
            title="Server status is unavailable"
            error={status.error}
            onRetry={() => {
              void status.refetch();
            }}
          />
        ) : (
          <div className="mt-3 space-y-2.5">
            <StatRow label="Version" value={status.data?.version ?? '—'} />
            <StatRow
              label="Contact email set"
              value={status.data?.contactEmailSet ? 'yes' : 'no'}
            />
            <StatRow
              label="Discovery ready"
              value={status.data?.discoveryReady ? 'yes' : 'no'}
            />
            <StatRow label="Leads stored" value={formatNumber(status.data?.counts.leads)} />
            <StatRow label="Tasks open" value={formatNumber(status.data?.counts.tasksOpen)} />
            <StatRow label="Tasks overdue" value={formatNumber(status.data?.counts.tasksOverdue)} />
            <StatRow
              label="Crawl queue"
              value={`${formatNumber(status.data?.queue.inFlight)} in flight · ${formatNumber(status.data?.queue.pending)} pending`}
            />

            {status.data?.warning ? (
              <p className="mt-1 flex items-start gap-2 rounded-2xl bg-page px-4 py-3 text-[12px] font-medium text-ink">
                <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {status.data.warning}
              </p>
            ) : null}

            <div className="mt-3">
              <p className="text-[11px] font-bold text-muted">Data directory</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl bg-page px-3 py-2 font-mono text-[11px] text-ink">
                  {status.data?.dataDir ?? 'not reported'}
                </code>
                <button
                  type="button"
                  aria-label="Copy data directory"
                  disabled={!status.data?.dataDir}
                  onClick={() => {
                    const value = status.data?.dataDir;
                    if (value) copyDataDir(value);
                  }}
                  className={cx(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-ink/[0.06] text-ink',
                    !status.data?.dataDir && 'opacity-40',
                  )}
                >
                  {copied ? <IconCheck className="h-4 w-4" /> : <IconCopy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-[11px] font-medium text-muted">
                Everything — database, cache, exports — lives here. Nothing leaves your machine.
              </p>
            </div>

            <div className="mt-3 rounded-2xl bg-page px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                <IconLock className="h-3.5 w-3.5" />
                Attribution
              </p>
              <p className="mt-1 text-[12px] font-medium text-ink">
                {status.data?.attribution.text ??
                  '© OpenStreetMap contributors — data licensed under the Open Database License (ODbL).'}
              </p>
              <a
                href={status.data?.attribution.url ?? 'https://www.openstreetmap.org/copyright'}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-ink underline"
              >
                <IconExternal className="h-3.5 w-3.5" />
                Attribution requirements
              </a>
              {status.data?.attribution.osmBase ? (
                <p className="mt-1 text-[11px] font-medium text-muted">
                  OSM base: {status.data.attribution.osmBase}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle hint="Nominatim &amp; Overpass usage policy">How to stay unblocked</CardTitle>
        <ul className="mt-3 space-y-2 text-[12px] font-medium text-muted">
          <li>• Keep one identifying contact email on file — anonymous clients get blocked.</li>
          <li>• Leave at least one second between requests to the same host.</li>
          <li>• Keep concurrency low; a small queue finishes sooner than a banned one.</li>
          <li>• Respect robots.txt, and cache aggressively (see the TTLs above).</li>
        </ul>
        <p className="mt-3 text-[12px] font-medium text-muted">
          Discovery was last checked {relativeTime(status.dataUpdatedAt, 'a moment ago')}.
        </p>
        {status.data?.discoveryReady === false ? (
          <p className="mt-2 text-[12px] font-bold text-ink">
            Discovery is currently blocked.{' '}
            <Link to="/discover" className="underline">
              See the Discover page
            </Link>
            .
          </p>
        ) : null}
      </Card>
    </div>
  );
}
