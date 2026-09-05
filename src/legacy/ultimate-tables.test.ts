/**
 * Holds the tables an ultimate is spread across to each other.
 *
 * An ultimate is one idea written in several places: what it DOES and what it
 * leaves running (`ULTIMATE`), which meter charges it (`ULTIMATE_CHARGE`), what
 * it looks like when it is ready (`ULTIMATE_AURA`), and the lane-D chip that
 * says so (`LANE_D`). The first three are keyed on the hero and must carry the
 * same set of heroes; the fourth is opted into per hero by listing `'ult'`.
 *
 * Nothing bound them together when they were written. They agreed, which is not
 * the same as being kept in agreement: a sixth hero, or a hero whose ultimate
 * was retired, would silently have ended up with an ability and no aura, or a
 * chip that never lights. That is the failure shape `events.coverage.test.ts`
 * exists to prevent between the event union, the handler and the emit sites,
 * and this is the same remedy -- read the source as text and compare key sets.
 *
 * `ULTIMATE` carries two abilities per hero, `first` and `second`, one of which
 * is equipped and never both, each a record with a `fire` and an optional
 * `tick`. The optional half is deliberate: only the ultimates that resolve over
 * TIME have one. What is not optional is that every hero has both slots and
 * every slot can be fired.
 *
 * Parsed by indentation rather than by regular expression, on purpose. The
 * patterns this needs are full of backslashes, and a scripted edit that writes
 * one through a shell heredoc silently collapses them -- which happened to this
 * very file. Counting leading spaces cannot go wrong that way.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHARACTERS } from '../net/protocol';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'game.js'), 'utf8');

/** The lines of `const NAME = { … };`, without the declaration or the brace. */
function tableBody(name: string): string[] {
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => l.startsWith(`const ${name} = {`));
  expect(start, `${name} not found in game.js`).toBeGreaterThan(-1);
  const end = lines.indexOf('};', start);
  expect(end, `${name} has no closing brace`).toBeGreaterThan(start);
  return lines.slice(start + 1, end);
}

/** Keys at one exact depth. Deeper keys belong to a nested object, and counting
 *  those would make a table agree with whatever happened to be inside it. */
function keysAtDepth(lines: string[], spaces: number): string[] {
  const pad = ' '.repeat(spaces);
  const out: string[] = [];
  for (const line of lines) {
    if (!line.startsWith(pad) || line[spaces] === ' ') continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(spaces, colon).trim();
    if (/^[A-Za-z_]\w*$/.test(key)) out.push(key);
  }
  return out;
}

/** Heroes whose lane-D list opts into the ultimate chip. */
function heroesWithUltChip(): string[] {
  return tableBody('LANE_D')
    .filter((l) => l.includes("'ult'"))
    .map((l) => l.slice(2, l.indexOf(':')).trim());
}

describe('the tables an ultimate is spread across', () => {
  const withUltimate = keysAtDepth(tableBody('ULTIMATE'), 2);

  it('names only real heroes', () => {
    expect(withUltimate.length).toBeGreaterThan(0);
    expect(withUltimate.filter((h) => !CHARACTERS.includes(h as never))).toEqual([]);
  });

  it('gives every hero with an ultimate a charge meter', () => {
    expect(new Set(keysAtDepth(tableBody('ULTIMATE_CHARGE'), 2))).toEqual(new Set(withUltimate));
  });

  it('gives every hero with an ultimate a ready aura', () => {
    // The aura is the only thing on screen that says the ultimate is up before
    // the player looks at the HUD. A hero without one has a silent ability.
    expect(new Set(keysAtDepth(tableBody('ULTIMATE_AURA'), 2))).toEqual(new Set(withUltimate));
  });

  it('gives every hero with an ultimate a lane-D chip', () => {
    expect(new Set(heroesWithUltChip())).toEqual(new Set(withUltimate));
  });

  // A hero with one slot filled offers a choice of one, which is not a choice.
  // A slot whose record has no `fire` spends the timer and does nothing.
  it('gives every hero both slots, and every slot something to fire', () => {
    const body = tableBody('ULTIMATE');
    const perHero = new Map<string, string[]>();
    let current = '';
    for (const line of body) {
      const key = keysAtDepth([line], 2)[0];
      if (key !== undefined) { current = key; perHero.set(key, []); continue; }
      if (current) perHero.get(current)!.push(line);
    }
    expect([...perHero.keys()]).toEqual(withUltimate);
    for (const [hero, lines] of perHero) {
      expect(keysAtDepth(lines, 4), `${hero} slots`).toEqual(['first', 'second']);
      for (const line of lines) {
        if (keysAtDepth([line], 4).length === 0) continue;
        expect(line, `${hero}: a slot with nothing to fire`).toContain('fire:');
      }
    }
  });
});

/**
 * The icon set is ten drawings, one per ultimate, and the ability each one is
 * FOR lives in game.js while the list of them lives in a Python manifest the
 * design pipeline reads. Nothing bound the two together: an ability renamed or
 * a slot re-cast left an icon for something that no longer exists, and the
 * pipeline's own coverage check would go on reporting ten of ten because it
 * only ever compares the icons against that manifest.
 *
 * The join is the ability's `id`, carried explicitly in the table. It used to
 * be read off the fire function's name, and the first run of this guard showed
 * why that was wrong: `fireBeam` draws `theBeam`, `fireLeap` draws `theLeap`,
 * and three of the ten did not match. A join on a coincidence of naming is one
 * rename away from being wrong about everything.
 */
describe('the icon manifest and the abilities it draws', () => {
  const manifest = readFileSync(
    resolve(here, '../../_design/talent-feedback/ultimates.py'), 'utf8');

  /** Every ability in the table, as the hero and slot it sits under plus its id. */
  function abilityIds(): Array<{ hero: string; slot: string; id: string }> {
    const out: Array<{ hero: string; slot: string; id: string }> = [];
    let hero = '';
    for (const line of tableBody('ULTIMATE')) {
      const top = keysAtDepth([line], 2)[0];
      if (top !== undefined) { hero = top; continue; }
      const slot = keysAtDepth([line], 4)[0];
      if (slot === undefined || !hero) continue;
      const marker = "id: '";
      const at = line.indexOf(marker);
      expect(at, `${hero}.${slot} carries no id`).toBeGreaterThan(-1);
      const rest = line.slice(at + marker.length);
      out.push({ hero, slot, id: rest.slice(0, rest.indexOf("'")) });
    }
    return out;
  }

  it('lists exactly the abilities the game has, under the same hero and slot', () => {
    const abilities = abilityIds();
    expect(abilities.length).toBeGreaterThan(0);
    const missing = abilities.filter(({ hero, slot, id }) =>
      !manifest.includes(`'${id}'`)
      || !new RegExp(`'${id}'[^)]*'${hero}', '${slot}'`).test(manifest));
    expect(missing.map((m) => `${m.id} (${m.hero} ${m.slot})`)).toEqual([]);
  });

  it('draws nothing the game does not have', () => {
    const known = new Set(abilityIds().map((a) => a.id));
    const listed = [...manifest.matchAll(/^ {4}\('(\w+)'/gm)].map((m) => m[1]!);
    expect(listed.length).toBe(known.size);
    expect(listed.filter((id) => !known.has(id))).toEqual([]);
  });
});
