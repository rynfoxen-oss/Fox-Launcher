import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type { JavaInstallation } from '../shared/types';

const execFileAsync = promisify(execFile);

export function javaExecutableName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

async function macJavaHomes(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  try {
    const { stdout, stderr } = await execFileAsync('/usr/libexec/java_home', ['-V'], { timeout: 8000 });
    return [...`${stdout}\n${stderr}`.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  } catch {
    return [];
  }
}

function parseVersion(output: string): { version: string; major: number; vendor?: string; bits?: 32 | 64 } | null {
  // java.exe writes its version banner to stderr, usually after an empty stdout line.
  const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  const match = first.match(/(?:java|openjdk) version "?([^"\s]+)/i) ?? first.match(/version "?([^"\s]+)/i);
  if (!match) return null;
  const version = match[1].replace(/"/g, '');
  const majorMatch = version.match(/^(\d+)/);
  let major = majorMatch ? Number(majorMatch[1]) : 0;
  if (major === 1) {
    const minor = version.match(/^1\.(\d+)/);
    major = minor ? Number(minor[1]) : 0;
  }
  const vendorMatch = output.match(/(?:Vendor|Runtime Name|OpenJDK Runtime Environment)[:\s]+([^\r\n]+)/i);
  // 32-bit HotSpot reports "Client VM"; 64-bit reports "64-Bit Server VM".
  const bits: 32 | 64 | undefined = /64-Bit/i.test(output)
    ? 64
    : /Client VM/i.test(output) ? 32 : undefined;
  return { version, major, vendor: vendorMatch?.[1]?.trim(), bits };
}

async function validateCandidate(javaPath: string): Promise<JavaInstallation | null> {
  if (!javaPath) return null;
  try {
    const stats = await fs.stat(javaPath);
    if (stats.isDirectory()) return null;
    const { stdout, stderr } = await execFileAsync(javaPath, ['-version'], { timeout: 8000, windowsHide: true });
    const parsed = parseVersion(`${stdout}\n${stderr}`);
    if (!parsed) return null;
    const bits = parsed.bits ?? (/\(x86\)/i.test(javaPath) ? 32 : undefined);
    return { path: javaPath, ...parsed, bits, valid: parsed.major >= 8 };
  } catch {
    return null;
  }
}

async function readRegistryValue(hive: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', key, '/v', 'JavaHome', '/reg:32'],
      { timeout: 5000, windowsHide: true },
    );
    const match = stdout.match(/JavaHome\s+REG_SZ\s+(.+)/i);
    return match?.[1]?.trim() ?? null;
  } catch {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/v', 'JavaHome'], {
        timeout: 5000,
        windowsHide: true,
      });
      const match = stdout.match(/JavaHome\s+REG_SZ\s+(.+)/i);
      return match?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  }
}

async function listChildDirs(parent: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

export async function detectJava(): Promise<JavaInstallation[]> {
  const candidates = new Set<string>();
  const javaName = javaExecutableName();
  const envHome = process.env.JAVA_HOME;
  if (envHome) candidates.add(path.join(envHome, 'bin', javaName));
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const trimmed = directory.trim().replace(/^"|"$/g, '');
    if (trimmed) candidates.add(path.join(trimmed, javaName));
  }

  if (process.platform === 'win32') {
    for (const key of [
      'HKLM\\SOFTWARE\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\JavaSoft\\JRE',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JRE',
    ]) {
      const home = await readRegistryValue('HKLM', key);
      if (home) candidates.add(path.join(home, 'bin', javaName));
    }
  }

  const roots = process.platform === 'darwin'
    ? [
        '/Library/Java/JavaVirtualMachines',
        '/System/Library/Java/JavaVirtualMachines',
        path.join(process.env.HOME ?? '', 'Library/Java/JavaVirtualMachines'),
      ]
    : [
        'C:\\Program Files\\Java',
        'C:\\Program Files (x86)\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Microsoft',
        'C:\\Program Files\\Amazon Corretto',
        'C:\\Program Files\\Zulu',
        'C:\\Program Files\\BellSoft',
      ];
  for (const root of roots) {
    for (const dir of await listChildDirs(root)) {
      candidates.add(path.join(dir, 'bin', javaName));
      if (process.platform === 'darwin') {
        candidates.add(path.join(dir, 'Contents', 'Home', 'bin', javaName));
      }
    }
  }
  for (const home of await macJavaHomes()) {
    candidates.add(path.join(home, 'bin', javaName));
    candidates.add(path.join(home, 'Contents', 'Home', 'bin', javaName));
  }

  const results = await Promise.all([...candidates].map(validateCandidate));
  const valid = results.filter((item): item is JavaInstallation => item !== null && item.valid);
  const unique = new Map<string, JavaInstallation>();
  for (const item of valid) {
    const key = `${item.major}|${item.path.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => b.major - a.major || a.path.localeCompare(b.path));
}

export async function validateJava(javaPath: string): Promise<JavaInstallation> {
  const result = await validateCandidate(javaPath);
  if (!result) throw new Error(`The selected path is not a valid Java executable: ${javaPath}`);
  return result;
}

/** Looks for a valid Java executable directly under an extracted runtime directory. */
export async function findJavaInDirectory(root: string): Promise<JavaInstallation | null> {
  const javaName = javaExecutableName();
  const direct = path.join(root, 'bin', javaName);
  const directResult = await validateCandidate(direct);
  if (directResult) return directResult;

  for (const child of await listChildDirs(root)) {
    const nested = path.join(child, 'bin', javaName);
    const result = await validateCandidate(nested);
    if (result) return result;
    if (process.platform === 'darwin') {
      const bundled = path.join(child, 'Contents', 'Home', 'bin', javaName);
      const bundledResult = await validateCandidate(bundled);
      if (bundledResult) return bundledResult;
    }
  }
  return null;
}
