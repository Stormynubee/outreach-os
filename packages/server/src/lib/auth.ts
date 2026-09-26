import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Access control for the API.
 *
 * The app has no user accounts on purpose — it assumes a single trusted operator. That
 * is safe while it only listens on 127.0.0.1, but the moment the interface is hosted
 * elsewhere it needs to reach the engine, usually through a tunnel, and then anyone
 * with the address could read every lead, edit the pipeline and make the engine issue
 * outbound requests from your IP.
 *
 * So: a shared token. It is optional locally (no token file, no token required) and
 * enforced for every request as soon as one exists. `ensureApiToken` creates it on
 * first use so the secure path is the default one.
 */

export const TOKEN_FILE = 'api-token.txt';

export function tokenFilePath(dataDir: string): string {
  return resolve(dataDir, TOKEN_FILE);
}

export function ensureApiToken(dataDir: string): { token: string; created: boolean } {
  if (process.env.OUTREACH_API_TOKEN?.trim()) {
    return { token: process.env.OUTREACH_API_TOKEN.trim(), created: false };
  }

  const path = tokenFilePath(dataDir);
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) return { token: existing, created: false };
  }

  const token = randomBytes(24).toString('base64url');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return { token, created: true };
}

/** Constant-time-ish comparison; the token is short and comparison is not hot. */
export function tokenMatches(expected: string, presented: string | null): boolean {
  if (!expected) return true;
  if (!presented) return false;
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}

export interface TokenRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
}

/**
 * Accepts the token as a bearer header, which is the normal path, or as `?token=`,
 * which exists because `EventSource` cannot set headers and the CSV export needs it
 * for non-JavaScript clients.
 */
export function presentedToken(request: TokenRequest): string | null {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (value?.toLowerCase().startsWith('bearer ')) return value.slice(7).trim();

  const query = request.query;
  if (query && typeof query === 'object' && 'token' in query) {
    const candidate = (query as { token?: unknown }).token;
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return null;
}
