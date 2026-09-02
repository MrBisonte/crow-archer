# -*- coding: utf-8 -*-
from iconkit import G, cyl_row, register

# ── BULWARK ─────────────────────────────────────────────────────────────────
# A banded door in its jamb. A blocked hit brings the guard straight back, so
# the object is the thing that is still shut afterwards.
#
# Three failures. A round shield with a blood drop collided twice: TOWER GUARD
# is already the knight's shield, and a drop in a frame read as DEAD EYE. Then
# the door was arched, with iron bands running edge to edge, and it read as a
# BARREL -- arched top plus hoops across staves is a barrel, and the sapper
# already owns one. The top is square now, the bands stop short with visible
# strap ends, and a stone jamb runs round three sides: a barrel is not set into
# anything, so the jamb is what settles it.
#
# `defence` tints the socket cool, so the boards are oak -- warm on cool -- and
# the steel is only the bands.
b = G()

OAK = 'BECHLh'
DARK = 'BBCHLL'
STEEL = 'XMPpSs'
JAMB = 'XSspPM'
LEFT, RIGHT = 8, 25
TOPY, BOTY = 5, 28
PLANK = 6


def plank_row(y, chars):
    for x in range(LEFT, RIGHT + 1, PLANK):
        b.put(y, x, cyl_row(min(PLANK, RIGHT - x + 1), chars))


# The jamb first, so the door sits inside it.
for y in range(TOPY - 2, BOTY + 1):
    b.put(y, LEFT - 3, cyl_row(3, JAMB))
    b.put(y, RIGHT + 1, cyl_row(3, JAMB))
for y in range(TOPY - 2, TOPY):
    b.put(y, LEFT - 3, cyl_row(RIGHT - LEFT + 7, JAMB))

for y in range(TOPY, BOTY + 1):
    plank_row(y, OAK if y < 20 else DARK)
for x in range(LEFT + PLANK - 1, RIGHT, PLANK):
    for y in range(TOPY, BOTY + 1):
        b.px(x, y, 'B')                        # the seam between boards

# Two straps, stopped short of the edges, each nailed at every board it crosses
# and finished with a spade end.
for y0 in (9, 21):
    for y in range(y0, y0 + 3):
        b.put(y, LEFT + 1, cyl_row(RIGHT - LEFT - 1, STEEL))
    b.put(y0 - 1, LEFT + 3, 'pPpp')
    b.put(y0 + 3, LEFT + 3, 'SSSS')
    for x in range(LEFT + 3, RIGHT, PLANK):
        b.px(x, y0 + 1, 'X')

# The ring, hung on the leaf's free edge where a hand would reach it.
RING = ((19, 15), (20, 14), (21, 14), (22, 15), (22, 16), (21, 17), (20, 17),
        (19, 16))
for x, y in RING:
    b.px(x, y, 'g')
    b.px(x, y + 1, 'K')
b.px(20, 14, 'G')
b.px(21, 14, 'G')
b.px(20, 13, 'k')
b.px(21, 13, 'k')

register(
    'bulwark', label='BULWARK', hero='KNIGHT', kind='mechanic', cat='defence',
    why='a banded door in its jamb',
    ramps=('leather', 'steel', 'gold'),
    grid=b,
)
