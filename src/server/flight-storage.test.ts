/**
 * The storage guard's decisions, which are the part worth testing without a
 * disk. Reading the volume is one statfs call; deciding what to do about the
 * number is where a mistake sends thirty mails or none.
 */
import { describe, expect, it } from 'vitest';

import { ALERT_BANDS, STOP_AT, accepts, alertText, bandToAlert, currentBand }
  from './flight-storage';

describe('accepts', () => {
  it('takes a record below the stop mark', () => {
    expect(accepts(0.79)).toBe(true);
  });

  it('refuses at the stop mark, not past it', () => {
    expect(accepts(STOP_AT)).toBe(false);
    expect(accepts(0.99)).toBe(false);
  });
});

describe('currentBand', () => {
  it('is null below every band', () => {
    expect(currentBand(0)).toBeNull();
    expect(currentBand(0.59)).toBeNull();
  });

  it('is the highest band reached', () => {
    expect(currentBand(0.6)).toBe(0.6);
    expect(currentBand(0.75)).toBe(0.7);
    expect(currentBand(1)).toBe(0.9);
  });
});

describe('bandToAlert', () => {
  it('reports the first crossing', () => {
    expect(bandToAlert(0.61, null)).toBe(0.6);
  });

  it('stays silent while nothing new is crossed', () => {
    expect(bandToAlert(0.61, 0.6)).toBeNull();
    expect(bandToAlert(0.69, 0.6)).toBeNull();
  });

  it('reports the next band up', () => {
    expect(bandToAlert(0.71, 0.6)).toBe(0.7);
  });

  it('reports once when several bands are passed at a stroke', () => {
    expect(bandToAlert(0.95, null)).toBe(0.9);
  });

  it('says nothing at all below the lowest band', () => {
    expect(bandToAlert(0.1, null)).toBeNull();
  });

  it('reports again after a fall and a second climb', () => {
    // The caller stores currentBand after every check, so emptying the volume
    // is what lowers the mark. 0.3 remembers null, and the climb re-reports.
    expect(currentBand(0.3)).toBeNull();
    expect(bandToAlert(0.61, currentBand(0.3))).toBe(0.6);
  });
});

describe('alertText', () => {
  const volume = { usedFraction: 0.82, totalBytes: 1e9, freeBytes: 18e7 };

  it('says the sink has stopped once it has', () => {
    const text = alertText(0.8, volume, '/data');
    expect(text).toContain('STOPPED');
    expect(text).toContain('507');
  });

  it('says what it will do, while it is still only filling', () => {
    const text = alertText(0.6, { ...volume, usedFraction: 0.61 }, '/data');
    expect(text).not.toContain('STOPPED');
    expect(text).toContain('stops accepting records');
  });

  it('names the mount, so two volumes cannot be confused', () => {
    expect(alertText(0.6, volume, '/data')).toContain('/data');
  });
});

describe('the bands themselves', () => {
  it('ascend, which bandToAlert relies on to take the last as the highest', () => {
    expect([...ALERT_BANDS]).toEqual([...ALERT_BANDS].sort((a, b) => a - b));
  });

  it('include the mark the sink actually stops at', () => {
    expect(ALERT_BANDS).toContain(STOP_AT);
  });
});
