/**
 * What a player must be able to pick out of the field while it is busy: a crow
 * on a dark floor, the wizard behind his own lance, and the field under a banner.
 */
import { describe, expect, it } from 'vitest';

import { devHooks as g } from './game.js';

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string): number => {
  const [r, g2, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * lin(r) + 0.7152 * lin(g2) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** The forest's open floor, from TILE_PAINTERS. */
const FOREST_FLOOR = '#1a2a1a';

describe('a crow reads against the forest floor', () => {
  it.each(['a', 'mid', 'b'])('keeps a third of frame %s at 3:1 or better', (frame) => {
    const grid = (g as unknown as { crowGrid: (k: string, f: string) => (string | null)[][] }).crowGrid('normal', frame);
    const cells = grid.flat().filter((c): c is string => c !== null);
    const strong = cells.filter((c) => ratio(c, FOREST_FLOOR) >= 3);
    expect(strong.length / cells.length).toBeGreaterThanOrEqual(1 / 3);
  });
});
