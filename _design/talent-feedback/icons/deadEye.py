# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── DEAD EYE ────────────────────────────────────────────────────────────────
# A straw butt, painted. SPLIT SHAFT is the arrow and FULL DRAW is the bow, so
# the rite that pays for the perfect shot is what the shot is aimed AT -- the
# three read as one line without any of them drawing the same thing twice.
#
# A butt is a coiled rope of straw, so it is a solid roundel and not a painted
# disc: the face sits a pixel up and left of the body, and the crescent that
# leaves along the lower right is its thickness.
#
# Two things sank the first drafts. A hard dome with a gold centre four pixels
# across is a shield boss -- the drawing TOWER GUARD already is -- so the face
# is nearly FLAT. And a thin painted ring cut by the coil grain came apart into
# a bronze donut, so the paint is a SOLID red roundel with a gold pip, and the
# coil is left to the straw margin round it where it says straw instead of
# eating the paint.
e = G()

FACE = (15.4, 15.1)
BODY = (16.5, 16.3)
R, RB = 9.8, 9.9
# The key sits out on the straw, not under the paint. Held over the middle it
# spent the specular on the red roundel and left the whole straw margin one
# flat brown, which is the ring that has to say what the butt is made of.
KEY = (10.0, 9.4)

GOLD, RED = 2.2, 6.2                          # the paint, in pixels


def face_tone(x, y):
    """Six steps across a nearly flat face: the falloff is wide on purpose, so
    the disc turns at its rim rather than bulging like a hemisphere."""
    d = math.hypot((x - KEY[0]) / 15.0, (y - KEY[1]) / 15.5)
    return pick(d, [0.20, 0.38, 0.58, 0.80, 0.98], 'ECHhLB'), d


for y in range(4, 28):
    for x in range(4, 28):
        rf = math.hypot(x - FACE[0], y - FACE[1])
        if rf > R:
            # The body behind the face: the coil seen edge on. The coil ends
            # are what keep that crescent from reading as a drop shadow.
            if math.hypot(x - BODY[0], y - BODY[1]) <= RB:
                e.px(x, y, 'B' if (x + y) % 3 else 'L')
            continue
        ch, d = face_tone(x, y)
        if rf > R - 1.0:
            # The rim. On the far side it takes the bounce off the ground --
            # that one pixel is what stops the disc reading as a sticker.
            ch = 'h' if (x - FACE[0]) + (y - FACE[1]) > 5.0 else 'L'
        elif rf <= GOLD:
            # Flat, because it is PAINT. Domed it became a boss sitting on the
            # butt, and a dark ring drawn round it turned the pip into a hole.
            ch = pick(d, [0.26, 0.48, 0.70], 'GGgk')
        elif rf <= RED:
            ch = pick(d, [0.22, 0.44, 0.66], 'RRrq')
        elif rf <= RED + 0.8:
            ch = 'B'                           # paint has an edge; straw does not
        elif int(rf - RED) % 2 == 0 and d > 0.52 and ch in 'ECHhL':
            # The coil, one step of tone every other turn, and only where the
            # face has begun to turn away. Run across the lit side too and the
            # rings read as the object rather than as its surface.
            ch = 'CHhLB'['ECHhL'.index(ch)]
        e.px(x, y, ch)

register(
    'deadEye', label='DEAD EYE', hero='ARCHER', kind='mechanic', cat='speed',
    why='a straw butt, red and gold',
    ramps=('leather', 'cloth', 'gold'),
    grid=e,
)
