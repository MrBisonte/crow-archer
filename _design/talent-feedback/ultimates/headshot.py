# -*- coding: utf-8 -*-
from iconkit import G, ULT_N, cyl_row, register

# ── HEADSHOT ────────────────────────────────────────────────────────────────
# ONE arrow, gilded, laid flat across the whole plate and running off both rims
# of the socket. The talent is a single line drawn from where he stands to the
# far side of the map, so the object is a single line and nothing else shares
# the frame with it.
#
# Its sibling ARROW RAIN is a fan of small arrows standing in a ring. The fork
# reads before either label does: one long horizontal thing against a scatter
# of short leaning ones.
h = G(ULT_N)

MID = 23.5
RIDGE = 23                # the blade's spine, one row above the centreline

# Six steps in cyl_row's order: dark edge, specular, highlight, midtone, core
# shadow, and the one pixel of reflected light on the far edge.
SHAFT = 'LECHBh'          # leather -- a lit wooden shaft is this exact ramp
VANE_UP = 'qRRrQq'        # the vane the light rakes across
VANE_DN = 'QrqqQq'        # the one turned away from it


def col(g, x, y0, chars):
    """A column of ramp characters. The arrow lies down; its shading stands up."""
    for i, ch in enumerate(chars):
        g.px(x, y0 + i, ch)


# ── the shaft ───────────────────────────────────────────────────────────────
for x in range(7, 30):
    col(h, x, 21, SHAFT)

# ── the head ────────────────────────────────────────────────────────────────
# A broadhead in gold, modelled as TWO FACETS and a spine, not as a gradient.
# The first draft ran one ramp top to bottom and came out a flat cream triangle
# -- a blade reads by the bright line where its facets meet.
UP = 'BKkgG'              # top edge down to the spine
DN = 'GgkKK'              # spine down to the bottom edge


def facet(y, top, bot):
    if y < RIDGE:
        f = (y - top) / float(max(1, RIDGE - top))
        return UP[min(len(UP) - 1, int(f * len(UP)))]
    if y == RIDGE:
        return 'Y'
    f = (y - RIDGE) / float(max(1, bot - RIDGE))
    return DN[min(len(DN) - 1, int(f * len(DN)))]


for x in range(30, 42):
    # Concave behind the widest point: a broadhead's rear edges sweep back.
    t = (41 - x) / 11.0
    half = 7.0 * (t ** 0.72)
    top = int(round(MID - half))
    bot = int(round(MID + half))
    for y in range(top, bot + 1):
        h.px(x, y, facet(y, top, bot))
    if bot - top >= 3:
        # Reflected light on the far edge -- but NOT on the last few columns,
        # where the blade is one or two pixels tall and this darkened the point
        # itself. The tip is the whole read; it does not get to be the shadow.
        h.px(x, bot, 'k')

# ── the ferrule and the binding ─────────────────────────────────────────────
# Two gold bands, one at each end of the shaft, a row proud of it top and
# bottom so they read as wrapped round rather than painted on.
for x in (28, 29, 18, 19):
    col(h, x, 20, cyl_row(8, 'BYGgKk'))

# ── the fletching ───────────────────────────────────────────────────────────
# Squared at the tail and tapered to the shaft at the front, which is the shape
# of a feather. The first draft flared 4.6 px all the way to the rim and read
# as a pennant on a rocket.
for x in range(7, 18):
    run = 4.2 if x <= 11 else 4.2 * (17 - x) / 6.0
    top = int(round(21 - run))
    bot = int(round(26 + run))
    col(h, x, top, cyl_row(21 - top, VANE_UP))
    col(h, x, 27, cyl_row(bot - 26, VANE_DN))
    # Grain: one step of tone every third column, on the SHADOW vane only. Run
    # across the lit one too and the stripes read as the object, not its surface.
    if x % 3 == 1:
        for y in range(27, bot + 1):
            h.px(x, y, 'Q')
    # Notches cut OUT of the outer edge, on the row that edge is actually on.
    # Pixels standing off the rod read as a mace, which is what LIGHT FOOT's
    # first two drafts were.
    if x % 2 == 0 and x <= 12:
        h.px(x, top, '.')
        h.px(x, bot, '.')

# The nock: a groove cut in the tail, where the string sat.
h.px(7, 23, '.')
h.px(7, 24, '.')
h.px(8, 23, 'B')
h.px(8, 24, 'B')

register(
    'headshot', label='HEADSHOT', hero='archer', kind='direct', cat='ultimate',
    why='one gilded arrow, rim to rim',
    ramps=('leather', 'gold', 'fire', 'cloth'),
    grid=h,
)
