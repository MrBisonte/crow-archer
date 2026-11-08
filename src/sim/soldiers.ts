/**
 * The cavern's garrison: who marches in each wave, and the rules that are
 * geometry rather than animation.
 *
 * A cavern is somebody's dug-out stronghold, so its enemies are the people who
 * dug it. That is not a reskin of the crow: a crow flies in off the right edge
 * in a straight line and is dangerous by arriving, whereas soldiers walk, path
 * around terrain, and are dangerous by what they are carrying. Three kinds,
 * each answering a different question the player has to answer differently:
 * the spearman punishes standing still, the shieldman punishes shooting from
 * the front, and the archer punishes staying at range.
 *
 * Pure. No DOM, no rng, no game state. `src/legacy/game.js` owns the bodies
 * and their animation; what lives here is the part worth pinning down in a
 * test — the composition of a wave and the arithmetic of a shield.
 */

/** The three of them. A fourth is a row here and a painter in render/. */
export type SoldierKind = 'spearman' | 'shieldman' | 'archer';

/**
 * In marching order, which is also the order waves rotate through. Exported so
 * callers and tests enumerate the kinds instead of retyping them.
 */
export const SOLDIER_KINDS: readonly SoldierKind[] = ['spearman', 'shieldman', 'archer'];

/**
 * What each kind is made of.
 *
 * Only the numbers every kind has are here. What each one *does* with them
 * lives in game.js beside the other bodies, for the reason the architecture
 * doc gives for bosses: a table earns its keep when new rows are mostly data,
 * and these three differ mostly by algorithm once they are on the field.
 *
 * The three rows are deliberately not interchangeable. Health, speed and reach
 * trade off against each other so that no kind is another kind but better: the
 * shieldman is the toughest and the slowest, the archer is the frailest and
 * outranges everything, and the spearman sits between them and closes.
 */
export const SOLDIER_STATS: Record<SoldierKind, {
  /** Arrows to put it down. */
  readonly hp: number;
  /** Walking speed in pixels per second. */
  readonly speed: number;
  /** Damage on touching the player. */
  readonly contactDamage: number;
  /** Distance in pixels at which it stops closing and does its own thing. */
  readonly reach: number;
}> = {
  // Closes, then charges the last stretch. Reach is the trigger distance, not
  // a weapon length: it is where the charge starts, far enough out that it is
  // a thing you see coming and can step off the line of.
  spearman: { hp: 2, speed: 92, contactDamage: 1, reach: 150 },
  // Walks up and stays there. The shortest reach of the three because it has
  // to actually arrive, which is what makes the slow speed cost something.
  shieldman: { hp: 4, speed: 66, contactDamage: 1, reach: 26 },
  // Stops well out and shoots. Frail on purpose: the answer to an archer is to
  // reach it, and that has to be worth the walk.
  archer: { hp: 1, speed: 78, contactDamage: 1, reach: 260 },
};

/**
 * One step of the ramp: from this wave on, a wave fields `kinds` different
 * kinds, `each` of them apiece.
 *
 * A table rather than a chain of ifs because this is the dial most likely to
 * be retuned after playing it, and a table can be retuned without re-reading
 * the logic that walks it.
 */
interface WaveBand {
  /** First wave this band applies to. */
  readonly from: number;
  /** How many distinct kinds march together. */
  readonly kinds: number;
  /** How many of each of those kinds. */
  readonly each: number;
}

/**
 * The ramp. One kind at a time to start, pairs from wave 3, the whole garrison
 * from wave 6 and more of them.
 *
 * Ordered by `from`, and read by taking the last band that has started. Adding
 * a step means one row.
 */
const WAVE_BANDS: readonly WaveBand[] = [
  { from: 1, kinds: 1, each: 3 },
  { from: 3, kinds: 2, each: 3 },
  { from: 6, kinds: 3, each: 4 },
];

/** The band a wave falls in. Waves before the first band are the first band. */
function bandFor(wave: number): WaveBand {
  let band = WAVE_BANDS[0]!;
  for (const next of WAVE_BANDS) if (wave >= next.from) band = next;
  return band;
}

/**
 * Who marches in a given wave.
 *
 * Which kinds are picked rotates with the wave number, so wave 1 and wave 2
 * are not the same three spearmen twice and the pairs at 3 to 5 are not the
 * same pair three times. Rotating rather than drawing at random keeps a wave
 * reproducible from its number alone, which is what lets a test say what wave
 * 4 is and a player learn that the pattern is a pattern.
 */
export function waveComposition(wave: number): SoldierKind[] {
  const n = Math.max(1, Math.floor(wave));
  const band = bandFor(n);
  const start = (n - 1) % SOLDIER_KINDS.length;
  const marching: SoldierKind[] = [];
  for (let i = 0; i < band.kinds; i++) {
    const kind = SOLDIER_KINDS[(start + i) % SOLDIER_KINDS.length]!;
    for (let c = 0; c < band.each; c++) marching.push(kind);
  }
  return marching;
}

/**
 * The wave the commander rides in on, and the end of the run.
 *
 * After the full-garrison band at 6 has come round a few times, so the player
 * has met everything he commands before they meet him.
 */
export const COMMANDER_WAVE = 9;

/**
 * How wide the shieldman's guard is, total, in radians: 120 degrees, so 60
 * either side of dead ahead.
 *
 * Not the flat 180 it started as. Half a circle puts a shot arriving square
 * from the side exactly on the boundary, so whether it lands comes down to
 * which way the comparison rounds, and that is not a rule a player can learn.
 * It also plays worse: a 180 guard can only be beaten from behind, which
 * against something that turns to face you is no angle at all. At 120 there is
 * a real flank — anything past 60 off its nose gets through — so walking wide
 * is an answer, and a soldier that has to keep turning is not doing anything
 * else while it turns.
 */
const SHIELD_ARC = (2 * Math.PI) / 3;

/** The smallest angle between two headings, in radians, always 0..PI. */
const angleBetween = (a: number, b: number): number =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * Does a shieldman facing `facing` stop something travelling along `heading`?
 *
 * The shield covers the front, so what matters is whether the shot is coming
 * *at* the front: a heading of `facing` is a shot going the same way the
 * soldier looks, which is one arriving from behind. Hence the comparison
 * against the reverse of the heading.
 *
 * This is the whole point of the kind. A shieldman that could be shot from the
 * front is a crow with more health; one that cannot has to be walked around,
 * which is a different question for the player to answer and a bad one to be
 * answering while a spearman is closing.
 *
 * Both angles are normalised, so a facing that has wound several turns round
 * from repeated aiming still answers correctly.
 */
export function shieldStops(facing: number, heading: number): boolean {
  return angleBetween(facing, heading + Math.PI) <= SHIELD_ARC / 2;
}

/**
 * Which way a soldier walking from (x, y) toward (tx, ty) is looking.
 *
 * Standing exactly on the target has no direction to report, so the previous
 * facing is kept rather than snapping to zero: a shield that flicks to facing
 * east because the soldier landed on the player's exact pixel would drop its
 * guard for a frame, and one frame is a hit.
 */
export function shieldFacing(
  x: number,
  y: number,
  tx: number,
  ty: number,
  previous = 0,
): number {
  const dx = tx - x;
  const dy = ty - y;
  if (dx === 0 && dy === 0) return previous;
  return Math.atan2(dy, dx);
}
