/**
 * Notices what changed between two snapshots and turns it into things worth
 * drawing: a hit, a death, a respawn.
 *
 * The wire carries gameplay facts, never cosmetics, so nothing tells a client
 * that a hit happened. It is inferred instead, from a body whose health went
 * down between one snapshot and the next. That keeps the protocol as it is and
 * keeps this out of the simulation.
 *
 * Pure: it is given snapshots and a time, and returns effects. Nothing here
 * knows about a canvas, and the tests need neither.
 */

import { EntityKind, PlayerState, type Snapshot } from '../net/protocol';

/** What happened. Drawing decides how each one looks. */
export const EffectKind = {
  HIT: 'hit',
  DEATH: 'death',
} as const;

export type EffectKind = (typeof EffectKind)[keyof typeof EffectKind];

export interface Effect {
  kind: EffectKind;
  /** Whose body it happened to. */
  id: number;
  /** Where it happened, in world pixels. */
  x: number;
  y: number;
  /** Health lost, for a hit. Zero for a death. */
  damage: number;
  /** When it started, on the caller's clock. */
  startedAt: number;
}

/** How long a hit is drawn for. Long enough to read, short enough not to pile up. */
export const HIT_MS = 260;

/** How long a death is drawn for. */
export const DEATH_MS = 500;

/** Effects kept at once. A burst is capped rather than allowed to grow. */
const MAX_EFFECTS = 24;

export class HitEffects {
  /** Health per body as of the last snapshot seen. */
  readonly #health = new Map<number, number>();
  /** Which bodies were dead last time, so a death fires once. */
  readonly #dead = new Set<number>();
  #effects: Effect[] = [];

  /**
   * Compares a snapshot against the previous one and records what changed.
   *
   * A body seen for the first time produces nothing: its health has not fallen,
   * it has only just been learned about.
   */
  observe(snap: Snapshot, now: number): void {
    for (const e of snap.entities) {
      if (e.kind !== EntityKind.PLAYER) continue;
      const previous = this.#health.get(e.id);
      this.#health.set(e.id, e.hp);

      const wasDead = this.#dead.has(e.id);
      const isDead = e.state === PlayerState.DEAD;
      if (isDead) this.#dead.add(e.id);
      else this.#dead.delete(e.id);

      if (previous === undefined) continue;
      if (isDead && !wasDead) {
        this.#push({ kind: EffectKind.DEATH, id: e.id, x: e.x, y: e.y, damage: 0, startedAt: now });
        continue;
      }
      if (e.hp < previous) {
        const damage = previous - e.hp;
        this.#push({ kind: EffectKind.HIT, id: e.id, x: e.x, y: e.y, damage, startedAt: now });
      }
    }
  }

  /**
   * The effects still running, each with how far through it is from 0 to 1.
   * Expired ones are dropped here rather than on a timer of their own.
   */
  active(now: number): { effect: Effect; progress: number }[] {
    const lifetime = (kind: EffectKind) => (kind === EffectKind.DEATH ? DEATH_MS : HIT_MS);
    this.#effects = this.#effects.filter((e) => now - e.startedAt < lifetime(e.kind));
    return this.#effects.map((effect) => ({
      effect,
      progress: (now - effect.startedAt) / lifetime(effect.kind),
    }));
  }

  #push(effect: Effect): void {
    this.#effects.push(effect);
    // Oldest first, because the newest is the one being looked at.
    if (this.#effects.length > MAX_EFFECTS) this.#effects.shift();
  }
}
