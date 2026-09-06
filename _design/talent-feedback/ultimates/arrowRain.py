# -*- coding: utf-8 -*-
import math

from iconkit import G, ULT_N, cyl_row, register

# ── ARROW RAIN ──────────────────────────────────────────────────────────────
# A gold ring marked on the ground and TWO arrows coming down into it, one near
# and one far.
#
# Six drafts. Standing them IN the ring failed three ways: four parallel ones
# read as logs in a bath, four converging ones crossed into a bundle of sticks,
# and three with their points buried read as paintbrushes -- an arrow is
# recognised by its POINT, and a shaft with a feather on it and no head is a
# brush. The fourth was proportion: a 25-row shaft with a 2-px vane is a pole,
# whatever colour the vane is.
#
# The last two were the 48 px read, which is the only size that decides
# anything. Three arrows with a shaft's gap between them merged into one brown
# mass, and a ring drawn as a true projected annulus has a one-pixel far arc
# that disappears into the violet, leaving a smudge under the shafts. TWO
# arrows with real air between them, a band the same number of pixels wide the
# whole way round, and heads wide enough to still be steel at 48.
#
# Its sibling HEADSHOT is one gilded arrow laid flat rim to rim. One committed
# line against a scatter, and a horizontal object against two leaning ones.
r = G(ULT_N)

CX, CY = 23.5, 31.0
RX, RY = 15.0, 8.0
BAND = 4                  # the ring's wall, IN PIXELS
LX, LY = 20.0, 18.0       # GEOM[48].light -- the key the socket itself is lit by

WOOD6 = 'UEWwuv'          # dark edge, specular, highlight, midtone, core, refl
STEEL6 = 'XMPpSs'
# Gold has four tones and a ring needs six, so leather's C fills the step
# between g and k and fire's Y is the specular.
RAMP = 'YGgCkK'
# Where the band starts on that ramp, by distance from the key. The stops are
# BUNCHED, spanning the ring's own 8..27 px range rather than the plate's: on
# an even spread the top of the ring sat on Y and the bottom on K, and a
# near-black arc on deep violet is the smudge that failed at 48.
STOPS = [10, 16, 21, 26]


def ring(g):
    """The marked circle, stamped inward along the curve's own normal.

    Filling between two concentric ellipses instead would set the wall as a
    FRACTION of each radius, and a flat annulus in perspective has a far arc of
    RY*(1-k) -- one pixel here. That is physically right and illegible, which
    is the whole lesson of MORE LINKS in a different costume: give the wall a
    number of pixels and the hole stays wider than the metal round it.
    """
    for i in range(720):
        t = 2.0 * math.pi * i / 720.0
        c, s = math.cos(t), math.sin(t)
        ox, oy = RY * c, RX * s                       # outward, unnormalised
        m = math.hypot(ox, oy) or 1.0
        d = math.hypot(CX + RX * c - LX, CY + RY * s - LY)
        base = sum(1 for stop in STOPS if d >= stop)
        for k in range(BAND):
            # HALF a step darker per pixel inward, not a whole one: four whole
            # steps walked the far side of the band off the end of the ramp and
            # the ring went dark on the right again.
            #
            # And the sixth step, where it belongs: ONE pixel of reflected
            # light on the far edge, following the curve round the arc that
            # faces away. That is what closes the loop at 48 -- without it the
            # dark arc sank into the violet and the ring read as a C. It is the
            # same pixel that stops a cylinder reading as a stripe, and the
            # honest fix: the arc stays the dark side, it just stops being
            # invisible. Lifting the whole arc instead would have lied about
            # where the light is.
            outer_edge = base >= 3 and k == 0
            j = 1 if outer_edge else base + (k + 1) // 2
            g.px(int(round(CX + RX * c - ox / m * k)),
                 int(round(CY + RY * s - oy / m * k)),
                 RAMP[min(len(RAMP) - 1, j)])


def arrow(g, tx, ty, hx, hy, w):
    """A whole arrow, laid out by ROWS rather than by fractions of its length:
    six of vane, six of point, shaft between. A vane that scales with the shaft
    is a vane you cannot see on the small one."""
    at = lambda y: tx + (hx - tx) * (y - ty) / float(hy - ty)
    left = lambda y: int(round(at(y) - (w - 1) / 2.0))
    for y in range(ty, hy - 5):
        # A six-px shaft holds all six steps as itself; a five-px one holds the
        # four a five-px cylinder can. Widening the small one to match turned
        # it into a post, so it keeps its four.
        g.put(y, left(y), WOOD6 if w == 6 else cyl_row(w, WOOD6))
    for i in range(6):
        # Half again as wide as the shaft. At 48 the point is the only cool
        # material on the plate and the only thing that says arrow rather than
        # stick, so it gets the pixels.
        y = hy - 5 + i
        half = (w + 2) / 2.0 * (1.0 - i / 5.0)
        a, b = int(round(at(y) - half)), int(round(at(y) + half))
        g.put(y, a, cyl_row(b - a + 1, STEEL6))
    for i in range(6):
        y = ty + i
        span = 3 if i < 4 else 2
        for k in range(span):
            g.px(left(y) - 1 - k, y, ('R', 'r', 'q')[k])
            g.px(left(y) + w + k, y, ('q', 'q', 'Q')[k])
        if i % 2:                                     # notched outer edge
            g.px(left(y) - span, y, '.')
            g.px(left(y) + w + span - 1, y, '.')


# Two, with five clear pixels of violet between the near one's vane and the far
# one's. Three could not be given that and stayed a mass.
ARROWS = [
    (14, 8, 20, 34, 6),
    (32, 7, 36, 22, 4),
]

ring(r)
for a in ARROWS:
    arrow(r, *a)

register(
    'arrowRain', label='ARROW RAIN', hero='archer', kind='direct', cat='ultimate',
    why='two arrows coming down into a gold ring',
    ramps=('gold', 'fire', 'leather', 'wood', 'steel', 'cloth'),
    grid=r,
)
