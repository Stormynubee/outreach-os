import { useState } from 'react';
import type { ReactElement } from 'react';

import type { DailyStat } from '@outreach/shared';

import { cx } from '../lib/cx';
import { formatNumber, mondayIndex } from '../lib/format';

export interface WeekChartProps {
  days?: DailyStat[] | null;
  className?: string;
}

type Range = 'weekly' | 'monthly';

interface Slot {
  label: string;
  tasks: number;
  leads: number;
  contacted: number;
  isToday: boolean;
  hasData: boolean;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Padding inside the SVG so the lime line never clips against the card edge. */
const Y_TOP = 26;
const Y_BOTTOM = 188;
const VIEW_H = 200;

function buildSlots(days: DailyStat[] | null | undefined): Slot[] {
  const list = Array.isArray(days) ? days.slice(-7) : [];
  const todayIndex = mondayIndex();

  // Align each stat to the weekday it actually belongs to when the dates parse.
  const byWeekday = new Map<number, DailyStat>();
  for (const day of list) {
    const parsed = Date.parse(`${day.day}T00:00:00`);
    if (!Number.isFinite(parsed)) continue;
    const index = mondayIndex(new Date(parsed));
    if (!byWeekday.has(index)) byWeekday.set(index, day);
  }
  const useWeekday = list.length > 0 && byWeekday.size >= Math.ceil(list.length / 2);

  return DAY_LABELS.map((label, index) => {
    const stat = useWeekday ? byWeekday.get(index) : list[index];
    return {
      label,
      tasks: stat?.tasksDone ?? 0,
      leads: stat?.leadsFound ?? 0,
      contacted: stat?.contacted ?? 0,
      isToday: index === todayIndex,
      hasData: stat !== undefined,
    };
  });
}

/**
 * The black chart card: 7 chunky white bars (Mon–Sun), a lime line over them,
 * a thinner teal line, and today's bar drawn as a dashed outline instead of solid.
 * Pure SVG + layout — no charting library.
 */
export function WeekChart({ days, className }: WeekChartProps): ReactElement {
  const [range, setRange] = useState<Range>('weekly');
  const slots = buildSlots(days);

  const max = Math.max(
    1,
    ...slots.map((slot) => Math.max(slot.tasks, slot.leads, slot.contacted)),
  );
  const totalTasks = slots.reduce((sum, slot) => sum + slot.tasks, 0);
  const totalLeads = slots.reduce((sum, slot) => sum + slot.leads, 0);
  const totalContacted = slots.reduce((sum, slot) => sum + slot.contacted, 0);
  const hasAny = totalTasks + totalLeads + totalContacted > 0;

  const yFor = (value: number): number => Y_BOTTOM - (value / max) * (Y_BOTTOM - Y_TOP);
  const pointsFor = (pick: (slot: Slot) => number): string =>
    slots.map((slot, index) => `${(index + 0.5) * 100},${yFor(pick(slot))}`).join(' ');

  /**
   * With no activity every bar would be a 3% sliver, which reads as a broken
   * chart. Draw a consistent resting height instead so the card looks the same
   * whether or not there is data behind it.
   */
  const barHeightPct = (value: number): number =>
    hasAny ? Math.max((value / max) * 100, 4) : 34;

  return (
    <section className={cx('rounded-card-lg bg-ink p-6 text-white shadow-card lg:p-7', className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-section text-white">Activity</h2>
          <p className="mt-1 text-[12px] font-medium text-white/50">
            Tasks completed, leads found and businesses contacted
          </p>
        </div>

        <label className="relative inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-white/10 px-3.5 py-2 text-[12px] font-bold text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lime/60">
          <span aria-hidden="true">{range === 'weekly' ? 'This week' : 'This month'}</span>
          <span aria-hidden="true">▾</span>
          <select
            aria-label="Chart range"
            value={range}
            onChange={(event) => setRange(event.target.value === 'monthly' ? 'monthly' : 'weekly')}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
          >
            <option value="weekly">This week</option>
            <option value="monthly">This month</option>
          </select>
        </label>
      </div>

      <ul className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        {[
          { label: 'Tasks completed', color: '#ffffff' },
          { label: 'Leads found', color: 'var(--color-lime)' },
          { label: 'Contacted', color: 'var(--color-teal)' },
        ].map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-[12px] font-bold text-white/55">
            <span
              className="h-2 w-2 rounded-pill"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            {item.label}
          </li>
        ))}
      </ul>

      <div className="relative mt-6 h-[220px] lg:h-[260px]">
        {slots.map((slot, index) => {
          const heightPct = barHeightPct(slot.tasks);
          return (
            <div
              key={slot.label}
              className="absolute inset-y-0 px-1.5"
              style={{ left: `${(index * 100) / 7}%`, width: `${100 / 7}%` }}
            >
              <div className="flex h-full flex-col justify-end">
                {slot.isToday ? (
                  <div
                    className="w-full rounded-t-full border-2 border-dashed border-white/45"
                    style={{ height: `${heightPct}%` }}
                    title={`${slot.label}: today`}
                  />
                ) : (
                  <div
                    className="w-full rounded-t-full bg-white transition-[height] duration-500 ease-soft"
                    style={{ height: `${heightPct}%`, opacity: hasAny ? 1 : 0.16 }}
                    title={`${slot.label}: ${formatNumber(slot.tasks)} tasks`}
                  />
                )}
              </div>
            </div>
          );
        })}

        <svg
          viewBox={`0 0 700 ${VIEW_H}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <polyline
            points={pointsFor((slot) => slot.leads)}
            fill="none"
            stroke="var(--color-lime)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={hasAny ? 1 : 0}
          />
          <polyline
            points={pointsFor((slot) => slot.contacted)}
            fill="none"
            stroke="var(--color-teal)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={hasAny ? 1 : 0}
          />
          {hasAny
            ? slots.map((slot, index) => (
                <circle
                  key={slot.label}
                  cx={(index + 0.5) * 100}
                  cy={yFor(slot.leads)}
                  r={3.6}
                  fill="var(--color-lime)"
                />
              ))
            : null}
        </svg>

        {!hasAny ? (
          <p className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-white/45">
            No activity recorded this week yet
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-[12px] font-bold text-white/45">
        {slots.map((slot) => (
          <span key={slot.label} className={slot.isToday ? 'text-white' : undefined}>
            {slot.label}
          </span>
        ))}
      </div>

      <p className="mt-5 border-t border-white/10 pt-4 text-[12px] font-semibold text-white/50 tabular-nums">
        {formatNumber(totalTasks)} tasks done · {formatNumber(totalLeads)} leads found ·{' '}
        {formatNumber(totalContacted)} contacted
        {range === 'monthly' ? ' — monthly rollups are not tracked yet, showing this week' : ''}
      </p>
    </section>
  );
}
