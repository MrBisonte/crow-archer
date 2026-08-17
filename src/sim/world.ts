/**
 * The seam between the server and the simulation.
 *
 * Match owns this interface, so the simulation is something the server is
 * handed rather than something it reaches into. That is what lets the netcode
 * be tested against a world small enough to reason about, and what lets the
 * real world arrive later without the server changing.
 *
 * A World is pure state and arithmetic: no canvas, no audio, no clock of its
 * own. It is stepped at a fixed rate with the inputs that arrived for that
 * step, and asked for a snapshot when one is due.
 */

import type {
  EntitySnapshot,
  GameMode,
  MapKind,
  PlayerId,
  PlayerStart,
  PlayerTeam,
} from '../net/protocol';
import type { InputCommand } from './input';

/** The inputs that arrived for one step, by seat. A missing seat sent nothing. */
export type StepInputs = ReadonlyMap<PlayerId, InputCommand>;

/**
 * One body brought down, and who by.
 *
 * A world knows a kill happened; only the match knows what it is worth. So the
 * kill is reported rather than counted here, and the credit travels with it: the
 * arrow's owner and team are the only place that information exists, and both
 * are gone the moment the arrow is spent.
 */
export interface Kill {
  victim: PlayerId;
  killer: PlayerId;
  killerTeam: PlayerTeam;
}

export interface World {
  /**
   * Advances one fixed step. `dt` is always the same value for a given match.
   *
   * Returns whatever the step brought down. Returning it rather than leaving it
   * to be collected means a caller cannot forget to look, which would lose the
   * score silently.
   */
  step(dt: number, inputs: StepInputs): readonly Kill[];

  /**
   * Everything a client needs to draw this instant. Positions are rounded to
   * whole pixels by the caller's contract, since a float prints far wider than
   * an integer and the snapshot budget is counted in bytes.
   */
  snapshot(): EntitySnapshot[];

  /**
   * Overwrites state with the server's. Prediction rewinds to the last
   * authoritative snapshot and replays the inputs the server has not yet
   * acknowledged, so a world has to be able to accept a position it did not
   * arrive at itself.
   *
   * Entities absent from the list are left alone: a snapshot describes what the
   * server knows, not what the client may drop.
   */
  restore(entities: readonly EntitySnapshot[]): void;

  /**
   * Takes an entity out of the world for good. A player who disconnects stands
   * idle for a grace window and is then removed, so their body stops being
   * broadcast to everyone still playing.
   */
  remove(id: number): void;
}

/**
 * How a world is built at match start. Keeps construction out of Match.
 *
 * The mode is passed because the rules of engagement differ by it: dynamite is
 * the archer's alone in co-op and everyone's in a duel, and only the world can
 * decide that, because only it knows who is carrying what.
 */
export type WorldFactory = (
  seed: number,
  starts: readonly PlayerStart[],
  mode: GameMode,
  mapKind: MapKind,
) => World;
