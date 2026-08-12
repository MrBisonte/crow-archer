import { describe, expect, it } from 'vitest';

import {
  ShotFlavourCode,
  packPlayerState,
  packShotState,
  unpackPlayerState,
  unpackShotState,
} from './entity-state';

const TAU = Math.PI * 2;

describe('player state packing', () => {
  const roundTrip = (v: Parameters<typeof packPlayerState>[0]) =>
    unpackPlayerState(packPlayerState(v));

  it('carries the flags back', () => {
    expect(roundTrip({ dead: true, shielded: false, aim: 0, swing: 0, dynamite: 0 })).toMatchObject({
      dead: true,
      shielded: false,
    });
    expect(roundTrip({ dead: false, shielded: true, aim: 0, swing: 0, dynamite: 0 })).toMatchObject({
      dead: false,
      shielded: true,
    });
  });

  it('carries both flags at once, since a shielded body can also go down', () => {
    expect(roundTrip({ dead: true, shielded: true, aim: 0, swing: 0, dynamite: 0 })).toMatchObject({
      dead: true,
      shielded: true,
    });
  });

  it('keeps the aim angle within the quantisation step', () => {
    for (const aim of [0, 0.5, 1, 2, 3, 4, 5, 6.2]) {
      const back = roundTrip({ dead: false, shielded: false, aim, swing: 0, dynamite: 0 });
      expect(Math.abs(back.aim - aim)).toBeLessThan(TAU / 256 + 1e-9);
    }
  });

  it('normalises a negative angle instead of letting the sign reach the flags', () => {
    const back = roundTrip({ dead: false, shielded: false, aim: -Math.PI / 2, swing: 0, dynamite: 0 });
    expect(back.dead).toBe(false);
    expect(back.shielded).toBe(false);
    expect(Math.abs(back.aim - (TAU - Math.PI / 2))).toBeLessThan(TAU / 256 + 1e-9);
  });

  it('normalises an angle past a full turn', () => {
    const back = roundTrip({ dead: false, shielded: false, aim: TAU + 1, swing: 0, dynamite: 0 });
    expect(Math.abs(back.aim - 1)).toBeLessThan(TAU / 256 + 1e-9);
  });

  it('carries swing progress back to within a sixteenth', () => {
    for (const swing of [0, 0.25, 0.5, 0.75, 0.99]) {
      const back = roundTrip({ dead: false, shielded: false, aim: 0, swing, dynamite: 0 });
      expect(Math.abs(back.swing - swing)).toBeLessThan(1 / 16 + 1e-9);
    }
  });

  it('reports not swinging as exactly zero, so a rest pose is never a swing', () => {
    expect(roundTrip({ dead: false, shielded: false, aim: 1, swing: 0, dynamite: 0 }).swing).toBe(0);
  });

  it('keeps every field independent', () => {
    const back = roundTrip({ dead: true, shielded: true, aim: 3, swing: 0.5, dynamite: 0 });
    expect(back.dead).toBe(true);
    expect(back.shielded).toBe(true);
    expect(Math.abs(back.aim - 3)).toBeLessThan(TAU / 256 + 1e-9);
    expect(Math.abs(back.swing - 0.5)).toBeLessThan(1 / 16 + 1e-9);
  });

  it('carries the sticks left, so the HUD can say what you have', () => {
    for (const dynamite of [0, 1, 4, 7]) {
      expect(roundTrip({ dead: false, shielded: false, aim: 0, swing: 0, dynamite }).dynamite)
        .toBe(dynamite);
    }
  });

  it('keeps the sticks clear of every other field', () => {
    const back = roundTrip({ dead: true, shielded: true, aim: 3, swing: 0.5, dynamite: 4 });
    expect(back.dead).toBe(true);
    expect(back.shielded).toBe(true);
    expect(back.dynamite).toBe(4);
    expect(Math.abs(back.aim - 3)).toBeLessThan(TAU / 256 + 1e-9);
  });

  it('packs to a non-negative integer, which is what the wire encodes', () => {
    const packed = packPlayerState({ dead: true, shielded: true, aim: 5.9, swing: 0.9, dynamite: 0 });
    expect(Number.isInteger(packed)).toBe(true);
    expect(packed).toBeGreaterThanOrEqual(0);
  });
});

describe('shot state packing', () => {
  const roundTrip = (v: Parameters<typeof packShotState>[0]) => unpackShotState(packShotState(v));

  it('carries the firing team', () => {
    expect(roundTrip({ team: 0, flavour: ShotFlavourCode.ARROW, aim: 0, fuse: 0 }).team).toBe(0);
    expect(roundTrip({ team: 1, flavour: ShotFlavourCode.ARROW, aim: 0, fuse: 0 }).team).toBe(1);
  });

  it.each([
    ['an arrow', ShotFlavourCode.ARROW],
    ['a bolt', ShotFlavourCode.BOLT],
    ['dynamite', ShotFlavourCode.DYNAMITE],
  ])('carries %s back as itself', (_name, flavour) => {
    expect(roundTrip({ team: 1, flavour, aim: 2, fuse: 0.5 }).flavour).toBe(flavour);
  });

  it('carries the direction of travel, so a shot points where it is going', () => {
    const back = roundTrip({ team: 0, flavour: ShotFlavourCode.ARROW, aim: 2.5, fuse: 0 });
    expect(Math.abs(back.aim - 2.5)).toBeLessThan(TAU / 256 + 1e-9);
  });

  it('carries the fuse, so a countdown can be drawn', () => {
    const back = roundTrip({ team: 0, flavour: ShotFlavourCode.DYNAMITE, aim: 0, fuse: 0.75 });
    expect(Math.abs(back.fuse - 0.75)).toBeLessThan(1 / 16 + 1e-9);
  });

  it('keeps every field independent', () => {
    const back = roundTrip({ team: 1, flavour: ShotFlavourCode.DYNAMITE, aim: 4, fuse: 0.5 });
    expect(back.team).toBe(1);
    expect(back.flavour).toBe(ShotFlavourCode.DYNAMITE);
    expect(Math.abs(back.aim - 4)).toBeLessThan(TAU / 256 + 1e-9);
    expect(Math.abs(back.fuse - 0.5)).toBeLessThan(1 / 16 + 1e-9);
  });
});
