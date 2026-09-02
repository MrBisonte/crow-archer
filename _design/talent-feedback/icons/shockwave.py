# -*- coding: utf-8 -*-
from iconkit import G, limb, pick, register

# ── SHOCKWAVE ───────────────────────────────────────────────────────────────
# A tamping maul. The talent is about the BLOW a combo blast lands -- what it
# does not kill it throws back -- and a maul is the one object in a sapper's
# kit that is nothing but a blow.
#
# The first drawing was the figure being thrown: a guard, arms out, hat flying.
# At 48 px a small figure with limbs at four angles is a lump, and it read as
# one; it also said the same thing as JUGGERNAUT, which already throws back
# what it hits. An object the hero HOLDS separates the two.
#
# Leather rather than wood for the head: `defence` tints the socket cool blue,
# so the object wants the warmest ramp with six steps in it, and the wood ramp
# bottoms out two steps darker than the ground it stands on.
m = G()

TOP, BOT = 8, 19
LEFT, RIGHT = 4, 25

# The head, a cylinder lit from above: one dark rim, specular, highlight,
# midtone, core shadow, and reflected light along the bottom edge.
for y in range(TOP, BOT + 1):
    f = (y - TOP) / float(BOT - TOP)
    ch = 'C' if y == TOP else 'h' if y == BOT else pick(f, [0.18, 0.42, 0.70, 0.90], 'ECHLL')
    inset = 1 if y in (TOP, BOT) else 0
    m.put(y, LEFT + inset, ch * (RIGHT - LEFT + 1 - 2 * inset))

# The end grain, one step darker so the far face turns away.
for y in range(TOP + 1, BOT):
    m.px(RIGHT, y, 'L')
    m.px(RIGHT - 1, y, 'h')

# Two steel bands, shaded on the same key so they belong to the same cylinder.
for x in (7, 8, 21, 22):
    for y in range(TOP, BOT + 1):
        f = (y - TOP) / float(BOT - TOP)
        m.px(x, y, 'P' if y == TOP else 's' if y == BOT
             else pick(f, [0.18, 0.42, 0.70, 0.90], 'MPpSS'))

# The haft, out of the head's underside and off the bottom-right corner.
limb(m, 14.5, 19, 21.0, 30, 5.0, 4.0, 'WwvU')

register(
    'shockwave', label='SHOCKWAVE', hero='SAPPER', kind='mechanic', cat='defence',
    why='a tamping maul',
    ramps=('leather', 'steel', 'wood'),
    grid=m,
)
