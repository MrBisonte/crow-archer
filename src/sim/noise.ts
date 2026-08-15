/**
 * The noise the terrain generator clusters tiles with.
 *
 * It is separated from mapgen so the generator stays free of the dependency and
 * testable without it, and it is shared by client and server so both build the
 * same landscape from the same four bytes. A server generating slightly
 * different rock from its clients is a player walking into nothing.
 *
 * SimplexNoise 2.4 takes a random function, so the field derives entirely from
 * the seed rather than from any global source of randomness.
 */

import SimplexNoise from 'simplex-noise';

import type { Noise2D } from './mapgen';
import { mulberry32 } from './rng';

/** Builds the noise field a seed describes. */
export function noiseFor(seed: number): Noise2D {
  const simplex = new SimplexNoise(mulberry32(seed));
  return (x, y) => simplex.noise2D(x, y);
}
