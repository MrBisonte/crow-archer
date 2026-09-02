# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── FOURTH BLOOD ────────────────────────────────────────────────────────────
# A stoppered phial banded four times, standing full to the third. The talent
# adds a fourth Bloodlust stack to a knight who fills three, so the object is a
# measure: three bands under the blood, and the fourth one waiting above it in
# GOLD -- the same way THIRD STEP says "this is the one you just bought"
# without printing a number on the icon.
#
# The socket is the red `damage` ground and the phial is most of it, so the
# blood is broken up rather than laid on: a cold rim down the near side, a cold
# pixel of bounce down the far one, four bands across it, and a quarter of
# empty glass over the surface. Red on red with nothing between is the
# brown-on-brown failure this set has already paid for once.
f = G()

CENTRE = 15.5
CORK, NECK, SHOULDER = 4, 7, 10       # the stopper, the neck, where the body flares
BODY, FOOT = 12, 24                   # the straight body, and where it rounds off
BODY_HALF = 5.9
BANDS = (14, 17, 20, 23)              # the fourth, then the three under the blood
LEVEL = BANDS[1]                      # blood stands at the third band


def phial_span(y):
    """Left and right column of the phial at row y: stopper, neck, body, foot."""
    if y < CORK or y > FOOT + 3:
        return None
    if y < NECK:
        half = 2.6
    elif y < SHOULDER:
        half = 1.8
    elif y < BODY:
        half = 1.8 + (y - SHOULDER + 1) * (BODY_HALF - 1.8) / (BODY - SHOULDER + 1)
    elif y <= FOOT:
        half = BODY_HALF
    else:
        half = BODY_HALF * (1.0 - ((y - FOOT) / 3.4) ** 2) ** 0.5
    if half < 0.5:
        return None
    return int(round(CENTRE - half)), int(round(CENTRE + half))


def cylinder(x, span, drop):
    """Where one column sits round a turning surface, lit from the upper left."""
    u = (x - (span[0] + span[1]) / 2.0) / max((span[1] - span[0]) / 2.0, 0.6)
    return 0.48 + 0.42 * u + 0.20 * u * u + drop


for y in range(CORK, FOOT + 4):
    span = phial_span(y)
    if not span:
        continue
    x0, x1 = span
    for x in range(x0, x1 + 1):
        if y < SHOULDER:                          # stopper and neck, solid steel
            f.px(x, y, pick(cylinder(x, span, 0.0), [0.16, 0.40, 0.66, 0.88], 'MPpsS'))
        elif y < LEVEL:                           # glass with nothing in it yet
            # Dark, and cooler than the steel over it. Empty glass painted at
            # the same value as the stopper reads as a metal canteen with a red
            # foot; what says EMPTY is that you can nearly see through it.
            f.px(x, y, pick(cylinder(x, span, 0.42), [0.44, 0.72, 0.98], 'psSX'))
        else:                                     # blood, standing to the third band
            drop = 0.10 * (y - LEVEL) / float(FOOT - LEVEL)
            f.px(x, y, pick(cylinder(x, span, drop), [0.38, 0.66, 0.94], 'RrqQ'))
    f.px(x0, y, 'S')                              # a cold rim down the near side
    f.px(x1 - 1, y, 'X' if y >= LEVEL else 'S')
    f.px(x1, y, 'p')                              # and the bounce down the far one

for x in range(13, 19):                           # the stopper's crown, into the light
    f.px(x, CORK, 'S' if x in (13, 18) else ('M' if x < 15 else 'P'))
for x in range(14, 18):                           # where it plugs into the neck
    f.px(x, NECK - 1, 'X' if x > 15 else 'S')

x0, x1 = phial_span(LEVEL)
for x in range(x0 + 1, x1):                       # the surface, catching the light
    f.px(x, LEVEL, 'R' if x < 18 else 'r')
f.px(x0 + 1, LEVEL, 'P')
for y in range(BODY + 1, LEVEL):                  # the specular streak down the glass
    f.px(x0 + 2, y, 'M' if y < LEVEL - 3 else 'P')
    f.px(x0 + 3, y, 'p' if y < LEVEL - 3 else 's')

# The marks. Four ticks up the near side, each standing one pixel proud of the
# glass so the silhouette itself counts them. Hoops run the whole way round and
# the phial came out a striped canister: what a measure has is marks on one
# side and one body of liquid behind them, not four bands of colour.
#
# The fourth is gold and it is the only one above the blood -- the same way
# THIRD STEP says "this is the one you just bought" without printing a number.
# What the talent buys is the room, not the blood that will fill it.
for i, mark in enumerate(BANDS):
    span = phial_span(mark)
    ramp = 'GgkK' if i == 0 else 'PpsS'
    for x in range(span[0] - 1, span[0] + 3):
        f.px(x, mark, ramp[min(3, x - span[0] + 1)])
    f.px(span[1] - 1, mark, ramp[2])              # the far end of the same tick
    f.px(span[1], mark, ramp[1])                  # catching the bounce off the glass

register(
    'fourthBlood', label='FOURTH BLOOD', hero='KNIGHT', kind='direct', cat='damage',
    why='a phial, banded four, filled three',
    ramps=('steel', 'cloth', 'gold'),
    grid=f,
)
