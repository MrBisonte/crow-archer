/**
 * Drives the real server over real sockets. The unit tests cover the rules;
 * this one covers the wiring, and answers phase 1's exit question: do four
 * clients gather in one lobby and see each other's picks?
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Team } from '../sim/team';
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '../net/protocol';
import { startServer, type RunningServer } from './index';

/** A test client that queues what arrives, so a test can await the next message. */
class Client {
  readonly #socket: WebSocket;
  readonly #queue: ServerMessage[] = [];
  #waiting: ((m: ServerMessage) => void) | null = null;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (data) => {
      const msg = parseServerMessage(JSON.parse(String(data)));
      if (!msg) throw new Error(`server sent something unparseable: ${data}`);
      const waiting = this.#waiting;
      if (waiting) { this.#waiting = null; waiting(msg); } else this.#queue.push(msg);
    });
  }

  static connect(port: number): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const client = new Client(socket);
    return new Promise((resolve, reject) => {
      socket.on('open', () => resolve(client));
      socket.on('error', reject);
    });
  }

  send(msg: ClientMessage): void {
    this.#socket.send(JSON.stringify(msg));
  }

  /** The next message, from the queue or whenever it lands. */
  next(): Promise<ServerMessage> {
    const queued = this.#queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => { this.#waiting = resolve; });
  }

  /** Sends and returns the single reply, which is the usual lobby round trip. */
  async ask(msg: ClientMessage): Promise<ServerMessage> {
    this.send(msg);
    return this.next();
  }

  async hello(name: string): Promise<ServerMessage> {
    return this.ask({ type: 'HELLO', v: PROTOCOL_VERSION, name });
  }

  close(): void {
    this.#socket.close();
  }
}

/** Narrows to ROOM_STATE, failing the test rather than returning a union. */
function roomState(msg: ServerMessage): Extract<ServerMessage, { type: 'ROOM_STATE' }> {
  if (msg.type !== 'ROOM_STATE') throw new Error(`expected ROOM_STATE, got ${msg.type}`);
  return msg;
}

describe('lobby server over websockets', () => {
  let server: RunningServer;
  let clients: Client[] = [];

  const connect = async (): Promise<Client> => {
    const c = await Client.connect(server.port);
    clients.push(c);
    return c;
  };

  beforeEach(async () => { server = await startServer({ port: 0 }); });

  afterEach(async () => {
    for (const c of clients) c.close();
    clients = [];
    await server.close();
  });

  it('completes the handshake', async () => {
    const a = await connect();
    expect(await a.hello('alex')).toEqual({ type: 'WELCOME', v: PROTOCOL_VERSION });
  });

  it('tells an out-of-date client why, rather than dropping it', async () => {
    const a = await connect();
    const reply = await a.ask({ type: 'HELLO', v: PROTOCOL_VERSION + 1, name: 'alex' });
    expect(reply).toMatchObject({ type: 'ERROR', code: 'VERSION_MISMATCH' });
  });

  it('answers BAD_MESSAGE to a frame that is not JSON', async () => {
    const a = await connect();
    await a.hello('alex');
    a.send('not json' as unknown as ClientMessage);
    expect(await a.next()).toMatchObject({ type: 'ERROR', code: 'BAD_MESSAGE' });
  });

  it('gathers four players in one lobby, each seeing the others', async () => {
    const names = ['alex', 'sam', 'kim', 'roo'];
    const players: Client[] = [];
    for (const name of names) {
      const c = await connect();
      await c.hello(name);
      players.push(c);
    }

    const created = roomState(await players[0]!.ask({ type: 'CREATE_ROOM' }));
    expect(created.you).toBe(0);
    const code = created.code;

    // Each join tells everyone already seated, so earlier clients see it too
    for (let i = 1; i < MAX_PLAYERS; i++) {
      players[i]!.send({ type: 'JOIN_ROOM', code });
      for (let seen = 0; seen <= i; seen++) {
        const state = roomState(await players[seen]!.next());
        expect(state.you).toBe(seen);
        expect(state.slots).toHaveLength(i + 1);
      }
    }

    // Everyone picks a character, and every pick reaches every client
    const picks = ['archer', 'wizard', 'knight', 'wizard'] as const;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      players[i]!.send({ type: 'SET_CHARACTER', character: picks[i]! });
      for (const p of players) await p.next();
    }

    // The host switches to deathmatch, which splits the four into 2v2
    players[0]!.send({ type: 'SET_MODE', mode: 'deathmatch' });
    for (const p of players) await p.next();

    // Everyone readies. The last state each client sees is the full picture.
    let final: Extract<ServerMessage, { type: 'ROOM_STATE' }> | null = null;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      players[i]!.send({ type: 'SET_READY', ready: true });
      for (let seen = 0; seen < MAX_PLAYERS; seen++) {
        const state = roomState(await players[seen]!.next());
        if (seen === 0) final = state;
      }
    }

    expect(final).not.toBeNull();
    expect(final!.mode).toBe('deathmatch');
    expect(final!.host).toBe(0);
    expect(final!.slots).toEqual([
      { id: 0, name: 'alex', character: 'archer', ready: true, team: Team.A },
      { id: 1, name: 'sam', character: 'wizard', ready: true, team: Team.B },
      { id: 2, name: 'kim', character: 'knight', ready: true, team: Team.A },
      { id: 3, name: 'roo', character: 'wizard', ready: true, team: Team.B },
    ]);
  });

  it('turns a fifth player away', async () => {
    const seated: Client[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = await connect();
      await c.hello(`p${i}`);
      seated.push(c);
    }
    const created = roomState(await seated[0]!.ask({ type: 'CREATE_ROOM' }));
    for (let i = 1; i < MAX_PLAYERS; i++) {
      seated[i]!.send({ type: 'JOIN_ROOM', code: created.code });
      for (let seen = 0; seen <= i; seen++) await seated[seen]!.next();
    }

    const late = await connect();
    await late.hello('late');
    expect(await late.ask({ type: 'JOIN_ROOM', code: created.code }))
      .toMatchObject({ type: 'ERROR', code: 'ROOM_FULL' });
  });

  it('frees the seat and moves the host when a socket drops', async () => {
    const host = await connect();
    const guest = await connect();
    await host.hello('alex');
    await guest.hello('sam');

    const created = roomState(await host.ask({ type: 'CREATE_ROOM' }));
    guest.send({ type: 'JOIN_ROOM', code: created.code });
    await host.next();
    await guest.next();

    host.close();
    const afterDrop = roomState(await guest.next());
    expect(afterDrop.host).toBe(1);
    expect(afterDrop.you).toBe(1);
    expect(afterDrop.slots).toHaveLength(1);
  });
});
