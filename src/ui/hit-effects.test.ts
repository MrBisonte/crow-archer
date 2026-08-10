import { beforeEach, describe, expect, it } from 'vitest';

import { EntityKind, PlayerState, type EntitySnapshot, type Snapshot } from '../net/protocol';
import { DEATH_MS, EffectKind, HIT_MS, HitEffects } from './hit-effects';

const player = (id: number, hp: number, state: PlayerState = PlayerState.ALIVE): EntitySnapshot => ({
  id, kind: EntityKind.PLAYER, x: 100 + id, y: 200, hp, state,
});

const snap = (tick: number, entities: EntitySnapshot[]): Snapshot => ({
  tick, entities, acks: [],
});

describe('HitEffects', () => {
  let effects: HitEffects;

  beforeEach(() => { effects = new HitEffects(); });

  it('says nothing about a body it is seeing for the first time', () => {
    effects.observe(snap(1, [player(0, 6)]), 0);
    expect(effects.active(0)).toHaveLength(0);
  });

  it('notices health going down', () => {
    effects.observe(snap(1, [player(0, 10)]), 0);
    effects.observe(snap(2, [player(0, 8)]), 10);
    expect(effects.active(10)).toMatchObject([
      { effect: { kind: EffectKind.HIT, id: 0, damage: 2 } },
    ]);
  });

  it('records where it happened, so it is drawn on the body and not in a corner', () => {
    effects.observe(snap(1, [player(3, 10)]), 0);
    effects.observe(snap(2, [player(3, 8)]), 0);
    expect(effects.active(0)[0]!.effect).toMatchObject({ x: 103, y: 200 });
  });

  it('ignores health going back up, which is a respawn and not a hit', () => {
    effects.observe(snap(1, [player(0, 4)]), 0);
    effects.observe(snap(2, [player(0, 10)]), 10);
    expect(effects.active(10)).toHaveLength(0);
  });

  it('ignores arrows, which have no health to lose', () => {
    const arrow = (id: number): EntitySnapshot => ({
      id, kind: EntityKind.PROJECTILE, x: 0, y: 0, hp: 0, state: 0,
    });
    effects.observe(snap(1, [arrow(1000)]), 0);
    effects.observe(snap(2, [arrow(1000)]), 10);
    expect(effects.active(10)).toHaveLength(0);
  });

  describe('dying', () => {
    it('fires once when a body goes down', () => {
      effects.observe(snap(1, [player(0, 2)]), 0);
      effects.observe(snap(2, [player(0, 0, PlayerState.DEAD)]), 0);
      const kinds = effects.active(0).map((a) => a.effect.kind);
      expect(kinds).toContain(EffectKind.DEATH);
      expect(kinds.filter((k) => k === EffectKind.DEATH)).toHaveLength(1);
    });

    it('does not fire again on every snapshot the body stays down for', () => {
      effects.observe(snap(1, [player(0, 2)]), 0);
      effects.observe(snap(2, [player(0, 0, PlayerState.DEAD)]), 0);
      effects.observe(snap(3, [player(0, 0, PlayerState.DEAD)]), 0);
      effects.observe(snap(4, [player(0, 0, PlayerState.DEAD)]), 0);
      const deaths = effects.active(0).filter((a) => a.effect.kind === EffectKind.DEATH);
      expect(deaths).toHaveLength(1);
    });

    it('fires again for a second death after coming back', () => {
      effects.observe(snap(1, [player(0, 2)]), 0);
      effects.observe(snap(2, [player(0, 0, PlayerState.DEAD)]), 0);
      effects.observe(snap(3, [player(0, 10)]), 0);
      effects.observe(snap(4, [player(0, 0, PlayerState.DEAD)]), 0);
      const deaths = effects.active(0).filter((a) => a.effect.kind === EffectKind.DEATH);
      expect(deaths).toHaveLength(2);
    });
  });

  describe('running out', () => {
    it('reports how far through an effect is', () => {
      effects.observe(snap(1, [player(0, 10)]), 0);
      effects.observe(snap(2, [player(0, 8)]), 1000);
      expect(effects.active(1000 + HIT_MS / 2)[0]!.progress).toBeCloseTo(0.5, 2);
    });

    it('drops a hit once its time is up', () => {
      effects.observe(snap(1, [player(0, 10)]), 0);
      effects.observe(snap(2, [player(0, 8)]), 0);
      expect(effects.active(HIT_MS - 1)).toHaveLength(1);
      expect(effects.active(HIT_MS)).toHaveLength(0);
    });

    it('keeps a death on screen longer than a hit', () => {
      expect(DEATH_MS).toBeGreaterThan(HIT_MS);
    });
  });

  it('caps a burst rather than letting it grow without limit', () => {
    effects.observe(snap(0, [player(0, 100)]), 0);
    for (let i = 1; i <= 40; i++) effects.observe(snap(i, [player(0, 100 - i)]), 0);
    expect(effects.active(0).length).toBeLessThanOrEqual(24);
  });
});
