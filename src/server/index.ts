/**
 * Node entry point. This is the only file in the server that knows what a
 * socket is: it assigns each one a connection id, hands frames to Lobby, and
 * writes back whatever Lobby says to send.
 *
 * All lobby behaviour lives in lobby.ts and room.ts, which have no I/O and are
 * covered by unit tests. Keep this file thin enough that there is nothing here
 * worth testing through a real port.
 */

import { pathToFileURL } from 'node:url';

import { WebSocketServer, type WebSocket } from 'ws';

import type { PlayerId } from '../net/protocol';
import type { InputCommand } from '../sim/input';
import { Lobby, randomRoomCode, type Outbound } from './lobby';
import { RoomStore, type ConnectionId } from './room';
import { Match } from './match';

/** Rooms one process will hold. Past this, CREATE_ROOM answers SERVER_FULL. */
const MAX_ROOMS = 500;

/** Frames larger than this are refused before they are parsed. */
const MAX_FRAME_BYTES = 8 * 1024;

export interface ServerOptions {
  port: number;
  maxRooms?: number;
}

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
  const lobby = new Lobby({
    rooms,
    now: () => Date.now(),
    // uint32, which is what mapgen takes and what MATCH_START carries
    newSeed: () => (Math.random() * 0x100000000) >>> 0,
  });

  const wss = new WebSocketServer({ port: options.port, maxPayload: MAX_FRAME_BYTES });
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

      if (message.type === 'MATCH_START') {
        const view = rooms.viewFor(to);
        if (view && !matches.has(view.code)) {
          matches.set(view.code, new Match(view));
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

  /** Steps all running matches at 60 Hz and broadcasts snapshots. */
  const startTickLoop = () => {
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      for (const [code, match] of matches) {
        const snapshot = match.step();
        if (snapshot) {
          // Broadcast to all seats in this room
          for (const { conn } of rooms.seatsOf(code)) {
            const socket = sockets.get(conn);
            if (socket?.readyState === socket?.OPEN) {
              socket?.send(JSON.stringify({ type: 'SNAPSHOT', snap: snapshot }));
            }
          }
        }
        if (match.isFinished()) matches.delete(code);
      }
      if (matches.size === 0 && tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
    }, 1000 / 60);
  };

  const close = () =>
    new Promise<void>((resolve) => {
      if (tickInterval) clearInterval(tickInterval);
      tickInterval = null;
      matches.clear();
      for (const socket of sockets.values()) socket.terminate();
      sockets.clear();
      wss.close(() => resolve());
    });

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const bound = wss.address();
      resolve({ port: typeof bound === 'object' && bound ? bound.port : options.port, close });
    });
  });
}

// Run only when invoked directly, so importing this file in a test is free.
// pathToFileURL rather than string building: a Windows path becomes
// file:///C:/... with three slashes, which no hand-rolled template gets right.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['PORT'] ?? 8082);
  void startServer({ port }).then((server) => {
    process.stdout.write(`crow-archer lobby listening on ${server.port}\n`);
  });
}
