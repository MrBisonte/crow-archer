/**
 * Drives the lobby UI. Thin glue between Transport, state machine, input, and
 * rendering. No business logic lives here — all of that is in lobby-state.ts
 * (pure) and the Transport.
 */

import { Team } from '../sim/team';
import type {
  CharacterKind,
  GameMode,
  MatchResult,
  PlayerStart,
  ServerMessage,
  Snapshot,
  WinCondition,
} from '../net/protocol';
import type { Transport } from '../net/transport';
import {
  initialLobbyState,
  transitionLobby,
  type LobbyState,
} from './lobby-state';

export class LobbyController {
  #transport: Transport;
  #state: LobbyState;
  #ctx: CanvasRenderingContext2D;
  #canvasW: number;
  #canvasH: number;
  #codeBuffer: string = '';  // for host_join screen text input

  constructor(options: {
    transport: Transport;
    canvas: HTMLCanvasElement;
  }) {
    this.#transport = options.transport;
    this.#state = initialLobbyState();
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.#ctx = ctx;
    this.#canvasW = options.canvas.width;
    this.#canvasH = options.canvas.height;
  }

  /** Polls the socket and draws. The lobby's own frame, when it owns the screen. */
  frame(): void {
    this.poll();
    this.#render();
  }

  /**
   * Drains the socket without drawing. Once a match is running the view owns
   * the canvas, but snapshots still arrive here, so polling has to continue
   * independently of rendering.
   */
  poll(): void {
    // Process all queued messages from the server
    let msg: ServerMessage | undefined;
    while ((msg = this.#transport.recv())) {
      if (msg.type === 'ROOM_STATE') {
        const { state: next } = transitionLobby(this.#state, {
          type: 'RECV_ROOM_STATE',
          view: msg,
        });
        this.#state = next;
      } else if (msg.type === 'ERROR') {
        const { state: next } = transitionLobby(this.#state, {
          type: 'RECV_ERROR',
          code: msg.code,
          message: msg.message,
        });
        this.#state = next;
        // Clear code on error so the user can try again
        if (this.#state.screen === 'host_join') {
          this.#codeBuffer = '';
        }
      } else if (msg.type === 'MATCH_START') {
        this.#matchStart = { seed: msg.seed, mode: msg.mode, starts: msg.starts, win: msg.win };
        this.#lastResult = null;
      } else if (msg.type === 'MATCH_END') {
        // Cleared with it, or matchStart() would keep describing the match that
        // just finished and the session would open it again immediately.
        this.#matchStart = null;
        this.#lastResult = msg.result;
      } else if (msg.type === 'SNAPSHOT') {
        // Held for the session to drain: the match view owns drawing them, and
        // the first snapshots can arrive before it has been built.
        this.#snapshots.push(msg.snap);
      }
    }
  }

  /**
   * Handle a key press. Returns true if handled by the lobby, false if it
   * should propagate to the game.
   */
  handleKey(key: string): boolean {
    if (this.#state.screen === 'multiplayer') {
      if (key.toUpperCase() === 'H') {
        const { state: next, send } = transitionLobby(this.#state, { type: 'CLICK_HOST' });
        this.#setState(next, send);
        return true;
      }
      if (key.toUpperCase() === 'J') {
        const { state: next, send } = transitionLobby(this.#state, { type: 'CLICK_JOIN' });
        this.#setState(next, send);
        return true;
      }
    }

    if (this.#state.screen === 'host_join') {
      if (key === 'Escape') {
        this.#state = initialLobbyState();
        this.#codeBuffer = '';
        return true;
      }
      if (key === 'Enter') {
        if (this.#codeBuffer.length === 4) {
          const { state: next, send } = transitionLobby(this.#state, {
            type: 'ENTER_CODE',
            code: this.#codeBuffer as any,
          });
          this.#setState(next, send);
          this.#codeBuffer = '';
          return true;
        }
      }
      if (key === 'Backspace') {
        this.#codeBuffer = this.#codeBuffer.slice(0, -1);
        return true;
      }
      if (/^[a-zA-Z]$/.test(key) && this.#codeBuffer.length < 4) {
        this.#codeBuffer += key.toUpperCase();
        return true;
      }
    }

    if (this.#state.screen === 'lobby') {
      if (key.toUpperCase() === 'R') {
        const { state: next, send } = transitionLobby(this.#state, { type: 'TOGGLE_READY' });
        this.#setState(next, send);
        return true;
      }
      if (key === 'Escape') {
        const { state: next, send } = transitionLobby(this.#state, { type: 'LEAVE_ROOM' });
        this.#setState(next, send);
        return true;
      }
      // Character picker: A/W/K for archer/wizard/knight
      const charMap: Record<string, CharacterKind> = {
        a: 'archer',
        w: 'wizard',
        k: 'knight',
      };
      const char = charMap[key.toLowerCase()];
      if (char) {
        const { state: next, send } = transitionLobby(this.#state, {
          type: 'PICK_CHARACTER',
          char,
        });
        this.#setState(next, send);
        return true;
      }
      // Win condition: F cycles the frag target, T cycles the time limit. Each
      // also selects that kind, so picking one turns the other off.
      if (this.#state.userSlot === this.#state.roomView?.host) {
        const cycle = { f: 'frags', t: 'time' } as const;
        const kind = cycle[key.toLowerCase() as 'f' | 't'];
        if (kind) {
          const { state: next, send } = transitionLobby(this.#state, {
            type: 'CYCLE_WIN_CONDITION',
            kind,
          });
          this.#setState(next, send);
          return true;
        }
      }
      // Mode toggle: C for coop, D for deathmatch (host only)
      if (this.#state.userSlot === this.#state.roomView?.host) {
        if (key.toLowerCase() === 'c') {
          const { state: next, send } = transitionLobby(this.#state, {
            type: 'SET_MODE',
            mode: 'coop',
          });
          this.#setState(next, send);
          return true;
        }
        if (key.toLowerCase() === 'd') {
          const { state: next, send } = transitionLobby(this.#state, {
            type: 'SET_MODE',
            mode: 'deathmatch',
          });
          this.#setState(next, send);
          return true;
        }
      }
    }

    return false;
  }

  /** Read-only view of the lobby, for the dev hook and for tests. */
  get state(): Readonly<LobbyState> {
    return this.#state;
  }

  /** Room code typed so far on the join screen, before it is submitted. */
  get typedCode(): string {
    return this.#codeBuffer;
  }

  /**
   * Has the game started? Once MATCH_START arrives, the harness should hand
   * off to the game. Returns null until then.
   */
  matchStart(): { seed: number; mode: GameMode; starts: PlayerStart[]; win: WinCondition } | null {
    return this.#matchStart;
  }

  /** How the last match finished, for the lobby to report. Null before the first. */
  get lastResult(): MatchResult | null {
    return this.#lastResult;
  }

  #matchStart: { seed: number; mode: GameMode; starts: PlayerStart[]; win: WinCondition } | null =
    null;
  #lastResult: MatchResult | null = null;
  readonly #snapshots: Snapshot[] = [];

  /** Snapshots received since the last call, oldest first. Drains the buffer. */
  takeSnapshots(): Snapshot[] {
    return this.#snapshots.splice(0, this.#snapshots.length);
  }

  /**
   * Is the lobby still active? Returns false once all activity ceases or if
   * the Transport errors.
   */
  isActive(): boolean {
    return (
      this.#transport.state === 'connected' &&
      (this.#state.screen === 'host_join' || this.#state.screen === 'lobby') &&
      !this.#matchStart
    );
  }

  #setState(
    next: LobbyState,
    send: Array<any>,
  ): void {
    this.#state = next;
    for (const msg of send) {
      try {
        this.#transport.send(msg);
      } catch (e) {
        console.error('Failed to send:', e);
      }
    }
  }

  #render(): void {
    // Clear
    this.#ctx.fillStyle = '#0a0f0a';
    this.#ctx.fillRect(0, 0, this.#canvasW, this.#canvasH);

    if (this.#state.screen === 'multiplayer') {
      this.#renderMultiplayerScreen();
    } else if (this.#state.screen === 'host_join') {
      this.#renderHostJoinScreen();
    } else if (this.#state.screen === 'joining') {
      this.#renderJoiningScreen();
    } else if (this.#state.screen === 'lobby') {
      this.#renderLobbyScreen();
    }
  }

  /** Waiting on the server to hand out a seat. */
  #renderJoiningScreen(): void {
    const x = this.#canvasW / 2;
    const y = this.#canvasH / 2;
    this.#ctx.fillStyle = '#39ff14';
    this.#ctx.font = '20px monospace';
    this.#ctx.textAlign = 'center';
    this.#ctx.fillText(
      this.#state.roomCode ? `JOINING ${this.#state.roomCode}` : 'CREATING ROOM',
      x,
      y,
    );
  }

  #renderMultiplayerScreen(): void {
    const x = this.#canvasW / 2;
    const y = this.#canvasH / 2;
    this.#ctx.fillStyle = '#39ff14';
    this.#ctx.font = '24px monospace';
    this.#ctx.textAlign = 'center';
    this.#ctx.fillText('MULTIPLAYER', x, y - 60);
    this.#ctx.font = '16px monospace';
    this.#ctx.fillText('[H] HOST', x, y);
    this.#ctx.fillText('[J] JOIN', x, y + 40);

    // A failed create or join lands back here, so this is where it is reported
    if (this.#state.error) {
      this.#ctx.fillStyle = '#ff1f1f';
      this.#ctx.font = '12px monospace';
      this.#ctx.fillText(this.#state.error.toUpperCase(), x, y + 90);
    }
  }

  #renderHostJoinScreen(): void {
    const x = this.#canvasW / 2;
    const y = this.#canvasH / 2;
    this.#ctx.fillStyle = '#39ff14';
    this.#ctx.font = '24px monospace';
    this.#ctx.textAlign = 'center';
    this.#ctx.fillText('JOIN ROOM', x, y - 60);
    this.#ctx.font = '16px monospace';
    const codeDisplay = this.#codeBuffer.padEnd(4, '_');
    this.#ctx.fillText(`CODE  ${codeDisplay}`, x, y);
    this.#ctx.fillText('[ESC] BACK   [ENTER] JOIN', x, y + 60);
  }

  #renderLobbyScreen(): void {
    if (!this.#state.roomView) return;
    const x = this.#canvasW / 2;
    let y = 40;

    this.#ctx.fillStyle = '#39ff14';
    this.#ctx.font = '24px monospace';
    this.#ctx.textAlign = 'center';
    this.#ctx.fillText('LOBBY', x, y);

    this.#ctx.font = '16px monospace';
    y += 40;
    this.#ctx.fillText(`CODE: ${this.#state.roomView.code}`, x, y);
    y += 30;

    // Mode (clickable for host)
    const isHost = this.#state.userSlot === this.#state.roomView.host;
    const modeText = `MODE: ${this.#state.roomView.mode.toUpperCase()}${isHost ? ' [C/D]' : ''}`;
    this.#ctx.fillText(modeText, x, y);
    y += 30;

    // What ends the match. One or the other, so only the chosen one is shown as
    // set, and the host is told which key changes each.
    this.#ctx.fillText(`${describeWin(this.#state.roomView.win)}${isHost ? '  [F/T]' : ''}`, x, y);
    y += 30;

    // How the last one went, so a finished match is reported rather than the
    // screen simply reappearing as though nothing had happened.
    if (this.#lastResult) {
      this.#ctx.fillText(describeResult(this.#lastResult), x, y);
    }
    y += 40;

    // Character picker
    this.#ctx.fillText('[A] ARCHER  [W] WIZARD  [K] KNIGHT', x, y);
    y += 40;

    // Render slots
    for (const slot of this.#state.roomView.slots) {
      const marker = slot.id === this.#state.userSlot ? '▶ ' : '  ';
      const readyMark = slot.ready ? '[✓]' : '[ ]';
      this.#ctx.fillText(
        `${marker}${slot.name.padEnd(8)} ${slot.character.padEnd(8)} ${readyMark}`,
        x,
        y,
      );
      y += 25;
    }

    y += 20;
    this.#ctx.fillText('[R] READY  [ESC] LEAVE', x, y);
  }
}

/**
 * How the win condition reads on screen. One line, because only one of the two
 * is ever in force.
 */
export function describeWin(win: WinCondition): string {
  return win.kind === 'frags' ? `FIRST TO: ${win.target} FRAGS` : `TIME LIMIT: ${win.minutes} MIN`;
}

/** How a finished match reads on the lobby screen. */
export function describeResult(result: MatchResult): string {
  if (result.outcome !== 'DEATHMATCH') return `LAST: WAVE ${result.wave}`;
  const line = `${result.scoreA} - ${result.scoreB}`;
  if (result.winner === null) return `LAST: DRAW  ${line}`;
  return `LAST: TEAM ${result.winner === Team.A ? 'A' : 'B'} WON  ${line}`;
}
