/**
 * The game harness: owns the canvas, the game loop, and transitions between
 * the lobby and the live game. This is the entry point for everything that
 * used to be `game.html`; the legacy monolith lives under src/legacy/.
 *
 * Not done yet: this is Phase 1's final piece. It scaffolds how the lobby
 * would connect and play alongside the legacy game.
 */

import type { LobbyController } from './ui/lobby-controller';
import type { WsTransport } from './net/ws-transport';

/**
 * Boots the harness. For now, this is a stub: it imports the legacy game
 * to preserve compatibility. Phase 1 will inject the lobby UI here when
 * the Transport connects.
 */
export function startGameHarness(options: {
  canvas: HTMLCanvasElement;
  serverUrl?: string;
}): void {
  // On page load, the legacy game (src/legacy/game.js) self-initializes.
  // This is called after it does, so we can extend it with Phase 1 features.
  //
  // Future work:
  // 1. If serverUrl is provided (or detectable from location), create WsTransport
  // 2. Create LobbyController, wire it to input/render events
  // 3. Let it run until MATCH_START, then hand off to the game
  // 4. On match end, return to lobby
  //
  // For now, just verify the legacy game still runs.
}
