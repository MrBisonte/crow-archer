import { describe, expect, it } from 'vitest';

import { CHARACTERS } from '../net/protocol';
import {
  CROSSBOW_BOLT_COUNT,
  CROSSBOW_BOLT_DAMAGE,
  CROSSBOW_BOLT_RADIUS,
  CROSSBOW_SPREAD_RADIANS,
  Crossbow,
  DYNAMITE_DAMAGE,
  DYNAMITE_FUSE_TICKS,
  DYNAMITE_SPEED,
  DynamitePouch,
  LightningStorm,
  PowderCharge,
  SAPPER_CHARGE_DAMAGE,
  SATCHEL_CARRIED,
  SATCHEL_DAMAGE,
  Satchel,
  Whirlwind,
  primaryWeapon,
  secondaryWeapon,
} from './weapons';

describe('Crossbow', () => {
  it('fires an independent shot per bolt, not one shot worth three hits', () => {
    const effects = new Crossbow().use();
    expect(effects).toHaveLength(CROSSBOW_BOLT_COUNT);
    for (const effect of effects) {
      expect(effect.kind).toBe('shot');
    }
  });

  it('deals the same damage per bolt regardless of position in the burst', () => {
    const effects = new Crossbow().use();
    for (const effect of effects) {
      if (effect.kind !== 'shot') throw new Error('expected a shot');
      expect(effect.shot.damage).toBe(CROSSBOW_BOLT_DAMAGE);
      expect(effect.shot.radius).toBe(CROSSBOW_BOLT_RADIUS);
    }
  });

  it('is smaller than the archer arrow it is derived from', () => {
    expect(CROSSBOW_BOLT_RADIUS).toBeLessThan(12); // ARROW_RADIUS
  });

  it('fans the three bolts symmetrically around the aim line', () => {
    const effects = new Crossbow().use();
    const offsets = effects.map((e) => (e.kind === 'shot' ? e.shot.angleOffset : undefined));
    expect(offsets).toEqual([-CROSSBOW_SPREAD_RADIANS, 0, CROSSBOW_SPREAD_RADIANS]);
  });

  it('stops nothing sinking in water and does not bounce off terrain', () => {
    const [effect] = new Crossbow().use();
    if (!effect || effect.kind !== 'shot') throw new Error('expected a shot');
    expect(effect.shot.onTerrain).toBe('stop');
    expect(effect.shot.drownsInWater).toBe(false);
  });
});

describe('Satchel', () => {
  it('bounces off terrain like dynamite, but never explodes just from stopping', () => {
    const [effect] = new Satchel().use();
    if (!effect || effect.kind !== 'shot') throw new Error('expected a shot');
    expect(effect.shot.onTerrain).toBe('bounce');
    expect(effect.shot.explodesAtRest).toBe(false);
  });

  it('hits softer than dynamite, the same cut the crossbow bolt takes', () => {
    expect(SATCHEL_DAMAGE).toBeLessThan(DYNAMITE_DAMAGE);
  });

  it('sinks in water, the same rule every thrown weapon follows', () => {
    const [effect] = new Satchel().use();
    if (!effect || effect.kind !== 'shot') throw new Error('expected a shot');
    expect(effect.shot.drownsInWater).toBe(true);
  });

  it('has no charge: every use is the same throw', () => {
    const a = new Satchel().use();
    const b = new Satchel().use();
    if (a[0]?.kind !== 'shot' || b[0]?.kind !== 'shot') throw new Error('expected shots');
    expect(a[0].shot.speed).toBe(b[0].shot.speed);
  });
});

describe('secondaryWeapon', () => {
  it('gives the archer dynamite in every mode, since it is their own weapon', () => {
    expect(secondaryWeapon('archer', 'coop').kind).toBe('dynamite');
    expect(secondaryWeapon('archer', 'deathmatch').kind).toBe('dynamite');
  });

  it('gives the ranger the satchel in every mode, since it is their own weapon', () => {
    expect(secondaryWeapon('ranger', 'coop').kind).toBe('satchel');
    expect(secondaryWeapon('ranger', 'deathmatch').kind).toBe('satchel');
  });

  it('gives the wizard storm in every mode, now that it is their own real weapon', () => {
    expect(secondaryWeapon('wizard', 'coop').kind).toBe('storm');
    expect(secondaryWeapon('wizard', 'deathmatch').kind).toBe('storm');
  });

  it('gives the knight whirlwind in every mode, now that it is their own real weapon', () => {
    expect(secondaryWeapon('knight', 'coop').kind).toBe('whirlwind');
    expect(secondaryWeapon('knight', 'deathmatch').kind).toBe('whirlwind');
  });

  it('carries the concrete weapon instance alongside the tag, so a caller never casts', () => {
    const dyn = secondaryWeapon('archer', 'coop');
    if (dyn.kind !== 'dynamite') throw new Error('expected dynamite');
    expect(dyn.weapon).toBeInstanceOf(DynamitePouch);

    const sat = secondaryWeapon('ranger', 'coop');
    if (sat.kind !== 'satchel') throw new Error('expected satchel');
    expect(sat.weapon).toBeInstanceOf(Satchel);

    const storm = secondaryWeapon('wizard', 'coop');
    if (storm.kind !== 'storm') throw new Error('expected storm');
    expect(storm.weapon).toBeInstanceOf(LightningStorm);

    const spin = secondaryWeapon('knight', 'coop');
    if (spin.kind !== 'whirlwind') throw new Error('expected whirlwind');
    expect(spin.weapon).toBeInstanceOf(Whirlwind);
  });
});

describe('LightningStorm', () => {
  it('is instant: a single-tick burst, not a channel', () => {
    const [effect] = new LightningStorm().use();
    if (!effect || effect.kind !== 'burst') throw new Error('expected a burst');
    expect(effect.burst.durationTicks).toBe(0);
  });

  it('clears terrain, the way an explosion does', () => {
    const [effect] = new LightningStorm().use();
    if (!effect || effect.kind !== 'burst') throw new Error('expected a burst');
    expect(effect.burst.destroysTerrain).toBe(true);
  });

  it('has a radius well short of the legacy 450px, so it cannot catch the whole arena', () => {
    const [effect] = new LightningStorm().use();
    if (!effect || effect.kind !== 'burst') throw new Error('expected a burst');
    expect(effect.burst.radius).toBeLessThan(450);
  });
});

describe('Whirlwind', () => {
  it('channels for longer than one tick, unlike storm', () => {
    const [effect] = new Whirlwind().use();
    if (!effect || effect.kind !== 'burst') throw new Error('expected a burst');
    expect(effect.burst.durationTicks).toBeGreaterThan(1);
  });

  it('deals its damage in small repeated ticks, not one lump sum', () => {
    const [effect] = new Whirlwind().use();
    if (!effect || effect.kind !== 'burst') throw new Error('expected a burst');
    expect(effect.burst.tickIntervalTicks).toBeGreaterThan(0);
    const possibleHits = effect.burst.durationTicks / effect.burst.tickIntervalTicks;
    expect(effect.burst.damage * possibleHits).toBeGreaterThan(10); // lethal if never once interrupted by iframes
    expect(effect.burst.damage).toBeLessThan(2); // but never lethal on a single tick
  });
});

describe('primaryWeapon', () => {
  it('gives the ranger a crossbow', () => {
    expect(primaryWeapon('ranger')).toBeInstanceOf(Crossbow);
  });
});

it('carries the same number of satchels as dynamite, absent a reason to differ', () => {
  expect(SATCHEL_CARRIED).toBe(4);
});

describe('PowderCharge', () => {
  it('throws one charge per use, not a burst', () => {
    const effects = new PowderCharge().use();
    expect(effects).toHaveLength(1);
    expect(effects[0]?.kind).toBe('shot');
  });

  it('is dynamite in everything but the damage', () => {
    const [effect] = new PowderCharge().use();
    if (!effect || effect.kind !== 'shot') throw new Error('expected a shot');
    expect(effect.shot.flavour).toBe('dynamite');
    expect(effect.shot.speed).toBe(DYNAMITE_SPEED);
    expect(effect.shot.lifeTicks).toBe(DYNAMITE_FUSE_TICKS);
    expect(effect.shot.onTerrain).toBe('bounce');
    expect(effect.shot.explodesAtRest).toBe(true);
    expect(effect.shot.drownsInWater).toBe(true);
  });

  it('hits for less than a stick, because it is thrown over and over', () => {
    const [effect] = new PowderCharge().use();
    if (!effect || effect.kind !== 'shot') throw new Error('expected a shot');
    expect(effect.shot.damage).toBe(SAPPER_CHARGE_DAMAGE);
    expect(SAPPER_CHARGE_DAMAGE).toBeLessThan(DYNAMITE_DAMAGE);
  });

  it('flies straight and alone: no homing, no fan', () => {
    const [effect] = new PowderCharge().use();
    if (!effect || effect.kind !== 'shot') throw new Error('expected a shot');
    expect(effect.shot.homingRate).toBe(0);
    expect(effect.shot.angleOffset).toBeUndefined();
  });

  it('has no charge-and-hold: every use is the same throw', () => {
    const a = new PowderCharge().use();
    const b = new PowderCharge().use();
    if (a[0]?.kind !== 'shot' || b[0]?.kind !== 'shot') throw new Error('expected shots');
    expect(a[0].shot.speed).toBe(b[0].shot.speed);
  });

  it('throws slower than every primary but the wizard staff', () => {
    const sapper = primaryWeapon('sapper').cooldownTicks;
    for (const kind of CHARACTERS) {
      if (kind === 'sapper' || kind === 'wizard') continue;
      expect(sapper, kind).toBeGreaterThan(primaryWeapon(kind).cooldownTicks);
    }
    expect(sapper).toBeLessThan(primaryWeapon('wizard').cooldownTicks);
  });
});

describe('the roster', () => {
  it('arms every character with a primary that produces something', () => {
    for (const kind of CHARACTERS) {
      const weapon = primaryWeapon(kind);
      expect(weapon.cooldownTicks, kind).toBeGreaterThan(0);
      expect(weapon.use().length, kind).toBeGreaterThan(0);
    }
  });

  it('answers the secondary question for every character, in every mode', () => {
    for (const kind of CHARACTERS) {
      for (const mode of ['coop', 'deathmatch'] as const) {
        expect(secondaryWeapon(kind, mode).kind, `${kind}/${mode}`).toBeTruthy();
      }
    }
  });

  it("gives the sapper no secondary at all, rather than its own primary twice", () => {
    // Without its own row this would fall through to the dynamite stand-in,
    // which is the powder charge again on another button.
    expect(secondaryWeapon('sapper', 'deathmatch')).toEqual({ kind: 'none' });
    expect(secondaryWeapon('sapper', 'coop')).toEqual({ kind: 'none' });
  });
});
