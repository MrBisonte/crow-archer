/**
 * Composites a talent icon: brass bezel, lit ground, cast shadow, seam pass,
 * object, and the sheen that travels the frame. One home -- the browser
 * preview and the artboard renderer both import this, so what you look at is
 * what ships.
 *
 * WHY 32x32 AND A BEZEL. The 16x16 pass read as a diagram: three values are
 * not enough to model a form, and an unframed shape floating on the panel has
 * nothing to be lit against. A Heroes-of-Might-and-Magic skill icon is a
 * painted object seated in a metal bezel -- the bezel is half the read, and it
 * costs nothing per icon because it is generated here rather than drawn
 * thirty-seven times.
 *
 * The bezel is four rings, and the trick that makes it read as RAISED rather
 * than as a border is that the two bevels are lit in opposite directions:
 * the outer edge catches the light at the upper left, the inner edge catches
 * it at the lower right.
 */

export const N = 32;

const EDGE = '#0A0806';
const RIM = '#17120A';   // fallback when a talent has no category yet
/** Brass, five steps. The bezel is the one place the game shows worked metal. */
const BRASS = ['#F2DCA0', '#D8AE55', '#A7802C', '#6E5216', '#42300C'];
/**
 * Gold, for the ultimates. Deeper and more saturated than the brass, and one
 * step brighter at the top: a talent is one of forty in a row and an ultimate
 * is one of two on a card, so the frame is allowed to be the thing that says
 * which you are looking at before the object inside it does.
 */
const GOLD = ['#FFF3C8', '#F0C64A', '#C08F18', '#7E5A0A', '#4A3405'];

/**
 * The socket, tinted by what the talent DOES -- the colour code the player
 * learns without being told. The brass never changes, so the set still reads
 * as one family; only the field inside it does.
 *
 * Four steps out from the key light. Step 0 is a pool rather than a wash: the
 * object stands IN the light instead of on an evenly lit plate, which is most
 * of what makes one look expensive.
 *
 * Attack speed and healing deliberately share green -- both are about how much
 * you get out of a fight rather than how hard you hit or how much you take.
 */
const GROUND = {
  movement: ['#6E5522', '#493716', '#2A1F0B', '#130E05'],
  defence:  ['#27436F', '#1B2D4B', '#111B2D', '#080D17'],
  damage:   ['#6E2C22', '#4A1C14', '#2A110C', '#130706'],
  speed:    ['#2F5C31', '#1F3D21', '#132513', '#081108'],
  healing:  ['#2F5C31', '#1F3D21', '#132513', '#081108'],
  // The ultimates' own ground: a deep violet none of the four categories uses,
  // so an ultimate is recognisable as one before the object is read. Shared by
  // all ten rather than split per hero, which is what makes them a tier
  // rather than five unrelated pairs.
  ultimate: ['#4A2A6E', '#331D4B', '#1E112D', '#0D0716'],
};

/** The inner rim carries the same code, so it survives being scaled to 48 px. */
const RIM_TINT = {
  movement: '#2A1E09', defence: '#0D1729', damage: '#2A110C',
  speed: '#0E2211', healing: '#0E2211', ultimate: '#1C0F2B',
};

/** The seam: warm where the light rakes across it, near-black where it does not. */
/** The sockets a category can tint. One home: this list was copied into
 *  render-svg.mjs and again into build-dc.py, and a fourth copy was only ever
 *  a matter of time. `composite` falls back to `movement` for an unknown one
 *  rather than throwing, so nothing downstream would have told you. */
export const CATS = ['movement', 'defence', 'damage', 'speed', 'healing', 'ultimate'];

const SEAM_LIT = '#3E2F18';
const SEAM = '#0A0F0A';
export const OUTLINE = SEAM;

/** The sheen that travels the bezel: half its width in radians, and its peak. */
const SHEEN_ARC = 0.78;
const SHEEN_PEAK = '#FFF6D8';

/**
 * The frame's geometry, per grid size.
 *
 * A table rather than the 32 px numbers scaled by 1.5 at read time: the forty
 * talent icons have to go on rendering byte for byte, and a scaling function
 * that lands on 31.0000001 somewhere is a whole set redrawn for nothing. Two
 * sizes exist and no third is planned, so two exact rows cost less than one
 * clever formula and cannot drift.
 *
 * `rings` are bezel, brass, rim and socket outward-in; `light` is where the
 * key falls on the ground; `bands` are the three radii the ground steps at;
 * `rivets` pin the plate to the frame on the diagonals.
 */
const GEOM = {
  32: {
    rings: [{ lo: 0, hi: 31, r: 7 }, { lo: 1, hi: 30, r: 6 },
            { lo: 3, hi: 28, r: 5 }, { lo: 4, hi: 27, r: 5 }],
    light: [13.5, 12], bands: [5.5, 9, 13],
    rivets: [[7, 7], [24, 7], [7, 24], [24, 24]],
  },
  48: {
    rings: [{ lo: 0, hi: 47, r: 11 }, { lo: 2, hi: 45, r: 9 },
            { lo: 4, hi: 43, r: 8 }, { lo: 6, hi: 41, r: 7 }],
    light: [20, 18], bands: [8, 13.5, 19.5],
    rivets: [[11, 11], [36, 11], [11, 36], [36, 36]],
  },
};

/** The size an icon draws at. Talents said nothing, and meant 32. */
const sizeOf = (icon) => icon.size ?? N;

function inRounded(x, y, lo, hi, r) {
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = x < lo + r ? lo + r : (x > hi - r ? hi - r : x);
  const cy = y < lo + r ? lo + r : (y > hi - r ? hi - r : y);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r + 0.5;
}

const within = (n, i) => (x, y) => {
  const r = GEOM[n].rings[i];
  return inRounded(x, y, r.lo, r.hi, r.r);
};
/** The socket, for callers that clip an object to it. Defaults to a talent. */
export const inSocket = (x, y, n = N) => within(n, 3)(x, y);

function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const c = (s) => Math.round((((a >> s) & 255) * (1 - t)) + (((b >> s) & 255) * t));
  return '#' + [16, 8, 0].map((s) => c(s).toString(16).padStart(2, '0')).join('');
}

/** Where the light falls on a bezel cell: -1 fully lit, +1 fully turned away. */
const facing = (x, y, n) => Math.max(-1, Math.min(1, ((x - (n / 2 - 0.5)) + (y - (n / 2 - 0.5))) / (n / 2)));

/** Four rivets on the diagonals, the way a HoMM plate is pinned to its frame. */


/**
 * The bezel and the lit ground inside it. Returns the pixels plus, for every
 * brass cell, which step of the ramp it landed on -- the sheen needs that so it
 * can lift a cell RELATIVE to where it already sits instead of flooding it.
 */
function bezel(cat, n = N) {
  const g = GROUND[cat] ?? GROUND.movement;
  const rim = RIM_TINT[cat] ?? RIM;
  // Gold frames an ultimate, brass frames a talent. The metal is keyed on the
  // category rather than on the size so the rule survives a talent ever being
  // drawn large for a card.
  const metal = cat === 'ultimate' ? GOLD : BRASS;
  const { light: [lx, ly], bands: [b0, b1, b2], rivets } = GEOM[n];
  const inBezel = within(n, 0), inBrass = within(n, 1), inRim = within(n, 2);
  const inSock = within(n, 3);
  const out = new Map();
  const step = new Map();
  const set = (x, y, c) => out.set(`${x},${y}`, c);
  const setBrass = (x, y, i) => { out.set(`${x},${y}`, metal[i]); step.set(`${x},${y}`, i); };

  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!inBezel(x, y)) continue;
    if (inSock(x, y)) {
      // The key light sits up and left of centre, so the far corner falls away.
      const d = Math.hypot(x - lx, y - ly);
      set(x, y, g[d < b0 ? 0 : d < b1 ? 1 : d < b2 ? 2 : 3]);
    } else if (inRim(x, y)) {
      set(x, y, rim);
    } else if (inBrass(x, y)) {
      // Inner bevel: lit from the LOWER RIGHT, which is what raises the plate.
      const f = facing(x, y, n);
      setBrass(x, y, f > 0.28 ? 0 : f > 0.05 ? 1 : f > -0.2 ? 2 : 3);
    } else if (inBezel(x - 1, y) && inBezel(x + 1, y)
      && inBezel(x, y - 1) && inBezel(x, y + 1)) {
      // Outer bevel, lit from the upper left.
      const f = facing(x, y, n);
      setBrass(x, y, f < -0.3 ? 0 : f < -0.05 ? 1 : f < 0.28 ? 2 : 3);
    } else {
      set(x, y, EDGE);                          // one dark pixel all the way round
    }
  }
  for (const [rx, ry] of rivets) {
    for (const [dx, dy, c] of [[0, 0, metal[0]], [1, 0, metal[2]],
                               [0, 1, metal[2]], [1, 1, metal[4]]]) {
      if (inBrass(rx + dx, ry + dy) && !inSock(rx + dx, ry + dy)) set(rx + dx, ry + dy, c);
    }
  }
  return { px: out, step };
}

/**
 * The travelling sheen: brass cells whose angle round the bezel falls inside
 * the arc are lifted along the ramp, brightest at its centre. Returned as its
 * own layer so a still can place it anywhere and the preview can cycle twelve
 * of them without redrawing the icon underneath.
 */
export function sheen(icon, phase) {
  const { step } = bezel(icon.cat, sizeOf(icon));
  const out = new Map();
  for (const [key, idx] of step) {
    const [x, y] = key.split(',').map(Number);
    let d = Math.atan2(y - 15.5, x - 15.5) - phase;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const t = 1 - Math.abs(d) / SHEEN_ARC;
    if (t <= 0) continue;
    out.set(key, t > 0.62 && idx <= 2
      ? SHEEN_PEAK
      : BRASS[Math.max(0, idx - (t > 0.35 ? 2 : 1))]);
  }
  return out;
}

const cellOf = (icon, x, y) => {
  const row = icon.rows[y];
  if (!row) return null;
  const ch = row[x];
  return ch && ch !== '.' ? (icon.legend[ch] ?? null) : null;
};

/**
 * One icon as a Map of "x,y" -> hex. Painted in the order a pixel artist
 * paints it: ground, the shadow the object casts on it, the seam, the object.
 * Everything but the bezel is clipped to the socket, so an object that runs
 * off the edge reads as cropped rather than as spilling onto the frame.
 */
export function composite(icon, phase) {
  const n = sizeOf(icon);
  const { px } = bezel(icon.cat, n);
  const inSock = within(n, 3);
  const lit = (x, y) => cellOf(icon, x, y);

  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!inSock(x, y) || lit(x, y)) continue;
    const cast = lit(x - 1, y - 1) ? 0.66 : lit(x - 2, y - 2) ? 0.38 : 0;
    if (cast) px.set(`${x},${y}`, mix(px.get(`${x},${y}`), '#000000', cast));
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!inSock(x, y) || lit(x, y)) continue;
    if (!(lit(x - 1, y) || lit(x + 1, y) || lit(x, y - 1) || lit(x, y + 1))) continue;
    // A uniformly black outline is what flattens a shape back into a sticker.
    // The seam is warm on the side the key light rakes across.
    px.set(`${x},${y}`, lit(x + 1, y) || lit(x, y + 1) ? SEAM_LIT : SEAM);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = lit(x, y);
    if (c && inSock(x, y)) px.set(`${x},${y}`, c);
  }
  if (phase !== undefined) for (const [k, c] of sheen(icon, phase)) px.set(k, c);
  return px;
}

/** A pixel map as run-length encoded rects -- ~4x fewer nodes than one each. */
function rects(px) {
  const parts = [];
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const c = px.get(`${x},${y}`);
      if (!c) { x++; continue; }
      let run = 1;
      while (x + run < N && px.get(`${x + run},${y}`) === c) run++;
      parts.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${c}"/>`);
      x += run;
    }
  }
  return parts.join('');
}

export function svg(icon, size, phase) {
  const n = sizeOf(icon);
  return `<svg viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" `
    + `shape-rendering="crispEdges">${rects(composite(icon, phase))}</svg>`;
}

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/**
 * The same icon with the sheen running round the frame. Twelve still layers
 * cycled by one keyframe, not a rotation: rotating a pixel grid resamples it,
 * and a resampled pixel is the one thing this whole set is trying not to be.
 */
export function svgSheen(icon, size, frames = 16, seconds = 2.6) {
  const id = `s${Math.abs(hash(icon.id))}`;
  const layers = [];
  for (let f = 0; f < frames; f++) {
    const phase = -Math.PI * 0.75 + (f / frames) * Math.PI * 2;
    layers.push(`<g class="${id}" style="animation-delay:${(-seconds * f / frames).toFixed(2)}s">`
      + `${rects(sheen(icon, phase))}</g>`);
  }
  const on = (100 / frames).toFixed(2);
  const n = sizeOf(icon);
  return `<svg viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" `
    + `shape-rendering="crispEdges"><style>`
    + `@keyframes ${id}k{0%,${on}%{opacity:1}${(+on + 0.01).toFixed(2)}%,100%{opacity:0}}`
    + `.${id}{opacity:0;animation:${id}k ${seconds}s linear infinite}`
    + `@media (prefers-reduced-motion:reduce){.${id}{animation:none}}`
    + `</style>${rects(composite(icon))}${layers.join('')}</svg>`;
}
