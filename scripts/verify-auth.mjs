/** Checks the access-token gate and CORS, which the hosted interface depends on. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE ?? 'http://127.0.0.1:4317';
const TOKEN = readFileSync(resolve(repo, 'data/api-token.txt'), 'utf8').trim();

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

console.log(`\nAuth and CORS check against ${BASE}\n`);

// 1. No credential at all.
const anon = await fetch(`${BASE}/api/status`);
record('a request with no token is refused', anon.status === 401, `HTTP ${anon.status}`);
record('and the refusal explains what to do', /token/i.test(await anon.text()));

// 2. Bearer header.
const bearer = await fetch(`${BASE}/api/status`, { headers: { authorization: `Bearer ${TOKEN}` } });
record('the bearer token is accepted', bearer.ok, `HTTP ${bearer.status}`);

// 3. Query-string token, needed because EventSource cannot set headers.
const viaQuery = await fetch(`${BASE}/api/status?token=${encodeURIComponent(TOKEN)}`);
record('the query-string token is accepted (for EventSource)', viaQuery.ok, `HTTP ${viaQuery.status}`);

// 4. A wrong token must not slip through.
const wrong = await fetch(`${BASE}/api/status`, { headers: { authorization: 'Bearer not-the-token' } });
record('a wrong token is refused', wrong.status === 401, `HTTP ${wrong.status}`);

// 5. Health stays open so a monitor or tunnel can check liveness.
const health = await fetch(`${BASE}/api/health`);
record('health needs no token', health.ok, `HTTP ${health.status}`);

// 6. CORS: a hosted interface is a different origin, so the browser preflights.
const ORIGIN = process.env.SITE_ORIGIN ?? 'https://outreach-os-example.vercel.app';
const preflight = await fetch(`${BASE}/api/leads`, {
  method: 'OPTIONS',
  headers: {
    origin: ORIGIN,
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'authorization',
  },
});
const allowOrigin = preflight.headers.get('access-control-allow-origin');
const allowHeaders = preflight.headers.get('access-control-allow-headers') ?? '';
record(
  'CORS preflight allows the hosted origin',
  preflight.ok && (allowOrigin === ORIGIN || allowOrigin === '*'),
  `HTTP ${preflight.status} allow-origin=${allowOrigin}`,
);
record(
  'CORS preflight allows the authorization header',
  /authorization/i.test(allowHeaders),
  `allow-headers=${allowHeaders}`,
);

// 7. A preflight on the mutating routes the interface uses.
const preflightWrite = await fetch(`${BASE}/api/tasks/1`, {
  method: 'OPTIONS',
  headers: { origin: ORIGIN, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type' },
});
record('CORS preflight allows PATCH with a JSON body', preflightWrite.ok, `HTTP ${preflightWrite.status}`);

// 8. The request the browser will actually make, with both the origin and the token.
const real = await fetch(`${BASE}/api/status`, {
  headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN}` },
});
const body = real.ok ? await real.json() : null;
record(
  'the hosted origin can read real data with the token',
  real.ok && typeof body?.counts?.leads === 'number' && body.counts.leads > 0,
  `HTTP ${real.status}, allow-origin=${real.headers.get('access-control-allow-origin')}, leads=${body?.counts?.leads}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
