# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── LONG REACH ──────────────────────────────────────────────────────────────
# A whole spear, corner to corner. The talent is +12 px of reach, so the LENGTH
# is the read: the object is laid on the anti-diagonal because that is the
# longest line the socket holds, and it fills the whole of it.
#
# The socket is the red `damage` ground, so this is the case the shield is not:
# steel is the only cool ramp in the set and it belongs here. The shaft is the
# warm note against it.
#
# Drawn parametrically off the axis rather than row by row, because everything
# about the object is a function of two numbers: t, how far along from the butt,
# and s, how far across from the centre line. Half-width is a profile in t, and
# every tone is a ramp in s -- which is what puts the specular in the same place
# on the blade, the collar and the butt shoe without three sets of coordinates.
p = G()

AX = 0.70710678                                 # the 45 degree axis, both ways

# t and s in pixels. Both depend on one sum, so the object is a clean 45 degree
# staircase and never a shallow-angle wobble.
along = lambda x, y: (x - y + 17) * AX
across = lambda x, y: (x + y - 31) * AX

L = 25.46                                       # butt at (7,24), tip at (25,6)
BUTT, SHAFT, COLLAR = 2.6, 13.6, 15.9           # the ends of the first three

# Half-width in PIXELS, never as a fraction of the shape, and each of these is
# a PIXEL COUNT: a band of half-width h is 2*floor(h*1.414)+1 pixels across a
# row, so the pole is five, the ferrule seven and the head nine. Two drafts
# died on this. A three-pixel pole under a seven-pixel head read as one needle,
# and a ferrule at 1.75 against a pole at 1.50 came out the SAME five pixels --
# a ring no wider than the pole is not a ring, it is a change of colour.
#
# The lengths matter as much: the ferrule and the butt shoe each need three
# units of t or more. Anything shorter is a sliver cut across a 45 degree
# object, and it lands as two stray pixels that read as dirt on the shaft.
SHAFT_HALF, FERRULE_HALF, HEAD_HALF = 2.15, 2.85, 3.55


def half_width(t):
    """The spear's profile: shoe, pole, ferrule, leaf blade."""
    if t < 0.0 or t > L:
        return None
    if t < BUTT:
        return 0.50 + (t / BUTT) * 0.95         # the butt spike, a long taper
    if t < SHAFT:
        return SHAFT_HALF
    if t < COLLAR:
        return FERRULE_HALF
    # The head is a TRIANGLE, widest at the shoulder where it steps out of the
    # ferrule and straight to the point from there. A leaf of the same bounding
    # box carries its width halfway up and reads short and fat -- a dagger --
    # and it cost the pole four pixels it needed to read as a pole.
    b = (t - COLLAR) / (L - COLLAR)
    return 0.40 + (HEAD_HALF - 0.40) * (1.0 - b) ** 0.92


def steel(s, hw):
    """Six steps across a lens-section blade, lit from the upper left.

    p P M M P p S S X X s -- the rolled edge, the highlight, the specular, the
    fall toward the crest, the crest itself, the hard step onto the shadow
    bevel, the core shadow, and the far edge bouncing. The specular sits OFF
    the crest rather than on it because the section is a lens and not a
    diamond; on the crest it read as a stripe down the middle.
    """
    if hw < 1.0:
        # The last two pixels are the point itself, all crest and no flank, so
        # they take the highlight whole. Run through the ramp they came out as
        # the crest tone -- the darkest of the light steels -- and the spear
        # ended in a grey speck instead of a point.
        return 'P'
    if s > 0.35 and s + 0.72 > hw:
        return 's'                              # reflected light, far edge only
    return pick(s, [-3.18, -2.47, -1.06, -0.35, 0.35, 1.77, 3.18], 'pPMPpSXs')


def wood(s, hw):
    """Seven pixels of pole, turned: highlight, midtone, core, and the bounce."""
    if s > 0.30 and s + 0.72 > hw:
        return 'v'
    return pick(s, [-1.76, -0.35, 0.35, 1.06, 1.77], 'wWwuUv')


for y in range(32):
    for x in range(32):
        t = along(x, y)
        hw = half_width(t)
        if hw is None:
            continue
        s = across(x, y)
        if abs(s) > hw:
            continue
        # Steel at both ends and at the socket, wood between: the pole is the
        # only warm thing in the frame and the socket it sits in is red, so it
        # carries the hue separation the blade cannot.
        if t < BUTT:
            # The spike runs the DARK half of the ramp. Lit like the blade it
            # was a bright bead at the foot of the object, which is a pommel,
            # and a pommel under a guard-shaped ferrule is a dagger.
            p.px(x, y, pick(s, [-0.35, 1.06], 'psS'))
        elif t < SHAFT:
            p.px(x, y, wood(s, hw))
        else:
            p.px(x, y, steel(s, hw))

register(
    'longReach', label='LONG REACH', hero='KNIGHT', kind='direct', cat='damage',
    why='a spear, blade ridged',
    ramps=('steel', 'wood'),
    grid=p,
)
