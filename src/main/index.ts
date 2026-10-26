import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, type ApiHandle } from './api';
import { EncryptedFileSecretStore, MemorySecretStore } from './services/secrets';
import { API_METHODS, type ApiMethodName } from '../shared/contract';
import type { AppEvent } from '../shared/types';

const isDev = Boolean(process.env.GITPP_DEV_URL);
const dataDir = process.env.GITPP_DATA_DIR || app.getPath('userData');
let mainWindow: BrowserWindow | null = null;
let api: ApiHandle | null = null;
let startupWarnings: string[] = [];

const ALLOWED_EVENT_TYPES = new Set<AppEvent['type']>(['repo-changed', 'preflight-progress', 'toast']);

function devCsp(): string {
  return "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ws://localhost:5199 http://localhost:5199; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
}

function prodCsp(): string {
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; media-src 'none'";
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function emit(event: AppEvent): void {
  if (!ALLOWED_EVENT_TYPES.has(event.type)) return;
  send('gitpp:event', event);
}

async function buildApi(): Promise<ApiHandle> {
  let secrets;
  if (safeStorage.isEncryptionAvailable()) {
    secrets = new EncryptedFileSecretStore(dataDir, safeStorage);
  } else {
    secrets = new MemorySecretStore();
    startupWarnings.push(
      'Operating-system credential encryption is unavailable on this machine. GitHub and AI keys will not be persisted after Git++ exits.',
    );
  }
  return createApi({
    dataDir,
    secrets,
    host: {
      meta: {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        dataDir,
        isPackaged: app.isPackaged,
      },
      openDirectoryDialog: async (title) => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
          title: title ?? 'Select a folder',
          properties: ['openDirectory', 'createDirectory'],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      openFileDialog: async (title) => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
          title: title ?? 'Select a file',
          properties: ['openFile'],
          filters: [
            { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All files', extensions: ['*'] },
          ],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      openExternal: async (url) => {
        await shell.openExternal(url);
        return true;
      },
      showItemInFolder: (target) => shell.showItemInFolder(target),
      emit,
    },
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    backgroundColor: '#0d1014',
    title: 'Git++',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const allowedOrigin = process.env.GITPP_DEV_URL ?? 'file://';
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (isDev && process.env.GITPP_DEV_URL) {
    void mainWindow.loadURL(process.env.GITPP_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const html = path.join(__dirname, '..', 'renderer', 'index.html');
    void mainWindow.loadFile(html);
  }
}

function registerIpc(): void {
  ipcMain.handle('gitpp:invoke', async (event, request: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      return { ok: false, error: { code: 'INTERNAL', kind: 'validation', message: 'Rejected IPC call from an unexpected frame.' } };
    }
    if (!request || typeof request !== 'object') {
      return { ok: false, error: { code: 'INVALID_INPUT', kind: 'validation', message: 'Malformed IPC request.' } };
    }
    const { method, payload } = request as { method?: unknown; payload?: unknown };
    if (typeof method !== 'string' || !API_METHODS.includes(method as ApiMethodName)) {
      return { ok: false, error: { code: 'INVALID_INPUT', kind: 'validation', message: 'Unknown action.' } };
    }
    if (!api) {
      return { ok: false, error: { code: 'INTERNAL', kind: 'unknown', message: 'Git++ is still starting. Try again in a moment.' } };
    }
    return api.invoke(method as ApiMethodName, payload ?? {});
  });

  ipcMain.handle('gitpp:window', (event, action: unknown) => {
    if (event.sender !== mainWindow?.webContents) return { maximized: false };
    if (!mainWindow) return { maximized: false };
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === 'close') mainWindow.close();
    else if (action === 'focus') mainWindow.focus();
    return { maximized: mainWindow.isMaximized() };
  });

  ipcMain.handle('gitpp:startup', async (event) => {
    if (event.sender !== mainWindow?.webContents) return { warnings: [] };
    return { warnings: startupWarnings };
  });
}

function buildMenu(): void {
  const sendCommand = (command: string) => send('gitpp:menu', command);
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open-repository') },
        { label: 'Clone Repository…', click: () => sendCommand('clone-repository') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => sendCommand('open-settings') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: () => sendCommand('command-palette') },
        { label: 'Changes', accelerator: 'CmdOrCtrl+1', click: () => sendCommand('nav-changes') },
        { label: 'History', accelerator: 'CmdOrCtrl+2', click: () => sendCommand('nav-history') },
        { label: 'Branches', accelerator: 'CmdOrCtrl+3', click: () => sendCommand('nav-branches') },
        { label: 'Refresh Repository', accelerator: 'CmdOrCtrl+R', click: () => sendCommand('refresh') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Git documentation', click: () => void shell.openExternal('https://git-scm.com/doc') },
        { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.gitplusplus.app');
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [isDev ? devCsp() : prodCsp()],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    });

    try {
      api = await buildApi();
      startupWarnings = [...startupWarnings, ...api.warnings];
    } catch (error) {
      startupWarnings.push(`Startup error: ${String(error)}`);
    }
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

void fileURLToPath;
