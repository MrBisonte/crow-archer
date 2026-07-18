/** Deterministic PRNG. Multiplayer clients rebuild identical maps from a shared seed. */

/** Returns a value in [0, 1), like Math.random. */
export type Rng = () => number;

/** mulberry32: small, fast, good enough distribution for gameplay. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
