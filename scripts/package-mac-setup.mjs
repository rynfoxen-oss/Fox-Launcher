import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import yauzl from 'yauzl';
import yazl from 'yazl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const macRoot = path.join(root, 'release', 'mac');
const setupName = `Fox-Launcher-${version}-mac-setup.zip`;
const outputPath = path.join(macRoot, setupName);

const installerScript = `#!/bin/bash
set -euo pipefail

HERE="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ARCH="\$(uname -m)"

case "\$ARCH" in
  arm64|aarch64)
    SRC="\$HERE/arm64/Fox Launcher.app"
    ;;
  x86_64|i386)
    SRC="\$HERE/x64/Fox Launcher.app"
    ;;
  *)
    echo "Unsupported Mac architecture: \$ARCH" >&2
    exit 1
    ;;
esac

if [ ! -d "\$SRC" ]; then
  echo "Missing app bundle: \$SRC" >&2
  exit 1
fi

echo "Fox Launcher ${version} macOS setup"
echo "Detected architecture: \$ARCH"
echo "Installing to ~/Applications/Fox Launcher.app"

mkdir -p "\$HOME/Applications"
rm -rf "\$HOME/Applications/Fox Launcher.app"
cp -R "\$SRC" "\$HOME/Applications/Fox Launcher.app"
xattr -cr "\$HOME/Applications/Fox Launcher.app" 2>/dev/null || true

echo "Install complete. Opening Fox Launcher..."
open "\$HOME/Applications/Fox Launcher.app"
`;

const setupReadme = `Fox Launcher ${version} macOS setup

INSTALL
1. Unzip this file.
2. Double-click "Install Fox Launcher.command".
   If macOS blocks it, right-click the file and choose Open.
3. The installer copies the correct app for your Mac to:
   ~/Applications/Fox Launcher.app
   and opens Fox Launcher.

MANUAL INSTALL
You can also drag either app bundle to Applications yourself:
- arm64/Fox Launcher.app  - Apple Silicon
- x64/Fox Launcher.app    - Intel

Game data is stored under ~/Library/Application Support/fox-launcher by default.
`;

async function openZip(file) {
  if (!(await fs.stat(file).then(() => true).catch(() => false))) {
    throw new Error(`Missing source archive: ${path.relative(root, file)}. Run npm run package:mac first.`);
  }
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) reject(error);
      else resolve(zip);
    });
  });
}

async function copyZip(zipfile, source, prefix) {
  await new Promise((resolve, reject) => {
    source.on('entry', (entry) => {
      (async () => {
        const mode = entry.externalFileAttributes >>> 16 || (entry.fileName.endsWith('/') ? 0o040755 : 0o100644);
        const mapped = `${prefix}${entry.fileName}`;
        if (entry.fileName.endsWith('/')) {
          zipfile.addEmptyDirectory(mapped, { mode: 0o040755, mtime: entry.getLastModDate() });
        } else if ((mode & 0o170000) === 0o120000) {
          const chunks = [];
          const stream = await new Promise((ok, no) => source.openReadStream(entry, (error, opened) => error ? no(error) : ok(opened)));
          stream.on('data', (chunk) => chunks.push(chunk));
          await new Promise((ok, no) => {
            stream.on('end', ok);
            stream.on('error', no);
          });
          zipfile.addBuffer(Buffer.concat(chunks), mapped, {
            mode: 0o120777,
            mtime: entry.getLastModDate(),
            compress: false,
          });
        } else {
          zipfile.addReadStreamLazy(mapped, {
            mode,
            mtime: entry.getLastModDate(),
            size: entry.uncompressedSize,
          }, (callback) => source.openReadStream(entry, callback));
        }
        source.readEntry();
      })().catch((error) => {
        source.close();
        reject(error);
      });
    });
    source.on('end', resolve);
    source.on('error', reject);
    source.readEntry();
  });
}

async function sourceZipFor(arch) {
  const candidates = [
    path.join(macRoot, `Fox-Launcher-${version}-mac-${arch}.zip`),
    path.join(root, 'release', `Fox-Launcher-${version}-mac-${arch}.zip`),
  ];
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error(`Missing source archive for ${arch}. Run npm run package:mac or npm run package:mac:dmg first.`);
}

await fs.rm(outputPath, { force: true });
const armZip = await openZip(await sourceZipFor('arm64'));
const x64Zip = await openZip(await sourceZipFor('x64'));
const zipfile = new yazl.ZipFile();
const outputDone = new Promise((resolve, reject) => {
  const output = zipfile.outputStream.pipe(createWriteStream(outputPath));
  output.on('close', resolve);
  output.on('error', reject);
  zipfile.outputStream.on('error', reject);
});

try {
  zipfile.addEmptyDirectory('Fox Launcher Mac Setup', { mode: 0o040755 });
  zipfile.addEmptyDirectory('Fox Launcher Mac Setup/arm64', { mode: 0o040755 });
  zipfile.addEmptyDirectory('Fox Launcher Mac Setup/x64', { mode: 0o040755 });
  await copyZip(zipfile, armZip, 'Fox Launcher Mac Setup/arm64/');
  await copyZip(zipfile, x64Zip, 'Fox Launcher Mac Setup/x64/');
  zipfile.addBuffer(Buffer.from(installerScript, 'utf8'), 'Fox Launcher Mac Setup/Install Fox Launcher.command', {
    mode: 0o100755,
  });
  zipfile.addBuffer(Buffer.from(setupReadme, 'utf8'), 'Fox Launcher Mac Setup/README.txt', {
    mode: 0o100644,
  });
  zipfile.end();
  await outputDone;
  const stat = await fs.stat(outputPath);
  console.log(`Created ${path.relative(root, outputPath)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
} finally {
  armZip.close();
  x64Zip.close();
}
