# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── FULL DRAW ───────────────────────────────────────────────────────────────
# The bow, strung and waiting, and NOTHING on the string. SPLIT SHAFT already
# owns the arrow, and an arrow here would have been the same drawing twice; the
# bare string is also the talent -- the bow is ready before he is.
#
# Six drafts died stood upright. Drawn to the ear it is a fat curve against a
# V, which at 48 px is a lozenge of empty ground inside a thin outline -- it
# read as a medallion, then as a leaf. Braced and vertical it is worse: to fill
# a square socket the arc has to be half a circle, the two limbs mirror each
# other about the grip, and a mirrored pair of curves meeting at a block is a
# BOOMERANG. It read as one four times running.
#
# So the bow is CANTED, corner to corner. That is twenty-six pixels of stave
# rather than twenty-one, which is enough length to bow gently instead of
# folding, and the two limbs no longer mirror -- one runs up into the light and
# the other down out of it, which is what a thing lying in a frame does.
d = G()

LOW, HIGH = (6.6, 25.4), (24.6, 6.4)          # the two tips
# Brace height, in pixels, and it is the number the whole drawing turns on: a
# parabola's slope at its ends is twice the sagitta over the half chord. Seven
# over a half span of twelve met the string at fifty degrees and the limbs came
# out HOOKED -- a slab across one corner and a bar down the side, which is a
# sickle. Five over thirteen meets it at thirty-nine, which is a bow, and it
# still leaves three pixels of ground between the stave and the cord.
BOW = 5.2
RECURVE = 0.30                                # how far past it the tips come

MIDX, MIDY = (LOW[0] + HIGH[0]) / 2.0, (LOW[1] + HIGH[1]) / 2.0
SPAN = math.hypot(HIGH[0] - LOW[0], HIGH[1] - LOW[1])
UX, UY = (HIGH[0] - LOW[0]) / SPAN, (HIGH[1] - LOW[1]) / SPAN    # along the string
PX, PY = UY, -UX                              # across it, toward the light

# Light: up, left and toward the viewer. Held as a 3-vector because the stave
# is a TUBE -- a limb that takes its lit side from "whichever way is outward"
# comes out lit from the LOWER left along the lower limb, which is what an
# earlier draft did and why the stave read as two different objects.
KX, KY, KZ = -0.62, -0.62, 0.48
LIMB = 'ECHhLB'                               # specular to deepest, six steps
CORD = 'RrqqQQ'                               # the same steps on the grip's cord
LIMB_STOPS = [-0.88, -0.62, -0.20, 0.18, 0.52]      # on -illumination
GRIP = 0.20                                   # the wrap, as a share of half the span


def spine(t):
    """A point and a unit tangent on the stave, lower tip (-1) to upper (+1).

    The sixth-power term is the recurve: over the last tenth of each limb the
    stave comes back level with the string and just crosses it. That crossing
    is the one line a boomerang has not got.
    """
    off = BOW * (1.0 - t * t) - RECURVE * t ** 6
    doff = -2.0 * BOW * t - 6.0 * RECURVE * t ** 5
    x = MIDX + UX * SPAN / 2.0 * t + PX * off
    y = MIDY + UY * SPAN / 2.0 * t + PY * off
    dx = UX * SPAN / 2.0 + PX * doff
    dy = UY * SPAN / 2.0 + PY * doff
    n = math.hypot(dx, dy)
    return x, y, dx / n, dy / n


def half(t):
    """Half the stave's width. It holds FLAT over the middle three fifths and
    tapers only over the last fifth, because that is how a stave is made -- a
    width that falls away from the grip the whole length is a wedge, and a
    wedge is what turned two drafts into a chevron."""
    a = abs(t)
    if a < 0.66:
        return 2.1
    return 2.1 - 1.3 * ((a - 0.66) / 0.34) ** 2


# The string, tip to tip, laid down FIRST so the recurved tips cross over it.
# One pixel is right for a cord, and the seam pass lays a dark edge either side
# of it, so it reads wider than it is drawn.
#
# It is STEEL, the only cool ramp in the set, and the brightest thing in the
# socket. Drawn in rope it was a dim grey thread beside a tan mass, the two
# read as one object, and the object they read as was a sickle. The string has
# to carry as much as the stave does or there is no bow, only a curve.
for i in range(int(SPAN * 3) + 1):
    f = i / (SPAN * 3.0)
    d.px(int(round(LOW[0] + (HIGH[0] - LOW[0]) * f)),
         int(round(LOW[1] + (HIGH[1] - LOW[1]) * f)), 'P' if f < 0.5 else 'p')

STEPS = 192
for i in range(STEPS):
    t = -1.0 + 2.0 * i / (STEPS - 1)
    cx, cy, ux, uy = spine(t)
    nx, ny = -uy, ux
    # The grip is wound HERE rather than stamped over the top afterwards. Laid
    # on as its own block it came out a red rectangle glued to the stave; wound
    # in the same pass it is the same tube a fraction of a pixel proud, which is
    # what a cord wrap actually is.
    grip = abs(t) < GRIP
    ramp = CORD if grip else LIMB
    turn = 1 if grip and int(round(SPAN / 2.0 * t)) % 2 else 0     # a turn's shaded half
    h = half(t) + (0.15 if grip else 0.0)
    k = -h
    while k <= h:
        u = k / h                              # -1 and +1 are the two edges
        z = math.sqrt(max(0.0, 1.0 - u * u))   # the tube, turning away
        lum = u * nx * KX + u * ny * KY + z * KZ
        step = int(pick(-lum, LIMB_STOPS, '012345'))
        if abs(u) > 0.93 and lum < 0:
            # The far edge takes the bounce off the ground. That one pixel is
            # the sixth step, and without it a limb reads as a stripe.
            step -= 2
        d.px(int(round(cx + nx * k)), int(round(cy + ny * k)),
             ramp[min(5, max(0, step + turn))])
        k += 0.3

# The nocking point: a bead of brass at the middle of the string, where the
# arrow would sit. The only warm bright thing out on the cord, so the eye ends
# up at the shot that is not there.
BEAD_X, BEAD_Y = int(round(MIDX)) - 1, int(round(MIDY)) - 1
for (dx, dy, ch) in ((0, 0, 'G'), (1, 0, 'g'), (0, 1, 'g'), (1, 1, 'k')):
    d.px(BEAD_X + dx, BEAD_Y + dy, ch)

register(
    'fullDraw', label='FULL DRAW', hero='ARCHER', kind='indirect', cat='speed',
    why='a bow, strung and empty',
    ramps=('leather', 'cloth', 'steel', 'gold'),
    grid=d,
)
