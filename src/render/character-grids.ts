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

import { makePixelGrid, setPixel, pixelRect, pixelEllipse, pixelCurve, pixelOutline, pixelTriangleUp, type AnimFrame, type PixelGrid } from './pixel-grid';

export const ARCHER_SPRITE = { w: 24, h: 32 };

/** Top-down 3/4, facing the viewer — callers only ever mirror left/right, so
 * there is no separate back pose. Three baked stride frames off the walk
 * phase, the same technique the ranger's cloak sway uses. The bow is not
 * baked in; both renderers draw it live, rotated to the real-time aim. */
export function buildArcherGrid(frame: AnimFrame, trim: string): PixelGrid {
  const C = {
    tunic: '#1F4A19', tunicHi: '#2C5A22', tunicSh: '#14330F',
    leather: '#1A2A1A', leatherHi: '#243424',
    skin: '#D9B98A', skinSh: '#A88A5E',
    wood: '#5B3A1F', woodHi: '#A07828',
    fletch: '#8A1010', fletchAlt: '#E8D8A0',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(ARCHER_SPRITE.w, ARCHER_SPRITE.h);

  // Walk cycle. One boot lifts while the other stays planted, and the shin
  // above it shortens by the same pixel, so the foot leaves the ground rather
  // than the leg stretching to reach it.
  //
  // Nothing moves sideways, deliberately. The two legs stand two columns
  // apart, and pixelOutline fills any empty cell orthogonally touching a
  // filled one — at that spacing the gap is already entirely outline colour,
  // so converging them even by a pixel welds the pair into one silhouette.
  // Vertical travel is the only axis that stays legible at 24x32.
  const lift = frame === 'a' ? 1 : 0;
  const rLift = frame === 'b' ? 1 : 0;
  // The cloak trails the step, the way the ranger's does off the same phase.
  const sway = frame === 'a' ? -1 : frame === 'b' ? 1 : 0;

  // Quiver on back, three arrows alternating fletching colours so the bundle
  // reads as separate shafts instead of one block, plus a band round the case
  pixelEllipse(g, 5, 7, 2.1, 4, C.wood);
  pixelEllipse(g, 4.2, 5, 1, 2, C.woodHi);
  pixelRect(g, 3, 9, 5, 1, C.leather);
  pixelRect(g, 4, 0, 1, 3, C.fletch); pixelRect(g, 5, 0, 1, 3, C.fletchAlt); pixelRect(g, 6, 1, 1, 3, C.fletch);
  // Cloak hanging off the far shoulder, behind everything else
  pixelRect(g, 3 + sway, 12, 3, 6, C.leather);
  pixelRect(g, 3 + sway, 12, 1, 5, C.leatherHi);
  // Hood
  pixelEllipse(g, 12, 6, 5.5, 4.5, C.leather);
  pixelEllipse(g, 10, 4.5, 2.5, 2, C.leatherHi);
  // Face, two eye pixels so the pose reads front-facing. The brow row is the
  // hood's own shadow: that is what makes the face read as set *under* it.
  pixelEllipse(g, 12, 7.7, 2.6, 1.8, C.skin);
  pixelRect(g, 10, 6, 5, 1, C.skinSh);
  setPixel(g, 10.5, 7.5, C.outline); setPixel(g, 13.5, 7.5, C.outline);
  // Shoulders and tapered torso, shaded down the side away from the light
  pixelRect(g, 5, 9, 14, 3, C.tunic);
  pixelRect(g, 7, 12, 10, 8, C.tunic);
  pixelRect(g, 6, 9, 3, 10, C.tunicHi);
  pixelRect(g, 15, 12, 2, 8, C.tunicSh);
  pixelRect(g, 8, 20, 8, 2, C.leather);
  // Quiver strap across the chest and the belt buckle it feeds into. Both go
  // down before the trim stripe, which stays the last thing painted on the
  // torso so the one team-readable marker can never be drawn over.
  pixelCurve(g, [7, 10], [11, 14], [15, 19], C.wood, 24);
  pixelRect(g, 11, 20, 2, 2, C.woodHi);
  pixelRect(g, 11, 13, 1, 6, trim);
  // Draw arm folded across the chest, bow arm out to the side under a bracer
  pixelRect(g, 6, 12, 3, 3, C.tunicHi);
  setPixel(g, 8, 15, C.skin); setPixel(g, 9, 15, C.skin);
  pixelRect(g, 16, 12, 3, 3, C.tunic);
  pixelRect(g, 17, 14, 2, 3, C.leatherHi);
  // Bow arm, held out to the side
  pixelCurve(g, [18, 9], [23, 15], [19, 23], C.wood, 40);
  pixelCurve(g, [18, 10], [22.3, 15], [19.5, 22], C.woodHi, 40);
  setPixel(g, 19, 16, C.skin); setPixel(g, 20, 16, C.skin);
  // Legs and boots, with a knee pad and a turned-down cuff at the boot top.
  // Each side reads its own lift, so the pair is never at the same height on
  // the two extreme frames and the stride is what the eye picks up.
  pixelRect(g, 8, 22, 3, 5 - lift, C.leather); pixelRect(g, 13, 22, 3, 5 - rLift, C.leather);
  pixelRect(g, 8, 24, 3, 1, C.leatherHi); pixelRect(g, 13, 24, 3, 1, C.leatherHi);
  pixelRect(g, 7, 27 - lift, 4, 3, C.leatherHi); pixelRect(g, 13, 27 - rLift, 4, 3, C.leatherHi);
  pixelRect(g, 7, 27 - lift, 4, 1, C.wood); pixelRect(g, 13, 27 - rLift, 4, 1, C.wood);
  return pixelOutline(g, C.outline);
}

export const WIZARD_SPRITE = { w: 24, h: 32 };

/** Same convention as the Archer's grid. Staff and orb are not baked in;
 * both renderers draw the orb pulse/glow live, and rotate the staff to aim. */
export function buildWizardGrid(trim: string): PixelGrid {
  const C = {
    robe: '#14143A', robeHi: '#22225A', robeSh: '#0A0A22',
    skin: '#D9B98A', skinSh: '#A88A5E',
    beard: '#DCDCEC', beardSh: '#9A9AB4',
    wood: '#5B3A1F',
    orb: '#8888FF', orbHi: '#FFFFFF', orbSh: '#4444B8',
    star: '#FFB400',
    boot: '#241608',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(WIZARD_SPRITE.w, WIZARD_SPRITE.h);
  // Pointed hat, a stack of shrinking rows down to a wide brim. The lit left
  // face of the cone and the band at its base are what stop a big flat
  // silhouette from reading as a paper triangle.
  for (let y = 0; y <= 7; y++) {
    const hw = Math.max(0, Math.round((y / 7) * 8));
    pixelRect(g, 12 - hw, y, hw * 2 + 1, 1, C.robe);
    if (hw > 1) pixelRect(g, 12 - hw, y, hw - 1, 1, C.robeHi);
  }
  pixelRect(g, 5, 6, 15, 1, C.star);
  pixelRect(g, 3, 7, 18, 2, C.robeHi);
  pixelRect(g, 3, 8, 18, 1, C.robeSh); // brim underside, shaded away from the light
  setPixel(g, 12, 0, C.star);
  // Robe, tapered wider toward the hem, with fold shadows down the skirt
  pixelRect(g, 8, 15, 8, 3, C.robe);
  pixelRect(g, 6, 18, 12, 10, C.robe);
  pixelRect(g, 4, 26, 16, 4, C.robe);
  pixelRect(g, 10, 16, 4, 12, C.robeHi);
  pixelRect(g, 7, 19, 1, 9, C.robeSh); pixelRect(g, 16, 19, 1, 9, C.robeSh);
  pixelRect(g, 6, 26, 1, 4, C.robeSh); pixelRect(g, 17, 26, 1, 4, C.robeSh);
  setPixel(g, 12, 20, C.star); setPixel(g, 12, 21, C.star);
  setPixel(g, 8, 23, C.star); setPixel(g, 16, 24, C.star); setPixel(g, 15, 19, C.star);
  pixelRect(g, 4, 28, 16, 1, trim); // hem trim, the one team-readable stripe
  // Boots peeking under the hem, so the robe stands on something
  pixelRect(g, 7, 30, 4, 1, C.boot); pixelRect(g, 14, 30, 4, 1, C.boot);
  // Sleeve, staff arm and a shaded orb rather than a flat disc
  pixelRect(g, 13, 16, 5, 3, C.robe);
  pixelRect(g, 16, 16, 2, 1, C.robeHi);
  pixelRect(g, 12, 17, 5, 1, C.wood);
  setPixel(g, 17, 17, C.skin); // the hand, between the staff and the orb
  pixelEllipse(g, 20, 16, 2.6, 2.6, C.orb);
  pixelEllipse(g, 21, 17, 1.5, 1.5, C.orbSh);
  setPixel(g, 19, 15, C.orbHi); setPixel(g, 20, 15, C.orbHi);
  // Face, shaded under the brim, then the beard over the top of the robe —
  // it hangs in front of the chest, so it has to be painted after it
  pixelEllipse(g, 12, 12, 3.2, 2.6, C.skin);
  pixelRect(g, 9, 10, 6, 1, C.skinSh);
  setPixel(g, 10.5, 11.7, C.outline); setPixel(g, 13.5, 11.7, C.outline);
  setPixel(g, 12, 13, C.skinSh);
  pixelRect(g, 10, 13, 2, 1, C.beard); pixelRect(g, 13, 13, 2, 1, C.beard);
  const beardHalf = [2, 2, 1, 1, 1, 0];
  for (const [i, hw] of beardHalf.entries()) {
    pixelRect(g, 12 - hw, 14 + i, hw * 2 + 1, 1, C.beard);
    // The tip row is one cell wide; shading it would leave no lit pixel at all.
    if (hw > 0) setPixel(g, 12 + hw, 14 + i, C.beardSh);
  }
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
    tunic: '#4A5D2E', tunicHi: '#5C7238', tunicSh: '#36461F', belt: '#0E1410',
    satchel: '#5A4A2A', satchelHi: '#7A6438',
    quiver: '#3A2A16', bolt: '#C8C0A8', brass: '#B08A2E', boot: '#141008',
    skin: '#D9B98A', skinSh: '#A88A5E',
    hood: '#24301A', hoodHi: '#324018', hoodSh: '#141C0C',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(RANGER_SPRITE.w, RANGER_SPRITE.h);
  const sway = frame === 'a' ? -1 : frame === 'b' ? 1 : 0;

  // Cloak — widens toward the hem, same shape family as the dark archer's.
  // A lit fold runs down each outer edge; both carry the sway with the cloak,
  // because a fold pinned to a fixed x would slide across the garment as it
  // swings. Where the tunic overlaps them they simply go behind it.
  for (let y = 19; y <= 29; y++) {
    const halfW = Math.round(5 + 4 * ((y - 19) / 10));
    pixelRect(g, 12 - halfW + sway, y, halfW * 2, 1, C.cloak);
    if (y >= 21) {
      setPixel(g, 12 - halfW + sway + 1, y, C.cloakHi);
      setPixel(g, 12 + halfW + sway - 2, y, C.cloakHi);
    }
  }

  // Tunic, belt, buckle and the clasps holding the cloak on
  pixelRect(g, 7, 19, 10, 11, C.tunic);
  pixelRect(g, 7, 19, 10, 2, C.tunicHi);
  pixelRect(g, 15, 21, 2, 8, C.tunicSh);
  pixelRect(g, 7, 25, 10, 1, C.belt);
  pixelRect(g, 11, 25, 2, 1, C.brass);
  setPixel(g, 8, 19, C.brass); setPixel(g, 15, 19, C.brass);

  // Satchel on one hip, bolt case on the other
  pixelRect(g, 4, 22, 4, 5, C.satchel);
  pixelRect(g, 4, 22, 4, 1, C.satchelHi);
  setPixel(g, 6, 24, C.brass);
  pixelRect(g, 16, 21, 3, 6, C.quiver);
  pixelRect(g, 17, 20, 2, 1, C.bolt);

  // Boots under the hem, so the body ends in feet rather than in cloth
  pixelRect(g, 8, 30, 3, 1, C.boot); pixelRect(g, 13, 30, 3, 1, C.boot);

  // Head
  pixelEllipse(g, 12, 14, 5, 5, C.skin);
  pixelRect(g, 10, 18, 4, 1, C.skinSh);
  setPixel(g, 12, 17, C.skinSh);

  // Hood — peaked and swept back, distinct from the archer's flat hat. The
  // shadow along its rim is what sets the face back inside it rather than
  // flush with it, which is the whole reason the eyes below read as lit.
  pixelTriangleUp(g, 13, 13, 6, 9, C.hood);
  pixelEllipse(g, 12, 12, 6, 4, C.hood);
  pixelRect(g, 7, 15, 10, 1, C.hoodSh);
  pixelRect(g, 9, 5, 4, 3, C.hoodHi);
  pixelRect(g, 9, 4, 6, 1, trim); // hood-brim trim, the one team-readable stripe
  setPixel(g, 10, 16, C.outline); setPixel(g, 14, 16, C.outline);

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
    strap: '#181C24',
  },
  fireSword: {
    armor: '#5A3018', armorShadow: '#301A0C', armorHi: '#F8C088',
    pauldron: '#442410', pauldronHi: '#E89858',
    leg: '#4A2818', legHi: '#C87838',
    helm: '#4A2818', helmHi: '#E89858',
    visor: '#FF5500',
    rivet: '#F0C090',
    strap: '#241004',
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
  // Crest / plume, with a tail swept back off the base
  pixelTriangleUp(g, 15, 4, 3, 5, trim);
  pixelRect(g, 11, 2, 2, 1, trim);
  pixelRect(g, 9, 3, 4, 1, trim);
  // Great helm, with a bright brow band catching the light and rivets set
  // along it
  pixelEllipse(g, 15, 10, 9, 6, C.helm);
  pixelRect(g, 6, 8, 18, 6, C.helm);
  pixelRect(g, 7, 8, 16, 2, C.helmHi);
  setPixel(g, 8, 9, C.rivet); setPixel(g, 12, 9, C.rivet);
  setPixel(g, 18, 9, C.rivet); setPixel(g, 22, 9, C.rivet);
  // Visor: a nasal bar splits the eye slit in two, and the breath slit below
  // is barred into a grille. One long bright band reads as a letterbox; two
  // eyes over a grille reads as a face looking back.
  pixelRect(g, 8, 11, 14, 2, C.visor);
  pixelRect(g, 14, 11, 2, 2, C.helm);
  pixelRect(g, 10, 14, 10, 2, C.visor);
  pixelRect(g, 12, 14, 1, 2, C.helm);
  pixelRect(g, 15, 14, 1, 2, C.helm);
  pixelRect(g, 18, 14, 1, 2, C.helm);
  // Pauldrons, each with a rim highlight
  pixelEllipse(g, 5, 18, 4, 5, C.pauldron);
  pixelEllipse(g, 25, 18, 4, 5, C.pauldron);
  pixelEllipse(g, 4, 16, 2, 1.4, C.pauldronHi);
  pixelEllipse(g, 24, 16, 2, 1.4, C.pauldronHi);
  setPixel(g, 5, 16, C.rivet); setPixel(g, 25, 16, C.rivet);
  // Upper-arm plates hanging under the pauldrons, before the torso goes down
  // over their inner edge
  pixelRect(g, 3, 22, 4, 5, C.armor); pixelRect(g, 23, 22, 4, 5, C.armor);
  pixelRect(g, 3, 22, 4, 1, C.pauldronHi); pixelRect(g, 23, 22, 4, 1, C.pauldronHi);
  pixelRect(g, 3, 26, 4, 1, C.armorShadow); pixelRect(g, 23, 26, 4, 1, C.armorShadow);
  // Torso / breastplate — shadow low, base mid, bright highlight upper-left
  pixelRect(g, 6, 15, 18, 15, C.armor);
  pixelRect(g, 6, 24, 18, 6, C.armorShadow);
  pixelRect(g, 8, 16, 8, 8, C.armorHi);
  // Cuirass neckline, cut as a V out of the breastplate highlight
  pixelRect(g, 11, 15, 8, 1, C.armorShadow);
  pixelRect(g, 12, 16, 6, 1, C.armorShadow);
  pixelRect(g, 13, 17, 4, 1, C.armorShadow);
  pixelRect(g, 14, 18, 2, 1, C.armorShadow);
  // Sword belt and buckle, then the two tassets hanging off it
  pixelRect(g, 6, 22, 18, 2, C.strap);
  pixelRect(g, 13, 22, 4, 2, C.rivet);
  pixelRect(g, 7, 24, 7, 5, C.pauldron); pixelRect(g, 16, 24, 7, 5, C.pauldron);
  pixelRect(g, 7, 24, 7, 1, C.pauldronHi); pixelRect(g, 16, 24, 7, 1, C.pauldronHi);
  // Legs, with a knee cop each and a sabaton wider than the shin above it
  pixelRect(g, 8, 29, 6, 7, C.leg); pixelRect(g, 16, 29, 6, 7, C.leg);
  pixelRect(g, 8, 29, 6, 3, C.legHi); pixelRect(g, 16, 29, 6, 3, C.legHi);
  pixelEllipse(g, 10.5, 32, 2.5, 1.4, C.legHi);
  pixelEllipse(g, 18.5, 32, 2.5, 1.4, C.legHi);
  pixelRect(g, 7, 34, 7, 2, C.pauldron); pixelRect(g, 16, 34, 7, 2, C.pauldron);
  pixelRect(g, 7, 34, 7, 1, C.pauldronHi); pixelRect(g, 16, 34, 7, 1, C.pauldronHi);
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
