// Legacy monolith, being dismantled into sim/ and render/ modules.
// The synth comes first, so it shares scope with the sound arrays below.

import SimplexNoise from 'simplex-noise';
import { FOV, Path } from 'rot-js';

import { TILE, TileMap, tilePassable } from '../sim/tilemap';
import { mulberry32 } from '../sim/rng';
import { generateGrid } from '../sim/mapgen';
import { PathScheduler, FovMap } from '../sim/pathfinding';
import { LocalInput, Button, hasButton } from '../sim/input';
import { Team, canDamage } from '../sim/team';
import { EventBus } from '../sim/events';
import { ScreenShake } from '../render/shake';
import { StaticTileLayer, AnimatedTileOverlay, makeVignette } from '../render/tiles';
import { glowDotStamp, glowRectStamp } from '../render/stamps';
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
  handicap: 0,          // 0-100: rubber-band difficulty assist

  dynamiteSpeed: 336, dynamiteLifetime: 1.5, dynamiteBlastRadius: 90, dynamiteBossDamage: 2,

  pitchforkRange: 52, pitchforkCooldown: 1.5, pitchforkBossDamage: 2, pitchforkSwingDuration: 0.38,

  fireArrowDuration: 3.0, fireArrowDamageInterval: 0.5, specialArrowPickupCount: 3,

  // Knight
  knightSpearRange: 80, knightSpearCooldown: 1.0,
  knightSpearBossDamage: 2, knightSpearSwingDuration: 0.35,
  knightWhirlwindDuration: 3, knightWhirlwindRadius: 72, knightWhirlwindCooldown: 8,
  knightWhirlwindTickRate: 0.22,  // damage/tile-break tick every N seconds during whirlwind
  knightFireSwordDuration: 8, knightFireSwordRangeMult: 2, knightFireSwordDamageMult: 2,
  knightJavelinsPerPickup: 3, knightJavelinSpeed: 580, knightJavelinPierce: 2,
  knightJavelinBossDamage: 1,
  bossHPKnight: 12,               // knight has high DPS so boss needs more HP

  // Wizard
  wizBoltCooldown: 2.0, wizBoltSpeed: 468, wizBoltLifetime: 3.5,
  wizBoltDamage: 1, wizFireBoltDamage: 3,
  wizBoltTurnRate: 4.5,           // rad/s homing angular speed
  stormCooldown: 10,
  stormBlastRadius: 450,          // = dynamiteBlastRadius * 5
  stormBossDamage: 3,
  stormFlashDuration: 0.35,       // seconds of blue screen-flash after storm

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
    dynamites: { max:  3, restore: 1, color: '#ff6600', dim: '#2d2d2d', icon: '■', spacing: 13 }
  },

  audio: true,
  keys: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    shoot: ' ', pause: 'Escape',
    menuControls: 'c', back: 'b', restart: 'r', menu: 'm', snipe: 'Shift'
  }
};

// ── PACE ──────────────────────────────────────────────────────────────────────

/**
 * How busy the field gets, and what the player has to answer it. The two move
 * together: raising crow density without raising arrows in flight and starting
 * ammo makes the game unwinnable rather than faster.
 *
 * baseArrows and baseDynamites are the starting count and the cap. Drop rates
 * are untouched, since more crows already means more drops.
 */
const PACE_PRESETS = {
  calm:      { crowStartCount:  5, crowEscalationInterval: 12, crowMax: 12, crowAggroTimeout:  4, crowPassiveSpeed:  60, maxArrowsInFlight: 3, baseArrows: 10, baseDynamites: 3 },
  fast:      { crowStartCount:  9, crowEscalationInterval:  4.5, crowMax: 18, crowAggroTimeout:  7, crowPassiveSpeed:  85, maxArrowsInFlight: 5, baseArrows: 16, baseDynamites: 4 },
  nightmare: { crowStartCount: 12, crowEscalationInterval:  2.5, crowMax: 22, crowAggroTimeout: 10, crowPassiveSpeed: 100, maxArrowsInFlight: 8, baseArrows: 24, baseDynamites: 5 },
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
  CONFIG.resources.arrows.max    = preset.baseArrows;
  CONFIG.resources.dynamites.max = preset.baseDynamites;
}

applyPace(new URLSearchParams(location.search).get('pace') ?? CONFIG.pace);

// ── MODULE-LEVEL CONSTANTS ────────────────────────────────────────────────────

const BOSS_ENTRY_TEXT = '⚠  THE CROWS SUMMONED THEIR KING  ⚠';

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
let playerHP = CONFIG.playerMaxHP, playerHitFlash = 0;
let killCount = 0, dropStreak = 0, playerShield = false;
let boss = null, bossDeathSeq = null, entrance = null;
let winScore = 0, winKills = 0, winHP = 0;
let sniperMode = false;

// Character selection — persists for the session, reset only on new run
let selectedChar = 'archer';   // 'archer' | 'wizard' | 'knight'

// Wizard combat cooldowns
let wizBoltCD = 0;   // 3-second cooldown for magic bolts
let stormCD   = 0;   // 10-second cooldown for lightning storm
let _stormFlash = 0; // countdown for the brief blue screen-flash after storm

// Knight combat state
let knightSpearCD = 0, knightSpearSwing = 0, knightSpearBossHit = false, knightSpearPhase2Hit = false;
let knightWhirlwindCD = 0, knightWhirlwindTimer = 0, knightWhirlwindTick = 0;

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
  if (next === 'win')      { winScore = score; winKills = killCount; winHP = playerHP; }
  if (next === 'gameover') events.emit({ type: 'GAME_OVER' });
}

// ── TILEMAP ───────────────────────────────────────────────────────────────────

const tileMap = new TileMap(CONFIG.rows, CONFIG.cols);
let waterPhase = false, waterLastTs = 0;

let mapSeed = 0;

function generateMap() {
  mapSeed = (Math.random() * 2 ** 32) >>> 0;
  const rng = mulberry32(mapSeed);
  // SimplexNoise 2.4 takes a random fn, so terrain derives fully from the seed.
  const sn = new SimplexNoise(rng);
  tileMap.reset(generateGrid(CONFIG.rows, CONFIG.cols, rng,
    (x, y) => sn.noise2D(x, y)));
}

function tileAt(wx, wy) {
  const c = Math.floor(wx / CONFIG.tileSize), r = Math.floor(wy / CONFIG.tileSize);
  if (c < 0 || c >= CONFIG.cols || r < 0 || r >= CONFIG.rows) return TILE.ROCK;
  return tileMap.get(r, c);
}

// Storm and whirlwind level terrain the same way: trees char to ash,
// rocks and huts are cleared outright.
function smashTile(row, col) {
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
const fovMap  = new FovMap(CONFIG.rows, CONFIG.cols,
  (col, row, mark) => _fov.compute(col, row, 14, mark));

function updateFOV() {
  fovMap.update(Math.floor(player.x / CONFIG.tileSize), Math.floor(player.y / CONFIG.tileSize));
}

// Returns true if grid cell (col, row) is currently in the player's line-of-sight.
function tileVisible(col, row) { return fovMap.isVisible(col, row); }

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

function startCharge() {
  if (selectedChar === 'wizard') {
    if (stormCD <= 0 && inGame()) fireLightningStorm();
  } else if (selectedChar === 'knight') {
    if (knightWhirlwindCD <= 0 && knightWhirlwindTimer <= 0 && inGame()) startWhirlwind();
    else if (knightWhirlwindCD > 0) events.emit({ type: 'ACTION_BLOCKED' });
  } else {
    if (inv.dynamites > 0 && !charge.on && inGame()) { charge.on = true; charge.t0 = performance.now(); }
  }
}
function releaseCharge() {
  if (!charge.on) return;
  charge.on = false;
  if (inGame() && selectedChar === 'archer') throwDynamite(Math.min(1, (performance.now() - charge.t0) / 1000));
}

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (CONFIG.canvasW / r.width);
  mouse.y = (e.clientY - r.top)  * (CONFIG.canvasH / r.height);
});
let mouseRightHeld = false;
// Held, not just pressed: multiplayer samples the button once per frame rather
// than reacting to the event, the same way it reads the keyboard.
let mouseLeftHeld = false;
canvas.addEventListener('mousedown', e => {
  initAudio();
  if (e.button === 0) { mouseLeftHeld = true; if (inGame()) shootPressed = true; }
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
  keys[e.key] = true;
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => {
  keys[e.key] = false;
  if (e.key === 'f' || e.key === 'F') releaseCharge();
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

let player = {}, arrows = [], crows = [], pickups = [], particles = [], dynamites = [];

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
  arrow: null, javelin: null, whirlwind: null, storm: null, dynamite: null,
};
// Sound and shake per attack the player starts.
const WEAPON_FX = {
  arrow:     { sound: () => sndShoot,     shake: null },
  bolt:      { sound: () => sndWizBolt,   shake: null },
  pitchfork: { sound: () => sndPitchfork, shake: [3, 90] },
  spear:     { sound: () => sndPitchfork, shake: [2, 70] },
  javelin:   { sound: () => sndPitchfork, shake: [3, 80] },
};

events.on(e => {
  switch (e.type) {
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

    case 'DYNAMITE_SPLASH':
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
  shootPressed = false;
  arrows = []; pickups = []; particles = []; dynamites = []; fires = []; floaters = [];
  playerHP = FEATHERS.maxHP(); playerHitFlash = 0; killCount = 0; dropStreak = 0; playerShield = false;
  wizBoltCD = 0; stormCD = 0; _stormFlash = 0;
  boss = null; bossDeathSeq = null; entrance = null;
  fovMap.invalidate(); // force FOV recompute on next player move
  FEATHERS.applyToGame();
  resetInv();
  FORESHADOW.reset(); STREAK.reset(); BOUNTIES.reset();
  player = { x: 2.5 * CONFIG.tileSize, y: (CONFIG.rows / 2) * CONFIG.tileSize, facing: 1, aimAngle: 0, walkPhase: 0, team: Team.A };
  crows = [];
  for (let i = 0; i < CONFIG.crowStartCount; i++) spawnCrow();
}

function spawnCrow() {
  const baseY = (1 + Math.random() * (CONFIG.rows - 2)) * CONFIG.tileSize;
  crows.push({
    x: CONFIG.canvasW + 20 + Math.random() * 80, y: baseY, baseY,
    state: 'passive', aggroTimer: 0, team: Team.ENEMY,
    wingPhase: Math.random() * Math.PI * 2, phaseOff: Math.random() * Math.PI * 2,
    entityPhase: Math.random() * Math.PI * 2,
    white: false, frozen: false,
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

  const cmd = playerInput.sample();
  sniperMode = hasButton(cmd, Button.SNIPE);

  if (!sniperMode) {
    let vx = 0, vy = 0;
    if (hasButton(cmd, Button.UP))    vy -= 1;
    if (hasButton(cmd, Button.DOWN))  vy += 1;
    if (hasButton(cmd, Button.LEFT))  vx -= 1;
    if (hasButton(cmd, Button.RIGHT)) vx += 1;
    const len = Math.hypot(vx, vy);
    if (len > 0) { vx = (vx/len)*FEATHERS.speed()*dt; vy = (vy/len)*FEATHERS.speed()*dt; player.walkPhase += 8 * dt; }
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

  player.aimAngle = cmd.aimAngle;
  player.facing   = Math.cos(cmd.aimAngle) >= 0 ? 1 : -1;

  for (const k in iFlash) if (iFlash[k] > 0) iFlash[k] = Math.max(0, iFlash[k] - dt);
  if (playerHitFlash > 0) playerHitFlash = Math.max(0, playerHitFlash - dt);
  if (pfCooldown          > 0) pfCooldown         = Math.max(0, pfCooldown         - dt);
  if (wizBoltCD           > 0) wizBoltCD          = Math.max(0, wizBoltCD          - dt);
  if (stormCD             > 0) stormCD            = Math.max(0, stormCD            - dt);
  if (_stormFlash         > 0) _stormFlash        = Math.max(0, _stormFlash        - dt);
  if (knightSpearCD       > 0) knightSpearCD      = Math.max(0, knightSpearCD      - dt);
  if (knightWhirlwindCD   > 0) knightWhirlwindCD  = Math.max(0, knightWhirlwindCD  - dt);
  if (inv.knightFireSwordTimer > 0) inv.knightFireSwordTimer = Math.max(0, inv.knightFireSwordTimer - dt);
  if (pfSwing > 0) {
    pfSwing = Math.max(0, pfSwing - dt);
    const prog = pfSwing > 0 ? 1 - pfSwing / CONFIG.pitchforkSwingDuration : 1;
    // Strike phase: continuously hit every crow within range every frame (no angular check)
    if (prog >= 0.28 && prog < 0.62) {
      const r2 = FEATHERS.pfRange() ** 2;
      for (let j = crows.length - 1; j >= 0; j--) {
        if (dist2(player.x, player.y, crows[j].x, crows[j].y) < r2) {
          killCrow(j);
          if (!pfHitFlash) {
            pfHitFlash = true;
            const tipX = player.x + Math.cos(player.aimAngle) * 44;
            const tipY = player.y + Math.sin(player.aimAngle) * 44;
            events.emit({ type: 'MELEE_HIT', x: tipX, y: tipY, kind: 'pitchfork', fire: false });
          }
        }
      }
      if (!pfBossHit && boss && appState === 'boss_fight' && boss.bstate !== 'dead' && !boss.shield &&
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
        killCrow(j);
        events.emit({ type: 'MELEE_HIT', x: c.x, y: c.y, kind: 'spear', fire: fsActive });
      }
    }
    // Boss: hit once in first half (phase 1), reset and hit again in second half (phase 2)
    const canHitBoss = boss && appState === 'boss_fight' && boss.bstate !== 'dead' && !boss.shield &&
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
        if (dist2(player.x, player.y, crows[j].x, crows[j].y) < wr2) killCrow(j);
      // Damage boss
      if (boss && appState === 'boss_fight' && boss.bstate !== 'dead' && !boss.shield &&
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

  if (shootPressed) { shootPressed = false; tryShoot(); }
}

function tryShoot() {
  if (selectedChar === 'wizard') { tryWizardBolt(); return; }
  if (selectedChar === 'knight') { tryKnightAttack(); return; }
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

function tryWizardBolt() {
  if (wizBoltCD > 0) { events.emit({ type: 'ACTION_BLOCKED' }); return; }
  if (arrows.length >= CONFIG.maxArrowsInFlight) return;
  let type = 'wiz_normal';
  let dmg  = CONFIG.wizBoltDamage;
  if      (inv.laserStreams > 0) { inv.laserStreams--; type = 'wiz_laser'; dmg = CONFIG.wizBoltDamage; }
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
    if (dist2(player.x, player.y, crows[j].x, crows[j].y) < r2) killCrow(j);
  if (boss && appState === 'boss_fight' && boss.bstate !== 'dead' && !boss.shield &&
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
      // Homing: steer toward nearest target
      if (a.homing) {
        let tgt = null, tDist2 = Infinity;
        for (const c of crows) { const d = dist2(a.x,a.y,c.x,c.y); if (d<tDist2){tDist2=d;tgt=c;} }
        if (!tgt && boss && appState==='boss_fight' && boss.bstate!=='dead') tgt = boss;
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
          killCrow(j);
          arrows.splice(i,1);
          wizHitCrow = true;
          break;
        }
      }
      if (wizHitCrow) continue;
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
          killCrow(j);
          a.pierceLeft--;
          events.emit({ type: 'JAVELIN_BOUNCE', x: a.x, y: a.y });
          if (a.pierceLeft <= 0) { arrows.splice(i,1); break; }
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

    // Boss hit. Ricochet arrows bounce and stay alive; everything else stops,
    // including on the shield, so no arrow passes through him.
    const arrowHit = resolveBossHit(a, CONFIG.arrowBossDamage, 'arrow');
    if (arrowHit === BossHit.DAMAGED) {
      if (a.type === 'fire') spawnFire(a.x, a.y);
      arrows.splice(i, 1); continue;
    }
    if (arrowHit === BossHit.ABSORBED) { arrows.splice(i, 1); continue; }
    if (arrowHit === BossHit.REFLECTED) continue;

    // Crow hit
    let hit = false;
    for (let j = crows.length - 1; j >= 0; j--) {
      if (dist2(a.x, a.y, crows[j].x, crows[j].y) < CONFIG.arrowHitRadius*CONFIG.arrowHitRadius) {
        killCrow(j); if (a.type === 'fire') spawnFire(a.x, a.y);
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
        if (dist2(f.x, f.y, crows[j].x, crows[j].y) < CONFIG.firePatchRadius*CONFIG.firePatchRadius) killCrow(j);
    }
  }
}

function onArrowMiss() {
  events.emit({ type: 'ARROW_MISS' }); aggroCrows(Math.random() < 0.5 ? 1 : 2);
  if (boss && appState === 'boss_fight' && boss.bstate === 'orbit') startBossCharge();
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

// ── DYNAMITES ─────────────────────────────────────────────────────────────────

function updateDynamites(dt) {
  for (let i = dynamites.length - 1; i >= 0; i--) {
    const d = dynamites[i];
    d.life -= dt; d.angle += dt * 5;

    if (d.life <= 0) { explodeDynamite(d); dynamites.splice(i, 1); continue; }

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
      events.emit({ type: 'DYNAMITE_SPLASH', x: d.x, y: d.y });
      dynamites.splice(i, 1); continue;
    }

    if (d.x <= 1 || d.x >= CONFIG.canvasW - 1) d.vx *= -0.65;
    if (d.y <= 1 || d.y >= CONFIG.rows * CONFIG.tileSize - 1) d.vy *= -0.65;
    d.vx *= 0.985; d.vy *= 0.985;
  }
}

function explodeDynamite(d) {
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
        tileMap.set(row, col, TILE.EMPTY);
    }
  }

  for (let j = crows.length - 1; j >= 0; j--)
    if (dist2(d.x, d.y, crows[j].x, crows[j].y) < r2) killCrow(j);
  if (boss && appState === 'boss_fight' && boss.bstate !== 'dead' && !boss.shield &&
      dist2(d.x, d.y, boss.x, boss.y) < r2) {
    damageBoss(CONFIG.dynamiteBossDamage, d.x, d.y, 'dynamite', 0.25);
  }
}

// ── CROWS ─────────────────────────────────────────────────────────────────────

function updateCrows(dt) {
  if (bossDeathSeq) return;
  // Serve last frame's queued path requests before crows move this frame.
  pathScheduler.serve(player.x, player.y);
  for (let i = crows.length - 1; i >= 0; i--) {
    const c = crows[i];
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
      const spd = (c.white ? CONFIG.whiteCrowAggroSpeed : CONFIG.crowAggroSpeed) * HANDICAP.crowSpeedMod();
      // Request a recompute when the cached path expires or runs out; the
      // scheduler serves it within a few frames. The crow keeps following its
      // stale path (or beelines when empty) until then.
      c.pathTimer -= dt;
      if (!c.path || c.path.length === 0 || c.pathTimer <= 0) pathScheduler.request(c);
      if (c.path && c.path.length > 0) {
        const wp = c.path[0];
        const wdx = wp.x - c.x, wdy = wp.y - c.y, wdist = Math.hypot(wdx, wdy);
        if (wdist < 6) { c.path.shift(); }                          // waypoint reached
        else { c.x += (wdx / wdist) * spd * dt; c.y += (wdy / wdist) * spd * dt; }
      } else {
        // No valid path (open space, already adjacent) — beeline directly
        c.x += (dx / dist) * spd * dt; c.y += (dy / dist) * spd * dt;
      }
      if (c.aggroTimer <= 0) { c.state = 'passive'; c.baseY = c.y; c.path = null; }
    }
  }
}

function aggroCrows(count) {
  // Only aggro crows that have line-of-sight to the player (rot.js FOV).
  // This prevents off-screen or wall-blocked crows from mysteriously turning hostile.
  const passive = crows
    .filter(c => {
      if (c.state !== 'passive') return false;
      return tileVisible(Math.floor(c.x / CONFIG.tileSize), Math.floor(c.y / CONFIG.tileSize));
    })
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

function checkPickupCollection() {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (dist2(player.x, player.y, p.x, p.y) >= CONFIG.pickupRadius*CONFIG.pickupRadius) continue;
    // Base ammo restore (archer only — wizard/knight use different systems)
    if (selectedChar === 'archer') {
      for (const [k, r] of Object.entries(CONFIG.resources))
        if (inv[k] < r.max) inv[k] = Math.min(r.max, inv[k] + r.restore);
    }
    // Type-specific bonus — effect differs by character
    if (p.type === 'ricochet') {
      if      (selectedChar === 'wizard') inv.laserStreams  += CONFIG.specialArrowPickupCount;
      else if (selectedChar === 'knight') inv.knightJavelins += CONFIG.knightJavelinsPerPickup;
      else                                inv.ricochetArrows += CONFIG.specialArrowPickupCount;
    } else if (p.type === 'fire') {
      if      (selectedChar === 'wizard') inv.fireBolts          += CONFIG.specialArrowPickupCount;
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
  if (escalationTimer >= CONFIG.crowEscalationInterval) {
    escalationTimer -= CONFIG.crowEscalationInterval;
    wave++;
    if (gameMode === 'waves') waveAnnounce = 2.2; // banner only in waves mode
    if (crows.length < CONFIG.crowMax) spawnCrow();
  }
}

// ── DAMAGE / BOSS ─────────────────────────────────────────────────────────────

function damagePlayer(amount, crowIndex = -1) {
  // Team gate: an attacker never hurts its own team. In single-player the
  // source is always an enemy, so this passes; it enforces the rule once
  // co-op puts two players on team A.
  const attacker = crowIndex >= 0 && crowIndex < crows.length ? crows[crowIndex].team : Team.ENEMY;
  if (!canDamage(attacker, player.team)) return;
  if (playerHitFlash > 0) return;
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
    const BOSS_TEXT = BOSS_ENTRY_TEXT;
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
  if (t >= 2.5) { if (boss) boss.bstate = 'orbit'; transitionTo('boss_fight'); }
}

function spawnBoss() {
  const hpMax = selectedChar === 'wizard' ? CONFIG.bossHPWizard
              : selectedChar === 'knight' ? CONFIG.bossHPKnight
              : CONFIG.bossHP;
  boss = {
    x: CONFIG.canvasW + 40, y: (CONFIG.rows / 2) * CONFIG.tileSize,
    hp: hpMax, hpMax,
    bstate: 'entering', stateTimer: 0,
    orbitAngle: 0, chargeTarget: null,
    wingPhase: 0, hitFlash: 0, screchCD: CONFIG.bossScreechInterval,
    batCD: CONFIG.bossBatCD, facing: 1,
    knockX: 0, knockY: 0,           // decaying shove offset from weapon hits
    burnTimer: 0, emberTimer: 0,    // fire-arrow burn: slows him and drains HP
    burnDps: 0,                     // damage per second for the burn now running
    // Shield state machine
    shield: true,
    shieldPhase: 'initial',           // 'initial' | 'open' | 'shielded'
    shieldTimer: CONFIG.bossShieldInitialDuration,
    shieldCount: 0,                   // random re-shields used this window
    shieldWindowTimer: CONFIG.bossShieldWindowDuration,
  };
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
  const dx = boss.x - fromX, dy = boss.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  boss.knockX += (dx / d) * CONFIG.bossKnockback;
  boss.knockY += (dy / d) * CONFIG.bossKnockback;
  events.emit({ type: 'BOSS_HIT', source });
  applyBossDamage(amount);
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
  if (!boss || appState !== 'boss_fight' || boss.bstate === 'dead') return BossHit.MISS;
  if (dist2(a.x, a.y, boss.x, boss.y) >= CONFIG.bossHitRadius * CONFIG.bossHitRadius)
    return BossHit.MISS;

  // Read once, before the damage below can start the death sequence
  const blocked = boss.shield;

  if (blocked) {
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

/** Speed multiplier for boss movement. Burning slows him. */
function bossSpeedMod() {
  return boss.burnTimer > 0 ? 1 - CONFIG.bossBurnSlowdown : 1;
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

  // ── Shield phase machine ─────────────────────────────────────────────────
  // Rolling 30s window: reset shield-use counter each window
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
  // ────────────────────────────────────────────────────────────────────────

  if (boss.bstate === 'orbit' || boss.bstate === 'charge') {
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
  }

  if (boss.bstate === 'orbit') {
    boss.stateTimer += dt;
    const angSpd = CONFIG.bossOrbitSpeed * bossSpeedMod() / CONFIG.bossOrbitRadius;
    boss.orbitAngle += angSpd * dt;
    boss.x = Math.max(CONFIG.bossRadius, Math.min(CONFIG.canvasW - CONFIG.bossRadius, player.x + Math.cos(boss.orbitAngle) * CONFIG.bossOrbitRadius));
    boss.y = Math.max(CONFIG.bossRadius, Math.min(CONFIG.rows * CONFIG.tileSize - CONFIG.bossRadius, player.y + Math.sin(boss.orbitAngle) * CONFIG.bossOrbitRadius));
    if (dist2(boss.x, boss.y, player.x, player.y) < CONFIG.bossRadius*CONFIG.bossRadius) { damagePlayer(CONFIG.bossContactDamage); events.emit({ type: 'BOSS_CONTACT' }); }
    if (boss.stateTimer >= CONFIG.bossOrbitDuration) startBossCharge();

  } else if (boss.bstate === 'charge') {
    if (!boss.chargeTarget) { boss.bstate = 'orbit'; boss.stateTimer = 0; return; }
    const dx = boss.chargeTarget.x - boss.x, dy = boss.chargeTarget.y - boss.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 12) {
      boss.bstate = 'orbit'; boss.stateTimer = 0; boss.chargeTarget = null;
    } else {
      const spd = CONFIG.bossChargeSpeed * bossSpeedMod() * dt;
      boss.x += (dx/dist)*spd; boss.y += (dy/dist)*spd;
      if (dist2(boss.x, boss.y, player.x, player.y) < CONFIG.bossRadius*CONFIG.bossRadius) {
        damagePlayer(CONFIG.bossContactDamage); events.emit({ type: 'BOSS_CONTACT' });
        boss.bstate = 'orbit'; boss.stateTimer = 0; boss.chargeTarget = null;
      }
    }
  } else if (boss.bstate === 'screech') {
    boss.stateTimer -= dt;
    if (boss.stateTimer <= 0) { boss.bstate = 'orbit'; boss.stateTimer = 0; }
  }

  applyBossKnockback(dt);
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
  if (s.timer >= 1.2) { bossDeathSeq = null; boss = null; crows = []; transitionTo('win'); }
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
  const localAngle = f===1 ? player.aimAngle : Math.PI - player.aimAngle;

  // Ground shadow
  ctx.fillStyle='rgba(0,0,0,0.40)';
  ctx.beginPath(); ctx.ellipse(0,11,9,2.5,0,0,Math.PI*2); ctx.fill();

  // Robe
  const sway = 1.4 * Math.sin((player.walkPhase||0)*0.7);
  ctx.beginPath();
  ctx.moveTo(-8, 13+sway); ctx.lineTo(-6,-1); ctx.lineTo(6,-1); ctx.lineTo(8,13-sway);
  ctx.closePath();
  ctx.fillStyle = flashOn ? '#553377' : '#14143a';
  ctx.fill();
  ctx.shadowColor='#8888FF'; ctx.shadowBlur=3;
  ctx.strokeStyle='#4444aa'; ctx.lineWidth=1; ctx.stroke(); ctx.shadowBlur=0;

  // Robe centre stripe + emblem star
  ctx.fillStyle='#22225a'; ctx.fillRect(-4,0,8,8);
  ctx.shadowColor='#FFB400'; ctx.shadowBlur=4;
  ctx.fillStyle='#FFB400';
  ctx.beginPath(); ctx.arc(0,3,2,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;

  // Head
  ctx.fillStyle = flashOn ? '#ffddcc' : '#D9B98A';
  ctx.beginPath(); ctx.arc(0,-7,5,0,Math.PI*2); ctx.fill();

  // Pointed hat
  const hatWobble = 1.6*Math.sin(loopT*1.9);
  ctx.fillStyle = flashOn ? '#553377' : '#14143a';
  ctx.beginPath(); ctx.moveTo(-7,-10); ctx.lineTo(0,-25+hatWobble); ctx.lineTo(7,-10);
  ctx.closePath(); ctx.fill();
  ctx.shadowColor='#8888FF'; ctx.shadowBlur=2;
  ctx.strokeStyle='#4444aa'; ctx.lineWidth=0.8; ctx.stroke(); ctx.shadowBlur=0;
  ctx.fillStyle='#22225a'; ctx.fillRect(-9,-12,18,2.5);
  // Hat star
  ctx.fillStyle='#FFB400'; ctx.shadowColor='#FFB400'; ctx.shadowBlur=5;
  ctx.fillRect(-0.5,-20+hatWobble,1,1); ctx.shadowBlur=0;

  // Staff arm toward aim
  const sx = Math.cos(localAngle)*15, sy = Math.sin(localAngle)*15;
  ctx.strokeStyle='#5c3317'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(sx,sy); ctx.stroke();

  // Orb
  const op = loopT*4.5;
  ctx.shadowColor='#8888FF'; ctx.shadowBlur=10+4*Math.sin(op);
  ctx.fillStyle=`rgba(136,136,255,${(0.85+0.15*Math.sin(op)).toFixed(2)})`;
  ctx.beginPath(); ctx.arc(sx,sy,4+0.5*Math.sin(op),0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.arc(sx-1,sy-1,1.2,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;

  // Bolt cooldown ring around orb
  if (wizBoltCD > 0) {
    const fill = 1 - wizBoltCD/3.0;
    ctx.save(); ctx.globalAlpha=0.65;
    ctx.strokeStyle='#8888FF'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(sx,sy,7,-Math.PI/2,-Math.PI/2+fill*Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // Shield halo
  if (playerShield) {
    const shP = loopT*4;
    ctx.shadowColor='#FFB400'; ctx.shadowBlur=14+5*Math.sin(shP);
    ctx.strokeStyle=`rgba(255,180,0,${(0.6+0.3*Math.sin(shP)).toFixed(2)})`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,0,16+Math.sin(shP*1.3),0,Math.PI*2); ctx.stroke();
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

function drawPlayer() {
  if (selectedChar === 'wizard') { drawWizard(); return; }
  if (selectedChar === 'knight') { drawKnight(); return; }
  const px = player.x, py = player.y + CONFIG.hudHeight, f = player.facing;

  // Aim line
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

  // Chromatic aberration ghost on hit
  if (playerHitFlash > 0.15) {
    const off = Math.round(playerHitFlash * 5);
    ctx.save(); ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(px - 5 + off, py - 7, 10, 14);
    ctx.fillStyle = '#0044ff'; ctx.fillRect(px - 5 - off, py - 7, 10, 14);
    ctx.restore();
  }

  ctx.save(); ctx.translate(px, py); ctx.scale(f, 1);
  const localAngle = f === 1 ? player.aimAngle : Math.PI - player.aimAngle;
  const flashOn = playerHitFlash > 0 && Math.floor(playerHitFlash * 20) % 2 === 0;

  // 1. Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 9, 9, 2.5, 0, 0, Math.PI*2); ctx.fill();

  // 2. Cloak (drawn before body so body covers front)
  const cloakSway   = 0.15 * Math.sin(loopT * 2.2);
  const cloakOffset = 1.5  * Math.sin((player.walkPhase || 0) + cloakSway);
  ctx.beginPath();
  ctx.moveTo(-5, -3);
  ctx.bezierCurveTo(-9, 0, -9, 4, -7, 7 + cloakOffset);
  ctx.lineTo(7, 7 - cloakOffset);
  ctx.bezierCurveTo(9, 4, 9, 0, 5, -3);
  ctx.closePath();
  ctx.fillStyle = flashOn ? '#882222' : '#0E1410'; ctx.fill();
  ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 3;
  ctx.strokeStyle = '#39FF14'; ctx.lineWidth = 1; ctx.stroke();
  ctx.shadowBlur = 0;

  // 3. Body / tunic
  ctx.fillStyle = flashOn ? '#6688cc' : '#3A5F88'; ctx.fillRect(-5, -3, 10, 11);
  ctx.fillStyle = '#0E1410'; ctx.fillRect(-5, 3, 10, 1); // belt

  // 4. Head
  ctx.fillStyle = flashOn ? '#ffddcc' : '#D9B98A';
  ctx.beginPath(); ctx.arc(0, -8, 5, 0, Math.PI*2); ctx.fill();

  // 5. Hat
  ctx.fillStyle = '#0E1410';
  ctx.fillRect(-5, -13, 10, 3);
  ctx.fillRect(-6, -10, 12, 1);

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
    // 6. Bow arm
    const gx = Math.cos(localAngle) * 8, gy = Math.sin(localAngle) * 8;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#D9B98A'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(gx, gy); ctx.stroke();

    // 7. Bow (half-circle arc facing aim direction)
    ctx.strokeStyle = '#8A6028'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(gx, gy, 7, localAngle - Math.PI/2, localAngle + Math.PI/2); ctx.stroke();

    // 8. Bowstring
    const bowTop = { x: gx + Math.cos(localAngle - Math.PI/2)*7, y: gy + Math.sin(localAngle - Math.PI/2)*7 };
    const bowBot = { x: gx + Math.cos(localAngle + Math.PI/2)*7, y: gy + Math.sin(localAngle + Math.PI/2)*7 };
    const nxOff  = gx + (-Math.cos(localAngle)) * 3;
    const nyOff  = gy + (-Math.sin(localAngle)) * 3;
    ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 4;
    ctx.strokeStyle = '#39FF14'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bowTop.x, bowTop.y); ctx.lineTo(nxOff, nyOff); ctx.lineTo(bowBot.x, bowBot.y); ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
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
  ctx.restore();

  // Pitchfork range indicators (outside sprite transform, world coordinates)
  if (inv.arrows <= 0 && inv.ricochetArrows <= 0 && inv.fireArrows <= 0) {
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

  // Dynamite charge bar
  if (charge.on) {
    const chargeFrac = Math.min(1, (performance.now() - charge.t0) / 1000);
    const bw = 28, bh = 4, bx = px - bw/2, by = py - 34;
    ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = chargeFrac < 0.5 ? '#ffcc00' : chargeFrac < 0.85 ? '#ff8800' : '#ff2200';
    ctx.fillRect(bx, by, bw * chargeFrac, bh);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 0.5; ctx.strokeRect(bx, by, bw, bh);
  }
}

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

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(0, 14, 13, 4, 0, 0, Math.PI*2); ctx.fill();

  const bob      = Math.sin(player.walkPhase || 0) * 1.2;
  const fsActive = inv.knightFireSwordTimer > 0;
  const swing    = knightSpearSwing > 0 ? 1 - knightSpearSwing / CONFIG.knightSpearSwingDuration : -1;

  // Legs — plate greaves
  ctx.fillStyle = '#1e2030';
  ctx.fillRect(-9, 7 + bob, 8, 10);
  ctx.fillRect(1,  7 + bob, 8, 10);
  ctx.fillStyle = '#2a2c3e';
  ctx.fillRect(-8, 7 + bob, 3, 4);
  ctx.fillRect(2,  7 + bob, 3, 4);

  // Torso — plate breastplate
  ctx.fillStyle = fsActive ? '#3a2010' : '#242436';
  ctx.fillRect(-11, -13 + bob, 22, 20);
  // Highlight stripe
  ctx.fillStyle = fsActive ? '#5a3018' : '#34364e';
  ctx.fillRect(-9, -12 + bob, 8, 7);
  // Pauldrons
  ctx.fillStyle = fsActive ? '#2a1808' : '#181826';
  ctx.fillRect(-15, -13 + bob, 6, 8);
  ctx.fillRect(9,   -13 + bob, 6, 8);
  // Pauldron rivets
  ctx.fillStyle = '#888';
  ctx.beginPath(); ctx.arc(-12, -10 + bob, 1.2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(12,  -10 + bob, 1.2, 0, Math.PI*2); ctx.fill();

  // Helmet — great helm style
  ctx.fillStyle = fsActive ? '#3a1a08' : '#1e2030';
  ctx.fillRect(-8, -26 + bob, 16, 14);
  ctx.beginPath(); ctx.arc(0, -26 + bob, 8, Math.PI, 0); ctx.fill();
  // Visor slits (2 horizontal bars)
  ctx.fillStyle = fsActive ? '#FF5500' : '#39FF14';
  ctx.shadowColor = fsActive ? '#FF7A1F' : '#39FF14';
  ctx.shadowBlur  = 5;
  ctx.fillRect(-6, -22 + bob, 12, 2);
  ctx.fillRect(-4, -18 + bob, 8,  2);
  ctx.shadowBlur = 0;
  // Helmet crest / plume
  ctx.fillStyle = fsActive ? '#cc3300' : '#2244aa';
  ctx.beginPath();
  ctx.moveTo(-3, -26 + bob); ctx.lineTo(0, -34 + bob); ctx.lineTo(3, -26 + bob);
  ctx.closePath(); ctx.fill();

  // ── Weapon ───────────────────────────────────────────────────────────────
  const spearAng = Math.atan2(Math.sin(player.aimAngle), f * Math.cos(player.aimAngle)); // world-space angle mapped into flipped canvas
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

  ctx.restore();
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

  // Per-spec palettes
  const bodyCol  = isWhite ? '#E8E8E8' : '#0A0A0A';
  const edgeCol  = isWhite ? '#FFFFFF' : '#1F1F1F';
  const wingCol  = isWhite ? '#E8E8E8' : '#0A0A0A';
  const beakCol  = isWhite ? '#FF1F1F' : '#FFB400';
  const eyeCol   = isWhite ? '#FF1F1F' : '#FFB400';
  const glintCol = isWhite ? '#FFFFFF' : '#FF1F1F';
  const shadowFill = isWhite ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
  const eyeBlur  = isWhite ? 4 + 2*Math.sin(loopT*4 + ep) : 3;

  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy);

  // 1. Ground shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle = shadowFill;
  ctx.beginPath(); ctx.ellipse(0, 6, 7, 1.8, 0, 0, Math.PI*2); ctx.fill();

  // 2. Body
  ctx.fillStyle = bodyCol;
  ctx.beginPath(); ctx.ellipse(0, bobY, 8, 5, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = edgeCol; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, bobY, 8, 5, 0, 0, Math.PI*2); ctx.stroke();

  // 3. Tail — faces +x (right), crow moves left so tail trails behind
  ctx.fillStyle = bodyCol;
  ctx.beginPath();
  ctx.moveTo(6, bobY + 1); ctx.lineTo(11, bobY - 2); ctx.lineTo(11, bobY + 4);
  ctx.closePath(); ctx.fill();

  // 4. Far wing (left side, +π phase)
  const lwPhase = c.wingPhase + Math.PI;
  const lwY     = bobY - 2 + Math.sin(lwPhase) * 3;
  const lwRot   = -0.4 + 0.5 * Math.sin(lwPhase);
  ctx.fillStyle = wingCol;
  ctx.beginPath(); ctx.ellipse(-3, lwY, 8, 3, lwRot, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = edgeCol; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(-3, lwY, 8, 3, lwRot, 0, Math.PI*2); ctx.stroke();

  // 5. Near wing (right side)
  const rwY   = bobY - 2 + Math.sin(c.wingPhase) * 3;
  const rwRot = -0.4 + 0.5 * Math.sin(c.wingPhase);
  ctx.fillStyle = wingCol;
  ctx.beginPath(); ctx.ellipse(3, rwY, 8, 3, rwRot, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = edgeCol; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(3, rwY, 8, 3, rwRot, 0, Math.PI*2); ctx.stroke();

  // 6. Beak — faces -x (crow flies left)
  ctx.fillStyle = beakCol;
  ctx.beginPath();
  ctx.moveTo(-9, bobY - 0.5); ctx.lineTo(-13, bobY); ctx.lineTo(-9, bobY + 1.5);
  ctx.closePath(); ctx.fill();

  // 7. Eye — stamped glow, one per (color, blur step) across the whole flock
  const eyeStamp = glowDotStamp(eyeCol, 1.2, eyeBlur);
  ctx.drawImage(eyeStamp, -6 - eyeStamp.width / 2, bobY - 1.5 - eyeStamp.height / 2);

  // 8. Eye glint (2×2 when aggro, 1×1 otherwise)
  if (isAggro) {
    const gs = glowRectStamp('#FF1F1F', 2, 2, 5);
    ctx.drawImage(gs, -5 - gs.width / 2, bobY - 0.5 - gs.height / 2);
  } else {
    ctx.fillStyle = glintCol;
    ctx.fillRect(-6, bobY - 1.5, 1, 1);
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

  ctx.restore();
}

function drawPickups() {
  for (const p of pickups) {
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

function drawBoss() {
  if (bossDeathSeq) {
    for (const f of bossDeathSeq.fragments) {
      if (f.alpha <= 0) continue;
      ctx.save(); ctx.globalAlpha = Math.max(0, f.alpha); ctx.fillStyle = '#8B0000';
      ctx.fillRect(f.x-f.w/2, f.y+CONFIG.hudHeight-f.h/2, f.w, f.h); ctx.restore();
    }
  }
  if (!boss || boss.bstate === 'dead') return;
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

  // 3. Far wing
  const farRot = 0.3 + 0.4 * Math.sin(wPhase);
  const farY   = bobY - 2 + Math.sin(wPhase) * 5;
  ctx.fillStyle = '#5A0808';
  ctx.beginPath(); ctx.ellipse(4, farY, 28, 11, farRot, 0, Math.PI*2); ctx.fill();

  // 4. Far wing edge feathers (5 tufts along outer arc)
  ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5;
  ctx.save(); ctx.translate(4, farY); ctx.rotate(farRot);
  [0.2, 0.4, 0.55, 0.7, 0.85].forEach(frac => {
    const t = frac * Math.PI;
    const ex = Math.cos(t) * 28, ey = Math.sin(t) * 11;
    const nLen = Math.hypot(Math.cos(t)/28, Math.sin(t)/11);
    const nx = (Math.cos(t)/28)/nLen, ny = (Math.sin(t)/11)/nLen;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + nx*6, ey + ny*6); ctx.stroke();
  });
  ctx.restore();

  // 5. Body
  ctx.fillStyle = '#050505';
  ctx.beginPath(); ctx.ellipse(0, bobY, 28, 18, 0, 0, Math.PI*2); ctx.fill();

  // 6. Body highlight
  ctx.fillStyle = '#1A1A1A';
  ctx.beginPath(); ctx.ellipse(-5, bobY - 4, 14, 6, 0, 0, Math.PI*2); ctx.fill();

  // 7. Crown spikes — 5 triangles, heights 5/8/11/8/5
  const spikeXs = [-16, -8, 0, 8, 16];
  const spikeHs = [5, 8, 11, 8, 5];
  const spikeBaseY = bobY - 18;
  for (let si = 0; si < 5; si++) {
    const sx = spikeXs[si], sh = spikeHs[si];
    ctx.fillStyle = '#0A0A0A';
    ctx.beginPath();
    ctx.moveTo(sx - 4, spikeBaseY); ctx.lineTo(sx, spikeBaseY - sh); ctx.lineTo(sx + 4, spikeBaseY);
    ctx.closePath(); ctx.fill();
    // Rim light on spike
    ctx.strokeStyle = '#5A0808'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 4, spikeBaseY); ctx.lineTo(sx, spikeBaseY - sh); ctx.lineTo(sx + 4, spikeBaseY);
    ctx.stroke();
  }

  // 8. Beak — large triangle facing left
  ctx.fillStyle = '#3A0606';
  ctx.beginPath();
  ctx.moveTo(-26, bobY - 1); ctx.lineTo(-38, bobY); ctx.lineTo(-26, bobY + 5);
  ctx.closePath(); ctx.fill();

  // 9. Eyes — two stacked
  const eyeBlur = 10 + 5 * Math.sin(loopT * 8);
  ctx.shadowColor = '#FF1F1F'; ctx.shadowBlur = eyeBlur;
  ctx.fillStyle = '#FF1F1F';
  ctx.beginPath(); ctx.arc(-21, bobY - 4, 5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(-21, bobY + 3, 5, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // 10. Eye cores (1×1 amber dot in each eye)
  ctx.fillStyle = '#FFB400';
  ctx.fillRect(-21, bobY - 4, 1, 1);
  ctx.fillRect(-21, bobY + 3, 1, 1);

  // 11. Near wing (overlaps body on player side)
  const nearRot = 0.3 + 0.4 * Math.sin(wPhase + Math.PI);
  const nearY   = bobY - 2 + Math.sin(wPhase + Math.PI) * 5;
  ctx.fillStyle = '#8A1010';
  ctx.beginPath(); ctx.ellipse(-4, nearY, 28, 11, nearRot, 0, Math.PI*2); ctx.fill();

  // 12. Near wing edge feathers
  ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5;
  ctx.save(); ctx.translate(-4, nearY); ctx.rotate(nearRot);
  [0.2, 0.4, 0.55, 0.7, 0.85].forEach(frac => {
    const t = frac * Math.PI;
    const ex = Math.cos(t) * 28, ey = Math.sin(t) * 11;
    const nLen = Math.hypot(Math.cos(t)/28, Math.sin(t)/11);
    const nx = (Math.cos(t)/28)/nLen, ny = (Math.sin(t)/11)/nLen;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + nx*6, ey + ny*6); ctx.stroke();
  });
  ctx.restore();

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
    const BOSS_TEXT = BOSS_ENTRY_TEXT;
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

  // Resources — archer quiver OR wizard cooldowns
  ctx.font = 'bold 10px "Courier New", monospace';
  let rx = isBoss ? 692 : 568;
  ctx.textAlign = 'left';
  if (selectedChar === 'archer') {
    for (const [k, r] of Object.entries(CONFIG.resources)) {
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
    if (inv.knightJavelins    > 0) { ctx.fillStyle='#D0D0E8'; ctx.fillText(`[J:${inv.knightJavelins}]`, rx, 16); rx+=48; }
    if (inv.knightFireSwordTimer > 0) {
      ctx.fillStyle='#FF7A1F';
      ctx.fillText(`[FS:${inv.knightFireSwordTimer.toFixed(1)}s]`, rx, 16); rx+=70;
    }
  } else {
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

function _drawCharPreview(cx, cy, char, t) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(2, 2);
  if (char === 'archer') {
    // Cloak
    ctx.fillStyle='#0E1410'; ctx.beginPath();
    ctx.moveTo(-5,-3); ctx.bezierCurveTo(-9,0,-9,4,-7,7); ctx.lineTo(7,7); ctx.bezierCurveTo(9,4,9,0,5,-3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#39FF14'; ctx.lineWidth=0.5; ctx.stroke();
    // Body
    ctx.fillStyle='#3A5F88'; ctx.fillRect(-5,-3,10,11);
    // Head
    ctx.fillStyle='#D9B98A'; ctx.beginPath(); ctx.arc(0,-8,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#0E1410'; ctx.fillRect(-5,-13,10,3); ctx.fillRect(-6,-10,12,1);
    // Bow
    ctx.shadowColor='#8A6028'; ctx.shadowBlur=2;
    ctx.strokeStyle='#8A6028'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(8,0,7,-Math.PI/2,Math.PI/2); ctx.stroke();
    ctx.strokeStyle='#39FF14'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(8,-7); ctx.lineTo(8,7); ctx.stroke();
    ctx.shadowBlur=0;
  } else if (char === 'wizard') {
    // Robe
    const sw=1.2*Math.sin(t*1.8);
    ctx.fillStyle='#14143a';
    ctx.beginPath(); ctx.moveTo(-8,13+sw); ctx.lineTo(-6,-1); ctx.lineTo(6,-1); ctx.lineTo(8,13-sw); ctx.closePath(); ctx.fill();
    ctx.shadowColor='#8888FF'; ctx.shadowBlur=3;
    ctx.strokeStyle='#4444aa'; ctx.lineWidth=0.6; ctx.stroke(); ctx.shadowBlur=0;
    ctx.fillStyle='#22225a'; ctx.fillRect(-4,0,8,8);
    ctx.fillStyle='#FFB400'; ctx.beginPath(); ctx.arc(0,3,2,0,Math.PI*2); ctx.fill();
    // Head
    ctx.fillStyle='#D9B98A'; ctx.beginPath(); ctx.arc(0,-7,5,0,Math.PI*2); ctx.fill();
    // Hat
    const hw=1.5*Math.sin(t*1.9);
    ctx.fillStyle='#14143a';
    ctx.beginPath(); ctx.moveTo(-7,-10); ctx.lineTo(0,-25+hw); ctx.lineTo(7,-10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#4444aa'; ctx.lineWidth=0.5; ctx.stroke();
    ctx.fillStyle='#22225a'; ctx.fillRect(-9,-12,18,2.5);
    // Orb
    const op2=t*4;
    ctx.shadowColor='#8888FF'; ctx.shadowBlur=8+3*Math.sin(op2);
    ctx.fillStyle=`rgba(136,136,255,${(0.85+0.15*Math.sin(op2)).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(12,-2+0.5*Math.sin(op2),4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(11,-3,1.2,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
  } else {
    // Knight — plate armour mini-preview
    // Legs
    ctx.fillStyle='#1e2030'; ctx.fillRect(-7,5,6,9); ctx.fillRect(1,5,6,9);
    ctx.fillStyle='#2a2c3e'; ctx.fillRect(-6,5,2,4); ctx.fillRect(2,5,2,4);
    // Torso
    ctx.fillStyle='#242436'; ctx.fillRect(-8,-10,16,16);
    ctx.fillStyle='#34364e'; ctx.fillRect(-7,-9,7,5);
    ctx.fillStyle='#181826'; ctx.fillRect(-11,-10,4,7); ctx.fillRect(7,-10,4,7);
    // Helmet
    ctx.fillStyle='#1e2030'; ctx.fillRect(-6,-22,12,13);
    ctx.beginPath(); ctx.arc(0,-22,6,Math.PI,0); ctx.fill();
    ctx.fillStyle='#39FF14'; ctx.shadowColor='#39FF14'; ctx.shadowBlur=4;
    ctx.fillRect(-5,-18,10,2); ctx.fillRect(-3,-15,6,2); ctx.shadowBlur=0;
    // Helmet crest
    ctx.fillStyle='#2244aa';
    ctx.beginPath(); ctx.moveTo(-2,-22); ctx.lineTo(0,-29); ctx.lineTo(2,-22); ctx.closePath(); ctx.fill();
    // Spear
    const sa = -0.35 + 0.1*Math.sin(t*1.5);
    ctx.save(); ctx.rotate(sa);
    ctx.strokeStyle='#5a3a10'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(18,0); ctx.stroke();
    ctx.fillStyle='#D0D0D8';
    ctx.beginPath(); ctx.moveTo(16,-4); ctx.lineTo(24,0); ctx.lineTo(16,4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
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

  const panelW=296, panelH=390, gapX=18;
  const totalW = panelW*3 + gapX*2;
  const startX = CONFIG.canvasW/2 - totalW/2;
  const panelY = 118;
  const panels = [
    { char:'archer', key:'A', color:'#39FF14', bg:'rgba(57,255,20,0.08)',  dim:'#1a7a08',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
      lines:['Longbow  ·  Quiver system','Up to 3 arrows in-flight',
             'Pickup: Fire / Ricochet arrows','Tool: Dynamite (charged throw)','Classic playstyle'] },
    { char:'wizard', key:'W', color:'#8888FF', bg:'rgba(100,80,255,0.10)', dim:'#1a1a6a',  dimBg:'rgba(255,255,255,0.025)', newBadge:false,
      lines:['Homing magic bolts  3s CD','Fire Bolt pickup: 2 dmg homing',
             'Laser pickup: pierces walls','Special: Lightning Storm AoE','Caster playstyle'] },
    { char:'knight', key:'K', color:'#C8C8E8', bg:'rgba(150,160,200,0.10)',dim:'#2a2a4a',  dimBg:'rgba(255,255,255,0.025)', newBadge:true,
      lines:['Long spear  ·  melee range','Pickup: Iron Javelin (throws/pierces)',
             'Pickup: Fire Sword (2× dmg/range)','Tool: Whirlwind (breaks tiles)','Frontline playstyle'] },
  ];

  panels.forEach((p, idx) => {
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
  });

  ctx.fillStyle='#0d4d04'; ctx.font='14px "Courier New",monospace';
  ctx.fillText('← →  /  [A] [W] [K]  SWITCH    ENTER  CONFIRM', CONFIG.canvasW/2, CONFIG.canvasH-22);
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
  { label: 'SNIPE MODE', key: 'snipe' },
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
  let hp = '';
  for (let i = 0; i < CONFIG.playerMaxHP; i++) hp += i < winHP ? '♥' : '♡';
  ctx.fillText(`HP REMAINING:  ${hp}`, CONFIG.canvasW/2, 328);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0a3a06'; ctx.font = '13px "Courier New", monospace';
  ctx.fillText(`[ ${gameMode.toUpperCase()} MODE ]`, CONFIG.canvasW/2, 358);

  ctx.fillStyle = '#1a7a08'; ctx.font = '18px "Courier New", monospace';
  ctx.fillText(`[R] PLAY AGAIN${Math.floor(t*2)%2===0 ? '_' : ' '}   [M] MENU`, CONFIG.canvasW/2, 400);
}

const GAME_VISIBLE_STATES = new Set(['playing','paused','boss_entrance','boss_fight']);

function render(t) {
  const gameVisible = GAME_VISIBLE_STATES.has(appState);
  if (gameVisible) {
    ctx.fillStyle = '#0a140a'; ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
    const so = shakeOffset(t);
    ctx.save(); ctx.translate(so.x, so.y);
    drawTiles(); FORESHADOW.drawSkyTint(); drawPickups(); drawFires(); drawParticles();
    crows.forEach(drawCrow);
    drawArrows(); drawDynamites(); drawPlayer(); drawBoss(); drawFloaters();
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
      ctx.fillText(`── WAVE ${wave} ──`, CONFIG.canvasW/2, CONFIG.canvasH/2);
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
  } else if (appState === 'multiplayer'){ multiplayerSession?.frame(keys, { x: mouse.x, y: mouse.y, fire: mouseLeftHeld, special: mouseRightHeld });
  } else if (appState === 'menu')       { drawMenu(t);
  } else if (appState === 'charselect') { drawCharSelect(t);
  } else if (appState === 'controls')   { drawControls(t);
  } else if (appState === 'gameover')   { drawGameOver(t);
  } else if (appState === 'win')        { drawWin(t);
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
      const chars = ['archer','wizard','knight'];
      const ci = chars.indexOf(selectedChar);
      if (keys['ArrowLeft'])  { selectedChar = chars[(ci+2)%3]; keys['ArrowLeft']=false; }
      if (keys['ArrowRight']) { selectedChar = chars[(ci+1)%3]; keys['ArrowRight']=false; }
      if (keys['a']||keys['A']) { selectedChar='archer'; keys['a']=keys['A']=false; }
      if (keys['w']||keys['W']) { selectedChar='wizard'; keys['w']=keys['W']=false; }
      if (keys['k']||keys['K']) { selectedChar='knight'; keys['k']=keys['K']=false; }
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
      updateFOV(); updatePlayer(dt); updateArrows(dt); updateDynamites(dt); updateCrows(dt);
      updatePickups(dt); updateParticles(dt); updateFloaters(dt); updateFires(dt); checkPickupCollection(); updateEscalation(dt);
      FORESHADOW.update(dt); STREAK.update(dt); BOUNTIES.update(dt);
      break;

    case 'boss_entrance':
      updateBossEntrance(dt); updateParticles(dt); updateFloaters(dt);
      break;

    case 'boss_fight':
      if (keys['Escape']) { pausedFrom='boss_fight'; transitionTo('paused'); keys['Escape']=false; break; }
      gameTime += dt;
      updateFOV(); updatePlayer(dt); updateArrows(dt); updateDynamites(dt); updateCrows(dt);
      updatePickups(dt); updateParticles(dt); updateFloaters(dt); updateFires(dt); checkPickupCollection();
      if (bossDeathSeq) updateBossDeath(dt); else updateBoss(dt);
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
  requestAnimationFrame(loop);
}

FEATHERS.init();
requestAnimationFrame(loop);

// Pure classes exposed for the test harness in tests.html.
window.CrowArcherInternals = { TILE, TileMap, PathScheduler, FovMap };

// Dev hook: steps the loop with fixed timestamps and exposes read access to
// module state, so headless verification works while the tab is backgrounded.
let __devTs = 0;
window.__game = {
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
  blast(x, y) { explodeDynamite({ x, y, vx: 0, vy: 0, life: 0, angle: 0 }); },
  floaters: () => floaters,
  arrows: () => arrows,
  pickups: () => pickups,
  boss: () => boss,
  // Tap the event bus, for verifying which gameplay events fire.
  onEvent: fn => events.on(fn),
  // Drive a real state transition, and pick a character, for scripted runs.
  go(s) { transitionTo(s); },
  pick(c) { selectedChar = c; },
  spawnCrow() { spawnCrow(); },
  key(k) {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true });
    window.dispatchEvent(e); document.dispatchEvent(e);
  },
  state: () => appState,
  multiplayer: () => multiplayerSession?.describe() ?? null,
  tiles: () => tileMap,
  player: () => player,
  crows: () => crows,
  mouse: () => mouse,
  counts: () => ({ crows: crows.length, particles: particles.length, hp: playerHP }),
};
