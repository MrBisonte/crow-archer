/**
 * Per-play variation for sound effects: the same sound, never quite the same
 * twice.
 *
 * The synth in `src/legacy/game.js` plays a positional parameter array
 * verbatim, so an archer with three arrows in flight, a ranger's three-bolt
 * burst and a sapper's five-bomb barrage all fire one identical sample several
 * times inside a fifth of a second, which the ear hears as a machine rather
 * than a weapon.
 *
 * Which parameters move is a property of *that* synth, not of upstream ZzFX,
 * and was read out of it rather than out of the ZzFX docs: its noise shapes (4
 * and 5) never read the oscillator phase, so frequency, slide, pitch jump and
 * the array's own randomness field at index 1 are inaudible on ten of the
 * game's twenty-two sounds — the arrow among them. Volume and the release tail
 * are the two dimensions every shape hears; frequency is the third, and is
 * simply inert on the noise ones.
 *
 * On the other twelve, index 1 does detune the carrier, and nine of them set
 * it to zero. So the two mechanisms stack rather than compete: index 1 is the
 * per-sound colour a sound was tuned with, `pitch` is the floor under every
 * sound that was not.
 *
 * Audio is presentation, so none of this touches a seeded stream: the source
 * of randomness is injected and defaults to `Math.random`, never the
 * simulation's `mulberry32`.
 */

import type { Rng } from '../sim/rng';

/** A sound as the synth takes it: ZzFX-style positional parameters. */
export type SoundParams = readonly number[];

/**
 * How far each varied parameter may move, as a fraction of its tuned value.
 * A gain of 0.1 means the sound plays somewhere in 90%-110% of its volume.
 */
export interface VariationProfile {
  /** Volume, index 0. Heard on every shape. */
  readonly gain: number;
  /** Carrier frequency, index 2. Inert on the synth's two noise shapes. */
  readonly pitch: number;
  /** Release, index 5: how long the sound rings out. Heard on every shape. */
  readonly tail: number;
}

/**
 * The most any one amount may be. This is texture, not novelty: past a half,
 * a sound stops being recognisable as itself and starts being a new sound
 * every time, so the ceiling is enforced rather than left to a tuner's taste.
 */
export const MAX_VARIATION = 0.5;

/** How a sound behaves when it plays again. */
export const PLAYBACK_KINDS = ['varied', 'fixed'] as const;

/**
 * `varied` is what almost everything wants. `fixed` is for the sounds a player
 * learns by ear — the UI's own beeps, a boss's signature — which have to be
 * the same sound every time to stay recognisable.
 */
export type PlaybackKind = (typeof PLAYBACK_KINDS)[number];

/** What the synth is handed for one play of a sound. */
export type Playback =
  (params: SoundParams, profile: VariationProfile, rand?: Rng) => SoundParams;

/** Volume, frequency and release: the positional indices variation moves. */
const VOLUME = 0;
const FREQUENCY = 2;
const RELEASE = 5;

/**
 * The loudest a play may ask for. The synth clamps the oscillator sample but
 * not the product (`D[i] = clamp(sm) * env * v`), so a volume over 1 is not a
 * louder sound, it is a clipped one — and the loudest sounds in the game are
 * already at 0.8.
 */
const MAX_VOLUME = 1;

/**
 * Holds an amount inside `[0, MAX_VARIATION]`. An amount that is not a number
 * at all reads as no variation rather than as NaN: a mistyped config key
 * would otherwise silence every sound in the game without throwing.
 */
const clampAmount = (amount: number): number =>
  Number.isFinite(amount) ? Math.min(MAX_VARIATION, Math.max(0, amount)) : 0;

/**
 * Builds a profile from raw tunables (`CONFIG.soundVariation`), clamping each
 * amount into the range a profile is allowed to express. A negative amount
 * would swing a parameter past zero and an unbounded one would make every play
 * a different sound, so neither can be reached by editing a config value.
 */
export function variationProfile(raw: VariationProfile): VariationProfile {
  return {
    gain: clampAmount(raw.gain),
    pitch: clampAmount(raw.pitch),
    tail: clampAmount(raw.tail),
  };
}

/**
 * One play of `params`, with volume, frequency and release nudged inside the
 * profile's bounds. Parameters the sound does not specify stay unspecified, so
 * the synth's own defaults still decide them.
 */
export function varyParams(
  params: SoundParams, profile: VariationProfile, rand: Rng = Math.random,
): SoundParams {
  const heard = [...params];
  const nudge = (index: number, amount: number): void => {
    const tuned = heard[index];
    if (tuned !== undefined) heard[index] = tuned * (1 + (rand() * 2 - 1) * amount);
  };
  nudge(VOLUME, profile.gain);
  nudge(FREQUENCY, profile.pitch);
  nudge(RELEASE, profile.tail);
  // Only downward, and only for a sound already near the ceiling: a loud one
  // varied upward would clip rather than land louder.
  const volume = heard[VOLUME];
  if (volume !== undefined) heard[VOLUME] = Math.min(MAX_VOLUME, volume);
  return heard;
}

/**
 * One transform per playback kind. `fixed` returns the tuned array itself:
 * nothing downstream writes to a sound, so there is nothing to copy.
 */
export const PLAYBACK: Record<PlaybackKind, Playback> = {
  varied: varyParams,
  fixed: (params) => params,
};
