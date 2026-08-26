import { describe, expect, it } from 'vitest';

import { DEFAULT_POP, panelAt, panelSlots, type PanelRow } from './panel-row';

/** The char-select row: five heroes on the shipped canvas. */
const ROW: PanelRow = {
  count: 5,
  canvasW: 1056,
  sideMargin: 56,
  bandMidY: 285,
  restH: 284,
  pop: DEFAULT_POP,
};

const centres = (selected: number): number[] =>
  panelSlots(ROW, selected).map((s) => s.x + s.w / 2);

describe('panelSlots', () => {
  it('keeps every slot centred where it was, whichever panel is picked', () => {
    // The whole point of the layout: the picked panel grows, the row does not
    // shuffle. Today every panel resizes and all five slide sideways.
    const first = centres(0);
    for (let i = 1; i < ROW.count; i++) expect(centres(i)).toEqual(first);
  });

  it('grows the picked panel about its own centre', () => {
    const slots = panelSlots(ROW, 2);
    const picked = slots[2]!;
    const unpicked = slots[1]!;
    expect(picked.w).toBeGreaterThan(unpicked.w);
    expect(picked.h).toBeGreaterThan(unpicked.h);
    // Same centre as it has when it is not the picked one.
    const idle = panelSlots(ROW, 0)[2]!;
    expect(picked.x + picked.w / 2).toBeCloseTo(idle.x + idle.w / 2, 6);
    expect(picked.y + picked.h / 2).toBeCloseTo(idle.y + idle.h / 2, 6);
  });

  it('centres the row on the canvas and follows the canvas when it changes', () => {
    // Measured with nothing picked, so the span is the row of slots rather
    // than the row plus one panel's overhang into the margin.
    const narrow = panelSlots(ROW, -1);
    const wide = panelSlots({ ...ROW, canvasW: 1760 }, -1);
    const span = (s: ReturnType<typeof panelSlots>): [number, number] =>
      [s[0]!.x, s[s.length - 1]!.x + s[s.length - 1]!.w];

    for (const [slots, w] of [[narrow, 1056], [wide, 1760]] as const) {
      const [left, right] = span(slots);
      // Equal margins either side: the row is centred, not pinned. Within a
      // pixel, because an odd leftover has to land on one side or the other.
      expect(Math.abs(left - (w - right))).toBeLessThanOrEqual(1);
      // And it actually uses the canvas it was given. The bug this replaces
      // sized a 998px row from a literal 1000 whatever the canvas was.
      expect(right - left).toBeGreaterThan(w * 0.8);
    }
  });

  it('leaves the grown panel clear of its neighbours at the default pop', () => {
    const slots = panelSlots(ROW, 2);
    const picked = slots[2]!;
    expect(picked.x).toBeGreaterThan(slots[1]!.x + slots[1]!.w);
    expect(picked.x + picked.w).toBeLessThan(slots[3]!.x);
  });

  it('never lets a panel escape the canvas, at any pop', () => {
    for (const pop of [1, 1.25, 1.6]) {
      for (let sel = 0; sel < ROW.count; sel++) {
        for (const s of panelSlots({ ...ROW, pop }, sel)) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w).toBeLessThanOrEqual(ROW.canvasW);
        }
      }
    }
  });

  it('clamps a pop outside the range rather than trusting it', () => {
    const huge = panelSlots({ ...ROW, pop: 99 }, 0);
    const capped = panelSlots({ ...ROW, pop: 1.6 }, 0);
    expect(huge[0]!.w).toBe(capped[0]!.w);
    const tiny = panelSlots({ ...ROW, pop: 0.1 }, 0);
    const flat = panelSlots({ ...ROW, pop: 1 }, 0);
    expect(tiny[0]!.w).toBe(flat[0]!.w);
  });

  it('at pop 1 draws every panel identically', () => {
    const slots = panelSlots({ ...ROW, pop: 1 }, 3);
    const [w, h] = [slots[0]!.w, slots[0]!.h];
    for (const s of slots) { expect(s.w).toBe(w); expect(s.h).toBe(h); }
  });

  it('returns nothing for an empty roster instead of dividing by zero', () => {
    expect(panelSlots({ ...ROW, count: 0 }, 0)).toEqual([]);
    // A one-hero roster is the other end of the same guard.
    expect(panelSlots({ ...ROW, count: 1 }, 0)).toHaveLength(1);
  });

  it('handles a selection index that is not on the row', () => {
    // Nothing picked yet, or a hero that was removed from the roster.
    const slots = panelSlots(ROW, -1);
    expect(slots).toHaveLength(5);
    const [w] = [slots[0]!.w];
    for (const s of slots) expect(s.w).toBe(w);
  });
});

describe('panelAt', () => {
  const slots = panelSlots(ROW, 2);
  const mid = (i: number): [number, number] =>
    [slots[i]!.x + slots[i]!.w / 2, slots[i]!.y + slots[i]!.h / 2];

  it('finds the panel under a point', () => {
    for (let i = 0; i < ROW.count; i++) expect(panelAt(slots, 2, ...mid(i))).toBe(i);
  });

  it('answers nothing for a gutter, and for anywhere off the row', () => {
    const gutter = slots[0]!.x + slots[0]!.w + 2;
    expect(panelAt(slots, 2, gutter, slots[0]!.y + 10)).toBeNull();
    expect(panelAt(slots, 2, slots[0]!.x + 10, 10)).toBeNull();
    expect(panelAt(slots, 2, ROW.canvasW - 1, slots[0]!.y + 10)).toBeNull();
  });

  it('gives an overlapped point to the picked panel, which is the one on top', () => {
    // At a pop high enough to overlap, the grown panel is drawn over its
    // neighbour — so the click has to land on what the player can see.
    const overlapping = panelSlots({ ...ROW, pop: 1.6 }, 2);
    const picked = overlapping[2]!;
    const left = overlapping[1]!;
    const seam = picked.x + 1;
    if (seam < left.x + left.w) {
      expect(panelAt(overlapping, 2, seam, picked.y + picked.h / 2)).toBe(2);
    }
  });

  it('includes the panel edges, so a click on the border still counts', () => {
    const s = slots[0]!;
    expect(panelAt(slots, 2, s.x, s.y)).toBe(0);
    expect(panelAt(slots, 2, s.x + s.w - 1, s.y + s.h - 1)).toBe(0);
  });
});
