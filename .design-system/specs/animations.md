# CROW ARCHER — Animation Specs

All animations are pure functions of `loopT` (seconds since game start) and `dt` (delta seconds), with optional per-entity phase floats. The base form is always:

```
property = base + amplitude * sin(loopT * freq + phase)
```

Discrete events (swings, hit-stops, fuse countdowns) are linear `t/duration` ramps gated on a state variable. No tween libraries. No easing curves beyond `sin`, `sin²`, and `1 - cos`.

---

## State variables — registry

These are the **only** per-entity floats animation code reads. New variables introduced by this spec are marked **NEW**.

| Variable | Owner entity | Update rule | Notes |
|---|---|---|---|
| `loopT` | global | `loopT = performance.now()/1000` | Single source of time. |
| `dt` | global | frame delta in seconds | Clamped to ≤ 0.05 to survive tab-suspend. |
| `entityPhase` | crows, boss, pickups, fire-patches, dynamite | `Math.random() * Math.PI * 2` at spawn | Decorrelates identical entities. **Already exists conceptually — name it explicitly.** |
| `wingPhase` | crow, boss | `wingPhase += freq * dt`; `freq` = 12 (normal), 14 (white), 5 (boss) | **NEW name** for the existing per-crow wing accumulator. |
| `walkPhase` | player | `walkPhase += 8*dt*speedScalar` while moving; frozen otherwise | NEW. |
| `aimAngle` | player | `atan2(mouseY - py, mouseX - px)` every frame | Existing. |
| `bowCharge` | player | `min(1, holdTime/0.6)` while LMB held; `0` otherwise | NEW name. |
| `cloakSway` | player | derived: `0.15 * sin(loopT*2.2 + entityPhase)` | NEW. |
| `bobY` | crows, boss, pickups | derived: `A * sin(loopT*F + entityPhase)`; per-entity `A` and `F` listed below | NEW name. |
| `aggroT` | crow | `aggroT += dt` while `aggro === true`; reset to 0 when cleared | NEW. |
| `pulsePhase` | aggro crow, low-HP HUD | `loopT * 6` | NEW name (was anonymous in current code). |
| `bossPulse` | boss | derived: `0.5 + 0.5*sin(loopT*2)` | NEW. |
| `eyeFlicker` | boss | derived: `loopT * 8` | NEW. |
| `fuseT` | dynamite | `fuseT -= dt`; explode at 0 | Existing. |
| `sparkPhase` | dynamite | `loopT * 18` | NEW name. |
| `bobPhase` | dynamite, pickups | random at spawn | NEW name (`entityPhase` alias for clarity). |
| `blinkPhase` | ricochet pickup | `loopT * 4 + bobPhase` | NEW. |
| `flamePhase` | fire pickup, fire patch, fire arrow | `loopT * 10 + entityPhase` or `+ fireSeed` | NEW. |
| `patchPhase` | fire patch | random at spawn | NEW alias of entityPhase. |
| `lifeT` | fire patch | `lifeT -= dt`; cull at ≤0 | NEW. |
| `birthT` | fire patch | `loopT` at spawn | NEW. |
| `fireSeed` | fire arrow | random at spawn | NEW. |
| `trailHistory` | ricochet arrow | deque, push current pos each frame, drop if `length > 6` | NEW. |
| `bouncesLeft` | ricochet arrow | int, decrement on wall hit | Existing. |
| `swingT` | pitchfork | `swingT += dt` while swinging; reset to 0 when complete | NEW. |
| `swingAngle` | pitchfork | snapshot of `aimAngle` at swing start | NEW. |

---

## Per-property formulas

### Player

| Property | Formula | Notes |
|---|---|---|
| body Y offset | `0.6 * sin(walkPhase * 2)` (only while moving) | Walk bob. Frozen at 0 when idle. |
| cloak bottom Y offset | `1.5 * sin(walkPhase + cloakSway)` | Adds the ambient idle sway via `cloakSway`. |
| bow shadowBlur | `4 + 8 * bowCharge` | Pulls visual attention as charge fills. |
| charge dot radius | `2 + 2 * bowCharge` | Drawn only when `bowCharge > 0.6`. |
| charge dot opacity | `bowCharge` | Fades in with charge. |
| hit flash (on damage) | `1.0` for 0.10s after hit, decays `flash -= 8*dt`; multiplies a `rgba(255,31,31, flash*0.8)` overlay on the body | Linear ramp gated on `hitTimer`. |

### Crow (normal)

| Property | Formula |
|---|---|
| wing rotation | `-0.4 + 0.5 * sin(wingPhase)` (left wing); `+0.4 - 0.5 * sin(wingPhase)` (right wing) |
| wing Y offset | `-2 + 3 * sin(wingPhase)` (left); `-2 - 3 * sin(wingPhase)` (right) |
| body Y bob | `0.8 * sin(loopT * 3 + entityPhase)` |
| eye shadowBlur | static `3` |

### Crow (white)

Same as normal, with `wingPhase` advancing at `14*dt` instead of `12*dt` and `bobY` amplitude `1.2` instead of `0.8`. Eye shadowBlur is animated `4 + 2*sin(loopT*4 + entityPhase)`.

### Crow (aggro)

v2: dropped the speed-trail cue. Two cues remain — ring + eye flare.

| Property | Formula |
|---|---|
| pulse ring radius | `10 + 3 * sin(pulsePhase)` |
| pulse ring alpha | `0.55 - 0.4 * sin²(pulsePhase)` |
| pulse ring shadowBlur | `8 + 4 * sin(pulsePhase)` |

### Boss (v2)

| Property | Formula |
|---|---|
| wing rotation | `+0.3 + 0.4 * sin(wingPhase)` (far); mirrored + π phase for near wing |
| wing Y offset | `-2 + 5 * sin(wingPhase)` |
| body Y bob | `2.4 * sin(loopT * 1.5 + entityPhase)` |
| corona radius | `38 + 5 * bossPulse` |
| corona alpha | `0.18 + 0.12 * bossPulse` |
| corona shadowBlur | `24 + 10 * bossPulse` |
| eye shadowBlur | `10 + 5 * sin(eyeFlicker)` |

### Arrow (normal)

No animation — static rect/triangle. Direction is `angle` from velocity.

### Arrow (ricochet)

| Property | Formula |
|---|---|
| trail position alpha | `0.5 - i*0.08` for ghost index `i` in `trailHistory` (oldest dimmest) |
| shaft shadowBlur | static `4` |
| head shadowBlur | static `6` |
| bounce pip count | `bouncesLeft` (int) |

### Arrow (fire)

| Property | Formula |
|---|---|
| rear flame rx | `4 + sin(loopT*14 + fireSeed)` |
| rear flame ry | `2.5` (constant) |
| rear flame x offset | `-12 - 2*sin(loopT*10)` |
| rear flame shadowBlur | `10 + 4 * sin(loopT*10 + fireSeed)` |
| head shadowBlur | `8 + 3 * sin(loopT*12 + fireSeed)` |
| trail emission cadence | 1 particle every 0.03s |

### Dynamite

| Property | Formula |
|---|---|
| body Y offset (idle bob) | `1.5 * sin(loopT*4 + bobPhase)` |
| wick char fraction | `1 - fuseT/fuseTotal` (0..1 over fuse) |
| spark core radius | `1.5 + 0.5*sin(sparkPhase)` |
| spark halo radius | `3 + sin(sparkPhase)` |
| spark shadowBlur | `6 + 4*sin(sparkPhase)` |
| countdown color tier | `fuseT > 1s → #FF1F1F`; `0.5–1s → #FFB400`; `<0.5s → #FFFFFF` |
| countdown shadowBlur | `4` normal, `16` in final 0.5s |

### Pickup (ricochet)

| Property | Formula |
|---|---|
| float Y offset | `-2 + sin(loopT*3 + bobPhase) * 2` |
| shaft alpha (blink) | `0.5 + 0.5 * sin²(blinkPhase)` |
| halo radius | `10 + sin(blinkPhase)` |
| halo alpha | `0.25 + 0.15 * sin(blinkPhase)` |
| shadowBlur (glyph) | `6 + 4 * sin(blinkPhase)` |
| shadowBlur (halo) | static `12` |

### Pickup (fire)

| Property | Formula |
|---|---|
| float Y offset | `-2 + sin(loopT*3 + bobPhase) * 2` |
| flame outer rx | `3 + sin(flamePhase)` |
| flame outer ry | `4 + 0.5*sin(flamePhase*1.3)` |
| flame core radius | `0.8 + 0.4*sin(flamePhase*2)` |
| flame outer shadowBlur | `12 + 4 * sin(flamePhase)` |
| halo radius | `11 + sin(flamePhase*0.4)` |
| halo alpha | `0.30 + 0.15 * sin(flamePhase*0.4)` |
| halo shadowBlur | static `14` |

### Fire patch

| Property | Formula |
|---|---|
| outer radius | `16 + 3 * sin(loopT*5 + patchPhase)` |
| inner radius | `6 + 1.5 * sin(loopT*8 + patchPhase)` |
| outer shadowBlur | `14 + 4 * sin(loopT*6 + patchPhase)` |
| inner shadowBlur | static `8` |
| overall alpha (lifetime fade) | `clamp(lifeT / 1.0, 0, 1)` |
| ember emission cadence | 8 / second |

### Pitchfork (three-phase swing)

```
swingDur = 0.36   // total
windupEnd = 0.12
strikeEnd = 0.18
recoverEnd = 0.36

offset(swingT) =
    swingT < windupEnd  → lerp(0,    -0.9, smoothstep(0, windupEnd, swingT))
    swingT < strikeEnd  → lerp(-0.9, +0.6, (swingT - windupEnd) / (strikeEnd - windupEnd))
    swingT < recoverEnd → lerp(+0.6,  0,   (swingT - strikeEnd) / (recoverEnd - strikeEnd))
    else                → 0
```

| Property | Formula |
|---|---|
| visible from | `swingT >= 0` until `swingT >= recoverEnd` |
| current angle | `swingAngle + offset(swingT)` |
| tine glint shadowBlur | `12 + 8*sin(loopT*20)` during STRIKE only; `0` otherwise |
| impact arc visible | only during STRIKE (`windupEnd ≤ swingT < strikeEnd`) |
| impact arc alpha | `1 - (swingT - windupEnd) / (strikeEnd - windupEnd)` (fades over strike) |

`smoothstep(a, b, x) = clamp((x-a)/(b-a), 0, 1)` and squared: `t*t*(3 - 2*t)`.

---

## Time-step contract

- A single `loopT` is computed once per frame at the top of the game loop and passed to every draw call. **Never** call `performance.now()` inside an entity's draw — that desynchronizes phases.
- `dt = min(now - lastFrame, 0.05)` clamps long pauses (tab in background) to avoid huge integrations.
- All per-entity phases that increment by `freq*dt` are wrapped: `phase = phase % (Math.PI * 2)` once per second to keep them small for FP precision.

---

## Easing reference

The only easing curves used in this game:

| Name | Formula | Used by |
|---|---|---|
| sin | `sin(x)` | All ambient sway/bob/pulse animations. |
| sin² | `sin(x)*sin(x)` | Aggro ring alpha, pickup blink — gives a "throb" rather than "wave". |
| 1 - cos | `1 - cos(x)` | Only if an explicitly ease-out feel is needed (not used in any current spec; reserved). |
| smoothstep | `t*t*(3 - 2*t)` | Pitchfork wind-up phase only. |
| linear ramp | `t/dur` | All discrete events (swing strike, hit flash, fuse, lifetime fade). |
