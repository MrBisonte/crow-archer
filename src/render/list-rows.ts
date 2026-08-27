/**
 * A vertical list of full-width rows, sized to fit whatever it is given.
 *
 * The sibling of `panel-row.ts` for the screens that read down instead of
 * across: the upgrade shop and the talent tree. Both are "a stack of bands you
 * point at and buy from", and both had, or would have had, the same three
 * figures written into them by hand.
 *
 * The rules are the ones `docs/playbooks/screens.md` was written for.
 *
 * The width comes off the canvas. The upgrade screen drew a 560 px band
 * whatever the canvas was — a comfortable 53% of the 1056 it was authored
 * against, and 32% of a 1760 one, with a third of the screen empty on each
 * side.
 *
 * The pitch shrinks but never grows. Four rows in a tall band should sit close
 * together, not spread to the corners; a list long enough to overflow tightens
 * instead of running off the bottom. So the pitch is the smaller of the cap
 * and what the band affords.
 *
 * What is left over goes above and below equally. A list that fills its band
 * starts at the top and ends at the foot; a short one sits in the middle of
 * it. Top-aligning both put three talent rows against the heading with a third
 * of the screen empty beneath them, which reads as a screen still loading.
 *
 * Selection moves nothing, because there is no selection here at all: a row's
 * box is the same box whether or not the cursor is on it. Highlighting is the
 * painter's business.
 *
 * Pure geometry: no canvas, no game state. The screen asks where the rows are
 * and paints them; the click handler asks which row a point is in. One answer,
 * two callers, so what is drawn and what is clickable cannot drift.
 */

/** A row's band, in canvas pixels. */
export interface ListRow {
  /** Top-left of the band. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The band's middle, which is where a row's text hangs. */
  readonly midY: number;
}

export interface ListRowSpec {
  /** The canvas the band is centred on. Its width derives from this. */
  readonly canvasW: number;
  readonly canvasH: number;
  /** How many rows. Zero is allowed and yields none. */
  readonly count: number;
  /** First usable y, below the screen's own heading. */
  readonly top: number;
  /** Last usable y, above the key hint. No row crosses it. */
  readonly bottom: number;
  /** Widest a row's pitch may get, so a short list stays a list. */
  readonly maxPitch: number;
  /** Tallest a band may get, independent of the pitch that carries it. */
  readonly maxBandH: number;
  /** Share of the canvas width a band spans. */
  readonly widthFrac: number;
}

/** How much of the pitch a band gives up to the gap under it. */
const BAND_GAP = 8;

/**
 * Where every row of the list sits.
 *
 * A pitch that would not fit is divided down; one that fits with room to
 * spare stays at its cap, and the block it makes is centred in the band. The
 * band height follows the pitch minus a gap, so the gap between rows survives
 * the tightening and two rows never fuse into one target.
 */
export function listRows(spec: ListRowSpec): ListRow[] {
  if (spec.count <= 0) return [];
  const span = spec.bottom - spec.top;
  const pitch = Math.min(spec.maxPitch, Math.floor(span / spec.count));
  const h = Math.min(spec.maxBandH, pitch - BAND_GAP);
  // The block is the rows plus the gaps between them — the trailing gap under
  // the last row is not part of it, or a centred block would sit high by half
  // a gap.
  const blockH = (spec.count - 1) * pitch + h;
  const top = spec.top + Math.max(0, Math.floor((span - blockH) / 2));
  const w = spec.canvasW * spec.widthFrac;
  const x = (spec.canvasW - w) / 2;
  const rows: ListRow[] = [];
  for (let i = 0; i < spec.count; i++) {
    const y = top + i * pitch;
    rows.push({ x, y, w, h, midY: y + h / 2 });
  }
  return rows;
}

/**
 * Which row a point is in, or null.
 *
 * A miss is a miss: the gap between two bands belongs to neither, and nothing
 * snaps to the nearest. On a screen that spends the player's feathers, a
 * click that lands near a row must not buy it.
 */
export function rowAt(rows: readonly ListRow[], x: number, y: number): number | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return null;
}
