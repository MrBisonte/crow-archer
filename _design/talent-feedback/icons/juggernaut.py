# -*- coding: utf-8 -*-
from iconkit import G, limb, pick, register
import math

# ── JUGGERNAUT ──────────────────────────────────────────────────────────────
# An iron-tyred wheel. The dash cannot be stopped, and a wheel under load is
# the plainest object for that.
#
# It was a pauldron and it read as an egg: armour articulation at 32 px is a
# stack of soft curves with nothing hard in it, and a soft closed curve is an
# egg. A wheel has a hole in the middle, which no amount of bad shading can
# turn into a lump.
#
# `movement` tints the socket golden, so the tyre is steel -- the cool ring is
# what separates the object from its ground, and the felloe inside it is warm
# so the two rings read apart from each other as well.
p = G()

MID = 15.5
TYRE_OUT, TYRE_IN, FELLOE_IN, HUB = 14.6, 12.1, 9.4, 3.4


def key(x, y):
    """0 at the upper left where the light is, 1 at the far corner."""
    return ((x - MID) + (y - MID)) / (2.0 * TYRE_OUT) * 0.5 + 0.5


# Six spokes, drawn first so the rings close over their ends.
for i in range(6):
    a = math.radians(90 * 0 + i * 60 + 15)
    limb(p, MID + HUB * math.cos(a), MID + HUB * math.sin(a),
         MID + FELLOE_IN * math.cos(a), MID + FELLOE_IN * math.sin(a),
         3.4, 2.6, 'WwvU')

for y in range(N := 32):
    for x in range(32):
        d = math.hypot(x - MID, y - MID)
        v = key(x, y)
        if TYRE_IN <= d <= TYRE_OUT:
            if d > TYRE_OUT - 1.0 and v > 0.62:
                ch = 's'                      # reflected light on the far rim
            else:
                ch = pick(v, [0.30, 0.46, 0.62, 0.80], 'MPpSX')
            p.px(x, y, ch)
        elif FELLOE_IN <= d < TYRE_IN:
            p.px(x, y, pick(v, [0.32, 0.50, 0.70], 'WwvU'))
        elif d <= HUB:
            p.px(x, y, pick(v, [0.30, 0.52, 0.74], 'GgkK'))

register(
    'juggernaut', label='JUGGERNAUT', hero='KNIGHT', kind='mechanic',
    cat='movement',
    why='an iron-tyred wheel',
    ramps=('steel', 'wood', 'gold'),
    grid=p,
)
