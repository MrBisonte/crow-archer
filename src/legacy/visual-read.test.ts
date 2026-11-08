/**
 * What a player must be able to pick out of the field while it is busy: a crow
 * on a dark floor, the wizard behind his own lance, and the field under a banner.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { beamLine } from '../render/ultimate-fx';
import { devHooks as g } from './game.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'game.js'), 'utf8');
const body = (name: string): string => {
  const from = source.slice(source.indexOf(`function ${name}(`));
  return from.slice(0, from.indexOf('\nfunction ', 1));
};

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

describe('the beam leaves the hero visible', () => {
  it('starts past the round cap and the sprite half-width', () => {
    const clear = g.config().wizBeamMuzzlePx as number;
    const width = g.config().wizBeamWidth as number;
    expect(clear - width / 2).toBeGreaterThanOrEqual(10);
    expect(beamLine(100, 100, 1, 0, clear, 400)).toEqual({ x0: 100 + clear, y0: 100, x1: 500, y1: 100 });
  });

  it('starts at the wall when a wall is nearer than the muzzle', () => {
    expect(beamLine(100, 100, 0, 1, 22, 5)).toEqual({ x0: 100, y0: 105, x1: 100, y1: 105 });
  });

  it('draws both ends from the hero on the canvas, HUD band included', () => {
    const draw = body('drawBeam');
    expect(draw).toContain('beamLine(player.x, player.y + HH,');
    expect(draw).not.toContain('y1 = player.y + ny');
  });
});
