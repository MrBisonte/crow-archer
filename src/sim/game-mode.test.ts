import { describe, it, expect } from 'vitest';
import {
  MODE_RULES, SINGLE_PLAYER_MODES, isSinglePlayerMode, modeRule, picksItsMap,
  type SinglePlayerMode,
} from './game-mode';

describe('single player mode table', () => {
  it('has a row for every mode, and no rows for anything else', () => {
    // Driven off the table both ways so neither the union nor the list can
    // grow without the other noticing.
    expect(SINGLE_PLAYER_MODES).toEqual(['brawl', 'waves']);
    expect(Object.keys(MODE_RULES).sort()).toEqual([...SINGLE_PLAYER_MODES].sort());
  });

  it('gives a fixed-map mode a map and a free-map mode none', () => {
    // The pairing the ModeRule comment argues for: these two fields have to
    // agree, and a row that says 'fixed' with nothing to fix on would send
    // initGame to `undefined`.
    for (const mode of SINGLE_PLAYER_MODES) {
      const rule = MODE_RULES[mode];
      if (rule.mapChoice === 'fixed') expect(rule.fixedMap).not.toBeNull();
      else expect(rule.fixedMap).toBeNull();
    }
  });

  it('states brawl as the short sprint and waves as the long climb', () => {
    expect(MODE_RULES.brawl).toMatchObject({
      label: 'BRAWL',
      mapChoice: 'fixed',
      fixedMap: 'forest',
      waveScaling: false,
      bossTrigger: 'killCount',
      runsCastleGauntlet: true,
      announcesWaves: false,
      summaryStat: 'kills',
    });
    expect(MODE_RULES.waves).toMatchObject({
      label: 'WAVES',
      mapChoice: 'free',
      fixedMap: null,
      waveScaling: true,
      bossTrigger: 'none',
      runsCastleGauntlet: false,
      announcesWaves: true,
      summaryStat: 'wave',
    });
  });

  it('lets exactly one mode run the castle gauntlet', () => {
    // Two sites read this one field — the gauntlet's own advance and the
    // escalation timer's bail-out. If a second mode ever answers true, both
    // have to be looked at together, which is the whole reason it is one
    // field rather than two.
    const runners = SINGLE_PLAYER_MODES.filter((m) => MODE_RULES[m].runsCastleGauntlet);
    expect(runners).toEqual(['brawl']);
  });

  it('gives every mode a distinct label', () => {
    const labels = SINGLE_PLAYER_MODES.map((m) => MODE_RULES[m].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('narrowing an untrusted mode string', () => {
  it('accepts the real modes and rejects everything else', () => {
    for (const mode of SINGLE_PLAYER_MODES) expect(isSinglePlayerMode(mode)).toBe(true);
    for (const junk of ['BRAWL', 'siege', '', 'toString', null, undefined, 7, {}]) {
      expect(isSinglePlayerMode(junk)).toBe(false);
    }
  });

  it('does not mistake an inherited Object property for a mode', () => {
    // hasOwnProperty rather than `v in MODE_RULES`, because `in` walks the
    // prototype and would have said yes to 'constructor'.
    expect(isSinglePlayerMode('constructor')).toBe(false);
    expect(isSinglePlayerMode('hasOwnProperty')).toBe(false);
  });

  it('falls back to brawl rather than throwing, since the draw loop reads it', () => {
    expect(modeRule('nonsense')).toBe(MODE_RULES.brawl);
    expect(modeRule(undefined)).toBe(MODE_RULES.brawl);
    expect(modeRule('waves')).toBe(MODE_RULES.waves);
  });
});

describe('picksItsMap', () => {
  it('sends only the free-choice mode through mapselect', () => {
    expect(picksItsMap('waves')).toBe(true);
    expect(picksItsMap('brawl')).toBe(false);
  });

  it('agrees with the table for every mode', () => {
    for (const mode of SINGLE_PLAYER_MODES) {
      expect(picksItsMap(mode)).toBe(MODE_RULES[mode].mapChoice === 'free');
    }
  });
});

describe('the table is the only place a mode is described', () => {
  it('answers every question the legacy comparisons used to ask', () => {
    // One assertion per field, so a field deleted in a future refactor takes
    // this test with it rather than silently reducing coverage.
    const fields: readonly (keyof (typeof MODE_RULES)[SinglePlayerMode])[] = [
      'label', 'mapChoice', 'fixedMap', 'waveScaling',
      'bossTrigger', 'runsCastleGauntlet', 'announcesWaves', 'summaryStat',
    ];
    for (const mode of SINGLE_PLAYER_MODES) {
      for (const field of fields) {
        expect(MODE_RULES[mode], `${mode}.${String(field)}`).toHaveProperty(field);
      }
    }
    expect(fields).toHaveLength(8);
  });
});
