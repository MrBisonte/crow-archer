# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── STORMCALLER ─────────────────────────────────────────────────────────────
# A bell. The talent is a RITE -- the storm comes back sooner because the
# wizard has made a habit of asking for it -- and a bell is the object a rite
# is kept by: struck, and struck again, on a shorter interval each time.
#
# It also had to be as far from WIDER SKY as WIDER SKY is from THUNDERSTEP.
# Those two are weather: cool, and hanging in the top of the socket. This is
# cast metal, warm, and it stands on the bottom of it.
#
# Gold is four steps and a surface this big needs six, so the body runs a brass
# ramp built from both warm ramps -- G E g k K B, light to dark. The `speed`
# socket is green, and the bell is the only warm thing in the frame.
b = G()

AXIS = 15.5
CROWN, SHOULDER, LIP = 7, 11, 20   # dome top, where it stops, where it flares
DOME = 5.15                        # rows the head takes to reach full shoulder
WAIST, FLARE = 5.4, 4.4            # half-widths in PIXELS, never in ratios
LIP_HALF = 10.4                    # the flange, standing proud of the mouth
MOUTH = (9.0, 2.2)                 # the opening: half-width, and half-depth
BODY = 'GEgkKB'


def bell_half(y):
    """Half-width of the bell at row y: a dome, then a waist, then the flare."""
    if y < SHOULDER:
        k = (SHOULDER - y) / DOME
        return WAIST * max(0.0, 1.0 - k * k) ** 0.5
    t = (y - SHOULDER) / float(LIP - SHOULDER)
    # Squared, not linear: a straight-sided bell is a lampshade. The flare has
    # to arrive late so the waist stays narrow and the mouth opens fast.
    return WAIST + FLARE * t * t


def course(y, half, ramp, stops, shade=0.0):
    """One row of a surface of revolution, six steps across it.

    The bell is turned, so the light runs round it horizontally the way it does
    on a cylinder. A pool of light, the way a shield takes it, would model this
    as a disc. The last pixel is the bounce off the far edge -- without it the
    right side of every row is an outline and the bell reads as a cut-out.
    """
    x0, x1 = int(round(AXIS - half)), int(round(AXIS + half))
    for x in range(x0, x1 + 1):
        b.px(x, y, pick((x - x0) / float(max(1, x1 - x0)) + shade, stops, ramp))
    b.px(x1, y, 'k')


for y in range(CROWN, LIP + 1):
    # A shade darker toward the mouth: it is further from the key light, and
    # the flare turns its own face down and away from it.
    course(y, bell_half(y), BODY, [0.08, 0.22, 0.50, 0.76, 0.93],
           0.10 * (y - CROWN) / float(LIP - CROWN))

# The lip. Two courses, not one: the top of the flange is turned up into the
# light and its outer face rolls down out of it, and that pair of rows is most
# of what separates a bell from a bag.
course(LIP + 1, LIP_HALF, 'GEgkK', [0.10, 0.28, 0.58, 0.84])
course(LIP + 2, LIP_HALF - 0.5, 'EgkKB', [0.10, 0.28, 0.58, 0.84])

# The mouth: the inside of the bell, seen from a little below, so it is the
# bottom of an ELLIPSE and not a bar. Drawn flat it read as a plank the bell
# was standing on. In there the far wall is the lit one, so the dark runs left
# and the bounce right -- the reverse of every outer surface on the object.
rx, ry = MOUTH
for i in range(2):
    y = LIP + 3 + i
    half = rx * max(0.0, 1.0 - ((y - (LIP + 2.6)) / ry) ** 2) ** 0.5
    x0, x1 = int(round(AXIS - half)), int(round(AXIS + half))
    for x in range(x0, x1 + 1):
        b.px(x, y, 'B' if (x - x0) / float(max(1, x1 - x0)) < 0.34 else 'K')
    b.px(x1, y, 'k')

# The clapper, hanging out of the mouth and off the axis. A bell drawn dead
# symmetrical is an ornament; this one is meant to be mid-swing.
CX, CY, CR = 19.4, 25.2, 1.9
for y in range(int(CY - CR), int(CY + CR) + 2):
    for x in range(int(CX - CR), int(CX + CR) + 2):
        if ((x - CX) ** 2 + (y - CY) ** 2) ** 0.5 > CR:
            continue
        n = ((x - (CX - 0.8)) ** 2 + (y - (CY - 0.8)) ** 2) ** 0.5
        b.px(x, y, pick(n, [0.9, 1.8, 2.6], 'EgkK'))

# The canon, the loop it hangs by. Wall two pixels, hole three by two, both
# given as numbers: a ring whose wall is a fraction of its radius closes up at
# 48 px and reads as a knob, which is what MORE LINKS died of four times. A
# two-wide hole was that knob -- the seam pass paints three of its four cells
# and what was left read as one dark pixel. The neck under it is the ring's own
# bottom, which is why DOME is slack enough to leave a seven-wide crown.
for y, ramp in ((4, 'gEEEEEk'), (5, 'GE   gk'), (6, 'GE   gk')):
    b.put(y, 13, ramp)

register(
    'stormcaller', label='STORMCALLER', hero='WIZARD', kind='indirect', cat='speed',
    why='a bell, clapper swung',
    ramps=('gold', 'leather'),
    grid=b,
)
