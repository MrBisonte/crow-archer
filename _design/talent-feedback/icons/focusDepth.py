# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── FOCUS DEPTH ─────────────────────────────────────────────────────────────
# A chalice filled to the lip. Focus is the one pool on the roster that fills
# itself and gets spent a point at a time, so the talent that DEEPENS it wants
# a vessel with a visible amount in it -- not a counter, and not four of
# anything, which would be the bar chart THIRD STEP was rejected for.
#
# The socket is the red `damage` ground, so the cup is STEEL: the only cool
# ramp in the set, and the same lesson the hourglass learned pointing the other
# way. What it holds is gold, which is already the wizard's precious substance
# here -- the hourglass's sand is the same ramp.
#
# The mouth is drawn as an ellipse seen from above rather than as a straight
# line, because a flat mouth shows how WIDE the cup is and nothing else. Tilted
# you see the pool lying in it, which is the whole read: how much he has.
c = G()

CX = 15.5                    # the axis everything is turned about
MOUTH_CY = 8.0
MOUTH_RX, MOUTH_RY = 8.0, 3.6
POOL_RX, POOL_RY = 6.2, 2.6
BOWL_BOT = 18


def span(half):
    """Columns a half-width covers, symmetric about the axis.

    int(round()) is not usable here: Python rounds .5 to even, so a half-width
    of exactly 8.0 lands on 8..24 -- a cup one pixel wider on the right than on
    the left, which at 48 px reads as a dent in the rim.
    """
    return int(math.floor(CX - half + 0.5)), int(math.ceil(CX + half - 0.5))


def ellipse_half(y, rx, ry):
    """Half-width of an ellipse about (CX, MOUTH_CY) at row y, or None."""
    k = 1.0 - ((y - MOUTH_CY) / ry) ** 2
    return rx * math.sqrt(k) if k > 0.0 else None


def bowl_half(y):
    """The cup's outside: the mouth's 8 px closing on the stem by row 18."""
    return MOUTH_RX * (1.0 - (y - MOUTH_CY) / 11.0) ** 0.55


def turned(g, y, x0, x1):
    """One row of a turned steel surface, all six steps across it.

    Highlight, specular, midtone, core shadow, dark edge, and the pixel of
    bounced light on the far side -- the step that stops the stem and the foot
    reading as three grey stripes stacked under a cup.

    The darkest step sits four fifths of the way across, not at the near edge.
    Put at the edge it lands on the side the key light is coming from, and a
    four-pixel stem spends a quarter of its width being black where it should
    be brightest.
    """
    width = max(1, x1 - x0)
    for x in range(x0, x1 + 1):
        f = (x - x0) / float(width)
        g.px(x, y, pick(f, [0.10, 0.30, 0.48, 0.66, 0.84], 'PMPpSX'))
    g.px(x1, y, 's')


# The bowl's outside, domed rather than banded: the light pools up and to the
# left and falls off as a distance, so the far side turns under the way a
# cylinder does not. Drawn first; the mouth is laid over its top rows, which is
# what puts the front lip in front of the bowl instead of beside it.
for y in range(8, BOWL_BOT + 1):
    bx0, bx1 = span(bowl_half(y))
    for x in range(bx0, bx1 + 1):
        d = math.hypot((x - 11.0) / 10.0, (y - 12.0) / 13.0)
        c.px(x, y, pick(d, [0.08, 0.22, 0.48, 0.76], 'MPpSX'))
    c.px(bx1 - 1, y, 'X')                   # core shadow, just inside the edge
    c.px(bx1, y, 's')                       # and the socket bouncing back in

# The rim, as a ring: two rows thick front and back, one pixel at the sides.
# A one-row mouth reads as a drawn line round a hole; two rows read as metal
# with a thickness you are looking at the top of.
#
# Lit round the ring rather than down the picture. Shading it by height put the
# whole front lip in core shadow, which read as a bar laid across the mouth --
# a rim is a torus, so what decides a cell is where it stands on the circle,
# and the near lip faces the key light as squarely as the far one.
KEY_ANGLE = math.atan2(-0.25, -1.0)             # round the ring, barely raised

for y in range(5, 12):
    half = ellipse_half(y, MOUTH_RX, MOUTH_RY)
    if half is None:
        continue
    x0, x1 = span(half)
    pool = ellipse_half(y, POOL_RX, POOL_RY)
    inner = span(pool) if pool is not None else None
    for x in range(x0, x1 + 1):
        if inner and inner[0] <= x <= inner[1]:
            continue
        a = math.atan2((y - MOUTH_CY) / MOUTH_RY, (x - CX) / MOUTH_RX)
        off = abs((a - KEY_ANGLE + math.pi) % (2.0 * math.pi) - math.pi)
        # Only the rows that reach the mouth's full width own the far
        # silhouette; on the lip rows x1 is the middle of the object.
        c.px(x, y, 's' if x == x1 and half > 6.5
             else pick(off, [0.70, 1.35, 2.05, 2.70], 'MPpSX'))

# The line the rim throws on the wall beneath it. Without it the front lip and
# the bowl under it run the same values, and a rim that is level with what it
# sits on is not a rim -- it is a gold disc lying on a cup.
STEEL = 'MPpsSX'                                # light to dark, in value order

lip0, lip1 = span(ellipse_half(11, MOUTH_RX, MOUTH_RY))
for x in range(lip0, lip1 + 1):
    was = c.g[12][x]
    c.px(x, 12, STEEL[min(len(STEEL) - 1, STEEL.index(was) + 1)])

# What is in it, up against the rim on every side.
#
# Two things, and the first is the one that was missing: a dark gold line all
# the way round where the liquid meets the metal. Without it the surface ran
# bright right up to the steel and read as a slab of gold laid on top of the
# cup rather than as something lying IN it. Inside that line the sheet is lit
# from the same corner as everything else, so it tips away to the right.
#
# The line is a cell with a NEIGHBOUR outside the pool, not a cell past some
# fraction of the way out. A fraction leaves the middle of the topmost row
# bright, because that row is far from the ellipse's ends and still hard
# against the far wall -- the contact line came out notched.


def in_pool(x, y):
    return ((x - CX) / POOL_RX) ** 2 + ((y - MOUTH_CY) / POOL_RY) ** 2 <= 1.0


for y in range(6, 11):
    pool = ellipse_half(y, POOL_RX, POOL_RY)
    if pool is None:
        continue
    px0, px1 = span(pool)
    for x in range(px0, px1 + 1):
        touches = all(in_pool(x + dx, y + dy)
                      for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)))
        d = math.hypot((x - 12.5) / 8.0, (y - 7.6) / 4.0)
        c.px(x, y, pick(d, [0.18, 0.55, 0.88], 'GgkK') if touches else 'K')

for y in range(19, 23):                     # the stem
    turned(c, y, 14, 17)
turned(c, 20, 12, 19)                       # the knop, where a hand takes it
turned(c, 21, 13, 18)                       # narrower below, so it reads round
turned(c, 23, 12, 19)                       # the foot, spreading
turned(c, 24, 10, 21)
turned(c, 25, 9, 22)
c.put(26, 10, 'X' + 'S' * 10 + 'X')         # its underside, out of the light

register(
    'focusDepth', label='FOCUS DEPTH', hero='WIZARD', kind='indirect', cat='damage',
    why='a chalice, brimming',
    ramps=('steel', 'gold'),
    grid=c,
)
