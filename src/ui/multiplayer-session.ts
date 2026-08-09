/**
 * Hosts the multiplayer screens inside the legacy game's loop.
 *
 * The legacy monolith owns the canvas, the clock, and the keydown listener, and
 * it keeps owning them here: this session is driven by a call per frame and
 * reads the same `keys` map the rest of the game reads. Nothing starts a second
 * requestAnimationFrame and nothing adds a second listener, because two clocks
 * driving one canvas is the bug that costs an afternoon to find.
 *
 * It owns the socket, so leaving the screen closes it.
 */

import { WsTransport } from '../net/ws-transport';
import { LobbyController } from './lobby-controller';

/** Where the lobby server lives when the page does not say otherwise. */
const DEFAULT_SERVER = 'ws://127.0.0.1:8082';

/** Remembered display name. Per-profile naming is a later phase. */
const NAME_KEY = 'crowArcher.playerName';

/** How the session is getting on, for the screen to report. */
export type SessionPhase = 'connecting' | 'live' | 'failed';

export class MultiplayerSession {
  readonly #canvas: HTMLCanvasElement;
  #transport: WsTransport | null = null;
  #controller: LobbyController | null = null;
  #phase: SessionPhase = 'connecting';
  #failure = '';
  /** Keys held on the previous frame, so a hold is not read as a new press. */
  #wasDown = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  get phase(): SessionPhase {
    return this.#phase;
  }

  get failure(): string {
    return this.#failure;
  }

  /** The match this session was told to start, or null while still in a lobby. */
  matchStart() {
    return this.#controller?.matchStart() ?? null;
  }

  /**
   * A flat summary for the dev hook, so a headless check can read the screen
   * without scraping the canvas.
   */
  describe() {
    const lobby = this.#controller?.state;
    return {
      phase: this.#phase,
      failure: this.#failure,
      screen: lobby?.screen ?? null,
      code: lobby?.roomCode ?? null,
      slot: lobby?.userSlot ?? null,
      character: lobby?.userCharacter ?? null,
      readiness: lobby?.userReadiness ?? null,
      mode: lobby?.roomView?.mode ?? null,
      players: lobby?.roomView?.slots.length ?? 0,
      error: lobby?.error ?? null,
      match: this.matchStart(),
    };
  }

  /** Opens the socket. Safe to call once per entry to the screen. */
  async open(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const url = params.get('server') ?? DEFAULT_SERVER;
    const name =
      params.get('name') ?? localStorage.getItem(NAME_KEY) ?? 'PLAYER';
    localStorage.setItem(NAME_KEY, name);

    const transport = new WsTransport({ url, name });
    this.#transport = transport;
    this.#controller = new LobbyController({ transport, canvas: this.#canvas });

    try {
      await transport.connect();
      this.#phase = 'live';
    } catch (err) {
      this.#phase = 'failed';
      this.#failure = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * One frame: turn newly-pressed keys into lobby actions, then let the
   * controller poll the socket and draw.
   *
   * Input is read here rather than in the fixed-step update because a lobby is
   * not a simulation. It reacts to discrete presses, so exactly one poll per
   * displayed frame is the right rate and cannot drop or double a keystroke the
   * way an accumulator running zero or two steps would.
   */
  frame(keys: Record<string, boolean>): void {
    if (this.#phase === 'failed') {
      this.#drawFailure();
      return;
    }
    // Keys are dropped until the socket is live. Forwarding them earlier meant
    // a keypress during the handshake threw inside send() and was swallowed,
    // leaving the screen claiming a room the server had never heard of.
    if (this.#phase === 'connecting') {
      this.#drawConnecting();
      return;
    }
    if (!this.#controller) return;

    for (const key of Object.keys(keys)) {
      if (!keys[key]) { this.#wasDown.delete(key); continue; }
      if (this.#wasDown.has(key)) continue;      // still held from last frame
      this.#wasDown.add(key);
      this.#controller.handleKey(key);
    }

    this.#controller.frame();
  }

  /** Closes the socket. Called when the screen is left, however it is left. */
  close(): void {
    this.#transport?.close();
    this.#transport = null;
    this.#controller = null;
    this.#wasDown.clear();
  }

  /** Clears to the void colour and returns the centre, for the plain screens. */
  #blank(): { ctx: CanvasRenderingContext2D; cx: number; cy: number } | null {
    const ctx = this.#canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#0A0F0A';
    ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
    ctx.textAlign = 'center';
    return { ctx, cx: this.#canvas.width / 2, cy: this.#canvas.height / 2 };
  }

  #drawConnecting(): void {
    const s = this.#blank();
    if (!s) return;
    s.ctx.fillStyle = '#39FF14';
    s.ctx.font = '20px "Courier New", monospace';
    s.ctx.fillText('CONTACTING SERVER', s.cx, s.cy);
    s.ctx.fillStyle = '#1a7a08';
    s.ctx.font = '12px "Courier New", monospace';
    s.ctx.fillText('[ESC]  BACK', s.cx, s.cy + 40);
  }

  #drawFailure(): void {
    const s = this.#blank();
    if (!s) return;
    const { ctx, cx, cy } = s;

    ctx.fillStyle = '#FF1F1F';
    ctx.font = '24px "Courier New", monospace';
    ctx.fillText('NO SERVER', cx, cy - 40);

    ctx.fillStyle = '#1a7a08';
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText('START ONE WITH  npm run server', cx, cy);
    ctx.fillText(this.#failure.toUpperCase().slice(0, 60), cx, cy + 22);
    ctx.fillText('[ESC]  BACK', cx, cy + 60);
  }
}
