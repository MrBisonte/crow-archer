/**
 * Impact freeze, "hitstop": a handful of fixed steps where the simulation is
 * held still while the frame loop keeps drawing, so a heavy hit reads as
 * weight rather than as a number going down.
 *
 * State plus arithmetic, no canvas and no DOM — deliberately the same shape as
 * `ScreenShake` in `src/render/shake.ts`, because the two are one impact felt
 * two ways and drift apart the moment one of them grows machinery the other
 * lacks.
 *
 * ## Why this lives under `sim/` and not beside `ScreenShake`
 *
 * Hitstop is awkward for the sim/render split on purpose: what *arms* it is a
 * presentation decision ("this hit should land hard"), but what it *does* is
 * hold the simulation. The counter is placed on the sim side of the seam
 * because its unit is the fixed sim step and its whole effect is on whether
 * the world advances. A counter owned by the render layer that decides
 * whether the sim runs would be exactly the inversion the split exists to
 * prevent — render would be steering the sim's clock.
 *
 * The other half of the answer is in `src/legacy/game.js`: the *policy* (how
 * many steps each kind of impact is worth) sits in the `HITSTOP` ladder beside
 * `SHAKE`, in the presentation layer, where every other "how loud does this
 * land" decision already is. The sim still only states what happened.
 */

/** What the frame loop should do with one fixed step. */
export type StepVerdict = 'run' | 'held';

/** The freeze counter. One instance per game; see `hitstop` in `game.js`. */
export class Hitstop {
  private frames = 0;

  /**
   * Holds the simulation for `frames` further fixed steps.
   *
   * Longest wins: a shorter hold arriving during a longer one is ignored, never
   * added to it, so several impacts landing in the same frame cost one freeze
   * instead of their sum. Same arbitration rule as `ScreenShake.trigger`, for
   * the same reason — a barrage of five bombs is one moment, not five.
   *
   * A row of `0` is a deliberate "shakes but does not freeze" and is a no-op
   * here, not an error: the `HITSTOP` ladder states those absences as data so
   * they stay reviewable.
   */
  trigger(frames: number): void {
    if (frames > this.frames) this.frames = frames;
  }

  /**
   * Spends one fixed step, reporting what the loop should do with it: `'held'`
   * while a freeze is still owed, `'run'` otherwise.
   */
  step(): StepVerdict {
    if (this.frames <= 0) return 'run';
    this.frames--;
    return 'held';
  }

  /** Fixed steps of freeze still owed. Zero means the world is running. */
  get held(): number {
    return this.frames;
  }

  /**
   * Drops a freeze in progress. A freeze belongs to one moment of one run, so
   * a screen change and a new run both end it rather than carrying it over.
   */
  clear(): void {
    this.frames = 0;
  }
}
