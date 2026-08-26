/**
 * Staging helpers for tests that drive the legacy game through `devHooks`.
 *
 * Everything here exists because the arena a test gets is *generated*, and a
 * generated arena is a second, silent input to any assertion about something
 * travelling across it. An arrow, a thrown charge or a walked path meets
 * whatever the generator put in the way, so the count a test asserts becomes a
 * question about where the trees landed rather than about the rule under test.
 *
 * That is not hypothetical: it flaked the power shot's pierce test roughly one
 * run in five — the arrow spent a pierce charge on a tree, and three bodies
 * short of five became two.
 */

import { TILE, type TileId } from '../sim/tilemap';
import { devHooks as g } from './game.js';

/**
 * Flattens the arena to open ground, leaving the border wall standing.
 *
 * The border is deliberately left: it is what stops a body walking off the map,
 * and a test that clears it is testing a state the game cannot reach.
 *
 * Call it *after* `go('playing')` — that runs `initGame`, which generates the
 * map, so clearing before it is undone immediately.
 */
export function clearArena(): void {
  const c = g.config() as { rows: number; cols: number };
  const tiles = g.tiles() as { set: (row: number, col: number, tile: TileId) => void };
  for (let row = 1; row < c.rows - 1; row++) {
    for (let col = 1; col < c.cols - 1; col++) tiles.set(row, col, TILE.EMPTY);
  }
}
