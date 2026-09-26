import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from './migrations.ts';
import { DEFAULT_SETTINGS, type Settings } from '../settings.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

/**
 * Everything the app writes lives in one directory: the database and the access
 * token. Setting only `OUTREACH_DB_PATH` is enough — the directory follows it, so a
 * container with just a database path still keeps its token on the same volume.
 */
export const dataDir = process.env.OUTREACH_DATA_DIR
  ? resolve(process.env.OUTREACH_DATA_DIR)
  : process.env.OUTREACH_DB_PATH
    ? dirname(resolve(process.env.OUTREACH_DB_PATH))
    : resolve(repoRoot, 'data');

export const dbPath = process.env.OUTREACH_DB_PATH
  ? resolve(process.env.OUTREACH_DB_PATH)
  : resolve(dataDir, 'app.db');

export type Db = Database.Database;

export function openDb(path: string = dbPath): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  // WAL + NORMAL: durable enough for local work, far fewer fsyncs than DELETE/FULL.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  return db;
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${m.version} (${m.name}) failed: ${(err as Error).message}`);
    }
  }
}

export function readSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      stored[r.key] = r.value;
    }
  }
  const merged = { ...DEFAULT_SETTINGS, ...stored } as Settings;
  merged.ttlSeconds = { ...DEFAULT_SETTINGS.ttlSeconds, ...(stored.ttlSeconds as object | undefined) };
  return merged;
}

export function writeSettings(db: Db, patch: Partial<Settings>): Settings {
  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [k, v] of entries) upsert.run(k, JSON.stringify(v), now);
  });
  tx(Object.entries(patch));
  return readSettings(db);
}

let cached: Db | null = null;

/** Process-wide handle. Local single-user app, so one connection is the right shape. */
export function getDb(): Db {
  if (!cached) {
    cached = openDb();
    migrate(cached);
  }
  return cached;
}

export function closeDb(): void {
  cached?.close();
  cached = null;
}
