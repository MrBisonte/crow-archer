/**
 * Single player's modes, and the rules that used to be scattered across
 * `gameMode === '...'` comparisons in the legacy monolith.
 *
 * This is deliberately NOT multiplayer's `GameMode` in `src/net/protocol.ts`.
 * Same word, unrelated values (`coop | deathmatch`), chosen per match rather
 * than at the main menu. The two have been confusable since the netcode
 * landed; naming this one `SinglePlayerMode` is the cheapest way to stop that.
 *
 * The comparisons this replaces were spread over eleven sites in
 * `src/legacy/game.js`, which is fine at two modes and a liability at three:
 * a third value falls through every one of them silently, and `checkJs` is
 * off, so nothing would say a word. As a `Record<SinglePlayerMode, ModeRule>`
 * a new mode fails to compile until it has answered every question the other
 * modes answer, which is the same bet `MAP_RULES` and `CHARACTER_STATS` make.
 *
 * One caution learned from `MAP_RULES.crows`: a field here should answer
 * exactly one question. `crows: boolean` was quietly answering both "do birds
 * live here" and "does this map field a wave at all", and it came apart the
 * moment a map wanted a population that was not birds. Each field below is
 * named for the single question it settles.
 */

import { type MapKind } from './arena-map';
import { SIEGE_WAVE_COUNT } from './siege-waves';

/**
 * A mode the player picks at the title screen.
 *
 * Two values today. The union is the reason a third one cannot be added
 * halfway: every table below is keyed on it.
 */
export type SinglePlayerMode = 'brawl' | 'waves' | 'siege';

/** Where the map for a run comes from. */
export type MapChoice = 'fixed' | 'free';

/** What ends the run and puts the boss on the field, if anything does. */
export type BossTrigger = 'killCount' | 'none';

/** Which number the HUD and the end screens lead with. */
export type SummaryStat = 'kills' | 'wave';

export interface ModeRule {
  /** Shown on the HUD, the character-select header and both end screens. */
  readonly label: string;

  /**
   * Whether the player chooses the ground.
   *
   * `fixed` also skips the mapselect screen on the way into a run, because a
   * screen with nothing to decide is a keypress the player did not ask for.
   */
  readonly mapChoice: MapChoice;

  /**
   * The map a `fixed` mode always starts on, and `null` for a `free` one.
   *
   * Paired with `mapChoice` rather than replacing it: `null` is a fine value
   * for "the player picks", but reading the choice off a null check makes the
   * two states implicit, and the whole point of the enum is that they are not.
   */
  readonly fixedMap: MapKind | null;

  /**
   * Whether crow hp and speed climb with the wave number.
   *
   * Off for brawl because brawl is a sprint to ten kills and a boss, so there
   * is no long climb to ramp against.
   */
  readonly waveScaling: boolean;

  /** What puts the boss on the field. */
  readonly bossTrigger: BossTrigger;

  /**
   * Whether this mode runs the castle's scripted skeleton gauntlet.
   *
   * Load-bearing in two places, and they are the same question asked twice.
   * The gauntlet advances when the last skeleton of a wave dies, and while it
   * is running the escalation timer must keep its hands off — otherwise, on
   * the castle, both would drive the population and each would undo the other.
   * That second half is the Waves+Castle bug: escalation used to bail on
   * `mapKind === 'castle'` alone, so picking Castle in Waves mode returned
   * every tick and the run never spawned another crow past the opening batch.
   * Keying on the mode is what fixed it, and keeping it as one field is what
   * stops the two sites drifting apart again.
   */
  readonly runsCastleGauntlet: boolean;

  /** Whether a new wave announces itself with a banner. */
  readonly announcesWaves: boolean;

  /** Which figure the HUD's top line and the game-over screen report. */
  readonly summaryStat: SummaryStat;

  /**
   * How many waves the run is, or `null` for a mode that never ends on a
   * count.
   *
   * `null` rather than `Infinity` because the two mean different things to a
   * reader: brawl ends on a kill count and waves does not end at all, and
   * neither is 'a very large number of waves'. The win transition reads this
   * instead of hardcoding a ten.
   */
  readonly waveCap: number | null;
}

/**
 * One row per mode. Adding a mode is a row here plus a `MENU_ENTRIES` entry;
 * everything else follows, because nothing downstream branches on the mode
 * any more.
 */
export const MODE_RULES: Record<SinglePlayerMode, ModeRule> = {
  brawl: {
    label: 'BRAWL',
    mapChoice: 'fixed',
    fixedMap: 'forest',
    waveScaling: false,
    bossTrigger: 'killCount',
    runsCastleGauntlet: true,
    announcesWaves: false,
    summaryStat: 'kills',
    waveCap: null,
  },
  waves: {
    label: 'WAVES',
    mapChoice: 'free',
    fixedMap: null,
    waveScaling: true,
    bossTrigger: 'none',
    runsCastleGauntlet: false,
    announcesWaves: true,
    summaryStat: 'wave',
    waveCap: null,
  },
  /**
   * The bastion siege: a finite defence of two towers with a retinue, over ten
   * waves drawn from the whole bestiary.
   *
   * `mapChoice: 'fixed'` because a siege is a place, not a setting — the
   * towers, the barrier and the corridor are the mode, so offering it on the
   * forest would be offering a different game with the same name. That also
   * keeps it off the mapselect screen, which has nothing to ask.
   *
   * `waveScaling: false` because its ladder already sets each wave's
   * composition explicitly; multiplying crow hp on top would ramp the
   * difficulty twice and make the ladder's own numbers a lie.
   */
  siege: {
    label: 'SIEGE',
    mapChoice: 'fixed',
    fixedMap: 'bastion',
    waveScaling: false,
    bossTrigger: 'none',
    runsCastleGauntlet: false,
    announcesWaves: true,
    summaryStat: 'wave',
    waveCap: SIEGE_WAVE_COUNT,
  },
};

/**
 * Every mode, in menu order.
 *
 * Derived from the table rather than written out again, so the two cannot
 * disagree about which modes exist.
 */
export const SINGLE_PLAYER_MODES = Object.keys(MODE_RULES) as readonly SinglePlayerMode[];

/**
 * Narrows an untrusted string to a mode.
 *
 * The legacy module holds `gameMode` as a plain string in a file `tsc` does
 * not check, and the dev hooks let a test set it. This is the one place that
 * turns "some string" back into a value the tables can be keyed on.
 */
export const isSinglePlayerMode = (v: unknown): v is SinglePlayerMode =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(MODE_RULES, v);

/**
 * The rule row for a mode, falling back to brawl for anything unrecognised.
 *
 * A fallback rather than a throw because this is read from the draw loop:
 * a bad mode string should leave the player looking at a slightly wrong
 * label, not at a blank canvas with an exception behind it. The narrowing
 * above is where a caller that wants to *know* should ask.
 */
export const modeRule = (mode: unknown): ModeRule =>
  isSinglePlayerMode(mode) ? MODE_RULES[mode] : MODE_RULES.brawl;

/** Does this mode send the player through the mapselect screen? */
export const picksItsMap = (mode: unknown): boolean =>
  modeRule(mode).mapChoice === 'free';
