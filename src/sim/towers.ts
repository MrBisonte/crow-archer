/**
 * The bastion's two defence towers: how much they take, and when they stop
 * taking it.
 *
 * **Towers are cover, not objectives. Losing one does not lose the run.** A
 * tower that falls costs the hero the shelter it was giving and the shots it
 * was stopping, and costs him nothing else. The run is lost when the hero dies
 * and won when the last wave is cleared, both of which are `siege-run.ts`'s
 * business and neither of which this module can bring about — there is no call
 * here that ends anything.
 *
 * That is worth saying at the top because it is not what the words "two towers
 * and a stone barrier" suggest. The genre those words belong to is the one
 * where the towers *are* the thing being defended, and somebody reading this
 * file cold will want to wire a loss condition to the second collapse out of
 * pure intuition. Don't. The alternative was considered and rejected for the
 * reason `siege-run.ts` rejects losing on the last guard: a defence that you
 * are punished for spending is not a defence, it is a second health bar with
 * masonry on it. The towers are meant to be spent. A hero holding wave 9 in the
 * open because both of them came down in wave 6 is the run going badly, which
 * is a story; it is not the run being over.
 *
 * What follows from that is the whole shape of this module. There is no
 * `allTowersFallen`, no count of survivors compared against a threshold, and no
 * event for the last one going down, because every one of those is a hook
 * somebody would hang a game over on. What there is: hp that goes down and does
 * not come back, a way to ask whether a tower is still there, and a way to ask
 * whether one is standing on a given tile. Cover, and questions about cover.
 *
 * Pure. No DOM, no `Math.random`, no rng of any kind — a tower's fate is
 * decided entirely by what hits it, so two identical runs damage them
 * identically and a bastion replay is exact. Nothing runs on import.
 */

/**
 * Grid position of a tower. Towers never move, so this is identity as well as
 * location.
 *
 * That immobility is the reason there is no id field. Two towers cannot share a
 * tile, so the pair of coordinates already distinguishes them for as long as
 * the run lasts, and an id would be a second name for the same thing that a
 * caller could match on while the coordinates said otherwise. `towerAt` is
 * built on exactly this: a tile is a lookup key because nothing ever moves off
 * one.
 *
 * Declared here rather than imported from the terrain generator that picks the
 * sites, and that is deliberate rather than an oversight. This module is about
 * what a tower *is*; where the two of them end up is a map question, and the
 * generator answering it today should be replaceable — by a hand-authored map,
 * by a second bastion layout — without this file knowing. The two shapes are
 * structurally identical, so a site from the generator satisfies this type
 * without any import in either direction, which is TypeScript paying for the
 * decoupling rather than the decoupling costing a conversion at the seam. The
 * cost, stated plainly: two declarations of the same two fields. If a third
 * module ever wants the shape, that is the signal to give it one home.
 */
export interface TowerSite {
  readonly row: number;
  readonly col: number;
}

/**
 * How much punishment a tower absorbs before it comes down.
 *
 * Twenty, chosen against the siege ladder rather than by feel. The ladder
 * fields 3 bodies on wave 1 and climbs to 12 on wave 10 — 75 in all, plus five
 * bosses — and the ordinary hit in this game is worth 1, the way a guard's is.
 *
 * So: the first three waves put twelve bodies on the map altogether, and even
 * if every one of them ignored the hero and battered a tower instead it would
 * still be standing at wave 4 with 8 left. That is the "survives a few stray
 * hits" half, and it matters early, when the player is still learning that the
 * towers are somewhere to stand rather than something to garrison. The other
 * half is the back of the run: a late wave is a dozen bodies, so a tower that
 * a wave actually camps on comes down inside two of them. Sustained pressure
 * takes it; noise does not.
 *
 * Both towers together are therefore 40 points of masonry against a run that
 * throws roughly 75 bodies at the map, which is the intended feel — you should
 * expect to finish a siege having lost one of them, and losing neither should
 * read as having played well rather than as the default.
 *
 * It is a single number and not a table because there is one kind of tower. A
 * `Record<TowerKind, TowerStats>` in the shape of `GUARD_STATS` was the obvious
 * thing to reach for and is not worth it yet: one row is a table pretending, and
 * the day a second kind of tower exists this constant becomes that row with the
 * compiler pointing at every place that needs revisiting.
 */
export const TOWER_MAX_HP = 20;

/**
 * How many tiles on a side a tower occupies.
 *
 * Two, so a tower is a 2x2 block of tiles rather than one. `row` and `col` on
 * a Tower are its NORTH-WEST corner and it extends east and south from there.
 *
 * One tile was 32px square, which is the same size as the hero and smaller
 * than most of what walks at it -- a defence tower that a crow is as big as
 * reads as a bollard. At 64px it is the largest thing on the map that is not a
 * boss, which is what a tower on a siege ground should be.
 *
 * Named rather than assumed so that "where is this tower" has one answer.
 * Every consumer -- the generator stamping tiles, the renderer, the contact
 * pass asking whether a body is hitting one, `towerCentre` below -- derives
 * its footprint from this instead of hardcoding a single tile, which is what
 * they all did before and is why the tower's centre was written out by hand in
 * three different places.
 */
export const TOWER_SPAN = 2;

/**
 * What one bolt from a tower takes off.
 *
 * Two, against the guard's one, and the difference is the tower's entire
 * argument for existing. A guard walks, is healed by the priest, and is
 * replaced by a recruit every wave. A tower does none of those: it cannot be
 * repaired, cannot be moved off a wave that is camping on it, and is gone for
 * the rest of the run once it falls. If its shot were worth the same as a
 * body's, the sensible play would be to ignore the towers entirely and the map
 * would be a brawl with scenery.
 *
 * A single number rather than a table for the same reason TOWER_MAX_HP is: one
 * kind of tower means one row, and one row is a table pretending.
 */
export const TOWER_DAMAGE = 2;

/**
 * One tower on the field.
 *
 * `row` and `col` are `readonly` because they are the tower's identity, and
 * `hp` is not because it is the tower's running state — the same split
 * `guards.ts` makes for the same reason. `maxHp` is carried per tower rather
 * than read back off `TOWER_MAX_HP` at the point of use so that a HUD drawing a
 * damage bar has both ends of the fraction in hand, and so that a tower built
 * before a retune keeps the ceiling it was built with instead of silently
 * gaining or losing masonry mid-run.
 *
 * There is no `fallen` flag. It would be a second way to say what `hp === 0`
 * already says, and two ways to say one thing is one bug waiting for the call
 * site that sets the hp and forgets the flag; ask `towerStanding`.
 */
export interface Tower {
  readonly row: number;
  readonly col: number;
  hp: number;
  readonly maxHp: number;
  /**
   * Seconds until this tower may loose its next bolt.
   *
   * Running state, so it sits beside `hp` rather than with the readonly
   * identity above, and is counted down by the loop that owns the frame -- the
   * same split a guard body makes. It lives on the tower rather than in a
   * parallel map in the renderer because a cooldown keyed by tile is a second
   * name for a tower, and the two can then disagree about which towers exist.
   */
  shotCD: number;
}

/**
 * A tower at the given tile, undamaged.
 *
 * The only way to make one, so no caller has to remember that a tower starts at
 * full hp or that its ceiling comes from `TOWER_MAX_HP` — the same service
 * `makeGuard` does for a recruit.
 *
 * Takes loose `row` and `col` rather than a `TowerSite`, because half the
 * callers that want one tower have coordinates rather than a site object, and
 * `makeTower(site.row, site.col)` is a cheaper thing to write than
 * `makeTower({ row, col })` is at every hand-built call site. `makeTowers`
 * takes the sites.
 */
export function makeTower(row: number, col: number): Tower {
  // shotCD starts at zero, so a tower may fire the first frame something comes
  // into range. Both towers therefore open together, which is deliberate: a
  // volley reads as the bastion answering, and staggering them would need a
  // rng this module does not have and does not want.
  return { row, col, hp: TOWER_MAX_HP, maxHp: TOWER_MAX_HP, shotCD: 0 };
}

/**
 * Every tower for a run, given the sites the generator chose.
 *
 * In the order the sites came in, because the caller that picked them may well
 * mean something by that order — near tower and far tower, left and right — and
 * a function that quietly re-sorted them would take that meaning away for no
 * gain. Two sites in, two towers out, in the same positions.
 *
 * Each tower is a fresh object from `makeTower`. That is the point of routing
 * through it rather than filling an array with a spread of one literal: a
 * shared literal gives every site the same body, and the first hit anything
 * takes damages all of them at once. The bug is invisible until a tower falls
 * in two places, so there is a test for it.
 *
 * It does not check for duplicate sites. Two towers on one tile is a broken map
 * rather than a broken tower, and the module that placed them is where that is
 * worth catching; here it would mean this file having an opinion about layout,
 * which is the coupling the `TowerSite` note above exists to avoid. `towerAt`
 * copes regardless — it answers with the first standing tower on the tile.
 */
export function makeTowers(sites: readonly TowerSite[]): Tower[] {
  return sites.map((site) => makeTower(site.row, site.col));
}

/**
 * Is this tower still up?
 *
 * A named question rather than `tower.hp > 0` spelled out at every call site,
 * so that "standing" has one definition. It is a one-liner today and that is
 * fine: the alternative is a dozen inlined comparisons that all have to be
 * found and edited the day a tower can be standing but ruined.
 */
export function towerStanding(tower: Tower): boolean {
  return tower.hp > 0;
}

/**
 * Applies damage. Returns whether THIS call brought the tower down, so a caller
 * can play the collapse once rather than every frame the hp stays at zero.
 *
 * Mutates `hp` in place, which is the one deliberate impurity in this module.
 * It is the same call `guards.ts` makes for a guard's hp, and being consistent
 * with the other running state the game loop owns matters more here than
 * purity does: the loop holds the towers in an array it built at the start of
 * the run and expects a hit to land on the tower it is holding. Note the
 * contrast with `siege-run.ts`, which is pure for the opposite reason — the
 * loop holds a reference to *its* `SiegeState` across a whole wave, so a call
 * that edited that in place would leave two objects claiming to be the same run
 * while disagreeing about it. Bodies are edited; bookkeeping is replaced.
 *
 * The rules, and why each is what it is:
 *
 * A tower already at zero stays at zero and gets `false`. It did not fall on
 * this call — it was already rubble, and a caller that played the collapse
 * animation every frame a corpse kept being shot is precisely the caller this
 * return value exists to save. "Did it fall just now" is a different question
 * from "is it down", and `towerStanding` answers the other one.
 *
 * hp never goes below zero, however large the hit. A negative hp has no meaning
 * — there is no overkill bonus and nothing reads the depth of the hole — and it
 * would make every `hp > 0` check elsewhere depend on a number that could
 * quietly be `-40`. Clamping at the moment of subtraction keeps the invariant
 * where it can be seen rather than in each reader.
 *
 * A zero or negative `amount` is ignored: hp is untouched and the answer is
 * `false`. Ignoring rather than repairing, because healing is a different
 * operation and it should have a different name. Damage in this game is often
 * arrived at by subtraction — a hit minus armour, a falloff over distance — and
 * the day one of those subtractions goes one step too far, the failure should
 * be a hit that did nothing rather than a tower that silently repaired itself
 * while the player watched. Ignoring rather than throwing, because a game loop
 * resolving a frame's collisions should not be able to crash a run over
 * arithmetic that merely came out flat.
 *
 * A non-finite `amount` — `NaN` from a comparison that met an `undefined`,
 * `Infinity` from a division by a distance of zero — is ignored on the same
 * terms. `Infinity` needs saying separately because it is genuinely greater
 * than zero and would sail through a sign check, flattening the tower in one
 * call; `NaN` needs saying because it would poison `hp` into a value that is
 * neither standing nor fallen and that every later comparison answers `false`
 * to, which is a tower that can never be repaired, never collapse, and never
 * be diagnosed. Neither is ever a real hit. Both are a bug upstream, and a
 * tower quietly collapsing is the worst available way to be told about one.
 */
export function damageTower(tower: Tower, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (!towerStanding(tower)) return false;

  tower.hp = Math.max(0, tower.hp - amount);
  return tower.hp === 0;
}

/**
 * The towers still standing.
 *
 * In the order they were given, so a caller that knows its towers by position
 * in the run's array can still recognise them — and so that this and
 * `makeTowers` agree about what order means.
 *
 * A new array, never a filter in place, because the run's tower list is fixed
 * at the start and the fallen ones are still wanted: something has to draw the
 * rubble, and a collapsed tower is worth naming on the end-of-run screen. This
 * is the read-only view of that list, not a replacement for it.
 */
export function standingTowers(towers: readonly Tower[]): Tower[] {
  return towers.filter(towerStanding);
}

/**
 * Does a tower stand on this tile? Used to stop shots and bodies.
 *
 * **A fallen tower does not block.** This answers with standing towers only; a
 * tile whose tower has come down is as open as a tile that never had one, for
 * both arrows and bodies. That is the decision, and it is the one that makes
 * the rest of the module mean anything: the towers are cover, so the cover has
 * to actually go away when they fall. If rubble kept stopping arrows, taking a
 * tower down would cost the hero a sprite and nothing else, and the player
 * would have no reason to care about the one mechanic this map adds.
 *
 * The alternative — rubble as low cover that still blocks bodies but not shots
 * — is a real design and was rejected for now on grounds of legibility rather
 * than taste. It needs the player to see, at a glance and mid-wave, that this
 * pile of stone stops him walking but not the archer shooting, and the arena is
 * already asking him to track a dozen bodies. A rule nobody can read during the
 * fight is a rule that reads as a bug. If it is ever wanted, it belongs as a
 * separate `rubbleAt` with its own answer, not as a flag on this one: a caller
 * stopping an arrow and a caller stopping a body would then be asking genuinely
 * different questions, and they should call different functions to do it.
 *
 * The consequence for callers, said plainly so nobody has to work it out from
 * the return type: this function stops being true about a tile the instant the
 * tower there falls, in the same frame, with no transition. Anything that wants
 * the tower at a tile regardless of whether it is standing — a renderer drawing
 * rubble — wants the array, not this.
 *
 * `null` rather than `undefined` for "nothing there", because it is an answer
 * rather than an absence: the tile was checked and it is clear. `find` hands
 * back `undefined`, and normalising it here rather than at each call site is
 * the point of having a function at all — one shape of empty answer, so a
 * caller writes one check and `noUncheckedIndexedAccess` has nothing to
 * complain about.
 */
/**
 * Where a tower's shots come from, in world pixels.
 *
 * Derived from TOWER_SPAN rather than assuming the tower is one tile, so the
 * day the footprint grows the muzzle moves with it instead of staying pinned
 * to the top-left corner. `row`/`col` are the tower's NORTH-WEST tile, which is
 * the corner the generator stamps from.
 */
export function towerCentre(tower: Tower, tileSize: number): { x: number; y: number } {
  return {
    x: (tower.col + TOWER_SPAN / 2) * tileSize,
    y: (tower.row + TOWER_SPAN / 2) * tileSize,
  };
}

export function towerAt(towers: readonly Tower[], row: number, col: number): Tower | null {
  const found = towers.find((tower) => towerCovers(tower, row, col) && towerStanding(tower));
  return found ?? null;
}

/**
 * Is this tile part of that tower, standing or not?
 *
 * Separate from `towerAt` because it answers a different question: this one is
 * about geometry and `towerAt` is about cover, and a renderer drawing rubble
 * needs the first without the second. Both used to be `row === tower.row &&
 * col === tower.col`, which stopped being true the moment a tower stopped
 * being one tile -- and would have failed silently, since three quarters of a
 * tower would simply never have answered to anything.
 */
export function towerCovers(tower: Tower, row: number, col: number): boolean {
  return (
    row >= tower.row && row < tower.row + TOWER_SPAN &&
    col >= tower.col && col < tower.col + TOWER_SPAN
  );
}

/**
 * Every tile a tower stands on, north-west first, in reading order.
 *
 * So a caller clearing a fallen tower's tiles, or reserving the ground under
 * one, walks the footprint rather than working it out from TOWER_SPAN again.
 */
export function towerTiles(tower: TowerSite): TowerSite[] {
  const out: TowerSite[] = [];
  for (let r = 0; r < TOWER_SPAN; r++) {
    for (let c = 0; c < TOWER_SPAN; c++) out.push({ row: tower.row + r, col: tower.col + c });
  }
  return out;
}
