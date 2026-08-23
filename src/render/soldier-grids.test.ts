import { describe, expect, it } from 'vitest';

import { SOLDIER_KINDS } from '../sim/soldiers';
import type { PixelGrid } from './pixel-grid';
import {
  COMMANDER_SPRITE,
  SOLDIER_GRID_BUILDERS,
  SOLDIER_SPRITE,
  buildCommanderGrid,
  type StrideFrame,
} from './soldier-grids';

const FRAMES: StrideFrame[] = ['a', 'mid', 'b'];

/** How many cells a grid actually paints. A silent typo tends to paint none. */
const painted = (g: PixelGrid): number =>
  g.reduce((n, row) => n + row.filter((c) => c !== null && c !== undefined).length, 0);

/** A grid as one comparable string, for telling two of them apart. */
const shapeOf = (g: PixelGrid): string => g.map((row) => row.join(',')).join('|');

describe('soldier grids', () => {
  it.each(SOLDIER_KINDS)('builds %s at the declared sprite size', (kind) => {
    for (const frame of FRAMES) {
      const g = SOLDIER_GRID_BUILDERS[kind](frame);
      expect(g).toHaveLength(SOLDIER_SPRITE.h);
      expect(g[0]).toHaveLength(SOLDIER_SPRITE.w);
    }
  });

  // The check that catches a builder which throws nothing and draws nothing —
  // an off-grid coordinate, or a colour that came out undefined. In the game
  // that is an invisible enemy, and nothing else fails.
  it.each(SOLDIER_KINDS)('paints a real body for %s, not an empty grid', (kind) => {
    for (const frame of FRAMES) {
      expect(painted(SOLDIER_GRID_BUILDERS[kind](frame)), `${kind} ${frame}`)
        .toBeGreaterThan(40);
    }
  });

  it('draws the three kinds differently, so they are told apart on sight', () => {
    const shapes = SOLDIER_KINDS.map((k) => shapeOf(SOLDIER_GRID_BUILDERS[k]('mid')));
    expect(new Set(shapes).size).toBe(SOLDIER_KINDS.length);
  });

  // The stride is the whole animation. Two frames that came out identical
  // would leave a soldier sliding across the floor without moving its legs.
  it.each(SOLDIER_KINDS)('moves %s between the two extremes of its stride', (kind) => {
    expect(shapeOf(SOLDIER_GRID_BUILDERS[kind]('a')))
      .not.toBe(shapeOf(SOLDIER_GRID_BUILDERS[kind]('b')));
  });

  it('is deterministic, so the sprite cache can key on kind and frame alone', () => {
    for (const kind of SOLDIER_KINDS) {
      expect(shapeOf(SOLDIER_GRID_BUILDERS[kind]('a')))
        .toBe(shapeOf(SOLDIER_GRID_BUILDERS[kind]('a')));
    }
  });

  // The shieldman's guard is a rule in sim/soldiers.ts, and this is the
  // picture a player reads it off. If the shield stopped being drawn on the
  // leading side, the rule would still work and would stop making sense.
  it('puts the shieldman\'s shield on the side it is facing', () => {
    const g = SOLDIER_GRID_BUILDERS.shieldman('mid');
    const half = (from: number, to: number): number => {
      let n = 0;
      for (const row of g) for (let x = from; x < to; x++) if (row[x]) n++;
      return n;
    };
    const leading = half(SOLDIER_SPRITE.w / 2, SOLDIER_SPRITE.w);
    const trailing = half(0, SOLDIER_SPRITE.w / 2);
    expect(leading).toBeGreaterThan(trailing);
  });
});

describe('the commander grid', () => {
  it.each(FRAMES)('builds at the declared sprite size on frame %s', (frame) => {
    const g = buildCommanderGrid(frame);
    expect(g).toHaveLength(COMMANDER_SPRITE.h);
    expect(g[0]).toHaveLength(COMMANDER_SPRITE.w);
  });

  it('paints a horse and rider rather than an empty grid', () => {
    expect(painted(buildCommanderGrid('mid'))).toBeGreaterThan(150);
  });

  it('is wider than a soldier, because he is mounted', () => {
    expect(COMMANDER_SPRITE.w).toBeGreaterThan(SOLDIER_SPRITE.w);
  });

  it('moves between the two extremes of the gait', () => {
    expect(shapeOf(buildCommanderGrid('a'))).not.toBe(shapeOf(buildCommanderGrid('b')));
  });
});
