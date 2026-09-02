# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── DEEPER CUT ──────────────────────────────────────────────────────────────
# A dagger held point down, wet halfway up the blade and beading at the tip.
# How far up the steel the blood stands is the whole of what this talent does:
# every Bloodlust stack puts the edge in deeper.
#
# Fifth drawing, and the four before it all failed on the same thing. A blade
# with nothing at the top of it is not a weapon: a socket over shoulders read
# as a lamp, a bare triangle read as a chisel, and a triangle over a swelling
# bead read as an HOURGLASS -- which this set already has. A GUARD is what
# names a blade at 48 px, so the steel gets a pommel, a grip and a crossbar,
# and the taper below them has something to be the blade OF.
#
# The socket is the red `damage` ground, so the object is steel -- the only
# cool ramp in the set -- and the blood is only ever carried by steel: a slick
# with a lit lip of metal over it, and a bead with a cold glint on it. Red laid
# straight onto this ground is TOWER GUARD's brown-on-brown with the hues
# swapped.
c = G()

CENTRE = 15.5
POMMEL, GUARD, SHOULDER = 4, 9, 11    # the rows the pommel, the bar and the blade start
NARROWS, TIP = 19, 24                 # where the blade starts to taper, and ends
BLADE_HALF = 3.9
WET = 19                              # how far up the blade the blood stands
BULB = (15.4, 25.6, 2.2)              # the bead at the tip: centre and radius


def blade_span(y):
    """Left and right column of the blade at row y.

    Straight and full width for two thirds of its length, then a taper. A
    blade that narrows from the guard down is a goblet's stem, and this icon
    was a goblet once already.
    """
    if y < SHOULDER or y > TIP:
        return None
    half = BLADE_HALF
    if y > NARROWS:
        half *= 1.0 - 0.86 * (y - NARROWS) / (TIP - NARROWS)
    return int(round(CENTRE - half)), int(round(CENTRE + half))


def bevel(x, y, half, ramp):
    """One column of a blade in section: a ridge, and both faces off it.

    The near face is turned into the key light and the far one out of it. A
    blade run bright-edge-to-dark-edge is a flat plate, whatever its outline.
    """
    d = abs(x - CENTRE) / max(half, 0.6)
    v = d * 0.78 if x < CENTRE else 0.36 + d * 0.60
    c.px(x, y, pick(v, [0.14, 0.34, 0.58, 0.83], ramp))


for y in range(SHOULDER, TIP + 1):
    x0, x1 = blade_span(y)
    for x in range(x0, x1 + 1):
        bevel(x, y, (x1 - x0) / 2.0, 'MPpsS')
    c.px(x0, y, 'S')                                     # the dark edge
    if x1 - x0 > 2:
        c.px(x1, y, 'p')                                 # the bounce off the far one

for y in range(POMMEL, GUARD):                            # the pommel, then the grip
    x0, x1 = (13, 18) if y < POMMEL + 2 else (14, 17)
    for x in range(x0, x1 + 1):
        c.px(x, y, pick((x - x0) / float(x1 - x0), [0.2, 0.45, 0.75], 'PpsS'))
    c.px(x0, y, 'S')
    c.px(x1, y, 'p')                                     # the bounce off the far side
for x in range(13, 19):
    c.px(x, POMMEL, 'S' if x in (13, 18) else ('P' if x < 16 else 'p'))
for x in range(14, 18):                                  # one binding round the grip
    c.px(x, POMMEL + 3, 'S' if x < 16 else 's')

# The crossbar is what names a blade at 48 px, and it only does that if it
# PROJECTS: two pixels either side of the blade is a collar, and a collar over
# a tapering body is a bottle. Five either side is a guard.
for y in (GUARD, GUARD + 1):
    x0, x1 = (8, 23) if y == GUARD else (7, 24)
    for x in range(x0, x1 + 1):
        v = (x - x0) / float(x1 - x0)
        c.px(x, y, pick(v, [0.18, 0.44, 0.72], 'PpsS') if y == GUARD
              else pick(v, [0.16, 0.42, 0.70], 'pssS'))
    c.px(x0, y, 'S')
    c.px(x1, y, 'p' if y == GUARD + 1 else 's')          # reflected, far end of the bar
c.px(9, GUARD, 'M')                                      # the specular, one pixel

# Blood standing on the steel, with a lit lip of metal over it. A waterline is
# what says how deep the cut went; a red panel butted against a grey one just
# says the bottom half is red.
for y in range(WET, TIP + 1):
    x0, x1 = blade_span(y)
    for x in range(x0, x1 + 1):
        bevel(x, y, (x1 - x0) / 2.0, 'RRrqq')
    c.px(x0, y, 'q')
    c.px(x1, y, 'q')
x0, x1 = blade_span(WET)
for x in range(x0, x1 + 1):                              # the lip, uneven
    c.px(x, WET - 1, 'P' if x < 16 else 'p')
c.px(x0, WET - 1, 'S')
c.px(x1, WET - 1, 'S')
c.px(x0 + 1, WET - 1, 'q')                               # the run creeping a row higher

# The bead at the tip. A drop with a cold glint on it and the dark seam
# compose.mjs lays under it is the one place red sits alone on this ground.
cx, cy, r = BULB
for y in range(TIP, 28):
    if y < cy:
        t = (y - TIP + 0.4) / (cy - TIP + 0.4)
        half = 0.5 + (r - 0.5) * t ** 1.8                # the neck, drawn out
    else:
        half = (r * r + 0.4 - (y - cy) ** 2) ** 0.5
    if half < 0.3:
        continue
    span = (int(round(cx - half)), int(round(cx + half)))
    mid = (span[0] + span[1]) / 2.0
    for x in range(span[0], span[1] + 1):
        u = (x - mid) / max((span[1] - span[0]) / 2.0, 0.6)
        c.px(x, y, pick(0.52 + 0.42 * u + 0.22 * u * u + 0.26 * (y - cy) / r,
                        [0.26, 0.50, 0.76, 1.00], 'RRrqQ'))
c.px(14, 26, 'P')                                        # the glint, cold and wet
c.px(17, 27, 'r')                                        # reflected light, far edge

register(
    'deeperCut', label='DEEPER CUT', hero='KNIGHT', kind='direct', cat='damage',
    why='a dagger, wet to the guard',
    ramps=('steel', 'cloth'),
    grid=c,
)
