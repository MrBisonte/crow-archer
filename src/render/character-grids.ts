/**
 * The four heroes' pixel art: one grid builder per character, shared between
 * the legacy single-player renderer (src/legacy/game.js) and the multiplayer
 * renderer (src/render/characters.ts). Single-player has no team concept and
 * multiplayer has no fire-sword powerup in its Pose, so neither is baked in
 * here — both are just a `trim` colour the caller supplies: single-player
 * passes a fixed thematic colour, multiplayer passes the team's.
 *
 * Grid *data* is intentionally not cached here — building one is a few dozen
 * pixelRect/pixelEllipse calls, cheap enough to redo on every call. The
 * expensive part, painting it into a canvas, is what stamps.ts caches (see
 * pixel-sprite.ts's spriteCanvas), keyed by whatever the caller passes in,
 * trim colour included.
 */

import { makePixelGrid, setPixel, pixelRect, pixelEllipse, pixelCurve, pixelOutline, pixelTriangleUp, type PixelGrid } from './pixel-grid';

export const ARCHER_SPRITE = { w: 24, h: 32 };

/** Top-down 3/4, one fixed pose (facing the viewer) — callers only ever
 * mirror left/right, so there is no separate back pose. The bow is not
 * baked in; both renderers draw it live, rotated to the real-time aim. */
export function buildArcherGrid(trim: string): PixelGrid {
  const C = {
    tunic: '#1F4A19', tunicHi: '#2C5A22',
    leather: '#1A2A1A', leatherHi: '#243424',
    skin: '#D9B98A',
    wood: '#5B3A1F', woodHi: '#A07828',
    fletch: '#8A1010',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(ARCHER_SPRITE.w, ARCHER_SPRITE.h);
  // Quiver on back, arrow fletchings peeking above
  pixelEllipse(g, 5, 7, 2.1, 4, C.wood);
  pixelEllipse(g, 4.2, 5, 1, 2, C.woodHi);
  pixelRect(g, 4, 0, 1, 2, C.fletch); pixelRect(g, 5, 0, 1, 2, C.fletch); pixelRect(g, 6, 1, 1, 2, C.fletch);
  // Hood
  pixelEllipse(g, 12, 6, 5.5, 4.5, C.leather);
  pixelEllipse(g, 10, 4.5, 2.5, 2, C.leatherHi);
  // Face, two eye pixels so the pose reads front-facing
  pixelEllipse(g, 12, 7.7, 2.6, 1.8, C.skin);
  setPixel(g, 10.5, 7.5, C.outline); setPixel(g, 13.5, 7.5, C.outline);
  // Shoulders and tapered torso
  pixelRect(g, 5, 9, 14, 3, C.tunic);
  pixelRect(g, 7, 12, 10, 8, C.tunic);
  pixelRect(g, 6, 9, 3, 10, C.tunicHi);
  pixelRect(g, 8, 20, 8, 2, C.leather);
  pixelRect(g, 11, 13, 1, 6, trim);
  // Bow arm, held out to the side
  pixelCurve(g, [18, 9], [23, 15], [19, 23], C.wood, 40);
  pixelCurve(g, [18, 10], [22.3, 15], [19.5, 22], C.woodHi, 40);
  setPixel(g, 19, 16, C.skin); setPixel(g, 20, 16, C.skin);
  // Legs and boots
  pixelRect(g, 8, 22, 3, 5, C.leather); pixelRect(g, 13, 22, 3, 5, C.leather);
  pixelRect(g, 7, 27, 4, 3, C.leatherHi); pixelRect(g, 13, 27, 4, 3, C.leatherHi);
  return pixelOutline(g, C.outline);
}

export const WIZARD_SPRITE = { w: 24, h: 32 };

/** Same convention as the Archer's grid. Staff and orb are not baked in;
 * both renderers draw the orb pulse/glow live, and rotate the staff to aim. */
export function buildWizardGrid(trim: string): PixelGrid {
  const C = {
    robe: '#14143A', robeHi: '#22225A',
    skin: '#D9B98A',
    wood: '#5B3A1F',
    orb: '#8888FF', orbHi: '#FFFFFF',
    star: '#FFB400',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(WIZARD_SPRITE.w, WIZARD_SPRITE.h);
  // Pointed hat, a stack of shrinking rows down to a wide brim
  for (let y = 0; y <= 7; y++) {
    const hw = Math.max(0, Math.round((y / 7) * 8));
    pixelRect(g, 12 - hw, y, hw * 2 + 1, 1, C.robe);
  }
  pixelRect(g, 3, 7, 18, 2, C.robeHi);
  setPixel(g, 12, 0, C.star);
  // Face
  pixelEllipse(g, 12, 12, 3.2, 2.6, C.skin);
  setPixel(g, 10.5, 11.7, C.outline); setPixel(g, 13.5, 11.7, C.outline);
  // Robe, tapered wider toward the hem
  pixelRect(g, 8, 15, 8, 3, C.robe);
  pixelRect(g, 6, 18, 12, 10, C.robe);
  pixelRect(g, 4, 26, 16, 4, C.robe);
  pixelRect(g, 10, 16, 4, 12, C.robeHi);
  setPixel(g, 12, 20, C.star); setPixel(g, 12, 21, C.star);
  pixelRect(g, 4, 28, 16, 1, trim); // hem trim, the one team-readable stripe
  // Staff arm, held out to the side
  pixelRect(g, 12, 17, 8, 1, C.wood);
  pixelEllipse(g, 20, 16, 2.6, 2.6, C.orb);
  setPixel(g, 19, 15, C.orbHi);
  return pixelOutline(g, C.outline);
}

export const RANGER_SPRITE = { w: 24, h: 32 };

/** frame 'a'/'b' are the cloak swayed to each side, 'mid' centered — see
 * animFrame3. The satchel is baked at a fixed spot rather than on whichever
 * hip facing picked; a small, low-stakes simplification. Crossbow is not
 * baked in; both renderers draw it live, rotated to the real-time aim. */
export function buildRangerGrid(frame: 'a' | 'mid' | 'b', trim: string): PixelGrid {
  const C = {
    cloak: '#0E1410', cloakHi: '#1C2A18',
    tunic: '#4A5D2E', tunicHi: '#5C7238', belt: '#0E1410',
    satchel: '#5A4A2A',
    skin: '#D9B98A', hood: '#24301A', hoodHi: '#324018',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(RANGER_SPRITE.w, RANGER_SPRITE.h);
  const sway = frame === 'a' ? -1 : frame === 'b' ? 1 : 0;

  // Cloak — widens toward the hem, same shape family as the dark archer's
  for (let y = 19; y <= 29; y++) {
    const halfW = Math.round(5 + 4 * ((y - 19) / 10));
    pixelRect(g, 12 - halfW + sway, y, halfW * 2, 1, C.cloak);
  }
  pixelRect(g, 8, 19, 4, 3, C.cloakHi);

  // Tunic + belt
  pixelRect(g, 7, 19, 10, 11, C.tunic);
  pixelRect(g, 7, 19, 10, 2, C.tunicHi);
  pixelRect(g, 7, 25, 10, 1, C.belt);

  // Satchel, on one hip
  pixelRect(g, 4, 22, 4, 5, C.satchel);

  // Head
  pixelEllipse(g, 12, 14, 5, 5, C.skin);

  // Hood — peaked and swept back, distinct from the archer's flat hat
  pixelTriangleUp(g, 13, 13, 6, 9, C.hood);
  pixelEllipse(g, 12, 12, 6, 4, C.hood);
  pixelRect(g, 9, 5, 4, 3, C.hoodHi);
  pixelRect(g, 9, 4, 6, 1, trim); // hood-brim trim, the one team-readable stripe

  return pixelOutline(g, C.outline);
}

export const KNIGHT_SPRITE = { w: 30, h: 36 };

const KNIGHT_KIND_PALETTE = {
  // Reads as metal, not cloth: a genuine value jump from armorShadow to
  // armorHi, not just a slightly-lighter dark tone — pixel art has no
  // gradients or glow to imply a reflective surface, so the contrast itself
  // has to carry that read. Every plate gets its own highlight.
  normal: {
    armor: '#3A4258', armorShadow: '#20242E', armorHi: '#C4CEE2',
    pauldron: '#2E3446', pauldronHi: '#8894AC',
    leg: '#323850', legHi: '#7884A0',
    helm: '#323850', helmHi: '#8894AC',
    visor: '#39FF14',
    rivet: '#D8DCE4',
  },
  fireSword: {
    armor: '#5A3018', armorShadow: '#301A0C', armorHi: '#F8C088',
    pauldron: '#442410', pauldronHi: '#E89858',
    leg: '#4A2818', legHi: '#C87838',
    helm: '#4A2818', helmHi: '#E89858',
    visor: '#FF5500',
    rivet: '#F0C090',
  },
} as const;

export type KnightKind = keyof typeof KNIGHT_KIND_PALETTE;

/** Top-down 3/4, one fixed pose. The spear/fire-sword is not baked in —
 * both renderers keep drawing and rotating it live, real combat feedback
 * with no other on-screen indicator. `trim` is the crest/plume colour: a
 * fixed thematic blue/orange in single-player (see KnightKind), the team
 * colour in multiplayer, since multiplayer has no fire-sword state to
 * recolor the crest for. */
export function buildKnightGrid(kind: KnightKind, trim: string): PixelGrid {
  const C = KNIGHT_KIND_PALETTE[kind];
  const outline = '#0A0F0A';
  const g = makePixelGrid(KNIGHT_SPRITE.w, KNIGHT_SPRITE.h);
  // Crest / plume
  pixelTriangleUp(g, 15, 4, 3, 5, trim);
  // Great helm, with a bright brow band catching the light
  pixelEllipse(g, 15, 10, 9, 6, C.helm);
  pixelRect(g, 6, 8, 18, 6, C.helm);
  pixelRect(g, 7, 8, 16, 2, C.helmHi);
  // Visor slits
  pixelRect(g, 8, 11, 14, 2, C.visor);
  pixelRect(g, 10, 14, 10, 2, C.visor);
  // Pauldrons, each with a rim highlight
  pixelEllipse(g, 5, 18, 4, 5, C.pauldron);
  pixelEllipse(g, 25, 18, 4, 5, C.pauldron);
  pixelEllipse(g, 4, 16, 2, 1.4, C.pauldronHi);
  pixelEllipse(g, 24, 16, 2, 1.4, C.pauldronHi);
  setPixel(g, 5, 16, C.rivet); setPixel(g, 25, 16, C.rivet);
  // Torso / breastplate — shadow low, base mid, bright highlight upper-left
  pixelRect(g, 6, 15, 18, 15, C.armor);
  pixelRect(g, 6, 24, 18, 6, C.armorShadow);
  pixelRect(g, 8, 16, 8, 8, C.armorHi);
  // Legs
  pixelRect(g, 8, 29, 6, 7, C.leg); pixelRect(g, 16, 29, 6, 7, C.leg);
  pixelRect(g, 8, 29, 6, 3, C.legHi); pixelRect(g, 16, 29, 6, 3, C.legHi);
  return pixelOutline(g, outline);
}

export const SAPPER_SPRITE = { w: 24, h: 32 };

/** Same fixed front pose as the archer, built stockier: a powder keg where the
 * archer carries a quiver, an apron instead of a tunic, and a bandolier of
 * charges across the chest in the trim colour. The charge itself is not baked
 * in; both renderers draw it live, held out along the real-time aim. */
export function buildSapperGrid(trim: string): PixelGrid {
  const C = {
    apron: '#4A3520', apronHi: '#5E4429',
    soot: '#2A2622', sootHi: '#3B3630',
    keg: '#6B4A24', kegHi: '#8A6430', band: '#8A6A22',
    skin: '#D9B98A',
    ember: '#C6501B',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(SAPPER_SPRITE.w, SAPPER_SPRITE.h);
  // Powder keg slung on the back, hooped in brass, where the archer's quiver sits
  pixelEllipse(g, 5, 8, 2.6, 4.4, C.keg);
  pixelEllipse(g, 4.2, 6, 1.1, 2, C.kegHi);
  pixelRect(g, 3, 6, 5, 1, C.band); pixelRect(g, 3, 10, 5, 1, C.band);
  // Flat-brimmed helm, wider than the archer's hood
  pixelRect(g, 6, 7, 12, 1, C.soot);
  pixelEllipse(g, 12, 5, 4.6, 3.4, C.soot);
  pixelEllipse(g, 10.4, 4, 2.2, 1.6, C.sootHi);
  // Face, two eye pixels so the pose reads front-facing like the others
  pixelEllipse(g, 12, 8.6, 2.6, 1.8, C.skin);
  setPixel(g, 10.5, 8.4, C.outline); setPixel(g, 13.5, 8.4, C.outline);
  // Heavy shoulders and a leather apron down the front
  pixelRect(g, 4, 10, 16, 4, C.soot);
  pixelRect(g, 6, 14, 12, 7, C.apron);
  pixelRect(g, 6, 14, 3, 7, C.apronHi);
  pixelRect(g, 7, 21, 10, 2, C.soot);
  // Bandolier of charges, corner to corner in the trim colour
  pixelCurve(g, [7, 11], [12, 15], [17, 19], trim, 26);
  setPixel(g, 9, 12.5, C.ember); setPixel(g, 13, 16.5, C.ember);
  // Legs and boots, planted wider than the archer's
  pixelRect(g, 7, 23, 4, 4, C.soot); pixelRect(g, 13, 23, 4, 4, C.soot);
  pixelRect(g, 6, 27, 5, 3, C.sootHi); pixelRect(g, 13, 27, 5, 3, C.sootHi);
  return pixelOutline(g, C.outline);
}
