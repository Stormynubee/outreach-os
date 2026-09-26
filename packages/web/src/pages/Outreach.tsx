import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { PIPELINE_STAGES, type TaskRow, type TaskStatus } from '@outreach/shared';
import { Link } from 'wouter';

import { Card, CardTitle } from '../components/Card';
import { EmptyState, ErrorState, LoadingState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { WeekChart } from '../components/WeekChart';
import { IconCheck, IconChevronRight, IconPlus, IconSend } from '../components/icons';
import { Spinner } from '../components/Spinner';
import { describeError } from '../lib/api';
import { cx } from '../lib/cx';
import { formatDate, formatNumber, todayISO } from '../lib/format';
import { CHANNEL_LABELS, PIPELINE_LABELS } from '../lib/labels';
import { useCreateTask, useStats, useTasksForDay, useToggleTask } from '../lib/queries';

export default function Outreach(): ReactElement {
  const date = todayISO();
  const tasks = useTasksForDay(date);
  const stats = useStats();
  const toggle = useToggleTask(date);
  const createTask = useCreateTask();

  const [quickTitle, setQuickTitle] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const day = tasks.data;
  const groups: Array<{ key: string; title: string; hint: string; rows: TaskRow[] }> = day
    ? [
        { key: 'overdue', title: 'Overdue', hint: 'Rolled over from earlier days', rows: day.overdue },
        { key: 'today', title: 'Today', hint: 'Due today', rows: day.open },
        { key: 'done', title: 'Done today', hint: 'Ticked off today', rows: day.done },
        { key: 'upcoming', title: 'Upcoming', hint: 'Scheduled for later', rows: day.upcoming },
      ]
    : [];

  const totalRows = groups.reduce((sum, group) => sum + group.rows.length, 0);

  const onToggle = (task: TaskRow, next: TaskStatus): void => {
    setFlash(null);
    toggle.mutate(
      { id: task.id, status: next },
      { onError: (error) => setFlash(describeError(error)) },
    );
  };

  const submitQuickAdd = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    setFlash(null);
    createTask.mutate(
      { title, dueDate: date },
      {
        onSuccess: () => {
          setQuickTitle('');
          setFlash('Task added.');
        },
        onError: (error) => setFlash(describeError(error)),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Outreach"
        description={`${formatDate(date)} · ${formatNumber(totalRows)} tasks on the board · ${formatNumber(
          stats.data?.today.tasksOpen,
        )} still open`}
        actions={
          <Link
            to="/leads"
            className="inline-flex items-center gap-2 rounded-pill bg-card px-4 py-2.5 text-[13px] font-bold text-ink shadow-card"
          >
            <IconSend className="h-4 w-4" />
            Find more leads
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {PIPELINE_STAGES.map((stage) => (
          <div key={stage} className="rounded-card bg-card p-4 shadow-card">
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
              {PIPELINE_LABELS[stage]}
            </p>
            <p className="mt-1.5 text-[28px] font-extrabold tabular-nums tracking-[-0.03em] text-ink">
              {formatNumber(stats.data?.pipeline[stage])}
            </p>
          </div>
        ))}
      </div>

      <Card>
        <form className="flex items-center gap-3" onSubmit={submitQuickAdd}>
          <div className="relative flex-1">
            <label htmlFor="quick-task" className="sr-only">
              New task title
            </label>
            <input
              id="quick-task"
              name="quick-task"
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              placeholder="Add a task for today…"
              autoComplete="off"
              className="w-full rounded-pill border border-ink/10 bg-page/70 px-5 py-3 text-[14px] font-semibold text-ink placeholder:font-medium placeholder:text-muted focus:border-ink/25 focus:bg-white focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={createTask.isPending || quickTitle.trim().length === 0}
            className={cx(
              'inline-flex h-12 shrink-0 items-center gap-2 rounded-pill bg-lime px-5 text-[13px] font-extrabold text-ink transition-transform active:scale-95',
              (createTask.isPending || quickTitle.trim().length === 0) && 'opacity-50',
            )}
          >
            {createTask.isPending ? (
              <Spinner size="sm" label="Adding" />
            ) : (
              <IconPlus className="h-4 w-4" />
            )}
            Add task
          </button>
        </form>
        {flash ? (
          <p role="status" className="mt-2.5 text-[12px] font-bold text-muted">
            {flash}
          </p>
        ) : null}
      </Card>

      {tasks.isLoading ? (
        <LoadingState label="Loading today's tasks" rows={4} />
      ) : tasks.isError ? (
        <ErrorState
          title="Today's tasks could not be loaded"
          error={tasks.error}
          onRetry={() => {
            void tasks.refetch();
          }}
        />
      ) : totalRows === 0 ? (
        <EmptyState
          icon={<IconSend className="h-5 w-5" />}
          title="Nothing on the list today"
          body="Add a task above, or open a lead and use “Add to to-do”."
          action={
            <Link to="/leads" className="rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white">
              Browse leads
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            {groups.map((group) =>
              group.rows.length === 0 ? null : (
                <section key={group.key} className="space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-section text-ink">{group.title}</h2>
                    <span className="text-[12px] font-semibold text-muted">
                      {group.hint} · {formatNumber(group.rows.length)}
                    </span>
                  </div>
                  <ul className="space-y-2.5">
                    {group.rows.map((task) => (
                      <TaskItem key={task.id} task={task} busy={toggle.isPending} onToggle={onToggle} />
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>

          <div className="lg:col-span-5">
            <WeekChart days={stats.data?.week.days} />
          </div>
        </div>
      )}
    </div>
  );
}

function TaskItem({
  task,
  busy,
  onToggle,
}: {
  task: TaskRow;
  busy: boolean;
  onToggle: (task: TaskRow, next: TaskStatus) => void;
}): ReactElement {
  const done = task.status === 'done';
  const meta = [
    task.businessName,
    task.businessScore === null ? null : `score ${formatNumber(task.businessScore)}`,
    task.channel ? CHANNEL_LABELS[task.channel] ?? task.channel : null,
    task.businessSiteState ? task.businessSiteState.replace(/_/g, ' ') : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <li className={cx('flex items-start gap-3 rounded-card bg-card p-4 shadow-card', done && 'opacity-70')}>
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-2xl">
        <span className="relative mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={done}
            disabled={busy}
            onChange={() => onToggle(task, done ? 'open' : 'done')}
            aria-label={`Mark "${task.title}" as ${done ? 'open' : 'done'}`}
            className="h-6 w-6 cursor-pointer appearance-none rounded-lg border-2 border-ink/15 bg-white transition-colors checked:border-ink checked:bg-ink"
          />
          {done ? (
            <IconCheck className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-white" />
          ) : null}
        </span>
        <span className="min-w-0">
          <span
            className={cx(
              'block text-[15px] font-bold tracking-[-0.01em] text-ink',
              done && 'text-muted line-through',
            )}
          >
            {task.title}
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-muted">
            {meta || `due ${task.dueDate || 'unscheduled'}`}
          </span>
          {task.note ? (
            <span className="mt-0.5 block truncate text-[11px] font-medium text-muted">{task.note}</span>
          ) : null}
        </span>
      </label>

      {task.businessId ? (
        <Link
          to={`/leads/${task.businessId}`}
          aria-label={`Open ${task.businessName ?? 'the linked lead'}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-ink/[0.06] text-ink"
        >
          <IconChevronRight className="h-4 w-4" />
        </Link>
      ) : null}
    </li>
  );
}
