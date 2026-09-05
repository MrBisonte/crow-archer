# -*- coding: utf-8 -*-
import math

from iconkit import G, ULT_N, pick, register

# ── VORTEX ──────────────────────────────────────────────────────────────────
# A whorl: the heavy turned top a wizard sets spinning on a spot. Every line on
# the object runs to one place -- the flywheel overhangs, the cone closes, the
# turned grooves tighten as it narrows, and it stands on a single iron point.
#
# Draft 1 was a stone hung in gold claws and read as a HOT-AIR BALLOON: a round
# mass under a small ring is a balloon before it is anything else. Draft 2 put
# a dome on the cone and read as an onion, because a curve meeting a curve has
# no shoulder. The flywheel is a hard edge and a flat top, and that is the
# whole difference between a turned object and a vegetable.
#
# Gold, because the ultimate ground is deep violet and steel there would be
# cool on cool -- the knight's shield lesson from the talent pass, inverted.
w = G(ULT_N)

CX = 23.5
FLY, SHOULDER, POINT, HALF = 19.0, 22.0, 40.0, 13.5

# Key light, up and left, matching the socket's own lit pool.
LX, LY, LZ = -0.46, -0.46, 0.76

# Gold runs four steps and a surface here runs six, so its dark end borrows
# leather's -- brown in the dark of gold is what gold looks like.
GOLD6 = 'BGgkKk'
WRAP6 = 'BCHhLh'
IRON6 = 'BHhLBL'
# Where the six steps land across a curved surface. Written for the LIGHTING
# value, not for a position across the row: draft 2 reused the position stops
# here and every value past the last one collapsed onto the reflected-light
# character, which is a cone painted in two tones and no reason on the screen.
SHADE = [0.16, 0.36, 0.70]


def turned(y, hw, ramp, lift=0.0):
    """One row across a turned surface, in the six steps every surface runs."""
    x0, x1 = int(round(CX - hw)), int(round(CX + hw))
    if x1 - x0 < 2:
        w.px(int(round(CX)), y, ramp[2])
        return
    for x in range(x0, x1 + 1):
        u = max(-1.0, min(1.0, (x - CX) / hw))
        nz = math.sqrt(max(0.05, 1.0 - u * u))
        s = 1.0 / math.sqrt(u * u + lift * lift + nz * nz)
        b = (u * LX + lift * LY + nz * LZ) * s
        w.px(x, y, pick(1.0 - b, SHADE, ramp[1:5]))
    w.px(x0, y, ramp[0])                 # dark edge, the rim turning away
    w.px(x1, y, ramp[5])                 # one pixel of reflected light


def cone_half(y):
    t = (y - SHOULDER) / (POINT - SHOULDER)
    return HALF * max(0.0, 1.0 - t) ** 0.86


# ── the flywheel's top face ─────────────────────────────────────────────────
# Flat and facing the light, so it is the brightest thing in the icon and the
# wall below it drops two steps at a hard line. That jump is the shoulder.
for y in range(15, int(FLY) + 1):
    t = (FLY - y) / 3.4
    hw = HALF * math.sqrt(max(0.0, 1.0 - t * t))
    x0, x1 = int(round(CX - hw)), int(round(CX + hw))
    for x in range(x0, x1 + 1):
        # Lit from the pool the socket itself is lit from, so the far corner of
        # the face falls away rather than sitting in one flat tone.
        d = math.hypot((x - 18.5) / 12.0, (y - 15.5) / 5.5)
        w.px(x, y, pick(d, [0.42, 0.86, 1.30], 'GgkK'))
    if x1 - x0 >= 2:
        w.px(x0, y, 'k')
        w.px(x1, y, 'g')

# ── the flywheel's wall ─────────────────────────────────────────────────────
for y in range(int(FLY) + 1, int(SHOULDER)):
    turned(y, HALF, GOLD6)

# ── the cone ────────────────────────────────────────────────────────────────
for y in range(int(SHOULDER), int(POINT) + 1):
    hw = cone_half(y)
    if hw >= 0.6:
        turned(y, hw, GOLD6)

# ── the turned grooves ──────────────────────────────────────────────────────
# They tighten as the cone does, which is the read: an object whose every line
# runs to one place. Cut as an arc sagging toward us in the middle, because
# that is what a circle on a cone does seen from above.
for gy in (26, 31, 35):
    hw = cone_half(gy)
    x0, x1 = int(round(CX - hw)), int(round(CX + hw))
    for x in range(x0 + 1, x1):
        u = max(-1.0, min(1.0, (x - CX) / hw))
        y = int(round(gy + 1.7 * math.sqrt(max(0.0, 1.0 - u * u))))
        w.px(x, y - 1, 'k' if u < 0.15 else 'K')
        w.px(x, y, 'B' if u > 0.15 else 'K')
        w.px(x, y + 1, 'G' if u < 0.15 else 'g')

# ── the stem he spins it by ─────────────────────────────────────────────────
for y in range(8, 15):
    turned(y, 3.2 if y < 10 else 2.2, WRAP6)

# ── the iron point it stands on ─────────────────────────────────────────────
for y in range(38, 42):
    turned(y, max(0.5, 2.0 - 0.55 * (y - 38)), IRON6)

register(
    'vortex', label='VORTEX', hero='wizard', kind='direct', cat='ultimate',
    why='a turned whorl, every groove closing on its one point',
    ramps=('leather', 'gold'),
    grid=w,
)
