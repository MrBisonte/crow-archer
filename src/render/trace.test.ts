import { describe, expect, it } from 'vitest';

import {
  FrameTrace,
  SPANS,
  countingContext,
  formatSpan,
  newCounters,
  type OpCounters,
  type SpanName,
} from './trace';

/**
 * A clock the test drives by hand, so a span's duration is stated rather than
 * measured. It also counts its own reads: "tracing off costs nothing" is
 * checkable as "the clock was never asked what time it is".
 */
function scriptedClock(): { now: () => number; advance: (ms: number) => void; reads: () => number } {
  let t = 0;
  let reads = 0;
  return {
    now: () => { reads++; return t; },
    advance: (ms: number) => { t += ms; },
    reads: () => reads,
  };
}

/**
 * The slice of the canvas surface these tests drive. Named rather than indexed
 * off a `Record`, so calling one is a checked call and not an index that
 * strict mode has to be told cannot be undefined.
 */
interface Surface {
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(...args: unknown[]): void;
  fill(): void;
  stroke(): void;
  save(): void;
  translate(x: number, y: number): void;
  fillStyle: string;
}

/** Records every call and property write, like the fake in tiles.test.ts. */
function fakeTarget(): { ctx: Record<string, unknown>; calls: string[]; sets: [string, unknown][] } {
  const calls: string[] = [];
  const sets: [string, unknown][] = [];
  const ctx: Record<string, unknown> = {
    fillRect: () => { calls.push('fillRect'); },
    drawImage: () => { calls.push('drawImage'); },
    fill: () => { calls.push('fill'); },
    stroke: () => { calls.push('stroke'); },
    save: () => { calls.push('save'); },
    translate: () => { calls.push('translate'); },
    fillStyle: '#000',
  };
  return {
    ctx: new Proxy(ctx, {
      set(obj, prop, value): boolean {
        if (typeof prop === 'string') sets.push([prop, value]);
        return Reflect.set(obj, prop, value);
      },
    }),
    calls,
    sets,
  };
}

describe('FrameTrace, off', () => {
  it('never reads the clock, so a disabled span costs one comparison', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    for (let i = 0; i < 100; i++) {
      t.beginFrame();
      for (const span of SPANS) t.mark(span);
      t.endFrame();
    }
    expect(clock.reads()).toBe(0);
    expect(t.frames()).toBe(0);
  });

  it('reports a zeroed row for every span rather than a missing key', () => {
    const summary = new FrameTrace().summary();
    expect(Object.keys(summary).sort()).toEqual([...SPANS].sort());
    for (const span of SPANS) expect(summary[span].ms).toBe(0);
  });
});

describe('FrameTrace, timing', () => {
  it('charges each span exactly the time that elapsed while it was open', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    t.setLevel('time');

    t.beginFrame();
    t.mark('sim');      clock.advance(4);
    t.mark('tiles');    clock.advance(1);
    t.mark('fog');      clock.advance(9);
    t.endFrame();

    const s = t.summary();
    expect(s.sim.ms).toBe(4);
    expect(s.tiles.ms).toBe(1);
    expect(s.fog.ms).toBe(9);
    // A span the frame never opened is zero, not undefined and not the
    // previous frame's value.
    expect(s.hud.ms).toBe(0);
  });

  it('averages over the frames it holds', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    t.setLevel('time');
    for (const ms of [2, 4, 6]) {
      t.beginFrame();
      t.mark('fog'); clock.advance(ms);
      t.endFrame();
    }
    expect(t.frames()).toBe(3);
    expect(t.summary().fog.ms).toBe(4);
  });

  it('keeps the worst frame separately, because an average hides a hitch', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    t.setLevel('time');
    for (const ms of [1, 1, 1, 40]) {
      t.beginFrame();
      t.mark('fog'); clock.advance(ms);
      t.endFrame();
    }
    expect(t.summary().fog.ms).toBeCloseTo(10.75, 5);
    expect(t.summary().fog.msMax).toBe(40);
  });

  it('drops the oldest frame once the ring is full', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now, capacity: 3 });
    t.setLevel('time');
    for (const ms of [100, 2, 2, 2]) {
      t.beginFrame();
      t.mark('fog'); clock.advance(ms);
      t.endFrame();
    }
    expect(t.frames()).toBe(3);
    // The 100 has aged out; had it not, the average would be 26.5.
    expect(t.summary().fog.ms).toBe(2);
  });
});

describe('FrameTrace, op counts', () => {
  /** Moves the counters the way a wrapped context would. */
  const paint = (c: OpCounters, rects: number, px: number): void => {
    c.fillRect += rects;
    c.px += px;
  };

  it('charges ops to whichever span was open when they happened', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    t.setLevel('ops');

    t.beginFrame();
    t.mark('tiles');  paint(t.counters, 3, 300);
    t.mark('fog');    paint(t.counters, 50, 5000);
    t.endFrame();

    const s = t.summary();
    expect(s.tiles.fillRect).toBe(3);
    expect(s.tiles.px).toBe(300);
    expect(s.fog.fillRect).toBe(50);
    expect(s.fog.px).toBe(5000);
  });

  it('starts each frame from zero rather than accumulating across frames', () => {
    const t = new FrameTrace();
    t.setLevel('ops');
    for (let i = 0; i < 4; i++) {
      t.beginFrame();
      t.mark('fog'); paint(t.counters, 10, 1000);
      t.endFrame();
    }
    expect(t.summary().fog.fillRect).toBe(10);
  });

  it('records no op counts at the time level, even while the counters move', () => {
    const t = new FrameTrace();
    t.setLevel('time');
    t.beginFrame();
    t.mark('fog'); paint(t.counters, 99, 9999);
    t.endFrame();
    expect(t.summary().fog.fillRect).toBe(0);
    expect(t.summary().fog.px).toBe(0);
  });
});

describe('FrameTrace, misuse', () => {
  it('ignores a mark outside a frame instead of opening a phantom one', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    t.setLevel('time');
    t.mark('fog');
    clock.advance(5);
    t.endFrame();
    expect(t.frames()).toBe(0);
    expect(t.summary().fog.ms).toBe(0);
  });

  it('drops a frame that was begun and never ended rather than half-recording it', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    t.setLevel('time');
    t.beginFrame();
    t.mark('fog'); clock.advance(3);
    t.beginFrame();                       // the frame above is abandoned
    t.mark('fog'); clock.advance(7);
    t.endFrame();
    expect(t.frames()).toBe(1);
    expect(t.summary().fog.ms).toBe(7);
  });

  it('forgets everything on reset, so one measurement cannot leak into the next', () => {
    const clock = scriptedClock();
    const t = new FrameTrace({ clock: clock.now });
    t.setLevel('time');
    t.beginFrame(); t.mark('fog'); clock.advance(8); t.endFrame();
    t.reset();
    expect(t.frames()).toBe(0);
    expect(t.summary().fog.ms).toBe(0);
  });
});

describe('countingContext', () => {
  it('tallies the four drawing calls it is asked about', () => {
    const counts = newCounters();
    const { ctx, calls } = fakeTarget();
    const g = countingContext(ctx, counts) as unknown as Surface;

    g.fillRect(0, 0, 10, 4);
    g.fillRect(0, 0, 2, 2);
    g.fill();
    g.stroke();
    g.stroke();

    expect(counts.fillRect).toBe(2);
    expect(counts.fill).toBe(1);
    expect(counts.stroke).toBe(2);
    // Everything still reached the real context.
    expect(calls).toEqual(['fillRect', 'fillRect', 'fill', 'stroke', 'stroke']);
  });

  it('measures filled area, which is what a fill actually costs', () => {
    const counts = newCounters();
    const g = countingContext(fakeTarget().ctx, counts) as unknown as Surface;
    g.fillRect(0, 0, 10, 4);
    g.fillRect(5, 5, 100, 7);
    expect(counts.px).toBe(40 + 700);
  });

  it('counts a negative-extent rect as the area it covers, not a negative one', () => {
    const counts = newCounters();
    const g = countingContext(fakeTarget().ctx, counts) as unknown as Surface;
    g.fillRect(10, 10, -4, -5);
    expect(counts.px).toBe(20);
  });

  it('reads the drawn area from whichever drawImage overload was used', () => {
    const counts = newCounters();
    const g = countingContext(fakeTarget().ctx, counts) as unknown as Surface;
    const img = { width: 8, height: 3 };
    g.drawImage(img, 0, 0);                              // 3-arg: the source's own size
    g.drawImage(img, 100, 100, 20, 5);                   // 5-arg: the destination size
    g.drawImage(img, 0, 0, 8, 3, 0, 0, 40, 2);           // 9-arg: the destination size
    expect(counts.drawImage).toBe(3);
    expect(counts.px).toBe(24 + 100 + 80);
  });

  it('passes through everything it does not count, in both directions', () => {
    const counts = newCounters();
    const target = fakeTarget();
    const g = countingContext(target.ctx, counts) as unknown as Surface;

    g.save();
    g.translate(4, 5);
    g.fillStyle = '#39FF14';

    expect(target.calls).toEqual(['save', 'translate']);
    expect(target.sets).toEqual([['fillStyle', '#39FF14']]);
    expect(g.fillStyle).toBe('#39FF14');
    expect(counts.fillRect).toBe(0);
  });

  it('hands back the same wrapper for a method every time, so a hot loop allocates none', () => {
    const g = countingContext(fakeTarget().ctx, newCounters()) as unknown as Surface;
    expect(g.fillRect).toBe(g.fillRect);
  });
});

describe('formatSpan', () => {
  const stats = {
    ms: 0.8051, msMax: 3.2, fillRect: 1870.4, drawImage: 3, fill: 0, stroke: 0, px: 7_700_000,
  };

  it('leads with the name and the two numbers a frame budget is judged on', () => {
    const line = formatSpan('fog', stats);
    expect(line.startsWith('fog')).toBe(true);
    expect(line).toContain('0.81');
    expect(line).toContain('3.20');
  });

  it('reports fills as a count and area as megapixels, the units they were measured in', () => {
    const line = formatSpan('fog', stats);
    expect(line).toContain('1870');
    expect(line).toContain('7.70');
  });

  it('pads to a fixed width so the rows line up as a column', () => {
    const short = formatSpan('fog', stats);
    const long = formatSpan('vignette', stats);
    expect(long.length).toBe(short.length);
  });
});

describe('SPANS', () => {
  it('names every section the render pass is split into, once each', () => {
    expect(new Set(SPANS).size).toBe(SPANS.length);
    // The set the overlay draws and the budgets assert against is this one.
    const expected: SpanName[] = ['sim', 'tiles', 'fog', 'bodies', 'vignette', 'hud'];
    expect([...SPANS]).toEqual(expected);
  });
});
