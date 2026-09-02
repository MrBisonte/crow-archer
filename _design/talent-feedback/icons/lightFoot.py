# -*- coding: utf-8 -*-
import math

from iconkit import G, register

# ── LIGHT FOOT ──────────────────────────────────────────────────────────────
# A feather, and the barbs are what makes it one. The first draft set single
# pixels standing off a straight white rod and it read as a mace: a barb is a
# STROKE, swept back toward the quill, and it touches the ones beside it. The
# vane is wide on the lit side and narrow on the other, which is both how a
# feather is built and where the six steps go -- M and P into the light, p and
# s across the shadow side, S at its edge, and one p of bounce beyond that.
w = G()
TIP, QUILL = (24.5, 4.0), (9.0, 28.0)
BOW = 2.2                                       # the rachis is not straight
SWEEP = 0.62                                    # how far back the barbs lie


def spine(t):
    """A point and a unit tangent on the rachis, tip to quill."""
    mx = (TIP[0] + QUILL[0]) / 2.0
    my = (TIP[1] + QUILL[1]) / 2.0
    dx, dy = QUILL[0] - TIP[0], QUILL[1] - TIP[1]
    n = math.hypot(dx, dy)
    cx = mx - dy / n * BOW                      # the control point, bowed out
    cy = my + dx / n * BOW
    a, b, c = (1 - t) * (1 - t), 2 * (1 - t) * t, t * t
    px = a * TIP[0] + b * cx + c * QUILL[0]
    py = a * TIP[1] + b * cy + c * QUILL[1]
    tx = 2 * ((1 - t) * (cx - TIP[0]) + t * (QUILL[0] - cx))
    ty = 2 * ((1 - t) * (cy - TIP[1]) + t * (QUILL[1] - cy))
    tl = math.hypot(tx, ty) or 1.0
    return px, py, tx / tl, ty / tl


STEPS = 30
VANE_END = 0.78
for i in range(STEPS):
    t = i / float(STEPS - 1)
    if t > VANE_END:
        continue
    cx, cy, ux, uy = spine(t)
    nx, ny = -uy, ux                            # across it, toward the light
    # 0.55 made the vane full width a tenth of the way down and the tip came
    # out blunt, which is half of why it read as a brush.
    shape = math.sin(math.pi * min(1.0, max(0.0, (t - 0.02) / (VANE_END - 0.02)))) ** 0.82
    for side, reach, ramp, notch in ((1, 5.9, 'MPps', 9), (-1, 3.0, 'psSp', 2)):
        # The vane is SOLID and the notches are cut out of it. Drawing the
        # barbs as separate rays left gaps between them, and a row of rays
        # standing off a rod is a thistle -- which is what the last two drafts
        # were. Four notches an edge is enough to say the edge is not drawn.
        span = reach * shape - (1.1 if i % 4 == notch else 0.0)
        if span < 0.7:
            continue
        bx = nx * side * math.cos(SWEEP) + ux * math.sin(SWEEP)
        by = ny * side * math.cos(SWEEP) + uy * math.sin(SWEEP)
        k = 0.0
        while k <= span:
            f = k / max(span, 0.01)
            ch = ramp[0] if f < 0.30 else (ramp[1] if f < 0.62 else ramp[2])
            if f > 0.90:
                ch = ramp[3]                    # the edge, and its bounce
            # Every third diagonal runs one step lighter, which is the grain:
            # a vane of one tone is a leaf, and the grain is what parts it into
            # barbs without opening a gap between them. Only on the shadow
            # side -- run it across the lit side too and the stripes read as
            # the object rather than as its surface.
            elif side < 0 and (i + int(k)) % 3 == 0 and f > 0.30:
                ch = ramp[1]
            w.px(int(round(cx + bx * k)), int(round(cy + by * k)), ch)
            k += 0.5

for i in range(STEPS * 2):                      # the rachis, over the barbs
    t = i / float(STEPS * 2 - 1)
    cx, cy, ux, uy = spine(t)
    nx, ny = -uy, ux
    if t <= VANE_END:
        w.px(int(round(cx)), int(round(cy)), 'M' if t < 0.42 else 'P')
        w.px(int(round(cx - nx)), int(round(cy - ny)), 's')
    else:                                       # the bare calamus, a tube
        w.px(int(round(cx + nx * 0.9)), int(round(cy + ny * 0.9)), 'P')
        w.px(int(round(cx)), int(round(cy)), 'p')
        w.px(int(round(cx - nx * 0.9)), int(round(cy - ny * 0.9)), 'S')

register(
    'lightFoot', label='LIGHT FOOT', hero='RANGER', kind='mechanic', cat='movement',
    why='a feather',
    ramps=('steel',),
    grid=w,
)
