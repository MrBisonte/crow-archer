# -*- coding: utf-8 -*-
import math

from iconkit import G, N, pick, register

# ── LONG STEP ───────────────────────────────────────────────────────────────
# A pair of dividers, opened wide. The instrument whose whole job is stepping
# off a distance, and whose own verb for doing it is "walking" it -- one leg
# planted, the other swung out as far as the joint will give. That is the
# talent: the same single hop, reaching further.
#
# It also sits with the other three by kind. HELD STEP is an hourglass and this
# is a pair of dividers, so the line opens on two instruments of measure -- time
# bought, then distance -- before THIRD STEP counts the hops and THUNDERSTEP
# lands them.
#
# Steel, for the reason the hourglass frame is steel: `movement` tints the
# socket golden and steel is the only COOL ramp in the set, so the object
# separates from its ground by hue and not only by value. Where the gold is
# allowed to go, and why it is allowed nowhere else, is at KNUCKLE_RX below.
s = G()

PIVOT = (14.0, 6.6)          # where both legs hinge, and the knuckle's centre

# Both bosses are WIDER THAN THEY ARE TALL, and that is the whole difference
# between a hinge and a knob: a round head on this object read as the bow of a
# key, and the key was all anyone saw. Given as two radii in pixels rather than
# as one radius and a squash factor, so the knuckle can be widened to cover the
# legs without growing taller and back into the bezel.
#
# The knuckle is STEEL, the same as the legs, so the silhouette is one
# continuous object. Drawn in brass it was the width of the shanks and a
# different colour from them, and it read as a hat sitting on two sticks. The
# brass is the washer inside it instead -- gold enclosed by steel, which is the
# only arrangement of those two that survives a golden socket, and the same one
# the hourglass keeps its sand in.
KNUCKLE_RX, KNUCKLE_RY = 4.2, 3.0
BOSS_RX, BOSS_RY = 2.2, 1.6

# ONE length and two bearings, rather than two feet placed by hand. A compass
# whose legs are different lengths is not a compass, and by the fourth draft the
# hand-placed feet were 13 per cent apart. The bearings are what carries the
# talent: the near leg is all but plumb -- planted, the foot you did not move --
# and the far one is swung to the far side of the socket, so the object is
# caught mid-stride rather than standing symmetrically to attention. A
# symmetrical pair of legs is an A, and the set already knows what happens to a
# shape that reads as a letter.
LEG_LEN = 21.0
BEARING_NEAR = -20.0         # degrees off plumb, the planted leg
BEARING_FAR = 34.0           # and the swung one

# In PIXELS, never as a fraction of the leg. A shank whose width is a ratio of
# its length tapers the whole way down and reads as a wedge -- which is what the
# first two drafts were, a pair of blades rather than a pair of legs. A real
# divider leg is parallel for most of its run and turns to a needle only at the
# end, and the needle is what says instrument rather than tongs.
SHANK_W = 5.0
POINT_W = 1.8                # under ~1.5 the tip breaks into loose pixels
POINT_AT = 0.80              # where along the leg the shank becomes the needle

# Six steps across a leg, near edge to far: dark edge, specular, highlight,
# midtone, core shadow, and the one pixel of reflected light that stops a rod
# reading as a stripe. Given as a cross-section rather than as a pair of
# outlines -- an outlined leg is a wireframe, which is how the hourglass failed.
ROD = 'XMPpSs'
ROD_STOPS = [0.17, 0.34, 0.52, 0.68, 0.84]


def rod(g, p0, p1, w0, w1):
    """A straight round bar from p0 to p1, w0 wide at one end and w1 at the other.

    Rasterised off the perpendicular distance to the centreline rather than row
    by row, so both legs come out the same thickness however far one of them is
    swung. Row spans would have made the far leg half again as fat as the near
    one at the angle it sits at, which is the proportion failure this whole set
    keeps losing drafts to.
    """
    x0, y0 = p0
    dx, dy = p1[0] - x0, p1[1] - y0
    span = math.hypot(dx, dy)
    for y in range(N):
        for x in range(N):
            along = ((x - x0) * dx + (y - y0) * dy) / (span * span)
            if not 0.0 <= along <= 1.0:
                continue
            half = (w0 + (w1 - w0) * along) / 2.0
            across = ((x - x0) * dy - (y - y0) * dx) / span
            if abs(across) > half:
                continue
            g.px(x, y, pick((across + half) / (2.0 * half), ROD_STOPS, ROD))


def leg(g, bearing):
    """One leg swung `bearing` degrees off plumb: parallel shank, then needle."""
    a = math.radians(bearing)
    foot = (PIVOT[0] + LEG_LEN * math.sin(a), PIVOT[1] + LEG_LEN * math.cos(a))
    knee = tuple(p + (f - p) * POINT_AT for p, f in zip(PIVOT, foot))
    rod(g, PIVOT, knee, SHANK_W, SHANK_W)
    rod(g, knee, foot, SHANK_W, POINT_W)


def dome(g, rx, ry, chars, stops, rim):
    """An oblate boss on the pivot, keyed from the upper left.

    Both the steel knuckle and the brass washer inside it are this shape in a
    different material, so it takes the ramp rather than switching on which one
    it is being asked for.
    """
    cx, cy = PIVOT
    for y in range(N):
        for x in range(N):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            out = math.hypot(nx, ny)
            if out > 1.0:
                continue
            v = (nx + ny) / 1.414
            g.px(x, y, rim if out > 0.66 and v > 0.35 else pick(v, stops, chars))


leg(s, BEARING_FAR)                      # far leg first, so the near one covers
leg(s, BEARING_NEAR)
dome(s, KNUCKLE_RX, KNUCKLE_RY, 'MPpSX', [-0.62, -0.28, 0.12, 0.55], 's')
dome(s, BOSS_RX, BOSS_RY, 'MGgk', [-0.70, -0.20, 0.35], 'g')

register(
    'blinkReach', label='LONG STEP', hero='WIZARD', kind='mechanic', cat='movement',
    why='a pair of dividers, stepped open',
    ramps=('steel', 'gold'),
    grid=s,
)
