/**
 * Guards on the ported icons that looking at one cannot give you.
 *
 * The pictures themselves are judged by rendering them, which is what the
 * design pipeline's `icon-png.mjs` is for. These are the faults that survive
 * being looked at, or that only appear once the rows become a grid.
 */
import { describe, expect, it } from 'vitest';

import { ultimateIconGrid } from './ultimate-icon-paint';
import { ULTIMATE_ICON_LEGEND, ULTIMATE_ICON_ROWS, ULTIMATE_ICON_SIZE } from './ultimate-icons';

describe('the ultimate icon grids', () => {
  const ids = Object.keys(ULTIMATE_ICON_ROWS);

  it('names a colour for every character the rows spell with', () => {
    // The failure this catches is the one the design side paid an afternoon
    // for: a character with no legend entry paints NOTHING and errors nowhere,
    // so a whole object can go missing and leave a blank plate behind it.
    for (const [id, rows] of Object.entries(ULTIMATE_ICON_ROWS)) {
      const unnamed = [...new Set(rows.join(''))]
        .filter((ch) => ch !== '.' && !(ch in ULTIMATE_ICON_LEGEND))
        .sort();
      expect(unnamed, `${id} spells with characters that have no colour`).toEqual([]);
    }
  });

  it('builds a full grid for every one of them', () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const grid = ultimateIconGrid(id)!;
      expect(grid.length, id).toBe(ULTIMATE_ICON_SIZE);
      // Both bounds. An empty grid is what a legend lookup that quietly missed
      // produces, and a full one is what a `.` that stopped meaning empty
      // produces -- the bezel is round, so the corners must stay unpainted.
      const filled = grid.flat().filter((c) => c !== null).length;
      const cells = ULTIMATE_ICON_SIZE * ULTIMATE_ICON_SIZE;
      expect(filled, `${id} paints nothing`).toBeGreaterThan(cells / 2);
      expect(filled, `${id} paints its rounded corners`).toBeLessThan(cells);
    }
  });

  it('builds each grid once and keeps it', () => {
    // The whole reason the cache exists: `stamps.get` returns a cached canvas
    // WITHOUT calling the painter, so a grid rebuilt per call is 2304 cells
    // built and thrown away every frame.
    for (const id of ids) expect(ultimateIconGrid(id)).toBe(ultimateIconGrid(id));
  });

  it('has nothing for an id it was never given', () => {
    expect(ultimateIconGrid('notAnUltimate')).toBeUndefined();
  });
});
