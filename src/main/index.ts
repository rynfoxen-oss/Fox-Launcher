import { app, BrowserWindow, dialog, Menu, nativeImage, session, Tray } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { stopBackgroundWorkers } from './background';
import { ensureFreeCape, grantFreeCapeToOfflineAccounts } from './capes';
import { events } from './events';
import { registerIpc } from './ipc';
import { startDiscovery, stopDiscovery } from './lanDiscovery';
import { stopPartyServer } from './partyServer';
import { store } from './store';
import { record as recordTelemetry } from './telemetry';
import { checkForUpdates } from './updates';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function appIconPath(): string {
  return path.join(__dirname, '../../build', process.platform === 'darwin' ? 'icon.png' : 'icon.ico');
}

function createTrayIcon() {
  const iconPath = appIconPath();
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return icon.resize({ width: 32, height: 32 });
  }
  // Generated fallback so the tray works even if the icon asset is missing.
  const size = 32;
  const rgb = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const border = x < 2 || y < 2 || x > size - 3 || y > size - 3;
      rgb[i] = border ? 255 : 255;
      rgb[i + 1] = border ? 255 : 107;
      rgb[i + 2] = border ? 255 : 53;
      rgb[i + 3] = 255;
    }
  }
  return nativeImage.createFromBuffer(rgb, { width: size, height: size });
}

/**
 * macOS Retina displays rasterize large animated layers in software unless the
 * GPU compositor is explicitly allowed. These switches must be set before the
 * app is ready, so bootstrap calls this first.
 */
function applyMacRenderOptimizations(): void {
  if (process.platform !== 'darwin') return;
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  // Do not bypass Chromium's GPU blocklist; forcing unsupported drivers causes
  // crashes/artifacts on some Macs instead of smoother rendering.
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Fox Launcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Fox Launcher', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    backgroundColor: '#090b12',
    show: false,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  events.attach(mainWindow.webContents);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('close', (event) => {
    if (quitting || !mainWindow) return;
    // Closing the window always quits unless the user explicitly chose to
    // keep the launcher running in the tray. No confirmation dialog is shown.
    if (store.get().settings.closeBehavior !== 'minimize') return;
    event.preventDefault();
    createTray();
    mainWindow.hide();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || (process.env.FOX_DEV ? 'http://127.0.0.1:5173' : '');
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

async function bootstrap(): Promise<void> {
  applyMacRenderOptimizations();
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  await app.whenReady();
  await store.init();
  try {
    await ensureFreeCape();
    await grantFreeCapeToOfflineAccounts();
  } catch (error) {
    console.warn('[Capes] Bundled free cape setup failed:', error);
  }
  events.hydrateDownloads(store.get().downloadHistory);
  // Voice calls are local-only; grant mic permission without a browser popup.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });
  registerIpc(() => mainWindow);
  startDiscovery();
  createWindow();
  recordTelemetry('app_start');
  if (store.get().settings.checkUpdates) {
    // Let the first themed frame paint before doing network work.
    setTimeout(() => {
      void checkForUpdates(true).catch((error) => {
        console.warn('[Updates] Startup check failed:', error);
      });
    }, 2500);
  }

  app.on('before-quit', () => {
    quitting = true;
    void stopPartyServer();
    stopDiscovery();
    stopBackgroundWorkers();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
}

void bootstrap().catch((error) => {
  console.error('Fatal startup error:', error);
  void dialog.showErrorBox('Fox Launcher failed to start', String(error));
  app.quit();
});
