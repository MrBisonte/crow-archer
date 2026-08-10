import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, type ServerMessage } from './protocol';
import type { Transport } from './transport';
import { DEFAULT_WIN_CONDITION } from './protocol';

/**
 * Fake transport for unit tests. Accepts messages in a scripted order and
 * returns them when asked. Never connects to a socket.
 */
export class FakeTransport implements Transport {
  #state: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  #error: undefined;
  #sent: string[] = [];
  #responses: ServerMessage[] = [];
  #nextResponse = 0;

  get state() {
    return this.#state;
  }

  get error() {
    return this.#error;
  }

  async connect(): Promise<void> {
    this.#state = 'connecting';
    await Promise.resolve();  // one tick
    this.#state = 'connected';
  }

  send(msg: any): void {
    if (this.#state !== 'connected') throw new Error('not connected');
    this.#sent.push(JSON.stringify(msg));
  }

  recv() {
    if (this.#nextResponse >= this.#responses.length) return undefined;
    return this.#responses[this.#nextResponse++];
  }

  close(): void {
    this.#state = 'idle';
    this.#sent = [];
    this.#responses = [];
    this.#nextResponse = 0;
  }

  /** For tests: inject responses that will be returned by recv(). */
  injectResponses(...responses: ServerMessage[]): void {
    this.#responses.push(...responses);
  }

  /** For tests: get all messages that were sent. */
  getSent(): any[] {
    return this.#sent.map((s) => JSON.parse(s));
  }
}

describe('Transport', () => {
  it('lets tests queue responses and verify sends', async () => {
    const t = new FakeTransport();
    expect(t.state).toBe('idle');

    await t.connect();
    expect(t.state).toBe('connected');

    t.injectResponses({ type: 'ROOM_STATE', code: 'AAAA', mode: 'coop', host: 0, slots: [], you: 0, win: DEFAULT_WIN_CONDITION });
    t.send({ type: 'CREATE_ROOM' });

    expect(t.recv()).toMatchObject({ type: 'ROOM_STATE' });
    expect(t.recv()).toBeUndefined();
    expect(t.getSent()).toEqual([{ type: 'CREATE_ROOM' }]);

    t.close();
    expect(t.state).toBe('idle');
  });
});
