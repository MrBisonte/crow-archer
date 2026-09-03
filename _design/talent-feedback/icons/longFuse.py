# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── LONG FUSE ───────────────────────────────────────────────────────────────
# The talent is REACH -- how far one bomb's blast finds the next -- so the
# drawing is a cast-iron bomb in the near corner and its cord burning at the
# far one, with the whole width of the socket in between. The distance is the
# subject; the bomb is only what one end of it is tied to.
#
# MORE LINKS already owns the chain, so nothing here may be a row of rings:
# the cord is one continuous stroke with the twist read as alternating strands,
# the way LONG THROW's fuse does it.
f = G()

CX, CY, R = 11.2, 20.2, 6.5     # the shell
LX, LY = 8.6, 17.4              # where the key light lands on it
COLLAR = ('XMPpX', 'XPpsX', 'XspsX')

iron = set()                    # every cell the bomb owns, so the cord defers

# The shell. Six steps out from the light -- specular, highlight, midtone,
# core shadow, deep -- and then the rim: the shaded three quarters take the
# dark edge, and the far arc takes one pixel of the ground bounced back into
# the iron. That pixel is the whole difference between a sphere and a disc.
for y in range(32):
    for x in range(32):
        d = math.hypot(x - CX, y - CY)
        if d > R:
            continue
        ch = pick(math.hypot(x - LX, y - LY), [0.9, 2.0, 3.7, 6.1, 8.7], 'MPpsSX')
        if d > R - 1.0:
            away = ((x - CX) + (y - CY)) / (d or 1.0)      # -1.41 near, +1.41 far
            ch = 'p' if away > 1.02 else ('X' if away > -0.35 else 'S')
        f.px(x, y, ch)
        iron.add((x, y))

# The collar the cord is packed into: a short steel neck, brightest on its
# upper left face, standing off the top of the shell.
for dy, band in enumerate(COLLAR):
    for dx, ch in enumerate(band):
        f.px(9 + dx, 11 + dy, ch)
        iron.add((9 + dx, 11 + dy))


def bez(t, p):
    """One point on the cubic Bezier over p, which is four (x, y) pairs."""
    u = 1.0 - t
    w = (u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t)
    return (sum(wi * pi[0] for wi, pi in zip(w, p)),
            sum(wi * pi[1] for wi, pi in zip(w, p)))


# The cord: up out of the collar, over the top of the socket and down the far
# side. A straight run would sit on MORE LINKS' own diagonal; an arc that hugs
# the bezel covers more ground and cannot be confused with it.
CURVE = ((11.0, 10.0), (11.5, 3.5), (23.0, 3.5), (24.0, 11.0))
spine = []
for i in range(241):
    cell = tuple(round(v) for v in bez(i / 240.0, CURVE))
    if not spine or spine[-1] != cell:
        spine.append(cell)

on = set(spine)
for i, (x, y) in enumerate(spine):
    # The shadow sits under a flat run and beside a steep one. Offsetting it
    # down AND right instead put it on the next cell of the spine wherever the
    # curve stepped diagonally, and the cord came out three pixels thick with
    # dark bites taken out of its top.
    ax, ay = spine[max(i - 1, 0)]
    bx, by = spine[min(i + 1, len(spine) - 1)]
    ox, oy = (0, 1) if abs(bx - ax) >= abs(by - ay) else (1, 0)
    if (x + ox, y + oy) not in on and (x + ox, y + oy) not in iron:
        f.px(x + ox, y + oy, 'L')
for i, (x, y) in enumerate(spine):
    # Two strands twisting: two cells lit, two cells two steps down. Single
    # alternating pixels read as a dotted line rather than as a rope, and two
    # neighbouring steps of the ramp do not read at all.
    f.px(x, y, 'E' if i % 4 < 2 else 'H')

# The burning end: a teardrop leaning off the cord, not LONG THROW's
# five-point star. It has to survive being scaled to 48 px, so it is a shape
# rather than the single lit pixel the first draft got away with at 224.
TX, TY = spine[-1]
for (dx, dy, ch) in ((0, 1, 'e'), (1, 1, 'e'),
                     (-1, 0, 'F'), (0, 0, 'Y'), (1, 0, 'F'), (2, 0, 'f'),
                     (0, -1, 'F'), (1, -1, 'Y'), (2, -1, 'F'),
                     (1, -2, 'f'), (2, -2, 'Y'),
                     (1, -3, 'f'), (2, -3, 'e')):
    f.px(TX + dx, TY + dy, ch)

register(
    'longFuse', label='LONG FUSE', hero='SAPPER', kind='indirect', cat='damage',
    why='a bomb, cord run long',
    ramps=('steel', 'leather', 'fire'),
    grid=f,
)
