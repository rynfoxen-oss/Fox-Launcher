import { execFileSync } from 'child_process';
import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { downloadArtifact } from '@electron/get';
import yauzl from 'yauzl';
import yazl from 'yazl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const installedElectron = await fs.readFile(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
  .then((text) => JSON.parse(text).version)
  .catch(() => null);
const electronVersion = installedElectron || String(pkg.devDependencies?.electron ?? '31.7.0').replace(/^[^\d]+/, '');
const appFolder = 'Fox Launcher.app';
const zipPrefix = `${appFolder}/`;
const resourcesPrefix = `${zipPrefix}Contents/Resources/`;
const appResourcesPrefix = `${resourcesPrefix}app/`;

function requestedArchs() {
  if (process.argv.includes('--x64')) return ['x64'];
  if (process.argv.includes('--arm64')) return ['arm64'];
  return ['x64', 'arm64'];
}

async function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

function entryMode(entry) {
  const mode = entry.externalFileAttributes >>> 16;
  return mode || (entry.fileName.endsWith('/') ? 0o040755 : 0o100644);
}

function isSymlink(mode) {
  return (mode & 0o170000) === 0o120000;
}

function patchInfoPlist(buffer) {
  let text = buffer.toString('utf8');
  text = text.replace(/Electron/g, 'Fox Launcher');
  text = text.replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/, '$1com.foxlauncher.app$2');
  text = text.replace(/electron\.icns/g, 'icon.icns');
  text = text.replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${version}$2`);
  text = text.replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${version}$2`);
  return Buffer.from(text, 'utf8');
}

function patchStrings(buffer) {
  return Buffer.from(buffer.toString('utf8').replace(/Electron/g, 'Fox Launcher'), 'utf8');
}

function mapElectronEntry(entry) {
  const name = entry.fileName;
  if (!name.startsWith('Electron.app/')) return null;
  let mapped = zipPrefix + name.slice('Electron.app/'.length);
  if (mapped === `${zipPrefix}Contents/MacOS/Electron`) {
    mapped = `${zipPrefix}Contents/MacOS/Fox Launcher`;
  }
  if (mapped === `${resourcesPrefix}electron.icns`) return null;
  if (mapped === `${resourcesPrefix}default_app.asar`) return null;
  return mapped;
}

async function copyLocalTree(zipfile, sourceRoot, metadataRoot) {
  const base = metadataRoot.endsWith('/') ? metadataRoot : `${metadataRoot}/`;
  async function walk(current, relative = '') {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const metadataPath = `${base}${relative}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full, `${relative}${entry.name}/`);
        continue;
      }
      if (entry.name === 'package-lock.json') continue;
      zipfile.addFile(full, metadataPath, { mode: 0o100644, mtime: new Date() });
    }
  }
  await walk(sourceRoot);
}

async function createStagingApp() {
  const staging = await fs.mkdtemp(path.join(root, 'release', 'mac', '.staging-'));
  await fs.copyFile(path.join(root, 'package.json'), path.join(staging, 'package.json'));
  await fs.copyFile(path.join(root, 'package-lock.json'), path.join(staging, 'package-lock.json'));
  await fs.cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
  await fs.cp(path.join(root, 'dist-electron'), path.join(staging, 'dist-electron'), { recursive: true });
  await fs.mkdir(path.join(staging, 'build'), { recursive: true });
  for (const asset of ['icon.png', 'icon.ico', 'icon.icns', 'fox-cape.png']) {
    await fs.copyFile(path.join(root, 'build', asset), path.join(staging, 'build', asset));
  }
  const npmArgs = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (await fs.stat(npmCli).then(() => true).catch(() => false)) {
    execFileSync(process.execPath, [npmCli, ...npmArgs], { cwd: staging, stdio: 'inherit' });
  } else {
    execFileSync('npm', npmArgs, { cwd: staging, stdio: 'inherit', shell: process.platform === 'win32' });
  }
  return staging;
}

async function buildArch(arch, staging) {
  const macRoot = path.join(root, 'release', 'mac');
  const zipPath = path.join(macRoot, `Fox-Launcher-${version}-mac-${arch}.zip`);
  await fs.rm(zipPath, { force: true });
  console.log(`Downloading Electron ${electronVersion} for macOS ${arch}...`);
  const electronZip = await downloadArtifact({
    version: electronVersion,
    platform: 'darwin',
    arch,
    artifactName: 'electron',
  });

  const zipfile = new yazl.ZipFile();
  const outputDone = new Promise((resolve, reject) => {
    const output = zipfile.outputStream.pipe(createWriteStream(zipPath));
    output.on('close', resolve);
    output.on('error', reject);
    zipfile.outputStream.on('error', reject);
  });

  const sourceZip = await new Promise((resolve, reject) => {
    yauzl.open(electronZip, { lazyEntries: true, autoClose: false }, (error, opened) => {
      if (error) reject(error);
      else resolve(opened);
    });
  });

  let symlinks = 0;
  let entries = 0;
  await new Promise((resolve, reject) => {
    sourceZip.on('entry', (entry) => {
      (async () => {
        const mapped = mapElectronEntry(entry);
        const mode = entryMode(entry);
        if (mapped) {
          entries += 1;
          if (entry.fileName.endsWith('/')) {
            zipfile.addEmptyDirectory(mapped, { mode: 0o040755, mtime: entry.getLastModDate() });
          } else if (isSymlink(mode)) {
            const target = await readEntry(sourceZip, entry);
            symlinks += 1;
            zipfile.addBuffer(target, mapped, { mode: 0o120777, mtime: entry.getLastModDate(), compress: false });
          } else if (mapped === `${zipPrefix}Contents/Info.plist`) {
            zipfile.addBuffer(patchInfoPlist(await readEntry(sourceZip, entry)), mapped, {
              mode: 0o100644,
              mtime: entry.getLastModDate(),
            });
          } else if (mapped.includes('.lproj/') && mapped.endsWith('.strings')) {
            zipfile.addBuffer(patchStrings(await readEntry(sourceZip, entry)), mapped, {
              mode: 0o100644,
              mtime: entry.getLastModDate(),
            });
          } else if (mapped.includes('/Contents/MacOS/')) {
            zipfile.addReadStreamLazy(mapped, {
              mode: 0o100755,
              mtime: entry.getLastModDate(),
              size: entry.uncompressedSize,
            }, (callback) => sourceZip.openReadStream(entry, callback));
          } else {
            zipfile.addReadStreamLazy(mapped, {
              mode,
              mtime: entry.getLastModDate(),
              size: entry.uncompressedSize,
            }, (callback) => sourceZip.openReadStream(entry, callback));
          }
        }
        sourceZip.readEntry();
      })().catch((error) => {
        sourceZip.close();
        reject(error);
      });
    });
    sourceZip.on('end', resolve);
    sourceZip.on('error', reject);
    sourceZip.readEntry();
  });

  if (symlinks < 1) throw new Error(`Electron ${arch} archive contained no symlinks; archive would be invalid on macOS`);

  await copyLocalTree(zipfile, staging, appResourcesPrefix);
  zipfile.addFile(path.join(root, 'build', 'icon.icns'), `${resourcesPrefix}icon.icns`, { mode: 0o100644 });
  zipfile.addFile(path.join(root, 'build', 'authlib-injector.jar'), `${resourcesPrefix}authlib-injector.jar`, { mode: 0o100644 });
  zipfile.addFile(path.join(root, 'build', 'fox-cape.png'), `${resourcesPrefix}fox-cape.png`, { mode: 0o100644 });
  zipfile.end();
  await outputDone;
  sourceZip.close();

  const stat = await fs.stat(zipPath);
  console.log(`Created ${path.relative(root, zipPath)} (${(stat.size / 1024 / 1024).toFixed(1)} MB, ${entries} Electron entries, ${symlinks} symlinks)`);
}

async function writeReadme(macRoot) {
  const readme = `Fox Launcher ${version} for macOS\n\nFiles:\n- Fox-Launcher-${version}-mac-x64.zip (Intel Macs)\n- Fox-Launcher-${version}-mac-arm64.zip (Apple Silicon Macs)\n- Fox-Launcher-${version}-mac-setup.zip (double-click installer for both Macs)\n\nInstall:\n1. Download the ZIP for your Mac and unzip it.\n2. Drag "Fox Launcher.app" to Applications.\n3. If macOS says it cannot verify Fox Launcher, right-click the app and choose Open,\n   then Open again. Or use System Settings > Privacy & Security > Open Anyway.\n4. If macOS still blocks it, run: xattr -cr "/Applications/Fox Launcher.app"\n\nThe setup ZIP removes the quarantine attribute automatically, but the installer may\nstill need a right-click > Open on first launch.\n\nGame data is stored under ~/Library/Application Support/fox-launcher by default.\n`;
  await fs.writeFile(path.join(macRoot, 'README.txt'), readme, 'utf8');
}

const archs = requestedArchs();
const macRoot = path.join(root, 'release', 'mac');
await fs.mkdir(macRoot, { recursive: true });
for (const entry of await fs.readdir(macRoot)) {
  if (entry.startsWith('.staging-')) {
    await fs.rm(path.join(macRoot, entry), { recursive: true, force: true }).catch(() => undefined);
  }
}
const staging = await createStagingApp();
try {
  for (const arch of archs) await buildArch(arch, staging);
  await writeReadme(macRoot);
} finally {
  await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
}
console.log(`Mac builds are in ${path.relative(root, macRoot)}`);
