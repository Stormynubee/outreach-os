/**
 * Verifies a self-contained deployment: one URL serving both the interface and the
 * engine, which is how the container image runs (locally, or on a container host).
 *
 *   node scripts/verify-engine.mjs http://127.0.0.1:4400 <token>
 *
 * Checks the interface, the auth gate, CORS for a hosted origin, and that data
 * actually persists in the mounted volume.
 */
const base = (process.argv[2] ?? process.env.ENGINE_URL ?? '').replace(/\/+$/, '');
const token = process.argv[3] ?? process.env.ENGINE_TOKEN ?? '';
const origin = process.env.SITE_ORIGIN ?? 'https://outreach-os-rouge.vercel.app';

if (!base) {
  console.error('Usage: node scripts/verify-engine.mjs <url> [token]');
  process.exit(1);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

const auth = token ? { authorization: `Bearer ${token}` } : {};

console.log(`\nEngine check: ${base}\n`);

// 1. The interface is served by the same process as the API.
let html = '';
try {
  const res = await fetch(base, { signal: AbortSignal.timeout(15000) });
  html = await res.text();
  record('the interface is served', res.ok && /<div id="root">/.test(html), `HTTP ${res.status}, ${html.length} bytes`);
} catch (error) {
  record('the interface is served', false, error.message);
  process.exit(1);
}
record('the page title is right', /<title>Outreach OS<\/title>/.test(html), /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');

const css = /href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1];
const js = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
for (const [label, ref] of [['stylesheet', css], ['javascript', js]]) {
  if (!ref) {
    record(`${label} is referenced`, false, 'no reference found in the shell');
    continue;
  }
  const asset = await fetch(`${base}${ref}`);
  record(`${label} resolves`, asset.ok, `${ref} -> HTTP ${asset.status}`);
}

// 2. Liveness is open; everything else needs the token.
const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(15000) });
record('health needs no token', health.ok, `HTTP ${health.status}`);

const anon = await fetch(`${base}/api/status`);
record('the API refuses an unauthenticated request', anon.status === 401, `HTTP ${anon.status}`);

const authed = await fetch(`${base}/api/status`, { headers: auth });
record('the token is accepted', authed.ok, `HTTP ${authed.status}`);

const status = authed.ok ? await authed.json() : null;
record(
  'the engine reports its state',
  Boolean(status) && typeof status.counts?.leads === 'number',
  `leads=${status?.counts?.leads} contactSet=${status?.contactEmailSet} ready=${status?.discoveryReady} dataDir=${status?.dataDir}`,
);

// 3. A hosted interface is a different origin.
const preflight = await fetch(`${base}/api/leads`, {
  method: 'OPTIONS',
  headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
});
const allowOrigin = preflight.headers.get('access-control-allow-origin');
record(
  'CORS allows the hosted interface origin',
  preflight.ok && (allowOrigin === origin || allowOrigin === '*'),
  `HTTP ${preflight.status} allow-origin=${allowOrigin}`,
);

// 4. Everything the dashboard needs.
const endpoints = ['/api/stats/summary', '/api/leads?pageSize=1', '/api/tasks', '/api/discovery', '/api/settings'];
let ok = 0;
const failures = [];
for (const path of endpoints) {
  const res = await fetch(`${base}${path}`, { headers: auth });
  if (res.ok) ok++;
  else failures.push(`${path} -> ${res.status}`);
}
record('every endpoint the interface calls is live', ok === endpoints.length, failures.join(', ') || `${ok}/${endpoints.length}`);

// 5. Data survives a restart, which is the whole point of the volume.
const created = await fetch(`${base}/api/tasks`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth },
  body: JSON.stringify({ title: 'persistence probe' }),
});
const task = created.ok ? await created.json() : null;
record('a task can be written', created.ok && typeof task?.id === 'number', `HTTP ${created.status} id=${task?.id}`);

if (task?.id) {
  console.log(
    `\n  → restart the container, then re-run with VERIFY_TASK_ID=${task.id} to confirm the row survived.`,
  );
}

const expected = process.env.VERIFY_TASK_ID;
if (expected) {
  const after = await fetch(`${base}/api/tasks`, { headers: auth });
  const day = after.ok ? await after.json() : null;
  const all = day ? [...(day.open ?? []), ...(day.done ?? []), ...(day.overdue ?? []), ...(day.upcoming ?? [])] : [];
  record(
    'data written before the restart is still there',
    all.some((row) => String(row.id) === String(expected)),
    `looking for task ${expected} among ${all.length} row(s)`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
