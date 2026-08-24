import { describe, it, expect, vi } from 'vitest';
import { mulberry32 } from '../sim/rng';
import {
  MAX_VARIATION, PLAYBACK, PLAYBACK_KINDS, type SoundParams, type VariationProfile,
  variationProfile, varyParams,
} from './sound-variation';

/** The arrow release exactly as game.js tunes it: white noise, one shot. */
const ARROW: SoundParams = [0.25, 0.05, 800, 0, 0.03, 0.05, 5, 1];

/** The profile game.js ships. Amounts small enough to read as texture. */
const PROFILE: VariationProfile = variationProfile({ gain: 0.1, pitch: 0.04, tail: 0.12 });

/** Nothing moves. Every sound plays exactly as tuned. */
const STILL: VariationProfile = variationProfile({ gain: 0, pitch: 0, tail: 0 });

/** A rand that walks a fixed list, so one play's draws are known in advance. */
function scripted(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

/** The three indices variation is allowed to move: volume, frequency, release. */
const VARIED = [0, 2, 5];

describe('a profile of variation amounts', () => {
  it('clamps an amount that would turn texture into novelty', () => {
    const wild = variationProfile({ gain: 4, pitch: 1.5, tail: MAX_VARIATION + 1 });
    expect(wild.gain).toBe(MAX_VARIATION);
    expect(wild.pitch).toBe(MAX_VARIATION);
    expect(wild.tail).toBe(MAX_VARIATION);
  });

  it('clamps a negative amount, which would swing a parameter past zero', () => {
    const inverted = variationProfile({ gain: -0.5, pitch: -1, tail: -0.01 });
    expect(inverted.gain).toBe(0);
    expect(inverted.pitch).toBe(0);
    expect(inverted.tail).toBe(0);
  });

  it('leaves an amount already inside the range alone', () => {
    expect(variationProfile({ gain: 0.1, pitch: 0.04, tail: 0.12 }))
      .toEqual({ gain: 0.1, pitch: 0.04, tail: 0.12 });
  });
});

describe('a varied sound', () => {
  it('keeps gain, pitch and tail inside the profile it was given', () => {
    for (let play = 0; play < 500; play++) {
      const heard = varyParams(ARROW, PROFILE);
      const bounded = (index: number, amount: number): void => {
        const tuned = ARROW[index]!;
        expect(heard[index]!).toBeGreaterThanOrEqual(tuned * (1 - amount));
        expect(heard[index]!).toBeLessThanOrEqual(tuned * (1 + amount));
      };
      bounded(0, PROFILE.gain);
      bounded(2, PROFILE.pitch);
      bounded(5, PROFILE.tail);
    }
  });

  it('leaves every parameter it does not vary exactly as tuned', () => {
    const heard = varyParams(ARROW, PROFILE);
    expect(heard.length).toBe(ARROW.length);
    for (let i = 0; i < ARROW.length; i++) {
      if (VARIED.includes(i)) continue;
      expect(heard[i], `parameter ${i}`).toBe(ARROW[i]);
    }
  });

  it('does not repeat itself: fifty plays are not one sound fifty times', () => {
    const plays = Array.from({ length: 50 }, () => varyParams(ARROW, PROFILE));
    expect(new Set(plays.map((p) => p[0])).size).toBeGreaterThan(45);
    expect(new Set(plays.map((p) => p[5])).size).toBeGreaterThan(45);
  });

  it('reaches both ends of each bound, so the whole range is used', () => {
    const quietest = varyParams(ARROW, PROFILE, scripted(0));
    const loudest = varyParams(ARROW, PROFILE, scripted(1));
    expect(quietest[0]!).toBeCloseTo(ARROW[0]! * (1 - PROFILE.gain), 10);
    expect(quietest[2]!).toBeCloseTo(ARROW[2]! * (1 - PROFILE.pitch), 10);
    expect(quietest[5]!).toBeCloseTo(ARROW[5]! * (1 - PROFILE.tail), 10);
    expect(loudest[0]!).toBeCloseTo(ARROW[0]! * (1 + PROFILE.gain), 10);
    expect(loudest[2]!).toBeCloseTo(ARROW[2]! * (1 + PROFILE.pitch), 10);
    expect(loudest[5]!).toBeCloseTo(ARROW[5]! * (1 + PROFILE.tail), 10);
  });

  it('draws from the source it is handed, so a caller can make a play repeatable', () => {
    const once = varyParams(ARROW, PROFILE, mulberry32(11));
    const again = varyParams(ARROW, PROFILE, mulberry32(11));
    expect(again).toEqual(once);
  });

  it('is silent about a parameter the sound does not specify', () => {
    // Three values in, three values out: the synth's own defaults still decide
    // the rest, rather than variation inventing a release the sound never had.
    const short = varyParams([0.3, 0, 440], PROFILE, scripted(1));
    expect(short.length).toBe(3);
    expect(short[0]!).toBeCloseTo(0.3 * (1 + PROFILE.gain), 10);
    expect(short[2]!).toBeCloseTo(440 * (1 + PROFILE.pitch), 10);
  });

  it('plays the sound as tuned when every amount is zero', () => {
    expect(varyParams(ARROW, STILL)).toEqual([...ARROW]);
  });

  it('never hands the synth a value it cannot play', () => {
    for (let play = 0; play < 200; play++) {
      for (const value of varyParams(ARROW, PROFILE)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('a fixed sound', () => {
  it('is handed to the synth exactly as tuned, every play', () => {
    const tuned = [...ARROW];
    for (let play = 0; play < 20; play++) {
      expect(PLAYBACK.fixed(ARROW, PROFILE)).toEqual(tuned);
    }
  });
});

describe('the playback table', () => {
  it('has a row for every kind, so a new kind cannot be half added', () => {
    expect(Object.keys(PLAYBACK).sort()).toEqual([...PLAYBACK_KINDS].sort());
  });

  it('returns a playable sound from every row', () => {
    for (const kind of PLAYBACK_KINDS) {
      const heard = PLAYBACK[kind](ARROW, PROFILE);
      expect(heard.length, kind).toBe(ARROW.length);
      expect(heard.every((v) => Number.isFinite(v)), kind).toBe(true);
    }
  });
});

describe('the simulation\'s own randomness', () => {
  it('is not where variation comes from: it draws from Math.random, once per parameter', () => {
    // The guard that matters. Reaching for the sim's seeded rng here would
    // make the map, the battle world and every replay depend on the volume
    // knob, and this is what would notice.
    const rolls = vi.spyOn(Math, 'random');
    try {
      varyParams(ARROW, PROFILE);
      expect(rolls).toHaveBeenCalledTimes(3);
    } finally {
      rolls.mockRestore();
    }
  });

  it('is untouched by sounds playing between draws', () => {
    // Audio is presentation. A seeded map, a seeded battle world, and every
    // replay that depends on them must see the same stream whether the game
    // is played with the sound on or off.
    const quiet = mulberry32(7);
    const noisy = mulberry32(7);
    const expected: number[] = [];
    const actual: number[] = [];
    for (let i = 0; i < 32; i++) {
      expected.push(quiet());
      varyParams(ARROW, PROFILE);
      PLAYBACK.varied(ARROW, PROFILE);
      PLAYBACK.fixed(ARROW, PROFILE);
      actual.push(noisy());
    }
    expect(actual).toEqual(expected);
  });
});
