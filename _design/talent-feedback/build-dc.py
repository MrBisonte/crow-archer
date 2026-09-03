# -*- coding: utf-8 -*-
"""Writes the Sigils artboard with the rendered icons inlined.

Run `node render-svg.mjs` first -- that is what turns icons32.js into SVG
through the same compositor the browser preview uses, so the artboard and the
preview cannot drift.
"""
import io
import json
import os
import re

DATA = json.load(io.open('icons32.rendered.json', encoding='utf-8'))
R, SW = DATA['icons'], DATA['swatches']

HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; background: #000; font-family: "Courier New", ui-monospace, monospace; }
    a { color: #8ED1FF; } a:hover { color: #cfe9ff; }
    .cap { font-size: 11px; letter-spacing: 0.16em; color: #6f8a6c; text-transform: uppercase; }
    .note { font-size: 12px; color: #93a08f; line-height: 1.6; max-width: 74ch; }
    .h1 { font-size: 22px; color: #39FF14; letter-spacing: 0.12em; text-shadow: 0 0 8px #39FF14; }
%s  </style>
</helmet>
"""

TAIL = "</x-dc>\n</body>\n</html>\n"

# The line art that ships today, read from the game rather than copied here.
# The old shape was a dict with one entry per icon, so a new icon raised a
# KeyError in a file that has nothing to do with drawing it -- and its entries
# had already drifted from what the game actually paints.
SIGILS = io.open(
    os.path.join('..', '..', 'src', 'render', 'talent-sigils.ts'), encoding='utf-8').read()


def vector_for(icon_id):
    """The sigil the game paints today, as SVG markup, or '' if there is none."""
    at = SIGILS.find("\n  %s: [" % icon_id)
    if at < 0:
        return ''
    open_at = SIGILS.index('[', at)
    depth, end = 0, open_at
    for i in range(open_at, len(SIGILS)):
        if SIGILS[i] == '[':
            depth += 1
        elif SIGILS[i] == ']':
            depth -= 1
            if depth == 0:
                end = i
                break
    out = []
    for line in SIGILS[open_at:end].split('\n'):
        line = line.strip()
        if not line.startswith('{'):
            continue
        d = re.search(r"d: '([^']*)'", line)
        if not d:
            continue
        attrs = ''
        if 'fill: true' in line:
            attrs += ' fill="#4f5750" stroke="none"'
        if 'dash: true' in line:
            attrs += ' stroke-dasharray="2.4 2"'
        alpha = re.search(r'alpha: ([0-9.]+)', line)
        if alpha:
            attrs += ' opacity="%s"' % alpha.group(1)
        out.append('<path d="%s"%s/>' % (d.group(1), attrs))
    return ''.join(out)


# Whatever has been drawn, in the game's own tree order -- render-svg.mjs wrote
# them in that order and json preserves it.
ORDER = list(R.keys())

cells = []
for k in ORDER:
    i = R[k]
    cells.append(
      '<div class="cell">'
      '<div class="hero">%s</div>'
      '<div class="box"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" '
      'stroke="#4f5750" stroke-width="1.5">%s</svg></div>'
      '<div class="arrow">v</div>'
      '<div class="box hot">%s</div>'
      '<div class="nm">%s</div><div class="why">%s</div>'
      '</div>' % (i['hero'], vector_for(k), i['sheen64'], i['name'], i['why']))

STEPS = [
  ('BEZEL', 'Four rings. The outer bevel is lit from the upper left and the '
            'inner one from the lower right, which is the whole trick that '
            'makes a border read as a raised plate.'),
  ('GROUND', 'Four steps falling away from the same key light, tinted by what '
             'the talent DOES. The colour code below is the player’s only '
             'read of a tree at a glance, so it lives in the field rather '
             'than in a label.'),
  ('OBJECT', 'One object, drawn big enough to crop. Every surface runs six '
             'steps: dark edge, specular, highlight, midtone, core shadow, and '
             'one pixel of reflected light on the far edge.'),
  ('SHADOW', 'Cast down and right, two steps. The seam round the silhouette is '
             'warm where the key light rakes it and near-black where it does '
             'not — a uniformly black outline is what flattens a shape back '
             'into a sticker.'),
  ('SHEEN', 'A bright arc travels the brass on a 2.6 s loop, lifting each cell '
            'relative to where the bevel already put it. Sixteen still layers '
            'cycled by one keyframe: rotating a pixel grid resamples it.'),
]

style1 = """    .grid { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 18px 22px; }
    .cell { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .box { width: 84px; height: 84px; display: flex; align-items: center; justify-content: center;
           border: 1px solid #23301f; }
    .box.hot { border-color: #6E5216; background: #050805; }
    .arrow { font-size: 11px; color: #3c5a33; }
    .nm { font-size: 10.5px; letter-spacing: 0.1em; color: #8f9a8c; }
    .hero { font-size: 9.5px; letter-spacing: 0.14em; color: #5c6459; }
    .why { font-size: 9.5px; color: #6f8a6c; text-align: center; max-width: 15ch; line-height: 1.5; }
    .ramp { display: flex; gap: 0; }
    .sw { width: 26px; height: 20px; }
    .rampname { font-size: 9.5px; color: #6f8a6c; letter-spacing: .1em; width: 96px; }
    .recipe { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 22px; }
    .step { display: flex; flex-direction: column; gap: 7px; }
    .stepn { font-size: 10.5px; letter-spacing: .16em; color: #D8AE55; }
    .stept { font-size: 10.5px; color: #93a08f; line-height: 1.65; }
"""


def ramp(name, cols):
    sw = ''.join('<div class="sw" style="background:%s"></div>' % c for c in cols)
    return ('<div style="display:flex;align-items:center;gap:14px">'
            '<div class="rampname">%s</div><div class="ramp">%s</div></div>' % (name, sw))


# The prose is editorial and lives here; the LIST is compose.mjs's and is
# checked against it, so a sixth category cannot appear in one and not the
# other.
CATS = [
  ('movement', 'MOVEMENT', 'speed, dashes, anything that changes where he is'),
  ('defence', 'DEFENCE', 'armour, blocks, anything that keeps him standing'),
  ('damage', 'DAMAGE', 'how hard a hit lands'),
  ('speed', 'ATTACK SPEED', 'how often one lands'),
  ('healing', 'HEALING', 'shares green with attack speed on purpose'),
]

assert [c[0] for c in CATS] == DATA['cats'], (
  'build-dc knows %s; compose.mjs has %s' % ([c[0] for c in CATS], DATA['cats']))

# BRASS is the bezel's own ramp and belongs to compose.mjs, not to any icon, so
# it stays named here; the rest come from the render.
ramps_html = ''.join(
  ramp(name.upper(), list(colours.values()))
  for name, colours in [('brass', {'a': '#F2DCA0', 'b': '#D8AE55', 'c': '#A7802C',
                                   'd': '#6E5216', 'e': '#42300C'})]
  + sorted(DATA['ramps'].items()))

legend = ''.join(
  '<div class="cell"><div class="box hot">%s</div>'
  '<div class="nm">%s</div><div class="why">%s</div></div>' % (SW[k], label, why)
  for k, label, why in CATS)

steps = ''.join('<div class="step"><div class="stepn">%d &middot; %s</div>'
                '<div class="stept">%s</div></div>' % (n + 1, a, b)
                for n, (a, b) in enumerate(STEPS))

art1 = HEAD % style1 + """
<div style="display:flex;flex-direction:column;gap:30px;padding:40px 44px 48px;background:#000;color:#C8D0C4">
  <div style="display:flex;flex-direction:column;gap:8px">
    <div class="h1">— A LIT OBJECT IN A BEZEL —</div>
    <div class="cap">what ships, above &middot; the same talent as a HoMM-style icon, below</div>
  </div>

  <div class="note" style="border-left:2px solid #6E5216;padding-left:14px">
    The bottom row is the <b>wizard's blink line</b>, added after the archer
    set: HELD STEP buys the window a chained hop has to be taken in, THIRD STEP
    buys a third hop, and THUNDERSTEP is the rite that makes every hop of a
    chain arrive harder than the last. Both of the first two took three
    drawings.
    The hourglass was first built as two lit walls around a dark interior, on
    the theory that seeing through it is what makes glass read as glass — on
    the socket that is a wireframe, which is the 16x16 failure again at four
    times the size. Given a body, its frame was <b>wood</b>, and wood on this
    icon is brown on brown: <code>movement</code> tints the socket golden, and
    the dark end of the wood ramp sits on top of the ground's own lit pool, so
    the silhouette dissolved into the field it was standing on. Steel is the
    one ramp in the set that is cool, so it separates by hue as well as by
    value — no amount of re-lighting a brown frame would have done that. The
    three materials then read apart by value: frame at the light end of steel,
    glass at the dark end of it, sand in gold and brightest, because the sand
    is what the icon is about. The steps were three flat-toned risers and read as a bar
    chart; drawn straight on as treads and risers alone they read as a zigzag
    line, because a step only reads as a step when you can see the TOP of it.
    Each one is a box in oblique projection now, with three faces catching
    three amounts of light — tread into the key light, riser toward the
    viewer, right end turned away — and one line of shadow under each nosing,
    which is what separates a stack of boxes from a folded ribbon. What fixed
    all of it is the rule the rest of the set already followed: model every
    surface across its width, and let the contrast between a face in the light
    and a face out of it do the work.
  </div>

  <div class="note">
    Two things were wrong, and only the first one was obvious. The sigils are
    stroked <b>Path2D</b> line art in a game where every sprite is a
    <b>PixelGrid</b> sealed with an outline pass — the only thing on screen
    drawn in a different medium. But redrawing them as flat pixel shapes did
    not fix it, because the second problem is that a diagram is still a diagram
    in any medium. An icon needs a <i>frame to be lit against</i>, an object
    big enough to crop, and enough value steps to be round.
  </div>

  <div class="grid">%s</div>

  <div style="display:flex;flex-direction:column;gap:16px;border-top:1px solid #1a2a18;padding-top:26px">
    <div class="cap">how one is built — four of these five are generated, not drawn</div>
    <div class="recipe">%s</div>
  </div>

  <div style="display:flex;flex-direction:column;gap:16px;border-top:1px solid #1a2a18;padding-top:26px">
    <div class="cap">the colour code — the brass never changes, only the field inside it</div>
    <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px;max-width:760px">%s</div>
  </div>

  <div style="display:flex;gap:44px;border-top:1px solid #1a2a18;padding-top:26px">
    <div style="display:flex;flex-direction:column;gap:11px">
      <div class="cap">the ramps</div>
      %s
    </div>
    <div style="display:flex;flex-direction:column;gap:11px">
      <div class="cap">at the sizes it is actually read</div>
      <div style="display:flex;gap:18px;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:6px;align-items:center">
          %s<div class="hero">48 · SHOP ROW</div></div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:center">
          %s<div class="hero">112 · CHOOSER</div></div>
      </div>
    </div>
  </div>
</div>
""" % (''.join(cells), steps, legend,
       ramps_html,
       R['thunderstep']['sheen48'], R['thunderstep']['sheen112']) + TAIL

io.open('Sigils.dc.html', 'w', encoding='utf-8', newline='').write(art1)
print('wrote Sigils.dc.html')

# The artboard's frame does not scale to its content -- surplus paints the
# background and a shortfall CLIPS, silently. The grid is five wide, so the
# height has to follow the row count or a fourth row of icons is simply not
# there. 700 + 600/row reproduces the hand-set 1900 at the ten icons it was
# set for, which is the one calibration point there is.
rows = -(-len(ORDER) // 5)
height = 700 + rows * 600
canvas = json.load(io.open('canvas.json', encoding='utf-8'))
for board in canvas['artboards']:
    if board['file'] == 'Sigils.dc.html':
        board['h'] = height
for note in canvas.get('annotations', []):
    note['y'] = height + 70          # they sit under the board, not on it
io.open('canvas.json', 'w', encoding='utf-8', newline='').write(
    json.dumps(canvas, indent=2) + chr(10))
print('canvas.json: Sigils artboard is %d tall for %d rows' % (height, rows))
