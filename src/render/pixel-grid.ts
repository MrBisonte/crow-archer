/**
 * Primitives for building a small pixel-art image: one hex color, or null
 * for transparent, per cell. Shared by anything that needs one — animated
 * sprites (see pixel-sprite.ts, cached per-frame via stamps.ts) and static
 * tile art (see tiles.ts, cached once per tile by StaticTileLayer) both
 * build a PixelGrid the same way, then blit it through their own caching
 * layer, because those two caching problems are different but the art
 * underneath them is not.
 */

export type PixelGrid = readonly (string | null)[][];

export function makePixelGrid(w: number, h: number): PixelGrid {
  return Array.from({ length: h }, () => Array(w).fill(null));
}

export function setPixel(g: PixelGrid, x: number, y: number, c: string): void {
  const xi = Math.round(x), yi = Math.round(y);
  const row = g[yi];
  if (row && xi >= 0 && xi < row.length) row[xi] = c;
}

export function pixelRect(g: PixelGrid, x0: number, y0: number, w: number, h: number, c: string): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) setPixel(g, x, y, c);
}

export function pixelEllipse(g: PixelGrid, cx: number, cy: number, rx: number, ry: number, c: string): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(g, x, y, c);
    }
}

export function pixelCurve(
  g: PixelGrid,
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  c: string,
  n: number,
): void {
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    setPixel(
      g,
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
      c,
    );
  }
}

/** Any transparent cell touching a filled one becomes a 1px outline, so a
 * silhouette stays crisp without hand-placing every edge pixel. */
export function pixelOutline(g: PixelGrid, c: string): PixelGrid {
  const h = g.length, w = g[0]?.length ?? 0;
  const out: (string | null)[][] = g.map((row) => row.slice());
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (g[y]?.[x]) continue;
      if (g[y]?.[x - 1] || g[y]?.[x + 1] || g[y - 1]?.[x] || g[y + 1]?.[x]) {
        const row = out[y];
        if (row) row[x] = c;
      }
    }
  return out;
}

/** Fills an upward-pointing triangle, apex up, base centered at (cx, baseY). */
export function pixelTriangleUp(g: PixelGrid, cx: number, baseY: number, halfW: number, h: number, c: string): void {
  for (let i = 0; i < h; i++) {
    const w = Math.max(0, Math.round(halfW - (halfW * i) / (h - 1 || 1)));
    pixelRect(g, cx - w, baseY - i, w * 2 + 1, 1, c);
  }
}

/** Buckets a continuous animation phase into one of 3 pixel-art frames: a
 * flap/stride cycle only reads as pixel art if it steps between hand-drawn
 * poses instead of interpolating smoothly. */
export function animFrame3(phase: number): 'a' | 'mid' | 'b' {
  const s = Math.sin(phase);
  return s > 0.33 ? 'b' : s < -0.33 ? 'a' : 'mid';
}

/** Blits a grid's real colors at (x, y), scaled up. The shared entry point
 * for both cached per-entity stamps (pixel-sprite.ts, offset 0,0 into an
 * isolated canvas) and static tile art (tiles.ts, a real offset into one
 * shared layer canvas). */
export function blitPixelGrid(ctx: CanvasRenderingContext2D, grid: PixelGrid, x: number, y: number, scale: number): void {
  // Runs of one colour go out as a single rect. Same pixels either way, but a
  // per-cell fill costs a fillStyle change per cell, and that state change is
  // what a full-map repaint actually spends its time on.
  for (const [ry, row] of grid.entries()) {
    let start = 0, run: string | null = null;
    for (let rx = 0; rx <= row.length; rx++) {
      const c = rx < row.length ? row[rx] ?? null : null;
      if (c === run) continue;
      if (run) {
        ctx.fillStyle = run;
        ctx.fillRect(x + start * scale, y + ry * scale, (rx - start) * scale, scale);
      }
      run = c; start = rx;
    }
  }
}

/** Same blit with every filled cell forced to one color — a flat silhouette
 * instead of the grid's real colors, e.g. for a hit-flash. */
export function blitPixelGridFlash(
  ctx: CanvasRenderingContext2D, grid: PixelGrid, x: number, y: number, scale: number, color: string,
): void {
  ctx.fillStyle = color;
  for (const [ry, row] of grid.entries())
    for (const [rx, c] of row.entries())
      if (c) ctx.fillRect(x + rx * scale, y + ry * scale, scale, scale);
}
