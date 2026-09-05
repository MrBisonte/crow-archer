# -*- coding: utf-8 -*-
import math

from iconkit import G, ULT_N, cyl_row, pick, register

# ── THE BIG ONE ─────────────────────────────────────────────────────────────
# One charge, filling the plate wall to wall and running off the bottom of it,
# with a cord long enough to fill the corner it does not reach. CARPET BOMB is
# many small bodies strung along a line; this is ONE mass, and the whole read
# is that it is too big for the socket it sits in.
#
# Two drafts died before this one and both died the same death: a TEAPOT. The
# first cropped the shell on three sides, which leaves a dome and not a
# sphere -- a mound with a lid. The second put the cord's return over the
# right shoulder, which is a handle. The shell is a whole sphere now, the
# spout is short and squat and sits on the crown, and the cord ends in FIRE
# clear of the body, which no handle does.
#
# The case is LEATHER rather than steel. The ultimate ground is deep violet
# and steel is the one cool ramp in the set, so a steel shell this large would
# be cool on cool over half the plate. The steel is the spout and nothing else.
#
# It is BOLTED, and that is not decoration. SHORT FUSE is already a tan ball
# with a steel collar and fire at the top of it, and side by side at 48 px the
# smooth version of this was the same object drawn larger. A hoop and a
# meridian rib, both riveted, are what say this one was built in plates in a
# yard rather than packed by hand -- construction is the difference, because
# scale alone is not one when each icon has its own plate to be big in.
b = G(ULT_N)

CX, CY, R = 25.0, 29.5, 13.8
LX, LY, LZ = -0.46, -0.60, 0.66
# The shell's ramp is leather at the lit end and ROPE at the dark one. All six
# steps in leather is a bread roll: that ramp is ochre from cream to near-black
# and a sphere painted in it has one hue and therefore one material, whatever
# the values do. Warm highlight into cold shadow is how painted iron looks, and
# it is the only change between this and the draft that read as a bun.
#
# The stops are the value split measured over the cells the socket actually
# shows, not guessed: specular 5, highlight 12, midtone 20, core 22, shadow 21,
# deep 20 per cent. Guessed evenly, a body this size sits two thirds at the
# pale end and reads as a clay pot -- which is what the first draft was.
SHELL = 'ECHhLno'
STEPS = [-0.989, -0.948, -0.866, -0.720, -0.455, -0.143]
DARKER = {'E': 'C', 'C': 'H', 'H': 'h', 'h': 'L', 'L': 'n', 'n': 'o', 'o': 'o'}
BAND_Y, BAND_BOW, BAND_TILT = 26.0, 2.6, -3.6

for y in range(int(CY - R) - 1, ULT_N):
    for x in range(ULT_N):
        dx, dy = (x - CX) / R, (y - CY) / R
        d2 = dx * dx + dy * dy
        if d2 > 1.0:
            continue
        ch = pick(-(dx * LX + dy * LY + math.sqrt(1.0 - d2) * LZ), STEPS, SHELL)
        if d2 > 0.93:
            # The limb: one step down all the way round, except the far side,
            # which takes the pixel of ground bounced back into the iron. That
            # pixel is the difference between a sphere and a disc.
            ch = 'h' if dx + dy > 1.05 else DARKER[ch]
        b.px(x, y, ch)


def band_y(x):
    """Where the cast band crosses column x. It BOWS, because a straight band
    across a sphere is a stripe painted on; and it TILTS, because a level one
    is a horizon -- it cut the shell into a lit top and a dark bottom and the
    draft that had it read as a bread roll on a plate. Tilted, the same three
    rows read as a hoop round a body."""
    t = (x - CX) / R
    return BAND_Y + BAND_BOW * math.sqrt(max(0.0, 1.0 - t * t)) + BAND_TILT * t


# The band and its rivets are drawn SMALL against the shell. Fine detail on a
# big form is most of what says the form is big; four fat rivets would have
# made the same sphere read as a marble.
for x in range(10, 40):
    top = int(round(band_y(x)))
    for i, ch in enumerate('KgK'):
        dx, dy = (x - CX) / R, (top + i - CY) / R
        if dx * dx + dy * dy <= 1.0:
            b.px(x, top + i, ch)
for rx in range(13, 39, 5):
    ry = int(round(band_y(rx))) + 1
    if ((rx - CX) / R) ** 2 + ((ry - CY) / R) ** 2 <= 0.96:
        b.px(rx, ry, 'G')

# The meridian rib. A seam down the FRONT of a sphere projects as a straight
# line and reads as a stripe painted on, so this one is set a third of the way
# round: its offset from the centre line is R * sin(longitude), narrowing to
# nothing at both poles, which is what lays it ON the surface. It is one step
# of tone, not a second gold strap -- drawn in gold to match the hoop it
# crosses, the shell read as a wrapped parcel.
LIGHTER = {v: k for k, v in DARKER.items() if k != v}
for y in range(int(CY - R), int(CY + R) + 1):
    e = math.sqrt(max(0.0, 1.0 - ((y - CY) / R) ** 2))
    if e < 0.14:
        continue
    rx = int(round(CX - 0.34 * R * e))
    here = b.g[y][rx]
    if here in LIGHTER:
        b.px(rx, y, LIGHTER[here])
        b.px(rx + 1, y, DARKER[here])
for ry in range(int(CY - R) + 4, int(CY + R) - 2, 5):
    e = math.sqrt(max(0.0, 1.0 - ((ry - CY) / R) ** 2))
    if e > 0.30:
        b.px(int(round(CX - 0.34 * R * e)), ry, 'g')

# The spout. A sphere with no spout is a BELL; a wide one with a flat top is a
# lid. Short, squat, and set left of the crown so nothing about the object is
# symmetric about its own centre line.
for i, y in enumerate(range(13, 17)):
    b.put(y, 20, cyl_row(7, ('X', 'M', 'P', 'p', 's', 'S')))
b.put(12, 19, cyl_row(9, ('X', 'P', 'p', 's', 'S', 'X')))
b.put(12, 22, 'XXX')                       # the mouth, looking down into it

# The fuse. The length IS the talent, so it has to be SEEN to be long rather
# than said to be: up out of the mouth, the whole width of the corner the
# shell does not fill, down the far side and back on itself to burn in clear
# air. Hemp, not rope-grey -- grey cord on violet is one dark on another.
CURVE = (((22.0, 11.0), (17.0, 5.5), (9.5, 7.0), (8.0, 13.0)),
         ((8.0, 13.0), (6.8, 19.5), (13.5, 20.5), (13.0, 14.0)))


def bez(t, p):
    """One point on the cubic Bezier over p, which is four (x, y) pairs."""
    u = 1.0 - t
    w = (u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t)
    return (sum(wi * pi[0] for wi, pi in zip(w, p)),
            sum(wi * pi[1] for wi, pi in zip(w, p)))


spine = []
for seg in CURVE:
    for i in range(161):
        cell = tuple(int(round(v)) for v in bez(i / 160.0, seg))
        if not spine or spine[-1] != cell:
            spine.append(cell)

on = set(spine)
for i, (x, y) in enumerate(spine):
    ax, ay = spine[max(i - 1, 0)]
    bx, by = spine[min(i + 1, len(spine) - 1)]
    ox, oy = (0, 1) if abs(bx - ax) >= abs(by - ay) else (1, 0)
    if (x + ox, y + oy) not in on:
        b.px(x + ox, y + oy, 'o')          # the cord's own shadow, under it
for i, (x, y) in enumerate(spine):
    b.px(x, y, 'E' if i % 4 < 2 else 'H')  # two strands, twisting

# The spark, in clear air at the far end of all that cord.
TX, TY = spine[-1]
for (dx, dy, ch) in ((0, 1, 'e'), (1, 1, 'f'),
                     (-1, 0, 'f'), (0, 0, 'Y'), (1, 0, 'F'),
                     (-1, -1, 'F'), (0, -1, 'Y'), (1, -1, 'Y'), (2, -1, 'f'),
                     (-1, -2, 'f'), (0, -2, 'F'), (1, -2, 'Y'), (2, -2, 'F'),
                     (0, -3, 'f'), (1, -3, 'F'), (2, -3, 'e'),
                     (1, -4, 'f')):
    b.px(TX + dx, TY + dy, ch)

register(
    'theBigOne', label='THE BIG ONE', hero='sapper', kind='direct',
    cat='ultimate',
    why='one shell too big for its plate, cord still burning',
    ramps=('leather', 'steel', 'gold', 'rope', 'fire'),
    grid=b,
)
