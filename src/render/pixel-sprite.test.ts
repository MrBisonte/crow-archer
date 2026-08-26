/**
 * The sprite cache's key, which is the whole of what these check.
 *
 * `scale` used to reach the canvas dimensions and the painter and never the
 * key, so two draws of one grid at two sizes were one cache entry and both got
 * whichever rendered first. Nothing caught it while every call site passed the
 * default 1; the first screen to draw a hero at two sizes would have.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { installStubCanvas } from './grid-testkit';
import type { PixelGrid } from './pixel-grid';
import { spriteCanvas, spriteFlashCanvas } from './pixel-sprite';

beforeAll(() => { installStubCanvas(); });

/** A 2x2 grid, enough to have a size worth scaling. */
const GRID: PixelGrid = [
  ['#39FF14', null],
  [null, '#39FF14'],
];

describe('spriteCanvas', () => {
  it('caches, so one key drawn twice is one canvas', () => {
    expect(spriteCanvas('hero', GRID, 2, 2)).toBe(spriteCanvas('hero', GRID, 2, 2));
  });

  it('gives each scale its own canvas, at its own size', () => {
    const small = spriteCanvas('hero', GRID, 2, 2, 3);
    const big = spriteCanvas('hero', GRID, 2, 2, 4);
    expect(small).not.toBe(big);
    expect([small.width, small.height]).toEqual([6, 6]);
    expect([big.width, big.height]).toEqual([8, 8]);
  });

  it('does not hand a later scale the canvas an earlier one cached', () => {
    // The failure this exists for: ask for 3 first, then 4, and get a 6x6 back
    // for the 4 because the key did not say which was which.
    spriteCanvas('order', GRID, 2, 2, 3);
    expect(spriteCanvas('order', GRID, 2, 2, 4).width).toBe(8);
    spriteCanvas('reverse', GRID, 2, 2, 4);
    expect(spriteCanvas('reverse', GRID, 2, 2, 3).width).toBe(6);
  });

  it('treats the default scale as a scale like any other', () => {
    expect(spriteCanvas('plain', GRID, 2, 2)).toBe(spriteCanvas('plain', GRID, 2, 2, 1));
  });
});

describe('spriteFlashCanvas', () => {
  it('gives each scale its own canvas, the same as the unflashed one', () => {
    const small = spriteFlashCanvas('hit', GRID, 2, 2, '#ffffff', 3);
    const big = spriteFlashCanvas('hit', GRID, 2, 2, '#ffffff', 4);
    expect(small).not.toBe(big);
    expect([small.width, big.width]).toEqual([6, 8]);
  });

  it('still separates colours', () => {
    expect(spriteFlashCanvas('hit2', GRID, 2, 2, '#ffffff', 2))
      .not.toBe(spriteFlashCanvas('hit2', GRID, 2, 2, '#ff0000', 2));
  });

  it('never collides with the unflashed sprite of the same key and scale', () => {
    expect(spriteCanvas('both', GRID, 2, 2, 2))
      .not.toBe(spriteFlashCanvas('both', GRID, 2, 2, '#ffffff', 2));
  });
});
