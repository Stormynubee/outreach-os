import { beforeEach, describe, expect, it } from 'vitest';
import { createBusinessRepo, getLeadDetail, listLeads } from '../src/db/businesses.ts';
import { openDb, migrate, type Db } from '../src/db/client.ts';
import { createJobQueue } from '../src/db/jobs.ts';
import { createStatsRepo } from '../src/db/stats.ts';
import { createTaskRepo } from '../src/db/tasks.ts';
import { normalizePoi } from '../src/discovery/normalize.ts';
import { localDay, addDays } from '../src/lib/urls.ts';
import type { OverpassElement } from '../src/providers/overpass.ts';

/**
 * Data-layer integration test. Every statement here is prepared against the real
 * schema, which is what catches raw-SQL mistakes that unit tests miss: a column
 * that does not exist, an upsert whose conflict target does not match a partial
 * index, or an fts5 MATCH that references the table name instead of its alias.
 */
let db: Db;
let repo: ReturnType<typeof createBusinessRepo>;
let jobs: ReturnType<typeof createJobQueue>;
let tasks: ReturnType<typeof createTaskRepo>;
let stats: ReturnType<typeof createStatsRepo>;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repo = createBusinessRepo(db);
  jobs = createJobQueue(db);
  tasks = createTaskRepo(db);
  stats = createStatsRepo(db);
});

const poi = (over: Partial<OverpassElement> & { id: number; tags: Record<string, string> }): OverpassElement => ({
  type: 'node',
  lat: 51.23,
  lon: -2.32,
  ...over,
});

describe('business upsert and classification', () => {
  it('records a business with no website as the top-value state', () => {
    const normalized = normalizePoi(poi({ id: 1, tags: { name: 'Beehive Cafe', amenity: 'cafe', 'addr:city': 'Frome' } }))!;
    const { id, isNew } = repo.upsertPoi(normalized, null, Date.now());
    expect(isNew).toBe(true);

    const detail = getLeadDetail(db, repo, id)!;
    expect(detail.siteState).toBe('no_tag');
    expect(detail.hasWebsite).toBe(false);
    expect(detail.score).toBeGreaterThan(0);
    expect(detail.scoreReasons.join(' ')).toContain('no website found');
  });

  it('treats a social URL in the website tag as social-only, not as a website', () => {
    const normalized = normalizePoi(
      poi({ id: 2, tags: { name: 'Fade Factory', shop: 'hairdresser', website: 'https://www.facebook.com/fadefactory' } }),
    )!;
    const { id } = repo.upsertPoi(normalized, null, Date.now());

    const detail = getLeadDetail(db, repo, id)!;
    expect(detail.siteState).toBe('social_only');
    expect(detail.hasWebsite).toBe(false);
    expect(detail.websiteUrl).toBeNull();
    // The URL is not thrown away — it becomes a contactable social profile.
    expect(detail.socialDetails).toHaveLength(1);
    expect(detail.socialDetails[0]!.platform).toBe('facebook');
    expect(detail.socialDetails[0]!.handle).toBe('fadefactory');
  });

  it('carries OSM contact tags straight through', () => {
    const normalized = normalizePoi(
      poi({
        id: 3,
        tags: {
          name: 'Frome Plumbing',
          craft: 'plumber',
          phone: '+44 1373 123456',
          email: 'info@fromeplumbing.co.uk',
          'contact:instagram': 'https://instagram.com/fromeplumbing',
        },
      }),
    )!;
    const { id } = repo.upsertPoi(normalized, null, Date.now());
    const detail = getLeadDetail(db, repo, id)!;

    expect(detail.emails.map((e) => e.address)).toContain('info@fromeplumbing.co.uk');
    expect(detail.phones[0]!.raw).toBe('+44 1373 123456');
    expect(detail.socialDetails.map((s) => s.platform)).toContain('instagram');
    expect(detail.hasEmail).toBe(true);
    expect(detail.hasSocial).toBe(true);
  });

  it('is idempotent across overlapping discovery runs', () => {
    const normalized = normalizePoi(poi({ id: 4, tags: { name: 'The Rye Bakery', shop: 'bakery' } }))!;
    const first = repo.upsertPoi(normalized, null, 1000);
    const second = repo.upsertPoi(normalized, null, 2000);

    expect(second.id).toBe(first.id);
    expect(second.isNew).toBe(false);
    expect((db.prepare('SELECT COUNT(*) AS n FROM business').get() as { n: number }).n).toBe(1);
  });

  it('skips unnamed and defunct POIs', () => {
    expect(normalizePoi(poi({ id: 5, tags: { amenity: 'cafe' } }))).toBeNull();
    expect(normalizePoi(poi({ id: 6, tags: { name: 'Closed Cafe', amenity: 'cafe', disused: 'yes' } }))).toBeNull();
    expect(normalizePoi(poi({ id: 7, tags: { name: 'Gone', shop: 'bakery', lifecycle: 'disused' } }))).toBeNull();
  });

  it('does not collapse two different businesses that share a free-host domain', () => {
    const a = normalizePoi(poi({ id: 8, tags: { name: 'Alpha Studio', shop: 'photo', website: 'https://alpha.wixsite.com/home' } }))!;
    const b = normalizePoi(poi({ id: 9, tags: { name: 'Beta Studio', shop: 'photo', website: 'https://beta.wixsite.com/home' } }))!;
    repo.upsertPoi(a, null, Date.now());
    repo.upsertPoi(b, null, Date.now());

    const dupes = db.prepare('SELECT * FROM possible_duplicate').all();
    expect(dupes).toHaveLength(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM business').get() as { n: number }).n).toBe(2);
  });

  it('flags the same domain on two rows as a possible duplicate without merging', () => {
    const a = normalizePoi(poi({ id: 10, lat: 51.2, lon: -2.3, tags: { name: 'Riverside Dental', amenity: 'dentist', website: 'https://riversidedental.co.uk' } }))!;
    const b = normalizePoi(poi({ id: 11, lat: 51.9, lon: -2.9, tags: { name: 'Riverside Dental Care', amenity: 'dentist', website: 'https://www.riversidedental.co.uk/contact' } }))!;
    repo.upsertPoi(a, null, Date.now());
    repo.upsertPoi(b, null, Date.now());

    const dupes = db.prepare('SELECT reason FROM possible_duplicate').all() as { reason: string }[];
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.reason).toBe('same_domain');
  });
});

describe('lead feed', () => {
  beforeEach(() => {
    const pois: Array<{ id: number; tags: Record<string, string> }> = [
      { id: 20, tags: { name: 'No Site Diner', amenity: 'restaurant', phone: '+441373111111' } },
      { id: 21, tags: { name: 'Live Site Cafe', amenity: 'cafe', website: 'https://livesitecafe.co.uk' } },
      { id: 22, tags: { name: 'Social Only Salon', shop: 'beauty', website: 'https://instagram.com/socialonlysalon' } },
      { id: 23, tags: { name: 'Dead Site Garage', shop: 'car_repair', website: 'https://deadgarage.co.uk' } },
    ];
    for (const p of pois) {
      repo.upsertPoi(normalizePoi(poi(p))!, null, Date.now());
    }
    // Give the live site a confirmed probed state so it is comparable.
    db.prepare("UPDATE business SET site_state = 'live' WHERE name = 'Live Site Cafe'").run();
    db.prepare("UPDATE business SET site_state = 'dead' WHERE name = 'Dead Site Garage'").run();
    repo.rescoreAll(Date.now());
  });

  it('sorts by score and puts missing websites first', () => {
    const { rows } = listLeads(db, repo, { sort: 'score', pageSize: 10 });
    expect(rows[0]!.name).toBe('No Site Diner');
    const live = rows.find((r) => r.name === 'Live Site Cafe')!;
    expect(rows[0]!.score).toBeGreaterThan(live.score);
  });

  it('filters to businesses without a working website', () => {
    const { rows, total } = listLeads(db, repo, { noWebsite: true, pageSize: 10 });
    expect(total).toBe(3);
    expect(rows.map((r) => r.name)).not.toContain('Live Site Cafe');
  });

  it('searches by name through the full-text index', () => {
    const { rows } = listLeads(db, repo, { q: 'Diner', pageSize: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('No Site Diner');
  });

  it('survives punctuation in a search query instead of erroring', () => {
    for (const q of ['No Site', 'Smith & Sons', 'cafe!', '""', "O'Brien", '*', 'a-b']) {
      expect(() => listLeads(db, repo, { q, pageSize: 5 })).not.toThrow();
    }
  });

  it('filters by contact availability', () => {
    const { rows } = listLeads(db, repo, { hasPhone: true, pageSize: 10 });
    expect(rows.map((r) => r.name)).toEqual(['No Site Diner']);
  });
});

describe('job queue', () => {
  it('deduplicates by key and reports the backlog', () => {
    expect(jobs.enqueue({ type: 'probe_site', payload: { businessId: 1 }, dedupeKey: 'probe:1' })).not.toBeNull();
    expect(jobs.enqueue({ type: 'probe_site', payload: { businessId: 1 }, dedupeKey: 'probe:1' })).toBeNull();
    expect(jobs.counts().queued).toBe(1);
  });

  it('allows multiple undeduped jobs and claims them in priority order', () => {
    jobs.enqueue({ type: 'check_social', payload: { businessId: 1 } });
    jobs.enqueue({ type: 'probe_site', payload: { businessId: 1 } });
    jobs.enqueue({ type: 'scrape_site', payload: { businessId: 1 } });

    const first = jobs.claim('w1')!;
    const second = jobs.claim('w1')!;
    const third = jobs.claim('w1')!;
    // Website probing must never be starved by slow social work.
    expect([first.type, second.type, third.type]).toEqual(['probe_site', 'scrape_site', 'check_social']);
    expect(jobs.claim('w1')).toBeNull();
  });

  it('reschedules a retry instead of dropping the job', () => {
    const id = jobs.enqueue({ type: 'probe_site', payload: { businessId: 1 } })!;
    const job = jobs.claim('w1')!;
    expect(job.attempts).toBe(1);

    const state = jobs.fail(id, 'boom', 1, 3);
    expect(state).toBe('queued');
    const row = db.prepare('SELECT status, last_error, run_at FROM job WHERE id = ?').get(id) as {
      status: string;
      last_error: string;
      run_at: number;
    };
    expect(row.status).toBe('queued');
    expect(row.last_error).toBe('boom');
    expect(row.run_at).toBeGreaterThan(Date.now() - 1000);
  });

  it('gives up after the final attempt', () => {
    const id = jobs.enqueue({ type: 'probe_site', payload: { businessId: 1 }, maxAttempts: 1 })!;
    jobs.claim('w1');
    expect(jobs.fail(id, 'fatal', 1, 1)).toBe('dead');
  });

  it('reclaims jobs abandoned by a crashed worker', () => {
    jobs.enqueue({ type: 'probe_site', payload: { businessId: 1 } });
    jobs.claim('w1');
    // Simulates the clock having moved past the lock timestamp.
    expect(jobs.reclaimStale(0, Date.now() + 1000)).toBe(1);
    expect(jobs.claim('w2')).not.toBeNull();
  });
});

describe('outreach tasks and the daily graph', () => {
  it('ticking and un-ticking reverts the counters exactly', () => {
    const today = localDay();
    const baseline = stats.summary().today.tasksDone;

    const task = tasks.create({ title: 'Call the bakery', channel: 'call' });
    expect(stats.summary().today.tasksOpen).toBeGreaterThan(0);

    tasks.update(task.id, { status: 'done' });
    expect(stats.summary().today.tasksDone).toBe(baseline + 1);
    expect(stats.daily(today, today)[0]!.tasksDone).toBe(baseline + 1);

    tasks.update(task.id, { status: 'open' });
    expect(stats.summary().today.tasksDone).toBe(baseline);
    expect(stats.daily(today, today)[0]!.tasksDone).toBe(baseline);
  });

  it('groups the day list into open, done, overdue and upcoming', () => {
    const today = localDay();
    const open = tasks.create({ title: 'Today task', dueDate: today });
    tasks.create({ title: 'Overdue task', dueDate: addDays(today, -3) });
    tasks.create({ title: 'Upcoming task', dueDate: addDays(today, 4) });
    const done = tasks.create({ title: 'Finished task', dueDate: today });
    tasks.update(done.id, { status: 'done' });

    const lists = tasks.forDay(today);
    expect(lists.open.map((t) => t.id)).toEqual([open.id]);
    expect(lists.done.map((t) => t.id)).toContain(done.id);
    expect(lists.overdue.map((t) => t.title)).toEqual(['Overdue task']);
    expect(lists.upcoming.map((t) => t.title)).toEqual(['Upcoming task']);
  });

  it('counts new businesses for the day, not POIs re-processed', () => {
    const today = localDay();
    const business = normalizePoi(poi({ id: 50, tags: { name: 'Counted Once', amenity: 'cafe' } }))!;

    // The same timestamp twice reproduces two upserts inside one millisecond,
    // which must still be recognised as an update rather than a new row.
    const stamp = Date.now();
    const first = repo.upsertPoi(business, null, stamp);
    expect(first.isNew).toBe(true);
    tasks.rebuildDay(today);
    const countAfterFirst = stats.daily(today, today)[0]!.leadsFound;

    const second = repo.upsertPoi(business, null, stamp);
    expect(second.isNew).toBe(false);
    expect(second.id).toBe(first.id);
    tasks.rebuildDay(today);

    // Re-running the same search updates the existing row rather than adding one,
    // so the day's headline number must not move.
    expect(stats.daily(today, today)[0]!.leadsFound).toBe(countAfterFirst);
    expect(countAfterFirst).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM business').get() as { n: number }).n).toBe(1);
  });

  it('records a streak and points without drifting', () => {
    const today = localDay();
    for (const offset of [0, -1, -2]) {
      const task = tasks.create({ title: `Task ${offset}`, dueDate: addDays(today, offset) });
      tasks.update(task.id, { status: 'done' });
      if (offset !== 0) {
        // Moving the task back also moves the day its completion is logged under.
        db.prepare('UPDATE activity_log SET day = ? WHERE task_id = ?').run(addDays(today, offset), task.id);
        tasks.rebuildDay(addDays(today, offset));
      }
      tasks.rebuildDay(today);
    }
    const summary = stats.summary();
    expect(summary.streak).toBeGreaterThanOrEqual(1);
    expect(summary.points).toBeGreaterThan(0);
    expect(summary.week.days).toHaveLength(7);
  });
});

describe('pipeline stages', () => {
  it('logs stage changes and rebuilds the affected day', () => {
    const { id } = repo.upsertPoi(normalizePoi(poi({ id: 30, tags: { name: 'Stage Test Ltd', office: 'company' } }))!, null, Date.now());

    expect(tasks.setStage(id, 'contacted')).toBe('contacted');
    expect(tasks.setStage(id, 'contacted')).toBe('contacted');
    expect(tasks.setStage(id, 'won')).toBe('won');

    const events = db.prepare('SELECT from_stage, to_stage FROM pipeline_event WHERE business_id = ? ORDER BY id').all(id) as {
      from_stage: string;
      to_stage: string;
    }[];
    // Re-setting the same stage must not create a duplicate event.
    expect(events).toEqual([
      { from_stage: 'new', to_stage: 'contacted' },
      { from_stage: 'contacted', to_stage: 'won' },
    ]);
    expect(stats.pipeline().won).toBe(1);
    expect(stats.summary().today.leadsFound).toBeGreaterThanOrEqual(0);
  });
});

describe('stats totals', () => {
  it('counts the categories the dashboard shows', () => {
    repo.upsertPoi(normalizePoi(poi({ id: 40, tags: { name: 'A', amenity: 'cafe' } }))!, null, Date.now());
    repo.upsertPoi(normalizePoi(poi({ id: 41, tags: { name: 'B', shop: 'bakery', website: 'https://b.co.uk' } }))!, null, Date.now());
    repo.upsertPoi(
      normalizePoi(poi({ id: 42, tags: { name: 'C', shop: 'beauty', website: 'https://facebook.com/c' } }))!,
      null,
      Date.now(),
    );

    const totals = stats.totals();
    expect(totals.leads).toBe(3);
    expect(totals.noWebsite).toBe(2);
    expect(totals.socialOnly).toBe(1);
    expect(stats.followers().unknown).toBe(1);
  });
});
