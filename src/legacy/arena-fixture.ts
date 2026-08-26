/**
 * Fixtures for tests that need to know what the ground is.
 *
 * `generateMap` runs on an unseeded `Math.random`, so any test that fires
 * something across the map is really asking a question about where the
 * generator put a tree. Two tests have already been fixed for exactly that:
 * the wizard's homing bolt bounced off a trunk about one run in sixty, and the
 * archer's power shot stopped on one about one run in fifteen. Both read as a
 * regression in the thing under test rather than as terrain.
 *
 * Clearing the field is the fix in both cases, and this is the one copy of it.
 */

import { TILE } from '../sim/tilemap';

import { devHooks as g } from './game.js';

/**
 * Strips every tile inside the border back to open ground.
 *
 * The border ring is left alone: it is what keeps a body on the map, and a
 * test that removes it is testing a map the game never builds.
 */
export function clearArena(): void {
  const c = g.config();
  const tiles = g.tiles();
  for (let row = 1; row < c.rows - 1; row++)
    for (let col = 1; col < c.cols - 1; col++) tiles.set(row, col, TILE.EMPTY);
}
