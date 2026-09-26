/**
 * End-to-end verification against a running server.
 *   node scripts/e2e.mjs [location]
 *
 * Exercises discovery, enrichment, the task tick/untick invariant, and CSV export.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4317';
const LOCATION = process.argv[2] ?? 'Frome, Somerset, England';

// The engine issues an access token on first boot and requires it for /api routes.
let AUTH = {};
try {
  const token = readFileSync(new URL('../data/api-token.txt', import.meta.url), 'utf8').trim();
  if (token) AUTH = { authorization: `Bearer ${token}` };
} catch {
  // No token file yet — the engine is running without one.
}

/**
 * The server buckets everything by LOCAL calendar day, so the script must too.
 * Using toISOString() here would look correct and fail near midnight.
 */
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A placeholder contact such as example.com is rejected by OpenStreetMap with a
 * bare 403, so tests use an identifier string instead. Set a real address in
 * Settings before running discovery for real.
 */
const TEST_CONTACT = process.env.TEST_CONTACT ?? 'local-outreach-tool';

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

const api = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...AUTH, ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  return false;
}

console.log(`\nEnd-to-end verification against ${BASE}\n`);

if (!(await waitForServer())) {
  console.error('Server never came up on ' + BASE);
  process.exit(1);
}
console.log('Server is up.\n');

// ---------------------------------------------------------------- 0. preconditions
console.log('0. Settings gate');
{
  const { body } = await api('/api/settings');
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ contactEmail: '' }) });
  const blocked = await api('/api/discovery', {
    method: 'POST',
    body: JSON.stringify({ location: 'Nowhere' }),
  });
  record(
    'discovery is refused without a contact email (OSM policy)',
    blocked.status === 400 && blocked.body?.code === 'contact_email_required',
    `HTTP ${blocked.status} ${JSON.stringify(blocked.body)}`,
  );

  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ contactEmail: 'someone@example.com' }),
  });
  const placeholder = await api('/api/discovery', {
    method: 'POST',
    body: JSON.stringify({ location: 'Nowhere' }),
  });
  record(
    'a placeholder contact is refused up front (OSM answers it with a bare 403)',
    placeholder.status === 400 && /placeholder/i.test(placeholder.body?.error ?? ''),
    placeholder.body?.error ?? '',
  );

  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      contactEmail: TEST_CONTACT,
      displayName: 'Tester',
      perDomainDelayMs: 800,
    }),
  });
  const ready = await api('/api/status');
  record('discovery becomes ready once a usable contact is set', ready.body?.discoveryReady === true);
  void body;
}

// ---------------------------------------------------------------- 1. discovery
console.log('\n1. Discovery');
let queryId = null;
{
  const before = await api('/api/stats/summary');
  const leadsBefore = before.body?.totals?.leads ?? 0;

  const started = await api('/api/discovery', {
    method: 'POST',
    body: JSON.stringify({ location: LOCATION, categories: ['food_drink', 'health_beauty', 'retail', 'trades'] }),
  });
  if (started.status !== 200 || !started.body?.queryId) {
    record('discovery request accepted', false, JSON.stringify(started.body));
  } else {
    queryId = started.body.queryId;
    record('discovery request accepted', true, `queryId=${queryId}`);

    let final = null;
    // Public Overpass mirrors are genuinely slow and flaky, so allow several
    // minutes and show progress rather than failing the moment they are busy.
    for (let i = 0; i < 180; i++) {
      const { body } = await api(`/api/discovery/${queryId}`);
      final = body;
      if (['done', 'empty', 'error', 'cancelled'].includes(body?.status)) break;
      if (i % 5 === 0) {
        // 'cache' means this exact query was answered from the local response cache.
        const mirror = body?.mirror ?? '';
        const host = mirror === 'cache' ? 'cache' : mirror ? new URL(mirror).host : '-';
        console.log(
          `          … ${body?.status} tiles ${body?.tilesDone}/${body?.tilesTotal} pois=${body?.poisFound} source=${host}`,
        );
      }
      await sleep(2000);
    }

    record(
      'discovery finished',
      !!final && ['done', 'empty'].includes(final.status),
      `status=${final?.status} pois=${final?.poisFound} tiles=${final?.tilesDone}/${final?.tilesTotal} err=${final?.error ?? '-'}`,
    );
    record('OSM data was actually returned', (final?.poisFound ?? 0) > 0, `${final?.poisFound} businesses`);
    record(
      'attribution carries the OSM base timestamp',
      !!final?.osmBase,
      `osm_base=${final?.osmBase ?? 'missing'}`,
    );

    const after = await api('/api/stats/summary');
    record(
      'leads found today is recorded in the stats',
      (after.body?.today?.leadsFound ?? 0) > 0,
      `today.leadsFound=${after.body?.today?.leadsFound}, total leads=${after.body?.totals?.leads} (was ${leadsBefore})`,
    );
  }
}

// ---------------------------------------------------------------- 2. leads
console.log('\n2. Leads and ranking');
let sampleLeadId = null;
{
  const { body } = await api('/api/leads?pageSize=8&sort=score');
  const rows = body?.rows ?? [];
  record('lead feed returns rows', rows.length > 0, `${body?.total ?? 0} total, showing ${rows.length}`);

  if (rows.length) {
    sampleLeadId = rows[0].id;
    console.log('          top 5 by score:');
    for (const r of rows.slice(0, 5)) {
      console.log(
        `            ${String(r.score).padStart(3)}  ${r.siteState.padEnd(16)} ${r.name.slice(0, 38).padEnd(38)} web=${r.hasWebsite ? 'y' : 'n'} mail=${r.hasEmail ? 'y' : 'n'} tel=${r.hasPhone ? 'y' : 'n'} soc=${r.socials.length}`,
      );
    }

    const noSiteStates = 'no_tag,social_only,dead,parked,server_down';
    const liveStates = 'live,live_weak,live_insecure';
    const noSiteTop = await api(`/api/leads?siteStates=${noSiteStates}&sort=score&pageSize=1`);
    const liveTop = await api(`/api/leads?siteStates=${liveStates}&sort=score&pageSize=1`);
    const worstNoSite = noSiteTop.body?.rows?.[0];
    const bestLive = liveTop.body?.rows?.[0];
    if (worstNoSite && bestLive) {
      // The whole point of the product: preferring the business with no website.
      record(
        'the highest-scoring business without a website outranks the best one with a live site',
        worstNoSite.score > bestLive.score,
        `no-site "${worstNoSite.name}"=${worstNoSite.score} vs live "${bestLive.name}"=${bestLive.score}`,
      );
    } else {
      console.log(`          (${noSiteTop.body?.total ?? 0} no-site and ${liveTop.body?.total ?? 0} live leads so far)`);
    }

    const sorted = rows.map((r) => r.score);
    record('feed is sorted by score descending', sorted.every((s, i) => i === 0 || sorted[i - 1] >= s));

    const filtered = await api('/api/leads?noWebsite=1&pageSize=5');
    record(
      'no-website filter works',
      (filtered.body?.rows ?? []).every((r) => ['no_tag', 'social_only', 'dead', 'parked', 'server_down'].includes(r.siteState)),
      `${filtered.body?.total} matching`,
    );

    const search = await api(`/api/leads?q=${encodeURIComponent(rows[0].name.split(' ')[0])}&pageSize=5`);
    record('text search returns results', (search.body?.rows ?? []).length > 0, `q="${rows[0].name.split(' ')[0]}"`);
  }
}

// ---------------------------------------------------------------- 3. enrichment
console.log('\n3. Enrichment (website probe + contacts + socials)');
{
  let enriched = 0;
  let noWebsite = 0;
  let probed = 0;
  let withEmail = 0;
  let withPhone = 0;
  let followersKnown = 0;
  let followersHonest = 0;

  for (let i = 0; i < 60; i++) {
    const { body } = await api('/api/leads?pageSize=40&sort=recent');
    const rows = body?.rows ?? [];
    probed = rows.filter((r) => ['live', 'live_weak', 'live_insecure', 'dead', 'parked', 'server_error', 'timeout', 'blocked', 'too_many_redirects'].includes(r.siteState)).length;
    enriched = rows.filter((r) => r.enrichmentState === 'done').length;
    noWebsite = rows.filter((r) => !r.hasWebsite).length;
    withEmail = rows.filter((r) => r.hasEmail).length;
    withPhone = rows.filter((r) => r.hasPhone).length;
    const socials = rows.flatMap((r) => r.socials ?? []);
    followersKnown = socials.filter((s) => s.manualOverride !== null || s.followersState === 'known').length;
    followersHonest = socials.filter((s) => s.followersState !== 'not_attempted').length;
    // Probing 100+ businesses with politeness delays takes minutes, so wait for
    // the queue to drain rather than sampling a fixed number of times.
    const drained = (body?.total ?? 0) > 0 && enriched + (body?.total ?? 0) > 0;
    if (drained && followersHonest > 0 && withEmail + withPhone > 0) break;
    if (i % 4 === 0) console.log(`          … enriched ${enriched} of ${body?.total ?? 0}, ${followersHonest} social checks done`);
    await sleep(5000);
  }

  record('website probing produced real states', probed > 0, `${probed} businesses classified into a definite state`);
  record('businesses without a website were identified', noWebsite > 0, `${noWebsite} have no working website`);
  record('contacts were extracted', withEmail + withPhone > 0, `${withEmail} with email, ${withPhone} with phone`);
  record(
    'social checks record an explicit state rather than a guess',
    followersHonest > 0 || followersKnown > 0,
    `${followersKnown} follower counts known, ${followersHonest} checked`,
  );
}

// ---------------------------------------------------------------- 4. lead detail
console.log('\n4. Lead detail and manual override');
{
  if (sampleLeadId) {
    const { status, body } = await api(`/api/leads/${sampleLeadId}`);
    record('lead detail loads', status === 200 && body?.id === sampleLeadId, `${body?.name}`);
    record('detail includes score reasons', Array.isArray(body?.scoreReasons) && body.scoreReasons.length > 0, (body?.scoreReasons ?? []).join('; '));
    console.log(`          site=${body?.siteState} platform=${body?.platform ?? '-'} reasons="${(body?.scoreReasons ?? []).join(', ')}"`);

    if (Array.isArray(body?.socialDetails) && body.socialDetails.length) {
      const social = body.socialDetails[0];
      const set = await api(`/api/leads/${sampleLeadId}/socials/${social.id}`, {
        method: 'PUT',
        body: JSON.stringify({ manualOverride: 12345 }),
      });
      const updated = (set.body?.socialDetails ?? []).find((s) => s.id === social.id);
      record(
        'manual follower override is stored and marked as manual',
        updated?.manualOverride === 12345 && updated?.followersState === 'known',
        `${social.platform}: override=${updated?.manualOverride} state=${updated?.followersState}`,
      );

      await api(`/api/leads/${sampleLeadId}/socials/${social.id}`, {
        method: 'PUT',
        body: JSON.stringify({ manualOverride: null }),
      });
      const cleared = await api(`/api/leads/${sampleLeadId}`);
      const after = (cleared.body?.socialDetails ?? []).find((s) => s.id === social.id);
      record('override can be cleared', after?.manualOverride === null);
    }
  }
}

// ---------------------------------------------------------------- 5. tasks
console.log('\n5. Outreach to-do list (tick and untick)');
{
  const today = localDay();
  const before = await api('/api/stats/summary');
  const doneBefore = before.body?.today?.tasksDone ?? 0;

  const t1 = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'E2E call the first lead', businessId: sampleLeadId, channel: 'call', dueDate: today }),
  });
  const t2 = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'E2E send follow-up email', channel: 'email', dueDate: today }) });
  record('tasks can be created', t1.status === 200 && t2.status === 200, `ids ${t1.body?.id}, ${t2.body?.id}`);

  const ticked = await api(`/api/tasks/${t1.body.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
  record('a task can be ticked', ticked.body?.status === 'done' && !!ticked.body?.doneAt);

  const afterDone = await api('/api/stats/summary');
  record(
    'ticking updates the day counters',
    (afterDone.body?.today?.tasksDone ?? 0) === doneBefore + 1,
    `${doneBefore} -> ${afterDone.body?.today?.tasksDone}`,
  );

  const list = await api(`/api/tasks?date=${today}`);
  record(
    'the day list separates open and completed work',
    (list.body?.done ?? []).some((t) => t.id === t1.body.id) && (list.body?.open ?? []).some((t) => t.id === t2.body.id),
    `${list.body?.open?.length ?? 0} open, ${list.body?.done?.length ?? 0} done`,
  );

  const untick = await api(`/api/tasks/${t1.body.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) });
  const afterUntick = await api('/api/stats/summary');
  record(
    'un-ticking reverts the counters exactly',
    untick.body?.status === 'open' &&
      (afterUntick.body?.today?.tasksDone ?? 0) === doneBefore &&
      (afterUntick.body?.today?.tasksDone ?? 0) === doneBefore,
    `${afterDone.body?.today?.tasksDone} -> ${afterUntick.body?.today?.tasksDone} (baseline ${doneBefore})`,
  );

  const week = await api('/api/stats/daily');
  const days = week.body ?? [];
  record('weekly graph feed returns 7+ ordered days', days.length >= 7 && days.every((d, i) => i === 0 || days[i - 1].day < d.day), `${days.length} days`);

  await api(`/api/tasks/${t1.body.id}`, { method: 'DELETE' });
  await api(`/api/tasks/${t2.body.id}`, { method: 'DELETE' });
  const afterCleanup = await api('/api/stats/summary');
  record(
    'deleting tasks cleans the counters up again',
    (afterCleanup.body?.today?.tasksDone ?? -1) === doneBefore,
    `tasksDone=${afterCleanup.body?.today?.tasksDone}`,
  );
}

// ---------------------------------------------------------------- 6. export
console.log('\n6. CSV export');
{
  const res = await fetch(`${BASE}/api/export/leads.csv`, { headers: AUTH });
  const bytes = new Uint8Array(await res.arrayBuffer());
  // fetch's text() strips a leading BOM, so check the raw bytes.
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = new TextDecoder('utf-8').decode(bytes);
  const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  record('CSV downloads with a header', lines[0]?.includes('Name'), lines[0]?.slice(0, 90));
  record('CSV has data rows', lines.length > 1, `${lines.length - 1} rows`);
  record('CSV starts with a BOM so Excel reads accents', hasBom);
  console.log(`          sample: ${lines[1]?.slice(0, 130) ?? '(none)'}`);
}

// ---------------------------------------------------------------- 7. mirrors
console.log('\n7. Overpass mirror health');
{
  const { body } = await api('/api/health/mirrors');
  record('mirror health is reported', Array.isArray(body) && body.length > 0, `${body?.length} mirrors configured`);
  for (const m of body ?? []) {
    const state = m.unhealthyUntil ? `cooldown until ${new Date(m.unhealthyUntil).toISOString().slice(11, 19)}` : 'healthy';
    console.log(
      `            ${m.host.padEnd(34)} ok=${String(m.ok).padStart(3)} fail=${m.failures} avg=${m.avgMs ?? '-'}ms last=${m.lastElementCount ?? '-'} ${state}${m.lastError ? ` (${m.lastError.slice(0, 40)})` : ''}`,
    );
  }
}

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
