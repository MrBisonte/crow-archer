/** Team model and the damage rule that reads it. */

export const Team = {
  A: 0,
  B: 1,
  ENEMY: 2,
} as const;

export type Team = (typeof Team)[keyof typeof Team];

/**
 * Friendly fire is off. An attacker never damages its own team. Enemies damage
 * both player teams; player teams damage enemies and each other (deathmatch).
 * In co-op both human teams are A, so players cannot hurt each other.
 */
export function canDamage(attacker: Team, target: Team): boolean {
  return attacker !== target;
}
