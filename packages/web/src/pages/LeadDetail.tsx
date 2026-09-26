import { useEffect, useId, useState } from 'react';
import type { FormEvent, ReactElement, ReactNode } from 'react';

import {
  FOLLOWERS_REASONS,
  PIPELINE_STAGES,
  SITE_STATE_LABELS,
  magnitudeTier,
  scoreLead,
  type PipelineStage,
  type SocialRef,
} from '@outreach/shared';
import { Link, useParams } from 'wouter';

import { Card, CardTitle, StatRow } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';
import { Field, inputClass, textareaClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { ScoreRing } from '../components/ScoreRing';
import { Segmented } from '../components/Segmented';
import { SocialBadge } from '../components/SocialBadge';
import { StatusPill } from '../components/StatusPill';
import { Spinner } from '../components/Spinner';
import { IconArrowLeft, IconCheck, IconExternal, IconPlus } from '../components/icons';
import { describeError } from '../lib/api';
import { cx } from '../lib/cx';
import { formatNumber, formatPercent, prettyUrl, relativeTime, todayISO } from '../lib/format';
import { EMAIL_KIND_LABELS, PIPELINE_LABELS, toOfferPreset } from '../lib/labels';
import {
  useCreateTask,
  useLead,
  useSettings,
  useSocialOverride,
  useStatus,
  useUpdateLead,
} from '../lib/queries';

const STAGE_OPTIONS = PIPELINE_STAGES.map((stage) => ({ value: stage, label: PIPELINE_LABELS[stage] }));

export default function LeadDetailPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const lead = useLead(id);
  const status = useStatus();
  const settings = useSettings();
  const updateLead = useUpdateLead(id);
  const createTask = useCreateTask();

  const [notes, setNotes] = useState('');
  const [notesTouched, setNotesTouched] = useState(false);
  const [notesFlash, setNotesFlash] = useState<string | null>(null);
  const [taskFlash, setTaskFlash] = useState<string | null>(null);

  useEffect(() => {
    if (lead.data && !notesTouched) setNotes(lead.data.notes ?? '');
  }, [lead.data, notesTouched]);

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <EmptyState
        title="That lead id does not look right"
        body="Open the leads list and pick a business instead."
        action={
          <Link to="/leads" className="rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white">
            Back to leads
          </Link>
        }
      />
    );
  }

  const backLink = (
    <Link
      to="/leads"
      aria-label="Back to leads"
      className="inline-flex items-center gap-2 rounded-pill bg-card px-3.5 py-2 text-[12px] font-extrabold text-ink shadow-card"
    >
      <IconArrowLeft className="h-3.5 w-3.5" />
      Leads
    </Link>
  );

  if (lead.isLoading) {
    return (
      <div className="space-y-4">
        {backLink}
        <LoadingState label="Loading this business" rows={4} />
      </div>
    );
  }

  if (lead.isError || !lead.data) {
    return (
      <div className="space-y-4">
        {backLink}
        <ErrorState
          title="This lead could not be loaded"
          error={lead.error ?? new Error('The server returned no lead.')}
          onRetry={() => {
            void lead.refetch();
          }}
        />
      </div>
    );
  }

  const data = lead.data;
  const osmBase = (status.data?.attribution.osmBase ?? 'https://www.openstreetmap.org').replace(/\/$/, '');
  const osmLink = data.osmKey ? `${osmBase}/${data.osmKey}` : null;
  const preset = toOfferPreset(settings.data?.primaryOffer);
  const followersKnown = data.followersKnown > 0;
  const breakdown = scoreLead({
    siteState: data.siteState,
    hasPhone: data.hasPhone,
    hasEmail: data.hasEmail,
    hasSocial: data.hasSocial,
    magnitudeTier: magnitudeTier(data.followersTotal, followersKnown ? 'known' : 'unknown'),
    websiteProbed: data.enrichmentStage !== 'none',
    contactsExtracted: data.emails.length > 0 || data.phones.length > 0,
    socialsChecked: data.socialDetails.some((social) => social.followersState === 'known'),
    preset,
  });

  const changeStage = (next: PipelineStage): void => {
    updateLead.mutate({ pipelineStage: next });
  };

  const saveNotes = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setNotesFlash(null);
    updateLead.mutate(
      { notes: notes.trim() ? notes : null },
      {
        onSuccess: () => {
          setNotesTouched(false);
          setNotesFlash('Notes saved.');
        },
        onError: (error) => setNotesFlash(describeError(error)),
      },
    );
  };

  const addTodo = (): void => {
    setTaskFlash(null);
    createTask.mutate(
      {
        businessId: data.id,
        title: `Follow up with ${data.name}`,
        dueDate: todayISO(),
        channel: 'call',
        note: data.phone ? `Phone: ${data.phone}` : null,
      },
      {
        onSuccess: () => setTaskFlash(`Added to today's list.`),
        onError: (error) => setTaskFlash(describeError(error)),
      },
    );
  };

  return (
    <div className="space-y-6">
      {backLink}

      <PageHeader
        eyebrow={[data.categoryLabel ?? data.category, data.city, data.countryCode]
          .filter((part): part is string => Boolean(part))
          .join(' · ')}
        title={data.name}
        description={`${PIPELINE_LABELS[data.pipelineStage]} · score ${formatNumber(data.score)} · first seen ${relativeTime(
          data.firstSeenAt,
          'recently',
        )}`}
        actions={
          <>
            {data.phone ? (
              <a
                href={`tel:${data.phone}`}
                className="rounded-pill bg-ink px-4 py-2.5 text-[13px] font-extrabold text-white"
              >
                Call {data.phone}
              </a>
            ) : null}
            {data.email ? (
              <a
                href={`mailto:${data.email}`}
                className="rounded-pill bg-card px-4 py-2.5 text-[13px] font-extrabold text-ink shadow-card"
              >
                Email
              </a>
            ) : null}
            <button
              type="button"
              onClick={addTodo}
              disabled={createTask.isPending}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-pill bg-lime px-4 py-2.5 text-[13px] font-extrabold text-ink',
                createTask.isPending && 'opacity-60',
              )}
            >
              {createTask.isPending ? <Spinner size="sm" label="Adding" /> : <IconPlus className="h-3.5 w-3.5" />}
              Add to to-do
            </button>
          </>
        }
      />

      {taskFlash ? (
        <p role="status" className="text-[12px] font-bold text-muted">
          {taskFlash}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <Card>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <ScoreRing score={data.score} size={96} caption="score" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill state={data.siteState} />
                  <span className="rounded-pill bg-ink/[0.05] px-2.5 py-1 text-[11px] font-bold text-muted">
                    {SITE_STATE_LABELS[data.siteState]}
                  </span>
                  {data.hasVideo ? (
                    <span className="rounded-pill bg-teal/40 px-2.5 py-1 text-[11px] font-bold text-ink">
                      video
                    </span>
                  ) : null}
                  {data.hasSsl ? (
                    <span className="rounded-pill bg-sage/70 px-2.5 py-1 text-[11px] font-bold text-ink">
                      SSL
                    </span>
                  ) : null}
                </div>

                <p className="mt-4 mb-2 text-[12px] font-bold text-ink">
                  Pipeline stage
                  {updateLead.isPending ? (
                    <span className="ml-2 font-semibold text-muted">saving…</span>
                  ) : null}
                </p>
                <Segmented
                  ariaLabel="Pipeline stage"
                  value={data.pipelineStage}
                  onValueChange={changeStage}
                  options={STAGE_OPTIONS}
                  size="sm"
                />
                {updateLead.isError ? (
                  <p role="alert" className="mt-2 text-[12px] font-semibold text-ink">
                    {describeError(updateLead.error)}
                  </p>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle
              hint={`${formatNumber(data.emails.length)} emails · ${formatNumber(data.phones.length)} phones`}
            >
              Contacts
            </CardTitle>

            {data.emails.length === 0 && data.phones.length === 0 ? (
              <EmptyState
                className="mt-3"
                bare
                title="No contacts found"
                body="This business has no reachable email or phone in the record yet."
              />
            ) : (
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold tracking-[0.06em] uppercase text-muted">Emails</p>
                  {data.emails.length === 0 ? (
                    <p className="mt-1.5 text-[13px] font-medium text-muted">None found.</p>
                  ) : (
                    <ul className="mt-2 space-y-2.5">
                      {data.emails.map((email) => {
                        const muted = email.kind === 'noreply';
                        return (
                          <li key={email.id} className="flex flex-wrap items-center gap-2">
                            <a
                              href={`mailto:${email.address}`}
                              className={cx(
                                'truncate text-[13px] font-bold',
                                muted ? 'text-muted' : 'text-ink underline',
                              )}
                            >
                              {email.address}
                            </a>
                            <span className="rounded-pill bg-ink/[0.05] px-2 py-0.5 text-[10px] font-extrabold text-muted">
                              {EMAIL_KIND_LABELS[email.kind]}
                            </span>
                            <span className="text-[11px] font-medium text-muted">
                              {email.source} · {formatPercent(email.confidence)}
                            </span>
                            {muted ? (
                              <span className="text-[11px] font-semibold text-muted">
                                automated address, not a human
                              </span>
                            ) : null}
                            {email.sourceUrl ? (
                              <a
                                href={email.sourceUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-[11px] font-bold text-muted underline"
                              >
                                source
                              </a>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-bold tracking-[0.06em] uppercase text-muted">Phones</p>
                  {data.phones.length === 0 ? (
                    <p className="mt-1.5 text-[13px] font-medium text-muted">None found.</p>
                  ) : (
                    <ul className="mt-2 space-y-2.5">
                      {data.phones.map((phone) => {
                        const rejected = Boolean(phone.rejectReason);
                        return (
                          <li key={phone.id}>
                            <div className="flex flex-wrap items-center gap-2">
                              <a
                                href={`tel:${phone.e164 ?? phone.raw}`}
                                className={cx(
                                  'text-[13px] font-bold',
                                  rejected ? 'text-muted' : 'text-ink underline',
                                )}
                              >
                                {phone.e164 ?? phone.raw}
                              </a>
                              {phone.isWhatsapp ? (
                                <span className="rounded-pill bg-lime px-2 py-0.5 text-[10px] font-extrabold text-ink">
                                  WhatsApp
                                </span>
                              ) : null}
                              {phone.isMobile ? (
                                <span className="rounded-pill bg-ink/[0.05] px-2 py-0.5 text-[10px] font-extrabold text-muted">
                                  Mobile
                                </span>
                              ) : null}
                              <span className="text-[11px] font-medium text-muted">
                                {phone.source} · {formatPercent(phone.confidence)}
                              </span>
                            </div>
                            {phone.rejectReason ? (
                              <p className="mt-0.5 text-[11px] font-medium text-muted">
                                Rejected: {phone.rejectReason}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle hint="Follower counts can be corrected by hand">Social accounts</CardTitle>

            {data.socialDetails.length === 0 ? (
              <EmptyState
                className="mt-3"
                bare
                title="No social accounts linked"
                body="Nothing was found on the website or in the OSM tags."
              />
            ) : (
              <ul className="mt-4 grid gap-3 xl:grid-cols-2">
                {data.socialDetails.map((social) => (
                  <SocialRow key={social.id} leadId={data.id} social={social} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle hint={data.websiteDomain ?? 'no domain on file'}>Website audit</CardTitle>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusPill state={data.siteState} />
              <span
                className={cx(
                  'rounded-pill px-2.5 py-1 text-[11px] font-bold',
                  data.hasSsl ? 'bg-sage/70 text-ink' : 'bg-ink/[0.05] text-muted',
                )}
              >
                {data.hasSsl ? 'Valid SSL' : 'No valid SSL'}
              </span>
              {data.platform ? (
                <span className="rounded-pill bg-teal/40 px-2.5 py-1 text-[11px] font-bold text-ink">
                  {data.platform}
                </span>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              <StatRow
                label="Final URL"
                value={
                  data.finalUrl ? (
                    <a
                      href={data.finalUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline"
                      title={data.finalUrl}
                    >
                      {prettyUrl(data.finalUrl)}
                    </a>
                  ) : (
                    'not probed'
                  )
                }
              />
              <StatRow
                label="HTTP status"
                value={data.httpStatus === null ? '—' : formatNumber(data.httpStatus)}
              />
              <StatRow label="Page title" value={data.siteTitle ?? '—'} />
              <StatRow
                label="OSM website tag"
                value={
                  data.websiteUrl ? (
                    <a
                      href={data.websiteUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline"
                    >
                      {prettyUrl(data.websiteUrl)}
                    </a>
                  ) : (
                    'none — business lists no website'
                  )
                }
              />
              <StatRow label="Enrichment stage" value={data.enrichmentStage} />
              <StatRow label="Enriched" value={relativeTime(data.enrichedAt, 'never')} />
              <StatRow label="Last error stage" value={data.lastErrorStage ?? '—'} />
            </div>

            {data.enrichmentError ? (
              <p className="mt-4 rounded-2xl bg-page/80 px-4 py-3 text-[12px] font-medium text-muted">
                {data.enrichmentError}
              </p>
            ) : null}

            <div className="mt-4 rounded-2xl bg-page/80 p-4">
              <p className="text-[11px] font-bold text-muted">Parking / for-sale evidence</p>
              {data.parkingEvidence.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {data.parkingEvidence.map((line, index) => (
                    <li key={`${index}-${line}`} className="text-[12px] font-medium text-muted">
                      • {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[12px] font-medium text-muted">
                  Nothing found — no parked-domain signals detected.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <form onSubmit={saveNotes}>
              <CardTitle hint="Private to this app">Notes</CardTitle>
              <div className="mt-4">
                <Field label="Notes about this business" htmlFor="lead-notes">
                  <textarea
                    id="lead-notes"
                    className={textareaClass}
                    rows={5}
                    value={notes}
                    placeholder="Owner name, opening hours, what they said…"
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setNotesTouched(true);
                    }}
                  />
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={updateLead.isPending}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-pill bg-ink px-4 py-2.5 text-[13px] font-extrabold text-white',
                    updateLead.isPending && 'opacity-60',
                  )}
                >
                  {updateLead.isPending ? (
                    <Spinner size="sm" label="Saving" className="border-white/30 border-t-lime" />
                  ) : (
                    <IconCheck className="h-3.5 w-3.5" />
                  )}
                  Save notes
                </button>
                {notesTouched ? (
                  <span className="text-[11px] font-bold text-muted">Unsaved changes</span>
                ) : null}
                {notesFlash ? (
                  <span role="status" className="text-[12px] font-bold text-muted">
                    {notesFlash}
                  </span>
                ) : null}
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <Card>
            <CardTitle hint={`Confidence ${formatPercent(data.confidenceFactor)}`}>
              Why this score
            </CardTitle>
            <div className="mt-4 flex items-center gap-5">
              <ScoreRing score={data.score} size={92} caption="score" />
              <div className="min-w-0 flex-1 space-y-3">
                <ProgressBar label="Website gap" value={breakdown.webGap} max={55} />
                <ProgressBar label="Contactability" value={breakdown.contactability} max={30} />
                <ProgressBar label="Social presence" value={breakdown.presence} max={15} />
              </div>
            </div>

            <div className="mt-5 border-t border-ink/[0.07] pt-4">
              <p className="text-[11px] font-bold text-muted">Score reasons reported by the server</p>
              {data.scoreReasons.length > 0 ? (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {data.scoreReasons.map((reason, index) => (
                    <li key={`${index}-${reason}`}>
                      <Chip>{reason}</Chip>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[12px] font-medium text-muted">
                  The server reported no reasons for this lead.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle hint="Where the record came from">Business</CardTitle>
            <div className="mt-4 space-y-3">
              <StatRow label="Address" value={data.addressLine ?? data.street ?? '—'} />
              <StatRow label="Postcode" value={data.postcode ?? '—'} />
              <StatRow
                label="Coordinates"
                value={
                  data.lat !== null && data.lon !== null
                    ? `${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`
                    : '—'
                }
              />
              <StatRow label="OSM type" value={data.osmType || '—'} />
              <StatRow label="First seen" value={relativeTime(data.firstSeenAt, 'unknown')} />
              <StatRow label="Last scored" value={relativeTime(data.scoredAt, 'never')} />
              <StatRow label="Assignee" value={data.assignee ?? 'unassigned'} />
            </div>
            {osmLink ? (
              <a
                href={osmLink}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-ink underline"
              >
                <IconExternal className="h-3.5 w-3.5" />
                View {data.osmKey} on OpenStreetMap
              </a>
            ) : (
              <p className="mt-4 text-[12px] font-medium text-muted">
                No OSM key recorded for this business.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle hint={`${formatNumber(data.tasks.length)} linked`}>Tasks</CardTitle>
            {data.tasks.length === 0 ? (
              <EmptyState
                className="mt-3"
                bare
                title="No tasks yet"
                body="Use “Add to to-do” above to put this business on today's list."
              />
            ) : (
              <ul className="mt-4 space-y-2">
                {data.tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-page/70 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-ink">{task.title}</span>
                      <span className="block text-[11px] font-medium text-muted">
                        due {task.dueDate || 'unscheduled'} · {task.status}
                      </span>
                    </span>
                    <span
                      className={cx(
                        'shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-extrabold',
                        task.status === 'done' ? 'bg-lime text-ink' : 'bg-ink/[0.06] text-muted',
                      )}
                    >
                      {task.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SocialRow({ leadId, social }: { leadId: number; social: SocialRef }): ReactElement {
  const mutation = useSocialOverride(leadId);
  const [text, setText] = useState(() => (social.manualOverride === null ? '' : String(social.manualOverride)));
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    setText(social.manualOverride === null ? '' : String(social.manualOverride));
  }, [social.manualOverride]);

  const reasonText = social.followersReason
    ? FOLLOWERS_REASONS[social.followersReason] ?? social.followersReason
    : FOLLOWERS_REASONS[social.followersState] ?? null;

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFlash(null);
    const trimmed = text.trim();

    let next: number | null = null;
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) {
        setError('Enter a whole number of followers, or clear the box.');
        return;
      }
      next = parsed;
    }

    setError(null);
    mutation.mutate(
      { socialId: social.id, manualOverride: next },
      {
        onSuccess: () => setFlash(next === null ? 'Override cleared.' : 'Override saved.'),
        onError: (cause) => setError(describeError(cause)),
      },
    );
  };

  return (
    <li className="rounded-2xl bg-page/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SocialBadge
          platform={social.platform}
          followers={social.followers}
          followersState={social.followersState}
          followersReason={social.followersReason}
          manualOverride={social.manualOverride}
          url={social.url}
        />
        <span className="truncate text-[11px] font-semibold text-muted">
          {social.handle ? `@${social.handle.replace(/^@/, '')}` : prettyUrl(social.url)}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Row label="Scraped count" value={social.followers === null ? 'not available' : formatNumber(social.followers)} />
        <Row label="State" value={social.followersState} />
        <Row label="Why" value={reasonText ?? '—'} />
        <Row label="Source" value={social.followersSource ?? '—'} />
        <Row label="Found via" value={social.discoverySource} />
        <Row label="Last checked" value={relativeTime(social.lastCheckedAt, 'never')} />
        <Row label="Has video" value={social.hasVideo ? 'yes' : 'no'} />
        <Row
          label="Manual override"
          value={social.manualOverride === null ? 'none' : formatNumber(social.manualOverride)}
        />
      </dl>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={save}>
        <div className="w-[168px]">
          <Field label="Set followers by hand" htmlFor={inputId}>
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={text}
              placeholder="e.g. 1450"
              onChange={(event) => setText(event.target.value)}
              className={cx(inputClass, 'tabular-nums')}
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-pill bg-ink px-4 py-3 text-[12px] font-extrabold text-white',
            mutation.isPending && 'opacity-60',
          )}
        >
          {mutation.isPending ? <Spinner size="sm" label="Saving" className="border-white/30 border-t-lime" /> : null}
          Save
        </button>
        {social.manualOverride !== null ? (
          <button
            type="button"
            onClick={() => {
              setText('');
              setError(null);
              mutation.mutate({ socialId: social.id, manualOverride: null });
            }}
            className="text-[12px] font-extrabold text-muted underline"
          >
            Clear override
          </button>
        ) : null}
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] font-bold text-ink">
          {error}
        </p>
      ) : null}
      {flash ? (
        <p role="status" className="mt-2 text-[11px] font-bold text-muted">
          {flash}
        </p>
      ) : null}
    </li>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold tracking-[0.04em] text-muted uppercase">{label}</dt>
      <dd className="truncate text-[12px] font-semibold text-ink">{value}</dd>
    </div>
  );
}
