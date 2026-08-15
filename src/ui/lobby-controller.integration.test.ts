/**
 * Phase 1 E2E: main menu → lobby → character pick → game start.
 * Verifies the state machine handles the full flow. Render testing happens
 * in the browser (lobby.html).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { Team } from '../sim/team';
import { initialLobbyState, transitionLobby } from './lobby-state';
import { type LobbyOutbound } from './lobby-state';
import { DEFAULT_WIN_CONDITION } from '../net/protocol';

describe('Phase 1 E2E: lobby state flow', () => {
  it('flows from menu → host → room state → character pick → ready → game start', () => {
    let state = initialLobbyState();
    let send: LobbyOutbound[] = [];

    // Step 1: At main menu
    expect(state.screen).toBe('multiplayer');

    // Step 2: Click host. The seat is not ours until the server says so.
    ({ state, send } = transitionLobby(state, { type: 'CLICK_HOST' }));
    expect(state.screen).toBe('joining');
    expect(send).toContainEqual({ type: 'CREATE_ROOM' });

    // Step 3: Server sends room state (room QRTZ created, this player is host in slot 0)
    ({ state } = transitionLobby(state, {
      type: 'RECV_ROOM_STATE',
      view: {
        code: 'QRTZ',
        mode: 'coop',
        host: 0,
        you: 0,
        win: DEFAULT_WIN_CONDITION,
        slots: [
          { id: 0, name: 'player', character: 'archer', ready: false, team: Team.A },
        ],
      },
    }));
    expect(state.screen).toBe('lobby');
    expect(state.roomCode).toBe('QRTZ');
    expect(state.userSlot).toBe(0);
    expect(state.userCharacter).toBe('archer');

    // Step 4: Pick wizard
    ({ state, send } = transitionLobby(state, {
      type: 'PICK_CHARACTER',
      char: 'wizard',
    }));
    expect(state.userCharacter).toBe('wizard');
    expect(send).toContainEqual({ type: 'SET_CHARACTER', character: 'wizard' });

    // Step 5: Toggle ready
    ({ state, send } = transitionLobby(state, { type: 'TOGGLE_READY' }));
    expect(state.userReadiness).toBe('pending_ready');
    expect(send).toContainEqual({ type: 'SET_READY', ready: true });

    // Step 6: Server reflects readiness (all 4 ready, match starts)
    // For this test, just verify the state update path
    ({ state } = transitionLobby(state, {
      type: 'RECV_ROOM_STATE',
      view: {
        code: 'QRTZ',
        mode: 'coop',
        host: 0,
        you: 0,
        win: DEFAULT_WIN_CONDITION,
        slots: [
          { id: 0, name: 'player', character: 'wizard', ready: true, team: Team.A },
        ],
      },
    }));
    expect(state.userReadiness).toBe('ready');

    // Step 7: Game starts (MATCH_START message arrives)
    // The controller handles this; here we verify the state machine stays in lobby
    // (no transition for MATCH_START in the state machine; it's handled by the harness)
    expect(state.screen).toBe('lobby');
  });
});
