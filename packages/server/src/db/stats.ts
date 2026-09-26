import type { DailyStat, PipelineStage, StatsSummary } from '@outreach/shared';
import type { Db } from './client.ts';
import { addDays, localDay } from '../lib/urls.ts';

export function createStatsRepo(db: Db) {
  const dayRow = db.prepare(
    `SELECT tasks_done AS tasksDone, tasks_created AS tasksCreated, leads_found AS leadsFound, contacted, replied, won
     FROM daily_stat WHERE day = ?`,
  );
  const rangeRows = db.prepare(
    `SELECT day, tasks_done AS tasksDone, tasks_created AS tasksCreated, leads_found AS leadsFound,
            contacted, replied, won
     FROM daily_stat WHERE day >= ? AND day <= ? ORDER BY day ASC`,
  );
  const zero = { tasksDone: 0, tasksCreated: 0, leadsFound: 0, contacted: 0, replied: 0, won: 0 };

  function totals() {
    const row = db
      .prepare(`
      SELECT
        (SELECT COUNT(*) FROM business) AS leads,
        (SELECT COUNT(*) FROM business WHERE site_state IN ('no_tag','social_only','dead','parked','server_down')) AS noWebsite,
        (SELECT COUNT(*) FROM business WHERE site_state IN ('dead','parked','server_down')) AS deadSite,
        (SELECT COUNT(*) FROM business WHERE site_state = 'social_only') AS socialOnly,
        (SELECT COUNT(*) FROM business WHERE has_email = 1) AS withEmail,
        (SELECT COUNT(*) FROM business WHERE has_phone = 1) AS withPhone,
        (SELECT COUNT(*) FROM business WHERE has_social = 1) AS withSocial,
        (SELECT COUNT(*) FROM business WHERE enrichment_state = 'done') AS enriched`)
      .get() as Record<string, number>;
    return {
      leads: row.leads ?? 0,
      noWebsite: row.noWebsite ?? 0,
      deadSite: row.deadSite ?? 0,
      socialOnly: row.socialOnly ?? 0,
      withEmail: row.withEmail ?? 0,
      withPhone: row.withPhone ?? 0,
      withSocial: row.withSocial ?? 0,
      scoredToday: row.enriched ?? 0,
    };
  }

  function followers() {
    const known = db
      .prepare(
        "SELECT COUNT(*) AS n FROM social_account WHERE manual_override IS NOT NULL OR followers_state = 'known'",
      )
      .get() as { n: number };
    const blocked = db
      .prepare("SELECT COUNT(*) AS n FROM social_account WHERE followers_state IN ('blocked','unsupported')")
      .get() as { n: number };
    const total = db.prepare('SELECT COUNT(*) AS n FROM social_account').get() as { n: number };
    return {
      known: known.n,
      blocked: blocked.n,
      unknown: Math.max(0, total.n - known.n - blocked.n),
    };
  }

  function pipeline(): Record<PipelineStage, number> {
    const rows = db
      .prepare('SELECT pipeline_stage AS stage, COUNT(*) AS n FROM business GROUP BY pipeline_stage')
      .all() as { stage: PipelineStage; n: number }[];
    const out: Record<PipelineStage, number> = { new: 0, contacted: 0, replied: 0, won: 0, lost: 0 };
    for (const row of rows) if (row.stage in out) out[row.stage] = row.n;
    return out;
  }

  function streak(today: string): number {
    const rows = rangeRows.all(addDays(today, -400), today) as DailyStat[];
    const active = new Set(rows.filter((r) => r.tasksDone > 0).map((r) => r.day));
    if (!active.size) return 0;
    let cursor = active.has(today) ? today : addDays(today, -1);
    let count = 0;
    while (active.has(cursor)) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  return {
    totals,
    followers,
    pipeline,
    summary(): StatsSummary {
      const today = localDay();
      const thisWeekStart = addDays(today, -6);
      const prevWeekStart = addDays(today, -13);
      const prevWeekEnd = addDays(today, -7);

      const thisWeek = rangeRows.all(thisWeekStart, today) as DailyStat[];
      const prevWeek = rangeRows.all(prevWeekStart, prevWeekEnd) as DailyStat[];
      const byDay = new Map(thisWeek.map((r) => [r.day, r]));

      const days: DailyStat[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = addDays(today, -i);
        const row = byDay.get(day);
        days.push({
          day,
          tasksDone: row?.tasksDone ?? 0,
          tasksCreated: row?.tasksCreated ?? 0,
          leadsFound: row?.leadsFound ?? 0,
          contacted: row?.contacted ?? 0,
          replied: row?.replied ?? 0,
          won: row?.won ?? 0,
        });
      }

      const sum = (rows: DailyStat[], key: keyof DailyStat) =>
        rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

      const thisDone = sum(thisWeek, 'tasksDone');
      const prevDone = sum(prevWeek, 'tasksDone');
      const deltaPct = prevDone > 0 ? Math.round(((thisDone - prevDone) / prevDone) * 100) : null;

      const todayRow = (dayRow.get(today) as DailyStat | undefined) ?? zero;
      const openRow = db
        .prepare("SELECT COUNT(*) AS n FROM outreach_task WHERE status = 'open' AND due_date <= ?")
        .get(today) as { n: number };
      const overdueRow = db
        .prepare("SELECT COUNT(*) AS n FROM outreach_task WHERE status = 'open' AND due_date < ?")
        .get(today) as { n: number };

      const allDays = db
        .prepare(
          `SELECT COALESCE(SUM(tasks_done),0) AS tasksDone, COALESCE(SUM(contacted),0) AS contacted,
                  COALESCE(SUM(replied),0) AS replied, COALESCE(SUM(won),0) AS won FROM daily_stat`,
        )
        .get() as { tasksDone: number; contacted: number; replied: number; won: number };

      // A single explainable engagement number for the header chip.
      const points =
        allDays.tasksDone * 5 + allDays.contacted * 15 + allDays.replied * 40 + allDays.won * 100;

      return {
        today: {
          date: today,
          leadsFound: todayRow.leadsFound,
          tasksDone: todayRow.tasksDone,
          tasksOpen: openRow.n,
          tasksOverdue: overdueRow.n,
        },
        week: {
          days,
          tasksDone: thisDone,
          leadsFound: sum(thisWeek, 'leadsFound'),
          deltaPct,
        },
        streak: streak(today),
        points,
        totals: totals(),
        pipeline: pipeline(),
        followers: followers(),
      };
    },
    daily(from: string, to: string): DailyStat[] {
      const rows = rangeRows.all(from, to) as DailyStat[];
      const byDay = new Map(rows.map((r) => [r.day, r]));
      const out: DailyStat[] = [];
      let cursor = from;
      while (cursor <= to) {
        const row = byDay.get(cursor);
        out.push({
          day: cursor,
          tasksDone: row?.tasksDone ?? 0,
          tasksCreated: row?.tasksCreated ?? 0,
          leadsFound: row?.leadsFound ?? 0,
          contacted: row?.contacted ?? 0,
          replied: row?.replied ?? 0,
          won: row?.won ?? 0,
        });
        cursor = addDays(cursor, 1);
      }
      return out;
    },
  };
}

export type StatsRepo = ReturnType<typeof createStatsRepo>;
