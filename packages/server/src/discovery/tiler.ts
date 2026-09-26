import type { BBox } from '../providers/geocode.ts';

export const MAX_TILE_DEPTH = 4;
/** ~500m. Below this, splitting stops helping and just burns requests. */
export const MIN_TILE_DEGREES = 0.005;

export interface Tile {
  index: number;
  depth: number;
  bbox: BBox;
}

/** A child tile before it is assigned a persisted index by the caller. */
export interface TileSpawn {
  depth: number;
  bbox: BBox;
}

/**
 * Adaptive tiling rather than a fixed grid: a fixed grid wastes dozens of empty
 * queries on a rural county and times out on every cell of a dense city. We start
 * with the whole area and only split where the server tells us it struggled.
 */
export function rootTile(bbox: BBox): Tile {
  return { index: 0, depth: 0, bbox };
}

export function tileSpan(bbox: BBox): number {
  return Math.max(bbox.north - bbox.south, bbox.east - bbox.west);
}

export function canSplit(tile: Tile): boolean {
  return tile.depth < MAX_TILE_DEPTH && tileSpan(tile.bbox) > MIN_TILE_DEGREES * 2;
}

export function splitTile(tile: Tile): TileSpawn[] {
  const { south, west, north, east } = tile.bbox;
  const midLat = (south + north) / 2;
  const midLon = (west + east) / 2;
  const depth = tile.depth + 1;
  const quadrants: BBox[] = [
    { south, west, north: midLat, east: midLon },
    { south, west: midLon, north: midLat, east },
    { south: midLat, west, north, east: midLon },
    { south: midLat, west: midLon, north, east },
  ];
  return quadrants.map((bbox) => ({ depth, bbox }));
}

/**
 * Split when the tile failed, or when it came back at the element cap — hitting
 * the cap is the only observable proxy for truncation, since Overpass has no
 * "truncated" flag.
 */
export function shouldSplit(opts: { ok: boolean; capped: boolean; tile: Tile }): boolean {
  if (!canSplit(opts.tile)) return false;
  return !opts.ok || opts.capped;
}
