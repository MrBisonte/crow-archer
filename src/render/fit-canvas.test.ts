import { describe, expect, it } from 'vitest';

import { fitToViewport } from './fit-canvas';

/** The shipped grid, and the one it is being enlarged to. */
const SHIPPED = { width: 1056, height: 720 };
const ENLARGED = { width: 1760, height: 1104 };

describe('fitToViewport', () => {
  it('shows a canvas 1:1 when the viewport has room for it', () => {
    expect(fitToViewport(SHIPPED, { width: 2560, height: 1330 })).toEqual(SHIPPED);
  });

  it('never scales past 1:1, however much room there is', () => {
    expect(fitToViewport(SHIPPED, { width: 7680, height: 4320 })).toEqual(SHIPPED);
  });

  it('fits the whole canvas rather than cropping it', () => {
    // A 1920x1080 laptop at 150% scaling: 1280x630 of CSS pixels, which is
    // smaller than the shipped canvas already and much smaller than the new one.
    const shown = fitToViewport(ENLARGED, { width: 1280, height: 630 });
    expect(shown.width).toBeLessThanOrEqual(1280);
    expect(shown.height).toBeLessThanOrEqual(630);
  });

  it('keeps the aspect ratio, so nothing is stretched', () => {
    const shown = fitToViewport(ENLARGED, { width: 1280, height: 630 });
    const want = ENLARGED.width / ENLARGED.height;
    expect(shown.width / shown.height).toBeCloseTo(want, 2);
  });

  it('is limited by whichever axis is tighter', () => {
    // Wide and short: height decides.
    expect(fitToViewport({ width: 100, height: 100 }, { width: 900, height: 50 }))
      .toEqual({ width: 50, height: 50 });
    // Tall and narrow: width decides.
    expect(fitToViewport({ width: 100, height: 100 }, { width: 40, height: 900 }))
      .toEqual({ width: 40, height: 40 });
  });

  it('returns the buffer unchanged rather than a canvas of nothing', () => {
    // A canvas before the game has sized it, and a window reporting no size,
    // are both states this runs in. Zero back would be an invisible game.
    expect(fitToViewport(SHIPPED, { width: 0, height: 0 })).toEqual(SHIPPED);
    expect(fitToViewport({ width: 0, height: 0 }, { width: 800, height: 600 }))
      .toEqual({ width: 0, height: 0 });
  });
});
