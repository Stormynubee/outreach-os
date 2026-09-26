import { createClient, type Client, type InArgs, type InValue, type Row, type Transaction } from '@libsql/client';
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

/** A hosted database, when one is configured. Otherwise a local file. */
export const hostedUrl = process.env.TURSO_DATABASE_URL?.trim() || '';
export const isHosted = hostedUrl !== '';

export type Args = Record<string, InValue | undefined> | (InValue | undefined)[];

/**
 * The driver rejects `undefined` as a bound value. Call sites legitimately produce it
 * from optional fields, and SQL has no meaning for it either way, so it becomes NULL.
 */
function toInArgs(args?: Args): InArgs | undefined {
  if (args === undefined) return undefined;
  if (Array.isArray(args)) return args.map((value) => (value === undefined ? null : value));
  const out: Record<string, InValue> = {};
  for (const [key, value] of Object.entries(args)) out[key] = value === undefined ? null : value;
  return out;
}

/** Mirrors the shape the call sites already use, so the SQL is untouched. */
export interface Statement {
  run(args?: Args): Promise<{ changes: number; lastInsertRowid: number }>;
  get(args?: Args): Promise<Row | undefined>;
  all(args?: Args): Promise<Row[]>;
}

export interface Db {
  prepare(sql: string): Statement;
  execute(sql: string, args?: Args): Promise<Row[]>;
  /** Runs several statements as one write transaction. */
  batch(statements: { sql: string; args?: Args }[]): Promise<void>;
  /** Runs several statements without a transaction. Used for schema changes. */
  executeMultiple(sql: string): Promise<void>;
  transaction(): Promise<Transaction>;
  /** False when the database lives on a server rather than on this disk. */
  readonly local: boolean;
  close(): void;
}

export function openDb(url: string = dbPath): Db {
  const remote = /^(libsql|https?|wss?):/i.test(url);
  if (!remote && url !== ':memory:') mkdirSync(dirname(url), { recursive: true });

  const client: Client = createClient(
    remote
      ? { url, authToken: process.env.TURSO_AUTH_TOKEN }
      : { url: url === ':memory:' ? ':memory:' : `file:${url}` },
  );

  // Local durability settings. A hosted database manages this itself, and rejects
  // pragmas, so they are only applied to a file.
  if (!remote) {
    for (const pragma of ['journal_mode = WAL', 'synchronous = NORMAL', 'busy_timeout = 5000', 'foreign_keys = ON']) {
      // Fire and forget: a pragma failing must not stop the app from opening.
      void client.execute(`PRAGMA ${pragma}`).catch(() => {});
    }
  }

  return {
    local: !remote,
    prepare(sql: string): Statement {
      return {
        async run(args?: Args) {
          const bound = toInArgs(args);
          const result = await client.execute(bound === undefined ? sql : { sql, args: bound });
          return {
            changes: Number(result.rowsAffected ?? 0),
            // BigInt would blow up the moment anything tried to serialise it.
            lastInsertRowid: Number(result.lastInsertRowid ?? 0),
          };
        },
        async get(args?: Args) {
          const bound = toInArgs(args);
          const result = await client.execute(bound === undefined ? sql : { sql, args: bound });
          return result.rows[0];
        },
        async all(args?: Args) {
          const bound = toInArgs(args);
          const result = await client.execute(bound === undefined ? sql : { sql, args: bound });
          return result.rows;
        },
      };
    },
    async execute(sql: string, args?: Args) {
      const bound = toInArgs(args);
      const result = await client.execute(bound === undefined ? sql : { sql, args: bound });
      return result.rows;
    },
    async batch(statements) {
      if (statements.length === 0) return;
      await client.batch(
        statements.map((s) => {
          const bound = toInArgs(s.args);
          return bound === undefined ? { sql: s.sql } : { sql: s.sql, args: bound };
        }),
        'write',
      );
    },
    async executeMultiple(sql: string) {
      // Schema changes are not always transaction-safe in a single batch, so a
      // migration either applies or throws where the DDL is wrong.
      await client.executeMultiple(sql);
    },
    transaction() {
      return client.transaction('write');
    },
    close() {
      client.close();
    },
  };
}

/**
 * Migrations are tracked in a table rather than `PRAGMA user_version`, because
 * pragmas are not available over the hosted protocol.
 */
export async function migrate(db: Db): Promise<void> {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const rows = await db.execute('SELECT MAX(version) AS v FROM schema_migrations');
  const current = Number(rows[0]?.v ?? 0);

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    try {
      await db.executeMultiple(m.up);
      await db.prepare(
        'INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run([m.version, m.name, Date.now()]);
    } catch (err) {
      throw new Error(`migration ${m.version} (${m.name}) failed: ${(err as Error).message}`);
    }
  }
}

export async function readSettings(db: Db): Promise<Settings> {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    const key = String(r.key);
    const value = String(r.value);
    try {
      stored[key] = JSON.parse(value);
    } catch {
      stored[key] = value;
    }
  }
  const merged = { ...DEFAULT_SETTINGS, ...stored } as Settings;
  merged.ttlSeconds = { ...DEFAULT_SETTINGS.ttlSeconds, ...(stored.ttlSeconds as object | undefined) };
  return merged;
}

export async function writeSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  const now = Date.now();
  const entries = Object.entries(patch);
  await db.batch(
    entries.map(([key, value]) => ({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [key, JSON.stringify(value), now],
    })),
  );
  return readSettings(db);
}

let cached: Db | null = null;

/**
 * Process-wide handle. On a server this is created per invocation, which is fine:
 * the client is stateless until a query runs, and the database is the source of
 * truth rather than anything held in memory.
 */
export function getDb(): Db {
  if (!cached) {
    cached = openDb(isHosted ? hostedUrl : dbPath);
  }
  return cached;
}

export function closeDb(): void {
  cached?.close();
  cached = null;
}
