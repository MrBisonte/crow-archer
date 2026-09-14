import { describe, expect, it } from 'vitest';

import { FLIGHT_PATH, flightEndpoint } from './flight-path';
import { classify, clientId, mintClientId, stamp } from './flight-recorder';
import type { Pulse } from './flight-recorder';

/** A healthy mid-brawl sample; each case states only what it breaks. */
function pulse(over: Partial<Pulse> = {}): Pulse {
  return {
    state: 'playing', mode: 'brawl', map: 'forest', char: 'archer',
    t: 10, lastTs: 1000, live: true, held: 0, hp: 10, kills: 3,
    crows: 5, skels: 0, soldiers: 0, arrows: 1, boss: null,
    ...over,
  };
}

describe('classify', () => {
  it('is quiet on a healthy advancing sample', () => {
    expect(classify(pulse(), pulse({ lastTs: 1500, t: 10.5 }), true, true)).toBeNull();
  });

  it('is quiet on the very first sample', () => {
    expect(classify(null, pulse(), true, true)).toBeNull();
  });

  it('names a dead loop when the game clock stalls but the page still animates', () => {
    expect(classify(pulse(), pulse(), true, true)).toBe('loop-dead');
  });

  it('names a page-wide stall when nothing animates but the tab claims visible', () => {
    // Not the loop's fault — but it is what a player calls a freeze, and it
    // is exactly how an embedded, throttled view presents. Caught live the
    // first time this recorder ran: the hidden Browser pane starves rAF while
    // visibilityState still says 'visible'.
    expect(classify(pulse(), pulse(), false, true)).toBe('no-frames');
  });

  it('is quiet on no-frames outside a running state: a static screen owes no frames', () => {
    // Menu, gameover and the talent chooser do not animate by design, so a
    // stalled frame clock there is the screen at rest, not a freeze. Before
    // this gate, static-screen no-frames was 11 of the 17 alarms on record,
    // every one of them noise.
    const menu = pulse({ state: 'menu' });
    expect(classify(menu, menu, false, true)).toBeNull();
  });

  it('still names no-frames in the boss fight, where the game owes frames', () => {
    const bf = pulse({ state: 'boss_fight' });
    expect(classify(bf, bf, false, true)).toBe('no-frames');
  });

  it('is quiet while the tab is hidden', () => {
    expect(classify(pulse(), pulse(), true, false)).toBeNull();
  });

  it('is quiet while a harness owns the clock', () => {
    expect(classify(pulse({ live: false }), pulse({ live: false }), true, true)).toBeNull();
  });

  it('names a logic freeze when frames tick but sim time is stuck in play', () => {
    expect(classify(pulse(), pulse({ lastTs: 1500 }), true, true)).toBe('logic-freeze');
  });

  it('also watches the boss fight for a logic freeze', () => {
    const prev = pulse({ state: 'boss_fight' });
    expect(classify(prev, pulse({ state: 'boss_fight', lastTs: 1500 }), true, true)).toBe('logic-freeze');
  });

  it('calls a hitstop sample a logic freeze — the streak is the hitstop filter', () => {
    // A held world is stuck time too, and deliberately so: ALARM_AFTER
    // outlasts the whole hitstop ladder, so a real hitstop never becomes an
    // alarm, while a hitstop that never drains still does.
    expect(classify(pulse(), pulse({ lastTs: 1500, held: 4 }), true, true)).toBe('logic-freeze');
  });

  it('is quiet on stuck sim time outside a run', () => {
    const prev = pulse({ state: 'menu' });
    expect(classify(prev, pulse({ state: 'menu', lastTs: 1500 }), true, true)).toBeNull();
  });

  it('is quiet across a state change even when sim time is stuck', () => {
    // Entering play from the intro: t has not moved yet and should not alarm.
    const prev = pulse({ state: 'stage_intro' });
    expect(classify(prev, pulse({ lastTs: 1500 }), true, true)).toBeNull();
  });
});

describe('where the recorder posts', () => {
  it('stays relative wherever the page came from a server', () => {
    // The vite dev server and the deployed one both serve the page and answer
    // the sink, so neither needs an origin named and both keep the address
    // they have always used.
    expect(flightEndpoint({ protocol: 'http:', host: 'localhost:8081' })).toBe(FLIGHT_PATH);
    expect(flightEndpoint({ protocol: 'https:', host: 'crow-archer.fly.dev' })).toBe(FLIGHT_PATH);
  });

  it('names the deployed server from a static host, which answers no route', () => {
    // Relative here resolves to mrbisonte.github.io/__flight, which 404s —
    // the whole reason the endpoint is a decision rather than a constant.
    expect(flightEndpoint({ protocol: 'https:', host: 'mrbisonte.github.io' })).toBe(
      'https://crow-archer.fly.dev/__flight',
    );
  });
});

describe('the page load id', () => {
  it('mints a fresh id every time it is asked', () => {
    expect(mintClientId()).not.toBe(mintClientId());
  });

  it('mints something non-empty', () => {
    expect(mintClientId().length).toBeGreaterThan(8);
  });

  it('holds one id for the life of the page', () => {
    expect(clientId()).toBe(clientId());
  });

  it('stamps every record, whatever its kind', () => {
    for (const kind of ['hello', 'beat', 'alarm', 'err', 'bye']) {
      expect(stamp({ kind })).toEqual({ cid: clientId(), kind });
    }
  });

  it('stamps the goodbye too, which is what makes an orphan attributable', () => {
    // The sink opens a new file per dev server run. A page that outlives the
    // server sends its `bye` into a file that never saw its `hello`; without
    // an id on the goodbye there is nothing to tie it back to.
    expect(stamp({ kind: 'bye', wall: 1, events: [] }).cid).toBe(clientId());
  });

  it('leaves the payload alone otherwise', () => {
    const payload = { kind: 'beat', wall: 42, events: [] };
    expect(stamp(payload)).toMatchObject(payload);
  });

  it('lets an explicit cid win, so a caller can always be explicit', () => {
    expect(stamp({ kind: 'beat', cid: 'chosen' }).cid).toBe('chosen');
  });
});
