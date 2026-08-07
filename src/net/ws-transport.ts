/**
 * WebSocket transport for the browser client. Connects to the server,
 * sends and receives protocol messages, queues inbound so the UI can
 * pull on its own time.
 */

import { parseServerMessage, type ClientMessage, type ServerMessage } from './protocol';
import type { Transport, TransportError, TransportState } from './transport';

export interface WsTransportOptions {
  /** The server's URL, e.g. `ws://localhost:8082` or `wss://example.com`. */
  url: string;
  /** How many milliseconds to wait for the server to say WELCOME before giving up. */
  handshakeTimeoutMs?: number;
}

export class WsTransport implements Transport {
  #url: string;
  #handshakeTimeoutMs: number;
  #socket: WebSocket | null = null;
  #queue: ServerMessage[] = [];
  #state: TransportState = 'idle';
  #error: TransportError | undefined;

  constructor(options: WsTransportOptions) {
    this.#url = options.url;
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5000;
  }

  get state(): TransportState {
    return this.#state;
  }

  get error(): TransportError | undefined {
    return this.#error;
  }

  async connect(): Promise<void> {
    if (this.#state !== 'idle') throw new Error(`Cannot connect from state ${this.#state}`);
    this.#state = 'connecting';
    this.#error = undefined;

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.#url);
      const timeout = setTimeout(() => {
        socket.close();
        this.#state = 'error';
        this.#error = 'timeout';
        reject(new Error('handshake timeout'));
      }, this.#handshakeTimeoutMs);

      socket.onopen = () => {
        // Send HELLO, wait for WELCOME
        socket.send(JSON.stringify({ type: 'HELLO', v: 3, name: 'player' }));
      };

      socket.onmessage = (event) => {
        const msg = parseServerMessage(JSON.parse(String(event.data)));
        if (!msg) {
          socket.close();
          this.#state = 'error';
          this.#error = 'protocol_error';
          clearTimeout(timeout);
          reject(new Error('server sent unparseable message'));
          return;
        }

        // First message must be WELCOME; after that, queue everything
        if (msg.type === 'WELCOME') {
          clearTimeout(timeout);
          this.#socket = socket;
          this.#state = 'connected';
          resolve();
        } else {
          this.#queue.push(msg);
        }
      };

      socket.onerror = () => {
        this.#state = 'error';
        this.#error = 'network';
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      };

      socket.onclose = () => {
        if (this.#state === 'connected') this.#state = 'error';
      };
    });
  }

  send(msg: ClientMessage): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send: not connected (state: ${this.#state})`);
    }
    this.#socket.send(JSON.stringify(msg));
  }

  recv(): ServerMessage | undefined {
    return this.#queue.shift();
  }

  close(): void {
    if (this.#socket) {
      this.#socket.close();
      this.#socket = null;
    }
    this.#state = 'idle';
    this.#error = undefined;
    this.#queue = [];
  }
}
