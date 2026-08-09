/**
 * Draws a running match and sends this client's input.
 *
 * Your own body is predicted, so it answers the keyboard immediately rather
 * than a round trip later. Everyone else is drawn interpolated and slightly in
 * the past, because their inputs are not known here and snapshots only arrive
 * 20 times a second.
 */

import { EntityKind, type EntitySnapshot, type PlayerStart, type Snapshot } from '../net/protocol';
import { Interpolator } from '../net/interpolation';
import { Predictor } from '../net/prediction';
import { LocalInput, type RawInput } from '../sim/input';
import { ARENA_H, ARENA_W, MovementWorld, PLAYER_RADIUS } from '../sim/movement-world';
import type { Transport } from '../net/transport';

/** Height of the legacy HUD strip. The sim knows nothing about it. */
const HUD_HEIGHT = 32;

/** Fixed step, matching the server's, or replayed inputs would drift. */
const DT = 1 / 60;

/** How far behind the newest snapshot remote bodies are drawn. */
const INTERP_DELAY_MS = 100;

/** Team colours, so two sides read apart at a glance. */
const TEAM_FILL = ['#39FF14', '#39E0FF'] as const;

/** Movement keys, matching the legacy arrow-key defaults. */
const MOVE_KEYS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
} as const;

export interface MatchViewOptions {
  ctx: CanvasRenderingContext2D;
  canvasW: number;
  canvasH: number;
  transport: Transport;
  starts: readonly PlayerStart[];
  you: number;
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
  readonly #now: () => number;
  readonly #input: LocalInput;
  readonly #predictor: Predictor;
  readonly #interpolator: Interpolator;
  #raw: RawInput = blankInput();
  #latest: Snapshot | null = null;

  constructor(options: MatchViewOptions) {
    this.#ctx = options.ctx;
    this.#canvasW = options.canvasW;
    this.#canvasH = options.canvasH;
    this.#transport = options.transport;
    this.#starts = options.starts;
    this.#you = options.you;
    this.#now = options.now ?? (() => performance.now());
    this.#input = new LocalInput(() => this.#raw);
    this.#predictor = new Predictor({
      world: new MovementWorld(options.starts),
      self: options.you,
      dt: DT,
    });
    this.#interpolator = new Interpolator({ delayMs: INTERP_DELAY_MS });
  }

  /** The most recent snapshot applied, for the dev hook. */
  get latest(): Snapshot | null {
    return this.#latest;
  }

  /** Inputs predicted but not yet acknowledged, for the dev hook. */
  get pending(): number {
    return this.#predictor.pending();
  }

  /** Takes a snapshot off the wire, correcting the prediction against it. */
  apply(snap: Snapshot): void {
    if (this.#latest && snap.tick <= this.#latest.tick) return;
    this.#latest = snap;
    this.#predictor.reconcile(snap);
    this.#interpolator.push(snap, this.#now());
  }

  /**
   * One frame: read the keyboard, send the command, predict with it, then draw.
   *
   * Every frame sends, rather than only when the held buttons change. The
   * predictor replays inputs the server has not acknowledged, so a command that
   * was predicted but never sent would never be acknowledged and would be
   * replayed forever, walking the local body away from the server's.
   */
  frame(keys: Record<string, boolean>): void {
    this.#raw = {
      up: !!keys[MOVE_KEYS.up],
      down: !!keys[MOVE_KEYS.down],
      left: !!keys[MOVE_KEYS.left],
      right: !!keys[MOVE_KEYS.right],
      fire: false,
      special: false,
      snipe: false,
      aimAngle: 0,
    };

    const cmd = this.#input.sample();
    try {
      this.#transport.send({ type: 'INPUT', cmd });
      this.#predictor.predict(cmd);
    } catch {
      // A closed socket is the session's business, not every frame's
    }

    this.#draw();
  }

  #draw(): void {
    const ctx = this.#ctx;
    ctx.fillStyle = '#0A0F0A';
    ctx.fillRect(0, 0, this.#canvasW, this.#canvasH);

    ctx.strokeStyle = '#1A2A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, HUD_HEIGHT, ARENA_W, ARENA_H);

    // Everyone else, interpolated and a little behind
    for (const e of this.#interpolator.at(this.#now())) {
      if (e.kind === EntityKind.PLAYER && e.id !== this.#you) this.#drawPlayer(e);
    }

    // Your own body, predicted, drawn last so it is never hidden
    const me = this.#predictor.self();
    if (me) {
      this.#drawPlayer({
        id: this.#you, kind: EntityKind.PLAYER,
        x: me.x, y: me.y, hp: 10, state: 0,
      });
    }

    this.#drawHud();
  }

  #drawPlayer(e: EntitySnapshot): void {
    const ctx = this.#ctx;
    const start = this.#starts.find((s) => s.id === e.id);
    const fill = TEAM_FILL[start?.team ?? 0] ?? TEAM_FILL[0];
    const y = e.y + HUD_HEIGHT;

    ctx.fillStyle = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(e.x, y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Your own body gets a ring, so identical dots stay tellable apart
    if (e.id === this.#you) {
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(e.x, y, PLAYER_RADIUS + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#1a7a08';
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(start?.character ?? '').toUpperCase(), e.x, y - PLAYER_RADIUS - 8);
  }

  #drawHud(): void {
    const ctx = this.#ctx;
    ctx.fillStyle = '#39FF14';
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`TICK ${this.#latest?.tick ?? 0}`, 8, 20);

    ctx.textAlign = 'center';
    ctx.fillText('ARROW KEYS MOVE', this.#canvasW / 2, 20);

    ctx.textAlign = 'right';
    ctx.fillText(`P${this.#you}`, this.#canvasW - 8, 20);
  }
}

function blankInput(): RawInput {
  return {
    up: false, down: false, left: false, right: false,
    fire: false, special: false, snipe: false, aimAngle: 0,
  };
}
