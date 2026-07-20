import { describe, expect, it } from 'vitest';

import { canDamage, Team } from './team';

describe('canDamage', () => {
  it('blocks same-team damage (friendly fire off)', () => {
    expect(canDamage(Team.A, Team.A)).toBe(false);
    expect(canDamage(Team.B, Team.B)).toBe(false);
    expect(canDamage(Team.ENEMY, Team.ENEMY)).toBe(false);
  });

  it('lets enemies damage both player teams', () => {
    expect(canDamage(Team.ENEMY, Team.A)).toBe(true);
    expect(canDamage(Team.ENEMY, Team.B)).toBe(true);
  });

  it('lets players damage enemies', () => {
    expect(canDamage(Team.A, Team.ENEMY)).toBe(true);
    expect(canDamage(Team.B, Team.ENEMY)).toBe(true);
  });

  it('lets player teams damage each other (deathmatch)', () => {
    expect(canDamage(Team.A, Team.B)).toBe(true);
    expect(canDamage(Team.B, Team.A)).toBe(true);
  });
});
