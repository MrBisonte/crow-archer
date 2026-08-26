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

/**
 * Which row of a hero grid sits on the body's origin — the ground between the
 * feet, which is the point the world positions them by.
 *
 * Both renderers drew the sprite at a literal `dy = -22`, and the
 * character-select preview needed the same number to put a live weapon in a
 * baked hand. Three copies of an offset is how a weapon ends up at an ankle,
 * so it is stated once here.
 */
export const SPRITE_ORIGIN_ROW = 22;

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

// ── The profile stride, shared by every hero who walks ───────────────────────
//
// Five builders draw the same two legs under five different bodies. The rules
// they have to obey are not stylistic — each one is a specific way the walk
// breaks — so they are stated once here and parameterised by the little that
// genuinely varies: how wide the hero stands, how far the feet throw, and what
// colour the cloth is.

/**
 * How wide the closed frame may be before `pixelOutline` welds the legs.
 *
 * The pass fills any empty cell orthogonally touching a filled one, from both
 * sides, so two columns of daylight become two columns of outline and the legs
 * fuse for exactly one frame of the cycle — the frame nobody screenshots.
 * Three is the floor, and `strideOf` refuses a stance that cannot hold it.
 */
const MIN_LEG_GAP = 3;

/** A cloth leg is two columns. Plate is thicker; see `strideOf`'s arithmetic. */
const SHIN_W = 2;

/** Where both feet have landed this frame. */
interface Stride {
  /** The trailing foot's column. */
  readonly back: number;
  /** The leading foot's column. */
  readonly front: number;
  /** This frame's throw, for anything that swings against the legs. */
  readonly swing: number;
  /**
   * How thick these legs are.
   *
   * Carried on the stride rather than passed to `paintLeg` separately, because
   * it is the same number `strideOf` checked the closed frame against. Two
   * copies of it is how a leg gets drawn wider than the gap it was cleared for.
   */
  readonly shin: number;
}

/**
 * One frame of a stride, as the two columns the feet landed on.
 *
 * Both feet swing about a *shared* centre and opposite ways, so the extremes
 * are mirror images of one another — which is what a stride is. `buildGuardBody`
 * records the alternative and why it fails: swing each foot about its own top
 * and they converge instead of splaying, meeting for one frame of the cycle as
 * a single thick leg. Invisible in a still, unmissable in motion.
 *
 * `throw_` is deliberately a parameter rather than a constant. A stride is the
 * clearest thing a body says about its speed, and the roster spans 150 px/s to
 * 250, so the ranger throws further than the knight and the arithmetic below is
 * what keeps either from welding.
 *
 * Throws rather than clamping on a stance too narrow for its throw: a silently
 * shortened stride is a hero whose walk stops reading, which is the whole
 * failure this module exists to avoid.
 */
function strideOf(
  frame: AnimFrame, back: number, front: number, throw_: number, shin: number = SHIN_W,
): Stride {
  const closed = front - back - 2 * throw_ - shin;
  if (closed < MIN_LEG_GAP) {
    throw new Error(
      `stride throws ${throw_} from a stance ${front - back} wide on ${shin}-wide shins, ` +
      `closing to ${closed} columns of daylight; pixelOutline welds anything ` +
      `under ${MIN_LEG_GAP}`,
    );
  }
  const swing = frame === 'a' ? throw_ : frame === 'b' ? -throw_ : 0;
  return { back: back - swing, front: front + swing, swing, shin };
}

/**
 * One leg, `SHIN_W` thick, tapering from the hip to wherever the foot landed.
 *
 * Two columns and not three. At a two-column throw the closed frame leaves
 * three columns between two-wide shins; three-wide shins leave one, and
 * `pixelOutline` closes that from both sides. A slimmer shin is also simply a
 * better silhouette at this size.
 */
function paintLeg(
  g: PixelGrid, s: Stride, hipX: number, footX: number, topY: number, bootRow: number,
  body: string, lit: string,
): void {
  for (let y = topY; y < bootRow; y++) {
    const t = (y - topY) / (bootRow - 1 - topY);
    const x = Math.round(hipX + (footX - hipX) * t);
    pixelRect(g, x - 1, y, s.shin, 1, body);
    setPixel(g, x - 1, y, lit);
    // A knee patch on the way down, so the shin is not one flat run.
    if (y === topY + 3) setPixel(g, x, y, lit);
  }
}

/**
 * A pair of boots, each hung *outside* its ankle rather than centred on it.
 *
 * Centred boots eat a column of the gap from each side, which on the closed
 * frame is the whole gap: the legs part cleanly and then the feet fuse instead,
 * which looks like a bug in the legs and is not.
 */
function paintBoots(
  g: PixelGrid, s: Stride, bootRow: number, boot: string, lit: string, w = 3,
): void {
  pixelRect(g, s.back - w + 1, bootRow - 1, w, 2, boot);
  pixelRect(g, s.front, bootRow - 1, w, 2, boot);
  pixelRect(g, s.back - w + 1, bootRow - 1, w, 1, lit);
  pixelRect(g, s.front, bootRow - 1, w, 1, lit);
}

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
 * The bow is not baked: it swings to the aim, bends through a held power shot
 * and snaps forward on release, which no fixed number of frames can carry.
 * render/archer-bow.ts draws it, and both renderers call that one painter.
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

  // Two columns each way, not one: a single column of travel is a shuffle at
  // this size, and the throw has to carry against a 24-wide body.
  const s = strideOf(frame, STANCE_BACK, STANCE_FRONT, 2);
  // The cloak lags the step rather than leading it.
  const sway = frame === 'a' ? -1 : frame === 'b' ? 1 : 0;

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
  paintLeg(g, s, 10, s.back, 20, BOOT_ROW, C.trouser, C.trouserHi);

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
  paintLeg(g, s, 15, s.front, 20, BOOT_ROW, C.trouser, C.trouserHi);

  paintBoots(g, s, BOOT_ROW, C.boot, C.trouserHi);

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

  // Trailing arm swings against the legs — opposite the foot on its own side,
  // which is what an arm does and what stops the walk reading as a shuffle.
  // The bow arm deliberately does not swing: it is holding a bow at a target,
  // and an archer whose aim wandered with his stride would be lying about it.
  const armSwing = -s.swing;
  pixelRect(g, 11 + armSwing, 13, 3, 4, C.tunicHi);
  setPixel(g, 12 + armSwing, 17, C.skin);
  setPixel(g, 13 + armSwing, 17, C.skin);
  // Leading arm out to the bow, bracer over the forearm.
  pixelRect(g, 16, 13, 3, 2, C.tunic);
  pixelRect(g, 18, 13, 2, 3, C.leatherHi);
  setPixel(g, 19, 15, C.skin);


  // Trim last, over everything on the torso: it is the one marker a player
  // reads a side off, and anything painted after it could bury it.
  pixelRect(g, 11, 15, 6, 1, trim);
  setPixel(g, 10, 16, trim);

  return pixelOutline(g, C.outline);
}

export const WIZARD_SPRITE = { w: 24, h: 32 };

/**
 * The wizard's stance: as wide as the archer's, on a shorter throw.
 *
 * He walks at 175 px/s against the archer's 200 and he is old, so the step is
 * a shuffle rather than a stride. What makes it read at all is that the robe
 * stops at mid-calf: a hem on the floor leaves nothing below it to move.
 */
const WIZARD_STANCE_BACK = 7;
const WIZARD_STANCE_FRONT = 16;

/**
 * Where the robe's hem falls: one row above the boots, and no lower.
 *
 * A wizard's robe reaches the floor, so it is set as low as it can go while
 * still leaving the boots to show under it. That means the legs are hidden for
 * the whole cycle and the walk is carried by two boots parting beneath a
 * swinging hem — but the legs still have to be there, because they are what
 * puts the boots where they go.
 */
const WIZARD_HEM_ROW = BOOT_ROW - 1;

/**
 * The wizard in profile, facing +x, three baked stride frames off walk phase.
 *
 * A pointed hat and a beard are the two most recognisable things a wizard has,
 * and both are shapes that only exist side-on: face-on the hat is a triangle
 * and the beard is a bib, which is what he shipped as. In profile the brim
 * projects fore and aft and the beard hangs off the jaw, so the silhouette
 * says wizard before any colour does.
 *
 * The staff and orb are **not** baked. They were, and the renderers painted a
 * live staff over the top of them — two staffs, the baked one pointing wherever
 * the art happened to put it while the real one tracked the aim. `paintStaff`
 * in render/characters.ts and its legacy twin own the weapon now, the same
 * split the archer's bow uses.
 */
export function buildWizardGrid(frame: AnimFrame, trim: string): PixelGrid {
  const C = {
    robe: '#14143A', robeHi: '#22225A', robeSh: '#0A0A22',
    skin: '#D9B98A', skinSh: '#A88A5E',
    beard: '#DCDCEC', beardSh: '#9A9AB4',
    // Trousers are a warm grey against a cold robe, so the shins below the hem
    // are a different value from the cloth above them rather than a darker one.
    trouser: '#4A4458', trouserHi: '#6A6480', boot: '#241608',
    star: '#FFB400',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(WIZARD_SPRITE.w, WIZARD_SPRITE.h);
  const s = strideOf(frame, WIZARD_STANCE_BACK, WIZARD_STANCE_FRONT, 2);
  const sway = frame === 'a' ? -1 : frame === 'b' ? 1 : 0;

  // ---- legs, under everything ---------------------------------------------

  // Both legs go down before the robe goes over them: only what falls below
  // the hem is meant to show, and the skirt painted afterwards is what decides
  // where that is.
  paintLeg(g, s, 10, s.back, 20, BOOT_ROW, C.trouser, C.trouserHi);
  paintLeg(g, s, 14, s.front, 20, BOOT_ROW, C.trouser, C.trouserHi);
  paintBoots(g, s, BOOT_ROW, C.boot, C.trouserHi);

  // ---- robe ----------------------------------------------------------------

  // Shoulders down to the waist, then a skirt flaring the whole way to the
  // boots. The back edge carries the full sway and the front takes half of it:
  // loose at the back and pinned at the front reads as a flag rather than as
  // cloth being walked in, and a front edge on the full sway swings into the
  // beard.
  pixelRect(g, 9, 13, 8, 7, C.robe);
  pixelRect(g, 9, 13, 8, 2, C.robeHi);
  pixelRect(g, 9, 15, 2, 5, C.robeSh);
  for (let y = 20; y < WIZARD_HEM_ROW; y++) {
    const t = (y - 20) / (WIZARD_HEM_ROW - 20);
    const back = Math.round(8 - 4 * t) + sway;
    const front = Math.round(17 + 3 * t) + (sway > 0 ? 1 : 0);
    pixelRect(g, back, y, front - back, 1, C.robe);
    setPixel(g, back, y, C.robeSh);
    setPixel(g, front - 1, y, C.robeHi);
    // Two folds running the length of the skirt, carried by the sway rather
    // than pinned to a column: a fold at a fixed x slides across the garment
    // as it swings, which reads as the pattern moving and not the cloth.
    if (y > 21) {
      setPixel(g, Math.round(11 + t) + sway, y, C.robeSh);
      setPixel(g, Math.round(15 + 2 * t), y, C.robeSh);
    }
  }
  // Sleeve out to where the live staff starts, so the weapon leaves a hand.
  pixelRect(g, 16, 15, 4, 3, C.robe);
  pixelRect(g, 16, 15, 4, 1, C.robeHi);
  setPixel(g, 20, 17, C.skin);
  setPixel(g, 20, 16, C.skin);

  // The stars that say what he is, spread down the longer skirt. The low ones
  // ride the sway so they travel with the cloth they are stitched to.
  setPixel(g, 11, 17, C.star);
  setPixel(g, 16, 22, C.star);
  setPixel(g, 9 + sway, 24, C.star);
  setPixel(g, 13 + sway, 27, C.star);

  // Hem trim, the one team-readable stripe. It rides the hem, which makes it
  // the clearest single thing on him saying the robe is in motion.
  pixelRect(g, 6 + sway, WIZARD_HEM_ROW - 1, 13, 1, trim);

  // ---- head ----------------------------------------------------------------

  // Face and the nose off the front of it. Drawn before the hat, so the brim's
  // shadow lands on the brow rather than under it.
  pixelRect(g, 12, 8, 5, 5, C.skin);
  setPixel(g, 17, 9, C.skin);
  setPixel(g, 17, 10, C.skin);
  setPixel(g, 15, 9, C.outline);

  // Pointed hat: a cone leaning back off the crown, over a brim that projects
  // both ways. The lean is the whole reason this reads as a hat in profile —
  // a cone standing straight up reads as a funnel.
  for (let i = 0; i <= 7; i++) {
    const w = Math.max(1, 5 - Math.round(i * 0.7));
    pixelRect(g, 10 - Math.round(i * 0.6), 6 - i, w, 1, C.robe);
    if (w > 1) setPixel(g, 10 - Math.round(i * 0.6), 6 - i, C.robeHi);
  }
  pixelRect(g, 7, 7, 12, 1, C.robeHi);
  pixelRect(g, 7, 8, 12, 1, C.robeSh); // brim underside, shaded away from the light
  pixelRect(g, 8, 6, 8, 1, C.star);    // the band around the base of the cone
  setPixel(g, 4, 0, C.star);

  // Beard, hanging off the jaw and forward of the chest — the shape that only
  // exists in profile. Painted after the robe, because it hangs in front of it.
  const beardRun = [5, 6, 6, 5, 4, 3, 2];
  for (const [i, w] of beardRun.entries()) {
    pixelRect(g, 13, 12 + i, w, 1, C.beard);
    setPixel(g, 13, 12 + i, C.beardSh);
    setPixel(g, 12 + w, 12 + i, C.beardSh);
  }
  // Moustache, bridging the nose to the beard so the face is not a gap in it.
  pixelRect(g, 15, 11, 3, 1, C.beard);

  return pixelOutline(g, C.outline);
}


export const RANGER_SPRITE = { w: 24, h: 32 };

/**
 * Where the ranger stands, and how far he throws a foot.
 *
 * Eleven columns apart against the archer's nine, and a three-column throw
 * against his two, which is the widest stride on the roster. That is his speed
 * said in the body rather than only in `CHARACTER_STATS`: he covers 250 px/s
 * against the archer's 200, and a hero who outruns everyone on a shorter step
 * reads as skating. The closed frame lands on exactly MIN_LEG_GAP, so this
 * stance cannot be narrowed without shortening the throw — `strideOf` says so
 * rather than letting the legs quietly weld.
 */
const RANGER_STANCE_BACK = 5;
const RANGER_STANCE_FRONT = 16;

/**
 * The ranger in profile, facing +x, three baked stride frames off walk phase.
 *
 * Redrawn from the front-facing 3/4 he shipped in, for the reason
 * `buildArcherGrid` gives: face-on, his three frames differed only by a
 * one-column cloak sway over a floor-length hem, so the fastest hero on the
 * roster walked without visibly moving a leg.
 *
 * Read against the archer, who is deliberately the body next to him: the
 * ranger is lighter everywhere. A half-cape cut at the waist rather than a
 * cloak to the shin, a narrower chest, a longer step, and the head carried
 * forward of the hips so the whole silhouette leans into the run.
 *
 * The crossbow is not baked, the same way the archer's bow is not: both
 * renderers rotate it to the live aim.
 */
export function buildRangerGrid(frame: AnimFrame, trim: string): PixelGrid {
  const C = {
    tunic: '#4A5D2E', tunicHi: '#5C7238', tunicSh: '#36461F',
    cape: '#0E1410', capeHi: '#1C2A18',
    hood: '#24301A', hoodHi: '#324018',
    skin: '#D9B98A', skinSh: '#A88A5E',
    // Trousers carry their own value for the reason the archer's do: legs in
    // the cape's colour vanish into it and the stride has nothing to show.
    trouser: '#2E2A1A', trouserHi: '#46402A', boot: '#141008',
    satchel: '#5A4A2A', satchelHi: '#7A6438',
    quiver: '#3A2A16', bolt: '#C8C0A8', brass: '#B08A2E',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(RANGER_SPRITE.w, RANGER_SPRITE.h);
  const s = strideOf(frame, RANGER_STANCE_BACK, RANGER_STANCE_FRONT, 3);
  // The cape lags the step, as the archer's cloak does.
  const sway = frame === 'a' ? -1 : frame === 'b' ? 1 : 0;

  // ---- behind the body -----------------------------------------------------

  // Half-cape off the trailing shoulder, cut at the waist. Short on purpose:
  // a hem at the shin is a third vertical run at the row that decides whether
  // the legs read as two, and this is the hero whose legs matter most.
  for (let y = 10; y <= 19; y++) {
    const t = (y - 10) / 9;
    const back = Math.round(9 - 4 * t) + sway;
    pixelRect(g, back, y, 10 - back, 1, C.cape);
    setPixel(g, back, y, C.capeHi);
  }

  // Satchel high on the back, and the bolt case standing off the same shoulder.
  pixelRect(g, 4, 16, 4, 4, C.satchel);
  pixelRect(g, 4, 16, 4, 1, C.satchelHi);
  setPixel(g, 6, 18, C.brass);
  pixelRect(g, 6, 12, 3, 6, C.quiver);
  pixelRect(g, 6, 11, 1, 2, C.bolt);
  pixelRect(g, 8, 11, 1, 2, C.bolt);

  // Trailing leg first, so the torso and the leading leg overlap it.
  paintLeg(g, s, 10, s.back, 20, BOOT_ROW, C.trouser, C.trouserHi);

  // ---- body ----------------------------------------------------------------

  // Chest carried forward of the hips: six columns against the archer's seven,
  // and set one to the right of centre, which is what makes the stance read as
  // a lean rather than a slouch.
  pixelRect(g, 11, 11, 6, 9, C.tunic);
  pixelRect(g, 11, 11, 6, 2, C.tunicHi);
  pixelRect(g, 11, 13, 2, 6, C.tunicSh);
  pixelEllipse(g, 16, 15, 1.4, 3, C.tunicHi);
  setPixel(g, 13, 16, C.tunicSh);
  setPixel(g, 15, 14, C.tunicHi);
  // Belt and buckle across the waist.
  pixelRect(g, 11, 19, 6, 1, C.cape);
  pixelRect(g, 13, 19, 2, 1, C.brass);

  // Leading leg over the tunic's hem.
  paintLeg(g, s, 15, s.front, 20, BOOT_ROW, C.trouser, C.trouserHi);
  paintBoots(g, s, BOOT_ROW, C.boot, C.trouserHi);

  // ---- head ----------------------------------------------------------------

  // Peaked hood swept back off the brow, which is the ranger's own head shape
  // against the archer's rounder one. The shadow row under the brim is what
  // sets the face inside the hood instead of flush with it.
  pixelEllipse(g, 12.5, 6, 3.8, 3.8, C.hood);
  // The peak, swept back off the crown and rising as it goes: the ranger's own
  // head shape against the archer's rounder hood. Drawn as a tapering tail
  // rather than a triangle — pixelTriangleUp builds *upward* from its base
  // row, so anything peaked near the top of a 32-row grid loses its point off
  // the edge and the remainder reads as a bar floating clear of the head.
  for (let i = 0; i <= 5; i++) {
    pixelRect(g, 9 - i, 4 - Math.round(i * 0.6), i < 3 ? 2 : 1, Math.max(1, 3 - Math.round(i * 0.5)), C.hood);
  }
  pixelEllipse(g, 11, 4.5, 2, 1.6, C.hoodHi);
  pixelRect(g, 9, 7, 4, 4, C.hood);
  pixelRect(g, 14, 4, 4, 2, C.hood);
  // Face under the brim: cheek, jaw, and a nose off the front.
  pixelRect(g, 14, 6, 4, 4, C.skin);
  setPixel(g, 18, 7, C.skin);
  pixelRect(g, 14, 6, 4, 1, C.skinSh);
  pixelRect(g, 14, 10, 3, 1, C.skinSh);
  setPixel(g, 16, 8, C.outline);

  // ---- arms ----------------------------------------------------------------

  // Trailing arm swings opposite the foot on its own side; the crossbow arm
  // stays put, because a levelled weapon that wandered with the stride would
  // be lying about where it points.
  const armSwing = -s.swing;
  pixelRect(g, 11 + armSwing, 13, 3, 4, C.tunicHi);
  setPixel(g, 12 + armSwing, 17, C.skin);
  // Leading arm out to the crossbow's stock.
  pixelRect(g, 16, 13, 3, 2, C.tunic);
  pixelRect(g, 18, 13, 2, 2, C.capeHi);
  setPixel(g, 19, 15, C.skin);

  // Trim last, over the chest: a baldric rather than the hood brim it used to
  // sit on. A stripe at head height reads as a blindfold, and the one marker a
  // player reads a side off should not be competing with the face.
  pixelCurve(g, [11, 17], [13, 14], [16, 12], trim, 14);
  setPixel(g, 12, 16, C.brass);

  return pixelOutline(g, C.outline);
}


export const KNIGHT_SPRITE = { w: 30, h: 36 };

/**
 * The knight's stance, on plate.
 *
 * The shortest throw on the roster, which is what 150 px/s looks like from
 * inside twelve points of armour. Three-column shins rather than the cloth
 * heroes' two — a greave is a thicker thing than a trouser leg — and the
 * stance is wide enough that even so the closed frame keeps four columns of
 * daylight. `strideOf` is given the width so it checks against the legs that
 * actually get drawn.
 */
const KNIGHT_STANCE_BACK = 9;
const KNIGHT_STANCE_FRONT = 22;
const KNIGHT_SHIN_W = 4;

/** The knight is four rows taller than the others, so his boots land lower. */
const KNIGHT_BOOT_ROW = 34;

/**
 * One armoured leg: cuisse, knee cop, greave, in three plates rather than one
 * tapering run.
 *
 * `paintLeg` deliberately does not do this job. It draws a leg the way cloth
 * hangs — two or three columns narrowing evenly from hip to ankle — and a
 * knight drawn with it is the archer's leg in a different colour, which is
 * exactly what it looked like. Plate is not a taper: it is a stack of separate
 * pieces, each wider than the joint below it, and the knee is the widest thing
 * on the leg rather than a patch of highlight on the way past.
 *
 * A new implementation rather than a flag on the shared one, per CLAUDE.md: a
 * parameter that switched between "cloth" and "plate" would be two functions
 * sharing a name.
 */
function paintPlateLeg(
  g: PixelGrid, s: Stride, hipX: number, footX: number, topY: number, bootRow: number,
  plate: string, lit: string, dark: string,
): void {
  const span = bootRow - 1 - topY;
  /** The leg's centre at a row, walking from the hip across to the foot. */
  const at = (y: number): number => Math.round(hipX + (footX - hipX) * ((y - topY) / span));
  const half = Math.floor(s.shin / 2);
  // The knee sits three rows down, leaving four for the greave below it. The
  // first attempt put it at four and left two, so the shin ran out above the
  // sabaton and the foot read as a ski hung off nothing.
  const kneeY = topY + 3;

  // Cuisse: the thigh plate, widest at the top where it meets the tasset.
  for (let y = topY; y < kneeY; y++) {
    const w = s.shin + (y === topY ? 2 : 1);
    pixelRect(g, at(y) - Math.floor(w / 2), y, w, 1, plate);
    setPixel(g, at(y) - Math.floor(w / 2), y, lit);
    setPixel(g, at(y) - Math.floor(w / 2) + w - 1, y, dark);
  }
  // Knee cop: a rounded plate standing proud of both thigh and shin. It is the
  // joint, so it is the one place an armoured leg gets *wider* going down —
  // which is the whole difference from a leg that just tapers to an ankle.
  pixelRect(g, at(kneeY) - half - 1, kneeY, s.shin + 2, 2, plate);
  pixelRect(g, at(kneeY) - half - 1, kneeY, s.shin, 1, lit);
  setPixel(g, at(kneeY) + half + 1, kneeY + 1, dark);
  // Greave: the shin, straight-sided rather than tapering, with a lit near
  // edge and a shadow down the far one so it reads as a tube, not a bar.
  for (let y = kneeY + 2; y < bootRow; y++) {
    const x = at(y) - half;
    pixelRect(g, x, y, s.shin, 1, plate);
    pixelRect(g, x, y, 2, 1, lit);
    setPixel(g, x + s.shin - 1, y, dark);
  }
}

/**
 * Sabatons: the armoured foot, which is a different shape from a boot.
 *
 * `paintBoots` hangs a rectangle entirely outside the ankle, which is right for
 * cloth — it buys back the column of daylight the legs need. A sabaton is
 * longer than the shin and comes to a point in front, so it has to sit *under*
 * the greave as well as ahead of it, or the foot reads as detached.
 */
function paintSabatons(
  g: PixelGrid, s: Stride, bootRow: number, plate: string, lit: string,
): void {
  const foot = (x: number, toe: number): void => {
    pixelRect(g, x, bootRow - 1, 6, 2, plate);
    pixelRect(g, x, bootRow - 1, 6, 1, lit);
    setPixel(g, toe, bootRow, plate);
  };
  foot(s.back - 4, s.back - 5);
  foot(s.front - 2, s.front + 4);
}

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

/**
 * The knight in profile, facing +x, three baked stride frames off walk phase.
 *
 * Redrawn from the front-facing 3/4 he shipped in. Face-on and symmetrical, a
 * suit of plate reads as a machine rather than a man — two eye slits over a
 * grille, two identical pauldrons, two identical legs — and nothing about it
 * moved. In profile the helm has a front and a back, one pauldron sits nearer
 * than the other, and the greaves can step.
 *
 * He is the heavy of the roster and the art says so the way the numbers do:
 * the shortest step, the thickest legs, and the deepest bob (`paintKnight`
 * carries that half).
 *
 * The spear is not baked. Both renderers rotate it to the aim and extend it
 * through the thrust, which is the game's only feedback that a swing landed.
 *
 * `trim` is the crest, which is the one thing a player reads a side off at
 * this size: a fixed thematic blue or orange in single-player, the team's
 * colour in multiplayer.
 */
export function buildKnightGrid(kind: KnightKind, frame: AnimFrame, trim: string): PixelGrid {
  const C = KNIGHT_KIND_PALETTE[kind];
  const outline = '#0A0F0A';
  const g = makePixelGrid(KNIGHT_SPRITE.w, KNIGHT_SPRITE.h);
  const s = strideOf(frame, KNIGHT_STANCE_BACK, KNIGHT_STANCE_FRONT, 2, KNIGHT_SHIN_W);

  // ---- behind the body -----------------------------------------------------

  // Everything on the far side is painted in the shadow value, nothing else.
  // A profile in plate lives or dies on that one split: drawn in the same
  // metal as the near side, both shoulders and both legs fuse into one slab
  // and he reads as the front-facing machine he was.
  pixelEllipse(g, 12, 18, 3.4, 4, C.armorShadow);
  pixelRect(g, 10, 21, 3, 6, C.armorShadow);
  paintPlateLeg(g, s, 12, s.back, 26, KNIGHT_BOOT_ROW, C.pauldron, C.armor, C.armorShadow);

  // ---- body ----------------------------------------------------------------

  // Breastplate: a chest that swells forward over a back that falls straight,
  // which is the profile of a cuirass and the reason it is not a box. The
  // highlight runs down the front edge rather than sitting in the middle —
  // light catches the curve of a plate at its rim.
  pixelRect(g, 9, 17, 13, 10, C.armor);
  pixelRect(g, 9, 17, 3, 10, C.armorShadow);
  pixelRect(g, 20, 18, 2, 8, C.armorHi);
  pixelRect(g, 19, 17, 1, 9, C.pauldronHi);
  pixelRect(g, 12, 24, 8, 3, C.armorShadow);
  setPixel(g, 14, 20, C.rivet); setPixel(g, 14, 23, C.rivet);

  // Gorget between helm and chest, in the dark value. Without a collar the
  // helm sits straight on the breastplate and the whole upper body reads as
  // one mass with a slit in it.
  pixelRect(g, 14, 14, 6, 3, C.armorShadow);
  pixelRect(g, 14, 14, 6, 1, C.pauldron);

  // Sword belt, and the tassets hanging off it over the hips.
  pixelRect(g, 9, 25, 13, 2, C.strap);
  pixelRect(g, 14, 25, 3, 2, C.rivet);
  pixelRect(g, 10, 27, 11, 3, C.pauldron);
  pixelRect(g, 10, 27, 11, 1, C.pauldronHi);
  pixelRect(g, 10, 29, 11, 1, C.armorShadow);

  // Near pauldron over the chest: the biggest plate on the body, and the one
  // that says which shoulder is nearer. Its rim is the light value so it reads
  // as a separate plate lying on top rather than as part of the breastplate.
  pixelEllipse(g, 13, 19, 4.6, 4.8, C.pauldron);
  pixelEllipse(g, 13, 17, 4.4, 2.2, C.pauldronHi);
  pixelEllipse(g, 12, 16, 2.4, 1.2, C.armorHi);
  setPixel(g, 14, 17, C.rivet);
  // Arm plate down from it, out to where the live spear is gripped.
  pixelRect(g, 17, 21, 4, 5, C.armor);
  pixelRect(g, 17, 21, 4, 1, C.pauldronHi);
  pixelRect(g, 20, 24, 3, 3, C.pauldron);
  pixelRect(g, 20, 24, 3, 1, C.pauldronHi);

  // Leading greave, then sabatons in the light value — a foot that vanishes
  // into the ground takes the stride with it.
  paintPlateLeg(g, s, 18, s.front, 26, KNIGHT_BOOT_ROW, C.leg, C.legHi, C.armorShadow);
  paintSabatons(g, s, KNIGHT_BOOT_ROW, C.pauldron, C.pauldronHi);

  // ---- helm ----------------------------------------------------------------

  // Great helm in profile: a rounded skull behind and a flat face forward.
  pixelEllipse(g, 16, 9.5, 4, 4.5, C.helm);
  pixelRect(g, 17, 6, 4, 8, C.helm);
  pixelRect(g, 13, 5, 8, 2, C.armorShadow);   // the crown, turned away from the light
  pixelRect(g, 13, 8, 8, 1, C.helmHi);         // brow band catching it
  setPixel(g, 14, 8, C.rivet); setPixel(g, 17, 8, C.rivet); setPixel(g, 20, 8, C.rivet);
  // One slit, forward. Face-on this was a letterbox band over a grille, and
  // two glowing eyes over a mouth is the single thing that made him read as a
  // machine rather than a man in a helmet. In profile a knight shows one eye.
  pixelRect(g, 17, 10, 4, 1, C.visor);
  setPixel(g, 21, 10, C.visor);
  // Breath holes, punched rather than barred.
  setPixel(g, 18, 12, C.armorShadow); setPixel(g, 20, 12, C.armorShadow);

  // ---- crest ---------------------------------------------------------------

  // Trim last and on top, where nothing can bury it. A horsehair plume laid
  // along the helm and swept back off it — low, and running fore-and-aft.
  // A crest that stands up tall is a cone, and a cone at this size is a
  // wizard's hat: it was, and the two heroes were not tellable apart.
  for (let i = 0; i <= 11; i++) {
    const t = i / 11;
    const top = 3 + Math.round(t * 2);
    const h = Math.max(1, 3 - Math.round(t * 1.5));
    pixelRect(g, 18 - i, top, 1, h, trim);
  }
  pixelRect(g, 16, 2, 4, 1, trim);
  pixelRect(g, 18, 3, 3, 1, trim);

  return pixelOutline(g, outline);
}


export const SAPPER_SPRITE = { w: 24, h: 32 };

/**
 * The sapper's stance: the archer's body, stood wider and built on thicker legs.
 *
 * He and the archer share a row in `CHARACTER_STATS` — 9 health, 200 px/s —
 * and the art is where the two of them stop being the same man. Same speed, so
 * the same two-column throw; three-column legs and a wider base, because he is
 * the one carrying a keg of powder.
 */
const SAPPER_STANCE_BACK = 5;
const SAPPER_STANCE_FRONT = 16;
const SAPPER_SHIN_W = 3;

/**
 * The sapper in profile, facing +x, three baked stride frames off walk phase.
 *
 * Redrawn from the fixed front-facing pose he shipped in, which had no walk at
 * all: he crossed the map at 200 px/s without moving.
 *
 * Read against the archer, who is his own body in every number: same height,
 * same speed, and the silhouette is the whole difference. A flat-brimmed helm
 * instead of a hood, a powder keg where the quiver sits, an apron instead of a
 * tunic, and a stance a good deal wider than a bowman's.
 *
 * The charge is not baked. Both renderers hold it out along the live aim with
 * its fuse guttering, which is the only warning anyone gets.
 */
export function buildSapperGrid(frame: AnimFrame, trim: string): PixelGrid {
  const C = {
    apron: '#5A4228', apronHi: '#7C5C36', apronSh: '#31220F',
    soot: '#2A2622', sootHi: '#3B3630',
    keg: '#6B4A24', kegHi: '#8A6430', band: '#8A6A22',
    skin: '#D9B98A', skinSh: '#A88A5E',
    // Trousers and boots are their own two values. Legs in the apron's colour
    // vanish into it, and the stride is the only thing the walk has.
    trouser: '#3A3228', trouserHi: '#544838', boot: '#171310',
    ember: '#C6501B',
    outline: '#0A0F0A',
  };
  const g = makePixelGrid(SAPPER_SPRITE.w, SAPPER_SPRITE.h);
  const s = strideOf(frame, SAPPER_STANCE_BACK, SAPPER_STANCE_FRONT, 2, SAPPER_SHIN_W);

  // ---- behind the body -----------------------------------------------------

  // Powder keg slung on the back, hooped in brass, where the archer's quiver
  // sits. Painted first so the shoulder comes down over its inner edge.
  pixelEllipse(g, 6, 15, 3, 5, C.keg);
  pixelEllipse(g, 5, 13, 1.2, 2.2, C.kegHi);
  pixelRect(g, 3, 12, 6, 1, C.band);
  pixelRect(g, 3, 17, 6, 1, C.band);

  // Trailing leg first, so the apron and the leading leg overlap it.
  paintLeg(g, s, 10, s.back, 20, BOOT_ROW, C.trouser, C.trouserHi);

  // ---- body ----------------------------------------------------------------

  // Heavy shoulders, then a leather apron hanging straight from them. Squarer
  // than the archer's tunic on purpose: he is the wide one of the pair.
  pixelRect(g, 9, 11, 9, 4, C.soot);
  pixelRect(g, 9, 11, 9, 1, C.sootHi);
  pixelRect(g, 9, 15, 9, 7, C.apron);
  pixelRect(g, 9, 15, 2, 7, C.apronSh);
  pixelRect(g, 16, 15, 2, 6, C.apronHi);
  pixelRect(g, 9, 21, 9, 2, C.soot);
  setPixel(g, 13, 18, C.apronSh);
  setPixel(g, 15, 17, C.apronHi);

  // Leading leg over the apron's hem.
  paintLeg(g, s, 14, s.front, 20, BOOT_ROW, C.trouser, C.trouserHi);
  paintBoots(g, s, BOOT_ROW, C.boot, C.trouserHi, 4);

  // ---- head ----------------------------------------------------------------

  // Flat-brimmed helm: the brim projects both ways, which is the shape that
  // tells him apart from the archer's hood at a glance and across the arena.
  pixelEllipse(g, 12, 6, 3.6, 3, C.soot);
  pixelEllipse(g, 10.5, 4.6, 2, 1.4, C.sootHi);
  pixelRect(g, 6, 8, 13, 1, C.soot);
  pixelRect(g, 6, 9, 13, 1, C.apronSh); // brim underside, shaded away from the light
  // Face under the brim: jaw, and a nose off the front of it.
  pixelRect(g, 13, 10, 5, 4, C.skin);
  setPixel(g, 18, 11, C.skin);
  pixelRect(g, 13, 10, 5, 1, C.skinSh);
  pixelRect(g, 13, 13, 4, 1, C.skinSh);
  setPixel(g, 16, 11, C.outline);

  // ---- arms ----------------------------------------------------------------

  // Trailing arm swings opposite the foot on its own side; the throwing arm
  // stays out, because the live charge is drawn from it.
  const armSwing = -s.swing;
  pixelRect(g, 10 + armSwing, 13, 3, 4, C.sootHi);
  setPixel(g, 11 + armSwing, 17, C.skin);
  pixelRect(g, 16, 13, 3, 3, C.soot);
  setPixel(g, 19, 15, C.skin);

  // Trim last, over the apron: a bandolier of charges corner to corner, which
  // is the one marker a player reads a side off.
  pixelCurve(g, [9, 20], [12, 16], [17, 12], trim, 20);
  setPixel(g, 11, 18, C.ember);
  setPixel(g, 15, 14, C.ember);

  return pixelOutline(g, C.outline);
}
