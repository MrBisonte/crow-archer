/**
 * Renders remote bodies smoothly from snapshots that arrive 20 times a second.
 *
 * Drawing the newest snapshot directly would step remote players 50 ms at a
 * time. Instead the client deliberately renders slightly in the past, between
 * the two snapshots that bracket that moment, so movement is continuous. The
 * cost is a fixed delay on everyone else's position, which is the standard
 * trade and the reason the roadmap puts remote entities about 100 ms behind.
 *
 * Extrapolation is not attempted. Running ahead of the newest snapshot invents
 * positions the server never sent, and then has to take them back.
 */

import type { EntitySnapshot, Snapshot } from './protocol';

/** One snapshot and when it landed, which is what the render clock compares to. */
interface Timed {
  snap: Snapshot;
  at: number;
}

export interface InterpolatorOptions {
  /** How far behind the newest snapshot to render, in milliseconds. */
  delayMs: number;
}

/**
 * Snapshots kept. Two are needed to interpolate; a few more absorb a late or
 * dropped packet without stalling. Older ones can never be asked for again.
 */
const KEEP = 4;

export class Interpolator {
  readonly #delayMs: number;
  readonly #buffer: Timed[] = [];

  constructor(options: InterpolatorOptions) {
    this.#delayMs = options.delayMs;
  }

  /** How many snapshots are held. Exposed so the cap can be asserted. */
  buffered(): number {
    return this.#buffer.length;
  }

  /** Adds a snapshot. Out-of-order arrivals are dropped, not reordered. */
  push(snap: Snapshot, now: number): void {
    const newest = this.#buffer[this.#buffer.length - 1];
    if (newest && snap.tick <= newest.snap.tick) return;
    this.#buffer.push({ snap, at: now });
    while (this.#buffer.length > KEEP) this.#buffer.shift();
  }

  /** Every body as it should be drawn now, interpolated where possible. */
  at(now: number): EntitySnapshot[] {
    if (this.#buffer.length === 0) return [];
    if (this.#buffer.length === 1) return this.#buffer[0]!.snap.entities;

    const target = now - this.#delayMs;
    const [older, newer] = this.#bracket(target);

    // Clamped at both ends: before the oldest and after the newest, hold still
    const span = newer.at - older.at;
    const t = span > 0 ? clamp01((target - older.at) / span) : 1;

    // The newer snapshot decides who exists; a body it has dropped is gone
    return newer.snap.entities.map((to) => {
      const from = older.snap.entities.find((e) => e.id === to.id);
      if (!from) return to;                       // appeared this snapshot
      return {
        ...to,
        x: Math.round(lerp(from.x, to.x, t)),
        y: Math.round(lerp(from.y, to.y, t)),
      };
    });
  }

  /** The two snapshots that straddle the target, or the closest available pair. */
  #bracket(target: number): [Timed, Timed] {
    for (let i = this.#buffer.length - 1; i > 0; i--) {
      const older = this.#buffer[i - 1]!;
      const newer = this.#buffer[i]!;
      if (older.at <= target && target <= newer.at) return [older, newer];
    }
    // Target is outside the buffer: use the nearest edge pair and let the
    // clamp above pin it to whichever end it fell off.
    const first = this.#buffer[0]!;
    const second = this.#buffer[1]!;
    const last = this.#buffer[this.#buffer.length - 1]!;
    const secondLast = this.#buffer[this.#buffer.length - 2]!;
    return target < first.at ? [first, second] : [secondLast, last];
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
