import { describe, expect, it } from 'vitest';

import { EventBus, type GameEvent } from './events';

const killed: GameEvent = { type: 'CROW_KILLED', x: 1, y: 2, white: false, earned: 3 };

describe('EventBus', () => {
  it('dispatches an event to every handler in registration order', () => {
    const bus = new EventBus();
    const order: number[] = [];
    bus.on(() => order.push(1));
    bus.on(() => order.push(2));
    bus.emit(killed);
    expect(order).toEqual([1, 2]);
  });

  it('passes the event through unchanged', () => {
    const bus = new EventBus();
    let received: GameEvent | null = null;
    bus.on(e => (received = e));
    bus.emit(killed);
    expect(received).toEqual(killed);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on(() => count++);
    bus.emit(killed);
    off();
    bus.emit(killed);
    expect(count).toBe(1);
  });

  it('clear removes all handlers', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on(() => count++);
    bus.on(() => count++);
    bus.clear();
    bus.emit(killed);
    expect(count).toBe(0);
  });
});
