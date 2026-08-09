/**
 * Draws a running match from server snapshots, and sends this client's input.
 *
 * There is no prediction here yet. Every player, including your own, is drawn
 * where the last snapshot put them, so movement lags by the round trip. That is
 * the honest starting point: prediction is a later slice, and adding it before
 * the plain path is proven would hide whether the plain path works.
 */

import { EntityKind, type EntitySnapshot, type PlayerStart, type Snapshot } from '../net/protocol';
import { LocalInput, type RawInput } from '../sim/input';
import { ARENA_H, ARENA_W, PLAYER_RADIUS } from '../sim/movement-world';
import type { Transport } from '../net/transport';

/** Height of the legacy HUD strip. The sim knows nothing about it. */
const HUD_HEIGHT = 32;

/** Team colours, so two sides read apart at a glance. */
const TEAM_FILL = ['#39FF14', '#39E0FF'] as const;

/** Which keys drive movement. Matches the legacy arrow-key defaults. */
const MOVE_KEYS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
} as const;

export class MatchView {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #canvasW: number;
  readonly #canvasH: number;
  readonly #transport: Transport;
  readonly #starts: readonly PlayerStart[];
  readonly #you: number;
  readonly #input: LocalInput;
  #raw: RawInput = blankInput();
  #latest: Snapshot | null = null;
  /** Last command sent, so a held direction is not re-sent every frame. */
  #lastSentButtons = -1;

  constructor(options: {
    ctx: CanvasRenderingContext2D;
    canvasW: number;
    canvasH: number;
    transport: Transport;
    starts: readonly PlayerStart[];
    you: number;
  }) {
    this.#ctx = options.ctx;
    this.#canvasW = options.canvasW;
    this.#canvasH = options.canvasH;
    this.#transport = options.transport;
    this.#starts = options.starts;
    this.#you = options.you;
    this.#input = new LocalInput(() => this.#raw);
  }

  /** The most recent snapshot applied, for the dev hook. */
  get latest(): Snapshot | null {
    return this.#latest;
  }

  /** Takes a snapshot off the wire. The newest one wins; older ones are stale. */
  apply(snap: Snapshot): void {
    if (this.#latest && snap.tick <= this.#latest.tick) return;
    this.#latest = snap;
  }

  /**
   * One frame: read the keyboard, send a command if it changed, then draw.
   *
   * A command goes out only when the held buttons change, not every frame. The
   * server holds the last command until a newer one arrives, so re-sending an
   * unchanged direction 60 times a second would be pure traffic.
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
    if (cmd.buttons !== this.#lastSentButtons) {
      this.#lastSentButtons = cmd.buttons;
      try {
        this.#transport.send({ type: 'INPUT', cmd });
      } catch {
        // A closed socket is reported by the session, not by every frame
      }
    }

    this.#draw();
  }

  #draw(): void {
    const ctx = this.#ctx;
    ctx.fillStyle = '#0A0F0A';
    ctx.fillRect(0, 0, this.#canvasW, this.#canvasH);

    this.#drawArena();
    for (const e of this.#latest?.entities ?? []) {
      if (e.kind === EntityKind.PLAYER) this.#drawPlayer(e);
    }
    this.#drawHud();
  }

  #drawArena(): void {
    const ctx = this.#ctx;
    ctx.strokeStyle = '#1A2A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, HUD_HEIGHT, ARENA_W, ARENA_H);
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

    // Your own body gets a ring, so four identical dots stay tellable apart
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
    ctx.fillText(
      String(start?.character ?? '').toUpperCase(),
      e.x,
      y - PLAYER_RADIUS - 8,
    );
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
