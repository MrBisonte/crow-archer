# CROW ARCHER — Entity Specs

Every entity below is fully specified for direct translation into Canvas 2D calls. Origin is the entity's logical center unless noted. All measurements in pixels. All colors in hex or rgba. All glows are `ctx.shadowBlur` with `shadowColor` set to the listed glow/shadow value before the relevant fill — reset to `0` between elements that should not bloom.

`loopT` = seconds since game start (`performance.now()/1000`).
`dt` = delta seconds since last frame.
Per-entity state variables are listed at the top of each entry. New variables are explicitly named.

---

### 01. PLAYER

**State variables**
- `walkPhase` (float, radians) — advances by `8 * dt * speedScalar` while moving; frozen otherwise.
- `aimAngle` (float, radians) — atan2 from player to mouse.
- `bowCharge` (0..1) — `min(1, holdTime / 0.6)`.
- `cloakSway` (float) — `0.15 * sin(loopT * 2.2 + entityPhase)` — small idle ambient sway, additive to walkPhase.

**Palette**
- body (tunic): `#3A5F88`
- skin: `#D9B98A`
- hat: `#0E1410`
- cloak: `#0E1410`
- cloak edge (1px stroke): `#39FF14`
- bow wood: `#8A6028`
- bowstring (and charge glow): `#39FF14`
- ground shadow: `rgba(0,0,0,0.45)`
- glow/shadow color: `#39FF14`
- shadowBlur: `4 + 8 * bowCharge` on the bowstring only. `0` elsewhere on the player. The cloak edge uses a flat `shadowBlur: 3`.

**Geometry** (origin = player center; ground-shadow ellipse sits at y = +9)
1. **Ground shadow** — `ellipse(0, +9, rx=9, ry=2.5)`, fill `rgba(0,0,0,0.45)`, no blur.
2. **Cloak** (drawn before body so body covers front) — single `bezierCurveTo` shape, fill `#0E1410`, stroke `#39FF14` 1px:
   - Anchored at shoulders (left `(-5, -3)`, right `(+5, -3)`).
   - Bottom corners at `(-7, +7 + cloakOffset)` and `(+7, +7 - cloakOffset)` where `cloakOffset = 1.5 * sin(walkPhase + cloakSway)`.
   - Control points push outward 4px to create a cape silhouette wider than the body.
3. **Body / tunic** — `fillRect(-5, -3, 10, 11)`, fill `#3A5F88`. Add a 1px `#0E1410` belt: `fillRect(-5, +3, 10, 1)`.
4. **Head** — `arc(0, -8, r=5)`, fill `#D9B98A`.
5. **Hat** — `fillRect(-5, -13, 10, 3)` plus a 1px brim `fillRect(-6, -10, 12, 1)`, both fill `#0E1410`.
6. **Bow arm** — single 1px `lineTo` from shoulder `(0, -2)` to bow-grip at `cos(aimAngle)*8, sin(aimAngle)*8`, stroke `#D9B98A`.
7. **Bow** — `arc(grip.x, grip.y, r=7, aimAngle - π/2, aimAngle + π/2)`, stroke `#8A6028` 1.5px. (A half-circle facing the aim direction.)
8. **Bowstring** — 2 line segments from bow top to nock to bow bottom; nock is at `grip + (-cos(aimAngle), -sin(aimAngle)) * (3 + 2*bowCharge)`. Stroke `#39FF14` 1px, `shadowColor #39FF14`, `shadowBlur 4 + 8*bowCharge`.
9. **Charge glow** (only when `bowCharge > 0.6`) — `arc(grip, r=2 + 2*bowCharge)`, fill `#39FF14`, `shadowBlur 12`.

**Canvas draw order** (back → front)
1. ground shadow → 2. cloak → 3. body → 4. head → 5. hat → 6. bow arm → 7. bow → 8. bowstring → 9. charge glow.

**Readability check.** Total height ~22px (hat top -13 to cloak bottom +9). Silhouette dominated by hat + cloak triangle → reads at 20px scale.

---

### 02. CROW (NORMAL)

**State variables**
- `wingPhase` (float) — advances `12 * dt` (faster than player walk).
- `entityPhase` (float) — random `0..2π` at spawn; decorrelates flocks.
- `bobY` (float) — `0.8 * sin(loopT * 3 + entityPhase)` body offset.

**Palette**
- body: `#0A0A0A`
- body-edge (1px outer stroke for definition vs. ground): `#1F1F1F`
- wing: `#0A0A0A` with `#1F1F1F` 1px outline
- beak: `#FFB400` (small but readable — was missing before, adds threat)
- eye: `#FFB400`  (amber, was yellow `#FFD000` — push toward orange for menace)
- eye glint: `#FF1F1F` (1px pixel — the menacing detail)
- ground shadow: `rgba(0,0,0,0.35)`
- glow color: `#FFB400`
- shadowBlur: `3` on the eye only; everything else `0`.

**Geometry** (origin = crow center, ellipse rx/ry given)
1. **Ground shadow** — `ellipse(0, +6, rx=7, ry=1.8)`, fill `rgba(0,0,0,0.35)`.
2. **Body** — `ellipse(0, bobY, rx=8, ry=5)`, fill `#0A0A0A`, then re-stroke with `#1F1F1F` 1px for silhouette.
3. **Tail** — single triangular `lineTo` path: `(rx 6, bobY+1) → (rx 11, bobY-2) → (rx 11, bobY+4) → close`, fill `#0A0A0A`. Adds a clear back-end so direction reads even at rest.
4. **Wing — left** — `ellipse(-3, bobY - 2 + sin(wingPhase)*3, rx=8, ry=3, rot = -0.4 + 0.5*sin(wingPhase))`, fill `#0A0A0A`, 1px `#1F1F1F` stroke.
5. **Wing — right** — same as left but mirrored x and `+π` offset on the phase.
6. **Beak** — small triangle `lineTo` path: `(-9, bobY - 0.5) → (-13, bobY) → (-9, bobY + 1.5)`, fill `#FFB400`. (Faces -x; flip with crow's heading.)
7. **Eye** — `arc(-6, bobY - 1.5, r=1.2)`, fill `#FFB400`, `shadowBlur 3`, `shadowColor #FFB400`.
8. **Eye glint** — single `fillRect(-6, bobY - 1.5, 1, 1)`, fill `#FF1F1F`, no blur. This is the new threat detail.

**Canvas draw order**
1. ground shadow → 2. body → 3. tail → 4. far wing → 5. near wing → 6. beak → 7. eye → 8. eye glint.

> **Threat improvements over current.** Amber/red eye (not yellow), added beak triangle, added tail triangle so the crow has a direction, 1px edge stroke for silhouette pop, body bob to suggest watching/breathing while hovering.

---

### 03. CROW (WHITE / BOSS-PHASE)

Identical geometry to CROW (NORMAL). Palette swap only.

**Palette**
- body: `#E8E8E8`
- body-edge: `#FFFFFF`
- wing: `#E8E8E8` outlined `#FFFFFF`
- beak: `#FF1F1F`
- eye: `#FF1F1F`
- eye glint: `#FFFFFF` (inverted)
- ground shadow: `rgba(0,0,0,0.55)` (heavier — they feel weightier)
- glow color: `#FF1F1F`
- shadowBlur: `4 + 2*sin(loopT*4 + entityPhase)` on the eye. Body has a subtle `shadowBlur 6 #FFFFFF` to read as "lit from within" against dark tiles.

**Animation tweaks** (everything else identical)
- `wingPhase` advances at `14 * dt` — 17% faster than normal crows for elevated tension.
- `bobY` amplitude `1.2` (was 0.8) — they hover with more authority.

---

### 04. CROW (AGGRO STATE)

A normal or white crow flagged `aggro = true`. Layered ON TOP of the base crow draw. Do not change body color (the current red fill replaces silhouette and confuses the eye). Instead, add **two** distinct cues so aggro is unmistakable.

> **v2 (this revision):** dropped the speed trail. With aggro crows already moving across a busy tilemap and emitting nothing but red, three cues was too loud. Two cues — throbbing ring + eye flare — read more cleanly.

**State variables**
- `aggroT` (float, seconds since `aggro` became true) — counts up from 0.
- `pulsePhase` (float) — `loopT * 6`.

**Palette**
- pulse ring: `rgba(255, 31, 31, alpha)` where `alpha = 0.55 - 0.4 * sin²(pulsePhase)`
- glint bar: `#FF1F1F`
- glow color: `#FF1F1F`
- shadowBlur on ring: `8 + 4 * sin(pulsePhase)`

**Geometry** (drawn after the crow, before HUD)
1. **Pulse ring** — `arc(crow.x, crow.y, r = 10 + 3*sin(pulsePhase))`, stroke 1.5px, color above. shadowBlur 8+4*sin(pulsePhase).
2. **Eye flare** — replace the normal eye glint with a 2×2 `fillRect`, fill `#FF1F1F`, shadowBlur 5.

**Canvas draw order** (relative to a normal crow)
1. crow ground shadow → 2. body+wings+beak → 3. eye+eye flare → 4. **pulse ring** (over everything).

> Two signals (color-shifted eye, throbbing ring) instead of three. The ring keeps the current vocabulary while the eye flare adds a sharper, more local cue that survives chaotic moments.

---

### 05. BOSS (v2 — imposing)

The crow king. Same primitives as a crow but scaled, layered, and slowed for weight. **v2 grows every dimension ~17–20% and adds two more crown spikes** so it dominates the screen on first appearance.

**State variables**
- `wingPhase` advances `5 * dt` — slow, ominous.
- `entityPhase` random.
- `bobY` — `2.4 * sin(loopT * 1.5 + entityPhase)`.
- `eyeFlicker` — `loopT * 8` (separate from wingPhase to keep eyes alive when wings are at rest).
- `bossPulse` — `0.5 + 0.5 * sin(loopT * 2)` drives the corona.

**Palette**
- body: `#050505` (deeper than normal crow — pure void)
- body inner highlight: `#1A1A1A` ellipse for shading
- wing primary: `#8A1010`
- wing inner (covert): `#5A0808`
- wing edge feathers: `#0A0A0A` (1px stroke)
- crown spikes: `#0A0A0A` with `#5A0808` rim light
- beak: `#3A0606`
- eyes: `#FF1F1F`
- eye core (1px): `#FFB400`
- corona: `rgba(255, 31, 31, 0.18 + 0.12 * bossPulse)`
- ground shadow: `rgba(0,0,0,0.7)`
- glow color: `#FF1F1F`
- shadowBlur: corona `24 + 10 * bossPulse`; eyes `10 + 5 * sin(loopT*8)`; wings `0`.

**Geometry** (origin = boss center, scaled up from v1)
1. **Ground shadow** — `ellipse(0, +22, rx=32, ry=6)`, fill `rgba(0,0,0,0.7)`.
2. **Corona** — `arc(0, bobY, r = 38 + 5*bossPulse)`, fill `rgba(255,31,31, 0.18 + 0.12*bossPulse)`, shadowBlur `24 + 10*bossPulse`, shadowColor `#FF1F1F`.
3. **Far wing** — `ellipse(+4, bobY - 2 + sin(wingPhase)*5, rx=28, ry=11, rot = 0.3 + 0.4*sin(wingPhase))`, fill `#5A0808`.
4. **Far wing edge feathers** — 5 short `lineTo` segments at 20%, 40%, 55%, 70%, 85% along the wing's outer edge, each 6px out, stroke `#0A0A0A` 1.5px.
5. **Body** — `ellipse(0, bobY, rx=28, ry=18)`, fill `#050505`.
6. **Body highlight** — `ellipse(-5, bobY-4, rx=14, ry=6)`, fill `#1A1A1A`.
7. **Crown spikes** — **5** triangular `lineTo` shapes across the head with rhythmic heights 5/8/11/8/5. Fill `#0A0A0A`, then re-stroke top half with `#5A0808` 1px for rim light. Spikes anchored to top of head at `y = bobY - 8`.
8. **Beak** — large triangle `(-26, bobY-1) → (-38, bobY) → (-26, bobY+5)`, fill `#3A0606`.
9. **Eyes** — two `arc(-21, bobY - 4, r=5)` and `arc(-21, bobY + 3, r=5)`, fill `#FF1F1F`, shadowBlur `10 + 5*sin(loopT*8)`.
10. **Eye cores** — 1×1 `fillRect` at each eye center, fill `#FFB400`, no blur.
11. **Near wing** — same as far wing but mirrored y-offset and phase `+π`. Drawn last so it overlaps body silhouette on the player-facing side.
12. **Near wing edge feathers** — same as far wing.

**Canvas draw order**
1. ground shadow → 2. corona → 3. far wing → 4. far wing edge feathers → 5. body → 6. body highlight → 7. crown spikes → 8. beak → 9. eyes → 10. eye cores → 11. near wing → 12. near wing edge feathers.

> Presence comes from: bigger corona pulse, taller central crown spike, two larger eyes with hotter pulse, dual-tone wings with more edge feathers, body highlight, deeper ink than normal crows, and slowed wing tempo. All still primitives.

---

### 06. ARROW (NORMAL)

**State variables**
- `angle` (float) — direction of flight, from `atan2(vy, vx)`.

**Palette**
- shaft: `#D4A832`
- head: `#F0C830`
- fletching: `#A07828`
- glow color: `#F0C830`
- shadowBlur: `4` on the head only. `0` on shaft and fletch.

**Geometry** (drawn translated to arrow.x, arrow.y, rotated by `angle`)
1. **Shaft** — `fillRect(-10, -0.5, 21, 1)`, fill `#D4A832`.
2. **Head** — triangle `lineTo` path `(11, -2) → (15, 0) → (11, +2) → close`, fill `#F0C830`, shadowBlur 4, shadowColor `#F0C830`.
3. **Fletching** — two diagonal `lineTo` segments: `(-10, -2) → (-7, 0)` and `(-10, +2) → (-7, 0)`, stroke `#A07828` 1px.

**Canvas draw order**: shaft → head → fletching (head over shaft so it isn't hidden by the rect's antialiased edge).

---

### 07. ARROW (RICOCHET)

Bounces off rocks/walls. Has a visible "bounce-readiness" cue.

**State variables**
- `angle` — flight direction.
- `bouncesLeft` (int) — decrements on hit.
- `trailHistory` — last 6 frame positions (deque of `{x, y, t}`).

**Palette**
- shaft: `#39E0FF`
- head: `#7AF0FF`
- fletching: `#1B7A8A`
- trail: `rgba(57, 224, 255, alpha)` where `alpha = 0.5 * (1 - i/6)` for ghost index `i`.
- bounce indicator: `#FFFFFF`
- glow color: `#39E0FF`
- shadowBlur: `6` on head, `4` on shaft (cyan glows more than gold — it's an "energized" arrow).

**Geometry**
1. **Trail** — 6 ghost copies of the arrow shaft+head at positions in `trailHistory`, each rect `fillRect(-10, -0.5, 21, 1)` rotated to that frame's angle, fill `rgba(57,224,255, 0.5 - i*0.08)`, no blur on trail.
2. **Shaft** — `fillRect(-10, -0.5, 21, 1)`, fill `#39E0FF`, shadowBlur 4, shadowColor `#39E0FF`.
3. **Head** — triangle `(11,-2) → (15,0) → (11,+2)`, fill `#7AF0FF`, shadowBlur 6.
4. **Fletching** — two diagonals as normal arrow, stroke `#1B7A8A`.
5. **Bounce pips** — small 1×1 `fillRect` per remaining bounce at `(2 + i*2, -3)` along the shaft, fill `#FFFFFF`. 3 bounces → 3 pips; consumed pips disappear.

**Canvas draw order**: trail → shaft → head → fletching → bounce pips.

---

### 08. ARROW (FIRE)

**State variables**
- `angle` — flight direction.
- `fireSeed` (random per arrow) — used to decorrelate flame jitter.
- emit a `fire-trail` particle every `0.03s` (see particles).

**Palette**
- shaft: `#FF7A1F`
- head: `#FFB400`
- fletching: `#B23A00`
- flame core (drawn at fletching): `#FFB400`
- flame outer: `#FF7A1F`
- flame smoke (background of trail): `rgba(178, 58, 0, 0.4)`
- glow color: `#FF7A1F`
- shadowBlur: `8 + 3 * sin(loopT * 12 + fireSeed)` on the head; `6` on shaft; `10 + 4*sin(loopT*10 + fireSeed)` on the rear flame.

**Geometry**
1. **Trail flame ellipse** (rear) — `ellipse(-12 - 2*sin(loopT*10), 0, rx=4 + sin(loopT*14 + fireSeed), ry=2.5)`, fill `#FF7A1F`, shadowBlur 10+4*sin(loopT*10 + fireSeed), shadowColor `#FF7A1F`.
2. **Trail flame inner** — `ellipse(-11, 0, rx=2.5, ry=1.5)`, fill `#FFB400`, shadowBlur 6.
3. **Shaft** — `fillRect(-10, -0.5, 21, 1)`, fill `#FF7A1F`, shadowBlur 6.
4. **Head** — triangle `(11,-2) → (15,0) → (11,+2)`, fill `#FFB400`, shadowBlur 8+3*sin(loopT*12 + fireSeed).
5. **Fletching** — two diagonals, stroke `#B23A00`.
6. Continuously emits **fire-trail** particles (see specs/particles.md).

**Canvas draw order**: rear flame outer → rear flame inner → shaft → head → fletching.

---

### 09. DYNAMITE (v2 — grown body)

**v2 grows the body from 20×6 to 24×8 so the label rect is large enough to render "TNT" at 6px legibly.** Everything else is identical.

**State variables**
- `fuseT` (float, seconds remaining) — counts down.
- `sparkPhase` — `loopT * 18`.
- `bobPhase` — random per dynamite.

**Palette**
- body: `#FF1F1F`
- body shading: `#8A1010` (right half darker for cylinder volume)
- label rect: `#F0F0F0`
- label text "TNT": `#0A0A0A`
- wick: `#A07828`
- wick char (last 30%): `#3A2A1A`
- spark core: `#FFFFFF`
- spark outer: `#FFB400`
- countdown text: `#FF1F1F` when `fuseT > 1s`, `#FFB400` when `fuseT ≤ 1s and > 0.5s`, `#FFFFFF + shadowBlur 16` when `fuseT ≤ 0.5s`
- ground shadow: `rgba(0,0,0,0.45)`
- glow color (spark): `#FFB400`
- shadowBlur: spark = `6 + 4 * sin(sparkPhase)`. Countdown text = `4` (or `16` in final 0.5s).

9. **Geometry** (origin = dynamite center; sits at thrown position)
1. **Ground shadow** — `ellipse(0, +7, rx=13, ry=2.5)`, fill `rgba(0,0,0,0.45)`.
2. **Body** — `fillRect(-12, -4, 24, 8)`, fill `#FF1F1F`.
3. **Body shading** — `fillRect(-12, 0, 24, 4)`, fill `#8A1010`. Bottom half is darker → reads as a cylinder, not a flat rect.
4. **End caps** — `fillRect(-12, -4, 1, 8)` and `fillRect(+11, -4, 1, 8)`, fill `#5A0808`.
5. **Label rect** — `fillRect(-7, -3, 14, 6)`, fill `#F0F0F0`.
6. **Label text** — `ctx.font = "bold 6px monospace"; ctx.fillStyle = "#0A0A0A"; ctx.fillText("TNT", 0, 0.5);` with `textAlign:center, textBaseline:middle`. (Body grew specifically so this reads on first glance.)
7. **Wick** — bezier curve from `(+11, -4)` arcing up-right to `(+17, -10)`. Stroke `#A07828` 1.5px for the first 70% of length, `#3A2A1A` 1.5px for the last 30% (the burnt portion grows from 30% toward 80% as `fuseT` decreases — `burntFrac = 1 - fuseT/fuseTotal`).
8. **Spark — core** — `arc(17, -10, r = 1.5 + 0.5*sin(sparkPhase))`, fill `#FFFFFF`, shadowBlur `6 + 4*sin(sparkPhase)`, shadowColor `#FFB400`.
9. **Spark — outer halo** — `arc(17, -10, r = 3 + sin(sparkPhase))`, fill `rgba(255, 180, 0, 0.4)`, no extra blur.
10. **Countdown text** — `ctx.font = "bold 10px monospace"; ctx.fillText(Math.ceil(fuseT), 0, -12);`. Color/glow per palette rules above.
11. **Idle bob** — entire entity is translated by `+1.5 * sin(loopT*4 + bobPhase)` on Y while at rest, simulating the stick rocking on uneven ground.

**Canvas draw order**: shadow → body → body shading → end caps → label rect → label text → wick → spark halo → spark core → countdown text.

> Improvements over current: cylinder shading, end caps, "TNT" stencil, burning wick that visibly chars over time, three-tier countdown color/glow that escalates to white-hot in the final half-second, idle bob.

---

### 10. PICKUP (RICOCHET TYPE)

A floating cyan arrow icon awaiting collection.

**State variables**
- `bobPhase` (random per pickup).
- `blinkPhase` — `loopT * 4 + bobPhase`.

**Palette**
- arrow shaft: `#39E0FF` modulated alpha `0.5 + 0.5 * sin²(blinkPhase)` for the blink
- arrow head: `#7AF0FF`
- pedestal halo: `rgba(57, 224, 255, 0.25 + 0.15 * sin(blinkPhase))`
- ground shadow: `rgba(0,0,0,0.35)`
- glow color: `#39E0FF`
- shadowBlur: `6 + 4 * sin(blinkPhase)` on the whole glyph; halo uses `12`.

**Geometry** (origin = pickup center; floats 4px above ground)
1. **Ground shadow** — `ellipse(0, +8, rx=8, ry=1.8)`, fill `rgba(0,0,0,0.35)`.
2. **Pedestal halo** — `arc(0, 0, r = 10 + sin(blinkPhase))`, fill above, shadowBlur 12.
3. **Float offset** — translate all glyph elements below by `bobY = -2 + sin(loopT*3 + bobPhase) * 2`.
4. **Arrow shaft** (drawn horizontally, like a held arrow) — `fillRect(-7, -0.5, 14, 1)`, fill cyan w/ animated alpha.
5. **Arrow head** — triangle `(7,-2) → (11,0) → (7,+2) → close`, fill `#7AF0FF`.
6. **Bounce pips** — 3 small 1×1 `fillRect` at `(-2, -3), (0, -3), (+2, -3)`, fill `#FFFFFF`. Brand cue: pickup → arrow with bounce pips → ricochet ammo.

**Canvas draw order**: ground shadow → halo → shaft → head → pips.

---

### 11. PICKUP (FIRE TYPE)

Orange arrow icon with an animated flame at the nock.

**State variables**
- `bobPhase` (random).
- `flamePhase` — `loopT * 10 + bobPhase`.

**Palette**
- arrow shaft: `#FF7A1F`
- arrow head: `#FFB400`
- flame outer: `#FF7A1F`
- flame inner: `#FFB400`
- flame core: `#FFFFFF`
- pedestal halo: `rgba(255, 122, 31, 0.30 + 0.15 * sin(flamePhase*0.4))`
- ground shadow: `rgba(0,0,0,0.35)`
- glow color: `#FF7A1F`
- shadowBlur: shaft/head `6`; flame outer `12 + 4 * sin(flamePhase)`; halo `14`.

**Geometry** (origin = pickup center)
1. **Ground shadow** — `ellipse(0, +8, rx=8, ry=1.8)`, fill `rgba(0,0,0,0.35)`.
2. **Pedestal halo** — `arc(0, 0, r = 11 + sin(flamePhase*0.4))`, fill above, shadowBlur 14.
3. **Float offset** — same bob as ricochet pickup.
4. **Flame — outer** — `ellipse(-9, 0, rx = 3 + sin(flamePhase), ry = 4 + 0.5*sin(flamePhase*1.3))`, fill `#FF7A1F`, shadowBlur 12+4*sin(flamePhase), shadowColor `#FF7A1F`.
5. **Flame — inner** — `ellipse(-9, 0, rx=2, ry=3)`, fill `#FFB400`.
6. **Flame — core** — `arc(-9, 0, r = 0.8 + 0.4*sin(flamePhase*2))`, fill `#FFFFFF`.
7. **Arrow shaft** — `fillRect(-7, -0.5, 14, 1)`, fill `#FF7A1F`.
8. **Arrow head** — triangle `(7,-2) → (11,0) → (7,+2)`, fill `#FFB400`.

**Canvas draw order**: shadow → halo → flame outer → flame inner → flame core → shaft → head.

---

### 12. FIRE PATCH

Burning ground left by a fire-arrow impact or boss attack.

**State variables**
- `lifeT` (seconds remaining, default 4s).
- `birthT` (loopT at creation).
- `patchPhase` (random).

**Palette**
- radial gradient stop 0 (center, hot): `#FFB400`
- radial gradient stop 0.4: `#FF7A1F`
- radial gradient stop 0.8: `rgba(178, 58, 0, 0.5)`
- radial gradient stop 1 (edge): `rgba(178, 58, 0, 0)`
- ember particles: see specs/particles.md `fire-patch-embers`
- glow color: `#FF7A1F`
- shadowBlur: `14 + 4 * sin(loopT*6 + patchPhase)` applied to the patch fill.

**Geometry** (origin = patch center, on ground)
1. **Outer halo** — `arc(0, 0, r_outer)` where `r_outer = 16 + 3 * sin(loopT*5 + patchPhase)`, fill = `createRadialGradient(0,0,2, 0,0, r_outer)` with the stops above. shadowBlur `14 + 4*sin(loopT*6 + patchPhase)`, shadowColor `#FF7A1F`.
2. **Inner core** — `arc(0, 0, r_inner)` where `r_inner = 6 + 1.5*sin(loopT*8 + patchPhase)`, fill flat `#FFB400`, shadowBlur 8.
3. **Lifetime fade** — multiply final alpha by `clamp(lifeT/1.0, 0, 1)` — the patch fades out over its last second of life.
4. Emits **fire-patch-embers** particles at `8 particles/second`.

**Canvas draw order**: outer halo → inner core → ember emission (particles drawn in the particle layer, above ground but below entities).

---

### 13. PITCHFORK

Melee weapon. Three-phase swing animation: WIND-UP → STRIKE → RECOVER.

**State variables**
- `swingT` — seconds since swing began.
- `swingDur` — `0.36s` total (`windup` 0.12s, `strike` 0.06s, `recover` 0.18s).
- `swingAngle` — base angle toward target. Strike angle is `swingAngle + offset(phase)`:
  - WIND-UP: `offset = lerp(0, -0.9 rad, smoothstep(0, 0.12, swingT))` (pulls back).
  - STRIKE: `offset = lerp(-0.9, +0.6 rad, (swingT-0.12) / 0.06)` (snap forward).
  - RECOVER: `offset = lerp(+0.6, 0 rad, (swingT-0.18) / 0.18)` (ease back).

**Palette**
- handle: `#8A6028` (same wood as bow)
- handle highlight (1px along top edge): `#B58A4A`
- tines: `#C8C8C8`
- tine glint (during STRIKE only): `#FFFFFF`
- impact arc (during STRIKE only): `rgba(255, 255, 255, 0.6)` fading to `rgba(57,255,20,0)`
- glow color: `#39FF14`
- shadowBlur: tine glint `12 + 8*sin(loopT*20)` during STRIKE; `0` otherwise. Handle uses `0`.

**Geometry** (origin = player hand at `(cos(swingAngle)*8, sin(swingAngle)*8)`, then rotate by `swingAngle + offset`)
1. **Handle** — `lineTo` from origin to `(28, 0)`, stroke `#8A6028` 2px.
2. **Handle highlight** — `lineTo` from `(2, -0.5)` to `(26, -0.5)`, stroke `#B58A4A` 0.5px.
3. **Crossbar** — `lineTo` from `(28, -5)` to `(28, +5)`, stroke `#C8C8C8` 1.5px.
4. **Tines** — three `lineTo` paths from `(28, -5), (28, 0), (28, +5)` outward by 8px to `(36, -5), (36, 0), (36, +5)`, stroke `#C8C8C8` 1.5px.
5. **Tine glints** (STRIKE phase only) — 1×1 `fillRect` at each tine tip `(36, -5/0/+5)`, fill `#FFFFFF`, shadowBlur as above.
6. **Impact arc** (STRIKE phase only) — `arc(0, 0, r = 38, swingAngle - 0.4, swingAngle + 0.4)`, stroke 2px with a `createLinearGradient(0, 0, cos(swingAngle)*38, sin(swingAngle)*38)`: `rgba(255,255,255,0.6)` at start → `rgba(57,255,20,0)` at end.

**Canvas draw order** (drawn AFTER player so it overlays the arm)
1. impact arc → 2. handle → 3. handle highlight → 4. crossbar → 5. tines → 6. tine glints.

> Animation timings exactly match the brief's three-phase model. Total swing 360ms; the strike subphase is intentionally the shortest (60ms) so impact feels snappy.

---

## Cross-entity rules

- **Reset `ctx.shadowBlur = 0` and `ctx.shadowColor = 'transparent'`** between drawing any non-luminous element. Forgetting this is the single most common bug — every entity will inherit the previous entity's bloom.
- **Ground shadows are drawn in a separate pass** before any entity bodies. This keeps the boss's shadow under a normal crow that flies in front of it.
- **The HUD draws last**, with `shadowBlur = 4`, `shadowColor = '#39FF14'`. Reset to `0` before returning to the world frame.
