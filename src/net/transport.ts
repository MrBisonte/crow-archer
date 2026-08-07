/**
 * Abstract transport for sending and receiving protocol messages. The client
 * uses this to speak to the server without knowing about WebSockets. Tests can
 * inject a fake transport; the real one lives in ws-transport.ts.
 */

import type { ClientMessage, ServerMessage } from './protocol';

/** State the transport is in: idle, connecting, connected, or dead. */
export type TransportState = 'idle' | 'connecting' | 'connected' | 'error';

/** What went wrong, if state is 'error'. */
export type TransportError = 'network' | 'timeout' | 'protocol_error';

/** A transport that queues messages. The UI pulls them when ready. */
export interface Transport {
  state: TransportState;
  error?: TransportError;

  /** Initiates a connection. Completes when the handshake finishes or fails. */
  connect(): Promise<void>;

  /** Sends one message. Throws if not connected. */
  send(msg: ClientMessage): void;

  /**
   * Returns the next queued message, or undefined if the queue is empty. Never
   * blocks — polling is the caller's job.
   */
  recv(): ServerMessage | undefined;

  /** Closes the connection cleanly, if open. */
  close(): void;
}
