# -*- coding: utf-8 -*-
from iconkit import G, ULT_N, pick, register

# ── THE LEAP ────────────────────────────────────────────────────────────────
# One sabaton, big, filling the plate: shaft, ankle, foot, heel and a sole with
# the arch cut out under it. Tall and steel against EARTHSHATTER's low warm
# slab -- the fork is the message, so the two are built of different materials
# running in different directions rather than one idea in two skins.
#
# Two drafts died before this one. Drawing the whole leg let the knee eat the
# pixels the foot needed and the thing read as a lightbulb; sweeping discs
# along a spine gave a smooth sausage and it read as a caterpillar. A boot's
# silhouette is the arch under the sole, the heel block behind it and the pinch
# at the ankle, and none of those survive a swept radius. The outline is a
# TABLE, drawn by hand.
#
# Steel is cool on the violet socket, so the read is bought back with gold at
# the two ends the eye lands on: the cuff rim and the toe cap.
l = G(ULT_N)

# y -> the spans painted on that row. Two spans where the arch cuts the sole.
BOOT = {
    8: ((14, 26),), 9: ((13, 27),), 10: ((13, 27),), 11: ((13, 27),),
    12: ((14, 27),), 13: ((14, 27),), 14: ((14, 26),), 15: ((14, 26),),
    16: ((15, 26),), 17: ((15, 26),), 18: ((15, 26),), 19: ((15, 26),),
    20: ((15, 26),), 21: ((16, 26),), 22: ((16, 25),), 23: ((16, 25),),
    24: ((16, 25),), 25: ((16, 25),),                      # the ankle pinch
    26: ((15, 26),), 27: ((15, 28),), 28: ((14, 30),), 29: ((14, 32),),
    30: ((13, 34),), 31: ((13, 35),), 32: ((13, 36),), 33: ((12, 37),),
    34: ((12, 37),), 35: ((12, 37),),
    36: ((12, 19), (26, 36)), 37: ((13, 19), (28, 35)),    # heel block, toe pad
}
SHAFT_BOT = 26                       # below this the boot is a foot, not a tube
STEEL = 'XMPpSs'                     # dark edge, specular, highlight, mid, shadow, bounce
BODY = 'MPpSX'
GOLD = 'GGgkK'
TOE = 32                             # the toe cap starts here
LAME = 5                             # one plate every five columns


def column(x):
    """Top and bottom row of the foot in column x, over all its spans."""
    ys = [y for y, spans in BOOT.items()
          if y > SHAFT_BOT and any(a <= x <= b for a, b in spans)]
    return (min(ys), max(ys)) if ys else None


# The shaft is a tube, and its own row rather than cyl_row's: the shared one
# spends a fifth of the width on the specular, which at thirteen pixels is
# three columns of pure white and reads as a chalk pillar. The specular here is
# TWO PIXELS, and everything either side of it is a step of the ramp.
def tube(f):
    """Across the shaft: dark edge, up to a narrow specular, down, then bounce."""
    return pick(f, [0.07, 0.16, 0.27, 0.45, 0.66, 0.87], 'XPMPpSs')


for y in range(8, SHAFT_BOT + 1):
    (x0, x1), = BOOT[y]
    for x in range(x0, x1 + 1):
        ch = tube((x - x0) / float(x1 - x0))
        # One plate joint down the shaft: the plate above laps over the one
        # below, so a shadow line and then its lit leading edge.
        if ch in BODY and y in (17, 18):
            i = BODY.index(ch) + (1 if y == 17 else -1)
            ch = BODY[max(0, min(len(BODY) - 1, i))]
        l.px(x, y, ch)

# The foot is plate, not tube: shade it DOWN the column, then lay the lames
# across it. A sabaton's lames run across the foot, so they are vertical bands
# here, and the seam between two of them is where the light stops.
for x in range(12, 38):
    span = column(x)
    if not span:
        continue
    top, bot = span
    height = max(1, bot - top)
    for y in range(top, bot + 1):
        if not any(a <= x <= b for a, b in BOOT.get(y, ())):
            continue
        t = (y - top) / float(height)
        if t < 0.09 or t > 0.94:
            ch = 'X'                                  # the silhouette, top and sole
        else:
            i = BODY.index(pick((t - 0.09) / 0.85, [0.18, 0.40, 0.66, 0.87], BODY))
            b = (x - 13) % LAME
            if b == LAME - 1:
                i = min(len(BODY) - 1, i + 1)         # where the next plate laps under
            elif b == 0:
                i = max(0, i - 1)                     # its lit leading edge
            ch = (GOLD if x >= TOE else BODY)[i]
        if y >= bot - 1:
            ch = 'X' if y == bot else 'S'     # the sole, the heavy edge
        l.px(x, y, ch)

# One pixel of reflected light on the far edge of the foot -- the step that
# stops the whole boot reading as a flat grey stripe.
for y in range(28, 36):
    (a, b), = BOOT[y]
    l.px(b, y, 'g' if b >= TOE else 's')

# The cuff is an opening, not a cap: gold rim, dark hollow, so the boot reads
# as a piece of armour a leg goes into.
for x in range(13, 28):
    l.px(x, 8, 'G' if x < 20 else 'g')
    l.px(x, 9, 'g' if x < 20 else 'k')
    l.px(x, 10, 'k' if x < 22 else 'K')
for x in range(17, 24):
    l.px(x, 8, 'K')

# The seam where the shaft ends and the foot begins. Without it the two shading
# schemes run into each other and the boot reads as one moulded lump.
for x in range(15, 27):
    if l.g[26][x] != '.':
        l.px(x, 26, 'X')

# The strap. It was two gold rivets for one draft, and two dots either side of
# a dark seam is a FACE -- the shaft grew eyes and a mouth at 48 px. A band
# reads as the same fitting and cannot be looked back at.
for x in range(15, 27):
    if l.g[21][x] != '.':
        l.px(x, 21, 'G' if x < 20 else 'g')
    if l.g[22][x] != '.':
        l.px(x, 22, 'k' if x < 23 else 'K')

register(
    'theLeap', label='THE LEAP', hero='knight', kind='direct', cat='ultimate',
    why='one sabaton, coming down toe first',
    ramps=('steel', 'gold'),
    grid=l,
)
