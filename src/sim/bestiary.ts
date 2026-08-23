/**
 * The catalogue: one row for every enemy kind in the game, and the five bosses
 * by name.
 *
 * `src/legacy/game.js` keeps its bodies in three arrays — `crows`, `skeletons`
 * and `soldiers` — and each array has its own spawner taking its own kind of
 * argument. That split is right for the code that pushes bodies and useless for
 * code that wants to ask a question about the cast as a whole: which kinds
 * shoot back, which ones arrive from off-screen, and above all whether a list
 * of kinds is the *whole* list. Nothing owned those answers, so each caller
 * that needed one wrote the kinds out by hand, and a hand-written list of kinds
 * is one new enemy away from being quietly wrong.
 *
 * Hence a Record keyed by the union, which is the repo's usual trade: a new
 * enemy costs a row here, and until it has one nothing that reads this table
 * compiles. That is the reason it is a table and not a helper with a switch in
 * it — a switch with a missing case is a runtime surprise, a Record with a
 * missing row is a build failure.
 *
 * It describes the cast; it does not spawn anything. Bodies, animation and AI
 * stay in game.js, for the reason soldiers.ts gives: a table earns its keep
 * when the rows are data rather than algorithms.
 *
 * Pure. No DOM, no rng, no game state, and nothing runs on import.
 */

/**
 * Every enemy that is not a boss.
 *
 * Named for what the player meets rather than for the legacy spawner argument,
 * which is why this says `soldier_archer` where game.js says `'archer'`: the
 * garrison's archer and the player's archer character share a word and nothing
 * else, and a union member called `archer` reads as the character at half the
 * call sites. The skeleton variants carry their element in the name for the
 * same reason — `fire_skeleton` says what turned up, where the legacy `'fire'`
 * only means anything to someone who already knows which spawner it was passed
 * to.
 */
export type EnemyKind =
  | 'bat' | 'crow' | 'rat' | 'skeleton' | 'fire_skeleton' | 'ice_skeleton'
  | 'spearman' | 'shieldman' | 'soldier_archer';

/**
 * The five bosses, in the order `BOSS_STAGES` has them in game.js.
 *
 * A separate union rather than more EnemyKind rows. A boss is a scripted
 * arrival with its own state machine, its own HP table and its own entrance
 * banner; none of the fields in `EnemyEntry` mean anything for one, so folding
 * them in would buy a shared type at the price of five rows of nulls and a
 * `BESTIARY` that could no longer answer "what does a normal wave field".
 * Keeping them apart also lets a wave say bosses and rabble separately, which
 * is exactly how the siege ladder next door reads.
 */
export type BossKind =
  | 'crowking' | 'dark_archer' | 'dark_knight' | 'minotaur' | 'commander';

/**
 * Which legacy array the entity lives in.
 *
 * Load-bearing, and not guessable from the name: the bat is a crow, the rat is
 * a skeleton. The roster decides which spawner builds the body and which update
 * loop runs it, so anything driving the legacy side from this table has to read
 * it rather than infer it from how the kind sounds.
 */
export type Roster = 'crows' | 'skeletons' | 'soldiers';

/** What is worth knowing about a kind before it is on the field. */
export interface EnemyEntry {
  readonly roster: Roster;
  /**
   * The argument the legacy spawner for that roster takes.
   *
   * `null` where the spawner takes none. Deliberately a plain string and not a
   * per-roster union: expressing "'normal' | 'fire' | 'ice' | 'rat' only when
   * the roster is skeletons" needs the table split into one discriminated
   * variant per roster, and that turns one readable catalogue into three to
   * gain a compile check on nine string literals. The literals are pinned by a
   * test instead, which is the cheaper half of the same guarantee.
   */
  readonly spawnArg: string | null;
  /**
   * Does it hurt you from across the map?
   *
   * The one fact that changes what the player must do about a kind rather than
   * how it looks doing it — against everything else, distance is an answer.
   */
  readonly ranged: boolean;
  /**
   * Enters from the right-hand corridor, vs being placed inside the map.
   *
   * The two are not interchangeable on an enclosed map: something that walks in
   * off the canvas edge is a thing you see coming and can back away from, and
   * something placed by `openTileAwayFrom` is already inside with you. It is
   * also why this is recorded per kind and not per roster — the skeletons array
   * holds both.
   */
  readonly walksIn: boolean;
}

/**
 * The catalogue itself, one row per kind.
 *
 * Every value here is read off `src/legacy/game.js`, not invented: game.js is
 * the thing that actually spawns these, so where the two disagree this file is
 * the one that is wrong.
 */
export const BESTIARY: Record<EnemyKind, EnemyEntry> = {
  // A white crow, literally: `spawnBossBats()` pushes into the `crows` array
  // with `white: true`, so a bat is the bird with a different palette and a
  // summoner. It takes no spawner argument because that flag is set at the push
  // site, and it does not walk in — the crow king conjures it on top of himself.
  bat: { roster: 'crows', spawnArg: null, ranged: false, walksIn: false },
  // The original arena enemy. Flies in off the right edge in a straight line;
  // dangerous by arriving rather than by carrying anything.
  crow: { roster: 'crows', spawnArg: null, ranged: false, walksIn: true },
  // Lives in the skeletons array but behaves like nothing else in it: placed in
  // the map by `openTileAwayFrom`, and poisons on contact, so a bite that is
  // barely a hit still costs you the next few seconds of movement.
  rat: { roster: 'skeletons', spawnArg: 'rat', ranged: false, walksIn: false },
  // The castle kinds march in from the right edge, unlike the rat they share an
  // array with. `spawnSkeleton` splits on exactly that — the rat gets
  // `openTileAwayFrom`, everything else gets `canvasW + 20` — and its own
  // comment says so. Worth stating because the three are otherwise easy to file
  // alongside the rat, and on the bastion this is the difference between a
  // siege coming down the corridor and one appearing behind the walls.
  skeleton: { roster: 'skeletons', spawnArg: 'normal', ranged: false, walksIn: true },
  fire_skeleton: { roster: 'skeletons', spawnArg: 'fire', ranged: false, walksIn: true },
  // The only skeleton that shoots: `fireIceBolt` sends a single freezing bolt,
  // which is a hit that also takes the next moment away from you.
  ice_skeleton: { roster: 'skeletons', spawnArg: 'ice', ranged: true, walksIn: true },
  // The garrison. All three are placed in the map rather than marched in, since
  // a cavern's own soldiers arriving through the wall reads as a bug.
  spearman: { roster: 'soldiers', spawnArg: 'spearman', ranged: false, walksIn: false },
  shieldman: { roster: 'soldiers', spawnArg: 'shieldman', ranged: false, walksIn: false },
  // `spawnArg` is the legacy `'archer'`; the name here is not. See EnemyKind.
  soldier_archer: { roster: 'soldiers', spawnArg: 'archer', ranged: true, walksIn: false },
};

/**
 * Every kind, in the order a player meets them: birds, then the castle's dead,
 * then the garrison.
 *
 * A union has no runtime form, so anything that wants to walk the cast — a
 * wave builder, a test asking whether the ladder is complete — needs a value to
 * walk. Written out rather than `Object.keys(BESTIARY) as EnemyKind[]`: that
 * cast is an assertion the compiler cannot check, so it would launder a wrong
 * list into a typed one, and it says nothing about order while this list is
 * also the order. The risk of the two drifting apart is real and is answered by
 * a test comparing this length against the number of rows.
 */
export const ENEMY_KINDS: readonly EnemyKind[] = [
  'bat', 'crow', 'rat', 'skeleton', 'fire_skeleton', 'ice_skeleton',
  'spearman', 'shieldman', 'soldier_archer',
];

/**
 * The bosses in stage order, matching `BOSS_STAGES` in game.js.
 *
 * Exported for the same reason as ENEMY_KINDS, and used for the same question:
 * a run that means to field every boss has to be checkable against the list of
 * bosses rather than against somebody's memory of it.
 */
export const BOSS_KINDS: readonly BossKind[] = [
  'crowking', 'dark_archer', 'dark_knight', 'minotaur', 'commander',
];
