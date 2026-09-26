import type { ProgressEvent } from '@outreach/shared';
import { categoriesFor } from '@outreach/shared';
import type { Db } from '../db/client.ts';
import type { BusinessRepo } from '../db/businesses.ts';
import type { JobQueue } from '../db/jobs.ts';
import type { Geocoder } from '../providers/geocode.ts';
import type { OverpassClient } from '../providers/overpass.ts';
import { buildPoiQuery, ELEMENT_CAP } from '../providers/overpass.ts';
import { normalizePoi } from './normalize.ts';
import { canSplit, rootTile, shouldSplit, splitTile, type Tile } from './tiler.ts';
import { localDay } from '../lib/urls.ts';

export interface DiscoveryCreateInput {
  location: string;
  categories?: string[];
  keyword?: string;
}

export interface DiscoveryServiceDeps {
  db: Db;
  repo: BusinessRepo;
  jobs: JobQueue;
  geocoder: Geocoder;
  overpass: OverpassClient;
  emit: (event: ProgressEvent) => void;
  onDiscoveryComplete?: (queryId: number, poisFound: number, day: string) => void;
}

interface QueryRow {
  id: number;
  location_text: string;
  location_key: string;
  display_name: string | null;
  country_code: string | null;
  bbox_south: number;
  bbox_west: number;
  bbox_north: number;
  bbox_east: number;
  area_id: number | null;
  categories: string;
  keyword: string | null;
  status: string;
  tiles_total: number;
  tiles_done: number;
  pois_found: number;
  used_area_filter: number;
  coverage_verified: number;
  mirror: string | null;
  osm_base: string | null;
  error: string | null;
}

export function createDiscoveryService(deps: DiscoveryServiceDeps) {
  const { db, repo, jobs, geocoder, overpass, emit } = deps;
  const running = new Map<number, boolean>();
  /** Mirrors that returned suspiciously empty results during a run. */
  const suspectedMirrors = new Set<string>();

  const insertQuery = db.prepare(`
    INSERT INTO discovery_query (location_text, location_key, display_name, country_code,
      bbox_south, bbox_west, bbox_north, bbox_east, area_id, categories, keyword,
      status, used_area_filter, created_at, updated_at)
    VALUES (@location_text, @location_key, @display_name, @country_code,
      @bbox_south, @bbox_west, @bbox_north, @bbox_east, @area_id, @categories, @keyword,
      'running', 0, @now, @now)
    RETURNING id`);

  const insertTile = db.prepare(`
    INSERT INTO discovery_tile (query_id, tile_index, depth, south, west, north, east, status, created_at, updated_at)
    VALUES (@query_id, @tile_index, @depth, @south, @west, @north, @east, 'pending', @now, @now)
    ON CONFLICT(query_id, tile_index) DO NOTHING`);

  const getQuery = db.prepare('SELECT * FROM discovery_query WHERE id = ?');
  const updateQuery = db.prepare(`
    UPDATE discovery_query SET status = @status, tiles_total = @tiles_total, tiles_done = @tiles_done,
      pois_found = @pois_found, used_area_filter = @used_area_filter, coverage_verified = @coverage_verified,
      mirror = @mirror, osm_base = @osm_base, error = @error, updated_at = @now
    WHERE id = @id`);

  // A failed tile is retried a bounded number of times, then left failed. Without
  // the cap the loop would retry it forever and the run would never reach a
  // terminal state, because a failed tile stays in this set.
  const MAX_TILE_ATTEMPTS = 3;
  const pendingTiles = db.prepare(
    `SELECT * FROM discovery_tile
     WHERE query_id = ? AND (status = 'pending' OR (status = 'failed' AND attempts < ${MAX_TILE_ATTEMPTS}))
     ORDER BY depth ASC, tile_index ASC`,
  );
  const markTile = db.prepare(`
    UPDATE discovery_tile SET status = @status, overpass_mirror = @mirror, element_count = @element_count,
      duration_ms = @duration_ms, used_area_filter = @used_area_filter, error = @error,
      attempts = attempts + 1, updated_at = @now
    WHERE id = @id`);

  const maxTileIndex = db.prepare('SELECT COALESCE(MAX(tile_index), -1) AS n FROM discovery_tile WHERE query_id = ?');
  const countTiles = db.prepare('SELECT COUNT(*) AS n FROM discovery_tile WHERE query_id = ?');

  function bumpCounters(query: QueryRow, patch: Partial<QueryRow>, now: number): void {
    const merged = { ...query, ...patch };
    updateQuery.run({
      id: merged.id,
      status: merged.status,
      tiles_total: merged.tiles_total,
      tiles_done: merged.tiles_done,
      pois_found: merged.pois_found,
      used_area_filter: merged.used_area_filter,
      coverage_verified: merged.coverage_verified,
      mirror: merged.mirror,
      osm_base: merged.osm_base,
      error: merged.error,
      now,
    });
    Object.assign(query, merged);
    emit({
      type: 'discovery',
      queryId: query.id,
      status: query.status,
      poisFound: query.pois_found,
      tilesDone: query.tiles_done,
      tilesTotal: query.tiles_total,
      mirror: query.mirror,
    });
  }

  async function processTile(
    query: QueryRow,
    row: TileRow,
    categories: ReturnType<typeof categoriesFor>,
  ): Promise<'ok' | 'split' | 'failed' | 'unavailable'> {
    const now = Date.now();
    const bbox = { south: row.south, west: row.west, north: row.north, east: row.east };
    const tile: Tile = { index: row.tile_index, depth: row.depth, bbox };
    let useArea = query.area_id !== null;
    let result = await overpass.run(
      buildPoiQuery({ categories, bbox, areaId: useArea ? query.area_id : null, keyword: query.keyword }),
      { exclude: [...suspectedMirrors] },
    );

    let areaFallback = false;
    // Area creation is subject to extraction rules and lags hours, so an
    // area-filtered query can silently return nothing for a city full of POIs.
    if (result.ok && result.elements.length === 0 && useArea) {
      areaFallback = true;
      useArea = false;
      result = await overpass.run(
        buildPoiQuery({ categories, bbox, areaId: null, keyword: query.keyword }),
        { exclude: [...suspectedMirrors] },
      );
    }

    // Coverage guard: a valid 200 with an empty list is indistinguishable from a
    // mirror that simply does not carry this region (regional extracts answer
    // exactly like this). Verify once per run against a different mirror before
    // believing that a populated area has no businesses.
    if (
      result.ok &&
      result.elements.length === 0 &&
      query.coverage_verified === 0 &&
      query.pois_found === 0 &&
      result.mirror &&
      result.mirror !== 'cache'
    ) {
      const second = await overpass.run(
        buildPoiQuery({ categories, bbox, areaId: null, keyword: query.keyword }),
        { exclude: [result.mirror], allowCache: false },
      );
      if (second.ok && second.elements.length > 0) {
        suspectedMirrors.add(result.mirror);
        overpass.penalize(result.mirror, `returned 0 elements where ${second.mirror} returned ${second.elements.length}`);
        result = second;
      }
      query.coverage_verified = 1;
    }

    if (!result.ok) {
      // Splitting only helps when the server said the query was too heavy. When the
      // mirrors are unreachable, splitting multiplies the load on servers that are
      // already struggling and turns one failure into a cascade.
      const canRetrySmaller = result.failureKind === 'server_timeout' && canSplit(tile);
      markTile.run({
        id: row.id,
        status: canRetrySmaller ? 'split' : 'failed',
        mirror: result.mirror,
        element_count: 0,
        duration_ms: result.durationMs,
        used_area_filter: useArea ? 1 : 0,
        error: result.error,
        now,
      });
      if (canRetrySmaller) spawnChildren(query, row);
      query.tiles_done += 1;
      query.osm_base = query.osm_base ?? result.osmBase;
      bumpCounters(query, {}, now);
      return result.failureKind === 'unavailable' ? 'unavailable' : canRetrySmaller ? 'split' : 'failed';
    }

    let inserted = 0;
    for (const element of result.elements) {
      const poi = normalizePoi(element);
      if (!poi) continue;
      // The geocoded country is the fallback for parsing national phone formats.
      const { id } = repo.upsertPoi(poi, query.id, now, query.country_code);
      jobs.enqueue({
        type: 'probe_site',
        payload: { businessId: id, queryId: query.id },
        dedupeKey: `probe:${id}`,
      });
      inserted++;
    }

    query.pois_found += inserted;
    query.tiles_done += 1;
    query.used_area_filter = useArea && !areaFallback ? 1 : query.used_area_filter;
    query.mirror = result.mirror;
    query.osm_base = result.osmBase ?? query.osm_base;

    const split = shouldSplit({ ok: true, capped: result.capped, tile });
    if (split) {
      markTile.run({
        id: row.id, status: 'split', mirror: result.mirror, element_count: result.elements.length,
        duration_ms: result.durationMs, used_area_filter: useArea ? 1 : 0, error: null, now,
      });
      spawnChildren(query, row);
    } else {
      markTile.run({
        id: row.id, status: 'ok', mirror: result.mirror, element_count: result.elements.length,
        duration_ms: result.durationMs, used_area_filter: useArea ? 1 : 0, error: null, now,
      });
    }

    bumpCounters(query, {}, now);
    return split ? 'split' : 'ok';
  }

  interface TileRow {
    id: number;
    query_id: number;
    tile_index: number;
    depth: number;
    south: number;
    west: number;
    north: number;
    east: number;
    status: string;
  }

  function spawnChildren(query: QueryRow, row: TileRow): void {
    const children = splitTile({
      index: row.tile_index,
      depth: row.depth,
      bbox: { south: row.south, west: row.west, north: row.north, east: row.east },
    });
    const now = Date.now();
    // Indices are allocated from the database rather than a module-level counter,
    // so two discovery runs in flight at once cannot collide on tile_index.
    let nextIndex = (maxTileIndex.get(query.id) as { n: number }).n + 1;
    for (const child of children) {
      insertTile.run({
        query_id: query.id,
        tile_index: nextIndex++,
        depth: child.depth,
        south: child.bbox.south,
        west: child.bbox.west,
        north: child.bbox.north,
        east: child.bbox.east,
        now,
      });
    }
  }

  async function runQuery(queryId: number): Promise<void> {
    if (running.get(queryId)) return;
    running.set(queryId, true);
    try {
      const initial = getQuery.get(queryId) as QueryRow | undefined;
      if (!initial) return;
      const categories = categoriesFor(JSON.parse(initial.categories) as string[]);

      let unreachable = 0;
      let abortReason: string | null = null;
      for (;;) {
        const query = getQuery.get(queryId) as QueryRow | undefined;
        if (!query) break;
        const tiles = pendingTiles.all(queryId) as TileRow[];
        // Pending is empty only when every tile is ok, split, or out of attempts —
        // i.e. the work is finished, so fall through to the terminal status.
        if (!tiles.length) break;
        query.tiles_total = (countTiles.get(queryId) as { n: number }).n;
        const outcome = await processTile(query, tiles[0]!, categories);

        // Two consecutive "cannot reach any mirror" results mean the problem is the
        // service, not this query. Grinding through the remaining tiles would burn
        // requests, so stop and say so.
        if (outcome === 'unavailable') {
          unreachable++;
          if (unreachable >= 2) {
            abortReason = 'The public Overpass mirrors are not responding right now. Your last search may have been rate limited — wait a few minutes and try again.';
            break;
          }
        } else {
          unreachable = 0;
        }

        // Overpass policy forbids parallel scripts from one app, so tiles are
        // strictly sequential with a polite gap.
        await new Promise((r) => setTimeout(r, 1100));
      }

      const finished = getQuery.get(queryId) as QueryRow | undefined;
      if (finished) {
        const failedTiles = (
          db.prepare("SELECT COUNT(*) AS n FROM discovery_tile WHERE query_id = ? AND status = 'failed'").get(queryId) as { n: number }
        ).n;
        // Report partial success honestly rather than pretending a run was clean.
        const status = abortReason
          ? finished.pois_found > 0
            ? 'done'
            : 'error'
          : finished.pois_found > 0
            ? 'done'
            : failedTiles > 0
              ? 'error'
              : 'empty';
        bumpCounters(
          finished,
          {
            status,
            error:
              abortReason ??
              (failedTiles > 0
                ? `${failedTiles} of ${finished.tiles_total} area${finished.tiles_total === 1 ? '' : 's'} could not be fetched from any mirror — results are partial. Try again in a few minutes.`
                : finished.error),
          },
          Date.now(),
        );
        const day = localDay();
        // Recorded in the append-only log only: daily_stat is rebuilt from it, so
        // the graph can never disagree with the log.
        deps.onDiscoveryComplete?.(queryId, finished.pois_found, day);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const query = getQuery.get(queryId) as QueryRow | undefined;
      if (query) bumpCounters(query, { status: 'error', error: message }, Date.now());
      emit({ type: 'log', level: 'error', message: `Discovery failed: ${message}`, at: Date.now() });
    } finally {
      running.delete(queryId);
    }
  }

  return {
    async create(input: DiscoveryCreateInput): Promise<{ ok: true; queryId: number } | { ok: false; error: string }> {
      const location = input.location.trim();
      if (!location) return { ok: false, error: 'Enter a location to search.' };

      const geo = await geocoder.geocode(location);
      if (!geo.ok || !geo.bbox) {
        return { ok: false, error: geo.error ?? 'Could not find that location.' };
      }

      const now = Date.now();
      const categories = input.categories?.length ? input.categories : ['all'];
      const info = insertQuery.get({
        location_text: location,
        location_key: location.toLowerCase().replace(/\s+/g, ' '),
        display_name: geo.displayName,
        country_code: geo.countryCode,
        bbox_south: geo.bbox.south,
        bbox_west: geo.bbox.west,
        bbox_north: geo.bbox.north,
        bbox_east: geo.bbox.east,
        area_id: geo.areaId,
        categories: JSON.stringify(categories),
        keyword: input.keyword?.trim() || null,
        now,
      }) as { id: number };

      const root = rootTile(geo.bbox);
      insertTile.run({
        query_id: info.id,
        tile_index: root.index,
        depth: root.depth,
        south: root.bbox.south,
        west: root.bbox.west,
        north: root.bbox.north,
        east: root.bbox.east,
        now,
      });
      updateQuery.run({
        id: info.id, status: 'running', tiles_total: 1, tiles_done: 0, pois_found: 0,
        used_area_filter: geo.areaId ? 1 : 0, coverage_verified: 0,
        mirror: null, osm_base: null, error: null, now,
      });

      // Detached: the HTTP response returns immediately with the id and the UI
      // follows progress over SSE.
      void runQuery(info.id);

      return { ok: true, queryId: info.id };
    },
    runQuery,
    /** Called on boot so a crash mid-discovery resumes instead of restarting. */
    resumeInterrupted(): void {
      const rows = db
        .prepare("SELECT id FROM discovery_query WHERE status = 'running' ORDER BY id ASC")
        .all() as { id: number }[];
      for (const row of rows) {
        emit({ type: 'log', level: 'info', message: `Resuming discovery #${row.id}`, at: Date.now() });
        void runQuery(row.id);
      }
    },
    cancel(queryId: number): void {
      running.delete(queryId);
      updateQuery.run({
        id: queryId, status: 'cancelled', tiles_total: 0, tiles_done: 0, pois_found: 0,
        used_area_filter: 0, coverage_verified: 0, mirror: null, osm_base: null,
        error: 'Cancelled', now: Date.now(),
      });
    },
  };
}

export type DiscoveryService = ReturnType<typeof createDiscoveryService>;
export { ELEMENT_CAP };
