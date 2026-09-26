import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { CATEGORIES } from '@outreach/shared';
import type { LeadRow } from '@outreach/shared';
import { Link } from 'wouter';

import { Card, CardTitle, StatRow } from '../components/Card';
import { Chip } from '../components/Chip';
import { DonutRing } from '../components/DonutRing';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';
import { Headline } from '../components/Headline';
import { PageHeader } from '../components/PageHeader';
import { ScoreRing } from '../components/ScoreRing';
import { Segmented } from '../components/Segmented';
import { SocialBadge } from '../components/SocialBadge';
import { StatusPill } from '../components/StatusPill';
import { Toggle } from '../components/Toggle';
import { WeekChart } from '../components/WeekChart';
import { IconAlert, IconCompass, IconFlame, IconPlus, IconSend } from '../components/icons';
import { describeError, listLeads } from '../lib/api';
import { cx } from '../lib/cx';
import { formatNumber, formatSignedPercent, hostFromUrl, todayISO } from '../lib/format';
import { ALL_CATEGORIES, readCategoryPref, writeCategoryPref } from '../lib/prefs';
import { keys, useCreateTask, useSaveSettings, useSettings, useStats, useStatus } from '../lib/queries';

/** One KPI tile: the reference's grey label over a very large numeral. */
function StatTile({
  label,
  value,
  superscript,
  hint,
  action,
}: {
  label: string;
  value: ReactNode;
  superscript?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <Card className="flex flex-col justify-between p-6">
      <div className="flex items-start justify-between gap-3">
        <Headline label={label} value={value} superscript={superscript} />
        {action}
      </div>
      {hint ? <p className="mt-4 text-[12px] font-medium text-muted">{hint}</p> : null}
    </Card>
  );
}

export default function Home(): ReactElement {
  const stats = useStats();
  const status = useStatus();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const createTask = useCreateTask();

  const [range, setRange] = useState<'this' | 'last'>('this');
  const [category, setCategory] = useState<string>(() => readCategoryPref());
  const [flash, setFlash] = useState<string | null>(null);

  // The single highest-scoring lead — the "call this one next" suggestion.
  const nextLeadQuery = useQuery({
    queryKey: keys.leads({ pageSize: 1, sort: 'score' }),
    queryFn: () => listLeads({ pageSize: 1, sort: 'score' }),
  });

  const displayName = settings.data?.displayName?.trim() || 'there';
  const pipeline = stats.data?.pipeline;
  const contacted = pipeline ? pipeline.contacted + pipeline.replied + pipeline.won + pipeline.lost : 0;
  const totalLeads = stats.data?.totals.leads ?? 0;
  const progressPct = totalLeads > 0 ? Math.round((contacted / totalLeads) * 100) : 0;

  const tasksDone = stats.data?.today.tasksDone ?? 0;
  const tasksOpen = stats.data?.today.tasksOpen ?? 0;
  const tasksOverdue = stats.data?.today.tasksOverdue ?? 0;

  const week = stats.data?.week;
  const deltaPct = week?.deltaPct ?? null;
  const deltaLabel = formatSignedPercent(deltaPct);
  const weekContacted = week ? week.days.reduce((sum, day) => sum + day.contacted, 0) : 0;

  const lead: LeadRow | undefined = nextLeadQuery.data?.rows[0];
  const discoveryBlocked = status.data?.discoveryReady === false;

  const applyCategory = (key: string): void => {
    writeCategoryPref(key);
    setCategory(key);
  };

  const addTaskForLead = (target: LeadRow): void => {
    setFlash(null);
    createTask.mutate(
      {
        businessId: target.id,
        title: `Call ${target.name}`,
        dueDate: todayISO(),
        channel: 'call',
        note: target.phone ? `Phone: ${target.phone}` : null,
      },
      {
        onSuccess: () => setFlash(`Task added for ${target.name}.`),
        onError: (error) => setFlash(`Could not add the task: ${describeError(error)}`),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${displayName}`}
        description={
          discoveryBlocked
            ? 'Discovery is paused until a contact is set — OpenStreetMap requires it before it will serve requests.'
            : 'Find local businesses that are missing a website, then work the list.'
        }
        actions={
          <>
            <Link
              to="/leads"
              className="inline-flex items-center gap-2 rounded-pill bg-card px-4 py-2.5 text-[13px] font-bold text-ink shadow-card"
            >
              Browse leads
            </Link>
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2.5 text-[13px] font-extrabold text-white"
            >
              <IconCompass className="h-4 w-4" />
              New search
            </Link>
          </>
        }
      />

      {discoveryBlocked ? (
        <Card className="border border-ink/10">
          <div className="flex items-start gap-4">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-pill bg-ink text-lime"
              aria-hidden="true"
            >
              <IconAlert className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-extrabold text-ink">Discovery is paused</h2>
              <p className="mt-1 max-w-2xl text-[13px] font-medium text-muted">
                {status.data?.warning ??
                  'OpenStreetMap requires a contact before it will serve requests.'}
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

      {stats.isLoading ? (
        <LoadingState label="Loading today's numbers" rows={3} />
      ) : stats.isError ? (
        <ErrorState
          title="Stats are unavailable"
          error={stats.error}
          onRetry={() => {
            void stats.refetch();
          }}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Businesses Found Today"
            value={formatNumber(stats.data?.today.leadsFound)}
            superscript={formatNumber(stats.data?.totals.leads)}
            hint={`${formatNumber(stats.data?.totals.leads)} in the workspace overall`}
          />
          <StatTile
            label="Outreach Progress"
            value={`${progressPct}%`}
            superscript={formatNumber(contacted)}
            hint={`${formatNumber(contacted)} of ${formatNumber(totalLeads)} leads contacted`}
          />
          <StatTile
            label="Tasks Completed Today"
            value={formatNumber(tasksDone)}
            superscript={formatNumber(tasksDone + tasksOpen)}
            hint={`${formatNumber(tasksOpen)} still open${
              tasksOverdue > 0 ? ` · ${formatNumber(tasksOverdue)} overdue` : ''
            }`}
          />
          <StatTile
            label="Leads Without a Website"
            value={formatNumber(stats.data?.totals.noWebsite)}
            superscript={formatNumber(stats.data?.totals.deadSite)}
            hint={`${formatNumber(stats.data?.totals.socialOnly)} are social-only`}
            action={
              <Link
                to="/leads?noWebsite=1"
                className="shrink-0 rounded-pill bg-ink/[0.06] px-3 py-1.5 text-[11px] font-extrabold text-ink"
              >
                View
              </Link>
            }
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        <WeekChart className="lg:col-span-8" days={stats.data?.week.days} />

        <Card className="lg:col-span-4">
          <CardTitle hint="Today's to-do list">Tasks</CardTitle>
          <div className="mt-5 flex items-center gap-6">
            <DonutRing
              value={tasksDone}
              max={tasksDone + tasksOpen}
              label="done"
              caption={`${formatNumber(tasksDone)} / ${formatNumber(tasksDone + tasksOpen)}`}
              size={132}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <StatRow label="Done today" value={formatNumber(tasksDone)} dot="#d7f94e" />
              <StatRow label="Still open" value={formatNumber(tasksOpen)} dot="#7bd3c8" />
              <StatRow label="Overdue" value={formatNumber(tasksOverdue)} dot="#0c0d0c" />
            </div>
          </div>
          <Link
            to="/outreach"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-pill bg-ink px-4 py-2.5 text-[13px] font-extrabold text-white"
          >
            <IconSend className="h-4 w-4" />
            Open today&apos;s list
          </Link>
        </Card>

        <Card className="lg:col-span-5">
          <CardTitle
            hint={range === 'this' ? 'This week at a glance' : 'Only the change is tracked'}
            action={
              <span
                className={cx(
                  'shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-extrabold tabular-nums',
                  deltaPct === null
                    ? 'bg-ink/[0.06] text-muted'
                    : deltaPct >= 0
                      ? 'bg-lime text-ink'
                      : 'bg-ink text-white',
                )}
              >
                {deltaLabel ?? '—'}
              </span>
            }
          >
            Weekly Productivity
          </CardTitle>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              ariaLabel="Which week to show"
              value={range}
              onValueChange={setRange}
              options={[
                { value: 'this', label: 'This Week' },
                { value: 'last', label: 'Last Week' },
              ]}
            />
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-ink/[0.06] px-3 py-1.5 text-[11px] font-extrabold text-ink">
              <IconFlame className="h-3.5 w-3.5" />
              {formatNumber(stats.data?.streak)} day streak
            </span>
          </div>

          {range === 'this' ? (
            <div className="mt-5 space-y-3">
              <StatRow label="Tasks completed" value={formatNumber(week?.tasksDone)} dot="#d7f94e" />
              <StatRow label="Leads found" value={formatNumber(week?.leadsFound)} dot="#7bd3c8" />
              <StatRow label="Leads contacted" value={formatNumber(weekContacted)} dot="#b6e8ae" />
            </div>
          ) : (
            <p className="mt-5 rounded-2xl bg-page/80 px-4 py-3 text-[13px] font-medium text-muted">
              Last week&apos;s breakdown is not stored — only the change is tracked
              {deltaLabel ? ` (${deltaLabel} versus this week)` : ''}.
            </p>
          )}

          <div className="mt-5 border-t border-ink/[0.07] pt-4">
            <Toggle
              label="Notifications"
              hint="A nudge when the day's list is still open"
              checked={settings.data?.notifications ?? true}
              disabled={!settings.data || saveSettings.isPending}
              busy={saveSettings.isPending}
              onChange={(next) => {
                if (!settings.data) return;
                saveSettings.mutate({ ...settings.data, notifications: next });
              }}
            />
          </div>
        </Card>

        <Card className="lg:col-span-7">
          <CardTitle hint="Highest score still on the list">Next lead to contact</CardTitle>

          {nextLeadQuery.isLoading ? (
            <LoadingState className="mt-4" bare label="Finding the best lead" rows={1} />
          ) : nextLeadQuery.isError ? (
            <ErrorState
              className="mt-4"
              bare
              title="Leads are unavailable"
              error={nextLeadQuery.error}
              onRetry={() => {
                void nextLeadQuery.refetch();
              }}
            />
          ) : !lead ? (
            <EmptyState
              className="mt-4"
              bare
              icon={<IconCompass className="h-5 w-5" />}
              title="No leads yet"
              body="Run a discovery to fill the list with local businesses."
              action={
                <Link
                  to="/discover"
                  className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white"
                >
                  Open Discover
                </Link>
              }
            />
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
                <ScoreRing score={lead.score} size={84} caption="score" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/leads/${lead.id}`}
                    className="block truncate text-[19px] font-extrabold tracking-[-0.03em] text-ink hover:underline"
                  >
                    {lead.name}
                  </Link>
                  <p className="mt-1 truncate text-[13px] font-medium text-muted">
                    {[
                      lead.categoryLabel ?? lead.category,
                      lead.city,
                      hostFromUrl(lead.websiteUrl, 'no website'),
                    ]
                      .filter((part) => Boolean(part))
                      .join(' · ')}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusPill state={lead.siteState} size="sm" />
                    {lead.socials.slice(0, 3).map((social) => (
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
                  <div className="mt-4 flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => addTaskForLead(lead)}
                      disabled={createTask.isPending}
                      className="inline-flex items-center gap-2 rounded-pill bg-lime px-4 py-2 text-[12px] font-extrabold text-ink disabled:opacity-60"
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                      {createTask.isPending ? 'Adding…' : 'Add a call task'}
                    </button>
                    <Link
                      to={`/leads/${lead.id}`}
                      className="inline-flex items-center gap-2 rounded-pill bg-ink/[0.06] px-4 py-2 text-[12px] font-extrabold text-ink"
                    >
                      View lead
                    </Link>
                  </div>
                </div>
              </div>
              {flash ? (
                <p role="status" className="mt-3 text-[12px] font-bold text-muted">
                  {flash}
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle hint="Chosen category filters the Leads page">Browse by category</CardTitle>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip selected={category === ALL_CATEGORIES} onClick={() => applyCategory(ALL_CATEGORIES)}>
            All categories
          </Chip>
          {CATEGORIES.map((item) => (
            <Chip
              key={item.key}
              selected={category === item.key}
              onClick={() => applyCategory(item.key)}
            >
              <span aria-hidden="true">{item.emoji}</span>
              {item.label}
            </Chip>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Link
            to={category === ALL_CATEGORIES ? '/leads' : `/leads?category=${encodeURIComponent(category)}`}
            className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2 text-[12px] font-extrabold text-white"
          >
            Open these leads
          </Link>
          <span className="text-[12px] font-medium text-muted">
            {category === ALL_CATEGORIES
              ? 'Showing every category'
              : `Filtered to ${CATEGORIES.find((item) => item.key === category)?.label ?? category}`}
          </span>
        </div>
      </Card>
    </div>
  );
}
