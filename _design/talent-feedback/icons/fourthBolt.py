# -*- coding: utf-8 -*-
from iconkit import G, register

# ── FOURTH BOLT ─────────────────────────────────────────────────────────────
# Four quarrels stood in the loops of a bolt belt. The talent adds one bolt to a
# volley of three, so the object has to be able to SHOW four: a single bolt
# cannot, and four bolts loose in the air is a diagram of a volley, not a thing.
#
# Three drafts died on the thing holding them. A quiver -- squat, then tapered,
# then a straight tube -- is a wide BRIGHT vessel with thin pale things standing
# out of it, and that is a pot of flowers however the vessel is drawn. What
# fixed it was not the vessel's shape but its weight: the bolts have to be the
# biggest and lightest thing in the socket and whatever holds them has to be a
# dark bar under them. A belt cropped by the bezel is that bar, and a belt of
# bolts is a thing a ranger owns.
q = G()

# A quarrel is not a short arrow. Its head is a stout four-sided pyramid with
# straight sides -- a bulging one reads as a leaf, which is what draft two's did
# -- and it sockets into a COLLAR a step narrower and much darker than itself.
# That hard step is what says crossbow rather than arrow, and it is worth a
# whole row: without it the head and the shaft are one tapering spike.
#
# It is also what keeps four pale shafts in a row from reading as candles: the
# head has to be twice the width of its own shaft, so the step down to the wood
# is the loudest thing on the bolt.
HEAD = ('   M   ',
        '  PMp  ',
        ' SPMps ',
        'SPMMpsp',
        'SPMMpsp',
        '  XPX  ')               # the collar the head sockets into
SHAFT = 'Wwv'
BOLTS = ((8, 7), (13, 4), (18, 6), (23, 9))    # centre column, row of the tip
BUTT = 26

for cx, top in BOLTS:
    for i, row in enumerate(HEAD):
        q.put(top + i, cx - 3, row)
    for y in range(top + len(HEAD), BUTT + 1):
        q.put(y, cx - 1, SHAFT)

# The belt over them, six steps DOWN it: dark edge, specular, highlight,
# midtone, core shadow, dark edge, and a row of reflected light under that. It
# is SLANTED, and drawn over the shafts rather than round them: four bolts
# standing in four loops on a level bar is a picket fence, and the fence was
# what draft four read as.
BELT = 'LECHhLh'
for x in range(4, 28):
    top = 19 + int(round(6.0 * (x - 4) / 23.0))
    for i, ch in enumerate(BELT):
        q.px(x, top + i, ch)
    if x % 5 == 2:                         # its stitching, so it is not a plank
        q.px(x, top + 4, 'L')

register(
    'fourthBolt', label='FOURTH BOLT', hero='RANGER', kind='direct', cat='damage',
    why='a belt, four bolts',
    ramps=('leather', 'steel', 'wood'),
    grid=q,
)
