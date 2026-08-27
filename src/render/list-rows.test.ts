import { describe, expect, it } from 'vitest';

import { type ListRowSpec, listRows, rowAt } from './list-rows';

/** The upgrade screen's own shape, as the numbers it shipped with. */
const SPEC: ListRowSpec = {
  canvasW: 1760, canvasH: 1104,
  count: 4,
  top: 170, bottom: 1050,
  maxPitch: 96, maxBandH: 76,
  widthFrac: 0.62,
};

const spec = (over: Partial<ListRowSpec>): ListRowSpec => ({ ...SPEC, ...over });

describe('listRows', () => {
  it('gives one row per entry, and none for none', () => {
    expect(listRows(SPEC)).toHaveLength(4);
    expect(listRows(spec({ count: 0 }))).toEqual([]);
  });

  it('keeps one pitch and one height for every row', () => {
    const rows = listRows(spec({ count: 6 }));
    const gaps = rows.slice(1).map((r, i) => r.y - rows[i]!.y);
    expect(new Set(gaps).size, 'the pitch drifts down the list').toBe(1);
    expect(new Set(rows.map((r) => r.h)).size, 'the rows are not one height').toBe(1);
  });

  it('never spills past the foot, however many rows it is given', () => {
    for (const count of [1, 4, 9, 17, 40]) {
      const rows = listRows(spec({ count }));
      const last = rows[rows.length - 1]!;
      expect(last.y + last.h, `${count} rows spill past the foot`)
        .toBeLessThanOrEqual(SPEC.bottom);
      expect(rows[0]!.y, `${count} rows start above the top`)
        .toBeGreaterThanOrEqual(SPEC.top);
    }
  });

  it('holds the pitch at its cap rather than spreading a short list out', () => {
    // Four rows in an 880 px band would sit 220 apart if the height were
    // simply divided. The screen wants them close together.
    const rows = listRows(SPEC);
    expect(rows[1]!.y - rows[0]!.y).toBe(SPEC.maxPitch);
    expect(rows[0]!.h).toBe(SPEC.maxBandH);
  });

  it('centres a short block in its band instead of hanging it off the top', () => {
    // Three talent rows top-aligned left a third of the screen empty under
    // them, which reads as a screen that has not finished drawing.
    const rows = listRows(spec({ count: 3 }));
    const above = rows[0]!.y - SPEC.top;
    const below = SPEC.bottom - (rows[rows.length - 1]!.y + rows[0]!.h);
    expect(above, 'the block is not centred').toBeCloseTo(below, -1);
    expect(above, 'a short block was left at the top').toBeGreaterThan(0);
  });

  it('gives a block that fills its band the whole band', () => {
    // Centring must not become a permanent inset: once the pitch is divided
    // down to fit, there is nothing left over to share.
    const rows = listRows(spec({ count: 40 }));
    expect(rows[0]!.y - SPEC.top).toBeLessThanOrEqual(SPEC.maxPitch);
  });

  it('widens with the canvas, because a row is not a pixel count', () => {
    // The guard the screens playbook exists for: the row this replaced was a
    // literal 560 px, which is a third of a 1760 canvas.
    const narrow = listRows(spec({ canvasW: 1056 }))[0]!;
    const wide = listRows(spec({ canvasW: 1760 }))[0]!;
    expect(wide.w / narrow.w).toBeCloseTo(1760 / 1056, 5);
  });

  it('centres the band on the canvas', () => {
    for (const canvasW of [1056, 1760, 2272]) {
      const row = listRows(spec({ canvasW }))[0]!;
      expect(row.x + row.w / 2, `off centre at ${canvasW}`).toBeCloseTo(canvasW / 2, 5);
    }
  });

  it('hangs the text line in the middle of the band', () => {
    for (const row of listRows(spec({ count: 7 }))) {
      expect(row.midY).toBeCloseTo(row.y + row.h / 2, 5);
    }
  });
});

describe('rowAt', () => {
  const rows = listRows(SPEC);

  it('finds the row a point is inside', () => {
    rows.forEach((r, i) => {
      expect(rowAt(rows, r.x + r.w / 2, r.midY), `row ${i} does not hit-test`).toBe(i);
    });
  });

  it('answers nothing beside, above or below the band', () => {
    const r = rows[0]!;
    expect(rowAt(rows, r.x - 4, r.midY)).toBeNull();
    expect(rowAt(rows, r.x + r.w + 4, r.midY)).toBeNull();
    expect(rowAt(rows, r.x + 4, r.y - 4)).toBeNull();
    const last = rows[rows.length - 1]!;
    expect(rowAt(rows, last.x + 4, last.y + last.h + 4)).toBeNull();
  });

  it('answers nothing in the gap between two rows', () => {
    // The gap is real: pitch exceeds height, so a click between rows is a
    // miss rather than a nearest-row guess. A screen that snapped to the
    // nearest would buy a talent the player did not point at.
    const gapY = rows[0]!.y + rows[0]!.h + (SPEC.maxPitch - SPEC.maxBandH) / 2;
    expect(rowAt(rows, rows[0]!.x + 4, gapY)).toBeNull();
  });
});
