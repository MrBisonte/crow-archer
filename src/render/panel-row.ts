/**
 * A centred row of selection panels where the picked one grows in place.
 *
 * The screens this serves used to compute their own geometry from a literal
 * design width — `1000` in char select, `640` in map select — so the row was
 * the same number of pixels wide whatever the canvas was. At 1056 that cost
 * 29 px a side and nobody noticed; on a wider canvas it leaves the row using
 * a little over half the screen.
 *
 * The second thing it fixes is movement. Char select gave the picked panel
 * 2.33x the width of the others and re-centred the row around it, so every
 * panel slid sideways on every switch. The enlargement is worth keeping — it
 * is the one moment of life on the screen, and it says which hero you are
 * about to play. Pushing the neighbours along to get it is not. So slot
 * centres are fixed and the picked panel grows about its own, which reads the
 * same and moves nothing else. It also means a panel can be clicked without
 * being a moving target.
 *
 * Pure geometry: no canvas, no game state. `drawCharSelect` asks it where the
 * panels are and paints them; the click handler asks it which one a point is
 * inside. One answer, two callers, so the thing drawn and the thing clicked
 * cannot drift apart.
 */

/** A panel's box, in canvas pixels. */
export interface Slot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PanelRow {
  /** How many panels. Zero is allowed and yields no slots. */
  readonly count: number;
  /** The canvas the row is centred on. The row's size derives from this. */
  readonly canvasW: number;
  /** Smallest gap wanted outside the row. Grown, never shrunk, when the
   *  picked panel's overhang would otherwise need more room than this. */
  readonly sideMargin: number;
  /** The line every panel is centred on, so growth is symmetric about it. */
  readonly bandMidY: number;
  /** Height of a panel that is not picked. */
  readonly restH: number;
  /** How much bigger the picked panel is. Clamped to [MIN_POP, MAX_POP]. */
  readonly pop: number;
}

/** Flat: every panel identical, no emphasis at all. */
export const MIN_POP = 1;
/** As far as the geometry goes before the gutters eat the panels. */
export const MAX_POP = 1.6;
/**
 * Enough to read as "this one", far short of the 2.33x it replaces — which
 * was less "picked" than "a different kind of object", and squeezed the other
 * four down to 150 px, which is what pushed their stats off the panel.
 */
export const DEFAULT_POP = 1.25;

/**
 * Gutter as a fraction of a panel's width, over and above what the picked
 * panel's overhang needs. Keeps a visible gap at `MIN_POP`, where the
 * overhang is zero and the panels would otherwise touch.
 */
const GUTTER_RATIO = 0.08;

const clampPop = (pop: number): number =>
  Number.isFinite(pop) ? Math.min(MAX_POP, Math.max(MIN_POP, pop)) : MIN_POP;

/**
 * Panel width and gutter for one margin, given how wide the row may be.
 *
 * The gutter is sized from the pop rather than fixed, so the row breathes
 * exactly as much as the growth needs: at `MIN_POP` panels are wide and gaps
 * are narrow, and both trade the other way as the pop rises.
 */
function measure(row: PanelRow, pop: number, margin: number): { slotW: number; gutter: number } {
  const ratio = (pop - 1) / 2 + GUTTER_RATIO;
  const available = Math.max(0, row.canvasW - margin * 2);
  const slotW = Math.max(1, Math.floor(available / (row.count + (row.count - 1) * ratio)));
  return { slotW, gutter: Math.round(slotW * ratio) };
}

export function panelSlots(row: PanelRow, selectedIndex: number): Slot[] {
  if (row.count <= 0) return [];
  const pop = clampPop(row.pop);

  // Two passes, because the margin the row needs depends on the panel width
  // and the panel width depends on the margin. The picked panel hangs
  // `overhang` past its slot on each side, and the first pass has no way to
  // know how much that is. One correction settles it at every size measured.
  let margin = row.sideMargin;
  let { slotW, gutter } = measure(row, pop, margin);
  for (let pass = 0; pass < 2; pass++) {
    margin = Math.max(row.sideMargin, Math.round((slotW * (pop - 1)) / 2));
    ({ slotW, gutter } = measure(row, pop, margin));
  }

  const overhang = Math.round((slotW * (pop - 1)) / 2);
  const bump = Math.round((row.restH * (pop - 1) * 0.66) / 2);
  const pitch = slotW + gutter;
  const rowW = row.count * slotW + (row.count - 1) * gutter;
  const startX = Math.round((row.canvasW - rowW) / 2);
  const restY = Math.round(row.bandMidY - row.restH / 2);

  const slots: Slot[] = [];
  for (let i = 0; i < row.count; i++) {
    const picked = i === selectedIndex;
    // Both dimensions are the rest size plus twice a whole-pixel inset, and
    // the origin moves back by exactly that inset. That is what keeps the
    // centre bit-for-bit identical whether or not this panel is the picked
    // one — rounding a width and an origin independently would not.
    const w = picked ? slotW + overhang * 2 : slotW;
    const h = picked ? row.restH + bump * 2 : row.restH;
    const x = startX + i * pitch - (picked ? overhang : 0);
    const y = restY - (picked ? bump : 0);
    // Last-resort guard. The two passes above keep the row inside the canvas
    // at every size and pop this ships with; a caller that asks for a margin
    // narrower than its own overhang gets a clipped centre rather than a
    // panel drawn off the edge of the screen.
    slots.push({ x: Math.max(0, Math.min(x, row.canvasW - w)), y, w, h });
  }
  return slots;
}

/**
 * Which panel covers (x, y), or null for a gutter or anywhere off the row.
 *
 * The picked panel is tested first because it is the one drawn on top: where
 * a high pop overlaps a neighbour, the click has to land on the panel the
 * player can actually see.
 */
export function panelAt(
  slots: readonly Slot[],
  selectedIndex: number,
  x: number,
  y: number,
): number | null {
  const inside = (s: Slot): boolean =>
    x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;

  const picked = slots[selectedIndex];
  if (picked !== undefined && inside(picked)) return selectedIndex;
  for (let i = 0; i < slots.length; i++) {
    if (i !== selectedIndex && inside(slots[i]!)) return i;
  }
  return null;
}
