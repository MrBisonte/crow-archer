/**
 * Drives the lobby UI. Thin glue between Transport, state machine, input, and
 * rendering. No business logic lives here — all of that is in lobby-state.ts
 * (pure) and the Transport.
 */

import { parseClientMessage } from '../net/protocol';
import type { ServerMessage } from '../net/protocol';
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

  /**
   * Run one frame: poll Transport for messages, process input, update state,
   * render. Called once per frame from the main game loop.
   */
  frame(dt: number): void {
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
      }
      // PONG and other messages are ignored in the lobby
    }

    // Render the current screen
    this.#render();
  }

  /**
   * Handle a click at (x, y) in canvas coordinates. Returns true if the lobby
   * handled it, false if it should propagate to the game.
   */
  handleClick(x: number, y: number): boolean {
    const action = this.#getClickAction(x, y);
    if (!action) return false;

    const { state: next, send } = transitionLobby(this.#state, action);
    this.#state = next;

    for (const msg of send) {
      try {
        this.#transport.send(msg as any);
      } catch (e) {
        console.error('Failed to send:', e);
      }
    }
    return true;
  }

  /**
   * Handle a key press. Returns true if handled.
   */
  handleKey(key: string): boolean {
    if (key === 'Escape') {
      const { state: next, send } = transitionLobby(this.#state, {
        type: 'LEAVE_ROOM',
      });
      this.#state = next;
      for (const msg of send) {
        try {
          this.#transport.send(msg as any);
        } catch (e) {
          console.error('Failed to send:', e);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Is the lobby still active? Returns false once the user navigates away or
   * if the Transport errors.
   */
  isActive(): boolean {
    return this.#state.screen !== 'multiplayer' || this.#transport.state === 'connected';
  }

  #getClickAction(x: number, y: number) {
    // Character picker: click a character icon (stub for now)
    // Ready button: click the ready button
    // Mode selector: click coop/deathmatch (host only)
    // These would be filled in once we define the screen layout
    return null;
  }

  #render(): void {
    // Clear
    this.#ctx.fillStyle = '#0a0f0a';
    this.#ctx.fillRect(0, 0, this.#canvasW, this.#canvasH);

    // Draw based on screen
    if (this.#state.screen === 'multiplayer') {
      this.#renderMultiplayerScreen();
    } else if (this.#state.screen === 'host_join') {
      this.#renderHostJoinScreen();
    } else if (this.#state.screen === 'lobby') {
      this.#renderLobbyScreen();
    }
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
  }

  #renderHostJoinScreen(): void {
    const x = this.#canvasW / 2;
    const y = this.#canvasH / 2;
    this.#ctx.fillStyle = '#39ff14';
    this.#ctx.font = '24px monospace';
    this.#ctx.textAlign = 'center';
    this.#ctx.fillText('JOIN ROOM', x, y - 60);
    this.#ctx.font = '16px monospace';
    this.#ctx.fillText(`CODE: ${this.#state.roomCode || 'ENTER 4 LETTERS'}`, x, y);
    this.#ctx.fillText('[ESC] BACK', x, y + 60);
  }

  #renderLobbyScreen(): void {
    if (!this.#state.roomView) return;
    const x = this.#canvasW / 2;
    const y = 50;
    this.#ctx.fillStyle = '#39ff14';
    this.#ctx.font = '24px monospace';
    this.#ctx.textAlign = 'center';
    this.#ctx.fillText('LOBBY', x, y);

    this.#ctx.font = '16px monospace';
    this.#ctx.fillText(`CODE: ${this.#state.roomView.code}`, x, y + 40);
    this.#ctx.fillText(`MODE: ${this.#state.roomView.mode.toUpperCase()}`, x, y + 70);

    // Render slots
    let slotY = y + 120;
    for (const slot of this.#state.roomView.slots) {
      const prefix = slot.id === this.#state.userSlot ? '▶ ' : '  ';
      const ready = slot.ready ? '[✓]' : '[ ]';
      this.#ctx.fillText(
        `${prefix}${slot.name} ${slot.character} ${ready}`,
        x,
        slotY,
      );
      slotY += 30;
    }

    this.#ctx.fillText('[R] READY  [ESC] LEAVE', x, this.#canvasH - 40);
  }
}
