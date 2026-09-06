/**
 * The seams between what an ultimate DOES and what it looks like.
 *
 * The painters themselves are guarded in `src/render/ultimate-fx.test.ts`,
 * where a fake context can be handed a pose. What cannot be checked there is
 * whether the game hands them the right one, and that is where the fault this
 * file exists for lived: the ring a player decides where to stand by was drawn
 * from a constant while the blast used a multiple of it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { ONE_SECOND, aimAt, clearArena, stepPast } from './arena-testkit';
import { devHooks as g } from './game.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'game.js'), 'utf8');

/** A hero on open ground with his ultimate in hand, aiming due east. */
function readyRun(hero: string): { x: number; y: number } {
  g.pick(hero);
  g.go('playing');
  clearArena();
  g.healHero();
  const p = g.player() as { x: number; y: number };
  p.x = 6.5 * (g.config().tileSize as number);
  p.y = 6.5 * (g.config().tileSize as number);
  // Through the mouse, never by assigning aimAngle: updatePlayer rewrites the
  // field from the pointer every step (`green-alone-red-in-suite`).
  aimAt(p.x + 400, p.y);
  g.setUltimateCD(0);
  stepPast(2);
  return p;
}

interface Explosion { type: string; radius: number; ult?: boolean }

/** Every EXPLOSION the next `run` emits. */
function explosionsWhile(run: () => void): Explosion[] {
  const seen: Explosion[] = [];
  g.onEvent((e: Explosion) => { if (e.type === 'EXPLOSION') seen.push(e); });
  run();
  return seen;
}

describe('the ring a charge draws and the blast it takes', () => {
  beforeEach(() => { g.pick('sapper'); });

  it('rings every charge at the radius it will really go off at', () => {
    // Read off the source rather than off a screenshot: the ring is a promise
    // about where it is safe to stand, and the way it went wrong was not a
    // wrong-looking picture but a right-looking one drawn from the wrong
    // number. `blastReachPx` is the one home for that number; a ring drawn
    // from the bare constant is the bug coming back.
    const draw = source.slice(source.indexOf('function drawDynamites()'));
    const body = draw.slice(0, draw.indexOf('\nfunction '));
    expect(body).toContain('blastReachPx(d)');
    expect(body, 'the ring is drawn from the base radius again')
      .not.toContain('CONFIG.dynamiteBlastRadius, 0, Math.PI*2');
  });

  it('takes THE BIG ONE off at the multiple its own figure names', () => {
    readyRun('sapper');
    g.setUltimateSlot('second');
    const base = g.config().dynamiteBlastRadius as number;
    const mult = g.config().sapperBigOneRadiusMult as number;
    expect(mult).toBeGreaterThan(1);

    const blasts = explosionsWhile(() => {
      g.special(g.SPECIAL_SOURCE.KEY);
      expect(g.ultimate().cd, 'the ultimate never fired').toBeGreaterThan(0);
      stepPast(Math.ceil((g.config().sapperBigOneFuse as number + 0.3) * ONE_SECOND));
    });
    expect(blasts.length, 'the big one never went off').toBeGreaterThan(0);
    expect(blasts[0]!.radius).toBeCloseTo(base * mult, 4);
  });

  it('marks an ultimate blast as one, and an ordinary charge as not', () => {
    // `big` cannot stand in for this: the shock-combo widens a plain charge.
    readyRun('sapper');
    g.setUltimateSlot('second');
    const ult = explosionsWhile(() => {
      g.special(g.SPECIAL_SOURCE.KEY);
      stepPast(Math.ceil((g.config().sapperBigOneFuse as number + 0.3) * ONE_SECOND));
    });
    expect(ult[0]!.ult).toBe(true);

    const plain = explosionsWhile(() => {
      // The BUTTON, which never fires the ultimate: an ordinary charge.
      g.special(g.SPECIAL_SOURCE.BUTTON);
      stepPast(Math.ceil((g.config().sapperBombLifetime as number + 0.5) * ONE_SECOND));
    });
    expect(plain.length, 'no ordinary charge went off').toBeGreaterThan(0);
    expect(plain.every((b) => b.ult !== true), 'an ordinary charge claimed to be an ultimate')
      .toBe(true);
  });
});

describe('the beat every ultimate opens on', () => {
  // One tell for all ten, so a player learns it once. Driven per hero rather
  // than asserted on one, because the whole value of a shared grammar is that
  // no ability is allowed to skip it -- and `tryUltimate` is the one place
  // that can enforce that.
  const HEROES = ['archer', 'wizard', 'knight', 'ranger', 'sapper'] as const;

  for (const hero of HEROES) {
    for (const slot of ['first', 'second'] as const) {
      it(`opens on the gold ring for the ${hero}'s ${slot}`, () => {
        readyRun(hero);
        g.setUltimateSlot(slot);
        expect(g.ultimate().cast, 'a beat was left running by the last test').toBe(false);
        g.special(g.SPECIAL_SOURCE.KEY);
        const went = (g.ultimate().cd as number) > 0;
        // Nine of the ten go. HARPOON refuses below the momentum cap, and a
        // refusal is not a cast -- she keeps the charge, so nothing may have
        // opened. That the beat follows what actually FIRED rather than what
        // was pressed is the half of this worth guarding.
        expect(went, `${hero}.${slot}`).toBe(!(hero === 'ranger' && slot === 'first'));
        expect(g.ultimate().cast, `${hero}.${slot}`).toBe(went);
        // And it ends: a beat that never cleared would dim the field for the
        // rest of the run.
        stepPast(Math.ceil((g.config().ultimateCastSecs as number + 0.2) * ONE_SECOND));
        expect(g.ultimate().cast, `${hero}.${slot} never let go`).toBe(false);
      });
    }
  }
});
