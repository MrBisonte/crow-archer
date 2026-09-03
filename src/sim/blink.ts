/**
 * The arithmetic of a blink chain.
 *
 * The wizard's Arcane Blink may be taken again inside a short window, and the
 * rite's Thunderstep pays for doing it: each hop of a chain arrives harder
 * than the one before, which is what turns an escape button into the way a
 * hard fight is actually fought. The rule is two lines of arithmetic and it
 * belongs here rather than inside `tryWizardBlink`, for the reason
 * `targeting.ts` gives about its own: an off-by-one in a hop count is
 * invisible on a canvas and obvious in a table.
 *
 * Pure: no DOM, no randomness, no I/O, nothing that runs at import time.
 */

/** What arriving does to everything standing where the wizard lands. */
export interface BlinkPulse {
  /** World pixels. */
  readonly radius: number;
  /** What a boss caught in it loses. */
  readonly bossDamage: number;
}

/**
 * Which hop of the chain has just been taken, counting from 1.
 *
 * The simulation counts hops DOWN — `wizBlinkHops` is how many are still
 * available, because that is the question every press asks. Escalation needs
 * the opposite number, so it is derived here once instead of being
 * re-subtracted at each call site.
 *
 * Clamped at both ends. A chain whose length shrank mid-run, or a count that
 * ran past its own floor, must never produce a zeroth or negative hop: those
 * multiply a pulse down to nothing, which reads on screen as the ability
 * failing to fire rather than as a number being wrong.
 */
export function hopOrdinal(maxHops: number, hopsLeft: number): number {
  return Math.min(Math.max(1, maxHops), Math.max(1, maxHops - hopsLeft));
}

/**
 * What the `ordinal`-th hop of a chain arrives with.
 *
 * Two laws rather than one, and the difference is deliberate:
 *
 * - **Damage is a count.** It steps by a whole base hit per hop, so a
 *   three-hop chain is worth 1 + 2 + 3 base hits. That is the figure the
 *   capstone is priced on, and it reads plainly on a boss bar.
 * - **Radius is a length**, and the ground a pulse covers grows as its
 *   square. Stepping it the same way would multiply the area caught by nine
 *   over three hops, so it climbs by a fraction of the base instead.
 *
 * `growth` of 0 is the identity for the radius, which is what lets the dial
 * be turned off without the caller learning a second code path.
 */
export function escalatedPulse(
  base: BlinkPulse,
  ordinal: number,
  growth: number,
): BlinkPulse {
  return {
    radius: base.radius * (1 + (ordinal - 1) * growth),
    bossDamage: base.bossDamage * ordinal,
  };
}
