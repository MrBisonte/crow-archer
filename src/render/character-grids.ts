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

/** The row the boots land on, and the row the two legs have to read as two. */
const BOOT_ROW = 30;

/**
 * Where the feet sit at rest, as two columns rather than a centre and a spread.
 *
 * Nine columns apart, which is wide for a man, and the width is what pays for
 * the swing: the closed frame brings the feet to within five of each other, and
 * with two-column shins that still leaves three columns of daylight. Narrow the
 * rest stance or thicken the shins and the closed frame drops to two, which
 * pixelOutline fills from both sides — the legs weld for one frame of the walk.
 */
const STANCE_BACK = 6;
const STANCE_FRONT = 15;

/**
 * The archer in profile, facing +x, three baked stride frames off walk phase.
 *
 * Profile rather than the front-facing 3/4 the other heroes are drawn in, and
 * it is the walk that forces it: face-on, a stride can only lift a boot a
 * pixel, which is invisible at 24x32. Side-on it swings the whole leg through
 * seven columns. Every guard in guard-grids.ts is already drawn this way, the
 * foot archer included, so the convention is the codebase's rather than new.
 *
 * The caller mirrors the whole sprite for the other heading — see `facing` in
 * render/characters.ts and `player.facing` in the legacy renderer, both of
 * which already flip on the sign of the aim.
 *
 * The bow is baked because it is the silhouette: an archer read across the
 * arena is a bent stave with a man behind it, and the live bow the multiplayer
 * painter rotates onto him is aim feedback, not the body.
 */
export function buildArcherGrid(frame: AnimFrame, trim: string): PixelGrid {
  const C = {
    tunic: '#1F4A19', tunicHi: '#2C5A22', tunicSh: '#14330F',
    leather: '#1A2A1A', leatherHi: '#243424',
    skin: '#D9B98A', skinSh: '#A88A5E',
    wood: '#5B3A1F', woodHi: '#A07828',
    fletch: '#8A1010', fletchAlt: '#E8D8A0',
    // Trousers are their own value on purpose. Legs drawn in the cloak's
    // colour vanish into it, and the stride is the only thing the walk has.
    trouser: '#4A3A22', trouserHi: '#66512F', boot: '#241A10',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(ARCHER_SPRITE.w, ARCHER_SPRITE.h);

  // Both feet swing about a shared centre and opposite ways, so the two
  // extremes are mirror images of one another — which is what a stride is.
  // guard-grids.ts records the alternative: swing each foot about its own top
  // and they converge instead of splaying, meeting for one frame of the cycle
  // as a single thick leg. Invisible in a still, unmissable in motion.
  //
  // Two columns each way, not one: a single column of travel is a shuffle at
  // this size, and the swing has to carry against a 24-wide body.
  const swing = frame === 'a' ? 2 : frame === 'b' ? -2 : 0;
  const footBack = STANCE_BACK - swing;
  const footFront = STANCE_FRONT + swing;
  // The cloak lags the step rather than leading it.
  const sway = frame === 'a' ? -1 : frame === 'b' ? 1 : 0;

  /**
   * One leg, two thick, tapering from the hip to wherever the foot landed.
   *
   * Two and not three. At a two-column swing the closed frame leaves three
   * columns between three-wide shins, and pixelOutline fills every empty cell
   * touching a filled one from both sides — the legs weld for exactly the frame
   * nobody screenshots. A slimmer shin is also simply a better archer.
   */
  const leg = (hipX: number, footX: number, body: string, lit: string): void => {
    for (let y = 20; y < BOOT_ROW; y++) {
      const t = (y - 20) / (BOOT_ROW - 1 - 20);
      const x = Math.round(hipX + (footX - hipX) * t);
      pixelRect(g, x - 1, y, 2, 1, body);
      setPixel(g, x - 1, y, lit);
      // A knee patch on the way down, so the shin is not one flat run.
      if (y === 23) setPixel(g, x, y, lit);
    }
  };

  // ---- behind the body -----------------------------------------------------

  // Cloak, hung off the shoulder and widening to the hem, swinging with the
  // step. It stops above the boots: a cloak drawn to the floor is a third
  // vertical run at the row that decides whether the legs read as two.
  for (let y = 11; y <= 23; y++) {
    const t = (y - 11) / 12;
    const back = Math.round(9 - 4 * t) + sway;
    pixelRect(g, back, y, 10 - back, 1, C.leather);
    setPixel(g, back, y, C.leatherHi);
  }

  // Quiver slung across the back, and three arrows standing out of it over the
  // trailing shoulder. Alternating fletching so the bundle reads as separate
  // shafts rather than one block.
  pixelEllipse(g, 8, 15, 2.2, 4.6, C.wood);
  pixelEllipse(g, 7.2, 13, 1, 2.2, C.woodHi);
  pixelRect(g, 6, 19, 5, 1, C.leather);
  pixelRect(g, 6, 5, 1, 5, C.fletch);
  pixelRect(g, 7, 4, 1, 6, C.fletchAlt);
  pixelRect(g, 8, 5, 1, 5, C.fletch);

  // Trailing leg first, so the torso and the leading leg overlap it.
  leg(10, footBack, C.trouser, C.trouserHi);

  // ---- body ----------------------------------------------------------------

  // Torso in profile: chest forward, shoulder blade back, narrowing to a belt.
  pixelRect(g, 10, 11, 7, 10, C.tunic);
  pixelRect(g, 10, 11, 7, 2, C.tunicHi);
  pixelRect(g, 10, 13, 2, 7, C.tunicSh);
  pixelEllipse(g, 16, 15, 1.6, 3.4, C.tunicHi);
  pixelRect(g, 10, 20, 7, 2, C.leather);
  pixelRect(g, 12, 20, 2, 2, C.woodHi);
  // Folds down the tunic, and the quiver's belt running to the buckle.
  setPixel(g, 12, 17, C.tunicSh); setPixel(g, 14, 18, C.tunicSh);
  setPixel(g, 13, 13, C.tunicHi); setPixel(g, 15, 17, C.tunicHi);
  pixelRect(g, 9, 18, 3, 1, C.wood);
  pixelRect(g, 10, 12, 1, 8, C.tunicSh);

  // Leading leg over the torso's hem.
  leg(15, footFront, C.trouser, C.trouserHi);

  // Boots, hung outside the ankle rather than centred on it. Centred boots eat
  // a column of the gap from each side, which on the closed frame is the whole
  // gap: the legs part cleanly and the feet fuse instead.
  pixelRect(g, footBack - 2, BOOT_ROW - 1, 3, 2, C.boot);
  pixelRect(g, footFront, BOOT_ROW - 1, 3, 2, C.boot);
  pixelRect(g, footBack - 2, BOOT_ROW - 1, 3, 1, C.trouserHi);
  pixelRect(g, footFront, BOOT_ROW - 1, 3, 1, C.trouserHi);

  // ---- head ----------------------------------------------------------------

  // Hood: the bulk sits behind the skull and a brim reaches forward over the
  // brow, which is what makes a profile read as hooded rather than helmeted.
  // The shadow row under the brim is what sets the face inside it.
  pixelEllipse(g, 11.5, 6.5, 4, 4, C.leather);
  pixelEllipse(g, 10, 5, 2.2, 1.8, C.leatherHi);
  pixelRect(g, 8, 8, 4, 4, C.leather);
  pixelRect(g, 13, 4, 4, 2, C.leather);
  // Face: cheek and jaw under the brim, a nose off the front of it, and the
  // brim's own shadow along the brow so the face sits inside the hood.
  pixelRect(g, 13, 6, 4, 4, C.skin);
  setPixel(g, 17, 7, C.skin);
  setPixel(g, 17, 8, C.skin);
  pixelRect(g, 13, 6, 4, 1, C.skinSh);
  pixelRect(g, 13, 10, 3, 1, C.skinSh);
  setPixel(g, 15, 8, C.outline);

  // ---- arms and bow --------------------------------------------------------

  // Trailing arm tucked to the ribs, drawing hand at the belt.
  pixelRect(g, 11, 13, 3, 4, C.tunicHi);
  setPixel(g, 12, 17, C.skin);
  setPixel(g, 13, 17, C.skin);
  // Leading arm out to the bow, bracer over the forearm.
  pixelRect(g, 16, 13, 3, 2, C.tunic);
  pixelRect(g, 18, 13, 2, 3, C.leatherHi);
  setPixel(g, 19, 15, C.skin);

  // The stave, bent away from the body so the draw shows in silhouette and not
  // only in colour, with the string running the chord of it.
  for (let y = 6; y <= 25; y++) {
    const t = (y - 6) / 19;
    const belly = Math.sin(t * Math.PI);
    const x = 19 + Math.round(belly * 2);
    pixelRect(g, x, y, 1, 1, C.wood);
    if (y > 8 && y < 23) setPixel(g, x, y, C.woodHi);
  }
  // String on the chord, and the grip closed round the stave at hand height so
  // the bow is held rather than standing beside him.
  pixelRect(g, 19, 7, 1, 18, C.fletchAlt);
  pixelRect(g, 19, 14, 3, 2, C.skinSh);
  setPixel(g, 20, 14, C.skin);

  // Trim last, over everything on the torso: it is the one marker a player
  // reads a side off, and anything painted after it could bury it.
  pixelRect(g, 11, 15, 6, 1, trim);
  setPixel(g, 10, 16, trim);

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
