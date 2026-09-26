/**
 * Where the engine lives.
 *
 * Normally the interface is served by the engine itself and talks to `/api` on the
 * same origin. When the interface is hosted separately (a static host) the engine is
 * somewhere else — a tunnel to your machine, or a VPS — and that address is kept in
 * local storage so it can be changed without rebuilding the site.
 *
 * Build-time defaults come from `VITE_ENGINE_URL` and `VITE_ENGINE_TOKEN`; anything
 * set in the interface wins.
 */

const URL_KEY = 'outreach-os:engine-url';
const TOKEN_KEY = 'outreach-os:engine-token';

/**
 * Vite replaces `import.meta.env` with a real object in a build, but it is absent
 * anywhere else the module might run (a bare bundle, a DOM test harness), so it is
 * read once through an optional accessor rather than dereferenced inline.
 */
const ENV = (import.meta as { env?: Record<string, string | undefined> }).env;

function envValue(key: string): string {
  const value = ENV?.[key];
  return typeof value === 'string' ? value : '';
}

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage disabled — the app still works for this visit.
  }
}

/** Accepts `host`, `https://host`, `https://host/` and `https://host/api` alike. */
export function normalizeEngineUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '').replace(/\/api$/i, '');
}

export function getEngineUrl(): string {
  const stored = read(URL_KEY);
  if (stored) return normalizeEngineUrl(stored);
  return normalizeEngineUrl(envValue('VITE_ENGINE_URL'));
}

export function getEngineToken(): string {
  const stored = read(TOKEN_KEY);
  if (stored) return stored;
  return envValue('VITE_ENGINE_TOKEN');
}

export function setEngineConfig(url: string, token: string): void {
  write(URL_KEY, normalizeEngineUrl(url));
  write(TOKEN_KEY, token.trim());
}

/** `''` means same origin; otherwise an absolute base ending in `/api`. */
export function engineApiBase(): string {
  const url = getEngineUrl();
  return url ? `${url}/api` : '/api';
}

export function isEngineSeparate(): boolean {
  return getEngineUrl() !== '';
}

/** Query-string form, for the two places that cannot send headers. */
export function engineAuthQuery(): string {
  const token = getEngineToken();
  return token ? `token=${encodeURIComponent(token)}` : '';
}
