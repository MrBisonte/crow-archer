/**
 * The hero drift ledger.
 *
 * This game implements its heroes TWICE — `src/legacy/game.js` (single
 * player) and `src/sim/weapons.ts` (the server-authoritative multiplayer
 * sim) — built independently, with per-hero figures hand-copied between
 * them. Nothing else in the suite compares the two, so a tune on one side
 * has never once been caught by a red test. This file is that catch.
 *
 * For every hero's primary and secondary weapon, each governing figure is
 * read live from BOTH runtimes (never retyped — see the two rules below)
 * and given exactly one of four relationships:
 *
 *   - shared    both sides read the very same constant, through
 *               `./weapon-figures`, which `CONFIG` imports too.
 *   - copied    two independently-declared constants that currently hold
 *               the same value. Asserted equal so a future tune on either
 *               side that breaks the coincidence fails here, by name.
 *   - scaled    deliberately different by a named factor (documented in
 *               weapons.ts's own comments). Asserted on the RATIO.
 *   - diverged  the two disagree and no one has decided whether that is
 *               correct. Both current values are pinned so a further move
 *               on EITHER side is a named failure, not silent drift.
 *
 * Two rules keep this file honest:
 *
 *   1. Legacy figures come from `devHooks.config()` on the real module —
 *      never a hand-typed copy of what CONFIG currently holds.
 *   2. Where a legacy figure has no CONFIG entry at all (a bare numeric
 *      literal inside a function body — the knight's spear thrust, the
 *      dynamite bounce coefficient, the whirlwind's per-tick damage), there
 *      is no module accessor to read it through. Retyping it here would be
 *      exactly the bug this file exists to catch, so those pairs are
 *      logged as `it.todo` instead of asserted — see "COULD NOT COMPARE"
 *      below each hero's block, and the top-level report handed back for
 *      this task names every one.
 *
 * PACE_PRESETS: none of the figures compared below are pace-owned (see
 * CLAUDE.md and PACE_PRESETS in game.js). Two pace-owned figures that would
 * otherwise look comparable — DYNAMITE_CARRIED/SATCHEL_CARRIED versus
 * `resources.dynamites.max` — are deliberately left out of the table for
 * exactly that reason: pinning a number that depends on the difficulty
 * would be pinning the wrong thing.
 *
 * DAMAGE is mostly excluded on purpose, not by oversight. weapons.ts's own
 * file header says why: single-player has no PvP damage at all (a body
 * dies to one hit of anything; every legacy damage CONFIG figure is a
 * BOSS-only number against a ~10-20 HP pool), while every multiplayer
 * damage figure is a from-scratch design against a 10 HP player. The two
 * numbers are not the same KIND of figure, so asserting them equal, scaled,
 * or even "diverged" would manufacture a relationship neither side claims.
 * The one exception below (the ranger's crossbow bolt) is included because
 * it is not a magnitude comparison at all — it is two independently
 * *computed* boss-damage-shaped values that happen to land on the same
 * number.
 *
 * TOTAL LEDGER (see the report handed back with this task for the full
 * breakdown by hero): 34 `it()`s — 23 copied, 2 scaled, 8 diverged, and one
 * that confirms a structural absence rather than compares a figure (the
 * sapper's multiplayer secondary resolves to `{ kind: 'none' }` in every
 * mode) — plus 22 `it.todo()`s naming a figure or mechanic that could not
 * be compared at all, and why. THE THIRD ABILITIES section below adds its
 * own, and its own count.
 *
 * ## A note on `copied` above versus `shared` below
 *
 * The WEAPON rows above were written as `copied` and most of them are now
 * `shared` in substance: `weapon-figures.ts` landed in the same round and
 * `CONFIG` imports from it, so `CONFIG.arrowSpeed` and `Bow`'s speed are one
 * constant read twice, not two that agree. They are deliberately NOT
 * reclassified here — the assertion is identical either way, relabelling
 * twenty rows would bury the abilities in churn, and a row that says `copied`
 * about a shared figure is pessimistic rather than wrong. The THIRD ABILITY
 * rows below are written as `shared` from the start, so the two vocabularies
 * are not being mixed inside one section.
 */
import { describe, expect, it } from 'vitest';

import { devHooks } from '../legacy/game.js';
import {
  Blink,
  Charge,
  MARK_COOLDOWN_TICKS,
  Mark,
  PowerDraw,
  ShockRound,
  type Ability,
  type AbilityEffect,
  type MarkSpec,
  type TravelSpec,
} from './abilities';
import { CHARACTER_STATS } from './arena';
import { ticks } from './tick';
import { SAPPER_COMBO_RADIUS_MULT } from './weapon-figures';
import {
  ARROW_RADIUS,
  BOLT_RADIUS,
  CROSSBOW_BOLT_COUNT,
  CROSSBOW_BOLT_DAMAGE,
  CROSSBOW_BOLT_RADIUS,
  CROSSBOW_SPREAD_RADIANS,
  Bow,
  Crossbow,
  DYNAMITE_BLAST_RADIUS,
  DYNAMITE_FUSE_TICKS,
  DYNAMITE_SPEED,
  DynamitePouch,
  LightningStorm,
  PowderCharge,
  SATCHEL_ARM_FUSE_TICKS,
  SATCHEL_IDLE_TICKS,
  SATCHEL_THROW_SPEED,
  SAPPER_CHARGE_COOLDOWN_TICKS,
  SPEAR_REACH,
  STORM_BLAST_RADIUS,
  STORM_COOLDOWN_TICKS,
  Satchel,
  Spear,
  Staff,
  WHIRLWIND_BLAST_RADIUS,
  WHIRLWIND_COOLDOWN_TICKS,
  WHIRLWIND_DURATION_TICKS,
  WHIRLWIND_TICK_INTERVAL_TICKS,
  Whirlwind,
  secondaryWeapon,
  type BurstSpec,
  type ShotSpec,
  type SwingSpec,
  type WeaponEffect,
} from './weapons';

// Read once. Nothing here calls devHooks.setPace, so this stays the module's
// own default ('fast') for the whole file — see the PACE_PRESETS note above
// for why that matters to which figures are safe to compare at all.
const CONFIG = devHooks.config();

function shotOf(effects: WeaponEffect[]): ShotSpec {
  const e = effects[0];
  if (!e || e.kind !== 'shot') throw new Error('expected a shot effect');
  return e.shot;
}
function swingOf(effects: WeaponEffect[]): SwingSpec {
  const e = effects[0];
  if (!e || e.kind !== 'swing') throw new Error('expected a swing effect');
  return e.swing;
}
function burstOf(effects: WeaponEffect[]): BurstSpec {
  const e = effects[0];
  if (!e || e.kind !== 'burst') throw new Error('expected a burst effect');
  return e.burst;
}

// ── ARCHER ───────────────────────────────────────────────────────────────

describe('archer', () => {
  describe('primary: bow / arrow', () => {
    const shot = shotOf(new Bow().use());

    it('speed — copied', () => {
      expect(shot.speed).toBe(CONFIG.arrowSpeed);
    });
    it('lifetime — copied', () => {
      expect(shot.lifeTicks).toBe(ticks(CONFIG.arrowLifetime));
    });
    it('hit radius — diverged: ARROW_RADIUS=12 vs arrowHitRadius=14', () => {
      // weapons.ts's own comment justifies 12 on lag-compensation math for a
      // PvP duel ("twelve plus the body's eight covers it"), not as a
      // scaling of legacy's 14. Legacy's 14 has never been asked to answer
      // that math. Reconciling the two is a balance call nobody has made.
      expect(CONFIG.arrowHitRadius).toBe(14);
      expect(ARROW_RADIUS).toBe(12);
    });

    // COULD NOT COMPARE
    it.todo(
      'rate of fire — legacy paces the bow via CONFIG.maxArrowsInFlight ' +
        '(pace-preset-owned: 3/5/8 on calm/fast/nightmare), not a per-shot ' +
        'cooldown; Bow.cooldownTicks=ticks(0.35) in weapons.ts is a PvP-only ' +
        'redesign with no legacy figure to pair against',
    );
    it.todo(
      'no WEAPON on either side can be held to power up: `Weapon.use()` takes ' +
        'no charge argument at all. This row used to fold the archer\'s draw ' +
        'in with it, which was wrong twice over — the draw is not the primary ' +
        'in either runtime (legacy hangs it off Shift via `pressShift`, ' +
        'multiplayer off `Button.SNIPE`, which is the same key), and it is no ' +
        'longer missing. It is compared figure by figure under THE THIRD ' +
        'ABILITIES below. What is still uncompared here is the BRACE ' +
        '(braceFillSecs/DrainMult/BossMult), which has no multiplayer half',
    );
  });

  describe('secondary: dynamite pouch', () => {
    const shot = shotOf(new DynamitePouch().use());

    it('throw speed — scaled ×0.7 (named in DYNAMITE_SPEED\'s own comment)', () => {
      expect(shot.speed).toBe(DYNAMITE_SPEED);
      expect(shot.speed / CONFIG.dynamiteSpeed).toBeCloseTo(0.7, 2);
    });
    it('fuse/lifetime — copied (NOT scaled: only the throw speed is slowed)', () => {
      expect(shot.lifeTicks).toBe(DYNAMITE_FUSE_TICKS);
      expect(shot.lifeTicks).toBe(ticks(CONFIG.dynamiteLifetime));
    });
    it('blast radius — copied', () => {
      expect(DYNAMITE_BLAST_RADIUS).toBe(CONFIG.dynamiteBlastRadius);
    });

    // COULD NOT COMPARE
    it.todo(
      'damage — legacy dynamiteBossDamage=2 is boss-only (every body dies ' +
        'to one hit of anything); DYNAMITE_DAMAGE=4 in weapons.ts is a ' +
        'from-scratch PvP figure, not a copy — see this file\'s damage note',
    );
    it.todo(
      'throw cooldown — legacy has none (gated only by inv.dynamites and ' +
        'the charge-hold duration); DynamitePouch.cooldownTicks=ticks(0.8) ' +
        'is a PvP-only redesign',
    );
    it.todo(
      'bounce restitution — cannot compare live: legacy\'s -0.65 is a bare ' +
        'literal at game.js\'s updateDynamites (`d.vx *= -0.65`), not a ' +
        'CONFIG field, so there is no module accessor to read without ' +
        'retyping it. DYNAMITE_BOUNCE=0.35 in weapons.ts cites and ' +
        'deliberately departs from that same 0.65 in its own comment (a ' +
        'softer bounce so a stick lands beside what it hit)',
    );
    it.todo(
      'per-tick drag — cannot compare live: legacy\'s 0.985 is a bare ' +
        'literal in the same function (`d.vx *= 0.985`), not exposed via ' +
        'CONFIG. DYNAMITE_DRAG=0.985 in weapons.ts cites the identical ' +
        'figure in its own comment; by source inspection they agree, but ' +
        'neither side exposes a live accessor to assert it',
    );
    it.todo(
      'rest-speed detonation threshold — this mechanic does not exist in ' +
        'legacy at all: a thrown stick only ever detonates on fuse ' +
        'timeout, or (with SHORT FUSE held) on first wall strike, never on ' +
        'slowing to a stop. DYNAMITE_REST_SPEED=50 with explodesAtRest:true ' +
        'is new to the multiplayer sim',
    );
  });
});

// ── WIZARD ───────────────────────────────────────────────────────────────

describe('wizard', () => {
  describe('primary: staff / bolt', () => {
    const shot = shotOf(new Staff().use());

    it('speed — copied', () => {
      expect(shot.speed).toBe(CONFIG.wizBoltSpeed);
    });
    it('lifetime — copied', () => {
      expect(shot.lifeTicks).toBe(ticks(CONFIG.wizBoltLifetime));
    });
    it('homing turn rate — copied', () => {
      expect(shot.homingRate).toBe(CONFIG.wizBoltTurnRate);
    });
    it('cooldown — copied', () => {
      expect(new Staff().cooldownTicks).toBe(ticks(CONFIG.wizBoltCooldown));
    });
    it('hit radius — diverged: BOLT_RADIUS=12 vs arrowHitRadius=14', () => {
      // The wizard's bolt has no radius CONFIG entry of its own — it hits
      // crows/skeletons/soldiers through the same CONFIG.arrowHitRadius the
      // archer's arrow uses (game.js's arrow-update loop, the `a.wiz`
      // branch). Same underlying divergence as the archer's own row above.
      expect(CONFIG.arrowHitRadius).toBe(14);
      expect(BOLT_RADIUS).toBe(12);
    });

    // COULD NOT COMPARE
    it.todo(
      'damage — legacy splits this into wizBoltDamage=1 (boss) and ' +
        'wizBoltBodyDamage=2 (crow/skeleton/soldier); BOLT_DAMAGE=3 in ' +
        'weapons.ts is one from-scratch PvP figure with no such split — ' +
        'see this file\'s damage note',
    );
  });

  describe('secondary: lightning storm', () => {
    const burst = burstOf(new LightningStorm().use());

    it('radius — diverged: STORM_BLAST_RADIUS=180 vs stormBlastRadius=450', () => {
      // weapons.ts's own comment: at legacy's 450 (5x a dynamite blast) the
      // storm "would catch nearly the whole map" in the multiplayer arena,
      // so it was redesigned down to 180 rather than scaled by a stated
      // factor. Pinned, not asserted equal or ratio-checked.
      expect(CONFIG.stormBlastRadius).toBe(450);
      expect(STORM_BLAST_RADIUS).toBe(180);
    });
    it('cooldown — diverged: STORM_COOLDOWN_TICKS=6s vs stormCooldown=10s', () => {
      expect(CONFIG.stormCooldown).toBe(10);
      expect(burst.tickIntervalTicks).toBe(0); // instant, not channelled
      expect(new LightningStorm().cooldownTicks).toBe(STORM_COOLDOWN_TICKS);
      expect(STORM_COOLDOWN_TICKS).toBe(ticks(6));
    });

    // COULD NOT COMPARE
    it.todo(
      'damage — legacy stormBossDamage=3 is boss-only; STORM_DAMAGE=4 in ' +
        'weapons.ts is set equal to DYNAMITE_DAMAGE by MP-internal design ' +
        'choice ("a single-target throw and a whole-area-at-once hit ' +
        'dealing the same number is already the AoE\'s real advantage"), ' +
        'unrelated to legacy\'s 3 — see this file\'s damage note',
    );
  });
});

// ── KNIGHT ───────────────────────────────────────────────────────────────

describe('knight', () => {
  describe('primary: spear', () => {
    const swing = swingOf(new Spear().use());

    it('reach — copied (CONFIG.knightSpearRange, the talent-wired base)', () => {
      // TALENTS.stat('longReach') reads { key: 'knightSpearRange' } — at
      // zero talent points spent (the base kit this file compares) that IS
      // CONFIG.knightSpearRange, confirmed at game.js's spear hit-detection
      // block (`baseRange = TALENTS.stat('longReach')`).
      expect(swing.reach).toBe(SPEAR_REACH);
      expect(SPEAR_REACH).toBe(CONFIG.knightSpearRange);
    });
    it('swing duration — copied', () => {
      expect(swing.durationTicks).toBe(ticks(CONFIG.knightSpearSwingDuration));
    });
    it('cooldown — copied (base, before Bloodlust\'s runtime speed-up)', () => {
      expect(new Spear().cooldownTicks).toBe(ticks(CONFIG.knightSpearCooldown));
    });

    // COULD NOT COMPARE
    it.todo(
      'thrust distance — cannot compare live: legacy\'s 22 is a bare ' +
        'literal in the spear hit-detection block ' +
        '(`Math.sin(...) * 22`), not a CONFIG field. SPEAR_THRUST=22 in ' +
        'weapons.ts matches it by source inspection, but there is no ' +
        'accessor to assert it through without retyping the legacy 22',
    );
    it.todo(
      'hit probe radius — cannot compare live: legacy\'s 22 ' +
        '(`hitR2 = 22 * 22`) is the same kind of bare literal as the ' +
        'thrust above, not exposed via CONFIG. weapons.ts\'s ' +
        'swing.radius=22 for the Spear is commented "the probe radius, ' +
        'hardcoded in legacy" — matches by inspection, not by accessor',
    );
    it.todo(
      'damage — legacy knightSpearBossDamage=1 is boss-only (landing ' +
        'twice per swing, so 2 total); SPEAR_DAMAGE=2 in weapons.ts is a ' +
        'from-scratch PvP figure (also landing twice, so 4 total) — see ' +
        'this file\'s damage note',
    );
  });

  describe('secondary: whirlwind', () => {
    const burst = burstOf(new Whirlwind().use());

    it('radius — diverged: WHIRLWIND_BLAST_RADIUS=70 vs knightWhirlwindRadius=72', () => {
      // weapons.ts's own comment: "Radius trims slightly, to 70" — a
      // nearby round number, not a named ratio (70/72 is not called out
      // anywhere), so this is diverged rather than scaled.
      expect(CONFIG.knightWhirlwindRadius).toBe(72);
      expect(WHIRLWIND_BLAST_RADIUS).toBe(70);
    });
    it('tick interval — copied', () => {
      expect(burst.tickIntervalTicks).toBe(ticks(CONFIG.knightWhirlwindTickRate));
      expect(WHIRLWIND_TICK_INTERVAL_TICKS).toBe(ticks(CONFIG.knightWhirlwindTickRate));
    });
    it('duration — copied', () => {
      expect(burst.durationTicks).toBe(ticks(CONFIG.knightWhirlwindDuration));
      expect(WHIRLWIND_DURATION_TICKS).toBe(ticks(CONFIG.knightWhirlwindDuration));
    });
    it('cooldown — copied', () => {
      expect(new Whirlwind().cooldownTicks).toBe(ticks(CONFIG.knightWhirlwindCooldown));
      expect(WHIRLWIND_COOLDOWN_TICKS).toBe(ticks(CONFIG.knightWhirlwindCooldown));
    });

    // COULD NOT COMPARE
    it.todo(
      'per-tick damage — cannot compare live: legacy\'s tick damage is a ' +
        'bare literal at game.js\'s knight-whirlwind tick ' +
        '(`damageEnemiesInRadius(..., { amount: 1, ... })`), not a CONFIG ' +
        'field (CONFIG has no knightWhirlwindDamage — only the dark ' +
        'knight\'s copy of the fight has darkKnightWhirlwindDamage, a ' +
        'different mechanic). WHIRLWIND_TICK_DAMAGE=1 in weapons.ts ' +
        'matches the literal 1 by inspection, not by accessor',
    );
  });
});

// ── RANGER ───────────────────────────────────────────────────────────────

describe('ranger', () => {
  describe('primary: crossbow', () => {
    const shot = shotOf(new Crossbow().use());

    it('bolt count — copied', () => {
      expect(new Crossbow().use()).toHaveLength(CONFIG.crossbowBoltCount);
      expect(CROSSBOW_BOLT_COUNT).toBe(CONFIG.crossbowBoltCount);
    });
    it('speed — copied (reuses the archer\'s own arrowSpeed, both sides)', () => {
      expect(shot.speed).toBe(CONFIG.arrowSpeed);
    });
    it('lifetime — copied (reuses the archer\'s own arrowLifetime, both sides)', () => {
      expect(shot.lifeTicks).toBe(ticks(CONFIG.arrowLifetime));
    });
    it('spread between bolts — copied', () => {
      expect(CROSSBOW_SPREAD_RADIANS).toBeCloseTo(CONFIG.crossbowSpreadRadians, 10);
    });
    it('per-bolt damage — copied (two independently-computed boss figures ' +
      'that land on the same number)', () => {
      // Legacy: CONFIG.arrowBossDamage(1) * CONFIG.crossbowBoltDamageMult(0.7)
      // = 0.7, applied in resolveBossHit via the bolt's own dmgMult. Not a
      // magnitude comparison against a PvP pool (see this file's damage
      // note) — both numbers are computed the same way, boss-damage-shaped,
      // and simply agree.
      expect(CONFIG.arrowBossDamage * CONFIG.crossbowBoltDamageMult).toBe(0.7);
      expect(shot.damage).toBe(CROSSBOW_BOLT_DAMAGE);
      expect(CROSSBOW_BOLT_DAMAGE).toBe(0.7);
    });
    it('per-bolt hit radius — diverged: CROSSBOW_BOLT_RADIUS=8 vs 9.8 in legacy', () => {
      // Both sides apply the SAME named 0.7 factor (legacy's own
      // CONFIG.crossbowBoltRadiusMult), but to different anchors — legacy's
      // arrowHitRadius=14 (unrounded: 9.8) versus weapons.ts's own
      // ARROW_RADIUS=12, then Math.round()ed down to 8. The anchor mismatch
      // is the archer-arrow-radius divergence above; the rounding is new
      // here. Net result: not the same radius by any tolerance worth calling
      // "scaled".
      expect(CONFIG.arrowHitRadius * CONFIG.crossbowBoltRadiusMult).toBeCloseTo(9.8, 5);
      expect(CROSSBOW_BOLT_RADIUS).toBe(8);
    });

    // COULD NOT COMPARE
    it.todo(
      'rate of fire — legacy paces the crossbow the same way as the bow ' +
        '(CONFIG.maxArrowsInFlight, pace-preset-owned); ' +
        'Crossbow.cooldownTicks=ticks(0.35) in weapons.ts has no legacy ' +
        'figure to pair against',
    );
    it.todo(
      'magazine/reload — legacy\'s crossbow has a real four-volley ' +
        'magazine and reload rhythm (crossbowMagazine=4, ' +
        'crossbowShotSecs=0.22, crossbowReloadSecs=1.1, ' +
        'crossbowReloadFullMult=0.45, cut by Momentum) entirely absent from ' +
        'weapons.ts\'s Crossbow, which is one burst of 3 on a flat cooldown',
    );
  });

  describe('secondary: satchel', () => {
    const shot = shotOf(new Satchel().use());

    it('throw speed — scaled ×0.7 (reuses DYNAMITE_SPEED, same factor)', () => {
      expect(shot.speed).toBe(SATCHEL_THROW_SPEED);
      expect(SATCHEL_THROW_SPEED).toBe(DYNAMITE_SPEED);
      expect(shot.speed / CONFIG.satchelThrowSpeed).toBeCloseTo(0.7, 2);
    });
    it('arm fuse — copied', () => {
      expect(SATCHEL_ARM_FUSE_TICKS).toBe(ticks(CONFIG.satchelArmFuse));
    });
    it('idle lifetime — copied', () => {
      expect(shot.lifeTicks).toBe(SATCHEL_IDLE_TICKS);
      expect(SATCHEL_IDLE_TICKS).toBe(ticks(CONFIG.satchelIdleLife));
    });

    // COULD NOT COMPARE
    it.todo(
      'damage — legacy satchelBossDamage=1 is boss-only; SATCHEL_DAMAGE=3 ' +
        'in weapons.ts is a from-scratch PvP figure — see this file\'s ' +
        'damage note. (Both sides do independently apply a 0.7 cut against ' +
        'their own dynamite damage figure, but legacy\'s stored 1 is ' +
        'Math.round(2 * 0.7) while its RAW ratio to dynamiteBossDamage is ' +
        '0.5, not 0.7 — the rounding erases the factor at this magnitude, ' +
        'so even the ratio is not safely assertable)',
    );
    it.todo(
      'trigger/own hit radius — legacy has no satchel-specific radius: a ' +
        'satchel is set off by whatever bolt strikes it, using THAT ' +
        'bolt\'s own hitRadius (the ranger\'s own crossbow bolt, already ' +
        'covered above). SATCHEL_TRIGGER_RADIUS=BOLT_RADIUS=12 in ' +
        'weapons.ts has no single legacy figure to pair against',
    );
    it.todo(
      'throw cooldown — legacy has none (gated only by inv.satchels, ' +
        'confirmed at game.js\'s useSatchel — no cooldown variable at ' +
        'all); Satchel.cooldownTicks=ticks(0.8) in weapons.ts is a ' +
        'PvP-only redesign',
    );
  });
});

// ── SAPPER ───────────────────────────────────────────────────────────────

describe('sapper', () => {
  describe('primary: powder charge', () => {
    const sapperShot = shotOf(new PowderCharge().use());
    const archerShot = shotOf(new DynamitePouch().use());

    it(
      'throw speed vs the archer\'s dynamite — diverged: legacy gives the ' +
        'sapper his own (faster) figure, weapons.ts reuses the archer\'s',
      () => {
        // Legacy deliberately does NOT share this figure between the two
        // throwers: CONFIG's own comment on sapperBombSpeed says the
        // sapper's bomb "outranges the archer's dynamite on purpose, via
        // speed and fuse both — a straight-line demolition tool, not a
        // lob." weapons.ts's PowderCharge instead reuses DYNAMITE_SPEED
        // outright, collapsing that distinction. Not documented anywhere in
        // weapons.ts.
        expect(CONFIG.sapperBombSpeed).toBe(400);
        expect(CONFIG.dynamiteSpeed).toBe(336);
        expect(sapperShot.speed).toBe(archerShot.speed);
        expect(sapperShot.speed).toBe(DYNAMITE_SPEED);
      },
    );
    it(
      'fuse/lifetime vs the archer\'s dynamite — diverged, same cause as speed',
      () => {
        expect(CONFIG.sapperBombLifetime).toBe(1.8);
        expect(CONFIG.dynamiteLifetime).toBe(1.5);
        expect(sapperShot.lifeTicks).toBe(archerShot.lifeTicks);
        expect(sapperShot.lifeTicks).toBe(DYNAMITE_FUSE_TICKS);
      },
    );
    it('blast radius vs the archer\'s dynamite — copied (both share dynamiteBlastRadius)', () => {
      // Confirmed at game.js: a sapper's own bomb explodes through
      // `explodeExplosive(d, 'dynamite')`, the same source tag the
      // archer's stick uses, so blastReachPx() resolves the same
      // CONFIG.dynamiteBlastRadius for both. weapons.ts's DYNAMITE_BLAST_RADIUS
      // is likewise shared by every explosive (see its own comment).
      expect(DYNAMITE_BLAST_RADIUS).toBe(CONFIG.dynamiteBlastRadius);
    });
    it('cooldown — copied', () => {
      expect(new PowderCharge().cooldownTicks).toBe(SAPPER_CHARGE_COOLDOWN_TICKS);
      expect(SAPPER_CHARGE_COOLDOWN_TICKS).toBe(ticks(CONFIG.sapperChargeCooldown));
    });

    // COULD NOT COMPARE
    it.todo(
      'damage — legacy\'s sapper charge deals boss damage through the ' +
        'SAME dynamiteBossDamage(2) the archer\'s stick uses (both explode ' +
        'with source \'dynamite\'); weapons.ts\'s SAPPER_CHARGE_DAMAGE ' +
        'instead reuses ARROW_DAMAGE(2) — the ARCHER\'S BOW figure, not his ' +
        'dynamite. Legacy ties the sapper\'s charge to the archer\'s ' +
        'explosive; weapons.ts ties it to the archer\'s arrow instead. Both ' +
        'numbers happen to be boss-damage-vs-PvP-damage-shaped and so are ' +
        'not directly comparable (see this file\'s damage note), but the ' +
        'RELATIONSHIP each side chooses is itself inverted, which is worth ' +
        'a human eye',
    );
    it.todo(
      'burst/hold mechanic — legacy can hold the primary to place up to ' +
        'CONFIG.sapperBurstCount(3) charges in one go, each on its own ' +
        'stagger (sapperBurstIntervalSecs=0.13); PowderCharge.use() in ' +
        'weapons.ts always throws exactly one, with no hold concept at all',
    );
  });

  describe('secondary', () => {
    it(
      'does not exist in the multiplayer sim at all, in either mode',
      () => {
        expect(secondaryWeapon('sapper', 'deathmatch')).toEqual({ kind: 'none' });
        expect(secondaryWeapon('sapper', 'coop')).toEqual({ kind: 'none' });
      },
    );

    // COULD NOT COMPARE — the largest gap in this ledger
    it.todo(
      'BARRAGE (legacy\'s special/right-click) — a fan of ' +
        'CONFIG.sapperBarrageCount(5) mini-bombs across ' +
        'CONFIG.sapperBarrageArcRadians(π/4), each with its own speed(380), ' +
        'lifetime(0.9s), blast radius(40), damage(1) and a 6s cooldown. No ' +
        'counterpart exists in weapons.ts: OWN_SECONDARY.sapper resolves ' +
        'to { kind: \'none\' } unconditionally',
    );
    it.todo(
      'the Shift shock round (legacy\'s third input; NOT piercing — ' +
        'updateSapperShots splices it on the first thing it touches) — ' +
        'CONFIG.sapperShotCooldown(10s), sapperShotSpeed(600), ' +
        'sapperShotLifetime(1.5s), sapperShotDamageMult(3x), ' +
        'sapperShotBossDamage(3), plus the early-detonation combo against ' +
        'his own bombs (sapperComboRadiusMult/FalloffMax/FalloffMin). No ' +
        'counterpart exists in weapons.ts at all — the sapper has only the ' +
        'one weapon, PowderCharge, on the multiplayer side',
    );
  });
});

// ═══ THE THIRD ABILITIES ═════════════════════════════════════════════════════
//
// `Button.SNIPE` on the wire, Shift on a keyboard. Single-player routes it
// through five functions in a row (`pressShift` in game.js); multiplayer
// describes the five in `src/sim/abilities.ts` and `battle-world` realises
// them. Same four relationships as above, plus the one thing this section has
// that the weapons do not: a genuine disagreement about HOW A HOLD IS
// MEASURED, which is structural rather than numeric and gets a row of its own
// for each of the two held abilities.

const abilityShotOf = (effects: AbilityEffect[]): ShotSpec => {
  const e = effects[0];
  if (!e || e.kind !== 'shot') throw new Error('expected a shot effect');
  return e.shot;
};
const travelOf = (effects: AbilityEffect[]): TravelSpec => {
  const e = effects[0];
  if (!e || e.kind !== 'travel') throw new Error('expected a travel effect');
  return e.travel;
};
const markOf = (effects: AbilityEffect[]): MarkSpec => {
  const e = effects[0];
  if (!e || e.kind !== 'mark') throw new Error('expected a mark effect');
  return e.mark;
};

/**
 * The wind-up of a held ability, in ticks, or null for one that fires on the
 * press. Reads the ability's own trigger rather than a figure, so a hold that
 * stopped being a hold fails here rather than silently reading zero.
 */
function windUpOf(ability: Ability): number | null {
  return ability.trigger.on === 'release' ? ability.trigger.windUpTicks : null;
}

describe('archer: the power draw', () => {
  const draw = new PowerDraw();
  const windUp = windUpOf(draw) ?? 0;

  it('draw length — shared (ARCHER_DRAW_MAX_SECS)', () => {
    expect(windUp).toBe(ticks(CONFIG.archerDrawMaxSecs));
  });
  it('cooldown — shared (ARCHER_POWER_COOLDOWN_SECS)', () => {
    expect(draw.cooldownTicks).toBe(ticks(CONFIG.archerPowerCooldown));
  });
  it('speed at a full draw — shared (both are arrowSpeed x archerPowerSpeedMult)', () => {
    expect(abilityShotOf(draw.use(windUp)).speed)
      .toBe(CONFIG.arrowSpeed * CONFIG.archerPowerSpeedMult);
  });
  it('speed at a tap — shared (both are a plain arrow)', () => {
    expect(abilityShotOf(draw.use(0)).speed).toBe(CONFIG.arrowSpeed);
  });
  it('pierce at a full draw — shared (ARCHER_POWER_PIERCE)', () => {
    expect(abilityShotOf(draw.use(windUp)).pierce).toBe(CONFIG.archerPowerPierce);
  });
  it('pierce at a tap — shared: one body, which is no piercing at all', () => {
    // Legacy: `1 + Math.round(drawn * (splitShaft - 1))` at drawn 0.
    expect(abilityShotOf(draw.use(0)).pierce).toBe(1);
  });
  it('flight lifetime — shared (ARROW_LIFE_SECS: a power shot is still an arrow)', () => {
    expect(abilityShotOf(draw.use(windUp)).lifeTicks).toBe(ticks(CONFIG.arrowLifetime));
  });

  it('HOW THE HOLD IS MEASURED — diverged, structurally: a wall clock vs ticks', () => {
    // `archerDrawFrac` in game.js divides `performance.now() - archerDraw.t0`
    // by 1000 and by the full-draw seconds. A fixed-step server has no wall
    // clock, and a hold measured against one is a figure that changes with
    // frame rate, so `PowerDraw.use` takes the TICKS the button has been
    // down, counted off the bitfield across InputCommands.
    //
    // The two therefore agree on the SECONDS a full draw takes, which is what
    // this asserts, and disagree about a draw that spans a stall: a frame that
    // takes 100 ms advances the legacy draw by 100 ms and the multiplayer one
    // by one tick. Nothing can assert that second half from here --
    // `performance.now()` is not a figure -- so it is stated.
    expect(windUp).toBe(ticks(CONFIG.archerDrawMaxSecs));
    expect(Number.isInteger(windUp)).toBe(true);
  });

  it('the wind-up ROOTS but does not protect — shared rule, stated two ways', () => {
    // game.js: `if (!knightCharge.on && !archerDraw.on && !beam)` gates
    // movement, so the draw roots him; `damagePlayer` exempts the knight's
    // windup and NOT the archer's, so he eats what arrives. Both are true of
    // `trigger.windUp` here, which is why it is an enum and not a flag.
    expect(draw.trigger.on === 'release' && draw.trigger.windUp).toBe('rooted');
  });

  // COULD NOT COMPARE
  it.todo(
    'power-shot damage — legacy archerPowerBossMult=3 multiplies BOSS damage; ' +
      'POWER_SHOT_DAMAGE_MULT=3 in abilities.ts multiplies ARROW_DAMAGE, a PvP ' +
      'figure. Same number, deliberately chosen twice for two different ' +
      'questions — see this file\'s damage note. Asserting them equal would ' +
      'bind a boss tune to a duel',
  );
  it.todo(
    'BRACE — the whole braced-stance system (braceFillSecs, braceBossMult, ' +
      'archerBracedCooldownCut, and the DEAD EYE rite refunding the cooldown ' +
      'on a perfect shot) has no multiplayer counterpart: `PowerDraw` knows ' +
      'only how long the key was down',
  );
  it.todo(
    'the queued pickup arrow — legacy spends one shaft per power shot and ' +
      'inherits its behaviour (a fire power shot lays a lane, a ricochet one ' +
      'keeps bouncing). Multiplayer has fire as a timed state on the SHOOTER ' +
      'rather than a queued arrow type, so there is nothing to spend',
  );
});

describe('wizard: the blink', () => {
  const blink = new Blink();
  const travel = travelOf(blink.use());

  it('reach — shared (BLINK_REACH)', () => {
    expect(travel.reach).toBe(CONFIG.wizBlinkDistance);
  });
  it('refusal threshold — shared (BLINK_MIN_REACH)', () => {
    expect(travel.minReach).toBe(CONFIG.wizBlinkMinDistance);
  });
  it('cooldown — shared (BLINK_COOLDOWN_SECS)', () => {
    expect(blink.cooldownTicks).toBe(ticks(CONFIG.wizBlinkCooldown));
  });
  it('i-frames on arrival — shared (BLINK_IFRAME_SECS)', () => {
    expect(travel.invulnerableTicks).toBe(ticks(CONFIG.wizBlinkIFrames));
  });
  it('arrival pulse radius — shared (BLINK_PULSE_RADIUS)', () => {
    expect(travel.pulse?.radius).toBe(CONFIG.wizBlinkPulseRadius);
  });
  it('arrives at once — shared mechanic: neither runtime animates the hop', () => {
    expect(travel.durationTicks).toBe(0);
  });
  it('opens no terrain — shared rule', () => {
    // Legacy's arrival calls `damageEnemiesInRadius` and nothing that smashes
    // a tile; the storm is the wizard's excavator in both runtimes.
    expect(travel.pulse?.destroysTerrain).toBe(false);
  });

  // COULD NOT COMPARE
  it.todo(
    'arrival pulse damage — legacy wizBlinkPulseBossDamage=1 is boss-only; ' +
      'BLINK_PULSE_DAMAGE=2 in abilities.ts is a from-scratch PvP figure set ' +
      'below the wizard\'s own bolt — see this file\'s damage note',
  );
  it.todo(
    'the Focus cost — legacy spends CONFIG.wizFocusBlink(2) of a three-point ' +
      'pool that regenerates on its own timer, and refuses the blink without ' +
      'it. Multiplayer has no Focus at all: the wizard is gated by the ' +
      'cooldown alone, so his blink is strictly more available there',
  );
  it.todo(
    'the chain — legacy allows wizBlinkMaxHops(2) hops inside ' +
      'shiftChainSecs(1.1), the second free of both Focus and cooldown, with ' +
      'THIRD STEP and HELD STEP tuning each and the Thunderstep rite ' +
      'escalating the pulse per hop (sim/blink.ts). None of it is built for ' +
      'multiplayer: one press is one hop',
  );
});

describe('knight: the charge', () => {
  const charge = new Charge();
  const windUp = windUpOf(charge) ?? 0;
  const travel = travelOf(charge.use(windUp));

  it('longest wind-up — shared (KNIGHT_CHARGE_MAX_HOLD_SECS)', () => {
    expect(windUp).toBe(ticks(CONFIG.knightChargeMaxHoldSecs));
  });
  it('cooldown — shared (KNIGHT_CHARGE_COOLDOWN_SECS)', () => {
    expect(charge.cooldownTicks).toBe(ticks(CONFIG.knightChargeCooldown));
  });
  it('dash duration — shared (KNIGHT_DASH_SECS)', () => {
    expect(travel.durationTicks).toBe(ticks(CONFIG.knightChargeDashDuration));
  });
  it('sweep radius — shared (KNIGHT_CHARGE_RADIUS)', () => {
    expect(travel.pulse?.radius).toBe(CONFIG.knightChargeRadius);
  });
  it('sweep tick rate — shared (KNIGHT_CHARGE_TICK_SECS)', () => {
    expect(travel.pulse?.tickIntervalTicks).toBe(ticks(CONFIG.knightChargeTickRate));
  });
  it('the hold curve — shared (KNIGHT_CHARGE_MIN/MAX_DAMAGE_MULT, on two bases)', () => {
    // Each runtime multiplies its OWN damage base by the same bounds: legacy
    // knightChargeBossDamage, multiplayer CHARGE_TICK_DAMAGE. The cut is
    // shared and the anchor is not, the CROSSBOW_BOLT_RADIUS_MULT shape, so
    // this is asserted on the RATIO.
    const tap = travelOf(charge.use(0)).pulse?.damage ?? 0;
    const full = travel.pulse?.damage ?? 0;
    expect(full / tap).toBeCloseTo(
      CONFIG.knightChargeMaxDamageMult / CONFIG.knightChargeMinDamageMult,
      10,
    );
  });
  it('dash distance — shared derivation, off a table both runtimes read', () => {
    // Legacy: `FEATHERS.speed() * knightChargeDashSpeedMult *
    // knightChargeDashDuration`, and `FEATHERS.speed()` at no stacks is
    // `CHARACTER_STATS[selectedChar].speed` — imported from src/sim/arena.ts,
    // the very table multiplayer reads. Both derive the reach the same way
    // from the same three figures. Asserted as the derivation rather than as a
    // distance, so a roster retune moves both and a change to either FORMULA
    // fails here.
    expect(travel.reach).toBe(
      CHARACTER_STATS.knight.speed
        * CONFIG.knightChargeDashSpeedMult
        * CONFIG.knightChargeDashDuration,
    );
  });
  it('the wind-up protects and the DASH does not — shared rule', () => {
    // `damagePlayer` returns early on `knightCharge.on` and says in its own
    // comment that the dash afterwards is exposed. The multiplayer travel
    // carries no i-frames for exactly that reason.
    expect(charge.trigger.on === 'release' && charge.trigger.windUp)
      .toBe('rooted-and-untouchable');
    expect(travel.invulnerableTicks).toBe(0);
  });

  it('HOW THE HOLD IS MEASURED — diverged, structurally: a wall clock vs ticks', () => {
    // `knightChargeFrac` divides `performance.now() - knightCharge.t0`; the
    // same divergence, and the same reason, as the archer's draw above. The
    // seconds agree; what a stalled frame does to a hold does not.
    expect(windUp).toBe(ticks(CONFIG.knightChargeMaxHoldSecs));
    expect(Number.isInteger(windUp)).toBe(true);
  });

  it('the sweep SHAPE — diverged: a wedge in legacy, a full ring in multiplayer', () => {
    // `inKnightArc` tests a real cone of knightChargeArcRadians (45 degrees)
    // centred on the committed angle. `BurstSpec` has no arc — it is the shape
    // the storm and the whirlwind already resolve through `#blastAt`, which
    // asks only for a radius. Reusing it means a dashing knight also catches
    // what is behind him. Deliberate: the wedge exists so he does not mow down
    // a crowd of crows he has run past, and a match holds two to four bodies.
    // Both sides pinned so a later arc on either one is a named change.
    expect(CONFIG.knightChargeArcRadians).toBeCloseTo(Math.PI / 4, 10);
    expect(travel.pulse && 'arcRadians' in travel.pulse).toBe(false);
  });

  // COULD NOT COMPARE
  it.todo(
    'dash damage — legacy knightChargeBossDamage=2 is boss-only; ' +
      'CHARGE_TICK_DAMAGE reuses WHIRLWIND_TICK_DAMAGE=1, a PvP figure, ' +
      'because a knight sweeping ground at speed and one sweeping it on the ' +
      'spot are the same swing — see this file\'s damage note',
  );
  it.todo(
    'the CHAINED charge — a second press mid-dash inside shiftChainSecs(1.1) ' +
      'with knightChainMinRoom(24) of room ahead, buying ' +
      'knightChargeChainSpeedMult(2.0) and one whirlwind swing of ' +
      'knightChainWhirlRadius(60). Not built for multiplayer: `Charge` has no ' +
      'notion of a press arriving while a travel is already running',
  );
});

describe('ranger: the mark', () => {
  const mark = new Mark();
  const spec = markOf(mark.use());

  it('duration — shared (RANGER_MARK_SECS)', () => {
    expect(spec.durationTicks).toBe(ticks(CONFIG.rangerMarkSecs));
  });
  it('reach — shared (RANGER_MARK_RADIUS)', () => {
    expect(spec.radius).toBe(CONFIG.rangerMarkRadius);
  });
  it('costs a press and no ammunition — shared: a designation, not a shot', () => {
    expect(mark.trigger.on).toBe('press');
    expect(mark.use().every((e) => e.kind === 'mark')).toBe(true);
  });

  it('WHAT GATES IT — diverged: a full Momentum meter vs a cooldown', () => {
    // `startRangerMark` refuses below `rangerMomentum >= 1` and zeroes the
    // meter, which is filled by RUNNING. Multiplayer has no Momentum, so
    // without something here the mark would be a free press. MARK_COOLDOWN
    // is that substitute and is a figure NEITHER runtime had — a product call
    // nobody has made, named in one place so it is one edit to change.
    expect(mark.cooldownTicks).toBe(MARK_COOLDOWN_TICKS);
    expect(mark.cooldownTicks).toBeGreaterThan(spec.durationTicks);
  });

  // COULD NOT COMPARE
  it.todo(
    'the multiplier — legacy rangerMarkCritMult=2.5 multiplies BOSS damage, ' +
      'and CONFIG\'s own comment says why: an ordinary body has one hit point ' +
      'and dies to any bolt, so a crit on a crow is a number nobody can see. ' +
      'MARK_DAMAGE_MULTIPLIER=2.5 in abilities.ts multiplies damage to a ' +
      '10-point PLAYER, which is a different question answered with the same ' +
      'number because it is the only number anyone has stated. Flagged for a ' +
      'product decision rather than asserted equal',
  );
  it.todo(
    'what it settles on — legacy `markTarget` prefers the BOSS outright and ' +
      'falls back to the nearest hostile of any kind; multiplayer has no boss ' +
      'and marks the nearest enemy FIGHTER, never a crow. Not a figure, and ' +
      'there is no boss to compare against',
  );
});

describe('sapper: the shock round', () => {
  const shock = new ShockRound();
  const shot = abilityShotOf(shock.use());

  it('cooldown — shared (SAPPER_SHOT_COOLDOWN_SECS)', () => {
    expect(shock.cooldownTicks).toBe(ticks(CONFIG.sapperShotCooldown));
  });
  it('speed — shared (SAPPER_SHOT_SPEED)', () => {
    expect(shot.speed).toBe(CONFIG.sapperShotSpeed);
  });
  it('lifetime — shared (SAPPER_SHOT_LIFE_SECS)', () => {
    expect(shot.lifeTicks).toBe(ticks(CONFIG.sapperShotLifetime));
  });
  it('combo blast width — shared (SAPPER_COMBO_RADIUS_MULT)', () => {
    expect(SAPPER_COMBO_RADIUS_MULT).toBe(CONFIG.sapperComboRadiusMult);
  });
  it('spent on the first thing it touches — shared: NEITHER pierces', () => {
    // CONFIG called it "a fast piercing shot" for a year and it never was:
    // `updateSapperShots` splices it on the first hit. The multiplayer shot
    // leaves `pierce` unset, which is that same one body.
    expect(shot.pierce).toBeUndefined();
  });
  it('stops on terrain rather than bouncing — shared', () => {
    // `if (!tilePassable(tileAt(nx, ny))) { splice; continue; }` in legacy.
    expect(shot.onTerrain).toBe('stop');
    expect(shot.explodesAtRest).toBe(false);
  });

  // COULD NOT COMPARE
  it.todo(
    'direct-hit damage — legacy sapperShotBossDamage=3 against a boss, and ' +
      'sapperShotDamageMult=3 as a flat amount against a body that has one ' +
      'hit point; SHOCK_DAMAGE in abilities.ts is SAPPER_CHARGE_DAMAGE x 3, a ' +
      'PvP figure. The MULTIPLE of a normal hit is three on both sides, which ' +
      'is the part worth noticing, but the bases are not comparable — see ' +
      'this file\'s damage note',
  );
  it.todo(
    'the combo falloff — legacy sapperComboFalloffMax(10)/Min(2) make the ' +
      'combo blast hottest at its centre. Multiplayer\'s `#blastAt` has no ' +
      'falloff at all: everything inside a radius takes the same damage, for ' +
      'every explosive in the game, so there is nothing to pair against',
  );
});
