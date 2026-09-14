/**
 * The weapon figures both runtimes read.
 *
 * The heroes are built twice — `src/legacy/game.js` and its `CONFIG` for the
 * single-player game, `src/sim/weapons.ts` for the server-authoritative match
 * — and for a while the multiplayer side held hand-typed copies of the
 * single-player numbers. A copy is not a shared figure: tuning `CONFIG`
 * moved one arrow and left the other where it was, with nothing to catch it.
 * These are the base figures, one home each, imported by both.
 *
 * Units are `CONFIG`'s, because `CONFIG` is where most of them were written
 * first: seconds, pixels, pixels per second, radians. The multiplayer side
 * converts to ticks at the point of use, with `ticks()`.
 *
 * ## What does NOT belong here
 *
 * Anything only one runtime has. Player-versus-player damage is designed in
 * `weapons.ts` — every damage figure in `CONFIG` is boss damage, and the
 * single-player game has no PvP at all, so there is nothing here to share.
 *
 * And a multiplayer figure that deliberately differs stays a difference: it
 * lives in `weapons.ts` as a named modifier applied to a base from here, so
 * the relationship survives a tune instead of being frozen at a value.
 * `MP_DYNAMITE_SPEED_SCALE` is the worked example. A figure the two sides
 * disagree on for no stated reason is not settled by this file either — it is
 * a balance call, and it stays in both places until somebody makes it.
 */

// ── The archer's bow ────────────────────────────────────────────────────────
// The ranger's crossbow shares the flight: same speed, same lifetime, and
// only the burst, the bolt's size and its damage are his own.

export const ARROW_SPEED = 500;
export const ARROW_LIFE_SECS = 1.5;

// ── The wizard's bolt ───────────────────────────────────────────────────────

export const BOLT_SPEED = 468;
export const BOLT_LIFE_SECS = 3.5;
/** Homing angular speed, radians per second. */
export const BOLT_TURN_RATE = 4.5;

// ── The knight's spear ──────────────────────────────────────────────────────

/** How far the tip reaches at rest, before the thrust extends it. */
export const SPEAR_REACH = 80;
export const SPEAR_COOLDOWN_SECS = 1.0;
export const SPEAR_SWING_SECS = 0.35;

// ── The knight's whirlwind ──────────────────────────────────────────────────
// The radius is deliberately NOT here: the arena trims it to 70 against the
// single-player 72, and `WHIRLWIND_BLAST_RADIUS` in weapons.ts says why.

export const WHIRLWIND_DURATION_SECS = 3;
export const WHIRLWIND_COOLDOWN_SECS = 6;
/** Seconds between damage ticks while it channels. */
export const WHIRLWIND_TICK_SECS = 0.22;

// ── Dynamite, and every other explosive ─────────────────────────────────────

/** Throw speed at no charge. Multiplayer throws slower; see weapons.ts. */
export const DYNAMITE_THROW_SPEED = 336;
export const DYNAMITE_FUSE_SECS = 1.5;
/**
 * Blast radius of a stick, and of everything else that goes off: the satchel
 * and the sapper's powder charge share it, in both runtimes, because an
 * explosion is an explosion and not a second copy of the same figure.
 */
export const DYNAMITE_BLAST_RADIUS = 90;

// ── The ranger's crossbow ───────────────────────────────────────────────────

/** Bolts a burst fires. Each is an independent shot resolving its own hit. */
export const CROSSBOW_BOLT_COUNT = 3;
/** A bolt is 30% smaller than the arrow it is cut down from. */
export const CROSSBOW_BOLT_RADIUS_MULT = 0.7;
/** Angle between adjacent bolts in a burst: 3 degrees. */
export const CROSSBOW_SPREAD_RADIANS = Math.PI / 60;

// ── The ranger's satchel ────────────────────────────────────────────────────

/** How long an armed satchel counts down before it goes off on its own. */
export const SATCHEL_ARM_FUSE_SECS = 3;
/** How long a thrown, unarmed satchel sits before it quietly expires. */
export const SATCHEL_IDLE_LIFE_SECS = 60;

// ── The sapper's powder charge ──────────────────────────────────────────────

/** Slower than every primary but the wizard's bolt. */
export const SAPPER_CHARGE_COOLDOWN_SECS = 1.1;
