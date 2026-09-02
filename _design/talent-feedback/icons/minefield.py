# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── MINEFIELD ───────────────────────────────────────────────────────────────
# Three bombs bedded in a bank of earth, waiting. The capstone turns a barrage
# bomb that hits nothing into ground nobody can cross, so this is not a bomb in
# flight -- it is one that has come to rest and been half swallowed, with an
# ember at the fuse to say it is still armed rather than spent.
#
# The earth is what makes them mines. Three spheres on their own are shot; the
# same three with a crest of dug earth run ACROSS them are set into a field.
# The earth is painted LAST, over the bodies: cutting each sphere at a straight
# line instead gave three domes sitting on a shelf, and the crest carries a
# bulge either side of every body so the earth reads as ploughed up rather than
# as a floor the mines were placed on.
m = G()

LX, LY, LZ = -0.50, -0.56, 0.66     # key light: up, left, and toward the viewer
SPOUT_W, SPOUT_H = 3, 2             # PIXELS on every mine, whatever its radius
STEPS = [-0.98, -0.92, -0.82, -0.56, -0.20]
BOUNCE = 0.62

# Centre x, radius, and how far the centre rides ABOVE the crest as a share of
# the radius -- 0.15 leaves a little over half the body showing. The first
# draft gave the figure as pixels of body above the crest and buried all
# three: how much of a sphere you see is a fraction of its radius, never a
# fixed height.
# Bigger and lower is nearer, and the bank rises to the right, so the small
# ones read as further off rather than as smaller bombs. Far to near.
MINES = ((25.0, 2.3, 0.15), (18.6, 3.6, 0.15), (9.6, 5.2, 0.15))


def ground(x):
    """The crest of the bank. A slope with a wobble on it -- a level line reads
    as a shelf and a smooth one as a wall -- and a bulge either side of every
    body, which is the earth each one threw up going in."""
    y = 20.5 - 0.35 * (x - 4) + 0.85 * math.sin(x * 0.8 + 1.0)
    for (cx, r, _) in MINES:
        for edge in (cx - r, cx + r):
            y -= 1.1 * math.exp(-((x - edge) / 1.7) ** 2)
    return y


def orb(g, cx, cy, r, ramp):
    """A sphere in six steps, with reflected light on the rim turned away."""
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            dx, dy = (x - cx) / r, (y - cy) / r
            d2 = dx * dx + dy * dy
            if d2 > 1.0:
                continue
            lam = dx * LX + dy * LY + math.sqrt(1.0 - d2) * LZ
            lam += BOUNCE * max(0.0, -(dx * LX + dy * LY)) * d2 ** 7
            g.px(x, y, pick(-lam, STEPS, ramp))


def crown(cx, r, ride):
    """A mine's centre and where its spout sits, in grid coordinates."""
    cy = ground(cx) - ride * r
    return cy, int(round(cx)) - 1, int(round(cy - r)) - 1


for (cx, r, ride) in MINES:                     # far to near
    cy, ax, ay = crown(cx, r, ride)
    orb(m, cx, cy, r, 'MPpsSX')
    for i in range(SPOUT_W):
        for k in range(SPOUT_H):
            m.px(ax + i, ay + k, 'PpsX'[min(3, i + k)])

for x in range(3, 30):                          # the bank, over the bodies
    crest = ground(x)
    for y in range(int(round(crest)), 30):
        m.px(x, y, pick(y - crest, [0.9, 2.2, 4.6, 8.2], 'WwvuU'))

for x in range(3, 30):                          # clods, so the crest is dug
    crest = int(round(ground(x)))
    if x % 5 in (0, 1):
        m.px(x, crest - 1, 'w')
    if x % 7 == 3:
        m.px(x, crest + 3, 'U')
        m.px(x + 1, crest + 3, 'U')

# The near mine's fuse, and the ember that says it is armed and not spent. No
# flare: a barrage bomb that goes off is longThrow's spark, and this one is
# waiting.
_, ax, ay = crown(*MINES[2])
for i, (x, y) in enumerate(((ax + 3, ay - 1), (ax + 4, ay - 2))):
    m.px(x, y, 'N' if i % 2 == 0 else 'n')
    m.px(x, y + 1, 'o')
m.px(ax + 5, ay - 4, 'f')
m.px(ax + 6, ay - 4, 'f')
m.px(ax + 5, ay - 3, 'F')
m.px(ax + 6, ay - 3, 'Y')
m.px(ax + 6, ay - 2, 'f')

register(
    'minefield', label='MINEFIELD', hero='SAPPER', kind='mechanic', cat='damage',
    why='three mines, bedded in earth',
    ramps=('steel', 'wood', 'rope', 'fire'),
    grid=m,
)
