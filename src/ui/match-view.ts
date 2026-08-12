/**
 * Draws a running match and sends this client's input.
 *
 * Your own body is predicted, so it answers the keyboard immediately rather
 * than a round trip later. Everyone else is drawn interpolated and slightly in
 * the past, because their inputs are not known here and snapshots only arrive
 * 20 times a second.
 */

import {
  EntityKind,
  PlayerState,
  type EntitySnapshot,
  type GameMode,
  type PlayerStart,
  type Snapshot,
  type WinCondition,
} from '../net/protocol';
import { unpackPlayerState, unpackShotState, ShotFlavourCode } from '../net/entity-state';
import { Terrain, TILE_SIZE } from '../sim/arena-map';
import { noiseFor } from '../sim/noise';
import { StaticTileLayer } from '../render/tiles';
import { drawCharacter } from '../render/characters';
import { drawCrow, drawPickup, drawShot, type ShotFlavour } from '../render/entities';
import { teamColour } from '../render/palette';
import { EffectKind, HitEffects } from './hit-effects';

import { Interpolator } from '../net/interpolation';
import { Predictor } from '../net/prediction';
import { LocalInput, type RawInput } from '../sim/input';
import { ARENA_H, ARENA_W, PLAYER_MAX_HP, PLAYER_RADIUS } from '../sim/arena';
import { DYNAMITE_BLAST_RADIUS, DYNAMITE_CARRIED, carriesDynamite } from '../sim/weapons';
import { MovementWorld } from '../sim/movement-world';
import type { Transport } from '../net/transport';

/** Wire code to the art that draws it. One entry per flavour, and no branch. */
const FLAVOUR_ART: Record<number, ShotFlavour> = {
  [ShotFlavourCode.ARROW]: 'arrow',
  [ShotFlavourCode.BOLT]: 'bolt',
  [ShotFlavourCode.DYNAMITE]: 'dynamite',
};


/**
 * Where the mouse is and whether its button is down, in canvas pixels.
 *
 * The legacy loop owns the pointer as it owns the keyboard, so this arrives per
 * frame rather than being listened for a second time.
 */
export interface AimInput {
  x: number;
  y: number;
  fire: boolean;
  /** Right button held: dynamite, for whoever is carrying it. */
  special: boolean;
}

/** Height of the legacy HUD strip. The sim knows nothing about it. */
const HUD_HEIGHT = 32;

/** Ticks per second, the rate the server counts in. */
const TICK_RATE = 60;

/** Fixed step, matching the server's, or replayed inputs would drift. */
const DT = 1 / TICK_RATE;

/** The same step in milliseconds, which is what a frame is measured in. */
const TICK_MS = 1000 * DT;

/**
 * Longest gap one frame may owe. A tab that was hidden, or a machine that
 * stalled, comes back owing seconds; replaying them would fire off hundreds of
 * inputs at once and throw the body across the arena.
 */
const MAX_FRAME_MS = 100;

/**
 * How far behind the newest snapshot remote bodies are drawn.
 *
 * It has to span two snapshots, plus margin for a late one. At 20 Hz that meant
 * 125 ms; at 30 Hz two snapshots are 67 ms, so 100 ms keeps very nearly the same
 * margin for network lateness while drawing everyone 25 ms closer to now.
 *
 * Lower is more responsive and less forgiving. 90 is fine when everyone is on
 * one continent; going under two snapshot intervals is not, at any latency.
 */
const INTERP_DELAY_MS = 100;

/** Movement keys, matching the legacy arrow-key defaults. */
const MOVE_KEYS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
} as const;

/** Fires as well as the left mouse button, so a keyboard alone can play. */
const FIRE_KEY = ' ';

/** Throws dynamite, as the right mouse button does. */
const DYNAMITE_KEY = 'q';

export interface MatchViewOptions {
  ctx: CanvasRenderingContext2D;
  canvasW: number;
  canvasH: number;
  transport: Transport;
  starts: readonly PlayerStart[];
  you: number;
  /**
   * Which mode is being played. The view says so, because co-op with friendly
   * fire off and no crows yet is a match where an arrow cannot do anything, and
   * that is indistinguishable from a broken game unless the screen explains it.
   */
  mode: GameMode;
  /** What ends the match, so the HUD can show the target or the clock. */
  win: WinCondition;
  /** The map seed, which is how the client builds the same ground the server has. */
  seed: number;
  /** Injected so the interpolation clock is the same one the tests drive. */
  now?: () => number;
}

export class MatchView {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #canvasW: number;
  readonly #canvasH: number;
  readonly #transport: Transport;
  readonly #starts: readonly PlayerStart[];
  readonly #you: number;
  readonly #mode: GameMode;
  readonly #win: WinCondition;
  readonly #now: () => number;
  readonly #input: LocalInput;
  readonly #predictor: Predictor;
  readonly #interpolator: Interpolator;
  #raw: RawInput = blankInput();
  #latest: Snapshot | null = null;
  readonly #tiles: StaticTileLayer;
  /** Walk cycle per body, and where each was last seen, to advance it. */
  readonly #walkPhase = new Map<number, number>();
  readonly #lastSeen = new Map<number, { x: number; y: number }>();
  /** When the last frame ran, so ticks are owed against the clock. */
  #lastFrameAt: number | null = null;
  /** Simulated time owed but not yet stepped, carried between frames. */
  #owedMs = 0;
  readonly #effects = new HitEffects();
  /** Whether this character carries dynamite at all, which the mode decides. */
  readonly #hasDynamite: boolean;

  constructor(options: MatchViewOptions) {
    this.#ctx = options.ctx;
    this.#canvasW = options.canvasW;
    this.#canvasH = options.canvasH;
    this.#transport = options.transport;
    this.#starts = options.starts;
    this.#you = options.you;
    this.#mode = options.mode;
    this.#win = options.win;
    this.#now = options.now ?? (() => performance.now());
    this.#input = new LocalInput(() => this.#raw);
    this.#predictor = new Predictor({
      world: new MovementWorld(options.starts),
      self: options.you,
      dt: DT,
    });
    this.#interpolator = new Interpolator({
      delayMs: INTERP_DELAY_MS,
      // The same tick length the server steps by, so a snapshot's tick lands on
      // the timeline at the moment the server actually simulated it.
      msPerTick: TICK_MS,
    });
    // Built from the seed, not received: four bytes stand in for 693 tiles, and
    // this is the exact grid the server is deciding collisions against.
    const terrain = Terrain.fromSeed(options.seed, noiseFor);
    this.#tiles = new StaticTileLayer(terrain.map, { tileSize: TILE_SIZE, hudHeight: HUD_HEIGHT });
    this.#tiles.repaintAll();
    const mine = options.starts.find((s) => s.id === options.you);
    this.#hasDynamite = carriesDynamite(mine?.character ?? 'archer', options.mode);
  }

  /** The most recent snapshot applied, for the dev hook. */
  get latest(): Snapshot | null {
    return this.#latest;
  }

  /** Inputs predicted but not yet acknowledged, for the dev hook. */
  get pending(): number {
    return this.#predictor.pending();
  }

  /** Where this client draws itself, and where its simulation says it is. */
  get predicted() {
    return { drawn: this.#predictor.self(), settled: this.#predictor.settled() };
  }

  /**
   * Everything remote as it is being drawn this instant, interpolated.
   *
   * The snapshot positions are already readable, and they are not what is on
   * screen. Smoothness is a property of these, so it cannot be measured without
   * them.
   */
  get interpolated() {
    return this.#interpolator.at(this.#now());
  }

  /**
   * How far behind remote bodies are currently drawn. It moves with the
   * connection, so it is the one number that says how jittery this link is.
   */
  get interpDelayMs(): number {
    return this.#interpolator.delayMs();
  }

  /** Takes a snapshot off the wire, correcting the prediction against it. */
  apply(snap: Snapshot): void {
    if (this.#latest && snap.tick <= this.#latest.tick) return;
    this.#latest = snap;
    this.#predictor.reconcile(snap);
    this.#interpolator.push(snap, this.#now());
    // A hit is inferred from health falling between snapshots. The wire carries
    // no cosmetics, so this is where a landed arrow becomes something visible.
    this.#effects.observe(snap, this.#now());
  }

  /**
   * One frame: read the keyboard, send the command, predict with it, then draw.
   *
   * Every frame sends, rather than only when the held buttons change. The
   * predictor replays inputs the server has not acknowledged, so a command that
   * was predicted but never sent would never be acknowledged and would be
   * replayed forever, walking the local body away from the server's.
   */
  frame(keys: Record<string, boolean>, aim: AimInput = blankAim()): void {
    const now = this.#now();
    // The first frame has no previous one to measure against, and a match that
    // has been on a hidden tab must not owe a thousand ticks on its return.
    const elapsed = this.#lastFrameAt === null ? TICK_MS : Math.min(now - this.#lastFrameAt, MAX_FRAME_MS);
    this.#lastFrameAt = now;
    this.#owedMs += elapsed;

    while (this.#owedMs >= TICK_MS) {
      this.#owedMs -= TICK_MS;
      this.#tick(keys, aim);
    }

    this.#draw();
  }

  /**
   * One simulated tick: read the input, send it, and predict with it.
   *
   * This is driven by the clock rather than by the frame, because the step it
   * predicts is a fixed sixtieth of a second. Running it once per rendered
   * frame made the local body move at the monitor's rate — half speed on a
   * struggling tab, more than double on a fast screen — and every snapshot then
   * dragged it back to where the server actually had it.
   */
  #tick(keys: Record<string, boolean>, aim: AimInput): void {
    // A dead player is ignored by the server, so holding a key while waiting to
    // respawn would predict a walk that every snapshot then takes back.
    const dead = this.#ownState() === PlayerState.DEAD;
    this.#raw = {
      up: !dead && !!keys[MOVE_KEYS.up],
      down: !dead && !!keys[MOVE_KEYS.down],
      left: !dead && !!keys[MOVE_KEYS.left],
      right: !dead && !!keys[MOVE_KEYS.right],
      fire: !dead && (aim.fire || !!keys[FIRE_KEY]),
      // Right mouse, or Q for a keyboard alone. Dynamite in a duel; the
      // archer's second weapon in co-op.
      special: !dead && (aim.special || !!keys[DYNAMITE_KEY]),
      snipe: false,
      aimAngle: this.#angleTo(aim),
    };

    const cmd = this.#input.sample();
    try {
      this.#transport.send({ type: 'INPUT', cmd });
      this.#predictor.predict(cmd);
    } catch {
      // A closed socket is the session's business, not every tick's
    }
  }

  /** This client's own entity as the server last described it. */
  #ownEntity(): EntitySnapshot | undefined {
    return this.#latest?.entities.find((e) => e.id === this.#you);
  }

  #ownState(): number {
    return this.#ownEntity()?.state ?? PlayerState.ALIVE;
  }

  /** Angle from your own body to the pointer, in world coordinates. */
  #angleTo(aim: AimInput): number {
    const me = this.#predictor.self();
    if (!me) return 0;
    return Math.atan2(aim.y - HUD_HEIGHT - me.y, aim.x - me.x);
  }

  /**
   * One frame of the arena.
   *
   * The order is the legacy game's: ground, then things lying on it, then
   * things flying over it, then the people. Bodies last so a player is never
   * hidden under an arrow, and your own body last of all.
   */
  #draw(): void {
    const ctx = this.#ctx;
    ctx.fillStyle = '#0A0F0A';
    ctx.fillRect(0, 0, this.#canvasW, this.#canvasH);

    // The map is not on the wire. Both sides built it from the seed, so this is
    // the same ground the server is deciding collisions against.
    this.#tiles.draw(ctx);

    const now = this.#now();
    const loopT = now / 1000;
    const visible = this.#interpolator.at(now);

    for (const e of visible) {
      if (e.kind === EntityKind.PICKUP) this.#drawDrop(e, loopT);
    }
    for (const e of visible) {
      if (e.kind === EntityKind.CROW) this.#drawBird(e, loopT);
    }
    for (const e of visible) {
      if (e.kind === EntityKind.PROJECTILE) this.#drawShotEntity(e, loopT);
    }
    for (const e of visible) {
      if (e.kind === EntityKind.PLAYER && e.id !== this.#you) this.#drawBody(e, loopT);
    }
    for (const e of visible) {
      if (e.kind === EntityKind.BLAST) this.#drawBlast(e);
    }

    // Your own body, predicted, drawn last so it is never hidden. Position is
    // the predicted one, everything else is the server's: prediction covers
    // movement, and inventing your own health would only be taken back.
    const me = this.#predictor.self();
    const own = this.#ownEntity();
    if (me) {
      this.#drawBody(
        { id: this.#you, kind: EntityKind.PLAYER, x: me.x, y: me.y,
          hp: own?.hp ?? PLAYER_MAX_HP, state: own?.state ?? 0 },
        loopT,
      );
    }

    this.#drawEffects();
    this.#drawHud();
  }

  /** A player, in whichever body they picked in the lobby. */
  #drawBody(e: EntitySnapshot, loopT: number): void {
    const start = this.#starts.find((s) => s.id === e.id);
    const visual = unpackPlayerState(e.state);
    const walk = this.#walkPhaseOf(e);
    drawCharacter(
      this.#ctx,
      {
        x: e.x,
        y: e.y,
        character: start?.character ?? 'archer',
        // Right-facing art mirrored by the sign of the aim, which is how the
        // legacy game decides which way a body is turned.
        facing: Math.cos(visual.aim) >= 0 ? 1 : -1,
        aimAngle: visual.aim,
        walkPhase: walk,
        team: (start?.team ?? 0) as 0 | 1,
        shielded: visual.shielded,
        dead: visual.dead,
        swingProgress: visual.swing,
        hitFlash: 0,
      },
      loopT,
      HUD_HEIGHT,
    );
    if (!visual.dead) this.#drawHealthBar(e, e.y + HUD_HEIGHT, teamColour(start?.team ?? 0));
  }

  /**
   * How far through its stride a body is.
   *
   * The wire does not carry it, because it is worth no bytes: a walk cycle can
   * be inferred from the fact that the body moved. Kept per id here, so four
   * players do not march in step.
   */
  #walkPhaseOf(e: EntitySnapshot): number {
    const last = this.#lastSeen.get(e.id);
    const moved = last ? Math.hypot(e.x - last.x, e.y - last.y) : 0;
    const phase = (this.#walkPhase.get(e.id) ?? 0) + moved * 0.12;
    this.#walkPhase.set(e.id, phase);
    this.#lastSeen.set(e.id, { x: e.x, y: e.y });
    return phase;
  }

  #drawShotEntity(e: EntitySnapshot, loopT: number): void {
    const wire = unpackShotState(e.state);
    drawShot(
      this.#ctx,
      { x: e.x, y: e.y, angle: wire.aim, flavour: FLAVOUR_ART[wire.flavour] ?? 'arrow', team: wire.team,
        fuse: wire.fuse },
      loopT,
      HUD_HEIGHT,
    );
  }

  #drawDrop(e: EntitySnapshot, loopT: number): void {
    drawPickup(
      this.#ctx,
      { x: e.x, y: e.y, kind: e.state === 0 ? 'shield' : 'fire' },
      loopT,
      HUD_HEIGHT,
    );
  }

  /**
   * A blast going off: a ring that expands to the real radius and fades.
   *
   * Drawn at the radius the simulation actually uses, so what you see is what
   * caught you. `state` carries how far through it is, in sixteenths.
   */
  #drawBlast(e: EntitySnapshot): void {
    const ctx = this.#ctx;
    const progress = Math.min(1, e.state / 16);
    const y = e.y + HUD_HEIGHT;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = '#FFB400';
    ctx.beginPath();
    ctx.arc(e.x, y, DYNAMITE_BLAST_RADIUS * progress * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FF3B30';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(e.x, y, DYNAMITE_BLAST_RADIUS * progress, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  #drawBird(e: EntitySnapshot, loopT: number): void {
    drawCrow(this.#ctx, { x: e.x, y: e.y, wingPhase: loopT * 12 + e.id }, loopT, HUD_HEIGHT);
  }

  /**
   * Hits and deaths, drawn over the bodies.
   *
   * A ring that expands and fades reads as an impact at a glance, and the number
   * says how much it took. Both are drawn where the snapshot put the body rather
   * than where it is now, because that is where the arrow actually struck.
   */
  #drawEffects(): void {
    const ctx = this.#ctx;
    const now = this.#now();
    for (const { effect, progress } of this.#effects.active(now)) {
      const y = effect.y + HUD_HEIGHT;
      const fade = 1 - progress;
      const death = effect.kind === EffectKind.DEATH;

      ctx.globalAlpha = fade;
      ctx.strokeStyle = death ? '#FF3B30' : '#FFFFFF';
      ctx.lineWidth = death ? 3 : 2;
      ctx.beginPath();
      ctx.arc(effect.x, y, PLAYER_RADIUS + progress * (death ? 34 : 16), 0, Math.PI * 2);
      ctx.stroke();

      if (effect.damage > 0) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px "Courier New", monospace';
        ctx.textAlign = 'center';
        // Rises as it fades, which is what the rest of the game does.
        ctx.fillText(`-${effect.damage}`, effect.x, y - PLAYER_RADIUS - 10 - progress * 14);
      }
      ctx.globalAlpha = 1;
    }

    this.#drawOwnDamageFlash(now);
  }

  /**
   * A red rim when it is you being hit.
   *
   * Your own body is under your cursor and hard to watch while moving, so taking
   * damage needs to be visible at the edge of vision rather than on the body.
   */
  #drawOwnDamageFlash(now: number): void {
    const mine = this.#effects
      .active(now)
      .find(({ effect }) => effect.id === this.#you && effect.damage > 0);
    if (!mine) return;
    const ctx = this.#ctx;
    ctx.globalAlpha = (1 - mine.progress) * 0.5;
    ctx.strokeStyle = '#FF3B30';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, HUD_HEIGHT + 5, ARENA_W - 10, ARENA_H - 10);
    ctx.globalAlpha = 1;
  }

  /**
   * The one line of text the HUD has room for, spent on whatever matters most
   * right now: being dead, then a mode where arrows cannot hurt anyone, then
   * the controls.
   */
  #centreLine(own: EntitySnapshot | undefined): string {
    if (own?.state === PlayerState.DEAD) return 'DOWN  ·  BACK SHORTLY';
    if (this.#mode === 'coop') return 'CO-OP  ·  ARROWS PASS THROUGH ALLIES  ·  NO CROWS YET';
    return 'ARROWS MOVE  ·  CLICK OR SPACE TO SHOOT';
  }

  /** A short bar over the head, only while it means something. */
  #drawHealthBar(e: EntitySnapshot, y: number, fill: string): void {
    if (e.hp >= PLAYER_MAX_HP) return;
    const ctx = this.#ctx;
    const width = PLAYER_RADIUS * 2;
    const top = y - PLAYER_RADIUS - 6;
    ctx.fillStyle = '#2A1A1A';
    ctx.fillRect(e.x - PLAYER_RADIUS, top, width, 2);
    ctx.fillStyle = fill;
    ctx.fillRect(e.x - PLAYER_RADIUS, top, (width * Math.max(0, e.hp)) / PLAYER_MAX_HP, 2);
  }

  #drawHud(): void {
    const ctx = this.#ctx;
    const own = this.#ownEntity();
    ctx.fillStyle = '#39FF14';
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left';
    // Health, shield and sticks left. Without the last two, a player cannot
    // tell whether they are carrying dynamite, and a weapon nobody knows they
    // have is a weapon that does not exist.
    const mine = own ? unpackPlayerState(own.state) : null;
    const left = mine?.dynamite ?? 0;
    const sticks = '■'.repeat(left) + '□'.repeat(Math.max(0, DYNAMITE_CARRIED - left));
    ctx.fillText(
      `HP ${own?.hp ?? PLAYER_MAX_HP}` +
        (mine?.shielded ? '  SHLD' : '') +
        (this.#hasDynamite ? `  DYN ${sticks}` : ''),
      8,
      20,
    );

    ctx.textAlign = 'center';
    ctx.fillText(this.#centreLine(own), this.#canvasW / 2, 20);

    ctx.textAlign = 'right';
    ctx.fillText(this.#scoreLine(), this.#canvasW - 8, 20);
  }

  /**
   * The score, and whichever of the two limits is in force.
   *
   * A frag match shows what it is played to; a timed one counts down, which is
   * derived from the tick rather than a clock of its own so it cannot disagree
   * with the server that will end the match.
   */
  #scoreLine(): string {
    const { a, b } = this.#latest?.scores ?? { a: 0, b: 0 };
    const score = `A ${a} - ${b} B`;
    if (this.#win.kind === 'frags') return `${score}  /${this.#win.target}`;
    const left = Math.max(0, this.#win.minutes * 60 - (this.#latest?.tick ?? 0) / TICK_RATE);
    const mins = Math.floor(left / 60);
    const secs = Math.floor(left % 60);
    return `${score}  ${mins}:${String(secs).padStart(2, '0')}`;
  }
}

function blankInput(): RawInput {
  return {
    up: false, down: false, left: false, right: false,
    fire: false, special: false, snipe: false, aimAngle: 0,
  };
}

function blankAim(): AimInput {
  return { x: 0, y: 0, fire: false, special: false };
}
