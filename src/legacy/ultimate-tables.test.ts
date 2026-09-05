/**
 * Holds the five hero-keyed tables an ultimate is spread across to each other.
 *
 * An ultimate is one idea written in five places: what it DOES (`ULTIMATE`),
 * which meter charges it (`ULTIMATE_CHARGE`), what it leaves running
 * (`ULTIMATE_TICK`), what it looks like when it is ready (`ULTIMATE_AURA`), and
 * the lane-D chip that says so (`LANE_D`). Four of the five are keyed on the
 * hero and must carry the same set of heroes; the fifth is opted into per hero
 * by listing `'ult'`.
 *
 * Nothing bound them together when they were written. They agreed, which is
 * not the same as being kept in agreement: a sixth hero, or a hero whose
 * ultimate is retired, would have silently ended up with an ability and no
 * aura, or a chip that never lights. That is the same failure shape
 * `events.coverage.test.ts` exists to prevent between the event union, the
 * handler and the emit sites, and this is the same remedy -- read the source as
 * text and compare the key sets.
 *
 * `ULTIMATE_TICK` is deliberately NOT required to match: only the ultimates
 * that resolve over time have a row, and an ultimate that finishes on the frame
 * it fires having no row is the point of that table. It is checked in one
 * direction only -- every row it does have must be a real hero with an
 * ultimate.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHARACTERS } from '../net/protocol';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'game.js'), 'utf8');

/** The top-level keys of an object literal declared as `const NAME = { … };`. */
function tableKeys(name: string): string[] {
  const start = source.indexOf(`const ${name} = {`);
  expect(start, `${name} not found in game.js`).toBeGreaterThan(-1);
  const end = source.indexOf('\n};', start);
  expect(end, `${name} has no closing brace`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  // Keys at one level of indentation only: a nested object's keys are two
  // spaces deeper, and counting those would make every table agree with
  // whatever happened to be inside it.
  return [...body.matchAll(/\n {2}(\w+):/g)].map((m) => m[1]!);
}

/** Heroes whose lane-D list opts into the ultimate chip. */
function heroesWithUltChip(): string[] {
  const start = source.indexOf('const LANE_D = {');
  const body = source.slice(start, source.indexOf('\n};', start));
  return [...body.matchAll(/\n {2}(\w+): \[([^\]]*)\]/g)]
    .filter((m) => m[2]!.includes("'ult'"))
    .map((m) => m[1]!);
}

describe('the tables an ultimate is spread across', () => {
  const withUltimate = tableKeys('ULTIMATE');

  it('names only real heroes', () => {
    expect(withUltimate.length).toBeGreaterThan(0);
    expect(withUltimate.filter((h) => !CHARACTERS.includes(h as never))).toEqual([]);
  });

  it('gives every hero with an ultimate a charge meter', () => {
    expect(new Set(tableKeys('ULTIMATE_CHARGE'))).toEqual(new Set(withUltimate));
  });

  it('gives every hero with an ultimate a ready aura', () => {
    // The aura is the only thing on screen that says the ultimate is up before
    // the player looks at the HUD. A hero without one has a silent ability.
    expect(new Set(tableKeys('ULTIMATE_AURA'))).toEqual(new Set(withUltimate));
  });

  it('gives every hero with an ultimate a lane-D chip', () => {
    expect(new Set(heroesWithUltChip())).toEqual(new Set(withUltimate));
  });

  it('leaves a running effect only where a hero has an ultimate to run it', () => {
    // One direction only: an instant ultimate rightly has no row here.
    const ticking = tableKeys('ULTIMATE_TICK');
    expect(ticking.filter((h) => !withUltimate.includes(h))).toEqual([]);
  });
});
