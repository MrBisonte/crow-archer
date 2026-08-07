/**
 * Drives the lobby UI. Thin glue between Transport, state machine, input, and
 * rendering. No business logic lives here — all of that is in lobby-state.ts
 * (pure) and the Transport.
 */

import type { CharacterKind } from '../net/protocol';
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

  /**
   * Run one frame: poll Transport for messages, render the current screen.
   * Input is handled separately via handleClick/handleKey.
   */
  frame(): void {
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
      }
    }

    this.#render();
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

  /**
   * Is the lobby still active? Returns false once all activity ceases or if
   * the Transport errors.
   */
  isActive(): boolean {
    return (
      this.#transport.state === 'connected' &&
      (this.#state.screen === 'host_join' || this.#state.screen === 'lobby')
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
    y += 50;

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
