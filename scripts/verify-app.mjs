/**
 * Verifies the single-process integration: the API and the built SPA served
 * together on one port, plus the SSE progress stream.
 *   node scripts/verify-app.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE ?? 'http://127.0.0.1:4317';

// The engine issues an access token on first boot and requires it for /api routes.
const tokenPath = resolve(repo, 'data/api-token.txt');
const TOKEN = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '';
const authHeaders = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};
const api = (path) => fetch(`${BASE}${path}`, { headers: authHeaders });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

console.log(`\nIntegration check against ${BASE}\n`);

// The server may still be booting (tsx takes a moment to compile), so wait for it.
let up = false;
for (let i = 0; i < 30 && !up; i++) {
  try {
    up = (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!up) {
  console.error(`Server never answered on ${BASE}. Start it with: npm run dev:server`);
  process.exit(1);
}

// The SPA is served from the same origin as the API.
const root = await fetch(`${BASE}/`);
const html = await root.text();
record('serves the app shell at /', root.ok && /<div id="root">|<script/.test(html), `HTTP ${root.status}, ${html.length} bytes`);
record('the shell references the built bundle', /assets\/index-[\w-]+\.js/.test(html));
record('the app sets a real title', /<title>([^<]+)<\/title>/.test(html), /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? '');

const css = await fetch(`${BASE}/`).then(async (r) => {
  const text = await r.text();
  const href = /href="([^"]+\.css)"/.exec(text)?.[1];
  return href ? fetch(`${BASE}${href}`).then((x) => x.text()) : '';
});
record(
  'the stylesheet ships the design tokens',
  css.includes('--color-lime') && css.toLowerCase().includes('#d7f94e') && css.includes('--color-ink'),
  `${css.length} bytes of CSS`,
);
record('the Manrope font is bundled locally (no external fetch)', css.includes('@font-face') && css.includes('manrope'), '');

// A deep link must fall through to the SPA, while /api paths must not.
const deep = await fetch(`${BASE}/leads`);
const deepText = await deep.text();
record('deep links fall through to the SPA', deep.ok && /<div id="root">|<script/.test(deepText), `HTTP ${deep.status}`);

const missingApi = await api('/api/does-not-exist');
record('unknown API routes still return JSON, not the SPA', missingApi.status === 404 && (await missingApi.json()).error !== undefined, `HTTP ${missingApi.status}`);

// Every endpoint the UI depends on.
const endpoints = [
  ['/api/status', 200],
  ['/api/settings', 200],
  ['/api/meta', 200],
  ['/api/stats/summary', 200],
  ['/api/stats/daily', 200],
  ['/api/leads?pageSize=1', 200],
  ['/api/tasks', 200],
  ['/api/discovery', 200],
  ['/api/health/mirrors', 200],
  ['/api/leads/duplicates', 200],
  ['/api/export/leads.csv', 200],
];
let ok = 0;
for (const [path, expected] of endpoints) {
  const res = await api(path);
  if (res.status === expected) ok++;
  else console.log(`          ${path} -> HTTP ${res.status}`);
}
record('every endpoint the UI calls is live', ok === endpoints.length, `${ok}/${endpoints.length}`);

// The status payload the Home and Discover pages read.
const status = await (await api('/api/status')).json();
record(
  'status reports readiness, counts and attribution',
  typeof status.discoveryReady === 'boolean' && status.counts && status.attribution?.url?.includes('openstreetmap'),
  `leads=${status.counts?.leads} openTasks=${status.counts?.tasksOpen} ready=${status.discoveryReady}`,
);

// SSE: connect, read at least one frame, disconnect.
const sse = await new Promise((resolve) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    resolve({ ok: false, reason: 'no frame within 8s' });
  }, 8000);

  fetch(`${BASE}/api/events`, { signal: controller.signal, headers: authHeaders })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        clearTimeout(timer);
        return resolve({ ok: false, reason: `HTTP ${res.status}` });
      }
      const reader = res.body.getReader();
      const { value } = await reader.read();
      clearTimeout(timer);
      controller.abort();
      const frame = new TextDecoder().decode(value ?? new Uint8Array());
      const parsed = /^data: (.+)$/m.exec(frame);
      let type = 'unparsed';
      try {
        type = JSON.parse(parsed?.[1] ?? '{}').type ?? 'unparsed';
      } catch {
        /* ignore */
      }
      resolve({ ok: /^data: /m.test(frame), reason: `first frame type=${type}` });
    })
    .catch((err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err.message });
    });
});
record('the live progress stream (SSE) emits frames', sse.ok, sse.reason);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
