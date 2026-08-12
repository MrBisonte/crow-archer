/**
 * The match simulation: three characters, their weapons, terrain, and the crow
 * that wanders through it.
 *
 * This is what MovementWorld and ArenaWorld were proving the way towards. It
 * owns nothing but state and arithmetic — no canvas, no audio, no clock — so
 * the server runs it authoritatively and the tests run it a thousand ticks at a
 * time without waiting.
 *
 * Everything that varies by character lives behind a weapon strategy, so the
 * step below reads the same whoever is playing. Everything that varies by
 * terrain is a question asked of Terrain. What is left here is the part that is
 * genuinely about a fight: who hit whom, who is still standing, and when.
 */

import {
  EntityKind,
  type CharacterKind,
  type EntitySnapshot,
  type GameMode,
  type PlayerId,
  type PlayerStart,
  type PlayerTeam,
} from '../net/protocol';
import { ShotFlavourCode, packPlayerState, packShotState } from '../net/entity-state';
import { ARENA_H, ARENA_W, PLAYER_MAX_HP, PLAYER_RADIUS, PLAYER_SPEED, direction } from './arena';
import { Terrain, type NoiseFactory } from './arena-map';
import { slide } from './collide';
import { advanceCrow, spawnCrow, CROW_HIT_RADIUS, CROW_INTERVAL_TICKS, MAX_CROWS, type Crow } from './crows';
import { Button, type InputCommand } from './input';
import { DROPPED_KINDS, PICKUP_RADIUS, applyPickup, type PickupKind } from './pickups';
import { mulberry32, type Rng } from './rng';
import { canDamage } from './team';
import { ticks } from './tick';
import {
  DYNAMITE_BLAST_RADIUS,
  DYNAMITE_CARRIED,
  DynamitePouch,
  carriesDynamite,
  primaryWeapon,
  type ShotSpec,
  type SwingSpec,
  type Weapon,
} from './weapons';
import type { Kill, StepInputs, World } from './world';

/**
 * Ticks of immunity after any hit. `playerHitFlashSecs: 0.3` in the legacy
 * CONFIG, where it gates both losing health and spending the shield.
 *
 * It matters more here than it ever did there. Without it, two archers standing
 * close would delete each other in a single volley, and a swing that lands on
 * consecutive ticks would count as five hits rather than one.
 */
const IFRAME_TICKS = ticks(0.3);

/** Ticks a dead player waits before returning at their spawn. */
export const RESPAWN_TICKS = ticks(3);

/** Ids at or above this are not players, so nothing collides in a snapshot. */
const FIRST_SHOT_ID = 1000;
const FIRST_PICKUP_ID = 5000;
const FIRST_CROW_ID = 8000;
const FIRST_BLAST_ID = 9000;

/**
 * How long a blast stays in the snapshot.
 *
 * Long enough to survive the interpolation delay and be drawn, short enough
 * that it is gone before the next one. Without this a stick of dynamite simply
 * disappeared, which looked exactly like a dud.
 */
const BLAST_TICKS = ticks(0.35);

/** Bodies and shots are circles; this is how they are compared. */
const withinRadius = (ax: number, ay: number, bx: number, by: number, r: number): boolean => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= r * r;
};

interface Fighter {
  readonly id: PlayerId;
  readonly team: PlayerTeam;
  readonly character: CharacterKind;
  readonly weapon: Weapon;
  readonly dynamite: DynamitePouch | null;
  readonly spawnX: number;
  readonly spawnY: number;
  x: number;
  y: number;
  hp: number;
  aim: number;
  shielded: boolean;
  fireTicks: number;
  cooldown: number;
  dynamiteCooldown: number;
  dynamiteLeft: number;
  invulnerable: number;
  respawnIn: number | null;
  /** Ticks left in the current swing, and what it is. Null when not swinging. */
  swing: { left: number; spec: SwingSpec; struckPhaseOne: boolean; struckPhaseTwo: boolean } | null;
}

interface Shot {
  id: number;
  owner: PlayerId;
  team: PlayerTeam;
  spec: ShotSpec;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
}

interface GroundPickup {
  id: number;
  x: number;
  y: number;
  kind: PickupKind;
}

export interface BattleWorldOptions {
  seed: number;
  starts: readonly PlayerStart[];
  mode: GameMode;
  noise: NoiseFactory;
  /**
   * Terrain to fight on, instead of the one the seed describes.
   *
   * Injected for the same reason the server injects its world factory: a test
   * about who hit whom should not also be a test of where the generator put a
   * rock. Production never passes it.
   */
  terrain?: Terrain;
}

export class BattleWorld implements World {
  readonly terrain: Terrain;
  readonly #mode: GameMode;
  readonly #fighters: Fighter[];
  readonly #rng: Rng;
  #shots: Shot[] = [];
  #pickups: GroundPickup[] = [];
  #crows: Crow[] = [];
  /** Blasts still worth drawing, with the ticks each has left. */
  #blasts: { id: number; x: number; y: number; left: number }[] = [];
  #nextShotId = FIRST_SHOT_ID;
  #nextPickupId = FIRST_PICKUP_ID;
  #nextCrowId = FIRST_CROW_ID;
  #nextBlastId = FIRST_BLAST_ID;
  #tick = 0;
  #crowTimer = CROW_INTERVAL_TICKS;

  constructor(options: BattleWorldOptions) {
    this.#mode = options.mode;
    this.terrain = options.terrain ?? Terrain.fromSeed(options.seed, options.noise);
    // A second stream, offset from the map's, so terrain and crows do not
    // march in step on every match played from the same seed.
    this.#rng = mulberry32(options.seed ^ 0x9e3779b9);

    // Spawns arrive in `starts` rather than being chosen here. The lobby picks
    // them from the same seed and sends them in MATCH_START, so the client's
    // prediction begins where the server actually put the body. Deciding again
    // here would be a second opinion, and the two would disagree.
    this.#fighters = options.starts.map((start) => {
      const at = { x: start.x, y: start.y };
      return {
        id: start.id,
        team: start.team,
        character: start.character,
        weapon: primaryWeapon(start.character),
        dynamite: carriesDynamite(start.character, options.mode) ? new DynamitePouch() : null,
        spawnX: at.x,
        spawnY: at.y,
        x: at.x,
        y: at.y,
        hp: PLAYER_MAX_HP,
        aim: 0,
        // Everyone starts behind a shield, so the first exchange of a match is
        // a trade rather than an execution.
        shielded: true,
        fireTicks: 0,
        cooldown: 0,
        dynamiteCooldown: 0,
        dynamiteLeft: DYNAMITE_CARRIED,
        invulnerable: 0,
        respawnIn: null,
        swing: null,
      };
    });
  }

  step(dt: number, inputs: StepInputs): readonly Kill[] {
    this.#tick++;
    const kills: Kill[] = [];
    for (const f of this.#fighters) {
      this.#countDown(f);
      const cmd = inputs.get(f.id);
      if (cmd) f.aim = cmd.aimAngle;
      if (f.respawnIn !== null) continue;
      if (cmd) {
        this.#move(f, cmd, dt);
        this.#act(f, cmd);
      }
      this.#resolveSwing(f, kills);
    }
    this.#advanceShots(dt, kills);
    this.#advanceCrows(dt);
    this.#collectPickups();
    this.#blasts = this.#blasts.filter((b) => --b.left > 0);
    return kills;
  }

  remove(id: number): void {
    const i = this.#fighters.findIndex((f) => f.id === id);
    if (i >= 0) this.#fighters.splice(i, 1);
  }

  /** Prediction only ever asks about players, so only players are restored. */
  restore(entities: readonly EntitySnapshot[]): void {
    for (const e of entities) {
      if (e.kind !== EntityKind.PLAYER) continue;
      const f = this.#fighters.find((b) => b.id === e.id);
      if (!f) continue;
      f.x = e.x;
      f.y = e.y;
      f.hp = e.hp;
    }
  }

  snapshot(): EntitySnapshot[] {
    return [
      ...this.#fighters.map((f) => ({
        id: f.id,
        kind: EntityKind.PLAYER,
        x: Math.round(f.x),
        y: Math.round(f.y),
        hp: Math.max(0, f.hp),
        state: packPlayerState({
          dead: f.respawnIn !== null,
          shielded: f.shielded,
          aim: f.aim,
          swing: f.swing ? 1 - f.swing.left / f.swing.spec.durationTicks : 0,
          dynamite: f.dynamite ? f.dynamiteLeft : 0,
        }),
      })),
      ...this.#shots.map((s) => ({
        id: s.id,
        kind: EntityKind.PROJECTILE,
        x: Math.round(s.x),
        y: Math.round(s.y),
        hp: 0,
        state: packShotState({
          team: s.team as 0 | 1,
          flavour: FLAVOUR_CODES[s.spec.flavour],
          aim: Math.atan2(s.vy, s.vx),
          fuse: s.spec.flavour === 'dynamite' ? 1 - s.life / s.spec.lifeTicks : 0,
        }),
      })),
      ...this.#pickups.map((p) => ({
        id: p.id,
        kind: EntityKind.PICKUP,
        x: Math.round(p.x),
        y: Math.round(p.y),
        hp: 0,
        state: p.kind === 'shield' ? 0 : 1,
      })),
      ...this.#blasts.map((b) => ({
        id: b.id,
        kind: EntityKind.BLAST,
        x: Math.round(b.x),
        y: Math.round(b.y),
        hp: 0,
        // How far through it is, in sixteenths, so the ring can expand.
        state: Math.min(15, Math.floor((1 - b.left / BLAST_TICKS) * 16)),
      })),
      ...this.#crows.map((c) => ({
        id: c.id,
        kind: EntityKind.CROW,
        x: Math.round(c.x),
        y: Math.round(c.y),
        hp: 1,
        state: 0,
      })),
    ];
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  /** Every per-tick timer a fighter carries, and the return that ends the last. */
  #countDown(f: Fighter): void {
    if (f.cooldown > 0) f.cooldown--;
    if (f.dynamiteCooldown > 0) f.dynamiteCooldown--;
    if (f.invulnerable > 0) f.invulnerable--;
    if (f.fireTicks > 0) f.fireTicks--;
    if (f.swing && --f.swing.left <= 0) f.swing = null;
    if (f.respawnIn === null) return;
    if (--f.respawnIn > 0) return;
    f.respawnIn = null;
    f.hp = PLAYER_MAX_HP;
    f.x = f.spawnX;
    f.y = f.spawnY;
    // The shield comes back with the body. Without it the first death would
    // hand the killer a permanent advantage for the rest of the match.
    f.shielded = true;
    f.invulnerable = IFRAME_TICKS;
  }

  #move(f: Fighter, cmd: InputCommand, dt: number): void {
    const { dx, dy } = direction(cmd);
    if (dx === 0 && dy === 0) return;
    const moved = slide(
      this.terrain,
      f.x,
      f.y,
      dx * PLAYER_SPEED * dt,
      dy * PLAYER_SPEED * dt,
      PLAYER_RADIUS,
    );
    f.x = Math.min(Math.max(moved.x, PLAYER_RADIUS), ARENA_W - PLAYER_RADIUS);
    f.y = Math.min(Math.max(moved.y, PLAYER_RADIUS), ARENA_H - PLAYER_RADIUS);
  }

  /** Turns held buttons into whatever the held weapon makes of them. */
  #act(f: Fighter, cmd: InputCommand): void {
    if (cmd.buttons & Button.FIRE && f.cooldown <= 0) {
      f.cooldown = f.weapon.cooldownTicks;
      this.#apply(f, f.weapon.use());
    }
    const pouch = f.dynamite;
    if (cmd.buttons & Button.SPECIAL && pouch && f.dynamiteCooldown <= 0 && f.dynamiteLeft > 0) {
      f.dynamiteCooldown = pouch.cooldownTicks;
      f.dynamiteLeft--;
      this.#apply(f, pouch.use());
    }
  }

  /** A weapon said what it made; this is where it becomes part of the world. */
  #apply(f: Fighter, effects: ReturnType<Weapon['use']>): void {
    for (const effect of effects) {
      if (effect.kind === 'swing') {
        f.swing = {
          left: effect.swing.durationTicks,
          spec: effect.swing,
          struckPhaseOne: false,
          struckPhaseTwo: false,
        };
        continue;
      }
      const spec = effect.shot;
      const cos = Math.cos(f.aim);
      const sin = Math.sin(f.aim);
      // Clear of the thrower, so nothing is hit before it has left the hand.
      // Unless that puts it inside a wall: someone with their back to rock
      // would otherwise fire shot after shot that died on the tick it was made,
      // with nothing on screen to say why.
      const reach = PLAYER_RADIUS + spec.radius + 1;
      const muzzleX = f.x + cos * reach;
      const muzzleY = f.y + sin * reach;
      const clear = !this.terrain.blocksShot(muzzleX, muzzleY);
      this.#shots.push({
        id: this.#nextShotId++,
        owner: f.id,
        team: f.team,
        spec,
        x: clear ? muzzleX : f.x,
        y: clear ? muzzleY : f.y,
        vx: cos * spec.speed,
        vy: sin * spec.speed,
        life: spec.lifeTicks,
        damage: this.#damageOf(f, spec.damage),
      });
    }
  }

  /** Fire doubles what anything does, for as long as it burns. */
  #damageOf(f: Fighter, base: number): number {
    return f.fireTicks > 0 ? base * 2 : base;
  }

  // -------------------------------------------------------------------------
  // Melee
  // -------------------------------------------------------------------------

  /**
   * The spear, sampled where its tip and its midpoint are this tick.
   *
   * Two probe circles along the aim ray rather than a swept arc, which is what
   * the legacy game does and what makes the reach feel like a thrust rather
   * than a sweep. Each half of the swing may land once, so a full swing is two
   * strikes and holding the button is not a blender.
   */
  #resolveSwing(f: Fighter, kills: Kill[]): void {
    const swing = f.swing;
    if (!swing) return;
    const progress = 1 - swing.left / swing.spec.durationTicks;
    const phaseTwo = progress >= 0.5;
    if (phaseTwo ? swing.struckPhaseTwo : swing.struckPhaseOne) return;

    const reach = swing.spec.reach + Math.sin(Math.min(progress, 1) * Math.PI) * swing.spec.thrust;
    const cos = Math.cos(f.aim);
    const sin = Math.sin(f.aim);
    const probes = [
      { x: f.x + cos * reach, y: f.y + sin * reach },
      { x: f.x + cos * reach * 0.6, y: f.y + sin * reach * 0.6 },
    ];

    for (const probe of probes) {
      if (this.#strikeAt(f, probe, swing.spec, kills)) {
        if (phaseTwo) swing.struckPhaseTwo = true;
        else swing.struckPhaseOne = true;
        return;
      }
    }
  }

  /** One probe circle against everything it could be touching. */
  #strikeAt(f: Fighter, probe: { x: number; y: number }, spec: SwingSpec, kills: Kill[]): boolean {
    for (const target of this.#fighters) {
      if (target.respawnIn !== null || !canDamage(f.team, target.team)) continue;
      if (!withinRadius(probe.x, probe.y, target.x, target.y, spec.radius + PLAYER_RADIUS)) continue;
      if (this.#wound(target, this.#damageOf(f, spec.damage))) {
        kills.push({ victim: target.id, killer: f.id, killerTeam: f.team });
      }
      return true;
    }
    return this.#killCrowNear(probe.x, probe.y, spec.radius);
  }

  // -------------------------------------------------------------------------
  // Projectiles
  // -------------------------------------------------------------------------

  #advanceShots(dt: number, kills: Kill[]): void {
    const surviving: Shot[] = [];
    for (const shot of this.#shots) {
      this.#steer(shot, dt);
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life--;

      if (shot.life <= 0) {
        // A fuse running out is the point of dynamite, not the end of it.
        if (shot.spec.flavour === 'dynamite') this.#explode(shot, kills);
        continue;
      }
      if (this.terrain.blocksShot(shot.x, shot.y)) {
        if (shot.spec.flavour === 'dynamite') this.#explode(shot, kills);
        continue;
      }
      if (this.#hitSomething(shot, kills)) continue;
      surviving.push(shot);
    }
    this.#shots = surviving;
  }

  /** Homing, for the weapons that have it. Turns towards the nearest enemy. */
  #steer(shot: Shot, dt: number): void {
    if (shot.spec.homingRate <= 0) return;
    const target = this.#nearestEnemy(shot);
    if (!target) return;
    const want = Math.atan2(target.y - shot.y, target.x - shot.x);
    const have = Math.atan2(shot.vy, shot.vx);
    let delta = ((want - have + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const most = shot.spec.homingRate * dt;
    delta = Math.min(most, Math.max(-most, delta));
    const angle = have + delta;
    shot.vx = Math.cos(angle) * shot.spec.speed;
    shot.vy = Math.sin(angle) * shot.spec.speed;
  }

  #nearestEnemy(shot: Shot): Fighter | null {
    let best: Fighter | null = null;
    let bestDist = Infinity;
    for (const f of this.#fighters) {
      if (f.respawnIn !== null || !canDamage(shot.team, f.team)) continue;
      const d = (f.x - shot.x) ** 2 + (f.y - shot.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
    return best;
  }

  /** True when the shot is spent, whether on a body, a bird, or a blast. */
  #hitSomething(shot: Shot, kills: Kill[]): boolean {
    for (const target of this.#fighters) {
      if (target.respawnIn !== null || !canDamage(shot.team, target.team)) continue;
      if (!withinRadius(shot.x, shot.y, target.x, target.y, shot.spec.radius + PLAYER_RADIUS)) {
        continue;
      }
      if (shot.spec.flavour === 'dynamite') {
        this.#explode(shot, kills);
        return true;
      }
      if (this.#wound(target, shot.damage)) {
        kills.push({ victim: target.id, killer: shot.owner, killerTeam: shot.team });
      }
      return true;
    }
    return this.#killCrowNear(shot.x, shot.y, CROW_HIT_RADIUS);
  }

  /**
   * A stick of dynamite going off.
   *
   * Friendly fire stays off, which also means it never catches the thrower.
   * That is generous, and the alternative is a weapon nobody dares use in a
   * corridor.
   */
  #explode(shot: Shot, kills: Kill[]): void {
    // Recorded before anything is resolved, so a blast that hits nothing is
    // still seen. A weapon you cannot see go off is a weapon nobody trusts.
    this.#blasts.push({ id: this.#nextBlastId++, x: shot.x, y: shot.y, left: BLAST_TICKS });
    for (const target of this.#fighters) {
      if (target.respawnIn !== null || !canDamage(shot.team, target.team)) continue;
      if (!withinRadius(shot.x, shot.y, target.x, target.y, DYNAMITE_BLAST_RADIUS)) continue;
      if (this.#wound(target, shot.damage)) {
        kills.push({ victim: target.id, killer: shot.owner, killerTeam: shot.team });
      }
    }
    this.#crows = this.#crows.filter((c) => {
      if (!withinRadius(shot.x, shot.y, c.x, c.y, DYNAMITE_BLAST_RADIUS)) return true;
      this.#dropFrom(c);
      return false;
    });
    this.terrain.burn(shot.x, shot.y);
  }

  // -------------------------------------------------------------------------
  // Damage
  // -------------------------------------------------------------------------

  /**
   * Applies damage, and reports whether it was fatal.
   *
   * The order matters and is the legacy order: immunity first, then the shield,
   * then health. A shield spent during immunity would be free to strip, and
   * health lost during immunity would make the shield pointless.
   */
  #wound(target: Fighter, amount: number): boolean {
    if (target.invulnerable > 0) return false;
    target.invulnerable = IFRAME_TICKS;
    if (target.shielded) {
      target.shielded = false;
      return false;
    }
    target.hp -= amount;
    if (target.hp > 0) return false;
    target.hp = 0;
    target.respawnIn = RESPAWN_TICKS;
    target.swing = null;
    return true;
  }

  // -------------------------------------------------------------------------
  // Crows and what they leave
  // -------------------------------------------------------------------------

  #advanceCrows(dt: number): void {
    if (--this.#crowTimer <= 0) {
      this.#crowTimer = CROW_INTERVAL_TICKS;
      if (this.#crows.length < MAX_CROWS) {
        this.#crows.push(spawnCrow(this.#nextCrowId++, this.#rng));
      }
    }
    const seconds = this.#tick / (1 / dt);
    this.#crows = this.#crows.filter((c) => advanceCrow(c, dt, seconds));
  }

  /** Kills the first crow within reach of a point. True if one died. */
  #killCrowNear(x: number, y: number, radius: number): boolean {
    const i = this.#crows.findIndex((c) => withinRadius(x, y, c.x, c.y, radius));
    if (i < 0) return false;
    this.#dropFrom(this.#crows[i]!);
    this.#crows.splice(i, 1);
    return true;
  }

  /**
   * A dead crow always leaves something.
   *
   * The single-player game drops on a quarter of kills with a pity timer, which
   * is right when crows arrive every few seconds. Here one turns up every
   * fifteen, so a bird that dropped nothing would be a waste of the only
   * interesting thing to happen that minute.
   */
  #dropFrom(crow: Crow): void {
    const kind = DROPPED_KINDS[Math.floor(this.#rng() * DROPPED_KINDS.length)] ?? 'shield';
    this.#pickups.push({ id: this.#nextPickupId++, x: crow.x, y: crow.y, kind });
  }

  #collectPickups(): void {
    this.#pickups = this.#pickups.filter((p) => {
      const taker = this.#fighters.find(
        (f) => f.respawnIn === null && withinRadius(p.x, p.y, f.x, f.y, PICKUP_RADIUS),
      );
      if (!taker) return true;
      applyPickup(p.kind, taker);
      return false;
    });
  }

  /** The mode this world is playing, which decides who may carry dynamite. */
  get mode(): GameMode {
    return this.#mode;
  }
}

/** Wire codes for each projectile look. One entry per flavour, no branch. */
const FLAVOUR_CODES = {
  arrow: ShotFlavourCode.ARROW,
  bolt: ShotFlavourCode.BOLT,
  dynamite: ShotFlavourCode.DYNAMITE,
} as const;
