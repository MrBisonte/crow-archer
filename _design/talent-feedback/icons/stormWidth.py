# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── WIDER SKY ───────────────────────────────────────────────────────────────
# A storm cloud, and the rain coming out of it wider than the cloud is.
# THUNDERSTEP is already a bolt, and a second bolt in the wizard's own line
# would be two icons nobody can tell apart -- so the storm is drawn as weather
# rather than as a strike, which is also what the talent buys: not a harder
# hit, a wider one.
#
# The shape of the cloud was settled by three drafts that were not clouds.
# Grown tall on a level base it is a slab with a bumpy lid, and reads as
# cobbles. Grown tall on a curved base it is an egg, and reads as a brain.
# Grown tall on a level middle with lifting flanks it is a bun. What says
# cloud is a SHORT body, a bumpy top edge with real notches in it, and a flat
# dark base as wide as the socket -- so the cloud is that, and the bottom third
# of the icon is the rain instead of more cloud.
c = G()

# The socket is a rounded square 24 wide, so the far lobe stops at x=27: at 3.0
# it reached 28 and four cells were quietly clipped away by `compose`, which
# reads as a cropped cloud and reports nothing.
BASE = 16                          # the flat underside a storm cloud hangs
LOBES = ((8.6, 12.2, 3.9), (12.6, 9.8, 4.7), (18.0, 8.8, 5.3),
         (22.4, 11.0, 4.4), (24.8, 13.4, 2.8), (15.6, 12.6, 5.5))


def canopy_top(x):
    """The topmost row any lobe reaches in this column, or None for empty."""
    top = None
    for lx, ly, lr in LOBES:
        dx = x - lx
        if abs(dx) > lr:
            continue
        y = ly - math.sqrt(lr * lr - dx * dx)
        top = y if top is None else min(top, y)
    return top


def owner(x, y):
    """Which lobe a cell belongs to, so each bump is modelled as its own ball.

    Shading the whole canopy off one light pool made it a boulder. The lobes
    are what say cloud, and a lobe only reads when it carries its own highlight
    and its own turn into shadow.
    """
    return min(LOBES, key=lambda L: math.hypot(x - L[0], y - L[1]) / L[2])


COLUMN = {}
for x in range(2, 30):
    top = canopy_top(x)
    if top is not None and math.ceil(top) <= BASE:
        COLUMN[x] = int(math.ceil(top))
CTOP = min(COLUMN.values())

for x, y0 in sorted(COLUMN.items()):
    for y in range(y0, BASE + 1):
        lx, ly, lr = owner(x, y)
        # Local: how far round its own lobe the cell has turned. Depth: how far
        # down the cloud it sits, because a storm base is dark end to end, and
        # a dark base is most of what separates a storm from fair weather.
        local = math.hypot(x - (lx - 0.44 * lr), y - (ly - 0.50 * lr)) / lr
        depth = (y - CTOP) / float(BASE - CTOP)
        c.px(x, y, pick(0.72 * local + 0.55 * depth,
                        [0.34, 0.60, 0.88, 1.16, 1.46], 'MPpsSX'))

ROW = {}
for x, y0 in COLUMN.items():
    for y in range(y0, BASE + 1):
        ROW.setdefault(y, []).append(x)
for y, xs in sorted(ROW.items()):
    c.px(max(xs), y, 's')          # one pixel of bounce down the far rim
    c.px(min(xs) + 1, y, 'P')      # and the near rim, into the key light
for x in ROW[BASE]:                # the base itself, the darkest thing here
    c.px(x, BASE, 'X')
c.px(max(ROW[BASE]), BASE, 'S')

# The rain. Four shafts, TWO pixels wide, and that width is the whole lesson:
# a one-pixel stroke standing in the socket picks up a warm seam down one side
# and a cast shadow down the other, so seven of them filled every column under
# the cloud with brown and white bars and the first draft read as a barcode.
# Two pixels makes each shaft an object -- a lit column and a shaded one -- and
# the seam becomes its outline instead of half of it. Four of them, five apart,
# leaves clear socket between. The run of a shaft is given in ROWS and its
# width in PIXELS, so neither one thickens with the other.
#
# They splay: the outer two lean away from the axis and the inner two barely
# lean at all, so the curtain is wider where it lands than where it left the
# cloud. That is the +50 px per level, drawn as a shape rather than as an arrow
# laid across the icon.
SHAFT_W = 2
SHAFTS = ((9.6, 8, -0.45), (14.4, 10, -0.16),
          (19.2, 10, 0.16), (23.2, 8, 0.40))
for (x0, run, lean) in SHAFTS:
    for k in range(run):
        f = k / float(run - 1)
        head = int(round(x0 + lean * k))
        # The last fifth tapers to one pixel: a shaft cut off square is a bar,
        # and this is water, which arrives at a point.
        for i in range(SHAFT_W if f < 0.80 else 1):
            c.px(head + i, BASE + 1 + k, pick(i + 2.0 * f, [0.9, 1.9, 2.9], 'PpsS'))

register(
    'stormWidth', label='WIDER SKY', hero='WIZARD', kind='direct', cat='damage',
    why='a storm cloud, four shafts of rain',
    ramps=('steel',),
    grid=c,
)
