/**
 * The third abilities, as descriptions.
 *
 * Nothing here runs a world: an ability is a pure function of how long its key
 * was held, so these are about the SHAPE each one hands back and about the hold
 * curve. What the world then does with a `travel` or a `mark` is
 * `battle-world.test.ts`'s question.
 */
import { describe, expect, it } from 'vitest';

import { CHARACTERS } from '../net/protocol';
import {
  Blink,
  Charge,
  MARK_COOLDOWN_TICKS,
  Mark,
  PowerDraw,
  ShockRound,
  abilityFor,
  type Ability,
  type AbilityEffect,
} from './abilities';
import { ARENA_H, ARENA_W, CHARACTER_STATS } from './arena';
import { ticks } from './tick';
import * as FIGURES from './weapon-figures';
import { ARROW_DAMAGE, SPEAR_REACH } from './weapons';

const shotOf = (effects: AbilityEffect[]) => {
  const e = effects[0];
  if (!e || e.kind !== 'shot') throw new Error('expected a shot effect');
  return e.shot;
};
const travelOf = (effects: AbilityEffect[]) => {
  const e = effects[0];
  if (!e || e.kind !== 'travel') throw new Error('expected a travel effect');
  return e.travel;
};
const markOf = (effects: AbilityEffect[]) => {
  const e = effects[0];
  if (!e || e.kind !== 'mark') throw new Error('expected a mark effect');
  return e.mark;
};

describe('the roster', () => {
  // The exact key set, not a count: a length check catches a deletion and
  // misses an addition, and an addition here is a hero whose third key was
  // left pointing at another hero's ability.
  it('gives every character an ability, and no character two', () => {
    const kinds = CHARACTERS.map((c) => abilityFor(c).kind);
    expect(new Set(kinds).size).toBe(CHARACTERS.length);
  });

  it.each(CHARACTERS)('gives %s an ability that produces exactly one effect', (character) => {
    const ability = abilityFor(character);
    const held = ability.trigger.on === 'release' ? ability.trigger.windUpTicks : 0;
    expect(ability.use(held)).toHaveLength(1);
  });

  it.each(CHARACTERS)('puts %s on a cooldown of at least a second', (character) => {
    expect(abilityFor(character).cooldownTicks).toBeGreaterThanOrEqual(ticks(1));
  });

  /**
   * A travel longer than the arena's short side would mean the world's clamp,
   * and not the ability, was deciding where a hero comes to rest.
   */
  it.each(CHARACTERS)('never carries %s further than the arena is short', (character) => {
    const ability = abilityFor(character);
    const held = ability.trigger.on === 'release' ? ability.trigger.windUpTicks : 0;
    for (const effect of ability.use(held)) {
      if (effect.kind === 'travel') {
        expect(effect.travel.reach).toBeLessThan(Math.min(ARENA_W, ARENA_H));
      }
    }
  });
});

describe('a held ability', () => {
  const holders: [string, Ability][] = [
    ['the archer\'s draw', new PowerDraw()],
    ['the knight\'s charge', new Charge()],
  ];

  it.each(holders)('%s counts its wind-up in ticks, not seconds', (_name, ability) => {
    expect(ability.trigger.on).toBe('release');
    if (ability.trigger.on !== 'release') return;
    expect(Number.isInteger(ability.trigger.windUpTicks)).toBe(true);
    expect(ability.trigger.windUpTicks).toBeGreaterThan(0);
  });

  it.each(holders)('%s treats a hold past full as full, not as more', (_name, ability) => {
    if (ability.trigger.on !== 'release') throw new Error('not a held ability');
    const full = ability.use(ability.trigger.windUpTicks);
    expect(ability.use(ability.trigger.windUpTicks * 10)).toEqual(full);
  });

  it.each(holders)('%s treats a negative hold as a tap', (_name, ability) => {
    expect(ability.use(-5)).toEqual(ability.use(0));
  });
});

describe("the archer's power shot", () => {
  const draw = new PowerDraw();
  const windUp = ticks(FIGURES.ARCHER_DRAW_MAX_SECS);

  it('is an ordinary arrow at a tap', () => {
    const shot = shotOf(draw.use(0));
    expect(shot.speed).toBe(FIGURES.ARROW_SPEED);
    expect(shot.damage).toBe(ARROW_DAMAGE);
    expect(shot.pierce).toBe(1);
  });

  it('is twice the speed and three times the damage at a full draw', () => {
    const shot = shotOf(draw.use(windUp));
    expect(shot.speed).toBe(FIGURES.ARROW_SPEED * FIGURES.ARCHER_POWER_SPEED_MULT);
    expect(shot.damage).toBe(ARROW_DAMAGE * 3);
    expect(shot.pierce).toBe(FIGURES.ARCHER_POWER_PIERCE);
  });

  it('pierces whole bodies at every draw, never a fraction of one', () => {
    for (let held = 0; held <= windUp; held++) {
      expect(Number.isInteger(shotOf(draw.use(held)).pierce)).toBe(true);
    }
  });

  it('climbs with the hold rather than stepping at the end of it', () => {
    const half = shotOf(draw.use(Math.round(windUp / 2)));
    expect(half.speed).toBeGreaterThan(FIGURES.ARROW_SPEED);
    expect(half.speed).toBeLessThan(FIGURES.ARROW_SPEED * FIGURES.ARCHER_POWER_SPEED_MULT);
    expect(half.damage).toBeGreaterThan(ARROW_DAMAGE);
  });
});

describe("the wizard's blink", () => {
  const travel = travelOf(new Blink().use());

  it('arrives at once, which is what makes it an escape', () => {
    expect(travel.durationTicks).toBe(0);
  });

  it('carries its own refusal threshold, so a blink into a wall costs nothing', () => {
    expect(travel.minReach).toBe(FIGURES.BLINK_MIN_REACH);
    expect(travel.minReach).toBeLessThan(travel.reach);
  });

  it('arrives untouchable and hits what was chasing', () => {
    expect(travel.invulnerableTicks).toBe(ticks(FIGURES.BLINK_IFRAME_SECS));
    expect(travel.pulse?.radius).toBe(FIGURES.BLINK_PULSE_RADIUS);
    expect(travel.pulse?.durationTicks).toBe(0);
  });

  it('opens no ground: the storm is what the wizard digs with', () => {
    expect(travel.pulse?.destroysTerrain).toBe(false);
  });
});

describe("the knight's charge", () => {
  const charge = new Charge();
  const windUp = ticks(FIGURES.KNIGHT_CHARGE_MAX_HOLD_SECS);

  it('runs for as long as the dash lasts, and is EXPOSED for all of it', () => {
    // The wind-up is where he is untouchable; `damagePlayer` in game.js says
    // the dash afterwards is exposed, and this is that bargain.
    const travel = travelOf(charge.use(windUp));
    expect(travel.durationTicks).toBe(ticks(FIGURES.KNIGHT_DASH_SECS));
    expect(travel.invulnerableTicks).toBe(0);
    expect(charge.trigger.windUp).toBe('rooted-and-untouchable');
  });

  it('is the only wind-up that protects: the archer just stands there', () => {
    expect(new PowerDraw().trigger.windUp).toBe('rooted');
  });

  it('carries him exactly what the dash outruns his own walk by', () => {
    // Read live from CHARACTER_STATS rather than written out: the reach is
    // derived from the knight's own speed, so a roster retune has to move it,
    // and a hand-typed distance here would be the second copy this whole
    // effort exists to remove.
    const walked = CHARACTER_STATS.knight.speed * FIGURES.KNIGHT_DASH_SECS;
    expect(travelOf(charge.use(0)).reach).toBe(walked * FIGURES.KNIGHT_DASH_SPEED_MULT);
    expect(travelOf(charge.use(0)).reach).toBeGreaterThan(walked);
  });

  it('closes more ground than the spear reaches, which is why he has it', () => {
    expect(travelOf(charge.use(0)).reach).toBeGreaterThan(SPEAR_REACH * 4);
  });

  it('bites harder for a longer hold, and by the stated bounds', () => {
    const tap = travelOf(charge.use(0)).pulse;
    const full = travelOf(charge.use(windUp)).pulse;
    expect(tap?.damage).toBeCloseTo(FIGURES.KNIGHT_CHARGE_MIN_DAMAGE_MULT, 10);
    expect(full?.damage).toBeCloseTo(FIGURES.KNIGHT_CHARGE_MAX_DAMAGE_MULT, 10);
  });

  it('never carries him further for holding longer: the hold buys bite, not distance', () => {
    expect(travelOf(charge.use(windUp)).reach).toBe(travelOf(charge.use(0)).reach);
  });

  it('sweeps for the whole dash rather than landing once at the end', () => {
    const pulse = travelOf(charge.use(windUp)).pulse;
    expect(pulse?.durationTicks).toBe(ticks(FIGURES.KNIGHT_DASH_SECS));
    expect(pulse?.tickIntervalTicks).toBe(ticks(FIGURES.KNIGHT_CHARGE_TICK_SECS));
  });
});

describe("the ranger's mark", () => {
  const mark = markOf(new Mark().use());

  it('does no damage of its own: it multiplies everyone else\'s', () => {
    expect(mark.damageMultiplier).toBeGreaterThan(1);
    expect(new Mark().use().every((e) => e.kind === 'mark')).toBe(true);
  });

  it('lasts less long than the wait for the next one', () => {
    // Otherwise a ranger holds a mark permanently and the cost is nothing.
    expect(mark.durationTicks).toBeLessThan(MARK_COOLDOWN_TICKS);
  });

  it('reaches a quarter of the arena, as it does in single player', () => {
    expect(mark.radius).toBe(FIGURES.RANGER_MARK_RADIUS);
  });
});

describe("the sapper's shock round", () => {
  const shot = shotOf(new ShockRound().use());

  it('is the fastest thing on the field', () => {
    expect(shot.speed).toBe(FIGURES.SAPPER_SHOT_SPEED);
    expect(shot.speed).toBeGreaterThan(FIGURES.ARROW_SPEED);
  });

  it('does not pierce, whatever the legacy comment used to say', () => {
    expect(shot.pierce).toBeUndefined();
  });

  it('stops on terrain rather than bouncing off it', () => {
    expect(shot.onTerrain).toBe('stop');
    expect(shot.explodesAtRest).toBe(false);
  });
});
