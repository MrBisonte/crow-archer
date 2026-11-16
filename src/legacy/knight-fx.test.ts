/**
 * The knight's two skill effects have one home: the painters in
 * `src/render/knight-fx.ts`, which `drawAbilityFx` calls. `drawKnight` kept its
 * own inline copies after the move, so every frame drew Whirlwind and the
 * charge dash twice, the old copy in smooth blurred strokes over the pixel one.
 *
 * Read off the source, as `ultimate-fx.test.ts` does: the fault is a second
 * call site, and the legacy renderer has no recording context to count calls.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'game.js'), 'utf8');

/** From `function <name>(` to the next top-level function. */
function body(name: string): string {
  const at = source.indexOf(`\nfunction ${name}(`);
  if (at < 0) throw new Error(`game.js declares no \`function ${name}\``);
  const from = source.slice(at + 1);
  return from.slice(0, from.indexOf('\nfunction '));
}

describe('the knight skill effects', () => {
  it('are painted by the knight-fx painters', () => {
    const fx = body('drawAbilityFx');
    expect(fx).toContain('paintWhirlwind(');
    expect(fx).toContain('paintChargeDash(');
  });

  // A branch on the skill being active is what drew each copy. drawKnight still
  // reads the Whirlwind timer for its cooldown pips, as `<= 0`, which is fine.
  it('are not painted a second time inside drawKnight', () => {
    const knight = body('drawKnight');
    expect(knight, 'drawKnight draws Whirlwind again').not.toMatch(/knightWhirlwindTimer\s*>\s*0/);
    expect(knight, 'drawKnight draws the dash sweep again').not.toMatch(/knightDash\.timer\s*>\s*0/);
  });
});
