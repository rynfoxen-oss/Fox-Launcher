import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

/**
 * Bundled free Ice Fox cape. Standard 64x32 cape layout:
 * outside face x=1..10 y=1..16, inside x=12..21 y=1..16, edges around them,
 * and the elytra half left transparent.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '..', 'build', 'fox-cape.png');

const png = new PNG({ width: 64, height: 32 });
const C = {
  icePale: [226, 250, 255],
  ice: [142, 222, 255],
  iceMid: [90, 184, 235],
  deep: [36, 104, 171],
  navy: [17, 42, 78],
  white: [248, 253, 255],
  shadow: [68, 137, 190],
  dark: [18, 39, 69],
  glow: [130, 239, 255],
  violet: [151, 126, 235],
  snow: [255, 255, 255],
};

function px(x, y, color) {
  if (x < 0 || x >= 64 || y < 0 || y >= 32) return;
  const i = (y * 64 + x) * 4;
  png.data[i] = color[0];
  png.data[i + 1] = color[1];
  png.data[i + 2] = color[2];
  png.data[i + 3] = 255;
}

function mix(a, b, t) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t));
}

// Outside face — darker frozen gradient so the white fox reads clearly.
for (let y = 1; y <= 16; y++) {
  const color = mix(C.iceMid, C.deep, (y - 1) / 15);
  for (let x = 1; x <= 10; x++) px(x, y, color);
}
// Sparse stars behind the emblem, kept clear of the ears and chin.
for (const [x, y] of [[2, 2], [9, 2], [2, 14], [9, 13], [5, 2], [6, 2]]) px(x, y, C.snow);

// 10x16 pixel art fox emblem. '.' keeps the background/snow visible.
const outside = [
  '..S....S..',
  '.S......S.',
  '..O....O..',
  '.OO....OO.',
  '.OIO..OIO.',
  '.OWWWWWWO.',
  'OWWMMMMWWO',
  'OWWWWWWWWO',
  'OWWEWWEWWO',
  'WWWEWWEWWW',
  'PWWWWWWWWP',
  '.PWWWWWWP.',
  '..PNNNNP..',
  '...PDDP...',
  'C.C.CC.C.C',
  'OOOOOOOOOO',
];
if (outside.length !== 16 || outside.some((row) => row.length !== 10)) {
  throw new Error('Ice Fox cape pattern must be exactly 10x16');
}

const palette = {
  S: C.snow,
  O: C.navy,
  I: C.glow,
  W: C.white,
  M: C.glow,
  E: C.dark,
  P: C.icePale,
  N: C.deep,
  D: C.shadow,
  C: C.snow,
};

for (let y = 1; y <= 16; y++) {
  for (let x = 1; x <= 10; x++) {
    const color = palette[outside[y - 1][x - 1]];
    if (color) px(x, y, color);
  }
}

// Frosty brows and cheek frost add life without muddying the dark eyes.
px(4, 8, C.glow);
px(7, 8, C.glow);
px(2, 11, C.snow);
px(9, 11, C.snow);

// Inside face — navy lining with an aurora tail and stars.
for (let y = 1; y <= 16; y++) {
  for (let x = 12; x <= 21; x++) px(x, y, C.navy);
  px(12, y, C.deep);
  px(21, y, C.deep);
}
for (let y = 3; y <= 15; y++) {
  const wave = Math.round(Math.sin(((y - 3) / 12) * Math.PI) * 3);
  px(13 + wave, y, C.ice);
  px(14 + wave, y, C.glow);
  const ribbon = 19 - Math.round(Math.cos(((y - 3) / 12) * Math.PI) * 2);
  px(ribbon, y, C.violet);
  px(ribbon + 1, y, C.icePale);
}
for (const [x, y] of [[14, 3], [19, 5], [15, 11], [20, 14]]) px(x, y, C.snow);

// Thin cloth edges and shoulder hems.
for (let y = 1; y <= 16; y++) {
  px(0, y, C.deep);
  px(11, y, C.glow);
}
for (let x = 1; x <= 10; x++) px(x, 0, C.ice);
for (let x = 12; x <= 21; x++) px(x, 0, C.navy);

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, PNG.sync.write(png));
console.log(`Wrote ${output} (64x32 Ice Fox cape)`);
