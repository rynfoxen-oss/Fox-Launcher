import { ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { offlineUuid } from './auth';
import { chooseJavaPath, getLoaderVersions } from './minecraft';
import { listInstalledMods } from './mods';
import { lanPartyAddresses, localPartyAddress } from './partyNetwork';
import { currentPartyMember, publicPartyMember } from './partyIdentity';
import { startPartyHub, stopPartyChat } from './partyChat';
import { store } from './store';
import { downloadFile, ensureDir, fetchJson, fileExists, safeFileName } from './utils';
import type { Instance, Party, PartyMember, PartyServerState } from '../shared/types';

const GAME_PORT = 25565;
const MAX_LOG_LINES = 24;
const SERVER_TIMEOUT_MS = 4 * 60 * 1000;

interface ServerHooks {
  onState: (state: PartyServerState) => Promise<void>;
  onAddress: (
    host: string,
    port: number,
    chatHost: string,
    chatPort: number,
    mode: 'lan',
    message: string,
  ) => Promise<void>;
  onMembers?: (members: PartyMember[]) => Promise<void> | void;
}

interface ServerPlan {
  command: string;
  args: string[];
  cwd: string;
}

let state: PartyServerState = { status: 'offline', message: 'No party server is running.' };
let activePartyId: string | null = null;
let hooks: ServerHooks | null = null;
let serverProcess: ChildProcess | null = null;
let generation = 0;
let lastLogPublish = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function oneLine(value: string, max = 120): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function toolsDir(): string {
  return path.join(app.getPath('userData'), 'party-server');
}

function pushLogLine(line: string): void {
  const clean = oneLine(line, 300);
  if (!clean) return;
  state = { ...state, log: [...(state.log ?? []), clean].slice(-MAX_LOG_LINES) };
  const now = Date.now();
  if (now - lastLogPublish > 1500) {
    lastLogPublish = now;
    void hooks?.onState(state);
  }
}

async function setState(patch: Partial<PartyServerState>): Promise<void> {
  state = { ...state, ...patch };
  await hooks?.onState(state);
}

export function serverStatus(): PartyServerState {
  return state;
}

function killChild(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    child.kill('SIGTERM');
  }
}

export async function stopPartyServer(): Promise<void> {
  generation++;
  killChild(serverProcess);
  serverProcess = null;
  stopPartyChat();
  activePartyId = null;
  state = { status: 'offline', message: 'Party server stopped.', log: [] };
  await hooks?.onState(state);
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => reject(new Error(`Port ${port} is already in use: ${error.message}`)));
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve()));
  });
}

async function downloadVanillaServer(version: string, destination: string): Promise<void> {
  const manifest = await fetchJson<{ versions?: Array<{ id: string; url: string }> }>(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  );
  const entry = manifest.versions?.find((item) => item.id === version);
  if (!entry) throw new Error(`Minecraft ${version} was not found in the version manifest`);
  const meta = await fetchJson<{ downloads?: { server?: { url: string; sha1: string } } }>(entry.url);
  const server = meta.downloads?.server;
  if (!server?.url || !server.sha1) throw new Error(`No official server jar is available for Minecraft ${version}`);
  await downloadFile(server.url, destination, { sha1: server.sha1 });
}

async function runInstaller(java: string, args: string[], cwd: string, label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(java, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (data: Buffer) => pushLogLine(`[${label}] ${data.toString('utf8')}`));
    child.stderr?.on('data', (data: Buffer) => pushLogLine(`[${label}] ${data.toString('utf8')}`));
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`)));
  });
}

function installerPath(name: string): string {
  return path.join(app.getPath('temp'), 'fox-launcher', 'party-server', safeFileName(name));
}

async function loaderVersionFor(instance: Instance): Promise<string> {
  if (instance.loader === 'vanilla') return '';
  const raw = instance.loaderVersion ?? (await getLoaderVersions(instance.loader, instance.minecraftVersion))[0];
  if (!raw) throw new Error(`No ${instance.loader} version is available for Minecraft ${instance.minecraftVersion}`);
  return instance.loader === 'forge'
    ? raw.replace(new RegExp(`^${instance.minecraftVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-+`), '')
    : raw;
}

async function copyHostContent(instance: Instance, serverDir: string): Promise<void> {
  const enabled = await listInstalledMods(instance.id).catch(() => []);
  const sourceMods = path.join(instance.gameDir, 'mods');
  const targetMods = path.join(serverDir, 'mods');
  await ensureDir(targetMods);
  for (const mod of enabled.filter((item) => item.enabled && !item.fileName.endsWith('.disabled'))) {
    const source = path.join(sourceMods, mod.fileName);
    if (!(await fileExists(source))) continue;
    await fs.promises.copyFile(source, path.join(targetMods, mod.fileName));
  }
  const sourceConfig = path.join(instance.gameDir, 'config');
  if (await fileExists(sourceConfig)) {
    await fs.promises.cp(sourceConfig, path.join(serverDir, 'config'), { recursive: true, force: true });
  }
}

async function discoverServerJar(serverDir: string, loader: Instance['loader']): Promise<string> {
  const preferred = loader === 'fabric'
    ? ['fabric-server-launch.jar']
    : loader === 'quilt'
      ? ['quilt-server-launch.jar']
      : [];
  const names = await fs.promises.readdir(serverDir).catch(() => [] as string[]);
  const jar = preferred.find((name) => names.includes(name))
    ?? names.find((name) => /^(?:forge|neoforge)-.+\.jar$/i.test(name) && !/installer|universal/i.test(name))
    ?? (names.includes('server.jar') ? 'server.jar' : undefined);
  if (!jar) throw new Error('The dedicated server installer did not produce a server jar');
  return path.join(serverDir, jar);
}

/**
 * Offline/Fox ID players use name-derived UUIDs. Keep a current allow list for
 * diagnostics and older plugins, but leave vanilla whitelist enforcement off so
 * invited players never get "not whitelisted" on the launcher-hosted server.
 */
async function writePartyAccessFiles(party: Party, serverDir: string): Promise<void> {
  const names = new Map<string, string>();
  for (const member of party.members ?? []) {
    const name = oneLine(member.name, 16);
    if (name) names.set(name.toLowerCase(), name);
  }
  const account = store.currentAccount();
  if (account?.name) names.set(account.name.toLowerCase(), oneLine(account.name, 16));

  const entries = [...names.values()].map((name) => ({
    uuid: offlineUuid(name).replace(/-/g, ''),
    name,
  }));
  await fs.promises.writeFile(
    path.join(serverDir, 'whitelist.json'),
    `${JSON.stringify(entries, null, 2)}\n`,
    'utf8',
  );
  await fs.promises.writeFile(
    path.join(serverDir, 'white-list.txt'),
    entries.length ? `${entries.map((entry) => entry.name).join('\n')}\n` : '',
    'utf8',
  );
  pushLogLine(`[fox] Offline access enabled for ${entries.length} party player(s); whitelist enforcement is off.`);
}

async function prepareServer(party: Party, expectedGeneration: number): Promise<ServerPlan> {
  const instance = store.get().instances.find((item) => item.id === party.instanceId);
  if (!instance) throw new Error('Choose an instance for this party');
  await setState({ status: 'installing', message: `Preparing the ${instance.loader} server files…` });
  const java = (await chooseJavaPath(instance)).path;
  const serverDir = path.join(toolsDir(), 'servers', safeFileName(party.id));
  await ensureDir(serverDir);
  await copyHostContent(instance, serverDir);
  await assertPortFree(GAME_PORT);
  if (expectedGeneration !== generation) throw new Error('Server setup was cancelled');

  const loaderVersion = await loaderVersionFor(instance);
  if (instance.loader === 'vanilla') {
    await setState({ message: `Downloading Minecraft ${instance.minecraftVersion} server…` });
    await downloadVanillaServer(instance.minecraftVersion, path.join(serverDir, 'server.jar'));
  } else if (instance.loader === 'fabric') {
    const jar = installerPath('fabric-installer-1.1.2.jar');
    await setState({ message: 'Downloading the Fabric server installer…' });
    await downloadFile('https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.2/fabric-installer-1.1.2.jar', jar);
    await setState({ message: 'Installing the Fabric server…' });
    await runInstaller(java, ['-jar', jar, 'server', '-dir', serverDir, '-mcversion', instance.minecraftVersion, '-loader', loaderVersion, '-downloadMinecraft'], path.dirname(jar), 'Fabric');
  } else if (instance.loader === 'quilt') {
    const jar = installerPath('quilt-installer-0.15.1.jar');
    await setState({ message: 'Downloading the Quilt server installer…' });
    await downloadFile('https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/0.15.1/quilt-installer-0.15.1.jar', jar);
    await setState({ message: 'Installing the Quilt server…' });
    await runInstaller(java, ['-jar', jar, 'install', 'server', instance.minecraftVersion, loaderVersion, '--download-server', `--install-dir=${serverDir}`], path.dirname(jar), 'Quilt');
  } else {
    const isForge = instance.loader === 'forge';
    const coordinate = isForge
      ? `net.minecraftforge:forge:${instance.minecraftVersion}-${loaderVersion}`
      : `net.neoforged:neoforge:${loaderVersion}`;
    const [group, artifact, version] = coordinate.split(':');
    const repo = isForge ? 'https://maven.minecraftforge.net/' : 'https://maven.neoforged.net/releases/';
    const jarName = `${artifact}-${version}-installer.jar`;
    const jar = installerPath(jarName);
    const url = `${repo}${group.replace(/\./g, '/')}/${artifact}/${version}/${jarName}`;
    await setState({ message: `Downloading the ${instance.loader} server installer…` });
    await downloadFile(url, jar);
    await setState({ message: `Installing the ${instance.loader} server…` });
    await runInstaller(java, ['-jar', jar, '--installServer', serverDir], path.dirname(jar), instance.loader);
  }
  if (expectedGeneration !== generation) throw new Error('Server setup was cancelled');

  await fs.promises.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true\n', 'utf8');
  const properties = [
    `server-port=${GAME_PORT}`,
    'online-mode=false',
    // Offline players must never be rejected by a stale or copied allow list.
    'white-list=false',
    'whitelist=false',
    'enforce-whitelist=false',
    `motd=${oneLine(`Fox Party - ${party.name}`, 60)}`,
    'max-players=40',
    'allow-flight=true',
    'difficulty=easy',
    'spawn-protection=0',
    'enable-rcon=false',
  ].join('\n');
  await fs.promises.writeFile(path.join(serverDir, 'server.properties'), `${properties}\n`, 'utf8');
  await writePartyAccessFiles(party, serverDir);

  const names = await fs.promises.readdir(serverDir).catch(() => [] as string[]);
  if (process.platform === 'win32' && names.includes('run.bat')) {
    return { command: 'cmd.exe', args: ['/c', 'run.bat', 'nogui'], cwd: serverDir };
  }
  if (process.platform !== 'win32' && names.includes('run.sh')) {
    return { command: 'bash', args: ['run.sh', 'nogui'], cwd: serverDir };
  }
  const serverJar = await discoverServerJar(serverDir, instance.loader);
  return {
    command: java,
    args: [`-Xmx${Math.max(1024, Math.min(instance.memoryMb || 2048, 8192))}M`, '-jar', serverJar, 'nogui'],
    cwd: serverDir,
  };
}

async function startMinecraftServer(plan: ServerPlan, expectedGeneration: number): Promise<void> {
  await assertPortFree(GAME_PORT);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('The dedicated server did not become ready in time')), SERVER_TIMEOUT_MS);
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess = child;
    const read = (data: Buffer) => {
      const text = data.toString('utf8');
      output += text;
      for (const line of text.split(/\r?\n/)) pushLogLine(`[server] ${line}`);
      if (/Done \(/i.test(output)) finish();
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      if (serverProcess === child) serverProcess = null;
      if (!settled) finish(new Error(`The dedicated server exited before it was ready (code ${code})`));
    });
    if (expectedGeneration !== generation) finish(new Error('Server setup was cancelled'));
  });
}

export async function startPartyServer(
  party: Party,
  options: {
    hooks: ServerHooks;
    selfMember?: PartyMember;
  },
): Promise<void> {
  generation++;
  const expectedGeneration = generation;
  hooks = options.hooks;
  activePartyId = party.id;
  killChild(serverProcess);
  serverProcess = null;
  await setState({
    status: 'preparing',
    message: 'Preparing your dedicated party server…',
    publicAddress: undefined,
    chatAddress: undefined,
    networkMessage: undefined,
    log: [],
  });

  try {
    const plan = await prepareServer(party, expectedGeneration);
    if (expectedGeneration !== generation) return;

    const identity = options.selfMember ?? publicPartyMember(currentPartyMember('online') ?? {
      name: party.hostName,
      accountType: 'offline',
      joinedAt: Date.now(),
      status: 'host',
      presence: 'online',
    });
    const chatPort = await startPartyHub(party, { ...identity, status: 'host' }, {
      onRoster: (members) => options.hooks.onMembers?.(members),
    });
    if (expectedGeneration !== generation) return;

    await setState({ status: 'installing', message: 'Finding your local network address…' });
    const published = lanPartyAddresses(GAME_PORT, chatPort);
    if (expectedGeneration !== generation) return;
    const address = `${published.host}:${published.port}`;
    const chatAddress = `${published.chatHost}:${published.chatPort}`;

    await options.hooks.onAddress(
      published.host,
      published.port,
      published.chatHost,
      published.chatPort,
      published.mode,
      published.message,
    );
    await setState({
      status: 'installing',
      message: published.message,
      publicAddress: address,
      chatAddress,
      mode: published.mode,
      networkMessage: published.message,
    });

    await setState({ status: 'starting', message: 'Starting the dedicated server…' });
    await startMinecraftServer(plan, expectedGeneration);
    if (expectedGeneration !== generation) return;

    await setState({
      status: 'running',
      message: 'The party server and chat are online. Share the invite code with your friends.',
      publicAddress: address,
      chatAddress,
      mode: published.mode,
      networkMessage: published.message,
    });
  } catch (error) {
    if (expectedGeneration !== generation) return;
    generation++;
    killChild(serverProcess);
    serverProcess = null;
    stopPartyChat();
    await setState({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}

export function activeServerPartyId(): string | null {
  return activePartyId;
}

export { localPartyAddress };
