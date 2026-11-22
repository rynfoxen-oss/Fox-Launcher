/* Generates the Fox Launcher icon (PNG + ICO) without external tooling. */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 256;
const png = new PNG({ width: SIZE, height: SIZE });

// 5x7 bitmap letter F
const glyph = [
  '11111',
  '10000',
  '10000',
  '11110',
  '10000',
  '10000',
  '10000',
];

function rounded(x, y) {
  const r = 48;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    if (!rounded(x, y)) {
      png.data[i] = png.data[i + 1] = png.data[i + 2] = png.data[i + 3] = 0;
      continue;
    }
    const t = (x + y) / (SIZE * 2);
    png.data[i] = Math.round(255 - t * 20);
    png.data[i + 1] = Math.round(107 + t * 45);
    png.data[i + 2] = Math.round(53 + t * 40);
    png.data[i + 3] = 255;

    const gx = Math.floor((x - 66) / 25);
    const gy = Math.floor((y - 40) / 25);
    if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && glyph[gy][gx] === '1') {
      png.data[i] = 255;
      png.data[i + 1] = 255;
      png.data[i + 2] = 255;
    }
  }
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const pngBuffer = PNG.sync.write(png);
fs.writeFileSync(path.join(outDir, 'icon.png'), pngBuffer);

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0; // 256px
header[7] = 0;
header[8] = 0;
header[9] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(pngBuffer.length, 14);
header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, pngBuffer]));

function downscale(buffer, size) {
  const source = PNG.sync.read(buffer);
  const target = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x / size) * source.width));
      const sy = Math.min(source.height - 1, Math.floor((y / size) * source.height));
      const from = (sy * source.width + sx) * 4;
      const to = (y * size + x) * 4;
      target.data[to] = source.data[from];
      target.data[to + 1] = source.data[from + 1];
      target.data[to + 2] = source.data[from + 2];
      target.data[to + 3] = source.data[from + 3];
    }
  }
  return PNG.sync.write(target);
}

// ICNS entries can contain PNG data directly. Include 128px and 256px variants.
const icnsEntries = [
  [Buffer.from('ic07', 'ascii'), downscale(pngBuffer, 128)],
  [Buffer.from('ic08', 'ascii'), pngBuffer],
];
const icnsBody = Buffer.concat(icnsEntries.map(([type, data]) => {
  const entryHeader = Buffer.alloc(8);
  type.copy(entryHeader, 0);
  entryHeader.writeUInt32BE(8 + data.length, 4);
  return Buffer.concat([entryHeader, data]);
}));
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(8 + icnsBody.length, 4);
fs.writeFileSync(path.join(outDir, 'icon.icns'), Buffer.concat([icnsHeader, icnsBody]));

console.log('Generated build/icon.png, build/icon.ico and build/icon.icns');
