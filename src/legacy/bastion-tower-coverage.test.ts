/**
 * The bastion's towers must be able to shoot the barrier they defend.
 *
 * Both halves of that sentence move with the grid, and they moved at different
 * rates. Towers are anchored west in the spawn block (`TOWER_COL`), while the
 * barrier was placed a quarter of the way across, so a wider grid walked the
 * barrier out of reach and took all four gates with it — every gate sits on the
 * barrier's centre columns. At 55 columns that left one gate of four covered;
 * at 71, none.
 *
 * Nothing caught it, because `bastion-terrain.test.ts` pins `rows=21, cols=33`
 * and the shipped grid is the one size where the geometry happens to work. So
 * this asserts the property at sizes the game does not ship, which is the only
 * form of the test that can fail before a resize rather than after it.
 *
 * It lives under `legacy/` because the reach is `CONFIG.towerReach` and `sim`
 * must not import `legacy`.
 */

import { describe, expect, it } from 'vitest';

import { TILE_SIZE } from '../sim/arena-map';
import { barrierGates, towerSites } from '../sim/bastion-terrain';
import { makeTower, towerCentre } from '../sim/towers';
import { devHooks } from './game.js';

/** Grid sizes to hold the property at: the shipped one, and four it is not. */
const GRIDS = [
  { rows: 21, cols: 33 },
  { rows: 27, cols: 45 },
  { rows: 33, cols: 55 },
  { rows: 37, cols: 71 },
  { rows: 45, cols: 91 },
] as const;

/** Distance from the nearest standing tower to a gate's centre, in pixels. */
function nearestTowerTo(rows: number, cols: number, gate: { row: number; col: number }): number {
  const centres = towerSites(rows, cols)
    .map(site => towerCentre(makeTower(site.row, site.col), TILE_SIZE));
  const gx = (gate.col + 0.5) * TILE_SIZE;
  const gy = (gate.row + 0.5) * TILE_SIZE;
  return Math.min(...centres.map(c => Math.hypot(c.x - gx, c.y - gy)));
}

describe('the towers cover the barrier they defend', () => {
  const reach = devHooks.config().towerReach;

  for (const { rows, cols } of GRIDS) {
    it(`reaches every gate on a ${cols}x${rows} grid`, () => {
      const gates = barrierGates(rows, cols);
      expect(gates.length).toBeGreaterThan(0);

      const out = gates
        .filter(gate => nearestTowerTo(rows, cols, gate) > reach)
        .map(gate => `r${gate.row}c${gate.col} at ${nearestTowerTo(rows, cols, gate).toFixed(1)}px`);

      expect(out).toEqual([]);
    });
  }
});
