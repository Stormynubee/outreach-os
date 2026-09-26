/**
 * UI smoke test. Bundles the real entry point, mounts it in a DOM, and asserts
 * the app actually renders — the highest-risk SPA failure is a blank page from a
 * runtime crash that a typecheck and a build both happily pass.
 *
 *   node scripts/verify-ui.mjs
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const jsdomPath = resolve(repo, 'node_modules/jsdom');
if (!existsSync(jsdomPath)) {
  console.log('jsdom is not installed — run `npm install` first. Skipping.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { JSDOM } = require(jsdomPath);
const { build } = require(resolve(repo, 'node_modules/esbuild'));

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

// ---------------------------------------------------------------- bundle
const outDir = resolve(repo, '.ui-smoke');
mkdirSync(outDir, { recursive: true });
const bundlePath = resolve(outDir, 'bundle.js');

await build({
  entryPoints: [resolve(repo, 'packages/web/src/main.tsx')],
  bundle: true,
  outfile: bundlePath,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  logLevel: 'silent',
  define: {
    'process.env.NODE_ENV': '"production"',
    // Vite normally provides this; esbuild does not, and the app must cope with it
    // being absent as well as present.
    'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }),
  },
  alias: { '@outreach/shared': resolve(repo, 'packages/shared/src/index.ts') },
  plugins: [
    {
      // Stylesheets are irrelevant to rendering behaviour; stub them out.
      name: 'stub-css',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /\.css$|^@fontsource-variable\// }, (args) => ({
          path: args.path,
          namespace: 'css-stub',
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({
          contents: 'export default {}',
          loader: 'js',
        }));
      },
    },
  ],
});

const bundle = readFileSync(bundlePath, 'utf8');

// ---------------------------------------------------------------- fake API
const now = Date.now();
const day = new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const RESPONSES = {
  '/api/status': {
    version: '0.1.0',
    discoveryReady: true,
    warning: null,
    contactEmailSet: true,
    queue: { pending: 0, inFlight: 0 },
    counts: { leads: 103, tasksOpen: 2, tasksOverdue: 1 },
    attribution: {
      text: '© OpenStreetMap contributors, available under the Open Database License (ODbL)',
      url: 'https://www.openstreetmap.org/copyright',
      osmBase: '2026-05-31T22:37:44Z',
    },
    dataDir: 'C:/data',
  },
  '/api/settings': {
    displayName: 'Storm',
    contactEmail: 'someone@real-domain.com',
    primaryOffer: 'websites',
    geocoderBaseUrl: 'https://nominatim.openstreetmap.org',
    overpassMirrors: ['https://overpass-api.de/api/interpreter'],
    globalConcurrency: 8,
    perDomainConcurrency: 1,
    perDomainDelayMs: 1200,
    maxPagesPerSite: 5,
    respectRobots: true,
    fetchTimeoutMs: 10000,
    maxBodyBytes: 2097152,
    notifications: true,
    ttlSeconds: { homepage: 86400, contactPage: 604800, social: 604800, robots: 86400, followers: 604800 },
  },
  '/api/stats/summary': {
    today: { date: day, leadsFound: 12, tasksDone: 3, tasksOpen: 2, tasksOverdue: 1 },
    week: {
      days: Array.from({ length: 7 }, (_, i) => ({
        day,
        tasksDone: i,
        tasksCreated: i,
        leadsFound: i * 3,
        contacted: i,
        replied: 0,
        won: 0,
      })),
      tasksDone: 21,
      leadsFound: 77,
      deltaPct: 13,
    },
    streak: 4,
    points: 1248,
    totals: {
      leads: 103,
      noWebsite: 58,
      deadSite: 4,
      socialOnly: 11,
      withEmail: 40,
      withPhone: 44,
      withSocial: 22,
      scoredToday: 30,
    },
    pipeline: { new: 91, contacted: 8, replied: 3, won: 1, lost: 0 },
    followers: { known: 6, unknown: 20, blocked: 9 },
  },
  '/api/stats/daily': [],
  '/api/tasks': { date: day, open: [], done: [], overdue: [], upcoming: [], dueToday: [] },
  '/api/leads': {
    rows: [
      {
        id: 1,
        name: 'Shanthi Massage',
        category: 'health_beauty',
        categoryLabel: 'Health & beauty',
        city: 'Frome',
        countryCode: 'gb',
        score: 76,
        confidenceFactor: 0.85,
        siteState: 'social_only',
        websiteUrl: null,
        websiteDomain: null,
        hasWebsite: false,
        hasSsl: false,
        phone: '+447706777712',
        email: null,
        hasPhone: true,
        hasEmail: false,
        hasSocial: true,
        followersTotal: null,
        followersKnown: 0,
        hasVideo: false,
        pipelineStage: 'new',
        enrichmentState: 'done',
        socials: [],
        firstSeenAt: now - 86_400_000,
      },
    ],
    total: 103,
    page: 1,
    pageSize: 12,
  },
  '/api/discovery': [],
  '/api/health/mirrors': [],
  '/api/leads/duplicates': [],
  '/api/meta': { categories: [], siteStates: [], platforms: [], stages: [], userAgent: 'test' },
};

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true },
);
const { window } = dom;

// jsdom ships no fetch and no Response, so use Node's own Response implementation.
// (Building one from window.Response throws, which silently failed every request.)
const NodeResponse = globalThis.Response;

window.fetch = (input) => {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const body = RESPONSES[path];
  if (body === undefined) {
    return Promise.resolve(
      new NodeResponse(JSON.stringify({ error: `no stub for ${path}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return Promise.resolve(
    new NodeResponse(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
};
window.EventSource = class {
  constructor() {
    this.readyState = 0;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll for a condition rather than guessing at animation timings. */
const waitFor = async (predicate, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return false;
};
/**
 * Scoped to the React root, NOT document.body: the bundle is injected as an inline
 * script, and a <script>'s textContent would otherwise leak every string literal
 * in the app into these assertions and make them pass without rendering anything.
 */
const root = window.document.getElementById('root');
const text = () => root.textContent ?? '';
const buttons = () => [...root.querySelectorAll('button')];
const anchors = () => [...root.querySelectorAll('a')];
const clickButton = (label) => {
  const target = buttons().find((b) => (b.textContent ?? '').trim() === label);
  if (!target) return false;
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return true;
};

// ---------------------------------------------------------------- run
const errors = [];
window.addEventListener('error', (event) => errors.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));

// In <head> so it never becomes part of the body's text content.
const script = window.document.createElement('script');
script.textContent = bundle;
window.document.head.appendChild(script);

await sleep(120);
record(
  'the app mounts and paints something',
  text().length > 0,
  `${text().length} characters of text rendered`,
);

record(
  'the splash screen shows on first paint',
  /Outreach\s*OS/.test(text()) && /Opening your workspace|Loading leads and tasks|Almost ready/i.test(text()),
  text().slice(0, 80).replace(/\s+/g, ' '),
);
record(
  'the splash promises the local, no-key story',
  /No cloud/i.test(text()) && /no API keys/i.test(text()),
);

await sleep(1700);

record(
  'the splash clears itself',
  !/No cloud · no API keys · free OpenStreetMap data/i.test(text()),
  'splash no longer in the DOM',
);
record(
  'the website shell renders: header nav and footer',
  /Dashboard/.test(text()) && /Discover/.test(text()) && /Leads/.test(text()) && /OpenStreetMap contributors/.test(text()),
);
record('the guide button is in the header', buttons().some((b) => b.getAttribute('aria-label') === 'Open the guide'));

// Checked here, before the guide opens, so the two are not conflated.
const digitsOnly = text().replace(/[^\d]/g, '');
record(
  'the dashboard KPI values render',
  /Businesses Found Today/.test(text()) &&
    /Outreach Progress/.test(text()) &&
    /Welcome back, Storm/.test(text()) &&
    // Thousands separators are a formatting choice, so compare digits only.
    digitsOnly.includes('1248') &&
    digitsOnly.includes('103'),
  text().slice(0, 260).replace(/\s+/g, ' '),
);

const autoOpened = await waitFor(() => /This finds businesses that need you/.test(text()));
record('the guide opens itself on a first visit', autoOpened);
record(
  'the guide shows every step in its rail',
  autoOpened &&
    ['Welcome', 'Do this first', 'Step 1', 'How it thinks', 'Step 2', 'Honest limits', 'Step 3', 'Useful to know', 'Fair use'].every(
      (eyebrow) => text().includes(eyebrow),
    ),
  'all nine section labels present',
);
record('the guide states the step count', /9 steps/.test(text()));

const dialog = () => root.querySelector('[role="dialog"]');
const dialogButtons = () => [...(dialog()?.querySelectorAll('button') ?? [])];
const stepAttr = () => dialog()?.getAttribute('data-step') ?? 'n/a';
const headingText = () => root.querySelector('#guide-heading')?.textContent?.trim() ?? '(none)';
/** Always query fresh inside the dialog: other pages have their own "Next" buttons. */
const clickInDialog = (label) => {
  const target = dialogButtons().find((b) => (b.textContent ?? '').trim() === label);
  if (!target) return false;
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
};

// The rail renders every step and marks the current one for assistive tech.
// Its click handler is the same `go()` that Next exercises below, so that path is
// covered; dispatching a click at this particular node is unreliable under jsdom.
const activeRail = dialog()?.querySelectorAll('button[aria-current="step"]') ?? [];
record(
  'the rail marks the current step as active',
  activeRail.length === 1 && (activeRail[0].textContent ?? '').includes('Welcome'),
  `${activeRail.length} active item(s), first="${activeRail[0]?.textContent?.trim() ?? ''}"`,
);

// Advance with Next. jsdom drops the first synthetic click dispatched into a
// freshly mounted dialog, so retry once; how many attempts were needed is printed
// so the quirk stays visible instead of silently papered over.
let attempts = 0;
let advanced = false;
while (attempts < 2 && !advanced) {
  attempts++;
  advanced = clickInDialog('Next');
  advanced = (await waitFor(() => stepAttr() === '1', 1500)) && advanced;
}
record(
  'Next advances the guide',
  advanced && /Set your contact before anything else/.test(headingText()),
  `advanced after ${attempts} click(s); data-step=${stepAttr()} heading="${headingText()}"`,
);
record(
  'the guide explains the placeholder-email trap',
  /403/.test(text()),
);
record(
  'the guide offers a shortcut to the relevant page',
  // The action is a router Link, so it renders as an anchor rather than a button.
  anchors().some((a) => /Open settings/i.test(a.textContent ?? '')),
);

const skipped = clickInDialog('Skip');
await waitFor(() => dialog() === null);
record('Skip closes the guide', skipped && dialog() === null);
record(
  'dismissing the guide remembers the choice',
  window.localStorage.getItem('outreach-os:guide-seen') === '1',
  `stored value: ${window.localStorage.getItem('outreach-os:guide-seen')}`,
);

record('no uncaught errors during the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

// Opening it again from the header must work after dismissal.
const guideButton = buttons().find((b) => b.getAttribute('aria-label') === 'Open the guide');
guideButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const reopened = await waitFor(() => /This finds businesses that need you/.test(headingText()));
record('the guide can be reopened from the header icon', reopened, `heading="${headingText()}"`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
}

// jsdom keeps timers and the React scheduler alive, so exit deliberately.
dom.window.close();
process.exit(failed.length ? 1 : 0);
