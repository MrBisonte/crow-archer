# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── WIDE NET ────────────────────────────────────────────────────────────────
# A spread of net, knotted at every crossing, its cord ends loose and three
# leads hanging off the hem. Wider than it is deep, which is the one word the
# talent says. MORE LINKS draws five links rather than a chain; this draws a
# spread of mesh rather than a net, for the same reason.
#
# Five drafts, and only one of them was ever about the mesh:
#  * a shape narrow at the top and wide at the foot, filled with texture, is a
#    MOUND -- draft one was a circus tent, straight flanks and evenly spaced
#    leads along the hem for a valance;
#  * halving the mesh to fix that fused the cords into a heap of gravel. Fine
#    mesh cannot survive 32 px: the holes have to win, which means few cords,
#    thin cords and fat holes, the way MORE LINKS wins its holes;
#  * then three drafts of the same mistake wearing different hats. A ROPE RUN
#    ROUND THE MESH IS A CONTAINER. With a cord over the top it was a basket
#    with a handle; with the hem straightened and the cord moved to the corner
#    it was a cart on wheels; slung between two ends, with a head-line above
#    and a hem-rope below, it was a purse. Nothing about the border was ever
#    fixable, because a border is what a container has. The mesh had to be the
#    whole object and its own edge -- cord ends, not a rim.
#
# SP and CORD are PIXEL COUNTS, decided once and held. Set either as a fraction
# of the spread and the cord thickens as the net widens, which is this unit's
# rule and the one MORE LINKS died on four times.
#
# Warm hemp on the blue `defence` ground. The leads are the one cool thing in
# it and they carry the specular; their beckets are the only rope, because rope
# anywhere else on this icon has already cost five drafts.
net = G()

SP = 5.8                 # px between one cord and the next
CORD = 1.4               # px across a cord: under 1.3 the 45-degree runs break
KNOT = 2.3               # px across a knot
SAG = 2.4                # px the cords hang below straight, at mid-span
OVER = 1.09              # how far past the edge the cut ends run
ROOT2 = math.sqrt(2.0)

CX, CY = 16.0, 15.0      # the spread's centre
A, B = 11.4, 8.6         # and its two half-axes: wide, and not tall
TILT = math.radians(-8.0)   # a spread square to the frame is a swatch pinned
                             # to a board; tilted, it is in the air
RAMP = 'ECHhLB'          # specular is RAMP[0], the dark edge RAMP[5]


def rim(th):
    """The spread's radius at angle th, as a multiple of the axes.

    Cord does not hold a true curve, so the edge wanders a few per cent. It is
    a weak cue on its own -- what keeps this off an ellipse is that there is no
    rope on the edge to draw one.
    """
    return 1.0 + 0.085 * math.cos(3.0 * th - 1.2) + 0.05 * math.cos(5.0 * th + 0.4)


def radius(x, y):
    """How far out (x, y) is, as a fraction of the edge. 1.0 is the edge."""
    px, py = x - CX, y - CY
    dx = (px * math.cos(TILT) + py * math.sin(TILT)) / A
    dy = (py * math.cos(TILT) - px * math.sin(TILT)) / B
    return math.hypot(dx, dy) / rim(math.atan2(dy, dx))


def sag_at(x):
    """How far the cords hang at column x. Zero at the edge, SAG at mid-span."""
    t = (x - CX) / A
    return SAG * max(0.0, 1.0 - t * t)


def across(w):
    """Signed distance from w to the nearest cord centreline, in pixels."""
    r = w % SP
    return r - SP if r > SP / 2.0 else r


def lit(x, y):
    """Which step of RAMP the spread sits on here, before the cord's own round."""
    d = math.hypot((x - 10.2) / 10.6, (y - 10.4) / 11.8)
    return pick(d, [0.44, 0.70, 0.96, 1.22], (0, 1, 2, 3, 4))


for y in range(4, 28):
    for x in range(4, 28):
        r = radius(x, y)
        if r > OVER:
            continue
        v = y - sag_at(x)                     # the cords hang; a grille does not
        ka = across((x + v) / ROOT2)          # cords running down-LEFT
        kb = across((x - v) / ROOT2)          # cords running down-RIGHT
        on_a, on_b = abs(ka) <= CORD / 2.0, abs(kb) <= CORD / 2.0
        if not (on_a or on_b):
            continue
        if r > 1.0:
            # Past the edge the cords go on alone, thin and dark: these are the
            # cut ends, and they are what makes the boundary read as cord
            # rather than as something the mesh was stamped out of.
            net.px(x, y, RAMP[min(5, lit(x, y) + 2)])
            continue
        i = lit(x, y)
        if abs(ka) <= KNOT / 2.0 and abs(kb) <= KNOT / 2.0:
            # The knot is the whole difference between a net and a lattice, so
            # it is drawn fatter than the cord and one step into the light.
            i -= 1
        elif on_a:
            # A down-left cord lies across the key light, so it rounds the way
            # any cylinder does: lit rim, core, dark rim.
            i += 1 if ka > 0.24 else (-1 if ka < -0.24 else 0)
        elif on_b:
            # A down-right cord lies ALONG the light, so it is brightest down
            # its middle and falls to both edges. Shade the two families alike
            # and the mesh stops reading as cords and starts reading as cloth.
            i += 1 if abs(kb) > 0.45 else (-1 if abs(kb) < 0.17 else 0)
        else:
            continue
        # The dark end is kept for the cut ends: run the mesh itself into
        # it and the whole lower right falls off the socket.
        net.px(x, y, RAMP[max(0, min(4, i))])

# Three leads, hung off the hem on their own beckets and unevenly spaced. Under
# a straight hem, evenly spaced, these were a cart's wheels twice. Three pixels
# wide rather than two: at two they were lost in the mesh at 48 px.
LEAD_FLOOR = 25              # the last row a lead can start on and stay in
for lx, drop, top in ((9, 2, 'P'), (15, 2, 'M'), (21, 2, 'P')):
    hem = [y for y in range(4, 28) if net.g[y][lx] in RAMP]
    if not hem:
        continue
    ly = min(max(hem) + drop, LEAD_FLOOR)
    if ly <= max(hem):
        continue
    for k in range(max(hem) + 1, ly):
        net.px(lx, k, 'n')                    # the becket it hangs on
    net.put(ly, lx - 1, top + 'Pp')           # M at mid-span is the one specular
    net.put(ly + 1, lx - 1, 'ssX')

# One pixel of bounce down the far side. Without it the right-hand cords go
# black against the socket and the spread reads as a flat cut-out.
for y in range(4, 28):
    xs = [x for x in range(4, 28) if net.g[y][x] in RAMP]
    if xs and max(xs) > CX and RAMP.index(net.g[y][max(xs)]) >= 3:
        net.px(max(xs), y, RAMP[RAMP.index(net.g[y][max(xs)]) - 1])

# A cut end clipped to a pixel or two off the edge of the mesh is a speck, and
# a speck floats. Sweeping them is cheaper than fitting the mesh to the rim,
# and a lone-pixel test is not enough -- the pair at the top right survived it.
seen = set()
for sy in range(32):
    for sx in range(32):
        if net.g[sy][sx] == '.' or (sx, sy) in seen:
            continue
        blob, stack = [], [(sx, sy)]
        seen.add((sx, sy))
        while stack:
            x, y = stack.pop()
            blob.append((x, y))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if (0 <= nx < 32 and 0 <= ny < 32 and (nx, ny) not in seen
                        and net.g[ny][nx] != '.'):
                    seen.add((nx, ny))
                    stack.append((nx, ny))
        if len(blob) < 3:
            for x, y in blob:
                net.px(x, y, '.')

register(
    'wideNet', label='WIDE NET', hero='RANGER', kind='mechanic', cat='defence',
    why='a spread of net, knotted',
    ramps=('leather', 'rope', 'steel'),
    grid=net,
)
