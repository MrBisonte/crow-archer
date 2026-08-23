import { describe, it, expect, vi } from 'vitest';
import { Logger, attachToEvents, type LogEvent } from './log';
import { EventBus } from './events';

/** A deterministic clock: each call returns the next multiple of 10. */
function fakeClock(): () => number {
  let t = 0;
  return () => (t += 10);
}

describe('Logger levels', () => {
  it('defaults to warn: info and debug are dropped, warn and error are kept', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.debug('test', 'a debug line');
    logger.info('test', 'an info line');
    logger.warn('test', 'a warn line');
    logger.error('test', 'an error line');
    const levels = logger.events().map((e) => e.level);
    expect(levels).toEqual(['warn', 'error']);
  });

  it('setLevel raises or lowers the floor', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.setLevel('debug');
    logger.debug('test', 'now visible');
    expect(logger.events()).toHaveLength(1);

    logger.setLevel('error');
    logger.debug('test', 'dropped again');
    logger.warn('test', 'also dropped');
    expect(logger.events()).toHaveLength(1); // unchanged
  });

  it('currentLevel reports what setLevel last set, default warn', () => {
    const logger = new Logger({ clock: fakeClock() });
    expect(logger.currentLevel()).toBe('warn');
    logger.setLevel('debug');
    expect(logger.currentLevel()).toBe('debug');
  });
});

describe('Logger event shape', () => {
  it('every event carries a monotonic id, the level, timestamp, source, and message', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.setLevel('debug');
    logger.debug('updatePlayer', 'collision check passed', { x: 100, y: 200 });
    logger.info('transitionTo', 'menu -> charselect');

    const [first, second] = logger.events();
    expect(first).toMatchObject({
      id: 1, level: 'debug', timestamp: 10, source: 'updatePlayer',
      message: 'collision check passed', data: { x: 100, y: 200 },
    });
    expect(second).toMatchObject({ id: 2, level: 'info', timestamp: 20, source: 'transitionTo' });
  });

  it('error() accepts an optional code, other levels have none', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.error('mapGen', 'cavern disconnected', 'map-gen-disconnected', { seed: 42 });
    logger.warn('foo', 'no code on this one');

    const [errEvent, warnEvent] = logger.events();
    expect(errEvent!.code).toBe('map-gen-disconnected');
    expect(warnEvent!.code).toBeUndefined();
  });

  it('ids are monotonic and never reused, even across levels', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.setLevel('debug');
    for (let i = 0; i < 5; i++) logger.debug('loop', `entry ${i}`);
    const ids = logger.events().map((e) => e.id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('Logger ring buffer', () => {
  it('drops the oldest event once capacity is exceeded, keeps the newest', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent', capacity: 3 });
    logger.setLevel('debug');
    for (let i = 0; i < 5; i++) logger.debug('loop', `entry ${i}`);
    const messages = logger.events().map((e) => e.message);
    expect(messages).toEqual(['entry 2', 'entry 3', 'entry 4']);
  });

  it('events() returns a copy: mutating the result does not affect the logger', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.warn('test', 'one');
    const snapshot = logger.events() as LogEvent[];
    snapshot.pop();
    expect(logger.events()).toHaveLength(1);
  });

  it('clear() empties the ring and resets ids back to 1', () => {
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.warn('test', 'one');
    logger.warn('test', 'two');
    logger.clear();
    expect(logger.events()).toHaveLength(0);
    logger.warn('test', 'three');
    expect(logger.events()[0]!.id).toBe(1);
  });
});

describe('Logger console mirroring', () => {
  it('mirrors to console at/above consoleLevel, independent of the ring buffer level', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = new Logger({ clock: fakeClock(), consoleLevel: 'info' });
      logger.setLevel('debug'); // kept in the ring, but below consoleLevel
      logger.debug('test', 'ring only, no console');
      logger.info('test', 'both ring and console');
      logger.warn('test', 'warn goes to console.warn');
      logger.error('test', 'error goes to console.error');

      expect(logger.events()).toHaveLength(4); // ring keeps everything >= its own level
      expect(logSpy).toHaveBeenCalledTimes(1); // only the info line
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore();
    }
  });

  it("consoleLevel: 'silent' mirrors nothing, even for error", () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
      logger.error('test', 'should not print');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(logger.events()).toHaveLength(1); // still recorded
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('attachToEvents', () => {
  it('records every emitted gameplay event as a debug-level entry tagged EventBus', () => {
    const bus = new EventBus();
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.setLevel('debug');
    attachToEvents(logger, bus);

    bus.emit({ type: 'CROW_KILLED', x: 10, y: 20, white: false, earned: 1 });
    bus.emit({ type: 'ARROW_MISS' });

    const events = logger.events();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ level: 'debug', source: 'EventBus', message: 'CROW_KILLED', data: { x: 10, y: 20, white: false, earned: 1 } });
    expect(events[1]).toMatchObject({ source: 'EventBus', message: 'ARROW_MISS' });
  });

  it('respects the logger\'s own level: attached at warn, gameplay events (debug) are dropped', () => {
    const bus = new EventBus();
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' }); // default level: warn
    attachToEvents(logger, bus);
    bus.emit({ type: 'ARROW_MISS' });
    expect(logger.events()).toHaveLength(0);
  });

  it('returns an unsubscribe function that stops further recording', () => {
    const bus = new EventBus();
    const logger = new Logger({ clock: fakeClock(), consoleLevel: 'silent' });
    logger.setLevel('debug');
    const unsubscribe = attachToEvents(logger, bus);

    bus.emit({ type: 'ARROW_MISS' });
    unsubscribe();
    bus.emit({ type: 'ARROW_MISS' });

    expect(logger.events()).toHaveLength(1);
  });
});
