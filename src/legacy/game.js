// Legacy monolith, being dismantled into sim/ and render/ modules.
// The synth comes first, so it shares scope with the sound arrays below.

import SimplexNoise from 'simplex-noise';
import { FOV, Path } from 'rot-js';

import { TILE, TileMap, tilePassable } from '../sim/tilemap';
import { mulberry32 } from '../sim/rng';
import { MAP_COLS, MAP_GEN, MAP_KINDS, MAP_ROWS, MAP_RULES, TILE_SIZE, runsWaves } from '../sim/arena-map';
import { modeRule, picksItsMap } from '../sim/game-mode';
import { BESTIARY } from '../sim/bestiary';
import { SIEGE_WAVE_COUNT } from '../sim/siege-waves';
import {
  GUARD_STATS, RANK_MARK, guardDamage, guardHeal, healGuard, invokeWard,
  isPriest, makeGuard, missingHp, onGuardGround as onDutyGround, shouldWard,
} from '../sim/guards';
import {
  completeWave as siegeCompleteWave, guardLost as siegeGuardLost,
  heroDied as siegeHeroDied, startSiege, waveRoster,
} from '../sim/siege-run';
import {
  TOWER_DAMAGE, TOWER_MAX_HP, damageTower, makeTowers, standingTowers, towerAt,
  towerCentre, towerStanding, towerTiles,
} from '../sim/towers';
import { barrierGates, towerSites } from '../sim/bastion-terrain';
import { nearestHostile, nearestHostileAmong, nearestHostileWithin } from '../sim/targeting';
import { escalatedPulse, hopOrdinal } from '../sim/blink';
import {
  GUARD_GRID_BUILDERS, GUARD_PALETTES, GUARD_SPRITES,
} from '../render/guard-grids';
import { Regrowth } from '../sim/regrowth';
import {
  COMMANDER_WAVE, SOLDIER_STATS, shieldFacing, shieldStops, waveComposition,
} from '../sim/soldiers';
import {
  COMMANDER_PALETTE, COMMANDER_SPRITE, SOLDIER_GRID_BUILDERS, SOLDIER_PALETTES,
  SOLDIER_SPRITE, buildCommanderGrid,
} from '../render/soldier-grids';
import { PathScheduler, FovMap } from '../sim/pathfinding';
import { LocalInput, Button, hasButton, noteKeyDown, noteKeyUp, pointerToCanvas } from '../sim/input';
import { CHARACTER_STATS } from '../sim/arena';
import { Team, canDamage } from '../sim/team';
import { EventBus } from '../sim/events';
import { Hitstop } from '../sim/hitstop';
import { log, attachToEvents } from '../sim/log';
import { SPANS, countingContext, trace } from '../render/trace';
import { DEFAULT_POP, panelAt, panelSlots } from '../render/panel-row';
import { listRows, rowAt } from '../render/list-rows';
import {
  UPGRADES, UPGRADE_ORDER, NO_UPGRADES,
  axisReaches, featherYield, feathersFrom, isMaxed, levelOf, levelsFrom, maxLevel,
  nextCost, perkHeld, purchase, statValue,
} from '../sim/upgrades';
import {
  CAPSTONE_RANK, CHAR_TREES, RANK_THRESHOLDS, draftOffers, draftedHeld,
  draftedValue, masteryAfter, ownedIds, purchaseTalent, rankOf, riteEligible,
  anyAffordable, bossMastery, clampCursor, masteryAvailable,
  talentBankFrom, talentLevel, tierOpenAt,
} from '../sim/talents';
import { ScreenShake } from '../render/shake';
import { PLAYBACK, variationProfile } from '../render/sound-variation';
import { StaticTileLayer, AnimatedTileOverlay, ANIMATED_THEMES, TILE_THEMES, makeVignette } from '../render/tiles';
import { glowDotStamp, glowRectStamp } from '../render/stamps';
import { paintTalentSigil } from '../render/talent-sigil-paint';
import { SIGILS } from '../render/talent-sigils';
import { spriteCanvas, spriteFlashCanvas } from '../render/pixel-sprite';
import {
  makePixelGrid, setPixel, pixelRect, pixelEllipse, pixelCurve, pixelOutline, pixelTriangleUp,
  animFrame3, ANIM_FRAMES,
} from '../render/pixel-grid';
import {
  ARCHER_SPRITE, buildArcherGrid,
  WIZARD_SPRITE, buildWizardGrid,
  RANGER_SPRITE, buildRangerGrid,
  KNIGHT_SPRITE, buildKnightGrid,
  SAPPER_SPRITE, buildSapperGrid,
  SPRITE_ORIGIN_ROW,
} from '../render/character-grids';
import { paintArcherBow } from '../render/archer-bow';
import { paintWizardStaff } from '../render/wizard-staff';
import { paintWizardBroom } from '../render/wizard-broom';
import { bloodlustStacks, paintBloodlust } from '../render/bloodlust';
import { BLAST_SECS, paintExplosion } from '../render/explosion';
import { paintNet, paintSatchel } from '../render/ranger-fx';
import { paintDynamiteCharge, paintPowerDraw, throwReachPx } from '../render/archer-fx';
import { chargeCommitColour, paintChargeDash, paintWhirlwind } from '../render/knight-fx';
import { BLINK_FX_SECS, STORM_FX_SECS, paintBlinkArrival, paintLightningStorm } from '../render/wizard-fx';

/**
 * The ground disc that says whose side a body is on.
 *
 * Keyed by Team, which is the model multiplayer already uses, so adding team
 * colours there is a row here rather than a second mechanism. Single player
 * only ever fields Team.A and Team.ENEMY, and the enemy's is deliberately the
 * plain shadow every body drew before any of this: the question a player asks
 * in a crowd is "which of these is mine", so the answer is carried by the
 * allies rather than paid for by everything on screen.
 */
const TEAM_DISC = {
  [Team.A]: 'rgba(120,190,255,0.55)',
  [Team.B]: 'rgba(255,150,90,0.55)',
  [Team.ENEMY]: 'rgba(0,0,0,0.35)',
};
const TEAM_RIM = {
  [Team.A]: 'rgba(190,230,255,0.9)',
  [Team.B]: 'rgba(255,205,160,0.9)',
  [Team.ENEMY]: 'rgba(0,0,0,0)',
};

// Single-player has no team concept, so each hero gets one fixed trim
// colour instead of the multiplayer per-team one. Archer's was already its
// tunic accent; the others are new, small, low-stakes additions in the same
// spirit (see buildWizardGrid/buildRangerGrid's hem/hood-brim trim).
const SP_TRIM = { archer: '#39FF14', wizard: '#FFB400', ranger: '#FFCC00', sapper: '#FF7A1A', knightNormal: '#3A5CC8', knightFireSword: '#CC3300' };
import { MultiplayerSession } from '../ui/multiplayer-session';

// Standalone synth reading ZzFX-style parameter arrays.
// https://github.com/KilledByAPixel/ZzFX — MIT License
//
// Partial reimplementation, not a drop-in replacement. It takes the same
// positional layout, but: slide is applied in Hz/s rather than ZzFX's scaled
// rate, so sweeps are far gentler; shapes 4 and 5 are noise rather than
// sin(phase**3) and a pulse wave; there is no decay stage between attack and
// sustain; the 0.3 master volume is not applied; and repeatTime, modulation,
// bitCrush, delay, decay, tremolo and filter are accepted but ignored.
// Every sound in this file was tuned by ear against this implementation, so
// changing it to match upstream would retune the whole game.
//
// Parameters (all optional, positional): volume, randomness, frequency, attack,
//   sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump,
//   pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
//   sustainVolume, decay, tremolo, filter
// shape: 0=sine 1=triangle 2=sawtooth 3=tangent 4=bit-noise 5=white-noise
//
// Shapes 4 and 5 never read the oscillator phase, so on a noise sound the
// whole pitch half of the layout — frequency, randomness, slide, deltaSlide,
// pitchJump — is computed and thrown away. Ten of the twenty-two sounds below
// are noise, the arrow among them, so `randomness` is not what makes a
// repeated sound vary; see playSound() and src/render/sound-variation.ts.
var zzfxX;
try { zzfxX = new (window.AudioContext || window.webkitAudioContext); } catch(_) {}

function zzfx(
  v=1, r=.05, f=220, a=0, s=0, d=.1,
  H=0, t=1, h=0, P=0, e=0, j=0,
  B=0, N=0, n=0, x=0, A=0, C=1, T=0, I=0, J=0
) {
  if (!zzfxX) return;
  if (zzfxX.state === 'suspended') zzfxX.resume();
  const SR = 44100, TAU = 2 * Math.PI;
  f *= 1 + (Math.random() - .5) * r * 2;       // randomness detune
  const aS = a * SR | 0, sS = s * SR | 0, dS = d * SR | 0;
  const tot = aS + sS + dS; if (!tot) return;
  const buf = zzfxX.createBuffer(1, tot, SR);
  const D   = buf.getChannelData(0);
  let freq = f, phase = 0, slide = h;
  for (let i = 0; i < tot; i++) {
    // envelope
    let env = i < aS ? i / aS
            : i < aS + sS ? C
            : C * (1 - (i - aS - sS) / (dS || 1));
    // pitch jump
    if (e && i === (j * SR | 0)) freq += e;
    // slide
    freq  += slide / SR;
    slide += P   / SR;
    // oscillator phase
    phase += freq / SR * TAU;
    const p = ((phase % TAU) + TAU) % TAU;
    let sm;
    switch (H | 0) {
      case 1: sm = 1 - 4 * Math.abs(Math.round(p/TAU) - p/TAU); break; // triangle
      case 2: sm = 1 - p / Math.PI % 2;  break; // sawtooth
      case 3: sm = Math.max(-1, Math.min(1, Math.tan(p) * .3)); break;  // tangent
      case 4: sm = Math.random() < .5 ? 1 : -1; break;                  // bit noise
      case 5: sm = Math.random() * 2 - 1; break;                         // noise
      default: sm = Math.sin(p);
    }
    if (t !== 1) sm = Math.sign(sm) * Math.pow(Math.abs(sm), t); // shape curve
    if (N)       sm += (Math.random() * 2 - 1) * N;              // noise mix
    D[i] = Math.max(-1, Math.min(1, sm)) * env * v;
  }
  const src = zzfxX.createBufferSource();
  src.buffer = buf; src.connect(zzfxX.destination); src.start();
  return src;
}

// ── CONFIG ────────────────────────────────────────────────────────────────────

/**
 * The band above the playfield. Named because the canvas height is the grid
 * plus this, and a literal in both places is two places to get it wrong.
 */
const HUD_HEIGHT = 48;

const CONFIG = {
  // Derived from the grid rather than restated: these were a third copy of the
  // arena's size, and a mismatch is invisible until something draws off the end
  // of the map. `src/legacy/arena-size.test.ts` pins them to MAP_COLS/MAP_ROWS.
  // Everything in world space is drawn at +hudHeight for the same reason.
  tileSize: TILE_SIZE, cols: MAP_COLS, rows: MAP_ROWS, hudHeight: HUD_HEIGHT,
  canvasW: MAP_COLS * TILE_SIZE, canvasH: MAP_ROWS * TILE_SIZE + HUD_HEIGHT,

  // No playerSpeed or playerMaxHP here on purpose. Both are per character,
  // in CHARACTER_STATS (src/sim/arena.ts), and FEATHERS stacks purchased
  // levels on the selected row. A shared figure kept here would be a second
  // home for a number nobody reads, free to be tuned to no effect.
  playerRadius: 8, playerHitFlashSecs: 0.3,
  // Enemy hit feedback. The sprite goes flat white for hitFlashWhiteSecs and
  // the knock offset decays across the whole hitFlashSecs, so the recoil
  // outlasts the flash instead of ending with it.
  hitFlashSecs: 0.15, hitFlashWhiteSecs: 0.07, hitKnockPx: 3,
  // How long the reticle flags a press the game refused. Short on purpose:
  // long enough to see, too short to be mistaken for a state you are in.
  blockedFlashSecs: 0.1,
  killsToTriggerBoss: 10,
  // The retinue. Reach and interval are the cavern garrison's numbers, so an
  // allied foot soldier and an enemy shieldman trade blows at the same rhythm.
  // guardSpeed was 74, tuned when the map was 33x21. The playfield is 2.62x
  // that area now, and at 74 a guard needed 23.8s to cross it -- longer than a
  // wave, so a breach on the far side was not answered late, it was never
  // answered at all. 110 puts the crossing back near 16s while still reading
  // as armour rather than a sprint; 123 would restore the old time exactly.
  guardSpeed: 110, guardMeleeReach: 26, guardArcherReach: 260,
  // Far enough that a boss does not land on top of the hero, near enough
  // that it is on screen and reachable the moment its wave begins.
  siegeBossSpawnDistance: 260,
  // The retinue is a bodyguard, not a hunting pack. postRadius is how far out
  // they ring the hero at rest, and postDrift the slow rotation that keeps a
  // standing retinue milling rather than frozen into a diagram.
  //
  // There was a second leash here, `guardLeash: 210`, carrying the rationale
  // below. Nothing read it — the live path has always used guardPostLeash — so
  // it has been deleted rather than left to look load-bearing.
  guardPostRadius: 58, guardPostDrift: 0.25,
  // How far a guard will leave its duty ground to fight, and how near it has to
  // get before it counts as standing on its gate again.
  //
  // The leash is the whole behaviour. Without it every guard walked at the
  // nearest enemy on the map, which on an open bastion meant the retinue
  // scattered across the field in the first ten seconds and the hero fought
  // the wave alone — the opposite of what a bodyguard is for. Generous enough
  // to meet something walking into the gap, mean enough that it comes back.
  //
  // What it is measured from is the capsule in sim/guards.ts, not a disc.
  guardPostLeash: 170, guardPostSlack: 14,
  // How often a guard re-solves its route home. Staggered per guard at
  // spawn so a retinue does not all solve on the same frame.
  guardRouteInterval: 0.5,
  guardShotInterval: 1.6, guardSwingInterval: 0.9, guardArrowSpeed: 420,
  // The towers outrange every guard on the field and reload faster. That is
  // the trade for being unable to move, be healed, or be replaced: all of a
  // tower's value has to sit in the arc it covers while it is still up.
  towerReach: 320, towerShotInterval: 1.1, towerBoltSpeed: 480,
  // The priest's numbers. The heal interval is well over twice a sword swing
  // on purpose: a retinue whose mending outpaces the damage coming in is a
  // retinue that cannot be spent, and the whole bastion is built on spending
  // it. Reach is long enough to work from behind the line and short enough
  // that the priest has to walk somewhere to be useful. The ward's radius is
  // wider than that again, because a once-per-wave sweep that reached fewer
  // allies than the cooldown heal could visit would never be worth casting.
  guardHealInterval: 2.4, guardHealReach: 130, guardWardRadius: 190,

  // Castle stage (brawl mode's second act). Persistently hostile, so no
  // passive-speed figure the way a crow has one; slower than an aggro'd
  // crow's 200 (matching player speed) on purpose, a threat that is always
  // closing is not meant to also be unescapable.
  skeletonSpeed: 130, skeletonContactDamage: 1,
  // The maze's trash mob. Faster than a skeleton and dies to anything, so the
  // threat is never one rat: it is a pack of them filling a two-tile corridor
  // while something you cannot kill comes down it. Spawns in packs on open
  // floor rather than walking in from the right, since a maze has no corridor
  // to walk in from.
  // Faster than every hero on purpose. Slower and a rat can never land
  // the first bite on anyone walking away, which makes the whole pack décor.
  // The margin is small, so you outrun them briefly; once poisoned you are at
  // 100 and they are on you. The slow is the trap, the speed just sets it.
  ratSpeed: 215, ratContactDamage: 1, ratPackSize: 5, ratSpawnMinDistance: 200,
  // Seconds of quiet after a pack is wiped out, before the next one appears.
  // A pack at a time, not a trickle: a trickle you can never get ahead of, and
  // getting ahead is the only reason to fight rats at all.
  ratRespawnSecs: 6,
  // A bite is barely a hit; the poison is the point. 3 damage spread over 3
  // seconds at one point a second, plus a crawl for the same window. Getting
  // bitten once is survivable, getting swarmed is not, and the slow is what
  // turns a second bite into a third.
  //
  // The slow was 0.5, which put you at 100 against a 215 rat: one bite and the
  // pack had you, with nothing you could do about it. 0.65 still means you
  // lose a straight race and no longer means the first bite decided it.
  ratPoisonSecs: 3, ratPoisonDamagePerTick: 1, ratPoisonTickSecs: 1, ratPoisonSlowMult: 0.65,
  // The maze's warden. Unkillable by design, so none of these are HP: they are
  // the shape of a chase. Prowl is a little slower than the player so walking
  // away works until a corridor ends; the charge is much faster than anyone.
  minotaurProwlSpeed: 165,
  minotaurChargeSpeed: 430,
  minotaurWindupSecs: 0.55,      // telegraph: he plants, snorts, then goes
  minotaurChargeMaxSecs: 1.6,
  minotaurRecoverSecs: 1.1,      // after a charge ends, however it ended
  minotaurChargeCooldown: 1.4,   // earliest he may line up another one
  minotaurContactDamage: 2,
  minotaurChargeContactDamage: 3,
  minotaurContactRadius: 26,
  minotaurSightRange: 520,       // he still needs line of sight, this caps it
  minotaurStunSecs: 1.5,         // what a hit buys you, instead of progress
  minotaurSmashRadius: 1,        // tiles cleared where a charge ends in wall

  // The maze's objective chain. Distances are pixels on a 1056x672 arena, so
  // "far" here means most of the way across it. The door is the far end, the
  // chest is a detour, and the separation stops one being the other's landmark.
  mazeChestMinDistance: 380,
  mazeDoorMinDistance: 620,
  mazeObjectiveSeparation: 300,
  // Per rat kill, and only once the warden has shown himself. One in five
  // makes the hunt a handful of kills rather than a grind or a formality.
  mazeSilverKeyDropChance: 0.2,

  // Sight, in tiles. The open maps keep the radius they have always had, which
  // is larger than the screen and so reads as "no fog at all". The maze runs
  // dark: four tiles is a little over two body lengths, enough to see the
  // corridor you are in and nothing of the one you are about to enter.
  sightRadiusTiles: 14,
  mazeSightRadiusTiles: 4,
  torchSightMult: 3,             // what a lit torch buys, permanently
  fogMemorySlope: 0.75,          // how fast a lit tile dims toward the edge of sight
  fogMemoryAlpha: 0.74,          // black over terrain you remember but cannot see
  torchGlowTiles: 2,             // tiles a lit torch keeps clear of fog, forever
  mazeTorchCount: 3,
  mazeTorchMinDistance: 200,     // from the spawn, so the first is not underfoot

  // Fire skeleton: same movement and contact damage as normal, but its
  // death is a small blast that punishes standing next to it when it pops.
  fireSkeletonBlastRadius: 50, fireSkeletonBlastDamage: 1,

  // Ice skeleton: same movement, plus a shot on a timer aimed at wherever
  // the player is right now. A hit chips 1 HP and locks out all input for
  // the freeze duration, so a wave of them punishes standing still.
  iceSkeletonShotInterval: 3, iceSkeletonBoltSpeed: 300,
  iceSkeletonBoltDamage: 1, iceSkeletonFreezeSecs: 3,

  // The cavern's garrison. Health, speed and reach are per kind and live in
  // sim/soldiers.ts with the wave table; what is here is the timing the three
  // share, and the two numbers that make a spearman's charge readable.
  //
  // Spawned into the map rather than off the canvas edge, so far enough away
  // that a wave arriving is something you see coming rather than something
  // that is suddenly beside you.
  soldierSpawnMinDistance: 230, soldierMax: 16, soldierContactReach: 14,
  // The archer's volley. Slower than an ice skeleton's, because an archer
  // that also outranges you is otherwise the only thing worth answering.
  soldierArcherShotInterval: 2.4, soldierArcherBoltSpeed: 300,
  soldierArcherBoltDamage: 1,
  // The spearman's run. Fast and short, with a long gap after: the charge is
  // meant to be dodged by stepping off its line, which needs it committed to
  // a heading it picked before it set off.
  soldierSpearChargeSpeed: 265, soldierSpearChargeSecs: 0.55,
  soldierSpearChargeGap: 2.5,

  arrowSpeed: 500, arrowLifetime: 1.5, maxArrowsInFlight: 3,

  // Archer power shot. Sniper mode used to root him for nothing but a longer
  // aim line, which is all cost; drawing the bow is the same root buying
  // something. A full draw is the only shot in his kit that punishes a single
  // big target, which is the gap the fastest and weakest bow leaves.
  //
  // Every figure below is what a FULL draw is worth; a tap gets the bottom of
  // each range, so the decision is how long to stand still, not whether to.
  // Brace. The archer's whole bargain is that he never has to be near, and
  // the bill for it is the smallest hit per press on the roster — seven arrows
  // to take the Crow King down, the longest count of anyone. Brace is where
  // that gets paid back, and standing still is the price.
  //
  // It reaches full in a second and a quarter and empties four times faster,
  // so it is a stance rather than a resource: you cannot bank it and walk it
  // somewhere. It multiplies boss damage only, which is the number he is
  // actually short of; a crow dies to any arrow either way.
  braceFillSecs: 1.25,
  braceDrainMult: 4,
  braceBossMult: 1.8,

  // Arrows a fully braced shot looses at once. This is what makes the meter
  // worth filling outside a boss fight: a brace multiplies BOSS damage only,
  // and a crow dies to any arrow either way, so before this the passive was
  // dark for most of a run.
  archerBraceVolley: 3,
  // What SHORT FUSE leaves of the stick's fuse.
  //
  // A fraction rather than a rest threshold. The first version blew the stick
  // when it slowed below 45 px/s, and friction of 0.985 a frame takes about
  // 136 frames to get there from a throw -- well past the 90-frame fuse it was
  // meant to beat, so the talent did nothing at all. The name was the better
  // specification: a short fuse is a short fuse.
  archerShortFuseMult: 0.35,
  archerVolleySpreadRadians: Math.PI / 44,   // ~4 degrees between arrows
  // What a full brace takes off the power shot's wait, as a fraction.
  archerBracedCooldownCut: 0.4,

  archerDrawMaxSecs: 1.0,
  archerPowerCooldown: 5,
  archerPowerSpeedMult: 2,   // 500 px/s at a tap, 1000 fully drawn
  archerPowerPierce: 3,      // bodies it passes through: 1 at a tap
  archerPowerBossMult: 3,    // against a boss, versus a plain arrow's 1

  // Crow density and the player's ability to answer it. Every value here is
  // set by the pace preset below, so edit PACE_PRESETS, not these.
  crowPassiveSpeed: 60, crowAggroSpeed: 200, crowAggroTimeout: 4,
  crowStartCount: 5, crowMax: 12, crowEscalationInterval: 12,
  whiteCrowPassiveSpeed: 120, whiteCrowAggroSpeed: 300,

  // Which preset to run. Override at runtime with ?pace=nightmare.
  pace: 'fast',

  // Three was the count on a 0.71 Mpx playfield. The playfield is 1.86 Mpx now,
  // so three meant a third of the old density and a much longer walk between
  // them; eight restores what it was.
  maxPickupsOnMap: 8,
  waterShimmerMs: 800,

  // One pool, the same whoever is fighting him. Who is holding the weapon is
  // answered by CHARACTER_STATS[kind].bossDamageMult, once, in
  // applyBossDamage. See docs/balance.md.
  bossHP: 10, bossOrbitRadius: 180, bossOrbitSpeed: 80, bossOrbitDuration: 3,
  // Time constant for orbitRadius easing back to bossOrbitRadius after any
  // interrupt (charge, screech, whirlwind) — see enterOrbit(). Keeps the
  // boss gliding back out instead of popping straight onto the circle.
  bossOrbitRadiusEaseTau: 0.35,
  bossChargeSpeed: 350, bossScreechInterval: 8, bossScreechHalt: 0.4, bossScreechRange: 200,
  bossBatCD: 2.5, bossBatsPerSummon: 5,
  bossShieldInitialDuration: 10,  // seconds of mandatory opening shield
  bossShieldOpenDuration: 5,      // seconds of vulnerability after shield drops
  bossShieldRandomDuration: 5,    // seconds of each random re-shield
  bossShieldChance: 0.65,         // probability of re-shielding after each open window
  bossShieldMaxPerWindow: 3,      // hard cap on shields per 30-second rolling window
  bossShieldWindowDuration: 30,
  bossKnockback: 62,              // px the boss is shoved per hit, away from the source
  bossKnockbackDecay: 0.30,       // seconds for that shove to fade to 1/e
  bossBurnDuration: 4,            // seconds a fire arrow keeps the boss alight
  bossBurnSlowdown: 0.3,          // fraction of speed removed while he burns
  bossBurnDamage: 0.5,            // extra damage the burn deals, as a fraction of the igniting hit
  bossBurnEmberInterval: 0.12,    // seconds between ember puffs while burning
  // Crow king only: a real (unshielded) hit dazes him, a breather window on
  // top of the knockback every hit already gives. Stun is a full action
  // freeze; the two recovery steps only slow him. A shielded hit still gets
  // knocked back (see resolveBossHit) but never dazes him, so the player
  // can't perma-freeze him through the one phase meant to be untouchable.
  bossDazeStunDuration: 1,
  bossDazeSlow1Duration: 1.5, bossDazeSlow1Speed: 0.33,
  bossDazeSlow2Duration: 1.5, bossDazeSlow2Speed: 0.66,

  // Dark bosses (castle stage 2/3). They reuse the crow king's orbit/charge
  // engine and burn/knockback handling; the shield-window mechanic is
  // dropped on purpose, so neither fight is another parry-timing puzzle.
  darkArcherHP: 12,
  darkArcherContactDamage: 1,     // weak up close — an archer that got caught
  darkArcherVolleyInterval: 2.2, darkArcherVolleyCount: 3,
  darkArcherVolleySpread: Math.PI / 14, darkArcherBoltSpeed: 380, darkArcherBoltDamage: 1,
  // Secondary, on its own cooldown alongside the volley: a lobbed bomb that
  // detonates in a radius, the same bow-and-dynamite split the real archer
  // carries.
  darkArcherBombInterval: 4.5, darkArcherBombFuse: 1.1, darkArcherBombSpeed: 220,
  darkArcherBombDamage: 2, darkArcherBombRadius: 55,
  darkArcherSkeletonInterval: 7,  // summons one ice skeleton on this cadence

  darkKnightHP: 16,
  darkKnightOrbitDuration: 1.2,   // short lead-in, spends most of its time charging
  darkKnightChargeSpeed: 460, darkKnightContactDamage: 3,
  // Secondary, on its own cooldown: a whirlwind halt between charges, the
  // same spear-and-whirlwind split the real knight carries.
  darkKnightWhirlwindInterval: 6, darkKnightWhirlwindDuration: 1.4,
  darkKnightWhirlwindTickRate: 0.25, darkKnightWhirlwindRadius: 70,
  darkKnightWhirlwindDamage: 1,
  darkKnightSkeletonInterval: 7,  // summons one fire skeleton on this cadence

  // The garrison's commander, mounted: the cavern's last wave and the end of
  // that run. Tuned against the dark knight, the charging melee boss he most
  // resembles — more health than either dark boss, and a charge that hurts
  // less than the knight's. Tanky rather than punishing, so the fight is long
  // enough to be about reading his charges rather than about surviving one.
  commanderHP: 20,
  // The keeper's pool, and only a siege ever reads it — see bossHpFor. Equal
  // to the commander's on purpose: wave ten fields the two of them on one
  // shared bar, so an even split is what makes that bar a doubled number
  // rather than a lopsided one. One figure rather than the three the siege
  // branch wrote, because bossDamageMult now carries the per-character half.
  keeperHP: 20,
  commanderContactDamage: 2, commanderContactReach: 30,
  // Rides the player down between charges, slower than he charges by a wide
  // margin so the wind-up is legible.
  commanderRideSpeed: 105,
  commanderChargeSpeed: 430, commanderChargeSecs: 0.75,
  // Random, but never less than this apart. The floor is the whole of what
  // makes the charge fair: without it two rolls can land back to back and
  // there is no window to punish him in.
  commanderChargeMinGap: 5, commanderChargeGapSpread: 3,

  handicap: 0,          // 0-100: rubber-band difficulty assist

  dynamiteSpeed: 336, dynamiteLifetime: 1.5, dynamiteBlastRadius: 90, dynamiteBossDamage: 2,
  // How far his own stick throws whatever is near it -- him at the centre,
  // and anything that lived through the blast. Falls to nothing at the edge,
  // so where he puts the stick is the whole control.
  archerBlastHopPx: 195,
  // A powered fire arrow drops a patch this often while it flies, which is
  // what turns one landing spot into a burning lane.
  archerFireTrailSecs: 0.09,
  // Bounces a powered ricochet gets before it gives up, against the 9 an
  // ordinary one gets.
  archerPowerBounces: 26,
  // 70% of dynamite's, same cut the crossbow bolt takes against the arrow. Blast
  // radius stays shared with dynamiteBlastRadius; only boss damage is softer.
  satchelBossDamage: 1,

  // Ranger net. The hold is the point and the damage is not: 0.9 never kills a
  // fresh 1 HP creep, it only stops it, and a netted crow left on 0.1 dies to
  // the next scratch. Throw, spread and hold all scale off the same draw, so a
  // full one is a committed choice rather than the default. Long cooldown to
  // match: this is the only crowd control in the ranger's kit.
  netCooldown: 10,
  netDrawMaxSecs: 1.0,
  netThrowMin: 120, netThrowMax: 320,
  netRadiusMin: 34, netRadiusMax: 70,
  netRadiusBonus: 0,   // WIDE NET adds to both ends; see TALENTS.STATS
  rangerHoldfastMult: 2,   // HOLDFAST: what a held target is worth
  netHoldMin: 0.8, netHoldMax: 2.0,
  netDamage: 0.9,
  netSpeed: 420,

  pitchforkRange: 52, pitchforkCooldown: 1.5, pitchforkBossDamage: 2, pitchforkSwingDuration: 0.38,
  // The broom is the wizard's pitchfork: the same swing on a cooldown half
  // again as long. It is what he has left with Focus empty, and it is meant to
  // be a rare save rather than a way to fight — a wizard who can hold his own
  // in melee is not a glass cannon.
  broomCooldownMult: 1.5,

  // Sapper. The powder charge is thrown on the primary and costs nothing but
  // time, so this cooldown is the whole of its ammo economy: there is no
  // quiver to run dry and so no pitchfork fallback either. Slower than every
  // primary but the wizard's bolt, matching SAPPER_CHARGE_COOLDOWN_TICKS in
  // sim/weapons.ts.
  sapperChargeCooldown: 1.1,
  // Held fire puts up to three charges down in one go, and the cooldown that
  // follows is the per-bomb one times however many actually left. So the burst
  // buys *placement*, not rate: three bombs in one spot cost exactly what three
  // bombs spread over three presses cost, and what he gets for it is a pile the
  // shift shot can set off together.
  //
  // Without it the chain was very nearly dead. A 1.8 s fuse against a 1.1 s
  // cooldown puts at most 1.6 charges in the air at a time, so "a blast sets off
  // nearby bombs" almost never had a second bomb to reach.
  sapperBurstCount: 3,
  sapperBurstIntervalSecs: 0.13,
  // The sapper's own bomb outranges the archer's dynamite on purpose, via
  // speed and fuse both — a straight-line demolition tool, not a lob.
  sapperBombSpeed: 400, sapperBombLifetime: 1.8,
  // Special: a fan of mini-bombs across a fixed arc, each a small independent
  // blast that goes off on the first thing it touches rather than counting
  // down a fuse — area denial the primary alone can't give him.
  sapperBarrageCount: 5, sapperBarrageArcRadians: Math.PI / 4, sapperBarrageCooldown: 6,
  sapperBarrageSpeed: 380, sapperBarrageLifetime: 0.9, sapperBarrageBlastRadius: 40,
  sapperBarrageDamage: 1,
  // MINEFIELD. A mine waits far longer than a fuse but not forever, and it
  // triggers at a stride rather than at a bomb's own contact radius --
  // something that has to touch it is a bomb with a long fuse, not a mine.
  sapperMineSecs: 20, sapperMineTriggerRadius: 26,
  // Shift: a fast piercing shot. A direct hit is a clean multiple of a normal
  // one; catching the sapper's own live bomb in flight instead detonates it
  // early into a bigger blast, its damage highest at the centre and falling
  // off toward the edge — the reward for threading the harder shot.
  sapperShotCooldown: 10, sapperShotSpeed: 600, sapperShotLifetime: 1.5,
  sapperShotDamageMult: 3, sapperShotBossDamage: 3,
  sapperComboRadiusMult: 1.33, sapperComboFalloffMax: 10, sapperComboFalloffMin: 2,
  // Chain detonation: a bomb going off lights every other bomb near it, and
  // those light the next. It finishes the combo the piercing shot already
  // started -- his shot detonates one of his own bombs -- by making the pouch
  // itself the weapon rather than needing a shot threaded through it.
  //
  // Lit rather than exploded outright. Setting a short fuse on the neighbour
  // costs no recursion, cannot re-enter, and buys the stagger for free: a
  // cascade that all went off on one frame is one loud blast, and the whole
  // appeal is hearing it run.
  //
  // The boss bonus is what makes it his answer to a boss rather than only to a
  // crowd. Ordinary enemies have one hit point and die to anything, so radius
  // is the only thing that helps against them and a damage bonus would be
  // invisible; against a boss each link lands harder than the last. Capped,
  // because a pouch of ten with no ceiling is a one-press boss kill.
  sapperChainRadius: 74,
  sapperChainDelaySecs: 0.07,
  sapperChainBossBonus: 0.5,
  sapperChainMaxLinks: 5,
  // How long the depth a cascade reached stays readable in the lane. A
  // chain resolves in five frames -- sapperChainDelaySecs is 0.07 -- so
  // without a hold there is nothing on screen to read, which is how the
  // one mechanic that multiplies his boss damage stayed invisible.
  sapperChainReadSecs: 2,
  // A fire bomb leaves the ground burning where it went off. Shorter-lived
  // than a fire arrow's patch and worth less per second, because a blast
  // already did its damage up front — this is the after-effect, not the hit.
  fireBlastPatchDuration: 1.5, fireBlastPatchDps: 1.5,
  // An ice bomb trades damage for time: one point to anything it reaches, and
  // that long standing still. The freeze is the whole of what it buys.
  iceBlastDamage: 1, iceBlastFreezeSecs: 1.5,

  fireArrowDuration: 3.0, fireArrowDamageInterval: 0.5, specialArrowPickupCount: 3,

  // Knight
  knightSpearRange: 80, knightSpearCooldown: 1.0,
  // One per hit, landing twice, so a swing is worth 2. It was 2 per hit, and
  // a 4-point swing against a baseline 1-point arrow is four times the
  // roster's unit of damage — which is precisely what the deleted
  // bossHPKnight column existed to absorb.
  knightSpearBossDamage: 1, knightSpearSwingDuration: 0.35,
  // Bloodlust: the knight's passive, and the only per-character mechanic on
  // the roster with no key at all. Every swing that connects stacks it and a
  // swing that hits nothing empties it, so what it pays for is staying in
  // contact rather than reaching contact once — which is the thing that is
  // genuinely hard about being the slowest hero who must be within 80 px to
  // do anything.
  //
  // One figure for both halves on purpose. Damage and attack speed multiply
  // each other, so three stacks is 1.3 x 1.3 = 1.69 times the damage per
  // second, and splitting them into two dials would hide that behind
  // arithmetic nobody does at the balance table.
  knightBloodlustMax: 3, knightBloodlustPer: 0.10,
  knightWhirlwindDuration: 3, knightWhirlwindRadius: 72, knightWhirlwindCooldown: 6,
  knightWhirlwindTickRate: 0.22,  // damage/tile-break tick every N seconds during whirlwind
  knightFireSwordDuration: 8, knightFireSwordRangeMult: 2, knightFireSwordDamageMult: 2,
  knightJavelinsPerPickup: 3, knightJavelinSpeed: 580, knightJavelinPierce: 2,
  knightJavelinBossDamage: 1,
  // Block: a self-charging directional guard, no pickup needed. Reuses
  // playerShield/damagePlayer's existing absorb-one-hit handling wholesale;
  // this cooldown just decides how often it's re-granted while down.
  knightBlockCooldown: 10,
  // Charge: hold Shift to wind up (rooted, invulnerable), release to advance
  // swinging. Damage scales with hold time against the boss only; crows and
  // skeletons die outright in the arc, same as every other knight melee hit.
  knightChargeMaxHoldSecs: 3, knightChargeCooldown: 4,
  // The dash outruns his own legs, which is the whole reason the slowest hero
  // on the roster has one. It ran at 0.5 for a long time: 75 px/s, slower than
  // every other hero WALKING, and 112 px of travel against a 90 px reach --
  // releasing put him barely further forward than he could already hit from,
  // after a windup that rooted him for up to three seconds. At 1.6 it carries
  // 360 px, which is four spear lengths and an actual gap closed.
  knightChargeDashDuration: 1.5, knightChargeDashSpeedMult: 1.6,
  knightChargeMinDamageMult: 1.3, knightChargeMaxDamageMult: 2,
  knightChargeBossDamage: 2, knightChargeRadius: 90,
  knightChargeArcRadians: Math.PI / 4,  // total sweep, so ±half that off aimAngle
  knightChargeTickRate: 0.2,
  // Chained charge: a second press mid-dash, inside shiftChainSecs and with
  // room left ahead, commits him harder in the direction he already picked.
  // The dash goes from fast to faster, and he lands one whirlwind swing where
  // he stands. Once per dash — the chain is a
  // decision taken during the commitment, not a button to hold down.
  knightChargeChainSpeedMult: 2.0,
  knightChainWhirlRadius: 60, knightChainWhirlBossDamage: 1,
  // How much room ahead counts as somewhere to go. A body width, so a knight
  // already nose-first into a wall cannot chain into it.
  knightChainMinRoom: 24,

  // A second press this soon after the first extends an ability instead of
  // starting one. Shared by the wizard's blink and the knight's charge so both
  // hands learn one rhythm rather than two.
  shiftChainSecs: 1.1,
  // How long an area effect's ring stays on screen. Long enough to read the
  // reach, short enough not to sit over the fight that follows.
  shockRingSecs: 0.35,

  // Wizard. Blink is the answer to the one question the rest of the kit does
  // not: something is on me right now. Five tiles is far enough to break
  // contact with anything that walks, short enough that it crosses a room and
  // not the map. The cooldown is the storm's own, since both are the wizard's
  // "once in a while" buttons and neither should be the answer twice in a row.
  // The refusal threshold keeps a blink into a wall from costing five seconds
  // for two pixels of travel.
  // Focus: the wizard's own resource, and the only spent one on the roster —
  // everything else is a cooldown or a pool that has to be picked up. Three
  // points buy a bolt and a blink, or three bolts, so casting and escaping
  // draw on one budget and the escape button stops quietly cancelling out his
  // being the most fragile hero in the game.
  //
  // The regeneration rate is deliberately slower than the bolt cooldown: at
  // 1.2 s a cooldown-gated wizard fires forever, and a resource that refills
  // faster than it is spent is not a resource. Below that rate Focus, not the
  // cooldown, is what actually paces him.
  wizFocusMax: 3,
  wizFocusRegenSecs: 2,
  wizFocusBolt: 1,
  wizFocusBlink: 2,
  wizBlinkDistance: 160, wizBlinkCooldown: 6, wizBlinkIFrames: 0.3,
  wizBlinkMinDistance: 32,
  // A blink may be chained once, into a second hop, if the key comes down
  // again inside shiftChainSecs and there is somewhere to go. Two is the cap
  // on purpose: three would cross the arena on one cooldown, and the point of
  // the ability is to break contact, not to travel.
  wizBlinkMaxHops: 2,
  // The pulse each arrival lets off. Small enough that it is an escape which
  // punishes whoever was chasing, rather than a repositioning nuke: it clears
  // the ring of crows that closed in, and takes one point off a boss.
  wizBlinkPulseRadius: 56, wizBlinkPulseBossDamage: 1,
  // Thunderstep: how much wider each further hop of a chain arrives, as a
  // fraction of the base radius. The damage step is a whole base hit and is
  // not a dial -- see escalatedPulse in sim/blink.ts for why one of them is a
  // count and the other a length. At 0.45 a three-hop chain arrives at 56,
  // 81 and 106 px, which is a ring cleared rather than a screen cleared, and
  // it is worth 1 + 2 + 3 to a boss across the whole chain.
  //
  // Against a boss that is 6 over about two seconds, on a 6 s cooldown.
  // Deliberately less than the five bolts the same six seconds would buy: the
  // chain is not more damage than casting, it is damage taken while moving,
  // with i-frames on every arrival, which is what makes it the answer to a
  // fight that will not let him stand still.
  wizThunderstepGrowth: 0.45,
  // The rite's Overchannel capstone: how long bolts cast free after a blink.
  wizOverchannelSecs: 4,
  // The rest of the rite, and the two tier-II unlocks.
  archerSplinterFrac: 0.6,       // each splinter's share of the parent blast
  archerSplinterSpread: 62,      // px each splinter lands from the crater
  knightJuggernautPush: 96,      // px the charge throws a body it reaches
  rangerSlipstreamSecs: 3,       // owner's cap: a full meter phases this long
  rangerShrapnelBolts: 8,        // bolts a satchel throws when it blows
  sapperDemolitionGrowth: 0.30,  // each chain link widens the next blast by this
  sapperShockwavePush: 120,      // px a combo blast throws a survivor
  // A rate, not a damage. What a bolt is worth is wizBoltDamage times the
  // wizard's multiplier; this is how long he spends unable to answer
  // anything, and two full seconds of it was most of why the fight was
  // unwinnable. Bolts share maxArrowsInFlight with arrows, 5 on the default
  // pace and 3 on calm, so a calm wizard whose bolts all miss can cap out.
  wizBoltCooldown: 1.2, wizBoltSpeed: 468, wizBoltLifetime: 3.5,
  wizBoltDamage: 1, wizFireBoltDamage: 3,
  // What a bolt is worth to a body, as opposed to a boss.
  //
  // bossDamageMult is boss-only, and balance.md justifies that scope by
  // saying everything else has exactly one hit point and dies to one hit of
  // anything. That was true when it was written and is not any more: a
  // spearman has 2, a shieldman 4, and a crow in waves mode climbs to 10. So
  // on every map with a garrison the 2.5x that IS the wizard did nothing at
  // all, and the hero the panel calls the hardest hitter took 3.9 s to kill a
  // shieldman the archer kills in 0.33 s. Measured rather than estimated —
  // see the time-to-kill test in game.test.ts.
  //
  // Two, so a spearman falls to one bolt and a shieldman to two. It is the
  // biggest single hit any hero lands on a body, which is what "hits hardest"
  // has to mean somewhere other than a boss fight, and he still kills slower
  // than the click-limited kits because his rate is what he pays for it.
  wizBoltBodyDamage: 2,
  wizBoltTurnRate: 4.5,           // rad/s homing angular speed
  // Wizard-only pickup batch size (archer/ranger/knight keep their own
  // counts — specialArrowPickupCount/knightJavelinsPerPickup below — so
  // this doesn't change anyone else's ammo economy).
  wizSpecialBoltCount: 5,
  stormCooldown: 10,
  stormBlastRadius: 450,          // = dynamiteBlastRadius * 5
  stormBossDamage: 3,
  stormFlashDuration: 0.35,       // seconds of blue screen-flash after storm

  // Ranger — crossbow ammo, cooldown and pickups reuse the archer's own
  // arrows/ricochetArrows/fireArrows fields and CONFIG.arrowBossDamage
  // unchanged; only the burst and its per-bolt scale-down live here.
  crossbowBoltCount: 3, crossbowBoltDamageMult: 0.7, crossbowBoltRadiusMult: 0.7,
  // Momentum: the archer's Brace pointed the other way. The archer is paid for
  // standing still and the ranger for never doing it, which is what makes the
  // pair legible -- and it is the right shape for the fastest hero on the
  // roster, who is also the weakest against a boss at 0.8x.
  //
  // Built off ground covered rather than time spent moving, so a speed upgrade
  // and a poison slow both reach it. 375 px is a second and a half at his 250
  // px/s; the decay is three seconds from full, slower than the fill on
  // purpose. Brace drains the archer four times faster than it fills, because
  // moving is what an archer wants to do anyway and the drain has to bite.
  // Standing still is not what a skirmisher wants to do, so his penalty is the
  // gentler one and his reward is the thing he was going to do regardless.
  rangerMomentumMax: 0.30,
  rangerMomentumFullPx: 375,
  rangerMomentumDecaySecs: 3,
  crossbowSpreadRadians: Math.PI / 60,   // 3° between adjacent bolts
  // Satchel: no charge to hold, one click is one throw at a fixed speed.
  // Blast radius and boss damage reuse dynamiteBlastRadius/dynamiteBossDamage
  // below — an explosion is an explosion, not a second copy of the same figure.
  satchelThrowSpeed: 336, satchelArmFuse: 3, satchelIdleLife: 60,

  // Hit detection radii
  arrowHitRadius: 14,             // arrow / javelin vs crow
  firePatchRadius: 20,            // fire patch vs crow
  pickupRadius: 20,               // player pickup collection distance

  // Boss hit detection & damage
  bossRadius: 28,                 // collision radius (contact damage)
  bossHitRadius: 30,              // projectile hit-detection radius
  bossContactDamage: 2,           // HP lost when boss body touches player
  arrowBossDamage: 1,             // normal arrow vs boss

  // Single definition for all player resources.
  // Adding a new resource type only requires a new entry here.
  resources: {
    arrows:    { max: 10, restore: 5, color: '#aaff44', dim: '#2d2d2d', icon: '▶', spacing: 13 },
    dynamites: { max:  3, restore: 1, color: '#FFB400', dim: '#2d2d2d', icon: '■', spacing: 13 },
    satchels:  { max:  3, restore: 1, color: '#ffcc00', dim: '#2d2d2d', icon: '●', spacing: 13 },
    // The sapper's own pouch. A pickup is worth one bomb, not a refill to
    // full, so a run's supply is the ten it opened with plus whatever it
    // picks up one at a time — the cooldown paces the throwing, this caps it.
    bombs:     { max: 10, restore: 1, color: '#FF7A1A', dim: '#2d2d2d', icon: '●', spacing: 13 },
    // Focus regenerates on a timer rather than off the ground, so its restore
    // is zero: the pickup loop that tops the other pools up runs only for the
    // three heroes with a quiver, and a restore above zero here would hand the
    // wizard free casts the moment that ever changed.
    focus:     { max: 3, restore: 0, color: '#8888FF', dim: '#2d2d2d', icon: '◆', spacing: 13 }
  },

  audio: true,

  // How far one play of a sound may drift from the tuned array, as a fraction
  // of each parameter. One profile for every sound rather than a column per
  // sound: nothing here has earned its own figure, and a sound that must not
  // drift at all opts out by kind instead (SOUND_PLAYBACK, below the sound
  // definitions). Amounts are clamped to MAX_VARIATION on the way in, so this
  // cannot be tuned into a different sound every play.
  //
  // gain is the only one the noise-shaped sounds hear at full strength, which
  // is why it is the largest; tail is second because the length of a burst
  // reads even on noise; pitch is small and, on shapes 4 and 5, inaudible.
  soundVariation: { gain: 0.1, pitch: 0.04, tail: 0.12 },

  keys: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    shoot: ' ', pause: 'Escape',
    menuControls: 'c', back: 'b', restart: 'r', menu: 'm', snipe: 'Shift',
    // Striking a torch is a decision, so it gets a button. Keys, the chest and
    // the door do not: your inventory has already decided those, and a prompt
    // in front of a foregone conclusion is a button press, not a choice.
    use: 'e',
    // The way out, for when something has gone wrong and the character
    // will not move. Bound because three separate causes have trapped a
    // player so far and the fourth is not found yet: the player should
    // never be waiting on us to ship a fix before they can walk again.
    unstick: 'u'
  }
};

// ── PACE ──────────────────────────────────────────────────────────────────────

/**
 * How busy the field gets, and what the player has to answer it. The two move
 * together: raising crow density without raising arrows in flight and starting
 * ammo makes the game unwinnable rather than faster.
 *
 * baseArrows and baseDynamites are the starting count and the cap. arrowRestore
 * is how many a pickup refills; it was a flat 5 regardless of pace until
 * Nightmare needed its own. Drop rates are untouched, since more crows already
 * means more drops.
 *
 * Nightmare's baseArrows and arrowRestore are both 25% over their prior values
 * (24->30, 5->6): Nightmare was staying unwinnable because ammo ran out before
 * the crow density did, and this is the small, direct answer rather than a
 * full re-derivation of the density-to-ammo ratio the other two presets use.
 */
const PACE_PRESETS = {
  calm:      { crowStartCount:  5, crowEscalationInterval: 12, crowMax: 12, crowAggroTimeout:  4, crowPassiveSpeed:  60, maxArrowsInFlight: 3, baseArrows: 10, baseDynamites: 3, arrowRestore: 5 },
  fast:      { crowStartCount:  9, crowEscalationInterval:  4.5, crowMax: 18, crowAggroTimeout:  7, crowPassiveSpeed:  85, maxArrowsInFlight: 5, baseArrows: 16, baseDynamites: 4, arrowRestore: 5 },
  nightmare: { crowStartCount: 12, crowEscalationInterval:  2.5, crowMax: 22, crowAggroTimeout: 10, crowPassiveSpeed: 100, maxArrowsInFlight: 8, baseArrows: 30, baseDynamites: 5, arrowRestore: 6 },
};

/**
 * Copies a preset into CONFIG. Call before the first game starts, and again
 * whenever the pace changes. FEATHERS.applyToGame() re-derives arrow capacity
 * from CONFIG.baseArrows, so upgrades stack on top of the preset instead of
 * overwriting it.
 */
function applyPace(name) {
  const preset = PACE_PRESETS[name] ?? PACE_PRESETS.fast;
  CONFIG.pace = preset === PACE_PRESETS[name] ? name : 'fast';
  CONFIG.crowStartCount        = preset.crowStartCount;
  CONFIG.crowEscalationInterval = preset.crowEscalationInterval;
  CONFIG.crowMax               = preset.crowMax;
  CONFIG.crowAggroTimeout      = preset.crowAggroTimeout;
  CONFIG.crowPassiveSpeed      = preset.crowPassiveSpeed;
  CONFIG.maxArrowsInFlight     = preset.maxArrowsInFlight;
  CONFIG.baseArrows            = preset.baseArrows;
  CONFIG.baseDynamites         = preset.baseDynamites;
  // Every base* figure here is the un-upgraded starting point FEATHERS stacks
  // its levels on, which is why the restore rate gets one too: without it,
  // FEATHERS.applyToGame() would have to add its bonus to whatever the last
  // run left behind, and the rate would climb every time a run started.
  CONFIG.baseArrowRestore      = preset.arrowRestore;
  CONFIG.resources.arrows.max     = preset.baseArrows;
  CONFIG.resources.arrows.restore = preset.arrowRestore;
  CONFIG.resources.dynamites.max = preset.baseDynamites;
  // The ranger's satchel count matches the archer's dynamite count — same
  // tool tier, nothing asked for a different number.
  CONFIG.resources.satchels.max  = preset.baseDynamites;
}

applyPace(CONFIG.pace);

// ── MODULE-LEVEL CONSTANTS ────────────────────────────────────────────────────

// Keyed by bossStage (1 = crow king, 2 = dark archer, 3 = dark knight), not
// boss.kind — the entrance banner starts typing before spawnBoss() has run.
/**
 * The black screen between one stage and the next.
 *
 * Cutting straight from a death burst into a fresh map reads as a glitch, so
 * each hand-off holds on a title until the player clicks. This was one screen
 * hardcoded as its own appState; the maze made it two, which is the point a
 * copy stops being cheaper than a table.
 *
 * The stage is already fully built behind the screen when it appears. The
 * intro only decides what to say and where to go, never what to set up.
 */
const STAGE_INTROS = {
  castle: {
    text: "You've entered the cursed Castle!",
    accent: '#B040E0', dim: '#8A40A8', frame: '#4a1a5c',
    sweep: 'rgba(176,64,224,0.045)',
  },
  bastion: {
    text: 'HOLD THE BASTION',
    // Limestone and gold rather than the maze's torchlight: the run comes up
    // out of the dark into daylight for its last stand, and the title is the
    // first thing that should say so.
    accent: '#D8B048', dim: '#8f8265', frame: '#4a3b28',
    sweep: 'rgba(216,176,72,0.05)',
  },
  maze: {
    text: "YOU HAVE ENTERED THE MINOTAUR'S LAIR",
    // Torchlight amber rather than the castle's purple: the maze is lit by
    // fire and the title should be the last warm thing before the dark.
    accent: '#FFA030', dim: '#B4702A', frame: '#5c3a12',
    sweep: 'rgba(255,160,48,0.05)',
  },
};

/** Which intro is on screen right now, or null. Only 'stage_intro' reads it. */
let pendingIntro = null;

/**
 * Holds the black screen in front of a stage that is already built.
 *
 * Assigns appState directly for the same reason the castle hand-off always
 * did: transitionTo('playing') runs initGame() and would wipe the run that
 * just cleared the previous stage.
 */
function showStageIntro(kind) {
  pendingIntro = kind;
  appState = 'stage_intro';
}

// ── The mid-run choosers: the draft and the rite ─────────────────────────────
//
// One screen shape for both: the run-start and boss drafts wake an owned
// talent for this run, and the rite seals a capstone the rank earned.
// `resume` is the appState a pick returns to, so a chooser can sit over a
// staged stage_intro or a boss entrance without either noticing — the same
// direct-assignment reasoning showStageIntro gives above.
let chooser = null;
let chooserQueue = [];
let riteOffered = false;   // once per run, taken or not

function queueDraft(resume) {
  const offers = TALENTS.offers(3);
  if (offers.length === 0) return;   // an empty pool skips the ceremony
  chooserQueue.push({ kind: 'draft', offers, cursor: 0, resume });
}

/**
 * The tree, if the boss just paid for something buyable.
 *
 * Queued rather than opened, so it takes its turn behind a rite the same way
 * a draft does. Skipped when nothing is affordable: a screen offering only
 * prices the purse cannot meet is a stop with no decision in it.
 */
function queueTree(resume) {
  if (!anyAffordable(CHAR_TREES[selectedChar], TALENTS.state())) return;
  chooserQueue.push({ kind: 'tree', resume });
}

function queueRite(resume) {
  if (riteOffered) return;
  const capstones = CHAR_TREES[selectedChar].capstones;
  if (capstones.length === 0 || !riteEligible(TALENTS.state().mastery)) return;
  riteOffered = true;   // offered once, whether or not the pick is liked
  chooserQueue.push({ kind: 'rite', offers: capstones.map((c) => c.id), cursor: 0, resume });
}

function openNextChooser() {
  if (chooser !== null || chooserQueue.length === 0) return;
  chooser = chooserQueue.shift();
  // The tree is a screen of its own rather than a row of three panels, so it
  // gets its own appState. It still travels through this queue, because what
  // matters is that ceremonies take turns and the last one hands back to the
  // screen the run was on.
  appState = chooser.kind === 'tree' ? 'talents' : 'chooser';
}

/**
 * Finishes whichever ceremony is open and moves to the next, or hands the run
 * back if that was the last.
 *
 * One home for the hand-back, because a ceremony that forgot it would strand
 * the player on a screen with no way out -- and the tree, unlike the chooser,
 * is a screen the player can also open from the pause menu, where the way out
 * is somewhere else entirely.
 */
function finishCeremony() {
  const resume = chooser === null ? null : chooser.resume;
  chooser = null;
  openNextChooser();
  if (chooser !== null || resume === null) return;
  // Assigned directly rather than through transitionTo, for the reason the
  // section header gives: a ceremony sat over a hand-off the run had already
  // staged and is giving it back untouched. transitionTo('playing') from here
  // would see a prev of 'chooser', call initGame, and restart the run.
  appState = resume;
}

/** A boss just died: the rite outranks the draft when both are owed. */
function queueBossChoosers() {
  if (appState === 'win' || appState === 'gameover') return;   // run over
  // Never mid-siege. A siege boss is one enemy inside a wave rather than the
  // end of a stage -- the death tail says so itself -- and a ceremony opened
  // over a running wave stops the field with crows still on it. The siege
  // pays its mastery like any other boss; what it does not do is hold a
  // ceremony about it. CLAUDE.md's siege rule, applied to a screen.
  if (siegeRun) return;
  queueRite(appState);
  // The tree before the draft: what a boss just paid for can be spent now,
  // and the draft that follows deals from a pool the spending may have grown.
  queueTree(appState);
  queueDraft(appState);
  openNextChooser();
}

/** Whether the talent screen is open as a ceremony rather than as a shop. */
function inCeremony() {
  return chooser !== null && chooser.kind === 'tree';
}

function confirmChooser() {
  const id = chooser.offers[chooser.cursor];
  if (chooser.kind === 'draft') TALENTS.draft(id); else TALENTS.sealCapstone(id);
  finishCeremony();
}

const BOSS_ENTRY_TEXT = {
  1: '⚠  THE CROWS SUMMONED THEIR KING  ⚠',
  2: '⚠  A DARK ARCHER STIRS IN THE DEPTHS  ⚠',
  3: '⚠  THE LAST DARK KNIGHT RISES  ⚠',
  // Stage 4 is not reachable from the brawl run yet: beating the dark knight
  // still goes to the win screen. It exists so the minotaur can be spawned
  // for testing without inventing a second boss-spawn path. Wiring level 3
  // into the progression is its own piece of work, see docs/level-3-maze.md.
  4: '⚠  SOMETHING IS ALREADY IN THE MAZE  ⚠',
  // Reached from Waves mode on the cavern, not from the brawl chain above.
  5: '⚠  THEIR COMMANDER RIDES OUT  ⚠',
};



// When the HUD starts shouting about health. A fraction, not a hit count:
// HP upgrades mean a flat "3 left" is the last hit at max 10 and most of a
// third of the bar at max 20, so an absolute threshold fires later and later
// into a run as the player buys HP.
const LOW_HP_FRACTION = 0.25;

// ── STATE ─────────────────────────────────────────────────────────────────────

// appState: menu | charselect | mapselect | multiplayer | controls | playing
// | paused | boss_entrance | boss_fight | stage_intro | inventory | talents
// | win | gameover
let appState = 'menu', controlsFrom = 'menu', pausedFrom = 'playing';

let gameMode = 'brawl'; // a SinglePlayerMode; see MODE_RULES — persists across restarts
let score = 0, wave = 1, gameTime = 0, escalationTimer = 0;
// The bastion's run, or null on every other map. See the SIEGE section.
let siegeRun = null, towers = [], guards = [], siegeExtraBosses = [], siegeSpawned = false;
let pfCooldown = 0, pfSwing = 0, pfBossHit = false, pfHitFlash = false;
let fires = [], floaters = [];   // fires: burning patches; floaters: score popups
let waveAnnounce = 0;            // countdown timer for wave banner display
let waveAnnounceText = '';       // what the banner says while it is up
let menuSelection = 0;

/**
 * The title-screen menu, in one place. Order here is the order on screen, the
 * order the arrow keys walk, and the index menuSelection holds; the renderer
 * and the input handler both read this table, so adding an entry is one row
 * rather than an edit in four places that have to agree on an index.
 *
 * `section` splits the list either side of the separator rule: 'mode' entries
 * start a game, 'util' entries do not.
 */
const MENU_ENTRIES = [
  { key: 'B', label: 'BRAWL', section: 'mode',
    sub: 'hunt 10 crows  ·  boss fight  ·  scarce drops',
    run: () => { gameMode = 'brawl'; transitionTo('charselect'); } },
  { key: 'W', label: 'WAVES', section: 'mode',
    sub: 'survive escalating swarms  ·  endless run',
    run: () => { gameMode = 'waves'; transitionTo('charselect'); } },
  { key: 'S', label: 'SIEGE', section: 'mode',
    sub: 'hold the bastion  ·  ten waves  ·  a retinue that grows',
    // Off the screen until the ladder and the retinue are wired into the loop.
    // MODE_RULES.siege and the bastion map are finished and tested; what is
    // missing is anything driving the spawners, so a run today lands on the
    // bastion and stays empty with nothing to fight and no way to end. Its
    // rules stay here rather than being deleted and rebuilt: delete this one
    // line to put the mode back.
    hidden: true,
    run: () => { gameMode = 'siege'; transitionTo('charselect'); } },
  { key: 'M', label: 'MULTIPLAYER', section: 'mode',
    sub: 'up to 4 players  ·  co-op or 2v2  ·  needs a server',
    run: () => transitionTo('multiplayer') },
  { key: 'C', label: 'CONTROLS', section: 'util',
    run: () => transitionTo('controls') },
];
/**
 * The entries a player can actually reach: everything MENU_ENTRIES holds that
 * is not hidden. Derived rather than hand-kept, and read by the draw, the
 * arrow-key walk and the hotkeys alike, so a hidden row cannot be off the
 * screen but still selectable — which is how a mode nobody can see would
 * otherwise stay one Enter away.
 */
const MENU_SHOWN = MENU_ENTRIES.filter((e) => !e.hidden);

let controlsSelection = 0, remapTarget = null;

/**
 * The character-select screen, in one place. drawCharSelect() renders these
 * panels in array order, and the charselect input handler in stepGame() reads
 * the same array for arrow-key cycling and the bracketed hotkey, so a new
 * character is one entry rather than two lists that have to independently
 * agree on the same three names.
 *
 * `preview` belongs here for that reason and not by preference. It used to be
 * a private lookup inside _drawCharPreview, keyed by character and checked by
 * nothing, so the sapper shipped with a panel and no portrait: the row was
 * simply missing and a missing row draws nothing rather than failing. Holding
 * it here means the row that adds a character is the row that gives it a face.
 * It is a function because the ranger's cloak sway is a real 3-frame cycle, so
 * its grid depends on the frame while the other four are fixed poses.
 */
// Difficulty gradient for the char-select panels, one home for the
// label/color pair so all four panels agree on what "hard" looks like.
// Rendered at full brightness regardless of panel selection (unlike
// everything else in a dimmed panel) so all four are scannable at a glance.
const DIFFICULTY = {
  easy:      { label: 'EASY',       color: '#39FF14', order: 1 },
  medium:    { label: 'MEDIUM',     color: '#CCAA00', order: 2 },
  hard:      { label: 'HARD',       color: '#FF8C00', order: 3 },
  extraHard: { label: 'EXTRA HARD', color: '#FF3B30', order: 4 },
};

/** Steps the difficulty meter draws, which is every row of DIFFICULTY. */
const DIFFICULTY_STEPS = Object.keys(DIFFICULTY).length;
/** How many pips a stat row draws, so the rating scale and the art agree. */
const STAT_SCALE = 5;

/**
 * The best speed and HP any character has, which the derived ratings are
 * scaled against. Read off CHARACTER_STATS rather than written down, so a
 * character that really is faster or tougher moves the whole scale instead of
 * quietly exceeding a hardcoded ceiling.
 */
const STAT_PEAKS = Object.values(CHARACTER_STATS).reduce(
  (peak, s) => ({ speed: Math.max(peak.speed, s.speed), maxHp: Math.max(peak.maxHp, s.maxHp) }),
  { speed: 1, maxHp: 1 },
);

/** A raw stat as 1..STAT_SCALE pips, relative to the roster's best. */
const statPips = (value, peak) =>
  Math.min(STAT_SCALE, Math.max(1, Math.ceil((value / peak) * STAT_SCALE)));

/**
 * `range` and `damage` are a judgement call per row, deliberately. Neither
 * summarises one number the way HP and speed do — an archer's range is its
 * bow, its pickups and a power-shot root together, and the sapper's damage is
 * a bomb, a barrage and a detonation with falloff. There is nothing to derive
 * them from, so they are authored, and they are the only two that are.
 *
 * HP and SPEED are not here: they come from CHARACTER_STATS below, because a
 * number typed here would be free to drift away from the one the simulation
 * actually runs on.
 *
 * `damage` is the one authored bar with something to check it against. It is
 * still not derived from bossDamageMult — a pip is a coarse impression of a
 * whole kit and the multiplier is one number the sim runs on, so neither
 * produces the other — but they are not allowed to disagree about the
 * ordering, and assertPanelDamageOrder below refuses to load if they do.
 */
const CHAR_PANELS = [
  { char:'archer', key:'A', color:'#39FF14', bg:'rgba(57,255,20,0.08)',  dim:'#1a7a08',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
    difficulty: DIFFICULTY.medium,
    preview: (frame) => ({ grid: buildArcherGrid(frame, SP_TRIM.archer), sprite: ARCHER_SPRITE, key: `archer|${frame}` }),
    paintWeapon: (c, v) => paintArcherBow(c, {
      aim: v.aim, draw: v.act ? v.act.draw : 0, recoil: v.act ? v.act.recoil : 0,
      trim: SP_TRIM.archer, wash: (colour) => colour,
    }),
    hook: 'Longbow and quiver', range: 5, damage: 3,
    skills: { main: 'Longbow, three arrows in flight',
              secondary: 'Dynamite, thrown further the longer held',
              shift: 'Draw a power shot that pierces',
              passive: 'Brace: stand still, boss hits land 1.8x' } },
  { char:'wizard', key:'W', color:'#8888FF', bg:'rgba(100,80,255,0.10)', dim:'#1a1a6a',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
    difficulty: DIFFICULTY.extraHard,
    preview: (frame) => ({ grid: buildWizardGrid(frame, SP_TRIM.wizard), sprite: WIZARD_SPRITE, key: `wizard|${frame}` }),
    paintWeapon: (c, v) => paintWizardStaff(c, {
      aim: v.aim, t: v.t, cooldown: null, wash: (colour) => colour,
    }),
    hook: 'Homing glass cannon', range: 4, damage: 5,
    skills: { main: 'Homing bolts that seek the nearest target',
              secondary: 'Lightning storm across a wide area',
              shift: 'Blink, tap again to chain a second hop',
              passive: 'Focus: 3 points buy your bolts and blinks' } },
  { char:'knight', key:'K', color:'#C8C8E8', bg:'rgba(150,160,200,0.10)',dim:'#2a2a4a',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
    difficulty: DIFFICULTY.hard,
    preview: (frame) => ({ grid: buildKnightGrid('normal', frame, SP_TRIM.knightNormal), sprite: KNIGHT_SPRITE, key: `knight|normal|${frame}` }),
    hook: 'Armoured brawler', range: 1, damage: 3,
    skills: { main: 'Long spear at melee reach, hits twice',
              secondary: 'Whirlwind that breaks the tiles around you',
              shift: 'Charge a dash, tap again to chain it',
              passive: 'Bloodlust: 3 hits stack +30% damage/speed' } },
  { char:'ranger', key:'X', color:'#FFCC00', bg:'rgba(255,204,0,0.10)',  dim:'#7a5a00',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
    difficulty: DIFFICULTY.easy,
    preview: (frame) => ({ grid: buildRangerGrid(frame, SP_TRIM.ranger), sprite: RANGER_SPRITE, key: `ranger|${frame}` }),
    hook: 'Fast skirmisher', range: 3, damage: 2,
    skills: { main: 'Crossbow burst of three weaker bolts',
              secondary: 'Satchel charge: throw, then click to arm',
              shift: 'Throw a net that holds what it catches',
              passive: 'Momentum: keep moving for up to +30%' } },
  { char:'sapper', key:'S', color:'#FF7A1A', bg:'rgba(255,122,26,0.10)', dim:'#7a3300',  dimBg:'rgba(255,255,255,0.025)', newBadge:true,
    difficulty: DIFFICULTY.hard,
    preview: (frame) => ({ grid: buildSapperGrid(frame, SP_TRIM.sapper), sprite: SAPPER_SPRITE, key: `sapper|${frame}` }),
    hook: 'Bombs and pitchfork', range: 2, damage: 3,
    skills: { main: 'Ten bombs, pitchfork when the pouch empties',
              secondary: 'Five-bomb barrage in a wide fan',
              shift: 'Piercing triple shot, sets off your bombs',
              passive: 'Bombs set off bombs; hold to place three' } },
].map((p) => {
  const stats = CHARACTER_STATS[p.char];
  // Loud at load rather than a panel with two blank bars. A character with a
  // panel and no CHARACTER_STATS row is the same silent gap the preview lookup
  // used to have, and the sapper is what that cost last time.
  if (!stats) throw new Error(`CHARACTER_STATS has no row for '${p.char}' (CHAR_PANELS has a panel for it)`);
  return { ...p, statBars: [
    { label: 'RANGE',  pips: p.range },
    { label: 'DAMAGE', pips: p.damage },
    { label: 'HP',     pips: statPips(stats.maxHp, STAT_PEAKS.maxHp), value: stats.maxHp },
    { label: 'SPEED',  pips: statPips(stats.speed, STAT_PEAKS.speed) },
  ] };
});

/**
 * Refuses to load a roster whose DAMAGE bars contradict the multipliers the
 * simulation runs on. Rank the heroes by bossDamageMult and the bars must not
 * climb: a character who hits softer than another may tie its bar, never beat
 * it. Ties are allowed because five pips cannot separate 1.5 from 1.4.
 *
 * Loud at load, like the missing-stats throw above it and MAP_PANELS' own
 * check, because the failure this catches is a panel that lies about a
 * character rather than one that draws wrong — nothing crashes, the player is
 * just told something untrue and has no way to find out.
 */
function assertPanelDamageOrder(panels) {
  const ranked = [...panels].sort((a, b) =>
    CHARACTER_STATS[b.char].bossDamageMult - CHARACTER_STATS[a.char].bossDamageMult);
  for (let i = 1; i < ranked.length; i++) {
    const harder = ranked[i - 1], softer = ranked[i];
    if (softer.damage > harder.damage) {
      throw new Error(
        `CHAR_PANELS: '${softer.char}' shows DAMAGE ${softer.damage} but hits softer than ` +
        `'${harder.char}' at ${harder.damage} ` +
        `(bossDamageMult ${CHARACTER_STATS[softer.char].bossDamageMult} vs ` +
        `${CHARACTER_STATS[harder.char].bossDamageMult})`);
    }
  }
}
assertPanelDamageOrder(CHAR_PANELS);

/**
 * The ability slots a selected panel lists, as [heading, row key], in the order
 * they appear. One list rather than repeated draw calls, so the headings and
 * the keys they read cannot drift apart.
 *
 * The first three are the bound ones: `main` is the shoot key, `secondary` is
 * startCharge(), and `shift` is the snipe key — sniper mode for the archer and
 * ranger, a distinct ability for the other three.
 *
 * `passive` is the fourth and it has no key at all, which is exactly why it had
 * to be added. Every hero gained something unbound — Brace, Focus, Bloodlust,
 * Momentum, chained bombs — and the pick screen is where a player decides what
 * to play, so an ability that only appears in the manual is an ability most
 * players never learn they have.
 */
const SKILL_SLOTS = [
  ['MAIN', 'main'], ['SECONDARY', 'secondary'], ['SHIFT', 'shift'], ['PASSIVE', 'passive'],
];

/**
 * The map-select screen shown between character-select and the run, Waves
 * mode only. Same shape as CHAR_PANELS for the same reason: drawMapSelect()
 * and the mapselect input handler both read this table, so a third map kind
 * is a row here, not a second list to keep in sync.
 *
 * Brawl skips this screen entirely and always starts on forest — see the
 * architecture doc's map-selection table. Membership is derived from
 * MAP_RULES (imported above, from arena-map.ts) rather than a hand-kept
 * list: a map earns a panel by fielding a wave of its own, which `runsWaves`
 * answers off MAP_RULES.population, so the maze (scripted — it's a brawl
 * stage, not a free choice) excludes itself instead of needing to be
 * remembered. That used to read `crows`, which happened to give the same
 * answer only while every wave map's wave was made of birds; the cavern
 * fields soldiers and would have silently lost its panel.
 * MAP_PANEL_INFO's presentation fields (key/color/lines) are still a
 * hand-kept table, unavoidably — display strings aren't derivable from a
 * population — so the construction below fails loudly at load if a row is
 * missing instead of drawing a blank panel.
 */
// The one shade every unselected panel dims to, in both this table and
// CHAR_PANELS above — not a per-panel choice, so it lives once here rather
// than repeated on every row.
const DIM_PANEL_BG = 'rgba(255,255,255,0.025)';
const MAP_PANEL_INFO = {
  forest: { key:'F', color:'#39FF14', bg:'rgba(57,255,20,0.08)', dim:'#1a7a08', dimBg: DIM_PANEL_BG,
    lines:['Open ground, scattered cover','Long sightlines for crows','The classic run'] },
  castle: { key:'C', color:'#AAB4C0', bg:'rgba(170,180,192,0.10)', dim:'#4A5560', dimBg: DIM_PANEL_BG,
    lines:['Denser walls, tight corridors','Crows funnel, fights close','A sharper, closer fight'] },
  // V, not C: the castle has that. Same reason the multiplayer lobby's map
  // keys are mnemonics, and the same reason RANGER answers to X.
  cavern: { key:'V', color:'#5AD8B0', bg:'rgba(90,216,176,0.10)', dim:'#2A6858', dimBg: DIM_PANEL_BG,
    lines:['Rough chambers, still pools','Wide rooms, short blind necks','Rock cover, fungus that burns'] },
};
const MAP_PANELS = MAP_KINDS
  .filter(kind => runsWaves(kind))
  .map(kind => {
    const info = MAP_PANEL_INFO[kind];
    // Fails at load rather than the first time the mapselect screen renders
    // an undefined-riddled panel: a map whose MAP_RULES row runs waves
    // still needs a row here, this just makes forgetting one loud and early.
    if (!info) throw new Error(`MAP_PANEL_INFO has no entry for '${kind}' (runsWaves says it earns a panel)`);
    return { kind, ...info };
  });

/**
 * One step of arrow-key-cycle-or-hotkey-match selection over a panel table,
 * shared by charselect (CHAR_PANELS/selectedChar) and mapselect
 * (MAP_PANELS/selectedMapKind) so the two don't separately reimplement the
 * same wraparound arithmetic. `field` is which property of each panel holds
 * the value being selected ('char' or 'kind').
 *
 * Arrow branches are `if`/`else if`: holding both in the same tick picks one
 * direction rather than computing the second from an index the first branch
 * already moved past.
 */
function cyclePanelSelection(panels, current, field) {
  const values = panels.map(p => p[field]);
  const n = values.length, i = values.indexOf(current);
  if (keys['ArrowLeft'])       { const next = values[(i+n-1)%n]; keys['ArrowLeft']=false; return next; }
  else if (keys['ArrowRight']) { const next = values[(i+1)%n];   keys['ArrowRight']=false; return next; }
  for (const p of panels) {
    const lower = p.key.toLowerCase();
    if (keys[lower] || keys[p.key]) { keys[lower] = keys[p.key] = false; return p[field]; }
  }
  return current;
}

// Character selection — persists for the session, reset only on new run.
// Declared here rather than with the other menu state below because the
// health a run opens on is the selected character's, and playerHP is the
// next line.
// Typed rather than left to inference: the union was written in a comment
// here and checked by nothing, so every table keyed by it took a bare string.
/** @type {import('../net/protocol').CharacterKind} */
let selectedChar = 'archer';
let playerHP = CHARACTER_STATS[selectedChar].maxHp, playerHitFlash = 0;
// Counts down after any refused action, to flash the reticle. See ACTION_BLOCKED.
let blockedFlash = 0;
let killCount = 0, dropStreak = 0, playerShield = false;
// Set by an ice skeleton's bolt landing. Counts down in updatePlayer, which
// returns before reading input while it is positive, so movement, aiming
// and every weapon lock out together for the duration.
let playerFrozenTimer = 0;
// Counts down to the next escape-hatch probe — see unstickPlayer().
let unstickCheck = 0;
// How long the player has been asking to move without moving, and how far
// they were when it started — see the refusal report in updatePlayer().
let refusedFor = 0, refusedAt = null, refusedReported = false;
// Rat venom. Mirrors playerFrozenTimer's shape: one countdown owns the whole
// effect, so the damage tick, the slow and the tint all read one source. A
// fresh bite refreshes rather than stacks, the same call dazeBoss makes.
let playerPoison = { timer: 0, tickIn: 0 };
// Its own counter, deliberately not sharing killCount: see the comment above
// the SKELETONS section for why that separation is load-bearing.
let skeletonKillCount = 0;
// The castle stage's own gauntlet: 0 before it starts, 1-9 during it. See
// startCastleWave. Distinct from `wave`, which is waves-mode's own counter
// and never advances during brawl mode.
let castleWave = 0;
// Which boss brawl mode is on: 1 = crow king (forest), 2 = dark archer,
// 3 = dark knight (both castle). Read by spawnBoss(); advanced by
// updateBossDeath() when a non-final boss dies.
let bossStage = 1;
let boss = null, bossDeathSeq = null, entrance = null;
let winScore = 0, winKills = 0, winSkeletons = 0, winHP = 0;

// Map selection for Waves mode — persists for the session. Brawl ignores this
// and always starts on forest; see MAP_PANELS and MENU_ENTRIES' 'WAVES' entry.
// One of MAP_PANELS' kinds, which is every MAP_RULES map that runs waves.
/** @type {import('../sim/arena-map').MapKind} */
let selectedMapKind = 'forest';

// Wizard combat cooldowns
let wizBoltCD = 0;   // 3-second cooldown for magic bolts
let sapperChargeCD = 0;  // the sapper's whole ammo economy, see CONFIG.sapperChargeCooldown
/** The deepest link the last cascade reached, and how long it stays
 *  readable. The peak rather than the last bomb: a chain goes off from the
 *  inside out and the final blast is not the deepest one. */
let sapperChainPeak = 0, sapperChainRead = 0;
/** Charges still owed to the burst in progress, and the timer to the next. */
let sapperBurstLeft = 0, sapperBurstTimer = 0, sapperBurstThrown = 0;
let sapperBarrageCD = 0, sapperShotCD = 0;
// Arcane Blink: what the wizard spends the sniper key on. The iframe is the
// short mercy window on arrival, without which blinking out of a swarm still
// takes the hit you blinked away from.
let wizBlinkCD = 0, wizBlinkIFrame = 0;
// Focus is the one pool in the game that fills itself, so unlike every other
// entry in `inv` it is a real number rather than a count. It climbs a little
// every frame and the HUD's cell track draws the part-filled point, which is
// what a regenerating resource should look like -- it used to sit still for two
// seconds and then jump a whole pip, which reads as the bar being broken.
//
// Nothing about the pacing changes. Accumulating 1/wizFocusRegenSecs per second
// crosses 1.0 at exactly the same moment granting a whole point every
// wizFocusRegenSecs did, and the spend guards compare against the same figures,
// so the frame a cast becomes affordable is unchanged.

/**
 * Which fallback weapon is mid-swing.
 *
 * The swing itself is one piece of code for every hero who runs dry (see
 * tryFallbackMelee), so the weapon has to be remembered rather than derived:
 * `selectedChar` would work today only because exactly one hero swings a
 * broom, and would quietly pick the wrong art the moment a second one did.
 */
/** @type {import('../sim/events').WeaponKind & ('pitchfork' | 'broom')} */
let pfKind = 'pitchfork';
// Hops still available in the current chain, and the window they must be
// taken in. The window is what makes a chain a rhythm rather than a stored
// charge: let it lapse and the ability is back to its plain cooldown.
let wizBlinkHops = 0, wizBlinkChainTimer = 0;
// Overchannel's remaining free-bolt window, seconds. Only ever nonzero when
// the rite sealed that capstone this run.
let wizOverchannel = 0;
/**
 * Slipstream's remaining window, seconds.
 *
 * Armed when the ranger's meter first reaches full and spent while it stays
 * there, so the capstone is three seconds of a full run rather than an
 * indefinite one -- the owner's cap, and the reason it is a timer and not a
 * flag. Dropping below full disarms it, so the next full meter re-arms.
 */
let rangerSlip = 0;
// The same window for the knight, opened when a dash starts.
let knightChainTimer = 0;
let stormCD   = 0;   // 10-second cooldown for lightning storm
let _stormFlash = 0; // countdown for the brief blue screen-flash after storm
/**
 * How long the storm's own art has left, and the blink's.
 *
 * Separate from `_stormFlash` on purpose. That is the screen flash and the
 * boss hit-flash, tuned to 0.35 s, and nine lightning strikes cannot stagger
 * themselves inside a third of a second without arriving as one white frame.
 * The blink's is shorter than its 0.3 s of invulnerability, so the effect is
 * gone before he is vulnerable again rather than outliving the protection.
 */
let stormFx = 0, blinkFx = 0, blinkRadius = 0;
let blinkFrom = { x: 0, y: 0 }, blinkTo = { x: 0, y: 0 };

// Knight combat state
let knightSpearCD = 0, knightSpearSwing = 0, knightSpearBossHit = false, knightSpearPhase2Hit = false;
/** Stacks held, 0..knightBloodlustMax. See CONFIG.knightBloodlustMax. */
let knightBloodlust = 0;
/**
 * Whether the swing in progress has touched anything yet.
 *
 * Latched across the whole swing rather than read at the end, because the
 * thrust sweeps: the crow it catches at full reach is long gone from the hit
 * test by the time the recovery frames run, and asking "is anything in range
 * now" would empty the stacks on a swing that plainly connected.
 */
let knightSpearConnected = false;
let knightWhirlwindCD = 0, knightWhirlwindTimer = 0, knightWhirlwindTick = 0;
// Counts down to the next free Block charge while no shield is banked (see
// the per-frame tick in updatePlayer); frozen while playerShield is true,
// since there's nothing to wait for until the current charge is used.
let knightBlockCD = 0;
// Charge windup, mirroring the dynamite `charge` object below. `dash` runs
// after release; `tick` paces its repeating arc hit-test the way
// knightWhirlwindTick paces the whirlwind's.
let knightCharge = { on: false, t0: 0 };
// No separate active flag: `timer > 0` is the live check, matching whirlwind.
let knightDash = { timer: 0, frac: 0, angle: 0, bossHit: false };
let knightChargeTick = 0, knightChargeCD = 0;

// Inventory — all resource counts live here, keyed by CONFIG.resources
let inv    = {};   // { arrows: n, dynamites: n }
let iFlash = {};   // empty-attempt flash timer per resource key

// Dynamite charge state
let charge = { on: false, t0: 0 };
// The archer's draw, on the key that means sniper mode for the sapper. Same
// shape as `charge` above, and deliberately so: the hand already knows it.
let archerDraw = { on: false, t0: 0 };
/**
 * Ground a full stride cycle covers, in pixels. The walk phase is derived from
 * it rather than ticking at a fixed rate.
 *
 * A flat `walkPhase += 8 * dt` meant one cycle per 157px at the base speed —
 * two steps to cross five body widths, so the hero skated and the legs
 * shuffled. Sixty-four is a stride of about one body height per step, which is
 * what a walk looks like.
 *
 * Deriving it from speed also means the swiftness upgrade and a poison slow
 * both reach the legs. At a fixed rate a hero bought up to 260px/s kept the
 * cadence of one at 200 and skated further with every level.
 */
const WALK_CYCLE_PX = 64;

/** Radians of walk phase for a distance travelled. */
function walkPhaseFor(distancePx) {
  return (distancePx / WALK_CYCLE_PX) * Math.PI * 2;
}

let archerPowerCD = 0;
/**
 * Seconds left of the snap forward after a shot leaves, counting down.
 *
 * Not a cooldown and deliberately not near one: nothing is gated on it, it
 * only tells the bow painter how far through a release it is. An ordinary
 * arrow has no windup at all, so this is the only thing that makes loosing one
 * look like anything.
 */
let archerLoose = 0;
/**
 * How drawn the shot that is currently snapping back was, 0 for an ordinary one.
 *
 * Separate from `archerLoose`, which every shot sets. The release flourish
 * belongs to the power shot alone -- an ordinary arrow has no windup, so a snap
 * scaled to one would be a promise the shot never made.
 */
let archerLoosePower = 0;
/**
 * How far the archer is braced, 0 to 1.
 *
 * Held here rather than derived from a "time since last moved" stamp, because
 * the drain has to be its own rate: a stance you lose four times faster than
 * you build is a decision, and one that simply resets is a punishment.
 */
let braceLevel = 0;
const ARCHER_LOOSE_SECS = 0.12;
// The ranger's net, the same draw-and-release shape as the archer's bow. He is
// not rooted while he draws: it is a throw rather than an aimed shot, and the
// skirmisher is the one character whose whole identity is not standing still.
/**
 * Momentum, 0..1. Multiply by CONFIG.rangerMomentumMax for the bonus itself.
 *
 * Held as a fraction of full rather than as the percentage, so the cap is one
 * number in one place: raising rangerMomentumMax changes what a full meter is
 * worth without touching the fill rate, the decay, or the chip that draws it.
 */
let rangerMomentum = 0;

let rangerNet = { on: false, t0: 0 };
let rangerNetCD = 0;
let nets = [];
/**
 * Nets lying on the ground, as opposed to `nets`, which is the throw in flight.
 *
 * Purely a thing to look at: the hold itself is still each caught enemy's own
 * `heldTimer`, and a mat expiring frees nothing. Two lists rather than a flag
 * on one, because a net in the air and a net on the ground share no field that
 * matters and every consumer wants exactly one of them.
 */
let netMats = [];

function resetInv() {
  for (const [k, r] of Object.entries(CONFIG.resources)) { inv[k] = r.max; iFlash[k] = 0; }
  inv.ricochetArrows = 0; inv.fireArrows = 0;
  // Elemental bombs are pickup-only, the way fire arrows are: the pouch opens
  // full of plain ones and these arrive during the run.
  inv.fireBombs = 0; inv.iceBombs = 0;
  inv.fireBolts = 0; inv.laserStreams = 0;
  inv.knightJavelins = 0; inv.knightFireSwordTimer = 0;
  charge.on = false;
}

function transitionTo(next) {
  if (next === 'controls') controlsFrom = appState;
  const prev = appState;
  appState = next;
  // Winning the run is a mastery milestone, and this is the one door into
  // 'win' - awarded here rather than at each victorious call site.
  if (next === 'win' && prev !== 'win') TALENTS.award('run_won');
  // A freeze belongs to one moment of one run. Resuming from the pause menu,
  // starting a fresh run, or walking into a boss fight all end that moment, so
  // none of them inherit whatever the last impact was still owed.
  hitstop.clear();
  if (prev !== next) log.info('transitionTo', `${prev} -> ${next}`, { prev, next, gameMode, mapKind });
  // The multiplayer screen owns a socket, so entering opens one and leaving
  // closes it. Handled here rather than at each call site, because every route
  // out of the screen (back, error, match start) must not leak the connection.
  if (next === 'multiplayer' && prev !== 'multiplayer') openMultiplayer();
  if (prev === 'multiplayer' && next !== 'multiplayer') closeMultiplayer();
  if (next === 'playing' && prev !== 'paused' && prev !== 'controls'
      && prev !== 'inventory' && prev !== 'talents') {
    initGame();
    // No opening draft. A run starts on the field, and the first talent
    // choice is a thing the first boss pays for -- a ceremony before anything
    // has happened asks the player to choose between three names they have no
    // reason to prefer yet, and it delays the run to do it.
  }
  // A charge/dash held into the pause menu has nowhere left to receive the
  // keyup that would normally release it — see cancelHeldActions().
  if (next === 'paused') cancelHeldActions();
  if (next === 'boss_entrance') entrance = {
    timer: 0, textProgress: 0, overlayAlpha: 0,
    fadeOut: false, crowsWhite: false, bossMoved: false,
    flash1: false, flash2: false, screchPlayed: false,
    treesBurned: false
  };
  if (next === 'boss_fight' && prev !== 'paused') { boss.screchCD = CONFIG.bossScreechInterval; bossDeathSeq = null; }
  if (next === 'win')      { winScore = score; winKills = killCount; winSkeletons = skeletonKillCount; winHP = playerHP; }
  if (next === 'gameover') events.emit({ type: 'GAME_OVER' });
}

// ── TILEMAP ───────────────────────────────────────────────────────────────────

const tileMap = new TileMap(CONFIG.rows, CONFIG.cols);
let waterPhase = false, waterLastTs = 0;

let mapSeed = 0;
/** @type {import('../sim/arena-map').MapKind} */
let mapKind = 'forest';

/**
 * Burnt cover growing back. Watches the grid, so every way this game chars a
 * tile — fire arrows, a lightning storm, a whirlwind — feeds it without
 * knowing it is there. See sim/regrowth.ts.
 *
 * Bodies are what it cannot see for itself, so occupancy is passed in: a tree
 * maturing under something standing on it would seal that thing inside
 * terrain. Pickups count for the same reason even though they do not move —
 * one inside a tree cannot be walked onto, so it is gone until something burns
 * the tile back down.
 *
 * Crows are not asked about: a passive one crosses the map in a straight line
 * with no terrain check at all, so it would veto tiles it is only flying over.
 * Neither are the maze's rats, and that one is not a judgement call — regrowth
 * is off entirely on a map MAP_RULES marks indestructible, and the maze is the
 * only place a rat has ever stood.
 */
const regrowth = new Regrowth(tileMap, mapKind, undefined, (row, col) => {
  const ts = CONFIG.tileSize;
  // Overlap, not "is centred on", and each body asked about with the radius its
  // own movement code collides with.
  //
  // updatePlayer samples all four corners of a playerRadius box and only moves
  // when every one is passable. A body near a tile edge is therefore partly on
  // the next tile, and a tree maturing there locks it in place for good: each
  // incremental step keeps that same corner inside the new tree, so all four
  // directions refuse and nothing short of burning the tile frees it. Asking
  // only about the centre tile is what let that happen.
  //
  // Radius 0 for the rest because that is genuinely their collision model:
  // updateBoss and updateSkeletons test the single point at their centre, and
  // a pickup is a point on the ground. Giving them a box here would be
  // inventing a footprint the movement code does not honour.
  const overlaps = (b, radius) => {
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
    return Math.floor((b.x - radius) / ts) <= col && col <= Math.floor((b.x + radius) / ts)
        && Math.floor((b.y - radius) / ts) <= row && row <= Math.floor((b.y + radius) / ts);
  };
  return overlaps(player, CONFIG.playerRadius)
    || overlaps(boss, 0)
    || skeletons.some((s) => overlaps(s, 0))
    || pickups.some((p) => overlaps(p, 0));
});

/**
 * Generates the map, defaulting to 'forest' so a bare call is still a valid
 * one. `kind` comes from three real sources today: brawl's own scripted
 * stage transitions (`'castle'`, then `'maze'`), Waves mode's mapselect
 * screen (`selectedMapKind`, any map runsWaves accepts), and the dev
 * harness.
 *
 * @param {import('../sim/arena-map').MapKind} kind
 */
function generateMap(kind = 'forest') {
  mapKind = kind;
  mapSeed = (Math.random() * 2 ** 32) >>> 0;
  const rng = mulberry32(mapSeed);
  // SimplexNoise 2.4 takes a random fn, so terrain derives fully from the seed.
  const sn = new SimplexNoise(rng);
  // Announced rather than applied: which painters a theme uses is a render
  // decision, and this function is simulation. The listener boot() registers
  // swaps them, and it runs before the reset below so the map is painted once
  // instead of once per theme.
  events.emit({ type: 'MAP_GENERATED', kind });
  // MAP_GEN holds a generator per kind, not a density: the maze is carved
  // rather than thresholded, so the noise source is offered and ignored by
  // the generators that do not want it. See docs/level-3-maze.md.
  tileMap.reset(MAP_GEN[kind].generate(CONFIG.rows, CONFIG.cols, rng,
    (x, y) => sn.noise2D(x, y)));
  // Regrowth is per-map twice over: which rules apply, and which tiles are
  // still coming back. Both change here, so retarget does both — half-burnt
  // tiles from the last map are coordinates on a grid that no longer exists.
  regrowth.retarget(kind);
  // The objective belongs to the maze and to no other map, so it is built and
  // cleared here, with the grid it is placed on. Every consumer then has one
  // guard, `mazeRun`, instead of its own check on mapKind.
  mazeRun = kind === 'maze' ? newMazeRun() : null;
  // Same argument as mazeRun, one map along: the siege belongs to the bastion,
  // it is opened and closed with the grid, and every consumer then has one
  // guard — siegeRun — instead of its own check on mapKind.
  if (mapIsSiege()) startSiegeRun(); else endSiegeRun();
  // A population belongs to its map. Moving to one that does not have it has
  // to take the last map's with it, or they keep walking through the new map's
  // walls and keep counting toward a win condition this map does not use.
  if (!mapHasCrows()) crows = [];
  if (!mapHasSoldiers()) soldiers = [];
  // Sight is grid-shaped too, so memory of the last map is a lie about this
  // one. It stays here rather than behind MAP_GENERATED: placing torches needs
  // the grid and puts real objects in the world, which is simulation, even
  // though what the fog then draws is not.
  resetSight();
}

/**
 * Where a run starts, snapped to open floor. Three callers wanted the same
 * point — the fresh run, the harness reposition, and the maze objective, which
 * has to be placed far from it — so the constant lives here rather than in the
 * first two and then a third copy.
 */
function spawnPoint() {
  return nearestOpenTile(2.5 * CONFIG.tileSize, (CONFIG.rows / 2) * CONFIG.tileSize);
}

/**
 * The centre of the closest tile to (wx, wy) that a body can stand on.
 *
 * The spawn point used to be a bare constant, which worked only because
 * generateGrid carves a guaranteed clear zone around it. A carved map makes no
 * such promise: the maze puts walls on every even index, so the old spawn
 * landed inside rock. Rings outwards the same way multiplayer's
 * nearestStandable does (src/sim/spawns.ts) rather than inventing a second
 * answer to the same question. Falls back to the point itself, since every map
 * this can be asked about has open tiles somewhere near the middle.
 */
function nearestOpenTile(wx, wy) {
  const ts = CONFIG.tileSize;
  const col0 = Math.floor(wx / ts), row0 = Math.floor(wy / ts);
  const centre = (r, c) => ({ x: c * ts + ts / 2, y: r * ts + ts / 2 });
  for (let radius = 0; radius <= 12; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        // Only the ring's edge is new; the inside was covered by smaller radii.
        if (radius > 0 && Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
        const r = row0 + dr, c = col0 + dc;
        if (r < 0 || r >= CONFIG.rows || c < 0 || c >= CONFIG.cols) continue;
        if (tilePassable(tileMap.get(r, c))) return centre(r, c);
      }
    }
  }
  return { x: wx, y: wy };
}

function tileAt(wx, wy) {
  const c = Math.floor(wx / CONFIG.tileSize), r = Math.floor(wy / CONFIG.tileSize);
  if (c < 0 || c >= CONFIG.cols || r < 0 || r >= CONFIG.rows) return TILE.ROCK;
  return tileMap.get(r, c);
}

// Storm and whirlwind level terrain the same way: trees char to ash,
// rocks and huts are cleared outright.
/** Can anything on this map break terrain at all? One home for the rule. */
function terrainDestructible() {
  return MAP_RULES[mapKind].destructibleTerrain;
}

/**
 * How fast everything hostile moves here, as a multiplier. One home again.
 *
 * The bastion runs at 0.8 because a siege is fought from a fixed position: you
 * are holding a line rather than kiting round an arena, and at full speed a
 * wave crosses the open ground faster than a retinue can be repositioned to
 * meet it. It is a per-map fact rather than a per-mode one for the usual
 * reason — the bastion is reachable from two modes and both want it.
 */
function mapEnemySpeed() {
  return MAP_RULES[mapKind].enemySpeed;
}

/** Does this map hide what the player cannot see? One home for that rule too. */
function fogOfWar() {
  return MAP_RULES[mapKind].fogOfWar;
}

/** Who fights on this map. Same table, same reason: it is a per-map fact. */
function mapPopulation() {
  return MAP_RULES[mapKind].population;
}

/** Do crows live on this map? */
function mapHasCrows() {
  return mapPopulation() === 'crows';
}

/** Does a garrison hold this map? */
function mapHasSoldiers() {
  return mapPopulation() === 'soldiers';
}

function smashTile(row, col) {
  if (!terrainDestructible()) return;
  const t = tileMap.get(row, col);
  if (t === TILE.TREE) tileMap.set(row, col, TILE.ASH);
  else if (t === TILE.ROCK || t === TILE.HUT) tileMap.set(row, col, TILE.EMPTY);
  // A sapling clears rather than chars: there is not enough of it to leave
  // ash, and leaving ash would start it growing again on the spot, which makes
  // clearing one pointless.
  else if (t === TILE.SAPLING) tileMap.set(row, col, TILE.EMPTY);
}

// ── ROT.JS — FOV & A* ─────────────────────────────────────────────────────────
// Passability callback shared by both FOV and pathfinding.
// The closure reads the tile map at call time, so it auto-adapts when tiles change.
const _rotPassable = (x, y) => {
  if (x < 0 || x >= CONFIG.cols || y < 0 || y >= CONFIG.rows) return false;
  return tilePassable(tileMap.get(y, x) ?? TILE.ROCK);
};

const _fov   = new FOV.PreciseShadowcasting(_rotPassable);

/**
 * How far the player can see right now, in tiles.
 *
 * Open maps keep the radius they have always had, which covers the arena, so
 * nothing about forest or castle changes. The maze runs on a torch's reach, and
 * lighting one triples it for the rest of the run.
 */
function playerSightTiles() {
  if (!fogOfWar()) return CONFIG.sightRadiusTiles;
  const base = CONFIG.mazeSightRadiusTiles;
  return torchIsLit() ? base * CONFIG.torchSightMult : base;
}

const fovMap  = new FovMap(CONFIG.rows, CONFIG.cols,
  (col, row, mark) => _fov.compute(col, row, playerSightTiles(), mark));

// Terrain the player has already stood in the light of, and terrain a lit torch
// holds open forever. Both are memory rather than sight: they say what the maze
// looks like, never what is moving in it.
const seenTiles  = new Uint8Array(CONFIG.rows * CONFIG.cols);
const torchTiles = new Uint8Array(CONFIG.rows * CONFIG.cols);
// Which tile the memory pass last ran from. FovMap only recomputes on a tile
// change, so marking memory on every step would be 693 writes for nothing.
let seenFrom = -1;

/** Clears sight, memory and torchlight. Called whenever a new grid is built. */
function resetSight() {
  fovMap.invalidate();
  seenTiles.fill(0);
  torchTiles.fill(0);
  seenFrom = -1;
}

function updateFOV() {
  const col = Math.floor(player.x / CONFIG.tileSize), row = Math.floor(player.y / CONFIG.tileSize);
  fovMap.update(col, row);
  if (!fogOfWar()) return;
  const at = row * CONFIG.cols + col;
  if (at === seenFrom) return;
  seenFrom = at;
  for (let r = 0; r < CONFIG.rows; r++)
    for (let c = 0; c < CONFIG.cols; c++)
      if (fovMap.isVisible(c, r)) seenTiles[r * CONFIG.cols + c] = 1;
}

// Returns true if grid cell (col, row) is currently in the player's line-of-sight.
function tileVisible(col, row) { return fovMap.isVisible(col, row); }

/** Can the player see this world point right now? Always true where there is no fog. */
function litAt(wx, wy) {
  if (!fogOfWar()) return true;
  return fovMap.isVisible(Math.floor(wx / CONFIG.tileSize), Math.floor(wy / CONFIG.tileSize));
}

/**
 * Is there an unobstructed straight line between two tiles?
 *
 * This is the question a hunter asks, and it is not the question fovMap
 * answers. That cache is computed from the player's tile at the player's
 * radius, so it says what the player can see. Shadowcasting is symmetric, which
 * let both questions share one answer while everyone had the same sight range.
 * The maze breaks that: shrink the player to four tiles and "the minotaur can
 * see you" would collapse into "you can already see the minotaur", which is the
 * opposite of a warden appearing at the end of a dark corridor.
 *
 * Bresenham over the same passability callback FOV and A* use, so a wall stops
 * a line here exactly where it stops an arrow.
 */
function lineOfSight(c0, r0, c1, r1) {
  let x = c0, y = r0;
  const dx = Math.abs(c1 - c0), dy = -Math.abs(r1 - r0);
  const sx = c0 < c1 ? 1 : -1, sy = r0 < r1 ? 1 : -1;
  let err = dx + dy;
  while (x !== c1 || y !== r1) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    // The far end is the target itself, which may be standing anywhere.
    if ((x !== c1 || y !== r1) && !_rotPassable(x, y)) return false;
  }
  return true;
}

/** Can something standing at (wx, wy) see the player, within `rangePx`? */
function seesPlayerFrom(wx, wy, rangePx) {
  if (Math.hypot(player.x - wx, player.y - wy) > rangePx) return false;
  const ts = CONFIG.tileSize;
  return lineOfSight(Math.floor(wx / ts), Math.floor(wy / ts),
                     Math.floor(player.x / ts), Math.floor(player.y / ts));
}

// A* path from pixel position (fromPx,fromPy) to (toPx,toPy).
// Returns an array of {x,y} pixel waypoints (tile centers), NOT including start.
function computeAStarPath(fromPx, fromPy, toPx, toPy) {
  const fc = Math.floor(fromPx / CONFIG.tileSize);
  const fr = Math.floor(fromPy / CONFIG.tileSize);
  const tc = Math.floor(toPx  / CONFIG.tileSize);
  const tr = Math.floor(toPy  / CONFIG.tileSize);
  if (fc === tc && fr === tr) return [];
  const path  = [];
  const astar = new Path.AStar(tc, tr, _rotPassable, { topology: 8 });
  astar.compute(fc, fr, (x, y) => path.push({
    x: x * CONFIG.tileSize + CONFIG.tileSize / 2,
    y: y * CONFIG.tileSize + CONFIG.tileSize / 2
  }));
  return path.slice(1); // drop the starting tile (crow is already there)
}

const pathScheduler = new PathScheduler(computeAStarPath);

/**
 * Every body that follows a cached pathScheduler route.
 *
 * Four populations with four update loops and three separate arrays, so this
 * is the one place that has to know all of them. A boss is yielded only while
 * it actually holds a route: the kinds that walk are set up with `path: null`,
 * and the kinds that do not have no such field at all. The rank and file get
 * no such filter because they need none — the crow king's bats ride in
 * `crows` without a `path` field, and the scheduler treats a missing route
 * like an empty one. That is the contract, not an accident: it froze a boss
 * fight solid the one time it wasn't.
 *
 * Guards are deliberately absent. They cache their own route under `route`
 * rather than `path`, and `moveGuard` refuses a step into solid ground, so a
 * stale guard route costs that guard time instead of putting it inside a
 * trunk. The bastion is also the one map regrowth never runs on.
 */
function* pathingAgents() {
  yield* crows;
  yield* skeletons;
  yield* soldiers;
  if (boss && Array.isArray(boss.path)) yield boss;
}

/**
 * Drops cached routes through a tile that just stopped being walkable.
 *
 * Regrowth is what closes ground: a sapling maturing into a tree puts a trunk
 * on a tile agents may already be routed through, and `chaseAlongPath` follows
 * waypoints without ever consulting the grid. Without this they walk through
 * the new tree until their own 0.4 s recompute happens to come round.
 *
 * The gate is the whole contract. Only a passable to solid transition can
 * invalidate a route, so every other mutation this game makes returns here
 * immediately: a blast clearing rock, fire charring a tree to ash, a tower
 * falling, a sapling sprouting on burnt ground.
 *
 * Registered once here rather than called from each mutation site, so a
 * future one cannot forget to.
 */
tileMap.onChange((r, c, oldTile, nextTile) => {
  if (!tilePassable(oldTile) || tilePassable(nextTile)) return;
  const dropped = pathScheduler.invalidateThrough(pathingAgents(), r, c, CONFIG.tileSize);
  if (dropped > 0) log.debug('path', 'terrain closed a route', { r, c, dropped });
});

// ── INPUT ─────────────────────────────────────────────────────────────────────

const keys  = {};
/** Physical key (e.code) to the name it went down under (e.key), so a
 *  release can clear the entry the press actually created. */
const keyDownAs = {};
const mouse = { x: 400, y: 256 };
let shootPressed = false;

// Bound by boot(), not at import: this module has to load under vitest, where
// there is no document. Everything that reads them runs downstream of boot().
let canvas = null;
let ctx = null;
/**
 * The context as the canvas handed it over, before any tracing wrapper.
 *
 * Kept because `ctx` is replaced by the counting wrapper at the `ops` level,
 * and wrapping is not idempotent: wrapping an already-wrapped context counts
 * every call twice, which reads as a real regression and is not one. Every
 * wrap starts from this.
 */
let rawCtx = null;
let booted = false;

function initAudio() {
  // Resume the shared AudioContext on the first user gesture (Chrome autoplay policy)
  if (zzfxX && zzfxX.state === 'suspended') zzfxX.resume();
}

const inGame = () => appState === 'playing' || appState === 'boss_fight';

/**
 * Hides the OS cursor once aiming actually matters, since drawReticle()
 * draws the per-character indicator in its place; restores it the moment
 * aiming stops (menus, pause, boss entrance, castle intro), so a screen
 * with a clickable row, like controls remapping, still shows a real one.
 * A style write is cheap but not free, so this only fires on the frame
 * inGame() actually flips rather than every frame.
 */
let cursorStyle = 'crosshair';
/** Whether the pointer is over something a click would act on. */
function _overClickable() {
  // The talent tree is a list rather than a panel row, so it answers through
  // its own hit test. Same rule either way: the rects the draw used.
  if (appState === 'talents') {
    return rowAt(talentTreeLayout().rows, mouse.x, mouse.y) !== null;
  }
  const layout = appState === 'charselect' ? charSelectLayout()
    : appState === 'chooser' && chooser !== null ? chooserLayout()
    : null;
  if (layout === null) return false;
  return panelAt(layout.slots, layout.selected, mouse.x, mouse.y) !== null;
}

/** Where a mouse event landed, in canvas pixels, or null before layout. */
function _canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return {
    x: (e.clientX - r.left) * (CONFIG.canvasW / r.width),
    y: (e.clientY - r.top) * (CONFIG.canvasH / r.height),
  };
}

/**
 * Click a panel to pick it; click the picked one to confirm.
 *
 * Two clicks to start a run rather than one, deliberately. A single click that
 * both picked and confirmed would commit the player to whichever hero they
 * touched first, with the stats they came here to read still unread — and the
 * panels are close enough together that a misclick would start the wrong run.
 *
 * Reads the same rects the draw does, so a panel is clickable exactly where it
 * looks clickable.
 */
function _clickCharSelect(e) {
  const at = _canvasPoint(e);
  if (at === null) return;
  const { slots, selected } = charSelectLayout();
  const hit = panelAt(slots, selected, at.x, at.y);
  if (hit === null) return;
  if (hit === selected) {
    transitionTo(picksItsMap(gameMode) ? 'mapselect' : 'playing');
    return;
  }
  // Cast rather than annotated on the table: annotating CHAR_PANELS costs the
  // inferred shape of every other field on the row, which two test files read.
  // The cast is checked elsewhere — game.test.ts asserts every character the
  // protocol knows has a panel, so a panel's `char` is always one of them.
  selectedChar = /** @type {import('../net/protocol').CharacterKind} */ (CHAR_PANELS[hit].char);
}

function syncCursor() {
  // Three answers now, not two, so the flag became the value itself: hidden in
  // a run, a pointer over something a click would act on, a crosshair
  // otherwise. A panel that looks clickable and shows a crosshair is the same
  // lie as one that is not clickable at all.
  const want = inGame() ? 'none' : _overClickable() ? 'pointer' : 'crosshair';
  if (want === cursorStyle) return;
  cursorStyle = want;
  canvas.style.cursor = want;
}

/** How far the in-progress windup has filled, 0 to 1. Read by the release, the
 * windup visual and the bar, so it lives in one place. */
function knightChargeFrac() {
  if (!knightCharge.on) return 0;
  return Math.min(1, (performance.now() - knightCharge.t0) / 1000 / CONFIG.knightChargeMaxHoldSecs);
}

/**
 * Whether the player's body fits with its centre at a point: all four
 * collision corners on passable tiles.
 *
 * Extracted from the movement resolution, which is still its main caller, so
 * that walking and the wizard's blink cannot come to disagree about what
 * counts as a wall.
 */
function playerFits(x, y) {
  const r = CONFIG.playerRadius;
  return tilePassable(tileAt(x-r, y-r)) && tilePassable(tileAt(x+r, y-r)) &&
         tilePassable(tileAt(x-r, y+r)) && tilePassable(tileAt(x+r, y+r));
}

/** The eight ways off a tile, for the walled-in test below. */
const STEP_DIRS = [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]];

/**
 * Is a body at this point walled in — no full tile step in any direction
 * landing somewhere it fits?
 *
 * A whole tile rather than a nudge on purpose: inside one open tile every
 * small step still fits, so a body sealed into a single tile would look free
 * to move. This asks whether there is anywhere to actually go.
 *
 * A legitimate corridor or corner always passes, because the way the body
 * walked in is still a direction that fits.
 */
function boxedInAt(x, y) {
  const d = CONFIG.tileSize;
  for (const [dx, dy] of STEP_DIRS) if (playerFits(x + dx*d, y + dy*d)) return false;
  return true;
}

/**
 * The nearest tile centre a body both fits in and can leave again.
 *
 * Unlike nearestOpenTile, which asks only whether one tile is passable, this
 * honours the four-corner box the movement code collides with and refuses a
 * spot that is itself sealed — otherwise the escape hatch below could move a
 * trapped player into a second trap, or leave them where they were.
 *
 * `minRadius` of 1 skips the tile the player is already on, which is what
 * the manual key wants: if it decides the player is fine and leaves them
 * exactly where they were, then it has done nothing for the one player it
 * exists for — the one who is stuck in a way we cannot yet detect.
 */
function nearestFreeTile(wx, wy, minRadius = 0) {
  const ts = CONFIG.tileSize;
  const col0 = Math.floor(wx / ts), row0 = Math.floor(wy / ts);
  for (let radius = minRadius; radius <= 12; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (radius > 0 && Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
        const r = row0 + dr, c = col0 + dc;
        if (r < 0 || r >= CONFIG.rows || c < 0 || c >= CONFIG.cols) continue;
        const x = c * ts + ts / 2, y = r * ts + ts / 2;
        if (playerFits(x, y) && !boxedInAt(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/**
 * Last-resort escape hatch: never leave the player with nowhere to go.
 *
 * Three separate root causes have put a player somewhere they could not move
 * out of, and each was found only after it had been reported, guessed at and
 * reproduced from scratch. Whatever the fourth turns out to be, being unable
 * to move is the one symptom they all share, so this catches the symptom
 * directly rather than waiting to catch the next cause.
 *
 * Deliberately narrow, so it cannot fire during normal play: it wants the
 * body either overlapping a wall outright, or sealed in with no tile step
 * anywhere that fits. Walking into a wall, standing in a corridor and sitting
 * in a corner all still leave somewhere to go, and none of them trip this.
 *
 * Logs at warn with the position, so a recurrence leaves evidence of where
 * and on which map instead of another report with nothing to go on.
 */
/**
 * The player asking to be freed, by hand.
 *
 * Unconditional on purpose. unstickPlayer() below only acts when it can prove
 * the body is trapped, and the trap that keeps getting reported is one it
 * cannot see yet — so the manual version does not ask. It moves the player to
 * open ground, clears everything that could be driving or holding them, and
 * says so in the log with the full state at that moment, which is the evidence
 * the automatic path has never managed to capture.
 */
function forceUnstick() {
  if (!inGame()) return;
  const spot = nearestFreeTile(player.x, player.y, 1) ?? spawnPoint();
  log.warn('forceUnstick', 'player asked to be freed', {
    from: { x: Math.round(player.x), y: Math.round(player.y) },
    to: { x: Math.round(spot.x), y: Math.round(spot.y) },
    map: mapKind, char: selectedChar,
    // Everything that can refuse movement, captured at the moment it mattered.
    buried: !playerFits(player.x, player.y), boxedIn: boxedInAt(player.x, player.y),
    frozen: playerFrozenTimer, charging: knightCharge.on, dashing: knightDash.timer,
    drawing: archerDraw.on, netting: rangerNet.on,
    heldKeys: Object.keys(keys).filter(k => keys[k]),
  });
  const fromX = player.x, fromY = player.y;
  player.x = spot.x; player.y = spot.y;
  knightDash.timer = 0; knightCharge.on = false;
  archerDraw.on = false; rangerNet.on = false;
  playerFrozenTimer = 0;
  events.emit({ type: 'PLAYER_UNSTUCK', x: fromX, y: fromY, toX: spot.x, toY: spot.y });
}

function unstickPlayer() {
  if (!inGame() || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return;
  const buried = !playerFits(player.x, player.y);
  if (!buried && !boxedInAt(player.x, player.y)) return;

  const spot = nearestFreeTile(player.x, player.y);
  const to = spot ?? spawnPoint();
  log.warn('unstickPlayer', buried ? 'body inside terrain' : 'walled in with no way out', {
    from: { x: Math.round(player.x), y: Math.round(player.y) },
    to: { x: Math.round(to.x), y: Math.round(to.y) },
    map: mapKind, char: selectedChar, usedSpawnFallback: spot === null,
  });
  const fromX = player.x, fromY = player.y;
  player.x = to.x; player.y = to.y;
  // Whatever was driving him is void now — a dash resuming after a rescue
  // would just push him back into it.
  knightDash.timer = 0; knightCharge.on = false;
  events.emit({ type: 'PLAYER_UNSTUCK', x: fromX, y: fromY, toX: to.x, toY: to.y });
}

/* Clamp bounds keep the player's collision corners inside the first passable
 * row/col (index 1) so they never straddle the solid border tiles and get
 * stuck. Two functions rather than one returning a point: this runs twice a
 * frame per axis and has no business allocating. */
function clampArenaX(x) {
  const r = CONFIG.playerRadius;
  return Math.max(CONFIG.tileSize + r, Math.min(CONFIG.canvasW - r, x));
}
function clampArenaY(y) {
  const r = CONFIG.playerRadius;
  return Math.max(CONFIG.tileSize + r, Math.min((CONFIG.rows - 1) * CONFIG.tileSize - r, y));
}

/**
 * How far the body can travel from a point along an angle before something
 * solid stops it, and where it ends up.
 *
 * Walks in short steps and keeps the last point the body actually fits in, so
 * no caller can be handed a destination inside a wall. The wizard's blink uses
 * it to find where it lands; the knight's chained charge uses it only to ask
 * whether there is anywhere left to go.
 */
function probeAhead(fromX, fromY, angle, maxDistance) {
  const step = 4;
  const dx = Math.cos(angle) * step, dy = Math.sin(angle) * step;
  let x = fromX, y = fromY;
  for (let travelled = 0; travelled < maxDistance; travelled += step) {
    const nx = clampArenaX(x + dx), ny = clampArenaY(y + dy);
    if (!playerFits(nx, ny)) break;
    x = nx; y = ny;
  }
  return { x, y, moved: Math.hypot(x - fromX, y - fromY) };
}

/**
 * Kills or wounds everything hostile inside a circle.
 *
 * These three loops were written out in the storm, the whirlwind and the
 * blast, and the blink's pulse and the knight's chained swing would have made
 * five. They live here once instead, parameterised by what actually differs:
 * where the circle is, how wide it is, and what the boss takes from it.
 *
 * Terrain is deliberately not part of this. Each caller breaks tiles under its
 * own rules — the blast's are not the storm's — and folding them together
 * would mean a flag that decides which caller you are.
 *
 * `bossHit` is null for an effect the boss simply ignores. `amount` is what
 * each ordinary enemy takes, and defaults to the one point that kills a fresh
 * creep outright — which is what the storm, the whirlwind and the blast all
 * want. Only the net passes anything else, and it passes less on purpose.
 */
/**
 * Shoves every body within `radius` directly away from a point.
 *
 * Shared by Juggernaut and Shockwave rather than written twice: they throw
 * bodies for different reasons but by the same rule, and the rule -- move
 * only onto ground the body could stand on -- is the part worth having in one
 * place. A shove into a wall stops at the wall instead of posting a crow
 * inside it.
 */
/**
 * How hard a blast pushes something `d` away from its centre.
 *
 * Full strength on top of it, nothing at the edge, straight line between. One
 * home because the archer's own hop and the shove his blast gives the bodies
 * around him are the same rule seen from two sides, and a blast that threw him
 * further than it threw a crow standing beside him would read as a bug.
 */
function blastPush(d, radius, maxPx) {
  if (d > radius) return 0;
  return maxPx * (1 - d / radius);
}

/**
 * Shoves everything that lived through a blast away from it.
 *
 * Called after the damage, which is what makes it survivors only: whatever the
 * blast killed is already out of these lists.
 */
function pushSurvivorsFrom(cx, cy, radius, maxPx) {
  for (const list of [crows, skeletons, soldiers]) {
    for (const b of list) {
      const d = Math.hypot(b.x - cx, b.y - cy);
      const px = blastPush(d, radius, maxPx);
      if (px <= 0 || d < 0.001) continue;
      const nx = clampArenaX(b.x + ((b.x - cx) / d) * px);
      const ny = clampArenaY(b.y + ((b.y - cy) / d) * px);
      if (tilePassable(tileAt(nx, b.y))) b.x = nx;
      if (tilePassable(tileAt(b.x, ny))) b.y = ny;
    }
  }
}

function pushBodiesFrom(cx, cy, radius, px) {
  const r2 = radius * radius;
  for (const list of [crows, skeletons, soldiers]) {
    for (const b of list) {
      const d2 = dist2(cx, cy, b.x, b.y);
      if (d2 > r2 || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = b.x + ((b.x - cx) / d) * px;
      const ny = b.y + ((b.y - cy) / d) * px;
      if (tilePassable(tileAt(nx, b.y))) b.x = clampArenaX(nx);
      if (tilePassable(tileAt(b.x, ny))) b.y = clampArenaY(ny);
    }
  }
}

function damageEnemiesInRadius(cx, cy, radius, bossHit, opts = {}) {
  const r2 = radius * radius;

  // Flat 1x with no falloff configured, otherwise a linear taper from max at
  // the epicentre to min at the very edge of the radius.
  const falloffAt = (tx, ty) => {
    if (!opts.falloff) return 1;
    const frac = Math.min(1, Math.sqrt(dist2(cx, cy, tx, ty)) / radius);
    return opts.falloff.max - frac * (opts.falloff.max - opts.falloff.min);
  };
  // Ice trades the blast's damage away for time: a flat single point to
  // everything it reaches, and that long held still. It overrides falloff
  // rather than scaling it, because "one damage" is the entire deal.
  const ice = opts.element === 'ice';
  // A caller's flat damage, tapered by falloff when one is configured.
  const base = opts.amount ?? 1;
  const hitFor = (tx, ty) => (ice ? CONFIG.iceBlastDamage : base * falloffAt(tx, ty));
  const chill = (e) => { if (ice) freezeEnemy(e, CONFIG.iceBlastFreezeSecs); };

  for (let j = crows.length - 1; j >= 0; j--) {
    const c = crows[j];
    if (dist2(cx, cy, c.x, c.y) < r2) { chill(c); damageCrow(j, hitFor(c.x, c.y)); }
  }
  for (let j = skeletons.length - 1; j >= 0; j--) {
    const k = skeletons[j];
    if (dist2(cx, cy, k.x, k.y) < r2) { chill(k); damageSkeleton(j, hitFor(k.x, k.y)); }
  }
  // The garrison arrived with the cavern on a different branch, after this
  // helper was written. Every caller — storm, whirlwind, blink pulse, chain
  // whirl, every explosive — was quietly skipping soldiers until this line.
  for (let j = soldiers.length - 1; j >= 0; j--) {
    const s = soldiers[j];
    if (dist2(cx, cy, s.x, s.y) < r2) { chill(s); damageSoldier(j, hitFor(s.x, s.y)); }
  }
  // Bosses take an ice bomb's damage but not its freeze — see freezeEnemy.
  if (bossHit && bossInPlay() && !boss.shield && dist2(cx, cy, boss.x, boss.y) < r2)
    damageBoss(ice ? CONFIG.iceBlastDamage : bossHit.amount * falloffAt(boss.x, boss.y),
               cx, cy, bossHit.source, bossHit.flash);
}

/**
 * The wizard's Arcane Blink, bound to the key that means sniper mode for
 * everyone else.
 *
 * Walks the aim line in short steps and keeps the last point the body
 * actually fits in, rather than jumping to the end and asking afterwards. So
 * a blink never crosses a wall and never lands inside one: it closes on cover
 * instead of passing through it. That is not a limitation to work around, it
 * is what keeps the maze a maze - its walls are the level, and nothing else
 * in the game can pass them either.
 */
function tryWizardBlink() {
  if (selectedChar !== 'wizard' || !inGame()) return;
  // A hop inside the window is paid for by the first blink and ignores the
  // cooldown the first one started; anything else has to wait it out.
  const chaining = wizBlinkHops > 0 && wizBlinkChainTimer > 0;
  if (!chaining && wizBlinkCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  // The first hop costs Focus; the chained one does not. It is already paid
  // for in skill — a 1.1 s window and a fresh angle to aim — and charging for
  // it twice would make the chain the thing you can never afford, which is the
  // half of the ability with anything to learn in it.
  if (!chaining && inv.focus < CONFIG.wizFocusBlink) {
    events.emit({ type: 'ACTION_BLOCKED' });
    return;
  }

  const hop = probeAhead(player.x, player.y, player.aimAngle, TALENTS.stat('blinkReach'));

  // Blinking face-first into a wall would otherwise cost the whole cooldown
  // for a couple of pixels, which reads as the button being broken rather
  // than as the wall being solid. A refused hop also costs no chain: the
  // window keeps running and a hop into open ground is still available.
  if (hop.moved < CONFIG.wizBlinkMinDistance) {
    events.emit({ type: 'ACTION_BLOCKED' });
    return;
  }

  const fromX = player.x, fromY = player.y;
  // Spent here and not at the guard above, so a hop refused for want of room
  // costs nothing — the same reasoning that already keeps a blocked hop off
  // the cooldown.
  if (!chaining) inv.focus -= CONFIG.wizFocusBlink;
  player.x = hop.x; player.y = hop.y;
  // THIRD STEP buys a hop, so the chain's length is a talent figure rather
  // than the raw constant. Read once: it sizes the chain on the opening hop
  // and numbers this one for the pulse below, and a draft landing between two
  // reads would otherwise change the answer in the middle of one blink.
  const maxHops      = TALENTS.stat('thirdStep');
  wizBlinkHops       = chaining ? wizBlinkHops - 1 : maxHops - 1;
  // HELD STEP buys window. See the STATS row: the base is the one the knight
  // shares, and only the wizard's reading of it is talent-aware.
  wizBlinkChainTimer = TALENTS.stat('heldStep');
  wizBlinkCD         = CONFIG.wizBlinkCooldown;
  wizBlinkIFrame     = CONFIG.wizBlinkIFrames;
  // The rite's Overchannel: a landed blink opens the free-bolt window.
  if (TALENTS.capstoneActive('overchannel')) wizOverchannel = CONFIG.wizOverchannelSecs;

  // The rite's Thunderstep: each hop of a chain arrives harder than the last.
  // Unsealed, the pulse is exactly what it always was -- escalatedPulse at
  // ordinal 1 is the identity, so there is no second code path here and no
  // way for the plain blink to drift away from the sealed one.
  const basePulse = {
    radius: CONFIG.wizBlinkPulseRadius, bossDamage: CONFIG.wizBlinkPulseBossDamage,
  };
  const pulse = TALENTS.capstoneActive('thunderstep')
    ? escalatedPulse(basePulse, hopOrdinal(maxHops, wizBlinkHops), CONFIG.wizThunderstepGrowth)
    : basePulse;

  // Arriving is itself the attack. Resolved here rather than on a timer, so
  // what the ring shows a moment later is a report of what was already hit.
  damageEnemiesInRadius(player.x, player.y, pulse.radius,
    { amount: pulse.bossDamage, source: 'storm', flash: 0.1 });
  events.emit({ type: 'WIZARD_BLINK', x: fromX, y: fromY, toX: player.x, toY: player.y,
                radius: pulse.radius });
}

/** How far the draw has come, 0 to 1. Read by the release, the aim line and
 * the bar, so it lives in one place. */
function archerDrawFrac() {
  if (!archerDraw.on) return 0;
  return Math.min(1, (performance.now() - archerDraw.t0) / 1000 / TALENTS.stat('fullDraw'));
}

/**
 * The archer's power shot, bound to the key that means sniper mode for the
 * sapper.
 *
 * He is rooted while he draws, which is exactly what sniper mode already cost
 * him. The difference is that the root now buys a shot that pierces, flies at
 * twice the speed and hits a boss for three times a plain arrow's worth — at
 * a full draw. A tap gets the bottom of every one of those ranges, so the
 * decision the key asks is how long to stand still, not whether to.
 */
function startArcherDraw() {
  if (selectedChar !== 'archer' || archerDraw.on || !inGame()) return;
  if (archerPowerCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  archerDraw.on = true;
  archerDraw.t0 = performance.now();
}

function releaseArcherDraw() {
  if (!archerDraw.on) return;
  const drawn = archerDrawFrac();
  archerDraw.on = false;
  // Let go after pausing or dying and the draw is simply lost, rather than
  // loosing an arrow the moment play resumes.
  if (!inGame()) return;

  // A power shot spends one unit of whatever is queued, exactly as an ordinary
  // shot does, so a fully drawn fire arrow is a fire arrow that also pierces.
  if (!hasShaft()) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  const type = spendShaft();

  // DEAD EYE: the most committed thing he can do stops costing him the next
  // one. BOTH halves have to be full -- a full draw and a full brace -- so
  // what buys the refund is the same 2.25 s of standing still it always was.
  //
  // Short of the rite, the archer round's braced cut still applies: the
  // stance already paid for draw damage, and this makes it pay for the
  // rhythm too. The two compose rather than replace -- one is a free shot,
  // the other a sooner one -- and they were written on different branches.
  const perfect = drawn >= 1 && braceLevel >= 1;
  archerPowerCD = (perfect && TALENTS.capstoneActive('deadEye'))
    ? 0
    : CONFIG.archerPowerCooldown * (1 - braceLevel * CONFIG.archerBracedCooldownCut);
  const spd = CONFIG.arrowSpeed * (1 + drawn * (CONFIG.archerPowerSpeedMult - 1));
  // The in-flight cap is deliberately not consulted. It is there to stop the
  // bow being held down, and this is one arrow every five seconds.
  arrows.push({ x: player.x, y: player.y,
    vx: Math.cos(player.aimAngle) * spd,
    vy: Math.sin(player.aimAngle) * spd,
    life: CONFIG.arrowLifetime, type, bounces: 0,
    initSpeed: spd,
    trailHistory: [], fireSeed: Math.random() * Math.PI * 2, trailTimer: 0,
    power: true,
    // What the pickup is worth on a powered shot. Fire lays a lane instead of
    // one patch; ricochet stops running out of bounces. Each is the arrow
    // type doing more of its own thing, so a pickup still reads as itself.
    fireTrail: type === 'fire' ? 0 : null,
    pierceLeft: 1 + Math.round(drawn * (TALENTS.stat('splitShaft') - 1)),
    // Draw and brace multiply: a fully drawn shot from a braced stance is
    // the most committed thing he can do, and it is paid for in seconds.
    dmgMult: (1 + drawn * (CONFIG.archerPowerBossMult - 1)) * braceBossMult() });
  archerLoose = ARCHER_LOOSE_SECS;
  archerLoosePower = drawn;
  events.emit({ type: 'ARCHER_POWER_SHOT', x: player.x, y: player.y, power: drawn });
}

/**
 * What a brace is worth to an arrow right now.
 *
 * One home, because both the ordinary shot and the power shot read it and a
 * second copy is how they come to disagree about what standing still buys.
 */
/**
 * What Bloodlust is worth right now, as one multiplier applied to both halves.
 *
 * Damage and attack speed take the same figure, so three stacks is 1.3 on each
 * and 1.69 times the damage per second between them. See CONFIG.
 */
/**
 * What one of the spear's two boss hits is worth.
 *
 * The figure was written out identically at both hit sites, which is how the
 * two halves of a swing come to disagree about a multiplier: Bloodlust would
 * have had to be added in two places, and the fire sword already was.
 */
/**
 * One tick of a meter that fills under a condition and drains when it does not.
 *
 * Brace and Momentum are the same mechanic pointed in opposite directions, so
 * the clamp and the shape live here once and the callers pass what actually
 * differs: the condition, and the two rates. Deliberately takes deltas rather
 * than rates, because one of the two fills by distance and the other by time
 * and forcing both through a seconds-based rate would mean converting one of
 * them back at every call site.
 */
/**
 * Per-frame meter upkeep for the heroes who carry one, keyed by character.
 *
 * A table rather than a chain of `selectedChar ===` arms inside the movement
 * loop, which is what this was and what `docs/design-patterns.md` opens by
 * arguing against: behaviour attaches to the tag from the outside, so a third
 * hero with a meter is a row here rather than another branch in a loop every
 * hero runs every frame.
 *
 * Each takes the seconds elapsed and the distance the body actually covered.
 * Both are needed because the two meters disagree about which one drives them:
 * Brace fills on the clock while he is still, Momentum fills on the ground he
 * covers. Passing both and letting the row choose is cheaper than two tables.
 */
/**
 * Per-frame upkeep that belongs to exactly one character, keyed by that
 * character. Runs alongside the cooldown timers rather than in the movement
 * loop -- see MOVEMENT_METERS for the two that need the distance covered.
 *
 * A table for the reason `docs/design-patterns.md` opens with: a sixth hero
 * with something to tick every frame is a row here, not another
 * `selectedChar ===` guard bolted onto a block every hero runs.
 */
const HERO_UPKEEP = {
  // Focus refills at a constant rate whether or not he is casting. Deliberate:
  // a regeneration that paused while acting would make the pool a second,
  // hidden cooldown, and two rates interacting is a balance problem with no
  // single dial to turn.
  wizard: (dt) => {
    if (wizOverchannel > 0) wizOverchannel = Math.max(0, wizOverchannel - dt);
    // The pool's ceiling is the effective figure, not the base: FOCUS DEPTH
    // raises resources.focus.max through TALENTS.applyToRun, and reading the
    // base here would regenerate a talent away.
    if (inv.focus >= CONFIG.resources.focus.max) return;
    inv.focus = Math.min(CONFIG.resources.focus.max, inv.focus + dt / CONFIG.wizFocusRegenSecs);
  },
  sapper: (dt) => {
    tickSapperBurst(dt);
    // The whole cascade lands inside one frame's worth of fuse, so the
    // hold is what makes it readable; the peak clears with it.
    if (sapperChainRead > 0) {
      sapperChainRead -= dt;
      if (sapperChainRead <= 0) { sapperChainRead = 0; sapperChainPeak = 0; }
    }
  },
};

const MOVEMENT_METERS = {
  archer: (dt, movedPx) => {
    const was = braceLevel;
    const fillSecs = TALENTS.stat('setFeet');
    // ROOTED: a brace that reached full survives being walked. Only a hit
    // knocks it down, which is what takeDamage does. Without the capstone the
    // meter drains the moment he moves, as it always has.
    const rooted = braceLevel >= 1 && TALENTS.capstoneActive('rooted');
    braceLevel = tickMeter(braceLevel, rooted || movedPx <= MOVED_EPSILON,
      dt / fillSecs,
      (dt / fillSecs) * TALENTS.stat('deepRoots'));
    if (was < 1 && braceLevel >= 1) events.emit({ type: 'ARCHER_BRACED', x: player.x, y: player.y });
  },
  ranger: (dt, movedPx) => {
    const was = rangerMomentum;
    // Filled by distance and drained by time, which is not a symmetry worth
    // forcing: ground covered is what the bonus is *for*, and a hero who has
    // stopped is covering none of it, so there is nothing to measure a decay
    // against but the clock.
    rangerMomentum = tickMeter(rangerMomentum, movedPx > MOVED_EPSILON,
      movedPx / TALENTS.stat('lightFoot'),
      dt / TALENTS.stat('longWind'));
    if (was < 1 && rangerMomentum >= 1) {
      events.emit({ type: 'RANGER_MOMENTUM', x: player.x, y: player.y });
      // Arms on the rising edge only, so the window is three seconds per
      // full meter rather than three seconds refreshed every frame she holds
      // one.
      if (TALENTS.capstoneActive('slipstream')) rangerSlip = CONFIG.rangerSlipstreamSecs;
    }
    if (rangerMomentum >= 1) rangerSlip = Math.max(0, rangerSlip - dt);
    else rangerSlip = 0;
  },
};

/**
 * Below this, a body has not moved.
 *
 * Not zero: the movement path writes a float every frame and floating point
 * leaves a residue on a body that is standing still, which is enough to keep a
 * meter that tests `> 0` permanently draining.
 */
const MOVED_EPSILON = 0.01;

function tickMeter(level, filling, fillDelta, drainDelta) {
  return filling ? Math.min(1, level + fillDelta) : Math.max(0, level - drainDelta);
}

/**
 * What Momentum is worth right now, as a multiplier on a bolt's damage.
 *
 * A multiplier and not a written damage figure, which is the whole reason it
 * is applied at the point a bolt is built: the ranger's fire and ricochet
 * pickups ride on the bolt's `type`, and anything that reset his damage to a
 * default would take those with it.
 */
function rangerMomentumMult() {
  return 1 + rangerMomentum * TALENTS.stat('fullTilt');
}

function knightSpearDamage(fireSword) {
  return CONFIG.knightSpearBossDamage
    * (fireSword ? CONFIG.knightFireSwordDamageMult : 1)
    * knightBloodlustMult();
}

function knightBloodlustMult() {
  return 1 + knightBloodlust * TALENTS.stat('deeperCut');
}

/**
 * How many arrows the bow looses on one press.
 *
 * Scales with the meter rather than waiting for a full brace, so standing
 * still pays continuously instead of paying nothing until it pays everything.
 * One at a standstill of zero, `archerBraceVolley` at a full one.
 */
function braceVolleyCount() {
  return 1 + Math.floor(braceLevel * (CONFIG.archerBraceVolley - 1));
}

function braceBossMult() {
  return 1 + braceLevel * (CONFIG.braceBossMult - 1);
}

/**
 * A set of pools that stand in for one another, dearest first.
 *
 * Two kits work this way and it is one rule, so it is written once and each kit
 * supplies its own row order. Special kinds first and plain last, because a
 * pickup is worth more than a plain one and nobody wants to burn their fire
 * arrows holding the button after the fight is over.
 *
 * Each row is [inventory key, what leaves the hand].
 */
const QUIVER = [['fireArrows', 'fire'], ['ricochetArrows', 'ricochet'], ['arrows', 'normal']];
const POUCH  = [['fireBombs', 'fire'], ['iceBombs', 'ice'], ['bombs', 'none']];

/** Whether any pool in the set still holds something. */
function anyLeft(pools) {
  return pools.some(([key]) => inv[key] > 0);
}

/**
 * Spends one unit from the first non-empty pool and says which kind left.
 *
 * Null on an empty set, which is the caller's cue to swing something instead.
 * This spend ran as three identical copies for the quiver alone, one per firing
 * path, which is exactly how two characters come to disagree about what is
 * spent first without anyone deciding they should. The sapper's pouch was a
 * fourth copy of the same rule.
 */
function spendFirst(pools) {
  for (const [key, label] of pools) {
    if (inv[key] > 0) { inv[key]--; return label; }
  }
  return null;
}

/**
 * The archer's and the ranger's quiver.
 *
 * Deliberately not per character. They draw on the same three pools by design
 * -- the manual calls it "the same quiver" -- and what separates them is what
 * leaves the string: one arrow against three lighter bolts in a spread.
 *
 * `hasShaft` has five callers and three of them are art: the pitchfork fallback
 * is drawn off the same fact the shot is refused by, so one reading is what
 * keeps the picture and the rule from disagreeing about whether he is out.
 */
function hasShaft()   { return anyLeft(QUIVER); }
function spendShaft() { return spendFirst(QUIVER); }

/** The sapper's pouch: his own three kinds, the same rule. See POUCH. */
function hasBomb()    { return anyLeft(POUCH); }

/** How far the net has been drawn, 0 to 1. */
function rangerNetFrac() {
  if (!rangerNet.on) return 0;
  return Math.min(1, (performance.now() - rangerNet.t0) / 1000 / CONFIG.netDrawMaxSecs);
}

/**
 * Pins everything hostile inside a circle for a while.
 *
 * Separate from damageEnemiesInRadius because it is a different question and
 * the net asks both: what does this hurt, and what does it stop. A boss is
 * held through the daze system it already has rather than a second mechanism,
 * which also means the minotaur is caught by the same rule that already lets a
 * hit stun him. Returns how many it caught, for the report on screen.
 */
function holdEnemiesInRadius(cx, cy, radius, secs) {
  const r2 = radius * radius;
  let caught = 0;
  for (const c of crows)
    if (dist2(cx, cy, c.x, c.y) < r2) { c.heldTimer = Math.max(c.heldTimer || 0, secs); caught++; }
  for (const s of skeletons)
    if (dist2(cx, cy, s.x, s.y) < r2) { s.heldTimer = Math.max(s.heldTimer || 0, secs); caught++; }
  // The garrison, for the same reason the blast helper had to grow a
  // soldiers loop: the net was written on a branch where soldiers did not
  // exist, and a net the cavern walks straight through is not a net.
  for (const s of soldiers)
    if (dist2(cx, cy, s.x, s.y) < r2) { s.heldTimer = Math.max(s.heldTimer || 0, secs); caught++; }
  // A shielded crow king shrugs it off, the same way a shielded hit never
  // dazes him. Everything else with a daze timer, the minotaur included, is
  // fair game: it is two seconds at the very most and it has to be landed.
  if (bossInPlay() && !boss.shield && dist2(cx, cy, boss.x, boss.y) < r2) {
    boss.dazeTimer = Math.max(boss.dazeTimer, dazeTimerForStun(secs));
    // Held separately from the daze it rides, because a daze also comes from a
    // stun and HOLDFAST is about the NET. Reading dazeTimer here would have
    // doubled every hit on a boss the knight had just stunned.
    boss.netHold = Math.max(boss.netHold || 0, secs);
    caught++;
  }
  return caught;
}

/**
 * The ranger's net, bound to the key that means sniper mode for the sapper.
 *
 * Draw longer and it is thrown further, opens wider and holds longer, all off
 * the one charge. The damage is the part that deliberately does not scale: 0.9
 * is under a fresh creep's single hit point at every draw, so the net never
 * kills what it catches. Stopping things is the whole of what it is for.
 */
function startRangerNet() {
  if (selectedChar !== 'ranger' || rangerNet.on || !inGame()) return;
  if (rangerNetCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  rangerNet.on = true;
  rangerNet.t0 = performance.now();
}

function releaseRangerNet() {
  if (!rangerNet.on) return;
  const drawn = rangerNetFrac();
  rangerNet.on = false;
  if (!inGame()) return;

  const lerp = (lo, hi) => lo + drawn * (hi - lo);
  const reach = lerp(CONFIG.netThrowMin, CONFIG.netThrowMax);
  // Where it can actually get to. probeAhead stops at the first thing solid,
  // so a net thrown at a wall opens against the wall rather than through it.
  const land = probeAhead(player.x, player.y, player.aimAngle, reach);

  rangerNetCD = CONFIG.netCooldown;
  nets.push({
    x: player.x, y: player.y,
    toX: land.x, toY: land.y,
    // WIDE NET shifts the whole range rather than an end of it, so the
    // draw still decides where between them this throw lands.
    radius: lerp(CONFIG.netRadiusMin, CONFIG.netRadiusMax) + TALENTS.stat('wideNet'),
    hold: lerp(CONFIG.netHoldMin, CONFIG.netHoldMax),
    spin: 0,
  });
  events.emit({ type: 'WEAPON_FIRED', kind: 'net' });
}

/** Flight is a straight run to a point already known to be clear, so a net
 * cannot end up somewhere a body could not stand. */
function updateNets(dt) {
  for (let i = nets.length - 1; i >= 0; i--) {
    const n = nets[i];
    n.spin += dt * 6;
    const dx = n.toX - n.x, dy = n.toY - n.y;
    const left = Math.hypot(dx, dy);
    const step = CONFIG.netSpeed * dt;
    if (left <= step) {
      n.x = n.toX; n.y = n.toY;
      openNet(n);
      nets.splice(i, 1);
      continue;
    }
    n.x += (dx / left) * step;
    n.y += (dy / left) * step;
  }
}

function openNet(n) {
  damageEnemiesInRadius(n.x, n.y, n.radius,
    { amount: CONFIG.netDamage, source: 'net', flash: 0.1 },
    { amount: CONFIG.netDamage });
  const caught = holdEnemiesInRadius(n.x, n.y, n.radius, n.hold);
  // The mat the net becomes once it lands.
  //
  // There was nothing here before: the projectile was spliced on arrival and
  // the hold lived on each enemy's own timer, so the only thing on screen was
  // a crosshatch over whatever got caught. That reads as the enemies being
  // marked rather than as a net being on the ground, and it left a player no
  // way to see how much longer the hold has to run.
  //
  // Spawned here rather than off RANGER_NET_OPEN because `n.hold` is in scope
  // here and is not on the event; carrying it would mean widening the event
  // union, its handler and its emit for something no listener needs.
  netMats.push({ x: n.x, y: n.y, radius: n.radius, timer: n.hold, total: n.hold });
  events.emit({ type: 'RANGER_NET_OPEN', x: n.x, y: n.y, radius: n.radius, caught });
}

/** Ages every mat, dropping the ones whose hold has run out. */
/**
 * The wizard's two effects, and the knight's, in the world layer.
 *
 * Grouped rather than each called from its own character's draw function,
 * because none of them belongs to a *body*: a storm is a 450 px area on the
 * ground, a blink is a line between two places he is not, and a whirlwind
 * keeps spinning while he is drawn walking. Drawing them with the hero would
 * mirror them with him, which for the vortex reverses its spin every time he
 * turns around.
 */
function drawAbilityFx() {
  if (selectedChar === 'archer') {
    if (charge.on) {
      // The same expression releaseCharge hands throwDynamite, so what the
      // preview promises and what the throw does cannot drift.
      const frac = Math.min(1, (performance.now() - charge.t0) / 1000);
      paintDynamiteCharge(ctx, {
        x: player.x, y: player.y + CONFIG.hudHeight, aim: player.aimAngle, frac,
        reach: throwReachPx(TALENTS.stat('longThrow') * (1 + frac * 2), CONFIG.dynamiteLifetime),
        blastRadius: CONFIG.dynamiteBlastRadius, t: loopT,
      });
    }
    if (archerDraw.on || archerLoose > 0) {
      paintPowerDraw(ctx, {
        x: player.x, y: player.y + CONFIG.hudHeight, aim: player.aimAngle,
        draw: archerDrawFrac(), recoil: archerLoose / ARCHER_LOOSE_SECS,
        power: archerLoosePower, t: loopT,
      });
    }
  }
  if (stormFx > 0) {
    paintLightningStorm(ctx, {
      x: player.x, y: player.y + CONFIG.hudHeight,
      radius: TALENTS.stat('stormWidth'), age: 1 - stormFx / STORM_FX_SECS,
    });
  }
  if (blinkFx > 0) {
    paintBlinkArrival(ctx, {
      fromX: blinkFrom.x, fromY: blinkFrom.y + CONFIG.hudHeight,
      toX: blinkTo.x, toY: blinkTo.y + CONFIG.hudHeight,
      radius: blinkRadius, age: 1 - blinkFx / BLINK_FX_SECS,
    });
  }
  if (selectedChar === 'knight' && knightWhirlwindTimer > 0) {
    paintWhirlwind(ctx, {
      x: player.x, y: player.y + CONFIG.hudHeight,
      radius: CONFIG.knightWhirlwindRadius,
      age:  1 - knightWhirlwindTimer / CONFIG.knightWhirlwindDuration,
      tick: 1 - knightWhirlwindTick / CONFIG.knightWhirlwindTickRate,
      t: loopT,
      kind: inv.knightFireSwordTimer > 0 ? 'fireSword' : 'normal',
    });
  }
  if (selectedChar === 'knight' && knightDash.timer > 0) {
    paintChargeDash(ctx, {
      x: player.x, y: player.y + CONFIG.hudHeight,
      angle: knightDash.angle,
      radius: CONFIG.knightChargeRadius, arc: CONFIG.knightChargeArcRadians,
      frac: knightDash.frac,
      progress: 1 - knightDash.timer / CONFIG.knightChargeDashDuration,
      tick: 1 - knightChargeTick / CONFIG.knightChargeTickRate,
    });
  }
}

/** Ages every blast, dropping the ones whose half second is up. */
function updateBlasts(dt) {
  for (let i = blasts.length - 1; i >= 0; i--) {
    blasts[i].t += dt;
    if (blasts[i].t >= BLAST_SECS) blasts.splice(i, 1);
  }
}

/** Every blast on screen, oldest first so a fresh one draws over a fading one. */
function drawBlasts() {
  for (const b of blasts) {
    paintExplosion(ctx, {
      x: b.x, y: b.y + CONFIG.hudHeight, radius: b.radius,
      age: b.t / BLAST_SECS, onWater: b.onWater,
    });
  }
}

/** Nets lying on the ground, under everything that walks on them. */
function drawNetMats() {
  for (const m of netMats) {
    paintNet(ctx, {
      x: m.x, y: m.y + CONFIG.hudHeight, radius: m.radius,
      age: 1 - m.timer / m.total,
    });
  }
}

function updateNetMats(dt) {
  for (let i = netMats.length - 1; i >= 0; i--) {
    netMats[i].timer -= dt;
    if (netMats[i].timer <= 0) netMats.splice(i, 1);
  }
}

/**
 * The knight's chained charge: a second press while the dash is running.
 *
 * He cannot steer — the angle was committed at release and stays committed —
 * so the chain buys speed in the direction already chosen and one whirlwind
 * swing where he is standing when he asks for it. Once per dash.
 *
 * Returns whether the press was the knight's, so the key handler knows not to
 * also read it as the start of a fresh windup.
 */
function tryKnightChainCharge() {
  if (selectedChar !== 'knight' || !inGame()) return false;
  if (knightDash.timer <= 0 || knightDash.chained || knightChainTimer <= 0) return false;

  // Somewhere to go, along the line he is already committed to. A knight who
  // has already run out of room gets the refusal flash rather than a free
  // whirlwind out of a charge that is over in everything but the timer.
  if (probeAhead(player.x, player.y, knightDash.angle, CONFIG.knightChainMinRoom * 2).moved
      < CONFIG.knightChainMinRoom) {
    events.emit({ type: 'ACTION_BLOCKED' });
    return true;
  }

  knightDash.chained = true;
  damageEnemiesInRadius(player.x, player.y, CONFIG.knightChainWhirlRadius,
    { amount: CONFIG.knightChainWhirlBossDamage, source: 'whirlwind', flash: 0.1 });
  events.emit({ type: 'KNIGHT_WHIRL_SWING', x: player.x, y: player.y,
                radius: CONFIG.knightChainWhirlRadius });
  return true;
}

/**
 * What the sniper key does on the way down. One function so the headless tests
 * drive the same path a real keyboard does, rather than a parallel one.
 */
function pressShift() {
  if (!tryKnightChainCharge()) startKnightCharge();
  tryWizardBlink();
  startArcherDraw();
  startRangerNet();
  trySapperShot();
}

/** The other half of the same key. Each of these belongs to one character and
 * returns immediately for the rest, so the routing stays a list rather than a
 * branch on who is playing. */
function releaseShift() {
  releaseKnightCharge();
  releaseArcherDraw();
  releaseRangerNet();
}

/** Knight-only, bound to the key that means sniper mode for everyone else.
 * Winds up in place; releaseKnightCharge() converts the hold into the dash. */
function startKnightCharge() {
  if (selectedChar !== 'knight' || knightCharge.on || knightDash.timer > 0 || !inGame()) return;
  if (knightChargeCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  knightCharge.on = true;
  knightCharge.t0 = performance.now();
}
function releaseKnightCharge() {
  if (!knightCharge.on) return;
  const held = knightChargeFrac();
  knightCharge.on = false;
  // Let go after pausing or dying and the charge is simply lost, rather than
  // queueing a dash that fires the moment play resumes.
  if (!inGame()) return;
  knightDash.bossHit = false;
  knightDash.chained = false;
  knightChainTimer   = CONFIG.shiftChainSecs;
  knightDash.timer   = CONFIG.knightChargeDashDuration;
  knightDash.frac    = held;
  knightDash.angle   = player.aimAngle;   // committed here, not re-read per frame
  knightChargeTick = 0;   // first arc sweep lands immediately, as whirlwind's does
  knightChargeCD   = CONFIG.knightChargeCooldown;
  events.emit({ type: 'KNIGHT_CHARGE', x: player.x, y: player.y, power: held });
}

/** Boss damage for the dash in flight, scaled by how long the windup was held. */
function knightDashBossDamage() {
  const { knightChargeMinDamageMult: lo, knightChargeMaxDamageMult: hi } = CONFIG;
  return CONFIG.knightChargeBossDamage * (lo + knightDash.frac * (hi - lo));
}


/** World-space angle mapped into the mirrored canvas a character is drawn in. */
function mirrorAngle(a, facing) {
  return Math.atan2(Math.sin(a), facing * Math.cos(a));
}

/**
 * The wedge a charge sweeps, as plain data: which way it points, how far
 * either side of that it reaches, and how far out.
 *
 * The one home for that geometry. inKnightArc() tests points against it, the
 * dash sweep draws it, and the windup telegraph draws it before it is
 * committed — so what a player is shown is the wedge that will actually hit.
 * Written out three times, the three drift apart the first time either number
 * is tuned; written once, they cannot.
 *
 * Only the centre angle differs by caller, so it is the parameter: the dash's
 * is committed (knightDash.angle), the telegraph's is still live
 * (player.aimAngle).
 */
function knightChargeWedge(angle) {
  return { angle, half: CONFIG.knightChargeArcRadians / 2, radius: CONFIG.knightChargeRadius };
}

/** Is (x,y) inside the wedge the dash is currently sweeping? The spear's own
 * hit test fakes a cone with two circle probes; this is a real one. */
function inKnightArc(x, y) {
  const wedge = knightChargeWedge(knightDash.angle);
  if (dist2(player.x, player.y, x, y) > wedge.radius ** 2) return false;
  // CHARGE THROUGH turns the forward wedge into a full sweep: inside the
  // reach is enough, whichever side of him it is on. The written effect --
  // "wounds along its line rather than only at its end" -- was already true
  // of the base dash, whose repeat ticks exist to catch what he advances
  // into, so the talent had to buy something the dash does not already do.
  if (TALENTS.held('chargeThrough')) return true;
  let d = Math.atan2(y - player.y, x - player.x) - wedge.angle;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= wedge.half;
}

/** How far the dash carries him on open ground: the same speed, multiplier and
 * duration updatePlayer() integrates one step at a time. The chain multiplier
 * is deliberately not in it — chaining is a decision taken during the dash,
 * and this is what letting go of the key commits to. */
function knightDashTravel() {
  return FEATHERS.speed() * CONFIG.knightChargeDashSpeedMult * CONFIG.knightChargeDashDuration;
}

/**
 * What the windup telegraph shows this frame, or null when nothing is winding
 * up.
 *
 * A reading of the simulation, not a part of it: nothing here is stored and
 * nothing downstream of it changes what the dash does. The angle is still
 * live — releaseKnightCharge() freezes whatever it is at that instant — which
 * is the whole reason it is worth drawing. Committing to a heading and a
 * second and a half without steering, while looking at a fill bar, is a
 * decision taken blind.
 *
 * The wedge comes from knightChargeWedge(), so the shape drawn during the
 * windup is the shape inKnightArc() will hit with.
 */
function knightChargeTelegraph() {
  if (!knightCharge.on || selectedChar !== 'knight') return null;
  const wedge = knightChargeWedge(player.aimAngle);
  // Stopped where terrain would stop the dash, reusing the probe the chained
  // charge already asks "is there room ahead" with, so the mark lands
  // somewhere he can actually reach rather than through the wall in front.
  const end = probeAhead(player.x, player.y, wedge.angle, knightDashTravel());
  return { ...wedge, frac: knightChargeFrac(), endX: end.x, endY: end.y, travel: end.moved };
}

function startCharge() {
  if (selectedChar === 'wizard') {
    if (stormCD <= 0 && inGame()) fireLightningStorm();
  } else if (selectedChar === 'knight') {
    if (knightWhirlwindCD <= 0 && knightWhirlwindTimer <= 0 && inGame()) startWhirlwind();
    else if (knightWhirlwindCD > 0) events.emit({ type: 'ACTION_BLOCKED' });
  } else if (selectedChar === 'ranger') {
    // No charge-and-hold: each click either throws a satchel or arms the one
    // already out. releaseCharge() has nothing to do for the ranger.
    if (inGame()) useSatchel();
  } else if (selectedChar === 'sapper') {
    // No charge-and-hold either: one press fires the whole fan at once.
    // releaseCharge() has nothing to do for the sapper, same as the ranger.
    trySapperBarrage();
  } else {
    if (inv.dynamites > 0 && !charge.on && inGame()) { charge.on = true; charge.t0 = performance.now(); }
  }
}
function releaseCharge() {
  if (!charge.on) return;
  charge.on = false;
  if (inGame() && selectedChar === 'archer') throwDynamite(Math.min(1, (performance.now() - charge.t0) / 1000));
}

/**
 * Drops every held key and cancels knightCharge/charge with no side effect —
 * no dash, no throw. A keyup is the only other thing that clears those, and
 * a keyup can be lost outright: a mid-charge Controls remap changes which
 * physical key the eventual keyup has to match, and an OS focus change
 * (alt-tab, a notification) swallows it with nothing here listening for
 * blur. Either way the flag stays stuck true — rooting the character — until
 * some later, unrelated keypress both releases it and fires an unintended
 * dash. Called on pause and on window blur so neither path can reach that
 * state.
 */
function cancelHeldActions() {
  knightCharge.on = false;
  charge.on = false;
  for (const k in keys) delete keys[k];
  for (const c in keyDownAs) delete keyDownAs[c];
}

let mouseRightHeld = false;
// Held, not just pressed: multiplayer samples the button once per frame rather
// than reacting to the event, the same way it reads the keyboard.
let mouseLeftHeld = false;

/**
 * Binds every pointer and keyboard listener to the canvas. Called by boot(),
 * so importing this module never reaches for document.
 */
function installInput() {
  // On the window, not the canvas, and clamped into it. On the canvas alone,
  // aim silently froze the moment the pointer crossed the edge: the last event
  // inside was the last aim update, so a shot fired while reaching for
  // something off to the side went where the pointer had last been seen rather
  // than where it was pointing. Clamping pins aim to the nearest edge instead,
  // which is what a player means by pushing past the border.
  window.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;   // canvas not laid out yet
    // Deliberately unclamped. The canvas is letterboxed, so there is margin on
    // every side to wander into, and clamping the aim here froze it the moment
    // the pointer left the picture: both axes pinned, so pushing further out
    // changed nothing and the shot kept going where you used to be pointing.
    // Keeping the crosshair on screen is reticleAt's job, not the aim's.
    const at = pointerToCanvas(e.clientX, e.clientY, r, CONFIG.canvasW, CONFIG.canvasH);
    mouse.x = at.x;
    mouse.y = at.y;
  });
  canvas.addEventListener('mousedown', e => {
    initAudio();
    if (e.button === 0) {
      mouseLeftHeld = true;
      if (inGame()) shootPressed = true;
      // A stage intro waits for exactly this: one click, no key, since it is
      // shown mid-run with the keyboard already busy with movement held down.
      else if (appState === 'stage_intro') { pendingIntro = null; appState = 'playing'; }
    }
    if (e.button === 2) { mouseRightHeld = true; startCharge(); }
  });
  canvas.addEventListener('mouseup',    e => {
    if (e.button === 0) mouseLeftHeld = false;
    if (e.button === 2) { mouseRightHeld = false; releaseCharge(); }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('keydown', e => {
    initAudio();
    if (remapTarget !== null && appState === 'controls') {
      if (e.key !== 'Escape') CONFIG.keys[remapTarget] = e.key;
      remapTarget = null; e.preventDefault(); return;
    }
    if (!keys[e.key] && e.key === CONFIG.keys.shoot) shootPressed = true;
    if (!keys[e.key] && (e.key === 'f' || e.key === 'F')) startCharge();
    if (!keys[e.key] && e.key === CONFIG.keys.snipe) pressShift();
    if (!keys[e.key] && e.key === CONFIG.keys.unstick) forceUnstick();
    // The name bookkeeping — including the held key that starts repeating
    // under a new name once shift comes down mid-hold — lives in
    // src/sim/input.ts, where its awkward cases are unit-tested without a
    // document.
    noteKeyDown(keys, keyDownAs, e.code, e.key);
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  });
  document.addEventListener('keyup', e => {
    const wentDownAs = noteKeyUp(keys, keyDownAs, e.code, e.key);
    if (e.key === 'f' || e.key === 'F' || wentDownAs === 'f' || wentDownAs === 'F') releaseCharge();
    if (e.key === CONFIG.keys.snipe || wentDownAs === CONFIG.keys.snipe) releaseShift();
  });
  // Focus can vanish without ever delivering the matching keyup (alt-tab, a
  // notification stealing the window) — see cancelHeldActions().
  window.addEventListener('blur', cancelHeldActions);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelHeldActions(); });

  canvas.addEventListener('click', e => {
    initAudio();
    if (appState === 'charselect') { _clickCharSelect(e); return; }
    if (appState === 'chooser') { _clickChooser(e); return; }
    if (appState === 'talents') { _clickTalentTree(e); return; }
    if (appState !== 'controls') return;
    const r  = canvas.getBoundingClientRect();
    const cy = (e.clientY - r.top) * (CONFIG.canvasH / r.height);
    CTRL_ACTIONS.forEach((action, i) => {
      const rowY = 160 + i * 46;
      if (cy >= rowY - 20 && cy < rowY + 26) { remapTarget = action.key; controlsSelection = i; }
    });
  });
}

// ── ENTITIES ──────────────────────────────────────────────────────────────────

let player = {}, arrows = [], crows = [], pickups = [], particles = [], dynamites = [], satchels = [];
// The sapper's special and Shift: kept apart from dynamites/arrows since
// neither shares their physics (mini-bombs explode on contact rather than a
// fuse; the shift shot flies straight and never bounces).
let barrageBombs = [], sapperShots = [];
// Expanding rings that show how far an area effect actually reached. Purely
// cosmetic: the damage is resolved before one is ever spawned.
let shockRings = [];
/**
 * Blasts still being drawn.
 *
 * An explosion is instantaneous in the simulation -- damage, tiles and the
 * event all resolve on one frame -- and half a second on screen. The fireball
 * therefore cannot live on the bomb, which is gone, so it lives here and is
 * aged out on its own timer. `radius` is the one the blast really damaged at,
 * carried on the event, so the picture cannot claim a reach the hit did not
 * have.
 */
let blasts = [];
// The castle stage's critter. A parallel array to crows, not a variant of it —
// see damageSkeleton/killSkeleton and updateSkeletons for why.
let skeletons = [];
// Enemy-owned projectiles that hit the player: the dark archer's volleys and
// the ice skeleton's shots. Not a variant of the player's arrows array — it
// has none of that array's ammo/pierce/ricochet concerns, only "fly
// straight, hit the player," optionally freezing on contact.
let hostileBolts = [];

// Local player input. Produces one InputCommand per tick from keyboard + mouse.
// The command shape matches the network input packet, so phase 2 sends the same
// type without reworking this seam.
const playerInput = new LocalInput(() => {
  const held = code => keys[code];
  return {
    up:    held(CONFIG.keys.up)    || keys['w'] || keys['W'],
    down:  held(CONFIG.keys.down)  || keys['s'] || keys['S'],
    left:  held(CONFIG.keys.left)  || keys['a'] || keys['A'],
    right: held(CONFIG.keys.right) || keys['d'] || keys['D'],
    fire:    !!keys[CONFIG.keys.shoot],
    special: !!mouseRightHeld,
    snipe:   !!keys[CONFIG.keys.snipe],
    aimAngle: (() => { const a = aimWorld(); return Math.atan2(a.y - player.y, a.x - player.x); })(),
  };
});

// Sim emits gameplay events; the client turns them into particles and sound.
// The server will run the same sim and ignore these (or forward the
// network-relevant ones), so cosmetics never touch the simulation.
const events = new EventBus();
// Every gameplay event also becomes a debug-level log entry — see
// src/sim/log.ts. Registering the subscription costs nothing and touches no
// DOM, so unlike the rest of boot() it doesn't need to wait for it: this
// runs on import, same as the module-scope tables above it, and is exactly
// as inert as they are until something actually calls log.setLevel('debug').
attachToEvents(log, events);

/**
 * Screen-shake ladder, one home so the ordering is reviewable at a glance.
 *
 * ScreenShake is strongest-wins: a weaker trigger during a stronger one is
 * ignored outright, never summed. So these magnitudes are not decoration, they
 * are the arbitration rule. Whichever event has the highest number is the one
 * the screen reports when several land in the same frame, which means the list
 * has to be ordered by how much the player needs to know a thing happened,
 * not by how energetic it looks.
 *
 * Read it top to bottom: a miss is the quietest thing in the game, taking a
 * hit outranks landing one, and only the boss and the run ending outrank that.
 *
 * Deliberately absent, and not an oversight to be corrected later: killing a
 * crow or a skeleton does not shake at all. Critters die constantly and in
 * groups, up to 22 alive at once on nightmare, so a per-kill shake is a
 * permanent rumble rather than information. The boss is the opposite case
 * and does shake, on contact, on death, and now per landed hit.
 */
const SHAKE = {
  arrowMiss:      [2,  100],
  meleeHit:       [3,  140],
  shieldBlocked:  [3,  150],
  playerFrozen:   [4,  200],
  whirlwindStart: [4,  250],
  foreshadow:     [5,  350],
  heavyMelee:     [6,  200],
  fireSkelBlast:  [6,  250],
  crowsAggro:     [6,  300],
  playerHit:      [7,  240],
  explosion:      [9,  300],
  bossSlam:       [12, 400],
  gameOver:       [12, 600],
  guardDown:      [4,  180],
  towerFell:      [8,  320],
  bossDeath:      [14, 600],
  stormCast:      [14, 600],
};

/**
 * Impact freeze ladder: how many fixed sim steps each impact holds the world
 * still for. One row per SHAKE row, because shake without hitstop is half an
 * impact — the camera moves and the world never stops — and the two only stay
 * in step if one table cannot gain a row the other lacks.
 *
 * Steps, not milliseconds: the loop advances the sim in whole fixed 60 Hz
 * steps, so a freeze is a count of them and nothing else. 2 is a tap, 6 is a
 * boss dying.
 *
 * `0` is a real answer, not a gap. It means "shakes but does not freeze", and
 * every one of them is either something that lands constantly (a miss), an
 * announcement rather than an impact (a milestone, a flock turning on you), a
 * cast leaving rather than a hit arriving (whirlwind, storm), or the run being
 * over. Freezing any of those trades weight for stutter, which is the same
 * call the SHAKE comment above makes about not shaking on a critter kill.
 *
 * These numbers are not in CONFIG, and that is the one place this file
 * deliberately departs from "all tunables live in CONFIG". Same reason SHAKE
 * is not: a row here means nothing on its own and everything read against its
 * neighbours, so the ladder has to be reviewable as a ladder. CONFIG is a flat
 * bag of independent figures and would scatter the ordering that is the whole
 * point.
 */
const HITSTOP = {
  arrowMiss:      0,
  foreshadow:     0,
  crowsAggro:     0,
  whirlwindStart: 0,
  stormCast:      0,
  gameOver:       0,
  meleeHit:       2,
  playerHit:      2,
  shieldBlocked:  2,
  playerFrozen:   2,
  heavyMelee:     3,
  // No SHAKE row of its own: a landed boss hit shakes per weapon, out of
  // BOSS_HIT_FX below. It freezes by source rather than by weapon, because
  // what a freeze reports is "that was a real chunk of the fight", which is
  // the same size whether it arrived by spear or by arrow.
  bossHit:        3,
  fireSkelBlast:  4,
  bossSlam:       4,
  explosion:      5,
  bossDeath:      6,
  // The bastion's two, which arrived on the siege branch after this table
  // and were caught by the guard below rather than by review.
  //
  // A guard goes down repeatedly across ten waves, so it gets the light tap
  // the player's own hit gets, not a beat that would turn a bad wave into a
  // stutter. A tower is one of two and losing one is most of the objective,
  // so it lands where the heavy structural hits do.
  guardDown:      2,
  towerFell:      4,
};

// The same load-time guard MAP_PANELS and BOSS_STAGES run for the half of
// their data that cannot be derived. A SHAKE row added without a HITSTOP row
// would silently never freeze, and a silent never is indistinguishable from a
// deliberate 0 six months later.
for (const kind of Object.keys(SHAKE)) {
  if (!(kind in HITSTOP)) {
    throw new Error(
      `SHAKE.${kind} has no HITSTOP row. Add one to the HITSTOP table above; ` +
      `0 means "shakes but does not freeze".`
    );
  }
}

/**
 * The freeze itself. See src/sim/hitstop.ts for why the counter lives on the
 * sim side of the seam while this table, the policy, lives here.
 */
const hitstop = new Hitstop();

/**
 * One impact, felt two ways: the camera moves and the world stops.
 *
 * Every caller that used to spread a SHAKE row into triggerShake says
 * `impact('x')` instead, so an impact cannot pick up a shake and forget a
 * freeze — a row can only be missing from both or neither. The two
 * tables are looked up under one key, once, at one call site per event.
 */
function impact(kind) {
  triggerShake(...SHAKE[kind]);
  hitstop.trigger(HITSTOP[kind]);
}

// Sound and shake per boss-hit source. The sim states what landed; the table
// decides how it sounds.
const BOSS_HIT_FX = {
  // Landing one of these is a large fraction of the fight: the crow king dies
  // in 5 archer hits, 14 wizard bolts. Ranged sources used to be silent here,
  // so a knight felt every hit on the boss and an archer felt none.
  pitchfork: [6, 200], spear: [5, 200], javelin: [5, 180], arrow: [4, 140],
  // Softer than the pitchfork it copies. A broom hitting a boss for the same
  // two points should not feel like the same weapon doing it.
  broom: [3, 150],
  // Still null, because each already shakes through its own event and would
  // otherwise fire twice for one action, or many times for one cast:
  // dynamite and satchel via EXPLOSION, storm via STORM_CAST, and whirlwind
  // ticks its damage every 0.2s for 3s, which is the critter-kill problem
  // wearing a different hat.
  whirlwind: null, storm: null, dynamite: null, satchel: null,
};
// Sound and shake per attack the player starts.
const WEAPON_FX = {
  arrow:     { sound: () => sndShoot,     shake: null },
  bolt:      { sound: () => sndWizBolt,   shake: null },
  crossbow:  { sound: () => sndCrossbow,  shake: null },
  pitchfork: { sound: () => sndPitchfork, shake: [3, 90] },
  // The wizard's fallback, on the charge whoosh rather than the pitchfork's
  // clang: straw through the air, not iron on stone.
  broom:     { sound: () => sndChargeWhoosh, shake: [2, 60] },
  spear:     { sound: () => sndPitchfork, shake: [2, 70] },
  javelin:   { sound: () => sndPitchfork, shake: [3, 80] },
  // The sapper's lob. Reuses the knight charge's whoosh rather than the bow's
  // snap: what the ear needs to hear is that something heavy is in the air.
  charge:    { sound: () => sndChargeWhoosh, shake: [2, 60] },
  // Five of them leaving at once, so it lands heavier than one bomb does.
  barrage:   { sound: () => sndChargeWhoosh, shake: [4, 120] },
  // The shot itself is light — what it sets off is not.
  sapperShot: { sound: () => sndCrossbow, shake: [2, 70] },
  net:       { sound: () => sndChargeWhoosh, shake: null },
};

// The retinue reaches twelve, and every guard swings on its own timer. Played
// straight, that is a dozen clangs stacked inside the same few milliseconds,
// which reads as noise rather than as a line holding. One voice per window: the
// ear learns "the wall is fighting" without being told how many swings landed.
//
// Kill and collapse are deliberately NOT routed through this. Those are facts
// the player has to hear every single time, and there are never twelve at once.
const RETINUE_VOICE_GAP_MS = 90;
let retinueVoiceAt = -Infinity;
function retinueVoice(snd) {
  const now = performance.now();
  if (now - retinueVoiceAt < RETINUE_VOICE_GAP_MS) return;
  retinueVoiceAt = now;
  playSound(snd);
}

events.on(e => {
  switch (e.type) {
    case 'MINOTAUR_ROAR':
      playSound(sndBossScreech);
      break;
    case 'MINOTAUR_CHARGE':
      playSound(sndChargeWhoosh);
      triggerShake(4, 120);
      break;
    case 'MINOTAUR_SMASH':
      playSound(sndExplosion);
      burst(e.x, e.y, { count: 26, colors: ['#5C554A','#4A443C','#8A6242','#332F29'],
        speedMin: 60, speedMax: 190, decay: 1.5, shape: 'circle',
        sizeMin: 1.5, sizeMax: 3.5, damping: 0.7, shadowBlur: 3, shadowColor: '#8A6242' });
      break;
    case 'PLAYER_POISONED':
      playSound(sndPoisonBite);
      triggerShake(2, 80);
      burst(e.x, e.y, { count: 10, colors: ['#6ABF2A','#9BE04A','#4E8F1E'],
        speedMin: 20, speedMax: 70, decay: 1.6, shape: 'circle',
        sizeMin: 1.5, sizeMax: 2.5, gravity: -30, shadowBlur: 5, shadowColor: '#6ABF2A' });
      break;
    case 'PLAYER_POISON_TICK':
      playSound(sndPoisonTick);
      burst(e.x, e.y, { count: 5, colors: ['#6ABF2A','#4E8F1E'],
        speedMin: 8, speedMax: 30, decay: 1.9, shape: 'spark',
        sizeMin: 1, sizeMax: 2, gravity: -55, shadowBlur: 4, shadowColor: '#6ABF2A' });
      break;

    // The objective chain. Each beat reads its colour from MAZE_KEYS or the
    // lock it belongs to, so the maze decides what a key is and this decides
    // only how loud it lands.
    case 'KEY_DROPPED': {
      playSound(sndKeyDrop);
      const key = MAZE_KEYS[e.kind];
      burst(e.x, e.y, { count: 14, colors: [key.color, '#FFFFFF'],
        speedMin: 30, speedMax: 110, decay: 1.8, shape: 'spark',
        sizeMin: 1, sizeMax: 2.5, gravity: -20, shadowBlur: 8, shadowColor: key.color });
      floaters.push({ x: e.x, y: e.y - 8, alpha: 1.0, vy: -34,
        text: `${e.kind.toUpperCase()} KEY`, color: key.color });
      break; }

    case 'KEY_TAKEN': {
      playSound(sndPickup);
      const key = MAZE_KEYS[e.kind];
      burst(e.x, e.y, { count: 12, colors: [key.color, '#FFFFFF'],
        speedMin: 40, speedMax: 140, decay: 2.2, shape: 'circle',
        sizeMin: 1.5, sizeMax: 3, shadowBlur: 10, shadowColor: key.color });
      break; }

    case 'CHEST_OPENED':
      playSound(sndChestOpen); triggerShake(4, 180);
      burst(e.x, e.y, { count: 22, colors: ['#FFB400','#FFD866','#FFFFFF','#7A4A18'],
        speedMin: 40, speedMax: 150, decay: 1.5,
        shapeMix: [['spark', 0.6], ['circle', 0.4]],
        sizeMin: 1.5, sizeMax: 3, gravity: -30, shadowBlur: 10, shadowColor: '#FFB400' });
      break;

    case 'DOOR_OPENED':
      playSound(sndDoorOpen); triggerShake(10, 500);
      burst(e.x, e.y, { count: 30, colors: ['#FFE8B0','#FFB400','#FFFFFF'],
        speedMin: 30, speedMax: 200, decay: 1.2, shape: 'circle',
        sizeMin: 2, sizeMax: 5, shadowBlur: 14, shadowColor: '#FFE8B0' });
      break;

    case 'TORCH_LIT':
      playSound(sndTorchLight);
      burst(e.x, e.y, { count: 16, colors: ['#FF7A1F','#FFB400','#FFF3C0'],
        speedMin: 20, speedMax: 90, decay: 2.0, shape: 'spark',
        sizeMin: 1, sizeMax: 2.5, gravity: -60, shadowBlur: 10, shadowColor: '#FF7A1F' });
      break;
    // ── The bastion ──────────────────────────────────────────────────────
    case 'GUARD_SWING':
      retinueVoice(sndPitchfork);
      burst(e.x, e.y, { count: 3, colors: ['#E7EDF4','#B7BFC9'],
        speedMin: 20, speedMax: 70, decay: 3.4, shape: 'spark',
        sizeMin: 1, sizeMax: 1.8, pri: PRI.AMBIENT });
      break;

    case 'GUARD_SHOT':
      retinueVoice(sndShoot);
      break;

    case 'GUARD_DOWN':
      // Violet for the retinue's livery, red because a guard is a person: the
      // same distinction SOLDIER_KILLED draws against the undead's bone.
      playSound(sndGuardDown);
      triggerShake(...SHAKE.guardDown);
      burst(e.x, e.y, { count: 16, colors: ['#6A4FB0','#9B7CE2','#A03028','#FFFFFF'],
        speedMin: 40, speedMax: 130, decay: 1.8,
        shapeMix: [['circle', 0.6], ['spark', 0.4]],
        sizeMin: 1.5, sizeMax: 2.5, damping: 0.6,
        shadowBlur: 4, shadowColor: '#9B7CE2', pri: PRI.KILL });
      break;

    case 'TOWER_SHOT':
      // Heavier than a guard's bow and drier than the wizard's bolt: an
      // emplacement loosing, not a person shooting.
      playSound(sndCrossbow);
      burst(e.x, e.y, { count: 3, colors: ['#E7EDF4','#B7BFC9'],
        speedMin: 30, speedMax: 80, decay: 3.6, shape: 'spark',
        sizeMin: 1, sizeMax: 1.6, pri: PRI.AMBIENT });
      break;

    case 'TOWER_FELL':
      // Heavier than a guard and duller than an explosion: stone giving up.
      playSound(sndTowerFell);
      triggerShake(...SHAKE.towerFell);
      burst(e.x, e.y, { count: 26, colors: ['#8A8578','#B5AFA0','#5A564C','#FFFFFF'],
        speedMin: 30, speedMax: 160, decay: 1.3, shape: 'circle',
        sizeMin: 2, sizeMax: 4.5, gravity: 220, damping: 0.7,
        shadowBlur: 6, shadowColor: '#B5AFA0', pri: PRI.CRITICAL });
      break;

    case 'SIEGE_WAVE_CLEARED': {
      // The chime climbs with the ladder, because holding wave nine should not
      // sound like holding wave one. Slot 2 is zzfx's base frequency.
      const held = [...sndWaveHeld];
      held[2] = sndWaveHeld[2] * (1 + 0.06 * e.wave);
      playSound(held);
      break; }

    case 'CROW_KILLED':
      playSound(sndHitCrow);
      burst(e.x, e.y, {
        count: 14, colors: ['#0A0A0A','#1F1F1F','#3A3A3A','#FFB400'],
        speedMin: 40, speedMax: 120, decay: 1.8,
        shapeMix: [['circle', 0.8], ['spark', 0.2]],
        sizeMin: 1.5, sizeMax: 2.5, damping: 0.6, shadowBlur: 4, shadowColor: '#FFB400',
        forceColor: '#FFB400', pri: PRI.KILL
      });
      floaters.push({ x: e.x, y: e.y, alpha: 1.0, vy: -42 });
      floaters.push({ x: e.x + 12, y: e.y - 6, alpha: 1.0, vy: -36, text: `+${e.earned}◆`, color: '#FFB400' });
      break;

    case 'SKELETON_KILLED': {
      playSound(sndHitCrow);
      const skelColors = e.kind === 'fire' ? ['#D86A40','#7A2A10','#FF6020','#FFFFFF']
                        : e.kind === 'ice'  ? ['#A8D8F0','#4878A0','#40D0F0','#FFFFFF']
                        : ['#D8D0C0','#8A8070','#B040E0','#FFFFFF'];
      const skelGlow = e.kind === 'fire' ? '#FF6020' : e.kind === 'ice' ? '#40D0F0' : '#B040E0';
      burst(e.x, e.y, {
        count: 14, colors: skelColors,
        speedMin: 40, speedMax: 120, decay: 1.8,
        shapeMix: [['circle', 0.7], ['spark', 0.3]],
        sizeMin: 1.5, sizeMax: 2.5, damping: 0.6, shadowBlur: 4, shadowColor: skelGlow,
        pri: PRI.KILL
      });
      break;
    }

    case 'SOLDIER_KILLED': {
      playSound(sndHitCrow);
      // Blood and steel rather than the undead's bone and violet: a soldier is
      // a person, and the burst is the one place that reads at a glance.
      const troopColors = e.kind === 'archer' ? ['#C8B48A','#7A6A48','#A03028','#FFFFFF']
                        : e.kind === 'shieldman' ? ['#B0B8C4','#5A6270','#A03028','#FFFFFF']
                        : ['#C0A070','#6A5838','#A03028','#FFFFFF'];
      burst(e.x, e.y, {
        count: 14, colors: troopColors,
        speedMin: 40, speedMax: 120, decay: 1.8,
        shapeMix: [['circle', 0.6], ['spark', 0.4]],
        sizeMin: 1.5, sizeMax: 2.5, damping: 0.6, shadowBlur: 4, shadowColor: '#D06048',
        pri: PRI.KILL
      });
      break;
    }

    case 'FIRE_SKELETON_BLAST':
      playSound(sndExplosion); impact('fireSkelBlast');
      burst(e.x, e.y, {
        count: 20, colors: ['#FFB400','#FF6020','#FFFFFF','#8A1010'],
        speedMin: 80, speedMax: 220, decay: 2.0,
        shape: 'circle', sizeMin: 2, sizeMax: 4, shadowBlur: 10, shadowColor: '#FF6020'
      });
      break;

    case 'ICE_BOLT_FIRED':
      playSound(sndWizBolt);
      break;

    // Same sound as a bolt leaving a staff for now; a bow of its own is a
    // sound to add, not a reason to have the archer emit an event about ice.
    case 'SOLDIER_SHOT':
      playSound(sndWizBolt);
      break;

    case 'PLAYER_FROZEN':
      impact('playerFrozen');
      burst(e.x, e.y, {
        count: 12, colors: ['#40D0F0','#A0E8FF','#FFFFFF'],
        speedMin: 30, speedMax: 90, decay: 2.2, shape: 'spark',
        shadowBlur: 8, shadowColor: '#40D0F0'
      });
      break;

    case 'MELEE_HIT':
      if (e.kind === 'pitchfork') {
        impact('heavyMelee');
        burst(e.x, e.y, { count: 12, colors: ['#FFFFFF','#39FF14','#D9D9D9'],
          speedMin: 90, speedMax: 160, decay: 3.0, shape: 'spark',
          gravity: 60, damping: 0.8, shadowBlur: 6, shadowColor: '#39FF14', pri: PRI.IMPACT });
      } else if (e.kind === 'broom') {
        // Straw, not iron: fewer motes, slower, and falling rather than
        // sparking off. It does the pitchfork's damage and should look like
        // it barely deserves to.
        impact('meleeHit');
        burst(e.x, e.y, { count: 9, colors: ['#C8A860','#E0CC90','#8A7038'],
          speedMin: 30, speedMax: 80, decay: 2.4, shape: 'spark',
          gravity: 90, damping: 0.86, shadowBlur: 2, shadowColor: '#C8A860', pri: PRI.IMPACT });
      } else {
        impact('meleeHit');
        burst(e.x, e.y, { count: 8, colors: ['#A0A0B0','#D0D0E0','#ffffff'],
          speedMin: 40, speedMax: 110, decay: 3.0, shape: 'spark',
          shadowBlur: e.fire ? 8 : 3, pri: PRI.IMPACT,
          shadowColor: e.fire ? '#FF7A1F' : '#C0C0C0' });
      }
      break;

    case 'BOSS_HIT': {
      playSound(sndBossHit);
      const shake = BOSS_HIT_FX[e.source];
      // One condition for both, so the freeze inherits every reason a source
      // is null there: whirlwind and storm tick their damage many times per
      // cast, and dynamite and satchel already land through EXPLOSION. A
      // freeze on any of those is the same double-count the shake avoids,
      // except a player feels this one as the game stuttering.
      if (shake) { triggerShake(shake[0], shake[1]); hitstop.trigger(HITSTOP.bossHit); }
      break; }

    case 'ARROW_MISS':
      playSound(sndMiss); impact('arrowMiss');
      break;

    case 'JAVELIN_BOUNCE':
      burst(e.x, e.y, { count: 6, colors: ['#C0C0C0','#ffffff'],
        speedMin: 30, speedMax: 80, decay: 3.5, shape: 'spark', shadowBlur: 3, shadowColor: '#C0C0C0' });
      break;

    case 'EXPLOSION':
      playSound(sndExplosion); impact('explosion');
      blasts.push({ x: e.x, y: e.y, radius: e.radius, onWater: e.onWater, t: 0 });
      if (e.onWater) {
        burst(e.x, e.y, { count: 22, colors: ['#2A66B0','#5A92D8','#A0C8F0','#FFFFFF'],
          speedMin: 80, speedMax: 200, decay: 1.6,
          shapeMix: [['spark', 0.7], ['circle', 0.3]],
          sizeMin: 1.5, sizeMax: 3, gravity: 380, shadowColor: '#FFFFFF' });
      } else {
        // The sapper's shift-detonated combo reaches a bigger radius than a
        // normal blast, so its burst travels 33% further to match rather than
        // reading like a normal explosion sitting inside a bigger ring.
        const m = e.big ? CONFIG.sapperComboRadiusMult : 1;
        burst(e.x, e.y, { count: Math.round(12 * m), colors: ['#FFFFFF','#FFB400'],
          speedMin: 200 * m, speedMax: 360 * m, decay: 4.0,
          shape: 'circle', sizeMin: 2, sizeMax: 5, shadowBlur: 16, shadowColor: '#FFB400' });
        burst(e.x, e.y, { count: Math.round(36 * m), colors: ['#FF7A1F','#FF1F1F','#FFB400','#8A1010'],
          speedMin: 120 * m, speedMax: 260 * m, decay: 1.2,
          shape: 'circle', sizeMin: 2.5, sizeMax: 5, damping: 0.5, shadowBlur: 10, shadowColor: '#FF7A1F' });
        burst(e.x, e.y, { count: Math.round(12 * m), colors: ['#3A3A3A','#1A1A1A','#5C5C5C'],
          speedMin: 30 * m, speedMax: 80 * m, decay: 0.5,
          shape: 'circle', sizeMin: 4, sizeMax: 7, gravity: -10, shrink: true });
      }
      break;

    case 'SPLASH':
      burst(e.x, e.y, { count: 10, colors: ['#2A66B0','#5A92D8','#A0C8F0','#FFFFFF'],
        speedMin: 40, speedMax: 120, decay: 2.5,
        shapeMix: [['spark', 0.7], ['circle', 0.3]],
        sizeMin: 1.5, sizeMax: 3, gravity: 200 });
      break;

    case 'WEAPON_FIRED': {
      const fx = WEAPON_FX[e.kind];
      playSound(fx.sound());
      if (fx.shake) triggerShake(fx.shake[0], fx.shake[1]);
      break; }

    case 'ACTION_BLOCKED':
      playSound(sndEmpty);
      blockedFlash = CONFIG.blockedFlashSecs;
      break;

    case 'SATCHEL_ARMED':
      playSound(sndArm);
      burst(e.x, e.y, { count: 6, colors: ['#FFCC00','#FFFFFF'],
        speedMin: 20, speedMax: 60, decay: 3.0, shape: 'spark',
        shadowBlur: 6, shadowColor: '#FFCC00' });
      break;

    case 'KNIGHT_CHARGE':
      // Scales with the windup: a tap is a light swing, a full hold lands hard.
      playSound(sndChargeWhoosh); triggerShake(2 + 4 * e.power, 120 + 160 * e.power);
      burst(e.x, e.y, {
        count: 8 + Math.round(14 * e.power),
        colors: e.power > 0.85 ? ['#FF3020','#FF8800','#FFFFFF'] : ['#C8C8E8','#FFCC00','#FFFFFF'],
        speedMin: 40, speedMax: 90 + 80 * e.power, decay: 2.6, shape: 'spark',
        shadowBlur: 6, shadowColor: e.power > 0.85 ? '#FF3020' : '#FFCC00'
      });
      break;

    case 'PLAYER_UNSTUCK':
      // A puff at both ends, so a rescue reads as a move rather than the
      // player teleporting for no reason they can see.
      for (const [px, py] of [[e.x, e.y], [e.toX, e.toY]])
        burst(px, py, {
          count: 10, colors: ['#FFFFFF', '#A8D8F0', '#C8C8E8'],
          speedMin: 30, speedMax: 110, decay: 2.8, shape: 'spark',
          shadowBlur: 6, shadowColor: '#A8D8F0',
        });
      break;

    case 'KNIGHT_CHARGE_STOPPED':
      // A short scrape of dust so the stop reads as hitting something solid
      // rather than the dash fizzling out on its own.
      triggerShake(3, 90);
      burst(e.x, e.y, {
        count: 8, colors: ['#8A6A4A','#C8B090','#5C5C5C'],
        speedMin: 30, speedMax: 90, decay: 3.2, shape: 'circle',
        sizeMin: 1.5, sizeMax: 3, damping: 0.6,
      });
      break;

    case 'SAPPER_MINE_ARMED':
      // A click and one settling puff. A mine that arms silently is a mine the
      // player does not know is there, which is a trap for the wrong person.
      playSound(sndArm);
      burst(e.x, e.y, {
        count: 5, colors: ['#8A6A4A', '#C8B090'],
        speedMin: 8, speedMax: 26, decay: 3.4, shape: 'circle',
        sizeMin: 1, sizeMax: 2, damping: 0.7,
      });
      break;

    case 'WIZARD_BLINK':
      // Two bursts, not one: the wizard was there and is now here, and a
      // single puff at the arrival end reads as a spawn rather than a move.
      playSound(sndLightning);
      burst(e.x, e.y, {
        count: 12, colors: ['#8888FF','#C8C8FF','#FFFFFF'],
        speedMin: 20, speedMax: 70, decay: 3.0, shape: 'spark',
        shadowBlur: 6, shadowColor: '#8888FF'
      });
      burst(e.toX, e.toY, {
        count: 16, colors: ['#8888FF','#FFFFFF'],
        speedMin: 40, speedMax: 110, decay: 2.4, shape: 'spark',
        shadowBlur: 8, shadowColor: '#8888FF'
      });
      // The arrival pulse's reach, at the radius the damage already used.
      // The ring the painter draws is at exactly wizBlinkPulseRadius and does
      // not grow into it, so a shock ring here is a second ring saying the same
      // thing at a different size.
      blinkFx = BLINK_FX_SECS;
      blinkFrom = { x: e.x, y: e.y };
      blinkTo = { x: e.toX, y: e.toY };
      blinkRadius = e.radius;
      break;

    case 'RANGER_NET_OPEN':
      playSound(sndArm);
      spawnShockRing(e.x, e.y, e.radius, '#E8E0C0');
      // Only shakes when it actually caught something, so a miss is quiet.
      if (e.caught > 0) triggerShake(2, 70);
      burst(e.x, e.y, {
        count: 8 + Math.min(12, e.caught * 4), colors: ['#E8E0C0','#FFFFFF'],
        speedMin: 20, speedMax: 60, decay: 3.4, shape: 'spark',
        shadowBlur: 4, shadowColor: '#E8E0C0'
      });
      break;

    case 'ARCHER_POWER_HIT': {
      // Weight on the body, not on the bow: a shake and a spray at the point of
      // contact, easing off as the shot spends what it has left to give.
      const bite = 0.4 + 0.2 * e.left;
      triggerShake(2 + 2 * bite, 90 + 60 * bite);
      burst(e.x, e.y, {
        count: 5 + 3 * e.left, colors: ['#EAFF6A', '#FFFFFF'],
        speedMin: 50, speedMax: 120 + 40 * e.left, decay: 2.8, shape: 'spark',
        shadowBlur: 5, shadowColor: '#EAFF6A',
      });
      break;
    }
    case 'KNIGHT_BLOODLUST':
      // Two different things wearing one event. Gaining is a short wet tick
      // that climbs with the stack, so the third one is audibly the payoff;
      // losing is the pickup sound played low, because a reset is information
      // he needs immediately and cannot see while he is looking at the enemy.
      if (e.stacks > 0) {
        playSound(sndPitchfork);
        burst(e.x, e.y - 26, {
          count: 3 + e.stacks * 2, colors: ['#D6193C', '#8A1010'],
          speedMin: 12, speedMax: 26 + e.stacks * 10, decay: 2.6, shape: 'spark',
          gravity: 120, shadowBlur: 4, shadowColor: '#D6193C', pri: PRI.IMPACT,
        });
      } else {
        playSound(sndMiss);
      }
      break;
    case 'RANGER_MOMENTUM':
      // The mirror of ARCHER_BRACED, and quieter still: he is running when it
      // lands, so it competes with everything, and a loud tell for a bonus he
      // will lose again in three seconds would wear out fast.
      playSound(sndPickup);
      burst(e.x, e.y, { count: 4, colors: ['#FFCC00'], speed: 30, life: 0.28, size: 1 });
      break;
    case 'ARCHER_BRACED':
      // Quiet and short: a confirmation, not an alarm. He is standing still to
      // hear it, so it does not have to compete with anything.
      playSound(sndPickup);
      burst(e.x, e.y, { count: 5, colors: ['#EAFF6A'], speed: 22, life: 0.35, size: 1 });
      break;
    case 'ARCHER_POWER_SHOT':
      // The shake scales with the draw, so a full one is felt and a tap is not.
      playSound(sndShoot); triggerShake(1 + 3 * e.power, 80 + 120 * e.power);
      burst(e.x, e.y, {
        count: 6 + Math.round(10 * e.power), colors: ['#EAFF6A','#FFFFFF'],
        speedMin: 30, speedMax: 60 + 90 * e.power, decay: 3.2, shape: 'spark',
        shadowBlur: 6, shadowColor: '#EAFF6A'
      });
      break;

    case 'KNIGHT_WHIRL_SWING':
      playSound(sndExplosion); triggerShake(3, 90);
      spawnShockRing(e.x, e.y, e.radius, '#C8C8E8');
      burst(e.x, e.y, {
        count: 14, colors: ['#C8C8E8','#FFFFFF'],
        speedMin: 60, speedMax: 130, decay: 2.8, shape: 'spark',
        shadowBlur: 6, shadowColor: '#C8C8E8'
      });
      break;

    case 'WHIRLWIND_START':
      playSound(sndExplosion); impact('whirlwindStart');
      burst(e.x, e.y, {
        count: 20, colors: ['#C0C0C0','#9090A0','#FFFFFF','#7080B0'],
        speedMin: 50, speedMax: 130, decay: 2.8, shape: 'spark',
        shadowBlur: 6, shadowColor: '#aaaacc'
      });
      break;

    case 'WHIRLWIND_TICK': {
      const wr = CONFIG.knightWhirlwindRadius;
      burst(e.x, e.y, {
        count: 6, colors: ['#C0C0D0','#8090B0','#ffffff'],
        speedMin: wr * 0.5, speedMax: wr * 0.95, decay: 4.0, shape: 'spark',
        shadowBlur: 4, shadowColor: '#9090B0'
      });
      break; }

    case 'WHIRLWIND_END':
      burst(e.x, e.y, {
        count: 14, colors: ['#888898','#B0B0C0','#ffffff'],
        speedMin: 30, speedMax: 90, decay: 2.5, shape: 'spark', shadowBlur: 3, shadowColor: '#aaaacc'
      });
      break;

    case 'STORM_CAST':
      playSound(sndLightning); impact('stormCast');
      burst(e.x, e.y, { count: 32, colors: ['#FFFFFF','#AAAAFF','#8888FF','#FFB400'],
        speedMin: 60, speedMax: 360, decay: 2.5, shape: 'spark',
        shadowBlur: 14, shadowColor: '#8888FF', gravity: -20 });
      for (let k = 0; k < 8; k++) {
        const ang = Math.random() * Math.PI * 2;
        const dst = 60 + Math.random() * TALENTS.stat('stormWidth') * 0.85;
        burst(e.x + Math.cos(ang)*dst, e.y + Math.sin(ang)*dst, {
          count: 5, colors: ['#FFFFFF','#8888FF'],
          speedMin: 20, speedMax: 60, decay: 4.0, shape: 'spark',
          shadowBlur: 8, shadowColor: '#8888FF' });
      }
      break;

    case 'PLAYER_HIT':
      impact('playerHit');
      break;

    case 'SHIELD_BLOCKED':
      impact('shieldBlocked');
      burst(e.x, e.y, { count: 10, colors: ['#FFB400','#FFFFFF','#FF7A1F'],
        speedMin: 60, speedMax: 200, decay: 2.5, shape: 'spark',
        shadowBlur: 10, shadowColor: '#FFB400', pri: PRI.CRITICAL });
      break;

    case 'PICKUP_TAKEN':
      playSound(sndPickup);
      addPickupMark(e.kind, e.x, e.y);
      if (e.kind === 'ricochet') {
        burst(e.x, e.y, { count: 12, colors: ['#39E0FF','#7AF0FF','#FFFFFF'],
          speedMin: 80, speedMax: 160, decay: 2.2, shape: 'spark',
          shadowBlur: 6, shadowColor: '#39E0FF' });
      } else if (e.kind === 'fire') {
        burst(e.x, e.y, { count: 16, colors: ['#FFB400','#FF7A1F','#FFFFFF','#B23A00'],
          speedMin: 50, speedMax: 140, decay: 1.6,
          shapeMix: [['circle', 0.6], ['spark', 0.4]],
          sizeMin: 1.5, sizeMax: 3, gravity: -20, shadowBlur: 8, shadowColor: '#FF7A1F' });
      } else {
        burst(e.x, e.y, { count: 14, colors: ['#FFB400','#FFFFFF','#FF7A1F'],
          speedMin: 40, speedMax: 140, decay: 2.0, shape: 'circle',
          sizeMin: 2, sizeMax: 5, shadowBlur: 10, shadowColor: '#FFB400' });
      }
      break;

    case 'GAME_OVER':
      impact('gameOver'); playSound(sndGameover);
      break;

    case 'CROWS_AGGRO':
      playSound(sndAggro); impact('crowsAggro');
      break;

    case 'BOSS_CONTACT':
      impact('bossSlam');
      break;

    case 'BOSS_BATS':
      burst(e.x, e.y, { count: 10, colors: ['#FF1F1F','#8A1010','#0A0A0A'],
        speedMin: 30, speedMax: 130, decay: 2.0, shape: 'circle',
        sizeMin: 2, sizeMax: 5, shadowBlur: 8, shadowColor: '#FF1F1F' });
      playSound(sndAggro);
      break;

    case 'BOSS_VOLLEY':
      playSound(sndCrossbow);
      burst(e.x, e.y, { count: 8, colors: ['#B040E0','#7A2AA0','#FFFFFF'],
        speedMin: 40, speedMax: 120, decay: 2.5, shape: 'spark',
        shadowBlur: 8, shadowColor: '#B040E0' });
      break;

    case 'BOSS_CHARGE':
      playSound(sndChargeWhoosh);
      break;

    case 'BOSS_SCREECH':
      playSound(sndBossScreech);
      break;

    case 'BOSS_DEATH_START':
      playSound(sndBossDeath); impact('bossDeath');
      break;

    // Staggered 3-wave death burst: a=0ms, b=+80ms, c=+160ms
    case 'BOSS_DEATH_BURST':
      if (e.phase === 'a') {
        burst(e.x, e.y, { count: 32, colors: ['#050505','#1A1A1A','#3A3A3A','#5A0808'],
          speedMin: 60, speedMax: 200, decay: 1.0, shape: 'circle',
          sizeMin: 2, sizeMax: 4, gravity: 30, damping: 0.4 });
      } else if (e.phase === 'b') {
        burst(e.x, e.y, { count: 18, colors: ['#FF1F1F','#8A1010','#FFB400'],
          speedMin: 120, speedMax: 280, decay: 1.4, shape: 'spark',
          shadowBlur: 6, shadowColor: '#FF1F1F' });
      } else {
        burst(e.x, e.y, { count: 8, colors: ['#FFB400','#FFFFFF','#FF7A1F'],
          speedMin: 30, speedMax: 80, decay: 0.9, shape: 'circle',
          sizeMin: 3, sizeMax: 6, shadowBlur: 12, shadowColor: '#FFB400', shrink: true });
      }
      break;

    case 'BOSS_ENTRANCE_FLASH':
      playSound(sndEntranceFlash);
      break;

    case 'BOSS_ENTRANCE_FIRE':
      burst(e.x, e.y, { count: 7, colors: ['#FF7A1F','#FFB400','#FFFFFF'],
        speedMin: 30, speedMax: 80, decay: 1.0, shape: 'spark',
        gravity: -50, shadowBlur: 6, shadowColor: '#FF7A1F' });
      break;

    case 'BOSS_SHIELD_BLOCKED':
      playSound(sndEmpty);
      burst(e.x, e.y, { count: 8, colors: ['#6EC6FF','#BFE4FF','#FFFFFF'],
        speedMin: 60, speedMax: 150, decay: 3.0, shape: 'spark',
        shadowBlur: 8, shadowColor: '#6EC6FF' });
      break;

    case 'BOSS_BURNING':
      burst(e.x, e.y, { count: 3, colors: ['#FF7A1F','#FFB400','#FFFFFF'],
        speedMin: 10, speedMax: 45, decay: 1.6, shape: 'spark',
        gravity: -70, shadowBlur: 6, shadowColor: '#FF7A1F' });
      break;
  }
});

function initGame() {
  // Brawl is always forest — see the architecture doc's map-selection table.
  // Waves honours whatever was picked on the mapselect screen.
  generateMap(modeRule(gameMode).fixedMap ?? selectedMapKind);
  score = 0; wave = 1; gameTime = 0; escalationTimer = 0; pfCooldown = 0; pfSwing = 0; pfBossHit = false; pfHitFlash = false; waveAnnounce = 0; waveAnnounceText = '';
  knightSpearCD = 0; knightSpearSwing = 0; knightSpearBossHit = false; knightSpearPhase2Hit = false;
  knightBloodlust = 0; knightSpearConnected = false;
  knightWhirlwindCD = 0; knightWhirlwindTimer = 0; knightWhirlwindTick = 0;
  knightBlockCD = 0;
  knightCharge.on = false; knightDash.timer = 0; knightDash.bossHit = false; knightDash.chained = false;
  knightChargeTick = 0; knightChargeCD = 0;
  shootPressed = false;
  arrows = []; pickups = []; particles = []; dynamites = []; satchels = []; fires = []; floaters = []; shockRings = [];
  // WARD FEATHER, if it has been bought, is the only thing that opens a run
  // with the shield already up; without it this is the plain reset it was.
  playerHP = FEATHERS.maxHP(); playerHitFlash = 0; killCount = 0; skeletonKillCount = 0; dropStreak = 0; playerShield = FEATHERS.wardStart();
  wizBoltCD = 0; stormCD = 0; _stormFlash = 0; sapperChargeCD = 0;
  sapperChainPeak = 0; sapperChainRead = 0;
  stormFx = 0; blinkFx = 0;
  sapperBurstLeft = 0; sapperBurstTimer = 0; sapperBurstThrown = 0;
  sapperBarrageCD = 0; sapperShotCD = 0; barrageBombs = []; sapperShots = [];
  wizBlinkCD = 0; wizBlinkIFrame = 0;
  wizBlinkCD = 0; wizBlinkIFrame = 0; wizBlinkHops = 0; wizBlinkChainTimer = 0; wizOverchannel = 0;
  rangerSlip = 0;
  chooser = null; chooserQueue = []; riteOffered = false;

  knightChainTimer = 0;
  archerDraw.on = false; archerPowerCD = 0; archerLoose = 0; archerLoosePower = 0; braceLevel = 0;
  rangerMomentum = 0;
  rangerNet.on = false; rangerNetCD = 0; nets = []; netMats = [];
  boss = null; bossDeathSeq = null; entrance = null; bossStage = 1; hostileBolts = [];
  castleWave = 0; playerFrozenTimer = 0; pendingIntro = null; playerPoison = { timer: 0, tickIn: 0 };
  resetSight(); // force an FOV recompute, and forget the last run's map
  FEATHERS.applyToGame();
  TALENTS.resetRun();
  resetInv();
  FORESHADOW.reset(); STREAK.reset(); BOUNTIES.reset();
  const spawn = spawnPoint();
  player = { x: spawn.x, y: spawn.y, facing: 1, aimAngle: 0, walkPhase: 0, team: Team.A };
  crows = [];
  skeletons = []; // only populated once brawl mode reaches its castle stage
  soldiers = []; soldierKillCount = 0;
  // The map's own population, which is the whole of what MAP_RULES.population
  // decides. A crows map opens with the pace preset's flock; a garrisoned one
  // opens with wave 1 of its own table; a scripted one opens with nothing and
  // waits for the script.
  if (mapHasCrows()) for (let i = 0; i < CONFIG.crowStartCount; i++) spawnCrow();
  else if (mapHasSoldiers()) spawnSoldierWave(1);
}

/**
 * How much tougher a crow spawned right now should be. Only waves mode
 * escalates this way: brawl is a short sprint to ten kills and the boss, not
 * an endless run, so it has no long climb to ramp against.
 *
 * Caps at 10x (reached around wave 25) rather than compounding forever,
 * since waves is endless and an uncapped 10%/wave climb would eventually
 * demand more hits than any weapon's ammo economy could supply.
 */
function waveCrowHpMult() {
  if (!modeRule(gameMode).waveScaling) return 1;
  return Math.min(10, Math.pow(1.1, wave - 1));
}

/**
 * How much faster an aggro'd crow should close in right now. Same idea as
 * waveCrowHpMult, on a slower every-3-waves cadence, and capped far lower
 * (2x, around wave 22): HP just costs more hits, but a crow fast enough
 * would stop being dodgeable at all, which is a different kind of hard.
 */
function waveCrowAggroMult() {
  if (!modeRule(gameMode).waveScaling) return 1;
  return Math.min(2, Math.pow(1.1, Math.floor((wave - 1) / 3)));
}

function spawnCrow() {
  const baseY = (1 + Math.random() * (CONFIG.rows - 2)) * CONFIG.tileSize;
  const maxHp = waveCrowHpMult();
  crows.push({
    x: CONFIG.canvasW + 20 + Math.random() * 80, y: baseY, baseY,
    state: 'passive', aggroTimer: 0, team: Team.ENEMY,
    wingPhase: Math.random() * Math.PI * 2, phaseOff: Math.random() * Math.PI * 2,
    entityPhase: Math.random() * Math.PI * 2,
    white: false, frozen: false, heldTimer: 0,
    hp: maxHp, maxHp, hitFlash: 0,
    path: null, pathTimer: 0   // rot.js A* path cache
  });
}

function spawnPickup(wx, wy) {
  if (pickups.length >= CONFIG.maxPickupsOnMap) return;
  const rnd = Math.random();
  const type = rnd < 0.33 ? 'ricochet' : rnd < 0.66 ? 'fire' : 'shield';
  const tryPlace = (col, row) => {
    if (col < 0 || col >= CONFIG.cols || row < 0 || row >= CONFIG.rows) return false;
    if (!tilePassable(tileMap.get(row, col))) return false;
    pickups.push({ x: col * CONFIG.tileSize + 16, y: row * CONFIG.tileSize + 16,
                   pulsePhase: 0, bobPhase: Math.random() * Math.PI * 2, type });
    return true;
  };
  const col = Math.floor(wx / CONFIG.tileSize), row = Math.floor(wy / CONFIG.tileSize);
  if (tryPlace(col, row)) return;
  for (let dc = -1; dc <= 1; dc++)
    for (let dr = -1; dr <= 1; dr++)
      if (tryPlace(col + dc, row + dr)) return;
}

const PARTICLE_CAP = 120;
/**
 * Particle importance. The cap used to evict oldest-first, which drops the
 * newest information in exactly the busiest frames: a boss fight in a crowd
 * is when the player most needs to see that they were hit, and when a plain
 * FIFO is most likely to have thrown it away for smoke.
 *
 * PRI.CRITICAL is never evicted. Anything below it yields to something more
 * important, and a spawn that finds nothing weaker than itself is dropped
 * rather than pushing the array past the cap.
 */
const PRI = { AMBIENT: 0, IMPACT: 1, KILL: 2, CRITICAL: 3 };

/**
 * Frees one slot for a particle of importance `pri`, evicting the lowest
 * tier first and the oldest within that tier (index order is age order).
 * Returns false when nothing weaker exists, meaning: drop the newcomer.
 */
function makeParticleRoom(pri) {
  if (particles.length < PARTICLE_CAP) return true;
  let worst = -1, worstPri = Infinity;
  for (let i = 0; i < particles.length; i++) {
    const q = particles[i].pri;
    if (q >= PRI.CRITICAL) continue;
    if (q < worstPri) { worstPri = q; worst = i; }
  }
  if (worst < 0 || worstPri > pri) return false;
  particles.splice(worst, 1);
  return true;
}

function burst(wx, wy, opts) {
  const {
    count = 8, colors = ['#ffffff'],
    speedMin = 40, speedMax = 100,
    decay = 2, gravity = 0, damping = 0,
    sizeMin = 1.5, sizeMax = 2.5,
    shadowBlur = 0, shadowColor = '#ffffff',
    shrink = false, shapeMix = null, shape = 'circle',
    forceColor = null, pri = PRI.AMBIENT
  } = opts;
  for (let i = 0; i < count; i++) {
    // Per particle, not once before the loop: the old trim freed a single
    // slot and then pushed the whole burst, so a 36-particle blast left 155
    // in a 120-capped array and the cap did not hold at all.
    if (!makeParticleRoom(pri)) break;
    const a   = Math.random() * Math.PI * 2;
    const spd = speedMin + Math.random() * (speedMax - speedMin);
    const pShape = shapeMix
      ? (Math.random() < shapeMix[0][1] ? shapeMix[0][0] : shapeMix[1][0])
      : shape;
    const col = (forceColor && i === count - 1) ? forceColor : colors[i % colors.length];
    const r   = sizeMin + Math.random() * (sizeMax - sizeMin);
    particles.push({
      x: wx, y: wy,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      color: col, alpha: 1, decay, shape: pShape,
      r, gravity, damping, shadowBlur, shadowColor, shrink, pri
    });
  }
}

function dist2(ax, ay, bx, by) { return (ax-bx)**2 + (ay-by)**2; }

// ── PLAYER ────────────────────────────────────────────────────────────────────

function updatePlayer(dt) {
  if (appState === 'boss_entrance') return;
  // An ice bolt's freeze locks out everything below, movement, aiming and
  // every weapon's cooldown tick, for its full duration. Nothing else can
  // read player input while this is positive.
  // Ticked before the freeze gate: being frozen stops you acting, it does not
  // stop you bleeding, and a poison that paused whenever an ice bolt landed
  // would quietly reward getting hit by two things at once.
  updatePlayerPoison(dt);

  // The escape hatch, twice a second rather than every frame: it walks eight
  // probes and there is no such thing as getting stuck between two frames.
  // Ahead of the freeze gate so a frozen player is still rescued, and ahead of
  // everything else so the rest of this function works from a valid position.
  unstickCheck -= dt;
  if (unstickCheck <= 0) { unstickCheck = 0.5; unstickPlayer(); }

  if (playerFrozenTimer > 0) { playerFrozenTimer = Math.max(0, playerFrozenTimer - dt); return; }

  const cmd = playerInput.sample();
  // Sniper mode is gone, and this is where it used to be set. Every one of
  // the five now spends this key on an ability — knight charges, wizard
  // blinks, archer draws, ranger nets, sapper fires his combo shot — so the
  // root that used to be the default had nobody left to belong to. The two
  // windups that do root, the knight's and the archer's, own that themselves
  // and say so in the movement gate below.
  // What the player is actually asking for this frame, before the dash decides
  // whether it is listening. Read up here because the dash needs it too.
  let wantX = 0, wantY = 0;
  if (hasButton(cmd, Button.UP))    wantY -= 1;
  if (hasButton(cmd, Button.DOWN))  wantY += 1;
  if (hasButton(cmd, Button.LEFT))  wantX -= 1;
  if (hasButton(cmd, Button.RIGHT)) wantX += 1;

  // Pulling back aborts the dash. The knight commits to a direction for a
  // second and a half, which is a long time to have no say at all: pushed into
  // a wall it slides along it, and on open ground it drags you somewhere you
  // may not want to be. Steering with it does not cancel — only asking to go
  // back the way you came, which is unambiguous and cannot fire by accident
  // from a key that was already held when the dash began.
  if (knightDash.timer > 0 && (wantX || wantY)) {
    const dot = wantX * Math.cos(knightDash.angle) + wantY * Math.sin(knightDash.angle);
    if (dot < 0) {
      knightDash.timer = 0;
      events.emit({ type: 'KNIGHT_CHARGE_STOPPED', x: player.x, y: player.y });
    }
  }

  // Drawing and charging root their owners the same way sniper mode roots the
  // sapper. For the archer that root is the whole cost of the power shot.
  if (!knightCharge.on && !archerDraw.on) {
    let vx = 0, vy = 0;
    if (knightDash.timer > 0) {
      // The dash drives movement instead of the keys, but shares the collision
      // resolution below so it stops on walls like any other movement.
      // Faster than he can walk; a chained charge commits him faster still,
      // which is the whole of what the chain buys.
      const dashMult = knightDash.chained
        ? CONFIG.knightChargeChainSpeedMult : CONFIG.knightChargeDashSpeedMult;
      const spd = FEATHERS.speed() * dashMult * dt;
      vx = Math.cos(knightDash.angle) * spd;
      vy = Math.sin(knightDash.angle) * spd;
      player.walkPhase += walkPhaseFor(Math.hypot(vx, vy));
    } else {
      vx = wantX; vy = wantY;
      const len = Math.hypot(vx, vy);
      if (len > 0) { const sp = FEATHERS.speed() * poisonSpeedMult(); vx = (vx/len)*sp*dt; vy = (vy/len)*sp*dt; player.walkPhase += walkPhaseFor(Math.hypot(vx, vy)); }
    }
    const fromX = player.x, fromY = player.y;
    const nx = player.x + vx;
    if (playerFits(nx, player.y)) player.x = clampArenaX(nx);
    const ny = player.y + vy;
    if (playerFits(player.x, ny)) player.y = clampArenaY(ny);

    // Two heroes carry a meter driven by movement, pointed opposite ways: the
    // archer's Brace fills while he is still, the ranger's Momentum fills while
    // he is not.
    //
    // Measured from the position that was actually reached, and ticked *after*
    // the move rather than before it. That is load-bearing and it was wrong:
    // vx/vy are what he asked for, and the fits checks above are what he got.
    // Reading the request meant a hero shoving into a wall covered ground on
    // paper -- which is the exact "earn a stance by leaning on terrain" this
    // comment claimed was prevented, and was not.
    const movedPx = Math.hypot(player.x - fromX, player.y - fromY);
    const meter = MOVEMENT_METERS[selectedChar];
    if (meter) meter(dt, movedPx);
    else braceLevel = 0;
    // A dash terrain has interfered with at all is over. Any blocked axis
    // counts, not just a dead stop: a dash clipping a wall used to slide along
    // it for the rest of its second and a half, moving the player on one axis
    // only with no say in it, which reads as being stuck able to go just left
    // and right. Both cases are the same complaint — the dash still holding
    // the controls after it stopped being a charge at anything.
    const blockedX = vx !== 0 && player.x === fromX;
    const blockedY = vy !== 0 && player.y === fromY;

    // Asking to go somewhere and not going. Reported once per episode, at warn,
    // with everything that could be refusing — because this has now been
    // reported from real play four times and reproduced in a harness none of
    // them, so the next occurrence should leave evidence rather than a guess.
    // Walking into a wall trips this too, which is why it reports rather than
    // acts: what matters is the state, not the verdict.
    if ((wantX || wantY) && knightDash.timer <= 0
        && player.x === fromX && player.y === fromY) {
      if (refusedAt === null) { refusedAt = { x: player.x, y: player.y }; refusedFor = 0; }
      refusedFor += dt;
      if (refusedFor > 1.5 && !refusedReported) {
        refusedReported = true;
        log.warn('movementRefused', 'asked to move and did not, for over a second', {
          seconds: Number(refusedFor.toFixed(2)),
          want: { x: wantX, y: wantY },
          at: { x: Math.round(player.x), y: Math.round(player.y) },
          map: mapKind, char: selectedChar,
          buried: !playerFits(player.x, player.y), boxedIn: boxedInAt(player.x, player.y),
          openDirections: STEP_DIRS
            .filter(([dx, dy]) => playerFits(player.x + dx * CONFIG.tileSize,
                                             player.y + dy * CONFIG.tileSize)).length,
          frozen: playerFrozenTimer, charging: knightCharge.on, dashing: knightDash.timer,
          drawing: archerDraw.on, netting: rangerNet.on,
          heldKeys: Object.keys(keys).filter((k) => keys[k]),
        });
      }
    } else {
      refusedFor = 0; refusedAt = null; refusedReported = false;
    }
    if (knightDash.timer > 0 && (blockedX || blockedY)) {
      knightDash.timer = 0;
      events.emit({ type: 'KNIGHT_CHARGE_STOPPED', x: player.x, y: player.y });
    }
  }

  // Mid-dash the aim is locked to the committed direction, so the arc can't be
  // swivelled around with the mouse after release.
  player.aimAngle = knightDash.timer > 0 ? knightDash.angle : cmd.aimAngle;
  player.facing   = Math.cos(player.aimAngle) >= 0 ? 1 : -1;

  for (const k in iFlash) if (iFlash[k] > 0) iFlash[k] = Math.max(0, iFlash[k] - dt);
  if (playerHitFlash > 0) playerHitFlash = Math.max(0, playerHitFlash - dt);
  if (blockedFlash > 0) blockedFlash = Math.max(0, blockedFlash - dt);
  updatePickupMarks(dt);
  if (pfCooldown          > 0) pfCooldown         = Math.max(0, pfCooldown         - dt);
  HERO_UPKEEP[selectedChar]?.(dt);
  if (wizBoltCD           > 0) wizBoltCD          = Math.max(0, wizBoltCD          - dt);
  if (sapperChargeCD      > 0) sapperChargeCD     = Math.max(0, sapperChargeCD     - dt);
  if (sapperBarrageCD     > 0) sapperBarrageCD    = Math.max(0, sapperBarrageCD    - dt);
  if (sapperShotCD        > 0) sapperShotCD       = Math.max(0, sapperShotCD       - dt);
  if (wizBlinkCD          > 0) wizBlinkCD         = Math.max(0, wizBlinkCD         - dt);
  if (wizBlinkIFrame      > 0) wizBlinkIFrame     = Math.max(0, wizBlinkIFrame     - dt);
  if (knightChainTimer    > 0) knightChainTimer   = Math.max(0, knightChainTimer   - dt);
  if (archerPowerCD       > 0) archerPowerCD      = Math.max(0, archerPowerCD      - dt);
  if (archerLoose         > 0) archerLoose        = Math.max(0, archerLoose        - dt);
  if (rangerNetCD         > 0) rangerNetCD        = Math.max(0, rangerNetCD        - dt);
  // The hops die with the window rather than waiting for the next blink to
  // notice, so a chain can never be resumed after a pause in the middle of it.
  if (wizBlinkChainTimer  > 0) {
    wizBlinkChainTimer = Math.max(0, wizBlinkChainTimer - dt);
    if (wizBlinkChainTimer === 0) wizBlinkHops = 0;
  }
  if (stormCD             > 0) stormCD            = Math.max(0, stormCD            - dt);
  if (_stormFlash         > 0) _stormFlash        = Math.max(0, _stormFlash        - dt);
  if (stormFx             > 0) stormFx            = Math.max(0, stormFx            - dt);
  if (blinkFx             > 0) blinkFx            = Math.max(0, blinkFx            - dt);
  if (knightSpearCD       > 0) knightSpearCD      = Math.max(0, knightSpearCD      - dt);
  if (knightWhirlwindCD   > 0) knightWhirlwindCD  = Math.max(0, knightWhirlwindCD  - dt);
  // Held off while the ability is still running, so the 4s only starts once
  // the knight is out of his own dash.
  if (knightChargeCD > 0 && !knightCharge.on && knightDash.timer <= 0)
    knightChargeCD = Math.max(0, knightChargeCD - dt);
  if (inv.knightFireSwordTimer > 0) inv.knightFireSwordTimer = Math.max(0, inv.knightFireSwordTimer - dt);
  // Block: passive, no keybind — once charged it just sits banked in
  // playerShield until something hits the knight from the front.
  if (selectedChar === 'knight' && !playerShield) {
    knightBlockCD = Math.max(0, knightBlockCD - dt);
    if (knightBlockCD <= 0) { playerShield = true; knightBlockCD = TALENTS.stat('towerGuard'); }
  }
  if (pfSwing > 0) {
    pfSwing = Math.max(0, pfSwing - dt);
    const prog = pfSwing > 0 ? 1 - pfSwing / CONFIG.pitchforkSwingDuration : 1;
    // Strike phase: continuously hit every crow within range every frame (no angular check)
    if (prog >= 0.28 && prog < 0.62) {
      const r2 = FEATHERS.pfRange() ** 2;
      for (let j = crows.length - 1; j >= 0; j--) {
        if (dist2(player.x, player.y, crows[j].x, crows[j].y) < r2) {
          damageCrow(j);
          if (!pfHitFlash) {
            pfHitFlash = true;
            const tipX = player.x + Math.cos(player.aimAngle) * 44;
            const tipY = player.y + Math.sin(player.aimAngle) * 44;
            events.emit({ type: 'MELEE_HIT', x: tipX, y: tipY, kind: pfKind, fire: false });
          }
        }
      }
      for (let j = skeletons.length - 1; j >= 0; j--) {
        if (dist2(player.x, player.y, skeletons[j].x, skeletons[j].y) < r2) {
          damageSkeleton(j);
          if (!pfHitFlash) {
            pfHitFlash = true;
            const tipX = player.x + Math.cos(player.aimAngle) * 44;
            const tipY = player.y + Math.sin(player.aimAngle) * 44;
            events.emit({ type: 'MELEE_HIT', x: tipX, y: tipY, kind: pfKind, fire: false });
          }
        }
      }
      if (!pfBossHit && bossInPlay() && !boss.shield &&
          dist2(player.x, player.y, boss.x, boss.y) < r2) {
        pfBossHit = true;
        damageBoss(CONFIG.pitchforkBossDamage, player.x, player.y, pfKind, 0.25);
      }
    }
  }

  // ── Knight spear swing hit-detection ────────────────────────────────────
  // Double-strike spear swing: two quick hits, one in each half of the animation.
  // Check both the tip and a mid-point so a crow can't slip through the shaft.
  if (selectedChar === 'knight' && knightSpearSwing > 0) {
    const swingWas = knightSpearSwing;
    knightSpearSwing = Math.max(0, knightSpearSwing - dt);
    const fsActive   = inv.knightFireSwordTimer > 0;
    const baseRange  = TALENTS.stat('longReach') * (fsActive ? CONFIG.knightFireSwordRangeMult : 1);
    const swingProg  = 1 - knightSpearSwing / CONFIG.knightSpearSwingDuration;
    const phase2     = swingProg >= 0.5;  // second half of swing triggers phase 2
    const thrustReach = Math.sin(Math.min(swingProg, 1) * Math.PI) * 22;
    const tipDist    = baseRange + thrustReach;
    const ang        = player.aimAngle;             // always world-space, no flip needed
    const tipX  = player.x + Math.cos(ang) * tipDist;
    const tipY  = player.y + Math.sin(ang) * tipDist;
    const midX  = player.x + Math.cos(ang) * tipDist * 0.6;
    const midY  = player.y + Math.sin(ang) * tipDist * 0.6;
    const hitR2 = 22 * 22;

    for (let j = crows.length - 1; j >= 0; j--) {
      const c = crows[j];
      if (dist2(tipX, tipY, c.x, c.y) < hitR2 || dist2(midX, midY, c.x, c.y) < hitR2) {
        if (fsActive) spawnFire(c.x, c.y);
        damageCrow(j);
        knightSpearConnected = true;
        events.emit({ type: 'MELEE_HIT', x: c.x, y: c.y, kind: 'spear', fire: fsActive });
      }
    }
    for (let j = skeletons.length - 1; j >= 0; j--) {
      const s = skeletons[j];
      if (dist2(tipX, tipY, s.x, s.y) < hitR2 || dist2(midX, midY, s.x, s.y) < hitR2) {
        if (fsActive) spawnFire(s.x, s.y);
        damageSkeleton(j);
        knightSpearConnected = true;
        events.emit({ type: 'MELEE_HIT', x: s.x, y: s.y, kind: 'spear', fire: fsActive });
      }
    }
    // Boss: hit once in first half (phase 1), reset and hit again in second half (phase 2)
    const canHitBoss = bossInPlay() && !boss.shield &&
        (dist2(tipX, tipY, boss.x, boss.y) < CONFIG.bossHitRadius ** 2 ||
         dist2(midX, midY, boss.x, boss.y) < CONFIG.bossHitRadius ** 2);

    if (phase2 && knightSpearPhase2Hit === false && canHitBoss) {
      knightSpearPhase2Hit = true;
      knightSpearConnected = true;
      damageBoss(knightSpearDamage(fsActive), player.x, player.y, 'spear', 0.15);
    } else if (!phase2 && !knightSpearBossHit && canHitBoss) {
      knightSpearBossHit = true;
      knightSpearConnected = true;
      damageBoss(knightSpearDamage(fsActive), player.x, player.y, 'spear', 0.2);
    }

    // The swing has just ended: bank a stack for a hit, empty him for a miss.
    // Settled here rather than at the next press, so a knight who swings at
    // nothing and then walks away has already lost it -- the price is leaving
    // the fight, and waiting for his next attack to charge it would mean he
    // never pays while disengaged.
    if (swingWas > 0 && knightSpearSwing === 0) {
      const was = knightBloodlust;
      // BERSERKER: a miss costs one stack rather than the lot. The difference
      // between a knight who must never miss and one who may.
      const onMiss = TALENTS.capstoneActive('berserker') ? Math.max(0, knightBloodlust - 1) : 0;
      knightBloodlust = knightSpearConnected
        ? Math.min(TALENTS.stat('fourthBlood'), knightBloodlust + 1)
        : onMiss;
      if (knightBloodlust !== was) {
        events.emit({ type: 'KNIGHT_BLOODLUST', stacks: knightBloodlust, x: player.x, y: player.y });
      }
    }
  }

  // ── Knight whirlwind continuous tick ─────────────────────────────────────
  if (selectedChar === 'knight' && knightWhirlwindTimer > 0) {
    knightWhirlwindTimer -= dt;
    knightWhirlwindTick  -= dt;
    if (knightWhirlwindTick <= 0) {
      knightWhirlwindTick = CONFIG.knightWhirlwindTickRate;
      const wr = CONFIG.knightWhirlwindRadius, wr2 = wr * wr;
      damageEnemiesInRadius(player.x, player.y, wr,
        { amount: 1, source: 'whirlwind', flash: 0.1 });
      // Break tiles in radius
      const tileR = Math.ceil(wr / CONFIG.tileSize);
      const tc = Math.floor(player.x / CONFIG.tileSize);
      const tr = Math.floor(player.y / CONFIG.tileSize);
      for (let dr = -tileR; dr <= tileR; dr++) {
        for (let dc = -tileR; dc <= tileR; dc++) {
          const row = tr + dr, col = tc + dc;
          if (row <= 0 || row >= CONFIG.rows - 1 || col <= 0) continue;
          const wx = (col+0.5)*CONFIG.tileSize, wy = (row+0.5)*CONFIG.tileSize;
          if (dist2(player.x, player.y, wx, wy) < wr2) smashTile(row, col);
        }
      }
      events.emit({ type: 'WHIRLWIND_TICK', x: player.x, y: player.y });
    }
    if (knightWhirlwindTimer <= 0) {
      knightWhirlwindTimer = 0;
      events.emit({ type: 'WHIRLWIND_END', x: player.x, y: player.y });
    }
  }

  // ── Knight charge dash: repeating arc sweep while advancing ──────────────
  if (knightDash.timer > 0) {
    knightDash.timer -= dt;
    knightChargeTick -= dt;
    if (knightChargeTick <= 0) {
      knightChargeTick = CONFIG.knightChargeTickRate;
      /**
       * Annotated because the literal alone infers `(any[] | fn)[][]`, which
       * loses the pairing and makes `damage` possibly-an-array.
       * @type {readonly [any[], (j: number, amount?: number, knock?: any) => void][]}
       */
      const arcTargets = [[crows, damageCrow], [skeletons, damageSkeleton]];
      for (const [list, damage] of arcTargets)
        for (let j = list.length - 1; j >= 0; j--)
          if (inKnightArc(list[j].x, list[j].y)) {
            events.emit({ type: 'MELEE_HIT', x: list[j].x, y: list[j].y, kind: 'spear', fire: false });
            damage(j);
          }
      // Once per dash, the way a spear swing lands once. The repeat ticks are
      // there to catch enemies he advances into, not to grind the same boss
      // seven times over.
      if (!knightDash.bossHit && bossInPlay() && !boss.shield && inKnightArc(boss.x, boss.y)) {
        knightDash.bossHit = true;
        damageBoss(knightDashBossDamage(), player.x, player.y, 'spear', 0.15);
      }
      // JUGGERNAUT throws aside what the charge reaches, so a body is an
      // obstacle he goes through rather than one he grinds against.
      if (TALENTS.capstoneActive('juggernaut')) {
        pushBodiesFrom(player.x, player.y, knightChargeWedge(knightDash.angle).radius,
          CONFIG.knightJuggernautPush * dt);
      }
    }
    if (knightDash.timer <= 0) knightDash.timer = 0;
  }

  // The charge owns the button and the swing: a normal spear poke mid-charge
  // would let the knight attack for free while invulnerable.
  if (shootPressed) {
    shootPressed = false;
    if (!knightCharge.on && knightDash.timer <= 0) tryShoot();
  }
}

function tryShoot() {
  if (selectedChar === 'wizard') { tryWizardBolt(); return; }
  if (selectedChar === 'knight') { tryKnightAttack(); return; }
  if (selectedChar === 'ranger') { tryCrossbowBolt(); return; }
  if (selectedChar === 'sapper') { trySapperCharge(); return; }
  if (!hasShaft()) { tryPitchfork(); return; }
  const volley = braceVolleyCount();
  // Gated on ONE arrow's worth of room, then the whole volley flies even if it
  // overshoots the cap by a couple.
  //
  // Reserving room for the whole volley - the crossbow's rule - made bracing
  // actively worse than not bracing. Measured over five seconds on open
  // ground: standing still put 13 arrows in the air, walking about put 16,
  // because a three-arrow volley waits for three free slots while a single
  // shot waits for one. The cap exists to stop the bow being held down, which
  // is about how often he may press, and this keeps that identical whether he
  // is braced or not. The overshoot is bounded by the volley itself.
  if (arrows.length >= CONFIG.maxArrowsInFlight) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  // One shaft for the whole volley, which is the crossbow's rule too. The
  // brace is what is being spent here -- it took a second and a quarter of
  // standing still in a game that spends most of its time chasing him.
  const type = spendShaft();
  const half = (volley - 1) / 2;
  for (let i = 0; i < volley; i++) {
    const a = player.aimAngle + (i - half) * CONFIG.archerVolleySpreadRadians;
    arrows.push({ x: player.x, y: player.y,
      vx: Math.cos(a) * CONFIG.arrowSpeed,
      vy: Math.sin(a) * CONFIG.arrowSpeed,
      life: CONFIG.arrowLifetime, type, bounces: 0,
      initSpeed: CONFIG.arrowSpeed,
      trailHistory: [], fireSeed: Math.random() * Math.PI * 2, trailTimer: 0,
      dmgMult: braceBossMult() });
  }
  archerLoose = ARCHER_LOOSE_SECS;
  archerLoosePower = 0;
  events.emit({ type: 'WEAPON_FIRED', kind: 'arrow' });
}

/**
 * The ranger's crossbow. Same ammo pool, deduction and pickup effects as the
 * archer's bow — one press spends exactly one unit of ammo, whichever type is
 * queued first — but that one press fires three independent, weaker, smaller
 * bolts in a narrow spread instead of one full-strength arrow.
 */
function tryCrossbowBolt() {
  if (!hasShaft()) { tryPitchfork(); return; }
  // Reserve room for the whole burst up front — a partial push would let
  // arrows.length overshoot maxArrowsInFlight and stall the next press.
  // Read once: a volley has to be counted, spread and fired off the same
  // number, and FOURTH BOLT moves it.
  const bolts = TALENTS.stat('fourthBolt');
  // A fourth bolt costs a little availability as well as buying damage:
  // bolts share maxArrowsInFlight with arrows, 5 on the default pace, so a
  // volley of four is refused whenever two are already out.
  if (arrows.length + bolts > CONFIG.maxArrowsInFlight) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  const type = spendShaft();
  const half = (bolts - 1) / 2;
  for (let i = 0; i < bolts; i++) {
    const boltAngle = player.aimAngle + (i - half) * CONFIG.crossbowSpreadRadians;
    arrows.push({ x: player.x, y: player.y,
      vx: Math.cos(boltAngle) * CONFIG.arrowSpeed,
      vy: Math.sin(boltAngle) * CONFIG.arrowSpeed,
      life: CONFIG.arrowLifetime, type, bounces: 0,
      initSpeed: CONFIG.arrowSpeed,
      trailHistory: [], fireSeed: Math.random() * Math.PI * 2, trailTimer: 0,
      bolt: true,
      hitRadius: CONFIG.arrowHitRadius * CONFIG.crossbowBoltRadiusMult,
      dmgMult: CONFIG.crossbowBoltDamageMult * rangerMomentumMult() });
  }
  events.emit({ type: 'WEAPON_FIRED', kind: 'crossbow' });
}

function tryWizardBolt() {
  if (wizBoltCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  const boltFree = wizOverchannel > 0;
  if (!boltFree && inv.focus < CONFIG.wizFocusBolt) { tryBroom(); return; }
  // Out of Focus he cannot cast at all, and swings a broom instead. Checked
  // before the in-flight cap so an empty pool always produces the swing rather
  // than sometimes producing nothing: a press that does nothing at all reads
  // as the button being broken.

  if (arrows.length >= CONFIG.maxArrowsInFlight) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  if (!boltFree) inv.focus -= CONFIG.wizFocusBolt;
  let type = 'wiz_normal';
  let dmg  = CONFIG.wizBoltDamage;
  if      (inv.laserStreams > 0) { inv.laserStreams--; type = 'wiz_laser'; dmg = CONFIG.wizFireBoltDamage; }
  else if (inv.fireBolts    > 0) { inv.fireBolts--;   type = 'wiz_fire';  dmg = CONFIG.wizFireBoltDamage; }
  wizBoltCD = CONFIG.wizBoltCooldown;
  const spd = CONFIG.wizBoltSpeed;
  arrows.push({
    x: player.x, y: player.y,
    vx: Math.cos(player.aimAngle) * spd,
    vy: Math.sin(player.aimAngle) * spd,
    life: CONFIG.wizBoltLifetime, type, bounces: 0, initSpeed: spd,
    trailHistory: [], fireSeed: Math.random() * Math.PI * 2, trailTimer: 0,
    wiz: true,
    homing:      type !== 'wiz_laser',
    passesTiles: type === 'wiz_laser',  // bypasses walls/rocks/trees
    pierce:      false,                 // no bolt passes through enemies
    dmg,
    hitSet: new WeakSet()
  });
  events.emit({ type: 'WEAPON_FIRED', kind: 'bolt' });
}

/**
 * The out-of-ammo melee swing, for whichever hero is out of whatever they
 * spend.
 *
 * `kind` picks the weapon rather than the behaviour: the archer, ranger and
 * sapper swing a pitchfork on an empty quiver and the wizard swings a broom on
 * empty Focus, and the only thing that differs between them is the art and how
 * long the cooldown runs. A separate function per weapon would be two copies
 * of a swing, which is how the two of them come to disagree about reach.
 */
function tryFallbackMelee(kind) {
  if (pfCooldown > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  pfKind     = kind;
  pfCooldown = CONFIG.pitchforkCooldown * (kind === 'broom' ? CONFIG.broomCooldownMult : 1);
  pfSwing    = CONFIG.pitchforkSwingDuration;
  pfBossHit  = false;
  pfHitFlash = false;
  events.emit({ type: 'WEAPON_FIRED', kind });
}

/** The three quiver heroes' fallback. See tryFallbackMelee. */
function tryPitchfork() { tryFallbackMelee('pitchfork'); }

/** The wizard's, on a cooldown half again as long. See tryFallbackMelee. */
function tryBroom() { tryFallbackMelee('broom'); }

function tryKnightAttack() {
  // Javelin throw when stocked — ranged piercing projectile
  if (inv.knightJavelins > 0) {
    inv.knightJavelins--;
    const spd = CONFIG.knightJavelinSpeed;
    arrows.push({
      x: player.x, y: player.y,
      vx: Math.cos(player.aimAngle) * spd,
      vy: Math.sin(player.aimAngle) * spd,
      life: 2.2, type: 'javelin', bounces: 0, initSpeed: spd,
      trailHistory: [], fireSeed: 0, trailTimer: 0,
      pierceLeft: CONFIG.knightJavelinPierce
    });
    events.emit({ type: 'WEAPON_FIRED', kind: 'javelin' });
    return;
  }
  // Melee spear thrust
  if (knightSpearCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  // Divided, not subtracted: "+10% attack speed" is a rate, so three stacks
  // is 1.0 / 1.3 = 0.77 s between swings rather than 0.70.
  knightSpearCD       = CONFIG.knightSpearCooldown / knightBloodlustMult();
  knightSpearSwing    = CONFIG.knightSpearSwingDuration;
  knightSpearBossHit  = false;
  // Reset per swing, both of them. knightSpearPhase2Hit was reset only at the
  // start of a run, so the second of the spear's two boss hits -- the half the
  // manual sells as "hits twice" and the balance table prices a swing at --
  // landed on the first swing of a run and never again.
  knightSpearPhase2Hit = false;
  knightSpearConnected = false;
  events.emit({ type: 'WEAPON_FIRED', kind: 'spear' });
}

function startWhirlwind() {
  knightWhirlwindCD    = CONFIG.knightWhirlwindCooldown;
  knightWhirlwindTimer = CONFIG.knightWhirlwindDuration;
  knightWhirlwindTick  = 0;
  events.emit({ type: 'WHIRLWIND_START', x: player.x, y: player.y });
}


/**
 * Puts one stick of powder in the air along the current aim.
 *
 * Shared by the archer's charged throw and the sapper's primary: same flight,
 * bounce and blast, and the only difference is what each spends to get it
 * there, how fast it leaves the hand, and how long its fuse runs — kind picks
 * which of those last two, and doubles as what tells drawDynamites() and the
 * sapper's own Shift shot which bomb this is. Extracted rather than copied,
 * so the two throws can never drift into being two slightly different
 * explosives.
 */
function launchCharge(speed, kind = 'dynamite', element = 'none', opts = {}) {
  const lifetime = (kind === 'bomb' ? CONFIG.sapperBombLifetime : CONFIG.dynamiteLifetime)
    * (opts.fuseMult ?? 1);
  dynamites.push({
    x: player.x, y: player.y,
    vx: Math.cos(player.aimAngle) * speed,
    vy: Math.sin(player.aimAngle) * speed,
    life: lifetime, fuseTotal: lifetime, kind, element,
    // Marks a stick as one HE threw, so only that one throws him back. The
    // blast alone cannot answer this: `explodeExplosive` sees source
    // 'dynamite' for a splinter child and for the `blast()` dev hook too, and
    // launching the player off either would be a surprise rather than a move.
    hop: opts.hop === true,
    // Read at the throw, not at the landing, so a talent drafted while a
    // stick is in the air cannot reach back and detonate it early.
    shortFuse: opts.shortFuse === true,
    angle: player.aimAngle, bobPhase: Math.random() * Math.PI * 2
  });
}

function throwDynamite(chargeFrac) {
  if (inv.dynamites <= 0) return;
  inv.dynamites--;
  launchCharge(TALENTS.stat('longThrow') * (1 + chargeFrac * 2), 'dynamite', 'none',
    { hop: true });
}

/**
 * Throws the player clear of his own blast. No damage: the stick has never
 * hurt him and this does not change that, it only moves him.
 *
 * The push falls off with distance, so standing on the stick throws him
 * furthest and catching the edge barely moves him. That makes the placement
 * the whole control -- a stick at his feet is a leap, a stick thrown long is
 * an attack he happens to be standing near.
 *
 * Walls are respected per axis, the way `pushBodiesFrom` does it, so a hop
 * into a rock slides along it rather than posting him inside it.
 */
function hopFromBlast(cx, cy, radius) {
  const d = Math.hypot(player.x - cx, player.y - cy);
  // Dead centre has no direction to push along. Rather than pick one, nudge
  // him the way he is facing, which is the only intent available.
  const angle = d < 0.001 ? player.aimAngle + Math.PI : Math.atan2(player.y - cy, player.x - cx);
  if (d > radius) return 0;
  const push = blastPush(d, radius, CONFIG.archerBlastHopPx);
  // Clamped into the arena BEFORE the tile is read, not after. Asking whether
  // a point beyond the wall is standable answers no, and the hop cancels
  // itself -- which is how a stick thrown at his feet while he stood on the
  // spawn tile moved him nowhere at all. Clamped first, the same hop carries
  // him up to the wall and stops there, which is what sliding means.
  const nx = clampArenaX(player.x + Math.cos(angle) * push);
  const ny = clampArenaY(player.y + Math.sin(angle) * push);
  if (tilePassable(tileAt(nx, player.y))) player.x = nx;
  if (tilePassable(tileAt(player.x, ny))) player.y = ny;
  return push;
}

/**
 * The sapper's bomb: thrown on the primary, out of a pouch and on a cooldown
 * both. The cooldown paces how fast they leave the hand; the pouch caps how
 * many there are to throw.
 *
 * Fire and ice are spent first when held, the same order and for the same
 * reason the archer spends fire before ricochet before plain: the special is
 * the one you picked up for a reason, and holding it back to the end of the
 * pouch wastes it. Run the pouch dry and the sapper falls back on the same
 * pitchfork the archer and ranger swing when the quiver is empty, rather
 * than standing there with nothing at all.
 */


/** Throws one charge out of the pouch, dearest kind first. See POUCH. */
function throwOneCharge() {
  const element = spendFirst(POUCH);
  if (element === null) return;
  launchCharge(CONFIG.sapperBombSpeed, 'bomb', element);
  events.emit({ type: 'WEAPON_FIRED', kind: 'charge' });
}

/**
 * Opens a burst. Holding the primary keeps it running, up to
 * CONFIG.sapperBurstCount charges; releasing early ends it there.
 *
 * The cooldown is not set here. It is charged when the burst *ends*, at the
 * per-bomb rate times however many actually left, so a player who holds for
 * three pays three cooldowns and one who taps pays one. That is what keeps the
 * burst a placement tool rather than a rate increase.
 */
function trySapperCharge() {
  if (!hasBomb()) { tryPitchfork(); return; }
  if (sapperChargeCD > 0 || sapperBurstLeft > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  throwOneCharge();
  sapperBurstThrown = 1;
  sapperBurstLeft   = CONFIG.sapperBurstCount - 1;
  sapperBurstTimer  = CONFIG.sapperBurstIntervalSecs;
}

/**
 * Runs a burst already in progress, one charge at a time while the primary is
 * still down.
 *
 * Read off the held key rather than off a repeat of the press, because "keeps
 * the attack pressed" is the input: a burst that continued after the button
 * came up would throw bombs the player had already decided not to throw.
 */
function tickSapperBurst(dt) {
  if (sapperBurstLeft <= 0 && sapperBurstThrown === 0) return;

  const holding = mouseLeftHeld || !!keys[CONFIG.keys.shoot];
  if (sapperBurstLeft > 0 && holding && hasBomb()) {
    sapperBurstTimer -= dt;
    if (sapperBurstTimer <= 0) {
      throwOneCharge();
      sapperBurstThrown += 1;
      sapperBurstLeft   -= 1;
      sapperBurstTimer   = CONFIG.sapperBurstIntervalSecs;
    }
    return;
  }

  // The burst is over: either he let go, he ran the pouch dry, or all three
  // left. Bill him for exactly what he threw.
  sapperChargeCD    = TALENTS.stat('shortFuse') * sapperBurstThrown;
  sapperBurstLeft   = 0;
  sapperBurstThrown = 0;
}

/**
 * The sapper's special: a fan of mini-bombs across a fixed arc in front of
 * him, each a small independent blast that goes off on the first thing it
 * touches rather than counting down a fuse — what "having only dynamite" was
 * missing, area denial that doesn't wait a second and a half to matter.
 */
function trySapperBarrage() {
  if (selectedChar !== 'sapper' || !inGame()) return;
  if (sapperBarrageCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  sapperBarrageCD = CONFIG.sapperBarrageCooldown;
  const n = TALENTS.stat('widerFan'), half = CONFIG.sapperBarrageArcRadians / 2;
  for (let i = 0; i < n; i++) {
    // n-1 equal steps across the arc, symmetric about aim angle, so an odd
    // count always puts one bomb on the aim line rather than straddling it.
    const a = player.aimAngle - half + (n === 1 ? half : (half * 2 * i) / (n - 1));
    barrageBombs.push({
      x: player.x, y: player.y,
      vx: Math.cos(a) * CONFIG.sapperBarrageSpeed, vy: Math.sin(a) * CONFIG.sapperBarrageSpeed,
      life: CONFIG.sapperBarrageLifetime, angle: a, kind: 'barrage',
    });
  }
  events.emit({ type: 'WEAPON_FIRED', kind: 'barrage' });
}

/**
 * The sapper's Shift: a fast, straight shot with two very different jobs.
 * Landed on an enemy it is a plain multiple of a normal hit; landed on the
 * sapper's own live bomb instead, it detonates that bomb early into a bigger
 * blast whose damage peaks at the very centre and falls off toward the
 * edge — the payoff for threading a shot through whatever stands between the
 * sapper and his own charge. UT99's shock-combo, not a second weapon.
 */
function trySapperShot() {
  if (selectedChar !== 'sapper' || !inGame()) return;
  if (sapperShotCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  sapperShotCD = CONFIG.sapperShotCooldown;
  sapperShots.push({
    x: player.x, y: player.y,
    vx: Math.cos(player.aimAngle) * CONFIG.sapperShotSpeed,
    vy: Math.sin(player.aimAngle) * CONFIG.sapperShotSpeed,
    life: CONFIG.sapperShotLifetime, angle: player.aimAngle,
  });
  events.emit({ type: 'WEAPON_FIRED', kind: 'sapperShot' });
}

function fireLightningStorm() {
  const STORM_R = TALENTS.stat('stormWidth');
  stormCD = TALENTS.stormCooldown();
  _stormFlash = CONFIG.stormFlashDuration;
  stormFx = STORM_FX_SECS;
  events.emit({ type: 'STORM_CAST', x: player.x, y: player.y });
  // Damage enemies
  const r2 = STORM_R ** 2;
  damageEnemiesInRadius(player.x, player.y, STORM_R,
    { amount: CONFIG.stormBossDamage, source: 'storm', flash: CONFIG.stormFlashDuration });
  // Destroy ROCK and TREE tiles within storm radius (protect border walls)
  const tileR = Math.ceil(STORM_R / CONFIG.tileSize);
  const tc = Math.floor(player.x / CONFIG.tileSize);
  const tr = Math.floor(player.y / CONFIG.tileSize);
  for (let dr = -tileR; dr <= tileR; dr++) {
    for (let dc = -tileR; dc <= tileR; dc++) {
      const row = tr + dr, col = tc + dc;
      if (row < 0 || row >= CONFIG.rows || col < 0 || col >= CONFIG.cols) continue;
      const isBorder = row === 0 || row === CONFIG.rows - 1 || col === 0;
      if (isBorder) continue;
      const wx = (col + 0.5) * CONFIG.tileSize, wy = (row + 0.5) * CONFIG.tileSize;
      if (dist2(player.x, player.y, wx, wy) < r2) smashTile(row, col);
    }
  }
}

// ── ARROWS ────────────────────────────────────────────────────────────────────

function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.life -= dt;

    // ── WIZARD BOLT ──────────────────────────────────────────────────────────
    if (a.wiz) {
      // Life expiry — must be checked here since we `continue` before the shared check below
      if (a.life <= 0) { arrows.splice(i, 1); continue; }
      // Homing: the boss during a boss fight, otherwise the nearest hostile of
      // any kind. A boss fight is what the player is there for — a leftover
      // passive crow stealing the bolt mid-fight is a bug, not a targeting
      // choice, so the boss is checked first rather than only as a fallback
      // when nothing else exists at all.
      //
      // The fallback used to walk `crows` and no other population, which left
      // the wizard's defining mechanic inert wherever the enemies are not
      // birds: the castle gauntlet and the maze, where crows are deleted
      // outright, and the cavern, whose whole garrison is soldiers. A bolt
      // that flew straight past a skeleton also read as broken rather than as
      // a rule, since the README has always sold it as steering toward
      // whoever is nearest.
      if (a.homing) {
        const tgt = bossInPlay()
          ? boss
          : nearestHostileAmong({ x: a.x, y: a.y, team: Team.A },
                                [crows, skeletons, soldiers]);
        if (tgt) {
          const tA = Math.atan2(tgt.y - a.y, tgt.x - a.x);
          const cA = Math.atan2(a.vy, a.vx);
          let dA = tA - cA;
          while (dA >  Math.PI) dA -= Math.PI*2;
          while (dA < -Math.PI) dA += Math.PI*2;
          const nA  = cA + Math.sign(dA) * Math.min(Math.abs(dA), CONFIG.wizBoltTurnRate*dt);
          const spd = Math.hypot(a.vx, a.vy);
          a.vx = Math.cos(nA)*spd; a.vy = Math.sin(nA)*spd;
        }
      }
      // Movement
      if (a.passesTiles) {
        a.x += a.vx*dt; a.y += a.vy*dt;   // laser: bypasses all tiles
      } else {
        const nx = a.x + a.vx*dt;
        if (tilePassable(tileAt(nx, a.y))) a.x = nx; else a.vx = -a.vx*0.5;
        const ny = a.y + a.vy*dt;
        if (tilePassable(tileAt(a.x, ny))) a.y = ny; else a.vy = -a.vy*0.5;
      }
      // Out-of-bounds removal
      if (a.x<0||a.x>=CONFIG.canvasW||a.y<0||a.y>=CONFIG.rows*CONFIG.tileSize) {
        arrows.splice(i,1); continue;
      }
      // Boss hit. Every bolt stops on the boss, shielded or not.
      const bolt = resolveBossHit(a, a.dmg, 'arrow');
      if (bolt !== BossHit.MISS) { arrows.splice(i,1); continue; }
      // Crow hits — all wiz bolts stop on first crow hit (laser doesn't pierce enemies)
      let wizHitCrow = false;
      for (let j = crows.length-1; j >= 0; j--) {
        if (dist2(a.x,a.y,crows[j].x,crows[j].y) < CONFIG.arrowHitRadius*CONFIG.arrowHitRadius) {
          damageCrow(j, CONFIG.wizBoltBodyDamage);
          arrows.splice(i,1);
          wizHitCrow = true;
          break;
        }
      }
      if (wizHitCrow) continue;
      let wizHitSkeleton = false;
      for (let j = skeletons.length-1; j >= 0; j--) {
        if (dist2(a.x,a.y,skeletons[j].x,skeletons[j].y) < CONFIG.arrowHitRadius*CONFIG.arrowHitRadius) {
          damageSkeleton(j, CONFIG.wizBoltBodyDamage);
          arrows.splice(i,1);
          wizHitSkeleton = true;
          break;
        }
      }
      if (wizHitSkeleton) continue;
      // The garrison was missed here the same way it was missed in the area
      // helper above (see its own note): this loop was written when a crow and
      // a skeleton were the whole roster, and the soldiers that arrived with
      // the cavern were never added, so the wizard's primary passed straight
      // through every one of them. The heading is handed over rather than
      // recomputed from the two positions, because it is what a shieldman's
      // guard is measured against and where a bolt came from is not where it
      // was pointed.
      for (let j = soldiers.length-1; j >= 0; j--) {
        if (dist2(a.x,a.y,soldiers[j].x,soldiers[j].y) < CONFIG.arrowHitRadius*CONFIG.arrowHitRadius) {
          // The same figure the crow and skeleton loops above use, not
          // `a.dmg`. What a bolt carries is its boss damage, and reading it
          // here would quietly make a fire bolt worth three to the garrison
          // and one to everything else.
          damageSoldier(j, CONFIG.wizBoltBodyDamage,
                        knockFrom(a.vx, a.vy), Math.atan2(a.vy, a.vx));
          arrows.splice(i, 1);
          break;
        }
      }
      continue; // done with wizard bolt — skip archer logic below
    }

    // A powered fire arrow leaves fire behind it rather than only where it
    // lands, so a full draw burns a lane through whatever it pierced. Spaced
    // on a timer rather than dropped per frame: a patch every frame would be
    // a hundred of them down one flight.
    if (a.fireTrail !== null && a.fireTrail !== undefined) {
      a.fireTrail -= dt;
      if (a.fireTrail <= 0) {
        a.fireTrail += CONFIG.archerFireTrailSecs;
        spawnFire(a.x, a.y);
      }
    }

    // Fire trail — 1 particle every 0.03s, rises like heat
    if (a.type === 'fire') {
      a.trailTimer -= dt;
      if (a.trailTimer <= 0) {
        a.trailTimer += 0.03;
        const rng = Math.random();
        const fc = rng < 0.6 ? '#FF7A1F' : rng < 0.9 ? '#FFB400' : '#FFFFFF';
        if (makeParticleRoom(PRI.AMBIENT)) particles.push({
          x: a.x, y: a.y, vx: (Math.random()-.5)*20, vy: (Math.random()-.5)*20,
          color: fc, alpha: 1, decay: 3.0, shape: 'circle',
          r: 1.5 + Math.random(), gravity: -40, damping: 0, shadowBlur: 8, shadowColor: fc,
          shrink: false, pri: PRI.AMBIENT
        });
      }
    }

    if (a.life <= 0) {
      if (a.type === 'fire') spawnFire(a.x, a.y);
      arrows.splice(i, 1); continue;
    }

    // ── JAVELIN (knight ranged) ───────────────────────────────────────────
    if (a.type === 'javelin') {
      // Straight movement — stops at solid tiles, pierces enemies
      const nx = a.x + a.vx * dt, ny = a.y + a.vy * dt;
      const tileX = tileAt(nx, a.y), tileY = tileAt(a.x, ny);
      if (tileX === TILE.ROCK || tileX === TILE.TREE || tileX === TILE.WATER || tileX === TILE.HUT) { arrows.splice(i,1); continue; }
      if (tileY === TILE.ROCK || tileY === TILE.TREE || tileY === TILE.WATER || tileY === TILE.HUT) { arrows.splice(i,1); continue; }
      a.x = nx; a.y = ny;
      if (a.x < 0 || a.x >= CONFIG.canvasW || a.y < 0 || a.y >= CONFIG.rows*CONFIG.tileSize)
        { arrows.splice(i,1); continue; }
      // Boss hit. The javelin never pierces the boss, shielded or not.
      const jav = resolveBossHit(a, CONFIG.knightJavelinBossDamage, 'javelin');
      if (jav !== BossHit.MISS) { arrows.splice(i,1); continue; }
      // Crow hits — pierces through up to pierceLeft enemies
      for (let j = crows.length - 1; j >= 0; j--) {
        if (dist2(a.x,a.y,crows[j].x,crows[j].y) < CONFIG.arrowHitRadius*CONFIG.arrowHitRadius) {
          damageCrow(j);
          a.pierceLeft--;
          events.emit({ type: 'JAVELIN_BOUNCE', x: a.x, y: a.y });
          if (a.pierceLeft <= 0) { arrows.splice(i,1); break; }
        }
      }
      // Skeleton hits — shares the same pierce budget, so a spent javelin
      // above never reaches here.
      if (a.pierceLeft > 0) {
        for (let j = skeletons.length - 1; j >= 0; j--) {
          if (dist2(a.x,a.y,skeletons[j].x,skeletons[j].y) < CONFIG.arrowHitRadius*CONFIG.arrowHitRadius) {
            damageSkeleton(j);
            a.pierceLeft--;
            events.emit({ type: 'JAVELIN_BOUNCE', x: a.x, y: a.y });
            if (a.pierceLeft <= 0) { arrows.splice(i,1); break; }
          }
        }
      }
      continue;
    }

    let removed = false;
    if (a.type === 'ricochet') {
      // Axis-separated movement so we know which wall was hit
      let bounced = false;
      const nx = a.x + a.vx * dt, tx = tileAt(nx, a.y);
      if      (tx === TILE.WATER)                                    { arrows.splice(i, 1); removed = true; }
      else if (tx === TILE.ROCK || tx === TILE.TREE || tx === TILE.HUT) { a.vx = -a.vx; a.bounces++; bounced = true; }
      else a.x = nx;
      if (!removed) {
        const ny = a.y + a.vy * dt, ty = tileAt(a.x, ny);
        if      (ty === TILE.WATER)                                    { arrows.splice(i, 1); removed = true; }
        else if (ty === TILE.ROCK || ty === TILE.TREE || ty === TILE.HUT) { a.vy = -a.vy; a.bounces++; bounced = true; }
        else a.y = ny;
      }
      // Speed boost on each bounce — gains 55% per bounce, capped at 5× initial speed
      // Also refresh arrow lifetime so extra speed actually translates into distance
      if (!removed && bounced) {
        const curSpd = Math.hypot(a.vx, a.vy);
        const maxSpd = (a.initSpeed || CONFIG.arrowSpeed) * 5;
        const s = Math.min(1.55, maxSpd / curSpd);
        a.vx *= s; a.vy *= s;
        a.life = Math.max(a.life, CONFIG.arrowLifetime * 0.8); // refresh at least 80% of lifetime
      }
      if (!removed) {
        // Record trail position
        a.trailHistory.push({ x: a.x, y: a.y, angle: Math.atan2(a.vy, a.vx) });
        if (a.trailHistory.length > 6) a.trailHistory.shift();
      }
      const bounceCap = a.power === true ? CONFIG.archerPowerBounces : 9;
      if (!removed && (a.bounces > bounceCap || a.x < 0 || a.x >= CONFIG.canvasW || a.y < 0 || a.y >= CONFIG.rows * CONFIG.tileSize))
        { arrows.splice(i, 1); removed = true; }
    } else {
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (a.x < 0 || a.x >= CONFIG.canvasW || a.y < 0 || a.y >= CONFIG.rows * CONFIG.tileSize) {
        if (a.type === 'fire') spawnFire(a.x, a.y); else onArrowMiss();
        arrows.splice(i, 1); removed = true;
      } else {
        const tile = tileAt(a.x, a.y);
        if (tile === TILE.ROCK) {
          if (a.type === 'fire') spawnFire(a.x, a.y); else onArrowMiss();
          arrows.splice(i, 1); removed = true;
        } else if (tile === TILE.TREE) {
          if (a.type === 'fire') {
            // Burn the tree — convert tile to ash, spawn fire patch
            const tc = Math.floor(a.x / CONFIG.tileSize), tr = Math.floor(a.y / CONFIG.tileSize);
            tileMap.set(tr, tc, TILE.ASH);
            spawnFire(a.x, a.y);
          } else {
            onArrowMiss();
          }
          arrows.splice(i, 1); removed = true;
        } else if (tile === TILE.HUT) {
          const htc = Math.floor(a.x / CONFIG.tileSize), htr = Math.floor(a.y / CONFIG.tileSize);
          if (a.type === 'fire') {
            // Fire arrow chars the hut to ash
            tileMap.set(htr, htc, TILE.ASH);
            spawnFire(a.x, a.y);
          } else {
            onArrowMiss();
          }
          arrows.splice(i, 1); removed = true;
        } else if (tile === TILE.WATER && a.type === 'fire') {
          arrows.splice(i, 1); removed = true;
        }
      }
    }
    if (removed) continue;

    // The ranger's own bolt sets off their own satchel on contact, armed or
    // not — no timer needed. Only the ranger ever has a satchel on the field,
    // so this never needs a selectedChar check of its own.
    if (satchels.length) {
      let hitSatchel = false;
      const r = a.hitRadius || CONFIG.arrowHitRadius;
      for (let k = satchels.length - 1; k >= 0; k--) {
        if (dist2(a.x, a.y, satchels[k].x, satchels[k].y) < r*r) {
          explodeExplosive(satchels[k], 'satchel');
          satchels.splice(k, 1);
          arrows.splice(i, 1);
          hitSatchel = true;
          break;
        }
      }
      if (hitSatchel) continue;
    }

    // Boss hit. Ricochet arrows bounce and stay alive; everything else stops,
    // including on the shield, so no arrow passes through him. Crossbow bolts
    // carry their own reduced damage; every other arrow's dmgMult is unset,
    // which the ||1 reads as full strength.
    const arrowHit = resolveBossHit(a, CONFIG.arrowBossDamage * (a.dmgMult || 1), 'arrow');
    if (arrowHit === BossHit.DAMAGED) {
      if (a.type === 'fire') spawnFire(a.x, a.y);
      arrows.splice(i, 1); continue;
    }
    if (arrowHit === BossHit.ABSORBED) { arrows.splice(i, 1); continue; }
    if (arrowHit === BossHit.REFLECTED) continue;

    // Crow hit. Crows die to one hit of anything, so a crossbow bolt's lower
    // damage never matters here — only its smaller hitRadius does.
    let hit = false;
    const hitR = a.hitRadius || CONFIG.arrowHitRadius;
    // A player arrow is worth one hit whatever it carries — the quiver is
    // balanced around that and every pickup changes the arrow, not the number.
    // A shot from the hero's side is worth what it carries: an archer guard's
    // rank adds damage and an archer never swings, so without this a senior
    // archer's promotion would be a badge with nothing behind it, and a tower
    // bolt would be worth the same as a crow peck.
    //
    // `allied` rather than `fromGuard`, which is what this was called when a
    // guard was the only thing that could set it. The flag was never about who
    // fired: it is about whether `damage` on the arrow is to be believed.
    const arrowDamage = a.allied ? (a.damage ?? 1) : 1;
    for (let j = crows.length - 1; j >= 0; j--) {
      if (dist2(a.x, a.y, crows[j].x, crows[j].y) < hitR*hitR) {
        damageCrow(j, arrowDamage, knockFrom(a.vx, a.vy)); if (a.type === 'fire') spawnFire(a.x, a.y);
        if (spendArrowPierce(a, i)) { hit = true; break; }
      }
    }
    if (hit) continue;
    for (let j = skeletons.length - 1; j >= 0; j--) {
      if (dist2(a.x, a.y, skeletons[j].x, skeletons[j].y) < hitR*hitR) {
        damageSkeleton(j, arrowDamage, knockFrom(a.vx, a.vy)); if (a.type === 'fire') spawnFire(a.x, a.y);
        if (spendArrowPierce(a, i)) { hit = true; break; }
      }
    }
    if (hit) continue;
    for (let j = soldiers.length - 1; j >= 0; j--) {
      if (dist2(a.x, a.y, soldiers[j].x, soldiers[j].y) < hitR*hitR) {
        // The arrow's own heading is what a shieldman's guard is measured
        // against, so it is passed rather than recomputed from the two
        // positions: where the shot came from is not where it was aimed.
        const landed = damageSoldier(j, arrowDamage, knockFrom(a.vx, a.vy), Math.atan2(a.vy, a.vx));
        // Spent either way — an arrow stopped by a shield is still stopped —
        // but only a hit that landed sets fire to anything.
        if (landed && a.type === 'fire') spawnFire(a.x, a.y);
        arrows.splice(i, 1); hit = true; break;
      }
    }
    if (hit) continue;
  }
}

/**
 * A patch of burning ground.
 *
 * `dps` is damage per second rather than damage per tick, so the figure in
 * CONFIG stays the same if the tick interval is ever retuned. The default is
 * the fire arrow's original one point every fireArrowDamageInterval, written
 * as the rate that produces — a fire bomb's patch is shorter and weaker and
 * passes its own.
 */
function spawnFire(x, y, opts = {}) {
  fires.push({
    x, y,
    life: opts.duration ?? CONFIG.fireArrowDuration,
    dps: opts.dps ?? 1 / CONFIG.fireArrowDamageInterval,
    phase: Math.random()*Math.PI*2, damageTimer: 0,
  });
}

/**
 * Locks a body in place for a while. One helper rather than three copies,
 * since crows, skeletons and soldiers each run their own update loop and all
 * three have to answer the same question the same way.
 *
 * Bosses are deliberately not freezable: a boss held still for a second and a
 * half is a boss not fighting, and every one of them is a scripted state
 * machine that would have to be taught to be interrupted.
 */
function freezeEnemy(e, secs) {
  if (!e) return;
  e.frozenTimer = Math.max(e.frozenTimer || 0, secs);
}

/** Is this body currently iced in place? */
function isFrozen(e) { return (e.frozenTimer || 0) > 0; }

/** Ticks a body's freeze down, and reports whether it is still held. */
function tickFrozen(e, dt) {
  if (!(e.frozenTimer > 0)) return false;
  e.frozenTimer = Math.max(0, e.frozenTimer - dt);
  return true;
}

function updateFires(dt) {
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i];
    f.life -= dt; f.phase += dt * 9;
    if (f.life <= 0) { fires.splice(i, 1); continue; }
    // Fire-patch embers: 8 particles/second, rise upward
    f.emberTimer = (f.emberTimer || 0) + dt;
    while (f.emberTimer >= 1/8) {
      f.emberTimer -= 1/8;
      const ec = Math.random() < 0.5 ? '#FFB400' : Math.random() < 0.5 ? '#FF7A1F' : '#FFFFFF';
      const ox = (Math.random()-.5)*20, oy = (Math.random()-.5)*20;
      const spd = 20 + Math.random()*40;
      const ea = Math.random()*Math.PI*2;
      if (makeParticleRoom(PRI.AMBIENT)) particles.push({
        x: f.x + ox, y: f.y + oy,
        vx: Math.cos(ea)*spd, vy: Math.sin(ea)*spd,
        color: ec, alpha: 1, decay: 1.5, shape: 'spark',
        r: 1.5, gravity: -80, damping: 0, shadowBlur: 6, shadowColor: ec,
        shrink: false, pri: PRI.AMBIENT
      });
    }
    f.damageTimer -= dt;
    if (f.damageTimer <= 0) {
      f.damageTimer = CONFIG.fireArrowDamageInterval;
      // Per-tick damage derived from the patch's own rate, so a patch that
      // burns for less can also burn for less per second.
      const bite = (f.dps ?? 1 / CONFIG.fireArrowDamageInterval) * CONFIG.fireArrowDamageInterval;
      const r2 = CONFIG.firePatchRadius * CONFIG.firePatchRadius;
      for (let j = crows.length - 1; j >= 0; j--)
        if (dist2(f.x, f.y, crows[j].x, crows[j].y) < r2) damageCrow(j, bite);
      for (let j = skeletons.length - 1; j >= 0; j--)
        if (dist2(f.x, f.y, skeletons[j].x, skeletons[j].y) < r2) damageSkeleton(j, bite);
      for (let j = soldiers.length - 1; j >= 0; j--)
        if (dist2(f.x, f.y, soldiers[j].x, soldiers[j].y) < r2) damageSoldier(j, bite);
    }
  }
}

function onArrowMiss() {
  events.emit({ type: 'ARROW_MISS' }); aggroCrows(Math.random() < 0.5 ? 1 : 2);
  if (boss && appState === 'boss_fight' && boss.bstate === 'orbit') startBossCharge();
}

/**
 * One hit landing on a crow. Every weapon deals a flat 1 regardless of type
 * or character — waves mode's difficulty climb lives entirely in how much
 * HP a crow was spawned with (waveCrowHpMult), not in rebalancing what any
 * given weapon is worth, which is a different question this doesn't answer.
 * Below wave 1's baseline of 1 HP, this behaves exactly as killCrow(j)
 * always did: one hit, dead.
 */
/**
 * Unit vector for a projectile's travel, for the hit recoil. Null for damage
 * with no direction to it (a blast, a fire patch), which then reads as a
 * flash with no shove, which is what those should look like.
 */
function hitKnockOffset(e) {
  if (!e.knock || e.hitFlash <= 0) return ZERO_KNOCK;
  const d = CONFIG.hitKnockPx * (e.hitFlash / CONFIG.hitFlashSecs);
  return { x: e.knock.x * d, y: e.knock.y * d };
}
const ZERO_KNOCK = { x: 0, y: 0 };

/**
 * Spends one body of an arrow's pierce budget, and says whether it is finished.
 *
 * `pierceLeft` was set on every power shot and read by nothing but the
 * renderer: the javelin's hit path honoured it, the ordinary arrow path spliced
 * on first contact, and a power arrow goes down the ordinary path. So a third
 * of what the hold bought never existed.
 *
 * An arrow with no pierce is finished by its first contact, which is why this
 * is one shape for both rather than a branch at each hit site.
 */
function spendArrowPierce(a, i) {
  // Emitted per body, including the last, so a shot that goes through three
  // enemies reads as three hits rather than as one arrow disappearing.
  if (a.power) {
    events.emit({ type: 'ARCHER_POWER_HIT', x: a.x, y: a.y, left: Math.max(0, (a.pierceLeft || 1) - 1) });
  }
  if (a.pierceLeft > 1) { a.pierceLeft--; return false; }
  arrows.splice(i, 1);
  return true;
}

function knockFrom(vx, vy) {
  const m = Math.hypot(vx, vy);
  return m ? { x: vx / m, y: vy / m } : null;
}

function damageCrow(j, amount = 1, knock = null) {
  const c = crows[j];
  if (!c) return;
  c.hp -= amount;
  if (c.hp > 0) { c.hitFlash = CONFIG.hitFlashSecs; c.knock = knock; return; }
  killCrow(j);
}

function killCrow(j) {
  const c = crows[j];
  score++; killCount++;
  // Gameplay result first, so the event can carry the feather count.
  const earned = FEATHERS.onCrowKill(c.white);
  FORESHADOW.onKill(killCount);
  STREAK.onKill();
  // Cosmetics (sound, death burst, score/feather floaters) run in the handler.
  events.emit({ type: 'CROW_KILLED', x: c.x, y: c.y, white: c.white, earned });
  // Guaranteed drop every 3rd kill; random ~25% otherwise; HANDICAP can boost drop rate
  const dropChance = 0.25 + HANDICAP.dropBoost();
  dropStreak++;
  if (dropStreak >= 3 || Math.random() < dropChance) { dropStreak = 0; spawnPickup(c.x, c.y); }
  crows.splice(j, 1);
  // boss only triggers in brawl mode
  if (modeRule(gameMode).bossTrigger === 'killCount' && killCount >= CONFIG.killsToTriggerBoss && appState === 'playing') transitionTo('boss_entrance');
}

// ── SKELETONS (castle stage) ────────────────────────────────────────────────
//
// A parallel system to crows, not a variant of one: a skeleton is ground-based
// and persistently hostile, where a passive crow flies and ignores terrain
// outright. Reused as-is: PathScheduler/FovMap, Team, tilePassable/TileMap,
// dist2, spawnPickup. Its own: movement, damage/death, and SKELETON_KILLED —
// it does not touch killCount or FEATHERS.onCrowKill, which is what keeps the
// first skeleton kill from instantly re-triggering the Crow King's own
// boss_entrance the moment the stage changes.

/** Speed per skeleton kind. A rat is the same entity, tuned to rush. */
const SKELETON_SPEED = {
  normal: () => CONFIG.skeletonSpeed,
  fire:   () => CONFIG.skeletonSpeed,
  ice:    () => CONFIG.skeletonSpeed,
  rat:    () => CONFIG.ratSpeed,
};

/**
 * A random open tile at least `minDist` from the player, for kinds that
 * appear inside the map rather than walking in from off-screen.
 *
 * Rejection sampling over open tiles, capped, because a maze's open tiles are
 * scattered rather than contiguous and there is no cheap closed form for
 * "somewhere over there". Falls back to any open tile, then to the caller's
 * off-screen default, so a spawn always resolves.
 */
function openTileAwayFrom(px, py, minDist) {
  const ts = CONFIG.tileSize;
  let fallback = null;
  for (let tries = 0; tries < 120; tries++) {
    const r = Math.floor(Math.random() * CONFIG.rows);
    const c = Math.floor(Math.random() * CONFIG.cols);
    if (!tilePassable(tileMap.get(r, c))) continue;
    const x = c * ts + ts / 2, y = r * ts + ts / 2;
    fallback ??= { x, y };
    if (dist2(x, y, px, py) >= minDist * minDist) return { x, y };
  }
  return fallback;
}

function spawnSkeleton(kind = 'normal') {
  const baseY = (1 + Math.random() * (CONFIG.rows - 2)) * CONFIG.tileSize;
  // Rats appear in the map; the castle kinds still march in from the right.
  const at = kind === 'rat'
    ? openTileAwayFrom(player.x, player.y, CONFIG.ratSpawnMinDistance)
    : null;
  skeletons.push({
    x: at ? at.x : CONFIG.canvasW + 20, y: at ? at.y : baseY,
    kind, // 'normal' | 'fire' | 'ice' | 'rat' — see the wave table below
    state: 'aggro', // always hostile — the only state a skeleton has, and
                     // what pathScheduler.serve() requires to path it at all
    // Says out loud what `state` only implies, so a skeleton satisfies
    // Targetable and can be weighed up where it lies. A crow has carried this
    // since the bastion; the two populations that arrived later did not, which
    // is why siegeHostiles still has to wrap every body it hands out.
    team: Team.ENEMY,
    hp: 1, maxHp: 1, hitFlash: 0, heldTimer: 0,
    walkPhase: Math.random() * Math.PI * 2,
    path: null, pathTimer: 0,
    // Staggered so a whole wave of ice skeletons does not fire in sync.
    shotCD: kind === 'ice' ? CONFIG.iceSkeletonShotInterval * Math.random() : 0,
  });
}

function damageSkeleton(j, amount = 1, knock = null) {
  const s = skeletons[j];
  if (!s) return;
  s.hp -= amount * netHoldMult(s.heldTimer || 0);
  if (s.hp > 0) { s.hitFlash = CONFIG.hitFlashSecs; s.knock = knock; return; }
  killSkeleton(j);
}

function killSkeleton(j) {
  const s = skeletons[j];
  score++; skeletonKillCount++;
  STREAK.onKill();
  events.emit({ type: 'SKELETON_KILLED', x: s.x, y: s.y, kind: s.kind });
  if (s.kind === 'fire') {
    events.emit({ type: 'FIRE_SKELETON_BLAST', x: s.x, y: s.y });
    if (dist2(s.x, s.y, player.x, player.y) < CONFIG.fireSkeletonBlastRadius ** 2) {
      damagePlayer(CONFIG.fireSkeletonBlastDamage);
    }
  }
  maybeDropSilverKey(s);
  const dropChance = 0.25 + HANDICAP.dropBoost();
  dropStreak++;
  if (dropStreak >= 3 || Math.random() < dropChance) { dropStreak = 0; spawnPickup(s.x, s.y); }
  skeletons.splice(j, 1);
  // No kill count here: the gauntlet is nine waves, cleared one at a time.
  // The last skeleton of a wave dying is what starts the next one, or, past
  // wave 9, the dark archer's entrance.
  // Gated on the gauntlet actually running, not just on the array emptying.
  // castleWave is 0 until startCastleWave sets it, so any other skeleton kind
  // in play elsewhere — the maze's rats, a boss summon before wave 1 — cannot
  // advance a gauntlet that has not begun.
  if (modeRule(gameMode).runsCastleGauntlet && appState === 'playing' && castleWave > 0 && skeletons.length === 0) {
    if (castleWave < CASTLE_TOTAL_WAVES) startCastleWave(castleWave + 1);
    else transitionTo('boss_entrance');
  }
}

// Three groups of three: normal, then fire, then ice, each group sized
// 3/4/5 so every new enemy kind starts easy and ends hard before the next
// group's first, harder kind takes over.
const CASTLE_TOTAL_WAVES = 9;
function castleWaveKind(n) { return n <= 3 ? 'normal' : n <= 6 ? 'fire' : 'ice'; }
function castleWaveSize(n) { return 3 + ((n - 1) % 3); }
function castleWaveBannerText(n) {
  const kind = castleWaveKind(n);
  const label = kind === 'fire' ? 'FIRE SKELETONS' : kind === 'ice' ? 'ICE SKELETONS' : 'SKELETONS';
  return `── WAVE ${n}/${CASTLE_TOTAL_WAVES}: ${label} ──`;
}

function startCastleWave(n) {
  castleWave = n;
  const kind = castleWaveKind(n);
  for (let i = 0; i < castleWaveSize(n); i++) spawnSkeleton(kind);
  waveAnnounce = 2.2;
  waveAnnounceText = castleWaveBannerText(n);
}

/**
 * Ground movement toward the player, using the same A* pathScheduler crows
 * use in their own aggro state — the only state a skeleton has. Unlike a
 * passive crow's flight, this respects tilePassable the way the player's own
 * movement does, so nothing here drifts through a pillar.
 */
/**
 * Walks one pursuer a step along its cached A* path toward the player.
 *
 * Crows, skeletons and rats all chase the same way: follow the cached path,
 * ask the scheduler for a fresh one when it expires or runs out, and beeline
 * while waiting. That was two copies and rats would have made three, so it
 * lives here once, parameterised by the only thing that actually differs
 * between them, speed.
 *
 * Returns whether it moved, which is what drives a walk cycle.
 */
function chaseAlongPath(e, spd, dt) {
  e.pathTimer -= dt;
  if (!e.path || e.path.length === 0 || e.pathTimer <= 0) pathScheduler.request(e);
  if (e.path && e.path.length > 0) {
    const wp = e.path[0];
    const wdx = wp.x - e.x, wdy = wp.y - e.y, wdist = Math.hypot(wdx, wdy);
    if (wdist < 6) { e.path.shift(); return false; }   // waypoint reached
    e.x += (wdx / wdist) * spd * dt; e.y += (wdy / wdist) * spd * dt;
    return true;
  }
  // No path yet (open ground, or already adjacent) — head straight at them.
  const dx = player.x - e.x, dy = player.y - e.y, dist = Math.hypot(dx, dy) || 1;
  e.x += (dx / dist) * spd * dt; e.y += (dy / dist) * spd * dt;
  return true;
}

function updateSkeletons(dt) {
  if (bossDeathSeq) return;
  // Requests go on the same queue crows use — updateCrows.serve() drains it
  // every tick regardless of whether any crows exist, so this only ever
  // needs to .request(), never .serve(). Relies on updateCrows still running
  // alongside this one in stepGame.
  for (let i = skeletons.length - 1; i >= 0; i--) {
    const s = skeletons[i];
    if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt);
    // Iced: no walking, no reaching, no shooting until it wears off.
    if (tickFrozen(s, dt)) continue;
    if (s.heldTimer > 0) { s.heldTimer = Math.max(0, s.heldTimer - dt); continue; }
    const dx = player.x - s.x, dy = player.y - s.y, dist = Math.hypot(dx, dy);
    const reach = s.kind === 'rat' ? 11 : 14;
    if (dist < reach) {
      damagePlayer(s.kind === 'rat' ? CONFIG.ratContactDamage : CONFIG.skeletonContactDamage);
      if (s.kind === 'rat') poisonPlayer();
      continue;
    }
    if (chaseAlongPath(s, SKELETON_SPEED[s.kind]() * mapEnemySpeed(), dt)) s.walkPhase += dt * 8;

    if (s.kind === 'ice') {
      s.shotCD -= dt;
      if (s.shotCD <= 0) { s.shotCD = CONFIG.iceSkeletonShotInterval; fireIceBolt(s); }
    }
  }
}

// ── SOLDIERS ──────────────────────────────────────────────────────────────────

/**
 * The cavern's garrison: spearmen, shieldmen and archers.
 *
 * Their own array and their own loop rather than more kinds on `skeletons`.
 * The castle's undead are a scripted nine-wave gauntlet whose every death is
 * read by `killSkeleton` to decide whether to start the next wave or the dark
 * archer's entrance; a cavern soldier dying must touch none of that. Sharing
 * the array would mean growing an "unless it is a soldier" clause on each of
 * those rules, which is the edit-the-core-loop shape a new variant is supposed
 * to avoid. What they do share is the part that genuinely is the same —
 * `chaseAlongPath`, the cached A* walk that crows, skeletons and rats already
 * use — so nothing here reinvents crossing a room.
 *
 * Stats and the wave table live in sim/soldiers.ts, which is pure and tested.
 * What lives here is the bodies.
 */
let soldiers = [];

/** Kills of the garrison, kept apart from killCount for the reason skeletonKillCount is. */
let soldierKillCount = 0;

/**
 * One soldier, placed out in the map rather than marched in off the canvas
 * edge the way the castle's skeletons are.
 *
 * A cavern is enclosed and its garrison already lives there, so arriving from
 * off-screen right would read as reinforcements walking in through solid rock.
 * `openTileAwayFrom` is the same placement the maze's rats use, and it falls
 * back to any open tile if the map is too small to honour the distance.
 */
function spawnSoldier(kind) {
  const stats = SOLDIER_STATS[kind];
  const at = openTileAwayFrom(player.x, player.y, CONFIG.soldierSpawnMinDistance)
    ?? spawnPoint();
  soldiers.push({
    x: at.x, y: at.y, kind,
    // Always hostile, and the state pathScheduler.serve() requires to path it.
    state: 'aggro',
    team: Team.ENEMY,   // see spawnSkeleton: stated, not inferred from `state`
    hp: stats.hp, maxHp: stats.hp, hitFlash: 0,
    walkPhase: Math.random() * Math.PI * 2,
    // Which way it is looking, which is the whole of the shieldman's guard.
    facing: 0,
    path: null, pathTimer: 0,
    // Staggered, so a rank of archers does not volley on a single frame.
    shotCD: kind === 'archer' ? CONFIG.soldierArcherShotInterval * Math.random() : 0,
    charge: 0, chargeAngle: 0, chargeCD: 0,
  });
}

/** Sends in one wave's worth, capped so a late wave cannot flood the map. */
function spawnSoldierWave(wave) {
  for (const kind of waveComposition(wave)) {
    if (soldiers.length >= CONFIG.soldierMax) return;
    spawnSoldier(kind);
  }
}

/** An archer's shot: the same hostile bolt an ice skeleton fires, without the freeze. */
function fireSoldierArrow(s) {
  const ang = Math.atan2(player.y - s.y, player.x - s.x);
  hostileBolts.push({
    x: s.x, y: s.y,
    vx: Math.cos(ang) * CONFIG.soldierArcherBoltSpeed,
    vy: Math.sin(ang) * CONFIG.soldierArcherBoltSpeed,
    life: 2.5, damage: CONFIG.soldierArcherBoltDamage, freezeSecs: 0, blastRadius: 0,
  });
  events.emit({ type: 'SOLDIER_SHOT', x: s.x, y: s.y });
}

/**
 * A soldier taking a hit.
 *
 * `heading` is the direction the thing that hit it was travelling, and only
 * the shieldman reads it. Returns whether the hit landed, so a caller can tell
 * a blocked arrow from a spent one.
 */
function damageSoldier(j, amount = 1, knock = null, heading = null) {
  const s = soldiers[j];
  if (!s) return false;
  if (s.kind === 'shieldman' && heading !== null && shieldStops(s.facing, heading)) {
    s.hitFlash = CONFIG.hitFlashSecs;
    events.emit({ type: 'SHIELD_BLOCKED', x: s.x, y: s.y });
    return false;
  }
  s.hp -= amount * netHoldMult(s.heldTimer || 0);
  if (s.hp > 0) { s.hitFlash = CONFIG.hitFlashSecs; s.knock = knock; return true; }
  killSoldier(j);
  return true;
}

function killSoldier(j) {
  const s = soldiers[j];
  score++; soldierKillCount++;
  STREAK.onKill();
  events.emit({ type: 'SOLDIER_KILLED', x: s.x, y: s.y, kind: s.kind });
  const dropChance = 0.25 + HANDICAP.dropBoost();
  dropStreak++;
  if (dropStreak >= 3 || Math.random() < dropChance) { dropStreak = 0; spawnPickup(s.x, s.y); }
  soldiers.splice(j, 1);
}

/**
 * Walks the garrison.
 *
 * Each kind answers a different question. The shieldman just arrives, slowly,
 * and has to be gone round. The archer stops at its reach and shoots, so
 * standing off is the thing that does not work against it. The spearman closes
 * and then commits to a straight run at where the player was when it set off,
 * which is what makes stepping off that line the answer.
 */
function updateSoldiers(dt) {
  if (bossDeathSeq) return;
  for (let i = soldiers.length - 1; i >= 0; i--) {
    const s = soldiers[i];
    const stats = SOLDIER_STATS[s.kind];
    if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt);
    if (s.chargeCD > 0) s.chargeCD = Math.max(0, s.chargeCD - dt);
    // Iced: held in place, guard and all. Ticked after the cooldowns above so
    // a frozen soldier is not also having its next attack held back.
    if (tickFrozen(s, dt)) continue;
    // Netted. Checked after the freeze so the two cannot cut each other
    // short when a soldier catches both at once.
    if (s.heldTimer > 0) { s.heldTimer = Math.max(0, s.heldTimer - dt); continue; }

    const dx = player.x - s.x, dy = player.y - s.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Faces where it is going, which for everything but a committed charge is
    // the player. The shieldman's guard is read off this.
    if (s.charge <= 0) s.facing = shieldFacing(s.x, s.y, player.x, player.y, s.facing);

    if (dist < CONFIG.soldierContactReach) {
      damagePlayer(stats.contactDamage);
      s.charge = 0;
      continue;
    }

    if (s.charge > 0) {
      // Committed. Terrain still stops it, and stopping ends the run rather
      // than sliding along the wall, so a charge broken on rock is a real
      // opening rather than a soldier grinding into stone.
      s.charge -= dt;
      const nx = s.x + Math.cos(s.chargeAngle) * CONFIG.soldierSpearChargeSpeed * mapEnemySpeed() * dt;
      const ny = s.y + Math.sin(s.chargeAngle) * CONFIG.soldierSpearChargeSpeed * mapEnemySpeed() * dt;
      if (tilePassable(tileAt(nx, ny))) { s.x = nx; s.y = ny; s.walkPhase += dt * 14; }
      else s.charge = 0;
      continue;
    }

    if (s.kind === 'archer') {
      s.shotCD -= dt;
      if (dist > stats.reach) {
        if (chaseAlongPath(s, stats.speed * mapEnemySpeed(), dt)) s.walkPhase += dt * 8;
      } else if (s.shotCD <= 0) {
        s.shotCD = CONFIG.soldierArcherShotInterval;
        fireSoldierArrow(s);
      }
      continue;
    }

    if (s.kind === 'spearman' && dist <= stats.reach && s.chargeCD <= 0) {
      s.charge = CONFIG.soldierSpearChargeSecs;
      s.chargeAngle = Math.atan2(dy, dx);
      s.chargeCD = CONFIG.soldierSpearChargeGap;
      s.facing = s.chargeAngle;
      continue;
    }

    if (chaseAlongPath(s, stats.speed * mapEnemySpeed(), dt)) s.walkPhase += dt * 8;
  }
}

// ── DYNAMITES ─────────────────────────────────────────────────────────────────

function updateDynamites(dt) {
  for (let i = dynamites.length - 1; i >= 0; i--) {
    const d = dynamites[i];
    d.life -= dt; d.angle += dt * 5;

    if (d.life <= 0) { explodeExplosive(d, 'dynamite'); dynamites.splice(i, 1); continue; }

    let splashed = false;
    let struck = false;
    const nx = d.x + d.vx * dt;
    const tx = tileAt(nx, d.y);
    if      (tx === TILE.WATER)              splashed = true;
    else if (tx === TILE.ROCK || tx === TILE.TREE || tx === TILE.HUT) { d.vx *= -0.65; struck = true; }
    else d.x = Math.max(0, Math.min(CONFIG.canvasW - 1, nx));

    if (!splashed) {
      const ny = d.y + d.vy * dt;
      const ty = tileAt(d.x, ny);
      if      (ty === TILE.WATER)              splashed = true;
      else if (ty === TILE.ROCK || ty === TILE.TREE || ty === TILE.HUT) { d.vy *= -0.65; struck = true; }
      else d.y = Math.max(0, Math.min(CONFIG.rows * CONFIG.tileSize - 1, ny));
    }

    // SHORT FUSE also blows on the first thing the stick touches, on top of
    // the shortened fuse it was launched with. A stick has no notion of the
    // ground -- it slides on friction until its fuse runs out -- so "lands" is
    // whatever it hits.
    if (!splashed && d.shortFuse === true && struck) {
      explodeExplosive(d, 'dynamite');
      dynamites.splice(i, 1);
      continue;
    }

    if (splashed) {
      events.emit({ type: 'SPLASH', x: d.x, y: d.y });
      dynamites.splice(i, 1); continue;
    }

    if (d.x <= 1 || d.x >= CONFIG.canvasW - 1) d.vx *= -0.65;
    if (d.y <= 1 || d.y >= CONFIG.rows * CONFIG.tileSize - 1) d.vy *= -0.65;
    d.vx *= 0.985; d.vy *= 0.985;
  }
}

/**
 * One explosive going off — dynamite's timer running out, a satchel's timer,
 * the ranger's own bolt, a mini-bomb from the sapper's barrage, or his own
 * bomb detonated early by his Shift shot. Blast radius and boss damage
 * default to dynamite's own CONFIG figures; a caller with a different size
 * (the barrage) or a per-target falloff (the Shift combo) passes `opts`
 * instead of a second copy of this function existing to drift out of sync
 * with the first.
 */
/**
 * Lights every one of the sapper's other bombs within reach of a blast.
 *
 * Called from the blast rather than from the bomb, so anything that sets a
 * bomb off starts a chain: a fuse running out, a barrage landing on the pile,
 * or the piercing shot that already detonated one on purpose.
 *
 * Only `kind === 'bomb'` is chained, which is the sapper's own pouch. The
 * archer's dynamite and the ranger's satchel share this array and this blast
 * path, and neither hero was given a chain -- the same test the shift-detonated
 * combo already makes.
 *
 * A bomb is lit once, and that guard is about *damage*, not termination — the
 * `Math.min` below already guarantees a lit bomb keeps counting down whoever
 * relights it. What it stops is a bomb being promoted a link deeper by every
 * successive blast that reaches it, so the boss bonus tracks how deep the chain
 * really is rather than how many neighbours happened to overlap it.
 *
 * Not a theoretical tidiness. Measured on six bombs packed inside a single
 * radius: 20.4 boss damage with the guard, 32.4 without — a 59% bonus bought by
 * standing still and piling them up, which is the easiest input the sapper has.
 */
function chainNearbyBombs(from, link) {
  if (!isSapperExplosive(from)) return;
  if (link >= TALENTS.stat('moreLinks')) return;
  const r2 = TALENTS.stat('longFuse') ** 2;
  // Both arrays. His thrown charges live in `dynamites` alongside the archer's
  // sticks and the ranger's satchels; his barrage fan lives in `barrageBombs`
  // on its own. Scanning only the first is what this shipped as, and it made
  // the whole mechanic very nearly inert: a 1.8 s fuse against a 1.1 s
  // cooldown puts at most 1.6 charges in the air at a time, so the one moment
  // he reliably has a pile of explosives out -- the five-bomb fan -- was the
  // one the chain could not see.
  for (const other of dynamites)    chainOne(from, other, link, r2);
  for (const other of barrageBombs) chainOne(from, other, link, r2);
}

/** Is this one of the sapper's, as opposed to a stick or a satchel? */
function isSapperExplosive(e) {
  return e.kind === 'bomb' || e.kind === 'barrage';
}

/** Lights one neighbour, if it is his, unlit, and in reach. */
function chainOne(from, other, link, r2) {
  if (other === from || other.chainLit || !isSapperExplosive(other)) return;
  if (dist2(from.x, from.y, other.x, other.y) >= r2) return;
  other.chainLit  = true;
  other.chainLink = link + 1;
  other.chainMult = from.chainMult ?? 1;
  // Never lengthens a fuse: a bomb already about to go off is not delayed by
  // being lit, it just goes off as its own link of the chain.
  other.life = Math.min(other.life, CONFIG.sapperChainDelaySecs);
}

/**
 * Flattens the destructible cover a blast reaches: rock, trees and huts.
 *
 * Its own function because it is its own responsibility and it is the bulk of
 * what a blast used to be -- a nested scan over a tile window, next to the
 * damage and the fire, in one 47-line body. On some maps terrain does not break
 * at all (`terrainDestructible`), which is a rule about the world rather than
 * about explosives and reads better standing alone.
 */
function clearTilesInBlast(x, y, radius) {
  if (!terrainDestructible()) return;
  const r2 = radius ** 2;
  const tileR = Math.ceil(radius / CONFIG.tileSize);
  const tc = Math.floor(x / CONFIG.tileSize), tr = Math.floor(y / CONFIG.tileSize);
  for (let dr = -tileR; dr <= tileR; dr++) {
    for (let dc = -tileR; dc <= tileR; dc++) {
      const row = tr + dr, col = tc + dc;
      if (row < 0 || row >= CONFIG.rows || col < 0 || col >= CONFIG.cols) continue;
      const t = tileMap.get(row, col);
      if (t !== TILE.ROCK && t !== TILE.TREE && t !== TILE.HUT) continue;
      const wx = (col + 0.5) * CONFIG.tileSize, wy = (row + 0.5) * CONFIG.tileSize;
      if (dist2(x, y, wx, wy) < r2) tileMap.set(row, col, TILE.EMPTY);
    }
  }
}

function explodeExplosive(d, source, opts = {}) {
  // A bomb carries its own radius multiplier so a chain inherits it. The shift
  // shot detonates one bomb wider than usual, and the point of the ability is
  // that the whole pile goes up that wide -- not just the one the dart touched.
  const mult = d.chainMult ?? 1;
  // How deep into a chain this bomb sits, needed before the radius because
  // DEMOLITIONIST grows the blast with it: each bomb a chain lights goes up
  // wider than the one that lit it.
  const link = Math.min(d.chainLink ?? 0, TALENTS.stat('moreLinks'));
  const grow = TALENTS.capstoneActive('demolitionist')
    ? 1 + link * CONFIG.sapperDemolitionGrowth : 1;
  // The chain is the sapper's ramp, and it was the only one on the roster
  // with nothing on screen: brace, momentum and bloodlust all report
  // themselves, and his multiplied a boss's damage silently. Every bomb a
  // cascade lights reports the depth it went off at.
  if (isSapperExplosive(d)) {
    sapperChainPeak = Math.max(sapperChainPeak, link + 1);
    sapperChainRead = CONFIG.sapperChainReadSecs;
  }
  const radius = (opts.radius ?? CONFIG.dynamiteBlastRadius * mult) * grow;
  const onWater = tileAt(d.x, d.y) === TILE.WATER;
  // Sound, shake, and the blast burst run in the render/audio handler.
  events.emit({ type: 'EXPLOSION', x: d.x, y: d.y, onWater, big: mult > 1, radius });
  const r2 = radius ** 2;

  clearTilesInBlast(d.x, d.y, radius);

  const baseBossDamage = source === 'satchel' ? CONFIG.satchelBossDamage
              : source === 'barrage' ? CONFIG.sapperBarrageDamage
              : CONFIG.dynamiteBossDamage;
  // Each link of a chain hits a boss harder than the one that lit it. The
  // multiplier reaches boss damage only, which is the point rather than a
  // limitation: everything else on the field dies to one hit of anything, so
  // against a crowd a chain is already worth exactly its coverage.
  const bossDamage = baseBossDamage * (1 + link * CONFIG.sapperChainBossBonus);
  damageEnemiesInRadius(d.x, d.y, radius,
    { amount: bossDamage, source, flash: 0.25 },
    { falloff: opts.falloff, element: d.element });

  // His own stick throws him, and throws whatever lived through it as well.
  // Nothing else does either, and neither costs him health. The bodies are
  // pushed after the damage above, so only survivors are still in the lists
  // to be moved.
  if (d.hop === true) {
    hopFromBlast(d.x, d.y, radius);
    pushSurvivorsFrom(d.x, d.y, radius, TALENTS.stat('longThrow'));
  }

  chainNearbyBombs(d, link);

  // SHOCKWAVE: the combo blast clears the ground around him of whatever it
  // did not kill. Only the combo -- an ordinary bomb keeps its old reach.
  if (source === 'sapperShot' && TALENTS.capstoneActive('shockwave')) {
    pushBodiesFrom(d.x, d.y, radius, CONFIG.sapperShockwavePush);
  }
  // SHRAPNEL: a satchel throws the ranger's own bolts outward as it goes.
  if (source === 'satchel' && TALENTS.capstoneActive('shrapnel')) {
    const n = CONFIG.rangerShrapnelBolts;
    for (let i = 0; i < n && arrows.length < CONFIG.maxArrowsInFlight; i++) {
      const a = (i / n) * Math.PI * 2;
      arrows.push({ x: d.x, y: d.y,
        vx: Math.cos(a) * CONFIG.arrowSpeed, vy: Math.sin(a) * CONFIG.arrowSpeed,
        life: CONFIG.arrowLifetime, type: 'normal', bounces: 0,
        initSpeed: CONFIG.arrowSpeed,
        trailHistory: [], fireSeed: 0, trailTimer: 0,
        bolt: true,
        hitRadius: CONFIG.arrowHitRadius * CONFIG.crossbowBoltRadiusMult,
        dmgMult: CONFIG.crossbowBoltDamageMult });
    }
  }
  // SPLINTER: one stick, three craters. The children are marked so they
  // cannot splinter again -- an unmarked child would light three more, and
  // the third generation is where a frame budget goes to die.
  if (source === 'dynamite' && !d.splinterChild && TALENTS.capstoneActive('splinter')) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      explodeExplosive({
        x: d.x + Math.cos(a) * CONFIG.archerSplinterSpread,
        y: d.y + Math.sin(a) * CONFIG.archerSplinterSpread,
        vx: 0, vy: 0, life: 0, angle: 0, element: d.element, splinterChild: true,
      }, 'dynamite', { radius: radius * CONFIG.archerSplinterFrac });
    }
  }

  // Fire leaves the ground burning where it went off.
  if (d.element === 'fire' && !onWater) {
    spawnFire(d.x, d.y, {
      duration: CONFIG.fireBlastPatchDuration, dps: CONFIG.fireBlastPatchDps,
    });
  }
}

/**
 * The sapper's barrage mini-bombs: straight flight, no bounce, and — unlike
 * the main charge — a check every frame for the first thing they touch,
 * since "explodes on hit" is the whole point of a fan of them. A miss still
 * goes off once its short fuse runs out, so a barrage into open ground reads
 * as five small blasts rather than five bombs vanishing off-screen.
 */
function updateBarrageBombs(dt) {
  for (let i = barrageBombs.length - 1; i >= 0; i--) {
    const b = barrageBombs[i];
    b.life -= dt;
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    const blocked = !tilePassable(tileAt(nx, ny));
    if (!blocked) { b.x = nx; b.y = ny; }

    const armed = b.mine === true;
    // An armed mine answers to a stride, not to a bomb's contact radius.
    const hitR = armed ? CONFIG.sapperMineTriggerRadius : CONFIG.arrowHitRadius;
    // A stuck bomb is already where it was going and STOPS LOOKING -- which is
    // what the line above always said and what it did only for walls. It kept
    // scanning bodies, so a STICKY FAN bomb resting against the crow it landed
    // on re-stuck itself every frame and never once ran its fuse out. A mine is
    // the exception: waiting for somebody is the whole of it.
    let hit = b.stuck && !armed ? false : blocked;
    const looking = armed || !b.stuck;
    if (looking && !hit) {
      for (const c of crows) if (dist2(b.x, b.y, c.x, c.y) < hitR * hitR) { hit = true; break; }
      if (!hit) for (const s of skeletons) if (dist2(b.x, b.y, s.x, s.y) < hitR * hitR) { hit = true; break; }
      // The garrison, which this loop never mentioned: a barrage bomb flew
      // through a soldier and went off on its own fuse behind him. A mine the
      // cavern can walk over is not a mine, so it is fixed rather than worked
      // around.
      if (!hit) for (const s of soldiers) if (dist2(b.x, b.y, s.x, s.y) < hitR * hitR) { hit = true; break; }
      if (!hit && bossInPlay() && !boss.shield && dist2(b.x, b.y, boss.x, boss.y) < hitR * hitR) hit = true;
    }

    // STICKY FAN: a bomb that touches something stops there and keeps its
    // fuse instead of going off on contact, which turns the fan from a
    // scatter into a placement -- and leaves five bombs on the ground for a
    // chain to run through. Its written effect said they would stop bouncing;
    // they never bounced, they detonated, so this is what it buys instead.
    if (hit && TALENTS.held('stickyFan')) {
      b.vx = 0; b.vy = 0; b.stuck = true;
    } else if (!hit && b.life <= 0 && !b.mine && TALENTS.capstoneActive('minefield')) {
      // MINEFIELD: a bomb that touched nothing does not spend itself on its own
      // fuse. It settles where it landed and waits, which turns a missed fan
      // into ground nobody can cross -- and they are still his bombs, so a
      // chain runs through them exactly as it runs through a stuck one.
      b.vx = 0; b.vy = 0; b.stuck = true; b.mine = true;
      b.life = CONFIG.sapperMineSecs;
      events.emit({ type: 'SAPPER_MINE_ARMED', x: b.x, y: b.y });
    } else if (hit || b.life <= 0) {
      explodeExplosive(b, 'barrage', { radius: CONFIG.sapperBarrageBlastRadius });
      barrageBombs.splice(i, 1);
    }
  }
}

/**
 * The sapper's Shift shot: straight flight, no bounce, gone on the first
 * thing it touches. The sapper's own live bombs are checked before enemies —
 * see trySapperShot() — since threading the combo is the shot this ability
 * exists for, not a fallback.
 */
function updateSapperShots(dt) {
  const hitR = CONFIG.arrowHitRadius;
  for (let i = sapperShots.length - 1; i >= 0; i--) {
    const s = sapperShots[i];
    s.life -= dt;
    const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
    if (!tilePassable(tileAt(nx, ny)) || s.life <= 0) { sapperShots.splice(i, 1); continue; }
    s.x = nx; s.y = ny;

    let comboHit = false;
    for (let j = dynamites.length - 1; j >= 0; j--) {
      const d = dynamites[j];
      if (d.kind === 'bomb' && dist2(s.x, s.y, d.x, d.y) < hitR * hitR) {
        dynamites.splice(j, 1);
        // Marked rather than given a one-off radius: chainNearbyBombs copies
        // this onto everything it lights, so the whole cluster goes up at the
        // wider size instead of one wide blast surrounded by ordinary ones.
        d.chainMult = CONFIG.sapperComboRadiusMult;
        explodeExplosive(d, 'sapperShot', {
          falloff: { max: CONFIG.sapperComboFalloffMax, min: CONFIG.sapperComboFalloffMin },
        });
        comboHit = true;
        break;
      }
    }
    if (comboHit) { sapperShots.splice(i, 1); continue; }

    let hit = false;
    if (bossInPlay() && !boss.shield && dist2(s.x, s.y, boss.x, boss.y) < hitR * hitR) {
      damageBoss(CONFIG.sapperShotBossDamage, s.x, s.y, 'sapperShot', 0.2);
      hit = true;
    }
    if (!hit) for (let j = crows.length - 1; j >= 0; j--)
      if (dist2(s.x, s.y, crows[j].x, crows[j].y) < hitR * hitR) {
        damageCrow(j, CONFIG.sapperShotDamageMult, knockFrom(s.vx, s.vy)); hit = true; break;
      }
    if (!hit) for (let j = skeletons.length - 1; j >= 0; j--)
      if (dist2(s.x, s.y, skeletons[j].x, skeletons[j].y) < hitR * hitR) {
        damageSkeleton(j, CONFIG.sapperShotDamageMult, knockFrom(s.vx, s.vy)); hit = true; break;
      }
    if (!hit) for (let j = soldiers.length - 1; j >= 0; j--)
      if (dist2(s.x, s.y, soldiers[j].x, soldiers[j].y) < hitR * hitR) {
        damageSoldier(j, CONFIG.sapperShotDamageMult, knockFrom(s.vx, s.vy), Math.atan2(s.vy, s.vx)); hit = true; break;
      }
    if (hit) sapperShots.splice(i, 1);
  }
}

// ── SATCHELS (ranger) ────────────────────────────────────────────────────────

/**
 * Throws a satchel, or arms the one already out.
 *
 * Unlike dynamite there is no charge to hold: the first click always throws
 * at the same fixed speed. The second click does not throw a second satchel
 * while the first is still live and unarmed — it arms that one, which is
 * what "a second mouse2 click" means. Once armed it drops out of this search
 * (armed !== unarmed), so a third click starts a fresh throw if ammo remains.
 */
function useSatchel() {
  const own = satchels.find(s => !s.armed);
  if (own) {
    own.armed = true;
    own.life  = CONFIG.satchelArmFuse;
    events.emit({ type: 'SATCHEL_ARMED', x: own.x, y: own.y });
    return;
  }
  if (inv.satchels <= 0) return;
  inv.satchels--;
  const spd = CONFIG.satchelThrowSpeed;
  satchels.push({
    x: player.x, y: player.y,
    vx: Math.cos(player.aimAngle) * spd, vy: Math.sin(player.aimAngle) * spd,
    life: CONFIG.satchelIdleLife, armed: false, resting: false,
    angle: player.aimAngle, bobPhase: Math.random() * Math.PI * 2
  });
}

/**
 * Flight and countdown for every satchel on the field.
 *
 * Terrain response now matches dynamite's bounce, tumble and all, rather
 * than stopping dead: `life` is doing double duty by design, the same way it
 * does for dynamite, but only the fuse actually detonates it, never the
 * slow-down that settles it — an unarmed satchel bounces to a stop and sits
 * there inert, same as before, just livelier getting there.
 */
function updateSatchels(dt) {
  for (let i = satchels.length - 1; i >= 0; i--) {
    const s = satchels[i];
    s.life -= dt;
    if (s.life <= 0) { explodeExplosive(s, 'satchel'); satchels.splice(i, 1); continue; }

    if (s.resting) continue;

    s.angle += dt * 5;

    const nx = s.x + s.vx * dt, tx = tileAt(nx, s.y);
    if (tx === TILE.WATER) { events.emit({ type: 'SPLASH', x: s.x, y: s.y }); satchels.splice(i, 1); continue; }
    if (tx === TILE.ROCK || tx === TILE.TREE || tx === TILE.HUT) s.vx *= -0.65; else s.x = nx;

    const ny = s.y + s.vy * dt, ty = tileAt(s.x, ny);
    if (ty === TILE.WATER) { events.emit({ type: 'SPLASH', x: s.x, y: s.y }); satchels.splice(i, 1); continue; }
    if (ty === TILE.ROCK || ty === TILE.TREE || ty === TILE.HUT) s.vy *= -0.65; else s.y = ny;

    // Same drag as dynamite, so it rolls and settles on the same rhythm.
    s.vx *= 0.985; s.vy *= 0.985;
    if (Math.hypot(s.vx, s.vy) < 8) { s.vx = 0; s.vy = 0; s.resting = true; }
  }
}

// ── CROWS ─────────────────────────────────────────────────────────────────────

function updateCrows(dt) {
  if (bossDeathSeq) return;
  // Serve last frame's queued path requests before crows move this frame.
  pathScheduler.serve(player.x, player.y);
  for (let i = crows.length - 1; i >= 0; i--) {
    const c = crows[i];
    if (c.hitFlash > 0) c.hitFlash = Math.max(0, c.hitFlash - dt);
    if (c.frozen) continue;
    // Iced: still there, still shootable, just not going anywhere.
    if (tickFrozen(c, dt)) continue;
    // Netted: it still bleeds and still burns, it simply does not move or
    // decide anything while the mesh is on it.
    if (c.heldTimer > 0) { c.heldTimer = Math.max(0, c.heldTimer - dt); continue; }
    c.wingPhase += dt * (c.white ? 14 : 12);
    if (c.state === 'passive') {
      const spd = (c.white ? CONFIG.whiteCrowPassiveSpeed : CONFIG.crowPassiveSpeed) * HANDICAP.crowSpeedMod() * mapEnemySpeed();
      c.x -= spd * dt;
      c.y  = c.baseY + Math.sin(gameTime / 3 + c.phaseOff) * 40;
      c.y  = Math.max(CONFIG.tileSize, Math.min((CONFIG.rows-1)*CONFIG.tileSize, c.y));
      if (c.x < -20) {
        c.x = CONFIG.canvasW + 20 + Math.random() * 80;
        c.baseY = c.y = (1 + Math.random() * (CONFIG.rows - 2)) * CONFIG.tileSize;
      }
    } else {
      // ── Aggro state ───────────────────────────────────────────────────────
      c.aggroTimer -= dt;
      const dx = player.x - c.x, dy = player.y - c.y, dist = Math.hypot(dx, dy);
      if (dist < 14) { damagePlayer(1, i); if (i < crows.length) { c.state = 'passive'; c.baseY = c.y; c.path = null; } continue; }
      const spd = (c.white ? CONFIG.whiteCrowAggroSpeed : CONFIG.crowAggroSpeed) * HANDICAP.crowSpeedMod() * waveCrowAggroMult() * mapEnemySpeed();
      chaseAlongPath(c, spd, dt);
      if (c.aggroTimer <= 0) { c.state = 'passive'; c.baseY = c.y; c.path = null; }
    }
  }
}

function aggroCrows(count) {
  // A crow turns on you because it noticed you, so the check runs from the
  // crow: does it have a clear line to the player, inside its own sight range.
  // That was the intent all along, and reading the player's FOV cache happened
  // to give the same answer while everyone shared one radius. It stops giving
  // it the moment the player's radius shrinks, which is exactly what the maze
  // does. The range matches the open maps' old FOV radius, so forest and castle
  // keep the reach they had.
  const range = CONFIG.sightRadiusTiles * CONFIG.tileSize;
  const passive = crows
    .filter(c => c.state === 'passive' && seesPlayerFrom(c.x, c.y, range))
    .sort((a, b) => dist2(a.x,a.y,player.x,player.y) - dist2(b.x,b.y,player.x,player.y));
  let n = 0;
  for (const c of passive) {
    if (n >= count) break;
    c.state = 'aggro'; c.aggroTimer = CONFIG.crowAggroTimeout;
    c.path = null; c.pathTimer = pathScheduler.initialPhase(); n++;
  }
  if (n > 0) events.emit({ type: 'CROWS_AGGRO' });
}

function aggroAllWhiteCrows() {
  for (const c of crows)
    if (c.white && c.state === 'passive') { c.state = 'aggro'; c.aggroTimer = CONFIG.crowAggroTimeout; }
}

// ── PICKUPS & PARTICLES ───────────────────────────────────────────────────────

function updatePickups(dt) { for (const p of pickups) p.pulsePhase += dt * (2*Math.PI/0.6); }

/**
 * Marks where an area effect reached, as a ring that opens out to the real
 * radius and fades.
 *
 * A blast that is only a puff of sparks leaves the player guessing how far it
 * went, and guessing wrong is how an ability feels unreliable. The ring is
 * drawn at the figure the damage actually used, so what is on screen is a
 * report rather than a decoration.
 */
function spawnShockRing(wx, wy, radius, color) {
  shockRings.push({ x: wx, y: wy, radius, color,
                    timer: CONFIG.shockRingSecs, total: CONFIG.shockRingSecs });
}

function updateShockRings(dt) {
  for (let i = shockRings.length - 1; i >= 0; i--) {
    shockRings[i].timer -= dt;
    if (shockRings[i].timer <= 0) shockRings.splice(i, 1);
  }
}

/** A net in flight: a small square of mesh, tumbling. */
function drawNets() {
  for (const n of nets) {
    ctx.save();
    ctx.translate(n.x, n.y + CONFIG.hudHeight);
    ctx.rotate(n.spin);
    ctx.strokeStyle = '#E8E0C0'; ctx.lineWidth = 1;
    ctx.shadowColor = '#E8E0C0'; ctx.shadowBlur = 4;
    for (const o of [-4, 0, 4]) {
      ctx.beginPath(); ctx.moveTo(-6, o); ctx.lineTo(6, o); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o, -6); ctx.lineTo(o, 6); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

/**
 * The mesh over whatever is pinned under it.
 *
 * Drawn in one pass over both enemy kinds rather than inside each painter, so
 * a third kind that can be netted needs no new drawing code at all.
 */
function drawHeldMarkers() {
  ctx.strokeStyle = '#E8E0C0'; ctx.lineWidth = 1;
  for (const e of [...crows, ...skeletons]) {
    if (!(e.heldTimer > 0)) continue;
    const ey = e.y + CONFIG.hudHeight;
    ctx.globalAlpha = 0.35 + 0.35 * Math.min(1, e.heldTimer);
    for (const o of [-5, 0, 5]) {
      ctx.beginPath(); ctx.moveTo(e.x - 8, ey + o); ctx.lineTo(e.x + 8, ey + o); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(e.x + o, ey - 8); ctx.lineTo(e.x + o, ey + 8); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawShockRings() {
  for (const r of shockRings) {
    const t = 1 - r.timer / r.total;            // 0 on cast, 1 as it dies
    const rad = r.radius * (0.35 + 0.65 * t);   // opens out to the real reach
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = r.color; ctx.lineWidth = 2;
    ctx.shadowColor = r.color; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(r.x, r.y + CONFIG.hudHeight, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
}

function updateParticles(dt) {
  if (particles.length > 120) particles.splice(0, particles.length - 120);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.gravity) p.vy += p.gravity * dt;
    if (p.damping) { p.vx *= (1 - p.damping * dt); p.vy *= (1 - p.damping * dt); }
    if (p.shrink && p.r > 0.1) p.r *= (1 - 0.4 * dt);
    p.alpha -= p.decay * dt;
    if (p.alpha <= 0) particles.splice(i, 1);
  }
}

function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.y += f.vy * dt; f.alpha -= dt * 2.2;
    if (f.alpha <= 0) floaters.splice(i, 1);
  }
}

// ── THE MAZE'S OBJECTIVE ──────────────────────────────────────────────────────
//
// A silver key opens a chest, the chest holds a golden key, the golden key
// opens the door, and the door is the level. Traversal rather than
// extermination, which is the whole reason the warden cannot be killed: if
// damage bought progress, the maze would be an arena with corners.

/**
 * The objective's entire state, or null on a map that has none.
 *
 * One nullable object rather than six loose flags: every consumer gets a
 * single guard, and generateMap has a single place to clear.
 */
let mazeRun = null;

/**
 * The maze's two keys.
 *
 * Same row shape as CONFIG.resources so drawHUD paints them with the
 * icon-per-unit loop it already runs for the quiver. They are not resources,
 * though: resetInv hands the player a full set of everything in that table,
 * and a key you start the level holding is not a key.
 */
const MAZE_KEYS = {
  silver: { color: '#D0D8E8', dim: '#2d2d2d', icon: '⚷', spacing: 13 },
  golden: { color: '#FFB400', dim: '#2d2d2d', icon: '⚷', spacing: 13 },
};

/**
 * What each lock wants, and what opening it buys.
 *
 * Two rows rather than an `if`: the chest and the door are one interaction,
 * and the only things that differ are the key it eats and the payoff. A third
 * lockable thing is a row, not an edit inside updateMazeObjective.
 */
const MAZE_LOCKS = {
  chest: {
    needs: 'silver',
    open: (x, y) => {
      mazeRun.held.golden = true;
      events.emit({ type: 'CHEST_OPENED', x, y });
    },
  },
  door: {
    needs: 'golden',
    open: (x, y) => {
      events.emit({ type: 'DOOR_OPENED', x, y });
      // The door is the way out of the maze, and out of the maze is the
      // bastion. It used to end the run; the siege is the campaign's last
      // stage now, so walking through here is a hand-off rather than a
      // curtain — the same shape the crow king's and the dark knight's
      // deaths already use.
      TALENTS.award('stage_cleared');
      startBastionStage();
    },
  },
};

/**
 * Places the chest and the door, once, on the grid that was just carved.
 *
 * openTileAwayFrom answers for one anchor at a time and both anchors matter
 * here, so the door is drawn first as the far end and the chest is re-rolled
 * until it clears the door as well as the spawn. The retry is bounded because
 * on a 33x21 grid the two constraints can fight, and an awkward layout beats
 * a hang.
 */
function newMazeRun() {
  const spawn = spawnPoint();
  const door = openTileAwayFrom(spawn.x, spawn.y, CONFIG.mazeDoorMinDistance) ?? spawn;
  let chest = openTileAwayFrom(spawn.x, spawn.y, CONFIG.mazeChestMinDistance) ?? spawn;
  const apart = CONFIG.mazeObjectiveSeparation ** 2;
  for (let tries = 0; tries < 12 && dist2(chest.x, chest.y, door.x, door.y) < apart; tries++) {
    chest = openTileAwayFrom(spawn.x, spawn.y, CONFIG.mazeChestMinDistance) ?? chest;
  }
  // Few, and scattered rather than placed: finding one has to feel like luck.
  const torches = [];
  for (let i = 0; i < CONFIG.mazeTorchCount; i++) {
    const at = openTileAwayFrom(spawn.x, spawn.y, CONFIG.mazeTorchMinDistance);
    if (at) torches.push({ x: at.x, y: at.y, lit: false, flamePhase: Math.random() * Math.PI * 2 });
  }
  return {
    locks: {
      chest: { x: chest.x, y: chest.y, opened: false },
      door:  { x: door.x,  y: door.y,  opened: false },
    },
    held: { silver: false, golden: false },
    drops: [],            // keys lying on the floor, waiting to be walked over
    torches,
    ratTimer: 0,          // counts down to the next pack, once the last is dead
    metMinotaur: false,   // his first charge or his first stun, whichever came first
    silverDropped: false, // one silver key exists, ever
  };
}

/**
 * Keeps a pack of rats in the maze.
 *
 * CONFIG.ratPackSize shipped with the rat and had no consumer: nothing put rats
 * on the map outside the dev harness, which left the silver key undroppable in
 * a real run.
 *
 * A pack at a time, and the next one only after the last is dead. Topping up
 * one rat at a time reads as fairer and plays far worse: the pack becomes a
 * permanent tax with no way to get ahead of it, and clearing a corridor stops
 * meaning anything. Killing all five buys real quiet, which is what makes them
 * worth shooting.
 */
function updateRatPack(dt) {
  if (skeletons.length > 0) { mazeRun.ratTimer = ratRespawnSecs(); return; }
  mazeRun.ratTimer -= dt;
  if (mazeRun.ratTimer > 0) return;
  mazeRun.ratTimer = ratRespawnSecs();
  const n = ratsPerPack();
  for (let i = 0; i < n; i++) spawnSkeleton('rat');
}

/**
 * Has the player lit anything yet?
 *
 * Derived from the torches rather than tracked beside them, so "the lights are
 * on" and "this torch is burning" can never disagree. The first one is the only
 * one that changes sight; the rest are landmarks.
 */
function torchIsLit() {
  return !!mazeRun && mazeRun.torches.some(t => t.lit);
}

/**
 * Strikes a torch, and holds a small patch of the maze open around it forever.
 *
 * Sight goes to three times the base and stays there for the run. A timer was
 * the alternative and it makes the level a stopwatch: a maze is a place you are
 * meant to search, and light that expires punishes searching. It would also
 * contradict the map, since the torch itself keeps burning either way.
 */
function lightTorch(t) {
  t.lit = true;
  const ts = CONFIG.tileSize, reach = CONFIG.torchGlowTiles;
  const c0 = Math.floor(t.x / ts), r0 = Math.floor(t.y / ts);
  for (let r = r0 - reach; r <= r0 + reach; r++)
    for (let c = c0 - reach; c <= c0 + reach; c++)
      if (r >= 0 && r < CONFIG.rows && c >= 0 && c < CONFIG.cols)
        torchTiles[r * CONFIG.cols + c] = 1;
  // The sight radius just changed, and FovMap only recomputes when the tracked
  // tile does. Without the invalidate the new reach waits for the next step the
  // player takes, which reads as the torch failing to light. The recompute has
  // to happen here too, not next frame: this runs after updateFOV, so leaving
  // the cache empty would render one fully black frame at the exact moment the
  // level is supposed to open up.
  fovMap.invalidate();
  seenFrom = -1;
  updateFOV();
  events.emit({ type: 'TORCH_LIT', x: t.x, y: t.y });
}

/**
 * The first time the warden does something to you.
 *
 * Committing to a charge and taking a stun both count, whichever lands first:
 * either way the player has met him, and meeting him is what turns the rats
 * from vermin into the way forward. Rolling for the key before that would let
 * a lucky opening kill hand over the chain before the level has said anything.
 */
function noteMinotaurEncounter() {
  if (mazeRun) mazeRun.metMinotaur = true;
}

/**
 * Rolls one dead rat for the silver key.
 *
 * Stops rolling the moment a key exists, so a player who walks past the one on
 * the floor does not farm a second. Only rats carry it: the castle's skeletons
 * share this death path and have nothing to do with the maze.
 */
function maybeDropSilverKey(s) {
  if (!mazeRun || s.kind !== 'rat') return;
  if (!mazeRun.metMinotaur || mazeRun.silverDropped) return;
  if (Math.random() >= CONFIG.mazeSilverKeyDropChance / mazePressure()) return;
  mazeRun.silverDropped = true;
  mazeRun.drops.push({ kind: 'silver', x: s.x, y: s.y, bobPhase: Math.random() * Math.PI * 2 });
  events.emit({ type: 'KEY_DROPPED', x: s.x, y: s.y, kind: 'silver' });
}

/**
 * Walk over a key to take it, walk into a lock to open it.
 *
 * No new keybind. The level's verb is traversal and pickups already teach that
 * touching a thing is how you use it, so reaching the door is the act of
 * leaving rather than a prompt in front of it. Distances reuse
 * CONFIG.pickupRadius, so a key collects at exactly the reach a quiver does.
 */
function updateMazeObjective(dt) {
  if (!mazeRun) return;
  updateRatPack(dt);
  const reach = CONFIG.pickupRadius ** 2;
  // Torches are the one thing here you choose rather than collect, so they are
  // the one thing on a button. Consumed on read, the way every other one-shot
  // key in stepGame is, so holding it down lights one torch and not a row.
  const use = !!keys[CONFIG.keys.use];
  if (use) keys[CONFIG.keys.use] = false;
  for (const t of mazeRun.torches) t.flamePhase += dt * 9;
  if (use) {
    // One press lights one torch, so two within arm's reach of each other stay
    // two decisions.
    const t = mazeRun.torches.find(t => !t.lit && dist2(player.x, player.y, t.x, t.y) < reach);
    if (t) lightTorch(t);
  }
  for (let i = mazeRun.drops.length - 1; i >= 0; i--) {
    const k = mazeRun.drops[i];
    k.bobPhase += dt * (2 * Math.PI / 0.6);
    if (dist2(player.x, player.y, k.x, k.y) >= reach) continue;
    mazeRun.held[k.kind] = true;
    events.emit({ type: 'KEY_TAKEN', x: k.x, y: k.y, kind: k.kind });
    mazeRun.drops.splice(i, 1);
  }
  for (const [name, lock] of Object.entries(MAZE_LOCKS)) {
    const at = mazeRun.locks[name];
    if (at.opened || !mazeRun.held[lock.needs]) continue;
    if (dist2(player.x, player.y, at.x, at.y) >= reach) continue;
    at.opened = true;
    lock.open(at.x, at.y);
  }
}

function checkPickupCollection() {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (dist2(player.x, player.y, p.x, p.y) >= CONFIG.pickupRadius*CONFIG.pickupRadius) continue;
    // Base ammo restore (archer and ranger — both run a countable quiver;
    // wizard/knight use different systems entirely)
    if (selectedChar === 'archer' || selectedChar === 'ranger' || selectedChar === 'sapper') {
      for (const [k, r] of Object.entries(CONFIG.resources))
        if (inv[k] < r.max) inv[k] = Math.min(r.max, inv[k] + r.restore);
    }
    // Type-specific bonus — effect differs by character
    if (p.type === 'ricochet') {
      if      (selectedChar === 'wizard') inv.laserStreams  += CONFIG.wizSpecialBoltCount;
      else if (selectedChar === 'knight') inv.knightJavelins += CONFIG.knightJavelinsPerPickup;
      // The sapper has nothing to bounce off a wall, so this slot buys the
      // other half of his elemental pair instead.
      else if (selectedChar === 'sapper') inv.iceBombs       += CONFIG.specialArrowPickupCount;
      else                                inv.ricochetArrows += CONFIG.specialArrowPickupCount;
    } else if (p.type === 'fire') {
      if      (selectedChar === 'wizard') inv.fireBolts          += CONFIG.wizSpecialBoltCount;
      else if (selectedChar === 'knight') inv.knightFireSwordTimer += CONFIG.knightFireSwordDuration;
      else if (selectedChar === 'sapper') inv.fireBombs            += CONFIG.specialArrowPickupCount;
      else                                inv.fireArrows           += CONFIG.specialArrowPickupCount;
    } else if (p.type === 'shield') {
      playerShield = true;
    }
    events.emit({ type: 'PICKUP_TAKEN', x: p.x, y: p.y, kind: p.type });
    pickups.splice(i, 1);
  }
}

function updateEscalation(dt) {
  escalationTimer += dt;
  if (waveAnnounce > 0) waveAnnounce -= dt;
  // A mode that runs the castle gauntlet drives that stage from
  // startCastleWave — see killSkeleton — so this timer must keep its hands
  // off it. Only waveAnnounce still counts down here, so a castle-wave banner
  // fades on schedule. The gate is on the *mode*, not on the map alone: keyed
  // on `mapKind === 'castle'` by itself, picking Castle on the mapselect
  // screen returned here every tick and the run never spawned another crow
  // past the opening batch. runsCastleGauntlet is that lesson kept as one
  // field, read here and in killSkeleton so the pair cannot drift apart.
  if (modeRule(gameMode).runsCastleGauntlet && mapKind === 'castle') return;
  // The maze's population is scripted: its rat pack and its warden are placed
  // by the stage, not by this timer. See MAP_RULES.population.
  if (!mapHasCrows() && !mapHasSoldiers()) return;
  if (escalationTimer < CONFIG.crowEscalationInterval) return;

  escalationTimer -= CONFIG.crowEscalationInterval;
  wave++;
  if (modeRule(gameMode).announcesWaves) { waveAnnounce = 2.2; waveAnnounceText = `── WAVE ${wave} ──`; }

  // What a wave is made of is the map's business, not this timer's. Crows
  // trickle in one at a time under a cap; a garrison arrives as a composed
  // wave from sim/soldiers.ts, and at COMMANDER_WAVE it arrives behind its
  // commander instead.
  if (mapHasCrows()) {
    if (crows.length < CONFIG.crowMax) spawnCrow();
    return;
  }
  if (wave >= COMMANDER_WAVE && !boss && appState === 'playing') {
    // spawnBoss and the entrance banner both read bossStage to decide who is
    // arriving, so it has to say the commander before either runs.
    bossStage = 5;
    transitionTo('boss_entrance');
    return;
  }
  spawnSoldierWave(wave);
}

// ── DAMAGE / BOSS ─────────────────────────────────────────────────────────────

/** Half speed while venom is in you, full speed otherwise. */
function poisonSpeedMult() {
  return playerPoison.timer > 0 ? CONFIG.ratPoisonSlowMult : 1;
}

/**
 * Applies a fresh bite's venom. Refreshes to full rather than stacking, so a
 * swarm is dangerous through the slow it keeps renewing rather than through
 * an unbounded damage total.
 */
function poisonPlayer() {
  const first = playerPoison.timer <= 0;
  playerPoison.timer = CONFIG.ratPoisonSecs;
  if (first) playerPoison.tickIn = CONFIG.ratPoisonTickSecs;
  events.emit({ type: 'PLAYER_POISONED', x: player.x, y: player.y });
}

/**
 * Counts the venom down and bites once a second while it lasts.
 *
 * Damage goes straight to playerHP rather than through damagePlayer, because
 * that gate refuses anything while playerHitFlash is up: routed through it,
 * every tick would be swallowed by the invulnerability from the bite that
 * applied the poison in the first place. A shield does not stop it either.
 * Venom is already inside you.
 */
function updatePlayerPoison(dt) {
  if (playerPoison.timer <= 0) return;
  playerPoison.timer = Math.max(0, playerPoison.timer - dt);
  playerPoison.tickIn -= dt;
  if (playerPoison.tickIn > 0) return;
  playerPoison.tickIn += CONFIG.ratPoisonTickSecs;
  playerHP -= CONFIG.ratPoisonDamagePerTick;
  events.emit({ type: 'PLAYER_POISON_TICK', x: player.x, y: player.y });
  if (playerHP <= 0) { playerHP = 0; transitionTo('gameover'); }
}

function damagePlayer(amount, crowIndex = -1) {
  // Team gate: an attacker never hurts its own team. In single-player the
  // source is always an enemy, so this passes; it enforces the rule once
  // co-op puts two players on team A.
  const attacker = crowIndex >= 0 && crowIndex < crows.length ? crows[crowIndex].team : Team.ENEMY;
  if (!canDamage(attacker, player.team)) return;
  if (playerHitFlash > 0) return;
  // Winding up the charge is the knight's whole defence for those seconds: he
  // cannot move or attack, so he eats nothing. The dash afterwards is exposed.
  if (knightCharge.on) return;
  // And the moment after a blink is the wizard's, for the same reason: an
  // escape that still eats the hit it escaped is not an escape.
  if (wizBlinkIFrame > 0) return;
  // Slipstream: at a full meter she is running through them, not into them.
  if (rangerSlip > 0) return;
  if (playerShield) {
    playerShield = false;
    playerHitFlash = CONFIG.playerHitFlashSecs;
    events.emit({ type: 'SHIELD_BLOCKED', x: player.x, y: player.y });
    // BULWARK: the guard comes straight back and a Bloodlust stack pays for
    // it. With no stack left there is nothing to spend and it recharges the
    // way it always did, so the rite cannot hold a guard up forever -- and it
    // argues with BERSERKER, whose whole job is keeping those stacks. Picking
    // one of the two is picking what the stacks are FOR.
    if (TALENTS.capstoneActive('bulwark') && knightBloodlust > 0) {
      knightBloodlust -= 1;
      playerShield = true;
      events.emit({ type: 'KNIGHT_BLOODLUST', stacks: knightBloodlust, x: player.x, y: player.y });
    }
    // Shield kills non-boss attackers
    if (crowIndex >= 0 && crowIndex < crows.length) killCrow(crowIndex);
    return;
  }
  playerHP -= amount; playerHitFlash = CONFIG.playerHitFlashSecs;
  events.emit({ type: 'PLAYER_HIT' });
  STREAK.onDamage();
  if (playerHP <= 0) { playerHP = 0; transitionTo('gameover'); }
}

function updateBossEntrance(dt) {
  const e = entrance; e.timer += dt; const t = e.timer;
  if (!e.flash1) { e.flash1 = true; events.emit({ type: 'BOSS_ENTRANCE_FLASH' }); }
  if (!e.flash2 && t >= 0.08) { e.flash2 = true; events.emit({ type: 'BOSS_ENTRANCE_FLASH' }); }
  if (t >= 0.2 && !e.fadeOut) e.overlayAlpha = Math.min(0.8, e.overlayAlpha + dt * 5);
  if (t >= 0.3) {
    const BOSS_TEXT = BOSS_ENTRY_TEXT[bossStage];
    e.textProgress = Math.min(BOSS_TEXT.length, (t - 0.3) * 30);
  }
  if (!e.screchPlayed && t >= 1.3) { e.screchPlayed = true; events.emit({ type: 'BOSS_SCREECH' }); }
  // Burn every tree to ash — clears the arena for the boss fight
  if (!e.treesBurned && t >= 0.8) {
    e.treesBurned = true;
    for (let r = 0; r < CONFIG.rows; r++)
      for (let c = 0; c < CONFIG.cols; c++)
        if (tileMap.get(r, c) === TILE.TREE) tileMap.set(r, c, TILE.ASH);
    // A few dramatic fire bursts across the arena
    for (let k = 0; k < 8; k++) {
      const bx = (2 + Math.random()*(CONFIG.cols-4)) * CONFIG.tileSize;
      const by = (1 + Math.random()*(CONFIG.rows-2)) * CONFIG.tileSize;
      events.emit({ type: 'BOSS_ENTRANCE_FIRE', x: bx, y: by });
    }
  }
  if (!e.crowsWhite && t >= 1.8) {
    e.crowsWhite = true;
    for (const c of crows) { c.white = true; c.state = 'passive'; c.aggroTimer = 0; }
  }
  if (!e.bossMoved && t >= 1.8) { e.bossMoved = true; spawnBoss(); }
  if (boss && boss.bstate === 'entering') {
    const targetX = CONFIG.canvasW * 0.75;
    boss.x = Math.max(targetX, boss.x - 300 * dt);
  }
  if (t >= 2.3) { e.fadeOut = true; e.overlayAlpha = Math.max(0, e.overlayAlpha - dt * 5); }
  if (t >= 2.5) { if (boss) enterOrbit(); transitionTo('boss_fight'); }
}

// Stage order for brawl mode's full run. Index 0 is always the forest fight;
// 1 and 2 are the castle stage's two dark bosses, fought in sequence.
// Stage 5 is not part of the brawl chain at all. The commander is the cavern's
// own ending, reached from Waves mode when its wave counter hits
// COMMANDER_WAVE, and bossStage is set to 5 there purely because spawnBoss and
// the entrance both read the stage to decide who is arriving.
const BOSS_STAGES = ['crowking', 'dark_archer', 'dark_knight', 'minotaur', 'commander'];

/**
 * What a landed hit does, per boss.
 *
 * The three arena bosses share one contract: they have HP, damage lowers it,
 * zero kills them. The minotaur shares none of it, so this is not a fourth
 * branch inside that contract, it is a second contract. Same Record<kind, fn>
 * shape as BOSS_HIT_FX above rather than an `if` inside damageBoss.
 */
/**
 * Which bosses exist outside a boss fight.
 *
 * The three arena bosses are only ever alive inside `boss_fight`, after an
 * entrance that burns the arena clear for them, so nothing has to update them
 * while the player explores. The minotaur is not fought, he is escaped: he
 * hunts through the whole level, which means updateBoss now runs in `playing`
 * too. One row per kind rather than an `if (boss.kind === 'minotaur')` at the
 * call site, so a fifth boss has to answer the question instead of inheriting
 * whichever answer the branch happened to give it.
 */
/**
 * How hard the maze pushes each character, as one multiplier.
 *
 * The level is last, so it is allowed to be hard, but the difficulty it landed
 * on was the wrong shape: the knight cleared it most easily because melee
 * shreds a rat pack, and the two characters the level was supposed to test
 * hardest were the ones dying in the hunt. This is the ordering it should
 * have, easiest first: ranger, archer, wizard, knight.
 *
 * One scalar rather than four tables. Everything the maze uses to apply
 * pressure moves together, so a row here is a single decision about a
 * character and not four that have to be kept consistent with each other.
 * Above 1 is harder than the level shipped, below 1 is easier.
 *
 * These are a starting point, not a measurement. Tune them by playing.
 */
const MAZE_PRESSURE = {
  ranger: 0.70,   // three bolts a press already answers a pack; give it room
  archer: 0.90,
  wizard: 1.10,   // a 2 s bolt against five rats is the level's real test
  knight: 1.35,   // melee is strongest here, so the maze leans hardest on him
};

/** The pressure for whoever is playing. 1 outside the maze, so nothing else moves. */
function mazePressure() {
  if (!mazeRun) return 1;
  return MAZE_PRESSURE[selectedChar] ?? 1;
}

/** Rats per pack, never fewer than two: one rat is not a pack. */
function ratsPerPack() {
  return Math.max(2, Math.round(CONFIG.ratPackSize * mazePressure()));
}

/** Quiet between packs. More pressure buys less of it. */
function ratRespawnSecs() {
  return CONFIG.ratRespawnSecs / mazePressure();
}

const BOSS_HUNTS_WHILE_EXPLORING = {
  crowking: false, dark_archer: false, dark_knight: false, minotaur: true,
  // He arrives behind an entrance like the three above him, so exploration
  // never has him walking around in it. The row exists because a missing one
  // reads as false rather than as a mistake, which is how it shipped.
  commander: false,
};

/**
 * Is the boss a live target for a weapon right now?
 *
 * Every attack used to ask `appState === 'boss_fight'`, which was the same
 * question while a boss only existed inside its own fight. It stopped being
 * the same question the moment the warden started hunting during exploration:
 * he was on screen, hitting the player, and immune to everything, so the stun
 * a hit is meant to buy could never happen and the level had no counterplay at
 * all. Same fact as BOSS_HUNTS_WHILE_EXPLORING, read from the weapon's end.
 */
function bossInPlay() {
  if (!boss || boss.bstate === 'dead') return false;
  if (appState === 'boss_fight') return true;
  // A siege boss is on the field during ordinary play with no entrance and no
  // boss_fight state around it, so it has to be a live target the same way the
  // warden is. Without this it walks about being immune, which is the same
  // no-counterplay bug the warden's own row was added to fix.
  if (appState === 'playing' && siegeRun) return true;
  return appState === 'playing' && BOSS_HUNTS_WHILE_EXPLORING[boss.kind];
}

const BOSS_ON_HIT = {
  crowking:    (amount) => { dazeBoss(); applyBossDamage(amount); },
  dark_archer: (amount) => applyBossDamage(amount),
  dark_knight: (amount) => applyBossDamage(amount),
  // In the maze he has no death path to reach, so a hit buys time instead: it
  // stuns him, which interrupts a charge and lets you get down the corridor.
  // In a siege he is one enemy inside wave ten and the wave cannot clear until
  // he is dead, so there the same hit also has to land. He keeps the stun in
  // both, since that is what makes him read as himself.
  minotaur:    (amount) => { stunMinotaur(); if (siegeRun) applyBossDamage(amount); },
  // Nothing special, like the two dark bosses: no shield to time and no daze.
  commander:   (amount) => applyBossDamage(amount),
};

// Which CONFIG key holds a kind's health. One key, not one per character:
// each of these rows used to be a [normal, wizard, knight] tuple read by a
// ternary on two named heroes, which meant twelve hand-tuned numbers, no
// compiler check that a hero had a column, and a sapper silently taking the
// base pool because he is neither of the two the ternary names.
const BOSS_HP_KEY = {
  crowking:    'bossHP',
  dark_archer: 'darkArcherHP',
  dark_knight: 'darkKnightHP',
  commander:   'commanderHP',
  // The keeper has a pool now, read only in a siege — see bossHpFor.
  minotaur:    'keeperHP',
};

function bossHpFor(kind) {
  // The keeper cannot be killed IN THE MAZE. That is the maze's rule — he is
  // the level's pressure, not its objective — and Infinity rather than a
  // sentinel keeps every `hp -= x` and `hp <= 0` in the file honest without any
  // of them learning that an unkillable boss exists.
  //
  // A siege is the other case. Wave ten fields him as one enemy inside a wave,
  // and the wave cannot clear until every boss in it is dead, so with no pool
  // the last wave of the bastion could not be won by fighting it. The ten-wave
  // test missed it because that harness kills through startBossDeath, which
  // never consults hp.
  if (kind === 'minotaur' && !siegeRun) return Infinity;
  return CONFIG[BOSS_HP_KEY[kind]];
}

/**
 * Refuses to load with a boss the tables above do not cover.
 *
 * They are Records in shape and plain objects in fact, so a stage added
 * without a row in each is not a compile error, it is `undefined` at the call
 * site — and the three call sites fail three different ways. A missing
 * BOSS_ON_HIT row throws TypeError on the first hit that lands. A missing
 * BOSS_HUNTS_WHILE_EXPLORING row reads as false, which is a decision nobody
 * took. A missing BOSS_HP_KEY row spawns a boss on `undefined` health.
 *
 * The commander shipped missing two of the three, which made the cavern's
 * ending crash on the first arrow rather than fail to build.
 */
for (const kind of BOSS_STAGES) {
  if (typeof BOSS_ON_HIT[kind] !== 'function')
    throw new Error(`BOSS_ON_HIT has no row for '${kind}', which BOSS_STAGES lists`);
  if (typeof BOSS_HUNTS_WHILE_EXPLORING[kind] !== 'boolean')
    throw new Error(`BOSS_HUNTS_WHILE_EXPLORING has no row for '${kind}', which BOSS_STAGES lists`);
  if (!BOSS_HP_KEY[kind])
    throw new Error(`BOSS_HP_KEY has no row for '${kind}', which BOSS_STAGES lists`);
}

function spawnBoss() {
  const kind = BOSS_STAGES[bossStage - 1];
  const hpMax = bossHpFor(kind);
  const common = {
    kind,
    x: CONFIG.canvasW + 40, y: (CONFIG.rows / 2) * CONFIG.tileSize,
    hp: hpMax, hpMax,
    bstate: 'entering', stateTimer: 0,
    orbitAngle: 0, orbitRadius: CONFIG.bossOrbitRadius, chargeTarget: null,
    wingPhase: 0, hitFlash: 0, facing: 1,
    knockX: 0, knockY: 0,           // decaying shove offset from weapon hits
    burnTimer: 0, emberTimer: 0,    // fire-arrow burn: slows him and drains HP
    burnDps: 0,                     // damage per second for the burn now running
    dazeTimer: 0,                   // crow king only: stun then two-step slow, see dazeBoss
    netHold: 0,                     // HOLDFAST: how long the net still has him
  };
  if (kind === 'minotaur') {
    // Starts far from the player rather than off the right edge: a maze has no
    // open lane to walk in along, and openTileAwayFrom is already the answer
    // to "somewhere over there" on a carved map.
    const at = openTileAwayFrom(player.x, player.y, 320) ?? { x: common.x, y: common.y };
    boss = {
      ...common,
      x: at.x, y: at.y,
      bstate: 'prowl',
      chargeDX: 0, chargeDY: 0,     // locked at windup, not re-aimed mid-charge
      chargeTimer: 0, cooldown: 0,
      path: null, pathTimer: 0,     // prowls on the shared A* scheduler
      state: 'aggro',               // what pathScheduler.serve() looks for
    };
    return;
  }
  if (kind === 'commander') {
    // Placed out in the map like the minotaur, and for the same reason: a
    // cavern has no open lane down the right to ride in along, so the
    // entrance's walk-in-from-the-edge does not apply to him.
    const at = openTileAwayFrom(player.x, player.y, 320) ?? { x: common.x, y: common.y };
    boss = {
      ...common,
      x: at.x, y: at.y,
      bstate: 'ride',
      shield: false,
      charge: 0, chargeAngle: 0,
      // The opening charge waits out the same floor every later one does, so
      // the fight starts with him closing rather than already on top of you.
      chargeCD: CONFIG.commanderChargeMinGap,
      path: null, pathTimer: 0,   // rides on the shared A* scheduler
      state: 'aggro',             // what pathScheduler.serve() looks for
    };
    return;
  }
  if (kind === 'crowking') {
    boss = {
      ...common,
      screchCD: CONFIG.bossScreechInterval, batCD: CONFIG.bossBatCD,
      // Shield state machine — crow king only, see updateBoss.
      shield: true,
      shieldPhase: 'initial',           // 'initial' | 'open' | 'shielded'
      shieldTimer: CONFIG.bossShieldInitialDuration,
      shieldCount: 0,                   // random re-shields used this window
      shieldWindowTimer: CONFIG.bossShieldWindowDuration,
    };
    return;
  }
  // Dark bosses skip the shield window entirely — shield stays permanently
  // down, so every hit lands the instant the entrance ends. Each also carries
  // its own secondary-attack cooldown and a skeleton-summon cooldown; see
  // updateBoss for how they fire.
  if (kind === 'dark_archer') {
    boss = {
      ...common, shield: false,
      volleyCD: CONFIG.darkArcherVolleyInterval,
      bombCD: CONFIG.darkArcherBombInterval,
      skeletonCD: CONFIG.darkArcherSkeletonInterval,
    };
  } else {
    boss = {
      ...common, shield: false,
      whirlwindCD: CONFIG.darkKnightWhirlwindInterval, whirlwindTick: 0,
      skeletonCD: CONFIG.darkKnightSkeletonInterval,
    };
  }
}

/**
 * The one place boss HP is lowered, so the death trigger has a single home,
 * and therefore the one place a character's damage multiplier is applied.
 * Every weapon reaches here through damageBoss; burn reaches it directly,
 * having no impact point and so no flash, no shove and no hit sound.
 *
 * Scaling here rather than at each weapon is what makes a new weapon scaled
 * by having damage at all. It is also why the burn is not counted twice:
 * igniteBoss derives burnDps from the raw damage of the hit that lit it, and
 * that raw figure passes through here once per tick like any other.
 */
function applyBossDamage(amount) {
  boss.hp -= amount * CHARACTER_STATS[selectedChar].bossDamageMult;
  if (boss.hp <= 0) startBossDeath();
}

/** Shoves the boss away from (fromX, fromY). Shared by real hits and
 * shielded blocks, so a shield still gives real physical feedback even
 * though it takes no damage. Decayed and actually applied to boss.x/y in
 * applyBossKnockback, every frame, not here. */
function knockBoss(fromX, fromY) {
  const dx = boss.x - fromX, dy = boss.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  boss.knockX += (dx / d) * CONFIG.bossKnockback;
  boss.knockY += (dy / d) * CONFIG.bossKnockback;
}

/**
 * Applies damage to the boss and shoves him away from the hit. Every weapon
 * routes through here, so hit flash, the BOSS_HIT event, and knockback stay in
 * one place.
 *
 * Callers do their own hit detection and shield check first, so a shielded
 * boss still swallows nothing and projectiles behave as before.
 */
/**
 * What a hit is worth to something the net is holding.
 *
 * HOLDFAST turns the net from a hold into a window, and the boss, the garrison
 * and the skeletons all have to agree about how wide that window is. One home:
 * three copies of `held > 0 ? 2 : 1` is three chances to disagree about what
 * caught means.
 */
function netHoldMult(held) {
  return held > 0 && TALENTS.capstoneActive('holdfast') ? CONFIG.rangerHoldfastMult : 1;
}

function damageBoss(amount, fromX, fromY, source, flash = 0.15) {
  boss.hitFlash = flash;
  knockBoss(fromX, fromY);
  events.emit({ type: 'BOSS_HIT', source });
  BOSS_ON_HIT[boss.kind](amount * netHoldMult(boss.netHold || 0));
}

/** Outcome of one projectile reaching the boss. */
const BossHit = {
  MISS:      'miss',      // nothing touched, keep flying
  REFLECTED: 'reflected', // bounced off on a new heading, keep it alive
  ABSORBED:  'absorbed',  // the shield stopped it, remove the projectile
  DAMAGED:   'damaged',   // it landed, remove the projectile
};

/**
 * Resolves one projectile against the boss. Every projectile type routes
 * through here, so shield behaviour, ricochet reflection, fire, and damage
 * stay in one place instead of being repeated per weapon.
 *
 * The caller owns the projectile array, so this never splices. It reports what
 * happened and the caller removes the projectile on ABSORBED or DAMAGED.
 */
function resolveBossHit(a, damage, source) {
  if (!bossInPlay()) return BossHit.MISS;
  if (dist2(a.x, a.y, boss.x, boss.y) >= CONFIG.bossHitRadius * CONFIG.bossHitRadius)
    return BossHit.MISS;

  // Read once, before the damage below can start the death sequence
  const blocked = boss.shield;

  if (blocked) {
    knockBoss(a.x, a.y);
    events.emit({ type: 'BOSS_SHIELD_BLOCKED', x: a.x, y: a.y });
  } else {
    if (a.type === 'fire') igniteBoss(damage);
    // Before the bounce, so knockback is measured from the real impact point
    damageBoss(damage, a.x, a.y, source);
  }

  // Ricochet arrows bounce off the boss and off his shield, as they do off rock
  if (a.type === 'ricochet') { reflectOffBoss(a); return BossHit.REFLECTED; }
  return blocked ? BossHit.ABSORBED : BossHit.DAMAGED;
}

/**
 * Mirrors a ricochet arrow about the boss's surface normal, which is the same
 * bounce a circle gives in any direction, then lifts it clear of the hit circle
 * so the next frame does not read a second collision.
 */
function reflectOffBoss(a) {
  const dx = a.x - boss.x, dy = a.y - boss.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  const dot = a.vx * nx + a.vy * ny;
  a.vx -= 2 * dot * nx;
  a.vy -= 2 * dot * ny;
  a.x = boss.x + nx * (CONFIG.bossHitRadius + 2);
  a.y = boss.y + ny * (CONFIG.bossHitRadius + 2);
  a.bounces++;
  // Same speed gain a wall bounce gives, so boss bounces are not a dead end
  const curSpd = Math.hypot(a.vx, a.vy) || 1;
  const maxSpd = (a.initSpeed || CONFIG.arrowSpeed) * 5;
  const s = Math.min(1.55, maxSpd / curSpd);
  a.vx *= s; a.vy *= s;
  a.life = Math.max(a.life, CONFIG.arrowLifetime * 0.8);
}

/**
 * Sets the boss alight. The burn deals bossBurnDamage of the igniting hit again
 * over its full duration, so a fire arrow costs him half a point more than a
 * plain one. A second fire arrow refreshes the burn rather than stacking it.
 */
function igniteBoss(damage) {
  boss.burnTimer = CONFIG.bossBurnDuration;
  boss.burnDps = damage * CONFIG.bossBurnDamage / CONFIG.bossBurnDuration;
}

/** Speed multiplier for boss movement. Burning and dazed-recovery both slow
 * him and stack multiplicatively; full stun is gated separately in
 * updateBoss (an action freeze, not just a movement slowdown). */
function bossSpeedMod() {
  const burnMod = boss.burnTimer > 0 ? 1 - CONFIG.bossBurnSlowdown : 1;
  const phase = bossDazePhase();
  const dazeMod = phase === 'slow1' ? CONFIG.bossDazeSlow1Speed
                : phase === 'slow2' ? CONFIG.bossDazeSlow2Speed
                : 1;
  return burnMod * dazeMod;
}

/** Total length of one daze: the stun plus both recovery steps. */
function bossDazeTotal() {
  return dazeTimerForStun(CONFIG.bossDazeStunDuration);
}

/**
 * Where the one daze countdown has to start for `secs` of full stun.
 *
 * bossDazePhase reads the timer as a position inside stun, then slow1, then
 * slow2, counting down. So "stun him for 1.5 seconds" is not `dazeTimer = 1.5`:
 * that lands inside slow2 and freezes nothing. Anyone setting the timer by
 * hand needs this conversion, which is exactly why it has a name.
 */
function dazeTimerForStun(secs) {
  return secs + CONFIG.bossDazeSlow1Duration + CONFIG.bossDazeSlow2Duration;
}

/** 'stun' | 'slow1' | 'slow2' | null, derived from the one countdown so
 * movement, the speed multiplier, and the visual all read the same source. */
function bossDazePhase() {
  const t = boss.dazeTimer;
  if (t <= 0) return null;
  if (t > CONFIG.bossDazeSlow1Duration + CONFIG.bossDazeSlow2Duration) return 'stun';
  if (t > CONFIG.bossDazeSlow2Duration) return 'slow1';
  return 'slow2';
}

/** Landing a real hit refreshes the daze to its full length, stun included
 * — chaining hits during an open window keeps him dazed continuously. */
function dazeBoss() { boss.dazeTimer = bossDazeTotal(); }

function updateBossDaze(dt) {
  if (boss.dazeTimer > 0) boss.dazeTimer = Math.max(0, boss.dazeTimer - dt);
  if (boss.netHold > 0) boss.netHold = Math.max(0, boss.netHold - dt);
}

/** Counts the burn down, drains HP with it, and puffs embers while it lasts. */
function updateBossBurn(dt) {
  if (boss.burnTimer <= 0) return;
  // Clamped to what is left, so the burn deals its exact total and no more
  const tick = Math.min(dt, boss.burnTimer);
  boss.burnTimer -= tick;
  boss.emberTimer -= tick;
  if (boss.emberTimer <= 0) {
    boss.emberTimer = CONFIG.bossBurnEmberInterval;
    events.emit({ type: 'BOSS_BURNING', x: boss.x, y: boss.y });
  }
  applyBossDamage(boss.burnDps * tick);
}

/**
 * Adds the knockback offset on top of whatever the state machine decided, then
 * decays it. It has to be applied after positioning: the orbit state assigns
 * boss.x and boss.y outright, so a shove written straight to those is gone on
 * the next frame.
 */
function applyBossKnockback(dt) {
  if (boss.knockX === 0 && boss.knockY === 0) return;
  const r = CONFIG.bossRadius;
  boss.x = Math.max(r, Math.min(CONFIG.canvasW - r, boss.x + boss.knockX));
  boss.y = Math.max(r, Math.min(CONFIG.rows * CONFIG.tileSize - r, boss.y + boss.knockY));
  const decay = Math.exp(-dt / CONFIG.bossKnockbackDecay);
  boss.knockX *= decay;
  boss.knockY *= decay;
  if (Math.hypot(boss.knockX, boss.knockY) < 0.5) { boss.knockX = 0; boss.knockY = 0; }
}

/**
 * Puts the boss into orbit starting from wherever it actually is right now,
 * instead of onto the orbit circle at whatever stale angle and radius were
 * left over from before the interruption. Every return to 'orbit' — charge
 * ending, screech ending, whirlwind ending, the entrance handing off to the
 * fight — routes through here. orbitRadius then eases toward bossOrbitRadius
 * in updateBoss's orbit branch rather than snapping to it, so the boss glides
 * back out instead of popping 150+px in one frame. This is what "teleporting"
 * was: orbit always computed position from the fixed bossOrbitRadius, so
 * re-entering it after being close to the player (mid-charge, mid-whirlwind)
 * always snapped straight back out to the full radius.
 */
function enterOrbit() {
  boss.bstate = 'orbit'; boss.stateTimer = 0; boss.chargeTarget = null;
  boss.orbitAngle = Math.atan2(boss.y - player.y, boss.x - player.x);
  boss.orbitRadius = Math.hypot(boss.x - player.x, boss.y - player.y);
}

/**
 * Line of sight from the warden's own eyes, capped by his own range.
 *
 * This used to read the player's FOV cache and lean on shadowcasting being
 * symmetric. Fog of war ended that: the player now sees four tiles and he sees
 * sixteen, so borrowing the player's answer would mean he could only ever
 * charge from inside the lit circle, and the whole point of him is arriving out
 * of the dark. See lineOfSight.
 */
function minotaurSeesPlayer() {
  return seesPlayerFrom(boss.x, boss.y, CONFIG.minotaurSightRange);
}

/**
 * What a hit on the minotaur buys: a stun that interrupts whatever he was
 * doing and puts his charge back on cooldown.
 *
 * Reuses the crow king's daze countdown wholesale rather than adding a second
 * stun concept — bossDazePhase() already derives stun/slow/slow from it, and
 * updateBossDaze already ticks it.
 */
function stunMinotaur() {
  noteMinotaurEncounter();
  boss.dazeTimer = Math.max(boss.dazeTimer, dazeTimerForStun(CONFIG.minotaurStunSecs));
  if (boss.bstate === 'charge' || boss.bstate === 'wind') endMinotaurCharge(false);
  boss.cooldown = Math.max(boss.cooldown, CONFIG.minotaurChargeCooldown / mazePressure());
}

/** Drops him out of a charge into recovery, smashing the wall if he hit one. */
function endMinotaurCharge(hitWall) {
  if (hitWall) {
    // smashTile is a no-op on a map whose terrain is not destructible, so on
    // the maze this is pure spectacle: he slams into stone, staggers, and
    // showers chips, but the wall holds. That is deliberate — a warden who
    // opens the maze as he chases you dismantles the level he is guarding.
    const r0 = Math.floor(boss.y / CONFIG.tileSize), c0 = Math.floor(boss.x / CONFIG.tileSize);
    const reach = CONFIG.minotaurSmashRadius;
    for (let dr = -reach; dr <= reach; dr++)
      for (let dc = -reach; dc <= reach; dc++) smashTile(r0 + dr, c0 + dc);
    triggerShake(9, 260);
    events.emit({ type: 'MINOTAUR_SMASH', x: boss.x, y: boss.y });
  }
  boss.bstate = 'recover';
  boss.stateTimer = 0;
  boss.cooldown = CONFIG.minotaurChargeCooldown / mazePressure();
}

/**
 * Prowl, charge on sight, recover. No shield, no HP, no death.
 *
 * Prowling reuses chaseAlongPath, the same A* follow crows, skeletons and rats
 * use, so he navigates a maze without knowing one exists. Only the charge
 * ignores the path: it commits to a direction locked at windup and runs in a
 * straight line until something stops it, which is what makes a corridor feel
 * like a corridor.
 */
function updateMinotaur(dt) {
  boss.stateTimer += dt;
  if (boss.cooldown > 0) boss.cooldown = Math.max(0, boss.cooldown - dt);

  // A stun freezes him wherever he is, mid-charge included.
  if (bossDazePhase() === 'stun') return;

  const contactR = CONFIG.minotaurContactRadius;
  const touching = Math.hypot(player.x - boss.x, player.y - boss.y) < contactR;

  if (boss.bstate === 'prowl') {
    if (touching) damagePlayer(CONFIG.minotaurContactDamage);
    if (chaseAlongPath(boss, CONFIG.minotaurProwlSpeed * bossSpeedMod(), dt)) boss.wingPhase += dt * 6;
    if (boss.cooldown <= 0 && minotaurSeesPlayer()) {
      boss.bstate = 'wind'; boss.stateTimer = 0;
      events.emit({ type: 'MINOTAUR_ROAR', x: boss.x, y: boss.y });
    }
    return;
  }

  if (boss.bstate === 'wind') {
    // Plants and telegraphs. Aim keeps tracking until the moment he launches,
    // so the tell is honest: what he is facing at the end is where he goes.
    const a = Math.atan2(player.y - boss.y, player.x - boss.x);
    boss.chargeDX = Math.cos(a); boss.chargeDY = Math.sin(a);
    if (touching) damagePlayer(CONFIG.minotaurContactDamage);
    if (boss.stateTimer >= CONFIG.minotaurWindupSecs) {
      boss.bstate = 'charge'; boss.stateTimer = 0; boss.chargeTimer = 0;
      boss.path = null;
      noteMinotaurEncounter();
      events.emit({ type: 'MINOTAUR_CHARGE', x: boss.x, y: boss.y });
    }
    return;
  }

  if (boss.bstate === 'charge') {
    if (touching) damagePlayer(CONFIG.minotaurChargeContactDamage);
    const spd = CONFIG.minotaurChargeSpeed * bossSpeedMod();
    const nx = boss.x + boss.chargeDX * spd * dt;
    const ny = boss.y + boss.chargeDY * spd * dt;
    // Axis-separated so a glancing wall stops him on the axis that hit it.
    const blockedX = !tilePassable(tileAt(nx, boss.y));
    const blockedY = !tilePassable(tileAt(boss.x, ny));
    if (blockedX || blockedY) { endMinotaurCharge(true); return; }
    boss.x = nx; boss.y = ny;
    boss.wingPhase += dt * 14;
    if (boss.stateTimer >= CONFIG.minotaurChargeMaxSecs) endMinotaurCharge(false);
    return;
  }

  // recover
  if (touching) damagePlayer(CONFIG.minotaurContactDamage);
  if (boss.stateTimer >= CONFIG.minotaurRecoverSecs) { boss.bstate = 'prowl'; boss.stateTimer = 0; }
}

function updateBoss(dt) {
  if (!boss || boss.bstate === 'dead') return;
  boss.wingPhase += dt * 8;
  // The burn is the only thing that can kill him from inside this function, so
  // the rest of the frame is skipped rather than run against a dead boss.
  updateBossBurn(dt);
  if (boss.bstate === 'dead') return;
  if (boss.hitFlash > 0) boss.hitFlash = Math.max(0, boss.hitFlash - dt);
  // Update facing toward player
  boss.facing = player.x > boss.x ? -1 : 1;

  // The instant the stun itself ends (not the slower recovery after it),
  // re-anchor the orbit from wherever he actually is. Without this, a player
  // who moved during that full second would make the orbit's stale
  // angle/radius snap him back the next frame — the same teleport-looking
  // bug enterOrbit() already fixes for charge/whirlwind returns. justResumed
  // also holds movement off for this exact frame: applying it right after
  // enterOrbit() would let orbitRadius's own easing decay run against the
  // freshly re-anchored radius before the next frame ever reads it, which
  // is a second, smaller version of the same snap.
  const wasStunned = bossDazePhase() === 'stun';
  updateBossDaze(dt);
  const justResumed = wasStunned && bossDazePhase() !== 'stun';
  if (justResumed && boss.bstate === 'orbit') enterOrbit();

  // The minotaur shares the frame preamble above (burn, flash, facing, daze)
  // and none of what follows: no shield window, no orbit, no volleys.
  if (boss.kind === 'minotaur') { updateMinotaur(dt); return; }
  if (boss.kind === 'commander') { updateCommander(dt); return; }

  // ── Shield phase machine — crow king only ────────────────────────────────
  // Rolling 30s window: reset shield-use counter each window
  if (boss.kind === 'crowking') {
    boss.shieldWindowTimer -= dt;
    if (boss.shieldWindowTimer <= 0) {
      boss.shieldWindowTimer = CONFIG.bossShieldWindowDuration;
      boss.shieldCount = 0;
    }
    boss.shieldTimer -= dt;
    if (boss.shieldTimer <= 0) {
      if (boss.shieldPhase === 'initial' || boss.shieldPhase === 'shielded') {
        // Shield just expired → open window
        boss.shieldPhase = 'open';
        boss.shield = false;
        boss.shieldTimer = CONFIG.bossShieldOpenDuration;
      } else {
        // Open window expired → maybe re-shield
        const canShield = boss.shieldCount < CONFIG.bossShieldMaxPerWindow;
        if (canShield && Math.random() < CONFIG.bossShieldChance) {
          boss.shieldPhase = 'shielded';
          boss.shield = true;
          boss.shieldTimer = CONFIG.bossShieldRandomDuration;
          boss.shieldCount++;
        } else {
          // Stay open; check again after another open window
          boss.shieldTimer = CONFIG.bossShieldOpenDuration;
        }
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  // Full stun freezes everything below: attack cooldowns, state timers,
  // movement. Burn, the shield machine, and the knockback shove at the
  // bottom all keep running regardless — none of those are "the boss
  // acting", so there's nothing dazing him should pause about them.
  if (bossDazePhase() !== 'stun' && !justResumed) {
    if (boss.bstate === 'orbit' || boss.bstate === 'charge') {
      if (boss.kind === 'crowking') {
        boss.screchCD -= dt;
        boss.batCD -= dt;
        if (boss.batCD <= 0) {
          boss.batCD = CONFIG.bossBatCD;
          spawnBossBats();
        }
        if (boss.screchCD <= 0) {
          boss.screchCD = CONFIG.bossScreechInterval; boss.bstate = 'screech';
          boss.stateTimer = CONFIG.bossScreechHalt;
          events.emit({ type: 'BOSS_SCREECH' }); aggroAllWhiteCrows();
          if (dist2(boss.x, boss.y, player.x, player.y) < CONFIG.bossScreechRange**2) damagePlayer(1);
        }
      } else if (boss.kind === 'dark_archer' && boss.bstate === 'orbit') {
        boss.volleyCD -= dt;
        if (boss.volleyCD <= 0) { boss.volleyCD = CONFIG.darkArcherVolleyInterval; fireBossVolley(); }
        boss.bombCD -= dt;
        if (boss.bombCD <= 0) { boss.bombCD = CONFIG.darkArcherBombInterval; fireBossBomb(); }
        boss.skeletonCD -= dt;
        if (boss.skeletonCD <= 0) { boss.skeletonCD = CONFIG.darkArcherSkeletonInterval; spawnSkeleton('ice'); }
      } else if (boss.kind === 'dark_knight') {
        boss.whirlwindCD -= dt;
        if (boss.whirlwindCD <= 0) {
          boss.whirlwindCD = CONFIG.darkKnightWhirlwindInterval;
          boss.bstate = 'whirlwind'; boss.stateTimer = CONFIG.darkKnightWhirlwindDuration;
          boss.whirlwindTick = 0; boss.chargeTarget = null;
          events.emit({ type: 'WHIRLWIND_START', x: boss.x, y: boss.y });
        }
        boss.skeletonCD -= dt;
        if (boss.skeletonCD <= 0) { boss.skeletonCD = CONFIG.darkKnightSkeletonInterval; spawnSkeleton('fire'); }
      }
    }

    const contactDamage = boss.kind === 'dark_archer' ? CONFIG.darkArcherContactDamage
                         : boss.kind === 'dark_knight' ? CONFIG.darkKnightContactDamage
                         : CONFIG.bossContactDamage;

    if (boss.bstate === 'orbit') {
      boss.stateTimer += dt;
      const angSpd = CONFIG.bossOrbitSpeed * bossSpeedMod() / CONFIG.bossOrbitRadius;
      boss.orbitAngle += angSpd * dt;
      // Close the gap to the target radius instead of snapping onto it — see enterOrbit.
      const radiusDecay = Math.exp(-dt / CONFIG.bossOrbitRadiusEaseTau);
      boss.orbitRadius = CONFIG.bossOrbitRadius + (boss.orbitRadius - CONFIG.bossOrbitRadius) * radiusDecay;
      boss.x = Math.max(CONFIG.bossRadius, Math.min(CONFIG.canvasW - CONFIG.bossRadius, player.x + Math.cos(boss.orbitAngle) * boss.orbitRadius));
      boss.y = Math.max(CONFIG.bossRadius, Math.min(CONFIG.rows * CONFIG.tileSize - CONFIG.bossRadius, player.y + Math.sin(boss.orbitAngle) * boss.orbitRadius));
      if (dist2(boss.x, boss.y, player.x, player.y) < CONFIG.bossRadius*CONFIG.bossRadius) { damagePlayer(contactDamage); events.emit({ type: 'BOSS_CONTACT' }); }
      // The dark archer keeps its distance and never charges; the crow king
      // and dark knight both do once their lead-in expires (the knight's is
      // short on purpose, so it spends most of the fight charging).
      const orbitDuration = boss.kind === 'dark_knight' ? CONFIG.darkKnightOrbitDuration : CONFIG.bossOrbitDuration;
      if (boss.kind !== 'dark_archer' && boss.stateTimer >= orbitDuration) startBossCharge();

    } else if (boss.bstate === 'charge') {
      if (!boss.chargeTarget) { enterOrbit(); return; }
      const dx = boss.chargeTarget.x - boss.x, dy = boss.chargeTarget.y - boss.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 12) {
        enterOrbit();
      } else {
        const chargeSpeed = boss.kind === 'dark_knight' ? CONFIG.darkKnightChargeSpeed : CONFIG.bossChargeSpeed;
        const spd = chargeSpeed * bossSpeedMod() * dt;
        boss.x += (dx/dist)*spd; boss.y += (dy/dist)*spd;
        if (dist2(boss.x, boss.y, player.x, player.y) < CONFIG.bossRadius*CONFIG.bossRadius) {
          damagePlayer(contactDamage); events.emit({ type: 'BOSS_CONTACT' });
          enterOrbit();
        }
      }
    } else if (boss.bstate === 'screech') {
      boss.stateTimer -= dt;
      if (boss.stateTimer <= 0) enterOrbit();
    } else if (boss.bstate === 'whirlwind') {
      boss.stateTimer -= dt;
      boss.whirlwindTick -= dt;
      if (boss.whirlwindTick <= 0) {
        boss.whirlwindTick = CONFIG.darkKnightWhirlwindTickRate;
        if (dist2(boss.x, boss.y, player.x, player.y) < CONFIG.darkKnightWhirlwindRadius ** 2) {
          damagePlayer(CONFIG.darkKnightWhirlwindDamage);
        }
        events.emit({ type: 'WHIRLWIND_TICK', x: boss.x, y: boss.y });
      }
      if (boss.stateTimer <= 0) {
        events.emit({ type: 'WHIRLWIND_END', x: boss.x, y: boss.y });
        enterOrbit();
      }
    }
  }

  applyBossKnockback(dt);
}

/**
 * The dark archer's ranged attack: a narrow spread of magic bolts aimed at
 * the player's current position. Pushed onto the shared hostileBolts array
 * — see its declaration for why that is not the player's arrows.
 */
function fireBossVolley() {
  const ang = Math.atan2(player.y - boss.y, player.x - boss.x);
  const count = CONFIG.darkArcherVolleyCount, half = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const a = ang + (i - half) * CONFIG.darkArcherVolleySpread;
    hostileBolts.push({
      x: boss.x, y: boss.y,
      vx: Math.cos(a) * CONFIG.darkArcherBoltSpeed,
      vy: Math.sin(a) * CONFIG.darkArcherBoltSpeed,
      life: 2.5, damage: CONFIG.darkArcherBoltDamage, freezeSecs: 0, blastRadius: 0,
    });
  }
  events.emit({ type: 'BOSS_VOLLEY', x: boss.x, y: boss.y });
}

/**
 * The dark archer's secondary: a slow lobbed bomb that detonates in a radius
 * at the end of its fuse, on its own cooldown alongside the volley — the
 * same bow-and-dynamite split the real archer's kit has. Aimed at the
 * player's position at throw time, same as the volley and the ice bolt;
 * it does not lead the target.
 */
function fireBossBomb() {
  const ang = Math.atan2(player.y - boss.y, player.x - boss.x);
  hostileBolts.push({
    x: boss.x, y: boss.y,
    vx: Math.cos(ang) * CONFIG.darkArcherBombSpeed,
    vy: Math.sin(ang) * CONFIG.darkArcherBombSpeed,
    life: CONFIG.darkArcherBombFuse, damage: CONFIG.darkArcherBombDamage, freezeSecs: 0,
    blastRadius: CONFIG.darkArcherBombRadius,
  });
}

/**
 * The ice skeleton's own shot: a single bolt aimed at the player, same
 * physics as the dark archer's volley, but it freezes on a hit instead of
 * just damaging.
 */
function fireIceBolt(s) {
  const ang = Math.atan2(player.y - s.y, player.x - s.x);
  hostileBolts.push({
    x: s.x, y: s.y,
    vx: Math.cos(ang) * CONFIG.iceSkeletonBoltSpeed,
    vy: Math.sin(ang) * CONFIG.iceSkeletonBoltSpeed,
    life: 2.5, damage: CONFIG.iceSkeletonBoltDamage, freezeSecs: CONFIG.iceSkeletonFreezeSecs, blastRadius: 0,
  });
  events.emit({ type: 'ICE_BOLT_FIRED', x: s.x, y: s.y });
}

/**
 * A lobbed bomb reaching the end of its fuse, or a wall/edge/water tile
 * stopping it early: either way it goes off right where it is, rather than
 * bouncing like the player's own dynamite does — dark bosses reimplement a
 * character's kit thematically, not physics-for-physics (see fireBossVolley
 * and the charge/spear comment on drawDarkKnight). Reuses the same EXPLOSION
 * event a dynamite going off already emits, so render/audio need nothing new.
 */
function detonateHostileBomb(b) {
  const onWater = tileAt(b.x, b.y) === TILE.WATER;
  events.emit({ type: 'EXPLOSION', x: b.x, y: b.y, onWater, big: false, radius: b.blastRadius });
  if (dist2(b.x, b.y, player.x, player.y) < b.blastRadius * b.blastRadius) {
    damagePlayer(b.damage);
  }
}

/** Moves every hostile bolt and resolves it against the player. */
function updateHostileBolts(dt) {
  for (let i = hostileBolts.length - 1; i >= 0; i--) {
    const b = hostileBolts[i];
    b.life -= dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life <= 0 || b.x < 0 || b.x >= CONFIG.canvasW || b.y < 0 ||
        b.y >= CONFIG.rows * CONFIG.tileSize || !tilePassable(tileAt(b.x, b.y))) {
      if (b.blastRadius > 0) detonateHostileBomb(b);
      hostileBolts.splice(i, 1); continue;
    }
    if (dist2(b.x, b.y, player.x, player.y) < CONFIG.arrowHitRadius * CONFIG.arrowHitRadius) {
      if (b.blastRadius > 0) {
        detonateHostileBomb(b);
        hostileBolts.splice(i, 1); continue;
      }
      damagePlayer(b.damage);
      if (b.freezeSecs > 0) {
        playerFrozenTimer = Math.max(playerFrozenTimer, b.freezeSecs);
        events.emit({ type: 'PLAYER_FROZEN', x: player.x, y: player.y });
      }
      hostileBolts.splice(i, 1);
    }
  }
}

/**
 * The garrison's commander, mounted.
 *
 * His own loop rather than a fifth branch inside the arena bosses' orbit and
 * charge machine, for the reason the minotaur has one: what he shares with
 * them is the damage contract, not the movement. He rides the player down at a
 * walk and charges on a timer, and that is the whole of him — no orbit, no
 * shield window, no summons.
 *
 * The charge is random with a floor. A pure random interval can roll two
 * charges back to back, which leaves no window to punish him in and reads as
 * unfair rather than as dangerous; a fixed interval reads as a metronome and
 * is beaten by counting. The floor plus a spread is the pair of those.
 */
function updateCommander(dt) {
  const b = boss;
  if (b.hitFlash > 0) b.hitFlash = Math.max(0, b.hitFlash - dt);

  const dx = player.x - b.x, dy = player.y - b.y;
  const dist = Math.hypot(dx, dy) || 1;
  b.facing = dx >= 0 ? 1 : -1;

  if (dist < CONFIG.commanderContactReach) damagePlayer(CONFIG.commanderContactDamage);

  if (b.charge > 0) {
    // Committed to the heading he picked at the wind-up, so stepping off that
    // line is the answer. Rock stops him dead rather than sliding him along
    // it, which is what makes fighting him among the pillars worth doing.
    b.charge -= dt;
    const nx = b.x + Math.cos(b.chargeAngle) * CONFIG.commanderChargeSpeed * dt;
    const ny = b.y + Math.sin(b.chargeAngle) * CONFIG.commanderChargeSpeed * dt;
    if (tilePassable(tileAt(nx, ny))) { b.x = nx; b.y = ny; }
    else b.charge = 0;
    b.wingPhase += dt * 14;
    return;
  }

  b.chargeCD -= dt;
  if (b.chargeCD <= 0) {
    b.charge = CONFIG.commanderChargeSecs;
    b.chargeAngle = Math.atan2(dy, dx);
    b.chargeCD = CONFIG.commanderChargeMinGap
      + Math.random() * CONFIG.commanderChargeGapSpread;
    events.emit({ type: 'BOSS_CHARGE' });
    return;
  }

  // Between charges he closes at a walk, on the same cached A* the rest of the
  // garrison uses, so the cavern's rock is something he goes round too.
  chaseAlongPath(b, CONFIG.commanderRideSpeed, dt);
  b.wingPhase += dt * 6;
}

function spawnBossBats() {
  const n = CONFIG.bossBatsPerSummon;
  for (let i = 0; i < n; i++) {
    crows.push({
      x: boss.x + (Math.random() - 0.5) * 24,
      y: boss.y + (Math.random() - 0.5) * 24,
      baseY: boss.y,
      state: 'aggro', aggroTimer: 8, team: Team.ENEMY,
      wingPhase: Math.random() * Math.PI * 2,
      phaseOff: Math.random() * Math.PI * 2,
      entityPhase: Math.random() * Math.PI * 2,
      white: true, frozen: false
    });
  }
  events.emit({ type: 'BOSS_BATS', x: boss.x, y: boss.y });
}

function startBossCharge() {
  const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
  boss.chargeTarget = { x: player.x + Math.cos(angle)*60, y: player.y + Math.sin(angle)*60 };
  boss.bstate = 'charge'; boss.stateTimer = 0;
  events.emit({ type: 'BOSS_CHARGE' });
}

function startBossDeath() {
  boss.bstate = 'dead'; boss.hp = 0;
  events.emit({ type: 'BOSS_DEATH_START' });
  for (const c of crows) c.frozen = true;
  const frags = [];
  for (let i = 0; i < 6; i++) {
    const a = (i/6)*Math.PI*2;
    frags.push({ x: boss.x, y: boss.y, vx: Math.cos(a)*120, vy: Math.sin(a)*120,
                 w: 10+Math.random()*10, h: 6+Math.random()*6, alpha: 1 });
  }
  bossDeathSeq = { timer: 0, fragments: frags, frozenAlpha: 1,
                   bx: boss.x, by: boss.y,
                   burstA: false, burstB: false, burstC: false };
}

function updateBossDeath(dt) {
  if (!bossDeathSeq) return;
  const s = bossDeathSeq; s.timer += dt;
  // Staggered 3-wave burst: A=0ms, B=+80ms, C=+160ms
  if (!s.burstA) { s.burstA = true; events.emit({ type: 'BOSS_DEATH_BURST', x: s.bx, y: s.by, phase: 'a' }); }
  if (!s.burstB && s.timer >= 0.08) { s.burstB = true; events.emit({ type: 'BOSS_DEATH_BURST', x: s.bx, y: s.by, phase: 'b' }); }
  if (!s.burstC && s.timer >= 0.16) { s.burstC = true; events.emit({ type: 'BOSS_DEATH_BURST', x: s.bx, y: s.by, phase: 'c' }); }
  for (const f of s.fragments) { f.x += f.vx*dt; f.y += f.vy*dt; f.alpha -= dt * 1.67; }
  if (s.timer >= 0.7) s.frozenAlpha = Math.max(0, s.frozenAlpha - dt * 3.33);
  if (s.timer >= 1.2) {
    bossDeathSeq = null;
    const deadKind = boss.kind;
    boss = null; hostileBolts = [];
    // A boss down pays mastery whether it ends a stage or sits inside a siege
    // wave; the stage hand-offs below pay their own milestone on top. What it
    // pays is the boss's own figure, the way its HP and its on-hit behaviour
    // already are: the crow king is worth one, so a first kill buys exactly
    // one tier-I talent and asks for one decision rather than five.
    TALENTS.awardBoss(deadKind);
    // On a siege the boss is one enemy inside a wave, not the end of a stage.
    // Every branch below hands off to another map or to a win screen, so
    // running any of them here would load the castle in the middle of wave 7.
    // The wave-clear check is what advances a siege, and it needs nothing from
    // this function beyond the slot being empty.
    if (siegeRun) {
      // Except the thaw. startBossDeath freezes every crow to hold the field
      // still for the cinematic, and updateCrows skips a frozen one outright.
      // Nothing ever had to undo that, because every brawl branch below either
      // clears `crows` or loads a map that replaces them -- so the flag died
      // with the bodies. A siege keeps its wave, and a crow left frozen is a
      // body no wave-clear check will ever see leave: the run stalls with the
      // last two bats hanging in the air and cannot be finished.
      //
      // Found by playing it in a browser, not by the suite: every siege test
      // that kills a boss either clears the wave first or never looks at what
      // the survivors do afterwards.
      for (const c of crows) c.frozen = false;
      queueBossChoosers();
      return;
    }
    if (deadKind === 'crowking') {
      // Stage 1 done. The run continues into the castle stage: reload the
      // map, reposition on the same corner initGame() always starts from
      // (the fresh random layout gives no guarantee the player's current
      // spot, wherever the crow king died, is still open ground), and seed
      // the first batch of skeletons.
      crows = [];
      TALENTS.award('stage_cleared');
      bossStage = 2;
      generateMap('castle');
      player.x = 2.5 * CONFIG.tileSize; player.y = (CONFIG.rows / 2) * CONFIG.tileSize;
      skeletons = []; skeletonKillCount = 0;
      startCastleWave(1);
      // Not transitionTo('playing'): that path calls initGame() for every
      // other 'playing' entry, which would wipe the run that just cleared
      // stage 1. The nine-wave gauntlet plays out in 'playing' like a normal
      // brawl; killSkeleton's own wave-clear check is what starts the next
      // wave, or the dark archer's entrance once wave 9 clears. The castle
      // is already fully set up at this point; the intro just holds a black
      // screen in front of it until the player clicks, since cutting straight
      // from the death burst into the new map read as too fast.
      showStageIntro('castle');
    } else if (deadKind === 'dark_archer') {
      // Both dark bosses share the castle stage, so no map reload here.
      skeletons = [];
      TALENTS.award('stage_cleared');
      bossStage = 3;
      transitionTo('boss_entrance');
    } else if (deadKind === 'dark_knight') {
      // Stage 3 done, and the run is not over: the castle's floor gives out
      // into the labyrinth under it. Built exactly the way the castle
      // hand-off builds its stage, then held behind a title.
      //
      // spawnBoss() reads bossStage, so that has to be 4 before it runs, and
      // the maze has to exist before the minotaur picks a tile to stand on.
      skeletons = []; crows = [];
      TALENTS.award('stage_cleared');
      bossStage = 4;
      generateMap('maze');
      const spawn = nearestOpenTile(2.5 * CONFIG.tileSize, (CONFIG.rows / 2) * CONFIG.tileSize);
      player.x = spawn.x; player.y = spawn.y;
      spawnBoss();
      showStageIntro('maze');
    } else if (deadKind === 'commander') {
      // The cavern's ending. Not a hand-off to another stage the way the brawl
      // chain's deaths are: this run is over, and what is left of the garrison
      // goes with him rather than being left walking around a won map.
      soldiers = []; skeletons = [];
      transitionTo('win');
    } else {
      // The minotaur cannot die, so nothing reaches here through him. The
      // maze is won by walking out of the door, not by clearing the room.
      skeletons = [];
      transitionTo('win');
    }
    queueBossChoosers();
  }
}

// ── THE BASTION SIEGE ─────────────────────────────────────────────────────────
//
// A finite ten-wave defence of two towers, with a retinue that grows. The rules
// live in sim/: siege-run.ts owns the run, siege-waves.ts the ladder, guards.ts
// the retinue, towers.ts the cover. This is only the wiring that puts them on
// the field.
//
// The retinue grows by recruitment and by exactly one exception. The priest is
// seated once by startSiege and never rolled for, which is enforced in the
// types rather than here — rollGuardKind cannot return one. Nothing in this
// section needs to defend against a second priest arriving, and nothing here
// should start trying to: the day this file grows a check for it is the day
// the guarantee has moved to the wrong place.
//
// EVERYTHING HERE KEYS ON THE MAP, NOT THE MODE.
//
// `mapPopulation() === 'siege'` is the gate, never `gameMode === 'siege'`. The
// bastion is reachable two ways — S on the title screen, and as the last stage
// of the brawl chain after the maze — and a mode check would run the siege on
// one and leave the map inert on the other. That is the shape of the
// Waves+Castle bug mirrored: that one keyed on the map where it should have
// keyed on the mode, and this would key on the mode where it should key on the
// map. Who lives on a map is the map's business.

/**
 * Where the retinue's rolls come from.
 *
 * Math.random by default, and replaceable so a harness can pin a run. The roll
 * decides which kinds open the siege and which arrive each wave, and a knight
 * cannot be promoted — so with an unpinned roll, any assertion about ranks is
 * really an assertion about the weather. Pinning it is what makes the retinue
 * testable rather than merely observable.
 */
let siegeRng = Math.random;

/**
 * Hands the run over to the bastion: the campaign's last stage.
 *
 * Built the way the castle and the maze hand-offs are — generate, reposition,
 * then hold the new map behind a title — and for the same reason each of them
 * gives: transitionTo('playing') runs initGame(), which would wipe the run
 * that just earned its way here. generateMap opens the siege by itself, since
 * the siege belongs to the map.
 *
 * The mode is left alone. A brawl that reaches the bastion is still a brawl,
 * and the siege runs because the map says so, not because the mode does.
 */
function startBastionStage() {
  boss = null; bossDeathSeq = null; hostileBolts = [];
  skeletons = []; crows = []; soldiers = [];
  mazeRun = null;
  generateMap('bastion');
  const spawn = nearestOpenTile(2.5 * CONFIG.tileSize, (CONFIG.rows / 2) * CONFIG.tileSize);
  player.x = spawn.x; player.y = spawn.y;
  showStageIntro('bastion');
}

/** Is the map currently loaded a siege ground? */
function mapIsSiege() {
  return mapPopulation() === 'siege';
}

/**
 * Opens a run on the grid that was just generated.
 *
 * Called from generateMap rather than initGame, because the brawl chain reaches
 * the bastion by generating it mid-run and never goes near initGame again.
 */
function startSiegeRun() {
  siegeRun = startSiege(siegeRng);
  towers = makeTowers(towerSites(CONFIG.rows, CONFIG.cols));
  guards = [];
  siegeExtraBosses = [];
  siegeSpawned = false;
  // Bodies are NOT seated here. generateMap runs before the hero is positioned
  // — in initGame and in the brawl chain's hand-off alike — so a retinue placed
  // now rings wherever the hero stood on the previous map. seatRetinue is
  // called from the tick instead, by which time the hero is where it belongs.
}

/**
 * Puts a body on the field for every record that has not got one yet.
 *
 * Called every tick rather than at one moment, so it covers both the opening
 * retinue and the recruit each cleared wave adds, and so neither depends on
 * being run at exactly the right point in a start-up sequence.
 */
function seatRetinue() {
  if (!siegeRun) return;
  while (guards.length < siegeRun.guards.length) {
    placeGuard(siegeRun.guards[guards.length]);
  }
}

/** Clears everything siege, for a map that is not one. */
function endSiegeRun() {
  siegeRun = null; towers = []; guards = []; siegeExtraBosses = []; siegeSpawned = false;
}

/**
 * Puts one guard on the field, behind the barrier and near a tower.
 *
 * Placed rather than walked in: a retinue that marched in from the corridor
 * would be arriving through the siege it is defending against.
 */
/**
 * The gates a retinue holds, in world pixels, or the hero's own ring on a map
 * with no barrier to hold.
 *
 * Recomputed rather than cached because a tower or a section can come down mid
 * run; the generator's answer is about the grid it built, and this is about the
 * grid as it stands.
 */
function guardPosts() {
  const gates = barrierGates(CONFIG.rows, CONFIG.cols);
  return gates.map((gate) => ({
    x: (gate.col + 0.5) * CONFIG.tileSize,
    y: (gate.row + 0.5) * CONFIG.tileSize,
  }));
}

/**
 * Which gate this guard holds.
 *
 * Assigned by index around the list, so four guards on four gates take one
 * each and the fifth doubles up on the first. A guard with no gate to hold —
 * a grid too small to fortify — falls back to the ring around the hero, which
 * is what the retinue did before it had posts at all.
 */
function postOf(g, index) {
  const posts = guardPosts();
  if (posts.length === 0) return guardStation(g);
  return posts[index % posts.length];
}

function placeGuard(guard) {
  // Seated on a gate in the barrier, one guard to each, between the hero and
  // the corridor the waves come down.
  //
  // Two earlier answers were wrong for opposite reasons. At the towers, a
  // recruit arrived five hundred pixels behind the fight and spent ten seconds
  // walking. Ringing the hero put the whole retinue behind the wall it was
  // supposed to be holding, so a wave came through a gap unopposed and reached
  // him before anyone met it. A gate is where a defender stands: forward of the
  // person guarded, on the ground the attack has to cross.
  const posts = guardPosts();
  const seat = posts.length > 0
    ? posts[guards.length % posts.length]
    : {
        x: player.x + Math.cos((guards.length * 2 * Math.PI) / 4) * CONFIG.guardPostRadius,
        y: player.y + Math.sin((guards.length * 2 * Math.PI) / 4) * CONFIG.guardPostRadius,
      };
  const at = nearestOpenTile(seat.x, seat.y);
  guards.push({
    // The sim's record is the source of truth for hp and rank; this is its body.
    guard,
    // Its station in the ring around the hero. Spread by index rather than
    // rolled, so a retinue of four stands at four points of the compass
    // instead of clumping wherever the rng happened to send them.
    post: (guards.length * 2 * Math.PI) / Math.max(3, guards.length + 1),
    // Its own cached route home. Guards do not share the crows' path
    // scheduler — see walkGuardTo.
    route: null, routeTimer: Math.random() * CONFIG.guardRouteInterval,
    x: at.x, y: at.y,
    facing: 0, walkPhase: Math.random() * Math.PI * 2, hitFlash: 0,
    shotCD: GUARD_STATS[guard.kind].ranged ? CONFIG.guardShotInterval * Math.random() : 0,
    swingCD: 0,
    // What this guard has decided to answer, refreshed every frame by
    // updateGuards. Seeded here so a body always carries the field rather
    // than growing it on whichever frame it first took a target.
    quarry: null,
    // A priest arrives having just prayed, so its first heal is a full interval
    // away. Starting at zero would let it mend somebody on the frame it walked
    // in, which reads as the ability firing at nothing in particular and makes
    // the opening of a wave depend on which frame the body was placed on.
    healCD: guard.kind === 'priest' ? CONFIG.guardHealInterval : 0,
    team: Team.A,
  });
}

/**
 * Where a guard should be standing when there is nothing worth leaving for.
 *
 * A slow orbit of the hero rather than a fixed offset: a retinue holding
 * station in perfect formation reads as furniture, and the drift costs one
 * cosine per guard per frame.
 */
function guardStation(g) {
  const ang = g.post + gameTime * CONFIG.guardPostDrift;
  return {
    x: player.x + Math.cos(ang) * CONFIG.guardPostRadius,
    y: player.y + Math.sin(ang) * CONFIG.guardPostRadius,
  };
}

/**
 * Where this guard should be when there is nothing to do: its gate.
 *
 * Falls back to the hero's ring when the map has no barrier, which keeps the
 * retinue meaningful on a grid too small to fortify rather than leaving it
 * standing on a post that does not exist.
 */
function guardHome(g, index) {
  const post = postOf(g, index);
  return post;
}

/**
 * The ground a guard answers for: the gate it holds, AND the hero.
 *
 * Two anchors, not one, and that is the fix for the way the retinue used to
 * look frozen. With the gate alone, anything that got past the barrier stopped
 * being any guard's business the moment it was more than a leash from the post
 * — and the hero stands further from the nearest gate than the leash is long.
 * So a wave that walked through reached him, ate him, and six guards stood on
 * their gates watching, each of them correctly concluding there was nothing
 * within its remit. Measured in a headless run: three bodies stacked on the
 * hero, nearest post 190px away, leash 170.
 *
 * The union of two discs rather than one bigger disc, because the two are
 * different jobs and one radius cannot express both — widening the leash until
 * it covered the hero would also let a guard chase a crow most of the way to
 * the corridor. Overlapping is what keeps the region connected, so a guard can
 * walk from its gate to the hero without ever being "outside".
 */
function guardGround(home) {
  return [home, { x: player.x, y: player.y }];
}

/**
 * Is this point on the ground a guard answers for?
 *
 * The geometry is `onGuardGround` in sim/guards.ts, which is where the reason
 * it is a capsule rather than two discs is written down and unit tested.
 */
function onGuardGround(ground, x, y) {
  const [post, hero] = ground;
  return onDutyGround(post, hero, x, y, CONFIG.guardPostLeash);
}

/**
 * The nearest hostile near enough to this guard's ground to be its business.
 *
 * Eligibility is measured from the ground and the choice from the guard, which
 * is the difference between a bodyguard and a skirmisher: a guard already drawn
 * out to the edge must not find something further out and keep going.
 */
function guardQuarry(g, hostiles, ground) {
  const near = [];
  for (const h of hostiles) if (onGuardGround(ground, h.x, h.y)) near.push(h);
  return nearestHostile(g, near);
}

/** Every hostile body on the field, as things nearestHostile can weigh up. */
function siegeHostiles() {
  const out = [];
  for (const c of crows) out.push({ x: c.x, y: c.y, team: Team.ENEMY, ref: c, kind: 'crow' });
  for (const sk of skeletons) out.push({ x: sk.x, y: sk.y, team: Team.ENEMY, ref: sk, kind: 'skel' });
  for (const so of soldiers) out.push({ x: so.x, y: so.y, team: Team.ENEMY, ref: so, kind: 'soldier' });
  if (boss && boss.bstate !== 'dead') out.push({ x: boss.x, y: boss.y, team: Team.ENEMY, ref: boss, kind: 'boss' });
  return out;
}

/** Everything on the hero's side, hero included. Read by the contact pass. */
function siegeFriendlies() {
  const out = [{ x: player.x, y: player.y, team: Team.A, ref: player, kind: 'hero' }];
  for (const g of guards) out.push({ x: g.x, y: g.y, team: Team.A, ref: g, kind: 'guard' });
  return out;
}

/** Sends in one wave's worth, using the spawners each roster already has. */
function spawnSiegeWave() {
  const roster = waveRoster(siegeRun);
  for (const entry of roster.enemies) {
    const info = BESTIARY[entry.kind];
    for (let n = 0; n < entry.count; n++) {
      if (info.roster === 'crows') {
        spawnCrow();
        const c = crows[crows.length - 1];
        if (c) {
          // Aggro on arrival, and white for a bat. A passive crow drifts left
          // and recycles off the edge forever, which on a finite ladder means a
          // wave that can never be cleared.
          c.state = 'aggro'; c.aggroTimer = 9999;
          c.white = entry.kind === 'bat';
        }
      } else if (info.roster === 'skeletons') {
        spawnSkeleton(info.spawnArg ?? 'normal');
      } else {
        spawnSoldier(info.spawnArg ?? 'spearman');
      }
    }
  }
  for (const kind of roster.bosses) spawnSiegeBoss(kind);
  waveAnnounce = 2.2;
  waveAnnounceText = '── WAVE ' + siegeRun.wave + ' / ' + SIEGE_WAVE_COUNT + ' ──';
  siegeSpawned = true;
}

/**
 * One boss for a siege wave.
 *
 * Wave 10 calls this twice and the single `boss` slot cannot hold two. Rather
 * than turn every `boss` read in this file into an array lookup — there are
 * dozens and each assumes one object or null — the second and later bosses of a
 * wave go into `siegeExtraBosses` and are ticked alongside. The slot keeps its
 * meaning as "the boss the camera and the health bar are about", which is what
 * every existing reader already wants of it.
 */
function spawnSiegeBoss(kind) {
  const stage = BOSS_STAGES.indexOf(kind) + 1;
  if (stage < 1) return;
  const keep = boss;
  bossStage = stage;
  spawnBoss();
  landSiegeBoss(boss);
  if (keep && boss !== keep) {
    // The newcomer joins the extras and the original keeps the health bar.
    siegeExtraBosses.push(boss);
    boss = keep;
  }
}

/**
 * Puts a freshly spawned boss on the field, in a state that fights.
 *
 * spawnBoss leaves most kinds at `canvasW + 40` in `bstate: 'entering'`, which
 * is correct for the brawl chain: the entrance is its own appState, and
 * updateBossEntrance walks them in. A siege has no entrance — the wave simply
 * arrives — so without this a boss sat off the right edge, out of reach and out
 * of the frame, and `siegeWaveCleared` waited on it for ever. That is a run
 * that cannot be finished, and it is what a playtest found.
 *
 * The minotaur and the commander already place themselves inside the map for
 * their own reasons, so they are left exactly as they are.
 */
function landSiegeBoss(b) {
  if (!b || b.bstate !== 'entering') return;
  const at = openTileAwayFrom(player.x, player.y, CONFIG.siegeBossSpawnDistance)
    ?? nearestOpenTile(CONFIG.canvasW - 3 * CONFIG.tileSize, (CONFIG.rows / 2) * CONFIG.tileSize);
  b.x = at.x; b.y = at.y;
  b.bstate = 'orbit';
  b.stateTimer = 0;
  b.orbitAngle = Math.atan2(b.y - player.y, b.x - player.x);
  b.orbitRadius = Math.max(CONFIG.bossOrbitRadius, Math.hypot(b.x - player.x, b.y - player.y));
  // What pathScheduler.serve() requires, for the kinds that walk.
  b.state = 'aggro';
}

/** Is every enemy of the current wave off the field? */
/**
 * The siege's bosses as one pool, or null when none is up.
 *
 * Wave ten fields two and they share a bar rather than getting one each: the
 * pair is one enemy with a doubled pool, so the number on the bar is the sum
 * of both and a hit on either drains it. Waves seven to nine field one, and
 * the same function describes that without a special case -- a pool of one.
 *
 * Live bodies only. A boss mid-death-sequence is still on the field as a heap
 * of fragments, and counting its zero into the total would leave the bar
 * showing half a pool that nothing can be done about.
 */
function siegeBossPool() {
  const live = [];
  if (boss && boss.bstate !== 'dead') live.push(boss);
  for (const b of siegeExtraBosses) if (b && b !== boss && b.bstate !== 'dead') live.push(b);
  if (live.length === 0) return null;
  let hp = 0, hpMax = 0, flash = false;
  for (const b of live) {
    // A non-finite pool is left out of the totals rather than poisoning them.
    // Nothing should reach here with one now that the siege keeper has a row,
    // but drawHpBar draws one divider per hit point and Infinity there is a
    // hung frame, not a slow one -- the same hazard drawLaneContext guards.
    const max = b.hpMax || CONFIG.bossHP;
    if (!Number.isFinite(max)) continue;
    hp += Math.max(0, b.hp);
    hpMax += max;
    if (b.hitFlash > 0) flash = true;
  }
  if (hpMax <= 0) return null;
  return { hp, hpMax, count: live.length, flash };
}

/**
 * One life between them: when a siege boss dies, the rest go with it.
 *
 * Called from updateSiege rather than from startBossDeath, and that is the
 * whole subtlety. tickSiegeBosses briefly moves an extra into the boss slot to
 * update it, so for the length of that call neither `boss` nor
 * siegeExtraBosses holds the complete set -- and a boss dying inside
 * updateBoss dies exactly there. By the time this runs the handover has
 * finished and the two lists are whole again.
 *
 * Idempotent: the death sequence lasts a couple of seconds and this is on the
 * path for every frame of it, so it has to be safe to run against bodies it
 * has already felled.
 */
function felledWithTheOther() {
  for (const b of siegeExtraBosses) {
    if (!b || b.bstate === 'dead') continue;
    b.bstate = 'dead';
    b.hp = 0;
    // A burst where the twin was, so it is seen to go rather than vanishing
    // between frames. The one that took the last hit has the full sequence.
    events.emit({ type: 'BOSS_DEATH_BURST', x: b.x, y: b.y, phase: 'c' });
  }
}

function siegeWaveCleared() {
  return crows.length === 0 && skeletons.length === 0 && soldiers.length === 0
    && (!boss || boss.bstate === 'dead') && siegeExtraBosses.length === 0;
}

/**
 * The run's own tick: spawn a wave, wait for it to be cleared, then promote,
 * recruit and move on — or win.
 */
function updateSiege(dt) {
  if (!siegeRun || siegeRun.outcome !== 'running') return;
  seatRetinue();
  if (!siegeSpawned) { spawnSiegeWave(); return; }
  tickSiegeBosses(dt);
  if (bossDeathSeq) felledWithTheOther();
  siegeExtraBosses = siegeExtraBosses.filter((b) => b && b.bstate !== 'dead');
  if (!siegeWaveCleared()) return;

  const before = siegeRun.wave;
  siegeRun = siegeCompleteWave(siegeRun, siegeRng);
  events.emit({ type: 'SIEGE_WAVE_CLEARED', wave: before });
  if (siegeRun.outcome === 'won') { TALENTS.award('siege_cleared'); transitionTo('win'); return; }

  // Promotion happens in the sim, and completeWave clones on promotion rather
  // than mutating, so the bodies must be re-seated onto the new records or they
  // would keep drawing yesterday's rank.
  reseatGuards();
  seatRetinue();
  wave = siegeRun.wave;
  siegeSpawned = false;
}

/**
 * Runs the boss AI for every boss a siege has on the field.
 *
 * Two things were broken here and a playtest found both. `updateBoss` only runs
 * during 'playing' for kinds BOSS_HUNTS_WHILE_EXPLORING marks as hunters —
 * which is the minotaur alone, and the table has no row for the commander at
 * all — so a siege boss never ticked. And the extras of wave 10 were never
 * ticked by anything, despite a comment of mine claiming they were. Both left
 * a wave that could not be cleared.
 *
 * The extras are ticked by swapping each into the `boss` slot and back.
 * updateBoss reads and writes the global throughout — it is hundreds of lines
 * built on there being exactly one — and threading a parameter through all of
 * it to field a second boss on one wave of one map would be a large change to
 * a lot of code that works. The swap is honest about what it is: the engine
 * has one boss, and this lends it out.
 */
/**
 * Hands the boss slot to `extra` and puts `held` back among the extras.
 *
 * Called when an extra dies while occupying the slot: the one that just died
 * keeps it, so updateBossDeath clears the right body, and the one that was
 * holding it rejoins the list rather than being dropped on the floor -- which
 * would leave a live boss on the field that nothing ticks and no wave-clear
 * check can see.
 *
 * Shared with the harness hook that kills an extra, so a test cannot exercise
 * a handover the game does not perform.
 */
function seatSiegeBoss(extra, held) {
  siegeExtraBosses = siegeExtraBosses.filter((b) => b !== extra);
  // A dead `held` is not handed back. It used to be, harmlessly, because the
  // slot's occupant was always alive; with one life shared between wave ten's
  // pair it can now be dead by the time the handover runs, and a dead body in
  // the live list is one siegeWaveCleared would wait on.
  if (held && held !== extra && held.bstate !== 'dead') siegeExtraBosses.push(held);
}

function tickSiegeBosses(dt) {
  if (bossDeathSeq) return;
  if (boss && boss.bstate !== 'dead' && !BOSS_HUNTS_WHILE_EXPLORING[boss.kind]) updateBoss(dt);
  if (siegeExtraBosses.length === 0) return;
  const held = boss;
  for (const extra of siegeExtraBosses) {
    if (!extra || extra.bstate === 'dead') continue;
    boss = extra;
    updateBoss(dt);
    if (bossDeathSeq) { seatSiegeBoss(extra, held); return; }
  }
  boss = held;
}

/** Re-points each body at its promoted record, dropping bodies whose record went. */
function reseatGuards() {
  const records = siegeRun.guards;
  for (let i = guards.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (!rec) { guards.splice(i, 1); continue; }
    guards[i].guard = rec;
  }
}

/** A guard was killed: it leaves the field and the retinue, and does not return. */
function killGuard(index) {
  const body = guards[index];
  if (!body) return;
  events.emit({ type: 'GUARD_DOWN', x: body.x, y: body.y });
  guards.splice(index, 1);
  siegeRun = siegeGuardLost(siegeRun, index);
}

/** Damage onto a guard, from a contact hit or a shot. */
function damageGuard(index, amount = 1) {
  const body = guards[index];
  if (!body) return;
  body.guard.hp -= amount;
  body.hitFlash = 0.15;
  if (body.guard.hp <= 0) killGuard(index);
}

/**
 * The retinue's turn: each guard closes on the nearest enemy and hits it.
 *
 * Movement is direct rather than A*: pathScheduler.serve takes one goal for the
 * whole frame and the crows already own it, so a guard asking for a path would
 * be asking for a path to the player. Over the bastion's open middle that costs
 * nothing — it is the one map deliberately built without corridors — and this
 * note is here so the next map does not inherit the assumption silently.
 */
function updateGuards(dt) {
  if (!siegeRun || bossDeathSeq) return;
  const hostiles = siegeHostiles();
  for (let i = guards.length - 1; i >= 0; i--) {
    const g = guards[i];
    if (g.hitFlash > 0) g.hitFlash = Math.max(0, g.hitFlash - dt);
    if (g.swingCD > 0) g.swingCD = Math.max(0, g.swingCD - dt);
    // The priest turns off here, before a target is ever looked for. Every path
    // below this line ends in damage, and the one guarantee the kind is built
    // on is that none of them can run for it: there is no branch further down
    // that has to remember to check, and no arm of one that could be added
    // later without noticing. Its own turn is a separate function for the same
    // reason — a healer is not a fighter with `if (canFight)` around it.
    // The anchor is set before the priest branches away, because the priest has
    // a gate to hold like everyone else and moveGuard measures its leash from
    // there. Set after the branch, the priest spent its first frame anchored to
    // nothing and fell back to the hero.
    const home = guardHome(g, i);
    g.anchor = home;
    g.ground = guardGround(home);
    if (isPriest(g.guard)) { updatePriest(g, dt); continue; }
    const stats = GUARD_STATS[g.guard.kind];
    // A guard that has drifted past its leash goes home before it does anything
    // else, and takes no target on the way.
    //
    // Without this the leash leaked. moveGuard has to allow any step once a
    // guard is outside — a body coming home round a barrier must move away from
    // the hero for part of the route, and forbidding that pinned it to the wall.
    // But 'outside, so anything goes' is also permission to keep walking
    // outward, so a guard that stepped over the line while fighting something
    // that then moved was free to follow it across the map. Deciding it here,
    // where the intent is known, is what closes that.
    const onDuty = onGuardGround(g.ground, g.x, g.y);
    const target = onDuty ? guardQuarry(g, hostiles, g.ground) : null;
    // Kept, not merely used. Every branch below turns this into movement, a
    // swing or a shot, and those are all the loop leaves behind -- so "which
    // body is this guard answering" could only be inferred back out of
    // geometry afterwards, and geometry cannot express it: an archer answers
    // from most of its 260px reach away without taking a step, which any
    // distance reading scores as a guard idling at its gate. The decision is
    // the honest record of it. `anchor` just above is kept for the same
    // reason. A priest has already left the loop and never takes one.
    g.quarry = target;
    if (!target) { returnToPost(g, home, dt); continue; }

    const dx = target.x - g.x, dy = target.y - g.y;
    const dist = Math.hypot(dx, dy) || 1;
    g.facing = Math.atan2(dy, dx);

    if (stats.ranged) {
      g.shotCD -= dt;
      // An archer shoots from where it stands and only closes if it cannot
      // reach: its reach is nearly its leash, so in practice it stays on the
      // hero's shoulder and fires past him, which is what an escort archer is.
      if (dist > CONFIG.guardArcherReach) walkGuardTo(g, target.x, target.y, dt);
      else if (g.shotCD <= 0) { g.shotCD = CONFIG.guardShotInterval; fireGuardArrow(g, target); }
      else returnToPost(g, home, dt);
      continue;
    }
    if (dist <= CONFIG.guardMeleeReach) {
      if (g.swingCD <= 0) {
        g.swingCD = CONFIG.guardSwingInterval;
        hitSiegeTarget(target, guardDamage(g.guard));
        events.emit({ type: 'GUARD_SWING', x: g.x, y: g.y });
      }
      continue;
    }
    // Routed, not beelined. A guard chasing in a straight line walks into the
    // barrier it is standing in a gate of, and stops there for as long as its
    // quarry stays put -- which is the "stuck or frozen a few seconds into a
    // wave" the playtest reported. Coming home already routed; going out did
    // not, and going out is the half that has a wall in the way.
    walkGuardTo(g, target.x, target.y, dt);
  }
}

/**
 * The priest's turn: the ward if the retinue is coming apart, otherwise one
 * ally mended, otherwise stand fast.
 *
 * It never asks `siegeHostiles()` anything. Not because enemies do not matter
 * to it — they are what is putting the holes in the retinue — but because
 * every question it could ask about a hostile would be the first half of an
 * attack, and the kind is defined by not having one. What it looks at is the
 * retinue's health, and where the health it needs to reach is standing.
 *
 * The ward comes first, before the cooldown heal is even considered. The one
 * moment it exists for is a wave breaking through, and a priest that had just
 * spent its turn mending one archer for 1 while three allies were down would
 * be holding the ability for a better moment that has already gone past.
 *
 * NO EVENT IS EMITTED FOR A HEAL, and that is a scope boundary rather than an
 * oversight. `GameEvent` in src/sim/events.ts is a closed union and the effects
 * layer switches over it exhaustively; a `GUARD_HEALED` variant belongs there,
 * in a change that owns that file. Reusing GUARD_SWING or GUARD_SHOT to get a
 * burst on screen was the alternative and is worse than nothing — events.ts is
 * explicit that an event which lies about what happened costs more than one
 * that duplicates another. The heal is legible from the health it restores
 * until that variant exists.
 */
function updatePriest(g, dt) {
  if (g.healCD > 0) g.healCD = Math.max(0, g.healCD - dt);

  // Who the ward would land on. The priest itself is deliberately not in this
  // list: guards.ts puts it into its own congregation, so "the priest is always
  // blessed by its own ward" is a rule of the ability rather than a thing this
  // call site has to remember to include.
  const inRadius = [];
  for (const b of guards) {
    if (b === g) continue;
    if (Math.hypot(b.x - g.x, b.y - g.y) <= CONFIG.guardWardRadius) inRadius.push(b.guard);
  }
  if (shouldWard(g.guard, inRadius)) { invokeWard(g.guard, inRadius); return; }

  // Otherwise the ally furthest from its own maximum, the priest included, so
  // the heal goes where it is worth the most rather than to whoever is nearest.
  // `missingHp` is the sim's answer to "how hurt is this one", so the choice
  // made here and the clamp applied in `healGuard` cannot come to disagree
  // about what full health means.
  let target = null;
  let worst = 0;
  for (const b of guards) {
    const need = missingHp(b.guard);
    if (need > worst) { worst = need; target = b; }
  }
  // Nobody is hurt, so it falls in with the rest of the retinue and keeps
  // station on the hero. It still never advances on an enemy — holdStation
  // walks toward the ring around the hero and nothing else, so the one unit
  // that never respawns is never the one walking at the wave. But standing
  // where it spawned while the hero moves off is how a healer ends the wave
  // out of range of everyone it exists to heal.
  if (!target) { returnToPost(g, g.anchor ?? guardStation(g), dt); return; }

  const dx = target.x - g.x, dy = target.y - g.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0) g.facing = Math.atan2(dy, dx);
  if (dist > CONFIG.guardHealReach) { walkGuardTo(g, target.x, target.y, dt); return; }
  if (g.healCD > 0) return;
  g.healCD = CONFIG.guardHealInterval;
  healGuard(target.guard, guardHeal(g.guard));
}

/**
 * Walks a guard toward an arbitrary point, around terrain rather than into it.
 *
 * Guards used to move in a straight line, and a comment here said that cost
 * nothing because the bastion's middle is open. That was true only while a
 * guard never had to go anywhere: it fought whatever was already beside it. The
 * moment the retinue had to follow the hero, the barrier it is standing behind
 * became a wall it walked into and stayed at — a playtest found the retinue
 * left behind at the towers while the hero was across the map.
 *
 * It solves its own A* rather than joining pathScheduler, because the scheduler
 * serves one destination for the whole frame and the crows own it — every agent
 * on that queue is going to the player. A guard is going to a moving point near
 * the player, and each guard's is different. The cost is bounded by the
 * recompute interval, not by the frame.
 */
function walkGuardTo(g, tx, ty, dt) {
  g.routeTimer -= dt;
  // A route is also stale when the thing it was computed for has moved off the
  // end of it. Without this a guard chasing a body across the field followed
  // the path to where that body used to be for up to half a second at a time,
  // which on a map with a wall through the middle of it is the difference
  // between going round the barrier and walking into it.
  const drifted = !g.routeGoal
    || dist2(g.routeGoal.x, g.routeGoal.y, tx, ty) > CONFIG.tileSize * CONFIG.tileSize;
  if (!g.route || g.route.length === 0 || g.routeTimer <= 0 || drifted) {
    g.route = computeAStarPath(g.x, g.y, tx, ty);
    g.routeGoal = { x: tx, y: ty };
    g.routeTimer = CONFIG.guardRouteInterval;
  }
  let aimX = tx, aimY = ty;
  if (g.route && g.route.length > 0) {
    const wp = g.route[0];
    if (Math.hypot(wp.x - g.x, wp.y - g.y) < 8) g.route.shift();
    else { aimX = wp.x; aimY = wp.y; }
  }
  const dx = aimX - g.x, dy = aimY - g.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  g.facing = Math.atan2(dy, dx);
  moveGuard(g, dx / dist, dy / dist, dt);
}

/**
 * Walks a guard back to its gate, and stands it down when it is there.
 *
 * The slack matters: without a dead zone a guard oscillates across its own post
 * every frame, which at this sprite size is a visible jitter rather than a
 * subtle one. Facing is turned toward the corridor once it arrives, so a
 * retinue at rest is looking at the ground the wave will come over rather than
 * at whatever it last walked past.
 */
function returnToPost(g, home, dt) {
  if (Math.hypot(home.x - g.x, home.y - g.y) < CONFIG.guardPostSlack) {
    g.route = null;
    g.routeGoal = null;
    g.facing = 0;
    return;
  }
  walkGuardTo(g, home.x, home.y, dt);
}

/**
 * One step, refused by terrain the way every other ground body's is.
 *
 * The leash is NOT enforced here, and that is a decision rather than an
 * omission. It used to be: a step was refused if it left the guard's ground.
 * That pins a guard against its own boundary, because this moves on each axis
 * separately and an axis-separated step can leave a disc the diagonal would
 * have stayed inside — so a guard heading for something perfectly legitimate
 * would have both halves of its step refused and simply stop.
 *
 * Nothing is lost by dropping it, because the two rules that actually bound a
 * guard live where the intent is known rather than where the pixels are:
 * `guardQuarry` will only hand back a threat standing on the guard's ground,
 * and `updateGuards` will not let a guard that is off its ground take a target
 * at all. A guard therefore only ever walks from a point on its ground toward
 * another point on its ground, and the moment its quarry steps off, it stops
 * being a target and the guard turns for home. A rule enforced twice is a rule
 * that can disagree with itself, and this was the half that was wrong.
 */
function moveGuard(g, ux, uy, dt) {
  const spd = CONFIG.guardSpeed;
  const nx = g.x + ux * spd * dt;
  const ny = g.y + uy * spd * dt;
  // A body already INSIDE terrain gets to walk out. Without this the
  // passability check refuses both halves of every step and the guard is
  // entombed for the rest of the run -- it cannot fight, cannot go home, and
  // nothing ever frees it. The player has a way out of this (PLAYER_UNSTUCK,
  // and master has just added a key for it); a guard had none.
  //
  // Allowing "any step" while inside is safe because a guard only ever walks
  // toward its post or a target, and both of those stand on open ground, so
  // the direction it is pushed is out rather than deeper.
  const stuck = !tilePassable(tileAt(g.x, g.y));
  if (stuck || tilePassable(tileAt(nx, g.y))) g.x = nx;
  if (stuck || tilePassable(tileAt(g.x, ny))) g.y = ny;
  g.walkPhase += dt * 8;
}

/** A guard archer's shot. Reuses the arrow array so nothing new has to fly. */
function fireGuardArrow(g, target) {
  const ang = Math.atan2(target.y - g.y, target.x - g.x);
  arrows.push({
    x: g.x, y: g.y,
    vx: Math.cos(ang) * CONFIG.guardArrowSpeed,
    vy: Math.sin(ang) * CONFIG.guardArrowSpeed,
    life: 2, angle: ang, damage: guardDamage(g.guard),
    allied: true, type: 'normal', pierce: 0,
  });
  events.emit({ type: 'GUARD_SHOT', x: g.x, y: g.y });
}

/**
 * The towers shoot.
 *
 * This is what makes them towers rather than walls. Cover that only absorbs is
 * a wall with a roof, and the bastion is a defence map; a hero who could ignore
 * the two stone drums entirely would be playing a brawl with scenery.
 *
 * Fallen towers are skipped, so the shots stop in the same frame the cover
 * does. There is no separate "destroyed" flag to fall out of step with the hp
 * -- `towerStanding` is the one question, the way `towerAt` already asks it.
 */
function updateTowers(dt) {
  if (!siegeRun || bossDeathSeq) return;
  const hostiles = siegeHostiles();
  for (const t of towers) {
    if (!towerStanding(t)) continue;
    t.shotCD -= dt;
    if (t.shotCD > 0) continue;
    const from = towerCentre(t, CONFIG.tileSize);
    // Team.A so the shared helper applies the same canDamage rule a guard's
    // targeting does, rather than this loop reimplementing "is that an enemy".
    const target = nearestHostileWithin(
      { x: from.x, y: from.y, team: Team.A }, hostiles, CONFIG.towerReach);
    if (!target) continue;
    t.shotCD = CONFIG.towerShotInterval;
    fireTowerBolt(from, target);
  }
}

/**
 * One bolt, from a tower's centre at whatever it just picked.
 *
 * Goes into `arrows` with the same shape a guard's shot has, so it inherits
 * flight, terrain collision and the hit loop already written for those rather
 * than growing a second projectile system beside them. `allied` is what makes
 * that hit loop read `damage` instead of assuming one.
 */
function fireTowerBolt(from, target) {
  const ang = Math.atan2(target.y - from.y, target.x - from.x);
  arrows.push({
    x: from.x, y: from.y,
    vx: Math.cos(ang) * CONFIG.towerBoltSpeed,
    vy: Math.sin(ang) * CONFIG.towerBoltSpeed,
    life: 2, angle: ang, damage: TOWER_DAMAGE,
    allied: true, type: 'normal', pierce: 0,
  });
  events.emit({ type: 'TOWER_SHOT', x: from.x, y: from.y });
}

/** Applies damage to whatever a guard just hit, through that kind's own path. */
function hitSiegeTarget(target, amount) {
  if (target.kind === 'crow') {
    const j = crows.indexOf(target.ref);
    if (j >= 0) damageCrow(j, amount);
  } else if (target.kind === 'skel') {
    const j = skeletons.indexOf(target.ref);
    if (j >= 0) damageSkeleton(j, amount);
  } else if (target.kind === 'soldier') {
    const j = soldiers.indexOf(target.ref);
    if (j >= 0) damageSoldier(j, amount);
  } else if (target.kind === 'boss' && boss) {
    damageBoss(amount, target.x, target.y, 'guard');
  }
}

/**
 * What the siege does to the hero's side: enemies that reach a guard fight it,
 * and enemies pressed against a standing tower knock lumps off it.
 *
 * Run here rather than inside each enemy's own update because the enemies do
 * not know the bastion exists. Their AI still walks them at the hero — the path
 * scheduler has one goal a frame and the hero is it — so this pass is what makes
 * a guard in the way, or a tower in the way, actually matter.
 */
function updateSiegeContact(dt) {
  if (!siegeRun || bossDeathSeq) return;
  const friendlies = siegeFriendlies();
  const ts = CONFIG.tileSize;
  const all = [...crows, ...skeletons, ...soldiers];
  for (const e of all) {
    const near = nearestHostile({ x: e.x, y: e.y, team: Team.ENEMY }, friendlies);
    if (near && near.kind === 'guard'
      && Math.hypot(near.x - e.x, near.y - e.y) < CONFIG.guardMeleeReach) {
      e.siegeSwingCD = (e.siegeSwingCD ?? 0) - dt;
      if (e.siegeSwingCD <= 0) {
        e.siegeSwingCD = CONFIG.guardSwingInterval;
        const j = guards.indexOf(near.ref);
        if (j >= 0) damageGuard(j, 1);
      }
      continue;
    }
    const row = Math.floor(e.y / ts), col = Math.floor(e.x / ts);
    // The body's own tile and its four neighbours. It used to probe east and
    // west only, which was enough when a tower was one tile wide and standing
    // beside it meant standing level with it; a 2x2 can be met from the north
    // or the south just as easily.
    const t = towerAt(towers, row, col)
      ?? towerAt(towers, row, col + 1)
      ?? towerAt(towers, row, col - 1)
      ?? towerAt(towers, row + 1, col)
      ?? towerAt(towers, row - 1, col);
    if (!t) continue;
    e.siegeSwingCD = (e.siegeSwingCD ?? 0) - dt;
    if (e.siegeSwingCD <= 0) {
      e.siegeSwingCD = CONFIG.guardSwingInterval;
      if (damageTower(t, 1)) {
        // It came down: the tile stops being cover, which is the whole point of
        // giving a tower hit points at all.
        // The layer redraws itself: StaticTileLayer subscribes to TileMap's
        // onChange in its constructor. An explicit rebuild call here was both
        // unnecessary and undefined, so the first tower ever to actually fall
        // threw — no test had driven one to zero until one was written for it.
        // Every tile of it. Clearing only the north-west corner would leave
        // three quarters of a fallen tower standing as cover that nothing can
        // any longer shoot back from, which is the opposite of the trade.
        for (const tile of towerTiles(t)) tileMap.set(tile.row, tile.col, TILE.EMPTY);
        const at = towerCentre(t, ts);
        events.emit({ type: 'TOWER_FELL', x: at.x, y: at.y });
      }
    }
  }
}

// ── AUDIO ─────────────────────────────────────────────────────────────────────
// All sounds defined as parameter arrays for the synth at the top of this file,
// which documents the layout and where it departs from upstream ZzFX.
// playSound() accepts either an array or a function (for multi-voice sounds).

/**
 * What one play of `s` amounts to, and the one home of the rule that audio can
 * be off. Three answers: null plays nothing, a function is a multi-voice sound
 * that calls the synth itself once per voice, and an array is what the synth
 * is handed — the tuned parameters, varied unless the sound opted out
 * (SOUND_PLAYBACK).
 *
 * Split out of playSound() because a headless test has no AudioContext: this
 * is the half that can be checked, zzfx() is the half that cannot.
 *
 * The profile is rebuilt per play so that editing CONFIG.soundVariation from
 * the console takes effect, which costs one small object against the whole
 * sample buffer zzfx() allocates immediately after.
 */
function soundPlan(s) {
  if (!CONFIG.audio) return null;
  if (typeof s === 'function') return s;
  return PLAYBACK[playbackOf(s)](s, variationProfile(CONFIG.soundVariation));
}

function playSound(s) {
  try {
    const plan = soundPlan(s);
    if (typeof plan === 'function') plan();
    else if (plan) zzfx(...plan);
  } catch (_) {}
}

// ── ZzFX sound definitions ────────────────────────────────────────────────────
// [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
//  slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, ...]

const sndShoot         = [.25, .05, 800, 0, .03, .05, 5, 1];            // filtered noise — arrow release
const sndHitCrow       = [.4,  0,   220, 0, .06, .08, 1, 1, -300];      // triangle glide down — thump
const sndMiss          = [.2,  .02, 180, 0, .04, .06, 2];               // sawtooth buzz — dull clank
const sndAggro         = [.25, 0,   200, 0, .12, .08, 2, 1, 200];       // sawtooth sweep up — threat sting
const sndPickup        = [.3,  0,   880, 0, .05, .07, 0];               // sine chime — bright collect
const sndEmpty         = [.2,  .1,  300, 0, .02, .03, 4];               // bit noise — dry click
const sndEntranceFlash = [.5,  .02, 1200, 0, .02, .03, 4];              // bit noise pop — flash
const sndBossScreech   = [.4,  .2,  800, 0, .25, .2,  4, 1, -500];      // bit noise sweep down — screech
const sndChargeWhoosh  = [.3,  0,   100, 0, .08, .1,  0, 1, 600];       // sine sweep up — whoosh
const sndBossHit       = [.4,  0,    60, 0, .08, .1,  2];               // low sawtooth — heavy thud
const sndPitchfork     = [.35, 0,   140, 0, .06, .1,  2, 1, -80];       // sawtooth drop — clang
const sndExplosion     = [.8,  .05,  90, 0, .18, .3,  5, 1, -40];       // lowpass noise — boom
const sndWizBolt       = [.25, 0,   440, 0, .04, .13, 0, 1, 0, 0, 440, .05]; // sine + pitch jump — magic zap
const sndLightning     = [.75, .15, 120, 0, .25, .3,  4, 1];            // bit noise — lightning crack
const sndCrossbow      = [.28, .04, 550, 0, .03, .06, 4, 1, -120];      // bit noise snap, downward pitch — mechanical thock
const sndPoisonBite    = [.22, .04, 260, 0, .04, .07, 4, 1, -140];     // bit noise, pitch dropping — a wet nip
const sndPoisonTick    = [.14, .02, 180, 0, .05, .09, 2, 1, -60];      // low sawtooth throb — the venom working
const sndArm           = [.22, 0,   900, 0, .02, .04, 1, 1, 300];       // triangle blip, upward pitch — arm confirm
const sndKeyDrop       = [.3,  .02, 1400, 0, .02, .12, 1, 1, 0, 0, 300, .05]; // triangle chime + pitch jump — small metal landing
const sndChestOpen     = [.4,  .05, 160, 0, .1,  .22, 2, 1, 120];       // sawtooth rising — a lid coming up
const sndDoorOpen      = [.6,  .1,   70, 0, .3,  .5,  4, 1, 40];        // low bit noise grinding up — stone giving way
const sndWaveHeld      = [.4,  .05, 520, 0, .08, .22, 1, 1, 120];      // triangle rising — the line held
const sndGuardDown     = [.35, .05, 300, 0, .05, .12, 2, 1, -220];     // sawtooth dropping — a body going down
const sndTowerFell     = [.7,  .1,   80, 0, .2,  .4,  4, 1, -30];      // low bit noise — masonry collapsing
const sndTorchLight    = [.3,  .3,  420, 0, .06, .18, 4, 1, 90];        // bit noise, rising — a strike catching

/**
 * How a sound behaves when it plays again. Everything above varies — see
 * CONFIG.soundVariation for how far, and src/render/sound-variation.ts for
 * which parameters this synth actually hears — except the rows below.
 *
 * A 'fixed' sound is one the player learns by ear and has to keep recognising:
 * the UI's own answers, and a boss's signature. The kind belongs to the sound
 * and not to the call site, so the screech is the Crow King's whether
 * FORESHADOW, the minotaur's roar or the fight itself plays it.
 *
 * The multi-voice sounds below are fixed by construction, and so have no row:
 * they call the synth themselves, one call per voice, and playSound() hands
 * them nothing to vary.
 *
 * Rows carry a kind rather than the table being a set of exceptions, because
 * the kind is what is being modelled: a third way for a sound to repeat lands
 * as a row here and a row in PLAYBACK, not as a second flag.
 *
 * Keyed on the array itself, so a call site has to pass the const. A copy of
 * sndEmpty is a different sound as far as this table is concerned, and would
 * quietly start varying.
 */
const SOUND_PLAYBACK = new Map([
  [sndEmpty,       'fixed'],  // the dry click for "that did nothing" — a UI answer
  [sndArm,         'fixed'],  // the arm confirm blip — the same
  [sndBossScreech, 'fixed'],  // the Crow King's signature, and the minotaur's roar
]);

/** The playback kind of one sound. A sound with no row of its own varies. */
const playbackOf = (s) => SOUND_PLAYBACK.get(s) ?? 'varied';

// Multi-voice sounds — ZzFX is single-voice, so use staggered calls via setTimeout
function sndGameover() {
  [[220, 0], [174, 60], [146, 120]].forEach(([f, d]) =>
    setTimeout(() => zzfx(.22, 0, f, 0, .35, .3, 0), d));
}
function sndBossDeath() {
  zzfx(.6, .08, 200, 0, .25, .4, 5);                              // noise crash
  setTimeout(() => zzfx(.4, 0, 220, 0, .3, .5, 0, 1, 0, 0, 220, .3), 300); // wailing sine rise
}
function sndAnnounce() {
  // UT99-style punchy two-tone ascending beep
  zzfx(.26, 0, 660, 0, .04, .08, 2);
  setTimeout(() => zzfx(.26, 0, 880, 0, .04, .08, 2), 70);
}

// ── GAMIFICATION MODULES ──────────────────────────────────────────────────────

// ── FORESHADOW: sky tint + atmospheric banners at kill milestones ─────────────
const FORESHADOW = (() => {
  const _MILESTONES = [
    { at: 2, text: '— the crows grow restless —',   tint: 0.05 },
    { at: 4, text: '— the sky darkens —',             tint: 0.10 },
    { at: 6, text: '— something wicked stirs —',      tint: 0.18, shake: true },
    { at: 8, text: '— the Crow King awakens —',       tint: 0.28, screech: true },
    { at: 9, text: '— he comes —',                    tint: 0.38, screech: true },
  ];
  let _skyAlpha = 0, _skyTarget = 0;
  let _banner   = null; // { text, timer }

  function onKill(kills) {
    const m = _MILESTONES.find(m => m.at === kills);
    if (!m) return;
    _skyTarget = m.tint;
    _banner    = { text: m.text, timer: 2.8 };
    if (m.shake)   impact('foreshadow');
    if (m.screech) playSound(sndBossScreech);
  }

  function update(dt) {
    _skyAlpha += (_skyTarget - _skyAlpha) * Math.min(1, dt * 2);
    if (_banner) { _banner.timer -= dt; if (_banner.timer <= 0) _banner = null; }
  }

  function drawSkyTint() {
    if (_skyAlpha < 0.003) return;
    ctx.save();
    ctx.fillStyle = `rgba(120,0,0,${_skyAlpha.toFixed(3)})`;
    ctx.fillRect(0, CONFIG.hudHeight, CONFIG.canvasW, CONFIG.rows * CONFIG.tileSize);
    ctx.restore();
  }

  function drawBanner() {
    if (!_banner) return;
    const TOTAL  = 2.8;
    const fadeIn  = Math.min(1, (TOTAL - _banner.timer) / 0.35);
    const fadeOut = Math.min(1, _banner.timer / 0.4);
    const alpha   = Math.min(fadeIn, fadeOut);
    ctx.save();
    ctx.globalAlpha = alpha;
    const ty = CONFIG.canvasH * 0.72;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, ty - 20, CONFIG.canvasW, 40);
    ctx.shadowColor = '#cc2200'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#cc3300';
    ctx.font = 'italic 17px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(_banner.text, CONFIG.canvasW / 2, ty);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function reset() { _skyAlpha = 0; _skyTarget = 0; _banner = null; }

  return { onKill, update, drawSkyTint, drawBanner, reset };
})();

// ── STREAK: UT99-style multi-kill + spree announcements ───────────────────────
const STREAK = (() => {
  const MULTI_LABELS     = ['','','DOUBLE KILL','MULTI KILL','MEGA KILL','ULTRA KILL','MONSTER KILL'];
  const SPREE_THRESHOLDS = [
    { at: 3,  text: 'KILLING SPREE' },
    { at: 5,  text: 'RAMPAGE'       },
    { at: 7,  text: 'DOMINATING'    },
    { at: 10, text: 'UNSTOPPABLE'   },
    { at: 15, text: 'GODLIKE'       },
  ];
  const MULTI_WINDOW = 2.2; // seconds

  let _multiCount = 0, _multiTimer = 0;
  let _spreeCount = 0;
  let _overlay    = null; // { text, sub, timer, color }

  function _show(text, sub, color) {
    _overlay = { text, sub, timer: 1.8, color };
  }

  function onKill() {
    _multiCount++;
    _multiTimer = MULTI_WINDOW;
    _spreeCount++;

    // Multi-kill announcement
    if (_multiCount >= 2) {
      const label = _multiCount < MULTI_LABELS.length
        ? MULTI_LABELS[_multiCount]
        : MULTI_LABELS[MULTI_LABELS.length - 1];
      const sub = _multiCount >= MULTI_LABELS.length
        ? 'UNSTOPPABLE SLAUGHTER'
        : `${_multiCount} kills in rapid succession`;
      _show(label, sub, '#FFB400');
      playSound(sndAnnounce);
    }

    // Spree announcement
    const spree = SPREE_THRESHOLDS.find(s => s.at === _spreeCount);
    if (spree) {
      _show(spree.text, `${_spreeCount} kill streak`, '#39FF14');
      playSound(sndAnnounce);
    }
  }

  function onDamage() { _multiCount = 0; _multiTimer = 0; _spreeCount = 0; }

  function update(dt) {
    if (_multiTimer > 0) {
      _multiTimer = Math.max(0, _multiTimer - dt);
      if (_multiTimer === 0) _multiCount = 0;
    }
    if (_overlay) { _overlay.timer -= dt; if (_overlay.timer <= 0) _overlay = null; }
  }

  function draw() {
    if (!_overlay) return;
    const TOTAL   = 1.8;
    const fadeIn  = Math.min(1, (TOTAL - _overlay.timer) / 0.18);
    const fadeOut = Math.min(1, _overlay.timer / 0.32);
    const alpha   = Math.min(fadeIn, fadeOut);
    const scl     = 0.82 + 0.18 * fadeIn;
    const cy      = CONFIG.canvasH * 0.38;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = _overlay.color; ctx.shadowBlur = 20;
    ctx.fillStyle   = _overlay.color;
    ctx.font        = 'bold 30px "Courier New", monospace';
    ctx.save();
    ctx.translate(CONFIG.canvasW / 2, cy);
    ctx.scale(scl, scl);
    ctx.fillText(_overlay.text, 0, 0);
    ctx.restore();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.55)';
    ctx.font        = '12px "Courier New", monospace';
    ctx.fillText(_overlay.sub, CONFIG.canvasW / 2, cy + 28);
    ctx.restore();
  }

  function reset() { _multiCount = 0; _multiTimer = 0; _spreeCount = 0; _overlay = null; }

  return {
    onKill, onDamage, update, draw, reset,
    get multiCount() { return _multiCount; },
    get spreeCount()  { return _spreeCount; },
  };
})();

// ── FEATHERS: meta-currency + persistent upgrade tree ─────────────────────────
//
// The tree itself — which axes exist, what a level costs, and what it is worth
// — lives in ../sim/upgrades.ts, where it is pure and can be checked without a
// canvas. What stays here is everything that needs a browser: the wallet, the
// save file, the cursor and the screen.
/**
 * Where a shop screen's rows sit: the upgrade list and the talent tree.
 *
 * Both are a stack of bands you point at and buy from, so they read the same
 * geometry rather than each carrying its own copy of the three figures. The
 * arithmetic is in `render/list-rows.ts`, testable without a canvas; what
 * lives here is only which figures this game hands it.
 */
function _shopRows(count, opts = {}) {
  return listRows({
    canvasW: CONFIG.canvasW, canvasH: CONFIG.canvasH,
    count,
    top: opts.top ?? 170,
    // Clear of the key hint along the bottom.
    bottom: opts.bottom ?? CONFIG.canvasH - 54,
    maxPitch: opts.maxPitch ?? 96,
    maxBandH: opts.maxBandH ?? 76,
    // Wide enough for a label, a description and a price without running to
    // the canvas edge on a wide screen.
    widthFrac: 0.62,
  });
}

const FEATHERS = (() => {
  const LS_KEY  = 'crow_archer_v1';

  let _feathers = 0;
  let _levels   = { ...NO_UPGRADES };
  let _cursor   = 0;

  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ feathers: _feathers, levels: _levels })); } catch (_) {}
  }

  function init() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const d   = raw ? JSON.parse(raw) : null;
      if (d) {
        _feathers = feathersFrom(d.feathers);
        _levels   = levelsFrom(d.levels);
      }
    } catch (_) { /* ignore */ }
  }

  function onCrowKill(isWhite) {
    const base   = isWhite ? 2 : 1;
    const bonus  = Math.random() < 0.5 ? 1 : 0;
    const earned = featherYield(_levels, base + bonus);
    _feathers += earned;
    _save();
    return earned;
  }

  // Health and speed start from the selected character's row and take
  // purchased levels on top, so a knight who has bought the health axis is
  // still one point ahead of an archer who has bought the same levels.
  function maxHP()   { return statValue(_levels, 'hp',      CHARACTER_STATS[selectedChar].maxHp); }
  function pfRange() { return statValue(_levels, 'pfRange', CONFIG.pitchforkRange); }
  function speed()   { return statValue(_levels, 'speed',   CHARACTER_STATS[selectedChar].speed); }
  function wallet()  { return _feathers; }
  // TALENTS buys from this same wallet; the subtraction lives with the wallet
  // so no other module ever writes _feathers.
  function spend(n) { _feathers = Math.max(0, _feathers - n); _save(); }
  /** Test-only wallet bypass, the sibling of TALENTS.grant. A shop test needs
   *  an exact balance, and the only earning path rolls a random bonus per
   *  kill; without this the alternative is spend(-n), which works by exploiting
   *  a clamp and would break the moment spend grew a guard. */
  function grant(n) { _feathers = Math.max(0, Math.trunc(n)); _save(); }
  // Whether a run opens with the shield already up, through the same
  // playerShield a pickup and the knight's block already raise.
  function wardStart() { return perkHeld(_levels, 'ward'); }

  function applyToGame() {
    // Resource figures derived from upgrade levels must be refreshed at game
    // start. Every base comes from the pace preset, so upgrades stack on the
    // preset rather than on whatever the previous run left behind.
    CONFIG.resources.arrows.max     = statValue(_levels, 'arrows',  CONFIG.baseArrows);
    CONFIG.resources.arrows.restore = statValue(_levels, 'restore', CONFIG.baseArrowRestore);
    // One axis for "the tool this hero throws": the archer's dynamite and the
    // ranger's satchels are the same tier and already share a preset figure,
    // so raising one without the other would make the axis a hero tax.
    CONFIG.resources.dynamites.max  = statValue(_levels, 'tools', CONFIG.baseDynamites);
    CONFIG.resources.satchels.max   = statValue(_levels, 'tools', CONFIG.baseDynamites);
  }

  /** The live level record. Handed out rather than copied so a test can set
   *  an axis directly; nothing in the game writes it but `buyCurrent`. */
  function levels() { return _levels; }

  function moveCursor(dir) {
    _cursor = (_cursor + dir + UPGRADE_ORDER.length) % UPGRADE_ORDER.length;
  }

  function buyCurrent() {
    const id = UPGRADE_ORDER[_cursor];
    // Half this tree is kit-specific wearing generic clothes, and three of the
    // five heroes cannot use some of it at all -- see AXIS_HEROES. Refused
    // rather than sold: the wallet is shared, so the same level bought while
    // playing a hero it serves is worth exactly as much, and taking 45
    // feathers for a POWDER KEG the sapper's bombs never read is the shop
    // lying about what it sells.
    if (!axisReaches(id, selectedChar)) return false;
    const result = purchase({ feathers: _feathers, levels: _levels }, id);
    if (result.kind !== 'bought') return false;
    _feathers = result.progress.feathers;
    _levels   = result.progress.levels;
    _save();
    return true;
  }

  function draw() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
    _scanSweep('rgba(57,255,20,0.022)', 80);
    _cornerFrame('#0d4d04');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Title
    ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#39FF14'; ctx.font = '24px "Courier New", monospace';
    ctx.fillText('── UPGRADES ──', CONFIG.canvasW / 2, 60);
    ctx.shadowBlur = 0;

    // Wallet
    ctx.font = '14px "Courier New", monospace';
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#FFB400';
    ctx.fillText(`◆ ${_feathers}  FEATHERS  (persists across runs)`, CONFIG.canvasW / 2, 96);
    ctx.shadowBlur = 0;

    // The rows come off the shared list geometry, which is also what the
    // talent shop reads. The pitch still shrinks to fit however many upgrades
    // the table holds; what changed is the width, which was a literal 560 px
    // whatever the canvas was — comfortable on the 1056 it was authored
    // against, a third of a 1760 one with the rest of the screen empty.
    const rows = _shopRows(UPGRADE_ORDER.length);

    // Upgrade rows
    UPGRADE_ORDER.forEach((id, i) => {
      const u     = UPGRADES[id];
      const lv    = levelOf(_levels, id);
      const sel   = i === _cursor;
      const maxed = isMaxed(_levels, id);
      const cost  = nextCost(_levels, id);
      // Whether this axis does anything for the hero being played. Said on the
      // row rather than only on the refusal, so the player reads it before
      // spending the keypress rather than after.
      const live  = axisReaches(id, selectedChar);
      const row   = rows[i];
      const oy    = row.midY;
      const barX  = row.x + 20;
      const barR  = row.x + row.w - 20;

      if (sel) {
        ctx.fillStyle = 'rgba(57,255,20,0.08)';
        ctx.fillRect(row.x, row.y, row.w, row.h);
        ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 14;
      }

      // Label
      ctx.textAlign = 'left';
      ctx.fillStyle = !live ? '#7a8877' : sel ? '#39FF14' : '#1a7a08';
      ctx.font = '19px "Courier New", monospace';
      ctx.fillText(u.label, barX, oy - 12);

      // Level pips (right-aligned)
      ctx.textAlign = 'right';
      ctx.fillStyle = !live ? '#5c6b59' : maxed ? '#FFB400' : (sel ? '#39FF14' : '#1a7a08');
      ctx.fillText('■'.repeat(lv) + '□'.repeat(maxLevel(id) - lv), barR, oy - 12);

      // Description
      ctx.textAlign = 'left';
      ctx.font = '12px "Courier New", monospace';
      ctx.fillStyle = live ? '#0a5a08' : '#5c6b59';
      ctx.fillText(u.desc, barX, oy + 12);

      // Cost / MAXED / nothing for this hero
      ctx.textAlign = 'right';
      if (!live) {
        // The levels still count for the heroes it does reach, so this says
        // "not for you" and not "not worth buying".
        ctx.fillStyle = '#7a8877';
        ctx.fillText(`NOTHING FOR THE ${selectedChar.toUpperCase()}`, barR, oy + 12);
      } else if (maxed) {
        ctx.fillStyle = '#FFB400';
        ctx.fillText('◆ MAXED', barR, oy + 12);
      } else {
        ctx.fillStyle = _feathers >= cost ? '#FFB400' : '#5a3a00';
        ctx.fillText(`◆ ${cost}`, barR, oy + 12);
      }
      ctx.shadowBlur = 0;
    });

    // #0d4d04 is 2.1:1 against black; #6f8a6c is 5.5:1, and is what the
    // selection screens settled on for the same line.
    ctx.textAlign = 'center'; ctx.font = '13px "Courier New", monospace'; ctx.fillStyle = '#6f8a6c';
    ctx.fillText('↑ ↓  NAVIGATE    ENTER  PURCHASE    [T]  TALENTS    [B]  BACK',
      CONFIG.canvasW / 2, CONFIG.canvasH - 22);
  }

  return { init, onCrowKill, maxHP, pfRange, speed, wallet, spend, grant, levels, wardStart, applyToGame, moveCursor, buyCurrent, draw };
})();

// ── HANDICAP: configurable rubber-band difficulty (0 = off, 100 = full) ───────

/**
 * Refuses to load a tree whose numeric talents are not all wired to a CONFIG
 * figure. `TALENTS.stat` would otherwise read `CONFIG[undefined]`, hand back
 * NaN, and pass it to whatever consumer asked — a brace that never fills, a
 * chain radius that matches nothing. Loud here, like TALENT_LOOK's own check.
 */
function assertTalentStatsWired(stats) {
  for (const [char, charTree] of Object.entries(CHAR_TREES)) {
    for (const spec of charTree.talents) {
      if (spec.effect.kind !== 'linear') continue;
      if (!stats[spec.id]) throw new Error(`TALENTS.STATS has no row for '${char}.${spec.id}'`);
    }
  }
}

// ── TALENTS: per-character trees, mastery, and the run draft ──────────────────
//
// The trees, the gate arithmetic and the draft rule live in ../sim/talents.ts,
// pure and checkable without a canvas — the FEATHERS split, applied again.
// What stays here is what needs the browser or the run: the save file, the
// mastery awards, the run's drafted set, the rite's seal, and the effective
// figures the wizard's kit reads.
const TALENTS = (() => {
  const LS_KEY = 'crow_archer_talents_v1';

  let _bank = talentBankFrom(null);
  // The run layer. Never saved: a draft and a sealed capstone are this run's
  // only, which is the whole reason ownership grows options rather than power.
  let _drafted = [];
  let _capstone = null;
  // The shop screen's cursor, and the note it prints under the rows. The note
  // is a purchase result rather than a string, so the screen decides its own
  // wording and this module never grows a copy of the screen's vocabulary.
  // It clears on any move, which is why it needs no timer: a message that
  // outlives the thing it is about is worse than none.
  let _cursor = 0;
  let _lastBuy = null;

  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_bank)); } catch (_) {}
  }

  function init() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) _bank = talentBankFrom(JSON.parse(raw));
    } catch (_) { /* a hostile save reads as a fresh one */ }
  }

  function tree()  { return CHAR_TREES[selectedChar]; }
  function state() { return _bank[selectedChar]; }

  /** Banks a run milestone for the character playing it. */
  function award(milestone) {
    _addMastery(masteryAfter(0, [milestone]));
  }

  /** Banks what a boss of this kind is worth. See BOSS_MASTERY. */
  function awardBoss(kind) {
    _addMastery(bossMastery(kind));
  }

  /** Adds to what has been earned. `spent` is untouched: earning never pays
   *  off a debt, it just widens the gap the purse is measured across. */
  function _addMastery(points) {
    const s = state();
    _bank[selectedChar] = { mastery: s.mastery + points, spent: s.spent, levels: s.levels };
    _save();
  }

  /** Mastery this character can still spend. */
  function purse() { return masteryAvailable(state()); }

  /** Where the shop cursor sits, clamped to the tree actually on screen -
   *  characters can be switched between visits and the trees need not be the
   *  same length. */
  function cursor() { return clampCursor(tree().talents.length, _cursor); }

  /** Moves the cursor and drops the note the last purchase left. */
  function moveCursor(dir) {
    const n = tree().talents.length;
    if (n === 0) return;
    _cursor = (cursor() + dir + n) % n;
    _lastBuy = null;
  }

  /** Puts the cursor on a row outright, for a click. */
  function setCursor(i) {
    const n = tree().talents.length;
    if (n === 0 || i < 0 || i >= n) return;
    _cursor = i;
    _lastBuy = null;
  }

  /** The last purchase attempt, or null. The screen reads its `kind`. */
  function lastBuy() { return _lastBuy; }

  /** Buys whatever the cursor is on, and keeps the answer for the screen. */
  function buyCurrent() {
    const spec = tree().talents[cursor()];
    if (!spec) return null;
    _lastBuy = buy(spec.id);
    return _lastBuy;
  }

  /**
   * Buys with mastery. Feathers are the upgrade tree's currency and are not
   * touched here: two ladders funded from one purse would have the player
   * choosing between a talent and a heart, which is not the choice either
   * tree was built to ask.
   */
  function buy(id) {
    const result = purchaseTalent(tree(), state(), id);
    if (result.kind !== 'bought') return result;
    _bank[selectedChar] = result.state;
    _save();
    return result;
  }

  /** Test-only ladder bypass — this module's healHero. */
  function grant(id, level) {
    const s = state();
    _bank[selectedChar] = { mastery: s.mastery, spent: s.spent, levels: { ...s.levels, [id]: level } };
  }

  /** The same bypass for mastery, so a screen can be staged without playing
   *  the four milestones that would otherwise be the only way to a rank. */
  function grantMastery(points) {
    const s = state();
    // Sets what has been EARNED and clears the debt with it, so a staged rank
    // is also a full purse -- a test that wants rank III wants to be able to
    // spend at it, and clamping `spent` to the new total is what the save
    // loader would do anyway.
    const mastery = Math.max(0, Math.trunc(points));
    _bank[selectedChar] = { mastery, spent: Math.min(s.spent, mastery), levels: s.levels };
  }

  function resetRun() { _drafted = []; _capstone = null; applyToRun(); }
  function draft(id) { if (!_drafted.includes(id)) _drafted.push(id); applyToRun(); }
  function drafted() { return _drafted.slice(); }
  function offers(count) { return draftOffers(ownedIds(tree(), state()), Math.random, count, _drafted); }
  function sealCapstone(id) { _capstone = id; }
  function capstoneActive(id) { return _capstone === id; }

  /**
   * Every talent that scales a CONFIG number, and which number it scales.
   *
   * A table rather than an accessor apiece, for the reason design-patterns.md
   * opens with: a fourteenth numeric talent is a row here, not a fourteenth
   * near-identical function. `min` is a floor where the arithmetic would
   * otherwise run a figure to zero or past it — a brace that fills in no time
   * is not a talent, it is a divide by zero waiting to happen.
   */
  const STATS = {
    focusDepth:  { key: 'wizFocusMax' },
    blinkReach:  { key: 'wizBlinkDistance' },
    stormWidth:  { key: 'stormBlastRadius' },
    // Keyed on the SHARED chain window on purpose: the wizard's window is the
    // common base plus what he bought, so the base keeps its one home. The
    // knight's charge reads CONFIG.shiftChainSecs straight and is untouched
    // by this -- a talent in the wizard's tree must not widen the knight's
    // window, and routing him through stat() is how that would happen.
    heldStep:    { key: 'shiftChainSecs' },
    thirdStep:   { key: 'wizBlinkMaxHops' },
    longThrow:   { key: 'dynamiteSpeed' },
    // Floors, where the arithmetic would otherwise run a figure to zero or
    // past it. A draw that completes in no time is not a talent, and a block
    // that is never on cooldown is not a cooldown.
    fullDraw:    { key: 'archerDrawMaxSecs', min: 0.4 },
    towerGuard:  { key: 'knightBlockCooldown', min: 4 },
    longReach:   { key: 'knightSpearRange' },
    wideNet:     { key: 'netRadiusBonus' },
    fourthBolt:  { key: 'crossbowBoltCount' },
    widerFan:    { key: 'sapperBarrageCount' },
    shortFuse:   { key: 'sapperChargeCooldown', min: 0.6 },
    setFeet:     { key: 'braceFillSecs', min: 0.35 },
    deepRoots:   { key: 'braceDrainMult', min: 1 },
    splitShaft:  { key: 'archerPowerPierce' },
    deeperCut:   { key: 'knightBloodlustPer' },
    fourthBlood: { key: 'knightBloodlustMax' },
    lightFoot:   { key: 'rangerMomentumFullPx', min: 120 },
    longWind:    { key: 'rangerMomentumDecaySecs' },
    fullTilt:    { key: 'rangerMomentumMax' },
    longFuse:    { key: 'sapperChainRadius' },
    moreLinks:   { key: 'sapperChainMaxLinks' },
  };

  /** A talent's effective figure: its CONFIG base, plus the levels this run
   *  drafted. Undrafted and unowned both come back as the base. */
  function stat(id) {
    const row = STATS[id];
    const value = draftedValue(tree(), state(), _drafted, id, CONFIG[row.key]);
    return row.min === undefined ? value : Math.max(row.min, value);
  }

  assertTalentStatsWired(STATS);

  /** An unlock talent, held only if this run drafted it. */
  function held(id) { return draftedHeld(tree(), state(), _drafted, id); }

  function stormCooldown() { return capstoneActive('stormcaller') ? CONFIG.stormCooldown / 2 : CONFIG.stormCooldown; }

  function applyToRun() {
    // The one CONFIG field talents move, moved the way FEATHERS.applyToGame
    // moves arrow capacity: effective = base + drafted, re-derived in full so
    // runs never compound onto each other.
    CONFIG.resources.focus.max = stat('focusDepth');
  }

  return {
    init, state, award, awardBoss, purse, buy, grant, grantMastery,
    resetRun, draft, drafted, offers, sealCapstone, capstoneActive,
    stat, held, stormCooldown, applyToRun,
    cursor, moveCursor, setCursor, buyCurrent, lastBuy,
  };
})();

const HANDICAP = (() => {
  // Returns a multiplier applied to crow speed each frame.
  // Low HP  → crows slow down (mercy assist).
  // Full HP → crows speed up very slightly (pressure reward).
  function crowSpeedMod() {
    if (!CONFIG.handicap) return 1;
    const hpFrac   = playerHP / FEATHERS.maxHP();
    const severity = Math.max(0, 1 - hpFrac * 1.5) * (CONFIG.handicap / 100);
    if (hpFrac >= 1) return 1 + (CONFIG.handicap / 100) * 0.12; // full-HP pressure
    return 1 - severity * 0.30;
  }

  // Extra flat drop probability when HP is low.
  function dropBoost() {
    if (!CONFIG.handicap) return 0;
    const hpFrac   = playerHP / FEATHERS.maxHP();
    const severity = Math.max(0, 1 - hpFrac * 1.5) * (CONFIG.handicap / 100);
    return severity * 0.35;
  }

  return { crowSpeedMod, dropBoost };
})();

// ── BOUNTIES: rotating micro-objectives tied to STREAK counters ───────────────
const BOUNTIES = (() => {
  const POOL = [
    { id: 'double_kill', label: 'Double Tap',    desc: 'Land a Double Kill',    done: () => STREAK.multiCount >= 2, reward: { type: 'ricochet', count: 3 } },
    { id: 'triple_kill', label: 'Triple Threat', desc: 'Land a Multi Kill (3+)',done: () => STREAK.multiCount >= 3, reward: { type: 'fire',     count: 3 } },
    { id: 'spree_3',     label: 'On A Roll',     desc: 'Reach a 3-kill streak', done: () => STREAK.spreeCount >= 3, reward: { type: 'arrows',   count: 5 } },
    { id: 'spree_5',     label: 'Rampage',       desc: 'Reach a 5-kill streak', done: () => STREAK.spreeCount >= 5, reward: { type: 'shield'              } },
    { id: 'streak_10',   label: 'Carnage',       desc: 'Reach a 10-kill streak',done: () => STREAK.spreeCount >= 10,reward: { type: 'ricochet', count: 5 } },
  ];

  let _active = [], _done = new Set(), _toast = null;

  function _grant(reward) {
    if      (reward.type === 'ricochet') inv.ricochetArrows += reward.count;
    else if (reward.type === 'fire')     inv.fireArrows     += reward.count;
    else if (reward.type === 'shield')   playerShield = true;
    else if (reward.type === 'arrows')   inv.arrows = Math.min(CONFIG.resources.arrows.max, inv.arrows + reward.count);
  }

  function _refill() {
    while (_active.length < 2) {
      const next = POOL.find(b => !_done.has(b.id) && !_active.some(a => a.id === b.id));
      if (!next) break;
      _active.push(next);
    }
  }

  function update(dt) {
    if (_toast) { _toast.timer -= dt; if (_toast.timer <= 0) _toast = null; }
    for (let i = _active.length - 1; i >= 0; i--) {
      const b = _active[i];
      if (_done.has(b.id)) { _active.splice(i, 1); continue; }
      if (b.done()) {
        _done.add(b.id);
        _grant(b.reward);
        _toast = { text: `BOUNTY: ${b.label}!`, timer: 2.5 };
        playSound(sndPickup);
        _active.splice(i, 1);
        _refill();
      }
    }
  }

  function draw() {
    // Active bounties — top-left panel below HUD
    if (_active.length > 0) {
      const baseY = CONFIG.hudHeight + 8;
      ctx.font = '10px "Courier New", monospace';
      ctx.textAlign = 'left';
      _active.forEach((b, i) => {
        const oy = baseY + i * 20;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.50)'; ctx.fillRect(4, oy - 7, 194, 16);
        ctx.fillStyle = '#185a10';
        ctx.fillText(`▸ ${b.desc}`, 9, oy + 2);
        ctx.restore();
      });
    }
    // Completion toast — centred near bottom
    if (_toast) {
      const TOTAL  = 2.5;
      const fadeIn  = Math.min(1, (TOTAL - _toast.timer) / 0.25);
      const fadeOut = Math.min(1, _toast.timer / 0.4);
      const alpha   = Math.min(fadeIn, fadeOut);
      const ty      = CONFIG.canvasH - 56;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(CONFIG.canvasW / 2 - 190, ty - 14, 380, 28);
      ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#39FF14';
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(_toast.text, CONFIG.canvasW / 2, ty);
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  function reset() {
    _done = new Set(); _active = []; _toast = null; _refill();
  }

  return { update, draw, reset };
})();

// ── RENDER ────────────────────────────────────────────────────────────────────

const shake = new ScreenShake();

function triggerShake(mag, ms) { shake.trigger(mag, ms); }
function updateShake(dt)       { shake.update(dt); }
function shakeOffset(t)        { return shake.offset(t); }

const tileLayout  = { tileSize: CONFIG.tileSize, hudHeight: CONFIG.hudHeight };
// Each builds its own offscreen canvas, so boot() constructs them.
let tileLayer = null;
let tileOverlay = null;
let vignetteCanvas = null;

function drawTiles() {
  tileLayer.draw(ctx);
  tileOverlay.draw(ctx, loopT, waterPhase);
}

function drawWizard() {
  const px = player.x, py = player.y + CONFIG.hudHeight, f = player.facing;

  // Purple aim line
  ctx.save();
  ctx.setLineDash([4,3]); ctx.lineWidth = 1.5;
  const aLen = 110;
  const lx1 = px + Math.cos(player.aimAngle)*aLen, ly1 = py + Math.sin(player.aimAngle)*aLen;
  const ag = ctx.createLinearGradient(px, py, lx1, ly1);
  ag.addColorStop(0,'rgba(136,136,255,0.45)'); ag.addColorStop(1,'rgba(136,136,255,0)');
  ctx.strokeStyle = ag; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(lx1,ly1); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();

  // Hit flash ghost
  if (playerHitFlash > 0.15) {
    const off = Math.round(playerHitFlash * 5);
    ctx.save(); ctx.globalAlpha = 0.30;
    ctx.fillStyle='#ff0000'; ctx.fillRect(px-6+off, py-14, 12, 20);
    ctx.fillStyle='#0044ff'; ctx.fillRect(px-6-off, py-14, 12, 20);
    ctx.restore();
  }

  ctx.save(); ctx.translate(px, py); ctx.scale(f, 1);
  const wLocalAngle = f === 1 ? player.aimAngle : Math.PI - player.aimAngle;
  const flashOn = playerHitFlash > 0 && Math.floor(playerHitFlash*20)%2===0;

  // Ground shadow
  ctx.fillStyle='rgba(0,0,0,0.40)';
  ctx.beginPath(); ctx.ellipse(0,10,10,2.5,0,0,Math.PI*2); ctx.fill();

  // Pixel-art body (see buildWizardGrid), three stride frames off walk phase.
  const wFrame = animFrame3(player.walkPhase || 0);
  const wgrid = buildWizardGrid(wFrame, SP_TRIM.wizard);
  const wBob = Math.abs(Math.sin(player.walkPhase || 0)) > 0.5 ? 0 : -1;
  const wSpriteDx = -(WIZARD_SPRITE.w) / 2, wSpriteDy = -22 + wBob;
  const wCanvas = flashOn
    ? spriteFlashCanvas(`wizard|${wFrame}`, wgrid, WIZARD_SPRITE.w, WIZARD_SPRITE.h, '#ffffff')
    : spriteCanvas(`wizard|${SP_TRIM.wizard}|${wFrame}`, wgrid, WIZARD_SPRITE.w, WIZARD_SPRITE.h);
  ctx.drawImage(wCanvas, wSpriteDx, wSpriteDy);

  // The staff is not part of the body grid: it turns to the aim, and the orb
  // on its end is where the bolt cooldown is reported. One painter, shared
  // with the multiplayer renderer, so the two cannot drift.
  // Broom or staff, never both: with the pool dry the staff is inert and the
  // broom is what he is actually swinging, so showing the orb would promise a
  // bolt he cannot cast.
  if (pfSwing > 0 || (inv.focus < CONFIG.wizFocusBolt && wizOverchannel <= 0)) {
    paintWizardBroom(ctx, {
      aim: wLocalAngle,
      swing: pfSwing > 0 ? 1 - pfSwing / CONFIG.pitchforkSwingDuration : -1,
      readiness: pfCooldown > 0 ? 'recharging' : 'ready',
      wash: (c) => c,
    });
  } else {
    paintWizardStaff(ctx, {
      aim: wLocalAngle,
      t: loopT,
      cooldown: wizBoltCD > 0 ? 1 - wizBoltCD / CONFIG.wizBoltCooldown : null,
      wash: (c) => c,
    });
  }

  // Shield halo
  if (playerShield) {
    const shP = loopT*4;
    ctx.shadowColor='#FFB400'; ctx.shadowBlur=14+5*Math.sin(shP);
    ctx.strokeStyle=`rgba(255,180,0,${(0.6+0.3*Math.sin(shP)).toFixed(2)})`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,-6,19+Math.sin(shP*1.3),0,Math.PI*2); ctx.stroke();
    ctx.shadowBlur=0;
  }
  ctx.restore();

  // Storm cooldown bar (world-space, above wizard)
  if (stormCD > 0) {
    const frac = 1 - stormCD / TALENTS.stormCooldown(), bw=34, bh=4, bx=px-bw/2, by2=py-38;
    ctx.fillStyle='#0a0a2a'; ctx.fillRect(bx,by2,bw,bh);
    ctx.fillStyle='#4444ff'; ctx.fillRect(bx,by2,bw*frac,bh);
    ctx.strokeStyle='#8888ff'; ctx.lineWidth=0.5; ctx.strokeRect(bx,by2,bw,bh);
  } else {
    ctx.save(); ctx.globalAlpha=0.55+0.25*Math.sin(loopT*3);
    ctx.font='10px "Courier New",monospace'; ctx.textAlign='center';
    ctx.fillStyle='#8888FF'; ctx.fillText('STORM',px,py-35);
    ctx.restore();
  }
}

/**
 * Drawn over whichever character is selected, while playerFrozenTimer is up.
 * A separate pass rather than a branch inside drawPlayer/drawWizard/
 * drawKnight/drawRanger, so the freeze reads the same on every character
 * without touching four separate draw functions for one shared status.
 */
/**
 * Venom tell: a sickly green haze and a few rising motes, plus a bar of the
 * remaining duration under the feet.
 *
 * Deliberately not the freeze ring's shape. Both can be up at once, and two
 * rings pulsing at different rates around one body is unreadable.
 */
function drawPlayerPoisonOverlay() {
  const px = player.x, py = player.y + CONFIG.hudHeight;
  const frac = Math.min(1, playerPoison.timer / CONFIG.ratPoisonSecs);
  const pulse = 0.5 + 0.5 * Math.sin(loopT * 7);
  ctx.save(); ctx.translate(px, py);
  ctx.globalAlpha = 0.20 + 0.12 * pulse;
  ctx.shadowColor = '#6ABF2A'; ctx.shadowBlur = 10;
  ctx.fillStyle = '#6ABF2A';
  ctx.beginPath(); ctx.arc(0, -3, 14, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  // Motes drifting up off the body
  for (let k = 0; k < 4; k++) {
    const t = (loopT * 0.6 + k / 4) % 1;
    const mx = Math.sin((k * 2.3) + loopT * 2) * 7;
    ctx.globalAlpha = (1 - t) * 0.75;
    ctx.fillStyle = k % 2 ? '#9BE04A' : '#4E8F1E';
    ctx.fillRect(mx, -4 - t * 16, 2, 2);
  }
  ctx.globalAlpha = 1;
  // Duration bar, under the feet so it never sits where the charge bar goes.
  const bw = 20, bh = 2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(-bw/2, 13, bw, bh);
  ctx.fillStyle = '#6ABF2A'; ctx.fillRect(-bw/2, 13, bw * frac, bh);
  ctx.restore();
}

function drawPlayerFrozenOverlay() {
  const px = player.x, py = player.y + CONFIG.hudHeight;
  const pulse = 0.5 + 0.5 * Math.sin(loopT * 5);
  ctx.save(); ctx.translate(px, py);
  ctx.shadowColor = '#40D0F0'; ctx.shadowBlur = 10 + 4 * pulse;
  ctx.strokeStyle = `rgba(64,208,240,${(0.6 + 0.3*pulse).toFixed(2)})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -2, 15 + pulse, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur = 0;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + loopT * 1.5;
    const sx = Math.cos(a) * 15, sy = -2 + Math.sin(a) * 15;
    ctx.fillStyle = '#A0E8FF';
    ctx.fillRect(sx - 1, sy - 1, 2, 2);
  }
  ctx.restore();
}

// ── PIXEL SPRITES ────────────────────────────────────────────────────────────
// Hand-authored pixel art: a small logical grid, one hex color or null per
// cell, built once and cached, then blitted at an integer scale so pixels
// stay crisp squares (no smoothing, no sub-pixel positions). This is Phase 1
// of the pixel-art overhaul (the Archer only) — see docs/design-patterns.md
// for why later phases add a table entry per character/tile kind here
// instead of a growing if/else chain.

function drawPlayer() {
  if (selectedChar === 'wizard') { drawWizard(); return; }
  if (selectedChar === 'knight') { drawKnight(); return; }
  if (selectedChar === 'ranger') { drawRanger(); return; }
  if (selectedChar === 'sapper') { drawSapper(); return; }
  const px = player.x, py = player.y + CONFIG.hudHeight, f = player.facing;

  drawAimLine(px, py);
  drawHitFlashGhost(px, py);

  ctx.save(); ctx.translate(px, py); ctx.scale(f, 1);
  const localAngle = f === 1 ? player.aimAngle : Math.PI - player.aimAngle;
  const flashOn = playerHitFlash > 0 && Math.floor(playerHitFlash * 20) % 2 === 0;

  // Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 10, 10, 2.5, 0, 0, Math.PI*2); ctx.fill();

  // Pixel-art body (see buildArcherGrid). The reference bow is baked into the
  // grid rather than rotated with aim, matching the rest of the aim feedback
  // this game already draws (drawAimLine, the per-character reticle) rather
  // than duplicating it on the sprite itself.
  const aFrame = animFrame3(player.walkPhase || 0);
  const grid = buildArcherGrid(aFrame, SP_TRIM.archer);
  const spriteScale = 1;
  const spriteDx = -(ARCHER_SPRITE.w * spriteScale) / 2;
  // The body rises as the legs pass and drops on each contact, twice a stride.
  // Whole pixels: a sprite on a half pixel is a sprite with a blurred edge.
  const aBob = Math.abs(Math.sin(player.walkPhase || 0)) > 0.5 ? 0 : -1;
  const spriteDy = -22 + aBob;
  const archerCanvas = flashOn
    ? spriteFlashCanvas(`archer|${aFrame}`, grid, ARCHER_SPRITE.w, ARCHER_SPRITE.h, '#ffffff', spriteScale)
    : spriteCanvas(`archer|${SP_TRIM.archer}|${aFrame}`, grid, ARCHER_SPRITE.w, ARCHER_SPRITE.h, spriteScale);
  ctx.drawImage(archerCanvas, spriteDx, spriteDy);
  // The bow is not part of the body grid: it swings to the aim, bends through a
  // held power shot and snaps forward on release. One painter, shared with the
  // multiplayer renderer, so the two cannot drift.
  paintArcherBow(ctx, {
    aim: localAngle,
    draw: archerDrawFrac(),
    recoil: archerLoose / ARCHER_LOOSE_SECS,
    trim: SP_TRIM.archer,
    wash: (colour) => (flashOn ? '#ffffff' : colour),
  });

  // Shield halo
  if (playerShield) {
    const shP = loopT * 4;
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 14 + 5 * Math.sin(shP);
    ctx.strokeStyle = `rgba(255,180,0,${(0.6 + 0.3 * Math.sin(shP)).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -6, 19 + Math.sin(shP * 1.3), 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const hasArrows = hasShaft();
  if (!hasArrows) drawPitchfork(localAngle);
  ctx.restore();

  if (!hasArrows) drawPitchforkIndicators(px, py);

  // Dynamite charge bar
  // The draw wins the bar when both are somehow live: it is the one on a
  // cooldown, so it is the one whose timing the player is reading.
  if (archerDraw.on) drawChargeBar(px, py, archerDrawFrac());
  else if (charge.on) drawChargeBar(px, py, Math.min(1, (performance.now() - charge.t0) / 1000));
}

/** Windup meter above a character's head. Shared by the archer's dynamite and
 * the knight's charge; both fill over their own hold and glow once full. */
function drawChargeBar(px, py, frac) {
  const bw = 28, bh = 4, bx = px - bw/2, by = py - 34;
  ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = frac < 0.5 ? '#ffcc00' : frac < 0.85 ? '#ff8800' : '#ff2200';
  if (frac >= 1) { ctx.shadowColor = '#ff2200'; ctx.shadowBlur = 6 + 3 * Math.sin(loopT * 18); }
  ctx.fillRect(bx, by, bw * frac, bh);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#555'; ctx.lineWidth = 0.5; ctx.strokeRect(bx, by, bw, bh);
}

/** Dotted aim line with a sniper-mode reticle. Shared by every character that
 * draws one — today the archer and the ranger, the game's two marksmen. */
function drawAimLine(px, py) {
  // A drawn bow gets the same long line the sapper's sniper mode does: it was
  // always the good half of that mode, and it is what an archer standing still
  // is standing still for.
  const aiming = archerDraw.on;
  const aimLen = aiming ? 220 : 80, aimAlpha = aiming ? 0.75 : 0.38;
  const aimRGB = aiming ? '255,255,60' : '170,255,68';
  ctx.save();
  ctx.setLineDash(aiming ? [5,3] : [3,4]); ctx.lineWidth = aiming ? 1.5 : 1;
  const lx1 = px + Math.cos(player.aimAngle)*aimLen, ly1 = py + Math.sin(player.aimAngle)*aimLen;
  const aimGrad = ctx.createLinearGradient(px, py, lx1, ly1);
  aimGrad.addColorStop(0, `rgba(${aimRGB},${aimAlpha})`);
  aimGrad.addColorStop(1, `rgba(${aimRGB},0)`);
  ctx.strokeStyle = aimGrad;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(lx1, ly1); ctx.stroke();
  ctx.setLineDash([]);
  if (aiming) {
    ctx.strokeStyle = `rgba(${aimRGB},0.7)`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lx1-7, ly1); ctx.lineTo(lx1+7, ly1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx1, ly1-7); ctx.lineTo(lx1, ly1+7); ctx.stroke();
    ctx.beginPath(); ctx.arc(lx1, ly1, 5, 0, Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}

/** Red/blue split-channel ghost, shown right after a hit. Shared for the same
 * reason as drawAimLine. */
function drawHitFlashGhost(px, py) {
  if (playerHitFlash <= 0.15) return;
  const off = Math.round(playerHitFlash * 5);
  ctx.save(); ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#ff0000'; ctx.fillRect(px - 5 + off, py - 7, 10, 14);
  ctx.fillStyle = '#0044ff'; ctx.fillRect(px - 5 - off, py - 7, 10, 14);
  ctx.restore();
}

/**
 * The ammo-out fallback melee weapon, drawn in local (translated/rotated)
 * sprite space. The archer and the ranger both fall back to it — same ammo
 * fields, same tryPitchfork() — so it is shared rather than copied.
 */
function drawPitchfork(localAngle) {
  // Pitchfork — three-phase swing: WIND-UP → STRIKE → RECOVER
  const prog = pfSwing > 0 ? 1 - pfSwing / CONFIG.pitchforkSwingDuration : -1;
  let sOff = 0;
  if      (prog >= 0    && prog < 0.28) sOff = -(prog / 0.28) * 0.9;
  else if (prog >= 0.28 && prog < 0.62) sOff = -0.9 + ((prog - 0.28) / 0.34) * 1.5;
  else if (prog >= 0.62)                sOff =  0.6  - ((prog - 0.62) / 0.38) * 0.6;
  const isStrike = prog >= 0.28 && prog < 0.62;
  const swingAngle = localAngle + sOff;
  const handX = Math.cos(localAngle) * 8, handY = Math.sin(localAngle) * 8;

  // Impact arc sweep — drawn behind the handle (before inner translate)
  if (isStrike) {
    const st = (prog - 0.28) / 0.34;
    const arcAlpha = (1 - st) * 0.75;
    const arcG = ctx.createLinearGradient(handX, handY,
      handX + Math.cos(swingAngle)*32, handY + Math.sin(swingAngle)*32);
    arcG.addColorStop(0, `rgba(255,255,255,${arcAlpha})`);
    arcG.addColorStop(1, 'rgba(57,255,20,0)');
    ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 6 * (1 - st);
    ctx.strokeStyle = arcG; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(handX, handY, 30, swingAngle - 0.5, swingAngle + 0.5);
    ctx.stroke(); ctx.shadowBlur = 0;
  }

  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(swingAngle);

  const onCooldown = pfCooldown > 0;
  const readyGlow  = !onCooldown && !isStrike;

  // Handle
  if (readyGlow) { ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 2 + Math.sin(loopT*4)*1.5; }
  ctx.strokeStyle = onCooldown ? '#4a3010' : '#8A6028'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(28, 0); ctx.stroke();
  // Handle highlight (1px top edge)
  ctx.shadowBlur = 0;
  ctx.strokeStyle = onCooldown ? '#2a1a08' : '#B58A4A'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(2, -0.5); ctx.lineTo(26, -0.5); ctx.stroke();

  // Crossbar + tines
  const tineCol = isStrike ? '#FFFFFF' : onCooldown ? '#666666' : '#C8C8C8';
  if (isStrike) { ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 12 + 8*Math.sin(loopT*20); }
  else if (readyGlow) { ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 3; }
  ctx.strokeStyle = tineCol; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(28, -5); ctx.lineTo(28, 5); ctx.stroke();
  for (let t = -1; t <= 1; t++) {
    ctx.beginPath(); ctx.moveTo(28, t*5); ctx.lineTo(36, t*5); ctx.stroke();
  }

  // Tine glints during STRIKE
  if (isStrike) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(35.5, -5.5, 1, 1);
    ctx.fillRect(35.5, -0.5, 1, 1);
    ctx.fillRect(35.5,  4.5, 1, 1);
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

/** Recharge ring, ready ring and strike sweep for the pitchfork fallback,
 * drawn in world space outside the sprite transform. Shared for the same
 * reason as drawPitchfork. */
function drawPitchforkIndicators(px, py) {
  // Recharge ring
  if (pfCooldown > 0) {
    const fill = 1 - pfCooldown / CONFIG.pitchforkCooldown;
    ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = '#5a4010'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 14, -Math.PI/2, -Math.PI/2 + fill * Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#8A6028'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, 14, -Math.PI/2, -Math.PI/2); ctx.stroke();
    ctx.restore();
  }
  // Ready ring — full circle; brightens when any crow is within range
  if (pfCooldown <= 0 && pfSwing <= 0) {
    const pfR  = FEATHERS.pfRange();
    const r2pf = pfR ** 2;
    const targetInRange = crows.some(c => dist2(player.x, player.y, c.x, c.y) < r2pf);
    const arcAlpha = targetInRange
      ? 0.30 + 0.18 * Math.abs(Math.sin(loopT * 7))
      : 0.07 + 0.04 * Math.sin(loopT * 2.5);
    const arcCol = targetInRange ? '#39FF14' : '#4a6630';
    ctx.save(); ctx.globalAlpha = arcAlpha;
    if (targetInRange) { ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 6; }
    ctx.strokeStyle = arcCol; ctx.lineWidth = targetInRange ? 2 : 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(px, py, pfR, 0, Math.PI * 2);
    ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.restore();
  }
  // Strike sweep arc — bright phosphor green flash at peak
  if (pfSwing > 0) {
    const pfR = FEATHERS.pfRange();
    const prog = 1 - pfSwing / CONFIG.pitchforkSwingDuration;
    if (prog >= 0.28 && prog < 0.75) {
      const st  = (prog - 0.28) / 0.47;
      const sOff2 = -0.9 + st * 1.5;
      const arcMid = player.aimAngle + sOff2 * player.facing;
      ctx.save(); ctx.globalAlpha = (1 - st) * 0.8;
      ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 10 * (1 - st);
      ctx.strokeStyle = '#39FF14'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(px, py, pfR * 0.82, arcMid - 0.32, arcMid + 0.32);
      ctx.stroke(); ctx.shadowBlur = 0; ctx.restore();
    }
  }
}

/**
 * The ranger. Built as the archer's own sibling — same cloaked-marksman
 * silhouette, same pitchfork fallback when ammo runs dry — with a hood
 * instead of a brimmed hat, a satchel pouch at the hip, and a crossbow's
 * crosswise limb and stock in place of the bow's curved arc.
 */

function drawRanger() {
  const px = player.x, py = player.y + CONFIG.hudHeight, f = player.facing;

  drawAimLine(px, py);
  drawHitFlashGhost(px, py);

  ctx.save(); ctx.translate(px, py); ctx.scale(f, 1);
  const localAngle = f === 1 ? player.aimAngle : Math.PI - player.aimAngle;
  const flashOn = playerHitFlash > 0 && Math.floor(playerHitFlash * 20) % 2 === 0;

  // 1. Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 9, 9, 2.5, 0, 0, Math.PI*2); ctx.fill();

  // 2. Pixel-art cloak/tunic/head/hood (see buildRangerGrid). The cloak's
  // walk sway is 3 baked frames off player.walkPhase, same technique as the
  // crow's flap and skeleton's stride, instead of a live per-frame offset.
  const rFrame = animFrame3(player.walkPhase || 0);
  const rGrid  = buildRangerGrid(rFrame, SP_TRIM.ranger);
  const rDx = -(RANGER_SPRITE.w) / 2, rDy = -22;
  const rCanvas = flashOn
    ? spriteFlashCanvas(`ranger|${rFrame}`, rGrid, RANGER_SPRITE.w, RANGER_SPRITE.h, '#ffffff')
    : spriteCanvas(`ranger|${SP_TRIM.ranger}|${rFrame}`, rGrid, RANGER_SPRITE.w, RANGER_SPRITE.h);
  ctx.drawImage(rCanvas, rDx, rDy);

  // Shield halo
  if (playerShield) {
    const shP = loopT * 4;
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 14 + 5 * Math.sin(shP);
    ctx.strokeStyle = `rgba(255,180,0,${(0.6 + 0.3 * Math.sin(shP)).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -1, 16 + Math.sin(shP * 1.3), 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const hasArrows = hasShaft();
  if (hasArrows) {
    // 6. Crossbow arm
    const gx = Math.cos(localAngle) * 8, gy = Math.sin(localAngle) * 8;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#D9B98A'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(gx, gy); ctx.stroke();

    // 7. Stock, along the aim line
    ctx.strokeStyle = '#5A3A1A'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(localAngle)*9, gy + Math.sin(localAngle)*9);
    ctx.stroke();

    // 8. Limb — a crosswise bar near the front of the stock, not a curved arc
    const limbX = gx + Math.cos(localAngle)*6, limbY = gy + Math.sin(localAngle)*6;
    const perpA = localAngle + Math.PI/2;
    const limbTop = { x: limbX + Math.cos(perpA)*6, y: limbY + Math.sin(perpA)*6 };
    const limbBot = { x: limbX - Math.cos(perpA)*6, y: limbY - Math.sin(perpA)*6 };
    ctx.strokeStyle = '#8A6028'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(limbTop.x, limbTop.y); ctx.lineTo(limbBot.x, limbBot.y); ctx.stroke();

    // 9. String — straight, offset in front of the limb rather than through it
    const so = 1.5;
    const strTop = { x: limbTop.x + Math.cos(localAngle)*so, y: limbTop.y + Math.sin(localAngle)*so };
    const strBot = { x: limbBot.x + Math.cos(localAngle)*so, y: limbBot.y + Math.sin(localAngle)*so };
    ctx.shadowColor = '#FFCC00'; ctx.shadowBlur = 4;
    ctx.strokeStyle = '#FFCC00'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(strTop.x, strTop.y); ctx.lineTo(strBot.x, strBot.y); ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    drawPitchfork(localAngle);
  }
  ctx.restore();

  if (!hasArrows) drawPitchforkIndicators(px, py);
}

function drawSapper() {
  const px = player.x, py = player.y + CONFIG.hudHeight, f = player.facing;

  drawAimLine(px, py);
  drawHitFlashGhost(px, py);

  ctx.save(); ctx.translate(px, py); ctx.scale(f, 1);
  const localAngle = f === 1 ? player.aimAngle : Math.PI - player.aimAngle;
  const flashOn = playerHitFlash > 0 && Math.floor(playerHitFlash * 20) % 2 === 0;

  // 1. Ground shadow, wider than the archer's: this one is built heavy
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 10, 11, 3, 0, 0, Math.PI*2); ctx.fill();

  // 2. Pixel-art keg/apron/helm (see buildSapperGrid), three stride frames off
  // walk phase, with the body bobbing twice a stride as the archer's does.
  const sFrame = animFrame3(player.walkPhase || 0);
  const sGrid = buildSapperGrid(sFrame, SP_TRIM.sapper);
  const sBob = Math.abs(Math.sin(player.walkPhase || 0)) > 0.5 ? 0 : -1;
  const sDx = -(SAPPER_SPRITE.w) / 2, sDy = -22 + sBob;
  const sCanvas = flashOn
    ? spriteFlashCanvas(`sapper|${sFrame}`, sGrid, SAPPER_SPRITE.w, SAPPER_SPRITE.h, '#ffffff')
    : spriteCanvas(`sapper|${SP_TRIM.sapper}|${sFrame}`, sGrid, SAPPER_SPRITE.w, SAPPER_SPRITE.h);
  ctx.drawImage(sCanvas, sDx, sDy);

  // 3. Shield halo
  if (playerShield) {
    const shP = loopT * 4;
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 14 + 5 * Math.sin(shP);
    ctx.strokeStyle = `rgba(255,180,0,${(0.6 + 0.3 * Math.sin(shP)).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -1, 17 + Math.sin(shP * 1.3), 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // 4. The charge held out along the aim, with a fuse that only burns while
  // one is ready to throw. A dead fuse is the cooldown, readable from the
  // sprite instead of only from the HUD chip.
  // Nothing in hand at all once the pouch is empty — the pitchfork is the
  // attack then, and a bomb still drawn there would be a lie.
  const held = inv.bombs > 0 || inv.fireBombs > 0 || inv.iceBombs > 0;
  const ready = sapperChargeCD <= 0 && held;
  const gx = Math.cos(localAngle) * 9, gy = Math.sin(localAngle) * 9;
  if (!held) { drawPitchfork(localAngle); ctx.restore(); return; }
  ctx.strokeStyle = '#D9B98A'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(gx, gy); ctx.stroke();

  ctx.fillStyle = '#3B3630';
  ctx.beginPath(); ctx.arc(gx, gy, 3.4, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#8A6A22'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(gx, gy, 3.4, 0, Math.PI*2); ctx.stroke();

  ctx.strokeStyle = '#1E1A16'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(gx, gy - 3); ctx.lineTo(gx + 1.5, gy - 6.5); ctx.stroke();
  if (ready) {
    const flare = 0.7 + 0.3 * Math.sin(loopT * 11);
    ctx.shadowColor = '#C6501B'; ctx.shadowBlur = 6 * flare;
    ctx.fillStyle = '#FF7A1A';
    ctx.beginPath(); ctx.arc(gx + 1.5, gy - 6.5, 1.4 * flare, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

/**
 * The windup telegraph: the wedge the dash will sweep, and the mark it will
 * end on, drawn behind the knight in the mirrored space his body is drawn in.
 *
 * Takes the context it paints into rather than reaching for the module's, the
 * way stamps.ts's painters already do, so what it asks the canvas for can be
 * read back with no canvas at all.
 */
function drawKnightChargeTelegraph(g, tele, facing) {
  g.save();
  drawKnightChargeReach(g, tele, mirrorAngle(tele.angle, facing));
  drawKnightChargeTravel(g, tele, facing);
  g.restore();
}

/**
 * The wedge itself: a dashed outline at its true reach, filled with streaks
 * converging on the blade.
 *
 * Every distance and angle is read off the telegraph, which carries the wedge
 * inKnightArc() hits with, so the drawn edge is the real edge. How hard the
 * charge is held shows in colour, alpha, glow and streak count, never in the
 * radius: reach does not grow with the hold, and a wedge that grew with it
 * would promise a range the dash never has.
 */
function drawKnightChargeReach(g, tele, ang) {
  const col = chargeCommitColour(tele.frac);
  const pulse = 0.7 + 0.3 * Math.sin(loopT * 4);
  g.strokeStyle = col; g.shadowColor = col;
  g.shadowBlur = 6 + 10 * tele.frac + (tele.frac >= 1 ? 6 * Math.sin(loopT * 18) : 0);
  // Dashed pie outline — the sapper reticle's blast-ring read, narrowed from
  // a circle to the wedge this actually reaches.
  g.globalAlpha = (0.3 + 0.5 * tele.frac) * pulse;
  g.lineWidth = 1.2 + 1.3 * tele.frac;
  g.setLineDash([4, 5]);
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, tele.radius, ang - tele.half, ang + tele.half);
  g.closePath();
  g.stroke();
  g.setLineDash([]);
  // Streaks converging on the blade: more of them, and livelier, near full.
  const streaks = 3 + Math.round(4 * tele.frac);
  for (let i = 0; i < streaks; i++) {
    const a = ang - tele.half + ((i + 0.5) / streaks) * tele.half * 2;
    const inner = tele.radius * (0.4 + 0.3 * Math.sin(loopT * (8 + 10 * tele.frac) + i * 1.7));
    const ca = Math.cos(a), sa = Math.sin(a);
    g.beginPath();
    g.moveTo(ca * inner, sa * inner);
    g.lineTo(ca * tele.radius, sa * tele.radius);
    g.stroke();
  }
}

/**
 * Where that wedge is carried to: a dashed line along the heading to the point
 * the dash stops at, ringed. Reuses drawAimLine's read — dashes fading out to
 * a mark — for the half of the commitment a fill bar cannot state, since the
 * dash drags the knight the length of this line whatever he does after
 * letting go.
 */
function drawKnightChargeTravel(g, tele, facing) {
  const col = chargeCommitColour(tele.frac);
  // The endpoint is a world position; the knight is drawn mirrored about his
  // own x. facing is ±1, so scaling the offset by it maps either way round.
  const lx = (tele.endX - player.x) * facing, ly = tele.endY - player.y;
  g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 4;
  g.globalAlpha = 0.3 + 0.4 * tele.frac;
  g.lineWidth = 1;
  g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(lx, ly); g.stroke();
  g.setLineDash([]);
  g.beginPath(); g.arc(lx, ly, 3.5, 0, Math.PI * 2); g.stroke();
}

// Same body shape, two palettes — the fire sword's "powered up" recolor of
// the whole knight, not just the blade. Mirrors SKELETON_PALETTES: one grid
// builder parameterized by kind rather than two near-duplicate functions.
//
// Reads as metal, not cloth: a genuine value jump from armorShadow to
// armorHi (dark-to-near-white), not just a slightly-lighter dark tone —
// pixel art has no gradients or glow to imply a reflective surface, so the
// contrast itself has to carry that read. Every plate (helm, pauldrons,
// chest) gets its own highlight rather than just one patch on the chest.

function drawKnight() {
  const px = player.x, py = player.y + CONFIG.hudHeight, f = player.facing;
  ctx.save(); ctx.translate(px, py); ctx.scale(f, 1);

  // ── Whirlwind visual (behind player) ────────────────────────────────────
  if (knightWhirlwindTimer > 0) {
    const wAlpha  = Math.min(1, knightWhirlwindTimer / 0.4);
    const fsColor = inv.knightFireSwordTimer > 0;
    for (let i = 0; i < 3; i++) {
      const baseA = loopT * 9 + (i / 3) * Math.PI * 2;
      ctx.save();
      ctx.globalAlpha = wAlpha * (0.45 + 0.3 * Math.sin(loopT * 14 + i * 2.1));
      ctx.strokeStyle = fsColor ? '#FF7A1F' : '#A0B8E8';
      ctx.shadowColor  = fsColor ? '#FF5500' : '#6080C0';
      ctx.shadowBlur   = 10;
      ctx.lineWidth    = 3;
      const r = CONFIG.knightWhirlwindRadius;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.42, baseA,          baseA + 1.15); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.72, baseA + 0.38,   baseA + 1.55); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.93, baseA + 0.65,   baseA + 1.80); ctx.stroke();
      ctx.restore();
    }
  }

  // ── Charge windup: the wedge he is about to sweep, and where it lands him ─
  const telegraph = knightChargeTelegraph();
  if (telegraph) drawKnightChargeTelegraph(ctx, telegraph, f);

  // ── Dash sweep: the blade crossing the arc, left to right, while advancing
  if (knightDash.timer > 0) {
    const prog  = 1 - knightDash.timer / CONFIG.knightChargeDashDuration;
    const heavy = knightDash.frac;
    // The wedge inKnightArc() is hitting with this instant, drawn at its own
    // size. It used to be scaled down by how hard the charge was held, which
    // drew a shorter blade than the one landing the hits.
    const wedge = knightChargeWedge(knightDash.angle);
    const ang   = mirrorAngle(wedge.angle, f);
    const half  = wedge.half;
    const col   = chargeCommitColour(heavy);
    const r     = wedge.radius;
    // Three passes across the arc over the dash, so it reads as repeated swings.
    const sweep = (prog * 3) % 1;
    const edge  = ang - half + sweep * half * 2;
    const ce = Math.cos(edge), se = Math.sin(edge);
    ctx.save();
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10 + 8 * heavy;
    // Fading wedge behind the blade: where it has already passed this sweep.
    ctx.globalAlpha = 0.3 * (1 - sweep) + 0.15;
    ctx.lineWidth = 3 + 3 * heavy;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.85, ang - half, edge); ctx.stroke();
    // The blade itself.
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3 + 2 * heavy;
    ctx.beginPath();
    ctx.moveTo(ce * 8, se * 8);
    ctx.lineTo(ce * r, se * r);
    ctx.stroke();
    ctx.restore();
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(0, 14, 13, 4, 0, 0, Math.PI*2); ctx.fill();

  const bob      = Math.sin(player.walkPhase || 0) * 1.2;
  const fsActive = inv.knightFireSwordTimer > 0;
  const swing    = knightSpearSwing > 0 ? 1 - knightSpearSwing / CONFIG.knightSpearSwingDuration : -1;

  // Pixel-art body (see buildKnightGrid). bob is rounded to a whole pixel so
  // the sprite blit stays on-grid instead of a blurred sub-pixel position.
  const kKind = fsActive ? 'fireSword' : 'normal';
  const kTrim = fsActive ? SP_TRIM.knightFireSword : SP_TRIM.knightNormal;
  const kFrame = animFrame3(player.walkPhase || 0);
  const kgrid = buildKnightGrid(kKind, kFrame, kTrim);
  const kSpriteDx = -(KNIGHT_SPRITE.w) / 2, kSpriteDy = -22 + Math.round(bob);
  const kCanvas = spriteCanvas(`knight|${kKind}|${kTrim}|${kFrame}`, kgrid, KNIGHT_SPRITE.w, KNIGHT_SPRITE.h);
  ctx.drawImage(kCanvas, kSpriteDx, kSpriteDy);

  // Bloodlust, over the helm. Painted inside the mirrored transform, which is
  // safe only because the badge is symmetric about the body's centre — an
  // asymmetric tell here would flip with his heading and read as part of the
  // aim rather than as a status.
  paintBloodlust(ctx, {
    stacks: bloodlustStacks(knightBloodlust),
    t: loopT,
    wash: (c) => c,
  });

  // ── Weapon ───────────────────────────────────────────────────────────────
  const spearAng = mirrorAngle(player.aimAngle, f);
  // Thrust extension: peak offset = 22px forward, covers the full swing duration
  const thrustOffset = swing >= 0
    ? Math.sin(Math.min(swing, 1) * Math.PI) * 22 : 0;

  ctx.save();
  ctx.translate(Math.cos(spearAng) * thrustOffset, Math.sin(spearAng) * thrustOffset);
  ctx.rotate(spearAng);

  if (fsActive) {
    // Fire sword — broad blade, short, glowing
    const sLen = TALENTS.stat('longReach') * CONFIG.knightFireSwordRangeMult * 0.55;
    ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 14 + 5 * Math.sin(loopT * 10);
    ctx.fillStyle = '#FF3300';
    ctx.fillRect(4, -4, sLen, 8);                // blade
    ctx.fillStyle = '#FFB400';
    ctx.fillRect(4, -1.5, sLen * 0.85, 3);       // hot inner edge
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#888';
    ctx.fillRect(0, -6, 5, 12);                  // crossguard
    ctx.fillStyle = '#5a3a10';
    ctx.fillRect(-10, -2, 12, 4);                // grip
  } else {
    // Spear — long shaft + leaf-tip
    const sLen = TALENTS.stat('longReach') * 0.92;
    ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(sLen, 0); ctx.stroke();
    // Cross-binding wraps
    ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1.5;
    [-4, 4, 12].forEach(x => {
      ctx.beginPath(); ctx.moveTo(x, -3); ctx.lineTo(x, 3); ctx.stroke();
    });
    // Tip — leaf spearhead
    const tipGlow = swing >= 0.2 && swing < 0.72;
    ctx.fillStyle = tipGlow ? '#FFFFFF' : '#D0D0D8';
    if (tipGlow) { ctx.shadowColor = '#FFFFFF'; ctx.shadowBlur = 8; }
    ctx.beginPath();
    ctx.moveTo(sLen - 2, -5);
    ctx.lineTo(sLen + 16, 0);
    ctx.lineTo(sLen - 2, 5);
    ctx.closePath(); ctx.fill();
    // Spear ferrule (butt end cap)
    ctx.fillStyle = '#B0B0B8'; ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-10, -3); ctx.lineTo(-16, 0); ctx.lineTo(-10, 3);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // ── Cooldown/whirlwind ring ───────────────────────────────────────────────
  if (knightWhirlwindCD > 0 && knightWhirlwindTimer <= 0) {
    const fill = 1 - knightWhirlwindCD / CONFIG.knightWhirlwindCooldown;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#6080A0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, bob, 15, -Math.PI/2, -Math.PI/2 + fill * Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (knightWhirlwindCD <= 0 && knightWhirlwindTimer <= 0) {
    ctx.globalAlpha = 0.4 + 0.2 * Math.sin(loopT * 4);
    ctx.strokeStyle = '#6080FF'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, bob, 15, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Block: charging ring, or the shield itself once banked ────────────────
  // Unlike the other three characters' omnidirectional shield halo (pickup
  // luck, any angle), Block is self-charged and reads as a guard the knight
  // actually raises — an arc centered on spearAng (the same mirrored aim
  // angle the spear points along), not a full ring.
  if (!playerShield && knightBlockCD > 0) {
    const fill = 1 - knightBlockCD / TALENTS.stat('towerGuard');
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#FFB400'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, bob, 19, -Math.PI/2, -Math.PI/2 + fill * Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (playerShield) {
    const shP = loopT * 4;
    const halfArc = Math.PI * 0.4;
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 14 + 5 * Math.sin(shP);
    ctx.strokeStyle = `rgba(255,180,0,${(0.6 + 0.3 * Math.sin(shP)).toFixed(2)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, bob, 19 + Math.sin(shP * 1.3), spearAng - halfArc, spearAng + halfArc); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();

  // Outside the mirrored transform, so the bar never draws backwards.
  if (knightCharge.on) drawChargeBar(px, py, knightChargeFrac());
}

function drawArrows() {
  const HH = CONFIG.hudHeight;
  for (const a of arrows) {
    const angle = Math.atan2(a.vy, a.vx);

    // Ricochet trail ghosts
    if (a.type === 'ricochet' && a.trailHistory && a.trailHistory.length > 0) {
      for (let ti = 0; ti < a.trailHistory.length; ti++) {
        const th = a.trailHistory[ti];
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.45 - ti * 0.08);
        ctx.translate(th.x, th.y + HH); ctx.rotate(th.angle);
        ctx.fillStyle = '#39E0FF'; ctx.fillRect(-10, -0.5, 21, 1);
        ctx.restore();
      }
    }

    ctx.save(); ctx.translate(a.x, a.y + HH); ctx.rotate(angle);
    ctx.shadowBlur = 0;

    // A drawn shot has to read as heavier than a loosed one, whichever ammo
    // it spent: a bright streak behind the shaft, as long as the number of
    // bodies it can still pass through.
    if (a.power) {
      const pips = a.pierceLeft || 1;
      ctx.globalAlpha = 0.5;
      ctx.shadowColor = '#EAFF6A'; ctx.shadowBlur = 10;
      ctx.strokeStyle = '#EAFF6A'; ctx.lineWidth = 2 + pips;
      ctx.beginPath(); ctx.moveTo(-16 - 4 * pips, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    if (a.type === 'fire') {
      const fs = a.fireSeed || 0;
      // Rear flame ellipse (outer)
      const flameX   = -12 - 2 * Math.sin(loopT * 10);
      const flameRX  = 4 + Math.sin(loopT * 14 + fs);
      const flameSB  = 10 + 4 * Math.sin(loopT * 10 + fs);
      ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = flameSB;
      ctx.fillStyle = '#FF7A1F';
      ctx.beginPath(); ctx.ellipse(flameX, 0, Math.max(0.5, flameRX), 2.5, 0, 0, Math.PI*2); ctx.fill();
      // Inner flame
      ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#FFB400';
      ctx.beginPath(); ctx.ellipse(-11, 0, 2.5, 1.5, 0, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      // Shaft
      ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#FF7A1F'; ctx.fillRect(-10, -0.5, 21, 1);
      // Head
      ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 8 + 3 * Math.sin(loopT * 12 + fs);
      ctx.fillStyle = '#FFB400';
      ctx.beginPath(); ctx.moveTo(11,-2); ctx.lineTo(15,0); ctx.lineTo(11,2); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // Fletching
      ctx.strokeStyle = '#B23A00'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-10,-2); ctx.lineTo(-7,0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 2); ctx.lineTo(-7,0); ctx.stroke();

    } else if (a.type === 'ricochet') {
      // Shaft
      ctx.shadowColor = '#39E0FF'; ctx.shadowBlur = 4;
      ctx.fillStyle = '#39E0FF'; ctx.fillRect(-10, -0.5, 21, 1);
      // Head
      ctx.shadowColor = '#7AF0FF'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#7AF0FF';
      ctx.beginPath(); ctx.moveTo(11,-2); ctx.lineTo(15,0); ctx.lineTo(11,2); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // Fletching
      ctx.strokeStyle = '#1B7A8A'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-10,-2); ctx.lineTo(-7,0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 2); ctx.lineTo(-7,0); ctx.stroke();
      // Bounce pips — remaining bounces (max 3 shown)
      const bouncesLeft = Math.max(0, 6 - (a.bounces || 0));
      ctx.fillStyle = '#FFFFFF';
      for (let pip = 0; pip < Math.min(3, bouncesLeft); pip++) {
        ctx.fillRect(2 + pip * 2, -3, 1, 1);
      }

    } else if (a.type === 'javelin') {
      // Long spear shaft with leaf tip — silver/steel
      ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(14, 0); ctx.stroke();
      // Wrap bindings
      ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1.5;
      [-10, -3, 4].forEach(x => { ctx.beginPath(); ctx.moveTo(x, -3); ctx.lineTo(x, 3); ctx.stroke(); });
      // Leaf spearhead
      const pLeft = a.pierceLeft || 0;
      ctx.fillStyle = pLeft > 1 ? '#FFFFFF' : '#A0A0B0';
      if (pLeft > 1) { ctx.shadowColor = '#FFFFFF'; ctx.shadowBlur = 6; }
      ctx.beginPath();
      ctx.moveTo(12, -5); ctx.lineTo(26, 0); ctx.lineTo(12, 5);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // Ferrule
      ctx.fillStyle = '#888';
      ctx.beginPath(); ctx.moveTo(-18,-3); ctx.lineTo(-24,0); ctx.lineTo(-18,3); ctx.closePath(); ctx.fill();
      // Pierce pips (remaining pierces)
      ctx.fillStyle = '#39FF14';
      for (let p = 0; p < pLeft; p++) ctx.fillRect(3 + p * 3, -4, 2, 2);

    } else if (a.type === 'wiz_normal') {
      // Magic bolt — homing blue-purple orb
      const p2 = loopT*8 + (a.fireSeed||0);
      ctx.shadowColor='#8888FF'; ctx.shadowBlur=10+3*Math.sin(p2);
      ctx.fillStyle=`rgba(136,136,255,${(0.9+0.1*Math.sin(p2)).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(0,0,4+0.4*Math.sin(p2),0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(-1,-1,1.3,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
      // Sparkling tail
      ctx.strokeStyle='rgba(100,100,220,0.45)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(0,0); ctx.stroke();

    } else if (a.type === 'wiz_fire') {
      // Fire bolt — hot orange-red orb
      const fp = loopT*10 + (a.fireSeed||0);
      ctx.shadowColor='#FF4400'; ctx.shadowBlur=12+4*Math.sin(fp);
      ctx.fillStyle='#FF4400';
      ctx.beginPath(); ctx.arc(0,0,5+0.5*Math.sin(fp),0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#FFB400';
      ctx.beginPath(); ctx.arc(-1.5,-1.5,2.2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#FFFFFF';
      ctx.beginPath(); ctx.arc(-2,-2,0.8,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;

    } else if (a.type === 'wiz_laser') {
      // Laser stream — long bright cyan piercing beam
      const laserLen = 22;
      ctx.shadowColor='#39E0FF'; ctx.shadowBlur=10;
      ctx.strokeStyle='#39E0FF'; ctx.lineWidth=3.5;
      ctx.beginPath(); ctx.moveTo(-laserLen,0); ctx.lineTo(laserLen,0); ctx.stroke();
      ctx.strokeStyle='#FFFFFF'; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(-laserLen,0); ctx.lineTo(laserLen,0); ctx.stroke();
      ctx.shadowBlur=0;

    } else {
      // Normal arrow
      ctx.shadowColor = '#F0C830'; ctx.shadowBlur = 4;
      ctx.fillStyle = '#D4A832'; ctx.fillRect(-10, -0.5, 21, 1);
      ctx.fillStyle = '#F0C830';
      ctx.beginPath(); ctx.moveTo(11,-2); ctx.lineTo(15,0); ctx.lineTo(11,2); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#A07828'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-10,-2); ctx.lineTo(-7,0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 2); ctx.lineTo(-7,0); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFires() {
  for (const f of fires) {
    const lifeFade = Math.min(1, f.life / 1.0);
    const rOuter   = 16 + 3 * Math.sin(loopT * 5 + f.phase);
    const rInner   = 6  + 1.5 * Math.sin(loopT * 8 + f.phase);
    const cx = f.x, cy = f.y + CONFIG.hudHeight;
    ctx.save(); ctx.globalAlpha = lifeFade * 0.88;
    // Outer halo with radial gradient
    ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 14 + 4 * Math.sin(loopT * 6 + f.phase);
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rOuter);
    grad.addColorStop(0,   '#FFB400');
    grad.addColorStop(0.4, '#FF7A1F');
    grad.addColorStop(0.8, 'rgba(178,58,0,0.5)');
    grad.addColorStop(1,   'rgba(178,58,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, rOuter, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // Inner core
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#FFB400';
    ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function drawDynamites() {
  for (const d of dynamites) {
    const dx = d.x, dy = d.y + CONFIG.hudHeight;
    const fuseT     = d.life;
    const fuseTotal = d.fuseTotal || CONFIG.dynamiteLifetime;
    const burntFrac = Math.min(0.8, 1 - fuseT / fuseTotal);
    const bobOff    = 1.5 * Math.sin(loopT * 4 + (d.bobPhase || 0));
    const sparkPhase = loopT * 18;

    ctx.save(); ctx.translate(dx, dy + bobOff);

    // Blast radius ring
    ctx.globalAlpha = 0.15; ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 1;
    ctx.setLineDash([4,4]); ctx.beginPath(); ctx.arc(0, 0, CONFIG.dynamiteBlastRadius, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    ctx.rotate(d.angle);

    // 1. Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 7, 13, 2.5, 0, 0, Math.PI*2); ctx.fill();

    // 2-4. Body. The sapper's own bomb is round — a real bomb, not the
    // archer's stick of dynamite; everything else about it (shadow, label,
    // wick, spark, countdown) stays the shared look both throws already had.
    const isBomb = d.kind === 'bomb';
    if (isBomb) {
      // Elemental bombs keep the shape and the label and change only the
      // casing's colour, so a fire bomb still reads as the same bomb.
      const body = d.element === 'fire' ? '#FF7A1F' : d.element === 'ice' ? '#40D0F0' : '#FF1F1F';
      const shade = d.element === 'fire' ? '#A03A00' : d.element === 'ice' ? '#1E6A90' : '#8A1010';
      if (d.element !== 'none') { ctx.shadowColor = body; ctx.shadowBlur = 8; }
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle = shade; ctx.fillRect(-10, 3, 20, 10);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(-3.5, -3.5, 2, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle = '#FF1F1F'; ctx.fillRect(-12, -4, 24, 8);
      ctx.fillStyle = '#8A1010'; ctx.fillRect(-12, 0, 24, 4);
      ctx.fillStyle = '#5A0808';
      ctx.fillRect(-12, -4, 1, 8); ctx.fillRect(11, -4, 1, 8);
    }
    // 5. Label rect
    const labelW = isBomb ? 12 : 14, labelH = isBomb ? 5 : 6;
    ctx.fillStyle = '#F0F0F0'; ctx.fillRect(-labelW/2, -labelH/2, labelW, labelH);
    // 6. Label text "TNT"
    ctx.fillStyle = '#0A0A0A'; ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 0, 0.5);

    // 7. Wick — anchored on the body's own edge, so it sits flush whichever
    //    shape the body is this time.
    const wickBase = isBomb ? { x: 7,  y: -7  } : { x: 11, y: -4  };
    const wickTip   = isBomb ? { x: 12, y: -13 } : { x: 17, y: -10 };
    //    Unburnt section (gold)
    ctx.strokeStyle = '#A07828'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(wickBase.x, wickBase.y);
    ctx.quadraticCurveTo(wickBase.x + 3, wickBase.y - 3, wickTip.x, wickTip.y); ctx.stroke();
    // Charred section (grows from base toward tip)
    if (burntFrac > 0) {
      ctx.strokeStyle = '#3A2A1A'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(wickBase.x, wickBase.y);
      ctx.quadraticCurveTo(wickBase.x + burntFrac*3, wickBase.y - burntFrac*3,
                            wickBase.x + burntFrac*6, wickBase.y - burntFrac*6); ctx.stroke();
    }

    // 8. Spark outer halo
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 6 + 4 * Math.sin(sparkPhase);
    ctx.fillStyle = `rgba(255,180,0,0.4)`;
    ctx.beginPath(); ctx.arc(wickTip.x, wickTip.y, 3 + Math.sin(sparkPhase), 0, Math.PI*2); ctx.fill();
    // 8b. Spark core
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(wickTip.x, wickTip.y, 1.5 + 0.5*Math.sin(sparkPhase), 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.rotate(-d.angle);

    // 9. Countdown text with tiered color/glow
    let countCol = '#FF1F1F', countBlur = 4;
    if      (fuseT <= 0.5) { countCol = '#FFFFFF'; countBlur = 16; }
    else if (fuseT <= 1.0) { countCol = '#FFB400'; countBlur = 4;  }
    ctx.shadowColor = countCol; ctx.shadowBlur = countBlur;
    ctx.fillStyle = countCol; ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(String(Math.max(1, Math.ceil(fuseT))), 0, -12);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

/** The sapper's barrage: small dark-iron balls, no fuse to read since they
 *  go off on contact rather than a countdown. */
function drawBarrageBombs() {
  for (const b of barrageBombs) {
    const dx = b.x, dy = b.y + CONFIG.hudHeight;
    ctx.save(); ctx.translate(dx, dy);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 4, 5, 1.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#2A2A2A';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(-1.3, -1.3, 1, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

/** The sapper's shift shot: a thin glowing dart, since it flies straight and
 *  is gone the instant it touches anything. */
function drawSapperShots() {
  for (const s of sapperShots) {
    const dx = s.x, dy = s.y + CONFIG.hudHeight;
    const a = Math.atan2(s.vy, s.vx);
    ctx.save(); ctx.translate(dx, dy); ctx.rotate(a);
    ctx.shadowColor = '#FF7A1A'; ctx.shadowBlur = 6;
    ctx.strokeStyle = '#FFB400'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(9, 0, 1.6, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

/**
 * Every satchel on the ground, thrown or armed.
 *
 * The drawing itself is `paintSatchel` in render/ranger-fx.ts, which is where
 * it belongs: this was fifty-eight lines of inline canvas work with the two
 * states interleaved through it, and the two states are the whole ability --
 * a second click is what arms one, so confusing them is a mistake a player
 * pays for.
 *
 * The bob stays here rather than in the painter. It is a property of a bag
 * lying on this game's ground, not of what a satchel looks like.
 */
function drawSatchels() {
  for (const s of satchels) {
    const bobOff = 1.5 * Math.sin(loopT * 4 + (s.bobPhase || 0));
    paintSatchel(ctx, {
      x: s.x, y: s.y + CONFIG.hudHeight + bobOff,
      state: s.armed ? 'armed' : 'inert',
      angle: s.angle,
      fuse: s.life / CONFIG.satchelArmFuse,
      fuseSecs: s.life,
      blast: s.armed ? CONFIG.dynamiteBlastRadius : null,
      t: loopT,
    });
  }
}

const CROW_SPRITE = { w: 20, h: 16 };

// White is a persistent enemy kind (c.white), not just the entrance's
// blink-white telegraph — drawCrow below picks this palette for both.
const CROW_PALETTES = {
  normal: { body: '#141414', bodyHi: '#3A3A3A', feather: '#2A2A2A', edge: '#000000', beak: '#FFB400', beakHi: '#FFD966' },
  white:  { body: '#E4E4E4', bodyHi: '#FFFFFF', feather: '#C8C8C8', edge: '#A8A8A8', beak: '#FF1F1F', beakHi: '#FF6A5A' },
};

/** frame 'a'/'b' are the two extremes of the flap, 'mid' the level pass
 * between them — see animFrame3. Body/tail/beak stay put; only the wing
 * mass moves, same simplification drawSkeleton's legs use below. */
function buildCrowGrid(kind, frame) {
  const C = CROW_PALETTES[kind];
  const g = makePixelGrid(CROW_SPRITE.w, CROW_SPRITE.h);

  // Wings are the highlight tone, not the body tone — pixelOutline only
  // seams the outer silhouette, so two overlapping same-color shapes fuse
  // into one blob without a distinct fill to tell them apart.
  const wing = frame === 'a' ? { x: 9, y: 11, rx: 6, ry: 2.2 }    // lowered, spread below
             : frame === 'b' ? { x: 9, y: 3, rx: 5, ry: 2 }       // raised, folded over the back
             :                 { x: 8, y: 7.5, rx: 6.5, ry: 1.6 }; // level, spread to the sides
  pixelEllipse(g, wing.x, wing.y, wing.rx, wing.ry, C.bodyHi);
  // Two flight-feather splits, each cut to the wing's own height where it
  // lands — the crow king's wing gets the same read at three times the size.
  for (const i of [-1, 1]) {
    const dx = (i * wing.rx) / 2;
    const half = wing.ry * Math.sqrt(Math.max(0, 1 - (dx / wing.rx) ** 2));
    pixelRect(g, Math.round(wing.x + dx), Math.round(wing.y - half), 1, Math.max(1, Math.round(half * 2)), C.feather);
  }

  // Tail, trailing right (crow flies left, tail streams behind)
  pixelEllipse(g, 15, 7, 3, 1.6, C.body);

  // Body, drawn over the wing root so the silhouette reads front-to-back
  pixelEllipse(g, 11, 7.5, 5, 3.3, C.body);
  pixelEllipse(g, 9, 6, 2.5, 1.4, C.bodyHi); // lit crown and nape
  // The tail is the body's own colour and the body is painted over its root,
  // so without a seam where they meet the silhouette has no tail at all.
  pixelRect(g, 15, 6, 1, 3, C.feather);
  pixelRect(g, 8, 9, 5, 1, C.feather); // breast/wing seam

  // Beak, pointing left (crow flies left), with a lit upper mandible
  pixelRect(g, 3, 7, 3, 1, C.beak);
  setPixel(g, 2, 7, C.beak);
  pixelRect(g, 4, 6, 2, 1, C.beakHi);

  return pixelOutline(g, C.edge);
}

const _crowGrids = {};
function crowGrid(kind, frame) {
  const key = `${kind}|${frame}`;
  return _crowGrids[key] || (_crowGrids[key] = buildCrowGrid(kind, frame));
}

/**
 * The rime over anything an ice bomb caught: a blue wash, a brighter shell,
 * and a few crystals. Drawn over the finished sprite rather than by recolouring
 * it, so it works the same for a crow, a skeleton and a soldier without any of
 * the three needing to know about it.
 *
 * The last third fades out, which is the only warning that a frozen thing is
 * about to start moving again.
 */
function drawFrozenOverlay(e) {
  const t = e.frozenTimer || 0;
  if (t <= 0) return;
  const cx = e.x, cy = e.y + CONFIG.hudHeight;
  const fade = Math.min(1, t / (CONFIG.iceBlastFreezeSecs * 0.33));
  const r = 11;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = 0.45 * fade;
  ctx.fillStyle = '#40D0F0';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  ctx.globalAlpha = 0.85 * fade;
  ctx.strokeStyle = '#A8D8F0'; ctx.lineWidth = 1.5;
  ctx.shadowColor = '#40D0F0'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;

  // Crystals, at fixed angles so a frozen body reads as set solid rather than
  // shimmering.
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1;
  for (const a of [-0.9, 0.4, 2.1, 3.6]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
    ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCrow(c) {
  const cx = c.x, cy = c.y + CONFIG.hudHeight;
  let alpha = 1;
  if (c.frozen && bossDeathSeq) alpha = Math.max(0, bossDeathSeq.frozenAlpha);
  let blinkWhite = false;
  if (entrance && entrance.timer >= 1.5 && entrance.timer < 1.8)
    blinkWhite = Math.floor((entrance.timer - 1.5) / 0.1) % 2 === 0;
  const isWhite   = c.white || blinkWhite;
  const isAggro   = c.state === 'aggro';
  const ep        = c.entityPhase || 0;
  const bobYAmp   = isWhite ? 1.2 : 0.8;
  const bobY      = bobYAmp * Math.sin(loopT * 3 + ep);
  const pulsePhase = loopT * 6;
  const flashOn = c.hitFlash > CONFIG.hitFlashSecs - CONFIG.hitFlashWhiteSecs;

  const kind  = isWhite ? 'white' : 'normal';
  const frame = animFrame3(c.wingPhase);
  const grid  = crowGrid(kind, frame);
  const eyeCol   = isWhite ? '#FF1F1F' : '#FFB400';
  const glintCol = isWhite ? '#FFFFFF' : '#FF1F1F';
  const shadowFill = isWhite ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
  const eyeBlur  = isWhite ? 4 + 2*Math.sin(loopT*4 + ep) : 3;

  const cKnock = hitKnockOffset(c);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx + cKnock.x, cy + cKnock.y);

  // 1. Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = shadowFill;
  ctx.beginPath(); ctx.ellipse(0, 6, 7, 1.8, 0, 0, Math.PI*2); ctx.fill();

  // 2. Pixel-art body (see buildCrowGrid). The flap cycle is 3 baked frames
  // (animFrame3), not a rotated overlay — a silhouette that never stops
  // moving needs real frames to read as pixel art instead of a frozen pose.
  const cSpriteDx = -(CROW_SPRITE.w) / 2;
  const cSpriteDy = -8 + Math.round(bobY);
  const cCanvas = flashOn
    ? spriteFlashCanvas(`crow|${frame}`, grid, CROW_SPRITE.w, CROW_SPRITE.h, '#ffffff')
    : spriteCanvas(`crow|${kind}|${frame}`, grid, CROW_SPRITE.w, CROW_SPRITE.h);
  if (flashOn) { ctx.shadowColor = '#FFFFFF'; ctx.shadowBlur = 8; }
  ctx.drawImage(cCanvas, cSpriteDx, cSpriteDy);
  ctx.shadowBlur = 0;

  // 3. Eye — stamped glow, one per (color, blur step) across the whole flock
  const eyeStamp = glowDotStamp(eyeCol, 1.2, eyeBlur);
  ctx.drawImage(eyeStamp, cSpriteDx + 5 - eyeStamp.width / 2, cSpriteDy + 6 - eyeStamp.height / 2);

  // 4. Eye glint (2×2 when aggro, 1×1 otherwise)
  if (isAggro) {
    const gs = glowRectStamp('#FF1F1F', 2, 2, 5);
    ctx.drawImage(gs, cSpriteDx + 6 - gs.width / 2, cSpriteDy + 7 - gs.height / 2);
  } else {
    ctx.fillStyle = glintCol;
    ctx.fillRect(cSpriteDx + 5, cSpriteDy + 6, 1, 1);
  }

  // Aggro pulse ring — layered on top
  if (isAggro) {
    const pAlpha = 0.55 - 0.4 * Math.pow(Math.sin(pulsePhase), 2);
    const ringR  = 10 + 3 * Math.sin(pulsePhase);
    ctx.shadowColor = '#FF1F1F'; ctx.shadowBlur = 8 + 4 * Math.sin(pulsePhase);
    ctx.strokeStyle = `rgba(255,31,31,${Math.max(0, pAlpha)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, bobY, ringR, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // HP pips — only once waves mode has actually made a crow tougher than
  // one hit. A "1/1" pip under every ordinary crow would be noise, not
  // information.
  if (c.maxHp > 1) {
    const pipW = 3, gap = 1, total = c.maxHp * pipW + (c.maxHp - 1) * gap;
    const startX = -total / 2, pipY = bobY - 10;
    for (let p = 0; p < c.maxHp; p++) {
      ctx.fillStyle = p < c.hp ? '#FF1F1F' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(startX + p * (pipW + gap), pipY, pipW, 2);
    }
  }

  ctx.restore();
}

// One palette per wave kind. `aura` is null for a normal skeleton so the
// elemental glow below only ever draws for fire and ice.
// `boneSh` sits between `bone` and `edge`: shading needs a tone that is darker
// than the body without being the outline, and with only the three original
// slots every shadow on these sprites had to be drawn in the seam colour,
// which reads as a hole rather than as a curve.
const SKELETON_PALETTES = {
  normal: { bone: '#D8D0C0', boneHi: '#F4F0E6', boneSh: '#B0A896', edge: '#8A8070', eye: '#B040E0', aura: null },
  fire:   { bone: '#D86A40', boneHi: '#F4A868', boneSh: '#A84828', edge: '#7A2A10', eye: '#FF6020', aura: '#FF6020' },
  ice:    { bone: '#A8D8F0', boneHi: '#E4F6FF', boneSh: '#78A8C8', edge: '#4878A0', eye: '#40D0F0', aura: '#40D0F0' },
  // Not bone at all, but it reads the same slots so nothing downstream
  // needs to know a rat is not a skeleton.
  rat:    { bone: '#4A3E36', boneHi: '#6B5A4C', boneSh: '#382E28', edge: '#2A221C', eye: '#FF4020', aura: null },
};

const SKELETON_SPRITE = { w: 14, h: 24 };
const RAT_SPRITE = { w: 14, h: 10 };

/**
 * A low, quick body: tail, hunched back, snout, and four legs that scurry on
 * the same three-frame stride the skeletons use.
 *
 * Drawn facing right and never mirrored, like every other ground critter here.
 */
function buildRatGrid(kind, frame) {
  const C = SKELETON_PALETTES[kind];
  const g = makePixelGrid(RAT_SPRITE.w, RAT_SPRITE.h);
  const swing = frame === 'a' ? 1 : frame === 'b' ? -1 : 0;

  // Tail, whipping opposite the legs so the body reads as driven by them.
  // Sampled per pixel of its length: at 8 samples over a curve twice that
  // long it came out dotted, which at this size reads as debris, not a tail.
  pixelCurve(g, [0, 4 - swing], [3, 6], [5, 5], C.edge, 20);
  // Haunch and back
  pixelEllipse(g, 6, 6, 4, 2, C.bone);
  pixelEllipse(g, 6, 5, 3, 1, C.boneHi);
  pixelRect(g, 3, 7, 6, 1, C.boneSh);   // belly, in shadow under the haunch
  // Head and snout
  pixelEllipse(g, 10, 6, 2, 2, C.bone);
  pixelRect(g, 12, 6, 2, 1, C.bone);
  setPixel(g, 13, 6, C.boneHi);         // nose tip
  setPixel(g, 11, 7, C.boneSh);         // jaw
  // Ear
  pixelRect(g, 9, 3, 2, 2, C.edge);
  setPixel(g, 10, 4, C.bone);
  // Four legs on fixed columns, the stride lifting alternate pairs rather
  // than swinging them sideways: one-pixel legs on a 14px body cannot pass
  // each other, and a sideways stride puts two of them in one column.
  for (const [i, x] of [3, 5, 8, 10].entries()) {
    const planted = frame === 'mid' || (i % 2 === 0) === (frame === 'a');
    pixelRect(g, x, 8, 1, planted ? 2 : 1, C.edge);
  }
  return g;
}

/**
 * Per-kind rendering, so a kind with a different body is a row rather than a
 * branch inside drawSkeleton. The three bone kinds share one builder and
 * differ only by palette; the rat brings its own.
 */
const SKELETON_LOOK = {
  normal: { sprite: SKELETON_SPRITE, build: buildSkeletonGrid, dy: -15, eyes: [[4, 5], [8, 5]], shadow: [7, 2] },
  fire:   { sprite: SKELETON_SPRITE, build: buildSkeletonGrid, dy: -15, eyes: [[4, 5], [8, 5]], shadow: [7, 2] },
  ice:    { sprite: SKELETON_SPRITE, build: buildSkeletonGrid, dy: -15, eyes: [[4, 5], [8, 5]], shadow: [7, 2] },
  rat:    { sprite: RAT_SPRITE,      build: buildRatGrid,      dy: -7,  eyes: [[11, 5]],        shadow: [6, 1.5] },
};

/** frame 'a'/'b' are the two extremes of the stride, 'mid' legs-together
 * between them — see animFrame3. Skull and ribcage stay put; only limbs
 * move, same simplification buildCrowGrid's wings use above. */
function buildSkeletonGrid(kind, frame) {
  const C = SKELETON_PALETTES[kind];
  const g = makePixelGrid(SKELETON_SPRITE.w, SKELETON_SPRITE.h);
  const swing = frame === 'a' ? 2.5 : frame === 'b' ? -2.5 : 0;

  // Legs: the stride lifts one foot and plants the other rather than swinging
  // them sideways. Two leg bones two columns apart cannot pass each other in
  // a 14px sprite — at the full sideways swing all four landed in the same
  // three columns, and the skeleton walked on one thick leg.
  const lift = frame === 'a' ? 1 : frame === 'b' ? -1 : 0;
  pixelRect(g, 5, 15, 2, 8 - lift, C.bone);
  pixelRect(g, 8, 15, 2, 8 + lift, C.bone);
  pixelRect(g, 4, 22 - lift, 3, 1, C.boneSh);
  pixelRect(g, 8, 22 + lift, 3, 1, C.boneSh);

  // Arms
  pixelCurve(g, [3, 10], [3 - swing * 0.3, 13], [3 - swing * 0.6, 16], C.bone, 12);
  pixelCurve(g, [10, 10], [10 + swing * 0.3, 13], [10 + swing * 0.6, 16], C.bone, 12);

  // Ribcage: lit across the collarbones, falling into shadow low, with a
  // sternum the ribs cross rather than one unbroken band per rib
  pixelRect(g, 4, 9, 6, 8, C.bone);
  pixelRect(g, 4, 9, 6, 2, C.boneHi);
  pixelRect(g, 4, 14, 6, 3, C.boneSh);
  for (let ry = 11; ry <= 15; ry += 2) pixelRect(g, 4, ry, 6, 1, C.edge);
  pixelRect(g, 6, 10, 2, 7, C.boneHi);

  // Pelvis, so the legs hang off something instead of out of the ribcage
  pixelRect(g, 4, 16, 6, 2, C.boneSh);
  setPixel(g, 6, 17, C.edge); setPixel(g, 7, 17, C.edge);

  // Skull, shaded away from the light, with a toothed jaw under the sockets
  pixelEllipse(g, 7, 5, 4, 3.6, C.bone);
  pixelEllipse(g, 5.5, 3.5, 1.6, 1.2, C.boneHi);
  pixelEllipse(g, 9.5, 5, 1.2, 1.8, C.boneSh);
  pixelRect(g, 4, 7, 6, 1, C.boneSh);
  for (const x of [5, 7, 9]) setPixel(g, x, 7, C.edge);

  return pixelOutline(g, C.edge);
}

const _skeletonGrids = {};
function skeletonGrid(kind, frame) {
  const key = `${kind}|${frame}`;
  return _skeletonGrids[key] || (_skeletonGrids[key] = SKELETON_LOOK[kind].build(kind, frame));
}

// Ground-based, so a walk cycle (legs swinging on s.walkPhase) replaces a
// crow's wing-flap. Reuses drawCrow's ground-shadow and glow-stamped-eye
// techniques, not its geometry — always aggro, so no state-transition ring.
function drawSkeleton(s) {
  const cx = s.x, cy = s.y + CONFIG.hudHeight;
  const flashOn = s.hitFlash > CONFIG.hitFlashSecs - CONFIG.hitFlashWhiteSecs;
  const kind = s.kind || 'normal';
  const palette = SKELETON_PALETTES[kind] || SKELETON_PALETTES.normal;
  const look = SKELETON_LOOK[kind] || SKELETON_LOOK.normal;
  const eyeCol = palette.eye;
  const frame = animFrame3(s.walkPhase);
  const grid = skeletonGrid(kind, frame);

  const sKnock = hitKnockOffset(s);
  ctx.save(); ctx.translate(cx + sKnock.x, cy + sKnock.y);

  // 1. Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 9, look.shadow[0], look.shadow[1], 0, 0, Math.PI*2); ctx.fill();

  // Elemental aura — fire and ice only, a small pulsing glow behind the ribs
  if (palette.aura && !flashOn) {
    const pulse = 0.5 + 0.5 * Math.sin(loopT * 6 + s.walkPhase);
    ctx.globalAlpha = 0.25 + 0.15 * pulse;
    ctx.shadowColor = palette.aura; ctx.shadowBlur = 8 + 5 * pulse;
    ctx.fillStyle = palette.aura;
    ctx.beginPath(); ctx.arc(0, -3, 11, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // 2. Pixel-art body (see buildSkeletonGrid). The stride is 3 baked frames
  // (animFrame3), same reasoning as the crow's flap cycle above.
  const kSpriteDx = -(look.sprite.w) / 2, kSpriteDy = look.dy;
  const kCanvas = flashOn
    ? spriteFlashCanvas(`skeleton|${kind}|${frame}`, grid, look.sprite.w, look.sprite.h, '#ffffff')
    : spriteCanvas(`skeleton|${kind}|${frame}`, grid, look.sprite.w, look.sprite.h);
  // #30's glow behind a flashing body, so a hit reads through a crowd. Kept
  // with the maze's per-kind sprite size: a rat is 14x10 and a skeleton
  // 14x24, so the dimensions have to come from the look row, not a constant.
  if (flashOn) { ctx.shadowColor = '#FFFFFF'; ctx.shadowBlur = 8; }
  ctx.drawImage(kCanvas, kSpriteDx, kSpriteDy);
  ctx.shadowBlur = 0;

  // 3. Eye sockets — stamped glow, same technique as the crow's eye
  const eyeStamp = glowDotStamp(eyeCol, 1, 3);
  for (const [ex, ey] of look.eyes) {
    ctx.drawImage(eyeStamp, kSpriteDx + ex - eyeStamp.width/2, kSpriteDy + ey - eyeStamp.height/2);
  }

  ctx.restore();
}

// ── SOLDIER ART ───────────────────────────────────────────────────────────────
//
// The grids themselves live in render/soldier-grids.ts, beside the heroes'.
// What stays here is the drawing: the parts that need `ctx`, the sprite cache
// and the per-body state a grid knows nothing about.

const _soldierGrids = {};
function soldierGrid(kind, frame) {
  const key = `${kind}|${frame}`;
  return _soldierGrids[key] || (_soldierGrids[key] = SOLDIER_GRID_BUILDERS[kind](frame));
}

/**
 * One soldier. Same shape as drawSkeleton — ground shadow, cached sprite,
 * white flash on a hit — with the one addition that matters here: the sprite
 * is mirrored to match `facing`.
 *
 * That mirror is not decoration. The shieldman's guard covers the way it is
 * looking, so the side its shield is drawn on is the side that stops arrows,
 * and a player works out to go round it by looking at it.
 */
/**
 * One guard, drawn the way a soldier is, with its rank on it.
 *
 * The rank is not drawn here — it is baked into the grid by buildGuardGrid,
 * because the pips have to sit on the body and mirror with it when the guard
 * turns round. Drawing them on top afterwards would leave them on the wrong
 * shoulder half the time, and the sprite cache key carries the rank so a
 * promotion is a new cached canvas rather than a stale one.
 */
/**
 * One guard's pixel grid, built once and kept.
 *
 * Memoised for the reason `_skeletonGrids` and `_soldierGrids` are, which
 * drawGuard should have done from the start and did not: the painted canvas is
 * already cached by `stamps`, and on a cache hit — which is almost every frame
 * — `stamps.get` returns it WITHOUT calling the painter. So the grid handed in
 * was built and thrown away, per guard, per frame.
 *
 * Measured before this landed: 9.1 us for a foot guard, 22.4 for the mounted
 * knight, and a wave-10 retinue of twelve rebuilding every frame came to
 * 122 us — 0.73% of a 16.7 ms frame, or 7.3 ms of work per second of play, all
 * of it discarded. Small, but it was bought for nothing.
 *
 * The table is bounded and tiny: four kinds by three frames by four ranks.
 */
const _guardGrids = {};
function guardGrid(kind, frame, rank, key) {
  const hit = _guardGrids[key];
  if (hit) return hit;
  const built = GUARD_GRID_BUILDERS[kind](frame, rank);
  _guardGrids[key] = built;
  return built;
}

/**
 * The disc under an ally, in its team's colour.
 *
 * Every body in this game already draws a flat black ellipse for a shadow, so
 * this costs a fill colour rather than a new draw. It is the readable half of
 * "whose side is that": a livery on a 16px sprite is a handful of pixels and
 * disappears in the twelve-body crowd of wave 10, while a coloured disc under
 * the feet survives being half-hidden behind another body and never competes
 * with the silhouette that says *what* the unit is — the spear, the shield,
 * the horse, the cross.
 *
 * Keyed on team rather than on being a guard, so multiplayer's teams drop into
 * the same call unchanged.
 */
function drawTeamDisc(team, rx = 7) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = TEAM_DISC[team] ?? 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 9, rx, rx * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  // A hard rim, because a translucent disc over dark ground reads as a smudge.
  ctx.strokeStyle = TEAM_RIM[team] ?? 'rgba(0,0,0,0)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawGuard(gd) {
  const cx = gd.x, cy = gd.y + CONFIG.hudHeight;
  const flashOn = gd.hitFlash > 0;
  const frame = animFrame3(gd.walkPhase);
  const rank = gd.guard.rank;
  const kind = gd.guard.kind;
  const size = GUARD_SPRITES[kind];
  const key = 'guard|' + kind + '|' + frame + '|' + rank;
  const grid = guardGrid(kind, frame, rank, key);

  ctx.save();
  ctx.translate(cx, cy);
  // Wider body, wider disc: a mounted knight on a foot soldier's disc looks
  // like it is standing beside its own marker.
  drawTeamDisc(gd.team, size.w > GUARD_SPRITES.archer.w ? 12 : 7);
  if (Math.cos(gd.facing) < 0) ctx.scale(-1, 1);
  const sprite = flashOn
    ? spriteFlashCanvas(key, grid, size.w, size.h, '#ffffff')
    : spriteCanvas(key, grid, size.w, size.h);
  if (flashOn) { ctx.shadowColor = '#FFFFFF'; ctx.shadowBlur = 8; }
  ctx.drawImage(sprite, -size.w / 2, -16);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawSoldier(s) {
  const cx = s.x, cy = s.y + CONFIG.hudHeight;
  const flashOn = s.hitFlash > CONFIG.hitFlashSecs - CONFIG.hitFlashWhiteSecs;
  const frame = animFrame3(s.walkPhase);
  const grid = soldierGrid(s.kind, frame);
  const knock = hitKnockOffset(s);

  ctx.save();
  ctx.translate(cx + knock.x, cy + knock.y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 9, 7, 2, 0, 0, Math.PI * 2); ctx.fill();

  // A committed charge leans into its own heading, so a spearman mid-run does
  // not read the same as one walking.
  if (s.charge > 0) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = SOLDIER_PALETTES[s.kind].accent;
    ctx.fillRect(-Math.cos(s.chargeAngle) * 14 - 2, -4, 4, 8);
    ctx.globalAlpha = 1;
  }

  if (Math.cos(s.facing) < 0) ctx.scale(-1, 1);
  const sprite = flashOn
    ? spriteFlashCanvas(`soldier|${s.kind}|${frame}`, grid, SOLDIER_SPRITE.w, SOLDIER_SPRITE.h, '#ffffff')
    : spriteCanvas(`soldier|${s.kind}|${frame}`, grid, SOLDIER_SPRITE.w, SOLDIER_SPRITE.h);
  if (flashOn) { ctx.shadowColor = '#FFFFFF'; ctx.shadowBlur = 8; }
  ctx.drawImage(sprite, -SOLDIER_SPRITE.w / 2, -16);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * Every hostile bolt in flight — a glowing shard oriented along its flight,
 * purple for the dark archer's, icy blue for a freezing one.
 */
function drawHostileBolts() {
  for (const b of hostileBolts) {
    if (b.blastRadius > 0) {
      // Lobbed bomb: a pulsing orb, not a directional dart — it threatens an
      // area once it lands, not a line, so it should not read as aimed.
      const pulse = 0.5 + 0.5 * Math.sin(loopT * 12);
      ctx.save(); ctx.translate(b.x, b.y + CONFIG.hudHeight);
      ctx.shadowColor = '#FF8020'; ctx.shadowBlur = 10 + 4 * pulse;
      ctx.fillStyle = '#FF8020';
      ctx.beginPath(); ctx.arc(0, 0, 5 + 1.5 * pulse, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
      continue;
    }
    const ang = Math.atan2(b.vy, b.vx);
    const col = b.freezeSecs > 0 ? '#40D0F0' : '#B040E0';
    ctx.save(); ctx.translate(b.x, b.y + CONFIG.hudHeight); ctx.rotate(ang);
    ctx.shadowColor = col; ctx.shadowBlur = 6;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

/**
 * The chest, closed with its lock plate lit or spent with its lid tipped back.
 */
function drawChest(at) {
  const open = at.opened;
  ctx.save(); ctx.translate(at.x, at.y + CONFIG.hudHeight);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, 9, 11, 2.5, 0, 0, Math.PI*2); ctx.fill();
  ctx.shadowColor = '#FFB400'; ctx.shadowBlur = open ? 0 : 6 + 4*Math.sin(loopT*3);
  ctx.fillStyle = '#6B4423'; ctx.fillRect(-11, -2, 22, 11);
  ctx.fillStyle = '#4A2E17'; ctx.fillRect(-11, 6, 22, 3);
  if (open) {
    ctx.fillStyle = '#0A0A08'; ctx.fillRect(-10, -3, 20, 4);
    ctx.fillStyle = '#5A381D'; ctx.fillRect(-11, -11, 22, 5);
  } else {
    ctx.fillStyle = '#7C5129'; ctx.fillRect(-11, -8, 22, 7);
    ctx.fillStyle = '#8A5B2E'; ctx.fillRect(-11, -8, 22, 2);
  }
  ctx.fillStyle = '#C8A040';
  ctx.fillRect(-7, open ? -11 : -8, 2, open ? 5 : 11);
  ctx.fillRect( 5, open ? -11 : -8, 2, open ? 5 : 11);
  if (!open) {
    ctx.fillStyle = '#E0C060'; ctx.fillRect(-3, -3, 6, 6);
    ctx.fillStyle = '#2A1A08'; ctx.fillRect(-1, -1, 2, 3);
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * The exit, timber in a stone arch until the golden key turns it into daylight.
 */
function drawDoor(at) {
  ctx.save(); ctx.translate(at.x, at.y + CONFIG.hudHeight);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, 14, 13, 3, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#4A4740'; ctx.fillRect(-13, -18, 26, 32);
  ctx.fillStyle = '#5C584F'; ctx.fillRect(-13, -18, 26, 3);
  if (at.opened) {
    const pulse = 0.6 + 0.4*Math.sin(loopT*2.5);
    ctx.shadowColor = '#FFE8B0'; ctx.shadowBlur = 10 + 6*pulse;
    ctx.fillStyle = `rgba(255,232,176,${(0.55 + 0.35*pulse).toFixed(2)})`;
    ctx.fillRect(-8, -14, 16, 28);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = '#3A2412'; ctx.fillRect(-8, -14, 16, 28);
    ctx.fillStyle = '#4E3018'; ctx.fillRect(-8, -14, 16, 2);
    ctx.fillStyle = '#2C1B0D';
    for (let y = -8; y < 14; y += 7) ctx.fillRect(-8, y, 16, 1);
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 5 + 3*Math.sin(loopT*3);
    ctx.fillStyle = '#C8A040'; ctx.fillRect(-3, -2, 6, 7);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1A1006'; ctx.fillRect(-1, 0, 2, 4);
  }
  ctx.restore();
}

// One painter per lock, the same Record<kind, painter> shape RETICLE_PAINTERS
// uses further down, so drawMazeObjective never branches on which one it has.
const MAZE_LOCK_PAINTERS = { chest: drawChest, door: drawDoor };

/** A key on the floor: bow, shaft, two teeth, over a pickup's pedestal halo. */
function drawMazeKey(k) {
  const look = MAZE_KEYS[k.kind];
  ctx.save(); ctx.translate(k.x, k.y + CONFIG.hudHeight);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 8, 7, 1.8, 0, 0, Math.PI*2); ctx.fill();
  ctx.shadowColor = look.color; ctx.shadowBlur = 12;
  ctx.globalAlpha = 0.22 + 0.12*Math.sin(k.bobPhase);
  ctx.fillStyle = look.color;
  ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.translate(0, -2 + Math.sin(k.bobPhase)*2);
  ctx.shadowBlur = 8;
  ctx.strokeStyle = look.color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-4, 0, 3.2, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = look.color;
  ctx.fillRect(-1, -1, 9, 2);
  ctx.fillRect(5, -4, 2, 4);
  ctx.fillRect(8, -3, 2, 3);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * A wall torch: dead stick in a bracket, or a flame.
 *
 * A lit one ignores the fog gate on purpose. It is the only landmark the maze
 * offers, and a landmark you can only see when you are standing on it is not
 * one. lightTorch holds the fog open around it to match.
 */
function drawTorch(t) {
  ctx.save(); ctx.translate(t.x, t.y + CONFIG.hudHeight);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 8, 6, 1.6, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#4A3A22'; ctx.fillRect(-1.5, -4, 3, 12);   // the stick
  ctx.fillStyle = '#6B5A38'; ctx.fillRect(-4, 6, 8, 3);       // the bracket
  if (!t.lit) {
    ctx.fillStyle = '#2A2218'; ctx.fillRect(-3, -8, 6, 5);    // cold pitch
    ctx.restore();
    return;
  }
  const f = Math.sin(t.flamePhase), g = Math.sin(t.flamePhase * 1.7);
  ctx.shadowColor = '#FF9020'; ctx.shadowBlur = 16 + 6*f;
  ctx.fillStyle = `rgba(255,144,32,${(0.16 + 0.06*f).toFixed(2)})`;
  ctx.beginPath(); ctx.arc(0, -6, 18 + 3*f, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#FF7A1F';
  ctx.beginPath(); ctx.ellipse(0, -8, 3.4 + 0.6*g, 6 + 1.2*f, 0, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FFB400';
  ctx.beginPath(); ctx.ellipse(0, -8, 2 + 0.4*g, 4, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#FFF3C0';
  ctx.beginPath(); ctx.arc(0, -8, 1 + 0.4*Math.abs(f), 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

/** The maze's furniture and any key lying on its floor. Nothing off the maze. */
function drawMazeObjective() {
  if (!mazeRun) return;
  for (const [name, at] of Object.entries(mazeRun.locks))
    if (litAt(at.x, at.y)) MAZE_LOCK_PAINTERS[name](at);
  for (const k of mazeRun.drops) if (litAt(k.x, k.y)) drawMazeKey(k);
  for (const t of mazeRun.torches) if (t.lit || litAt(t.x, t.y)) drawTorch(t);
}

/**
 * Three states per tile: lit right now, remembered, or never seen.
 *
 * Painted over the world rather than baked into it, so terrain and memory stay
 * one drawing pass and the fog is the only thing that knows about sight. Lit
 * tiles fade toward the edge of the circle instead of ending on a hard rim,
 * which costs one hypot per tile and buys the difference between a torch and a
 * spotlight.
 *
 * Anything that moves is gated at its own draw call, not here, because memory
 * has to show the corridor and never the rat standing in it.
 */
function drawFog() {
  if (!fogOfWar()) return;
  const ts = CONFIG.tileSize, hud = CONFIG.hudHeight, cols = CONFIG.cols;
  const pc = player.x / ts - 0.5, pr = player.y / ts - 0.5;
  const radius = playerSightTiles();
  const dim = CONFIG.fogMemoryAlpha;
  for (let r = 0; r < CONFIG.rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let a;
      if (fovMap.isVisible(c, r)) {
        a = Math.min(dim, (Math.hypot(c - pc, r - pr) / radius) ** 2 * CONFIG.fogMemorySlope);
      } else if (torchTiles[i]) {
        a = 0;
      } else {
        a = seenTiles[i] ? dim : 1;
      }
      if (a <= 0.01) continue;
      ctx.fillStyle = a >= 1 ? '#000' : `rgba(0,0,0,${a.toFixed(3)})`;
      ctx.fillRect(c * ts, r * ts + hud, ts, ts);
    }
  }
}

function drawPickups() {
  for (const p of pickups) {
    if (!litAt(p.x, p.y)) continue;
    const ep         = p.bobPhase || 0;
    const blinkPhase = loopT * 4 + ep;
    const bobY       = -2 + Math.sin(loopT * 3 + ep) * 2;

    ctx.save(); ctx.translate(p.x, p.y + CONFIG.hudHeight);
    ctx.shadowBlur = 0;

    if (p.type === 'ricochet') {
      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 8, 8, 1.8, 0, 0, Math.PI*2); ctx.fill();
      // Pedestal halo
      ctx.shadowColor = '#39E0FF'; ctx.shadowBlur = 12;
      ctx.fillStyle = `rgba(57,224,255,${0.25 + 0.15*Math.sin(blinkPhase)})`;
      ctx.beginPath(); ctx.arc(0, 0, 10 + Math.sin(blinkPhase), 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      // Float + glyph
      ctx.translate(0, bobY);
      const shaftAlpha = 0.5 + 0.5 * Math.pow(Math.sin(blinkPhase), 2);
      const glyphBlur  = 6 + 4 * Math.sin(blinkPhase);
      ctx.shadowColor = '#39E0FF'; ctx.shadowBlur = glyphBlur;
      ctx.globalAlpha = shaftAlpha;
      ctx.fillStyle = '#39E0FF';
      ctx.fillRect(-7, -0.5, 14, 1);
      ctx.globalAlpha = 1;
      // Head
      ctx.fillStyle = '#7AF0FF';
      ctx.beginPath(); ctx.moveTo(7,-2); ctx.lineTo(11,0); ctx.lineTo(7,2); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // Bounce pips — 3 white dots (brand cue: ricochet ammo)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-2, -3, 1, 1); ctx.fillRect(0, -3, 1, 1); ctx.fillRect(2, -3, 1, 1);

    } else if (p.type === 'fire') {
      const flamePhase = loopT * 10 + ep;
      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 8, 8, 1.8, 0, 0, Math.PI*2); ctx.fill();
      // Pedestal halo
      ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(255,122,31,${0.30 + 0.15*Math.sin(flamePhase*0.4)})`;
      ctx.beginPath(); ctx.arc(0, 0, 11 + Math.sin(flamePhase*0.4), 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      // Float
      ctx.translate(0, bobY);
      // Flame outer
      ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 12 + 4*Math.sin(flamePhase);
      ctx.fillStyle = '#FF7A1F';
      ctx.beginPath(); ctx.ellipse(-9, 0, Math.max(0.5, 3 + Math.sin(flamePhase)), 4 + 0.5*Math.sin(flamePhase*1.3), 0, 0, Math.PI*2); ctx.fill();
      // Flame inner
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#FFB400';
      ctx.beginPath(); ctx.ellipse(-9, 0, 2, 3, 0, 0, Math.PI*2); ctx.fill();
      // Flame core
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(-9, 0, 0.8 + 0.4*Math.sin(flamePhase*2), 0, Math.PI*2); ctx.fill();
      // Arrow shaft
      ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#FF7A1F'; ctx.fillRect(-7, -0.5, 14, 1);
      // Arrow head
      ctx.fillStyle = '#FFB400';
      ctx.beginPath(); ctx.moveTo(7,-2); ctx.lineTo(11,0); ctx.lineTo(7,2); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;

    } else if (p.type === 'shield') {
      // Gold diamond shield pickup
      const sglow = 8 + 5 * Math.sin(blinkPhase);
      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 8, 8, 1.8, 0, 0, Math.PI*2); ctx.fill();
      // Pulsing halo
      ctx.shadowColor = '#FFB400'; ctx.shadowBlur = sglow;
      ctx.fillStyle = `rgba(255,180,0,${(0.20 + 0.12*Math.sin(blinkPhase)).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(0, 0, 13 + Math.sin(blinkPhase), 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      // Float
      ctx.translate(0, bobY);
      ctx.shadowColor = '#FFB400'; ctx.shadowBlur = sglow;
      ctx.fillStyle = '#FFB400';
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0);
      ctx.closePath(); ctx.fill();
      // Inner highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(-1.5, -2, 2, 0, Math.PI*2); ctx.fill();
      // Mid-stripe
      ctx.fillStyle = '#FF7A1F';
      ctx.beginPath(); ctx.moveTo(0,-3); ctx.lineTo(4,0); ctx.lineTo(0,3); ctx.lineTo(-4,0); ctx.closePath(); ctx.fill();

    }
    ctx.restore();
  }
}



function drawParticles() {
  for (const p of particles) {
    const a = Math.max(0, Math.min(1, p.alpha));
    const py = p.y + CONFIG.hudHeight;
    if (p.shape === 'spark') {
      const spd = Math.hypot(p.vx, p.vy) || 1;
      const len = Math.min(9, spd * 0.045 + 2);
      const nx = p.vx / spd, ny = p.vy / spd;
      // Glow is a wide soft understroke; a real shadowBlur here would cost a
      // raster pass per particle.
      if (p.shadowBlur) {
        ctx.globalAlpha = a * 0.35;
        ctx.strokeStyle = p.shadowColor || p.color; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x - nx*len, py - ny*len); ctx.lineTo(p.x + nx*len, py + ny*len);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x - nx*len, py - ny*len); ctx.lineTo(p.x + nx*len, py + ny*len);
      ctx.stroke();
    } else {
      ctx.globalAlpha = a;
      const r = Math.max(0.1, p.r || 2.5);
      if (p.shadowBlur) {
        const s = glowDotStamp(p.color, r, p.shadowBlur);
        ctx.drawImage(s, p.x - s.width / 2, py - s.height / 2);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, py, r, 0, Math.PI*2); ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of floaters) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
    ctx.fillStyle = f.color || '#39FF14';
    ctx.fillText(f.text || '+1', f.x, f.y + CONFIG.hudHeight);
  }
  ctx.globalAlpha = 1;
}

const CROW_KING_SPRITE = { w: 64, h: 44 };

// One boss, no kind variants, so a plain palette object — not a
// Record<Kind,X> table, there is no second row this would ever need.
const CROW_KING_PALETTE = {
  body: '#0A0A0A', bodyHi: '#2A0A0A', feather: '#1A1A1A',
  wing: '#5A0808', wingHi: '#8A1010',
  beak: '#3A0606', beakHi: '#6A1010',
  crown: '#0A0A0A', crownRim: '#5A0808', crownHi: '#8A1010', jewel: '#FFB400',
  edge: '#000000',
};

/** frame 'a'/'b' are the two flap extremes, 'mid' the level pass between
 * them — see animFrame3. Same simplification as the regular crow: crown,
 * beak, and body stay put, only the wing mass moves. */
function buildCrowKingGrid(frame) {
  const C = CROW_KING_PALETTE;
  const g = makePixelGrid(CROW_KING_SPRITE.w, CROW_KING_SPRITE.h);

  const wing = frame === 'a' ? { x: 30, y: 35, rx: 20, ry: 6, c: C.wing }    // lowered, spread below
             : frame === 'b' ? { x: 30, y: 11, rx: 17, ry: 6, c: C.wingHi }  // raised, folded over the back
             :                 { x: 28, y: 24, rx: 22, ry: 5, c: C.wing };   // level, spread to the sides
  pixelEllipse(g, wing.x, wing.y, wing.rx, wing.ry, wing.c);
  // Flight-feather splits, each cut to the wing's own height where it lands,
  // so a slab of one colour reads as separate primaries at any flap extreme.
  for (const i of [-2, -1, 1, 2]) {
    const dx = (i * wing.rx) / 3;
    const half = wing.ry * Math.sqrt(Math.max(0, 1 - (dx / wing.rx) ** 2));
    pixelRect(g, Math.round(wing.x + dx), Math.round(wing.y - half), 1, Math.max(1, Math.round(half * 2)), C.feather);
  }

  // Crown — 5 spikes, tallest in the middle. The spikes are the body's own
  // colour, so without a lit edge down each one and a jewel at each tip the
  // whole crown is a single silhouette that pixelOutline only seams outside.
  const spikeXs = [16, 24, 32, 40, 48], spikeHs = [5, 8, 11, 8, 5];
  for (let i = 0; i < 5; i++) {
    pixelTriangleUp(g, spikeXs[i], 9, 4, spikeHs[i], C.crown);
    for (let d = 1; d < spikeHs[i]; d++) {
      const w = Math.max(0, Math.round(4 - (4 * d) / (spikeHs[i] - 1)));
      setPixel(g, spikeXs[i] - w, 9 - d, C.crownHi);
    }
    setPixel(g, spikeXs[i], Math.max(0, 9 - spikeHs[i] + 1), C.jewel);
  }
  pixelRect(g, 12, 8, 40, 2, C.crownRim);
  for (const x of [20, 28, 36, 44]) setPixel(g, x, 8, C.jewel);

  // Body, drawn over the wing root and crown base
  pixelEllipse(g, 34, 24, 20, 13, C.body);
  pixelEllipse(g, 27, 18, 9, 5, C.bodyHi);
  // Neck ruff, and feather chevrons over the breast. The head is the same
  // mass as the body without a collar to cut it off.
  pixelCurve(g, [26, 12], [20, 24], [26, 34], C.bodyHi, 30);
  pixelCurve(g, [27, 13], [21, 24], [27, 33], C.feather, 30);
  for (const y of [25, 29, 33]) pixelCurve(g, [32, y], [39, y + 3], [46, y], C.feather, 20);

  // Beak, pointing left — a sideways taper, apex at the tip, so a column
  // loop rather than pixelTriangleUp's upward-apex shape. The gape line
  // along its axis is what makes it two mandibles instead of one wedge.
  for (let i = 0; i < 6; i++) {
    const hw = Math.round((5 * i) / 5);
    pixelRect(g, 4 + i, 22 - hw, 1, hw * 2 + 1, C.beak);
    setPixel(g, 4 + i, 22 - hw, C.beakHi);
  }
  for (let i = 1; i < 6; i++) setPixel(g, 4 + i, 22, C.edge);

  return pixelOutline(g, C.edge);
}

const _crowKingGrids = {};
function crowKingGrid(frame) {
  return _crowKingGrids[frame] || (_crowKingGrids[frame] = buildCrowKingGrid(frame));
}

function drawBoss() {
  if (bossDeathSeq) {
    for (const f of bossDeathSeq.fragments) {
      if (f.alpha <= 0) continue;
      ctx.save(); ctx.globalAlpha = Math.max(0, f.alpha); ctx.fillStyle = '#8B0000';
      ctx.fillRect(f.x-f.w/2, f.y+CONFIG.hudHeight-f.h/2, f.w, f.h); ctx.restore();
    }
  }
  if (!boss || boss.bstate === 'dead') return;
  if (boss.kind === 'dark_archer') { drawDarkArcher(); return; }
  if (boss.kind === 'dark_knight') { drawDarkKnight(); return; }
  if (boss.kind === 'minotaur')    { drawMinotaur(); return; }
  if (boss.kind === 'commander')   { drawCommander(); return; }
  const bx = boss.x, by = boss.y + CONFIG.hudHeight;
  const fl = boss.hitFlash > 0;
  const bossPulse = 0.5 + 0.5 * Math.sin(loopT * 2);
  const bobY      = 1.2 * Math.sin(loopT * 1.2);   // reduced amplitude, slower bob
  const wPhase    = boss.wingPhase;
  const bFacing   = boss.facing || 1;

  ctx.save(); ctx.translate(bx, by);
  ctx.scale(bFacing, 1);   // face toward player

  // 1. Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath(); ctx.ellipse(0, 22, 32, 6, 0, 0, Math.PI*2); ctx.fill();

  // 2. Corona — pulsing red aura
  const coronaR = 38 + 5 * bossPulse;
  ctx.shadowColor = '#FF1F1F'; ctx.shadowBlur = 24 + 10 * bossPulse;
  ctx.fillStyle = `rgba(255,31,31,${0.18 + 0.12*bossPulse})`;
  ctx.beginPath(); ctx.arc(0, bobY, coronaR, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // Shield — rotating segmented ring, blue during initial phase, purple when random
  if (boss.shield) {
    const isInitial = boss.shieldPhase === 'initial';
    const shieldPulse = 0.6 + 0.4 * Math.sin(loopT * (isInitial ? 3 : 5));
    const shieldColor = isInitial
      ? `rgba(80,160,255,${shieldPulse})`
      : `rgba(190,80,255,${shieldPulse})`;
    const glowColor  = isInitial ? '#50a0ff' : '#be50ff';
    const shieldR    = coronaR + 14;
    const segments   = 6;
    const gap        = 0.25;   // radians of gap between segments
    ctx.save();
    ctx.rotate(loopT * (isInitial ? 1.4 : -2.2));  // initial rotates slow-CW, random fast-CCW
    ctx.lineWidth  = 4;
    ctx.shadowColor = glowColor; ctx.shadowBlur = 18;
    ctx.strokeStyle = shieldColor;
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2 + gap * 0.5;
      const a1 = ((s + 1) / segments) * Math.PI * 2 - gap * 0.5;
      ctx.beginPath(); ctx.arc(0, bobY, shieldR, a0, a1); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  if (fl) {
    // Hit flash: simplified bright fill
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(0, bobY, 28, 18, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore(); return;
  }

  // 3. Pixel-art body (see buildCrowKingGrid). Same 3-baked-frame flap as
  // the regular crow, scaled up, plus the crown and stacked eyes a boss needs.
  const bkFrame = animFrame3(wPhase);
  const bkGrid  = crowKingGrid(bkFrame);
  const bkDx = -(CROW_KING_SPRITE.w) / 2, bkDy = -24 + Math.round(bobY);
  ctx.drawImage(spriteCanvas(`crowking|${bkFrame}`, bkGrid, CROW_KING_SPRITE.w, CROW_KING_SPRITE.h), bkDx, bkDy);

  // 4. Eyes — two stacked, same glow-stamp technique as the skeleton's
  const eyeBlur = 10 + 5 * Math.sin(loopT * 8);
  const eyeStamp = glowDotStamp('#FF1F1F', 2.5, eyeBlur * 0.4);
  ctx.drawImage(eyeStamp, bkDx + 13 - eyeStamp.width/2, bkDy + 20 - eyeStamp.height/2);
  ctx.drawImage(eyeStamp, bkDx + 13 - eyeStamp.width/2, bkDy + 27 - eyeStamp.height/2);

  // 5. Eye cores (1×1 amber dot in each eye)
  ctx.fillStyle = '#FFB400';
  ctx.fillRect(bkDx + 13, bkDy + 20, 1, 1);
  ctx.fillRect(bkDx + 13, bkDy + 27, 1, 1);

  // 6. Daze stars — old-pixel-game "seeing stars", orbiting his head. Fewer
  // and slower as bossSpeedMod()'s same phase read recovers, so the visual
  // decays in step with the mechanical debuff instead of just switching off.
  const dazePhase = bossDazePhase();
  if (dazePhase) {
    const starCount = dazePhase === 'stun' ? 4 : dazePhase === 'slow1' ? 3 : 2;
    const spinSpeed = dazePhase === 'stun' ? 6 : dazePhase === 'slow1' ? 3 : 1.5;
    const starY = bobY - 26;
    ctx.shadowColor = '#FFEE44'; ctx.shadowBlur = 5;
    ctx.fillStyle = '#FFEE44';
    for (let i = 0; i < starCount; i++) {
      const a = loopT * spinSpeed + (i / starCount) * Math.PI * 2;
      const sx = Math.cos(a) * 14, sy = starY + Math.sin(a) * 5;
      ctx.fillRect(sx - 0.5, sy - 2, 1, 5);
      ctx.fillRect(sx - 2, sy - 0.5, 5, 1);
    }
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

/**
 * Castle stage boss 1: a corrupted echo of the player's own Archer, reusing
 * that character's bow-arc-and-string drawing technique (see drawPlayer)
 * scaled up and aimed continuously at the player, plus the corona-pulse and
 * hit-flash techniques from the crow king. New geometry, not new drawing
 * tricks.
 */
const DARK_ARCHER_SPRITE = { w: 40, h: 42 };
const DARK_ARCHER_PALETTE = {
  cloak: '#241030', cloakHi: '#3A1A4A', cloakSh: '#180A22',
  body: '#382048', bodyHi: '#4A2C5E', bodySh: '#241432', strap: '#120818',
  head: '#1A0E22', headHi: '#2C1838', hood: '#150A1C', hoodSh: '#0E0614',
  rune: '#B040E0',
  edge: '#0A0510',
};

/**
 * How far down each column of the cloak reaches, repeated across its width.
 * A 40px cloak cut off straight reads as a bucket; a hem torn into tongues
 * is the whole silhouette below the waist, and pixelOutline then seams every
 * tongue on its own.
 */
const DARK_ARCHER_HEM = [41, 39, 40, 41, 37, 41, 40, 38, 41, 40];

/** No walk cycle, no wing-flap — like the heroes, one static frame plus a
 * live bob is enough. Bow/arm/bowstring stay live below, same reasoning as
 * the player Archer's own bow: real-time aim is gameplay information. */
function buildDarkArcherGrid() {
  const C = DARK_ARCHER_PALETTE;
  const g = makePixelGrid(DARK_ARCHER_SPRITE.w, DARK_ARCHER_SPRITE.h);

  // Cloak — widens from the shoulders down to a hem torn into tongues
  // (see DARK_ARCHER_HEM), with fold shadows down the drop of the cloth
  for (let y = 14; y <= 41; y++) {
    const halfW = Math.round(10 + 9 * ((y - 14) / 27));
    for (let x = 20 - halfW; x < 20 + halfW; x++) {
      if (y > DARK_ARCHER_HEM[((x % DARK_ARCHER_HEM.length) + DARK_ARCHER_HEM.length) % DARK_ARCHER_HEM.length]) continue;
      setPixel(g, x, y, C.cloak);
    }
  }
  for (const x of [7, 13, 27, 33]) pixelRect(g, x, 22, 1, 19, C.cloakSh);

  // Body panel, under the hood: lit down one side, shaded down the other,
  // with the quiver strap and belt that break up its middle
  pixelRect(g, 10, 18, 20, 16, C.body);
  pixelRect(g, 10, 18, 4, 16, C.bodyHi);
  pixelRect(g, 26, 18, 4, 16, C.bodySh);
  pixelCurve(g, [11, 20], [20, 25], [29, 31], C.strap, 30);
  pixelRect(g, 10, 30, 20, 2, C.strap);
  pixelRect(g, 18, 30, 4, 2, C.rune); // belt buckle, the one lit accent

  // Head, with the hood's brim shadowing its top
  pixelEllipse(g, 20, 10, 9, 9, C.head);
  pixelEllipse(g, 20, 15, 5, 3, C.headHi);
  pixelRect(g, 12, 8, 16, 2, C.hoodSh);

  // Collar — the head is as wide as the shoulders, so the whole upper half
  // is one silhouette until something cuts across it
  pixelRect(g, 11, 17, 18, 2, C.cloakHi);
  setPixel(g, 13, 18, C.rune); setPixel(g, 26, 18, C.rune); // cloak clasps

  // Hood — peaked rather than a flat lid, drawn last so it sets the face back
  for (let y = 0; y <= 7; y++) {
    const halfW = Math.round(4 + 6 * (y / 7));
    pixelRect(g, 20 - halfW, y, halfW * 2, 1, C.hood);
  }
  pixelRect(g, 11, 6, 18, 1, C.cloakHi); // lit brim

  return pixelOutline(g, C.edge);
}

let _darkArcherGrid = null;
function darkArcherGrid() { return _darkArcherGrid || (_darkArcherGrid = buildDarkArcherGrid()); }

function drawDarkArcher() {
  const bx = boss.x, by = boss.y + CONFIG.hudHeight;
  const bobY = 1.2 * Math.sin(loopT * 1.2);
  const aimAngle = Math.atan2(player.y - boss.y, player.x - boss.x);

  ctx.save(); ctx.translate(bx, by);

  // Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 24, 20, 5, 0, 0, Math.PI*2); ctx.fill();

  // Corona — dark magic aura
  const pulse = 0.5 + 0.5 * Math.sin(loopT * 2);
  ctx.shadowColor = '#B040E0'; ctx.shadowBlur = 20 + 8 * pulse;
  ctx.fillStyle = `rgba(176,64,224,${(0.16 + 0.10*pulse).toFixed(2)})`;
  ctx.beginPath(); ctx.arc(0, bobY, 30 + 4*pulse, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  if (boss.hitFlash > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(0, bobY, 16, 26, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore(); return;
  }

  // Pixel-art cloak/body/head (see buildDarkArcherGrid)
  const daDx = -(DARK_ARCHER_SPRITE.w) / 2, daDy = -24 + Math.round(bobY);
  ctx.drawImage(spriteCanvas('darkarcher', darkArcherGrid(), DARK_ARCHER_SPRITE.w, DARK_ARCHER_SPRITE.h), daDx, daDy);

  // Eyes — same glow-stamp technique as the skeleton's
  const eyeStamp = glowDotStamp('#B040E0', 1.4, 4);
  ctx.drawImage(eyeStamp, daDx + 15 - eyeStamp.width/2, daDy + 9 - eyeStamp.height/2);
  ctx.drawImage(eyeStamp, daDx + 21 - eyeStamp.width/2, daDy + 9 - eyeStamp.height/2);

  // Bow arm, drawn toward the player
  const gx = Math.cos(aimAngle) * 16, gy = bobY + Math.sin(aimAngle) * 16;
  ctx.strokeStyle = '#1A0E22'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, bobY - 2); ctx.lineTo(gx, gy); ctx.stroke();

  // Bow
  ctx.strokeStyle = '#0A0510'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(gx, gy, 14, aimAngle - Math.PI/2, aimAngle + Math.PI/2); ctx.stroke();

  // Bowstring — glowing, permanently drawn taut
  const topX = gx + Math.cos(aimAngle - Math.PI/2)*14, topY = gy + Math.sin(aimAngle - Math.PI/2)*14;
  const botX = gx + Math.cos(aimAngle + Math.PI/2)*14, botY = gy + Math.sin(aimAngle + Math.PI/2)*14;
  const nockX = gx - Math.cos(aimAngle) * 6, nockY = gy - Math.sin(aimAngle) * 6;
  ctx.shadowColor = '#B040E0'; ctx.shadowBlur = 6;
  ctx.strokeStyle = '#D080F0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(topX, topY); ctx.lineTo(nockX, nockY); ctx.lineTo(botX, botY); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.restore();
}

/**
 * Castle stage boss 2: a corrupted echo of the player's own Knight, reusing
 * that character's plate-armor silhouette and the world-to-local angle
 * remap it thrusts its spear with (see drawKnight), scaled up, plus the
 * corona-pulse and hit-flash techniques from the crow king.
 */
const MINOTAUR_SPRITE = { w: 26, h: 34 };
const MINOTAUR_PALETTE = {
  hide:    '#6B4A32',
  hideHi:  '#8A6242',
  hideDk:  '#43301F',
  muscle:  '#7A563A',
  horn:    '#E8DCC2',
  hornDk:  '#A89777',
  hoof:    '#2A1E14',
  eye:     '#FF3010',
  ring:    '#C8A040',
};

/**
 * A hero's build wearing a bull's head, drawn at the same 1x pixel scale as
 * every other sprite and simply taller: 26x34 against a hero's 20x24, which is
 * the 50% ceiling asked for and still leaves room to slip past in a 64px
 * corridor.
 *
 * Deliberately humanoid. The threat is that it is the same kind of thing you
 * are, and bigger, not that it is a monster filling the passage.
 */
function buildMinotaurGrid(frame) {
  const C = MINOTAUR_PALETTE;
  const g = makePixelGrid(MINOTAUR_SPRITE.w, MINOTAUR_SPRITE.h);
  const swing = frame === 'a' ? 3 : frame === 'b' ? -3 : 0;

  /**
   * A two-pixel limb. A quadratic sampled once per few pixels of its length
   * leaves a dotted line, and at 26x34 a dotted line reads as damage rather
   * than as a leg; the sample count here is well over the curve's length, so
   * every step lands on a cell adjacent to the last.
   */
  const limb = (p0, p1, p2, c) => {
    pixelCurve(g, p0, p1, p2, c, 24);
    pixelCurve(g, [p0[0] + 1, p0[1]], [p1[0] + 1, p1[1]], [p2[0] + 1, p2[1]], c, 24);
  };

  // Legs, digitigrade-ish, ending in hooves over a fetlock band. The stride
  // is a third of the arms' swing: at the full swing the two feet land on
  // the same column, which was invisible while the legs were dotted lines
  // and reads as one leg the moment they are solid.
  // Hooves sit a column apart at every stride: this sprite skips the
  // pixelOutline pass, so two adjacent hooves in one colour fuse into a
  // single bar with nothing to seam them.
  const stride = swing / 3;
  limb([9, 22], [9 + stride * 0.4, 27], [9 + stride, 31], C.muscle);
  limb([16, 22], [16 - stride * 0.4, 27], [16 - stride, 31], C.muscle);
  pixelRect(g, 9 + stride, 30, 2, 1, C.hideDk);
  pixelRect(g, 16 - stride, 30, 2, 1, C.hideDk);
  pixelRect(g, 8 + stride, 31, 4, 3, C.hoof);
  pixelRect(g, 15 - stride, 31, 4, 3, C.hoof);

  // Torso: broad chest tapering to the waist
  pixelRect(g, 7, 12, 12, 8, C.hide);
  pixelRect(g, 8, 20, 10, 3, C.hideDk);
  pixelRect(g, 9, 13, 8, 4, C.hideHi);
  // Pectoral shading, one ab line under it, and the belt over the waist
  pixelRect(g, 12, 13, 1, 6, C.hideDk);
  pixelRect(g, 9, 18, 8, 1, C.hideDk);
  pixelRect(g, 8, 20, 10, 1, C.ring);

  // Arms, swinging opposite the legs, each with a shoulder cap
  limb([5, 13], [2, 17 + swing], [2, 21 + swing], C.muscle);
  limb([19, 13], [22, 17 - swing], [22, 21 - swing], C.muscle);
  pixelRect(g, 5, 12, 3, 2, C.hideHi);
  pixelRect(g, 18, 12, 3, 2, C.hideHi);
  pixelRect(g, 1, 21 + swing, 4, 3, C.hideDk);
  pixelRect(g, 21, 21 - swing, 4, 3, C.hideDk);

  // Neck
  pixelRect(g, 11, 10, 4, 3, C.hideDk);

  // Bull skull: broad muzzle, heavy brow, and the eyes under it — the one
  // palette entry this sprite declared and never used
  pixelEllipse(g, 13, 6, 6, 5, C.hide);
  pixelRect(g, 10, 7, 7, 4, C.hideHi);       // muzzle plate
  pixelRect(g, 11, 10, 5, 1, C.hideDk);      // mouth line
  setPixel(g, 11, 8, C.hideDk); setPixel(g, 15, 8, C.hideDk);   // nostrils
  pixelRect(g, 8, 3, 11, 2, C.hideDk);       // brow ridge
  setPixel(g, 10, 5, C.eye); setPixel(g, 16, 5, C.eye);

  // Horns, sweeping out and up — two cells thick and densely sampled, for
  // the same reason the limbs are
  for (const dy of [0, 1]) {
    pixelCurve(g, [7, 4 + dy], [3, 2 + dy], [1, 0 + dy], C.horn, 16);
    pixelCurve(g, [19, 4 + dy], [23, 2 + dy], [25, 0 + dy], C.horn, 16);
  }
  setPixel(g, 1, 0, C.hornDk); setPixel(g, 25, 0, C.hornDk);
  setPixel(g, 2, 1, C.hornDk); setPixel(g, 24, 1, C.hornDk);
  // Nose ring, the one bit of gear
  pixelEllipse(g, 13, 12, 2, 1, C.ring);

  return g;
}

let _minotaurGrids = {};
function minotaurGrid(frame) {
  return _minotaurGrids[frame] || (_minotaurGrids[frame] = buildMinotaurGrid(frame));
}

const DARK_KNIGHT_SPRITE = { w: 40, h: 70 };
const DARK_KNIGHT_PALETTE = {
  leg: '#141018', legHi: '#2A2430',
  torso: '#241820', torsoHi: '#3A2030',
  pauldron: '#1A1018', pauldronHi: '#3A2838',
  helm: '#1A1018', helmHi: '#3A2838',
  visor: '#B040E0', crest: '#5A1030', crestHi: '#8A1A48',
  rivet: '#6A5A70',
  edge: '#0A0510',
};

/** No walk cycle — like the heroes, one static frame plus a live bob. The
 * whirlwind visual and the spear (rotates with aim, extends on a charge)
 * stay live below, same reasoning as the player Knight's own spear. */
function buildDarkKnightGrid() {
  const C = DARK_KNIGHT_PALETTE;
  const g = makePixelGrid(DARK_KNIGHT_SPRITE.w, DARK_KNIGHT_SPRITE.h);

  // Great helm — rect body with a domed top
  pixelRect(g, 10, 10, 20, 18, C.helm);
  pixelEllipse(g, 20, 10, 10, 7, C.helm);
  pixelRect(g, 10, 8, 20, 3, C.helmHi);
  for (const x of [12, 17, 23, 28]) setPixel(g, x, 9, C.rivet);

  // Crest — a plume standing on the dome, and it has to go down *after* the
  // helm: drawn before it, the dome swallowed everything but its top two
  // rows, which is why this boss had no crest to speak of.
  pixelTriangleUp(g, 20, 6, 5, 7, C.crest);
  pixelRect(g, 19, 1, 2, 5, C.crestHi);

  // Visor — a nasal bar splits the eye slit and the breath slit below is
  // barred into a grille, the same read as the player Knight's helm. That
  // resemblance is the point: this boss is his echo.
  pixelRect(g, 12, 16, 16, 3, C.visor);
  pixelRect(g, 19, 16, 2, 3, C.helm);
  pixelRect(g, 14, 21, 11, 3, C.visor);
  for (const x of [17, 20, 23]) pixelRect(g, x, 21, 1, 3, C.helm);
  pixelRect(g, 12, 26, 16, 2, C.pauldronHi); // gorget under the helm

  // Pauldrons, banded into lames and spiked on the outer edge
  pixelTriangleUp(g, 3, 29, 3, 6, C.pauldron);
  pixelTriangleUp(g, 36, 29, 3, 6, C.pauldron);
  pixelRect(g, 0, 28, 8, 11, C.pauldron);
  pixelRect(g, 32, 28, 8, 11, C.pauldron);
  pixelRect(g, 0, 28, 8, 3, C.pauldronHi);
  pixelRect(g, 32, 28, 8, 3, C.pauldronHi);
  pixelRect(g, 0, 34, 8, 1, C.helmHi);
  pixelRect(g, 32, 34, 8, 1, C.helmHi);

  // Torso — a centre ridge, a belt, and lames stepped down the belly. Left
  // plain it is twenty-six unbroken rows of one colour, the flattest run of
  // pixels in the file.
  pixelRect(g, 5, 28, 30, 26, C.torso);
  pixelRect(g, 8, 30, 10, 9, C.torsoHi);
  pixelRect(g, 19, 28, 2, 13, C.torsoHi);
  pixelRect(g, 5, 41, 30, 2, C.helm);
  pixelRect(g, 17, 41, 6, 2, C.crest);
  for (const y of [45, 48, 51]) pixelRect(g, 5, y, 30, 1, C.helm);

  // Legs, with a knee cop, a greave band and a sabaton wider than the shin
  pixelRect(g, 7, 52, 11, 16, C.leg);
  pixelRect(g, 22, 52, 11, 16, C.leg);
  pixelRect(g, 7, 52, 11, 3, C.legHi);
  pixelRect(g, 22, 52, 11, 3, C.legHi);
  pixelRect(g, 8, 58, 9, 2, C.legHi);
  pixelRect(g, 23, 58, 9, 2, C.legHi);
  pixelRect(g, 7, 64, 11, 1, C.pauldronHi);
  pixelRect(g, 22, 64, 11, 1, C.pauldronHi);
  pixelRect(g, 6, 66, 13, 3, C.helm);
  pixelRect(g, 21, 66, 13, 3, C.helm);
  pixelRect(g, 6, 66, 13, 1, C.pauldronHi);
  pixelRect(g, 21, 66, 13, 1, C.pauldronHi);

  return pixelOutline(g, C.edge);
}

let _darkKnightGrid = null;
function darkKnightGrid() { return _darkKnightGrid || (_darkKnightGrid = buildDarkKnightGrid()); }

/**
 * Every baked pixel-art grid this module owns, in one place.
 *
 * Sprite art is a PixelGrid (see src/render/pixel-grid.ts) long before it is
 * a canvas, so listing the builders here is what lets the headless tests read
 * the art itself — dimensions, palette, silhouette — with no DOM and no frame
 * loop, the same way devHooks exposes the simulation. A row carries the
 * sprite box the draw code passes to spriteCanvas, the exact kinds and frames
 * its builder is ever called with, and one uniform way to build one; the
 * builders' own signatures differ, and the difference stops here.
 *
 * The heroes are not rows: their grids live in src/render/character-grids.ts,
 * which is plain TypeScript and imported by its own test directly.
 */
const SPRITE_GRIDS = {
  crow:       { sprite: CROW_SPRITE,        kinds: ['normal', 'white'],       frames: ANIM_FRAMES, build: buildCrowGrid },
  skeleton:   { sprite: SKELETON_SPRITE,    kinds: ['normal', 'fire', 'ice'], frames: ANIM_FRAMES, build: buildSkeletonGrid },
  rat:        { sprite: RAT_SPRITE,         kinds: ['rat'],                   frames: ANIM_FRAMES, build: buildRatGrid },
  crowking:   { sprite: CROW_KING_SPRITE,   kinds: ['crowking'],              frames: ANIM_FRAMES, build: (_kind, frame) => buildCrowKingGrid(frame) },
  minotaur:   { sprite: MINOTAUR_SPRITE,    kinds: ['minotaur'],              frames: ANIM_FRAMES, build: (_kind, frame) => buildMinotaurGrid(frame) },
  darkarcher: { sprite: DARK_ARCHER_SPRITE, kinds: ['dark_archer'],           frames: ['still'],   build: () => buildDarkArcherGrid() },
  darkknight: { sprite: DARK_KNIGHT_SPRITE, kinds: ['dark_knight'],           frames: ['still'],   build: () => buildDarkKnightGrid() },
};

function drawDarkKnight() {
  const bx = boss.x, by = boss.y + CONFIG.hudHeight;
  const bobY = 1.2 * Math.sin(loopT * 1.2);
  const facing = boss.facing || 1;
  const charging = boss.bstate === 'charge';
  const aimAngle = charging && boss.chargeTarget
    ? Math.atan2(boss.chargeTarget.y - boss.y, boss.chargeTarget.x - boss.x)
    : Math.atan2(player.y - boss.y, player.x - boss.x);

  ctx.save(); ctx.translate(bx, by); ctx.scale(facing, 1);

  // Whirlwind visual (behind the body) — same three-rotating-arcs technique
  // as the player's own whirlwind (see drawKnight), in the dark knight's own
  // red/purple palette instead of the player's steel blue.
  if (boss.bstate === 'whirlwind') {
    const wAlpha = Math.min(1, boss.stateTimer / 0.4);
    for (let i = 0; i < 3; i++) {
      const baseA = loopT * 9 + (i / 3) * Math.PI * 2;
      ctx.save();
      ctx.globalAlpha = wAlpha * (0.45 + 0.3 * Math.sin(loopT * 14 + i * 2.1));
      ctx.strokeStyle = '#FF1F1F';
      ctx.shadowColor  = '#B040E0';
      ctx.shadowBlur   = 10;
      ctx.lineWidth    = 3;
      const r = CONFIG.darkKnightWhirlwindRadius;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.42, baseA,        baseA + 1.15); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.72, baseA + 0.38, baseA + 1.55); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.93, baseA + 0.65, baseA + 1.80); ctx.stroke();
      ctx.restore();
    }
  }

  // Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 26, 22, 6, 0, 0, Math.PI*2); ctx.fill();

  // Corona — dark magic aura, redder than the archer's
  const pulse = 0.5 + 0.5 * Math.sin(loopT * 2);
  ctx.shadowColor = '#FF1F1F'; ctx.shadowBlur = 20 + 8 * pulse;
  ctx.fillStyle = `rgba(140,20,20,${(0.18 + 0.12*pulse).toFixed(2)})`;
  ctx.beginPath(); ctx.arc(0, bobY, 32 + 4*pulse, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  if (boss.hitFlash > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(0, bobY, 20, 28, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore(); return;
  }

  // Pixel-art armor (see buildDarkKnightGrid)
  const dkDx = -(DARK_KNIGHT_SPRITE.w) / 2, dkDy = -44 + Math.round(bobY);
  ctx.drawImage(spriteCanvas('darkknight', darkKnightGrid(), DARK_KNIGHT_SPRITE.w, DARK_KNIGHT_SPRITE.h), dkDx, dkDy);

  // Spear — extends forward on a charge
  ctx.save();
  ctx.rotate(mirrorAngle(aimAngle, facing));
  ctx.translate(charging ? 14 : 0, 0);
  ctx.strokeStyle = '#2A2018'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(30, 0); ctx.stroke();
  ctx.fillStyle = '#B0B0C0';
  ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(22, -5); ctx.lineTo(22, 5); ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.restore();
}

/**
 * The minotaur, with the state he is in readable at a glance.
 *
 * No HP bar: he does not have HP, and drawing an empty one would promise
 * progress that never comes. The stun ring is the only feedback a hit gives,
 * so it has to be unmistakable.
 */
const _commanderGrids = {};
function commanderGrid(frame) {
  return _commanderGrids[frame] || (_commanderGrids[frame] = buildCommanderGrid(frame));
}

/**
 * The commander. Same ground shadow and hit flash every other body uses, plus
 * a dust streak behind a committed charge so the one dangerous state is
 * visible from across the room.
 */
function drawCommander() {
  const b = boss;
  const cx = b.x, cy = b.y + CONFIG.hudHeight;
  const flashOn = b.hitFlash > 0;
  const frame = animFrame3(b.wingPhase);
  const grid = commanderGrid(frame);

  ctx.save();
  ctx.translate(cx + (b.knockX || 0), cy + (b.knockY || 0));
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, 13, 15, 3.5, 0, 0, Math.PI * 2); ctx.fill();

  if (b.charge > 0) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = COMMANDER_PALETTE.cloth;
    for (let i = 1; i <= 3; i++) {
      ctx.fillRect(-Math.cos(b.chargeAngle) * (10 + i * 9) - 3, -6 + i, 6, 3);
    }
    ctx.globalAlpha = 1;
  }

  if (b.facing < 0) ctx.scale(-1, 1);
  const sprite = flashOn
    ? spriteFlashCanvas(`commander|${frame}`, grid, COMMANDER_SPRITE.w, COMMANDER_SPRITE.h, '#ffffff')
    : spriteCanvas(`commander|${frame}`, grid, COMMANDER_SPRITE.w, COMMANDER_SPRITE.h);
  if (flashOn) { ctx.shadowColor = '#FFFFFF'; ctx.shadowBlur = 10; }
  ctx.drawImage(sprite, -COMMANDER_SPRITE.w / 2, -16);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawMinotaur() {
  const bx = boss.x, by = boss.y + CONFIG.hudHeight;
  const flashOn = boss.hitFlash > 0 && Math.floor(boss.hitFlash * 20) % 2 === 0;
  const stunned = bossDazePhase() === 'stun';
  const frame = animFrame3(boss.wingPhase);
  const grid = minotaurGrid(frame);

  ctx.save(); ctx.translate(bx, by);

  // Ground shadow, wider than a hero's because he is
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 16, 13, 3.5, 0, 0, Math.PI*2); ctx.fill();

  // Windup tell: dust kicking back and a red glow building at the horns
  if (boss.bstate === 'wind') {
    const t = Math.min(1, boss.stateTimer / CONFIG.minotaurWindupSecs);
    ctx.globalAlpha = 0.30 + 0.35 * t;
    ctx.shadowColor = '#FF3010'; ctx.shadowBlur = 8 + 14 * t;
    ctx.strokeStyle = '#FF3010'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -12, 15 + 6 * t, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    // The line he is about to run down, so the tell is directional, not just loud
    ctx.globalAlpha = 0.25 + 0.3 * t;
    ctx.setLineDash([6, 5]); ctx.strokeStyle = '#FF6040'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(boss.chargeDX * 150, boss.chargeDY * 150);
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // Charge: speed streaks trailing behind him
  if (boss.bstate === 'charge') {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#C8A040'; ctx.lineWidth = 2;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.moveTo(-boss.chargeDX * 10 * k, -boss.chargeDY * 10 * k - 6 + k * 4);
      ctx.lineTo(-boss.chargeDX * 26 * k, -boss.chargeDY * 26 * k - 6 + k * 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const dx = -MINOTAUR_SPRITE.w / 2, dy = -MINOTAUR_SPRITE.h + 16;
  const cvs = flashOn
    ? spriteFlashCanvas(`minotaur|${frame}`, grid, MINOTAUR_SPRITE.w, MINOTAUR_SPRITE.h, '#ffffff')
    : spriteCanvas(`minotaur|${frame}`, grid, MINOTAUR_SPRITE.w, MINOTAUR_SPRITE.h);
  ctx.save(); ctx.scale(boss.facing, 1);
  ctx.drawImage(cvs, boss.facing === 1 ? dx : dx, dy);
  ctx.restore();

  // Eyes, stamped over the skull
  const eye = glowDotStamp(MINOTAUR_PALETTE.eye, 1, 4);
  ctx.drawImage(eye, dx + 10 - eye.width/2, dy + 6 - eye.height/2);
  ctx.drawImage(eye, dx + 16 - eye.width/2, dy + 6 - eye.height/2);

  // Stunned: the one thing a hit actually does, so it reads loudly
  if (stunned) {
    const p = 0.5 + 0.5 * Math.sin(loopT * 12);
    ctx.shadowColor = '#FFD040'; ctx.shadowBlur = 10 + 6 * p;
    ctx.strokeStyle = `rgba(255,208,64,${(0.65 + 0.3*p).toFixed(2)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -22, 12, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
    for (let k = 0; k < 3; k++) {
      const a = loopT * 5 + (k / 3) * Math.PI * 2;
      ctx.fillStyle = '#FFD040';
      ctx.fillRect(Math.cos(a) * 12 - 1, -22 + Math.sin(a) * 5 - 1, 2, 2);
    }
  }

  ctx.restore();
}

function drawBossEntrance() {
  if (!entrance) return;
  const e = entrance, t = e.timer;
  let flashA = 0;
  if (t < 0.08) flashA = 0.9*(1-t/0.08);
  else if (t < 0.16) flashA = 0.9*(1-(t-0.08)/0.08);
  if (flashA > 0) { ctx.fillStyle = `rgba(255,255,255,${flashA})`; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH); }
  if (e.overlayAlpha > 0) { ctx.fillStyle = `rgba(0,0,0,${e.overlayAlpha})`; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH); }
  if (e.textProgress > 0) {
    const BOSS_TEXT = BOSS_ENTRY_TEXT[bossStage];
    ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 4 + 4 * Math.sin(loopT * 4);
    ctx.fillStyle = '#39FF14'; ctx.font = '24px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(BOSS_TEXT.slice(0, Math.floor(e.textProgress)), CONFIG.canvasW/2, CONFIG.canvasH/2);
    ctx.shadowBlur = 0;
  }
}

/**
 * The HUD's four lanes. A lane's contents never move another lane's
 * contents: every element inside one has a literal x, so picking something
 * up changes a value and never a position. This replaces a running `rx`
 * accumulator where each optional item advanced the next by a hardcoded
 * amount, which meant a fire arrow pickup shifted everything to its right
 * and nothing in the strip had a position worth learning.
 *
 * A · VITALS       health, and nothing else
 * B · CONSUMABLES  every countable pool
 * C · CONTEXT      run state, or the boss, or the maze objective
 * D · STATUS       cooldowns and non-countable power-ups
 */
/**
 * The width the HUD band is laid out for, which is the canvas width it was
 * drawn against and no longer follows.
 *
 * The four lanes below sum to exactly this, and the painters inside them use
 * absolute coordinates — `drawReservePool(key, 240 + i * 100)` and the like —
 * so the band cannot be stretched without re-laying out every one of them. It
 * is therefore drawn at its designed width and centred, with `hudBandInset()`
 * as the single offset. On a wider canvas that leaves dead bar either side.
 *
 * Reflowing the lanes from `CONFIG.canvasW` is the real fix and is its own
 * change; this is the part that keeps the HUD readable in the meantime.
 */
const HUD_BAND_W = 1056;

/** Where the fixed-width HUD band starts, so it sits centred on any canvas. */
function hudBandInset() {
  return Math.max(0, Math.round((CONFIG.canvasW - HUD_BAND_W) / 2));
}

const LANE = {
  A: { x:   0, w: 232 },
  B: { x: 232, w: 280 },
  C: { x: 512, w: 288 },
  D: { x: 800, w: 256 },
};

/**
 * One counted track: always ten cells, always the same box, so the geometry
 * is identical either side of the breakpoint and only the subdivision
 * changes. Under the limit a cell is one unit and capacity is countable at a
 * glance; over it each cell is `max/10` and the boundary cell fills
 * proportionally, which is what lets an upgraded max grow without the row
 * ever reflowing or colliding with its neighbour.
 *
 * The proportional cell keeps a 2px floor while the value is at least 1, so
 * "almost gone" never renders as "gone".
 */
function drawCellTrack(x, y, cells, pitch, body, h, cur, max, colOn, colDim) {
  const perCell = max / cells;
  for (let i = 0; i < cells; i++) {
    const cx = x + i * pitch;
    ctx.fillStyle = colDim;
    ctx.fillRect(cx, y, body, h);
    const filled = Math.min(1, Math.max(0, cur / perCell - i));
    if (filled <= 0) continue;
    let w = Math.floor(body * filled);
    if (w < 2 && cur >= 1) w = 2;
    ctx.fillStyle = colOn;
    ctx.fillRect(cx, y, w, h);
  }
}

/**
 * Shape vocabulary. Every HUD item is a shape in its own colour plus a
 * count, replacing letter codes ([R:] [F:] [J:] [FS:] [L:] [FB:]) that
 * needed a legend nobody ships. Each painter fills an `s` by `s` box from
 * the current origin using whatever fill and stroke the caller set, so one
 * glyph serves the lit and dimmed states without knowing which it is in.
 *
 * Hue carries damage type and shape carries delivery: the fire family all
 * share #FF7A1F and differ only in outline.
 */
const GLYPH = {
  // Momentum: three speed lines, which is the one idiom in this table that is
  // about the hero rather than about what he throws.
  momentum: (s) => { ctx.lineWidth = 2;
    for (const [y, w] of [[0.28, 0.9], [0.5, 0.65], [0.72, 0.85]]) {
      ctx.beginPath(); ctx.moveTo(s * 0.08, s * y); ctx.lineTo(s * w, s * y); ctx.stroke();
    } },
  // Focus: a four-pointed diamond, which is the one shape in this table that
  // is not a weapon. It should not — a point of Focus is not a projectile, it
  // is what a projectile is bought with.
  focus: (s) => { const m = s/2;
    ctx.beginPath();
    ctx.moveTo(m, s*0.08); ctx.lineTo(s*0.88, m); ctx.lineTo(m, s*0.92); ctx.lineTo(s*0.12, m);
    ctx.closePath(); ctx.fill(); },
  arrow: (s) => { const m = s/2;
    ctx.beginPath(); ctx.moveTo(s*0.95, m); ctx.lineTo(s*0.5, m-s*0.3); ctx.lineTo(s*0.5, m+s*0.3); ctx.closePath(); ctx.fill();
    ctx.fillRect(s*0.08, m-s*0.07, s*0.45, s*0.14); },
  fireArrow: (s) => { const m = s/2;
    ctx.beginPath(); ctx.moveTo(s*0.95, m); ctx.lineTo(s*0.5, m-s*0.3); ctx.lineTo(s*0.5, m+s*0.3); ctx.closePath(); ctx.fill();
    ctx.fillRect(s*0.08, m-s*0.07, s*0.45, s*0.14);
    ctx.fillRect(0, m-s*0.28, s*0.12, s*0.56); },
  ricochet: (s) => { const m = s/2; ctx.lineWidth = 2;
    for (const dx of [0.15, 0.5]) { ctx.beginPath();
      ctx.moveTo(s*dx, m-s*0.3); ctx.lineTo(s*(dx+0.28), m); ctx.lineTo(s*dx, m+s*0.3); ctx.stroke(); } },
  dynamite: (s) => { ctx.fillRect(s*0.28, s*0.28, s*0.44, s*0.62);
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s*0.5, s*0.28); ctx.lineTo(s*0.72, s*0.06); ctx.stroke(); },
  // Three mini-bombs fanned across the barrage's own arc, not just a row.
  barrage: (s) => { [[0.22, 0.62], [0.5, 0.42], [0.78, 0.62]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(s*x, s*y, s*0.14, 0, Math.PI*2); ctx.fill(); }); },
  // Round body and a stub of fuse: the sapper's bomb, not a stick of dynamite.
  bomb: (s) => { ctx.beginPath(); ctx.arc(s*0.48, s*0.6, s*0.3, 0, Math.PI*2); ctx.fill();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s*0.66, s*0.36); ctx.lineTo(s*0.84, s*0.14); ctx.stroke(); },
  // Two planted feet on a ground line: the chip says "still", not "shoot".
  brace: (s) => { ctx.fillRect(s*0.2, s*0.28, s*0.18, s*0.42);
    ctx.fillRect(s*0.62, s*0.28, s*0.18, s*0.42);
    ctx.fillRect(s*0.1, s*0.76, s*0.8, s*0.12); },
  satchel: (s) => { ctx.fillRect(s*0.15, s*0.4, s*0.7, s*0.5);
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s*0.3, s*0.4); ctx.lineTo(s*0.7, s*0.4); ctx.stroke(); },
  javelin: (s) => { ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s*0.1, s*0.9); ctx.lineTo(s*0.72, s*0.28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.95, s*0.05); ctx.lineTo(s*0.62, s*0.2); ctx.lineTo(s*0.8, s*0.38); ctx.closePath(); ctx.fill(); },
  fireSword: (s) => { ctx.fillRect(s*0.43, s*0.05, s*0.14, s*0.6);
    ctx.fillRect(s*0.22, s*0.62, s*0.56, s*0.12);
    ctx.fillRect(s*0.45, s*0.74, s*0.1, s*0.2); },
  laser: (s) => { const m = s/2;
    ctx.fillRect(s*0.15, m-s*0.07, s*0.7, s*0.14);
    ctx.fillRect(s*0.1, m-s*0.24, s*0.08, s*0.48);
    ctx.fillRect(s*0.82, m-s*0.24, s*0.08, s*0.48); },
  fireBolt: (s) => { [[0.2, 0.7], [0.34, 0.52], [0.48, 0.34]].forEach(([y, w], i) =>
    ctx.fillRect(s*0.12, s*(y + 0.12*i), s*w, s*0.1)); },
  spin: (s) => { const m = s/2; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.beginPath();
      ctx.arc(m, m, s*0.36, i*2.09, i*2.09 + 1.3); ctx.stroke(); } },
  bolt: (s) => { ctx.beginPath();
    ctx.moveTo(s*0.58, s*0.05); ctx.lineTo(s*0.28, s*0.52); ctx.lineTo(s*0.48, s*0.52);
    ctx.lineTo(s*0.4, s*0.95); ctx.lineTo(s*0.72, s*0.44); ctx.lineTo(s*0.5, s*0.44); ctx.closePath(); ctx.fill(); },
  storm: (s) => { ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s*0.5, s*0.36, s*0.3, Math.PI*0.9, Math.PI*2.1); ctx.stroke();
    GLYPH.bolt(s*0.7); },
  block: (s) => { const m = s/2, r = s*0.42;
    ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(m, m-r); ctx.lineTo(m+r, m-r*0.4); ctx.lineTo(m, m+r); ctx.lineTo(m-r, m-r*0.4);
    ctx.closePath(); ctx.stroke(); },
  shield: (s) => { const m = s/2; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI/6 + i*Math.PI/3;
      const px = m + s*0.42*Math.cos(a), py = m + s*0.42*Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); ctx.stroke(); },
  feather: (s) => { const m = s/2; ctx.beginPath();
    ctx.moveTo(m, 0); ctx.quadraticCurveTo(s, m, m, s); ctx.quadraticCurveTo(0, m, m, 0);
    ctx.closePath(); ctx.fill(); },
  // Two chevrons pointing the same way with a gap between them: something
  // that was here, and is now there.
  blink: (s) => { const m = s/2; ctx.lineWidth = 2;
    [[-0.30, -0.06], [0.06, 0.30]].forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(m + s*a, m - s*0.22);
      ctx.lineTo(m + s*b, m);
      ctx.lineTo(m + s*a, m + s*0.22);
      ctx.stroke();
    }); },
  snipe: (s) => { const m = s/2; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m, m, s*0.3, 0, Math.PI*2); ctx.stroke();
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => { ctx.beginPath();
      ctx.moveTo(m + dx*s*0.36, m + dy*s*0.36); ctx.lineTo(m + dx*s*0.5, m + dy*s*0.5); ctx.stroke(); }); },
  key: (s) => { const m = s/2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s*0.3, m, s*0.24, 0, Math.PI*2); ctx.stroke();
    ctx.fillRect(s*0.52, m-s*0.07, s*0.46, s*0.14);
    ctx.fillRect(s*0.82, m, s*0.08, s*0.24); },
};

/** Every countable pool: which glyph draws it, and the colour it owns. */
const POOL = {
  arrows:         { glyph: 'arrow',     color: '#D4A832' },
  ricochetArrows: { glyph: 'ricochet',  color: '#39E0FF' },
  fireArrows:     { glyph: 'fireArrow', color: '#FF7A1F' },
  dynamites:      { glyph: 'dynamite',  color: '#FFB400' },
  bombs:          { glyph: 'bomb',      color: '#FF7A1A' },
  fireBombs:      { glyph: 'bomb',      color: '#FF7A1F' },
  iceBombs:       { glyph: 'bomb',      color: '#40D0F0' },
  satchels:       { glyph: 'satchel',   color: '#B23A00' },
  knightJavelins: { glyph: 'javelin',   color: '#D9B98A' },
  laserStreams:   { glyph: 'laser',     color: '#39E0FF' },
  fireBolts:      { glyph: 'fireBolt',  color: '#FF7A1F' },
  focus:          { glyph: 'focus',     color: '#8888FF' },
};

/**
 * Lane B per character: the pool being fired, then the reserves.
 *
 * The knight and wizard have no countable primary, since a spear and a bolt
 * are gated by cooldown rather than ammo, so their active slot is empty and
 * their pools sit in reserve. Every listed pool is always drawn, dimmed at
 * zero rather than hidden, which is what keeps the positions fixed.
 */
const LANE_B = {
  archer: { active: 'arrows', reserve: ['ricochetArrows', 'fireArrows', 'dynamites'] },
  ranger: { active: 'arrows', reserve: ['ricochetArrows', 'fireArrows', 'satchels'] },
  knight: { active: null,     reserve: ['knightJavelins'] },
  // Focus is the wizard's active pool now. The note above about him having no
  // countable primary was true right up until a bolt started costing something.
  wizard: { active: 'focus',  reserve: ['laserStreams', 'fireBolts'] },
  // A pouch like the archer's now rather than nothing: the bombs being thrown,
  // then the two elemental kinds in reserve.
  sapper: { active: 'bombs',  reserve: ['fireBombs', 'iceBombs'] },
};

/**
 * Lane D per character: cooldowns and non-countable power-ups, assigned once
 * and never reordered during a run.
 *
 * The knight fills all four slots, which is what sizes the lane. Countable
 * things are deliberately absent even where they look like status: javelins,
 * laser streams and fire bolts are pools, and pools live in lane B.
 */
const LANE_D = {
  archer: ['brace', 'power', 'shield'],
  ranger: ['momentum', 'net', 'shield'],
  knight: ['whirlwind', 'block', 'fireSword', 'shield'],
  wizard: ['bolt', 'storm', 'blink', 'shield'],
  sapper: ['charge', 'barrage', 'sapperShot', 'chain', 'shield'],
};

/** Reads one chip's live state. A table rather than a switch, so a new
 *  ability is a new row instead of another arm on a growing chain. */
const CHIP = {
  whirlwind: () => cooldownChip('spin', knightWhirlwindCD, CONFIG.knightWhirlwindCooldown, knightWhirlwindTimer),
  block:     () => cooldownChip('block', playerShield ? 0 : knightBlockCD, TALENTS.stat('towerGuard'), 0),
  bolt:      () => cooldownChip('bolt', wizBoltCD, CONFIG.wizBoltCooldown, 0),
  charge:    () => cooldownChip('dynamite', sapperChargeCD, TALENTS.stat('shortFuse'), 0),
  storm:     () => cooldownChip('storm', stormCD, TALENTS.stormCooldown(), 0),
  blink:     () => cooldownChip('blink', wizBlinkCD, CONFIG.wizBlinkCooldown, 0),
  // Reads as live while the bow is bent, so the bar on the body and the chip
  // in the lane say the same thing.
  power:     () => cooldownChip('arrow', archerPowerCD, CONFIG.archerPowerCooldown,
                                archerDraw.on ? TALENTS.stat('fullDraw') : 0),
  // Not a cooldownChip: nothing is gated and nothing is spent, so "READY"
  // would be a lie. It reports a stance that is filling, full, or draining,
  // and the fraction is the same number the arrows are multiplied by.
  // Not a cooldownChip either, and for the same reason Brace is not: nothing
  // is gated and nothing is spent. It reports a bonus that is building, full,
  // or falling away, and the label is the figure the bolts are multiplied by.
  momentum:  () => ({
    glyph: 'momentum', color: '#FFCC00', lit: rangerMomentum >= 1,
    // The talent's ceiling, not the base one. FULL TILT raises what a full
    // meter is worth and this label is the only place the player is told
    // the figure, so reading CONFIG here printed +30% at a bonus of +45%.
    label: rangerMomentum <= 0 ? ''
      : '+' + Math.round(rangerMomentum * TALENTS.stat('fullTilt') * 100) + '%',
    frac: rangerMomentum >= 1 ? null : rangerMomentum,
  }),
  brace:     () => ({
    glyph: 'brace', color: '#EAFF6A', lit: braceLevel >= 1,
    label: braceLevel >= 1 ? 'SET' : braceLevel <= 0 ? '' : Math.round(braceLevel * 100) + '%',
    frac: braceLevel >= 1 ? null : braceLevel,
  }),
  net:       () => cooldownChip('satchel', rangerNetCD, CONFIG.netCooldown,
                                rangerNet.on ? CONFIG.netDrawMaxSecs : 0),
  fireSword: () => ({ glyph: 'fireSword', color: '#FF7A1F', lit: inv.knightFireSwordTimer > 0,
                      label: inv.knightFireSwordTimer > 0 ? inv.knightFireSwordTimer.toFixed(1) + 's' : '',
                      frac: null }),
  shield:    () => ({ glyph: 'shield', color: '#FFB400', lit: playerShield,
                      label: playerShield ? 'ON' : '', frac: null }),
  barrage:    () => cooldownChip('barrage', sapperBarrageCD, CONFIG.sapperBarrageCooldown, 0),
  // Not a cooldownChip, for the reason Brace and Momentum are not: nothing
  // is gated and nothing is spent. It reports the depth the last cascade
  // reached, which is the figure a boss's damage was multiplied by --
  // 1 + link x sapperChainBossBonus -- against the ceiling MORE LINKS
  // sets rather than the base one, so a talent is not read away.
  chain:      () => ({
    glyph: 'bomb', color: '#FF7A1A', lit: sapperChainPeak > 1,
    label: sapperChainPeak > 1 ? 'x' + sapperChainPeak : '',
    frac: sapperChainPeak > 1
      ? Math.min(1, sapperChainPeak / (TALENTS.stat('moreLinks') + 1)) : null,
  }),
  // Reuses the snipe crosshair glyph — it is a precision shot, same read as
  // everyone else's aim-down-it key, just cooldown-gated instead of held.
  sapperShot: () => cooldownChip('snipe', sapperShotCD, CONFIG.sapperShotCooldown, 0),
};

/** Shared shape for anything that recharges: ready, counting down, or live. */
function cooldownChip(glyph, cd, full, activeTimer) {
  const active = activeTimer > 0, ready = cd <= 0;
  return {
    glyph, color: '#39FF14', lit: active || ready,
    label: active ? activeTimer.toFixed(1) + 's' : ready ? 'READY' : cd.toFixed(1) + 's',
    frac:  active || ready ? null : 1 - cd / full,
  };
}

const TRACK_CELLS = 10;

/**
 * Charge, drawn at the player's feet instead of in the strip.
 *
 * Charging is an aiming decision, so it belongs where the eye already is.
 * The arc opens around the aim vector as the charge builds, which means the
 * same mark answers "how long have I held this" and "where will it go".
 */
function drawChargeArc() {
  const held = charge.on ? Math.min(1, (performance.now() - charge.t0) / 1000)
             : knightCharge.on ? knightChargeFrac()
             : 0;
  if (held <= 0) return;

  const col = held < 0.5 ? '#28B30E' : held < 0.99 ? '#39FF14' : '#F0C830';
  const half = (1.8 * held) / 2;
  ctx.save();
  ctx.translate(player.x, player.y + CONFIG.hudHeight + 6);
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.shadowColor = col;
  ctx.shadowBlur = held >= 0.99 ? 10 + 4*Math.sin(loopT*12) : 0;
  ctx.beginPath();
  ctx.arc(0, 0, 20, player.aimAngle - half, player.aimAngle + half);
  ctx.stroke();
  ctx.restore();
}

/**
 * Pickup confirmations, rising off the player.
 *
 * This is what teaches the shape vocabulary. The HUD dropped letter codes in
 * favour of glyphs, and a glyph nobody has been introduced to is worse than
 * the code it replaced, so the moment of acquisition is where the shape gets
 * learned: the same mark that will sit in lane B, at twice the size, over
 * the thing that just picked it up.
 */
const PICKUP_MARK = {
  ricochet: { glyph: 'ricochet', color: '#39E0FF' },
  fire:     { glyph: 'fireArrow', color: '#FF7A1F' },
  shield:   { glyph: 'shield',   color: '#FFB400' },
};
const PICKUP_MARK_SECS = 0.8;
let pickupMarks = [];

function addPickupMark(kind, x, y) {
  const look = PICKUP_MARK[kind];
  if (look) pickupMarks.push({ x, y, t: PICKUP_MARK_SECS, ...look });
}

function updatePickupMarks(dt) {
  for (let i = pickupMarks.length - 1; i >= 0; i--) {
    pickupMarks[i].t -= dt;
    if (pickupMarks[i].t <= 0) pickupMarks.splice(i, 1);
  }
}

function drawPickupMarks() {
  for (const m of pickupMarks) {
    const done = 1 - m.t / PICKUP_MARK_SECS;
    const rise = 16 * done;
    // Alpha only starts falling for the last 250ms, so the shape is fully
    // solid for most of its life and does not read as a flicker.
    const fade = m.t < 0.25 ? m.t / 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(m.x - 14, m.y + CONFIG.hudHeight - 24 - rise);
    ctx.fillStyle = m.color; ctx.strokeStyle = m.color;
    ctx.shadowColor = m.color; ctx.shadowBlur = 6;
    GLYPH[m.glyph](28);
    ctx.restore();
  }
}

/**
 * The two states that end a run get the screen edge to themselves, rather
 * than another line of text competing for the same 48px as everything else.
 * HP always wins: never both at once.
 */
function drawEdgeAlerts() {
  const maxHP = FEATHERS.maxHP();
  const hpFrac = playerHP > 0 ? playerHP / maxHP : 1;
  const pool = CONFIG.resources.arrows;
  const ammoFrac = (selectedChar === 'archer' || selectedChar === 'ranger') && pool.max > 0
    ? inv.arrows / pool.max : 1;

  let col = null, amp = 0;
  if (playerHP > 0 && hpFrac <= LOW_HP_FRACTION) { col = '#FF1F1F'; amp = 0.10; }
  else if (ammoFrac <= 0.10)                     { col = '#FFB400'; amp = 0.05; }
  if (!col) return;

  const y = CONFIG.hudHeight;
  ctx.save();
  ctx.globalAlpha = amp + amp * Math.sin(loopT * 8);
  ctx.strokeStyle = col; ctx.lineWidth = 6;
  ctx.shadowColor = col; ctx.shadowBlur = 12;
  ctx.strokeRect(3, y + 3, CONFIG.canvasW - 6, CONFIG.canvasH - y - 6);
  ctx.restore();
}

/**
 * Edge ticks for threats the player cannot currently account for.
 *
 * The design asked for off-screen threat markers, reasoning that on a 33x21
 * grid the thing that kills you is usually just off-frame. That is not true
 * here: the world is exactly 33x21 at 32px and there is no camera, so it
 * fills the viewport and nothing is ever off-screen. The real version of
 * that problem is a threat you cannot see rather than one you cannot reach:
 * an enemy standing in the maze's unlit dark, or a crow that has noticed you
 * while your attention is elsewhere.
 *
 * So the mechanism is the design's, pointed at the case that actually
 * exists. It also replaces the old blinking INCOMING text, and improves on
 * it, since a tick says which direction the trouble is in.
 */
const EDGE_TICK_MAX = 8;

/** A boss ticks in its own eye colour, like every other threat marker. */
function bossTickColor() {
  return boss.kind === 'minotaur' ? MINOTAUR_PALETTE.eye : '#B040E0';
}

function drawEdgeTicks() {
  const cx = CONFIG.canvasW / 2, cy = CONFIG.hudHeight + (CONFIG.canvasH - CONFIG.hudHeight) / 2;
  const threats = [];

  // Aggro only, never merely unseen. Trash that cannot be seen stays
  // unmarked on purpose: the maze deletes crows and keeps a pack of rats
  // alive at all times, so ticking every unlit one would pin six to eight
  // markers to the edge permanently. That is a live minimap of the threats
  // the dark exists to hide, and it gets more useful the darker it gets,
  // which is backwards. Rats are meant to be found, not mapped.
  for (const c of crows) {
    if (c.state !== 'aggro') continue;
    threats.push({ x: c.x, y: c.y + CONFIG.hudHeight, col: c.white ? '#FFFFFF' : '#FF1F1F' });
  }
  // The boss is the opposite case and does tick when unseen. Something
  // unkillable closing through a wall is the one threat where knowing the
  // direction, and being able to do little about it, is the point.
  if (boss && boss.bstate !== 'dead' && !litAt(boss.x, boss.y))
    threats.push({ x: boss.x, y: boss.y + CONFIG.hudHeight, col: bossTickColor() });

  if (!threats.length) return;
  threats.sort((a, b) => dist2(cx, cy, a.x, a.y) - dist2(cx, cy, b.x, b.y));

  const top = CONFIG.hudHeight + 16, bot = CONFIG.canvasH - 16;
  const left = 16, right = CONFIG.canvasW - 16;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.25 * Math.sin(loopT * 4);
  for (const th of threats.slice(0, EDGE_TICK_MAX)) {
    const ang = Math.atan2(th.y - cy, th.x - cx);
    const ex = Math.max(left, Math.min(right, cx + Math.cos(ang) * CONFIG.canvasW));
    const ey = Math.max(top,  Math.min(bot,   cy + Math.sin(ang) * CONFIG.canvasH));
    ctx.save();
    ctx.translate(ex, ey); ctx.rotate(ang);
    ctx.fillStyle = th.col; ctx.shadowColor = th.col; ctx.shadowBlur = 6;
    ctx.fillRect(-1.5, -12, 3, 24);
    ctx.restore();
  }
  ctx.restore();
}

function drawHUD(t) {
  const isBoss = appState === 'boss_fight';
  const maxHP  = FEATHERS.maxHP();
  const lowHP  = playerHP > 0 && playerHP / maxHP <= LOW_HP_FRACTION;

  ctx.fillStyle = '#0A0F0A'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.hudHeight);
  ctx.textBaseline = 'middle';

  // The band is a fixed-width island, centred. See HUD_BAND_W.
  ctx.save();
  ctx.translate(hudBandInset(), 0);
  ctx.fillStyle = '#243424';
  for (const l of [LANE.B, LANE.C, LANE.D]) ctx.fillRect(l.x, 4, 1, 38);

  drawLaneVitals(maxHP, lowHP);
  drawLaneConsumables();
  drawLaneContext(t, isBoss);
  drawLaneStatus();
  ctx.restore();

  ctx.shadowColor = lowHP ? '#FF1F1F' : '#196407';
  ctx.shadowBlur  = lowHP ? 6 + 6*Math.sin(t*8) : 4;
  ctx.strokeStyle = lowHP ? '#FF1F1F' : '#196407'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, CONFIG.hudHeight-1); ctx.lineTo(CONFIG.canvasW, CONFIG.hudHeight-1); ctx.stroke();
  ctx.shadowBlur = 0;
}

/** Lane A: health, with nothing else allowed to compete with it. */
function drawLaneVitals(maxHP, lowHP) {
  const col = lowHP ? '#FF1F1F' : '#39FF14';
  ctx.textAlign = 'left';
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillStyle = '#28B30E';
  ctx.fillText('HP', 8, 13);

  if (lowHP) { ctx.shadowColor = '#FF1F1F'; ctx.shadowBlur = 6 + 6*Math.sin(loopT*8); }
  // Plain rects rather than heart glyphs: a 12px glyph inside a 14px cell
  // leaves 1px of margin and stops resolving under the scanline pass, where
  // a solid block still reads at any count.
  drawCellTrack(8, 18, TRACK_CELLS, 16, 14, 14, playerHP, maxHP, col, '#243424');
  ctx.shadowBlur = 0;

  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'right'; ctx.fillStyle = col;
  ctx.fillText(playerHP + '/' + maxHP, 224, 30);
}

/** Lane B: the pool being fired on top, the reserves underneath. */
function drawLaneConsumables() {
  const spec = LANE_B[selectedChar];
  if (!spec) return;
  if (spec.active) drawActivePool(spec.active);
  spec.reserve.forEach((key, i) => drawReservePool(key, 240 + i * 100));
}

function drawActivePool(key) {
  const pool  = POOL[key];
  const res   = CONFIG.resources[key];
  const cur   = inv[key] || 0;
  const max   = res ? res.max : 0;
  const flash = iFlash[key] > 0 && Math.floor(iFlash[key]*12)%2 === 0;
  const col   = flash ? '#8A1010' : pool.color;

  ctx.save(); ctx.translate(240, 5);
  ctx.fillStyle = col; ctx.strokeStyle = col; GLYPH[pool.glyph](14);
  ctx.restore();

  if (max > 0) drawCellTrack(260, 7, TRACK_CELLS, 12, 10, 12, cur, max, col, '#243424');

  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'right'; ctx.fillStyle = col;
  // Floored, because Focus is a real number and the others are counts: a pool
  // mid-refill holds 2.4 points and can spend 2 of them, so 2 is what the
  // number beside it has to say. Every other pool is already whole and is
  // unaffected.
  ctx.fillText(max > 0 ? Math.floor(cur) + '/' + max : String(Math.floor(cur)), 504, 17);
}

function drawReservePool(key, x) {
  const pool = POOL[key];
  const cur  = inv[key] || 0;
  ctx.save();
  ctx.globalAlpha = cur > 0 ? 1 : 0.35;
  ctx.translate(x, 27);
  ctx.fillStyle = pool.color; ctx.strokeStyle = pool.color;
  GLYPH[pool.glyph](12);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = cur > 0 ? 1 : 0.35;
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'left'; ctx.fillStyle = pool.color;
  ctx.fillText(String(cur), x + 18, 37);
  ctx.restore();
}

/**
 * Lane C: run context, or the boss, or the maze objective.
 *
 * This is what stops a boss fight from moving the rest of the HUD. Only the
 * elements the boss is allowed to replace live here, so lanes A, B and D
 * render identically in and out of a fight.
 */
function drawLaneContext(t, isBoss) {
  const cx = LANE.C.x + LANE.C.w / 2;
  ctx.textAlign = 'center';

  if (isBoss && boss && !Number.isFinite(boss.hpMax)) {
    // The minotaur cannot be killed, so a bar would promise progress that
    // never arrives, and the divider loop in drawBossBar counts one per HP
    // point, which against Infinity is a hang rather than a slow frame.
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.shadowColor = '#C8A040'; ctx.shadowBlur = 6 + 3*Math.sin(t*3);
    ctx.fillStyle = '#C8A040';
    ctx.fillText('THE MAZE HAS A KEEPER', cx, 18);
    ctx.shadowBlur = 0;
  } else if (isBoss && boss) {
    drawBossBar(t, cx);
  } else {
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 4; ctx.fillStyle = '#39FF14';
    ctx.fillText(modeRule(gameMode).summaryStat === 'kills'
      ? 'KILLS ' + String(killCount).padStart(2, '0') + '/10'
      : 'WAVE ' + String(wave).padStart(2, '0'), cx, 18);
    ctx.shadowBlur = 0;
    ctx.font = 'bold 10px "Courier New", monospace'; ctx.fillStyle = '#28B30E';
    ctx.fillText('SCORE ' + score, cx, 34);
  }

  // Row three is identical in all three states above, so nothing here moves.
  ctx.save(); ctx.translate(520, 32); ctx.fillStyle = '#A07828'; GLYPH.feather(10); ctx.restore();
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'left'; ctx.fillStyle = '#A07828';
  ctx.fillText(String(FEATHERS.wallet()), 534, 42);

  if (mazeRun) drawMazeKeys(cx);

  ctx.textAlign = 'right'; ctx.fillStyle = '#196407';
  ctx.fillText(mapIsSiege() ? 'BASTION' : modeRule(gameMode).label, 792, 42);
  if (siegeRun) drawSiegeHud(t, cx);
}

/**
 * The siege's own line: how far through the ladder, what is left of the
 * retinue, and how the towers are holding.
 *
 * Keyed on siegeRun rather than on the mode, like everything else here, so the
 * brawl chain's last stage reads the same as the standalone one.
 */
function drawSiegeHud(t, cx) {
  const standing = standingTowers(towers);
  const hp = standing.reduce((n, t) => n + t.hp, 0);
  const full = towers.length * TOWER_MAX_HP;
  ctx.textAlign = 'center';
  // A boss on the field takes the top row, and carries the wave counter with
  // it rather than costing it -- see drawSiegeBossBar.
  const pool = siegeBossPool();
  if (pool) {
    drawSiegeBossBar(t, pool);
  } else {
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.shadowColor = '#D8B048'; ctx.shadowBlur = 4; ctx.fillStyle = '#D8B048';
    ctx.fillText('WAVE ' + siegeRun.wave + '/' + SIEGE_WAVE_COUNT, cx, 18);
    ctx.shadowBlur = 0;
  }
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillStyle = standing.length === towers.length ? '#8f8265' : '#8c3a24';
  // Rank marks rather than a count: a retinue of three seniors is not the same
  // asset as three recruits, and the HUD should say which one you have.
  const retinue = guards.map((gd) => (RANK_MARK[gd.guard.rank] || '') + gd.guard.kind.charAt(0).toUpperCase()).join(' ');
  ctx.fillText('TOWERS ' + standing.length + '/' + towers.length
    + '  ' + hp + '/' + full + '   ' + (retinue || 'ALONE'), cx, 34);
}

/** Where the boss bar sits, shared by both callers so the two cannot drift. */
const BOSS_BAR = { x: 520, y: 6, w: 272, h: 16 };

/**
 * The bar itself: track, fill, one divider per hit point, border.
 *
 * Extracted because a siege draws the same bar in the same place for a
 * different thing -- one pool shared by wave ten's pair -- and differs only in
 * what it writes on top of it. The bar is the shared part; the labelling is
 * not, so the labels stay with their callers.
 */
function drawHpBar(t, hp, hpMax, hitOn) {
  const { x, y, w, h } = BOSS_BAR;
  const frac = hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax)) : 0;

  ctx.fillStyle = '#1A2A1A'; ctx.fillRect(x, y, w, h);
  ctx.shadowColor = hitOn ? '#FFFFFF' : '#FF1F1F';
  ctx.shadowBlur  = hitOn ? 20 : 6 + 4*Math.sin(t*3);
  ctx.fillStyle   = hitOn ? '#FFFFFF' : (frac > 0.5 ? '#FF1F1F' : frac > 0.25 ? '#B23A00' : '#8A1010');
  ctx.fillRect(x, y, w * frac, h);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#0A0F0A';
  for (let i = 1; i < hpMax; i++) ctx.fillRect(x + (w/hpMax)*i - 0.5, y, 1, h);
  ctx.strokeStyle = '#FF1F1F'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Burn damage makes hp fractional; the readout shows the point still held. */
const hpReadout = (hp, hpMax) => Math.ceil(hp - 1e-6) + ' / ' + hpMax;

function drawBossBar(t, cx) {
  const hpMax = boss.hpMax || CONFIG.bossHP;
  const hitOn = boss.hitFlash > 0 && Math.floor(boss.hitFlash*18)%2 === 0;
  drawHpBar(t, boss.hp, hpMax, hitOn);

  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.fillStyle = '#FF8888';
  // The epsilon keeps float dust from rounding a whole point back up.
  ctx.fillText(hpReadout(boss.hp, hpMax), cx, 34);
}

/**
 * The siege's boss bar: one bar for however many are up.
 *
 * Its labels sit INSIDE the bar rather than under it, which is the one thing
 * it does differently from a boss fight's. A boss fight owns the whole of lane
 * C and can put the number on the row below; a siege still has to show the
 * towers and the retinue there, and the two would land on the same pixels.
 * Putting the wave on the left and the pool on the right also means the bar
 * costs the wave counter nothing -- it replaces that line and carries it.
 */
function drawSiegeBossBar(t, pool) {
  const { x, y, w, h } = BOSS_BAR;
  const flashOn = pool.flash && Math.floor(t*18)%2 === 0;
  drawHpBar(t, pool.hp, pool.hpMax, flashOn);

  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.shadowColor = '#000000'; ctx.shadowBlur = 3;
  ctx.fillStyle = '#FFFFFF';
  const mid = y + h / 2 + 3.5;
  ctx.textAlign = 'left';
  ctx.fillText('W' + siegeRun.wave + '/' + SIEGE_WAVE_COUNT, x + 6, mid);
  ctx.textAlign = 'right';
  ctx.fillText(hpReadout(pool.hp, pool.hpMax), x + w - 6, mid);
  ctx.shadowBlur = 0;
}

/**
 * The maze's two keys. Held or not held, never a count, so they get marks
 * and no number. They sit in lane C because they are objective state like
 * the wave counter, and because lane D is already full for the knight.
 */
function drawMazeKeys(cx) {
  const kinds = Object.keys(MAZE_KEYS);
  const pitch = 18;
  let x = cx - ((kinds.length - 1) * pitch) / 2 - 5;
  for (const kind of kinds) {
    const k = MAZE_KEYS[kind], held = mazeRun.held[kind];
    ctx.save();
    ctx.globalAlpha = held ? 1 : 0.35;
    ctx.translate(x, 32);
    ctx.fillStyle = held ? k.color : k.dim;
    ctx.strokeStyle = held ? k.color : k.dim;
    if (held) { ctx.shadowColor = k.color; ctx.shadowBlur = 6; }
    GLYPH.key(10);
    ctx.restore();
    x += pitch;
  }
}

/** Lane D: one chip per ability, in a slot that never reorders. */
function drawLaneStatus() {
  const chips = LANE_D[selectedChar] || [];
  chips.forEach((kind, i) => drawChip(CHIP[kind](), 804 + i * 60, 14));
}

function drawChip(c, x, y) {
  const w = 56, h = 20;
  ctx.save();
  ctx.globalAlpha = c.lit ? 0.6 : 1;
  ctx.strokeStyle = c.lit ? c.color : '#243424'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = c.lit ? 1 : 0.22;
  ctx.translate(x + 2, y + 3);
  ctx.fillStyle = c.color; ctx.strokeStyle = c.color;
  if (c.lit) { ctx.shadowColor = c.color; ctx.shadowBlur = 6; }
  GLYPH[c.glyph](14);
  ctx.restore();

  if (c.label) {
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'right'; ctx.fillStyle = c.lit ? c.color : '#243424';
    ctx.fillText(c.label, x + 52, y + 10);
  }
  // The same primitive for a recharging ability and a timed pickup, so one
  // visual language covers both.
  if (c.frac != null) {
    ctx.fillStyle = c.color;
    ctx.fillRect(x + 2, y + h - 3, (w - 4) * c.frac, 2);
  }
}

// Shared helpers for overlay screens
function _screenCrows(count, alphaBase, speedBase) {
  for (let i = 0; i < count; i++) {
    const cx = CONFIG.canvasW - ((loopT * (speedBase + i*11) + i * 148) % (CONFIG.canvasW + 80));
    const cy = 40 + i * Math.floor(CONFIG.canvasH / count) + 20*Math.sin(loopT*0.5 + i*1.3);
    const wf = Math.sin(loopT*8 + i*1.8) * 0.45;
    ctx.save(); ctx.globalAlpha = alphaBase + i*0.008; ctx.fillStyle = '#1a3a1a'; ctx.translate(cx, cy);
    ctx.beginPath(); ctx.ellipse(0,0,8,5,0,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.rotate(wf);  ctx.beginPath(); ctx.ellipse(-9,-1,8,3,0,0,Math.PI*2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.rotate(-wf); ctx.beginPath(); ctx.ellipse(9,-1,8,3,0,0,Math.PI*2); ctx.fill(); ctx.restore();
    ctx.restore();
  }
}
function _scanSweep(color, speed) {
  const scanY = (loopT * speed) % CONFIG.canvasH;
  const sg = ctx.createLinearGradient(0, scanY-10, 0, scanY+10);
  sg.addColorStop(0,'rgba(0,0,0,0)'); sg.addColorStop(0.5, color); sg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, scanY-10, CONFIG.canvasW, 20);
}
function _cornerFrame(color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  const m = 14, cl = 22;
  [[m,m,1,1],[CONFIG.canvasW-m,m,-1,1],[m,CONFIG.canvasH-m,1,-1],[CONFIG.canvasW-m,CONFIG.canvasH-m,-1,-1]]
    .forEach(([fx,fy,sx,sy]) => { ctx.beginPath(); ctx.moveTo(fx+sx*cl,fy); ctx.lineTo(fx,fy); ctx.lineTo(fx,fy+sy*cl); ctx.stroke(); });
}

/**
 * `text` cut down until it fits inside `maxW`, with a trailing ellipsis when
 * anything was dropped.
 *
 * Every string a panel draws goes through this rather than being trusted to
 * fit. Panels are sized by how many characters the roster holds, so a line
 * that fits five panels overflows six, and this screen shipped with its
 * description text drawn straight over its own borders for exactly that
 * reason: a fifth character narrowed the panels and nothing re-measured.
 *
 * The caller sets ctx.font first. measureText reads the live font, so fitting
 * against one font and drawing in another silently defeats the whole point.
 */
function _fitText(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let cut = text;
  while (cut.length > 0 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * The box a select-screen panel sits in: its fill, its border, and the glow
 * that marks the selected one.
 *
 * Shared by charselect and mapselect because it was the same five statements
 * in each, and how selection reads is one decision — a change to the glow
 * should not be able to land on one screen and not the other. `p` is a row
 * from either panel table; both carry the same four colours (bg/dimBg for the
 * fill, color/dim for the border), which is what lets one helper serve both.
 */
function _panelFrame(px, py, w, h, sel, p) {
  ctx.fillStyle = sel ? p.bg : p.dimBg;
  ctx.fillRect(px, py, w, h);
  if (sel) { ctx.shadowColor = p.color; ctx.shadowBlur = 16; }
  ctx.strokeStyle = sel ? p.color : p.dim; ctx.lineWidth = 1.5;
  ctx.strokeRect(px, py, w, h);
  ctx.shadowBlur = 0;
}

/** The muted tone the stat labels and skill slot names share, so the panel's
 * own colour stays on the values rather than being spent on the chrome. */
const PANEL_LABEL_COLOR = '#8a8a8a';

/**
 * Width kept clear to the right of every pip row for a stat's real figure.
 *
 * Reserved on all four rows and filled on the one that has a figure, so the
 * pip columns line up down the panel. Filling only the rows that carry a
 * number and letting the others reach further right would step the pips and
 * read as a layout fault rather than as the distinction it is.
 */
const STAT_VALUE_W = 20;

/**
 * One `LABEL ●●●○○ 9` row: label left, pips right-aligned inside `maxW`, and
 * the figure, where there is one, in a column reserved past them.
 *
 * Pips are drawn as rectangles rather than written as characters so the row's
 * width is arithmetic instead of a font measurement — a star-string would be
 * one more thing that fits at five panels and not at six.
 *
 * Only HP carries a figure, and that is not an oversight. `statPips` is a
 * ceiling against the roster's best, so with the current spread every derived
 * pip lands between three and five and a 7 HP hero draws the same three pips
 * whatever else changes; the number is what separates them. The other three
 * rows have nothing honest to print — RANGE and DAMAGE are authored
 * impressions of a whole kit with no unit behind them, and SPEED is world
 * units per second, which tells a player nothing.
 */
function _drawStatBar(lx, ly, maxW, bar, color) {
  ctx.textAlign = 'left';
  ctx.font = '9.5px "Courier New",monospace';
  ctx.fillStyle = PANEL_LABEL_COLOR;
  ctx.fillText(bar.label, lx, ly);

  const pipW = 7, pipGap = 3, pipH = 7;
  const rowW = STAT_SCALE * pipW + (STAT_SCALE - 1) * pipGap;
  const x0 = lx + maxW - STAT_VALUE_W - rowW, top = ly - pipH / 2;
  for (let i = 0; i < STAT_SCALE; i++) {
    const px = x0 + i * (pipW + pipGap);
    if (i < bar.pips) {
      ctx.fillStyle = color;
      ctx.fillRect(px, top, pipW, pipH);
    } else {
      ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, top + 0.5, pipW - 1, pipH - 1);
    }
  }

  if (bar.value !== undefined) {
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(String(bar.value), lx + maxW, ly);
    ctx.textAlign = 'left';
  }
}

/**
 * Difficulty as a length as well as a hue.
 *
 * The ramp runs #39FF14 green to #FF3B30 red, which is the axis most
 * colour-blind players lose, and on an unpicked panel the word was the
 * brightest thing on it — the one element that is an opinion outranking the
 * four that are facts. A filled-step meter says the same thing in a channel
 * that survives, and lets the word sit down.
 */
function _drawDifficultyMeter(lx, ly, w, diff, sel) {
  const gap = 3;
  const stepW = (w - gap * (DIFFICULTY_STEPS - 1)) / DIFFICULTY_STEPS;
  for (let i = 0; i < DIFFICULTY_STEPS; i++) {
    ctx.fillStyle = i < diff.order ? (sel ? diff.color : '#4a5a48') : '#20281f';
    ctx.fillRect(lx + i * (stepW + gap), ly, stepW, 4);
  }
  ctx.textAlign = 'center';
  ctx.font = '9.5px "Courier New",monospace';
  ctx.fillStyle = sel ? diff.color : '#93a08f';
  ctx.fillText(diff.label, lx + w / 2, ly + 16);
  ctx.textAlign = 'left';
}

/** Reuses the same cached grids gameplay draws from — one real sprite per
 * hero instead of a fifth hand-drawn mini-vector copy per character. The
 * gentle bob is the only animation now; the vector version's per-character
 * sway/pulse lived on live overlays this preview has no equivalent of.
 *
 * Takes the panel row rather than the character name so the grid comes from
 * the row being drawn (see CHAR_PANELS.preview). That also means one grid is
 * built per panel per frame instead of all five: the lookup this replaced was
 * a table literal, so every call rebuilt every character's grid to use one. */
/**
 * The archer's shop window: walk in, plant, draw a power shot, loose it, then
 * snap a quick one off before walking on.
 *
 * A routine rather than a loop of the walk, because the panel is where someone
 * decides which hero to be and the walk alone says nothing about him. Every
 * pose in it is one the game already computes — a stride frame, a draw
 * fraction, a release — so this schedules them rather than drawing anything new.
 *
 * Everything is aimed forward. A first version turned him to shoot back over
 * his shoulder and it exposed a real gap: the body is mirrored by `facing`,
 * which the preview does not set, so he pointed the arrow behind himself while
 * still looking ahead. Aiming somewhere a hero is not facing is wrong for every
 * character, not just this one — see the heading rule in
 * docs/character-rebuild-playbook.md — so the routine stays forward until the
 * body can turn with the aim.
 *
 * Times are absolute seconds through one cycle, so reading the ladder top to
 * bottom is reading the performance in order.
 */
function _archerPreviewAct(t) {
  const u = t % 5.0;
  // Walking in, bow down.
  if (u < 1.6) return { walking: true, draw: 0, recoil: 0, aim: 0 };
  // Planted, drawing the power shot over a full second — the shift skill.
  if (u < 2.8) return { walking: false, draw: (u - 1.6) / 1.2, recoil: 0, aim: 0 };
  // Loosed. The recoil decays over the same window the game gives it.
  if (u < 3.1) return { walking: false, draw: 0, recoil: 1 - (u - 2.8) / 0.3, aim: 0 };
  // A beat, then one quick shot from the same stance.
  if (u < 3.5) return { walking: false, draw: 0, recoil: 0, aim: 0 };
  if (u < 3.8) return { walking: false, draw: (u - 3.5) / 0.3 * 0.45, recoil: 0, aim: 0 };
  if (u < 4.0) return { walking: false, draw: 0, recoil: 1 - (u - 3.8) / 0.2, aim: 0 };
  // Walking on.
  return { walking: true, draw: 0, recoil: 0, aim: 0 };
}

/** What each panel is doing in its window. Absent means "just walk". */
const PREVIEW_ACTS = { archer: _archerPreviewAct };

function _drawCharPreview(cx, cy, panel, t, scale) {
  const act = PREVIEW_ACTS[panel.char] ? PREVIEW_ACTS[panel.char](t) : null;
  // Roughly the cadence the hero walks at in play. At the old 1.5 the preview
  // took four seconds a cycle, which read as a stuck sprite rather than a walk.
  // A hero mid-routine holds his stride still while he is planted.
  const walking = !act || act.walking;
  const { grid, sprite, key } = panel.preview(walking ? animFrame3(t * 10) : 'mid');
  const bob = Math.round(1.5 * Math.sin(t * 2));
  ctx.save(); ctx.translate(cx, cy + bob);
  ctx.drawImage(
    spriteCanvas(`preview|${key}`, grid, sprite.w, sprite.h, scale),
    -(sprite.w * scale) / 2, -(sprite.h * scale) / 2,
  );
  // A live weapon on a baked body. A weapon that has to move leaves the grid
  // for a painter, and without this the hero stands in the shop window empty
  // handed — which is exactly what happened to the archer when the bow came
  // out, and would have happened again to the wizard's staff.
  //
  // The panel carries its own painter rather than this function branching on
  // the character: a hero whose weapon comes out of the grid is a new row in
  // CHAR_PANELS, not another arm on a chain here.
  if (panel.paintWeapon) {
    ctx.save();
    ctx.translate(0, -(sprite.h * scale) / 2 + SPRITE_ORIGIN_ROW * scale);
    ctx.scale(scale, scale);
    // No routine means no aim to follow, and forward is the only safe default:
    // a hero must face the side he is aiming at, and this surface does not
    // mirror the body. See docs/character-rebuild-playbook.md.
    panel.paintWeapon(ctx, { act, t, aim: act ? act.aim : 0 });
    ctx.restore();
  }
  ctx.restore();
}

/** How much bigger the picked hero is drawn than the four beside it. */
const PREVIEW_SCALE_PICKED = 4;
const PREVIEW_SCALE_REST = 3;

/**
 * Shared backdrop for the charselect/mapselect panel screens: the black
 * fill, ambient crows, scanline sweep, corner frame, and the title/subtitle
 * pair. Split out because it was identical, verbatim, in both draw
 * functions — the panel grid each one draws over it is genuinely different
 * (character previews and difficulty vs. a terrain swatch) and stays put.
 */
function _selectionScreenBackdrop(title, subtitle) {
  ctx.fillStyle='#000'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH);
  _screenCrows(4, 0.038, 20);
  _scanSweep('rgba(57,255,20,0.022)', 88);
  _cornerFrame('#0d4d04');

  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='#39FF14'; ctx.shadowBlur=8;
  ctx.fillStyle='#39FF14'; ctx.font='22px "Courier New",monospace';
  ctx.fillText(title, CONFIG.canvasW/2, 65);
  ctx.shadowBlur=0;
  // #1a7a08 measured 3.8:1 against black, under the 4.5:1 floor, on the line
  // that names the mode — which decides what the whole run is. #6f8a6c is
  // 5.5:1 and is the same shade the key hint uses, so the two lines that tell
  // the player where they are now read as a pair.
  ctx.font='12px "Courier New",monospace'; ctx.fillStyle='#6f8a6c';
  ctx.fillText(subtitle, CONFIG.canvasW/2, 100);
}

/**
 * Where everything on the char-select screen lives.
 *
 * One function, read by the draw and by the click handler, so what is painted
 * and what is clickable cannot drift apart. Computing the rects twice is the
 * same bug class as a character with a panel and no portrait, in geometry
 * instead of in data.
 *
 * Every figure derives from the canvas. The row this replaces was sized from a
 * literal 1000 whatever the canvas was, which is 94% of the shipped width and
 * a little over half of a wider one.
 */
function charSelectLayout() {
  const H = CONFIG.canvasH;
  const hintY = H - 34;
  const stripH = Math.round(H * 0.247);
  const stripTop = hintY - 36 - stripH;
  const bandTop = Math.round(H * 0.122) + 26;
  const bandBot = stripTop - 20;
  // Clamped so a tall canvas gives height to the detail rather than growing
  // panels into columns.
  const restH = Math.max(200, Math.min(420, Math.round((bandBot - bandTop) * 0.84)));
  const selected = CHAR_PANELS.findIndex((p) => p.char === selectedChar);
  return {
    selected,
    stripTop,
    hintY,
    slots: panelSlots({
      count: CHAR_PANELS.length,
      canvasW: CONFIG.canvasW,
      sideMargin: 56,
      bandMidY: (bandTop + bandBot) / 2,
      restH,
      pop: DEFAULT_POP,
    }, selected),
  };
}

/**
 * One hero's panel.
 *
 * Every panel carries its four stat rows now, picked or not. Four of the five
 * used to show a name, one hook line and a difficulty word, which meant
 * comparing two heroes was done by cycling between them and remembering — the
 * one job a selection screen exists to do for the player.
 */
function _drawCharPanel(slot, p, sel, t) {
  const { x, y, w, h } = slot;
  const pad = 12, innerW = w - pad * 2, cx = x + w / 2;
  _panelFrame(x, y, w, h, sel, p);

  // Selection reads as a bar above the panel rather than only as the hero's
  // own colour: the archer's #39FF14 is also the screen's accent, so an archer
  // picked in its own green reads as chrome rather than as a choice.
  if (sel) {
    ctx.save();
    ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#39FF14';
    ctx.fillRect(x, y - 7, w, 4);
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = sel ? p.color : '#8f9a8c';
  ctx.font = `${sel ? 17 : 15}px "Courier New",monospace`;
  ctx.fillText(_fitText(`[${p.key}] ${p.char.toUpperCase()}`, innerW), cx, y + 21);
  if (p.newBadge) {
    ctx.font = 'bold 10px "Courier New",monospace';
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 7;
    ctx.fillStyle = '#FFB400'; ctx.fillText('[ NEW ]', cx, y + 38);
    ctx.shadowBlur = 0;
  }

  _drawCharPreview(cx, y + h * 0.38, p, t, sel ? PREVIEW_SCALE_PICKED : PREVIEW_SCALE_REST);

  ctx.font = '10.5px "Courier New",monospace';
  ctx.fillStyle = '#93a08f';
  ctx.fillText(_fitText(p.hook, innerW), cx, y + h * 0.60);

  const pitch = sel ? 19 : 17;
  const barsBottom = y + h - 44;
  p.statBars.forEach((bar, i) => _drawStatBar(
    x + pad, barsBottom - (p.statBars.length - 1 - i) * pitch, innerW, bar,
    sel ? p.color : '#5c6b59',
  ));

  _drawDifficultyMeter(x + pad, y + h - 30, innerW, p.difficulty, sel);
}

/**
 * The picked hero's three abilities, under the row.
 *
 * They used to be inside the picked panel, which is why it had to be 2.33x the
 * width of the others — and why the other four had no room for anything. The
 * band below the panels was empty: 160px on the shipped canvas and 544 on a
 * taller one. Putting the detail there pays for the stats above.
 */
function _drawCharDetail(p, top) {
  const left = 56, right = CONFIG.canvasW - 56;
  ctx.strokeStyle = '#1d2a1d'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, top + 0.5); ctx.lineTo(right, top + 0.5); ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = '10px "Courier New",monospace';
  ctx.fillStyle = PANEL_LABEL_COLOR;
  ctx.fillText('SELECTED', left, top + 26);
  ctx.font = '20px "Courier New",monospace';
  ctx.fillStyle = p.color;
  ctx.fillText(p.char.toUpperCase(), left, top + 50);
  ctx.font = '11px "Courier New",monospace';
  ctx.fillStyle = '#7d8a79';
  ctx.fillText(_fitText(p.hook, 190), left, top + 72);

  const colX = left + 234;
  const colW = Math.floor((right - colX - 52) / SKILL_SLOTS.length);
  SKILL_SLOTS.forEach(([label, slot], i) => {
    const sx = colX + i * (colW + 26);
    ctx.font = '9px "Courier New",monospace';
    ctx.fillStyle = PANEL_LABEL_COLOR;
    ctx.fillText(label, sx, top + 26);
    ctx.font = '11.5px "Courier New",monospace';
    ctx.fillStyle = '#C8D0C4';
    ctx.fillText(_fitText(p.skills[slot], colW), sx, top + 48);
  });
}

/**
 * How each talent and capstone shows on the chooser screens: an accent in
 * the char-select scheme, a sigil that depicts the effect, and the panel's
 * hook line. Presentation only — the tree itself lives in sim/talents.ts —
 * and checked loudly at load the way CHAR_PANELS checks CHARACTER_STATS: an
 * id without a look would draw a blank panel, which is the sapper's old
 * missing-portrait gap wearing new clothes.
 */
/**
 * What a talent DOES to a run, and how that reads at a glance.
 *
 * Three kinds, one colour each. Inside a chooser every offer comes from the
 * same hero, so colouring by hero spent the slot on something the player
 * already knew — three sapper offers in three identical oranges. Colouring by
 * kind spends it on the one thing the row is actually asking: what sort of
 * talent is this.
 *
 * A fourth kind — defensive, healing, damage taken — is deliberately absent
 * rather than empty. Not one of the twenty-five does any of those things; the
 * FEATHERS tree carries health and the ward. The day a tree grows one, it
 * gets a row here, and until then an unused colour would only be a promise
 * the screen does not keep.
 *
 * `label` is on the panel beside the tier, because a colour code nobody can
 * decode is decoration. The word teaches the colour; after a few runs the
 * colour is doing the work alone.
 */
const TALENT_KINDS = {
  /** Puts more damage on the target: reach, pierce, extra blasts, per-hit worth. */
  direct:   { label: 'DAMAGE',   color: '#FF7A1A', dim: '#7a3300', bg: 'rgba(255,122,26,0.10)' },
  /** Pays for damage rather than dealing it: resources, uptime, meters, stacks. */
  indirect: { label: 'BUILD-UP', color: '#FFCC00', dim: '#7a5a00', bg: 'rgba(255,204,0,0.10)' },
  /** Changes where bodies are: movement, placement, phasing, knockback. */
  mechanic: { label: 'MOVEMENT', color: '#8888FF', dim: '#1a1a6a', bg: 'rgba(100,80,255,0.10)' },
};

/**
 * Each talent's kind, its sigil, and the one line the panel leads with.
 *
 * Presentation only — the tree itself lives in sim/talents.ts — and checked
 * loudly at load the way CHAR_PANELS checks CHARACTER_STATS: an id without a
 * look would draw a blank panel, which is the sapper's old missing-portrait
 * gap wearing new clothes.
 */
const TALENT_LOOK = {
  // Wizard.
  focusDepth:    { kind: 'indirect', hook: 'A full pool casts four bolts' },
  blinkReach:    { kind: 'mechanic', hook: 'The wall you could not reach is now cover' },
  heldStep:      { kind: 'mechanic', hook: 'The window stays open a breath longer' },
  longThrow:     { kind: 'mechanic', hook: 'The stick lands where he was aiming' },
  fullDraw:      { kind: 'indirect', hook: 'The bow is ready before he is' },
  towerGuard:    { kind: 'indirect', hook: 'The guard comes back up sooner' },
  longReach:     { kind: 'direct',   hook: 'A step further than they think' },
  wideNet:       { kind: 'mechanic', hook: 'Fewer edges to slip out of' },
  fourthBolt:    { kind: 'direct',   hook: 'One more in every fan' },
  widerFan:      { kind: 'direct',   hook: 'The arc keeps growing' },
  shortFuse:     { kind: 'mechanic', hook: 'He is already reaching for the next' },
  thirdStep:     { kind: 'mechanic', hook: 'Twice was the cap. It is three' },
  thunderstep:   { kind: 'direct',   hook: 'Arriving is the attack, and it grows' },
  stormWidth:    { kind: 'direct',   hook: 'The storm stops asking where they are' },
  overchannel:   { kind: 'indirect', hook: 'The escape button becomes the attack button' },
  stormcaller:   { kind: 'indirect', hook: 'The sky becomes a habit' },

  // Archer.
  setFeet:       { kind: 'indirect', hook: 'Set faster, hit sooner' },
  deepRoots:     { kind: 'indirect', hook: 'What you built takes longer to lose' },
  splitShaft:    { kind: 'direct',   hook: 'One shaft, a line of them' },
  rooted:        { kind: 'indirect', hook: 'Braced, and free to walk' },
  splinter:      { kind: 'direct',   hook: 'One stick, three craters' },
  deadEye:       { kind: 'mechanic', hook: 'Stand still enough and it is free' },

  // Knight.
  deeperCut:     { kind: 'direct',   hook: 'Every stack bites harder' },
  fourthBlood:   { kind: 'direct',   hook: 'A fourth drop to earn' },
  chargeThrough: { kind: 'direct',   hook: 'He cuts on every side while charging' },
  berserker:     { kind: 'indirect', hook: 'A miss is no longer the end of it' },
  juggernaut:    { kind: 'mechanic', hook: 'Nothing stops the charge' },
  bulwark:       { kind: 'mechanic', hook: 'Blood buys the guard back' },

  // Ranger.
  lightFoot:     { kind: 'indirect', hook: 'Less ground to reach full tilt' },
  longWind:      { kind: 'indirect', hook: 'A pause no longer costs everything' },
  fullTilt:      { kind: 'indirect', hook: 'The ceiling climbs with you' },
  slipstream:    { kind: 'mechanic', hook: 'At full speed, nothing is in the way' },
  shrapnel:      { kind: 'direct',   hook: 'The satchel answers outward' },
  holdfast:      { kind: 'direct',   hook: 'Caught is worth twice' },

  // Sapper.
  longFuse:      { kind: 'indirect', hook: 'A bomb reaches further for the next' },
  moreLinks:     { kind: 'direct',   hook: 'The chain runs longer before it dies' },
  stickyFan:     { kind: 'mechanic', hook: 'The fan stays where it lands' },
  demolitionist: { kind: 'direct',   hook: 'Each blast louder than the last' },
  shockwave:     { kind: 'mechanic', hook: 'What survives is thrown clear' },
  minefield:     { kind: 'mechanic', hook: 'A miss becomes ground they cannot cross' },
};
for (const [lookChar, lookTree] of Object.entries(CHAR_TREES)) {
  for (const entry of [...lookTree.talents, ...lookTree.capstones]) {
    const row = TALENT_LOOK[entry.id];
    if (!row) throw new Error(`TALENT_LOOK has no row for '${lookChar}.${entry.id}'`);
    // A kind that is not in the table would paint `undefined` on every field
    // the panel reads, which draws an invisible offer rather than failing.
    if (!TALENT_KINDS[row.kind]) {
      throw new Error(`TALENT_LOOK['${entry.id}'] has no such kind: '${row.kind}'`);
    }
    // And a drawing. A talent with no sigil paints an empty panel, which is
    // the same silent gap a missing look row would have been.
    if (!SIGILS[entry.id]) throw new Error(`no sigil drawn for '${lookChar}.${entry.id}'`);
  }
}

/** The numerals the tier footer wears. The colour left with them: tier is a
 *  word, and the panel's colour now says what the talent does instead. */
const TIER_ROMAN  = { 1: 'I', 2: 'II', 3: 'III' };

/** The spec behind a chooser offer — a talent row or a capstone row. */
function chooserSpec(id) {
  const tree = CHAR_TREES[selectedChar];
  const spec = tree.talents.find((t) => t.id === id) || tree.capstones.find((c) => c.id === id);
  if (!spec) throw new Error(`chooser offer '${id}' is not in ${selectedChar}'s tree`);
  return spec;
}

/**
 * The climbable talent behind an offer id, or null for a capstone.
 *
 * `chooserSpec` answers with either kind, which is right for a label and a
 * description because both carry those. A ladder and a tier only one kind
 * carries, and asking `isRite` for them reads the ceremony instead of the
 * offer — a capstone dealt by the draft would reach `.costs.length` on an
 * object with no costs. This asks the tree, which is the thing that knows.
 */
function chooserLadder(id) {
  return CHAR_TREES[selectedChar].talents.find((t) => t.id === id) ?? null;
}

/** One LEVEL ■■□ row sized to the talent's own ladder, not STAT_SCALE. */
function _drawOwnedPips(lx, ly, maxW, filled, total, color) {
  ctx.textAlign = 'left';
  ctx.font = '9.5px "Courier New",monospace';
  ctx.fillStyle = PANEL_LABEL_COLOR;
  ctx.fillText('LEVEL', lx, ly);
  const pipW = 7, pipGap = 3, pipH = 7;
  const rowW = total * pipW + (total - 1) * pipGap;
  const x0 = lx + maxW - rowW, top = ly - pipH / 2;
  for (let i = 0; i < total; i++) {
    const px = x0 + i * (pipW + pipGap);
    if (i < filled) { ctx.fillStyle = color; ctx.fillRect(px, top, pipW, pipH); }
    else { ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, top + 0.5, pipW - 1, pipH - 1); }
  }
}

/** The selected panel's detail block: pips for a talent, then EFFECT rows. */
/** One label/value pair inside a panel, returning the y the next row starts at. */
function _drawChooserRow(lx, y, maxW, label, text, color) {
  ctx.textAlign = 'left';
  ctx.font = '9px "Courier New",monospace';
  ctx.fillStyle = PANEL_LABEL_COLOR;
  ctx.fillText(label, lx, y);
  ctx.font = '11px "Courier New",monospace';
  ctx.fillStyle = color;
  ctx.fillText(_fitText(text, maxW), lx, y + 16);
  return y + 34;
}

/**
 * One offer's panel, painted into the slot the row geometry gave it.
 *
 * The picked panel carries its own detail rather than handing it to a strip
 * below. Char select moved detail out because five panels on a 1056 px canvas
 * left the picked one no room; three offers on this canvas are ~600 px wide,
 * which is room enough, and the alternative is a tall panel holding a sigil
 * and one line.
 */
function _drawChooserPanel(slot, id, index, sel, isRite) {
  const { x, y, w, h } = slot;
  const look = TALENT_LOOK[id], kind = TALENT_KINDS[look.kind], spec = chooserSpec(id);
  const pad = 14, innerW = w - pad * 2, cx = x + w / 2;
  _panelFrame(x, y, w, h, sel, { bg: kind.bg, dimBg: DIM_PANEL_BG, color: kind.color, dim: kind.dim });

  // The green bar over the picked panel, for the reason _drawCharPanel gives:
  // an offer whose own accent is the screen's accent would read as chrome.
  if (sel) {
    ctx.save();
    ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#39FF14';
    ctx.fillRect(x, y - 7, w, 4);
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = sel ? kind.color : '#8f9a8c';
  ctx.font = `${sel ? 18 : 15}px "Courier New",monospace`;
  ctx.fillText(_fitText(`[${index + 1}] ${spec.label}`, innerW), cx, y + 26);

  // The sigil stands where a hero's portrait stands on the select screen.
  // Drawn rather than printed: a glyph is only as good as whatever font the
  // player happens to have, and U+2608 shipped here as an empty box once.
  //
  // Every figure below is a fraction of the panel, not a pixel count, so the
  // box can be resized without the contents needing re-placing by hand. The
  // type sizes are deliberately NOT fractions: shrinking the box must not
  // shrink the reading, and the sigil holds its stroke weight for the same
  // reason.
  paintTalentSigil(ctx, id, {
    // Centred on the fraction, with no baseline fudge: the painter centres on
    // the point it is given, where fillText hung a glyph off a baseline.
    // Larger than the glyphs were, too — a 46 px letter fills its em box and a
    // stroked drawing on a 24 grid does not, so matching the old number gave
    // a sigil that read as an afterthought in the middle of the panel.
    x: cx, y: y + h * (sel ? 0.32 : 0.44),
    size: sel ? 74 : 58,
    color: sel ? kind.color : kind.dim,
    glow: sel ? 12 : 0,
  });

  ctx.font = '10.5px "Courier New",monospace';
  ctx.fillStyle = '#93a08f';
  ctx.fillText(_fitText(look.hook, innerW), cx, y + h * (sel ? 0.50 : 0.72));

  if (sel) {
    let ry = y + h * 0.61;
    ry = _drawChooserRow(x + pad, ry, innerW, 'EFFECT', spec.desc, '#C8D0C4');
    _drawChooserRow(x + pad, ry, innerW,
      isRite ? 'LASTS' : 'DRAFT',
      isRite ? 'This run only, once the rite is sealed'
             : 'Live this run only; the next wakes at each boss',
      '#C8D0C4');
  }

  // A capstone has no ladder, so only the draft shows a level. Asked of the
  // spec rather than of `isRite`: the flag says which ceremony is open and the
  // shape says whether this offer has a ladder at all, and reading the flag
  // for both is how a capstone dealt by the draft would reach `.costs.length`
  // on an object that has no costs.
  const ladder = chooserLadder(id);
  if (ladder !== null) {
    _drawOwnedPips(x + pad, y + h - 42, innerW,
      talentLevel(TALENTS.state(), id), ladder.costs.length, sel ? kind.color : '#5c6b59');
  }

  // Grey, both of them: the panel's colour is spent on what the talent does,
  // so tier says its piece in words rather than competing for the same hues.
  ctx.textAlign = 'center';
  ctx.font = '11px "Courier New",monospace';
  ctx.fillStyle = sel ? PANEL_LABEL_COLOR : '#5c6b59';
  ctx.fillText(ladder !== null ? `${kind.label} · TIER ${TIER_ROMAN[ladder.tier]}`
                               : `${kind.label} · SEALS THE RUN`, cx, y + h - 22);
}

/**
 * Where the chooser's panels are. `charSelectLayout`'s twin, over the offers
 * instead of the roster, and canvas-derived for the same reason: a row sized
 * from a literal fills half a wide canvas — see `render/panel-row.ts`.
 */
function chooserLayout() {
  const H = CONFIG.canvasH;
  const hintY = H - 34;
  const bandTop = Math.round(H * 0.122) + 26;
  const bandBot = hintY - 40;
  // PANEL_SCALE off both dimensions, against the size this screen first
  // shipped at. An offer carries a sigil, a hook and two label rows — a third
  // of what a hero panel carries — so at char select's size the box read as
  // mostly empty. Height comes off the band factor and the clamp; width comes
  // off `sideMargin` below, which is the only lever `panelSlots` offers.
  const restH = Math.max(150, Math.min(322, Math.round((bandBot - bandTop) * 0.60)));
  return {
    selected: chooser.cursor,
    hintY,
    slots: panelSlots({
      count: chooser.offers.length,
      canvasW: CONFIG.canvasW,
      // Doubles as the width dial. `panelSlots` derives slot width from what
      // the margins leave, so narrowing the panels means widening these: the
      // row keeps 0.75 of the width it had at 0.09, which is the same quarter
      // taken off the height above.
      //
      // It also has to clear the canvas edge. Char select's 56 works because
      // five panels make each overhang small; a chooser deals two or three,
      // and `panelSlots` takes the greater of margin and overhang rather than
      // their sum — at 0.06 that put the picked panel 2 px from the edge.
      sideMargin: Math.round(CONFIG.canvasW * 0.1925),
      bandMidY: (bandTop + bandBot) / 2,
      restH,
      pop: DEFAULT_POP,
    }, chooser.cursor),
  };
}

/**
 * The draft and the rite, in the char-select screen's own anatomy — the
 * owner's pick of the five mocked styles. Same geometry module and the same
 * panel frame, so a change to how selection reads lands on both screens
 * rather than on one.
 */
function drawChooser() {
  const isRite = chooser.kind === 'rite';
  const rank = rankOf(TALENTS.state().mastery);
  _selectionScreenBackdrop(
    isRite ? '── THE RITE ──' : '── THE DRAFT ──',
    isRite ? `THE BOSS IS DOWN · MASTERY RANK ${TIER_ROMAN[rank] || rank} · ONE CAPSTONE, THIS RUN ONLY`
           : `${selectedChar.toUpperCase()} · OWNED TALENTS WAKE BY BEING PICKED`);

  const { slots, selected, hintY } = chooserLayout();
  chooser.offers.forEach((id, i) => _drawChooserPanel(slots[i], id, i, i === selected, isRite));

  ctx.textAlign = 'center';
  ctx.fillStyle = '#6f8a6c'; ctx.font = '12px "Courier New",monospace';
  const digits = chooser.offers.map((_, i) => `[${i + 1}]`).join(' ');
  ctx.fillText(`CLICK OR ← →  /  ${digits}  SWITCH    ENTER  ${isRite ? 'SEAL THE RITE' : 'WAKE IT'}`,
    CONFIG.canvasW / 2, hintY);
}

/** Click an offer to move to it; click the picked one to take it. The same
 *  two-gesture rule char select uses, over the same `panelAt`. */
function _clickChooser(e) {
  const at = _canvasPoint(e);
  if (at === null || chooser === null) return;
  const { slots, selected } = chooserLayout();
  const hit = panelAt(slots, selected, at.x, at.y);
  if (hit === null) return;
  if (hit === selected) { confirmChooser(); return; }
  chooser.cursor = hit;
}

/**
 * Where the talent shop's rows and its rite footer sit.
 *
 * One function, read by the draw and by the click handler, for the reason
 * `charSelectLayout` gives: a rect computed twice is a rect that drifts.
 */
function talentTreeLayout() {
  const H = CONFIG.canvasH;
  const hintY = H - 34;
  // The rite footer is a fixed block, so the rows take what is left above it
  // rather than the footer taking what the rows leave.
  const riteY = hintY - 86;
  return {
    hintY, riteY,
    cursor: TALENTS.cursor(),
    rows: _shopRows(CHAR_TREES[selectedChar].talents.length, {
      top: Math.round(H * 0.185),
      bottom: riteY - 26,
      // Taller than an upgrade row: a talent carries a sigil, a kind, a tier
      // and a description where an upgrade carries a label and a line.
      maxPitch: 116, maxBandH: 104,
    }),
  };
}

/** What the shop should say about the last thing the player tried to buy. */
function _talentBuyNote(result) {
  if (result === null) return null;
  switch (result.kind) {
    case 'bought':     return { text: `TAKEN · ${result.spent} MASTERY SPENT`, color: '#39FF14' };
    case 'maxed':      return { text: 'ALREADY AT ITS LAST LEVEL', color: '#FFB400' };
    case 'tooPoor':    return {
      text: `${result.short} MORE MASTERY · ${result.cost} NEEDED`, color: '#C86A2A',
    };
    case 'tierLocked': return {
      text: `TIER LOCKED · MASTERY RANK ${TIER_ROMAN[result.rankNeeded] || result.rankNeeded}`
          + ` NEEDED, RANK ${TIER_ROMAN[result.rankHeld] || result.rankHeld || '—'} HELD`,
      color: '#C86A2A',
    };
  }
  // Every kind the model returns is named above. A new one arriving silently
  // would be a screen that says nothing when a purchase fails.
  throw new Error(`no shop note for purchase kind '${result.kind}'`);
}

/** How far along the mastery ladder this character is, in words. */
function _masteryLine(points) {
  const rank = rankOf(points);
  if (rank >= RANK_THRESHOLDS.length) {
    return `RANK ${TIER_ROMAN[rank] || rank} · EVERY TIER OPEN`;
  }
  const next = RANK_THRESHOLDS[rank];
  return `RANK ${rank === 0 ? '—' : TIER_ROMAN[rank]}`
       + ` · ${points}/${next} EARNED TOWARD RANK ${TIER_ROMAN[rank + 1]}`;
}

/**
 * One talent's row: sigil, name, what kind of thing it is, and its price.
 *
 * Coloured by kind, the same three colours the draft uses, so a player meets
 * a talent's colour here and recognises it when the chooser deals it.
 */
function _drawTalentRow(row, spec, sel, mastery, purse) {
  const look = TALENT_LOOK[spec.id], kind = TALENT_KINDS[look.kind];
  const tierOpen = tierOpenAt(mastery, spec.tier);
  const open = tierOpen;
  const level = talentLevel(TALENTS.state(), spec.id);
  const maxed = level >= spec.costs.length;
  const cost = maxed ? 0 : spec.costs[level];
  // A locked row is dimmed rather than hidden: what you are climbing toward
  // is the reason to climb. Dimmed, not unreadable — #5c6659 measured 3.3:1
  // against black, under the 4.5 floor the screens playbook set, and a talent
  // you cannot read yet is not a goal.
  const tint = !open ? '#5c6b59' : sel ? kind.color : kind.dim;
  const lockedInk = '#7a8877';

  ctx.fillStyle = sel ? kind.bg : 'rgba(0,0,0,0)';
  ctx.fillRect(row.x, row.y, row.w, row.h);
  ctx.strokeStyle = tint; ctx.lineWidth = sel ? 1.5 : 1;
  if (sel) { ctx.shadowColor = kind.color; ctx.shadowBlur = 12; }
  ctx.strokeRect(row.x, row.y, row.w, row.h);
  ctx.shadowBlur = 0;

  const sigilBox = row.h;
  paintTalentSigil(ctx, spec.id, {
    x: row.x + sigilBox / 2, y: row.midY,
    // Two thirds of the row. The chooser's picked panel draws its sigil at
    // 74 px and this lands near it, so a talent looks the same size where you
    // buy it as where you wake it.
    size: Math.round(row.h * 0.64),
    color: tint,
    glow: sel ? 10 : 0,
  });

  const textX = row.x + sigilBox;
  const rightX = row.x + row.w - 20;
  const textW = rightX - textX - 150;

  ctx.textAlign = 'left';
  ctx.fillStyle = open ? (sel ? kind.color : '#8f9a8c') : lockedInk;
  ctx.font = `${sel ? 19 : 17}px "Courier New",monospace`;
  ctx.fillText(_fitText(spec.label, textW), textX, row.midY - 18);

  ctx.font = '10px "Courier New",monospace';
  ctx.fillStyle = PANEL_LABEL_COLOR;
  ctx.fillText(`${kind.label} · TIER ${TIER_ROMAN[spec.tier]}`, textX, row.midY + 2);

  ctx.font = '11.5px "Courier New",monospace';
  ctx.fillStyle = open ? '#93a08f' : lockedInk;
  ctx.fillText(_fitText(spec.desc, textW), textX, row.midY + 22);

  // Price and ladder, right-aligned, on the same two lines as the name and
  // the description so the eye reads across rather than hunting.
  ctx.textAlign = 'right';
  ctx.font = '13px "Courier New",monospace';
  if (!tierOpen) {
    ctx.fillStyle = '#C86A2A';
    ctx.fillText(`LOCKED · RANK ${TIER_ROMAN[spec.tier - 1] || spec.tier - 1}`, rightX, row.midY - 18);
  } else if (maxed) {
    ctx.fillStyle = '#FFB400';
    ctx.fillText('◆ MAXED', rightX, row.midY - 18);
  } else {
    ctx.fillStyle = purse >= cost ? '#8ED1FF' : '#31506b';
    ctx.fillText(`${cost} MASTERY`, rightX, row.midY - 18);
  }
  _drawOwnedPips(rightX - 130, row.midY + 20, 130, level, spec.costs.length,
    open ? (sel ? kind.color : '#5c6b59') : lockedInk);
}

/**
 * The talent shop: the one screen that spends feathers on a tree.
 *
 * `TALENTS.buy()` has enforced the mastery gate and the wallet since the model
 * landed, and until this screen there was no way to reach it but the console.
 */
function drawTalentTree() {
  const tree = CHAR_TREES[selectedChar];
  const mastery = TALENTS.state().mastery;
  const purse = TALENTS.purse();
  // Feathers are deliberately absent from this screen. They buy upgrades, and
  // naming them here would invite the player to look for a price in the wrong
  // currency.
  _selectionScreenBackdrop(
    inCeremony() ? '── SPEND WHAT THE FIGHT PAID ──' : `── ${selectedChar.toUpperCase()} TALENTS ──`,
    `${purse} MASTERY TO SPEND  ·  ${_masteryLine(mastery)}`);

  const { rows, cursor, hintY, riteY } = talentTreeLayout();
  tree.talents.forEach((spec, i) => _drawTalentRow(rows[i], spec, i === cursor, mastery, purse));

  // Under the last row rather than above the rite: a message about a purchase
  // belongs beside the thing that was bought, and the rows are centred in
  // their band, so the foot of the block moves with the tree's length.
  const note = _talentBuyNote(TALENTS.lastBuy());
  if (note !== null && rows.length > 0) {
    const foot = rows[rows.length - 1];
    ctx.textAlign = 'center'; ctx.font = '13px "Courier New",monospace';
    ctx.fillStyle = note.color;
    ctx.fillText(note.text, CONFIG.canvasW / 2, foot.y + foot.h + 32);
  }

  // The rite, which is earned and not bought — shown so the ladder has a
  // visible top, and greyed until the rank that opens it.
  const earned = riteEligible(mastery);
  ctx.textAlign = 'center';
  ctx.font = '11px "Courier New",monospace';
  ctx.fillStyle = PANEL_LABEL_COLOR;
  ctx.fillText(`THE RITE · MASTERY RANK ${TIER_ROMAN[CAPSTONE_RANK]} · EARNED, NEVER BOUGHT`,
    CONFIG.canvasW / 2, riteY);
  ctx.font = '15px "Courier New",monospace';
  ctx.fillStyle = earned ? '#FFB400' : '#7a8877';
  ctx.fillText(tree.capstones.map((c) => c.label).join('   ·   ') || 'NONE YET',
    CONFIG.canvasW / 2, riteY + 24);

  // The hint has to match what the keys actually do. Inside a ceremony the
  // crossing to the upgrades is refused and [B] hands the run back, so
  // advertising UPGRADES and BACK there would be the screen lying about
  // itself.
  ctx.font = '12px "Courier New",monospace'; ctx.fillStyle = '#6f8a6c';
  ctx.fillText(inCeremony()
    ? 'CLICK OR ↑ ↓  NAVIGATE    ENTER  TAKE IT    [B]  DONE'
    : 'CLICK OR ↑ ↓  NAVIGATE    ENTER  BUY    [U]  UPGRADES    [B]  BACK',
    CONFIG.canvasW / 2, hintY);
}

/** Click a row to move to it; click the one you are on to buy it. The same
 *  two-gesture rule char select and the chooser use, over the same rects. */
function _clickTalentTree(e) {
  const at = _canvasPoint(e);
  if (at === null) return;
  const { rows, cursor } = talentTreeLayout();
  const hit = rowAt(rows, at.x, at.y);
  if (hit === null) return;
  if (hit === cursor) { TALENTS.buyCurrent(); return; }
  TALENTS.setCursor(hit);
}

function drawCharSelect(t) {
  _selectionScreenBackdrop('── CHOOSE YOUR CHAMPION ──', `MODE: ${modeRule(gameMode).label}`);
  const { slots, selected, stripTop, hintY } = charSelectLayout();

  CHAR_PANELS.forEach((p, i) => _drawCharPanel(slots[i], p, i === selected, t));
  _drawCharDetail(CHAR_PANELS[selected] ?? CHAR_PANELS[0], stripTop);

  // Lifted out of #0d4d04, which is 2.1:1 against black and was the only place
  // ENTER was ever named. ESC has always worked here and drawMapSelect already
  // says so, which made this screen the inconsistent one.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6f8a6c'; ctx.font = '12px "Courier New",monospace';
  ctx.fillText('CLICK OR ← →  SWITCH    ENTER  CONFIRM    ESC  BACK',
    CONFIG.canvasW / 2, hintY);
}

/** Waves-only screen between charselect and the run. Same layout family as
 * drawCharSelect above, over MAP_PANELS instead of CHAR_PANELS. */
function drawMapSelect(t) {
  _selectionScreenBackdrop('── CHOOSE YOUR GROUND ──', `${selectedChar.toUpperCase()}  ·  WAVES`);

  const gapX = 24, panelH = 280;
  const panelW = Math.floor((640 - gapX * (MAP_PANELS.length - 1)) / MAP_PANELS.length);
  const totalW = panelW*MAP_PANELS.length + gapX*(MAP_PANELS.length-1);
  const startX = CONFIG.canvasW/2 - totalW/2;
  const panelY = 160;

  // A 2px inset either side rather than charselect's 12: these panels are only
  // as wide as their longest line already, so a full pad would truncate copy
  // that fits the panel perfectly well. The inset is there to keep a glyph off
  // the border, not to reserve a margin.
  const innerW = panelW - 4;

  MAP_PANELS.forEach((p, idx) => {
    const px = startX + idx * (panelW + gapX);
    const sel = selectedMapKind === p.kind;
    _panelFrame(px, panelY, panelW, panelH, sel, p);
    ctx.fillStyle = sel ? p.color : p.dim;
    ctx.font='19px "Courier New",monospace';
    ctx.fillText(_fitText(`[${p.key}] ${p.kind.toUpperCase()}`, innerW), px+panelW/2, panelY+34);
    // Terrain swatch — flat color, not art, just enough to read as "ground"
    ctx.globalAlpha = sel ? 0.85 : 0.3;
    ctx.fillStyle = p.color;
    ctx.fillRect(px+24, panelY+60, panelW-48, 96);
    ctx.globalAlpha = 1;
    ctx.font='11px "Courier New",monospace';
    ctx.fillStyle = sel ? p.color : p.dim;
    p.lines.forEach((line, i) => ctx.fillText(_fitText(line, innerW), px+panelW/2, panelY+192+i*22));
  });

  ctx.fillStyle='#0d4d04'; ctx.font='14px "Courier New",monospace';
  const keyHint = MAP_PANELS.map(p => `[${p.key}]`).join(' ');
  ctx.fillText(`← →  /  ${keyHint}  SWITCH    ENTER  CONFIRM    ESC  BACK`, CONFIG.canvasW/2, CONFIG.canvasH-22);
}

function drawMenu(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH);
  _screenCrows(6, 0.050, 28);
  _scanSweep('rgba(57,255,20,0.035)', 110);
  _cornerFrame('#0d4d04');

  // Title — breathing phosphor glow
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 10 + 5*Math.sin(loopT * 1.4);
  ctx.fillStyle = '#39FF14'; ctx.font = '17px "Courier New", monospace';
  ['  ██████╣██████╗  ██████╗ ██╗    ██╗',
   ' ██╔════╝██╔══██╗██╔═══██╗██║    ██║',
   ' ██║     ██████╔╝██║   ██║██║ █╗ ██║',
   ' ██║     ██╔══██╗██║   ██║██║███╗██║',
   ' ╚██████╣██║  ██║╚██████╔╝╚███╔███╔╝',
   '  ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝',
   '', '         A  R  C  H  E  R'].forEach((line, i) => ctx.fillText(line, CONFIG.canvasW/2, 80+i*21));
  ctx.shadowBlur = 0;

  // Both lists come from MENU_ENTRIES, so an added row lands on screen and in
  // the key handler at once. Index i is menuSelection, which is why the util
  // loop offsets by the number of modes rather than by a written-in constant.
  const modes = MENU_SHOWN.filter((e) => e.section === 'mode');
  const utils = MENU_SHOWN.filter((e) => e.section === 'util');

  const MODE_TOP = 303, MODE_STEP = 60;
  modes.forEach(({ key, label, sub }, i) => {
    const oy = MODE_TOP + i * MODE_STEP, sel = menuSelection === i;
    if (sel) {
      ctx.fillStyle = 'rgba(57,255,20,0.07)';
      ctx.fillRect(CONFIG.canvasW/2 - 210, oy - 16, 420, 38);
      ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 18;
    }
    ctx.fillStyle = sel ? '#39FF14' : '#1a7a08';
    ctx.font = '20px "Courier New", monospace';
    ctx.fillText(`[${key}]  ${label}${sel && Math.floor(t*2)%2===0 ? '_' : ' '}`, CONFIG.canvasW/2, oy);
    ctx.shadowBlur = 0;
    // Description sub-text
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = sel ? '#1a7a08' : '#0a3a06';
    ctx.fillText(sub, CONFIG.canvasW/2, oy + 16);
  });

  // Separator sits below the last mode's sub-text, so the rule keeps its
  // spacing whatever the list length.
  const sepY = MODE_TOP + (modes.length - 1) * MODE_STEP + 69;
  ctx.strokeStyle = '#0d3a04'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(CONFIG.canvasW/2 - 140, sepY); ctx.lineTo(CONFIG.canvasW/2 + 140, sepY); ctx.stroke();

  utils.forEach(({ key, label }, i) => {
    const oy = sepY + 18 + i * 34, sel = menuSelection === modes.length + i;
    ctx.font = '16px "Courier New", monospace';
    ctx.fillStyle = sel ? '#39FF14' : '#1a7a08';
    if (sel) { ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 10; }
    ctx.fillText(`[${key}]  ${label}${sel && Math.floor(t*2)%2===0 ? '_' : ' '}`, CONFIG.canvasW/2, oy);
    ctx.shadowBlur = 0;
  });

  ctx.fillStyle = '#0d4d04'; ctx.font = '12px "Courier New", monospace';
  ctx.fillText('↑ ↓  NAVIGATE    ENTER / KEY  CONFIRM', CONFIG.canvasW/2, CONFIG.canvasH - 20);
}

const CTRL_ACTIONS = [
  { label: 'MOVE UP',    key: 'up'    },
  { label: 'MOVE DOWN',  key: 'down'  },
  { label: 'MOVE LEFT',  key: 'left'  },
  { label: 'MOVE RIGHT', key: 'right' },
  { label: 'SHOOT',      key: 'shoot' },
  { label: 'SNIPE/CHARGE', key: 'snipe' },
  { label: 'LIGHT TORCH', key: 'use'   },
  { label: 'GET UNSTUCK', key: 'unstick' },
  { label: 'PAUSE',      key: 'pause' }
];

function drawControls(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH);
  _screenCrows(4, 0.038, 22);
  _scanSweep('rgba(57,255,20,0.030)', 95);
  _cornerFrame('#0d4d04');

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#39FF14'; ctx.font = '24px "Courier New", monospace';
  ctx.fillText('── CONTROLS ──', CONFIG.canvasW/2, 60);
  ctx.shadowBlur = 0;
  ctx.font = '13px "Courier New", monospace'; ctx.fillStyle = '#1a7a08';
  ctx.fillText('CLICK ROW TO REMAP  ·  THEN PRESS NEW KEY', CONFIG.canvasW/2, 100);
  ctx.font = '17px "Courier New", monospace';

  CTRL_ACTIONS.forEach((action, i) => {
    const ry = 160+i*46, isRemap = remapTarget === action.key, isSel = controlsSelection === i;
    if (isRemap) {
      ctx.fillStyle = 'rgba(255,255,50,0.09)'; ctx.fillRect(CONFIG.canvasW/2-210, ry-18, 420, 36);
      ctx.shadowColor = '#ffff33'; ctx.shadowBlur = 14;
      ctx.fillStyle = Math.floor(t*4)%2===0 ? '#ffff33' : '#888800';
      ctx.fillText(`▶ ${action.label.padEnd(12)}  [ PRESS KEY ]`, CONFIG.canvasW/2, ry);
    } else {
      if (isSel) {
        ctx.fillStyle = 'rgba(57,255,20,0.06)'; ctx.fillRect(CONFIG.canvasW/2-210, ry-18, 420, 36);
        ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 8;
      }
      ctx.fillStyle = isSel ? '#39FF14' : '#1a7a08';
      const kn = CONFIG.keys[action.key] === ' ' ? 'SPACE' : CONFIG.keys[action.key];
      ctx.fillText(`  ${action.label.padEnd(12)}  [ ${kn} ]`, CONFIG.canvasW/2, ry);
    }
    ctx.shadowBlur = 0;
  });

  ctx.fillStyle = '#0d4d04'; ctx.font = '15px "Courier New", monospace';
  ctx.fillText('[B]  BACK', CONFIG.canvasW/2, CONFIG.canvasH-36);
}

function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.70)'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH);
  _scanSweep('rgba(57,255,20,0.025)', 85);
  // Central glow halo behind text
  const hx = CONFIG.canvasW/2, hy = CONFIG.canvasH/2 - 36;
  const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 180);
  hg.addColorStop(0, 'rgba(57,255,20,0.06)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 14 + 4*Math.sin(loopT*2.1);
  ctx.fillStyle = '#39FF14'; ctx.font = '34px "Courier New", monospace';
  ctx.fillText('── PAUSED ──', CONFIG.canvasW/2, CONFIG.canvasH/2-36);
  ctx.shadowBlur = 0;
  ctx.font = '16px "Courier New", monospace'; ctx.fillStyle = '#1a7a08';
  ctx.fillText('[ESC] RESUME     [C] CONTROLS     [M] MENU', CONFIG.canvasW/2, CONFIG.canvasH/2+16);
  ctx.fillStyle = '#FFB400'; ctx.font = '14px "Courier New", monospace';
  ctx.fillText(`[I] UPGRADES  [T] TALENTS  [◆${FEATHERS.wallet()} FTH]`, CONFIG.canvasW/2, CONFIG.canvasH/2+44);
}

function drawGameOver(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH);
  // Drifting crows — darker, more ominous
  _screenCrows(5, 0.040, 25);
  _scanSweep('rgba(180,0,0,0.045)', 88);
  _cornerFrame('#4d0404');

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Pulsing red title glow
  ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 20 + 7*Math.sin(t * 2.3);
  ctx.fillStyle = '#ff2222'; ctx.font = '36px "Courier New", monospace';
  ctx.fillText('>>> GAME OVER <<<', CONFIG.canvasW/2, 170);
  ctx.shadowBlur = 0;

  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 5;
  ctx.fillStyle = '#39FF14'; ctx.font = '22px "Courier New", monospace';
  ctx.fillText(`FINAL SCORE:   ${String(score).padStart(3,'0')}`, CONFIG.canvasW/2, 254);
  if (modeRule(gameMode).summaryStat === 'kills') ctx.fillText(`KILLS:         ${killCount}`, CONFIG.canvasW/2, 296);
  else                      ctx.fillText(`WAVE REACHED:  ${wave}`,     CONFIG.canvasW/2, 296);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#0a3a06'; ctx.font = '13px "Courier New", monospace';
  ctx.fillText(`[ ${modeRule(gameMode).label} MODE ]`, CONFIG.canvasW/2, 336);

  ctx.fillStyle = '#1a7a08'; ctx.font = '18px "Courier New", monospace';
  ctx.fillText(`[R] RESTART${Math.floor(t*2)%2===0 ? '_' : ' '}     [M] MENU`, CONFIG.canvasW/2, 390);
}

function drawWin(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH);

  // Celebratory twinkling pixel stars — deterministic positions using index
  for (let i = 0; i < 22; i++) {
    const blink = Math.sin(loopT * (2.8 + i*0.6) + i*2.1);
    if (blink < 0) continue;
    ctx.save(); ctx.globalAlpha = blink * 0.45;
    ctx.fillStyle = '#39FF14';
    ctx.fillRect((i*137 + 50) % CONFIG.canvasW, (i*89 + 30) % CONFIG.canvasH, 2, 2);
    ctx.restore();
  }

  _scanSweep('rgba(57,255,20,0.040)', 100);
  _cornerFrame('#0d4d04');

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 14 + 6*Math.sin(t * 1.7);
  ctx.fillStyle = '#39FF14'; ctx.font = '22px "Courier New", monospace';
  ['██╗    ██╗██╗███╗   ██╗','██║    ██║██║████╗  ██║','██║ █╗ ██║██║██╔██╗ ██║',
   '╚███╔███╔╝██║██║╚██╗██║',' ╚══╝╚══╝ ╚═╝╚═╝ ╚═══╝']
    .forEach((line, i) => ctx.fillText(line, CONFIG.canvasW/2, 80+i*30));
  ctx.shadowBlur = 0;

  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 5;
  ctx.font = '20px "Courier New", monospace';
  ctx.fillText(`FINAL SCORE:   ${String(winScore).padStart(3,'0')}`, CONFIG.canvasW/2, 260);
  ctx.fillText(`CROWS KILLED:  ${winKills}`, CONFIG.canvasW/2, 294);
  ctx.fillText(`SKELETONS SLAIN: ${winSkeletons}`, CONFIG.canvasW/2, 322);
  let hp = '';
  const winMaxHP = FEATHERS.maxHP();
  for (let i = 0; i < winMaxHP; i++) hp += i < winHP ? '♥' : '♡';
  ctx.fillText(`HP REMAINING:  ${hp}`, CONFIG.canvasW/2, 350);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0a3a06'; ctx.font = '13px "Courier New", monospace';
  ctx.fillText(`[ ${modeRule(gameMode).label} MODE ]`, CONFIG.canvasW/2, 378);

  ctx.fillStyle = '#1a7a08'; ctx.font = '18px "Courier New", monospace';
  ctx.fillText(`[R] PLAY AGAIN${Math.floor(t*2)%2===0 ? '_' : ' '}   [M] MENU`, CONFIG.canvasW/2, 410);
}

/**
 * Shown once, between the Crow King's death and the castle stage's own
 * setup becoming visible. That setup (generateMap('castle'), the wave 1
 * spawn) already ran before this state was entered, hidden behind the black
 * screen, so the click just reveals it rather than triggering it.
 */
function drawStageIntro(t) {
  const intro = STAGE_INTROS[pendingIntro] || STAGE_INTROS.castle;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
  _scanSweep(intro.sweep, 90);
  _cornerFrame(intro.frame);

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = intro.accent; ctx.shadowBlur = 16 + 7 * Math.sin(t * 1.7);
  ctx.fillStyle = intro.accent; ctx.font = '24px "Courier New", monospace';
  ctx.fillText(intro.text, CONFIG.canvasW / 2, CONFIG.canvasH / 2 - 16);
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 3);
  ctx.fillStyle = intro.dim; ctx.font = '16px "Courier New", monospace';
  ctx.fillText('[ CLICK TO CONTINUE ]', CONFIG.canvasW / 2, CONFIG.canvasH / 2 + 32);
  ctx.globalAlpha = 1;
}

/**
 * Per-character aim reticle, drawn at the mouse position in place of the
 * system cursor (see syncCursor). One row per CHAR_PANELS entry, reusing
 * that table's own color for each so the reticle always matches the
 * character-select swatch, and a fifth character gets a row here instead
 * of a growing if/else chain.
 */
const RETICLE_PAINTERS = {
  archer: drawArcherReticle,
  wizard: drawWizardReticle,
  knight: drawKnightReticle,
  ranger: drawRangerReticle,
  sapper: drawSapperReticle,
};

/**
 * Where the shot is going, in canvas pixels — and therefore where the reticle
 * belongs.
 *
 * `mouse` is already canvas-space: the listener scales it by
 * canvasW / rect.width, so it survives the canvas being displayed at any size.
 * The aim ray converts it to world space by subtracting hudHeight, and world
 * space is drawn hudHeight further down, so the point the arrow flies at is
 * canvas `mouse.y` exactly.
 *
 * drawReticle used to ADD hudHeight here, putting the reticle 48px below the
 * point being aimed at. The OS cursor is hidden in game — see syncCursor — so
 * the reticle is the only aiming reference the player has: lining it up on a
 * crow sent the arrow a clean 48px over its head, on a target 16px tall. A
 * reticle that is not the aim point is a lie the player aims with.
 *
 * One function so the two can never disagree again, and exposed on devHooks so
 * the agreement is checkable without a canvas.
 *
 * The two do differ in one way, and only one: `mouse` is unclamped, so the aim
 * follows the pointer out into the letterbox margin and beyond, while the
 * crosshair has to stay on the picture to be seen at all. Where they differ the
 * crosshair is pinned to the point the aim ray crosses the playfield edge, so
 * it still sits on the line the shot travels. Players reported the aim
 * "sticking" precisely because the old code clamped the aim instead: once both
 * axes pinned, moving further out changed nothing.
 */
function reticleAt() {
  const top = CONFIG.hudHeight, bottom = CONFIG.canvasH, right = CONFIG.canvasW;
  if (mouse.x >= 0 && mouse.x <= right && mouse.y >= top && mouse.y <= bottom) {
    return { x: mouse.x, y: mouse.y };
  }
  // Off the picture, so pin the crosshair where the aim ray leaves the
  // playfield rather than at the nearest edge point. Nearest-point is what a
  // plain clamp gives, and it puts the crosshair off the line the shot travels
  // -- the same lie as the old 48px offset above, just in the other axis.
  const px = player.x, py = player.y + top;
  const dx = mouse.x - px, dy = mouse.y - py;
  let t = 1;
  if (dx > 0) t = Math.min(t, (right - px) / dx);
  else if (dx < 0) t = Math.min(t, -px / dx);
  if (dy > 0) t = Math.min(t, (bottom - py) / dy);
  else if (dy < 0) t = Math.min(t, (top - py) / dy);
  if (!Number.isFinite(t)) t = 0;
  t = Math.max(0, Math.min(1, t));
  return { x: px + dx * t, y: py + dy * t };
}

/** The world point the aim ray is pointed at. */
function aimWorld() {
  return { x: mouse.x, y: mouse.y - CONFIG.hudHeight };
}

function drawReticle() {
  const at = reticleAt();
  ctx.save();
  ctx.translate(at.x, at.y);
  (RETICLE_PAINTERS[selectedChar] || drawRangerReticle)();
  drawBlockedFlash();
  ctx.restore();
}

/**
 * Rings the reticle when the game refuses a press. Drawn over every
 * character's own reticle rather than inside each painter, because
 * ACTION_BLOCKED already covers every refusal there is: a cooldown that has
 * not finished, an empty pool, and the in-flight arrow cap. All of those
 * used to be silent, so a press that did nothing and a press that fired
 * looked identical and the weapon took the blame.
 */
function drawBlockedFlash() {
  if (blockedFlash <= 0) return;
  ctx.globalAlpha = blockedFlash / CONFIG.blockedFlashSecs;   // linear 1 -> 0
  ctx.strokeStyle = '#8A1010'; ctx.lineWidth = 2;
  ctx.shadowColor = '#8A1010'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

/** Ranger: a plain crosshair, the natural read for the crossbow's straight bolts. */
function drawRangerReticle() {
  const pulse = 0.7 + 0.3 * Math.sin(loopT * 4);
  ctx.globalAlpha = 0.25 + 0.55 * pulse;
  ctx.strokeStyle = '#FFCC00'; ctx.lineWidth = 1.5;
  ctx.shadowColor = '#FFCC00'; ctx.shadowBlur = 5 + 3 * pulse;
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(dx * 4, dy * 4); ctx.lineTo(dx * 11, dy * 11); ctx.stroke();
  });
  ctx.shadowBlur = 0; ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#FFCC00';
  ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Sapper: a wide dashed ring at the blast radius, with a dot at the aim point.
 *
 * The only reticle that shows an area rather than a point, because the only
 * thing a sapper needs to judge is what the charge will reach - and how close
 * that is to their own feet.
 */
function drawSapperReticle() {
  const pulse = 0.7 + 0.3 * Math.sin(loopT * 4);
  ctx.globalAlpha = 0.18 + 0.3 * pulse;
  ctx.strokeStyle = '#FF7A1A'; ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 5]);
  ctx.beginPath(); ctx.arc(0, 0, CONFIG.dynamiteBlastRadius, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.25 + 0.55 * pulse;
  ctx.shadowColor = '#FF7A1A'; ctx.shadowBlur = 5 + 3 * pulse;
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(dx * 5, dy * 5); ctx.lineTo(dx * 10, dy * 10); ctx.stroke();
  });
  ctx.shadowBlur = 0; ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#FF7A1A';
  ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

/** Archer: a scope ring with the cross peeking through it, for a longbow's precision. */
function drawArcherReticle() {
  const pulse = 0.7 + 0.3 * Math.sin(loopT * 4);
  const R = 9;
  ctx.globalAlpha = 0.25 + 0.5 * pulse;
  ctx.strokeStyle = '#39FF14'; ctx.lineWidth = 1.4;
  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 5 + 3 * pulse;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(dx * (R - 4), dy * (R - 4)); ctx.lineTo(dx * (R + 4), dy * (R + 4)); ctx.stroke();
  });
  ctx.shadowBlur = 0; ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#39FF14';
  ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Knight: a small spearhead rotated onto player.aimAngle, so it points the
 * same way the real spear would thrust rather than sitting axis-aligned.
 */
function drawKnightReticle() {
  ctx.rotate(player.aimAngle);
  ctx.globalAlpha = 0.75;
  ctx.shadowColor = '#C8C8E8'; ctx.shadowBlur = 5;
  ctx.fillStyle = '#C8C8E8';
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(0, -4); ctx.lineTo(-3, 0); ctx.lineTo(0, 4);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#8C8CA8'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-10, 0); ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Wizard: a small wand rotated onto player.aimAngle, its tip sparking with
 * the same pulse-and-glow technique the character panels' magic accents use.
 */
function drawWizardReticle() {
  ctx.rotate(player.aimAngle);
  const pulse = 0.5 + 0.5 * Math.sin(loopT * 6);
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = '#5A3C22'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(4, 0); ctx.stroke();
  ctx.shadowColor = '#8888FF'; ctx.shadowBlur = 6 + 4 * pulse;
  ctx.fillStyle = '#8888FF';
  ctx.beginPath(); ctx.arc(6, 0, 2 + pulse, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#C8C8FF'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(2, 0); ctx.lineTo(10, 0);
  ctx.moveTo(6, -4); ctx.lineTo(6, 4);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

const GAME_VISIBLE_STATES = new Set(['playing','paused','boss_entrance','boss_fight']);

function render(t) {
  trace.mark('hud');
  syncCursor();
  const gameVisible = GAME_VISIBLE_STATES.has(appState);
  if (gameVisible) {
    trace.mark('tiles');
    ctx.fillStyle = '#0a140a'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
    const so = shakeOffset(t);
    ctx.save(); ctx.translate(so.x, so.y);
    // A net lies on the ground, so it goes down with the terrain and before
    // anything that walks over it. Blasts go over the bodies instead -- they
    // are in the air and half of what sells one is that it hides what it hit.
    drawTiles(); FORESHADOW.drawSkyTint(); drawMazeObjective(); drawNetMats();
    drawPickups(); drawFires(); drawParticles(); drawShockRings();
    // Anything alive is drawn only where the player can see it right now.
    // litAt is unconditionally true off the maze, so this is the same list of
    // draws it has always been on forest and castle.
    // The ice overlay goes on at the call site rather than inside each of the
    // three draw functions: it is the same rime over whatever was just drawn,
    // and one copy beats three that could drift.
    trace.mark('bodies');
    for (const c of crows) if (litAt(c.x, c.y)) { drawCrow(c); drawFrozenOverlay(c); }
    for (const s of skeletons) if (litAt(s.x, s.y)) { drawSkeleton(s); drawFrozenOverlay(s); }
    for (const s of soldiers) if (litAt(s.x, s.y)) { drawSoldier(s); drawFrozenOverlay(s); }
    for (const gd of guards) if (litAt(gd.x, gd.y)) drawGuard(gd);
    drawArrows(); drawDynamites(); drawBarrageBombs(); drawSapperShots(); drawSatchels(); drawHostileBolts(); drawNets(); drawHeldMarkers();
    drawChargeArc(); drawPlayer();
    if (playerPoison.timer > 0) drawPlayerPoisonOverlay();
    if (playerFrozenTimer > 0) drawPlayerFrozenOverlay();
    if (!boss || litAt(boss.x, boss.y)) drawBoss();
    // Over every body, because half of what sells a blast is that it briefly
    // hides what it went off on. Under the floaters, so the damage numbers
    // still read through it.
    drawBlasts(); drawAbilityFx();
    drawFloaters(); drawPickupMarks();
    // Last thing inside the shake, so the dark moves with the world instead of
    // sliding across it.
    trace.mark('fog');
    drawFog();
    ctx.restore();
    trace.mark('vignette');
    drawEdgeTicks(); drawEdgeAlerts();
    // Vignette — applied outside shake to stay stable
    ctx.drawImage(vignetteCanvas, 0, 0);
    if (bossDeathSeq) {
      const ft = bossDeathSeq.timer;
      if ((ft >= 0.3 && ft < 0.42) || (ft >= 0.55 && ft < 0.67))
        { ctx.fillStyle = 'rgba(110,0,0,0.45)'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH); }
    }
    // Wave announcement banner
    if (waveAnnounce > 0) {
      // Banner is 2.2s total: fade in 0-0.4s, hold, fade out last 0.5s
      const TOTAL = 2.2;
      const fadeIn  = Math.min(1, (TOTAL - waveAnnounce) / 0.4);
      const fadeOut = Math.min(1, waveAnnounce / 0.5);
      const bannerA = Math.min(fadeIn, fadeOut);
      ctx.save(); ctx.globalAlpha = bannerA;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, CONFIG.canvasH/2 - 24, CONFIG.canvasW, 48);
      ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 4 + 4 * Math.sin(loopT * 4);
      ctx.fillStyle = '#39FF14'; ctx.font = 'bold 22px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(waveAnnounceText, CONFIG.canvasW/2, CONFIG.canvasH/2);
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    trace.mark('hud');
    drawHUD(t);
    FORESHADOW.drawBanner(); STREAK.draw(); BOUNTIES.draw();
    // Lightning storm flash overlay
    if (_stormFlash > 0) {
      ctx.save(); ctx.globalAlpha = (_stormFlash/0.35)*0.42;
      ctx.fillStyle='#2222AA';
      ctx.fillRect(0, CONFIG.hudHeight, CONFIG.canvasW, CONFIG.canvasH-CONFIG.hudHeight);
      ctx.restore();
    }
    if (appState === 'paused')        drawPause();
    if (appState === 'boss_entrance') drawBossEntrance();
    if (inGame()) drawReticle();
  } else if (appState === 'multiplayer'){ multiplayerSession?.frame(keys, { x: mouse.x, y: mouse.y, fire: mouseLeftHeld, special: mouseRightHeld });
  } else if (appState === 'menu')       { drawMenu(t);
  } else if (appState === 'charselect') { drawCharSelect(t);
  } else if (appState === 'mapselect')  { drawMapSelect(t);
  } else if (appState === 'controls')   { drawControls(t);
  } else if (appState === 'gameover')   { drawGameOver(t);
  } else if (appState === 'win')        { drawWin(t);
  } else if (appState === 'stage_intro') { drawStageIntro(t);
  } else if (appState === 'chooser')    { drawChooser();
  } else if (appState === 'inventory')  { FEATHERS.draw();
  } else if (appState === 'talents')    { drawTalentTree(); }
}

// ── LOOP ──────────────────────────────────────────────────────────────────────

/**
 * The tracer's readout, one row per section, drawn after the frame is filed so
 * it never counts itself.
 *
 * Deliberately not part of `render()`: the thing measuring the render pass
 * cannot also be inside it. `trace` holds the numbers (see src/render/trace.ts)
 * and formats the rows; this only puts them on the canvas.
 */
/**
 * Sets the trace level and puts the right context behind `ctx`.
 *
 * The only place the counting wrapper is installed or removed, so the two
 * callers (the ?perf switch at boot and devHooks.setTrace) cannot disagree
 * about it, and so re-entering `ops` rewraps the raw context rather than the
 * wrapper it installed last time.
 */
function applyTraceLevel(level) {
  trace.setLevel(level);
  if (rawCtx !== null) ctx = trace.level() === 'ops' ? countingContext(rawCtx, trace.counters) : rawCtx;
  return trace.level();
}

function drawTraceOverlay() {
  if (!trace.frames()) return;
  const rows = trace.lines();
  const top = CONFIG.canvasH - 11 * (rows.length + 1) - 4;
  ctx.save();
  ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(2, top - 2, 420, 11 * (rows.length + 1) + 4);
  ctx.fillStyle = '#39FF14';
  ctx.fillText(`TRACE ${trace.level()}  ${trace.frames()} frames`, 4, top);
  rows.forEach((row, i) => ctx.fillText(row, 4, top + 11 * (i + 1)));
  ctx.restore();
}

/**
 * Mirrors the same rows into the diagnostic log once a second, so a playtest
 * bug report carries the numbers without the reporter having had the overlay
 * open. Gated on the log's own level, so it costs nothing below `debug`.
 */
let traceLoggedAt = 0;
function logTraceSummary(ts) {
  if (trace.level() === 'off' || log.currentLevel() !== 'debug') return;
  if (ts - traceLoggedAt < 1000) return;
  traceLoggedAt = ts;
  const summary = trace.summary();
  log.debug('trace', `${trace.frames()} frames`, {
    map: mapKind,
    rows: trace.lines(),
    worst: SPANS.reduce((a, b) => (summary[a].ms >= summary[b].ms ? a : b)),
  });
}

let lastTs = 0, loopT = 0;

// ── MULTIPLAYER SCREEN ────────────────────────────────────────────────────────

/**
 * The lobby lives in src/ui and is driven from this loop, so there is one
 * canvas, one clock, and one keydown listener for the whole game.
 */
let multiplayerSession = null;

function openMultiplayer() {
  multiplayerSession = new MultiplayerSession(canvas);
  // Connecting is async; the screen draws its own connecting and failure states
  void multiplayerSession.open();
}

function closeMultiplayer() {
  multiplayerSession?.close();
  multiplayerSession = null;
}

/**
 * Escape leaves the screen. Every other key belongs to the lobby, which reads
 * them in its own frame call so a held key is not read as a repeated press.
 */
function handleMultiplayerInput() {
  if (keys['Escape']) {
    keys['Escape'] = false;
    transitionTo('menu');
    return;
  }
  // A started match is the server's decision, not a keystroke, so it is checked
  // here rather than waiting for input
  const started = multiplayerSession?.matchStart();
  if (started) matchStarted = started;
}

/** The deal from the last MATCH_START, kept for the slice that renders it. */
let matchStarted = null;

function handleMenuInput() {
  const n = MENU_SHOWN.length;
  if (keys['ArrowUp'])   { menuSelection = (menuSelection - 1 + n) % n; keys['ArrowUp']   = false; }
  if (keys['ArrowDown']) { menuSelection = (menuSelection + 1) % n;     keys['ArrowDown'] = false; }
  if (keys['Enter']) {
    keys['Enter'] = false;
    MENU_SHOWN[menuSelection].run();
    return;                       // the entry may have changed appState
  }
  // Hotkeys, the bracketed letter beside each label
  for (const entry of MENU_SHOWN) {
    const lower = entry.key.toLowerCase();
    if (keys[lower] || keys[entry.key]) {
      keys[lower] = keys[entry.key] = false;
      entry.run();
      return;
    }
  }
}

const FIXED_DT = 1 / 60;   // sim advances in fixed 60 Hz steps
const MAX_STEPS = 8;       // cap sim work per frame (~133ms) to avoid a spiral after a stall
let accumulator = 0;

// One fixed simulation step. Same body as before; dt is always FIXED_DT now.
function stepGame(dt) {
  switch (appState) {
    case 'menu':        handleMenuInput(); break;
    case 'multiplayer': handleMultiplayerInput(); break;

    case 'charselect': {
      // Reads CHAR_PANELS rather than its own list, so a character exists on
      // screen and here at once — see the comment on CHAR_PANELS.
      selectedChar = cyclePanelSelection(CHAR_PANELS, selectedChar, 'char');
      // Waves lets the player pick the ground; brawl's map is fixed, so it
      // skips straight to the run the way it always has.
      if (keys['Enter']) { transitionTo(picksItsMap(gameMode) ? 'mapselect' : 'playing'); keys['Enter']=false; }
      if (keys['Escape']) { transitionTo('menu'); keys['Escape']=false; }
      break; }

    case 'mapselect': {
      // Same cycling shape as charselect above, over MAP_PANELS instead of
      // CHAR_PANELS — see the comment on MAP_PANELS.
      selectedMapKind = cyclePanelSelection(MAP_PANELS, selectedMapKind, 'kind');
      if (keys['Enter']) { transitionTo('playing'); keys['Enter']=false; }
      if (keys['Escape']) { transitionTo('charselect'); keys['Escape']=false; }
      break; }

    case 'chooser': {
      const picks = chooser ? chooser.offers.length : 0;
      if (picks === 0) { appState = 'playing'; break; }   // belt: never staged empty
      if (keys['ArrowLeft'])  { chooser.cursor = (chooser.cursor + picks - 1) % picks; keys['ArrowLeft'] = false; }
      if (keys['ArrowRight']) { chooser.cursor = (chooser.cursor + 1) % picks; keys['ArrowRight'] = false; }
      for (let i = 0; i < picks; i++) {
        if (keys[String(i + 1)]) { chooser.cursor = i; keys[String(i + 1)] = false; }
      }
      if (keys['Enter']) { keys['Enter'] = false; confirmChooser(); }
      break; }

    case 'controls':
      if (remapTarget === null && (keys['b']||keys['B'])) {
        transitionTo(controlsFrom === 'paused' ? 'paused' : 'menu'); keys['b']=keys['B']=false;
      }
      break;

    case 'playing':
      if (keys['Escape']) { pausedFrom='playing'; transitionTo('paused'); keys['Escape']=false; break; }
      gameTime += dt;
      updateFOV(); updatePlayer(dt); updateArrows(dt); updateDynamites(dt); updateSatchels(dt); updateCrows(dt); updateSkeletons(dt);
      updateBarrageBombs(dt); updateSapperShots(dt);
      // The maze's warden hunts you the whole level, so he ticks here as well
      // as in a boss fight. See BOSS_HUNTS_WHILE_EXPLORING for why this is a
      // table lookup and not a kind check.
      if (boss && BOSS_HUNTS_WHILE_EXPLORING[boss.kind]) updateBoss(dt);
      // A boss can now die outside a boss fight — a siege kills one in the
      // middle of a wave — and the death sequence is what clears bossDeathSeq.
      // Without this it is set and never cleared, and the five update
      // functions that bail on it (crows, skeletons, soldiers, guards, the
      // siege contact pass) stop for good: the whole field freezes and the run
      // cannot be finished. Found by playing it.
      if (bossDeathSeq) updateBossDeath(dt);
      updateHostileBolts(dt);
      updatePickups(dt); updateParticles(dt); updateShockRings(dt); updateBlasts(dt); updateNets(dt); updateNetMats(dt); updateFloaters(dt); updateFires(dt); checkPickupCollection(); updateEscalation(dt);
      updateMazeObjective(dt);
      updateSoldiers(dt); regrowth.tick(dt);
      updateTowers(dt); updateGuards(dt); updateSiegeContact(dt); updateSiege(dt);
      FORESHADOW.update(dt); STREAK.update(dt); BOUNTIES.update(dt);
      break;

    case 'boss_entrance':
      updateBossEntrance(dt); updateParticles(dt); updateShockRings(dt); updateBlasts(dt); updateNets(dt); updateNetMats(dt); updateFloaters(dt);
      break;

    case 'boss_fight':
      if (keys['Escape']) { pausedFrom='boss_fight'; transitionTo('paused'); keys['Escape']=false; break; }
      gameTime += dt;
      updateFOV(); updatePlayer(dt); updateArrows(dt); updateDynamites(dt); updateSatchels(dt); updateCrows(dt); updateSkeletons(dt);
      updatePickups(dt); updateParticles(dt); updateShockRings(dt); updateBlasts(dt); updateNets(dt); updateNetMats(dt); updateFloaters(dt); updateFires(dt); checkPickupCollection();
      updateSoldiers(dt); regrowth.tick(dt); updateBarrageBombs(dt); updateSapperShots(dt);
      updateTowers(dt); updateGuards(dt); updateSiegeContact(dt); updateSiege(dt);
      if (bossDeathSeq) updateBossDeath(dt); else { updateBoss(dt); updateHostileBolts(dt); }
      FORESHADOW.update(dt); STREAK.update(dt); BOUNTIES.update(dt);
      break;

    case 'paused':
      if (keys['Escape'])      { transitionTo(pausedFrom); keys['Escape']=false; }
      if (keys['c']||keys['C']){ transitionTo('controls'); keys['c']=keys['C']=false; }
      if (keys['m']||keys['M']){ transitionTo('menu');     keys['m']=keys['M']=false; }
      if (keys['i']||keys['I']){ transitionTo('inventory'); keys['i']=keys['I']=false; }
      if (keys['t']||keys['T']){ transitionTo('talents');   keys['t']=keys['T']=false; }
      break;

    case 'inventory':
      if (keys['ArrowUp'])   { FEATHERS.moveCursor(-1); keys['ArrowUp']   = false; }
      if (keys['ArrowDown']) { FEATHERS.moveCursor( 1); keys['ArrowDown'] = false; }
      if (keys['Enter'])     { FEATHERS.buyCurrent();   keys['Enter']     = false; }
      if (keys['t']||keys['T']) { transitionTo('talents'); keys['t']=keys['T']=false; }
      if (keys['b']||keys['B']) { transitionTo('paused'); keys['b']=keys['B']=false; }
      break;

    // The talent shop. Both shops spend the same wallet, so they sit next to
    // each other rather than one being buried under the other.
    case 'talents':
      if (keys['ArrowUp'])   { TALENTS.moveCursor(-1); keys['ArrowUp']   = false; }
      if (keys['ArrowDown']) { TALENTS.moveCursor( 1); keys['ArrowDown'] = false; }
      if (keys['Enter'])     { TALENTS.buyCurrent();   keys['Enter']     = false; }
      // Only a shop visit can cross to the upgrades. A boss opened this to be
      // spent and handed back, and wandering into another screen from inside a
      // ceremony loses the hand-off it was holding.
      if (!inCeremony() && (keys['u']||keys['U'])) { transitionTo('inventory'); keys['u']=keys['U']=false; }
      if (keys['b']||keys['B']) {
        keys['b'] = keys['B'] = false;
        if (inCeremony()) finishCeremony(); else transitionTo('paused');
      }
      break;

    case 'gameover':
      if (keys['r']||keys['R']) { transitionTo('playing'); keys['r']=keys['R']=false; }
      if (keys['m']||keys['M']) { transitionTo('menu');    keys['m']=keys['M']=false; }
      break;

    case 'win':
      if (keys['r']||keys['R']) { transitionTo('playing'); keys['r']=keys['R']=false; }
      if (keys['m']||keys['M']) { transitionTo('menu');    keys['m']=keys['M']=false; }
      break;
  }

}

/**
 * One fixed step of the frame clock: the screen shake decays, and the
 * simulation advances unless hitstop is holding it.
 *
 * The gate is here rather than inside stepGame or inside loop() for two
 * reasons. It has to be above stepGame, because a freeze that lived inside
 * stepGame's playing branch would be a rule every future update function had
 * to remember to ask about. And it has to be below loop(), because
 * devHooks.stepSim drives the sim without a frame or a render: a gate written
 * only into loop() would leave the headless harness running a second, subtly
 * different simulation, and the tests would be checking that copy.
 *
 * render() is deliberately not in here. It stays in loop(), outside the
 * accumulator, so a held world is still drawn every frame — the screen stays
 * alive and the world holds still, which is the whole effect.
 */
function fixedStep() {
  updateShake(FIXED_DT);
  // Only a live run can be held. Every other screen — the title, char select,
  // the pause menu, game over — reads its input inside stepGame, so a freeze
  // that reached them would freeze the menu with no key left to unfreeze it.
  //
  // Outside a run any freeze still owed is dropped, not banked. transitionTo
  // clears it too, and that is the statement of the rule; this is the safety
  // net for the two places that assign appState directly rather than going
  // through it (showStageIntro and the intro dismissal), where a freeze armed
  // by the impact that cleared the stage would otherwise wake up on the next.
  if (!inGame()) {
    hitstop.clear();
    stepGame(FIXED_DT);
    return;
  }
  if (hitstop.step() === 'run') stepGame(FIXED_DT);
}

function loop(ts) {
  let frameTime = (ts - lastTs) / 1000;
  lastTs = ts; loopT = ts / 1000;
  if (frameTime > 0.25) frameTime = 0.25;   // drop a huge gap (e.g. backgrounded tab)

  if (ts - waterLastTs >= CONFIG.waterShimmerMs) { waterLastTs = ts; waterPhase = !waterPhase; }

  // The frame's own boundaries. render() marks the rest: its first mark closes
  // `sim`, so the accumulator below needs no closing call of its own.
  trace.beginFrame();
  trace.mark('sim');
  accumulator += frameTime;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    fixedStep();
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS) accumulator = 0;   // discard backlog after the cap

  render(loopT);
  trace.endFrame();
  if (trace.level() !== 'off') { drawTraceOverlay(); logTraceSummary(ts); }
  if (liveLoop) requestAnimationFrame(loop);
}

// Whether the browser's own frame clock still drives the loop. A harness turns
// this off (see devHooks.takeClock) because the two clocks share one
// accumulator and race: real time runs faster than a scripted step(), so one
// live frame arriving between two calls subtracts however many seconds of wall
// clock have passed and the sim silently stops advancing until that debt is
// repaid.
let liveLoop = true;

// Dev hook: steps the loop with fixed timestamps and exposes read access to
// module state, so headless verification works while the tab is backgrounded.
let __devTs = 0;

/**
 * Read and drive access to module state. boot() also hangs this on
 * `window.__game` for the browser console. Tests import it directly, which is
 * what keeping this module free of import-time side effects buys.
 *
 * FEATHERS.init() and the first requestAnimationFrame used to sit here at
 * module scope. They belong to boot() now, which is the whole point of the
 * seam: importing this file must not start a game.
 */
export const devHooks = {
  // Hands the clock to the harness: stops the browser driving the loop and
  // zeroes the shared accumulator, so step(n) advances exactly n fixed steps.
  // Without it a scripted run is at the mercy of whichever clock ran last.
  takeClock() {
    liveLoop = false;
    accumulator = 0;
    lastTs = __devTs = performance.now();
    return { accumulator, devTs: __devTs };
  },
  clock: () => ({ accumulator, lastTs, devTs: __devTs, live: liveLoop }),
  step(n = 1) {
    if (__devTs === 0) __devTs = performance.now();
    // Advance by exactly one fixed step per call, so step(n) runs n sim steps.
    for (let i = 0; i < n; i++) { __devTs += FIXED_DT * 1000; loop(__devTs); }
  },
  /**
   * Advances the frame clock, one fixed step per count, with no render. Needs
   * no canvas, so this is what the headless tests drive; step() and frame()
   * above go through the real loop and need a booted page.
   *
   * It runs fixedStep(), the same body the real loop's accumulator runs, so a
   * hitstop freeze holds a scripted run exactly as it holds a played one. That
   * makes n steps n *frames*, which is n sim steps only while nothing is
   * frozen: a test waiting out a cooldown across an impact has to count sim
   * steps itself. See stepPast() in game.test.ts.
   */
  stepSim(n = 1) { for (let i = 0; i < n; i++) fixedStep(); },
  gameTime: () => gameTime,
  // The impact freeze. `hitstop` is the fixed steps still owed; `holdFrames`
  // arms one directly, the way startKnightCharge exposes an edge a headless
  // test cannot press; `hitstopLadder` is the table itself, so a test reads
  // the rows the game reads rather than a second copy of them.
  hitstop: () => hitstop.held,
  holdFrames(n) { hitstop.trigger(n); },
  hitstopLadder: () => HITSTOP,
  config: () => CONFIG,
  /**
   * The frame tracer, for a headless run that wants the numbers rather than
   * the overlay. `level` takes the same values ?perf does; 'ops' installs the
   * counting wrapper, which a booted page needs a canvas for.
   */
  trace: () => ({ level: trace.level(), frames: trace.frames(), spans: trace.summary() }),
  setTrace(level) { trace.reset(); return applyTraceLevel(level); },
  // The char-select rects, so a headless check can ask where a panel is
  // rather than re-deriving geometry the screen owns — which is the same
  // second copy this layout exists to remove.
  charSelect: () => charSelectLayout(),
  selectChar(name) { selectedChar = name; return selectedChar; },
  // The live key map and the one-shot fire latch, so a test can drive the same
  // input path a real keyboard does instead of a parallel one.
  keys: () => keys,
  shoot() { shootPressed = true; },
  killCount: () => killCount,
  hp: () => playerHP,
  // One frame with a raw millisecond gap, to test accumulator multi-stepping.
  frame(ms) {
    if (__devTs === 0) __devTs = performance.now();
    __devTs += ms; loop(__devTs);
  },
  // Dev triggers that drive real sim paths, for headless event-bus checks.
  kill(i = 0) { if (i >= 0 && i < crows.length) killCrow(i); },
  // Lands a hit through the real damage path, so a test can check what does
  // and does not absorb one without staging a collision to produce it.
  hurt(amount = 1) { damagePlayer(amount); },
  killSkel(i = 0) { if (i >= 0 && i < skeletons.length) killSkeleton(i); },
  // Drives the same death path a real kill shot would, so the crowking →
  // dark_archer → dark_knight → win chain can be walked without grinding
  // out every stage's HP bar by hand.
  killBoss() { if (boss && boss.bstate !== 'dead') startBossDeath(); },
  blast(x, y, element = 'none') {
    explodeExplosive({ x, y, vx: 0, vy: 0, life: 0, angle: 0, element }, 'dynamite');
  },
  // Lights the boss the way a fire weapon's hit does, so the burn's own
  // arithmetic can be checked without staging an arrow's whole flight.
  igniteBoss(amount) { if (boss) igniteBoss(amount); },
  // The pouch and the burning ground, for the sapper's ammo and fire tests.
  inv: () => inv,
  fires: () => fires,
  floaters: () => floaters,
  arrows: () => arrows,
  pickups: () => pickups,
  dynamites: () => dynamites,
  satchels: () => satchels,
  boss: () => boss,
  bossStage: () => bossStage,
  setBossStage(n) { bossStage = n; },
  hostileBolts: () => hostileBolts,
  castleWave: () => castleWave,
  startCastleWave(n) { startCastleWave(n); },
  frozenTimer: () => playerFrozenTimer,
  // The run's vitals in one read, one line per heartbeat of a monitored
  // playtest: the flight recorder (src/dev/flight-recorder.ts) polls this
  // rather than reaching into a dozen getters. `lastTs` is the loop's own
  // frame clock — stalled while the page's rAF still ticks means the loop
  // died; `t` stalled while `state` says a run is on means the sim is held.
  pulse: () => ({
    state: appState, mode: gameMode, map: mapKind, char: selectedChar,
    t: +gameTime.toFixed(3), lastTs: Math.round(lastTs), live: liveLoop,
    held: hitstop.held, hp: playerHP, kills: killCount,
    crows: crows.length, skels: skeletons.length, soldiers: soldiers.length,
    arrows: arrows.length, boss: boss ? boss.kind : null,
  }),
  // Everything that can refuse the player movement, in one place. A stuck
  // player is always one of these, so a harness that catches one can say which
  // rather than guessing.
  // The escape hatch and its two predicates, so a test can check the rescue
  // without waiting out the half-second probe timer.
  unstick() { unstickPlayer(); },
  forceUnstick() { forceUnstick(); },
  boxedIn: () => boxedInAt(player.x, player.y),
  fits: (x = player.x, y = player.y) => playerFits(x, y),
  movementBlockers: () => ({
    frozen: playerFrozenTimer,
    charging: knightCharge.on,
    dashing: knightDash.timer,
    buried: !playerFits(player.x, player.y),
    snipeKeyHeld: !!keys[CONFIG.keys.snipe],
    snipeKeyName: CONFIG.keys.snipe,
    heldKeys: Object.keys(keys).filter(k => keys[k]),
    x: player.x, y: player.y, state: appState, char: selectedChar, map: mapKind,
  }),
  poison: () => ({ timer: playerPoison.timer, tickIn: playerPoison.tickIn, speedMult: poisonSpeedMult() }),
  minotaur: () => (boss && boss.kind === 'minotaur'
    ? { bstate: boss.bstate, x: boss.x, y: boss.y, hp: boss.hp,
        stateTimer: boss.stateTimer, cooldown: boss.cooldown,
        daze: boss.dazeTimer, phase: bossDazePhase(), sees: minotaurSeesPlayer() }
    : null),
  // Puts a stage's boss on the map outright, past the entrance cinematic,
  // because transitionTo('boss_entrance') does not clear the previous one: a
  // harness that walks the entrance twice weighs the same boss twice.
  spawnBossNow(stage) { bossStage = stage; spawnBoss(); return boss.kind; },
  spawnMinotaur() { bossStage = 4; spawnBoss(); boss.bstate = 'prowl'; return boss.kind; },
  // The whole objective chain in one read: which keys are held, which locks
  // are open, whether the warden has been met yet, and where the furniture is.
  intro: () => pendingIntro,
  pressure: () => ({
    char: selectedChar, pressure: mazePressure(),
    ratsPerPack: ratsPerPack(), ratRespawnSecs: +ratRespawnSecs().toFixed(2),
    silverDropChance: +(CONFIG.mazeSilverKeyDropChance / mazePressure()).toFixed(3),
    chargeCooldown: +(CONFIG.minotaurChargeCooldown / mazePressure()).toFixed(2),
    poisonSlow: CONFIG.ratPoisonSlowMult,
  }),
  // The same two lines the click handler runs, so a harness advances the
  // stage hand-off through the real path rather than assigning appState.
  dismissIntro() { if (appState !== 'stage_intro') return false; pendingIntro = null; appState = 'playing'; return true; },
  maze: () => (mazeRun ? {
    silver: mazeRun.held.silver, golden: mazeRun.held.golden,
    chestOpened: mazeRun.locks.chest.opened, doorOpened: mazeRun.locks.door.opened,
    metMinotaur: mazeRun.metMinotaur, silverDropped: mazeRun.silverDropped,
    chest: { x: mazeRun.locks.chest.x, y: mazeRun.locks.chest.y },
    door: { x: mazeRun.locks.door.x, y: mazeRun.locks.door.y },
    drops: mazeRun.drops.map(k => ({ kind: k.kind, x: k.x, y: k.y })),
    torches: mazeRun.torches.map(t => ({ x: t.x, y: t.y, lit: t.lit })),
  } : null),
  // What the player can see, and how much of the map they have banked.
  sight: () => {
    let visible = 0;
    for (let r = 0; r < CONFIG.rows; r++)
      for (let c = 0; c < CONFIG.cols; c++) if (fovMap.isVisible(c, r)) visible++;
    return {
      fog: fogOfWar(), radiusTiles: playerSightTiles(), torchLit: torchIsLit(), visible,
      remembered: seenTiles.reduce((n, v) => n + v, 0),
      torchOpened: torchTiles.reduce((n, v) => n + v, 0),
      tiles: CONFIG.rows * CONFIG.cols,
    };
  },
  // The two halves of the sight question, which fog of war pulled apart.
  // lit is "the player can see this point"; seesPlayerFrom is "something here
  // can see the player". They stopped having the same answer on the maze.
  lit: (x, y) => litAt(x, y),
  seesPlayerFrom: (x, y, range) => seesPlayerFrom(x, y, range),
  // The same A* the pursuers walk, so a scripted run crosses the maze the way
  // a player would instead of teleporting and calling it a playtest.
  path: (x, y) => computeAStarPath(player.x, player.y, x, y),
  knightCharge: () => ({
    charging: knightCharge.on, frac: knightChargeFrac(),
    dashing: knightDash.timer > 0, dashTimer: knightDash.timer,
    dashFrac: knightDash.frac, bossDamage: knightDashBossDamage(),
    angle: knightDash.angle, cooldown: knightChargeCD,
    chained: !!knightDash.chained, chainWindow: knightChainTimer,
  }),
  // The wedge the dash sweeps, and the hit test that reads it. Both exposed
  // because the only thing worth asserting about a telegraph is that it
  // agrees with what actually lands, and that takes reading both.
  knightChargeWedge: angle => knightChargeWedge(angle),
  inKnightArc: (x, y) => inKnightArc(x, y),
  // The render side's own reading of the windup, and the painter that draws
  // it. paintKnightTelegraph takes the context to paint into, so the drawing
  // is checkable with no canvas — the same idea as spriteGrid() handing over
  // the pixel art as the data it is, applied to a painter instead of a grid.
  knightTelegraph: () => knightChargeTelegraph(),
  paintKnightTelegraph(target) {
    const tele = knightChargeTelegraph();
    if (tele) drawKnightChargeTelegraph(target, tele, player.facing);
    return tele;
  },
  // Charge/release run off keydown/keyup edges rather than the held `keys`
  // map, so headless tests drive them directly the same way devHooks.blink
  // drives the wizard's edge-triggered ability.
  startKnightCharge() { startKnightCharge(); },
  releaseKnightCharge() { releaseKnightCharge(); },
  // Tap the event bus, for verifying which gameplay events fire.
  onEvent: fn => events.on(fn),
  // Drive a real state transition, and pick a character, for scripted runs.
  go(s) { transitionTo(s); },
  pick(c) { selectedChar = c; },
  selectedChar: () => selectedChar,
  // The char-select table itself, so a test can check that every character
  // the protocol knows about actually has a panel to be picked from.
  charPanels: () => CHAR_PANELS,
  ctrlActions: () => CTRL_ACTIONS,
  sapperChargeCD: () => sapperChargeCD,
  // Barrage and shot run off the same startCharge/keydown edges the archer's
  // secondary and the wizard's blink do, so headless tests drive them
  // directly rather than staging a real mouse click or keypress.
  barrage() { trySapperBarrage(); },
  sapperShot() { trySapperShot(); },
  sapperBarrageCD: () => sapperBarrageCD,
  sapperShotCD: () => sapperShotCD,
  barrageBombs: () => barrageBombs,
  sapperShots: () => sapperShots,
  // The blink runs off a keydown edge rather than the held `keys` map, so a
  // headless test drives it the same way devHooks.shoot drives the primary.
  blink() { tryWizardBlink(); },
  /** What the arrival effect is drawing, and at what radius. */
  blinkFx: () => ({ secs: blinkFx, radius: blinkRadius, from: blinkFrom, to: blinkTo }),
  wizBlink: () => ({ cd: wizBlinkCD, iframe: wizBlinkIFrame,
                     hops: wizBlinkHops, chainWindow: wizBlinkChainTimer }),
  // The secondary-attack path, which is the F key and the right mouse button
  // in play. Exposed for the same reason shift() is: every character routes
  // something different through it -- the wizard's storm, the knight's
  // whirlwind, the ranger's satchel, the sapper's barrage, the archer's
  // dynamite charge -- and a test that called one of those directly would not
  // be exercising the routing that picks it.
  secondary() { startCharge(); },
  secondaryUp() { releaseCharge(); },
  // The whole sniper-key path, so a test exercises the same routing the
  // keyboard does rather than calling one ability directly.
  shift() { pressShift(); },
  shiftUp() { releaseShift(); },
  archerDraw: () => ({ drawing: archerDraw.on, frac: archerDrawFrac(), cooldown: archerPowerCD }),
  brace: () => ({ level: braceLevel, bossMult: braceBossMult() }),
  /**
   * Every live explosive's chain state, across both arrays they live in.
   *
   * Reporting only `dynamites` is what hid the bug this exists to catch: the
   * barrage fan is the one time the sapper has a pile of bombs out, it lives in
   * its own array, and a harness that cannot see it measures a cascade that
   * never happened as a cascade that worked.
   */
  chain: () => [...dynamites, ...barrageBombs].map((d) => ({
    kind: d.kind, x: d.x, y: d.y, life: d.life,
    lit: !!d.chainLit, link: d.chainLink ?? 0,
  })),
  /** Momentum's meter and what it multiplies a bolt by. */
  momentum: () => ({ level: rangerMomentum, mult: rangerMomentumMult(),
                     max: TALENTS.stat('fullTilt') }),
  /** Bloodlust's stacks, what they multiply, and whether the swing in progress
   *  has touched anything yet. Enough to check a stack or a reset without
   *  reconstructing the swing. */
  bloodlust: () => ({ stacks: knightBloodlust, mult: knightBloodlustMult(),
                      connected: knightSpearConnected, cooldown: knightSpearCD }),
  /** The wizard's pool, the part-point banked toward the next one, and which
   *  fallback weapon is mid-swing. Enough to check a spend without guessing. */
  focus: () => ({ points: inv.focus, spendable: Math.floor(inv.focus),
                  max: CONFIG.resources.focus.max, melee: pfKind }),
  /** The talent system's public face - bank, run layer, effective figures -
   *  so a test drives a draft before the screens exist. */
  talents: () => TALENTS,
  /** The playing character's tree, so a harness can name every talent it owns
   *  rather than keep a second list of them - the same reason `hitstopLadder`
   *  hands out the real table. A benchmark that drafts a foreign id crashes
   *  in `talentValue`, so guessing is not an option. */
  charTree: () => CHAR_TREES[selectedChar],
  /** The wallet TALENTS buys from, so a test can set up a poor buyer. */
  feathers: () => FEATHERS,
  /** The purchased upgrade levels themselves, so a test can measure one axis
   *  at a time. Levels are module state that outlives a test, so reading the
   *  sum of whatever earlier tests bought is the failure mode this avoids. */
  upgradeLevels: () => FEATHERS.levels(),
  /** The mid-run chooser, and a pick that goes through the real confirm. */
  chooser: () => chooser,
  /** How each talent is presented: its kind, sigil and hook. Exposed so the
   *  colour code can be held to a test — a scheme that drifts talent by
   *  talent is worse than no scheme, because it teaches the wrong thing. */
  talentLook: () => ({ kinds: TALENT_KINDS, look: TALENT_LOOK }),
  /** The talent shop's row geometry, held to the same playbook: canvas-derived,
   *  inside the canvas, and the exact rects the click handler tests. */
  talentTreeLayout: () => talentTreeLayout(),
  /** What the shop prints about a purchase. Exposed because the alternative
   *  is driving the real painter, and a refusal the screen cannot word is a
   *  screen that says nothing when a purchase fails. */
  talentBuyNote: (result) => _talentBuyNote(result),
  /** The chooser row's geometry, so a test can hold it to the screens
   *  playbook: canvas-derived, inside the canvas, and centres that do not
   *  move when the cursor does. */
  chooserLayout: () => (chooser === null ? null : chooserLayout()),
  chooserPick(i) { if (!chooser) return false; chooser.cursor = i; confirmChooser(); return true; },
  /** Overchannel's remaining window, for pinning the rite's free bolts. */
  wizOverchannel: () => wizOverchannel,
  /** Slipstream's remaining window, seconds. Zero whenever she is not phasing. */
  slipstream: () => rangerSlip,
  /** The sapper's combo blast at a point, the way `blast` stages a plain one:
   *  same routine the shift shot reaches when it threads one of his bombs. */
  sapperCombo(x, y) {
    explodeExplosive({ x, y, vx: 0, vy: 0, life: 0, angle: 0 }, 'sapperShot',
      { radius: CONFIG.dynamiteBlastRadius * CONFIG.sapperComboRadiusMult });
  },
  // Backdates a draw already in progress, so a test can loose a fully drawn
  // shot without spending a real second on it: archerDrawFrac reads the wall
  // clock, which no amount of stepSim moves.
  holdDraw(secs) { if (archerDraw.on) archerDraw.t0 = performance.now() - secs * 1000; },
  holdNet(secs) { if (rangerNet.on) rangerNet.t0 = performance.now() - secs * 1000; },
  rangerNet: () => ({ drawing: rangerNet.on, frac: rangerNetFrac(), cooldown: rangerNetCD }),
  sapperChain: () => ({ peak: sapperChainPeak, read: sapperChainRead }),
  nets: () => nets,
  /** Nets lying on the ground, which is what a player actually sees. */
  netMats: () => netMats,
  /** Blasts still being drawn. An explosion is one frame in the sim and half a
   *  second on screen, so this is the only place the picture is observable. */
  blasts: () => blasts,
  rings: () => shockRings,
  pickMap(kind) { selectedMapKind = kind; },
  spawnCrow() { spawnCrow(); },
  spawnSkeleton(kind = 'normal') { spawnSkeleton(kind); },
  key(k) {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true });
    window.dispatchEvent(e); document.dispatchEvent(e);
  },
  state: () => appState,
  soldiers: () => soldiers,
  /** One known hit on one known soldier. A test that has to build a projectile
   *  to deliver a hit is measuring the projectile as well as the hit. */
  damageSoldier(j, amount = 1) { return damageSoldier(j, amount); },
  soldierKills: () => soldierKillCount,
  spawnSoldier(kind) { spawnSoldier(kind); },
  multiplayer: () => multiplayerSession?.describe() ?? null,
  tiles: () => tileMap,
  // Whether this map grows cover back, and how many tiles are mid-regrowth.
  // Enough for a test to watch ash come back without reaching into the module.
  regrowth: () => ({ active: regrowth.active, pending: regrowth.pendingCount }),
  smashTile: (row, col) => { smashTile(row, col); },
  mapKind: () => mapKind,
  selectedMapKind: () => selectedMapKind,
  // The mode axis. Until these existed, MENU_ENTRIES was the only writer of
  // gameMode and it is reachable only by a keypress on the title screen, so
  // every test in the suite ran in the default 'brawl' and nothing had ever
  // exercised the other side of the mode branches. setMode is deliberately
  // unvalidated: modeRule falls back to brawl for anything it does not
  // recognise, and a test that wants to prove that needs to be able to set
  // nonsense on purpose.
  mode: () => gameMode,
  setMode(m) { gameMode = m; },
  // The wave counter and the banner it raises, so a test can watch escalation
  // happen through the real timer rather than asserting on a draw call.
  wave: () => wave,
  waveBanner: () => ({ secs: waveAnnounce, text: waveAnnounceText }),
  // The two screens that decide what a player can reach at all. Exposed
  // because a mode or a map whose rules are complete but whose entry is
  // missing is unreachable, and nothing else in the suite would notice.
  menuEntries: () => MENU_ENTRIES,
  menuShown: () => MENU_SHOWN,
  mapPanels: () => MAP_PANELS,
  // Audio. A headless test has no AudioContext, so zzfx() is a no-op there and
  // the only observable half is the decision: what one play of a sound comes
  // to (null when audio is off), which sounds opted out of per-play variation,
  // and the render-side table the weapons play through.
  soundPlan: (s) => soundPlan(s),
  soundPlayback: () => SOUND_PLAYBACK,
  weaponFx: () => WEAPON_FX,
  // The siege, for a harness that wants to drive a ten-wave run without
  // playing one. siege() is the sim state; guards and towers are the bodies.
  siege: () => (siegeRun ? { wave: siegeRun.wave, outcome: siegeRun.outcome, guards: siegeRun.guards } : null),
  guards: () => guards,
  towers: () => towers,
  siegeBosses: () => siegeExtraBosses,
  /**
   * One hit on the boss holding the slot, through the real per-kind on-hit
   * path -- not startBossDeath. killBoss skips straight to the death sequence
   * and never consults hp, which is why the ten-wave run passed for months
   * against a wave ten that could not actually be fought.
   */
  hitBoss(amount = 1) {
    if (!boss || boss.bstate === 'dead') return null;
    damageBoss(amount, boss.x - 40, boss.y, 'arrow', 0);
    return { hp: boss.hp, bstate: boss.bstate };
  },
  /** What the siege's shared boss bar is showing, or null when none is up. */
  siegeBossBar: () => siegeBossPool(),
  // The flag five update functions bail on. Exposed because a death sequence
  // that never finishes freezes the whole field, and that is invisible from
  // outside unless something can look at it.
  bossDeathSeq: () => bossDeathSeq,
  /** Pins the retinue rolls. Pass null to hand it back to Math.random. */
  setSiegeRng(fn) { siegeRng = fn ?? Math.random; },
  /**
   * Puts both maze keys in hand, so a harness can reach the door without
   * playing the whole level. It grants the keys only — the locks still have to
   * be walked onto, so what the door does is still exercised for real.
   */
  giveMazeKeys() { if (mazeRun) { mazeRun.held.silver = true; mazeRun.held.golden = true; } },
  /**
   * Kills one boss on the field the way play does, extras included.
   *
   * `which` picks the slot. 'primary' takes whoever holds it; 'extra' takes
   * one from the extras list even while a live boss holds the slot, which is
   * the order the field actually produces and the only one that reaches the
   * handover's second half: tickSiegeBosses displaces the primary to tick an
   * extra, so a LIVE boss is out of the slot when that extra dies and has to
   * be given back. Killing the primary first never tests that -- the displaced
   * boss is already dead by then, and dropping it changes nothing observable.
   *
   * Returns which one died, or null when there is no live boss left.
   *
   * This exists because clearSiegeWave() nulls `boss` and `siegeExtraBosses`
   * outright. Every ladder test in the suite advanced that way, so ten waves
   * were walked without a single boss ever dying -- which is how a boss death
   * could freeze the field with the suite fully green.
   */
  killSiegeBoss(which = 'primary') {
    const primaryLive = boss && boss.bstate !== 'dead';
    const extra = siegeExtraBosses.find((b) => b && b.bstate !== 'dead');
    if (extra && (which === 'extra' || !primaryLive)) {
      const held = boss;
      boss = extra;
      startBossDeath();
      seatSiegeBoss(extra, held);
      return 'extra';
    }
    if (primaryLive) { startBossDeath(); return 'primary'; }
    return null;
  },
  /** Wipes the field so a test can reach the next wave without fighting one. */
  clearSiegeWave() { crows = []; skeletons = []; soldiers = []; boss = null; siegeExtraBosses = []; },
  /**
   * Fast-forwards a siege to the start of wave `n`, promoting and recruiting on
   * the way exactly as clearing each wave would.
   *
   * It walks the real completeWave rather than assigning the number, so the
   * retinue that arrives is the one ten cleared waves would actually have
   * produced — ranks, recruits and all. Assigning siegeRun.wave directly would
   * put you on wave 9 with two rank-0 guards, which is not a state the game can
   * reach and therefore not worth looking at.
   */
  jumpToSiegeWave(n) {
    if (!siegeRun) return null;
    let guardStops = 0;
    while (siegeRun.wave < n && siegeRun.outcome === 'running' && guardStops < 64) {
      this.clearSiegeWave();
      updateSiege(FIXED_DT);
      guardStops++;
    }
    this.clearSiegeWave();
    siegeSpawned = false;
    updateSiege(FIXED_DT);
    return { wave: siegeRun.wave, outcome: siegeRun.outcome, guards: siegeRun.guards.length };
  },
  /**
   * Tops the hero back up.
   *
   * For a harness driving a long run in which the hero is not the subject.
   * Nobody is holding the keys, so a hero left standing in a wave dies, and a
   * test about whether the ladder completes would be measuring that instead --
   * which is exactly how the ten-wave play-through first failed, on wave ten.
   */
  healHero() { playerHP = FEATHERS.maxHP(); return playerHP; },
  /** Hurts the hero through the real damage path, so every guard that path
   *  carries — shields, i-frames, Slipstream — is exercised rather than
   *  bypassed by writing playerHP directly. */
  hurtHero(n = 1) { damagePlayer(n); return playerHP; },
  /** Wounds every guard by n, never below 1, so the priest has work to do. */
  hurtGuards(n = 1) {
    for (const body of guards) body.guard.hp = Math.max(1, body.guard.hp - n);
    return guards.map((b) => b.guard.kind + ' ' + b.guard.hp + '/' + b.guard.maxHp);
  },
  /** Drops every tower to hp, to watch cover come off when it falls. */
  hurtTowers(hp = 1) { for (const t of towers) t.hp = hp; return towers.map((t) => t.hp); },
  // The diagnostic log — see src/sim/log.ts. logs() is a snapshot, safe to
  // hold onto after the call; setLogLevel changes what future calls record,
  // it does not retroactively add or remove anything already in the ring.
  logs: () => log.events(),
  setLogLevel(level) { log.setLevel(level); },
  clearLogs() { log.clear(); },
  generateMap(kind) { generateMap(kind); },
  // Regenerating the map under a player already placed leaves them wherever
  // they were, which on a carved map is often inside a wall. This is the
  // reposition initGame does for itself, exposed so a harness can switch maps
  // mid-run without that artefact looking like a spawn bug.
  respawnPlayer() {
    const p = spawnPoint();
    player.x = p.x; player.y = p.y;
    return { x: p.x, y: p.y };
  },
  player: () => player,
  crows: () => crows,
  skeletons: () => skeletons,
  mouse: () => mouse,
  /** Where the reticle is drawn, in canvas pixels. */
  reticleAt: () => reticleAt(),
  /** The world point the shot is aimed at. */
  aimWorld: () => aimWorld(),
  // `fires` is here rather than as its own accessor because a burning patch is
  // only ever counted, never inspected: what a test wants to know is whether a
  // shot lit one. Arrows are the other way round and already have `arrows()`.
  counts: () => ({ crows: crows.length, skeletons: skeletons.length, particles: particles.length, fires: fires.length, hp: playerHP }),
  // The pixel art, as the data it is (see SPRITE_GRIDS). One reading of what
  // sprites exist, and one way to build any of their grids, so the art can be
  // checked headlessly the same way the simulation is.
  spriteGrids: () => Object.entries(SPRITE_GRIDS).map(([name, s]) => ({
    name, w: s.sprite.w, h: s.sprite.h, kinds: [...s.kinds], frames: [...s.frames],
  })),
  spriteGrid(name, kind, frame) {
    const spec = SPRITE_GRIDS[name];
    if (!spec) throw new Error(`no sprite grid named "${name}"`);
    return spec.build(kind, frame);
  },
};

/**
 * Binds this module to a browser and starts the frame loop.
 *
 * Every DOM, storage and timer touch in this file happens here or downstream of
 * here. Nothing runs at import, so `import { devHooks } from './game.js'` works
 * under vitest with no document, which is what makes the simulation testable.
 */
export function boot() {
  // Listeners and the frame loop must not be registered twice; a second call
  // would double every keypress and run two loops.
  if (booted) return;
  booted = true;

  const query = new URLSearchParams(location.search);

  // The pace preset is already applied at import; this only layers the ?pace=
  // override on top, and applyPace is plain assignment so re-running is safe.
  applyPace(query.get('pace') ?? CONFIG.pace);

  canvas = document.getElementById('game');
  canvas.width = CONFIG.canvasW; canvas.height = CONFIG.canvasH;
  rawCtx = canvas.getContext('2d');
  ctx = rawCtx;

  tileLayer      = new StaticTileLayer(tileMap, tileLayout);
  tileOverlay    = new AnimatedTileOverlay(tileMap, tileLayout);
  vignetteCanvas = makeVignette(CONFIG.canvasW, CONFIG.canvasH, CONFIG.hudHeight);

  // ?perf=1 times the six sections; ?perf=ops also counts canvas calls and
  // fill area, which needs every call routed through a wrapper and is for
  // verifying a change rather than for playing. Off, a span is one comparison.
  const perf = query.get('perf');
  if (perf !== null) applyTraceLevel(perf === 'ops' ? 'ops' : 'time');

  // ?log=debug (or info/warn/error) for a human testing session; omitted,
  // the logger stays at its default 'warn' floor so real play pays for
  // nothing. The EventBus subscription that feeds gameplay events into the
  // log already happened at module scope, next to `events` itself — see
  // src/sim/log.ts for why that's reuse, not a second event system.
  const logLevel = query.get('log');
  if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
    log.setLevel(logLevel);
  }

  installInput();

  // Render-side reaction to a new map. Registered here, not at module scope,
  // because it touches the offscreen layers boot() just built.
  events.on(e => {
    switch (e.type) {
      case 'MAP_GENERATED':
        tileLayer.usePainters(TILE_THEMES[e.kind]);
        tileOverlay.setPalette(ANIMATED_THEMES[e.kind]);
        break;
    }
  });

  // Pure classes exposed for the test harness in tests.html.
  window.CrowArcherInternals = { TILE, TileMap, PathScheduler, FovMap };
  window.__game = devHooks;

  // Short console verbs, for looking at the bastion without playing to it.
  //
  // These exist because the useful sequence is three chained calls on
  // `__game`, and every browser now blocks pasting into the console until you
  // type "allow pasting" at it — so the long form has to be typed by hand,
  // which nobody should have to do to look at a map. Each of these is one
  // word and a number.
  //
  // Deliberately globals rather than more devHooks entries: a devHook is for a
  // test, which can afford to be explicit, and these are for a person at a
  // console who cannot.
  window.siege = (wave = 1) => {
    devHooks.setMode('siege');
    devHooks.go('playing');
    return devHooks.jumpToSiegeWave(wave);
  };
  window.hurt = (n = 1) => devHooks.hurtGuards(n);
  window.crack = (hp = 1) => devHooks.hurtTowers(hp);
  window.retinue = () => devHooks.guards().map(
    (b) => (RANK_MARK[b.guard.rank] || '') + b.guard.kind + ' ' + b.guard.hp + '/' + b.guard.maxHp,
  );
  // The two chooser screens, staged in one word each. The shop [T] opens off
  // the pause menu and the upgrade screen sells talents now, so neither screen
  // is unreachable any more. Both still sit at the end of a grind: the draft
  // deals only from talents already owned, and the rite wants rank III on top
  // of that. One word each is the short way in.
  window.draft = (char = selectedChar) => {
    devHooks.pick(char);
    for (const t of CHAR_TREES[char].talents) TALENTS.grant(t.id, 1);
    transitionTo('playing');   // initGame queues the run's opening draft itself
    return chooser ? chooser.offers : `${char} owns no talents to draft`;
  };
  window.rite = (char = selectedChar) => {
    devHooks.pick(char);
    TALENTS.grantMastery(RANK_THRESHOLDS[CAPSTONE_RANK - 1]);
    transitionTo('playing');
    // The run just started, so an opening draft may be queued in front of the
    // rite; this verb is for looking at the rite, so it goes first.
    chooser = null; chooserQueue = []; riteOffered = false;
    queueRite('playing');
    openNextChooser();
    return chooser ? chooser.offers : `${char} has no capstones`;
  };
  // Printed once so the verbs are discoverable from the console itself rather
  // than only from a document the player would have to already be reading.
  log.info('boot', 'console: siege(n) hurt(n) crack(hp) retinue() draft(char) rite(char)');

  FEATHERS.init();
  TALENTS.init();
  requestAnimationFrame(loop);
}
