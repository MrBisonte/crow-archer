import { stamps, type StampPainter } from './stamps';

/** A small logical sprite: one hex color, or null for transparent, per cell. */
export type PixelGrid = readonly (string | null)[][];

function gridPainter(grid: PixelGrid, scale: number): StampPainter {
  return (g) => {
    for (const [y, row] of grid.entries())
      for (const [x, c] of row.entries())
        if (c) { g.fillStyle = c; g.fillRect(x * scale, y * scale, scale, scale); }
  };
}

function gridFlashPainter(grid: PixelGrid, color: string, scale: number): StampPainter {
  return (g) => {
    g.fillStyle = color;
    for (const [y, row] of grid.entries())
      for (const [x, c] of row.entries())
        if (c) g.fillRect(x * scale, y * scale, scale, scale);
  };
}

/** The pre-rendered, true-color sprite for a grid. `w`/`h` are the grid's
 * logical cell dimensions (before `scale`); the result is cached by `key`. */
export function spriteCanvas(
  key: string, grid: PixelGrid, w: number, h: number, scale = 1,
): HTMLCanvasElement {
  return stamps.get(key, w * scale, h * scale, gridPainter(grid, scale));
}

/** The same grid painted as a flat single-color silhouette, for hit-flash. */
export function spriteFlashCanvas(
  key: string, grid: PixelGrid, w: number, h: number, color: string, scale = 1,
): HTMLCanvasElement {
  return stamps.get(`${key}|flash|${color}`, w * scale, h * scale, gridFlashPainter(grid, color, scale));
}
