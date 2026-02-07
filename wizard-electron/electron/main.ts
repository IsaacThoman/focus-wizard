import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

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

function createSettingsWindow(mode: 'setup' | 'settings' = 'settings') {
  if (settingsWin) {
    settingsWin.focus()
    return
  }

  settingsWin = new BrowserWindow({
    width: 500,
    height: 700,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: mode === 'setup' ? 'Setup - Focus Wizard' : 'Settings - Focus Wizard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  settingsWin.on('closed', () => {
    settingsWin = null
  })

  if (VITE_DEV_SERVER_URL) {
    settingsWin.loadURL(`${VITE_DEV_SERVER_URL}settings.html?mode=${mode}`)
  } else {
    settingsWin.loadFile(path.join(RENDERER_DIST, 'settings.html'), {
      query: { mode },
    })
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
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createSettingsWindow('setup')
  }
})

app.whenReady().then(() => createSettingsWindow('setup'))

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

