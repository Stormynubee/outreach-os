import type { PipelineStage, TaskChannel, TaskRow, TaskStatus } from '@outreach/shared';
import type { Db } from './client.ts';
import { mapTask } from './businesses.ts';
import { addDays, localDay } from '../lib/urls.ts';

export interface ActivityInput {
  kind: string;
  businessId?: number | null;
  taskId?: number | null;
  day?: string;
  meta?: Record<string, unknown>;
}

export function createTaskRepo(db: Db) {
  const insertActivity = db.prepare(`
    INSERT INTO activity_log (kind, business_id, task_id, at, day, meta)
    VALUES (@kind, @business_id, @task_id, @at, @day, @meta)`);

  const insertTask = db.prepare(`
    INSERT INTO outreach_task (business_id, title, note, due_date, status, channel, position, created_at, updated_at)
    VALUES (@business_id, @title, @note, @due_date, 'open', @channel, @position, @now, @now)
    RETURNING *`);

  const getTask = db.prepare('SELECT * FROM outreach_task WHERE id = ?');
  const deleteTask = db.prepare('DELETE FROM outreach_task WHERE id = ?');
  const nextPosition = db.prepare(
    "SELECT COALESCE(MAX(position), 0) + 1 AS p FROM outreach_task WHERE due_date = ?",
  );
  const updateTask = db.prepare(`
    UPDATE outreach_task SET
      title = COALESCE(@title, title),
      note = COALESCE(@note, note),
      due_date = COALESCE(@due_date, due_date),
      channel = COALESCE(@channel, channel),
      status = COALESCE(@status, status),
      position = COALESCE(@position, position),
      done_at = @done_at,
      snooze_until = @snooze_until,
      updated_at = @now
    WHERE id = @id
    RETURNING *`);

  const dayLists = db.prepare(`
    SELECT t.id, t.business_id, t.title, t.note, t.due_date, t.status, t.channel, t.done_at,
           t.snooze_until, t.created_at, t.position,
           b.name AS business_name, b.score AS business_score, b.site_state AS business_site_state
    FROM outreach_task t LEFT JOIN business b ON b.id = t.business_id
    WHERE t.due_date = @date AND t.status = @status
    ORDER BY t.position ASC, t.created_at ASC`);

  const overdueList = db.prepare(`
    SELECT t.id, t.business_id, t.title, t.note, t.due_date, t.status, t.channel, t.done_at,
           t.snooze_until, t.created_at, t.position,
           b.name AS business_name, b.score AS business_score, b.site_state AS business_site_state
    FROM outreach_task t LEFT JOIN business b ON b.id = t.business_id
    WHERE t.due_date < @date AND t.status = 'open'
    ORDER BY t.due_date ASC, t.position ASC`);

  const upcomingList = db.prepare(`
    SELECT t.id, t.business_id, t.title, t.note, t.due_date, t.status, t.channel, t.done_at,
           t.snooze_until, t.created_at, t.position,
           b.name AS business_name, b.score AS business_score, b.site_state AS business_site_state
    FROM outreach_task t LEFT JOIN business b ON b.id = t.business_id
    WHERE t.due_date > @date AND t.status = 'open' AND t.due_date <= @until
    ORDER BY t.due_date ASC, t.position ASC`);

  const openCountForDay = db.prepare(
    "SELECT COUNT(*) AS n FROM outreach_task WHERE status = 'open' AND due_date <= ?",
  );
  const taskTimestamps = db.prepare('SELECT due_date, status, done_at FROM outreach_task WHERE id = ?');

  const rebuildDayStmt = db.prepare(`
    INSERT INTO daily_stat (day, tasks_created, tasks_done, leads_found, contacted, replied, won, lost)
    VALUES (
      @day,
      (SELECT COUNT(*) FROM activity_log WHERE day = @day AND kind = 'task_created'),
      -- Projected from task state rather than counted from the log, so un-ticking
      -- a task reverts the counter exactly instead of drifting.
      (SELECT COUNT(*) FROM outreach_task
        WHERE done_at IS NOT NULL
          AND date(done_at / 1000, 'unixepoch', 'localtime') = @day),
      -- New businesses, not POIs returned: re-running the same search must not
      -- inflate the day's headline number.
      (SELECT COUNT(*) FROM business
        WHERE date(first_seen_at / 1000, 'unixepoch', 'localtime') = @day),
      (SELECT COUNT(*) FROM activity_log WHERE day = @day AND kind = 'stage_change' AND json_extract(meta, '$.toStage') = 'contacted'),
      (SELECT COUNT(*) FROM activity_log WHERE day = @day AND kind = 'stage_change' AND json_extract(meta, '$.toStage') = 'replied'),
      (SELECT COUNT(*) FROM activity_log WHERE day = @day AND kind = 'stage_change' AND json_extract(meta, '$.toStage') = 'won'),
      (SELECT COUNT(*) FROM activity_log WHERE day = @day AND kind = 'stage_change' AND json_extract(meta, '$.toStage') = 'lost')
    )
    ON CONFLICT(day) DO UPDATE SET
      tasks_created = excluded.tasks_created,
      tasks_done = excluded.tasks_done,
      leads_found = excluded.leads_found,
      contacted = excluded.contacted,
      replied = excluded.replied,
      won = excluded.won,
      lost = excluded.lost`);

  const log = (input: ActivityInput) => {
    insertActivity.run({
      kind: input.kind,
      business_id: input.businessId ?? null,
      task_id: input.taskId ?? null,
      at: Date.now(),
      day: input.day ?? localDay(),
      meta: JSON.stringify(input.meta ?? {}),
    });
  };

  /**
   * daily_stat is a pure cache derived from activity_log. Rebuilding after every
   * change is what makes un-ticking a task revert the counters exactly, instead of
   * drifting from hand-maintained increments.
   */
  const rebuildDay = (day: string) => rebuildDayStmt.run({ day });

  return {
    log,
    rebuildDay,
    create(input: {
      businessId?: number | null;
      title: string;
      note?: string | null;
      dueDate?: string;
      channel?: TaskChannel | null;
    }): TaskRow {
      const now = Date.now();
      const dueDate = input.dueDate ?? localDay();
      const position = (nextPosition.get(dueDate) as { p: number }).p;
      const row = insertTask.get({
        business_id: input.businessId ?? null,
        title: input.title.trim() || 'Outreach task',
        note: input.note ?? null,
        due_date: dueDate,
        channel: input.channel ?? null,
        position,
        now,
      }) as Record<string, unknown>;
      log({ kind: 'task_created', businessId: input.businessId ?? null, taskId: row.id as number, day: dueDate });
      rebuildDay(dueDate);
      return this.get(row.id as number)!;
    },
    get(id: number): TaskRow | null {
      const row = db
        .prepare(
          `SELECT t.*, b.name AS business_name, b.score AS business_score, b.site_state AS business_site_state
           FROM outreach_task t LEFT JOIN business b ON b.id = t.business_id WHERE t.id = ?`,
        )
        .get(id) as Record<string, unknown> | undefined;
      return row ? mapTask(row) : null;
    },
    update(
      id: number,
      patch: {
        title?: string;
        note?: string | null;
        dueDate?: string;
        channel?: TaskChannel | null;
        status?: TaskStatus;
        snoozeUntil?: number | null;
      },
    ): TaskRow | null {
      const before = getTask.get(id) as
        | { due_date: string; status: string; done_at: number | null }
        | undefined;
      if (!before) return null;

      const now = Date.now();
      const nextStatus = patch.status ?? (before.status as TaskStatus);
      const wasDone = before.status === 'done';
      const nowDone = nextStatus === 'done';
      const doneAt = nowDone ? (wasDone && before.done_at ? before.done_at : now) : null;

      const row = updateTask.get({
        id,
        title: patch.title ?? null,
        note: patch.note ?? null,
        due_date: patch.dueDate ?? null,
        channel: patch.channel ?? null,
        status: patch.status ?? null,
        position: null,
        done_at: doneAt,
        snooze_until: patch.snoozeUntil ?? null,
        now,
      }) as Record<string, unknown>;

      const affected = new Set<string>([before.due_date]);
      const after = (row.due_date as string) ?? before.due_date;
      affected.add(after);
      // Completion is bucketed by the local calendar day it happened, which is not
      // always the task's due date, so that day needs rebuilding too.
      if (before.done_at) affected.add(localDay(new Date(before.done_at)));
      if (doneAt) affected.add(localDay(new Date(doneAt)));

      if (!wasDone && nowDone) {
        log({ kind: 'task_done', businessId: (row.business_id as number | null) ?? null, taskId: id, day: after });
      } else if (wasDone && !nowDone) {
        log({ kind: 'task_undone', businessId: (row.business_id as number | null) ?? null, taskId: id, day: before.due_date });
      }
      for (const day of affected) rebuildDay(day);

      return this.get(id);
    },
    remove(id: number): boolean {
      const before = taskTimestamps.get(id) as { due_date: string } | undefined;
      const info = deleteTask.run(id);
      if (before) rebuildDay(before.due_date);
      return info.changes > 0;
    },
    forDay(date: string): { open: TaskRow[]; done: TaskRow[]; overdue: TaskRow[]; upcoming: TaskRow[] } {
      const map = (rows: unknown[]) => (rows as Record<string, unknown>[]).map(mapTask);
      const doneToday = db
        .prepare(
          `SELECT t.id, t.business_id, t.title, t.note, t.due_date, t.status, t.channel, t.done_at,
                  t.snooze_until, t.created_at, t.position,
                  b.name AS business_name, b.score AS business_score, b.site_state AS business_site_state
           FROM outreach_task t LEFT JOIN business b ON b.id = t.business_id
           WHERE t.status = 'done' AND (
             t.due_date = @date OR date(t.done_at / 1000, 'unixepoch', 'localtime') = @date
           )
           ORDER BY t.done_at DESC`,
        )
        .all({ date }) as unknown[];

      return {
        open: map(dayLists.all({ date, status: 'open' })),
        done: map(doneToday),
        overdue: map(overdueList.all({ date })),
        upcoming: map(upcomingList.all({ date, until: addDays(date, 30) })),
      };
    },
    openCountUpTo(date: string): number {
      return (openCountForDay.get(date) as { n: number }).n;
    },
    setStage(businessId: number, toStage: PipelineStage, note?: string | null): PipelineStage | null {
      const current = db.prepare('SELECT pipeline_stage FROM business WHERE id = ?').get(businessId) as
        | { pipeline_stage: PipelineStage }
        | undefined;
      if (!current) return null;
      if (current.pipeline_stage === toStage) return toStage;

      const now = Date.now();
      const day = localDay();
      db.prepare('UPDATE business SET pipeline_stage = ?, updated_at = ? WHERE id = ?').run(toStage, now, businessId);
      db.prepare(
        'INSERT INTO pipeline_event (business_id, from_stage, to_stage, note, at) VALUES (?, ?, ?, ?, ?)',
      ).run(businessId, current.pipeline_stage, toStage, note ?? null, now);
      log({ kind: 'stage_change', businessId, day, meta: { fromStage: current.pipeline_stage, toStage } });
      rebuildDay(day);
      return toStage;
    },
    pipelineCounts(): Record<PipelineStage, number> {
      const rows = db
        .prepare('SELECT pipeline_stage AS stage, COUNT(*) AS n FROM business GROUP BY pipeline_stage')
        .all() as { stage: PipelineStage; n: number }[];
      const out: Record<PipelineStage, number> = { new: 0, contacted: 0, replied: 0, won: 0, lost: 0 };
      for (const row of rows) {
        if (row.stage in out) out[row.stage] = row.n;
      }
      return out;
    },
    /** Derived from activity_log, so it can never disagree with the task list. */
    daily(from: string, to: string) {
      return db
        .prepare(
          `SELECT day, tasks_created AS tasksCreated, tasks_done AS tasksDone, leads_found AS leadsFound,
                  contacted, replied, won
           FROM daily_stat WHERE day >= ? AND day <= ? ORDER BY day ASC`,
        )
        .all(from, to) as never;
    },
  };
}

export type TaskRepo = ReturnType<typeof createTaskRepo>;
