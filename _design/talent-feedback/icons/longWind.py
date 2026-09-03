# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── LONG WIND ───────────────────────────────────────────────────────────────
# A hunting horn. The talent buys a second of standing still before Momentum
# starts to drain, and a horn is the object a long breath belongs to.
#
# Not a second hourglass. HELD STEP owns that one, and two duration talents
# drawn as the same object is an icon the player has to read twice.
#
# Material is what this socket decides. `speed` tints the ground GREEN, so the
# warm ramp is the one that separates, and leather runs the horn's six steps
# across the tube. All-steel here would have been cool on cool, which is the
# knight's shield mistake pointing the other way.
#
# The mounts went on in GOLD first and disappeared. Gold and leather are the
# same hue at nearly the same values -- #E8B63A on #D6A65C -- so a band of one
# on the other is a band nobody can see. They are steel, which is the only
# thing in the set that separates from tan by hue rather than by a shade.
#
# The axis runs lower-left to upper-right and it has to. Lay a tube along the
# key light instead and its cross-section is lit edge-on -- no gradient across
# it at all, and a tube with no gradient is a stripe.
h = G()

TIP, BELL = (7.4, 23.6), (20.6, 10.4)
BOW = 4.2                                   # bent, not curled: a curl is a snail
R_TIP, R_BELL = 0.95, 4.7
# Six steps across the tube, the way SET FEET runs them across a boot shaft:
# dark edge, specular, highlight, midtone, core shadow, far dark edge, and the
# reflected pixel OUTSIDE that -- the last one is what stops a tube reading as
# a stripe. f = 0 is the upper-left edge, which is where the key light is.
ACROSS = [0.09, 0.19, 0.38, 0.62, 0.78, 0.90]
HORN = 'LECHhLh'
MOUNT = 'XMPpsSp'                           # steel, landing on the same values


def spine(t):
    """A point, a unit tangent and the tube's radius, mouthpiece to bell."""
    dx, dy = BELL[0] - TIP[0], BELL[1] - TIP[1]
    n = math.hypot(dx, dy)
    cx = (TIP[0] + BELL[0]) / 2.0 - dy / n * BOW
    cy = (TIP[1] + BELL[1]) / 2.0 + dx / n * BOW
    a, b, c = (1 - t) * (1 - t), 2 * (1 - t) * t, t * t
    px = a * TIP[0] + b * cx + c * BELL[0]
    py = a * TIP[1] + b * cy + c * BELL[1]
    ux = 2 * ((1 - t) * (cx - TIP[0]) + t * (BELL[0] - cx))
    uy = 2 * ((1 - t) * (cy - TIP[1]) + t * (BELL[1] - cy))
    ul = math.hypot(ux, uy) or 1.0
    return px, py, ux / ul, uy / ul, R_TIP + (R_BELL - R_TIP) * t ** 1.55


# The mounts are t-intervals rather than pixel rows: a band drawn as rows cuts
# the tube square across and reads as a join, and a horn is one piece.
BANDS = ((0.00, 0.10), (0.44, 0.51), (0.87, 0.94))

STEPS = 320
for i in range(STEPS):
    t = i / float(STEPS - 1)
    cx, cy, ux, uy, r = spine(t)
    nx, ny = -uy, ux                        # across the tube, toward the shadow
    ramp = MOUNT if any(lo <= t <= hi for lo, hi in BANDS) else HORN
    k = -r
    while k <= r:
        h.px(int(round(cx + nx * k)), int(round(cy + ny * k)),
             pick((k + r) / (2 * r), ACROSS, ramp))
        k += 0.45

# The bell. A tube that simply stops is a tusk, which is what the first draft
# was: the OPEN MOUTH is what names the object. Dark inside, the far inner wall
# taking the light that gets in, and a lip standing a little proud.
#
# The lip is drawn OUTSIDE the mouth. The first pass put its two rings inside,
# at 1.00 and 0.86 of the ellipse, and on a mouth five pixels across they met
# in the middle -- a solid cap, and the horn was a tusk with a bright end.
BX, BY, BUX, BUY, _ = spine(1.0)
BNX, BNY = -BUY, BUX
BX, BY = BX + BUX * 0.7, BY + BUY * 0.7
MAJOR, MINOR = R_BELL * 1.05, R_BELL * 0.70

for y in range(2, 30):
    for x in range(2, 30):
        a = (x - BX) * BNX + (y - BY) * BNY
        b = (x - BX) * BUX + (y - BY) * BUY
        if (a / MAJOR) ** 2 + (b / MINOR) ** 2 > 1.0:
            continue
        h.px(x, y, pick(a / MAJOR, [0.24, 0.66], 'BLh'))

RIM = 260
for i in range(RIM):
    th = i / float(RIM) * math.pi * 2
    for scale in (1.0, 1.13):
        ox = BNX * MAJOR * scale * math.cos(th) + BUX * MINOR * scale * math.sin(th)
        oy = BNY * MAJOR * scale * math.cos(th) + BUY * MINOR * scale * math.sin(th)
        h.px(int(round(BX + ox)), int(round(BY + oy)),
             pick((ox + oy) / MAJOR, [-0.9, -0.3, 0.3, 0.8], 'PPpsS'))

# The mouthpiece, so the thin end is an end and not a break.
MX, MY, MUX, MUY, _ = spine(0.0)
for y in range(2, 30):
    for x in range(2, 30):
        d = math.hypot(x - MX + MUX * 0.4, y - MY + MUY * 0.4)
        if d <= 1.9:
            h.px(x, y, pick(math.hypot(x - MX + 0.9, y - MY + 0.9), [1.0, 2.1], 'Pps'))

register(
    'longWind', label='LONG WIND', hero='RANGER', kind='indirect', cat='speed',
    why='a hunting horn, mouth open',
    ramps=('leather', 'steel'),
    grid=h,
)
