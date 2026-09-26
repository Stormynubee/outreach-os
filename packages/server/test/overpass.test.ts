import { describe, expect, it, vi } from 'vitest';
import { categoriesFor } from '@outreach/shared';
import { openDb, migrate, type Db } from '../src/db/client.ts';
import { buildPoiQuery, createOverpassClient, parseOverpassBody } from '../src/providers/overpass.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings.ts';

const makeDb = (): Db => {
  const db = openDb(':memory:');
  migrate(db);
  return db;
};

const settings = (): Settings => ({ ...DEFAULT_SETTINGS, contactEmail: 'test-contact', overpassMirrors: ['https://mirror.test/api/interpreter'] });

const jsonResponse = (elements: unknown[]): Response =>
  new Response(JSON.stringify({ version: 0.6, generator: 'Overpass API test', osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z' }, elements }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const bboxA = { south: 51.0, west: -2.5, north: 51.1, east: -2.4 };
const bboxB = { south: 52.0, west: -3.5, north: 52.1, east: -3.4 };

describe('overpass query building', () => {
  it('includes a name filter and a centre modifier', () => {
    const query = buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxA });
    expect(query).toContain('["name"]');
    // Without `center`, ways and relations come back with no coordinates at all.
    expect(query).toMatch(/out (tags center|center tags) \d+;/);
    expect(query).toContain('[out:json]');
  });

  it('scopes by area when one is available, and always carries the bbox', () => {
    const withArea = buildPoiQuery({ categories: categoriesFor(['retail']), bbox: bboxA, areaId: 3600123456 });
    expect(withArea).toContain('area(3600123456)->.a;');
    expect(withArea).toContain('(area.a)(51.000000,-2.500000,51.100000,-2.400000)');

    const withoutArea = buildPoiQuery({ categories: categoriesFor(['retail']), bbox: bboxA, areaId: null });
    expect(withoutArea).not.toContain('area(');
  });

  it('anchors category regexes so substrings do not match', () => {
    const query = buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxA });
    expect(query).toContain('^(restaurant|cafe|bar|pub|');
    expect(query).not.toMatch(/"\^\(bar\)\$"/);
  });
});

describe('overpass response validation', () => {
  it('rejects the HTML error page that Overpass returns with HTTP 200', () => {
    const parsed = parseOverpassBody('<!DOCTYPE html><html><body>Error</body></html>', 200);
    expect(parsed.ok).toBe(false);
    // A body it cannot parse is never treated as an empty-but-valid result.
    expect(parsed.failureKind).toBe('unavailable');
  });

  it('rejects a JSON body carrying a fatal remark', () => {
    const parsed = parseOverpassBody(
      JSON.stringify({ version: 0.6, remark: 'runtime error: Query timed out in "query" at line 3', elements: [] }),
      200,
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/timed out/i);
  });

  it('accepts a non-fatal remark and keeps the elements', () => {
    const parsed = parseOverpassBody(
      JSON.stringify({ version: 0.6, remark: 'note: something harmless', elements: [{ type: 'node', id: 1 }] }),
      200,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.elements).toHaveLength(1);
  });

  it('rejects a body with no elements array', () => {
    expect(parseOverpassBody(JSON.stringify({ version: 0.6 }), 200).ok).toBe(false);
    expect(parseOverpassBody('', 200).ok).toBe(false);
  });

  it('reads the database timestamp used for attribution', () => {
    const parsed = parseOverpassBody(
      JSON.stringify({ version: 0.6, osm3s: { timestamp_osm_base: '2026-02-03T04:05:06Z' }, elements: [] }),
      200,
    );
    expect(parsed.osmBase).toBe('2026-02-03T04:05:06Z');
  });
});

describe('overpass caching', () => {
  it('caches a repeated identical query', async () => {
    const db = makeDb();
    const fetchImpl = vi.fn(async () => jsonResponse([{ type: 'node', id: 1, lat: 51, lon: -2, tags: { name: 'A' } }]));
    const client = createOverpassClient({ db, settings, fetchImpl });

    const query = buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxA });
    const first = await client.run(query);
    const second = await client.run(query);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.elements).toHaveLength(1);
  });

  /**
   * Regression: the cache key used to be a truncated hash of the query. The tile
   * bounding box sits at the END of a generated query, so every tile of a search
   * shared one key and returned the first tile's results for all of them — a
   * silent corruption that looked exactly like a working, complete crawl.
   */
  it('does not serve one tile of a search from another tile cache entry', async () => {
    const db = makeDb();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      return jsonResponse([{ type: 'node', id: call, lat: 51, lon: -2, tags: { name: `Tile${call}` } }]);
    });
    const client = createOverpassClient({ db, settings, fetchImpl });

    const tileA = buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxA });
    const tileB = buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxB });

    const a = await client.run(tileA);
    const b = await client.run(tileB);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(a.elements[0]!.tags!.name).toBe('Tile1');
    expect(b.elements[0]!.tags!.name).toBe('Tile2');
  });

  it('treats a tile that hit the element cap as needing a split', async () => {
    const db = makeDb();
    const many = Array.from({ length: 3000 }, (_, i) => ({ type: 'node', id: i, lat: 51, lon: -2, tags: { name: `N${i}` } }));
    const client = createOverpassClient({ db, settings, fetchImpl: async () => jsonResponse(many) });
    const result = await client.run(buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxA }));
    expect(result.capped).toBe(true);
  });

  it('classifies a mirror error page so the caller can decide whether to retry smaller', () => {
    // The Overpass server itself aborted the query: splitting the tile may help.
    const busy = parseOverpassBody(
      '<html><body>OSM3S Response Error : runtime error: Query timed out in "query" at line 3.</body></html>',
      200,
    );
    expect(busy.ok).toBe(false);
    expect(busy.failureKind).toBe('server_timeout');

    // A plain gateway error says nothing about the query, so splitting would
    // multiply load on a mirror that is already down.
    const gateway = parseOverpassBody('<html><head><title>504 Gateway Time-out</title></head></html>', 504);
    expect(gateway.failureKind).toBe('unavailable');

    const malformed = parseOverpassBody('not json at all', 200);
    expect(malformed.failureKind).toBe('bad_request');
  });

  it('reports an unavailable failure kind when every mirror is unreachable', async () => {
    const db = makeDb();
    const client = createOverpassClient({
      db,
      settings,
      fetchImpl: async () => {
        throw new Error('connect ETIMEDOUT');
      },
    });
    const result = await client.run(buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxA }));
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe('unavailable');
  });

  it('reports an actionable error when every mirror fails', async () => {
    const db = makeDb();
    const client = createOverpassClient({
      db,
      settings,
      fetchImpl: async () => new Response('<html><body>504</body></html>', { status: 504 }),
    });
    const result = await client.run(buildPoiQuery({ categories: categoriesFor(['food_drink']), bbox: bboxA }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mirrors failed/i);
  });
});
