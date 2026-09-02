# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── JUGGERNAUT ──────────────────────────────────────────────────────────────
# A pauldron: the plate over the shoulder he goes in with. The rite makes the
# dash unstoppable and throws back what it hits, and the thing that does the
# throwing is a braced shoulder -- so the icon is that shoulder's armour, not
# an arrow, a chevron or a set of speed lines, which is what drawing MOTION
# collapses into every time.
#
# Steel on the golden `movement` ground: cool object on a warm socket, which
# is the hourglass's lesson, and gold only where plate is actually pinned.
#
# The first draft was an EGG. Four tones of soft gradient over a smooth oval
# is a thimble whatever the outline does, and the two things that fixed it are
# both about hardness. The laps between lames are forced to the darkest step
# for a full row, with the lit free edge of the plate above sitting straight
# on top of it -- articulated plate is read at the joints, and a joint you
# have to look for is not one. And the lower front corner is CUT AWAY, the way
# a real pauldron is cut for the armpit, which is what stops the silhouette
# closing back into an oval and sends the whole piece sweeping down and
# outboard along the arm.
p = G()

TOP, BOTTOM = 5, 25
# Half-width row by row from TOP. Written out rather than fitted: the shape is
# the whole read here, and a curve that happens to be smooth is worth less
# than one that is the right shape at four or five specific rows.
HALF = (4.0, 5.6, 6.7, 7.4, 7.9, 8.2, 8.4, 8.5, 8.5, 8.5, 8.4,
        8.3, 8.1, 7.9, 7.6, 7.3, 6.9, 6.5, 6.0, 5.4, 4.6)
LEAN = 0.34                         # px of drift per row, down and outboard
LAMES = (13.2, 16.4, 19.4, 22.2)    # where one plate laps over the next
DIP = 1.3                           # those laps sag in the middle: they wrap
ARMPIT = 18                         # below this the front edge is cut away

STEEL = 'MPpsSX'
STOPS = [0.12, 0.28, 0.45, 0.64, 0.84]


def tone(v, ramp=STEEL):
    """Brightness in 0..1 (1 = specular) onto a six-step ramp."""
    return pick(1.0 - min(1.0, max(0.0, v)), STOPS, ramp)


def geom(y):
    """Centre, half-width, and how much of the front edge is cut for the arm."""
    cut = 0.62 * max(0.0, (y - ARMPIT) / float(BOTTOM - ARMPIT)) ** 1.4
    return 13.4 + LEAN * (y - TOP), HALF[y - TOP], cut


def lap(i, u):
    """Row where lame `i` laps over the next, at across-position u."""
    return LAMES[i] + DIP * max(0.0, 1.0 - u * u)


for y in range(TOP, BOTTOM + 1):
    cx, half, cut = geom(y)
    for x in range(int(cx - half) - 1, int(cx + half) + 2):
        u = (x - cx) / half
        if u > 1.0 or u < -1.0 + cut:
            continue
        laps = [lap(i, u) for i in range(len(LAMES))]
        band = sum(1 for L in laps if y >= L)
        # A cylinder across, with the light up and to the left. The square
        # term is what stops the far half being an even wash.
        v = 0.50 - 0.44 * u - 0.14 * u * u
        v -= 0.24 * max(0.0, (10 - y) / 5.0) ** 2      # the crown rolls over
        edge = laps[band] if band < len(LAMES) else BOTTOM + 1.0
        v += 0.34 * max(0.0, 1.0 - (edge - y))         # each free edge is lit
        ch = tone(v)
        if band and y - laps[band - 1] < 1.0:
            ch = 'X'                # the lap, hard: a joint you hunt for is none
        elif u < -0.90 + cut:
            ch = 'P'                # the turned edge, rolled and catching it
        elif u < -0.76 + cut:
            ch = 'S'                # and the groove that turning it leaves
        elif u > 0.90:
            ch = 'p'                # reflected light, far edge
        p.px(x, y, ch)

# Rivets at the outboard end of every lame, where the leathers that let a lame
# slide are actually pinned. Gold, because that is where this set spends gold.
for L in LAMES:
    row = int(round(L + 2.0))
    cx, half, _ = geom(row)
    rx = int(round(cx + 0.72 * half))
    p.px(rx, row, 'G')
    p.px(rx + 1, row, 'g')
    p.px(rx, row + 1, 'g')
    p.px(rx + 1, row + 1, 'k')

register(
    'juggernaut', label='JUGGERNAUT', hero='KNIGHT', kind='mechanic',
    cat='movement',
    why='a pauldron, four lames',
    ramps=('steel', 'gold'),
    grid=p,
)
