/**
 * Players and arrows: the first world that can be won or lost.
 *
 * The server runs this. The client keeps predicting with MovementWorld, which
 * ignores the fire button, so an arrow is only ever created by the server and a
 * snapshot never has to take a locally invented one back. The cost is that your
 * own arrow appears a round trip after you press the key; the alternative is
 * un-spawning arrows that the server disagreed with, which is a worse thing to
 * watch than a short delay.
 *
 * Friendly fire is off in every mode, so an arrow passes through your own team.
 * In co-op that means arrows hit nothing at all, because everyone is on team A
 * and there are no crows yet. Deathmatch is the mode with a game in it.
 */

import {
  EntityKind,
  PlayerState,
  type EntitySnapshot,
  type PlayerId,
  type PlayerStart,
} from '../net/protocol';
import { canDamage, type Team } from './team';
import { Button, type InputCommand } from './input';
import {
  ARENA_H,
  ARENA_W,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  clampToArena,
  direction,
  insideArena,
} from './arena';
import type { StepInputs, World } from './world';

/** Pixels per second. Fast enough that few arrows are in flight at once. */
export const ARROW_SPEED = 700;

/** Hit points an arrow takes, so a player dies to five of them. */
export const ARROW_DAMAGE = 2;

/** Arrows are small, and a near miss should miss. */
export const ARROW_RADIUS = 3;

/** Ticks between shots. At 60 Hz this is 0.4 seconds. */
export const FIRE_COOLDOWN_TICKS = 24;

/**
 * Ticks an arrow lives before it is culled, whatever it has not hit. This caps
 * how many can be in the air at once, which is what keeps a snapshot inside the
 * 1 KB budget with four players all firing.
 */
export const ARROW_LIFETIME_TICKS = 90;

/** Ticks a dead player waits before returning at their spawn point. */
export const RESPAWN_TICKS = 180;

/**
 * Arrow ids start well above any seat's, so a player and an arrow can never
 * collide in a snapshot keyed by id.
 */
export const FIRST_ARROW_ID = 1000;

interface Body {
  readonly id: PlayerId;
  readonly team: Team;
  readonly spawnX: number;
  readonly spawnY: number;
  x: number;
  y: number;
  hp: number;
  /** Ticks until this player may fire again. */
  cooldown: number;
  /** Ticks until this player respawns, or null while alive. */
  respawnIn: number | null;
}

interface Arrow {
  readonly id: number;
  readonly owner: PlayerId;
  readonly team: Team;
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  /** Ticks left before it is culled. */
  life: number;
}

export class ArenaWorld implements World {
  readonly #bodies: Body[];
  #arrows: Arrow[] = [];
  #nextArrowId = FIRST_ARROW_ID;

  constructor(starts: readonly PlayerStart[]) {
    this.#bodies = starts.map((s) => ({
      id: s.id,
      team: s.team,
      spawnX: s.x,
      spawnY: s.y,
      x: s.x,
      y: s.y,
      hp: PLAYER_MAX_HP,
      cooldown: 0,
      respawnIn: null,
    }));
  }

  step(dt: number, inputs: StepInputs): void {
    for (const body of this.#bodies) {
      this.#countDown(body);
      const cmd = inputs.get(body.id);
      if (!cmd || body.respawnIn !== null) continue;
      this.#move(body, cmd, dt);
      this.#fire(body, cmd);
    }
    this.#advanceArrows(dt);
  }

  remove(id: number): void {
    const i = this.#bodies.findIndex((b) => b.id === id);
    if (i >= 0) this.#bodies.splice(i, 1);
    // Arrows already in the air are left alone. They belong to the world now,
    // not to whoever fired them, and a departing player should not unfire them.
  }

  /**
   * Puts the players back where a snapshot says they are.
   *
   * Arrows are not restored, because nothing predicts them: the only caller is
   * client-side reconciliation, and the client's world is MovementWorld. Should
   * a client ever predict firing, this has to rebuild them too.
   */
  restore(entities: readonly EntitySnapshot[]): void {
    for (const e of entities) {
      if (e.kind !== EntityKind.PLAYER) continue;
      const body = this.#bodies.find((b) => b.id === e.id);
      if (!body) continue;
      body.x = e.x;
      body.y = e.y;
      body.hp = e.hp;
    }
  }

  snapshot(): EntitySnapshot[] {
    const players = this.#bodies.map((b) => ({
      id: b.id,
      kind: EntityKind.PLAYER,
      x: Math.round(b.x),
      y: Math.round(b.y),
      hp: b.hp,
      state: b.respawnIn === null ? PlayerState.ALIVE : PlayerState.DEAD,
    }));
    const arrows = this.#arrows.map((a) => ({
      id: a.id,
      kind: EntityKind.PROJECTILE,
      x: Math.round(a.x),
      y: Math.round(a.y),
      hp: 0,
      state: a.team,
    }));
    return [...players, ...arrows];
  }

  /** Ticks a player's two timers, bringing them back when the second runs out. */
  #countDown(body: Body): void {
    if (body.cooldown > 0) body.cooldown--;
    if (body.respawnIn === null) return;
    body.respawnIn--;
    if (body.respawnIn > 0) return;
    body.respawnIn = null;
    body.hp = PLAYER_MAX_HP;
    body.x = body.spawnX;
    body.y = body.spawnY;
  }

  #move(body: Body, cmd: InputCommand, dt: number): void {
    const { dx, dy } = direction(cmd);
    if (dx === 0 && dy === 0) return;
    body.x = clampToArena(body.x + dx * PLAYER_SPEED * dt, ARENA_W);
    body.y = clampToArena(body.y + dy * PLAYER_SPEED * dt, ARENA_H);
  }

  #fire(body: Body, cmd: InputCommand): void {
    if (!(cmd.buttons & Button.FIRE) || body.cooldown > 0) return;
    body.cooldown = FIRE_COOLDOWN_TICKS;
    const cos = Math.cos(cmd.aimAngle);
    const sin = Math.sin(cmd.aimAngle);
    this.#arrows.push({
      id: this.#nextArrowId++,
      owner: body.id,
      team: body.team,
      // Clear of the shooter's own body, or it would be hit by its own arrow
      // the instant a teammate rule ever allowed it.
      x: body.x + cos * (PLAYER_RADIUS + ARROW_RADIUS + 1),
      y: body.y + sin * (PLAYER_RADIUS + ARROW_RADIUS + 1),
      vx: cos * ARROW_SPEED,
      vy: sin * ARROW_SPEED,
      life: ARROW_LIFETIME_TICKS,
    });
  }

  /** Moves every arrow, resolves what it hit, and drops the spent ones. */
  #advanceArrows(dt: number): void {
    const surviving: Arrow[] = [];
    for (const arrow of this.#arrows) {
      arrow.x += arrow.vx * dt;
      arrow.y += arrow.vy * dt;
      arrow.life--;
      if (arrow.life <= 0 || !insideArena(arrow.x, arrow.y)) continue;
      const hit = this.#victimOf(arrow);
      if (hit) {
        this.#wound(hit);
        continue;
      }
      surviving.push(arrow);
    }
    this.#arrows = surviving;
  }

  /** The first live opponent this arrow overlaps, or null if it hit nobody. */
  #victimOf(arrow: Arrow): Body | null {
    const reach = PLAYER_RADIUS + ARROW_RADIUS;
    for (const body of this.#bodies) {
      if (body.respawnIn !== null) continue;
      // The rule lives in team.ts, which is the only place that decides who may
      // damage whom. Spelling it out here as an equality check meant the same
      // rule existed twice and could disagree with itself.
      if (!canDamage(arrow.team, body.team)) continue;
      const dx = body.x - arrow.x;
      const dy = body.y - arrow.y;
      if (dx * dx + dy * dy <= reach * reach) return body;
    }
    return null;
  }

  #wound(body: Body): void {
    body.hp -= ARROW_DAMAGE;
    if (body.hp > 0) return;
    body.hp = 0;
    body.respawnIn = RESPAWN_TICKS;
  }
}
