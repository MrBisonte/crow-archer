import { stamps, type StampPainter } from './stamps';
import { blitPixelGrid, blitPixelGridFlash, type PixelGrid } from './pixel-grid';

export type { PixelGrid };

function gridPainter(grid: PixelGrid, scale: number): StampPainter {
  return (g) => blitPixelGrid(g, grid, 0, 0, scale);
}

function gridFlashPainter(grid: PixelGrid, color: string, scale: number): StampPainter {
  return (g) => blitPixelGridFlash(g, grid, 0, 0, scale, color);
}

/**
 * Everything that decides what a cached sprite looks like, in its key.
 *
 * `scale` belongs here and not only in the dimensions. It used to reach the
 * canvas size and the painter and never the key, so one grid asked for at two
 * sizes was a single cache entry and both callers got whichever rendered
 * first. Nothing caught it while every call site passed the default 1 — the
 * first screen to draw a hero at two sizes did, and the symptom there is a
 * sprite that is quietly the wrong size with nothing pointing at a cache.
 *
 * Folded in here rather than at the call sites so every caller is right
 * without having to know the rule, and so the next one added is too.
 */
const cacheKey = (key: string, scale: number): string => `${key}|@${scale}`;

/** The pre-rendered, true-color sprite for a grid. `w`/`h` are the grid's
 * logical cell dimensions (before `scale`); the result is cached by `key`
 * and `scale` together. */
export function spriteCanvas(
  key: string, grid: PixelGrid, w: number, h: number, scale = 1,
): HTMLCanvasElement {
  return stamps.get(cacheKey(key, scale), w * scale, h * scale, gridPainter(grid, scale));
}

/** The same grid painted as a flat single-color silhouette, for hit-flash. */
export function spriteFlashCanvas(
  key: string, grid: PixelGrid, w: number, h: number, color: string, scale = 1,
): HTMLCanvasElement {
  return stamps.get(
    cacheKey(`${key}|flash|${color}`, scale), w * scale, h * scale, gridFlashPainter(grid, color, scale),
  );
}
