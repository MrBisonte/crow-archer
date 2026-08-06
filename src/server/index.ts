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

import { Lobby, randomRoomCode, type Outbound } from './lobby';
import { RoomStore, type ConnectionId } from './room';

/** Rooms one process will hold. Past this, CREATE_ROOM answers SERVER_FULL. */
const MAX_ROOMS = 500;

/** Frames larger than this are refused before they are parsed. */
const MAX_FRAME_BYTES = 8 * 1024;

export interface ServerOptions {
  port: number;
  maxRooms?: number;
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
  const lobby = new Lobby({ rooms, now: () => Date.now() });

  const wss = new WebSocketServer({ port: options.port, maxPayload: MAX_FRAME_BYTES });
  const sockets = new Map<ConnectionId, WebSocket>();
  let nextId: ConnectionId = 0;

  /** Writes one batch. A socket that has gone away is skipped, not awaited. */
  const send = (out: Outbound[]) => {
    for (const { to, message } of out) {
      const socket = sockets.get(to);
      if (socket?.readyState === socket?.OPEN) socket?.send(JSON.stringify(message));
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
      send(lobby.receive(conn, raw));
    });

    const drop = () => {
      if (!sockets.delete(conn)) return;   // close and error can both fire
      send(lobby.close(conn));
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  const close = () =>
    new Promise<void>((resolve) => {
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
