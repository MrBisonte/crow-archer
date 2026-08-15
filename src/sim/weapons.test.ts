import { describe, expect, it } from 'vitest';

import {
  CROSSBOW_BOLT_COUNT,
  CROSSBOW_BOLT_DAMAGE,
  CROSSBOW_BOLT_RADIUS,
  CROSSBOW_SPREAD_RADIANS,
  Crossbow,
  DynamitePouch,
  SATCHEL_CARRIED,
  Satchel,
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

  it('gives wizard and knight dynamite only in deathmatch, as a stand-in', () => {
    expect(secondaryWeapon('wizard', 'deathmatch').kind).toBe('dynamite');
    expect(secondaryWeapon('knight', 'deathmatch').kind).toBe('dynamite');
  });

  it('gives wizard and knight nothing in coop: no real secondary exists yet there', () => {
    expect(secondaryWeapon('wizard', 'coop').kind).toBe('none');
    expect(secondaryWeapon('knight', 'coop').kind).toBe('none');
  });

  it('carries the concrete weapon instance alongside the tag, so a caller never casts', () => {
    const dyn = secondaryWeapon('archer', 'coop');
    if (dyn.kind !== 'dynamite') throw new Error('expected dynamite');
    expect(dyn.weapon).toBeInstanceOf(DynamitePouch);

    const sat = secondaryWeapon('ranger', 'coop');
    if (sat.kind !== 'satchel') throw new Error('expected satchel');
    expect(sat.weapon).toBeInstanceOf(Satchel);
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
