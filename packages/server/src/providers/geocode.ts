import type { Db } from '../db/client.ts';
import type { Settings } from '../settings.ts';
import { userAgent } from '../settings.ts';
import type { DomainScheduler } from '../lib/buckets.ts';

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GeocodeResult {
  ok: boolean;
  displayName: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
  bbox: BBox | null;
  osmType: string | null;
  osmId: number | null;
  /** Overpass area id (3600000000 + relation id) when the result is a relation. */
  areaId: number | null;
  category: string | null;
  error: string | null;
  fromCache: boolean;
}

export const NOMINATIM_HOST = 'nominatim.openstreetmap.org';

/**
 * Nominatim's boundingbox is [south, north, west, east] — latitude bounds first.
 * Overpass wants (south, west, north, east). Swapping these silently returns
 * the wrong part of the planet, so the mapping lives in exactly one place.
 */
export function bboxFromNominatim(bb: unknown): BBox | null {
  if (!Array.isArray(bb) || bb.length !== 4) return null;
  const nums = bb.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [south, north, west, east] = nums as [number, number, number, number];
  return { south, west, north, east };
}

export function locationKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface Geocoder {
  geocode(location: string): Promise<GeocodeResult>;
}

export interface GeocoderOptions {
  db: Db;
  settings: () => Settings;
  scheduler: DomainScheduler;
  fetchImpl?: typeof fetch;
}

export function createGeocoder(opts: GeocoderOptions): Geocoder {
  const { db, scheduler } = opts;
  const doFetch = opts.fetchImpl ?? fetch;

  const read = db.prepare('SELECT * FROM geocode_cache WHERE location_key = ?');
  const write = db.prepare(`
    INSERT INTO geocode_cache (location_key, location_text, display_name, country_code, lat, lon,
                               bbox_south, bbox_west, bbox_north, bbox_east, osm_type, osm_id, area_id,
                               osm_category, fetched_at, fetch_state, error)
    VALUES (@location_key, @location_text, @display_name, @country_code, @lat, @lon,
            @bbox_south, @bbox_west, @bbox_north, @bbox_east, @osm_type, @osm_id, @area_id,
            @osm_category, @fetched_at, @fetch_state, @error)
    ON CONFLICT(location_key) DO UPDATE SET
      display_name = excluded.display_name, country_code = excluded.country_code,
      lat = excluded.lat, lon = excluded.lon, bbox_south = excluded.bbox_south,
      bbox_west = excluded.bbox_west, bbox_north = excluded.bbox_north, bbox_east = excluded.bbox_east,
      osm_type = excluded.osm_type, osm_id = excluded.osm_id, area_id = excluded.area_id,
      osm_category = excluded.osm_category, fetched_at = excluded.fetched_at,
      fetch_state = excluded.fetch_state, error = excluded.error
  `);

  return {
    async geocode(location: string): Promise<GeocodeResult> {
      const settings = opts.settings();
      const key = locationKey(location);

      // Nominatim's policy requires caching and forbids repeated identical queries,
      // so a location string is looked up at most once, ever.
      const cached = read.get(key) as Record<string, unknown> | undefined;
      if (cached && cached.fetch_state === 'ok') {
        return {
          ok: true,
          displayName: cached.display_name as string,
          countryCode: cached.country_code as string | null,
          lat: cached.lat as number,
          lon: cached.lon as number,
          bbox: {
            south: cached.bbox_south as number,
            west: cached.bbox_west as number,
            north: cached.bbox_north as number,
            east: cached.bbox_east as number,
          },
          osmType: cached.osm_type as string | null,
          osmId: cached.osm_id as number | null,
          areaId: cached.area_id as number | null,
          category: cached.osm_category as string | null,
          error: null,
          fromCache: true,
        };
      }

      const url = new URL('/search', settings.geocoderBaseUrl);
      url.searchParams.set('q', location);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '1');

      const fail = (error: string): GeocodeResult => {
        write.run({
          location_key: key,
          location_text: location,
          display_name: null,
          country_code: null,
          lat: null,
          lon: null,
          bbox_south: null,
          bbox_west: null,
          bbox_north: null,
          bbox_east: null,
          osm_type: null,
          osm_id: null,
          area_id: null,
          osm_category: null,
          fetched_at: Date.now(),
          fetch_state: 'error',
          error,
        });
        return {
          ok: false, displayName: null, countryCode: null, lat: null, lon: null, bbox: null,
          osmType: null, osmId: null, areaId: null, category: null, error, fromCache: false,
        };
      };

      try {
        const res = await scheduler.run(NOMINATIM_HOST, () =>
          doFetch(url.toString(), {
            headers: { 'User-Agent': userAgent(settings), 'Accept-Language': 'en' },
            signal: AbortSignal.timeout(settings.fetchTimeoutMs * 2),
          }),
        );
        if (res.status === 403) {
          return fail(
            'OpenStreetMap refused the request (403 Access denied). This almost always means the contact in Settings is missing or is a placeholder such as example.com.',
          );
        }
        if (res.status === 429) {
          return fail('OpenStreetMap is rate limiting this machine (429). Wait a minute and try again.');
        }
        if (!res.ok) return fail(`HTTP ${res.status}`);
        const json = (await res.json()) as Array<Record<string, unknown>>;
        const hit = json[0];
        if (!hit) return fail('No place matched that name. Try adding a country or region.');

        const bbox = bboxFromNominatim(hit.boundingbox);
        if (!bbox) return fail('The location came back without a usable bounding box.');

        const address = (hit.address ?? {}) as Record<string, string>;
        const osmType = (hit.osm_type as string | null) ?? null;
        const osmId = hit.osm_id != null ? Number(hit.osm_id) : null;
        const areaId = osmType === 'relation' && osmId !== null ? 3_600_000_000 + osmId : null;

        write.run({
          location_key: key,
          location_text: location,
          display_name: (hit.display_name as string) ?? null,
          country_code: address.country_code ?? null,
          lat: hit.lat != null ? Number(hit.lat) : null,
          lon: hit.lon != null ? Number(hit.lon) : null,
          bbox_south: bbox.south,
          bbox_west: bbox.west,
          bbox_north: bbox.north,
          bbox_east: bbox.east,
          osm_type: osmType,
          osm_id: osmId,
          area_id: areaId,
          osm_category: (hit.category as string) ?? (hit.type as string) ?? null,
          fetched_at: Date.now(),
          fetch_state: 'ok',
          error: null,
        });

        return {
          ok: true,
          displayName: (hit.display_name as string) ?? null,
          countryCode: address.country_code ?? null,
          lat: hit.lat != null ? Number(hit.lat) : null,
          lon: hit.lon != null ? Number(hit.lon) : null,
          bbox,
          osmType,
          osmId,
          areaId,
          category: (hit.category as string) ?? null,
          error: null,
          fromCache: false,
        };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
