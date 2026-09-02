// Rasterises composited icons straight to a PNG, so looking at one needs no
// browser and no server.
//
// The rule in this directory is render and LOOK -- every art fault here was
// obvious in a picture and invisible in the coordinates. That used to mean a
// static server and a browser pane, which is fine for one person and useless
// for fourteen working at once: one shared pane and fourteen ports. `composite`
// already returns a map of pixel to colour, so the picture was one deflate
// away the whole time.
//
//   node icon-png.mjs out.png towerGuard moreLinks
//
// Each icon is drawn at 224 px (judge the modelling), 96 px and 48 px (judge
// whether it still reads). An icon that only works at 224 is not an icon.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

import { ICONS } from './icons32.js';
import { N, composite } from './compose.mjs';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                       // filter: none
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                          // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const [out, ...ids] = process.argv.slice(2);
if (!out || !ids.length) {
  console.error('usage: node icon-png.mjs <out.png> <iconId> [iconId ...]');
  process.exit(2);
}

// Sizes and columns are overridable so one sheet can hold the whole set at a
// glance: ICON_SIZES=96 ICON_COLS=6 node icon-png.mjs sheet.png <ids...>
const SIZES = (process.env.ICON_SIZES ?? '224,96,48').split(',').map(Number);
const COLS = Number(process.env.ICON_COLS ?? 1);
const GAP = 10;
const BG = [0x0d, 0x0f, 0x0c];

const by = new Map(ICONS.map((i) => [i.id, i]));
const missing = ids.filter((id) => !by.has(id));
if (missing.length) {
  // Silence here would be a black rectangle and a wasted look.
  console.error(`no such icon: ${missing.join(', ')}`);
  console.error(`drawn so far: ${[...by.keys()].join(', ')}`);
  process.exit(1);
}

const CELL = SIZES.reduce((a, s) => a + s + GAP, 0);
const W = GAP + COLS * CELL;
const ROW = SIZES[0] + GAP;
const H = GAP + Math.ceil(ids.length / COLS) * ROW;
const px = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255;
}

ids.forEach((id, i) => {
  const cells = composite(by.get(id));
  const row = Math.floor(i / COLS);
  let x0 = GAP + (i % COLS) * CELL;
  for (const size of SIZES) {
    const scale = size / N;
    const y0 = GAP + row * ROW + (SIZES[0] - size);   // sat on one baseline
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = cells.get(`${Math.floor(x / scale)},${Math.floor(y / scale)}`);
        if (!c) continue;
        const o = ((y0 + y) * W + x0 + x) * 4;
        px[o] = parseInt(c.slice(1, 3), 16);
        px[o + 1] = parseInt(c.slice(3, 5), 16);
        px[o + 2] = parseInt(c.slice(5, 7), 16);
        px[o + 3] = 255;
      }
    }
    x0 += size + GAP;
  }
});

writeFileSync(out, encodePng(W, H, px));
console.log(`wrote ${out} — ${ids.join(', ')} at ${SIZES.join('/')} px`);
