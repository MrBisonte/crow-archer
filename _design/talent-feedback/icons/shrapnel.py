# -*- coding: utf-8 -*-
from iconkit import G, limb, pick, register

# ── SHRAPNEL ────────────────────────────────────────────────────────────────
# The ranger's satchel with quarrels driven out through its own skin. The rite
# is the bag going up and throwing bolts outward, and the bolts have to be IN
# the leather -- one drawn clear of the bag floats, and a bag with single pixels
# standing off it is a thistle, which is what LIGHT FOOT's first two drafts
# were. Each is a stroke wide enough to be modelled, not a ray.
#
# It is a satchel and not a second bundle of dynamite. LONG THROW is three tall
# red cylinders lashed together with a lit fuse; this is one tan bag with a
# buckled flap, no fire anywhere, and it sits in the low left corner rather than
# square in the middle.
#
# Three drafts and three failures, all the same two faults.
#
# SYMMETRY. A bag with a spike out of each corner is a CAT: two matched spikes
# up are ears, two out sideways are whiskers, a bright buckle dead centre is a
# nose. So the bag is pushed off centre, the bolts go one way out of it, and no
# two of them answer each other.
#
# MATERIAL. Wood and leather are the same warm tan two steps apart, so wooden
# shafts on a leather bag were invisible; all-steel bolts merged head into shaft
# and read as paper darts. Every bolt now gets a dark steel rim under it first
# and the shaft back in wood, which only ever crosses the ground.
s = G()

STOPS = (0.06, 0.19, 0.44, 0.69, 0.82, 0.94)
FLAP_TONE = 'LECHhLh'            # the flap, in front and into the light
BAG_TONE = 'BCHhLBL'             # the bag under it, one step down


def hide(y, x0, x1, chars):
    """One row of stuffed leather: six steps across however wide the row is."""
    for x in range(x0, x1 + 1):
        s.px(x, y, pick((x - x0) / float(x1 - x0), STOPS, chars))


BAG = ((20, 6, 20), (21, 5, 21), (22, 5, 21), (23, 5, 21), (24, 5, 21),
       (25, 6, 20))
FLAP = ((15, 8, 18), (16, 6, 20), (17, 5, 21), (18, 5, 21), (19, 5, 21))
for y, x0, x1 in BAG:
    hide(y, x0, x1, BAG_TONE)
for y, x0, x1 in FLAP:
    hide(y, x0, x1, FLAP_TONE)
s.put(19, 5, 'L' * 17)           # the cut edge of the flap, straight across
s.put(20, 5, 'B' * 17)           # and the shadow it throws down the bag
s.put(26, 7, 'B' * 13)           # where the bag sits down on its own shadow
for y in range(16, 21):          # the strap, well off centre so it is not a nose
    s.put(y, 8, 'LECh')
s.put(21, 8, 'sPMs')             # and the buckle it ends in
s.put(22, 8, 'XSSX')


def quarrel(x0, y0, x1, y1):
    """A bolt driven out: a dark rim, a stub of wooden shaft, then the head.

    The rim goes down first and everything else sits inside it, so the bolt
    keeps an edge where it crosses the bag as well as where it crosses ground.
    """
    mx, my = x0 + (x1 - x0) * 0.66, y0 + (y1 - y0) * 0.66
    limb(s, x0, y0, x1, y1, 5.4, 1.9, 'XXXX')
    limb(s, x0, y0, mx, my, 3.2, 3.0, 'WWwv')
    limb(s, mx, my, x1, y1, 4.2, 0.9, 'MPps')


# Three, no two mirrored and no two the same length: out of the shoulder, out of
# the flap leaning right, and one out of the side. A head that runs half the
# bolt is a blade -- it is the last third, and the wood is the rest.
for spike in ((10, 17, 5, 10), (14, 17, 22, 5), (18, 20, 27, 14)):
    quarrel(*spike)

register(
    'shrapnel', label='SHRAPNEL', hero='RANGER', kind='direct', cat='damage',
    why='a satchel, bolts driven out',
    ramps=('leather', 'steel', 'wood'),
    grid=s,
)
