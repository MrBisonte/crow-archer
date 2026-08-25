/**
 * The arena's size is one fact, and three modules used to state it separately.
 *
 * `MAP_COLS`/`MAP_ROWS` size the tile grid, `ARENA_W`/`ARENA_H` size the
 * networked worlds, and `CONFIG` sizes the canvas the legacy game draws on.
 * Nothing tied them together: `arena-map.ts` claimed the match in a comment and
 * `arena.ts` spelled the numbers out again as `33 * 32`. Changing the grid
 * therefore left multiplayer simulating a box the old size inside the new
 * canvas — no error, no failing test, just a fraction of the map playable.
 *
 * This lives under `legacy/` rather than `sim/` because it reads the legacy
 * `CONFIG` at runtime, and `sim` must not import `legacy`.
 */

import { describe, expect, it } from 'vitest';

import { ARENA_H, ARENA_W } from '../sim/arena';
import { MAP_COLS, MAP_ROWS, TILE_SIZE } from '../sim/arena-map';
import { devHooks } from './game.js';

describe('the arena has one size', () => {
  it('sizes the networked worlds from the tile grid', () => {
    expect({ w: ARENA_W, h: ARENA_H }).toEqual({
      w: MAP_COLS * TILE_SIZE,
      h: MAP_ROWS * TILE_SIZE,
    });
  });

  it('sizes the legacy canvas from the tile grid', () => {
    const config = devHooks.config();
    expect({
      tileSize: config.tileSize,
      cols: config.cols,
      rows: config.rows,
      canvasW: config.canvasW,
      canvasH: config.canvasH,
    }).toEqual({
      tileSize: TILE_SIZE,
      cols: MAP_COLS,
      rows: MAP_ROWS,
      canvasW: MAP_COLS * TILE_SIZE,
      // The HUD is a band above the playfield, so the canvas is taller than the
      // grid by exactly that much. Everything below it is drawn at +hudHeight.
      canvasH: MAP_ROWS * TILE_SIZE + config.hudHeight,
    });
  });
});
