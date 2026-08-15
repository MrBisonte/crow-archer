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
import { ARENA_H, ARENA_W, CHARACTER_STATS, PLAYER_RADIUS } from '../sim/arena';
import {
  DYNAMITE_BLAST_RADIUS,
  DYNAMITE_CARRIED,
  DYNAMITE_CHARGE_TICKS,
  SATCHEL_CARRIED,
  secondaryWeapon,
  type Secondary,
} from '../sim/weapons';
import { MovementWorld } from '../sim/movement-world';
import type { Transport } from '../net/transport';

/** Wire code to the art that draws it. One entry per flavour, and no branch. */
const FLAVOUR_ART: Record<number, ShotFlavour> = {
  [ShotFlavourCode.ARROW]: 'arrow',
  [ShotFlavourCode.BOLT]: 'bolt',
  [ShotFlavourCode.DYNAMITE]: 'dynamite',
  [ShotFlavourCode.SATCHEL]: 'satchel',
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

/** How wide the five health pips are together. */
const HEALTH_BAR_WIDTH = 22;

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

/**
 * Movement keys. The legacy arrows, and WASD beside them.
 *
 * Both at once rather than a setting, because there is nothing to choose
 * between: a hand on the arrows and a hand on WASD want the same thing, and
 * having to pick is friction for no gain.
 */
const MOVE_KEYS = {
  up: ['ArrowUp', 'w', 'W'],
  down: ['ArrowDown', 's', 'S'],
  left: ['ArrowLeft', 'a', 'A'],
  right: ['ArrowRight', 'd', 'D'],
} as const;

/** True when any of the keys bound to a direction is down. */
const anyDown = (keys: Record<string, boolean>, bound: readonly string[]): boolean =>
  bound.some((k) => !!keys[k]);

/** Fires as well as the left mouse button, so a keyboard alone can play. */
const FIRE_KEY = ' ';

/**
 * Throws dynamite, as the right mouse button does.
 *
 * F, because that is the key the single-player game charges a throw on, and a
 * player who has played that one will reach for it here.
 */
const DYNAMITE_KEYS = ['f', 'F'] as const;

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
  readonly #terrain: Terrain;
  /** Blasts already applied to the local grid, so each one clears tiles once. */
  readonly #cleared = new Set<number>();
  /** Walk cycle per body, and where each was last seen, to advance it. */
  readonly #walkPhase = new Map<number, number>();
  readonly #lastSeen = new Map<number, { x: number; y: number }>();
  /** When the last frame ran, so ticks are owed against the clock. */
  #lastFrameAt: number | null = null;
  /** Simulated time owed but not yet stepped, carried between frames. */
  #owedMs = 0;
  readonly #effects = new HitEffects();
  /** This character's second weapon, which the mode and the character decide. */
  readonly #secondary: Secondary;
  /** This character's own max health, for the fallback before a snapshot arrives. */
  readonly #ownMaxHp: number;
  /**
   * How far this client's own throw is wound up, 0 to 1.
   *
   * Counted here rather than read off the wire: it is this player's own button,
   * so the answer is already local, and a charge bar that waited a round trip
   * would lag the finger holding it.
   */
  #windUp = 0;

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
    this.#terrain = Terrain.fromSeed(options.seed, noiseFor);
    this.#tiles = new StaticTileLayer(this.#terrain.map, {
      tileSize: TILE_SIZE,
      hudHeight: HUD_HEIGHT,
    });
    this.#tiles.repaintAll();
    const mine = options.starts.find((s) => s.id === options.you);
    this.#secondary = secondaryWeapon(mine?.character ?? 'archer', options.mode);
    this.#ownMaxHp = CHARACTER_STATS[mine?.character ?? 'archer'].maxHp;
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
    this.#applyBlasts(snap);
    this.#applyBurns(snap);
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
      up: !dead && anyDown(keys, MOVE_KEYS.up),
      down: !dead && anyDown(keys, MOVE_KEYS.down),
      left: !dead && anyDown(keys, MOVE_KEYS.left),
      right: !dead && anyDown(keys, MOVE_KEYS.right),
      fire: !dead && (aim.fire || !!keys[FIRE_KEY]),
      // Right mouse, or Q for a keyboard alone. Dynamite in a duel; the
      // archer's second weapon in co-op; the satchel for the ranger.
      // Gated on actually carrying a secondary. A wizard in co-op carries
      // none, and without this the HUD wound a charge up that the server
      // would never throw: the weapon looked loaded and did nothing.
      special:
        !dead && this.#secondary.kind !== 'none' &&
        (aim.special || DYNAMITE_KEYS.some((k) => !!keys[k])),
      snipe: false,
      aimAngle: this.#angleTo(aim),
    };

    // A held throw winds up at the same rate the server counts it, so the bar
    // and the distance agree. Only dynamite has a wind-up: the satchel's
    // click is instant, so this stays at zero for a ranger and the bar never
    // appears.
    this.#windUp = this.#raw.special && this.#secondary.kind === 'dynamite'
      ? Math.min(1, this.#windUp + 1 / DYNAMITE_CHARGE_TICKS)
      : 0;

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
      if (e.kind === EntityKind.BURN) this.#drawBurn(e);
    }

    // Your own body, predicted, drawn last so it is never hidden. Position is
    // the predicted one, everything else is the server's: prediction covers
    // movement, and inventing your own health would only be taken back.
    const me = this.#predictor.self();
    const own = this.#ownEntity();
    if (me) {
      this.#drawBody(
        { id: this.#you, kind: EntityKind.PLAYER, x: me.x, y: me.y,
          hp: own?.hp ?? this.#ownMaxHp, state: own?.state ?? 0 },
        loopT,
      );
    }

    this.#drawEffects();
    this.#drawHud();
  }

  /**
   * Clears the tiles each new blast destroyed.
   *
   * The server mutates its own grid and says nothing about it, because it does
   * not have to: the rule is deterministic and the blast's position is already
   * on the wire, so running the same rule here lands on the same grid. Without
   * this the client kept drawing trees the server had already cleared, and
   * players walked through scenery that was no longer there.
   */
  #applyBlasts(snap: Snapshot): void {
    for (const e of snap.entities) {
      if (e.kind !== EntityKind.BLAST || this.#cleared.has(e.id)) continue;
      this.#cleared.add(e.id);
      this.#terrain.destroyArea(e.x, e.y, DYNAMITE_BLAST_RADIUS);
    }
  }

  /**
   * Chars the tile each new fire hit burned. Same deterministic-replay
   * pattern as #applyBlasts and the same reason: the server mutates its grid
   * and says nothing further, so the client runs the identical one-tile rule
   * itself. Shares #cleared with #applyBlasts — both sets just mean "already
   * replayed", and BURN and BLAST ids are drawn from disjoint ranges.
   */
  #applyBurns(snap: Snapshot): void {
    for (const e of snap.entities) {
      if (e.kind !== EntityKind.BURN || this.#cleared.has(e.id)) continue;
      this.#cleared.add(e.id);
      this.#terrain.burnTile(e.x, e.y);
    }
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
    if (!visual.dead) {
      const maxHp = CHARACTER_STATS[start?.character ?? 'archer'].maxHp;
      this.#drawHealthBar(e, e.y + HUD_HEIGHT, visual.shielded, maxHp);
    }
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
    if (wire.fiery) this.#drawFlame(e, loopT);
    drawShot(
      this.#ctx,
      { x: e.x, y: e.y, angle: wire.aim, flavour: FLAVOUR_ART[wire.flavour] ?? 'arrow', team: wire.team,
        fuse: wire.fuse },
      loopT,
      HUD_HEIGHT,
    );
  }

  /**
   * The flame on a burning shot, drawn under it.
   *
   * Under rather than over, so the shot itself stays the readable part and the
   * fire is what makes it unmistakable at a glance.
   */
  #drawFlame(e: EntitySnapshot, loopT: number): void {
    const ctx = this.#ctx;
    const flicker = 4 + Math.sin(loopT * 24 + e.id) * 1.5;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#FF6600';
    ctx.beginPath();
    ctx.arc(e.x, e.y + HUD_HEIGHT, flicker + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFD400';
    ctx.beginPath();
    ctx.arc(e.x, e.y + HUD_HEIGHT, flicker * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
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
    // Fades out over the whole second, and the fill goes first, so the ring is
    // still readable when the flash has gone.
    ctx.globalAlpha = (1 - progress) * 0.8;
    ctx.fillStyle = '#FFB400';
    ctx.beginPath();
    // The flash only covers the first third; after that it is smoke and a ring.
    ctx.arc(e.x, y, DYNAMITE_BLAST_RADIUS * Math.min(1, progress * 3) * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FF3B30';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(e.x, y, DYNAMITE_BLAST_RADIUS * progress, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * A tile catching fire — one flare-up sized to the tile it hit, not the
   * expanding blast wave #drawBlast draws. `state` is the same sixteenths
   * fade the server already sends for BLAST.
   */
  #drawBurn(e: EntitySnapshot): void {
    const ctx = this.#ctx;
    const progress = Math.min(1, e.state / 16);
    const y = e.y + HUD_HEIGHT;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = '#FF7A1F';
    ctx.beginPath();
    ctx.arc(e.x, y, (TILE_SIZE / 2) * (1 - progress * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFB400';
    ctx.beginPath();
    ctx.arc(e.x, y, (TILE_SIZE / 4) * (1 - progress * 0.4), 0, Math.PI * 2);
    ctx.fill();
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
        // Rises as it fades, which is what the rest of the game does. Rounded
        // for display only: a crossbow bolt's 0.7 damage is real to the
        // simulation, but "-0.7" would read as broken next to every other
        // weapon's whole numbers.
        ctx.fillText(`-${Math.round(effect.damage)}`, effect.x, y - PLAYER_RADIUS - 10 - progress * 14);
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

  /**
   * Health as five pips over the head, one per fifth.
   *
   * Pips rather than a continuous bar, because a fifth is what a hit is worth
   * and counting two left is quicker than judging a length. Amber while the
   * shield is up and green once it is gone, so the one thing that decides
   * whether the next hit costs health is the colour of the thing showing health.
   */
  #drawHealthBar(e: EntitySnapshot, y: number, shielded: boolean, maxHp: number): void {
    const ctx = this.#ctx;
    const pips = 5;
    const gap = 1;
    const pipWidth = (HEALTH_BAR_WIDTH - gap * (pips - 1)) / pips;
    const left = e.x - HEALTH_BAR_WIDTH / 2;
    const top = y - PLAYER_RADIUS - 8;
    // Ceil, so any health at all still lights a pip: a player on one hit point
    // must not look dead.
    const lit = Math.ceil((Math.max(0, e.hp) / maxHp) * pips);
    for (let i = 0; i < pips; i++) {
      ctx.fillStyle = i < lit ? (shielded ? '#FFB400' : '#39FF14') : '#2A2A2A';
      ctx.fillRect(left + i * (pipWidth + gap), top, pipWidth, 3);
    }
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
    const left = mine?.secondaryAmmo ?? 0;
    const carriedMax = this.#secondary.kind === 'satchel' ? SATCHEL_CARRIED : DYNAMITE_CARRIED;
    const rounds = '■'.repeat(left) + '□'.repeat(Math.max(0, carriedMax - left));
    const secondaryLabel = this.#secondary.kind === 'satchel' ? 'SAT' : 'DYN';
    ctx.fillText(
      `HP ${Math.round(own?.hp ?? this.#ownMaxHp)}` +
        (mine?.shielded ? '  SHLD' : '') +
        (this.#secondary.kind !== 'none' ? `  ${secondaryLabel} ${rounds}` : '') +
        (this.#windUp > 0 ? `  CHARGING ${Math.round(this.#windUp * 100)}%` : ''),
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
