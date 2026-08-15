/**
 * The rate the simulation runs at.
 *
 * It lives in the sim rather than in the server because the sim is what is
 * measured in ticks: weapon cooldowns, fuses and respawn timers are all counts
 * of these, and they cannot import the server to find out how long one is.
 */

/** Server ticks per second. The client predicts against the same rate. */
export const TICK_HZ = 60;

/** Seconds per tick, the fixed step every world is advanced by. */
export const FIXED_DT = 1 / TICK_HZ;

/** Seconds expressed as a whole number of ticks. */
export const ticks = (seconds: number): number => Math.round(seconds * TICK_HZ);
