/**
 * The roster table itself, checked as a shape rather than through a game.
 *
 * `CHARACTER_STATS` is the one home for what a character is, read by
 * `BattleWorld`, by the legacy single-player game, and by the character-select
 * panel. The compiler already refuses a row that is missing a field; what it
 * cannot check is that the numbers in those rows still say what the design
 * says, which is what this file is for. Every claim below is a sentence from
 * docs/balance.md with the arithmetic done.
 */
import { describe, it, expect } from 'vitest';
import { CHARACTERS, type CharacterKind } from '../net/protocol';
import { CHARACTER_STATS } from './arena';

/** The character with the highest value of one column. */
const peakBy = (pick: (kind: CharacterKind) => number): CharacterKind =>
  [...CHARACTERS].sort((a, b) => pick(b) - pick(a))[0]!;

const hp = (kind: CharacterKind): number => CHARACTER_STATS[kind].maxHp;
const speed = (kind: CharacterKind): number => CHARACTER_STATS[kind].speed;
const dial = (kind: CharacterKind): number => CHARACTER_STATS[kind].bossDamageMult;

describe('CHARACTER_STATS', () => {
  it('has a row for every character the protocol knows about', () => {
    for (const kind of CHARACTERS) {
      const row = CHARACTER_STATS[kind];
      expect(row, kind).toBeDefined();
      for (const field of ['speed', 'maxHp', 'bossDamageMult'] as const) {
        expect(Number.isFinite(row[field]), `${kind}.${field}`).toBe(true);
        expect(row[field], `${kind}.${field}`).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(CHARACTER_STATS).sort()).toEqual([...CHARACTERS].sort());
  });

  it('gives the knight more health than anyone else, on his own', () => {
    // The one stat the player asked for by name: the brawler is the only hero
    // who has to be in contact to do anything, so he is the only one who can
    // afford the extra point.
    expect(peakBy(hp)).toBe('knight');
    for (const kind of CHARACTERS) {
      if (kind !== 'knight') expect(hp(kind), kind).toBeLessThan(hp('knight'));
    }
  });

  it('gives the wizard the hardest hit and the least health, on his own', () => {
    expect(peakBy(dial)).toBe('wizard');
    for (const kind of CHARACTERS) {
      if (kind === 'wizard') continue;
      expect(dial(kind), kind).toBeLessThan(dial('wizard'));
      expect(hp(kind), kind).toBeGreaterThan(hp('wizard'));
    }
  });

  it('gives the ranger the most speed and the softest hit', () => {
    expect(peakBy(speed)).toBe('ranger');
    // The volley is his unit of damage, not the bolt: three at once, each
    // already 30% of an arrow, is why his is the only multiplier under 1.
    expect(dial('ranger')).toBeLessThan(1);
    for (const kind of CHARACTERS) {
      if (kind !== 'ranger') expect(dial(kind), kind).toBeGreaterThan(dial('ranger'));
    }
  });

  it('trades health against speed rather than stacking both on one hero', () => {
    const toughest = peakBy(hp);
    const fastest = peakBy(speed);
    expect(toughest).not.toBe(fastest);
    // And the toughest is the slowest, which is the trade being real rather
    // than merely not-inverted.
    expect(speed(toughest)).toBe(Math.min(...CHARACTERS.map(speed)));
  });

  it('leaves no two characters holding the same three numbers', () => {
    const rows = CHARACTERS.map((kind) => `${speed(kind)}|${hp(kind)}|${dial(kind)}`);
    expect(new Set(rows).size).toBe(CHARACTERS.length);
  });

  it('lets archer and sapper share a body, and differ only in what they throw', () => {
    // Deliberate: they are the pair the rest of the roster is read against, so
    // the one thing separating them should be the weapon.
    expect(hp('archer')).toBe(hp('sapper'));
    expect(speed('archer')).toBe(speed('sapper'));
    expect(dial('archer')).not.toBe(dial('sapper'));
  });
});
