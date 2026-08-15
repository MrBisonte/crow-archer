/**
 * Renders remote bodies smoothly from snapshots that arrive 20 times a second.
 *
 * Drawing the newest snapshot directly would step remote players 50 ms at a
 * time. Instead the client deliberately renders slightly in the past, between
 * the two snapshots that bracket that moment, so movement is continuous. The
 * cost is a fixed delay on everyone else's position, which is the standard
 * trade and the reason the roadmap puts remote entities about 100 ms behind.
 *
 * The timeline is the server's, taken from each snapshot's tick, and not the
 * time the packet landed. Two snapshots are always exactly three ticks apart in
 * simulated time, while their arrivals measured 46 to 63 ms apart over a real
 * connection. Interpolating against arrival times spread that jitter straight
 * into how fast everything appeared to move, which a 200 px/s player shows as a
 * shimmer and a 700 px/s arrow shows as a lurch. Against ticks the gap is exact
 * and a late packet costs latency instead of speed.
 *
 * Extrapolation is not attempted. Running ahead of the newest snapshot invents
 * positions the server never sent, and then has to take them back.
 */

import type { EntitySnapshot, Snapshot } from './protocol';

/** One snapshot placed on the server's timeline, in milliseconds of sim time. */
interface Timed {
  snap: Snapshot;
  simMs: number;
}

export interface InterpolatorOptions {
  /**
   * How far behind the newest snapshot to render, in milliseconds.
   *
   * Constant on purpose. This was briefly derived from measured lateness, on
   * the reasoning that a bad connection needs more margin than a local game.
   * It made things worse: a delay that changes between frames moves the moment
   * being drawn, and a moving target injects the jitter it was meant to hide.
   * Measured, a delay wandering between 100 and 160 ms spread a 700 px/s arrow
   * across 379 to 1285 px/s, while any fixed value held it inside 680 to 790.
   * Adapting needs the applied delay slewed by a fraction of a millisecond per
   * frame rather than set from the newest measurement, which is a bigger change
   * than the one it fixes.
   */
  delayMs: number;
  /** Simulated milliseconds in one server tick. Defaults to a 60 Hz tick. */
  msPerTick?: number;
}

/**
 * Snapshots kept. Two are needed to interpolate; the rest absorb a late or
 * dropped packet without stalling. Older ones can never be asked for again.
 */
const KEEP = 6;

/**
 * How much of each new offset observation is taken. Small, because this only
 * has to track how far apart the two clocks are, which does not change, and
 * every observation carries that packet's share of network jitter.
 */
const OFFSET_SMOOTHING = 0.05;

/**
 * An offset this far from the running estimate is a new clock rather than a
 * late packet: the first snapshot of a match, or a stall long enough that
 * easing across it would render the past for the rest of the match.
 */
const RESYNC_MS = 250;

export class Interpolator {
  readonly #delayMs: number;
  readonly #msPerTick: number;
  readonly #buffer: Timed[] = [];
  /**
   * Local clock minus server sim time. Adding it to a sim time says when that
   * moment should be drawn here, which is what lets one timeline drive the
   * other without the two ever agreeing on what time it is.
   */
  #offsetMs: number | null = null;

  constructor(options: InterpolatorOptions) {
    this.#delayMs = options.delayMs;
    this.#msPerTick = options.msPerTick ?? 1000 / 60;
  }

  /** How many snapshots are held. Exposed so the cap can be asserted. */
  buffered(): number {
    return this.#buffer.length;
  }

  /** How far behind remote bodies are drawn. Fixed, for the reason above. */
  delayMs(): number {
    return this.#delayMs;
  }

  /** Adds a snapshot. Out-of-order arrivals are dropped, not reordered. */
  push(snap: Snapshot, now: number): void {
    const newest = this.#buffer[this.#buffer.length - 1];
    if (newest && snap.tick <= newest.snap.tick) return;

    const simMs = snap.tick * this.#msPerTick;
    this.#trackOffset(now - simMs);
    this.#buffer.push({ snap, simMs });
    while (this.#buffer.length > KEEP) this.#buffer.shift();
  }

  /** Every body as it should be drawn now, interpolated where possible. */
  at(now: number): EntitySnapshot[] {
    if (this.#buffer.length === 0) return [];
    if (this.#buffer.length === 1 || this.#offsetMs === null) {
      return this.#buffer[this.#buffer.length - 1]!.snap.entities;
    }

    const target = now - this.#offsetMs - this.#delayMs;
    const [older, newer] = this.#bracket(target);

    // Clamped at both ends: before the oldest and after the newest, hold still
    const span = newer.simMs - older.simMs;
    const t = span > 0 ? clamp01((target - older.simMs) / span) : 1;

    // The OLDER snapshot decides who exists, because the moment being drawn is
    // at or after it. A body the newer one has dropped was still there then,
    // and dropping it now would delete an arrow up to a whole delay before it
    // actually hit anything. One that only the newer one has did not exist yet.
    return older.snap.entities.map((from) => {
      const to = newer.snap.entities.find((e) => e.id === from.id);
      if (!to) return from;                       // gone by the newer snapshot
      return {
        ...to,
        x: Math.round(lerp(from.x, to.x, t)),
        y: Math.round(lerp(from.y, to.y, t)),
      };
    });
  }

  /** Keeps the running estimate of how far apart the two clocks are. */
  #trackOffset(observed: number): void {
    if (this.#offsetMs === null || Math.abs(observed - this.#offsetMs) > RESYNC_MS) {
      this.#offsetMs = observed;
      return;
    }
    this.#offsetMs += (observed - this.#offsetMs) * OFFSET_SMOOTHING;
  }

  /** The two snapshots that straddle the target, or the closest available pair. */
  #bracket(target: number): [Timed, Timed] {
    for (let i = this.#buffer.length - 1; i > 0; i--) {
      const older = this.#buffer[i - 1]!;
      const newer = this.#buffer[i]!;
      if (older.simMs <= target && target <= newer.simMs) return [older, newer];
    }
    // Target is outside the buffer: use the nearest edge pair and let the
    // clamp above pin it to whichever end it fell off.
    const first = this.#buffer[0]!;
    const second = this.#buffer[1]!;
    const last = this.#buffer[this.#buffer.length - 1]!;
    const secondLast = this.#buffer[this.#buffer.length - 2]!;
    return target < first.simMs ? [first, second] : [secondLast, last];
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
