/**
 * Colours that more than one drawing surface has to agree on.
 *
 * The two team colours were written out separately in the character art, the
 * entity art and the match HUD. Three copies of one fact is three chances for a
 * side to be green in one place and cyan in another, which is exactly the thing
 * a player uses to decide whether to shoot.
 */

/** Team A, then team B. Indexed by the team number the wire carries. */
export const TEAM_COLOURS = ['#39FF14', '#39E0FF'] as const;

/** The colour of a side, falling back to team A for anything unexpected. */
export const teamColour = (team: number): string => TEAM_COLOURS[team] ?? TEAM_COLOURS[0];
