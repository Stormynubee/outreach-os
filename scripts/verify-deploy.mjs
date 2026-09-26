/**
 * Verifies a deployed interface: that the shell, every asset and the deep-link
 * rewrite all work, and that no engine secret was baked into the public bundle.
 *
 *   node scripts/verify-deploy.mjs https://your-app.vercel.app
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] ?? process.env.SITE_URL ?? '').replace(/\/+$/, '');

if (!base) {
  console.error('Usage: node scripts/verify-deploy.mjs https://your-app.vercel.app');
  process.exit(1);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

console.log(`\nDeployment check: ${base}\n`);

let html = '';
try {
  const res = await fetch(base);
  html = await res.text();
  record('the site answers', res.ok, `HTTP ${res.status}, ${html.length} bytes`);
} catch (error) {
  record('the site answers', false, error.message);
  process.exit(1);
}

record('the page title is right', /<title>Outreach OS<\/title>/.test(html), (/<title>([^<]*)<\/title>/.exec(html)?.[1]) ?? '');
record('the shell mounts a React root', /<div id="root">/.test(html));

// Every referenced asset must resolve, or the page renders blank.
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((ref) => ref.startsWith('/') && !ref.endsWith('.woff2'));

let assetsOk = refs.length > 0;
const assetLines = [];
for (const ref of refs) {
  const res = await fetch(`${base}${ref}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0];
  assetLines.push(`${ref} -> ${res.status} ${type}`);
  if (!res.ok || type === 'text/html') assetsOk = false;
}
record('every referenced asset resolves (not the SPA fallback)', assetsOk, assetLines.join('\n          '));

const script = refs.find((ref) => ref.endsWith('.js'));
record('the JavaScript bundle is served', Boolean(script), script ?? 'no script tag found');

// Deep links must fall through to the shell, while real files must not.
const deep = await fetch(`${base}/leads/1`);
const deepText = await deep.text();
record('a deep link falls through to the shell', deep.ok && /<div id="root">/.test(deepText), `HTTP ${deep.status}`);

// The bundle is public, so the engine's actual token must not be inside it. Key
// names like "outreach-os:engine-token" legitimately appear in the source.
const tokenPath = resolve(repo, 'data/api-token.txt');
const secret = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '';
if (script) {
  const bundle = await (await fetch(`${base}${script}`)).text();
  record(
    'the engine token is not baked into the public bundle',
    secret === '' || !bundle.includes(secret),
    secret === '' ? 'no local token to compare against' : 'compared against the local token value',
  );
  // The variable NAME legitimately appears as a lookup key; what must never appear is
  // a non-empty value, which is what Vite inlining a build-time token would produce.
  const inlined = /VITE_ENGINE_TOKEN"\s*:\s*"([^"]*)"/.exec(bundle);
  record(
    'no build-time engine token value was inlined',
    inlined === null || inlined[1] === '',
    inlined ? `inlined value length ${inlined[1].length}` : 'no inlined value found',
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
