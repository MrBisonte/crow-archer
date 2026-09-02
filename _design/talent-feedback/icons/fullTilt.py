# -*- coding: utf-8 -*-
import math

from iconkit import G, N, register

# ── FULL TILT ───────────────────────────────────────────────────────────────
# A horseshoe. "At full tilt" is a riding phrase before it is anything else,
# and Momentum is measured off ground actually COVERED -- a wall gives her
# nothing -- so the object is the one that covers the ground at the gallop and
# wears out doing it.
#
# The socket is the red `damage` ground, so the plate is STEEL: the one cool
# ramp in the set, on the warmest ground in it.
#
# Three drafts before this, all of them a rowel spur, and each failed further
# in. Spindly first -- a 2.5 px band, a thin neck and six needle points, none
# of which survives the outline pass. Fattened, the wheel came out a DAISY:
# sinusoidal lobes round a bright gold boss is a flower in every painting there
# has ever been. Flat-sided teeth and a dark axle fixed the wheel, and the icon
# still read as a wrench -- because a spur is THREE masses, band, neck and
# wheel, and at 32 px a reader gets one silhouette, not an assembly.
#
# So: one mass. The wall is given in PIXELS, which is MORE LINKS's lesson taken
# as read rather than re-learnt -- a wall set as a fraction of the radius
# thickens with the shoe and the opening stops being an opening.
s = G()

CX, CY = 15.5, 15.2
OUTER, WALL = 10.0, 4.6
INNER = OUTER - WALL
HEEL = -math.pi / 2 + 0.12                  # the gap, leaning off dead vertical
GAP = 0.85                                  # half its angle, in radians
LX, LY = 10.0, 9.0                          # where the key light pools
STEEL = 'MPpsSX'


def face(x, y):
    """Which step of the ramp the web sits on, before the bevels."""
    d = math.hypot(x - LX, y - LY)
    for i, stop in enumerate((3.2, 7.0, 11.5, 15.5)):
        if d < stop:
            return i
    return 4


def branch(x, y):
    """Where a pixel sits on the shoe, or None if it is off it.

    Returns how far across the web it is (0 inner, 1 outer), how far its normal
    has turned from the key light (-1 into it, +1 away), and how close to a
    heel it is (0 at the toe, 1 at the very end of a branch).
    """
    dx, dy = x - CX, y - CY
    d = math.hypot(dx, dy)
    if d > OUTER or d < INNER:
        return None
    off = abs((math.atan2(dy, dx) - HEEL + math.pi) % (2 * math.pi) - math.pi)
    if off < GAP:
        return None
    return (d - INNER) / WALL, (dx + dy) / d, max(0.0, 1.0 - (off - GAP) / 0.30)


for y in range(N):
    for x in range(N):
        at = branch(x, y)
        if at is None:
            continue
        rr, c, heel = at
        step = face(x, y)
        # The web is a flat plate, so the six steps run across the WHOLE shoe
        # rather than across the wall -- a 4.6 px wall carrying its own six is
        # what left the first horseshoe speckled. The two bevels are all the
        # wall gets: a plate reads as thick when its edges disagree.
        if rr > 0.86:
            step = max(0, step - 1) if c < -0.1 else (2 if c > 0.25 else step)
        elif rr < 0.14:
            step = min(5, step + 2) if c < 0.1 else max(0, step - 1)
        if heel:
            step = min(5, step + 1)         # the calkins, turned down and dark
        s.px(x, y, STEEL[step])

# Six nail holes, three to a branch. They are what says horseshoe rather than
# ring: a bare arc of metal this thick is a bracket. One pixel each and no
# lip -- a fuller groove was in here too, and a groove and eight holes across
# five pixels of web is not texture, it is noise.
for sign in (1, -1):
    for j in range(3):
        a = HEEL + sign * (GAP + 0.34 + j * 0.62)
        r = INNER + WALL * 0.56
        s.px(int(round(CX + math.cos(a) * r)), int(round(CY + math.sin(a) * r)), 'X')

register(
    'fullTilt', label='FULL TILT', hero='RANGER', kind='indirect', cat='damage',
    why='a horseshoe, six nail holes',
    ramps=('steel',),
    grid=s,
)
