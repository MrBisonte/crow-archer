/**
 * Test-only readings of a PixelGrid, treated as the data it is.
 *
 * Sprite art is checked as data, never as a picture. What a detail pass can
 * quietly break is always one of the same few things: the grid stops being
 * the size its sprite constants promise, a cell ends up holding something a
 * canvas fillStyle cannot take, the one team-readable marker gets painted
 * over, or the grid stops surviving the bake into a cached canvas. Every
 * stage of the art work needs those same readings, so they live here once
 * rather than once per sprite family.
 */

import type { PixelGrid } from './pixel-grid';

/** The colour format every filled cell has to be in to survive the blit. */
export const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

export const isHexColour = (c: string): boolean => HEX_COLOUR.test(c);

export function gridSize(grid: PixelGrid): { w: number; h: number } {
  return { w: grid[0]?.length ?? 0, h: grid.length };
}

/** Indices of rows whose width differs from the first row's, so a grid that
 * is the right height but ragged fails on its own terms rather than as some
 * later, stranger symptom. */
export function raggedRows(grid: PixelGrid): number[] {
  const { w } = gridSize(grid);
  return [...grid.entries()].filter(([, row]) => row.length !== w).map(([y]) => y);
}

export function countFilled(grid: PixelGrid): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== null) n++;
  return n;
}

export function gridColours(grid: PixelGrid): Set<string> {
  const seen = new Set<string>();
  for (const row of grid) for (const c of row) if (c !== null) seen.add(c);
  return seen;
}

/** Every distinct cell colour that is not a hex string. Empty is the pass. */
export function invalidColours(grid: PixelGrid): string[] {
  return [...gridColours(grid)].filter((c) => !isHexColour(c));
}

/**
 * How many separate runs of filled cells one row has.
 *
 * This is how "does it still have two legs" is asked of a walk cycle. A
 * stride that swings limbs sideways can land two of them in the same columns
 * at the extreme of the swing, which is invisible while the limbs are sparse
 * curves and reads as one thick limb the moment they are solid. Only useful
 * on a sprite with no pixelOutline pass, where the gap between limbs is real
 * emptiness; on an outlined sprite the seam is a coloured pixel, so ask about
 * the colour of the gap column instead.
 */
export function filledRuns(grid: PixelGrid, y: number): number {
  let runs = 0;
  let inRun = false;
  for (const c of grid[y] ?? []) {
    if (c !== null && !inRun) runs++;
    inRun = c !== null;
  }
  return runs;
}

interface StubCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D;
}

/**
 * The smallest `document` stamps.ts can bake a grid into: vitest runs in the
 * `node` environment, so there is no real one. The context carries only what
 * blitPixelGrid actually touches, which means a sprite that starts needing
 * more than a fillStyle and a fillRect fails here loudly instead of silently
 * drawing nothing.
 *
 * src/render/characters.test.ts installs its own *recording* stand-in rather
 * than this one, because it asserts on the individual draw calls; this one
 * only has to not throw. Installing is a no-op where a document already
 * exists, so a DOM environment keeps its own.
 */
export function installStubCanvas(): void {
  const host = globalThis as { document?: unknown };
  if (host.document) return;
  host.document = {
    createElement(tag: string): StubCanvas {
      if (tag !== 'canvas') throw new Error(`the stub document only makes canvases, got "${tag}"`);
      return {
        width: 0,
        height: 0,
        getContext: () =>
          ({ fillStyle: '', fillRect: () => undefined }) as unknown as CanvasRenderingContext2D,
      };
    },
  };
}
