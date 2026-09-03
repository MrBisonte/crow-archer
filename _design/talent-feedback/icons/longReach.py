# -*- coding: utf-8 -*-
from iconkit import G, limb, register

# ── LONG REACH ──────────────────────────────────────────────────────────────
# A spear laid corner to corner. The talent buys twelve pixels of shaft, so the
# icon is about LENGTH and nothing else.
#
# It read as a fountain pen first, and the reason was proportion, not detail: a
# fat body with a small point on it is a pen whatever you shade it like. The
# shaft is three pixels wide now and runs the full diagonal, and the head is a
# ninth of it.
p = G()

# The shaft, butt at the low left, thinning a little as it goes.
limb(p, 4.0, 28.0, 21.0, 11.0, 3.4, 3.0, 'WwvU')

# The butt spike, so the low end is finished rather than cropped.
limb(p, 3.0, 29.5, 6.0, 26.5, 1.0, 3.0, 'MPpS')

# The socket collar and its langets: two straps down the shaft, which is what
# tells you the head is fitted rather than drawn on.
limb(p, 20.0, 12.0, 23.0, 9.0, 5.0, 5.0, 'MPpS')
limb(p, 18.5, 13.5, 21.0, 11.0, 1.6, 1.6, 'PpSS')

# The head: a narrow leaf with a ridge down it.
limb(p, 22.5, 9.5, 28.5, 3.5, 5.0, 0.8, 'MPpS')
limb(p, 23.0, 9.0, 28.0, 4.0, 1.4, 0.8, 'MMPp')

register(
    'longReach', label='LONG REACH', hero='KNIGHT', kind='direct', cat='damage',
    why='a spear, corner to corner',
    ramps=('steel', 'wood'),
    grid=p,
)
