/**
 * Database compatibility preflight.
 *
 * Verifies, before the data layer is rewritten around it, that every SQL feature the
 * app depends on actually works — locally first, then against a hosted Turso database.
 *
 *   node scripts/preflight-db.mjs                       # local only
 *   node scripts/preflight-db.mjs <url> <authToken>     # local and Turso
 *
 * The point is to fail here rather than three files into a refactor.
 */
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [remoteUrl, remoteToken] = process.argv.slice(2);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

/** Exercises everything the app's SQL relies on against one client. */
async function exercise(label, client) {
  console.log(`\n── ${label}\n`);

  // 1. Rows come back addressable by column name. ~80 call sites depend on this.
  await client.execute('DROP TABLE IF EXISTS probe');
  await client.execute(`
    CREATE TABLE probe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload TEXT NOT NULL DEFAULT '{}',
      score INTEGER NOT NULL DEFAULT 0,
      done_at INTEGER,
      dedupe_key TEXT
    )`);
  await client.execute({
    sql: 'INSERT INTO probe (name, payload, score, done_at, dedupe_key) VALUES (?, ?, ?, ?, ?)',
    args: ['alpha', JSON.stringify({ a: 1 }), 42, 1_756_000_000_000, 'k1'],
  });

  const inserted = await client.execute({
    sql: 'SELECT * FROM probe WHERE name = ?',
    args: ['alpha'],
  });
  const first = inserted.rows[0];
  check(
    'rows are addressable by column name',
    Boolean(first) && first.name === 'alpha' && first.score === 42,
    `name=${first?.name} score=${first?.score} typeof score=${typeof first?.score}`,
  );

  // 2. Integer handling: JS arithmetic on scores and timestamps must not receive BigInt.
  const big = await client.execute('SELECT MAX(done_at) AS at FROM probe');
  check(
    'large integers come back as usable numbers',
    typeof big.rows[0]?.at === 'number',
    `typeof=${typeof big.rows[0]?.at} value=${big.rows[0]?.at}`,
  );

  // 3. Partial unique index, and the partial conflict target the job queue uses.
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS probe_dedupe ON probe(dedupe_key) WHERE dedupe_key IS NOT NULL",
  );
  let partialConflict = false;
  let partialDetail = '';
  try {
    await client.execute({
      sql: "INSERT INTO probe (name, dedupe_key) VALUES ('dup', 'k1') ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING",
      args: [],
    });
    const count = await client.execute("SELECT COUNT(*) AS n FROM probe WHERE dedupe_key = 'k1'");
    partialConflict = Number(count.rows[0]?.n) === 1;
    partialDetail = `rows with k1 = ${count.rows[0]?.n} (dedupe held)`;
  } catch (error) {
    partialDetail = error.message;
  }
  check('partial index with a partial conflict target', partialConflict, partialDetail);

  // 4. Upsert with RETURNING — used by the business upsert and the job claim.
  let returning = false;
  let returningDetail = '';
  try {
    const row = await client.execute({
      sql: "INSERT INTO probe (name, status) VALUES (?, 'queued') ON CONFLICT(id) DO UPDATE SET name = excluded.name RETURNING id, name",
      args: ['beta'],
    });
    returning = Boolean(row.rows[0]?.id);
    returningDetail = `returned id=${row.rows[0]?.id} name=${row.rows[0]?.name}`;
  } catch (error) {
    returningDetail = error.message;
  }
  check('INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING', returning, returningDetail);

  // 5. lastInsertRowid, used when enqueueing jobs.
  const enq = await client.execute("INSERT INTO probe (name) VALUES ('gamma')");
  check(
    'lastInsertRowid is usable',
    enq.lastInsertRowid !== undefined && enq.lastInsertRowid !== null,
    `lastInsertRowid=${enq.lastInsertRowid} (${typeof enq.lastInsertRowid}) rowsAffected=${enq.rowsAffected}`,
  );

  // 6. JSON functions: the score reasons and daily rollups are built with these.
  let json = false;
  let jsonDetail = '';
  try {
    const row = await client.execute(`
      SELECT
        json_extract(payload, '$.a') AS a,
        json_group_array(name) AS names
      FROM (SELECT name, payload FROM probe WHERE name IN ('alpha','beta'))`);
    json = row.rows[0]?.a !== undefined && typeof row.rows[0]?.names === 'string';
    jsonDetail = `json_extract=${row.rows[0]?.a} json_group_array=${row.rows[0]?.names}`;
  } catch (error) {
    jsonDetail = error.message;
  }
  check('json_extract and json_group_array', json, jsonDetail);

  let jsonEach = false;
  let jsonEachDetail = '';
  try {
    const row = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM probe WHERE id IN (SELECT value FROM json_each(?))',
      args: [JSON.stringify([1, 2])],
    });
    jsonEach = Number(row.rows[0]?.n) > 0;
    jsonEachDetail = `matched ${row.rows[0]?.n} row(s)`;
  } catch (error) {
    jsonEachDetail = error.message;
  }
  check('json_each for batched IN lookups', jsonEach, jsonEachDetail);

  // 7. Local-day bucketing, used by the daily stats and the weekly graph.
  let dates = false;
  let datesDetail = '';
  try {
    const row = await client.execute({
      sql: "SELECT date(? / 1000, 'unixepoch', 'localtime') AS day",
      args: [1_756_000_000_000],
    });
    dates = /^\d{4}-\d{2}-\d{2}$/.test(String(row.rows[0]?.day));
    datesDetail = `day=${row.rows[0]?.day}`;
  } catch (error) {
    datesDetail = error.message;
  }
  check("date(x, 'unixepoch', 'localtime')", dates, datesDetail);

  // 8. The chunked bulk rescore relies on an ordered LIMIT/OFFSET subquery.
  let chunked = false;
  let chunkedDetail = '';
  try {
    const row = await client.execute({
      sql: 'UPDATE probe SET score = 7 WHERE id IN (SELECT id FROM probe ORDER BY id LIMIT ? OFFSET ?)',
      args: [500, 0],
    });
    chunked = row.rowsAffected >= 0;
    chunkedDetail = `rowsAffected=${row.rowsAffected}`;
  } catch (error) {
    chunkedDetail = error.message;
  }
  check('UPDATE ... WHERE id IN (SELECT ... LIMIT ? OFFSET ?)', chunked, chunkedDetail);

  // 9. Batch, used where several statements must land together.
  let batch = false;
  let batchDetail = '';
  try {
    const out = await client.batch(
      [
        { sql: "INSERT INTO probe (name, status) VALUES ('batched', 'queued')", args: [] },
        { sql: 'SELECT COUNT(*) AS n FROM probe', args: [] },
      ],
      'write',
    );
    batch = Array.isArray(out) && out.length === 2;
    batchDetail = `statements returned=${out.length}`;
  } catch (error) {
    batchDetail = error.message;
  }
  check('batch()', batch, batchDetail);

  // 10. An explicit transaction, used by the duplicate merge.
  let tx = false;
  let txDetail = '';
  try {
    const transaction = await client.transaction('write');
    await transaction.execute("INSERT INTO probe (name, status) VALUES ('tx', 'queued')");
    await transaction.execute('DELETE FROM probe WHERE name = ?', ['tx']);
    await transaction.commit();
    tx = true;
    txDetail = 'committed';
  } catch (error) {
    txDetail = error.message;
  }
  check('transaction()', tx, txDetail);

  // 11. A migrations table, replacing PRAGMA user_version.
  let migrations = false;
  let migrationDetail = '';
  try {
    await client.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    await client.execute({
      sql: 'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      args: [1, 'core schema', Date.now()],
    });
    const row = await client.execute('SELECT MAX(version) AS v FROM schema_migrations');
    migrations = Number(row.rows[0]?.v) === 1;
    migrationDetail = `current version=${row.rows[0]?.v}`;
  } catch (error) {
    migrationDetail = error.message;
  }
  check('schema_migrations table', migrations, migrationDetail);

  // 12. BLOB round trip plus gunzip, which is exactly how cached bodies are stored
  //     and read back. libsql hands BLOBs back as an ArrayBuffer.
  let blob = false;
  let blobDetail = '';
  try {
    const { gzipSync, gunzipSync } = await import('node:zlib');
    const original = '<html>cached body</html>';
    await client.execute('CREATE TABLE IF NOT EXISTS blob_probe (id INTEGER PRIMARY KEY, body BLOB)');
    await client.execute({
      sql: 'INSERT INTO blob_probe (id, body) VALUES (1, ?)',
      args: [new Uint8Array(gzipSync(Buffer.from(original, 'utf8')))],
    });
    const row = await client.execute('SELECT body FROM blob_probe WHERE id = 1');
    const value = row.rows[0]?.body;
    const restored = value == null ? null : gunzipSync(Buffer.from(value)).toString('utf8');
    blob = restored === original;
    blobDetail = `stored as ${value?.constructor?.name}, gunzipped back to ${restored?.length} chars`;
  } catch (error) {
    blobDetail = error.message;
  }
  check('BLOB round trip with gzip (the response cache)', blob, blobDetail);

  // 14. Named parameters bound from an object. Every statement in the app uses this
  //     form (@name) rather than positional placeholders.
  let named = false;
  let namedDetail = '';
  try {
    await client.execute({
      sql: 'INSERT INTO probe (name, status, score) VALUES (@name, @status, @score)',
      args: { name: 'named', status: 'running', score: 9 },
    });
    const row = await client.execute({
      sql: 'SELECT id, name, status, score FROM probe WHERE name = @name AND score = @score',
      args: { name: 'named', score: 9 },
    });
    named = row.rows[0]?.status === 'running' && row.rows[0]?.score === 9;
    namedDetail = `bound @name/@status/@score -> ${JSON.stringify(row.rows[0] ?? null)}`;
  } catch (error) {
    namedDetail = error.message;
  }
  check('named parameters from an object (@name)', named, namedDetail);

  // 15. The exact shape the job queue uses: named args in an UPDATE ... RETURNING
  //     whose subquery picks the next row by priority.
  let claim = false;
  let claimDetail = '';
  try {
    await client.execute("INSERT INTO probe (name, status, score) VALUES ('job-low', 'queued', 1), ('job-high', 'queued', 9)");
    const claimed = await client.execute({
      sql: `UPDATE probe SET status = 'running', score = @now
            WHERE id = (SELECT id FROM probe WHERE status = 'queued' ORDER BY score DESC LIMIT 1)
            RETURNING id, name`,
      args: { now: 123 },
    });
    claim = claimed.rows[0]?.name === 'job-high';
    claimDetail = `claimed ${JSON.stringify(claimed.rows[0] ?? null)}`;
  } catch (error) {
    claimDetail = error.message;
  }
  check('UPDATE ... RETURNING with named args (the job claim)', claim, claimDetail);

  // 13. Informational: FTS5 is being dropped, but knowing is better than assuming.
  let fts = 'unsupported';
  try {
    await client.execute("CREATE VIRTUAL TABLE IF NOT EXISTS fts_probe USING fts5(name)");
    fts = 'available';
  } catch {
    fts = 'unsupported';
  }
  console.log(`  NOTE  FTS5 is ${fts} here (the plan drops it for a LIKE filter regardless)`);
}

const workspace = mkdtempSync(join(tmpdir(), 'libsql-preflight-'));
const clients = [];
try {
  const file = createClient({ url: `file:${join(workspace, 'probe.db')}` });
  clients.push(file);
  await exercise('local file database', file);

  const memory = createClient({ url: ':memory:' });
  clients.push(memory);
  await exercise('in-memory database (used by the test suite)', memory);

  if (remoteUrl) {
    const remote = createClient({ url: remoteUrl, authToken: remoteToken });
    clients.push(remote);
    await exercise(`Turso (${remoteUrl.replace(/\/\/.*@/, '//')})`, remote);
  } else {
    console.log('\nNo Turso URL given — skipping the hosted checks.\n');
  }
} finally {
  // The local driver keeps the file open, so close before removing the directory.
  for (const client of clients) {
    try {
      client.close();
    } catch {
      /* already closed */
    }
  }
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* Windows occasionally still holds the handle; the temp dir is harmless */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
