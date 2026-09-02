# -*- coding: utf-8 -*-
"""The kit every icon draws with, and the registry it lands in.

Split out of draw-icons.py when the set went from ten icons to forty. One icon
is one file under `icons/`, so adding one touches nothing shared -- the old
shape had a META table that every new icon had to write a row into, which is a
merge conflict per icon and a silent mismatch when a row and a grid disagree.
An icon now declares what it IS beside the code that draws it.
"""
import math

N = 32

# The ramps, richer than the sprite ramps because these are read on dark brass.
# Real data here rather than text inside the JS header, so that a Python check
# can ask whether a character an icon used actually exists.
RAMPS = {
    'leather': {'E': '#F2CE8A', 'C': '#D6A65C', 'H': '#AE7F3E', 'h': '#85602C', 'L': '#5A421D', 'B': '#33260F'},
    'steel': {'M': '#FFFFFF', 'P': '#D8E4F0', 'p': '#A8BACE', 's': '#6E8296', 'S': '#45566A', 'X': '#2A3646'},
    'wood': {'W': '#B08A50', 'w': '#85622F', 'v': '#5A3F1D', 'u': '#33230E', 'U': '#221709'},
    'cloth': {'R': '#E05A3C', 'r': '#B0301C', 'q': '#711C0A', 'Q': '#3E0B04'},
    'fire': {'Y': '#FFF8D8', 'F': '#FFD24A', 'f': '#FF8A20', 'e': '#C43510'},
    'gold': {'G': '#FFEFC0', 'g': '#E8B63A', 'k': '#A87A18', 'K': '#6E4A08'},
    'rope': {'N': '#7A7A6E', 'n': '#3E3E36', 'o': '#16160F'},
}

# The five sockets compose.mjs can tint. An unknown one there falls back to the
# golden `movement` ground WITHOUT complaining, which is a wrong-looking icon
# and no error, so it is checked at registration instead.
CATS = ('movement', 'defence', 'damage', 'speed', 'healing')

# What the talent does to the sim. Carried through to the artboard.
KINDS = ('direct', 'indirect', 'mechanic')


class G:
    def __init__(self):
        self.g = [['.'] * N for _ in range(N)]

    def put(self, y, x, s):
        """Places a row segment. ' ' leaves a cell alone, '.' erases it."""
        for i, ch in enumerate(s):
            if ch != ' ' and 0 <= x + i < N and 0 <= y < N:
                self.g[y][x + i] = ch

    def px(self, x, y, ch):
        if 0 <= x < N and 0 <= y < N:
            self.g[y][x] = ch

    def rows(self):
        return [''.join(r) for r in self.g]


def pick(v, stops, chars):
    """Quantises a lighting value onto a ramp. Last char is the far end."""
    for s, c in zip(stops, chars):
        if v < s:
            return c
    return chars[-1]


def cyl_row(w, chars):
    """One row across a cylinder, in the six steps every surface here runs.

    `chars` is (dark edge, specular, highlight, midtone, core shadow, reflected
    light). The last one is the pixel on the FAR edge that stops a shape reading
    as a stripe, and it is the step a hand-written row keeps forgetting -- five
    icons wanted this loop, so it lives here rather than in five modules.
    """
    if w <= 0:
        return ''
    if w <= 2:
        return chars[2] * w
    body = [pick(i / float(w - 1), [0.20, 0.48, 0.78], chars[1:5]) for i in range(w)]
    return chars[0] + ''.join(body[1:-1]) + chars[5]


def limb(g, x0, y0, x1, y1, w0, w1, ramp):
    """A tapering wedge. Used for roots and anything else that thins as it goes."""
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    for i in range(n):
        t = i / float(n - 1)
        cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        half = (w0 + (w1 - w0) * t) / 2.0
        k = -half
        while k <= half:
            g.px(int(round(cx + k)), int(round(cy)),
                 pick((k + half) / max(half, 0.01) * 2.0, [1.1, 2.2, 3.4], ramp))
            k += 1


ICONS = []


def register(icon_id, label, hero, kind, cat, why, ramps, grid):
    """Records one finished icon, refusing the mistakes that fail silently."""
    assert cat in CATS, '%s: cat %r is not one of %s' % (icon_id, cat, CATS)
    assert kind in KINDS, '%s: kind %r is not one of %s' % (icon_id, kind)
    legend = {}
    for name in ramps:
        assert name in RAMPS, '%s: no ramp called %r' % (icon_id, name)
        legend.update(RAMPS[name])
    rows = grid.rows()
    for i, row in enumerate(rows):
        assert len(row) == N, '%s row %d is %d wide' % (icon_id, i, len(row))
    # The one that cost an afternoon: TOWER GUARD's face was drawn in leather
    # against a steel-and-gold legend, so every E C H h L painted NOTHING and
    # what showed was the rim filling the silhouette. No error anywhere.
    used = {ch for row in rows for ch in row if ch != '.'}
    missing = sorted(used - set(legend))
    assert not missing, ('%s uses %s with no ramp for it -- those pixels would '
                         'paint nothing. Its ramps are %s.'
                         % (icon_id, missing, list(ramps)))
    ICONS.append({'id': icon_id, 'label': label, 'hero': hero, 'kind': kind,
                  'cat': cat, 'why': why, 'ramps': list(ramps), 'rows': rows})
