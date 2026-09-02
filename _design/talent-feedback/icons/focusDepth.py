# -*- coding: utf-8 -*-
from iconkit import G, cyl_row, register

# ── FOCUS DEPTH ─────────────────────────────────────────────────────────────
# A crucible, filled past its rim. The talent buys one more Focus, and Focus is
# a pool, so the object is the thing the pool is held in.
#
# Three failures. A stemmed chalice reads as tableware and says nothing about
# depth. Stemless and wide, it read as a bucket. Then it read as a gold tankard
# -- and that one was a modelling error, not a proportion error: the fill was
# painted down the whole interior, so the OBJECT came out gold and the steel
# survived only as a dark line at the edge. A vessel seen from slightly above
# shows its outer wall all the way round and its contents only in the mouth.
# The gold is a pool in the opening now, and the body is steel.
c = G()

STEEL = 'XMPpSs'
GOLD = 'KGgkKg'
MID = 15.5
TOP, BOT = 10, 26


def half(y):
    return 8.0 - 2.0 * (y - TOP) / float(BOT - TOP)


for y in range(TOP, BOT + 1):
    w = int(round(half(y) * 2))
    c.put(y, int(round(MID - w / 2.0)), cyl_row(w, STEEL))

# The mouth: the far rim behind, the pool in it, the near rim in front.
for y, w in ((TOP, 16), (TOP + 1, 15), (TOP + 2, 13), (TOP + 3, 9)):
    c.put(y, int(round(MID - w / 2.0)), cyl_row(w, GOLD))
c.put(TOP + 3, 13, 'kKKKk')
c.put(TOP - 1, 9, cyl_row(14, STEEL))          # near rim, over the pool
c.put(TOP - 2, 10, 'XSSSSSSSSSSs')

# The fill standing proud of it, which is the talent: more than there was.
for y, w in ((TOP - 3, 10), (TOP - 4, 7), (TOP - 5, 4)):
    c.put(y, int(round(MID - w / 2.0)), cyl_row(w, GOLD))
c.put(TOP - 5, 14, 'GGG')
for y in (TOP - 1, TOP):
    c.px(20, y, 'g')                           # a run, over the near rim
c.px(20, TOP + 1, 'k')

# A foot, so it stands rather than floats.
c.put(BOT + 1, 11, cyl_row(10, STEEL))
c.put(BOT + 2, 10, cyl_row(12, STEEL))

register(
    'focusDepth', label='FOCUS DEPTH', hero='WIZARD', kind='indirect', cat='damage',
    why='a crucible, filled over the rim',
    ramps=('steel', 'gold'),
    grid=c,
)
