/**
 * The lobby screen's own reading of a room: who is in it, and which heroes are
 * being shared.
 *
 * The duplicate test comes in the front door, through a ROOM_STATE off the
 * transport and one frame drawn, rather than through describeSlots alone. A
 * helper that formats perfectly and is called by nothing reads exactly as
 * green, which is the trap CHARACTER_KEYS' own comment records one screen over.
 */

import { describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import {
  DEFAULT_WIN_CONDITION,
  type CharacterKind,
  type ClientMessage,
  type PlayerSlot,
  type RoomView,
  type ServerMessage,
} from '../net/protocol';
import type { Transport, TransportState } from '../net/transport';
import { LobbyController, describeSlots } from './lobby-controller';

/** A connected transport with a hand-fed inbox. No socket, no clock. */
class FakeTransport implements Transport {
  state: TransportState = 'connected';
  readonly sent: ClientMessage[] = [];
  readonly #inbox: ServerMessage[] = [];

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(msg: ClientMessage): void {
    this.sent.push(msg);
  }

  recv(): ServerMessage | undefined {
    return this.#inbox.shift();
  }

  close(): void {
    this.state = 'idle';
  }

  /** Queues a message as though the server had sent it. */
  deliver(msg: ServerMessage): void {
    this.#inbox.push(msg);
  }
}

/** A canvas that keeps every string drawn on it, in order. */
function recordingCanvas(): { canvas: HTMLCanvasElement; drawn: string[] } {
  const drawn: string[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    fillRect: () => {},
    fillText: (text: string) => {
      drawn.push(text);
    },
  };
  const canvas = {
    width: 800,
    height: 600,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, drawn };
}

const seat = (id: number, name: string, character: CharacterKind): PlayerSlot => ({
  id,
  name,
  character,
  ready: false,
  team: id % 2 === 0 ? Team.A : Team.B,
});

const roomState = (slots: PlayerSlot[]): ServerMessage & RoomView => ({
  type: 'ROOM_STATE',
  you: 0,
  code: 'AAAA',
  mode: 'deathmatch',
  mapKind: 'forest',
  host: 0,
  win: DEFAULT_WIN_CONDITION,
  slots,
});

/** Drives one frame of the lobby screen against a room and returns what it drew. */
function draw(slots: PlayerSlot[]): string[] {
  const transport = new FakeTransport();
  const { canvas, drawn } = recordingCanvas();
  const controller = new LobbyController({ transport, canvas });
  transport.deliver(roomState(slots));
  controller.frame();
  return drawn;
}

describe('the lobby screen', () => {
  it('says SHARED on both seats holding the same hero', () => {
    const drawn = draw([seat(0, 'alex', 'archer'), seat(1, 'sam', 'archer')]);
    expect(drawn.filter((line) => line.includes('SHARED'))).toHaveLength(2);
  });

  it('says it across teams as well as within one', () => {
    // Slots 0 and 1 are opposing seats in deathmatch; 0 and 2 are team mates.
    const across = draw([seat(0, 'alex', 'wizard'), seat(1, 'sam', 'wizard')]);
    const within = draw([
      seat(0, 'alex', 'wizard'),
      seat(1, 'sam', 'knight'),
      seat(2, 'kim', 'wizard'),
    ]);
    expect(across.filter((line) => line.includes('SHARED'))).toHaveLength(2);
    expect(within.filter((line) => line.includes('SHARED'))).toHaveLength(2);
    expect(within.find((line) => line.includes('sam'))).not.toContain('SHARED');
  });

  it('says nothing when every seat picked its own', () => {
    const drawn = draw([seat(0, 'alex', 'archer'), seat(1, 'sam', 'knight')]);
    expect(drawn.filter((line) => line.includes('SHARED'))).toEqual([]);
  });
});

describe('describeSlots', () => {
  it('marks the seat the reader is sitting in', () => {
    const lines = describeSlots([seat(0, 'alex', 'archer'), seat(1, 'sam', 'knight')], 1);
    expect(lines[0]!.startsWith('▶')).toBe(false);
    expect(lines[1]!.startsWith('▶')).toBe(true);
  });

  it('shows readiness per seat', () => {
    const [waiting, set] = describeSlots(
      [seat(0, 'alex', 'archer'), { ...seat(1, 'sam', 'knight'), ready: true }],
      0,
    );
    expect(waiting).toContain('[ ]');
    expect(set).toContain('[✓]');
  });
});
