import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  /** ZIP external attributes; the high 16 bits hold the Unix mode. */
  externalAttributes: number;
}

export interface MacAppExtraction {
  appBundle: string;
  /** Relative file paths and their Unix modes, used to restore executable bits after copy. */
  modes: Array<[string, number]>;
}

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: end of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, externalAttributes });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipData(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  return null;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function findAppBundle(directory: string, depth = 0): Promise<string | null> {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith('.app')) return path.join(directory, entry.name);
  }
  if (depth >= 2) return null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findAppBundle(path.join(directory, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

export async function extractNativesLocal(jarPath: string, outputDir: string): Promise<string[]> {
  const buffer = await fs.promises.readFile(jarPath);
  const entries = readZipEntries(buffer);
  const extracted: string[] = [];
  await ensureDir(outputDir);
  for (const entry of entries) {
    const fileName = path.basename(entry.name);
    if (!/\.(dll|so|dylib)$/i.test(fileName) || entry.name.includes('META-INF')) continue;
    const content = readZipData(buffer, entry);
    if (!content) continue;
    const target = path.join(outputDir, fileName);
    await fs.promises.writeFile(target, content);
    if (process.platform !== 'win32') await fs.promises.chmod(target, 0o755).catch(() => undefined);
    extracted.push(target);
  }
  return extracted;
}

export async function readZipArchiveLocal(file: string): Promise<Array<[string, Buffer]>> {
  const buffer = await fs.promises.readFile(file);
  const result: Array<[string, Buffer]> = [];
  for (const entry of readZipEntries(buffer)) {
    if (entry.name.endsWith('/')) continue;
    const content = readZipData(buffer, entry);
    if (content) result.push([entry.name, content]);
  }
  return result;
}

export async function extractZipArchiveLocal(file: string, outputDir: string): Promise<string[]> {
  const buffer = await fs.promises.readFile(file);
  const root = path.resolve(outputDir);
  const extracted: string[] = [];
  await ensureDir(root);
  for (const entry of readZipEntries(buffer)) {
    if (entry.name.endsWith('/')) continue;
    const target = path.resolve(root, entry.name);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    const content = readZipData(buffer, entry);
    if (!content) continue;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content);
    extracted.push(target);
  }
  return extracted;
}

/**
 * Extracts an Electron macOS ZIP while preserving symlinks and Unix modes.
 * Electron apps contain Frameworks symlinks and executable helpers; a plain
 * writeFile extraction produces a bundle that macOS refuses to launch.
 */
export async function extractMacAppArchiveLocal(file: string, outputDir: string): Promise<MacAppExtraction> {
  const buffer = await fs.promises.readFile(file);
  const root = path.resolve(outputDir);
  const modes: Array<[string, number]> = [];
  await ensureDir(root);
  for (const entry of readZipEntries(buffer)) {
    if (entry.name.endsWith('/')) continue;
    const target = path.resolve(root, entry.name);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    const content = readZipData(buffer, entry);
    if (!content) continue;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const unixMode = (entry.externalAttributes >>> 16) & 0xffff;
    const fileType = unixMode & 0o170000;
    if (fileType === 0o120000) {
      const linkTarget = content.toString('utf8');
      if (path.isAbsolute(linkTarget)) continue;
      // A relative link like ../../../etc must not let a later entry write
      // outside the staging directory.
      const resolvedLink = path.resolve(path.dirname(target), linkTarget);
      if (resolvedLink !== root && !resolvedLink.startsWith(`${root}${path.sep}`)) continue;
      await fs.promises.symlink(linkTarget, target);
      continue;
    }
    await fs.promises.writeFile(target, content);
    const mode = (unixMode & 0o777) || (fileType === 0o100000 ? 0o644 : 0o755);
    await fs.promises.chmod(target, mode).catch(() => undefined);
    modes.push([path.relative(root, target), mode]);
  }
  const appBundle = await findAppBundle(root);
  if (!appBundle) throw new Error('The macOS update archive does not contain a Fox Launcher.app bundle');
  return { appBundle, modes };
}
