# CROW ARCHER — Particle Specs

All values are direct arguments for the existing `burst(x, y, opts)` API. Where a particle is continuously emitted (e.g. fire trail), the `count` is the count **per emission tick** and the emission cadence is listed in `notes`.

The renderer branches on `p.shape`:
- `circle`: `arc(p.x, p.y, p.r)`, fill flat color, optional shadowBlur.
- `spark`: a 1px line drawn from `p.x, p.y` along its velocity vector by `4..6` px — velocity-aligned. Faster moving = longer streak.
- `line`: a fixed-length 1px line segment, angle frozen at spawn (used for debris).

Decay is in `alpha-units per second` — so `decay: 2.0` means a particle's alpha drops from 1.0 to 0.0 in 0.5 seconds.

For every event, particle initial velocity is `random direction × random speed in [speedMin, speedMax]`. Velocity is in **px/s** and is **integrated with dt every frame** (`p.x += p.vx * dt`). Optional `gravity` applies a constant downward acceleration in px/s².

---

### 01. CROW DEATH BURST

A puff of dark feathers and one bright sentry spark.

- **shape:** mixed — 80% `circle`, 20% `spark`
- **colors:** `['#0A0A0A', '#1F1F1F', '#3A3A3A', '#FFB400']`  *(black/dark-gray feathers; one amber spark in the rotation = the dying eye light)*
- **count:** 14
- **speed:** 40–120 px/s
- **decay:** 1.8 (~0.55s lifetime)
- **size:** `circle` r = 1.5–2.5; `spark` length = 5
- **gravity:** 0 (crows are airborne; particles drift)
- **shadowBlur:** 0 on feather circles; `4` on the amber spark
- **notes:** one of the spark particles is forced amber `#FFB400` to guarantee a "soul" pop per kill; the rest are randomly picked from the color list. Particles slow over time via velocity damping `v *= (1 - 0.6*dt)`.

---

### 02. BOSS DEATH BURST

Massive, multi-layered, three sub-bursts staggered by 80ms each. The implementer should `burst()` three times with the staggers — each sub-burst with its own profile below.

**Sub-burst A (t = 0ms) — feathers & ash**
- **shape:** `circle`
- **colors:** `['#050505', '#1A1A1A', '#3A3A3A', '#5A0808']`
- **count:** 32
- **speed:** 60–200 px/s
- **decay:** 1.0 (~1.0s lifetime)
- **size:** r = 2–4
- **gravity:** 30 px/s²
- **shadowBlur:** 0
- **notes:** velocity damping `0.4*dt`.

**Sub-burst B (t = +80ms) — red embers**
- **shape:** `spark`
- **colors:** `['#FF1F1F', '#8A1010', '#FFB400']`
- **count:** 18
- **speed:** 120–280 px/s
- **decay:** 1.4 (~0.7s lifetime)
- **size:** spark length = 6
- **gravity:** 0
- **shadowBlur:** `6` on all
- **notes:** "soul leaving the king."

**Sub-burst C (t = +160ms) — bright corona pop**
- **shape:** `circle`
- **colors:** `['#FFB400', '#FFFFFF', '#FF7A1F']`
- **count:** 8
- **speed:** 30–80 px/s
- **decay:** 0.9 (~1.1s lifetime — lingers)
- **size:** r = 3–6 (these are big)
- **gravity:** 0
- **shadowBlur:** `12 + 6*sin(loopT*20)` — animated bloom on the dying corona
- **notes:** these particles ALSO scale their radius down over life: `r *= (1 - 0.4*dt)`. Final flourish.

---

### 03. PICKUP COLLECT — RICOCHET

Crisp cyan flash.

- **shape:** `spark`
- **colors:** `['#39E0FF', '#7AF0FF', '#FFFFFF']`
- **count:** 12
- **speed:** 80–160 px/s
- **decay:** 2.2 (~0.45s lifetime)
- **size:** spark length = 5
- **gravity:** 0
- **shadowBlur:** `6`
- **notes:** emit in a tight ring (angles spaced `2π/count + jitter`) so it reads as a snap-ring rather than a chaotic puff.

---

### 04. PICKUP COLLECT — FIRE

Warm flash that lingers slightly.

- **shape:** mixed — 60% `circle`, 40% `spark`
- **colors:** `['#FFB400', '#FF7A1F', '#FFFFFF', '#B23A00']`
- **count:** 16
- **speed:** 50–140 px/s
- **decay:** 1.6 (~0.6s lifetime)
- **size:** circle r = 1.5–3; spark length = 6
- **gravity:** -20 px/s² *(negative = rises — like heat)*
- **shadowBlur:** `8 + 2*sin(loopT*20)` on warm colors; `0` on `#B23A00` smoke
- **notes:** the `#B23A00` particles are "smoke" — give them 2× the lifetime via decay `0.8` and r = 3–5.

---

### 05. EXPLOSION (DYNAMITE)

Three-stage: flash → fireball ring → smoke. Spawned as one combined `burst()` with `count: 60` AND three discrete radial waves.

**Wave 1 — white flash (t = 0ms)**
- **shape:** `circle`
- **colors:** `['#FFFFFF', '#FFB400']`
- **count:** 12
- **speed:** 200–360 px/s
- **decay:** 4.0 (~0.25s lifetime — gone fast)
- **size:** r = 2–5
- **shadowBlur:** `16`
- **notes:** spawned at the explosion epicenter. These define the "muzzle" frame.

**Wave 2 — fireball ring (t = +30ms)**
- **shape:** `circle`
- **colors:** `['#FF7A1F', '#FF1F1F', '#FFB400', '#8A1010']`
- **count:** 36
- **speed:** 120–260 px/s
- **decay:** 1.2 (~0.8s lifetime)
- **size:** r = 2.5–5
- **gravity:** 0
- **shadowBlur:** `10`
- **notes:** velocity damping `0.5*dt`. Spawn angles biased toward a ring (radius emission jitter ±0.3 rad) for a shockwave look.

**Wave 3 — smoke (t = +120ms)**
- **shape:** `circle`
- **colors:** `['#3A3A3A', '#1A1A1A', '#5C5C5C']`
- **count:** 12
- **speed:** 30–80 px/s
- **decay:** 0.5 (~2.0s lifetime — lingers)
- **size:** r = 4–7 (and grows: `r += 6*dt`)
- **gravity:** -10 px/s²
- **shadowBlur:** 0
- **notes:** smoke trails up and slowly enlarges.

---

### 06. WATER SPLASH (DYNAMITE HITS WATER)

Cool, fast, droplet-shaped.

- **shape:** mixed — 70% `spark` (droplets), 30% `circle` (foam)
- **colors:** `['#2A66B0', '#5A92D8', '#A0C8F0', '#FFFFFF']`
- **count:** 22
- **speed:** 120–260 px/s — biased upward: y velocity multiplied by 1.6, x by 0.7
- **decay:** 1.6 (~0.6s lifetime)
- **size:** spark length = 5; circle r = 1.5–3
- **gravity:** 380 px/s² *(droplets arc and fall back)*
- **shadowBlur:** `4` on `#FFFFFF` particles only; `0` elsewhere
- **notes:** also leaves a `rgba(160,200,240, 0.5)` ring drawn for 0.3s at impact site — handled as a one-shot decal, not a particle, but listed here for completeness.

---

### 07. PITCHFORK STRIKE SPARKS

Short, sharp, three-tine emission. Spawned at the three tine tip positions at the start of the STRIKE phase.

- **shape:** `spark`
- **colors:** `['#FFFFFF', '#39FF14', '#D9D9D9']`
- **count:** 4 per tine × 3 tines = **12 total**
- **speed:** 90–160 px/s
- **decay:** 3.0 (~0.33s lifetime — sharp)
- **size:** spark length = 6
- **gravity:** 60 px/s² (slight gravity for "scrap metal" feel)
- **shadowBlur:** `6`
- **notes:** spawn direction is biased forward by `swingAngle ± 0.4 rad` — sparks fly the way the strike points, not in a 360° puff. Velocity damping `0.8*dt` for a crisp falloff.

---

## Continuous-emission helpers

These are not "events" — they are continuous trails attached to entities. The host's particle system needs to support per-frame emission with rate-limiting (max ~120 active particles globally; oldest dropped first).

### FIRE-ARROW TRAIL
- **shape:** `circle`
- **colors:** `['#FF7A1F', '#FFB400', '#FFFFFF']` (60/30/10 weight)
- **emission rate:** 1 particle every `0.03s` while arrow is alive
- **speed:** 0–20 px/s (drift only — arrow's velocity is not inherited)
- **decay:** 3.0 (~0.33s lifetime)
- **size:** r = 1.5–2.5
- **gravity:** -40 px/s² (rises like heat)
- **shadowBlur:** `8`

### FIRE-PATCH EMBERS
- **shape:** `spark`
- **colors:** `['#FFB400', '#FF7A1F', '#FFFFFF']`
- **emission rate:** 8 particles/second from random points within `r=10` of patch center
- **speed:** 20–60 px/s
- **decay:** 1.5 (~0.66s lifetime)
- **size:** spark length = 3
- **gravity:** -80 px/s² (rises hard)
- **shadowBlur:** `6`

### RICOCHET-ARROW TRAIL
Already covered by the arrow's own `trailHistory` ghost rendering — no particle emission needed. Listed here so the implementer does not also emit particles by mistake.

---

## Global rules

- Particles update before they render: `p.x += p.vx*dt; p.y += p.vy*dt; p.vy += gravity*dt; p.vx *= dampingFactor; p.alpha -= decay*dt;` then cull if `alpha <= 0`.
- Particles draw **above** the world tiles and entities, **below** the HUD.
- `ctx.globalAlpha = p.alpha` before each draw; reset to 1 after.
- `ctx.shadowBlur` and `ctx.shadowColor` must be set per-particle from the spec (don't leak from the previous entity).
- Hard cap: 120 active particles. Beyond cap, drop oldest.
