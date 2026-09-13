/**
 * A stage title's four colours are one colour, said four ways.
 *
 * Each row of `STAGE_INTROS` carries an `accent`, a `dim`, a `frame` and a
 * `sweep`, and the sweep is not a fifth choice: it is the accent again as
 * `rgba(...)` at the alpha the screen washes with. Nothing said so, and the
 * dark knight's row proved why that matters -- his accent moved from steel to
 * his own fire-sword red and the sweep would have stayed steel, which is a
 * title in one colour lit by another with nothing on screen to explain it and
 * no diff line that looks wrong.
 *
 * Read as source text rather than through the module for the reason
 * `ultimate-tables.test.ts` gives: the table is a plain object literal in a
 * file that exports a game, not a value anything hands out, and counting
 * leading spaces cannot be broken by a scripted edit the way a pattern full of
 * backslashes can.
 *
 * `dim` and `frame` are deliberately NOT pinned to an arithmetic rule. They
 * are hand-picked walks down each accent -- roughly seven tenths and a third,
 * with the dark channels lifted so neither goes flat -- and a formula here
 * would be a formula the next row has to argue with rather than a fact.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'game.js'), 'utf8');

/** One intro row: its key and the text of the lines under it. */
function introRows(): Array<{ name: string; body: string }> {
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => l.startsWith('const STAGE_INTROS = {'));
  expect(start, 'STAGE_INTROS not found in game.js').toBeGreaterThan(-1);
  const end = lines.indexOf('};', start);
  expect(end, 'STAGE_INTROS has no closing brace').toBeGreaterThan(start);

  const out: Array<{ name: string; body: string }> = [];
  for (const line of lines.slice(start + 1, end)) {
    const opened = /^ {2}(\w+): \{$/.exec(line);
    if (opened?.[1] !== undefined) { out.push({ name: opened[1], body: '' }); continue; }
    const row = out[out.length - 1];
    if (row) row.body += `${line}\n`;
  }
  return out;
}

/** `#RRGGBB` as the three channels, so a hex and an rgba can be compared. */
function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

describe('the stage intro palette', () => {
  const rows = introRows();

  it('finds every intro, so an empty listing cannot pass as agreement', () => {
    expect(rows.map((r) => r.name)).toEqual(['castle', 'darkKnight', 'bastion', 'maze']);
  });

  for (const { name, body } of rows) {
    it(`washes ${name} in its own accent`, () => {
      const accent = /accent: '(#[0-9A-Fa-f]{6})'/.exec(body)?.[1];
      const sweep = /sweep: 'rgba\((\d+),\s*(\d+),\s*(\d+),/.exec(body);
      expect(accent, `${name} has no accent`).toBeDefined();
      expect(sweep, `${name} has no sweep`).not.toBeNull();
      expect([Number(sweep?.[1]), Number(sweep?.[2]), Number(sweep?.[3])])
        .toEqual(channels(accent ?? '#000000'));
    });

    it(`gives ${name} a dim and a frame darker than its accent`, () => {
      // The order is the whole content of the three-colour scheme: the accent
      // is the title, the dim is the line under it and the frame is the box
      // round both. Two of them the same brightness is a scheme with two
      // colours in it, whatever the hex says.
      const lit = (hex: string): number => channels(hex).reduce((a, b) => a + b, 0);
      const pick = (key: string): string =>
        new RegExp(`${key}: '(#[0-9A-Fa-f]{6})'`).exec(body)?.[1] ?? '#000000';
      const accent = lit(pick('accent')), dim = lit(pick('dim')), frame = lit(pick('frame'));
      expect(dim, `${name}: dim is not darker than accent`).toBeLessThan(accent);
      expect(frame, `${name}: frame is not darker than dim`).toBeLessThan(dim);
    });
  }
});
