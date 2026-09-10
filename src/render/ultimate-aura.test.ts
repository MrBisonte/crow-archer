/**
 * What the ten ready auras may and may not draw.
 *
 * Two of them shipped painting UNDER the hero and no test noticed: the aura
 * goes down before the sprite, so a shaft through the chest is a shaft with
 * its middle removed and a chevron narrower than the body is a chevron nobody
 * sees. It was found by rendering all ten out of a running game and looking at
 * them, which is the right way to find it and the wrong way to keep it found.
 *
 * So the rule the painters were rewritten around is checked here instead: no
 * aura writes into the cells the hero's own sprite covers. That is a property
 * of the finished grid, readable without a canvas, and it fails by name.
 *
 * The other half is that each frame draws SOMETHING. A guard that only forbids
 * is satisfied by an empty picture, and an aura that paints nothing is the
 * exact failure the whole table exists against.
 */
import { describe, expect, it } from 'vitest';

import { AURA_CELLS, AURA_FRAMES, AURA_IDS, auraFrame, auraGrid } from './ultimate-aura';

/** The sprite's own cells, restated from the module so a box quietly widened
 *  there does not quietly widen what this accepts. */
const BODY = { c0: 8, c1: 16, r0: 7, r1: 16 } as const;

/** Every filled cell of one frame, as `col,row` pairs. */
function filled(id: string, frame: number): Array<readonly [number, number]> {
  const grid = auraGrid(id, frame);
  expect(grid, `${id} frame ${frame} has no grid`).toBeDefined();
  const out: Array<readonly [number, number]> = [];
  for (const [r, row] of (grid ?? []).entries())
    for (const [c, cell] of row.entries()) if (cell) out.push([c, r]);
  return out;
}

describe('the ready auras', () => {
  it('draws ten, which is one per ability', () => {
    expect(AURA_IDS.length).toBe(10);
  });

  for (const id of AURA_IDS) {
    for (let frame = 0; frame < AURA_FRAMES; frame++) {
      it(`keeps ${id} frame ${frame} clear of the body`, () => {
        const under = filled(id, frame).filter(
          ([c, r]) => c >= BODY.c0 && c <= BODY.c1 && r >= BODY.r0 && r <= BODY.r1,
        );
        expect(under.map(([c, r]) => `${c},${r}`)).toEqual([]);
      });

      it(`draws something for ${id} frame ${frame}`, () => {
        // Six blocks is well under the smallest of the ten and well over
        // nothing, which is the only failure this has to catch.
        expect(filled(id, frame).length).toBeGreaterThan(6);
      });
    }

    it(`fits ${id} inside the grid it is given`, () => {
      for (let frame = 0; frame < AURA_FRAMES; frame++)
        for (const [c, r] of filled(id, frame)) {
          expect(c, `${id} frame ${frame} column`).toBeLessThan(AURA_CELLS);
          expect(r, `${id} frame ${frame} row`).toBeLessThan(AURA_CELLS);
        }
    });

    it(`changes ${id} from frame to frame`, () => {
      // Four cached pictures that are all the same picture is a still image
      // paying for an animation, and it costs four cache entries to say so.
      const seen = new Set<string>();
      for (let frame = 0; frame < AURA_FRAMES; frame++)
        seen.add(filled(id, frame).map(([c, r]) => `${c},${r}`).join('|'));
      expect(seen.size).toBeGreaterThan(1);
    });
  }

  it('builds each grid once and keeps it', () => {
    // The whole performance argument for pixel art here. `stamps.get` returns
    // a cached canvas WITHOUT calling the painter, so an unmemoized grid is
    // built and thrown away every frame the aura is up -- which for a ready
    // ultimate is every frame until the player spends it.
    for (const id of AURA_IDS)
      for (let frame = 0; frame < AURA_FRAMES; frame++)
        expect(auraGrid(id, frame)).toBe(auraGrid(id, frame));
  });

  it('steps between frames rather than sliding through them', () => {
    // Whole frames, and only AURA_FRAMES of them however long the clock runs.
    const frames = new Set<number>();
    for (let t = 0; t < 4; t += 1 / 240) frames.add(auraFrame('headshot', t));
    expect([...frames].sort()).toEqual([0, 1, 2, 3]);
  });

  it('runs FULL AUTO faster than the rest, because that is what it says', () => {
    // Its cadence IS the ability: a stutter at everyone else's speed says
    // nothing about the rate of fire the player is about to get.
    const cycles = (id: string): number => {
      let changes = 0;
      for (let t = 1 / 240; t < 1; t += 1 / 240)
        if (auraFrame(id, t) !== auraFrame(id, t - 1 / 240)) changes++;
      return changes;
    };
    expect(cycles('fullAuto')).toBeGreaterThan(cycles('headshot') * 2);
    expect(cycles('theBigOne')).toBeLessThan(cycles('headshot'));
  });

  it('draws nothing at all for an ability it has never heard of', () => {
    expect(auraGrid('noSuchUltimate', 0)).toBeUndefined();
  });
});
