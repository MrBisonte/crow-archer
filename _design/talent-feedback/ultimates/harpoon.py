# -*- coding: utf-8 -*-
import math

from iconkit import G, ULT_N, pick, register

# ── HARPOON ─────────────────────────────────────────────────────────────────
# One heavy barbed head, socketed on a haft, the line whipped round the haft
# and running off the plate. The talent throws ONE thing and the thing pulls
# HIM in, so the object is drawn for weight and the line is drawn long.
#
# LAID ON A DIAGONAL, and both of the first three drafts are why. Stood
# upright it was bilaterally symmetric with a point at the top, which is an
# ARROWHEAD -- no amount of barb or rope argued with that silhouette, and the
# archer already has an arrow. Tilted, nothing else in the set has its shape,
# and the line has a whole corner of plate to cross instead of a stub at the
# edge. The tip leads up-RIGHT rather than up-left for a second reason: an
# axis pointed into the key light is lit flat along its whole length, so the
# haft had no round to it at all.
#
# Bronze rather than steel. The ultimate ground is deep violet, so a cool ramp
# there is the hourglass mistake inverted -- gold's specular over leather's
# body gives eight warm steps that separate by hue as well as by value. Its
# line-mate FULL AUTO is a wooden box with steel points: one heavy thing on a
# line against many light ones leaving at once.
h = G(ULT_N)

# (dark edge, specular, highlight, midtone, core shadow, reflected light)
BRONZE = ('B', 'G', 'E', 'C', 'h', 'H')
WOOD = ('U', 'E', 'W', 'w', 'u', 'v')
GOLD6 = ('K', 'G', 'g', 'k', 'K', 'k')
CORD = ('o', 'N', 'N', 'n', 'o', 'n')

BUTT = (13.0, 38.0)
TIP = (33.0, 10.0)
LEN = math.hypot(TIP[0] - BUTT[0], TIP[1] - BUTT[1])
UX, UY = (TIP[0] - BUTT[0]) / LEN, (TIP[1] - BUTT[1]) / LEN
PX, PY = -UY, UX                       # across the shaft, down-right = shadow

HAFT, COLLAR, NECK = 17.0, 21.0, 21.0  # distances up the axis from the butt
SHOULDER = 25.0


def at(s, k=0.0):
    """A point s pixels up the axis and k pixels across it."""
    return (BUTT[0] + UX * s + PX * k, BUTT[1] + UY * s + PY * k)


def spine(s0, s1, half_at, chars):
    """A body of revolution along the axis, in the six steps every surface runs.

    Shaded ACROSS the axis: the dark contour on the lit rim, the specular just
    inside it, and one pixel of bounce on the far rim, which is the step that
    stops a long shape reading as a stripe.
    """
    s = s0
    while s <= s1 + 0.01:
        half = half_at(s)
        k = -half
        while k <= half + 0.01:
            f = (k + half) / max(2.0 * half, 0.01)
            if half > 1.0 and k <= -half + 0.6:
                ch = chars[0]
            elif half > 1.0 and k >= half - 0.6:
                ch = chars[5]
            else:
                ch = pick(f, [0.24, 0.5, 0.78], chars[1:5])
            x, y = at(s, k)
            h.px(int(round(x)), int(round(y)), ch)
            k += 0.45
        s += 0.34


def wedge(a, b, w0, w1, chars):
    """A tapering limb between two points, shaded the same way across."""
    steps = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) * 3) + 1
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln, dx / ln
    if nx + ny < 0:
        nx, ny = -nx, -ny
    for i in range(steps + 1):
        t = i / float(steps)
        cx, cy = a[0] + dx * t, a[1] + dy * t
        half = (w0 + (w1 - w0) * t) / 2.0
        k = -half
        while k <= half + 0.01:
            f = (k + half) / max(2.0 * half, 0.01)
            if half > 0.9 and k <= -half + 0.6:
                ch = chars[0]
            elif half > 0.9 and k >= half - 0.6:
                ch = chars[5]
            else:
                ch = pick(f, [0.24, 0.5, 0.78], chars[1:5])
            h.px(int(round(cx + nx * k)), int(round(cy + ny * k)), ch)
            k += 0.45


def cord(pts):
    """The line: two pixels thick, its crown alternating every fourth pixel so
    the strand reads as laid rather than as a grey pipe."""
    laid = 0
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        n = int(max(abs(bx - ax), abs(by - ay)) * 3) + 1
        for j in range(n + 1):
            t = j / float(n)
            x, y = int(round(ax + (bx - ax) * t)), int(round(ay + (by - ay) * t))
            twist = (laid // 4) % 2 == 0
            h.px(x, y, 'N' if twist else 'n')
            h.px(x, y + 1, 'n' if twist else 'o')
            laid += 1


def blade_half(s):
    if s < SHOULDER:
        return 2.0 + 1.7 * (s - NECK) / (SHOULDER - NECK)
    return 3.7 * (1.0 - ((s - SHOULDER) / (LEN - SHOULDER)) ** 1.15)


# The barbs first, so the head closes over their roots. Two segments each, so
# the barb BENDS and its point turns back toward the haft; a straight spike off
# the neck is a fin.
# The far barb is drawn SHORTER than the near one. Equal reaches on a tilted
# object put the upper one out sideways at almost no fall, and a flat span off
# the neck reads as a wing rather than as a barb.
for sign, reach, drop in ((-1, 5.4, 9.0), (1, 8.4, 8.0)):
    root = at(23.0, sign * 1.4)
    knee = at(23.0 - drop * 0.45, sign * reach * 0.68)
    point = at(23.0 - drop, sign * reach)
    wedge(root, knee, 3.2, 2.2, BRONZE)
    wedge(knee, point, 2.2, 0.9, BRONZE)

spine(0.0, HAFT, lambda s: 2.6, WOOD)              # the haft
spine(HAFT - 0.5, COLLAR, lambda s: 3.2, GOLD6)    # the socket collar
spine(NECK, LEN, blade_half, BRONZE)               # the head

# The mid-rib: a ridge one step brighter than the face with its own shadow on
# the low side, so the head reads as a diamond section rather than a plate.
s = NECK + 2.0
while s < LEN - 2.0:
    for k, ch in ((-0.9, 'G'), (0.1, 'E'), (1.1, 'h')):
        x, y = at(s, k)
        h.px(int(round(x)), int(round(y)), ch)
    s += 0.34

# Two turns of the line whipped round the haft, and then the line itself,
# sweeping off across the corner the object leaves empty.
for s_w in (6.0, 12.0):
    spine(s_w - 1.3, s_w + 1.3, lambda s: 3.0, CORD)
cord([(18.6, 31.4), (24.0, 35.0), (30.0, 37.0), (36.0, 35.5), (41.0, 31.0)])

register(
    'harpoon', label='HARPOON', hero='ranger', kind='direct', cat='ultimate',
    why='a barbed head on a line, thrown once and hauled on',
    ramps=('gold', 'leather', 'wood', 'rope'),
    grid=h,
)
