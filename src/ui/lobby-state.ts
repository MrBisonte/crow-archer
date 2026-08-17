/**
 * Pure state machine for the lobby. Input: current state + an action. Output:
 * new state + messages to send to the server. No I/O, no clock, no randomness.
 */

import {
  nextWinCondition,
  type CharacterKind,
  type GameMode,
  type MapKind,
  type PlayerId,
  type RoomCode,
  type RoomView,
  type WinCondition,
} from '../net/protocol';

/**
 * Which screen the lobby is showing.
 *
 * 'joining' covers the round trip for both create and join. It exists so the
 * client never claims to be in a room before the server has put it in one:
 * you hold a seat when ROOM_STATE says you do, not when you pressed a key.
 */
export type LobbyScreen = 'multiplayer' | 'host_join' | 'joining' | 'lobby';

/** The user's readiness on this device. Not sent until the screen confirms it. */
export type UserReadiness = 'not_ready' | 'pending_ready' | 'ready';

/** Client-side lobby state. All transitions are pure; server state rides along. */
export interface LobbyState {
  screen: LobbyScreen;
  roomCode: RoomCode | null;
  userSlot: number | null;          // which slot (0-3) this client occupies
  userCharacter: CharacterKind;     // current pick (archer|wizard|knight)
  userReadiness: UserReadiness;
  roomView: RoomView | null;        // current server state (null until join/create succeeds)
  error: string | null;             // user-facing error message
}

/** Actions the user can take. */
export type LobbyAction =
  | { type: 'CLICK_HOST' }
  | { type: 'CLICK_JOIN' }
  | { type: 'ENTER_CODE'; code: RoomCode }
  | { type: 'PICK_CHARACTER'; char: CharacterKind }
  | { type: 'TOGGLE_READY' }
  | { type: 'SET_MODE'; mode: GameMode }
  | { type: 'SET_MAP'; mapKind: MapKind }
  /**
   * Cycles the frag target or the time limit. The kind is what the user chose;
   * the value comes from the list on offer, so the two settings cannot both be
   * active and neither can be set to something absurd.
   */
  | { type: 'CYCLE_WIN_CONDITION'; kind: 'frags' | 'time' }
  | { type: 'LEAVE_ROOM' }
  // Carries `you` because that is how the client learns which seat is its own.
  // The stored roomView drops it again: userSlot is the one home for that fact.
  | { type: 'RECV_ROOM_STATE'; view: RoomView & { you: PlayerId } }
  | { type: 'RECV_ERROR'; code: string; message: string };

/** What to send to the server. */
export type LobbyOutbound =
  | { type: 'CREATE_ROOM' }
  | { type: 'JOIN_ROOM'; code: RoomCode }
  | { type: 'SET_CHARACTER'; character: CharacterKind }
  | { type: 'SET_READY'; ready: boolean }
  | { type: 'SET_MODE'; mode: GameMode }
  | { type: 'SET_MAP'; mapKind: MapKind }
  | { type: 'SET_WIN_CONDITION'; win: WinCondition }
  | { type: 'LEAVE_ROOM' };

/** Initial state: at the main menu. */
export function initialLobbyState(): LobbyState {
  return {
    screen: 'multiplayer',
    roomCode: null,
    userSlot: null,
    userCharacter: 'archer',
    userReadiness: 'not_ready',
    roomView: null,
    error: null,
  };
}

/**
 * Pure state transition. Returns the new state and any messages that should be
 * sent to the server.
 */
export function transitionLobby(
  state: LobbyState,
  action: LobbyAction,
): { state: LobbyState; send: LobbyOutbound[] } {
  const send: LobbyOutbound[] = [];

  switch (action.type) {
    case 'CLICK_HOST':
      // No room code is invented here. The server picks it, and RECV_ROOM_STATE
      // is what moves this client onto the lobby screen.
      return {
        state: { ...state, screen: 'joining', roomCode: null, error: null },
        send: [{ type: 'CREATE_ROOM' }],
      };

    case 'CLICK_JOIN':
      return { state: { ...state, screen: 'host_join' }, send: [] };

    case 'ENTER_CODE': {
      const code = action.code.toUpperCase();
      return {
        state: { ...state, screen: 'joining', roomCode: code, error: null },
        send: [{ type: 'JOIN_ROOM', code }],
      };
    }

    case 'PICK_CHARACTER': {
      if (state.screen !== 'lobby' || !state.roomView) return { state, send: [] };
      return {
        state: { ...state, userCharacter: action.char },
        send: [{ type: 'SET_CHARACTER', character: action.char }],
      };
    }

    case 'TOGGLE_READY': {
      if (state.screen !== 'lobby' || !state.roomView) return { state, send: [] };
      // Toggle between ready and not_ready. Cycle through pending_ready in between.
      const nextReady =
        state.userReadiness === 'not_ready' ? 'pending_ready' : 'not_ready';
      const shouldReady = nextReady === 'pending_ready';
      return {
        state: { ...state, userReadiness: nextReady },
        send: [{ type: 'SET_READY', ready: shouldReady }],
      };
    }

    case 'SET_MODE': {
      if (state.screen !== 'lobby' || !state.roomView) return { state, send: [] };
      // Only host can change mode; others ignore
      if (state.userSlot !== state.roomView.host) return { state, send: [] };
      return {
        state,
        send: [{ type: 'SET_MODE', mode: action.mode }],
      };
    }

    case 'SET_MAP': {
      if (state.screen !== 'lobby' || !state.roomView) return { state, send: [] };
      // Only host can change the map; others ignore
      if (state.userSlot !== state.roomView.host) return { state, send: [] };
      return {
        state,
        send: [{ type: 'SET_MAP', mapKind: action.mapKind }],
      };
    }

    case 'CYCLE_WIN_CONDITION': {
      if (state.screen !== 'lobby' || !state.roomView) return { state, send: [] };
      // Host only, like the mode. The next room state is what moves the display,
      // so nothing is changed locally and the two cannot disagree.
      if (state.userSlot !== state.roomView.host) return { state, send: [] };
      const win = nextWinCondition(state.roomView.win, action.kind);
      return { state, send: [{ type: 'SET_WIN_CONDITION', win }] };
    }

    case 'LEAVE_ROOM':
      return {
        state: { ...initialLobbyState() },
        send: state.screen === 'lobby' ? [{ type: 'LEAVE_ROOM' }] : [],
      };

    case 'RECV_ROOM_STATE': {
      const view = action.view;
      // `you` from the server tells us which slot we are
      const userSlot = view.you;
      const mySlot = view.slots[userSlot] || null;
      return {
        state: {
          ...state,
          screen: 'lobby',
          roomCode: view.code,
          userSlot,
          userCharacter: mySlot?.character ?? state.userCharacter,
          userReadiness: mySlot?.ready ? 'ready' : 'not_ready',
          roomView: view,
          error: null,
        },
        send: [],
      };
    }

    case 'RECV_ERROR': {
      const errorText = action.message || action.code;
      // A failed create or join has nowhere to stand, so any error during the
      // round trip returns to the menu. One rule rather than a list of codes:
      // ROOM_FULL, ROOM_IN_MATCH and ALREADY_IN_ROOM would all strand the
      // player on a screen for a seat they never got.
      if (state.screen === 'joining') {
        return { state: { ...initialLobbyState(), error: errorText }, send: [] };
      }
      return { state: { ...state, error: errorText }, send: [] };
    }
  }
}
