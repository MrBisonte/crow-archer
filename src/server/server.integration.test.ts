/**
 * Drives the real server over real sockets. The unit tests cover the rules;
 * this one covers the wiring, and answers phase 1's exit question: do four
 * clients gather in one lobby and see each other's picks?
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { FLIGHT_PATH, MAX_BODY_BYTES } from '../dev/flight-path';
import { PAGES_ORIGIN, SERVER_ORIGIN } from '../net/server-url';
import { Team } from '../sim/team';
import { Button } from '../sim/input';
import { PLAYER_MAX_HP } from '../sim/arena';
import {
  EntityKind,
  FRAG_TARGETS,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  WS_PATH,
  parseServerMessage,
  type ClientMessage,
  type EntitySnapshot,
  type ServerMessage,
} from '../net/protocol';
import { BattleWorld } from '../sim/battle-world';
import { MAP_COLS, MAP_ROWS, Terrain } from '../sim/arena-map';
import { TileMap } from '../sim/tilemap';
import type { Kill, World } from '../sim/world';
import { HEALTH_PATH, startServer, type RunningServer } from './index';

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
    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
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

/**
 * A world in which team A scores on a fixed schedule and nothing else happens.
 *
 * Injected so a match can be played to its end in under a second. It exists to
 * exercise the path a score takes to the wire, not to simulate anything.
 */
class ScoringWorld implements World {
  #ticks = 0;

  constructor(private readonly everyTicks: number) {}

  step(): readonly Kill[] {
    this.#ticks++;
    if (this.#ticks % this.everyTicks !== 0) return [];
    return [{ victim: 1, killer: 0, killerTeam: Team.A }];
  }

  snapshot(): EntitySnapshot[] {
    return [];
  }

  restore(): void {}

  remove(): void {}
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

  it('starts a match and streams snapshots once both seats ready', async () => {
    const host = await connect();
    const guest = await connect();
    await host.hello('alex');
    await guest.hello('sam');

    const created = roomState(await host.ask({ type: 'CREATE_ROOM' }));
    guest.send({ type: 'JOIN_ROOM', code: created.code });
    await host.next();
    await guest.next();

    // Co-op on purpose: this test is about two seats on one side starting a
    // match, and a room now opens in deathmatch.
    host.send({ type: 'SET_MODE', mode: 'coop' });
    await host.next();
    await guest.next();

    host.send({ type: 'SET_READY', ready: true });
    await host.next();
    await guest.next();

    // The last seat to ready tips the room into a match
    guest.send({ type: 'SET_READY', ready: true });
    for (const p of [host, guest]) {
      expect(await p.next()).toMatchObject({ type: 'ROOM_STATE' });
      const start = await p.next();
      expect(start).toMatchObject({ type: 'MATCH_START', mode: 'coop' });
      expect((start as Extract<ServerMessage, { type: 'MATCH_START' }>).starts).toHaveLength(2);
    }

    // The tick loop is now running, so snapshots arrive without being asked for
    for (const p of [host, guest]) {
      expect(await p.next()).toMatchObject({ type: 'SNAPSHOT' });
    }
  });

  it('advances the snapshot tick over time', async () => {
    const solo = await connect();
    await solo.hello('alex');
    const created = roomState(await solo.ask({ type: 'CREATE_ROOM' }));
    expect(created.slots).toHaveLength(1);

    // Co-op, because a solo deathmatch has nobody to fight and will not start.
    await solo.ask({ type: 'SET_MODE', mode: 'coop' });
    solo.send({ type: 'SET_READY', ready: true });
    await solo.next();                                    // ROOM_STATE
    await solo.next();                                    // MATCH_START

    const first = await solo.next();
    const second = await solo.next();
    expect(first).toMatchObject({ type: 'SNAPSHOT' });
    expect(second).toMatchObject({ type: 'SNAPSHOT' });

    const tickOf = (m: ServerMessage) =>
      (m as Extract<ServerMessage, { type: 'SNAPSHOT' }>).snap.tick;
    expect(tickOf(second)).toBeGreaterThan(tickOf(first));
  });

  it('acks an input in a later snapshot', async () => {
    const solo = await connect();
    await solo.hello('alex');
    await solo.ask({ type: 'CREATE_ROOM' });
    // Co-op, because a solo deathmatch has nobody to fight and will not start.
    await solo.ask({ type: 'SET_MODE', mode: 'coop' });
    solo.send({ type: 'SET_READY', ready: true });
    await solo.next();                                    // ROOM_STATE
    await solo.next();                                    // MATCH_START

    const ackOf = (m: ServerMessage) =>
      (m as Extract<ServerMessage, { type: 'SNAPSHOT' }>).snap.acks[0]!.seq;

    expect(ackOf(await solo.next())).toBe(0);             // nothing sent yet
    solo.send({ type: 'INPUT', cmd: { seq: 7, buttons: 0, aimAngle: 0 } });

    // The ack shows up on whichever snapshot lands after the input does
    let acked = 0;
    for (let i = 0; i < 5 && acked === 0; i++) acked = ackOf(await solo.next());
    expect(acked).toBe(7);
  });

  it('refuses to start a deathmatch with nobody to fight', async () => {
    const solo = await connect();
    await solo.hello('alex');
    await solo.ask({ type: 'CREATE_ROOM' });
    solo.send({ type: 'SET_MODE', mode: 'deathmatch' });
    await solo.next();

    solo.send({ type: 'SET_READY', ready: true });
    expect(await solo.next()).toMatchObject({ type: 'ROOM_STATE' });

    // The same room in coop would be playing by now
    await new Promise((r) => setTimeout(r, 150));
    expect(server.activeMatches()).toBe(0);
  });

  it('starts a solo coop match, which is just single player', async () => {
    const solo = await connect();
    await solo.hello('alex');
    await solo.ask({ type: 'CREATE_ROOM' });
    // Asked for, because a room now opens in deathmatch, and a deathmatch of one
    // has nobody to fight.
    await solo.ask({ type: 'SET_MODE', mode: 'coop' });
    solo.send({ type: 'SET_READY', ready: true });
    await solo.next();
    expect(await solo.next()).toMatchObject({ type: 'MATCH_START', mode: 'coop' });
  });

  it('stops ticking a match once everyone has gone', async () => {
    const solo = await connect();
    await solo.hello('alex');
    await solo.ask({ type: 'CREATE_ROOM' });
    // Co-op, because a solo deathmatch has nobody to fight and will not start.
    await solo.ask({ type: 'SET_MODE', mode: 'coop' });
    solo.send({ type: 'SET_READY', ready: true });
    await solo.next();                                    // ROOM_STATE
    await solo.next();                                    // MATCH_START
    expect(await solo.next()).toMatchObject({ type: 'SNAPSHOT' });

    // Dropping the only player ends the match; without this the interval and
    // the Match object would live for the life of the process.
    solo.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(server.activeMatches()).toBe(0);
  });

  it('leaves a dropped body standing for the others', async () => {
    const host = await connect();
    const guest = await connect();
    await host.hello('alex');
    await guest.hello('sam');
    const created = roomState(await host.ask({ type: 'CREATE_ROOM' }));
    guest.send({ type: 'JOIN_ROOM', code: created.code });
    await host.next();
    await guest.next();

    host.send({ type: 'SET_READY', ready: true });
    await host.next();
    await guest.next();
    guest.send({ type: 'SET_READY', ready: true });
    for (const p of [host, guest]) { await p.next(); await p.next(); }

    guest.close();
    await new Promise((r) => setTimeout(r, 150));

    // The match is still running for the host, and the body is still there
    expect(server.activeMatches()).toBe(1);
    let seen: ServerMessage = await host.next();
    while (seen.type !== 'SNAPSHOT') seen = await host.next();
    const entities = (seen as Extract<ServerMessage, { type: 'SNAPSHOT' }>).snap.entities;
    expect(entities.map((e) => e.id).sort()).toEqual([0, 1]);
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

describe('a deathmatch that can be won', () => {
  let server: RunningServer;
  let clients: Client[] = [];

  const connect = async (): Promise<Client> => {
    const c = await Client.connect(server.port);
    clients.push(c);
    return c;
  };

  /**
   * The real battle world, but on open ground.
   *
   * A generated map puts rock between the two spawns often enough that a test
   * firing across it would pass or fail on the seed. The terrain rules have
   * their own tests; what this file is for is whether an input reaches the
   * world and the result reaches the wire.
   */
  beforeEach(async () => {
    server = await startServer({
      port: 0,
      makeWorld: (seed, starts, mode) =>
        new BattleWorld({
          seed,
          starts,
          mode,
          noise: () => null,
          terrain: new Terrain(new TileMap(MAP_ROWS, MAP_COLS)),
        }),
    });
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    clients = [];
    await server.close();
  });

  /** Two seats in a started deathmatch, with the spawn positions they were given. */
  const startMatch = async () => {
    const host = await connect();
    const guest = await connect();
    await host.hello('alex');
    await guest.hello('sam');

    const created = roomState(await host.ask({ type: 'CREATE_ROOM' }));
    guest.send({ type: 'JOIN_ROOM', code: created.code });
    await host.next();
    await guest.next();

    host.send({ type: 'SET_MODE', mode: 'deathmatch' });
    await host.next();
    await guest.next();

    host.send({ type: 'SET_READY', ready: true });
    await host.next();
    await guest.next();
    guest.send({ type: 'SET_READY', ready: true });

    // Both get ROOM_STATE then MATCH_START; the starts are what we aim with.
    let started: Extract<ServerMessage, { type: 'MATCH_START' }> | null = null;
    for (let i = 0; i < 6 && !started; i++) {
      const msg = await host.next();
      if (msg.type === 'MATCH_START') started = msg;
    }
    if (!started) throw new Error('the match never started');
    return { host, guest, starts: started.starts };
  };

  /** Reads snapshots until one satisfies the predicate, or gives up. */
  const snapshotWhere = async (
    client: Client,
    predicate: (s: Extract<ServerMessage, { type: 'SNAPSHOT' }>['snap']) => boolean,
  ) => {
    for (let i = 0; i < 200; i++) {
      const msg = await client.next();
      if (msg.type === 'SNAPSHOT' && predicate(msg.snap)) return msg.snap;
    }
    throw new Error('no snapshot matched within 200 messages');
  };

  it('plays to a frag target, reports the winner, and hands the room back', async () => {
    // The world is injected because ten frags of real archery is fifty seconds
    // of arrows and respawns. What is under test here is the wiring: the score
    // reaching the wire, MATCH_END, and the room becoming playable again.
    // ArenaWorld's own rules are covered by its unit tests.
    const fast = await startServer({ port: 0, makeWorld: () => new ScoringWorld(6) });
    const host = await Client.connect(fast.port);
    const guest = await Client.connect(fast.port);
    try {
      await host.hello('alex');
      await guest.hello('sam');

      const created = roomState(await host.ask({ type: 'CREATE_ROOM' }));
      guest.send({ type: 'JOIN_ROOM', code: created.code });
      await host.next();
      await guest.next();

      host.send({ type: 'SET_MODE', mode: 'deathmatch' });
      await host.next();
      await guest.next();

      host.send({ type: 'SET_WIN_CONDITION', win: { kind: 'frags', target: FRAG_TARGETS[0]! } });
      expect(roomState(await host.next()).win).toEqual({ kind: 'frags', target: 10 });
      await guest.next();

      host.send({ type: 'SET_READY', ready: true });
      await host.next();
      await guest.next();
      guest.send({ type: 'SET_READY', ready: true });

      let started: Extract<ServerMessage, { type: 'MATCH_START' }> | null = null;
      for (let i = 0; i < 6 && !started; i++) {
        const msg = await host.next();
        if (msg.type === 'MATCH_START') started = msg;
      }
      if (!started) throw new Error('the match never started');
      expect(started.win).toEqual({ kind: 'frags', target: 10 });

      let ended: Extract<ServerMessage, { type: 'MATCH_END' }> | null = null;
      let sawScore = false;
      for (let i = 0; i < 500 && !ended; i++) {
        const msg = await host.next();
        if (msg.type === 'SNAPSHOT' && msg.snap.scores.a > 0) sawScore = true;
        if (msg.type === 'MATCH_END') ended = msg;
      }
      if (!ended) throw new Error('the match never ended');

      expect(sawScore).toBe(true);             // the score travelled while playing
      expect(ended.result).toEqual({
        outcome: 'DEATHMATCH', winner: Team.A, scoreA: 10, scoreB: 0,
      });

      // The room is playable again: back in its lobby, with readiness cleared so
      // it does not restart the instant it finished.
      const back = roomState(await host.next());
      expect(back.slots.every((s) => !s.ready)).toBe(true);
      expect(fast.activeMatches()).toBe(0);
    } finally {
      host.close();
      guest.close();
      await fast.close();
    }
  }, 20_000);

  it('puts an arrow on the wire when a player fires', async () => {
    const { host, starts } = await startMatch();
    const me = starts.find((s) => s.id === 0)!;
    const them = starts.find((s) => s.id === 1)!;
    const aimAngle = Math.atan2(them.y - me.y, them.x - me.x);

    host.send({ type: 'INPUT', cmd: { seq: 1, buttons: Button.FIRE, aimAngle } });
    const snap = await snapshotWhere(host, (s) =>
      s.entities.some((e) => e.kind === EntityKind.PROJECTILE),
    );
    expect(snap.entities.filter((e) => e.kind === EntityKind.PROJECTILE).length).toBeGreaterThan(0);
  });

  it('wounds the player it was aimed at, which is the whole game in one line', async () => {
    const { host, starts } = await startMatch();
    const me = starts.find((s) => s.id === 0)!;
    const them = starts.find((s) => s.id === 1)!;
    const aimAngle = Math.atan2(them.y - me.y, them.x - me.x);

    host.send({ type: 'INPUT', cmd: { seq: 1, buttons: Button.FIRE, aimAngle } });
    const snap = await snapshotWhere(host, (s) => {
      const target = s.entities.find((e) => e.id === 1 && e.kind === EntityKind.PLAYER);
      return !!target && target.hp < PLAYER_MAX_HP;
    });
    expect(snap.entities.find((e) => e.id === 1)!.hp).toBeLessThan(PLAYER_MAX_HP);
  }, 10_000);
});

describe('serving the client', () => {
  const PAGE = '<!doctype html><title>crow archer</title>';
  let server: RunningServer;

  const get = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body: await res.text(),
    };
  };

  beforeEach(async () => {
    server = await startServer({ port: 0, clientPage: { read: async () => PAGE } });
  });

  afterEach(async () => { await server.close(); });

  it('serves the page at the root, so one URL is the whole deployment', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
    expect(res.body).toBe(PAGE);
  });

  it('serves the page at /index.html, which is what a copied link often has', async () => {
    expect(await get('/index.html')).toMatchObject({ status: 200, body: PAGE });
  });

  it('forbids caching the page, so a rebuild is never served stale', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('ignores a query string, since ?server= and ?name= arrive on the page URL', async () => {
    expect(await get('/?name=alex')).toMatchObject({ status: 200, body: PAGE });
  });

  it('answers the health check a host polls to decide the process is up', async () => {
    expect(await get(HEALTH_PATH)).toMatchObject({ status: 200, body: 'ok' });
  });

  it('has nothing at any other path', async () => {
    expect((await get('/etc/passwd')).status).toBe(404);
  });

  it('serves sockets even with no build to hand out', async () => {
    const bare = await startServer({ port: 0, clientPage: { read: async () => null } });
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/`);
      expect(res.status).toBe(503);
      const socket = new WebSocket(`ws://127.0.0.1:${bare.port}${WS_PATH}`);
      await new Promise<void>((resolve, reject) => {
        socket.on('open', () => resolve());
        socket.on('error', reject);
      });
      socket.close();
    } finally {
      await bare.close();
    }
  });

  it('offers no upgrade off the socket path, so the page route stays a page route', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    const failure = await new Promise<Error>((resolve) => {
      socket.on('error', resolve);
      socket.on('open', () => resolve(new Error('the server upgraded a page request')));
    });
    expect(failure.message).not.toContain('upgraded');
  });
});

/**
 * The flight route on the deployed server, driven through a real port.
 *
 * The line format and the cap are pure and tested where they live
 * (src/dev/flight-path.ts); what is only observable here is the wiring — the
 * method, the origin rules, the header on the way back, and the fact that a
 * record reaches the disk.
 */
describe('receiving a flight record', () => {
  let server: RunningServer;
  let dir: string;

  const post = async (body: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${server.port}${FLIGHT_PATH}`, { method: 'POST', body, headers });

  /** Every line in this run's log, which is the only file in the directory. */
  const lines = async (): Promise<Record<string, unknown>[]> => {
    const [name] = await readdir(dir);
    if (name === undefined) return [];
    const text = await readFile(join(dir, name), 'utf8');
    return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'crow-flight-'));
    server = await startServer({ port: 0, flightDir: dir });
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('appends one line per record, stamped with its own receive time', async () => {
    const before = Date.now();
    expect((await post('{"kind":"beat","raf":7}')).status).toBe(204);
    expect((await post('{"kind":"bye"}')).status).toBe(204);

    const written = await lines();
    expect(written.map((l) => l['kind'])).toEqual(['beat', 'bye']);
    expect(written[0]?.['raf']).toBe(7);
    expect(written[0]?.['srv']).toBeGreaterThanOrEqual(before);
  });

  it('writes nothing at all until a record arrives', async () => {
    // A directory made at startup would appear beside every server anyone
    // ever starts, including each of the dozens this suite starts.
    expect(await readdir(dir)).toEqual([]);
  });

  it('answers the Pages origin with the header that lets the reply be read', async () => {
    // Without it the page's own fetch rejects, the recorder counts a failure,
    // and after five it stops sending — so the header is what keeps a
    // cross-origin recorder alive, not just what lets it read a 204.
    const res = await post('{"kind":"beat"}', { origin: PAGES_ORIGIN });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN);
  });

  it('answers its own origin too, since the Fly build posts cross-origin-shaped', async () => {
    const res = await post('{"kind":"beat"}', { origin: SERVER_ORIGIN });
    expect(res.headers.get('access-control-allow-origin')).toBe(SERVER_ORIGIN);
  });

  it('accepts the page it served itself, whatever address that page was reached at', async () => {
    // The case a play session found and curl could not. A browser sends Origin
    // on every POST, its own page included, so an allowlist of two deployment
    // addresses refused the server's own page on localhost, on 127.0.0.1 and
    // on anything else that is not those two.
    const own = `http://127.0.0.1:${server.port}`;
    const res = await post('{"kind":"hello"}', { origin: own });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(own);
    expect(await lines()).toHaveLength(1);
  });

  it('refuses an origin off the list, and writes nothing for it', async () => {
    // A browser would discard the reply either way. Refusing is about the
    // file: an open sink on a public URL is a file anyone can fill.
    const res = await post('{"kind":"beat"}', { origin: 'https://evil.example.com' });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(await lines()).toEqual([]);
  });

  it('refuses a body that is not a JSON object', async () => {
    expect((await post('[1,2]')).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect(await lines()).toEqual([]);
  });

  it('refuses a body over the cap rather than appending it', async () => {
    const huge = JSON.stringify({ kind: 'beat', pad: 'x'.repeat(MAX_BODY_BYTES + 1) });
    // The connection is destroyed mid-body, so the client may see the 413 or
    // see the socket go; either way what matters is that nothing was written.
    await post(huge).catch(() => undefined);
    expect(await lines()).toEqual([]);
  });

  it('answers 405 to anything but a POST, so a browsed URL is not a record', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}${FLIGHT_PATH}`);
    expect(res.status).toBe(405);
  });

  it('keeps the route off every other path', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/__flightlog`, {
      method: 'POST',
      body: '{"kind":"beat"}',
    });
    expect(res.status).toBe(404);
  });
});
