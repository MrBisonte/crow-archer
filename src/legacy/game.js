// Legacy monolith, being dismantled into sim/ and render/ modules.
// The synth comes first, so it shares scope with the sound arrays below.

import SimplexNoise from 'simplex-noise';
import { FOV, Path } from 'rot-js';

import { TILE, TileMap, tilePassable } from '../sim/tilemap';
import { mulberry32 } from '../sim/rng';
import { MAP_GEN, MAP_RULES } from '../sim/arena-map';
import { PathScheduler, FovMap } from '../sim/pathfinding';
import { LocalInput, Button, hasButton } from '../sim/input';
import { Team, canDamage } from '../sim/team';
import { EventBus } from '../sim/events';
import { ScreenShake } from '../render/shake';
import { StaticTileLayer, AnimatedTileOverlay, ANIMATED_THEMES, TILE_THEMES, makeVignette } from '../render/tiles';
import { glowDotStamp, glowRectStamp } from '../render/stamps';
import { spriteCanvas, spriteFlashCanvas } from '../render/pixel-sprite';
import {
  makePixelGrid, setPixel, pixelRect, pixelEllipse, pixelCurve, pixelOutline, pixelTriangleUp, animFrame3,
} from '../render/pixel-grid';
import {
  ARCHER_SPRITE, buildArcherGrid,
  WIZARD_SPRITE, buildWizardGrid,
  RANGER_SPRITE, buildRangerGrid,
  KNIGHT_SPRITE, buildKnightGrid,
} from '../render/character-grids';

// Single-player has no team concept, so each hero gets one fixed trim
// colour instead of the multiplayer per-team one. Archer's was already its
// tunic accent; the others are new, small, low-stakes additions in the same
// spirit (see buildWizardGrid/buildRangerGrid's hem/hood-brim trim).
const SP_TRIM = { archer: '#39FF14', wizard: '#FFB400', ranger: '#FFCC00', knightNormal: '#3A5CC8', knightFireSword: '#CC3300' };
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

const CONFIG = {
  tileSize: 32, cols: 33, rows: 21, hudHeight: 32,
  canvasW: 1056, canvasH: 704,

  playerSpeed: 200, playerRadius: 8,
  playerMaxHP: 10, playerHitFlashSecs: 0.3,
  killsToTriggerBoss: 10,

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
  // Faster than playerSpeed (200) on purpose. Slower and a rat can never land
  // the first bite on anyone walking away, which makes the whole pack décor.
  // The margin is small, so you outrun them briefly; once poisoned you are at
  // 100 and they are on you. The slow is the trap, the speed just sets it.
  ratSpeed: 215, ratContactDamage: 1, ratPackSize: 5, ratSpawnMinDistance: 200,
  // Seconds of quiet after a pack is wiped out, before the next one appears.
  // A pack at a time, not a trickle: a trickle you can never get ahead of, and
  // getting ahead is the only reason to fight rats at all.
  ratRespawnSecs: 6,
  // A bite is barely a hit; the poison is the point. 3 damage spread over 3
  // seconds at one point a second, plus a half-speed crawl for the same
  // window. Getting bitten once is survivable, getting swarmed is not, and
  // the slow is what turns a second bite into a third.
  ratPoisonSecs: 3, ratPoisonDamagePerTick: 1, ratPoisonTickSecs: 1, ratPoisonSlowMult: 0.5,
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

  arrowSpeed: 500, arrowLifetime: 1.5, maxArrowsInFlight: 3,

  // Crow density and the player's ability to answer it. Every value here is
  // set by the pace preset below, so edit PACE_PRESETS, not these.
  crowPassiveSpeed: 60, crowAggroSpeed: 200, crowAggroTimeout: 4,
  crowStartCount: 5, crowMax: 12, crowEscalationInterval: 12,
  whiteCrowPassiveSpeed: 120, whiteCrowAggroSpeed: 300,

  // Which preset to run. Override at runtime with ?pace=nightmare.
  pace: 'fast',

  maxPickupsOnMap: 3,
  waterShimmerMs: 800,

  bossHP: 5, bossHPWizard: 14, bossOrbitRadius: 180, bossOrbitSpeed: 80, bossOrbitDuration: 3,
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
  darkArcherHP: 6, darkArcherHPWizard: 16, darkArcherHPKnight: 14,
  darkArcherContactDamage: 1,     // weak up close — an archer that got caught
  darkArcherVolleyInterval: 2.2, darkArcherVolleyCount: 3,
  darkArcherVolleySpread: Math.PI / 14, darkArcherBoltSpeed: 380, darkArcherBoltDamage: 1,
  // Secondary, on its own cooldown alongside the volley: a lobbed bomb that
  // detonates in a radius, the same bow-and-dynamite split the real archer
  // carries.
  darkArcherBombInterval: 4.5, darkArcherBombFuse: 1.1, darkArcherBombSpeed: 220,
  darkArcherBombDamage: 2, darkArcherBombRadius: 55,
  darkArcherSkeletonInterval: 7,  // summons one ice skeleton on this cadence

  darkKnightHP: 8, darkKnightHPWizard: 20, darkKnightHPKnight: 18,
  darkKnightOrbitDuration: 1.2,   // short lead-in, spends most of its time charging
  darkKnightChargeSpeed: 460, darkKnightContactDamage: 3,
  // Secondary, on its own cooldown: a whirlwind halt between charges, the
  // same spear-and-whirlwind split the real knight carries.
  darkKnightWhirlwindInterval: 6, darkKnightWhirlwindDuration: 1.4,
  darkKnightWhirlwindTickRate: 0.25, darkKnightWhirlwindRadius: 70,
  darkKnightWhirlwindDamage: 1,
  darkKnightSkeletonInterval: 7,  // summons one fire skeleton on this cadence

  handicap: 0,          // 0-100: rubber-band difficulty assist

  dynamiteSpeed: 336, dynamiteLifetime: 1.5, dynamiteBlastRadius: 90, dynamiteBossDamage: 2,
  // 70% of dynamite's, same cut the crossbow bolt takes against the arrow. Blast
  // radius stays shared with dynamiteBlastRadius; only boss damage is softer.
  satchelBossDamage: 1,

  pitchforkRange: 52, pitchforkCooldown: 1.5, pitchforkBossDamage: 2, pitchforkSwingDuration: 0.38,

  fireArrowDuration: 3.0, fireArrowDamageInterval: 0.5, specialArrowPickupCount: 3,

  // Knight
  knightSpearRange: 80, knightSpearCooldown: 1.0,
  knightSpearBossDamage: 2, knightSpearSwingDuration: 0.35,
  knightWhirlwindDuration: 3, knightWhirlwindRadius: 72, knightWhirlwindCooldown: 6,
  knightWhirlwindTickRate: 0.22,  // damage/tile-break tick every N seconds during whirlwind
  knightFireSwordDuration: 8, knightFireSwordRangeMult: 2, knightFireSwordDamageMult: 2,
  knightJavelinsPerPickup: 3, knightJavelinSpeed: 580, knightJavelinPierce: 2,
  knightJavelinBossDamage: 1,
  bossHPKnight: 12,               // knight has high DPS so boss needs more HP
  // Block: a self-charging directional guard, no pickup needed. Reuses
  // playerShield/damagePlayer's existing absorb-one-hit handling wholesale;
  // this cooldown just decides how often it's re-granted while down.
  knightBlockCooldown: 10,
  // Charge: hold Shift to wind up (rooted, invulnerable), release to advance
  // swinging. Damage scales with hold time against the boss only; crows and
  // skeletons die outright in the arc, same as every other knight melee hit.
  knightChargeMaxHoldSecs: 3, knightChargeCooldown: 4,
  knightChargeDashDuration: 1.5, knightChargeDashSpeedMult: 0.5,
  knightChargeMinDamageMult: 1.3, knightChargeMaxDamageMult: 2,
  knightChargeBossDamage: 2, knightChargeRadius: 90,
  knightChargeArcRadians: Math.PI / 4,  // total sweep, so ±half that off aimAngle
  knightChargeTickRate: 0.2,

  // Wizard
  wizBoltCooldown: 2.0, wizBoltSpeed: 468, wizBoltLifetime: 3.5,
  wizBoltDamage: 1, wizFireBoltDamage: 3,
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
    dynamites: { max:  3, restore: 1, color: '#ff6600', dim: '#2d2d2d', icon: '■', spacing: 13 },
    satchels:  { max:  3, restore: 1, color: '#ffcc00', dim: '#2d2d2d', icon: '●', spacing: 13 }
  },

  audio: true,
  keys: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    shoot: ' ', pause: 'Escape',
    menuControls: 'c', back: 'b', restart: 'r', menu: 'm', snipe: 'Shift',
    // Striking a torch is a decision, so it gets a button. Keys, the chest and
    // the door do not: your inventory has already decided those, and a prompt
    // in front of a foregone conclusion is a button press, not a choice.
    use: 'e'
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
  CONFIG.resources.arrows.max     = preset.baseArrows;
  CONFIG.resources.arrows.restore = preset.arrowRestore;
  CONFIG.resources.dynamites.max = preset.baseDynamites;
  // The ranger's satchel count matches the archer's dynamite count — same
  // tool tier, nothing asked for a different number.
  CONFIG.resources.satchels.max  = preset.baseDynamites;
}

applyPace(new URLSearchParams(location.search).get('pace') ?? CONFIG.pace);

// ── MODULE-LEVEL CONSTANTS ────────────────────────────────────────────────────

// Keyed by bossStage (1 = crow king, 2 = dark archer, 3 = dark knight), not
// boss.kind — the entrance banner starts typing before spawnBoss() has run.
const BOSS_ENTRY_TEXT = {
  1: '⚠  THE CROWS SUMMONED THEIR KING  ⚠',
  2: '⚠  A DARK ARCHER STIRS IN THE DEPTHS  ⚠',
  3: '⚠  THE LAST DARK KNIGHT RISES  ⚠',
  // Stage 4 is not reachable from the brawl run yet: beating the dark knight
  // still goes to the win screen. It exists so the minotaur can be spawned
  // for testing without inventing a second boss-spawn path. Wiring level 3
  // into the progression is its own piece of work, see docs/level-3-maze.md.
  4: '⚠  SOMETHING IS ALREADY IN THE MAZE  ⚠',
};

// Above this capacity the HUD shows a count instead of one icon per unit.
// 12 icons at 13 px still fit beside the boss HP bar; more do not.
const HUD_ICON_LIMIT = 12;

// ── STATE ─────────────────────────────────────────────────────────────────────

// appState: menu | multiplayer | controls | playing | paused | boss_entrance | boss_fight | win | gameover
let appState = 'menu', controlsFrom = 'menu', pausedFrom = 'playing';

let gameMode = 'brawl'; // 'brawl' | 'waves'  — persists across restarts
let score = 0, wave = 1, gameTime = 0, escalationTimer = 0;
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
  { key: 'M', label: 'MULTIPLAYER', section: 'mode',
    sub: 'up to 4 players  ·  co-op or 2v2  ·  needs a server',
    run: () => transitionTo('multiplayer') },
  { key: 'C', label: 'CONTROLS', section: 'util',
    run: () => transitionTo('controls') },
];
let controlsSelection = 0, remapTarget = null;

/**
 * The character-select screen, in one place. drawCharSelect() renders these
 * panels in array order, and the charselect input handler in stepGame() reads
 * the same array for arrow-key cycling and the bracketed hotkey, so a new
 * character is one entry rather than two lists that have to independently
 * agree on the same three names.
 */
// Difficulty gradient for the char-select panels, one home for the
// label/color pair so all four panels agree on what "hard" looks like.
// Rendered at full brightness regardless of panel selection (unlike
// everything else in a dimmed panel) so all four are scannable at a glance.
const DIFFICULTY = {
  easy:      { label: 'EASY',       color: '#39FF14' },
  medium:    { label: 'MEDIUM',     color: '#CCAA00' },
  hard:      { label: 'HARD',       color: '#FF8C00' },
  extraHard: { label: 'EXTRA HARD', color: '#FF3B30' },
};
const CHAR_PANELS = [
  { char:'archer', key:'A', color:'#39FF14', bg:'rgba(57,255,20,0.08)',  dim:'#1a7a08',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
    difficulty: DIFFICULTY.medium,
    lines:['Longbow  ·  Quiver system','Up to 3 arrows in-flight',
           'Pickup: Fire / Ricochet arrows','Tool: Dynamite (charged throw)','Classic playstyle'] },
  { char:'wizard', key:'W', color:'#8888FF', bg:'rgba(100,80,255,0.10)', dim:'#1a1a6a',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
    difficulty: DIFFICULTY.extraHard,
    lines:['Homing magic bolts  2s CD','Fire Bolt pickup: 3 dmg homing',
           'Laser pickup: 3 dmg, pierces walls','Special: Lightning Storm AoE','Caster playstyle'] },
  { char:'knight', key:'K', color:'#C8C8E8', bg:'rgba(150,160,200,0.10)',dim:'#2a2a4a',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
    difficulty: DIFFICULTY.hard,
    lines:['Long spear  ·  melee range','Hold Shift: charge sweep (2× dmg)',
           'Pickups: Javelin  ·  Fire Sword','Tool: Whirlwind (breaks tiles)','Special: Block (1 hit, 10s)'] },
  { char:'ranger', key:'X', color:'#FFCC00', bg:'rgba(255,204,0,0.10)',  dim:'#7a5a00',  dimBg:'rgba(255,255,255,0.025)', newBadge:true,
    difficulty: DIFFICULTY.easy,
    lines:['Crossbow  ·  3-bolt burst','Independent bolts, 30% weaker',
           'Pickup: Fire / Ricochet bolts','Tool: Satchel (throw, arm)','Skirmisher playstyle'] },
];
let playerHP = CONFIG.playerMaxHP, playerHitFlash = 0;
let killCount = 0, dropStreak = 0, playerShield = false;
// Set by an ice skeleton's bolt landing. Counts down in updatePlayer, which
// returns before reading input while it is positive, so movement, aiming
// and every weapon lock out together for the duration.
let playerFrozenTimer = 0;
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
let sniperMode = false;

// Character selection — persists for the session, reset only on new run
let selectedChar = 'archer';   // 'archer' | 'wizard' | 'knight' | 'ranger'

// Wizard combat cooldowns
let wizBoltCD = 0;   // 3-second cooldown for magic bolts
let stormCD   = 0;   // 10-second cooldown for lightning storm
let _stormFlash = 0; // countdown for the brief blue screen-flash after storm

// Knight combat state
let knightSpearCD = 0, knightSpearSwing = 0, knightSpearBossHit = false, knightSpearPhase2Hit = false;
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

function resetInv() {
  for (const [k, r] of Object.entries(CONFIG.resources)) { inv[k] = r.max; iFlash[k] = 0; }
  inv.ricochetArrows = 0; inv.fireArrows = 0;
  inv.fireBolts = 0; inv.laserStreams = 0;
  inv.knightJavelins = 0; inv.knightFireSwordTimer = 0;
  charge.on = false;
}

function transitionTo(next) {
  if (next === 'controls') controlsFrom = appState;
  const prev = appState;
  appState = next;
  // The multiplayer screen owns a socket, so entering opens one and leaving
  // closes it. Handled here rather than at each call site, because every route
  // out of the screen (back, error, match start) must not leak the connection.
  if (next === 'multiplayer' && prev !== 'multiplayer') openMultiplayer();
  if (prev === 'multiplayer' && next !== 'multiplayer') closeMultiplayer();
  if (next === 'playing' && prev !== 'paused' && prev !== 'controls' && prev !== 'inventory') initGame();
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
let mapKind = 'forest';

/**
 * Generates the map, defaulting to 'forest', today's only map in real play,
 * so every existing call site is unaffected by a second one existing. `kind`
 * is only ever 'castle' from the dev harness right now — nothing in real
 * gameplay picks it yet, that is brawl mode's second stage.
 */
function generateMap(kind = 'forest') {
  mapKind = kind;
  mapSeed = (Math.random() * 2 ** 32) >>> 0;
  const rng = mulberry32(mapSeed);
  // SimplexNoise 2.4 takes a random fn, so terrain derives fully from the seed.
  const sn = new SimplexNoise(rng);
  // tileLayer/tileOverlay are built once at startup, so the theme has to be
  // set here too, not just the tiles. The theme goes on first, without a
  // repaint of its own, so the reset below is the single pass that paints
  // every tile: doing it the other way round repaints the whole map twice.
  tileLayer.usePainters(TILE_THEMES[kind]);
  tileOverlay.setPalette(ANIMATED_THEMES[kind]);
  // MAP_GEN holds a generator per kind, not a density: the maze is carved
  // rather than thresholded, so the noise source is offered and ignored by
  // the generators that do not want it. See docs/level-3-maze.md.
  tileMap.reset(MAP_GEN[kind].generate(CONFIG.rows, CONFIG.cols, rng,
    (x, y) => sn.noise2D(x, y)));
  // The objective belongs to the maze and to no other map, so it is built and
  // cleared here, with the grid it is placed on. Every consumer then has one
  // guard, `mazeRun`, instead of its own check on mapKind.
  mazeRun = kind === 'maze' ? newMazeRun() : null;
  // Crows belong to the map. Moving to one that has none has to take the last
  // map's birds with it, or they keep flying through the new map's walls and
  // keep counting toward a win condition this map does not use.
  if (!mapHasCrows()) crows = [];
  // Sight is about the grid too: memory of the last map is a lie about this one.
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

/** Does this map hide what the player cannot see? One home for that rule too. */
function fogOfWar() {
  return MAP_RULES[mapKind].fogOfWar;
}

/** Do crows live on this map? Same table, same reason: it is a per-map fact. */
function mapHasCrows() {
  return MAP_RULES[mapKind].crows;
}

function smashTile(row, col) {
  if (!terrainDestructible()) return;
  const t = tileMap.get(row, col);
  if (t === TILE.TREE) tileMap.set(row, col, TILE.ASH);
  else if (t === TILE.ROCK || t === TILE.HUT) tileMap.set(row, col, TILE.EMPTY);
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

// ── INPUT ─────────────────────────────────────────────────────────────────────

const keys  = {};
const mouse = { x: 400, y: 256 };
let shootPressed = false;

const canvas = document.getElementById('game');
canvas.width = CONFIG.canvasW; canvas.height = CONFIG.canvasH;
const ctx = canvas.getContext('2d');

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
let cursorHidden = false;
function syncCursor() {
  const hide = inGame();
  if (hide === cursorHidden) return;
  cursorHidden = hide;
  canvas.style.cursor = hide ? 'none' : 'crosshair';
}

/** How far the in-progress windup has filled, 0 to 1. Read by the release, the
 * windup visual and the bar, so it lives in one place. */
function knightChargeFrac() {
  if (!knightCharge.on) return 0;
  return Math.min(1, (performance.now() - knightCharge.t0) / 1000 / CONFIG.knightChargeMaxHoldSecs);
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

/** Windup and dash both tint yellow through orange to red as the charge builds. */
function knightChargeColor(frac) {
  return frac >= 0.85 ? '#FF3020' : frac > 0.5 ? '#FF8800' : '#FFCC00';
}

/** World-space angle mapped into the mirrored canvas a character is drawn in. */
function mirrorAngle(a, facing) {
  return Math.atan2(Math.sin(a), facing * Math.cos(a));
}

/** Is (x,y) inside the wedge the dash is currently sweeping? The spear's own
 * hit test fakes a cone with two circle probes; this is a real one. */
function inKnightArc(x, y) {
  if (dist2(player.x, player.y, x, y) > CONFIG.knightChargeRadius ** 2) return false;
  let d = Math.atan2(y - player.y, x - player.x) - knightDash.angle;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= CONFIG.knightChargeArcRadians / 2;
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
  } else {
    if (inv.dynamites > 0 && !charge.on && inGame()) { charge.on = true; charge.t0 = performance.now(); }
  }
}
function releaseCharge() {
  if (!charge.on) return;
  charge.on = false;
  if (inGame() && selectedChar === 'archer') throwDynamite(Math.min(1, (performance.now() - charge.t0) / 1000));
}

// Listens on the window, not the canvas, and clamps into it.
//
// On the canvas alone, aim silently froze the moment the pointer crossed the
// edge: the last event inside was the last aim update, so a shot fired while
// reaching for something off to the side went wherever the pointer had last
// been seen rather than where it was pointing. Clamping keeps the aim pinned
// to the nearest edge instead, which is what the player means when they push
// past the border, and costs nothing while the pointer is inside.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
window.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;   // canvas not laid out yet
  mouse.x = clamp((e.clientX - r.left) * (CONFIG.canvasW / r.width), 0, CONFIG.canvasW);
  mouse.y = clamp((e.clientY - r.top) * (CONFIG.canvasH / r.height), 0, CONFIG.canvasH);
});
let mouseRightHeld = false;
// Held, not just pressed: multiplayer samples the button once per frame rather
// than reacting to the event, the same way it reads the keyboard.
let mouseLeftHeld = false;
canvas.addEventListener('mousedown', e => {
  initAudio();
  if (e.button === 0) {
    mouseLeftHeld = true;
    if (inGame()) shootPressed = true;
    // The castle-intro black screen waits for exactly this: one click, no
    // key, since it is shown mid-run with the keyboard already busy with
    // movement held down.
    else if (appState === 'castle_intro') appState = 'playing';
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
  if (!keys[e.key] && e.key === CONFIG.keys.snipe) startKnightCharge();
  keys[e.key] = true;
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => {
  keys[e.key] = false;
  if (e.key === 'f' || e.key === 'F') releaseCharge();
  if (e.key === CONFIG.keys.snipe) releaseKnightCharge();
});

canvas.addEventListener('click', e => {
  initAudio();
  if (appState !== 'controls') return;
  const r  = canvas.getBoundingClientRect();
  const cy = (e.clientY - r.top) * (CONFIG.canvasH / r.height);
  CTRL_ACTIONS.forEach((action, i) => {
    const rowY = 160 + i * 46;
    if (cy >= rowY - 20 && cy < rowY + 26) { remapTarget = action.key; controlsSelection = i; }
  });
});

// ── ENTITIES ──────────────────────────────────────────────────────────────────

let player = {}, arrows = [], crows = [], pickups = [], particles = [], dynamites = [], satchels = [];
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
    aimAngle: Math.atan2((mouse.y - CONFIG.hudHeight) - player.y, mouse.x - player.x),
  };
});

// Sim emits gameplay events; the client turns them into particles and sound.
// The server will run the same sim and ignore these (or forward the
// network-relevant ones), so cosmetics never touch the simulation.
const events = new EventBus();

// Sound and shake per boss-hit source. The sim states what landed; the table
// decides how it sounds.
const BOSS_HIT_FX = {
  pitchfork: [6, 200], spear: [5, 200],
  arrow: null, javelin: null, whirlwind: null, storm: null, dynamite: null, satchel: null,
};
// Sound and shake per attack the player starts.
const WEAPON_FX = {
  arrow:     { sound: () => sndShoot,     shake: null },
  bolt:      { sound: () => sndWizBolt,   shake: null },
  crossbow:  { sound: () => sndCrossbow,  shake: null },
  pitchfork: { sound: () => sndPitchfork, shake: [3, 90] },
  spear:     { sound: () => sndPitchfork, shake: [2, 70] },
  javelin:   { sound: () => sndPitchfork, shake: [3, 80] },
};

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
    case 'CROW_KILLED':
      playSound(sndHitCrow);
      burst(e.x, e.y, {
        count: 14, colors: ['#0A0A0A','#1F1F1F','#3A3A3A','#FFB400'],
        speedMin: 40, speedMax: 120, decay: 1.8,
        shapeMix: [['circle', 0.8], ['spark', 0.2]],
        sizeMin: 1.5, sizeMax: 2.5, damping: 0.6, shadowBlur: 4, shadowColor: '#FFB400',
        forceColor: '#FFB400'
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
        sizeMin: 1.5, sizeMax: 2.5, damping: 0.6, shadowBlur: 4, shadowColor: skelGlow
      });
      break;
    }

    case 'FIRE_SKELETON_BLAST':
      playSound(sndExplosion); triggerShake(6, 250);
      burst(e.x, e.y, {
        count: 20, colors: ['#FFB400','#FF6020','#FFFFFF','#8A1010'],
        speedMin: 80, speedMax: 220, decay: 2.0,
        shape: 'circle', sizeMin: 2, sizeMax: 4, shadowBlur: 10, shadowColor: '#FF6020'
      });
      break;

    case 'ICE_BOLT_FIRED':
      playSound(sndWizBolt);
      break;

    case 'PLAYER_FROZEN':
      triggerShake(4, 200);
      burst(e.x, e.y, {
        count: 12, colors: ['#40D0F0','#A0E8FF','#FFFFFF'],
        speedMin: 30, speedMax: 90, decay: 2.2, shape: 'spark',
        shadowBlur: 8, shadowColor: '#40D0F0'
      });
      break;

    case 'MELEE_HIT':
      if (e.kind === 'pitchfork') {
        triggerShake(6, 200);
        burst(e.x, e.y, { count: 12, colors: ['#FFFFFF','#39FF14','#D9D9D9'],
          speedMin: 90, speedMax: 160, decay: 3.0, shape: 'spark',
          gravity: 60, damping: 0.8, shadowBlur: 6, shadowColor: '#39FF14' });
      } else {
        triggerShake(3, 120);
        burst(e.x, e.y, { count: 8, colors: ['#A0A0B0','#D0D0E0','#ffffff'],
          speedMin: 40, speedMax: 110, decay: 3.0, shape: 'spark',
          shadowBlur: e.fire ? 8 : 3,
          shadowColor: e.fire ? '#FF7A1F' : '#C0C0C0' });
      }
      break;

    case 'BOSS_HIT': {
      playSound(sndBossHit);
      const shake = BOSS_HIT_FX[e.source];
      if (shake) triggerShake(shake[0], shake[1]);
      break; }

    case 'ARROW_MISS':
      playSound(sndMiss); triggerShake(3, 200);
      break;

    case 'JAVELIN_BOUNCE':
      burst(e.x, e.y, { count: 6, colors: ['#C0C0C0','#ffffff'],
        speedMin: 30, speedMax: 80, decay: 3.5, shape: 'spark', shadowBlur: 3, shadowColor: '#C0C0C0' });
      break;

    case 'EXPLOSION':
      playSound(sndExplosion); triggerShake(10, 450);
      if (e.onWater) {
        burst(e.x, e.y, { count: 22, colors: ['#2A66B0','#5A92D8','#A0C8F0','#FFFFFF'],
          speedMin: 80, speedMax: 200, decay: 1.6,
          shapeMix: [['spark', 0.7], ['circle', 0.3]],
          sizeMin: 1.5, sizeMax: 3, gravity: 380, shadowColor: '#FFFFFF' });
      } else {
        burst(e.x, e.y, { count: 12, colors: ['#FFFFFF','#FFB400'],
          speedMin: 200, speedMax: 360, decay: 4.0,
          shape: 'circle', sizeMin: 2, sizeMax: 5, shadowBlur: 16, shadowColor: '#FFB400' });
        burst(e.x, e.y, { count: 36, colors: ['#FF7A1F','#FF1F1F','#FFB400','#8A1010'],
          speedMin: 120, speedMax: 260, decay: 1.2,
          shape: 'circle', sizeMin: 2.5, sizeMax: 5, damping: 0.5, shadowBlur: 10, shadowColor: '#FF7A1F' });
        burst(e.x, e.y, { count: 12, colors: ['#3A3A3A','#1A1A1A','#5C5C5C'],
          speedMin: 30, speedMax: 80, decay: 0.5,
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

    case 'WHIRLWIND_START':
      playSound(sndExplosion); triggerShake(4, 250);
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
      playSound(sndLightning); triggerShake(14, 600);
      burst(e.x, e.y, { count: 32, colors: ['#FFFFFF','#AAAAFF','#8888FF','#FFB400'],
        speedMin: 60, speedMax: 360, decay: 2.5, shape: 'spark',
        shadowBlur: 14, shadowColor: '#8888FF', gravity: -20 });
      for (let k = 0; k < 8; k++) {
        const ang = Math.random() * Math.PI * 2;
        const dst = 60 + Math.random() * CONFIG.stormBlastRadius * 0.85;
        burst(e.x + Math.cos(ang)*dst, e.y + Math.sin(ang)*dst, {
          count: 5, colors: ['#FFFFFF','#8888FF'],
          speedMin: 20, speedMax: 60, decay: 4.0, shape: 'spark',
          shadowBlur: 8, shadowColor: '#8888FF' });
      }
      break;

    case 'PLAYER_HIT':
      triggerShake(4, 200);
      break;

    case 'SHIELD_BLOCKED':
      triggerShake(3, 150);
      burst(e.x, e.y, { count: 10, colors: ['#FFB400','#FFFFFF','#FF7A1F'],
        speedMin: 60, speedMax: 200, decay: 2.5, shape: 'spark',
        shadowBlur: 10, shadowColor: '#FFB400' });
      break;

    case 'PICKUP_TAKEN':
      playSound(sndPickup);
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
      triggerShake(12, 600); playSound(sndGameover);
      break;

    case 'CROWS_AGGRO':
      playSound(sndAggro); triggerShake(6, 300);
      break;

    case 'BOSS_CONTACT':
      triggerShake(6, 250);
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
      playSound(sndBossDeath); triggerShake(14, 500);
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
  generateMap();
  score = 0; wave = 1; gameTime = 0; escalationTimer = 0; pfCooldown = 0; pfSwing = 0; pfBossHit = false; pfHitFlash = false; waveAnnounce = 0;
  knightSpearCD = 0; knightSpearSwing = 0; knightSpearBossHit = false; knightSpearPhase2Hit = false;
  knightWhirlwindCD = 0; knightWhirlwindTimer = 0; knightWhirlwindTick = 0;
  knightBlockCD = 0;
  knightCharge.on = false; knightDash.timer = 0; knightDash.bossHit = false;
  knightChargeTick = 0; knightChargeCD = 0;
  shootPressed = false;
  arrows = []; pickups = []; particles = []; dynamites = []; satchels = []; fires = []; floaters = [];
  playerHP = FEATHERS.maxHP(); playerHitFlash = 0; killCount = 0; skeletonKillCount = 0; dropStreak = 0; playerShield = false;
  wizBoltCD = 0; stormCD = 0; _stormFlash = 0;
  boss = null; bossDeathSeq = null; entrance = null; bossStage = 1; hostileBolts = [];
  castleWave = 0; playerFrozenTimer = 0; playerPoison = { timer: 0, tickIn: 0 };
  resetSight(); // force an FOV recompute, and forget the last run's map
  FEATHERS.applyToGame();
  resetInv();
  FORESHADOW.reset(); STREAK.reset(); BOUNTIES.reset();
  const spawn = spawnPoint();
  player = { x: spawn.x, y: spawn.y, facing: 1, aimAngle: 0, walkPhase: 0, team: Team.A };
  crows = [];
  skeletons = []; // only populated once brawl mode reaches its castle stage
  if (mapHasCrows()) for (let i = 0; i < CONFIG.crowStartCount; i++) spawnCrow();
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
  if (gameMode !== 'waves') return 1;
  return Math.min(10, Math.pow(1.1, wave - 1));
}

/**
 * How much faster an aggro'd crow should close in right now. Same idea as
 * waveCrowHpMult, on a slower every-3-waves cadence, and capped far lower
 * (2x, around wave 22): HP just costs more hits, but a crow fast enough
 * would stop being dodgeable at all, which is a different kind of hard.
 */
function waveCrowAggroMult() {
  if (gameMode !== 'waves') return 1;
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
    white: false, frozen: false,
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

function burst(wx, wy, opts) {
  const {
    count = 8, colors = ['#ffffff'],
    speedMin = 40, speedMax = 100,
    decay = 2, gravity = 0, damping = 0,
    sizeMin = 1.5, sizeMax = 2.5,
    shadowBlur = 0, shadowColor = '#ffffff',
    shrink = false, shapeMix = null, shape = 'circle',
    forceColor = null
  } = opts;
  while (particles.length >= 120) particles.shift();
  for (let i = 0; i < count; i++) {
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
      r, gravity, damping, shadowBlur, shadowColor, shrink
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
  if (playerFrozenTimer > 0) { playerFrozenTimer = Math.max(0, playerFrozenTimer - dt); return; }

  const cmd = playerInput.sample();
  // The knight spends this button on his charge instead: he has no aim line
  // to sharpen, so sniper mode was a pure downside for him.
  sniperMode = selectedChar !== 'knight' && hasButton(cmd, Button.SNIPE);

  // Charging roots him in place the same way sniper mode roots everyone else.
  if (!sniperMode && !knightCharge.on) {
    let vx = 0, vy = 0;
    if (knightDash.timer > 0) {
      // The dash drives movement instead of the keys, but shares the collision
      // resolution below so it stops on walls like any other movement.
      const spd = FEATHERS.speed() * CONFIG.knightChargeDashSpeedMult * dt;
      vx = Math.cos(knightDash.angle) * spd;
      vy = Math.sin(knightDash.angle) * spd;
      player.walkPhase += 8 * dt;
    } else {
      if (hasButton(cmd, Button.UP))    vy -= 1;
      if (hasButton(cmd, Button.DOWN))  vy += 1;
      if (hasButton(cmd, Button.LEFT))  vx -= 1;
      if (hasButton(cmd, Button.RIGHT)) vx += 1;
      const len = Math.hypot(vx, vy);
      if (len > 0) { const sp = FEATHERS.speed() * poisonSpeedMult(); vx = (vx/len)*sp*dt; vy = (vy/len)*sp*dt; player.walkPhase += 8 * dt; }
    }
    const r = CONFIG.playerRadius;
    // Clamp bounds keep the player's collision corners (±r) inside the first passable
    // row/col (index 1) so they never straddle the solid border tiles and get stuck.
    const ts = CONFIG.tileSize;
    const minX = ts + r, maxX = CONFIG.canvasW - r;
    const minY = ts + r, maxY = (CONFIG.rows - 1) * ts - r;
    const nx = player.x + vx;
    if (tilePassable(tileAt(nx-r, player.y-r)) && tilePassable(tileAt(nx+r, player.y-r)) &&
        tilePassable(tileAt(nx-r, player.y+r)) && tilePassable(tileAt(nx+r, player.y+r)))
      player.x = Math.max(minX, Math.min(maxX, nx));
    const ny = player.y + vy;
    if (tilePassable(tileAt(player.x-r, ny-r)) && tilePassable(tileAt(player.x+r, ny-r)) &&
        tilePassable(tileAt(player.x-r, ny+r)) && tilePassable(tileAt(player.x+r, ny+r)))
      player.y = Math.max(minY, Math.min(maxY, ny));
  }

  // Mid-dash the aim is locked to the committed direction, so the arc can't be
  // swivelled around with the mouse after release.
  player.aimAngle = knightDash.timer > 0 ? knightDash.angle : cmd.aimAngle;
  player.facing   = Math.cos(player.aimAngle) >= 0 ? 1 : -1;

  for (const k in iFlash) if (iFlash[k] > 0) iFlash[k] = Math.max(0, iFlash[k] - dt);
  if (playerHitFlash > 0) playerHitFlash = Math.max(0, playerHitFlash - dt);
  if (pfCooldown          > 0) pfCooldown         = Math.max(0, pfCooldown         - dt);
  if (wizBoltCD           > 0) wizBoltCD          = Math.max(0, wizBoltCD          - dt);
  if (stormCD             > 0) stormCD            = Math.max(0, stormCD            - dt);
  if (_stormFlash         > 0) _stormFlash        = Math.max(0, _stormFlash        - dt);
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
    if (knightBlockCD <= 0) { playerShield = true; knightBlockCD = CONFIG.knightBlockCooldown; }
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
            events.emit({ type: 'MELEE_HIT', x: tipX, y: tipY, kind: 'pitchfork', fire: false });
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
            events.emit({ type: 'MELEE_HIT', x: tipX, y: tipY, kind: 'pitchfork', fire: false });
          }
        }
      }
      if (!pfBossHit && bossInPlay() && !boss.shield &&
          dist2(player.x, player.y, boss.x, boss.y) < r2) {
        pfBossHit = true;
        damageBoss(CONFIG.pitchforkBossDamage, player.x, player.y, 'pitchfork', 0.25);
      }
    }
  }

  // ── Knight spear swing hit-detection ────────────────────────────────────
  // Double-strike spear swing: two quick hits, one in each half of the animation.
  // Check both the tip and a mid-point so a crow can't slip through the shaft.
  if (selectedChar === 'knight' && knightSpearSwing > 0) {
    knightSpearSwing = Math.max(0, knightSpearSwing - dt);
    const fsActive   = inv.knightFireSwordTimer > 0;
    const baseRange  = CONFIG.knightSpearRange * (fsActive ? CONFIG.knightFireSwordRangeMult : 1);
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
        events.emit({ type: 'MELEE_HIT', x: c.x, y: c.y, kind: 'spear', fire: fsActive });
      }
    }
    for (let j = skeletons.length - 1; j >= 0; j--) {
      const s = skeletons[j];
      if (dist2(tipX, tipY, s.x, s.y) < hitR2 || dist2(midX, midY, s.x, s.y) < hitR2) {
        if (fsActive) spawnFire(s.x, s.y);
        damageSkeleton(j);
        events.emit({ type: 'MELEE_HIT', x: s.x, y: s.y, kind: 'spear', fire: fsActive });
      }
    }
    // Boss: hit once in first half (phase 1), reset and hit again in second half (phase 2)
    const canHitBoss = bossInPlay() && !boss.shield &&
        (dist2(tipX, tipY, boss.x, boss.y) < CONFIG.bossHitRadius ** 2 ||
         dist2(midX, midY, boss.x, boss.y) < CONFIG.bossHitRadius ** 2);

    if (phase2 && knightSpearPhase2Hit === false && canHitBoss) {
      knightSpearPhase2Hit = true;
      const dmg = CONFIG.knightSpearBossDamage * (fsActive ? CONFIG.knightFireSwordDamageMult : 1);
      damageBoss(dmg, player.x, player.y, 'spear', 0.15);
    } else if (!phase2 && !knightSpearBossHit && canHitBoss) {
      knightSpearBossHit = true;
      const dmg = CONFIG.knightSpearBossDamage * (fsActive ? CONFIG.knightFireSwordDamageMult : 1);
      damageBoss(dmg, player.x, player.y, 'spear', 0.2);
    }
  }

  // ── Knight whirlwind continuous tick ─────────────────────────────────────
  if (selectedChar === 'knight' && knightWhirlwindTimer > 0) {
    knightWhirlwindTimer -= dt;
    knightWhirlwindTick  -= dt;
    if (knightWhirlwindTick <= 0) {
      knightWhirlwindTick = CONFIG.knightWhirlwindTickRate;
      const wr = CONFIG.knightWhirlwindRadius, wr2 = wr * wr;
      // Damage crows
      for (let j = crows.length - 1; j >= 0; j--)
        if (dist2(player.x, player.y, crows[j].x, crows[j].y) < wr2) damageCrow(j);
      for (let j = skeletons.length - 1; j >= 0; j--)
        if (dist2(player.x, player.y, skeletons[j].x, skeletons[j].y) < wr2) damageSkeleton(j);
      // Damage boss
      if (bossInPlay() && !boss.shield &&
          dist2(player.x, player.y, boss.x, boss.y) < wr2) {
        damageBoss(1, player.x, player.y, 'whirlwind', 0.1);
      }
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
      for (const [list, damage] of [[crows, damageCrow], [skeletons, damageSkeleton]])
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
  const hasArrows = inv.arrows > 0 || inv.ricochetArrows > 0 || inv.fireArrows > 0;
  if (!hasArrows) { tryPitchfork(); return; }
  if (arrows.length >= CONFIG.maxArrowsInFlight) return;
  let type = 'normal';
  if      (inv.fireArrows     > 0) { inv.fireArrows--;     type = 'fire';     }
  else if (inv.ricochetArrows > 0) { inv.ricochetArrows--; type = 'ricochet'; }
  else                             { inv.arrows--;                             }
  arrows.push({ x: player.x, y: player.y,
    vx: Math.cos(player.aimAngle) * CONFIG.arrowSpeed,
    vy: Math.sin(player.aimAngle) * CONFIG.arrowSpeed,
    life: CONFIG.arrowLifetime, type, bounces: 0,
    initSpeed: CONFIG.arrowSpeed,
    trailHistory: [], fireSeed: Math.random() * Math.PI * 2, trailTimer: 0 });
  events.emit({ type: 'WEAPON_FIRED', kind: 'arrow' });
}

/**
 * The ranger's crossbow. Same ammo pool, deduction and pickup effects as the
 * archer's bow — one press spends exactly one unit of ammo, whichever type is
 * queued first — but that one press fires three independent, weaker, smaller
 * bolts in a narrow spread instead of one full-strength arrow.
 */
function tryCrossbowBolt() {
  const hasArrows = inv.arrows > 0 || inv.ricochetArrows > 0 || inv.fireArrows > 0;
  if (!hasArrows) { tryPitchfork(); return; }
  // Reserve room for the whole burst up front — a partial push would let
  // arrows.length overshoot maxArrowsInFlight and stall the next press.
  if (arrows.length + CONFIG.crossbowBoltCount > CONFIG.maxArrowsInFlight) return;
  let type = 'normal';
  if      (inv.fireArrows     > 0) { inv.fireArrows--;     type = 'fire';     }
  else if (inv.ricochetArrows > 0) { inv.ricochetArrows--; type = 'ricochet'; }
  else                             { inv.arrows--;                             }
  const half = (CONFIG.crossbowBoltCount - 1) / 2;
  for (let i = 0; i < CONFIG.crossbowBoltCount; i++) {
    const boltAngle = player.aimAngle + (i - half) * CONFIG.crossbowSpreadRadians;
    arrows.push({ x: player.x, y: player.y,
      vx: Math.cos(boltAngle) * CONFIG.arrowSpeed,
      vy: Math.sin(boltAngle) * CONFIG.arrowSpeed,
      life: CONFIG.arrowLifetime, type, bounces: 0,
      initSpeed: CONFIG.arrowSpeed,
      trailHistory: [], fireSeed: Math.random() * Math.PI * 2, trailTimer: 0,
      bolt: true,
      hitRadius: CONFIG.arrowHitRadius * CONFIG.crossbowBoltRadiusMult,
      dmgMult: CONFIG.crossbowBoltDamageMult });
  }
  events.emit({ type: 'WEAPON_FIRED', kind: 'crossbow' });
}

function tryWizardBolt() {
  if (wizBoltCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  if (arrows.length >= CONFIG.maxArrowsInFlight) return;
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

function tryPitchfork() {
  if (pfCooldown > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  pfCooldown = CONFIG.pitchforkCooldown;
  pfSwing    = CONFIG.pitchforkSwingDuration;
  pfBossHit  = false;
  pfHitFlash = false;
  events.emit({ type: 'WEAPON_FIRED', kind: 'pitchfork' });
}

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
  knightSpearCD       = CONFIG.knightSpearCooldown;
  knightSpearSwing    = CONFIG.knightSpearSwingDuration;
  knightSpearBossHit  = false;
  events.emit({ type: 'WEAPON_FIRED', kind: 'spear' });
}

function startWhirlwind() {
  knightWhirlwindCD    = CONFIG.knightWhirlwindCooldown;
  knightWhirlwindTimer = CONFIG.knightWhirlwindDuration;
  knightWhirlwindTick  = 0;
  events.emit({ type: 'WHIRLWIND_START', x: player.x, y: player.y });
}


function throwDynamite(chargeFrac) {
  if (inv.dynamites <= 0) return;
  inv.dynamites--;
  const spd = CONFIG.dynamiteSpeed * (1 + chargeFrac * 2);
  dynamites.push({
    x: player.x, y: player.y,
    vx: Math.cos(player.aimAngle) * spd,
    vy: Math.sin(player.aimAngle) * spd,
    life: CONFIG.dynamiteLifetime, fuseTotal: CONFIG.dynamiteLifetime,
    angle: player.aimAngle, bobPhase: Math.random() * Math.PI * 2
  });
}

function fireLightningStorm() {
  const STORM_R = CONFIG.stormBlastRadius;
  stormCD = CONFIG.stormCooldown;
  _stormFlash = CONFIG.stormFlashDuration;
  events.emit({ type: 'STORM_CAST', x: player.x, y: player.y });
  // Damage enemies
  const r2 = STORM_R ** 2;
  for (let j = crows.length - 1; j >= 0; j--)
    if (dist2(player.x, player.y, crows[j].x, crows[j].y) < r2) damageCrow(j);
  for (let j = skeletons.length - 1; j >= 0; j--)
    if (dist2(player.x, player.y, skeletons[j].x, skeletons[j].y) < r2) damageSkeleton(j);
  if (bossInPlay() && !boss.shield &&
      dist2(player.x, player.y, boss.x, boss.y) < r2) {
    damageBoss(CONFIG.stormBossDamage, player.x, player.y, 'storm', CONFIG.stormFlashDuration);
  }
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
      // Homing: the boss during a boss fight, otherwise the nearest crow. A
      // boss fight is what the player is there for — a leftover passive crow
      // stealing the bolt mid-fight is a bug, not a targeting choice, so the
      // boss is checked first rather than only as a fallback when no crow
      // exists at all.
      if (a.homing) {
        let tgt = null;
        if (bossInPlay()) {
          tgt = boss;
        } else {
          let tDist2 = Infinity;
          for (const c of crows) { const d = dist2(a.x,a.y,c.x,c.y); if (d<tDist2){tDist2=d;tgt=c;} }
        }
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
          damageCrow(j);
          arrows.splice(i,1);
          wizHitCrow = true;
          break;
        }
      }
      if (wizHitCrow) continue;
      let wizHitSkeleton = false;
      for (let j = skeletons.length-1; j >= 0; j--) {
        if (dist2(a.x,a.y,skeletons[j].x,skeletons[j].y) < CONFIG.arrowHitRadius*CONFIG.arrowHitRadius) {
          damageSkeleton(j);
          arrows.splice(i,1);
          wizHitSkeleton = true;
          break;
        }
      }
      if (wizHitSkeleton) continue;
      continue; // done with wizard bolt — skip archer logic below
    }

    // Fire trail — 1 particle every 0.03s, rises like heat
    if (a.type === 'fire') {
      a.trailTimer -= dt;
      if (a.trailTimer <= 0) {
        a.trailTimer += 0.03;
        const rng = Math.random();
        const fc = rng < 0.6 ? '#FF7A1F' : rng < 0.9 ? '#FFB400' : '#FFFFFF';
        particles.push({
          x: a.x, y: a.y, vx: (Math.random()-.5)*20, vy: (Math.random()-.5)*20,
          color: fc, alpha: 1, decay: 3.0, shape: 'circle',
          r: 1.5 + Math.random(), gravity: -40, damping: 0, shadowBlur: 8, shadowColor: fc, shrink: false
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
      if (!removed && (a.bounces > 9 || a.x < 0 || a.x >= CONFIG.canvasW || a.y < 0 || a.y >= CONFIG.rows * CONFIG.tileSize))
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
    for (let j = crows.length - 1; j >= 0; j--) {
      if (dist2(a.x, a.y, crows[j].x, crows[j].y) < hitR*hitR) {
        damageCrow(j); if (a.type === 'fire') spawnFire(a.x, a.y);
        arrows.splice(i, 1); hit = true; break;
      }
    }
    if (hit) continue;
    for (let j = skeletons.length - 1; j >= 0; j--) {
      if (dist2(a.x, a.y, skeletons[j].x, skeletons[j].y) < hitR*hitR) {
        damageSkeleton(j); if (a.type === 'fire') spawnFire(a.x, a.y);
        arrows.splice(i, 1); hit = true; break;
      }
    }
    if (hit) continue;
  }
}

function spawnFire(x, y) {
  fires.push({ x, y, life: CONFIG.fireArrowDuration, phase: Math.random()*Math.PI*2, damageTimer: 0 });
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
      particles.push({
        x: f.x + ox, y: f.y + oy,
        vx: Math.cos(ea)*spd, vy: Math.sin(ea)*spd,
        color: ec, alpha: 1, decay: 1.5, shape: 'spark',
        r: 1.5, gravity: -80, damping: 0, shadowBlur: 6, shadowColor: ec, shrink: false
      });
    }
    f.damageTimer -= dt;
    if (f.damageTimer <= 0) {
      f.damageTimer = CONFIG.fireArrowDamageInterval;
      for (let j = crows.length - 1; j >= 0; j--)
        if (dist2(f.x, f.y, crows[j].x, crows[j].y) < CONFIG.firePatchRadius*CONFIG.firePatchRadius) damageCrow(j);
      for (let j = skeletons.length - 1; j >= 0; j--)
        if (dist2(f.x, f.y, skeletons[j].x, skeletons[j].y) < CONFIG.firePatchRadius*CONFIG.firePatchRadius) damageSkeleton(j);
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
function damageCrow(j, amount = 1) {
  const c = crows[j];
  if (!c) return;
  c.hp -= amount;
  if (c.hp > 0) { c.hitFlash = 0.15; return; }
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
  if (gameMode === 'brawl' && killCount >= CONFIG.killsToTriggerBoss && appState === 'playing') transitionTo('boss_entrance');
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
    hp: 1, maxHp: 1, hitFlash: 0,
    walkPhase: Math.random() * Math.PI * 2,
    path: null, pathTimer: 0,
    // Staggered so a whole wave of ice skeletons does not fire in sync.
    shotCD: kind === 'ice' ? CONFIG.iceSkeletonShotInterval * Math.random() : 0,
  });
}

function damageSkeleton(j, amount = 1) {
  const s = skeletons[j];
  if (!s) return;
  s.hp -= amount;
  if (s.hp > 0) { s.hitFlash = 0.15; return; }
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
  if (gameMode === 'brawl' && appState === 'playing' && castleWave > 0 && skeletons.length === 0) {
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
    const dx = player.x - s.x, dy = player.y - s.y, dist = Math.hypot(dx, dy);
    const reach = s.kind === 'rat' ? 11 : 14;
    if (dist < reach) {
      damagePlayer(s.kind === 'rat' ? CONFIG.ratContactDamage : CONFIG.skeletonContactDamage);
      if (s.kind === 'rat') poisonPlayer();
      continue;
    }
    if (chaseAlongPath(s, SKELETON_SPEED[s.kind](), dt)) s.walkPhase += dt * 8;

    if (s.kind === 'ice') {
      s.shotCD -= dt;
      if (s.shotCD <= 0) { s.shotCD = CONFIG.iceSkeletonShotInterval; fireIceBolt(s); }
    }
  }
}

// ── DYNAMITES ─────────────────────────────────────────────────────────────────

function updateDynamites(dt) {
  for (let i = dynamites.length - 1; i >= 0; i--) {
    const d = dynamites[i];
    d.life -= dt; d.angle += dt * 5;

    if (d.life <= 0) { explodeExplosive(d, 'dynamite'); dynamites.splice(i, 1); continue; }

    let splashed = false;
    const nx = d.x + d.vx * dt;
    const tx = tileAt(nx, d.y);
    if      (tx === TILE.WATER)              splashed = true;
    else if (tx === TILE.ROCK || tx === TILE.TREE || tx === TILE.HUT) d.vx *= -0.65;
    else d.x = Math.max(0, Math.min(CONFIG.canvasW - 1, nx));

    if (!splashed) {
      const ny = d.y + d.vy * dt;
      const ty = tileAt(d.x, ny);
      if      (ty === TILE.WATER)              splashed = true;
      else if (ty === TILE.ROCK || ty === TILE.TREE || ty === TILE.HUT) d.vy *= -0.65;
      else d.y = Math.max(0, Math.min(CONFIG.rows * CONFIG.tileSize - 1, ny));
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
 * One explosive going off — dynamite's timer running out, or a satchel's
 * timer or the ranger's own bolt. Blast radius is dynamite's own CONFIG
 * figure for both, one copy rather than two numbers that could quietly drift
 * apart. Boss damage is not: the satchel hits for less, `source` picks which
 * CONFIG figure applies and is also carried through to `damageBoss` to tag
 * which weapon the hit event names.
 */
function explodeExplosive(d, source) {
  const onWater = tileAt(d.x, d.y) === TILE.WATER;
  // Sound, shake, and the blast burst run in the render/audio handler.
  events.emit({ type: 'EXPLOSION', x: d.x, y: d.y, onWater });
  const r2 = CONFIG.dynamiteBlastRadius ** 2;

  // Destroy ROCK and TREE tiles within blast radius
  const tileR = Math.ceil(CONFIG.dynamiteBlastRadius / CONFIG.tileSize);
  const tc = Math.floor(d.x / CONFIG.tileSize), tr = Math.floor(d.y / CONFIG.tileSize);
  for (let dr = -tileR; dr <= tileR; dr++) {
    for (let dc = -tileR; dc <= tileR; dc++) {
      const row = tr + dr, col = tc + dc;
      if (row < 0 || row >= CONFIG.rows || col < 0 || col >= CONFIG.cols) continue;
      const wx = (col + 0.5) * CONFIG.tileSize, wy = (row + 0.5) * CONFIG.tileSize;
      const t = tileMap.get(row, col);
      if (dist2(d.x, d.y, wx, wy) < r2 && (t === TILE.ROCK || t === TILE.TREE || t === TILE.HUT))
        if (terrainDestructible()) tileMap.set(row, col, TILE.EMPTY);
    }
  }

  for (let j = crows.length - 1; j >= 0; j--)
    if (dist2(d.x, d.y, crows[j].x, crows[j].y) < r2) damageCrow(j);
  for (let j = skeletons.length - 1; j >= 0; j--)
    if (dist2(d.x, d.y, skeletons[j].x, skeletons[j].y) < r2) damageSkeleton(j);
  if (bossInPlay() && !boss.shield &&
      dist2(d.x, d.y, boss.x, boss.y) < r2) {
    const bossDamage = source === 'satchel' ? CONFIG.satchelBossDamage : CONFIG.dynamiteBossDamage;
    damageBoss(bossDamage, d.x, d.y, source, 0.25);
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
    c.wingPhase += dt * (c.white ? 14 : 12);
    if (c.state === 'passive') {
      const spd = (c.white ? CONFIG.whiteCrowPassiveSpeed : CONFIG.crowPassiveSpeed) * HANDICAP.crowSpeedMod();
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
      const spd = (c.white ? CONFIG.whiteCrowAggroSpeed : CONFIG.crowAggroSpeed) * HANDICAP.crowSpeedMod() * waveCrowAggroMult();
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
      transitionTo('win');
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
  if (skeletons.length > 0) { mazeRun.ratTimer = CONFIG.ratRespawnSecs; return; }
  mazeRun.ratTimer -= dt;
  if (mazeRun.ratTimer > 0) return;
  mazeRun.ratTimer = CONFIG.ratRespawnSecs;
  for (let i = 0; i < CONFIG.ratPackSize; i++) spawnSkeleton('rat');
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
  if (Math.random() >= CONFIG.mazeSilverKeyDropChance) return;
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
    if (selectedChar === 'archer' || selectedChar === 'ranger') {
      for (const [k, r] of Object.entries(CONFIG.resources))
        if (inv[k] < r.max) inv[k] = Math.min(r.max, inv[k] + r.restore);
    }
    // Type-specific bonus — effect differs by character
    if (p.type === 'ricochet') {
      if      (selectedChar === 'wizard') inv.laserStreams  += CONFIG.wizSpecialBoltCount;
      else if (selectedChar === 'knight') inv.knightJavelins += CONFIG.knightJavelinsPerPickup;
      else                                inv.ricochetArrows += CONFIG.specialArrowPickupCount;
    } else if (p.type === 'fire') {
      if      (selectedChar === 'wizard') inv.fireBolts          += CONFIG.wizSpecialBoltCount;
      else if (selectedChar === 'knight') inv.knightFireSwordTimer += CONFIG.knightFireSwordDuration;
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
  // The castle stage's population is entirely wave-driven (startCastleWave),
  // not this timer — see killSkeleton. Only waveAnnounce still needs to
  // count down here so a castle-wave banner fades on schedule.
  if (mapKind === 'castle') return;
  // The maze's population is the rat pack and the warden. See MAP_RULES.crows.
  if (!mapHasCrows()) return;
  if (escalationTimer >= CONFIG.crowEscalationInterval) {
    escalationTimer -= CONFIG.crowEscalationInterval;
    wave++;
    if (gameMode === 'waves') { waveAnnounce = 2.2; waveAnnounceText = `── WAVE ${wave} ──`; }
    if (crows.length < CONFIG.crowMax) spawnCrow();
  }
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
  if (playerShield) {
    playerShield = false;
    playerHitFlash = CONFIG.playerHitFlashSecs;
    events.emit({ type: 'SHIELD_BLOCKED', x: player.x, y: player.y });
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
const BOSS_STAGES = ['crowking', 'dark_archer', 'dark_knight', 'minotaur'];

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
const BOSS_HUNTS_WHILE_EXPLORING = {
  crowking: false, dark_archer: false, dark_knight: false, minotaur: true,
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
  return appState === 'playing' && BOSS_HUNTS_WHILE_EXPLORING[boss.kind];
}

const BOSS_ON_HIT = {
  crowking:    (amount) => { dazeBoss(); applyBossDamage(amount); },
  dark_archer: (amount) => applyBossDamage(amount),
  dark_knight: (amount) => applyBossDamage(amount),
  // No HP to lower and no death path to reach. A hit buys time instead:
  // it stuns him, which interrupts a charge and lets you get down the corridor.
  minotaur:    ()       => stunMinotaur(),
};

// Which CONFIG keys hold a kind's HP for each character, so bossHpFor has one
// home instead of a third near-identical ternary chain pasted next to the
// two dark bosses already need.
const BOSS_HP_KEYS = {
  crowking:    ['bossHP', 'bossHPWizard', 'bossHPKnight'],
  dark_archer: ['darkArcherHP', 'darkArcherHPWizard', 'darkArcherHPKnight'],
  dark_knight: ['darkKnightHP', 'darkKnightHPWizard', 'darkKnightHPKnight'],
};

function bossHpFor(kind) {
  // The minotaur cannot be killed, so he has no HP row. Infinity rather than a
  // sentinel keeps every `hp -= x` and `hp <= 0` in the file honest without
  // any of them learning that an unkillable boss exists.
  if (kind === 'minotaur') return Infinity;
  const [normal, wizard, knight] = BOSS_HP_KEYS[kind];
  const key = selectedChar === 'wizard' ? wizard : selectedChar === 'knight' ? knight : normal;
  return CONFIG[key];
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
 * The one place boss HP is lowered, so the death trigger has a single home.
 * Burn damage takes this path directly: it has no impact point, so it gets no
 * flash, no shove, and no hit sound.
 */
function applyBossDamage(amount) {
  boss.hp -= amount;
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
function damageBoss(amount, fromX, fromY, source, flash = 0.15) {
  boss.hitFlash = flash;
  knockBoss(fromX, fromY);
  events.emit({ type: 'BOSS_HIT', source });
  BOSS_ON_HIT[boss.kind](amount);
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
  boss.cooldown = Math.max(boss.cooldown, CONFIG.minotaurChargeCooldown);
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
  boss.cooldown = CONFIG.minotaurChargeCooldown;
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
  events.emit({ type: 'EXPLOSION', x: b.x, y: b.y, onWater });
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
    if (deadKind === 'crowking') {
      // Stage 1 done. The run continues into the castle stage: reload the
      // map, reposition on the same corner initGame() always starts from
      // (the fresh random layout gives no guarantee the player's current
      // spot, wherever the crow king died, is still open ground), and seed
      // the first batch of skeletons.
      crows = [];
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
      // is already fully set up at this point; castle_intro just holds a
      // black screen in front of it until the player clicks, since cutting
      // straight from the death burst into the new map read as too fast.
      appState = 'castle_intro';
    } else if (deadKind === 'dark_archer') {
      // Both dark bosses share the castle stage, so no map reload here.
      skeletons = [];
      bossStage = 3;
      transitionTo('boss_entrance');
    } else {
      skeletons = [];
      transitionTo('win');
    }
  }
}

// ── AUDIO ─────────────────────────────────────────────────────────────────────
// All sounds defined as parameter arrays for the synth at the top of this file,
// which documents the layout and where it departs from upstream ZzFX.
// playSound() accepts either an array or a function (for multi-voice sounds).

function playSound(s) {
  if (!CONFIG.audio) return;
  try { typeof s === 'function' ? s() : zzfx(...s); } catch (_) {}
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
const sndTorchLight    = [.3,  .3,  420, 0, .06, .18, 4, 1, 90];        // bit noise, rising — a strike catching

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
    if (m.shake)   triggerShake(5, 350);
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
const FEATHERS = (() => {
  const LS_KEY  = 'crow_archer_v1';
  const UPGRADES = [
    {
      id: 'arrows',  label: 'QUIVER DEPTH',  desc: '+2 arrow capacity / level',
      costs: [5, 12, 25], maxLv: 3,
    },
    {
      id: 'hp',      label: 'VITALITY',      desc: '+1 max HP / level',
      costs: [8, 20, 40], maxLv: 3,
    },
    {
      id: 'pfRange', label: 'TINE REACH',    desc: '+8 px pitchfork range / level',
      costs: [6, 15, 30], maxLv: 3,
    },
    {
      id: 'speed',   label: 'SWIFTNESS',     desc: '+20 move speed / level',
      costs: [7, 18, 35], maxLv: 3,
    },
  ];
  const DEFAULTS = { arrows: 0, hp: 0, pfRange: 0, speed: 0 };

  let _feathers = 0;
  let _levels   = { ...DEFAULTS };
  let _cursor   = 0;

  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ feathers: _feathers, levels: _levels })); } catch (_) {}
  }

  function init() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const d   = raw ? JSON.parse(raw) : null;
      if (d) {
        _feathers = d.feathers || 0;
        _levels   = Object.assign({ ...DEFAULTS }, d.levels || {});
      }
    } catch (_) { /* ignore */ }
  }

  function onCrowKill(isWhite) {
    const base   = isWhite ? 2 : 1;
    const bonus  = Math.random() < 0.5 ? 1 : 0;
    const earned = base + bonus;
    _feathers += earned;
    _save();
    return earned;
  }

  function maxHP()   { return CONFIG.playerMaxHP  + (_levels.hp      || 0); }
  function pfRange() { return CONFIG.pitchforkRange + (_levels.pfRange || 0) * 8; }
  function speed()   { return CONFIG.playerSpeed    + (_levels.speed   || 0) * 20; }
  function wallet()  { return _feathers; }

  function applyToGame() {
    // Arrow capacity from upgrade level must be refreshed at game start.
    // The base comes from the pace preset, so upgrades stack on it.
    CONFIG.resources.arrows.max = CONFIG.baseArrows + (_levels.arrows || 0) * 2;
  }

  function moveCursor(dir) {
    _cursor = (_cursor + dir + UPGRADES.length) % UPGRADES.length;
  }

  function buyCurrent() {
    const u  = UPGRADES[_cursor];
    const lv = _levels[u.id] || 0;
    if (lv >= u.maxLv) return false;
    const cost = u.costs[lv];
    if (_feathers < cost) return false;
    _feathers -= cost;
    _levels[u.id] = lv + 1;
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

    // Upgrade rows
    UPGRADES.forEach((u, i) => {
      const lv    = _levels[u.id] || 0;
      const sel   = i === _cursor;
      const maxed = lv >= u.maxLv;
      const cost  = maxed ? null : u.costs[lv];
      const oy    = 170 + i * 96;
      const barX  = CONFIG.canvasW / 2 - 260;
      const barR  = CONFIG.canvasW / 2 + 260;

      if (sel) {
        ctx.fillStyle = 'rgba(57,255,20,0.08)';
        ctx.fillRect(CONFIG.canvasW / 2 - 280, oy - 32, 560, 76);
        ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 14;
      }

      // Label
      ctx.textAlign = 'left';
      ctx.fillStyle = sel ? '#39FF14' : '#1a7a08';
      ctx.font = '19px "Courier New", monospace';
      ctx.fillText(u.label, barX, oy - 12);

      // Level pips (right-aligned)
      ctx.textAlign = 'right';
      ctx.fillStyle = maxed ? '#FFB400' : (sel ? '#39FF14' : '#1a7a08');
      ctx.fillText('■'.repeat(lv) + '□'.repeat(u.maxLv - lv), barR, oy - 12);

      // Description
      ctx.textAlign = 'left';
      ctx.font = '12px "Courier New", monospace';
      ctx.fillStyle = '#0a5a08';
      ctx.fillText(u.desc, barX, oy + 12);

      // Cost / MAXED
      ctx.textAlign = 'right';
      if (maxed) {
        ctx.fillStyle = '#FFB400';
        ctx.fillText('◆ MAXED', barR, oy + 12);
      } else {
        ctx.fillStyle = _feathers >= cost ? '#FFB400' : '#5a3a00';
        ctx.fillText(`◆ ${cost}`, barR, oy + 12);
      }
      ctx.shadowBlur = 0;
    });

    ctx.textAlign = 'center'; ctx.font = '13px "Courier New", monospace'; ctx.fillStyle = '#0d4d04';
    ctx.fillText('↑ ↓  NAVIGATE    ENTER  PURCHASE    [B]  BACK', CONFIG.canvasW / 2, CONFIG.canvasH - 22);
  }

  return { init, onCrowKill, maxHP, pfRange, speed, wallet, applyToGame, moveCursor, buyCurrent, draw };
})();

// ── HANDICAP: configurable rubber-band difficulty (0 = off, 100 = full) ───────
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
const tileLayer   = new StaticTileLayer(tileMap, tileLayout);
const tileOverlay = new AnimatedTileOverlay(tileMap, tileLayout);
const vignetteCanvas = makeVignette(CONFIG.canvasW, CONFIG.canvasH, CONFIG.hudHeight);

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
  const flashOn = playerHitFlash > 0 && Math.floor(playerHitFlash*20)%2===0;

  // Ground shadow
  ctx.fillStyle='rgba(0,0,0,0.40)';
  ctx.beginPath(); ctx.ellipse(0,10,10,2.5,0,0,Math.PI*2); ctx.fill();

  // Pixel-art body (see buildWizardGrid). Staff and orb are baked into the
  // pose rather than rotated with aim, same reasoning as the archer's bow:
  // the purple aim line above already shows aim direction.
  const wgrid = buildWizardGrid(SP_TRIM.wizard);
  const wSpriteDx = -(WIZARD_SPRITE.w) / 2, wSpriteDy = -22;
  const wCanvas = flashOn
    ? spriteFlashCanvas('wizard', wgrid, WIZARD_SPRITE.w, WIZARD_SPRITE.h, '#ffffff')
    : spriteCanvas(`wizard|${SP_TRIM.wizard}`, wgrid, WIZARD_SPRITE.w, WIZARD_SPRITE.h);
  ctx.drawImage(wCanvas, wSpriteDx, wSpriteDy);

  // Orb glow pulse + bolt cooldown ring, at the orb's fixed position in the sprite
  const ox = 20 + wSpriteDx, oy = 16 + wSpriteDy;
  const op = loopT*4.5;
  ctx.shadowColor='#8888FF'; ctx.shadowBlur=8+3*Math.sin(op);
  ctx.fillStyle=`rgba(136,136,255,${(0.35+0.15*Math.sin(op)).toFixed(2)})`;
  ctx.beginPath(); ctx.arc(ox,oy,4+0.5*Math.sin(op),0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  if (wizBoltCD > 0) {
    const fill = 1 - wizBoltCD/3.0;
    ctx.save(); ctx.globalAlpha=0.65;
    ctx.strokeStyle='#8888FF'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(ox,oy,7,-Math.PI/2,-Math.PI/2+fill*Math.PI*2); ctx.stroke();
    ctx.restore();
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
    const frac = 1 - stormCD/10, bw=34, bh=4, bx=px-bw/2, by2=py-38;
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
  const grid = buildArcherGrid(SP_TRIM.archer);
  const spriteScale = 1;
  const spriteDx = -(ARCHER_SPRITE.w * spriteScale) / 2;
  const spriteDy = -22;
  const archerCanvas = flashOn
    ? spriteFlashCanvas('archer', grid, ARCHER_SPRITE.w, ARCHER_SPRITE.h, '#ffffff', spriteScale)
    : spriteCanvas(`archer|${SP_TRIM.archer}`, grid, ARCHER_SPRITE.w, ARCHER_SPRITE.h, spriteScale);
  ctx.drawImage(archerCanvas, spriteDx, spriteDy);

  // Shield halo
  if (playerShield) {
    const shP = loopT * 4;
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 14 + 5 * Math.sin(shP);
    ctx.strokeStyle = `rgba(255,180,0,${(0.6 + 0.3 * Math.sin(shP)).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -6, 19 + Math.sin(shP * 1.3), 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const hasArrows = inv.arrows > 0 || inv.ricochetArrows > 0 || inv.fireArrows > 0;
  if (!hasArrows) drawPitchfork(localAngle);
  ctx.restore();

  if (!hasArrows) drawPitchforkIndicators(px, py);

  // Dynamite charge bar
  if (charge.on) drawChargeBar(px, py, Math.min(1, (performance.now() - charge.t0) / 1000));
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
  const aimLen = sniperMode ? 220 : 80, aimAlpha = sniperMode ? 0.75 : 0.38;
  const aimRGB = sniperMode ? '255,255,60' : '170,255,68';
  ctx.save();
  ctx.setLineDash(sniperMode ? [5,3] : [3,4]); ctx.lineWidth = sniperMode ? 1.5 : 1;
  const lx1 = px + Math.cos(player.aimAngle)*aimLen, ly1 = py + Math.sin(player.aimAngle)*aimLen;
  const aimGrad = ctx.createLinearGradient(px, py, lx1, ly1);
  aimGrad.addColorStop(0, `rgba(${aimRGB},${aimAlpha})`);
  aimGrad.addColorStop(1, `rgba(${aimRGB},0)`);
  ctx.strokeStyle = aimGrad;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(lx1, ly1); ctx.stroke();
  ctx.setLineDash([]);
  if (sniperMode) {
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

  const hasArrows = inv.arrows > 0 || inv.ricochetArrows > 0 || inv.fireArrows > 0;
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

  // ── Charge windup: the arc he is about to sweep, filling as he holds ────
  if (knightCharge.on) {
    const cf   = knightChargeFrac();
    const full = cf >= 1;
    const ang  = mirrorAngle(player.aimAngle, f);
    const half = CONFIG.knightChargeArcRadians / 2;
    const col  = knightChargeColor(cf);
    const r    = CONFIG.knightChargeRadius * (0.35 + 0.5 * cf);
    ctx.save();
    ctx.strokeStyle = col; ctx.shadowColor = col;
    ctx.shadowBlur  = 6 + 14 * cf + (full ? 6 * Math.sin(loopT * 18) : 0);
    ctx.lineWidth   = 2 + 2 * cf;
    ctx.globalAlpha = 0.25 + 0.55 * cf;
    ctx.beginPath(); ctx.arc(0, 0, r, ang - half, ang + half); ctx.stroke();
    // Streaks converging on the blade: more of them, and livelier, near full.
    const streaks = 3 + Math.round(4 * cf);
    for (let i = 0; i < streaks; i++) {
      const a     = ang - half + ((i + 0.5) / streaks) * half * 2;
      const inner = r * (0.45 + 0.3 * Math.sin(loopT * (8 + 10 * cf) + i * 1.7));
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(ca * inner, sa * inner);
      ctx.lineTo(ca * r,     sa * r);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Dash sweep: the blade crossing the arc, left to right, while advancing
  if (knightDash.timer > 0) {
    const prog  = 1 - knightDash.timer / CONFIG.knightChargeDashDuration;
    const heavy = knightDash.frac;
    const ang   = mirrorAngle(knightDash.angle, f);
    const half  = CONFIG.knightChargeArcRadians / 2;
    const col   = knightChargeColor(heavy);
    const r     = CONFIG.knightChargeRadius * (0.7 + 0.3 * heavy);
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
  const kgrid = buildKnightGrid(kKind, kTrim);
  const kSpriteDx = -(KNIGHT_SPRITE.w) / 2, kSpriteDy = -22 + Math.round(bob);
  const kCanvas = spriteCanvas(`knight|${kKind}|${kTrim}`, kgrid, KNIGHT_SPRITE.w, KNIGHT_SPRITE.h);
  ctx.drawImage(kCanvas, kSpriteDx, kSpriteDy);

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
    const sLen = CONFIG.knightSpearRange * CONFIG.knightFireSwordRangeMult * 0.55;
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
    const sLen = CONFIG.knightSpearRange * 0.92;
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
    const fill = 1 - knightBlockCD / CONFIG.knightBlockCooldown;
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

    // 2. Body
    ctx.fillStyle = '#FF1F1F'; ctx.fillRect(-12, -4, 24, 8);
    // 3. Body shading — lower half darker (cylinder volume)
    ctx.fillStyle = '#8A1010'; ctx.fillRect(-12, 0, 24, 4);
    // 4. End caps
    ctx.fillStyle = '#5A0808';
    ctx.fillRect(-12, -4, 1, 8); ctx.fillRect(11, -4, 1, 8);
    // 5. Label rect
    ctx.fillStyle = '#F0F0F0'; ctx.fillRect(-7, -3, 14, 6);
    // 6. Label text "TNT"
    ctx.fillStyle = '#0A0A0A'; ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 0, 0.5);

    // 7. Wick — bezier from (11,-4) arcing to (17,-10)
    //    Unburnt section (gold)
    ctx.strokeStyle = '#A07828'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(11, -4);
    ctx.quadraticCurveTo(14, -7, 17, -10); ctx.stroke();
    // Charred section (grows from base toward tip)
    if (burntFrac > 0) {
      ctx.strokeStyle = '#3A2A1A'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(11, -4);
      ctx.quadraticCurveTo(11 + burntFrac*3, -4 - burntFrac*3,
                            11 + burntFrac*6, -4 - burntFrac*6); ctx.stroke();
    }

    // 8. Spark outer halo
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 6 + 4 * Math.sin(sparkPhase);
    ctx.fillStyle = `rgba(255,180,0,0.4)`;
    ctx.beginPath(); ctx.arc(17, -10, 3 + Math.sin(sparkPhase), 0, Math.PI*2); ctx.fill();
    // 8b. Spark core
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(17, -10, 1.5 + 0.5*Math.sin(sparkPhase), 0, Math.PI*2); ctx.fill();
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

/**
 * The ranger's satchels. A dull leather bag while thrown-but-unarmed — it can
 * sit for up to satchelIdleLife without going off, so nothing here should
 * read as urgent — and a glowing, counting-down bag once armed, matching how
 * drawDynamites shows its own fuse.
 */
function drawSatchels() {
  for (const s of satchels) {
    const dx = s.x, dy = s.y + CONFIG.hudHeight;
    const bobOff = 1.5 * Math.sin(loopT * 4 + (s.bobPhase || 0));
    ctx.save(); ctx.translate(dx, dy + bobOff);

    if (s.armed) {
      // Blast radius ring — dynamiteBlastRadius, the one shared figure every
      // explosive in the game uses.
      ctx.globalAlpha = 0.15; ctx.strokeStyle = '#FFCC00'; ctx.lineWidth = 1;
      ctx.setLineDash([4,4]); ctx.beginPath(); ctx.arc(0, 0, CONFIG.dynamiteBlastRadius, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    ctx.rotate(s.angle);

    // 1. Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 7, 10, 2.5, 0, 0, Math.PI*2); ctx.fill();

    // 2. Bag body
    ctx.fillStyle = s.armed ? '#B08020' : '#5A4A2A';
    ctx.beginPath();
    ctx.moveTo(-9, 2); ctx.quadraticCurveTo(-9, -6, 0, -6); ctx.quadraticCurveTo(9, -6, 9, 2);
    ctx.quadraticCurveTo(9, 6, 0, 7); ctx.quadraticCurveTo(-9, 6, -9, 2);
    ctx.closePath(); ctx.fill();

    // 3. Strap and buckle
    ctx.strokeStyle = '#3A2A10'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(6, -5); ctx.stroke();
    ctx.fillStyle = '#D0B060'; ctx.fillRect(-2, -6, 4, 3);

    if (s.armed) {
      // 4. Armed pulse
      const sparkPhase = loopT * 10;
      ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 6 + 4 * Math.sin(sparkPhase);
      ctx.fillStyle = 'rgba(255,180,0,0.5)';
      ctx.beginPath(); ctx.arc(0, -2, 2 + Math.sin(sparkPhase), 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.rotate(-s.angle);

    if (s.armed) {
      // 5. Countdown text, same tiered color/glow treatment as dynamite's
      const fuseT = s.life;
      let countCol = '#FFCC00', countBlur = 4;
      if      (fuseT <= 0.5) { countCol = '#FFFFFF'; countBlur = 16; }
      else if (fuseT <= 1.0) { countCol = '#FFB400'; countBlur = 4;  }
      ctx.shadowColor = countCol; ctx.shadowBlur = countBlur;
      ctx.fillStyle = countCol; ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(Math.max(1, Math.ceil(fuseT))), 0, -10);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}

const CROW_SPRITE = { w: 20, h: 16 };

// White is a persistent enemy kind (c.white), not just the entrance's
// blink-white telegraph — drawCrow below picks this palette for both.
const CROW_PALETTES = {
  normal: { body: '#141414', bodyHi: '#3A3A3A', edge: '#000000', beak: '#FFB400' },
  white:  { body: '#E4E4E4', bodyHi: '#FFFFFF', edge: '#A8A8A8', beak: '#FF1F1F' },
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
  if (frame === 'a')      pixelEllipse(g, 9, 11, 6, 2.2, C.bodyHi); // lowered, spread below
  else if (frame === 'b') pixelEllipse(g, 9, 3, 5, 2, C.bodyHi);    // raised, folded over the back
  else                    pixelEllipse(g, 8, 7.5, 6.5, 1.6, C.bodyHi); // level, spread to the sides

  // Tail, trailing right (crow flies left, tail streams behind)
  pixelEllipse(g, 15, 7, 3, 1.6, C.body);

  // Body, drawn over the wing root so the silhouette reads front-to-back
  pixelEllipse(g, 11, 7.5, 5, 3.3, C.body);

  // Beak, pointing left (crow flies left)
  pixelRect(g, 3, 7, 3, 1, C.beak);
  setPixel(g, 2, 7, C.beak);

  return pixelOutline(g, C.edge);
}

const _crowGrids = {};
function crowGrid(kind, frame) {
  const key = `${kind}|${frame}`;
  return _crowGrids[key] || (_crowGrids[key] = buildCrowGrid(kind, frame));
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
  const flashOn = c.hitFlash > 0 && Math.floor(c.hitFlash * 20) % 2 === 0;

  const kind  = isWhite ? 'white' : 'normal';
  const frame = animFrame3(c.wingPhase);
  const grid  = crowGrid(kind, frame);
  const eyeCol   = isWhite ? '#FF1F1F' : '#FFB400';
  const glintCol = isWhite ? '#FFFFFF' : '#FF1F1F';
  const shadowFill = isWhite ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
  const eyeBlur  = isWhite ? 4 + 2*Math.sin(loopT*4 + ep) : 3;

  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy);

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
  ctx.drawImage(cCanvas, cSpriteDx, cSpriteDy);

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
const SKELETON_PALETTES = {
  normal: { bone: '#D8D0C0', boneHi: '#F4F0E6', edge: '#8A8070', eye: '#B040E0', aura: null },
  fire:   { bone: '#D86A40', boneHi: '#F4A868', edge: '#7A2A10', eye: '#FF6020', aura: '#FF6020' },
  ice:    { bone: '#A8D8F0', boneHi: '#E4F6FF', edge: '#4878A0', eye: '#40D0F0', aura: '#40D0F0' },
  // Not bone at all, but it reads the same three slots so nothing downstream
  // needs to know a rat is not a skeleton.
  rat:    { bone: '#4A3E36', boneHi: '#6B5A4C', edge: '#2A221C', eye: '#FF4020', aura: null },
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
  pixelCurve(g, [0, 4 - swing], [3, 6], [5, 5], C.edge, 8);
  // Haunch and back
  pixelEllipse(g, 6, 6, 4, 2, C.bone);
  pixelEllipse(g, 6, 5, 3, 1, C.boneHi);
  // Head and snout
  pixelEllipse(g, 10, 6, 2, 2, C.bone);
  pixelRect(g, 12, 6, 2, 1, C.bone);
  // Ear
  pixelRect(g, 9, 3, 2, 2, C.edge);
  setPixel(g, 10, 4, C.bone);
  // Legs, alternating with the stride
  pixelRect(g, 4 + swing, 8, 1, 2, C.edge);
  pixelRect(g, 7 - swing, 8, 1, 2, C.edge);
  pixelRect(g, 10 + swing, 8, 1, 2, C.edge);
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

  // Legs
  pixelCurve(g, [5, 15], [5 + swing * 0.4, 18], [5 + swing, 22], C.bone, 10);
  pixelCurve(g, [6, 15], [6 + swing * 0.4, 18], [6 + swing, 22], C.bone, 10);
  pixelCurve(g, [8, 15], [8 - swing * 0.4, 18], [8 - swing, 22], C.bone, 10);
  pixelCurve(g, [9, 15], [9 - swing * 0.4, 18], [9 - swing, 22], C.bone, 10);

  // Arms
  pixelCurve(g, [3, 10], [3 - swing * 0.3, 13], [3 - swing * 0.6, 16], C.bone, 8);
  pixelCurve(g, [10, 10], [10 + swing * 0.3, 13], [10 + swing * 0.6, 16], C.bone, 8);

  // Ribcage
  pixelRect(g, 4, 9, 6, 8, C.bone);
  pixelRect(g, 4, 9, 6, 2, C.boneHi);
  for (let ry = 11; ry <= 15; ry += 2) pixelRect(g, 4, ry, 6, 1, C.edge);

  // Skull
  pixelEllipse(g, 7, 5, 4, 3.6, C.bone);
  pixelEllipse(g, 5.5, 3.5, 1.6, 1.2, C.boneHi);

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
  const flashOn = s.hitFlash > 0 && Math.floor(s.hitFlash * 20) % 2 === 0;
  const kind = s.kind || 'normal';
  const palette = SKELETON_PALETTES[kind] || SKELETON_PALETTES.normal;
  const look = SKELETON_LOOK[kind] || SKELETON_LOOK.normal;
  const eyeCol = palette.eye;
  const frame = animFrame3(s.walkPhase);
  const grid = skeletonGrid(kind, frame);

  ctx.save(); ctx.translate(cx, cy);

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
  ctx.drawImage(kCanvas, kSpriteDx, kSpriteDy);

  // 3. Eye sockets — stamped glow, same technique as the crow's eye
  const eyeStamp = glowDotStamp(eyeCol, 1, 3);
  for (const [ex, ey] of look.eyes) {
    ctx.drawImage(eyeStamp, kSpriteDx + ex - eyeStamp.width/2, kSpriteDy + ey - eyeStamp.height/2);
  }

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
  body: '#0A0A0A', bodyHi: '#2A0A0A',
  wing: '#5A0808', wingHi: '#8A1010',
  beak: '#3A0606', crown: '#0A0A0A', crownRim: '#5A0808',
  edge: '#000000',
};

/** frame 'a'/'b' are the two flap extremes, 'mid' the level pass between
 * them — see animFrame3. Same simplification as the regular crow: crown,
 * beak, and body stay put, only the wing mass moves. */
function buildCrowKingGrid(frame) {
  const C = CROW_KING_PALETTE;
  const g = makePixelGrid(CROW_KING_SPRITE.w, CROW_KING_SPRITE.h);

  if (frame === 'a')      pixelEllipse(g, 30, 35, 20, 6, C.wing);   // lowered, spread below
  else if (frame === 'b') pixelEllipse(g, 30, 11, 17, 6, C.wingHi); // raised, folded over the back
  else                    pixelEllipse(g, 28, 24, 22, 5, C.wing);   // level, spread to the sides

  // Crown — 5 spikes, tallest in the middle
  const spikeXs = [16, 24, 32, 40, 48], spikeHs = [5, 8, 11, 8, 5];
  for (let i = 0; i < 5; i++) pixelTriangleUp(g, spikeXs[i], 9, 4, spikeHs[i], C.crown);
  pixelRect(g, 12, 8, 40, 2, C.crownRim);

  // Body, drawn over the wing root and crown base
  pixelEllipse(g, 34, 24, 20, 13, C.body);
  pixelEllipse(g, 27, 18, 9, 5, C.bodyHi);

  // Beak, pointing left — a sideways taper, apex at the tip, so a column
  // loop rather than pixelTriangleUp's upward-apex shape.
  for (let i = 0; i < 6; i++) {
    const hw = Math.round((5 * i) / 5);
    pixelRect(g, 4 + i, 22 - hw, 1, hw * 2 + 1, C.beak);
  }

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
  cloak: '#241030', cloakHi: '#3A1A4A',
  body: '#382048', head: '#1A0E22', hood: '#150A1C',
  edge: '#0A0510',
};

/** No walk cycle, no wing-flap — like the heroes, one static frame plus a
 * live bob is enough. Bow/arm/bowstring stay live below, same reasoning as
 * the player Archer's own bow: real-time aim is gameplay information. */
function buildDarkArcherGrid() {
  const C = DARK_ARCHER_PALETTE;
  const g = makePixelGrid(DARK_ARCHER_SPRITE.w, DARK_ARCHER_SPRITE.h);

  // Cloak — widens from the shoulders down to the hem
  for (let y = 14; y <= 41; y++) {
    const halfW = Math.round(10 + 9 * ((y - 14) / 27));
    pixelRect(g, 20 - halfW, y, halfW * 2, 1, C.cloak);
  }
  pixelRect(g, 12, 14, 8, 6, C.cloakHi);

  // Body panel, under the hood
  pixelRect(g, 10, 18, 20, 16, C.body);

  // Head, with the hood's brim shadowing its top
  pixelEllipse(g, 20, 10, 9, 9, C.head);
  pixelRect(g, 10, 0, 20, 6, C.hood);

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

  // Legs, digitigrade-ish, ending in hooves
  pixelCurve(g, [10, 22], [10 + swing * 0.4, 27], [10 + swing, 31], C.muscle, 4);
  pixelCurve(g, [16, 22], [16 - swing * 0.4, 27], [16 - swing, 31], C.muscle, 4);
  pixelRect(g, 8 + swing, 31, 5, 3, C.hoof);
  pixelRect(g, 14 - swing, 31, 5, 3, C.hoof);

  // Torso: broad chest tapering to the waist
  pixelRect(g, 7, 12, 12, 8, C.hide);
  pixelRect(g, 8, 20, 10, 3, C.hideDk);
  pixelRect(g, 9, 13, 8, 4, C.hideHi);
  // Pectoral shading
  pixelRect(g, 12, 13, 1, 6, C.hideDk);

  // Arms, swinging opposite the legs
  pixelCurve(g, [6, 13], [3, 17 + swing], [3, 21 + swing], C.muscle, 4);
  pixelCurve(g, [20, 13], [23, 17 - swing], [23, 21 - swing], C.muscle, 4);
  pixelRect(g, 1, 21 + swing, 4, 3, C.hideDk);
  pixelRect(g, 21, 21 - swing, 4, 3, C.hideDk);

  // Neck
  pixelRect(g, 11, 10, 4, 3, C.hideDk);

  // Bull skull: broad muzzle, heavy brow
  pixelEllipse(g, 13, 6, 6, 5, C.hide);
  pixelRect(g, 10, 7, 7, 4, C.hideHi);       // muzzle plate
  pixelRect(g, 11, 10, 5, 1, C.hideDk);      // mouth line
  setPixel(g, 11, 8, C.hideDk); setPixel(g, 15, 8, C.hideDk);   // nostrils
  pixelRect(g, 8, 3, 11, 2, C.hideDk);       // brow ridge

  // Horns, sweeping out and up
  pixelCurve(g, [7, 4], [3, 2], [1, 0], C.horn, 6);
  pixelCurve(g, [19, 4], [23, 2], [25, 0], C.horn, 6);
  setPixel(g, 1, 0, C.hornDk); setPixel(g, 25, 0, C.hornDk);
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
  visor: '#B040E0', crest: '#5A1030',
  edge: '#0A0510',
};

/** No walk cycle — like the heroes, one static frame plus a live bob. The
 * whirlwind visual and the spear (rotates with aim, extends on a charge)
 * stay live below, same reasoning as the player Knight's own spear. */
function buildDarkKnightGrid() {
  const C = DARK_KNIGHT_PALETTE;
  const g = makePixelGrid(DARK_KNIGHT_SPRITE.w, DARK_KNIGHT_SPRITE.h);

  // Crest
  pixelTriangleUp(g, 20, 10, 4, 10, C.crest);

  // Great helm — rect body with a domed top
  pixelRect(g, 10, 10, 20, 18, C.helm);
  pixelEllipse(g, 20, 10, 10, 7, C.helm);
  pixelRect(g, 10, 8, 20, 3, C.helmHi);

  // Visor slits — baked solid, same convention as the player Knight's visor
  pixelRect(g, 12, 16, 16, 3, C.visor);
  pixelRect(g, 14, 21, 11, 3, C.visor);

  // Pauldrons
  pixelRect(g, 0, 28, 8, 11, C.pauldron);
  pixelRect(g, 32, 28, 8, 11, C.pauldron);
  pixelRect(g, 0, 28, 8, 3, C.pauldronHi);
  pixelRect(g, 32, 28, 8, 3, C.pauldronHi);

  // Torso
  pixelRect(g, 5, 28, 30, 26, C.torso);
  pixelRect(g, 8, 30, 10, 9, C.torsoHi);

  // Legs
  pixelRect(g, 7, 52, 11, 16, C.leg);
  pixelRect(g, 22, 52, 11, 16, C.leg);
  pixelRect(g, 7, 52, 11, 3, C.legHi);
  pixelRect(g, 22, 52, 11, 3, C.legHi);

  return pixelOutline(g, C.edge);
}

let _darkKnightGrid = null;
function darkKnightGrid() { return _darkKnightGrid || (_darkKnightGrid = buildDarkKnightGrid()); }

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

function drawHUD(t) {
  const isBoss = appState === 'boss_fight';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.hudHeight);
  ctx.font = 'bold 12px "Courier New", monospace'; ctx.textBaseline = 'middle';

  // Score
  ctx.fillStyle = '#39FF14'; ctx.textAlign = 'left';
  ctx.fillText(`SCORE:${String(score).padStart(3,'0')}`, 8, 16);

  // Kill counter or wave counter, depending on mode; or boss HP bar
  if (!isBoss) {
    if (gameMode === 'brawl') ctx.fillText(`  KILLS:${String(killCount).padStart(2,'0')}/10`, 96, 16);
    else                      ctx.fillText(`  WAVE:${String(wave).padStart(2,'0')}`, 96, 16);
  } else if (boss && !Number.isFinite(boss.hpMax)) {
    // A boss with no finite HP has no bar to draw. The minotaur cannot be
    // killed, so a bar would promise progress that never arrives, and the
    // segment loop below counts one divider per HP point — against Infinity
    // that is not a slow frame, it is a hang. This is the one place the rest
    // of the file has to know an unkillable boss exists.
    ctx.textAlign='right'; ctx.font='bold 11px "Courier New",monospace';
    ctx.fillStyle='#C8A040';
    ctx.fillText('THE MAZE HAS A KEEPER', 680, 16);
    ctx.textAlign='left'; ctx.font='bold 12px "Courier New",monospace';
  } else if (boss) {
    // Prominent segmented HP bar
    const bBarX=420, bBarW=260, bBarY=4, bBarH=22;
    const bHpMax = boss.hpMax || CONFIG.bossHP;
    const hpFrac = boss.hp / bHpMax;
    const hitOn  = boss.hitFlash > 0 && Math.floor(boss.hitFlash*18)%2===0;
    ctx.fillStyle='#1a0000'; ctx.fillRect(bBarX, bBarY, bBarW, bBarH);
    ctx.shadowColor = hitOn ? '#FFFFFF' : '#ff2222';
    ctx.shadowBlur  = hitOn ? 20 : 8 + 4*Math.sin(t*5);
    ctx.fillStyle   = hitOn ? '#ffffff' : (hpFrac > 0.5 ? '#ff2222' : hpFrac > 0.25 ? '#ff5500' : '#cc0000');
    ctx.fillRect(bBarX, bBarY, bBarW * hpFrac, bBarH);
    ctx.shadowBlur=0;
    // Segment dividers
    ctx.fillStyle='rgba(0,0,0,0.6)';
    for (let i=1;i<bHpMax;i++) ctx.fillRect(bBarX+(bBarW/bHpMax)*i-1, bBarY, 2, bBarH);
    // Border glow
    ctx.shadowColor='#cc0000'; ctx.shadowBlur=5;
    ctx.strokeStyle='#ff4444'; ctx.lineWidth=1.5;
    ctx.strokeRect(bBarX, bBarY, bBarW, bBarH);
    ctx.shadowBlur=0;
    // Labels
    ctx.textAlign='right'; ctx.font='bold 11px "Courier New",monospace';
    ctx.fillStyle='#cc0000'; ctx.fillText('BOSS HP', bBarX-5, 16);
    ctx.fillStyle='#ff8888'; ctx.font='bold 10px "Courier New",monospace';
    // Burn damage makes hp fractional, so the readout shows the point he is
    // still on while the bar behind it drains smoothly. The epsilon keeps
    // float dust from rounding a whole point back up.
    ctx.fillText(`${Math.ceil(boss.hp - 1e-6)}/${bHpMax}`, bBarX+bBarW-4, 16);
    ctx.font='bold 12px "Courier New",monospace';
  }

  // HP hearts
  const hpX = isBoss ? 248 : 383;
  const lowHP = playerHP <= 3 && playerHP > 0;
  for (let i = 0; i < FEATHERS.maxHP(); i++) {
    const active = i < playerHP;
    const pulse = lowHP && active && Math.floor(t*4)%2===0;
    ctx.fillStyle = pulse ? '#ff4444' : (active ? '#39FF14' : '#333');
    if (pulse) { ctx.shadowColor = '#ff2222'; ctx.shadowBlur = 8; }
    ctx.fillText('♥', hpX + i*14, 16);
    if (pulse) ctx.shadowBlur = 0;
  }

  // Resources — archer/ranger quiver OR knight/wizard cooldowns. Each branch
  // is named explicitly rather than falling through to a trailing else, so a
  // fifth character with none of these draws nothing here instead of
  // silently inheriting whichever branch used to be last.
  ctx.font = 'bold 10px "Courier New", monospace';
  let rx = isBoss ? 692 : 568;
  ctx.textAlign = 'left';
  if (selectedChar === 'archer' || selectedChar === 'ranger') {
    // Same ammo fields, same pickup effects — only which second resource
    // shows (dynamites vs satchels) differs.
    const keys = selectedChar === 'archer' ? ['arrows', 'dynamites'] : ['arrows', 'satchels'];
    for (const k of keys) {
      const r = CONFIG.resources[k];
      const flash = iFlash[k] > 0 && Math.floor(iFlash[k]*12)%2===0;
      // One icon per unit reads well up to a point. Past it the row would run
      // off the HUD, so show a single icon and a count instead.
      if (r.max > HUD_ICON_LIMIT) {
        ctx.fillStyle = flash ? '#ff4444' : (inv[k] > 0 ? r.color : r.dim);
        const label = `${r.icon}${String(inv[k]).padStart(2,'0')}/${r.max}`;
        ctx.fillText(label, rx, 16);
        rx += label.length * 6 + 10;
      } else {
        for (let i = 0; i < r.max; i++) {
          ctx.fillStyle = i < inv[k] ? (flash ? '#ff4444' : r.color) : r.dim;
          ctx.fillText(r.icon, rx + i * r.spacing, 16);
        }
        rx += r.max * r.spacing + 8;
      }
    }
    if (inv.ricochetArrows > 0) { ctx.fillStyle='#44ddff'; ctx.fillText(`[R:${inv.ricochetArrows}]`,rx,16); rx+=52; }
    if (inv.fireArrows     > 0) { ctx.fillStyle='#ff7700'; ctx.fillText(`[F:${inv.fireArrows}]`,rx,16);     rx+=44; }
  } else if (selectedChar === 'knight') {
    // Knight — whirlwind cooldown bar + active buffs
    const wrdRdy  = knightWhirlwindCD <= 0;
    const wrdFrac = wrdRdy ? 1 : (CONFIG.knightWhirlwindCooldown - knightWhirlwindCD) / CONFIG.knightWhirlwindCooldown;
    const wrdActive = knightWhirlwindTimer > 0;
    ctx.fillStyle='#111120'; ctx.fillRect(rx, 4, 78, 11);
    ctx.shadowColor='#6080FF'; ctx.shadowBlur = wrdActive ? 8 : (wrdRdy ? 4 : 0);
    ctx.fillStyle = wrdActive ? '#88aaff' : (wrdRdy ? '#4060d0' : '#1a2060');
    ctx.fillRect(rx, 4, 78*wrdFrac, 11);
    ctx.shadowBlur=0;
    ctx.strokeStyle='#4060C0'; ctx.lineWidth=0.7; ctx.strokeRect(rx,4,78,11);
    ctx.fillStyle = wrdActive ? '#ccddff' : (wrdRdy ? '#8899cc' : '#444466');
    ctx.font='bold 8px "Courier New",monospace'; ctx.textAlign='center';
    const wrdLabel = wrdActive ? `SPIN ${knightWhirlwindTimer.toFixed(1)}s` : (wrdRdy ? '◎ READY' : `◎ ${knightWhirlwindCD.toFixed(1)}s`);
    ctx.fillText(wrdLabel, rx+39, 12);
    rx += 86; ctx.textAlign='left'; ctx.font='bold 10px "Courier New",monospace';
    // Block bar — countdown to the next free charge. The shared ◆SHLD
    // readout further down already flags a banked charge as active, so this
    // one just needs to read "ready" rather than duplicate that text.
    const blkRdy  = knightBlockCD <= 0 || playerShield;
    const blkFrac = blkRdy ? 1 : (CONFIG.knightBlockCooldown - knightBlockCD) / CONFIG.knightBlockCooldown;
    ctx.fillStyle='#2a1a05'; ctx.fillRect(rx, 4, 78, 11);
    ctx.shadowColor='#FFB400'; ctx.shadowBlur = blkRdy ? 6 : 0;
    ctx.fillStyle = blkRdy ? '#FFB400' : '#5a3a10';
    ctx.fillRect(rx, 4, 78*blkFrac, 11);
    ctx.shadowBlur=0;
    ctx.strokeStyle='#FFB400'; ctx.lineWidth=0.7; ctx.strokeRect(rx,4,78,11);
    ctx.fillStyle = blkRdy ? '#FFE8B0' : '#7a5a30';
    ctx.font='bold 8px "Courier New",monospace'; ctx.textAlign='center';
    ctx.fillText(blkRdy ? '◎ READY' : `◎ ${knightBlockCD.toFixed(1)}s`, rx+39, 12);
    rx += 86; ctx.textAlign='left'; ctx.font='bold 10px "Courier New",monospace';
    if (inv.knightJavelins    > 0) { ctx.fillStyle='#D0D0E8'; ctx.fillText(`[J:${inv.knightJavelins}]`, rx, 16); rx+=48; }
    if (inv.knightFireSwordTimer > 0) {
      ctx.fillStyle='#FF7A1F';
      ctx.fillText(`[FS:${inv.knightFireSwordTimer.toFixed(1)}s]`, rx, 16); rx+=70;
    }
  } else if (selectedChar === 'wizard') {
    // Wizard — bolt cooldown bar
    const boltRdy  = wizBoltCD <= 0;
    const boltFrac = boltRdy ? 1 : (CONFIG.wizBoltCooldown - wizBoltCD) / CONFIG.wizBoltCooldown;
    const stormRdy  = stormCD <= 0;
    const stormFrac = stormRdy ? 1 : (CONFIG.stormCooldown - stormCD) / CONFIG.stormCooldown;
    // Bolt bar
    ctx.fillStyle='#1a1a3a'; ctx.fillRect(rx, 4, 78, 11);
    ctx.shadowColor='#8888FF'; ctx.shadowBlur = boltRdy ? 6 : 0;
    ctx.fillStyle = boltRdy ? '#8888ff' : '#3a3a8a'; ctx.fillRect(rx, 4, 78*boltFrac, 11);
    ctx.shadowBlur=0;
    ctx.strokeStyle='#8888ff'; ctx.lineWidth=0.7; ctx.strokeRect(rx,4,78,11);
    ctx.fillStyle = boltRdy ? '#ccccff' : '#555588';
    ctx.font='bold 8px "Courier New",monospace'; ctx.textAlign='center';
    ctx.fillText(boltRdy ? 'BOLT READY' : `BOLT ${wizBoltCD.toFixed(1)}s`, rx+39, 12);
    rx += 86;
    // Storm bar
    ctx.fillStyle='#10101e'; ctx.fillRect(rx, 4, 78, 11);
    ctx.shadowColor='#4444ff'; ctx.shadowBlur = stormRdy ? 6 : 0;
    ctx.fillStyle = stormRdy ? '#4444ff' : '#1a1a55'; ctx.fillRect(rx, 4, 78*stormFrac, 11);
    ctx.shadowBlur=0;
    ctx.strokeStyle='#4444ff'; ctx.lineWidth=0.7; ctx.strokeRect(rx,4,78,11);
    ctx.fillStyle = stormRdy ? '#aaaaff' : '#444488';
    ctx.fillText(stormRdy ? 'STORM RDY' : `STORM ${stormCD.toFixed(1)}s`, rx+39, 12);
    rx += 86; ctx.textAlign='left'; ctx.font='bold 10px "Courier New",monospace';
    // Special ammo
    if (inv.laserStreams > 0) { ctx.fillStyle='#39E0FF'; ctx.fillText(`[L:${inv.laserStreams}]`,rx,16); rx+=50; }
    if (inv.fireBolts    > 0) { ctx.fillStyle='#ff5500'; ctx.fillText(`[FB:${inv.fireBolts}]`,rx,16);  rx+=54; }
  }
  // The maze's keys, one icon per key, lit when held. Same icon-per-unit loop
  // as the quiver above, and only while a maze run is live, so forest and
  // castle keep the HUD they had.
  if (mazeRun) {
    ctx.textAlign='left'; ctx.font='bold 10px "Courier New",monospace';
    for (const [kind, k] of Object.entries(MAZE_KEYS)) {
      const held = mazeRun.held[kind];
      ctx.shadowColor = k.color; ctx.shadowBlur = held ? 6 : 0;
      ctx.fillStyle = held ? k.color : k.dim;
      ctx.fillText(k.icon, rx, 16);
      ctx.shadowBlur = 0;
      rx += k.spacing;
    }
    rx += 8;
  }
  if (playerShield) {
    ctx.textAlign='left'; ctx.font='bold 10px "Courier New",monospace';
    ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 6 + 3*Math.sin(t*6);
    ctx.fillStyle = '#FFB400'; ctx.fillText('◆SHLD', rx, 16);
    ctx.shadowBlur = 0; rx += 52;
  }
  // Feather wallet — dim amber, always visible
  ctx.textAlign='left'; ctx.font='bold 10px "Courier New",monospace';
  ctx.fillStyle = '#5a3a00';
  ctx.fillText(`◆${FEATHERS.wallet()}`, rx, 16);
  ctx.font = 'bold 12px "Courier New", monospace';

  // Mode badge (always visible, dim)
  ctx.font = 'bold 10px "Courier New", monospace'; ctx.textAlign = 'right';
  ctx.fillStyle = '#1a5a10';
  ctx.fillText(gameMode === 'brawl' ? 'BRAWL' : 'WAVES', CONFIG.canvasW - 8, 7);

  // INCOMING / SNIPE indicator
  ctx.font = 'bold 12px "Courier New", monospace';
  if (!isBoss) {
    if (sniperMode) {
      ctx.fillStyle = '#ffff33';
      ctx.fillText('◎ SNIPE', CONFIG.canvasW - 8, 22);
    } else if (crows.some(c => c.state === 'aggro') && Math.floor(t*2)%2===0) {
      ctx.fillStyle = '#ff2222';
      ctx.fillText('⚠ INCOMING', CONFIG.canvasW - 8, 22);
    }
  }

  // HUD separator — glows on low HP
  ctx.shadowColor = lowHP ? '#ff2222' : '#39FF14';
  ctx.shadowBlur  = lowHP ? 6 + 3*Math.sin(t*8) : 3;
  ctx.strokeStyle = lowHP ? '#ff4444' : '#39FF14'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, CONFIG.hudHeight-1); ctx.lineTo(CONFIG.canvasW, CONFIG.hudHeight-1); ctx.stroke();
  ctx.shadowBlur = 0;
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

/** Reuses the same cached grids gameplay draws from — one real sprite per
 * hero instead of a fifth hand-drawn mini-vector copy per character. The
 * gentle bob is the only animation now; the vector version's per-character
 * sway/pulse lived on live overlays this preview has no equivalent of. */
function _drawCharPreview(cx, cy, char, t) {
  const rFrame = animFrame3(t * 1.5);
  const PREVIEW = {
    archer: { grid: buildArcherGrid(SP_TRIM.archer),        sprite: ARCHER_SPRITE, key: 'archer' },
    wizard: { grid: buildWizardGrid(SP_TRIM.wizard),        sprite: WIZARD_SPRITE, key: 'wizard' },
    knight: { grid: buildKnightGrid('normal', SP_TRIM.knightNormal), sprite: KNIGHT_SPRITE, key: 'knight|normal' },
    ranger: { grid: buildRangerGrid(rFrame, SP_TRIM.ranger), sprite: RANGER_SPRITE, key: `ranger|${rFrame}` },
  };
  const p = PREVIEW[char];
  if (!p) return;
  const scale = 1.4;
  const bob = Math.round(1.5 * Math.sin(t * 2));
  ctx.save(); ctx.translate(cx, cy + bob);
  ctx.drawImage(
    spriteCanvas(`preview|${p.key}`, p.grid, p.sprite.w, p.sprite.h, scale),
    -(p.sprite.w * scale) / 2, -(p.sprite.h * scale) / 2,
  );
  ctx.restore();
}

function drawCharSelect(t) {
  ctx.fillStyle='#000'; ctx.fillRect(0,0,CONFIG.canvasW,CONFIG.canvasH);
  _screenCrows(4, 0.038, 20);
  _scanSweep('rgba(57,255,20,0.022)', 88);
  _cornerFrame('#0d4d04');

  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='#39FF14'; ctx.shadowBlur=8;
  ctx.fillStyle='#39FF14'; ctx.font='22px "Courier New",monospace';
  ctx.fillText('── CHOOSE YOUR CHAMPION ──', CONFIG.canvasW/2, 65);
  ctx.shadowBlur=0;
  ctx.font='12px "Courier New",monospace'; ctx.fillStyle='#1a7a08';
  ctx.fillText(`MODE: ${gameMode.toUpperCase()}`, CONFIG.canvasW/2, 100);

  // Panel width shrinks to fit however many CHAR_PANELS holds today — four
  // panels at the old 296px width would run 182px wider than the canvas.
  const gapX = 12, panelH = 390;
  const panelW = Math.floor((1000 - gapX * (CHAR_PANELS.length - 1)) / CHAR_PANELS.length);
  const totalW = panelW*CHAR_PANELS.length + gapX*(CHAR_PANELS.length-1);
  const startX = CONFIG.canvasW/2 - totalW/2;
  const panelY = 118;

  CHAR_PANELS.forEach((p, idx) => {
    const px = startX + idx * (panelW + gapX);
    const sel = selectedChar === p.char;
    ctx.fillStyle = sel ? p.bg : p.dimBg;
    ctx.fillRect(px, panelY, panelW, panelH);
    if (sel) { ctx.shadowColor=p.color; ctx.shadowBlur=16; }
    ctx.strokeStyle = sel ? p.color : p.dim; ctx.lineWidth=1.5;
    ctx.strokeRect(px, panelY, panelW, panelH); ctx.shadowBlur=0;
    ctx.fillStyle = sel ? p.color : p.dim;
    ctx.font='19px "Courier New",monospace';
    ctx.fillText(`[${p.key}] ${p.char.toUpperCase()}`, px+panelW/2, panelY+30);
    if (p.newBadge) {
      ctx.font='bold 10px "Courier New",monospace';
      ctx.shadowColor='#FFB400'; ctx.shadowBlur=7;
      ctx.fillStyle='#FFB400'; ctx.fillText('[ NEW ]', px+panelW/2, panelY+50);
      ctx.shadowBlur=0;
    }
    _drawCharPreview(px+panelW/2, panelY+114, p.char, t);
    ctx.font='10.5px "Courier New",monospace';
    ctx.fillStyle = sel ? p.color.replace('FF','88') : p.dim;
    p.lines.forEach((line, i) => ctx.fillText(line, px+panelW/2, panelY+208+i*30));
    ctx.font='11px "Courier New",monospace';
    ctx.shadowColor = p.difficulty.color; ctx.shadowBlur = 6;
    ctx.fillStyle = p.difficulty.color;
    ctx.fillText(`DIFFICULTY: ${p.difficulty.label}`, px+panelW/2, panelY+360);
    ctx.shadowBlur = 0;
  });

  ctx.fillStyle='#0d4d04'; ctx.font='14px "Courier New",monospace';
  const keyHint = CHAR_PANELS.map(p => `[${p.key}]`).join(' ');
  ctx.fillText(`← →  /  ${keyHint}  SWITCH    ENTER  CONFIRM`, CONFIG.canvasW/2, CONFIG.canvasH-22);
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
  const modes = MENU_ENTRIES.filter((e) => e.section === 'mode');
  const utils = MENU_ENTRIES.filter((e) => e.section === 'util');

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
  ctx.fillText(`[I] UPGRADES  [◆${FEATHERS.wallet()} FTH]`, CONFIG.canvasW/2, CONFIG.canvasH/2+44);
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
  if (gameMode === 'brawl') ctx.fillText(`KILLS:         ${killCount}`, CONFIG.canvasW/2, 296);
  else                      ctx.fillText(`WAVE REACHED:  ${wave}`,     CONFIG.canvasW/2, 296);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#0a3a06'; ctx.font = '13px "Courier New", monospace';
  ctx.fillText(`[ ${gameMode.toUpperCase()} MODE ]`, CONFIG.canvasW/2, 336);

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
  for (let i = 0; i < CONFIG.playerMaxHP; i++) hp += i < winHP ? '♥' : '♡';
  ctx.fillText(`HP REMAINING:  ${hp}`, CONFIG.canvasW/2, 350);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0a3a06'; ctx.font = '13px "Courier New", monospace';
  ctx.fillText(`[ ${gameMode.toUpperCase()} MODE ]`, CONFIG.canvasW/2, 378);

  ctx.fillStyle = '#1a7a08'; ctx.font = '18px "Courier New", monospace';
  ctx.fillText(`[R] PLAY AGAIN${Math.floor(t*2)%2===0 ? '_' : ' '}   [M] MENU`, CONFIG.canvasW/2, 410);
}

/**
 * Shown once, between the Crow King's death and the castle stage's own
 * setup becoming visible. That setup (generateMap('castle'), the wave 1
 * spawn) already ran before this state was entered, hidden behind the black
 * screen, so the click just reveals it rather than triggering it.
 */
function drawCastleIntro(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
  _scanSweep('rgba(176,64,224,0.045)', 90);
  _cornerFrame('#4a1a5c');

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#B040E0'; ctx.shadowBlur = 16 + 7 * Math.sin(t * 1.7);
  ctx.fillStyle = '#B040E0'; ctx.font = '24px "Courier New", monospace';
  ctx.fillText("You've entered the cursed Castle!", CONFIG.canvasW / 2, CONFIG.canvasH / 2 - 16);
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 3);
  ctx.fillStyle = '#8A40A8'; ctx.font = '16px "Courier New", monospace';
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
};

function drawReticle() {
  ctx.save();
  ctx.translate(mouse.x, mouse.y + CONFIG.hudHeight);
  (RETICLE_PAINTERS[selectedChar] || drawRangerReticle)();
  ctx.restore();
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
  syncCursor();
  const gameVisible = GAME_VISIBLE_STATES.has(appState);
  if (gameVisible) {
    ctx.fillStyle = '#0a140a'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
    const so = shakeOffset(t);
    ctx.save(); ctx.translate(so.x, so.y);
    drawTiles(); FORESHADOW.drawSkyTint(); drawMazeObjective(); drawPickups(); drawFires(); drawParticles();
    // Anything alive is drawn only where the player can see it right now.
    // litAt is unconditionally true off the maze, so this is the same list of
    // draws it has always been on forest and castle.
    for (const c of crows) if (litAt(c.x, c.y)) drawCrow(c);
    for (const s of skeletons) if (litAt(s.x, s.y)) drawSkeleton(s);
    drawArrows(); drawDynamites(); drawSatchels(); drawHostileBolts(); drawPlayer();
    if (playerPoison.timer > 0) drawPlayerPoisonOverlay();
    if (playerFrozenTimer > 0) drawPlayerFrozenOverlay();
    if (!boss || litAt(boss.x, boss.y)) drawBoss();
    drawFloaters();
    // Last thing inside the shake, so the dark moves with the world instead of
    // sliding across it.
    drawFog();
    ctx.restore();
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
  } else if (appState === 'controls')   { drawControls(t);
  } else if (appState === 'gameover')   { drawGameOver(t);
  } else if (appState === 'win')        { drawWin(t);
  } else if (appState === 'castle_intro') { drawCastleIntro(t);
  } else if (appState === 'inventory')  { FEATHERS.draw(); }
}

// ── LOOP ──────────────────────────────────────────────────────────────────────

// Frame-time probe, dev only. Enable with ?perf=1.
// Tracks update and render cost separately over the last 120 frames.
const PERF = new URLSearchParams(location.search).has('perf') ? {
  upd: new Float32Array(120), ren: new Float32Array(120), i: 0, n: 0,
  push(u, r) {
    this.upd[this.i] = u; this.ren[this.i] = r;
    this.i = (this.i + 1) % 120; if (this.n < 120) this.n++;
  },
  stats(buf) {
    let sum = 0, max = 0;
    for (let k = 0; k < this.n; k++) { sum += buf[k]; if (buf[k] > max) max = buf[k]; }
    return [sum / this.n, max];
  },
  draw() {
    if (!this.n) return;
    const [ua, um] = this.stats(this.upd), [ra, rm] = this.stats(this.ren);
    ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#39FF14';
    ctx.fillText(`UPD AVG ${ua.toFixed(2)} MAX ${um.toFixed(2)}`, 4, CONFIG.canvasH - 24);
    ctx.fillText(`REN AVG ${ra.toFixed(2)} MAX ${rm.toFixed(2)}`, 4, CONFIG.canvasH - 13);
  }
} : null;

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
  const n = MENU_ENTRIES.length;
  if (keys['ArrowUp'])   { menuSelection = (menuSelection - 1 + n) % n; keys['ArrowUp']   = false; }
  if (keys['ArrowDown']) { menuSelection = (menuSelection + 1) % n;     keys['ArrowDown'] = false; }
  if (keys['Enter']) {
    keys['Enter'] = false;
    MENU_ENTRIES[menuSelection].run();
    return;                       // the entry may have changed appState
  }
  // Hotkeys, the bracketed letter beside each label
  for (const entry of MENU_ENTRIES) {
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
      const chars = CHAR_PANELS.map(p => p.char);
      const n = chars.length, ci = chars.indexOf(selectedChar);
      if (keys['ArrowLeft'])  { selectedChar = chars[(ci+n-1)%n]; keys['ArrowLeft']=false; }
      if (keys['ArrowRight']) { selectedChar = chars[(ci+1)%n];   keys['ArrowRight']=false; }
      for (const p of CHAR_PANELS) {
        const lower = p.key.toLowerCase();
        if (keys[lower] || keys[p.key]) { selectedChar = p.char; keys[lower] = keys[p.key] = false; }
      }
      if (keys['Enter']) { transitionTo('playing'); keys['Enter']=false; }
      if (keys['Escape']) { transitionTo('menu'); keys['Escape']=false; }
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
      // The maze's warden hunts you the whole level, so he ticks here as well
      // as in a boss fight. See BOSS_HUNTS_WHILE_EXPLORING for why this is a
      // table lookup and not a kind check.
      if (boss && BOSS_HUNTS_WHILE_EXPLORING[boss.kind]) updateBoss(dt);
      updateHostileBolts(dt);
      updatePickups(dt); updateParticles(dt); updateFloaters(dt); updateFires(dt); checkPickupCollection(); updateEscalation(dt);
      updateMazeObjective(dt);
      FORESHADOW.update(dt); STREAK.update(dt); BOUNTIES.update(dt);
      break;

    case 'boss_entrance':
      updateBossEntrance(dt); updateParticles(dt); updateFloaters(dt);
      break;

    case 'boss_fight':
      if (keys['Escape']) { pausedFrom='boss_fight'; transitionTo('paused'); keys['Escape']=false; break; }
      gameTime += dt;
      updateFOV(); updatePlayer(dt); updateArrows(dt); updateDynamites(dt); updateSatchels(dt); updateCrows(dt); updateSkeletons(dt);
      updatePickups(dt); updateParticles(dt); updateFloaters(dt); updateFires(dt); checkPickupCollection();
      if (bossDeathSeq) updateBossDeath(dt); else { updateBoss(dt); updateHostileBolts(dt); }
      FORESHADOW.update(dt); STREAK.update(dt); BOUNTIES.update(dt);
      break;

    case 'paused':
      if (keys['Escape'])      { transitionTo(pausedFrom); keys['Escape']=false; }
      if (keys['c']||keys['C']){ transitionTo('controls'); keys['c']=keys['C']=false; }
      if (keys['m']||keys['M']){ transitionTo('menu');     keys['m']=keys['M']=false; }
      if (keys['i']||keys['I']){ transitionTo('inventory'); keys['i']=keys['I']=false; }
      break;

    case 'inventory':
      if (keys['ArrowUp'])   { FEATHERS.moveCursor(-1); keys['ArrowUp']   = false; }
      if (keys['ArrowDown']) { FEATHERS.moveCursor( 1); keys['ArrowDown'] = false; }
      if (keys['Enter'])     { FEATHERS.buyCurrent();   keys['Enter']     = false; }
      if (keys['b']||keys['B']) { transitionTo('paused'); keys['b']=keys['B']=false; }
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

function loop(ts) {
  let frameTime = (ts - lastTs) / 1000;
  lastTs = ts; loopT = ts / 1000;
  if (frameTime > 0.25) frameTime = 0.25;   // drop a huge gap (e.g. backgrounded tab)

  if (ts - waterLastTs >= CONFIG.waterShimmerMs) { waterLastTs = ts; waterPhase = !waterPhase; }

  const _pt0 = PERF ? performance.now() : 0;
  accumulator += frameTime;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    updateShake(FIXED_DT);
    stepGame(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS) accumulator = 0;   // discard backlog after the cap
  const _updMs = PERF ? performance.now() - _pt0 : 0;

  const _pt1 = PERF ? performance.now() : 0;
  render(loopT);
  if (PERF) { PERF.push(_updMs, performance.now() - _pt1); PERF.draw(); }
  if (liveLoop) requestAnimationFrame(loop);
}

// Whether the browser's own frame clock still drives the loop. A harness turns
// this off (see __game.takeClock) because the two clocks share one accumulator
// and race: real time runs faster than a scripted step(), so one live frame
// arriving between two calls subtracts however many seconds of wall clock have
// passed and the sim silently stops advancing until that debt is repaid.
let liveLoop = true;

FEATHERS.init();
requestAnimationFrame(loop);

// Pure classes exposed for the test harness in tests.html.
window.CrowArcherInternals = { TILE, TileMap, PathScheduler, FovMap };

// Dev hook: steps the loop with fixed timestamps and exposes read access to
// module state, so headless verification works while the tab is backgrounded.
let __devTs = 0;
window.__game = {
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
  // One frame with a raw millisecond gap, to test accumulator multi-stepping.
  frame(ms) {
    if (__devTs === 0) __devTs = performance.now();
    __devTs += ms; loop(__devTs);
  },
  // Dev triggers that drive real sim paths, for headless event-bus checks.
  kill(i = 0) { if (i >= 0 && i < crows.length) killCrow(i); },
  killSkel(i = 0) { if (i >= 0 && i < skeletons.length) killSkeleton(i); },
  // Drives the same death path a real kill shot would, so the crowking →
  // dark_archer → dark_knight → win chain can be walked without grinding
  // out every stage's HP bar by hand.
  killBoss() { if (boss && boss.bstate !== 'dead') startBossDeath(); },
  blast(x, y) { explodeExplosive({ x, y, vx: 0, vy: 0, life: 0, angle: 0 }, 'dynamite'); },
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
  poison: () => ({ timer: playerPoison.timer, tickIn: playerPoison.tickIn, speedMult: poisonSpeedMult() }),
  minotaur: () => (boss && boss.kind === 'minotaur'
    ? { bstate: boss.bstate, x: boss.x, y: boss.y, hp: boss.hp,
        stateTimer: boss.stateTimer, cooldown: boss.cooldown,
        daze: boss.dazeTimer, phase: bossDazePhase(), sees: minotaurSeesPlayer() }
    : null),
  spawnMinotaur() { bossStage = 4; spawnBoss(); boss.bstate = 'prowl'; return boss.kind; },
  // The whole objective chain in one read: which keys are held, which locks
  // are open, whether the warden has been met yet, and where the furniture is.
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
  }),
  // Tap the event bus, for verifying which gameplay events fire.
  onEvent: fn => events.on(fn),
  // Drive a real state transition, and pick a character, for scripted runs.
  go(s) { transitionTo(s); },
  pick(c) { selectedChar = c; },
  spawnCrow() { spawnCrow(); },
  spawnSkeleton(kind = 'normal') { spawnSkeleton(kind); },
  key(k) {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true });
    window.dispatchEvent(e); document.dispatchEvent(e);
  },
  state: () => appState,
  multiplayer: () => multiplayerSession?.describe() ?? null,
  tiles: () => tileMap,
  mapKind: () => mapKind,
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
  counts: () => ({ crows: crows.length, skeletons: skeletons.length, particles: particles.length, hp: playerHP }),
};
