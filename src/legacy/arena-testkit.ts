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

/** One second of simulation, at the fixed 60 Hz step the loop uses. */
export const ONE_SECOND = 60;

/**
 * Advances the simulation by exactly `n` fixed steps, riding out any impact
 * freeze on the way.
 *
 * `stepSim(n)` is n *frames* of the loop, and hitstop can spend some of them
 * holding the world still (see the HITSTOP ladder in game.js), so a test
 * waiting out a cooldown has to count sim steps rather than frames or it comes
 * up short by however heavily the run happened to land.
 *
 * That is not theoretical. The knight's Bloodlust test read zero stacks off a
 * swing that had plainly connected, because the kill it landed froze the world
 * for long enough that the swing had not finished when the frame budget ran
 * out. Two frames short, and the mechanic looked broken.
 */
export function stepPast(n: number): void {
  for (let i = 0; i < n; i++) {
    while (g.hitstop() > 0) g.stepSim(1);
    g.stepSim(1);
  }
}

/**
 * Points the aim ray at a world position by moving the pointer.
 *
 * Writing `player.aimAngle` directly holds for exactly zero frames: the sim
 * recomputes it from the pointer every tick, as
 * `atan2(aimWorld().y - player.y, aimWorld().x - player.x)`. That is invisible
 * to an instantaneous attack -- an arrow reads the angle once, when it spawns
 * -- and fatal to a sustained one, because the knight's spear samples it on
 * every frame of a 21-frame swing.
 *
 * It stayed hidden while the arena was 33x21, where the default pointer sat
 * close enough to due east of the hero's spawn that a swing aimed at 0 landed
 * anyway. At 55x33 the same pointer reads -45 degrees and every swing misses,
 * so the mechanic looked broken when only the staging was.
 *
 * `aimWorld` subtracts the HUD band from the pointer, so this adds it back.
 */
export function aimAt(wx: number, wy: number): void {
  const m = g.mouse() as { x: number; y: number };
  const c = g.config() as { hudHeight: number };
  m.x = wx;
  m.y = wy + c.hudHeight;
}
