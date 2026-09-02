/**
 * Every talent's sigil, as canvas path data on a 24x24 grid.
 *
 * Generated from the design sheets in `_design/talent-icons/` rather than
 * transcribed: each recommended drawing is lifted whole, and its circles,
 * lines and rectangles are flattened to path data here so the painter only
 * ever builds a `Path2D`. The game draws these every frame and has no
 * business parsing markup to do it.
 *
 * They replace the single Unicode glyphs the panels used to print. A glyph
 * depends on whatever the player's machine has installed — U+2608 drew an
 * empty box on a default Windows font and shipped that way once — and a
 * drawing depends on nothing.
 */

/** One stroked or filled path of a sigil, in grid units. */
export interface SigilPart {
  readonly d: string;
  /** Filled rather than stroked. */
  readonly fill?: boolean;
  /** Dashed, for the parts that mean "and further" or "not yet". */
  readonly dash?: boolean;
  /** Drawn faint, for trails and ghosts. */
  readonly alpha?: number;
}

/** The grid every path is drawn against. */
export const SIGIL_GRID = 24;

/** Stroke weight in grid units, kept constant on screen however it scales. */
export const SIGIL_STROKE = 1.5;

export const SIGILS: Record<string, readonly SigilPart[]> = {
  berserker: [
    { d: 'M7 3.4 V20.6' },
    { d: 'M7 6.4 L11 8 L7 9.6' },
    { d: 'M7 11.2 L11 12.8 L7 14.4' },
    { d: 'M7 16 L11 17.6 L7 19.2' },
    { d: 'M20.4 9.6 L12.6 12.8 L20.4 16z', fill: true },
  ],
  blinkReach: [
    { d: 'M1.5 20 L8.5 20' },
    { d: 'M15.5 20 L22.5 20' },
    { d: 'M5 20 Q12 3.5 19 20', dash: true },
  ],
  chargeThrough: [
    { d: 'M1.5 12 L18.4 12' },
    { d: 'M17.8 8.9 L22.4 12 L17.8 15.1z', fill: true },
    { d: 'M6 8.4 V15.6 M3.4 9.6 L8.6 14.4 M8.6 9.6 L3.4 14.4' },
    { d: 'M12.6 9.6 V14.4 M10.8 10.2 L14.4 13.8 M14.4 10.2 L10.8 13.8', alpha: 0.6 },
  ],
  deepRoots: [
    { d: 'M6 3 H18 L12 12 L18 21 H6 L12 12z' },
    { d: 'M7.8 4.8 H16.2 L12.6 10.2 h-1.2z', fill: true },
    { d: 'M9.4 19.4 H14.6 L12 15.6z', fill: true },
    { d: 'M12 12.4 L12 14.4', dash: true },
  ],
  deeperCut: [
    { d: 'M12 2.6 L16.4 10.6 a4.9 4.9 0 1 1 -8.8 0z', fill: true },
    { d: 'M3.5 20.6 L7 20.6' },
    { d: 'M9 20.6 L14 20.6' },
    { d: 'M16 20.6 L22.5 20.6' },
  ],
  demolitionist: [
    { d: 'M4.6 17.4 L11 15.4 L18.6 12.4', dash: true },
    { d: 'M3.1 17.4 A1.5 1.5 0 1 0 6.1 17.4 A1.5 1.5 0 1 0 3.1 17.4', fill: true },
    { d: 'M8.3 15.4 A2.7 2.7 0 1 0 13.7 15.4 A2.7 2.7 0 1 0 8.3 15.4', fill: true },
    { d: 'M14.3 12.4 A4.3 4.3 0 1 0 22.9 12.4 A4.3 4.3 0 1 0 14.3 12.4', fill: true },
    { d: 'M18.6 6.4 V3.8 M13.4 8.4 L11.6 6.6 M23.2 7.4 L21.6 9' },
  ],
  heldStep: [
    { d: 'M20.6 8.4 A9 9 0 1 0 21.2 13.6', dash: true, alpha: 0.7 },
    { d: 'M17.6 5 L21.8 8.6 L17.4 10.6' },
    { d: 'M6.6 16.4 L9.4 16.4' },
    { d: 'M14.6 16.4 L17.4 16.4' },
    { d: 'M8 16.4 Q12 8.8 16 16.4' },
  ],
  focusDepth: [
    { d: 'M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12' },
    { d: 'M10.3 7.2 A1.7 1.7 0 1 0 13.7 7.2 A1.7 1.7 0 1 0 10.3 7.2', fill: true },
    { d: 'M15.1 12 A1.7 1.7 0 1 0 18.5 12 A1.7 1.7 0 1 0 15.1 12', fill: true },
    { d: 'M10.3 16.8 A1.7 1.7 0 1 0 13.7 16.8 A1.7 1.7 0 1 0 10.3 16.8', fill: true },
    { d: 'M5.5 12 A1.7 1.7 0 1 0 8.9 12 A1.7 1.7 0 1 0 5.5 12', fill: true },
  ],
  fourthBlood: [
    { d: 'M5 5 L5 18' },
    { d: 'M9 5 L9 18' },
    { d: 'M13 5 L13 18' },
    { d: 'M17 5 L17 18', dash: true },
    { d: 'M3.4 20.6 L18.6 20.6', alpha: 0.45 },
  ],
  fourthBolt: [
    { d: 'M2.4 12 L7.4 12' },
    { d: 'M7.4 12 L20.6 5.4', alpha: 0.5 },
    { d: 'M7.4 12 L21.4 9.6', alpha: 0.5 },
    { d: 'M7.4 12 L21.4 14.4', alpha: 0.5 },
    { d: 'M7.4 12 L20.6 18.6' },
    { d: 'M17.4 16.6 L21.6 19.6 L18.2 21z', fill: true },
  ],
  fullDraw: [
    { d: 'M7.4 3.2 A11 11 0 0 1 7.4 20.8' },
    { d: 'M7.4 3.2 L17.4 12 L7.4 20.8' },
    { d: 'M3.4 12 L17.4 12' },
    { d: 'M15.6 9.8 L20.6 12 L15.6 14.2z', fill: true },
  ],
  fullTilt: [
    { d: 'M2.5 5 L21.5 5' },
    { d: 'M2.5 11 L21.5 11', dash: true, alpha: 0.55 },
    { d: 'M2.5 20.6 L21.5 20.6' },
    { d: 'M12 18.4 L12 7.4' },
    { d: 'M9.2 9.8 L12 6.6 L14.8 9.8', fill: true },
  ],
  juggernaut: [
    { d: 'M4.5 5.5 L16 12 L4.5 18.5z', fill: true },
    { d: 'M16.8 9.6 L20 6.4' },
    { d: 'M19.8 3.4 h2.8 v2.8 h-2.8 z', fill: true },
    { d: 'M16.8 14.4 L20 17.6' },
    { d: 'M19.8 17.8 h2.8 v2.8 h-2.8 z', fill: true },
  ],
  lightFoot: [
    { d: 'M1.5 20.6 L22.5 20.6' },
    { d: 'M2.2 19.6 L4.6 19.6 L5.4 17 L3 17z', fill: true },
    { d: 'M6.2 19.6 L8.6 19.6 L9.4 17 L7 17z', fill: true },
    { d: 'M10.2 19.6 L12.6 19.6 L13.4 17 L11 17z', fill: true },
    { d: 'M14.4 20.6 L14.4 4' },
    { d: 'M14.4 4 H21.6 L19.4 7 L21.6 10 H14.4z', fill: true },
    { d: 'M16.6 19.6 L19 19.6 L19.8 17 L17.4 17z', dash: true, alpha: 0.5 },
    { d: 'M20.4 19.6 L22.8 19.6 L23.6 17 L21.2 17z', dash: true, alpha: 0.5 },
  ],
  longFuse: [
    { d: 'M1.4 13 A8.6 8.6 0 1 0 18.6 13 A8.6 8.6 0 1 0 1.4 13', dash: true },
    { d: 'M7.6 13 A2.4 2.4 0 1 0 12.4 13 A2.4 2.4 0 1 0 7.6 13', fill: true },
    { d: 'M14.3 9.2 A1.9 1.9 0 1 0 18.1 9.2 A1.9 1.9 0 1 0 14.3 9.2', fill: true },
    { d: 'M13.5 17.6 A1.9 1.9 0 1 0 17.3 17.6 A1.9 1.9 0 1 0 13.5 17.6', fill: true },
    { d: 'M2.9 7.6 A1.9 1.9 0 1 0 6.7 7.6 A1.9 1.9 0 1 0 2.9 7.6', fill: true },
  ],
  longReach: [
    { d: 'M2.8 20.4 L16.8 6.4' },
    { d: 'M15.4 5 L20 3.4 L18.4 8z', fill: true },
    { d: 'M4.6 20.2 L2 22.2 L2.4 19z', fill: true },
    { d: 'M18.2 8.6 L22.4 4.4', dash: true },
  ],
  longThrow: [
    { d: 'M2.6 20.6 Q10.4 1.8 20.6 14.6', dash: true },
    { d: 'M2.2 20.6 L6.4 20.6' },
    { d: 'M18.6 13.6 h4 v6.4 h-4z', fill: true },
    { d: 'M20.6 13.6 V10.2' },
    { d: 'M19 8.8 L22.2 8.8' },
  ],
  longWind: [
    { d: 'M15.6 6.6 L22 12 L15.6 17.4z', fill: true },
    { d: 'M12.4 12 L15.4 12' },
    { d: 'M7.4 12 L11 12', alpha: 0.7 },
    { d: 'M2.6 12 L6 12', alpha: 0.42 },
    { d: 'M8.6 7.4 L13.4 7.4', alpha: 0.55 },
    { d: 'M8.6 16.6 L13.4 16.6', alpha: 0.55 },
  ],
  moreLinks: [
    { d: 'M2 19.6 L22 19.6', alpha: 0.45 },
    { d: 'M2.8 14.6 A2.2 2.2 0 1 0 7.2 14.6 A2.2 2.2 0 1 0 2.8 14.6', fill: true },
    { d: 'M5 9.4 V11.4 M1.6 10.6 L3.2 12.2 M8.4 10.6 L6.8 12.2' },
    { d: 'M9.8 14.6 A2.2 2.2 0 1 0 14.2 14.6 A2.2 2.2 0 1 0 9.8 14.6', fill: true },
    { d: 'M12 9.4 V11.4 M8.6 10.6 L10.2 12.2 M15.4 10.6 L13.8 12.2' },
    { d: 'M16.8 14.6 A2.2 2.2 0 1 0 21.2 14.6 A2.2 2.2 0 1 0 16.8 14.6', fill: true },
    { d: 'M19 9.4 V11.4 M15.6 10.6 L17.2 12.2 M22.4 10.6 L20.8 12.2' },
  ],
  overchannel: [
    { d: 'M20.6 8.4 A9 9 0 1 0 21.2 13.6', dash: true },
    { d: 'M17.6 5 L21.8 8.6 L17.4 10.6' },
    { d: 'M13.4 6 L9 12.6 h2.8 l-1.2 6 4.8-8.2h-2.8z', fill: true },
  ],
  rooted: [
    { d: 'M2 12.4 H22' },
    { d: 'M10.2 2.4 h3.6 v10 h-3.6 z', fill: true },
    { d: 'M6.4 5.8 L10.2 8.4' },
    { d: 'M17.6 5.8 L13.8 8.4' },
    { d: 'M7.4 12.4 H16.6 L12 19.8z', fill: true },
    { d: 'M8.6 17.4 L6.2 21.8' },
    { d: 'M12 19.8 V22.6' },
    { d: 'M15.4 17.4 L17.8 21.8' },
  ],
  setFeet: [
    { d: 'M12 3.5 A8.5 8.5 0 1 1 3.5 12' },
    { d: 'M3.5 12 A8.5 8.5 0 0 1 12 3.5', dash: true },
    { d: 'M8.6 8 L13 12 L8.6 16z', fill: true },
    { d: 'M13.4 8 L17.8 12 L13.4 16z', fill: true },
  ],
  shockwave: [
    { d: 'M9.7 12 A2.3 2.3 0 1 0 14.3 12 A2.3 2.3 0 1 0 9.7 12', fill: true },
    { d: 'M5.6 12 A6.4 6.4 0 1 0 18.4 12 A6.4 6.4 0 1 0 5.6 12', dash: true },
    { d: 'M18.4 10.6 h2.8 v2.8 h-2.8 z', fill: true },
    { d: 'M21.8 12 L23.4 12' },
    { d: 'M10.6 18.4 h2.8 v2.8 h-2.8 z', fill: true },
    { d: 'M12 21.8 L12 23.4' },
    { d: 'M4 5.4 h2.8 v2.8 h-2.8 z', fill: true },
    { d: 'M3.4 4.8 L2.2 3.6' },
  ],
  shortFuse: [
    { d: 'M6.4 15.4 A5.6 5.6 0 1 0 17.6 15.4 A5.6 5.6 0 1 0 6.4 15.4', fill: true },
    { d: 'M12 9.8 V6.4' },
    { d: 'M10.4 5 L13.6 5 M12 3.4 V6.4 M9.6 3.6 L14.4 6.4 M14.4 3.6 L9.6 6.4' },
    { d: 'M2.6 15.4 L5.4 15.4 M3.6 11 L5.8 12.6 M3.6 19.8 L5.8 18.2', alpha: 0.6 },
  ],
  shrapnel: [
    { d: 'M7.4 12 A4.6 4.6 0 1 0 16.6 12 A4.6 4.6 0 1 0 7.4 12', dash: true },
    { d: 'M10.2 12 A1.8 1.8 0 1 0 13.8 12 A1.8 1.8 0 1 0 10.2 12', fill: true },
    // Three bolts, at 0 and +/-120 degrees about the satchel. They were three
    // copies of the SAME path: one arrow drawn three times, which renders as
    // one arrow and shows nothing wrong on a sheet.
    { d: 'M16.8 12 L20.2 12' },
    { d: 'M19.6 10.5 L22.6 12 L19.6 13.5z', fill: true },
    { d: 'M17 10.6 L17 13.4' },
    { d: 'M9.6 16.2 L7.9 19.1' },
    { d: 'M9.5 17.8 L6.7 21.2 L6.9 19.3z', fill: true },
    { d: 'M10.7 15.6 L8.3 17' },
    { d: 'M9.6 7.8 L7.9 4.9' },
    { d: 'M6.9 4.7 L6.7 2.8 L9.5 6.2z', fill: true },
    { d: 'M8.3 7 L10.7 8.4' },
  ],
  slipstream: [
    { d: 'M9.4 5.4 A2.6 2.6 0 1 0 14.6 5.4 A2.6 2.6 0 1 0 9.4 5.4', dash: true },
    { d: 'M12 8 V15', dash: true },
    { d: 'M8 10.4 H16', dash: true },
    { d: 'M12 15 L8.8 21.4 M12 15 L15.2 21.4', dash: true },
    { d: 'M1.5 12.6 L22.5 12.6' },
    { d: 'M3.6 17.6 L20.4 17.6', alpha: 0.6 },
  ],
  splinter: [
    { d: 'M9.6 4.8 A2.4 2.4 0 1 0 14.4 4.8 A2.4 2.4 0 1 0 9.6 4.8', fill: true },
    { d: 'M12 7.4 L5.6 14.4' },
    { d: 'M12 7.4 V14.4' },
    { d: 'M12 7.4 L18.4 14.4' },
    { d: 'M3.6 16.6 A2 2 0 1 0 7.6 16.6 A2 2 0 1 0 3.6 16.6', fill: true },
    { d: 'M10 16.6 A2 2 0 1 0 14 16.6 A2 2 0 1 0 10 16.6', fill: true },
    { d: 'M16.4 16.6 A2 2 0 1 0 20.4 16.6 A2 2 0 1 0 16.4 16.6', fill: true },
    { d: 'M2.2 21 L4.4 18.8' },
    { d: 'M19.6 18.8 L21.8 21' },
  ],
  splitShaft: [
    { d: 'M1 12 L19 12' },
    { d: 'M18 9.2 L22.6 12 L18 14.8z', fill: true },
    { d: 'M2.5 12 A2.7 2.7 0 1 0 7.9 12 A2.7 2.7 0 1 0 2.5 12' },
    { d: 'M7.7 12 A2.7 2.7 0 1 0 13.1 12 A2.7 2.7 0 1 0 7.7 12' },
    { d: 'M12.9 12 A2.7 2.7 0 1 0 18.3 12 A2.7 2.7 0 1 0 12.9 12', dash: true },
  ],
  stickyFan: [
    { d: 'M18.6 2 L18.6 22' },
    { d: 'M19.4 5.4 L22.4 2.4', alpha: 0.45 },
    { d: 'M19.4 11.4 L22.4 8.4', alpha: 0.45 },
    { d: 'M19.4 17.4 L22.4 14.4', alpha: 0.45 },
    { d: 'M11.6 12 A3.4 3.4 0 1 0 18.4 12 A3.4 3.4 0 1 0 11.6 12', fill: true },
    { d: 'M15 8.6 q0 -3.2 2.8 -3.8', dash: true },
    { d: 'M11 8.6 L9 7.2 M10.6 12 H8.4 M11 15.4 L9 16.8' },
  ],
  stormWidth: [
    { d: 'M1 12 A11 11 0 1 0 23 12 A11 11 0 1 0 1 12', dash: true, alpha: 0.35 },
    { d: 'M4 12 A8 8 0 1 0 20 12 A8 8 0 1 0 4 12', dash: true, alpha: 0.6 },
    { d: 'M7 12 A5 5 0 1 0 17 12 A5 5 0 1 0 7 12', dash: true },
    { d: 'M13.2 6 L9.6 12.4 h2.6 l-1.1 5.8 4.3-7.6h-2.6z', fill: true },
  ],
  thirdStep: [
    { d: 'M1.6 20.4 L22.4 20.4' },
    { d: 'M3 20.4 Q5.5 14.6 8 20.4', alpha: 0.45 },
    { d: 'M8 20.4 Q11 12.2 14 20.4', alpha: 0.7 },
    { d: 'M14 20.4 Q18 8.2 22 20.4' },
  ],
  thunderstep: [
    { d: 'M4.6 18.6 A2.4 2.4 0 1 0 9.4 18.6 A2.4 2.4 0 1 0 4.6 18.6', alpha: 0.5 },
    { d: 'M8.2 12.6 A3.8 3.8 0 1 0 15.8 12.6 A3.8 3.8 0 1 0 8.2 12.6', alpha: 0.75 },
    { d: 'M13.6 6.2 A5.2 5.2 0 1 0 24 6.2 A5.2 5.2 0 1 0 13.6 6.2' },
    { d: 'M7 18.6 L12 12.6 L18.8 6.2', dash: true },
    { d: 'M19.4 2.6 L16.6 7.4 h1.8 l-0.8 4.4 3.4-5.6h-1.8z', fill: true },
  ],
  stormcaller: [
    { d: 'M9.6 2.8 L5.4 11.4 h2.6 l-1.1 8 5-9.8h-2.6z', fill: true },
    { d: 'M18 2.8 L13.8 11.4 h2.6 l-1.1 8 5-9.8h-2.6z', dash: true },
  ],
  towerGuard: [
    { d: 'M12 2.4 L20.4 5.8 v7.2 q0 5.6 -8.4 8.6 Q3.6 18.6 3.6 13 V5.8z' },
    { d: 'M9.4 11 A2.6 2.6 0 1 0 14.6 11 A2.6 2.6 0 1 0 9.4 11', fill: true },
    { d: 'M12 5.2 V8.4', alpha: 0.6 },
    { d: 'M6.6 22.4 h10.8', alpha: 0.5 },
  ],
  wideNet: [
    { d: 'M4.8 12 A7.2 7.2 0 1 0 19.2 12 A7.2 7.2 0 1 0 4.8 12' },
    { d: 'M1.6 12 A10.4 10.4 0 1 0 22.4 12 A10.4 10.4 0 1 0 1.6 12', dash: true, alpha: 0.5 },
    { d: 'M12 4.8 V19.2 M4.8 12 H19.2' },
    { d: 'M6.9 6.9 L17.1 17.1 M17.1 6.9 L6.9 17.1', alpha: 0.55 },
  ],
  widerFan: [
    { d: 'M10.4 21.8 h3.2 v1.4 h-3.2z', fill: true },
    { d: 'M2.6 15.6 Q12 2.6 21.4 15.6', dash: true, alpha: 0.5 },
    { d: 'M3.6 12.8 A1.7 1.7 0 1 0 7 12.8 A1.7 1.7 0 1 0 3.6 12.8', fill: true, alpha: 0.5 },
    { d: 'M7.5 7.9 A1.7 1.7 0 1 0 10.9 7.9 A1.7 1.7 0 1 0 7.5 7.9', fill: true, alpha: 0.65 },
    { d: 'M13.1 7.9 A1.7 1.7 0 1 0 16.5 7.9 A1.7 1.7 0 1 0 13.1 7.9', fill: true, alpha: 0.8 },
    { d: 'M16.8 12.4 A2.3 2.3 0 1 0 21.4 12.4 A2.3 2.3 0 1 0 16.8 12.4', fill: true },
    { d: 'M21.4 9.4 V7.2 M20.2 7.6 L22.6 6.4', alpha: 0.9 },
  ],
};
