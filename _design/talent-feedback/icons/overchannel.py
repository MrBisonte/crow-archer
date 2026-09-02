# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── OVERCHANNEL ─────────────────────────────────────────────────────────────
# A candle carrying a flame far too big for it, with one run of wax gone over
# the side. The rite makes bolts free for four seconds, which is not "more
# power" but power spent at a rate nothing is paying for -- and a wick
# throwing a flame its own height again is the object everybody already reads
# that way.
#
# It is deliberately NOT another vessel. FOCUS DEPTH, the other icon in this
# pass, is a chalice, and two cups on one talent line would be the same
# silhouette twice at 48 px.
#
# The socket is the green `speed` ground, so the object is WARM. Leather is
# the only warm ramp with six steps in it, and tan over brown is what tallow
# looks like anyway; the dish is gold and the flame is fire, so all three
# materials stand off a cool field.
#
# Second drawing. The first was eight to ten pixels wide over nine rows with
# the wax bulging at four different heights, and it read as a BELL: too broad
# for its height, and lumpy where it should have been turned. Width is the
# whole proportion here -- seven pixels under a nine-pixel flame is a candle
# overrun, and ten under the same flame is a pot boiling over.
w = G()

CX = 15.0
BODY_X0, BODY_TOP, BODY_BOT = 12, 15, 24

# The seven columns of the candle: near edge, specular, highlight, midtone,
# core shadow, the dark edge, and the pixel of light the socket bounces back
# into the far side. All six steps, one column each but for the highlight.
WALL = 'CECHhBL'
# The same wall a step further down the ramp, for the row the melted crown
# overhangs and the row standing in the dish. A cylinder with no event down
# it reads as a plank however many steps run across it.
WALL_SHADED = 'HCHhLBB'
# And the wax that ran over and set: two columns wider, from row 20 down.
#
# This is the third thing tried in that job. A three-pixel lobe hung off the
# left at mid-height read as a lump stuck to the candle -- the crevice line
# that separated it from the wall separated it too well, and what showed was a
# handle. A run of wax is not an object beside the candle; it is the candle
# being fatter lower down, and the silhouette says so in one step.
WALL_BASE = 'CEECHHhBL'
WALL_BASE_SHADED = 'HCCHhhLBL'                  # its last row, down in the dish
BASE_TOP = 20

# The flame, as half-widths per row. A table rather than a curve: every shape
# in this set that failed, failed on proportion, and the two numbers that
# decide whether this reads as a flame or as a leaf are how fast it opens off
# the wick and how far down the belly sits.
FLAME = {4: 0.7, 5: 1.5, 6: 2.3, 7: 2.9, 8: 3.4,
         9: 3.8, 10: 3.9, 11: 3.6, 12: 2.6, 13: 1.4}
FLAME_TOP, FLAME_BASE = 4, 13
GOLD = 'GgkK'                                   # light to dark, in value order


def span(cx, half):
    """Columns a half-width covers about cx, symmetric, no .5-to-even."""
    return int(math.floor(cx - half + 0.5)), int(math.ceil(cx + half - 0.5))


for y in range(BODY_TOP, BASE_TOP):
    w.put(y, BODY_X0, WALL_SHADED if y == BODY_TOP else WALL)
for y in range(BASE_TOP, BODY_BOT + 1):
    w.put(y, BODY_X0 - 1, WALL_BASE)
w.put(BODY_BOT, BODY_X0 - 1, WALL_BASE_SHADED)          # the row in the dish

# The melted crown: two rows brighter than the wall under them, the lower one
# overhanging it. A candle whose top is square with its sides is a dowel.
w.put(13, 12, 'EEECCHh')
w.put(14, 11, 'CEEECCHhL')

# The flame. Hot at the wick and cooling as it climbs, so the tip is the red
# end of the ramp and the core by the wick is white. It is its own light
# source and the only shape here whose shading does not run from the upper
# left -- lit that way it would be a balloon.
for y in range(FLAME_TOP, FLAME_BASE + 1):
    half = FLAME[y]
    cx = CX - 1.2 * ((FLAME_BASE - y) / 9.0) ** 2   # the tip drifting off true
    x0, x1 = span(cx, half)
    t = (y - FLAME_TOP) / float(FLAME_BASE - FLAME_TOP)
    for x in range(x0, x1 + 1):
        r = abs(x - cx) / half
        v = (1.0 - 0.80 * r * r) * (0.20 + 0.80 * t)
        w.px(x, y, pick(v, [0.28, 0.50, 0.70], 'efFY'))

# The dish it stands in. Gold under tallow is the pairing the hourglass
# already uses for its sand, and it gives the candle something to stand ON --
# a cylinder ending in mid-socket floats.
for y, x0, x1 in ((25, 9, 22), (26, 10, 21), (27, 12, 19)):
    for x in range(x0, x1 + 1):
        d = math.hypot((x - 11.5) / 13.0, (y - 25.0) / 5.0)
        w.px(x, y, pick(d, [0.14, 0.42, 0.72], 'GgkK'))
    w.px(x1, y, 'k')                            # the bounce along the far rim
for x in range(13, 22):                         # what the candle throws on it
    was = w.g[25][x]
    w.px(x, 25, GOLD[min(len(GOLD) - 1, GOLD.index(was) + 1)])

register(
    'overchannel', label='OVERCHANNEL', hero='WIZARD', kind='indirect', cat='speed',
    why='a candle, running over',
    ramps=('leather', 'fire', 'gold'),
    grid=w,
)
