import { describe, expect, it } from 'vitest';

import { escalatedPulse, hopOrdinal } from './blink';

describe('hopOrdinal', () => {
  // The sim counts hops DOWN, because what it needs every frame is whether
  // another one is available. The escalation needs the opposite number, and
  // getting it by subtraction is exactly where an off-by-one lives.
  it('numbers the hops of a two-hop chain 1 then 2', () => {
    expect(hopOrdinal(2, 1)).toBe(1);   // the opening blink: one hop left after it
    expect(hopOrdinal(2, 0)).toBe(2);   // the chained hop: none left
  });

  it('numbers the hops of a three-hop chain 1, 2, 3', () => {
    expect(hopOrdinal(3, 2)).toBe(1);
    expect(hopOrdinal(3, 1)).toBe(2);
    expect(hopOrdinal(3, 0)).toBe(3);
  });

  // A chain length that shrank mid-run, or a count that went past its own
  // floor, must not produce a zeroth or a negative hop: those multiply a
  // pulse down to nothing, which reads as the ability failing to fire.
  it('never numbers a hop below the first, whatever it is handed', () => {
    expect(hopOrdinal(1, 5)).toBe(1);
    expect(hopOrdinal(0, 0)).toBe(1);
    expect(hopOrdinal(3, -2)).toBe(3);  // clamped by the chain's own length
  });
});

describe('escalatedPulse', () => {
  const BASE = { radius: 56, bossDamage: 1 };

  it('leaves the opening hop exactly as it was', () => {
    expect(escalatedPulse(BASE, 1, 0.45)).toEqual(BASE);
  });

  // Two laws, on purpose. Damage is a count and steps by whole base hits, so
  // a three-hop chain is worth 1 + 2 + 3. Radius is a length whose AREA grows
  // as its square, so it climbs by a fraction instead: tripling it would
  // multiply the ground covered by nine.
  it('steps damage by a whole base hit and the radius by a fraction', () => {
    expect(escalatedPulse(BASE, 2, 0.45)).toEqual({ radius: 56 * 1.45, bossDamage: 2 });
    expect(escalatedPulse(BASE, 3, 0.45)).toEqual({ radius: 56 * 1.9, bossDamage: 3 });
  });

  it('is the identity at no growth, so the dial can be turned off', () => {
    expect(escalatedPulse(BASE, 3, 0)).toEqual({ radius: 56, bossDamage: 3 });
  });

  it('scales whatever base it is handed rather than the shipped one', () => {
    expect(escalatedPulse({ radius: 100, bossDamage: 2 }, 2, 0.5))
      .toEqual({ radius: 150, bossDamage: 4 });
  });
});
