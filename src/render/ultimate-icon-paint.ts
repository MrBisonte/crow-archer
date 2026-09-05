/**
 * Draws an ultimate's icon onto a canvas.
 *
 * Split from the rows it draws for the reason `talent-sigil-paint.ts` is split
 * from `talent-sigils.ts`: the art is data with no opinion about a canvas, and
 * this is the twenty lines that need one. The split matters more here, because
 * `ultimate-icons.ts` is GENERATED — hand-written code living in it would be
 * lost the next time somebody re-runs the porter.
 *
 * WHY A GRID AND NOT A PATH. A talent's sigil is a line drawing and scales by
 * stroking a `Path2D`; an ultimate's icon is painted pixel art with a bezel, a
 * lit ground and a cast shadow, which is a `PixelGrid` and goes through the
 * same `spriteCanvas` every sprite in the game does. Same pipeline, not a new
 * one.
 */

import { makePixelGrid, setPixel, type PixelGrid } from './pixel-grid';
import { ULTIMATE_ICON_LEGEND, ULTIMATE_ICON_ROWS, ULTIMATE_ICON_SIZE } from './ultimate-icons';
import { spriteCanvas } from './pixel-sprite';

/**
 * One icon's grid, built once and kept.
 *
 * Memoised for the reason `_skeletonGrids` and `_guardGrids` in game.js are:
 * the painted canvas is already cached by `stamps`, and on a cache hit —
 * which is every frame after the first — `stamps.get` returns it WITHOUT
 * calling the painter. An unmemoised grid is therefore 2304 cells built and
 * thrown away per icon per frame, and the pick screen shows two at once with
 * nothing else competing for the frame, so nobody would ever notice.
 *
 * Keyed on the id alone, which is everything that varies: these are baked
 * drawings with no frame, no rank and no palette. The table is ten entries.
 */
const _iconGrids = new Map<string, PixelGrid>();

/**
 * The grid for one ultimate, or `undefined` for an id with no drawing.
 *
 * Exported for the tests, which build all ten without a canvas.
 */
export function ultimateIconGrid(id: string): PixelGrid | undefined {
  const cached = _iconGrids.get(id);
  if (cached !== undefined) return cached;

  const rows = ULTIMATE_ICON_ROWS[id];
  if (rows === undefined) return undefined;

  const g = makePixelGrid(ULTIMATE_ICON_SIZE, ULTIMATE_ICON_SIZE);
  for (const [y, row] of rows.entries())
    for (let x = 0; x < row.length; x++) {
      // A character with no legend entry paints NOTHING, which is the failure
      // that cost the design side an afternoon. It cannot happen here: the
      // porter builds the legend from the pixels themselves, so the only
      // unnamed character is `.`, which means "no colour reached this cell".
      const c = ULTIMATE_ICON_LEGEND[row[x] ?? '.'];
      if (c !== undefined) setPixel(g, x, y, c);
    }

  _iconGrids.set(id, g);
  return g;
}

/** How the caller wants an icon drawn. Mirrors `SigilPaint`, so a panel that
 *  places a talent sigil places an ultimate icon the same way. */
export interface UltimateIconPaint {
  /** Centre, in canvas pixels. */
  readonly x: number;
  readonly y: number;
  /** Width and height on screen, in canvas pixels. A multiple of
   *  `ULTIMATE_ICON_SIZE` keeps the art on whole pixels; anything else lands
   *  cell edges between them and softens what is deliberately hard. */
  readonly size: number;
}

/**
 * Paints `id` centred on `(x, y)`.
 *
 * Unknown ids draw nothing rather than throwing, the same way
 * `paintTalentSigil` does: the tests bind this set to the ability table, so
 * reaching here with a stranger means something upstream is already wrong and
 * a crash mid-frame would only bury it.
 */
export function paintUltimateIcon(
  ctx: CanvasRenderingContext2D, id: string, opts: UltimateIconPaint,
): void {
  const grid = ultimateIconGrid(id);
  if (grid === undefined) return;
  const scale = opts.size / ULTIMATE_ICON_SIZE;
  ctx.drawImage(
    spriteCanvas(`ultimate|${id}`, grid, ULTIMATE_ICON_SIZE, ULTIMATE_ICON_SIZE, scale),
    opts.x - opts.size / 2, opts.y - opts.size / 2,
  );
}
