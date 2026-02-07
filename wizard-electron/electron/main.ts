import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } from 'electron'
import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BridgeManager, FocusData } from './bridge-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let setupWin: BrowserWindow | null = null
let bridge: BridgeManager | null = null

function createSetupWindow() {
  if (setupWin) {
    setupWin.focus()
    return
  }

  setupWin = new BrowserWindow({
    width: 500,
    height: 700,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Setup - Focus Wizard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  setupWin.on('closed', () => {
    setupWin = null
  })

  if (VITE_DEV_SERVER_URL) {
    setupWin.loadURL(`${VITE_DEV_SERVER_URL}setup.html`)
  } else {
    setupWin.loadFile(path.join(RENDERER_DIST, 'setup.html'))
  }
}

function createSettingsWindow() {
  if (settingsWin) {
    settingsWin.show()
    settingsWin.focus()
    return
  }

  settingsWin = new BrowserWindow({
    width: 500,
    height: 700,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Settings - Focus Wizard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  settingsWin.on('closed', () => {
    settingsWin = null
  })

  if (VITE_DEV_SERVER_URL) {
    settingsWin.loadURL(`${VITE_DEV_SERVER_URL}settings.html`)
  } else {
    settingsWin.loadFile(path.join(RENDERER_DIST, 'settings.html'))
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const windowSize = 220
  const margin = 20
  
  win = new BrowserWindow({
    width: windowSize,
    height: windowSize,
    minWidth: windowSize,
    maxWidth: windowSize,
    minHeight: windowSize,
    maxHeight: windowSize,
    x: width - windowSize - margin,
    y: height - windowSize - margin,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    frame: false,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  bridge?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createSetupWindow()
  }
})

app.whenReady().then(createSetupWindow)

ipcMain.handle('focus-wizard:capture-page-screenshot', async () => {
  const primaryDisplay = screen.getPrimaryDisplay()
  const targetWidth = Math.max(1, Math.floor(primaryDisplay.size.width * primaryDisplay.scaleFactor))
  const targetHeight = Math.max(1, Math.floor(primaryDisplay.size.height * primaryDisplay.scaleFactor))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: targetWidth,
      height: targetHeight,
    },
  })

  const source =
    sources.find((item) => item.display_id === String(primaryDisplay.id)) ??
    sources[0]

  if (!source) {
    throw new Error('No screen source available for capture')
  }

  return source.thumbnail.toPNG().toString('base64')
})

ipcMain.handle('focus-wizard:open-settings', () => {
  createSettingsWindow()
})

ipcMain.handle('focus-wizard:start-session', () => {
  if (!win) {
    createWindow()
  } else {
    win.focus()
  }
})

ipcMain.handle('focus-wizard:quit-app', () => {
  app.quit()
})

ipcMain.handle('focus-wizard:open-wallet-page', () => {
  shell.openExternal('http://localhost:8000/wallet')
})

ipcMain.handle('focus-wizard:hide-window', () => {
  // Hide the current focused window (typically settings)
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.hide()
  }
})

// ── Bridge IPC Handlers ──────────────────────────────────

async function startBridge(): Promise<void> {
  const apiKey = process.env.SMARTSPECTRA_API_KEY || ''

  if (!apiKey) {
    console.warn('[Main] No SMARTSPECTRA_API_KEY set — bridge will not start.')
    console.warn('[Main] Set it in your environment or pass it via the app settings.')
    // Send error to all windows
    settingsWin?.webContents.send('bridge:error', 'No SMARTSPECTRA_API_KEY set. Please configure your API key.')
    setupWin?.webContents.send('bridge:error', 'No SMARTSPECTRA_API_KEY set. Please configure your API key.')
    return
  }

  bridge = new BridgeManager({ apiKey, mode: 'docker' })

  bridge.on('ready', () => {
    console.log('[Main] Bridge is ready!')
    settingsWin?.webContents.send('bridge:ready')
    setupWin?.webContents.send('bridge:ready')
  })

  bridge.on('focus', (data: FocusData) => {
    settingsWin?.webContents.send('bridge:focus', data)
    setupWin?.webContents.send('bridge:focus', data)
  })

  bridge.on('metrics', (data: Record<string, unknown>) => {
    settingsWin?.webContents.send('bridge:metrics', data)
    setupWin?.webContents.send('bridge:metrics', data)
  })

  bridge.on('edge', (data: Record<string, unknown>) => {
    settingsWin?.webContents.send('bridge:edge', data)
    setupWin?.webContents.send('bridge:edge', data)
  })

  bridge.on('status', (status: string) => {
    console.log(`[Main] Bridge status: ${status}`)
    settingsWin?.webContents.send('bridge:status', status)
    setupWin?.webContents.send('bridge:status', status)
  })

  bridge.on('bridge-error', (message: string) => {
    console.error(`[Main] Bridge error: ${message}`)
    settingsWin?.webContents.send('bridge:error', message)
    setupWin?.webContents.send('bridge:error', message)
  })

  bridge.on('close', (code: number) => {
    console.log(`[Main] Bridge exited with code ${code}`)
    settingsWin?.webContents.send('bridge:closed', code)
    setupWin?.webContents.send('bridge:closed', code)
  })

  try {
    await bridge.start()
  } catch (err) {
    console.error('[Main] Failed to start bridge:', err)
    const errorMsg = err instanceof Error ? err.message : String(err)
    settingsWin?.webContents.send('bridge:error', errorMsg)
    setupWin?.webContents.send('bridge:error', errorMsg)
  }
}

ipcMain.handle('bridge:start', async (_event, apiKey?: string) => {
  if (apiKey) {
    process.env.SMARTSPECTRA_API_KEY = apiKey
  }
  if (bridge?.running) {
    return { success: true, message: 'Bridge already running' }
  }
  await startBridge()
  return { success: true }
})

ipcMain.handle('bridge:stop', async () => {
  bridge?.stop()
  return { success: true }
})

ipcMain.handle('bridge:status', async () => {
  return {
    running: bridge?.running ?? false,
  }
})

ipcMain.handle('docker:check', async () => {
  return { available: BridgeManager.isDockerAvailable() }
})

ipcMain.on('frame:data', (_event, timestampUs: number, data: Buffer) => {
  const frameWriter = bridge?.frameWriter
  if (!frameWriter) {
    console.warn('[Main] Received frame but frame writer not initialized')
    return
  }
  
  try {
    frameWriter.writeFrame(timestampUs, Buffer.from(data))
    console.log(`[Main] Frame written: ${timestampUs}, size: ${data.length} bytes, count: ${frameWriter.count}`)
  } catch (err) {
    console.error('[Main] Error writing frame:', err)
  }
})

ipcMain.handle('focus-wizard:quit-app', () => {
  app.quit()
})
