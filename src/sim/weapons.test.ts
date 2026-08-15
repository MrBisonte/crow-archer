import { describe, expect, it } from 'vitest';

import {
  CROSSBOW_BOLT_COUNT,
  CROSSBOW_BOLT_DAMAGE,
  CROSSBOW_BOLT_RADIUS,
  CROSSBOW_SPREAD_RADIANS,
  Crossbow,
  DynamitePouch,
  LightningStorm,
  SATCHEL_CARRIED,
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
  it('rests where it lands instead of bouncing or vanishing', () => {
    const [effect] = new Satchel().use();
    if (!effect || effect.kind !== 'shot') throw new Error('expected a shot');
    expect(effect.shot.onTerrain).toBe('rest');
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
