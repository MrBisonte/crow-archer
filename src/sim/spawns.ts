/**
 * Where each seat starts on a generated map.
 *
 * The four fixed points the lobby used were fine on an empty arena and are not
 * on terrain: a spawn can land inside a rock. These are anchored per seat and
 * then walked outwards to the nearest ground you can actually stand on.
 *
 * Even seats anchor left and odd seats anchor right, which is how the teams
 * fall out: deathmatch alternates teams by slot, so that puts team A on one
 * side and team B on the other without spawns needing to know about teams.
 *
 * Pure and deterministic, because both sides compute it from the same seed and
 * a spawn that differed between them would be a player standing in two places.
 */

import { MAP_COLS, MAP_ROWS, TILE_SIZE, type Terrain } from './arena-map';

/** A point in world pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Where each seat would ideally start, as a fraction of the map.
 *
 * Kept off the edges: the generator walls the border and always leaves the two
 * right-hand columns open, so anchoring inside those would put one team in a
 * corridor and the other in the field.
 */
const ANCHORS: readonly Point[] = [
  { x: 0.18, y: 0.28 },
  { x: 0.82, y: 0.28 },
  { x: 0.18, y: 0.72 },
  { x: 0.82, y: 0.72 },
];

/** How far the search will wander from an anchor before giving up, in tiles. */
const MAX_SEARCH_RADIUS = 12;

/**
 * A spawn for each seat, in slot order.
 *
 * `count` may be anything from one to four, so a 1v1, a 2v1 and a 2v2 all get
 * spawns that are spread rather than a subset huddled in one corner.
 */
export function pickSpawns(terrain: Terrain, count: number): Point[] {
  const spawns: Point[] = [];
  for (let slot = 0; slot < count; slot++) {
    const anchor = ANCHORS[slot % ANCHORS.length]!;
    spawns.push(nearestStandable(terrain, anchor));
  }
  return spawns;
}

/**
 * The centre of the closest tile to an anchor that a body can stand on.
 *
 * Rings outwards rather than scanning the grid, so a clear anchor costs one
 * check and a buried one costs the few rings it takes to get out. Tile centres
 * rather than corners, so nobody spawns half inside a wall.
 */
function nearestStandable(terrain: Terrain, anchor: Point): Point {
  const col0 = Math.floor(anchor.x * MAP_COLS);
  const row0 = Math.floor(anchor.y * MAP_ROWS);

  for (let radius = 0; radius <= MAX_SEARCH_RADIUS; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        // Only the ring's edge is new; the inside was covered by smaller radii.
        if (radius > 0 && Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
        const r = row0 + dr;
        const c = col0 + dc;
        if (r < 0 || r >= MAP_ROWS || c < 0 || c >= MAP_COLS) continue;
        const point = centreOf(r, c);
        if (terrain.walkable(point.x, point.y)) return point;
      }
    }
  }
  // Every tile within twelve of the anchor is solid, which the generator does
  // not produce. Falling back to the anchor keeps a match starting rather than
  // failing, and a body inside rock is pushed out by the first step it takes.
  return centreOf(row0, col0);
}

const centreOf = (row: number, col: number): Point => ({
  x: col * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
});
