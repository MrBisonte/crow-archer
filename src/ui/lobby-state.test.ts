import { describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import { DEFAULT_WIN_CONDITION } from '../net/protocol';
import {
  initialLobbyState,
  transitionLobby,
  type LobbyState,
} from './lobby-state';

describe('Lobby state machine', () => {
  describe('main menu', () => {
    it('starts at multiplayer screen', () => {
      const state = initialLobbyState();
      expect(state.screen).toBe('multiplayer');
      expect(state.roomCode).toBeNull();
      expect(state.error).toBeNull();
    });

    it('waits on the server after click host rather than claiming a room', () => {
      const state = initialLobbyState();
      const { state: next, send } = transitionLobby(state, { type: 'CLICK_HOST' });
      expect(next.screen).toBe('joining');
      expect(next.roomCode).toBeNull();     // the server names the room, not us
      expect(send).toEqual([{ type: 'CREATE_ROOM' }]);
    });

    it('reaches the lobby only when the server sends a seat', () => {
      let { state } = transitionLobby(initialLobbyState(), { type: 'CLICK_HOST' });
      ({ state } = transitionLobby(state, {
        type: 'RECV_ROOM_STATE',
        view: {
          code: 'QRTZ',
          mode: 'coop',
          mapKind: 'forest',
          host: 0,
          you: 0,
          win: DEFAULT_WIN_CONDITION,
          slots: [{ id: 0, name: 'alex', character: 'archer', ready: false, team: Team.A }],
        },
      }));
      expect(state.screen).toBe('lobby');
      expect(state.roomCode).toBe('QRTZ');
    });

    it('returns to the menu when a join fails, whatever the code', () => {
      for (const code of ['ROOM_NOT_FOUND', 'ROOM_FULL', 'ROOM_IN_MATCH', 'ALREADY_IN_ROOM']) {
        let { state } = transitionLobby(initialLobbyState(), {
          type: 'ENTER_CODE',
          code: 'QRTZ',
        });
        expect(state.screen).toBe('joining');
        ({ state } = transitionLobby(state, { type: 'RECV_ERROR', code, message: `nope: ${code}` }));
        expect(state.screen).toBe('multiplayer');
        expect(state.error).toBe(`nope: ${code}`);
      }
    });

    it('transitions to host_join on click join', () => {
      const state = initialLobbyState();
      const { state: next, send } = transitionLobby(state, { type: 'CLICK_JOIN' });
      expect(next.screen).toBe('host_join');
      expect(send).toEqual([]);
    });
  });

  describe('host/join screen', () => {
    it('sends JOIN_ROOM with uppercase code', () => {
      const state = { ...initialLobbyState(), screen: 'host_join' as const };
      const { state: next, send } = transitionLobby(state, {
        type: 'ENTER_CODE',
        code: 'qrtz',
      });
      expect(send).toEqual([{ type: 'JOIN_ROOM', code: 'QRTZ' }]);
      expect(next.roomCode).toBe('QRTZ');
    });
  });

  describe('lobby screen', () => {
    const roomView = {
      code: 'AAAA' as const,
      mode: 'coop' as const,
      mapKind: 'forest' as const,
      host: 0,
      you: 0,
      win: DEFAULT_WIN_CONDITION,
      slots: [
        {
          id: 0,
          name: 'alex',
          character: 'archer' as const,
          ready: false,
          team: Team.A,
        },
      ],
    };

    it('transitions to lobby on RECV_ROOM_STATE', () => {
      const state = initialLobbyState();
      const { state: next } = transitionLobby(state, {
        type: 'RECV_ROOM_STATE',
        view: roomView,
      });
      expect(next.screen).toBe('lobby');
      expect(next.roomCode).toBe('AAAA');
      expect(next.userSlot).toBe(0);
      expect(next.roomView).toEqual(roomView);
    });

    it('reflects server character picks', () => {
      const state = initialLobbyState();
      const view = {
        ...roomView,
        slots: [{ ...roomView.slots[0]!, character: 'wizard' as const }],
      };
      const { state: next } = transitionLobby(state, {
        type: 'RECV_ROOM_STATE',
        view,
      });
      expect(next.userCharacter).toBe('wizard');
    });

    it('reflects server readiness', () => {
      const state = initialLobbyState();
      const view = { ...roomView, slots: [{ ...roomView.slots[0]!, ready: true }] };
      const { state: next } = transitionLobby(state, {
        type: 'RECV_ROOM_STATE',
        view,
      });
      expect(next.userReadiness).toBe('ready');
    });

    it('sends SET_CHARACTER and updates locally', () => {
      const state = { ...initialLobbyState(), screen: 'lobby' as const, roomView };
      const { state: next, send } = transitionLobby(state, {
        type: 'PICK_CHARACTER',
        char: 'knight',
      });
      expect(next.userCharacter).toBe('knight');
      expect(send).toEqual([{ type: 'SET_CHARACTER', character: 'knight' }]);
    });

    it('toggles readiness: not_ready -> pending_ready -> not_ready', () => {
      const state = {
        ...initialLobbyState(),
        screen: 'lobby' as const,
        roomView,
        userReadiness: 'not_ready' as const,
      };
      const { state: state1, send: send1 } = transitionLobby(state, { type: 'TOGGLE_READY' });
      expect(send1).toEqual([{ type: 'SET_READY', ready: true }]);
      expect(state1.userReadiness).toBe('pending_ready');

      const { state: state2, send: send2 } = transitionLobby(state1, { type: 'TOGGLE_READY' });
      expect(send2).toEqual([{ type: 'SET_READY', ready: false }]);
      expect(state2.userReadiness).toBe('not_ready');
    });

    it('only host can change mode', () => {
      // Host (slot 0)
      const hostState = {
        ...initialLobbyState(),
        screen: 'lobby' as const,
        roomView,
        userSlot: 0,
      };
      const { send: hostSend } = transitionLobby(hostState, {
        type: 'SET_MODE',
        mode: 'deathmatch',
      });
      expect(hostSend).toEqual([{ type: 'SET_MODE', mode: 'deathmatch' }]);

      // Non-host (slot 1)
      const guestState = { ...hostState, userSlot: 1 };
      const { send: guestSend } = transitionLobby(guestState, {
        type: 'SET_MODE',
        mode: 'deathmatch',
      });
      expect(guestSend).toEqual([]);
    });

    it('only host can change the map', () => {
      const hostState = {
        ...initialLobbyState(),
        screen: 'lobby' as const,
        roomView,
        userSlot: 0,
      };
      const { send: hostSend } = transitionLobby(hostState, {
        type: 'SET_MAP',
        mapKind: 'castle',
      });
      expect(hostSend).toEqual([{ type: 'SET_MAP', mapKind: 'castle' }]);

      const guestState = { ...hostState, userSlot: 1 };
      const { send: guestSend } = transitionLobby(guestState, {
        type: 'SET_MAP',
        mapKind: 'castle',
      });
      expect(guestSend).toEqual([]);
    });

    it('returns to main menu with error on room not found', () => {
      const state = initialLobbyState();
      const { state: next } = transitionLobby(state, {
        type: 'RECV_ERROR',
        code: 'ROOM_NOT_FOUND',
        message: 'No room has that code.',
      });
      expect(next.screen).toBe('multiplayer');
      expect(next.error).toBe('No room has that code.');
    });

    it('returns to main menu and clears state on leave', () => {
      const state = {
        ...initialLobbyState(),
        screen: 'lobby' as const,
        roomCode: 'AAAA' as const,
        roomView,
      };
      const { state: next, send } = transitionLobby(state, { type: 'LEAVE_ROOM' });
      expect(next.screen).toBe('multiplayer');
      expect(next.roomCode).toBeNull();
      expect(send).toEqual([{ type: 'LEAVE_ROOM' }]);
    });
  });
});
