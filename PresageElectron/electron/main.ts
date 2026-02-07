/**
 * main.ts — Electron main process
 *
 * Creates the app window, spawns the C++ bridge, and forwards
 * focus data to the React renderer via IPC.
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { BridgeManager, FocusData } from './bridge-manager';

let mainWindow: BrowserWindow | null = null;
let bridge: BridgeManager | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: 'Focus Wizard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev, load from Vite dev server; in prod, load the built file
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startBridge(): Promise<void> {
  const apiKey = process.env.SMARTSPECTRA_API_KEY || '';

  if (!apiKey) {
    console.warn('[Main] No SMARTSPECTRA_API_KEY set \u2014 bridge will not start.');
    console.warn('[Main] Set it in your environment or pass it via the app settings.');
    return;
  }

  bridge = new BridgeManager({ apiKey, mode: 'docker' });

  bridge.on('ready', () => {
    console.log('[Main] Bridge is ready!');
    mainWindow?.webContents.send('bridge:ready');
  });

  bridge.on('focus', (data: FocusData) => {
    mainWindow?.webContents.send('bridge:focus', data);
  });

  bridge.on('metrics', (data: Record<string, unknown>) => {
    mainWindow?.webContents.send('bridge:metrics', data);
  });

  bridge.on('edge', (data: Record<string, unknown>) => {
    mainWindow?.webContents.send('bridge:edge', data);
  });

  bridge.on('status', (status: string) => {
    console.log(`[Main] Bridge status: ${status}`);
    mainWindow?.webContents.send('bridge:status', status);
  });

  bridge.on('bridge-error', (message: string) => {
    console.error(`[Main] Bridge error: ${message}`);
    mainWindow?.webContents.send('bridge:error', message);
  });

  bridge.on('close', (code: number) => {
    console.log(`[Main] Bridge exited with code ${code}`);
    mainWindow?.webContents.send('bridge:closed', code);
  });

  try {
    await bridge.start();
  } catch (err) {
    console.error('[Main] Failed to start bridge:', err);
    mainWindow?.webContents.send('bridge:error',
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── IPC Handlers ─────────────────────────────────────────

ipcMain.handle('bridge:start', async (_event, apiKey?: string) => {
  if (apiKey) {
    process.env.SMARTSPECTRA_API_KEY = apiKey;
  }
  if (bridge?.running) {
    return { success: true, message: 'Bridge already running' };
  }
  await startBridge();
  return { success: true };
});

ipcMain.handle('bridge:stop', async () => {
  bridge?.stop();
  return { success: true };
});

ipcMain.handle('bridge:status', async () => {
  return {
    running: bridge?.running ?? false,
  };
});

/** Check if Docker is available on this machine. */
ipcMain.handle('docker:check', async () => {
  return { available: BridgeManager.isDockerAvailable() };
});

/**
 * Receive a webcam frame from the renderer.
 * The frame is a JPEG ArrayBuffer; we write it to the shared
 * Docker volume as a numbered file for SmartSpectra to read.
 */
ipcMain.on('frame:data', (_event, timestampUs: number, data: Buffer) => {
  bridge?.frameWriter?.writeFrame(timestampUs, Buffer.from(data));
});

// ── App Lifecycle ────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startBridge();
});

app.on('window-all-closed', () => {
  bridge?.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  bridge?.stop();
});
