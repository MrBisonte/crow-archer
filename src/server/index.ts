/**
 * Node entry point. This is the only file in the server that knows what a
 * socket is: it assigns each one a connection id, hands frames to Lobby, and
 * writes back whatever Lobby says to send.
 *
 * It also serves the built client, on the same origin as the socket. One
 * process on one URL is the whole deployment, and it is what lets the client
 * derive the server's address from the page it was loaded from instead of
 * having one baked into the bundle at build time.
 *
 * All lobby behaviour lives in lobby.ts and room.ts, which have no I/O and are
 * covered by unit tests. Keep this file thin enough that there is nothing here
 * worth testing through a real port: the flight route's own decisions — the
 * body cap, the line format — live in src/dev/flight-path.ts for that reason,
 * and what is left here is plumbing, which the integration test drives.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { WebSocketServer, type WebSocket } from 'ws';

import { FLIGHT_PATH, MAX_BODY_BYTES, toLine } from '../dev/flight-path';
import { WS_PATH, type PlayerId, type RoomCode, type Snapshot } from '../net/protocol';
import { PAGES_ORIGIN, SERVER_ORIGIN } from '../net/server-url';
import type { InputCommand } from '../sim/input';
import { BattleWorld } from '../sim/battle-world';
import { noiseFor } from '../sim/noise';
import type { WorldFactory } from '../sim/world';
import { FileClientPage, type ClientPage } from './client-page';
import { Lobby, randomRoomCode, type Outbound } from './lobby';
import { RoomStore, type ConnectionId } from './room';
import { Match, TICK_HZ } from './match';

/** Rooms one process will hold. Past this, CREATE_ROOM answers SERVER_FULL. */
const MAX_ROOMS = 500;

/** Milliseconds of simulated time in one tick. */
const TICK_MS = 1000 / TICK_HZ;

/**
 * How often the timer wakes to see whether a tick is due. Well under a tick, so
 * the accumulator is never more than a few milliseconds behind, and the cost is
 * a comparison on the wakeups where nothing is owed.
 */
const TIMER_MS = 4;

/** Most ticks one wakeup will run, so a stall cannot become a longer stall. */
const MAX_CATCHUP_TICKS = 5;

/** Frames larger than this are refused before they are parsed. */
const MAX_FRAME_BYTES = 8 * 1024;

/**
 * Where flight records land when nothing says otherwise: the same gitignored
 * directory the dev sink writes, so running this server locally behaves the
 * way `npm run dev` does. The deployment points FLIGHT_LOG_DIR at a volume,
 * because a machine that restarts mid-hunt would otherwise take the evidence
 * with it — see fly.toml.
 */
const DEFAULT_FLIGHT_DIR = '_flightlogs';

/**
 * The page origins allowed to file a flight record. An allowlist and not `*`:
 * the log is a file on a volume, and a sink open to the web is a sink anyone
 * can fill. Both entries are deployment facts read from their one home in
 * ../net/server-url, which is where the client reads them to decide where to
 * point — a disagreement between the two would present as a CORS error rather
 * than as the typo it is.
 */
const FLIGHT_ORIGINS: readonly string[] = [PAGES_ORIGIN, SERVER_ORIGIN];

export interface ServerOptions {
  port: number;
  maxRooms?: number;
  /**
   * Builds the simulation for a starting match. Injected so a test can run the
   * server against a world it controls, and so replacing the world later is a
   * new implementation rather than an edit in here.
   */
  makeWorld?: WorldFactory;
  /**
   * The built client to serve. Injected for the same reason as the world: a
   * test can hand over a page without a build on disk to point at.
   */
  clientPage?: ClientPage;
  /**
   * Where flight records are appended. Injected for the same reason again: a
   * test needs a directory it owns. The deployment passes a volume mount.
   */
  flightDir?: string;
}

/** The path a load balancer polls to decide the process is alive. */
export const HEALTH_PATH = '/healthz';

/**
 * Narrows a decoded frame to an INPUT before the lobby sees it. Full validation
 * still happens in parseClientMessage for everything else; an input only needs
 * enough shape to reach the match, which then owns the sequence rules.
 */
function isInputFrame(raw: unknown): raw is { type: 'INPUT'; cmd: InputCommand } {
  if (typeof raw !== 'object' || raw === null) return false;
  const frame = raw as Record<string, unknown>;
  if (frame['type'] !== 'INPUT') return false;
  const cmd = frame['cmd'];
  if (typeof cmd !== 'object' || cmd === null) return false;
  const c = cmd as Record<string, unknown>;
  return (
    Number.isInteger(c['seq']) &&
    Number.isInteger(c['buttons']) &&
    typeof c['aimAngle'] === 'number' &&
    Number.isFinite(c['aimAngle'])
  );
}

/** A running server. `port` is the bound one, which matters when asking for 0. */
export interface RunningServer {
  port: number;
  /** Matches currently ticking. Zero once every player has left one. */
  activeMatches: () => number;
  close: () => Promise<void>;
}

/**
 * Starts the lobby server and resolves once it is listening. Pass port 0 to let
 * the OS pick one, which is what the integration test does so runs never
 * collide. The module only listens on its own when run directly.
 */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const rooms = new RoomStore({
    newCode: () => randomRoomCode(),
    maxRooms: options.maxRooms ?? MAX_ROOMS,
  });
  // The full battle: characters, weapons, terrain built from the seed, and the
  // crow that wanders through it.
  const makeWorld: WorldFactory =
    options.makeWorld ??
    ((seed, starts, mode, mapKind) => new BattleWorld({ seed, starts, mode, mapKind, noise: noiseFor }));

  const lobby = new Lobby({
    rooms,
    now: () => Date.now(),
    // uint32, which is what mapgen takes and what MATCH_START carries
    newSeed: () => (Math.random() * 0x100000000) >>> 0,
  });

  const clientPage = options.clientPage ?? new FileClientPage();

  // One file per process start, as the dev sink does it: a restart opens a new
  // log rather than interleaving two runs into one file with no boundary.
  const flightDir = options.flightDir ?? DEFAULT_FLIGHT_DIR;
  const flightFile = join(
    flightDir,
    `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
  );
  // Made on the first record rather than at startup, so a server nobody
  // records against leaves no directory behind — which is every test run.
  let flightDirReady: Promise<unknown> | null = null;
  const appendFlight = (line: string): Promise<void> => {
    flightDirReady ??= mkdir(flightDir, { recursive: true });
    return flightDirReady.then(() => appendFile(flightFile, line));
  };

  /**
   * Takes one flight record from the page (src/dev/flight-recorder.ts).
   *
   * The recorder posts a bare string with no custom header, so its requests are
   * CORS-simple and never preflight — there is no OPTIONS handler here because
   * no browser asks for one. What a cross-origin page does need is the
   * allow-origin header coming back: without it the page's own `fetch` rejects,
   * the recorder counts a failure, and after five it stops sending altogether.
   *
   * An origin off the list is refused rather than merely denied that header. A
   * browser would discard the response either way, but the line would already
   * be in the log, and the point of the list is what gets written. A request
   * with no Origin at all is not a browser — curl, a probe, this test suite —
   * and CORS was never a defence against those.
   */
  const receiveFlight = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const origin = req.headers.origin;
    if (origin !== undefined && !FLIGHT_ORIGINS.includes(origin)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('origin not allowed');
      return;
    }
    const cors = origin === undefined ? {} : { 'access-control-allow-origin': origin };
    // Buffers, decoded once at the end: a multi-byte character split across a
    // chunk boundary decodes to replacement characters if each chunk is
    // stringified on its own, which corrupts a log nobody would question.
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { res.writeHead(413, cors).end(); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;   // the cap already answered
      let line: string;
      try {
        line = `${toLine(Buffer.concat(chunks).toString('utf8'), Date.now())}\n`;
      } catch {
        res.writeHead(400, cors).end();
        return;
      }
      void appendFlight(line)
        .then(() => { res.writeHead(204, cors).end(); })
        // A full disk is the server's fault, not the page's, and saying so is
        // what stops the recorder giving up on a sink that is coming back.
        .catch(() => { res.writeHead(500, cors).end(); });
    });
  };

  // Four routes, so they are read here rather than routed through a table
  // that would have one entry per line and a lookup between them.
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === HEALTH_PATH) {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (path === FLIGHT_PATH) {
      receiveFlight(req, res);
      return;
    }
    if (path !== '/' && path !== '/index.html') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    void clientPage.read().then((html) => {
      if (html === null) {
        // Sockets still work. Saying so beats a bare 404 for the one person
        // who will ever see this, who is running a server with no build.
        res.writeHead(503, { 'content-type': 'text/plain' }).end('no client build to serve');
        return;
      }
      // Never cached. Without a header a browser caches heuristically, and a
      // stale page is a stale client: it may hold an old PROTOCOL_VERSION, and
      // it silently lacks whatever the last build added, which is a confusing
      // way to lose an evening. The page is one request per join, not per frame.
      res
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store, must-revalidate',
        })
        .end(html);
    });
  });

  // Mounted on the HTTP server and on one path, so the same origin carries the
  // page and the socket. A request to any other path is not offered an upgrade.
  const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: MAX_FRAME_BYTES });
  const sockets = new Map<ConnectionId, WebSocket>();
  let nextId: ConnectionId = 0;

  // Matches in progress, keyed by room code
  const matches = new Map<string, Match>();
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Writes one batch. A socket that has gone away is skipped, not awaited.
   *
   * A MATCH_START in the batch is also the signal that a Match is now owed:
   * the lobby decided the room is playing, and this is where that decision
   * turns into a ticking object.
   */
  const send = (out: Outbound[]) => {
    for (const { to, message } of out) {
      const socket = sockets.get(to);
      if (socket?.readyState === socket?.OPEN) socket?.send(JSON.stringify(message));

      // The message carries the seed and the spawn list, which is exactly what
      // a world is built from, so the match is created from what was sent
      // rather than from a second lookup that could disagree with it.
      if (message.type === 'MATCH_START') {
        const view = rooms.viewFor(to);
        if (view && !matches.has(view.code)) {
          matches.set(
            view.code,
            new Match(view, makeWorld(message.seed, message.starts, message.mode, message.mapKind)),
          );
          startTickLoop();
        }
      }
    }
  };

  wss.on('connection', (socket) => {
    const conn = nextId++;
    sockets.set(conn, socket);

    socket.on('message', (data) => {
      // A frame that is not JSON is not a protocol message. Lobby answers
      // BAD_MESSAGE for undefined just as it would for any other junk.
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        raw = undefined;
      }
      // An input belongs to a running match, not to the lobby, so it is routed
      // here rather than through Lobby, which has no match to give it to.
      const match = matchFor(conn);
      if (match && isInputFrame(raw)) {
        match.recordInput(seatOf(conn)!, raw.cmd);
        return;
      }
      send(lobby.receive(conn, raw));
    });

    const drop = () => {
      if (!sockets.delete(conn)) return;   // close and error can both fire
      // Told before the seat is freed: afterwards the room no longer knows
      // which slot this connection held, so the match could not be informed.
      const match = matchFor(conn);
      const seat = seatOf(conn);
      if (match && seat !== null) match.dropSeat(seat);
      send(lobby.close(conn));
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  /** The match a connection is playing in, or null if it is still in a lobby. */
  const matchFor = (conn: ConnectionId): Match | null => {
    const view = rooms.viewFor(conn);
    return view ? matches.get(view.code) ?? null : null;
  };

  /** The seat a connection holds, or null if it holds none. */
  const seatOf = (conn: ConnectionId): PlayerId | null => {
    const view = rooms.viewFor(conn);
    if (!view) return null;
    return rooms.seatsOf(view.code).find((s) => s.conn === conn)?.slot ?? null;
  };

  /** Sends one snapshot to every seat in a room. */
  const broadcast = (code: string, snapshot: Snapshot) => {
    const frame = JSON.stringify({ type: 'SNAPSHOT', snap: snapshot });
    for (const { conn } of rooms.seatsOf(code)) {
      const socket = sockets.get(conn);
      if (socket?.readyState === socket?.OPEN) socket?.send(frame);
    }
  };

  /**
   * Reports a finished match and returns its room to the lobby.
   *
   * A match with a result is one that was played to its end, and everyone still
   * connected is owed the score. A match with no result ended because the last
   * player left, and there is nobody to tell.
   */
  const finish = (code: string, match: Match) => {
    const result = match.result;
    if (result) {
      for (const { conn } of rooms.seatsOf(code)) {
        const socket = sockets.get(conn);
        if (socket?.readyState === socket?.OPEN) {
          socket?.send(JSON.stringify({ type: 'MATCH_END', result }));
        }
      }
    }
    // Back to the lobby either way, so the room can be played again rather than
    // being stuck in a match that is over.
    const view = rooms.endMatch(code as RoomCode);
    if (view) send(lobby.roomState(view));
  };

  /**
   * Steps all running matches at 60 Hz and broadcasts snapshots.
   *
   * The number of steps comes from the clock, not from the number of times the
   * timer fired. `setInterval(1000/60)` is not a 60 Hz clock: on Windows it
   * fires around every 26 ms under load, and stepping once per fire ran the
   * whole world at 38 Hz in slow motion while every client predicted at full
   * speed. Reading the elapsed time instead makes the rate right however badly
   * the timer behaves, and the timer only has to be faster than a tick.
   */
  const startTickLoop = () => {
    if (tickInterval) return;
    let previous = Date.now();
    let owedMs = 0;
    tickInterval = setInterval(() => {
      const now = Date.now();
      owedMs += now - previous;
      previous = now;

      let steps = Math.floor(owedMs / TICK_MS);
      if (steps <= 0) return;
      if (steps > MAX_CATCHUP_TICKS) {
        // A long stall is dropped rather than replayed. Catching up on a
        // second of missed time would stall the process further and teleport
        // everyone, which is worse than losing that second.
        steps = MAX_CATCHUP_TICKS;
        owedMs = 0;
      } else {
        owedMs -= steps * TICK_MS;
      }

      for (let i = 0; i < steps; i++) {
        for (const [code, match] of matches) {
          const snapshot = match.step();
          if (snapshot) broadcast(code, snapshot);
        }
      }

      for (const [code, match] of matches) {
        if (!match.isFinished()) continue;
        finish(code, match);
        matches.delete(code);
      }
      if (matches.size === 0 && tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
    }, TIMER_MS);
  };

  const close = () =>
    new Promise<void>((resolve) => {
      if (tickInterval) clearInterval(tickInterval);
      tickInterval = null;
      matches.clear();
      for (const socket of sockets.values()) socket.terminate();
      sockets.clear();
      // The HTTP server owns the port now, so it is the one that has to give it
      // back. Closing only the socket server would leave the listener open and
      // the next test run would find the port taken.
      wss.close(() => http.close(() => resolve()));
    });

  return new Promise((resolve) => {
    http.listen(options.port, () => {
      const bound = http.address();
      resolve({
        port: typeof bound === 'object' && bound ? bound.port : options.port,
        activeMatches: () => matches.size,
        close,
      });
    });
  });
}

// Run only when invoked directly, so importing this file in a test is free.
// pathToFileURL rather than string building: a Windows path becomes
// file:///C:/... with three slashes, which no hand-rolled template gets right.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // PORT is what every host this deploys to assigns, so it is read and not
  // configured. 8082 is the local default the client falls back to.
  const port = Number(process.env['PORT'] ?? 8082);
  // FLIGHT_LOG_DIR is a volume mount in the deployment so a restart does not
  // take the log with it; unset, records land where the dev sink's do.
  void startServer({ port, flightDir: process.env['FLIGHT_LOG_DIR'] }).then((server) => {
    process.stdout.write(`crow-archer on http://localhost:${server.port} (socket ${WS_PATH})\n`);
  });
}
