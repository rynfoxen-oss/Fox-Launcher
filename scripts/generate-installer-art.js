const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const HEADER_WIDTH = 150;
const HEADER_HEIGHT = 57;
const SIDE_WIDTH = 164;
const SIDE_HEIGHT = 314;

const root = path.resolve(__dirname, '..');
const icon = PNG.sync.read(fs.readFileSync(path.join(root, 'build', 'icon.png')));

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function mix(a, b, t) {
  return [
    clamp(a[0] + (b[0] - a[0]) * t),
    clamp(a[1] + (b[1] - a[1]) * t),
    clamp(a[2] + (b[2] - a[2]) * t),
  ];
}

function sampleIcon(x, y, size, offsetX, offsetY) {
  const px = Math.floor(((x - offsetX) / size) * icon.width);
  const py = Math.floor(((y - offsetY) / size) * icon.height);
  if (px < 0 || py < 0 || px >= icon.width || py >= icon.height) return null;
  const index = (icon.width * py + px) * 4;
  return {
    r: icon.data[index],
    g: icon.data[index + 1],
    b: icon.data[index + 2],
    a: icon.data[index + 3] / 255,
  };
}

function render(variant) {
  const isHeader = variant === 'header';
  const width = isHeader ? HEADER_WIDTH : SIDE_WIDTH;
  const height = isHeader ? HEADER_HEIGHT : SIDE_HEIGHT;
  const pixels = Buffer.alloc(width * height * 3);
  const top = isHeader ? [14, 18, 33] : [17, 23, 44];
  const bottom = isHeader ? [39, 23, 58] : [58, 27, 63];
  const accent = [255, 107, 53];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = y / Math.max(1, height - 1);
      let color = mix(top, bottom, t);

      const glowX = width * 0.5;
      const glowY = isHeader ? height * 0.5 : 205;
      const radius = isHeader ? 48 : 150;
      const glow = Math.max(0, 1 - Math.hypot(x - glowX, y - glowY) / radius);
      color = mix(color, accent, glow * glow * 0.28);

      const stripe = Math.sin((x + y * 0.35) * 0.09) * 0.5 + 0.5;
      color = color.map((channel) => clamp(channel + stripe * 5));

      const iconSize = isHeader ? 42 : 122;
      const iconX = Math.floor((width - iconSize) / 2);
      const iconY = isHeader ? Math.floor((height - iconSize) / 2) : 78;
      const sampled = sampleIcon(x, y, iconSize, iconX, iconY);
      if (sampled && sampled.a > 0) color = mix(color, [sampled.r, sampled.g, sampled.b], sampled.a);

      if (!isHeader && y > height - 4) color = accent;

      const outIndex = ((height - 1 - y) * width + x) * 3;
      pixels[outIndex] = color[2];
      pixels[outIndex + 1] = color[1];
      pixels[outIndex + 2] = color[0];
    }
  }

  return { pixels, width, height };
}

function writeBmp(file, image) {
  const { pixels, width, height } = image;
  const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
  const padding = rowSize - width * 3;
  const pixelSize = rowSize * height;
  const headerSize = 54;
  const buffer = Buffer.alloc(headerSize + pixelSize);

  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(headerSize + pixelSize, 2);
  buffer.writeUInt32LE(headerSize, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(pixelSize, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);
  buffer.writeUInt32LE(0, 46);
  buffer.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y += 1) {
    const source = y * width * 3;
    const target = headerSize + y * rowSize;
    pixels.copy(buffer, target, source, source + width * 3);
    if (padding > 0) buffer.fill(0, target + width * 3, target + rowSize);
  }

  fs.writeFileSync(file, buffer);
  console.log(`Generated ${path.relative(root, file)} (${width}x${height})`);
}

writeBmp(path.join(root, 'build', 'installer-header.bmp'), render('header'));
writeBmp(path.join(root, 'build', 'installer-welcome.bmp'), render('welcome'));
