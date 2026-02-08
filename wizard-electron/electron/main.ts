import "dotenv/config";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  shell,
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BridgeManager, FocusData } from "./bridge-manager";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let bridge: BridgeManager | null = null;

function createSettingsWindow(mode: "setup" | "settings" = "settings") {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 500,
    height: 700,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: mode === "setup"
      ? "Setup - Focus Wizard"
      : "Settings - Focus Wizard",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  settingsWin.on("closed", () => {
    settingsWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    settingsWin.loadURL(`${VITE_DEV_SERVER_URL}settings.html?mode=${mode}`);
  } else {
    settingsWin.loadFile(path.join(RENDERER_DIST, "settings.html"), {
      query: { mode },
    });
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 246;
  const windowHeight = 369;
  const margin = 20;

  win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: windowWidth,
    maxWidth: windowWidth,
    minHeight: windowHeight,
    maxHeight: windowHeight,
    x: width - windowWidth - margin,
    y: height - windowHeight - margin,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send(
      "main-process-message",
      (new Date()).toLocaleString(),
    );
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  bridge?.stop();
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createSettingsWindow("setup");
  }
});

// ---------------------------------------------------------------------------
// Screen-diff monitor
//
// Captures a low-res screenshot every 1 s and computes a 0-1 delta between
// consecutive frames. When a significant change is detected (delta > threshold)
// it tells the renderer to submit a screenshot for productivity analysis.
//
// Trigger rules:
//   1. delta > DELTA_THRESHOLD  → trigger immediately (subject to cooldown)
//   2. Cooldown of DEBOUNCE_MS from the *start* of the last triggered call.
//      If a trigger fires during cooldown, it is queued and fires as soon as
//      the cooldown expires.
//   3. If no trigger has fired for IDLE_TRIGGER_MS, fire automatically.
// ---------------------------------------------------------------------------
const DELTA_THRESHOLD = 0.15;
const DEBOUNCE_MS = 5_000;
const IDLE_TRIGGER_MS = 15_000;

let previousBitmap: Buffer | null = null;
let screenDiffInterval: ReturnType<typeof setInterval> | null = null;

// Debounce / idle state
let lastTriggerTime = 0; // Date.now() when we last sent the trigger
let pendingTriggerTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function captureScreenBitmap(): Promise<
  { bitmap: Buffer; width: number; height: number }
> {
  const primaryDisplay = screen.getPrimaryDisplay();
  // 480p-ish is plenty for change detection and keeps memory + CPU low.
  const scale = 480 / primaryDisplay.size.height;
  const thumbWidth = Math.max(1, Math.round(primaryDisplay.size.width * scale));
  const thumbHeight = Math.max(
    1,
    Math.round(primaryDisplay.size.height * scale),
  );

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: thumbWidth, height: thumbHeight },
  });

  const source =
    sources.find((s) => s.display_id === String(primaryDisplay.id)) ??
      sources[0];

  if (!source) throw new Error("No screen source available");

  const img = source.thumbnail;
  const bitmap = img.toBitmap();
  const size = img.getSize();
  return { bitmap, width: size.width, height: size.height };
}

function computeDelta(a: Buffer, b: Buffer): number {
  const len = Math.min(a.length, b.length);
  let totalDiff = 0;
  let pixelCount = 0;

  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    totalDiff += (dr + dg + db) / (3 * 255);
    pixelCount++;
  }

  return pixelCount === 0 ? 0 : totalDiff / pixelCount;
}

/** Send the "take a screenshot now" signal to the renderer window. */
function emitScreenshotTrigger() {
  lastTriggerTime = Date.now();
  resetIdleTimer();
  win?.webContents.send("focus-wizard:trigger-screenshot");
}

/** Reset the idle timer so it fires IDLE_TRIGGER_MS after the last trigger. */
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    emitScreenshotTrigger();
  }, IDLE_TRIGGER_MS);
}

/**
 * Request a screenshot submission. Respects the debounce cooldown:
 *  - If enough time has passed, fire immediately.
 *  - Otherwise, schedule to fire at the end of the cooldown (coalescing
 *    multiple requests into one).
 */
function requestScreenshotTrigger() {
  const now = Date.now();
  const elapsed = now - lastTriggerTime;

  if (elapsed >= DEBOUNCE_MS) {
    // Cooldown has passed — fire now
    if (pendingTriggerTimer) {
      clearTimeout(pendingTriggerTimer);
      pendingTriggerTimer = null;
    }
    emitScreenshotTrigger();
  } else if (!pendingTriggerTimer) {
    // Schedule to fire as soon as cooldown expires
    const remaining = DEBOUNCE_MS - elapsed;
    pendingTriggerTimer = setTimeout(() => {
      pendingTriggerTimer = null;
      emitScreenshotTrigger();
    }, remaining);
  }
  // If a pending timer already exists, we just let it fire — no need to
  // reschedule since it will already fire at the earliest allowed time.
}

function startScreenDiffMonitor() {
  if (screenDiffInterval) return;

  // Kick off the idle timer so we get a trigger even if nothing changes
  resetIdleTimer();

  screenDiffInterval = setInterval(async () => {
    try {
      const { bitmap } = await captureScreenBitmap();

      if (previousBitmap && previousBitmap.length === bitmap.length) {
        const delta = computeDelta(previousBitmap, bitmap);
        if (delta > DELTA_THRESHOLD) {
          requestScreenshotTrigger();
        }
      }

      previousBitmap = bitmap;
    } catch (err) {
      console.error("[screen-diff] capture error:", err);
    }
  }, 1_000);
}
app.on("before-quit", () => {
  bridge?.stop();
});

app.whenReady().then(() => {
  createSettingsWindow("setup");
  startScreenDiffMonitor();
});

ipcMain.handle("focus-wizard:capture-page-screenshot", async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const targetWidth = Math.max(
    1,
    Math.floor(primaryDisplay.size.width * primaryDisplay.scaleFactor),
  );
  const targetHeight = Math.max(
    1,
    Math.floor(primaryDisplay.size.height * primaryDisplay.scaleFactor),
  );

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: targetWidth,
      height: targetHeight,
    },
  });

  const source = sources.find((item) =>
    item.display_id === String(primaryDisplay.id)
  ) ??
    sources[0];

  if (!source) {
    throw new Error("No screen source available for capture");
  }

  return source.thumbnail.toPNG().toString("base64");
});

ipcMain.handle("focus-wizard:open-settings", () => {
  createSettingsWindow();
});

ipcMain.handle("focus-wizard:start-session", () => {
  if (!win) {
    createWindow();
  } else {
    win.focus();
  }
});

ipcMain.handle("focus-wizard:hide-window", () => {
  // Hide the current focused window (typically settings)
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.hide();
  }
});

// ── Bridge IPC Handlers ──────────────────────────────────

async function startBridge(): Promise<void> {
  const apiKey = process.env.SMARTSPECTRA_API_KEY || "";

  if (!apiKey) {
    console.warn("[Main] No SMARTSPECTRA_API_KEY set — bridge will not start.");
    console.warn(
      "[Main] Set it in your environment or pass it via the app settings.",
    );
    // Send error to all windows
    settingsWin?.webContents.send(
      "bridge:error",
      "No SMARTSPECTRA_API_KEY set. Please configure your API key.",
    );
    return;
  }

  bridge = new BridgeManager({ apiKey, mode: "docker" });

  bridge.on("ready", () => {
    console.log("[Main] Bridge is ready!");
    settingsWin?.webContents.send("bridge:ready");
  });

  bridge.on("focus", (data: FocusData) => {
    settingsWin?.webContents.send("bridge:focus", data);
  });

  bridge.on("metrics", (data: Record<string, unknown>) => {
    settingsWin?.webContents.send("bridge:metrics", data);
  });

  bridge.on("edge", (data: Record<string, unknown>) => {
    settingsWin?.webContents.send("bridge:edge", data);
  });

  bridge.on("status", (status: string) => {
    console.log(`[Main] Bridge status: ${status}`);
    settingsWin?.webContents.send("bridge:status", status);
  });

  bridge.on("bridge-error", (message: string) => {
    console.error(`[Main] Bridge error: ${message}`);
    settingsWin?.webContents.send("bridge:error", message);
  });

  bridge.on("close", (code: number) => {
    console.log(`[Main] Bridge exited with code ${code}`);
    settingsWin?.webContents.send("bridge:closed", code);
  });

  try {
    await bridge.start();
  } catch (err) {
    console.error("[Main] Failed to start bridge:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    settingsWin?.webContents.send("bridge:error", errorMsg);
  }
}
// keep all above

ipcMain.handle("bridge:start", async (_event, apiKey?: string) => {
  if (apiKey) {
    process.env.SMARTSPECTRA_API_KEY = apiKey;
  }
  if (bridge?.running) {
    return { success: true, message: "Bridge already running" };
  }
  await startBridge();
  return { success: true };
});

ipcMain.handle("bridge:stop", async () => {
  bridge?.stop();
  return { success: true };
});

ipcMain.handle("bridge:status", async () => {
  return {
    running: bridge?.running ?? false,
  };
});

ipcMain.handle("docker:check", async () => {
  return { available: BridgeManager.isDockerAvailable() };
});

ipcMain.on("frame:data", (_event, timestampUs: number, data: Buffer) => {
  const frameWriter = bridge?.frameWriter;
  if (!frameWriter) {
    console.warn("[Main] Received frame but frame writer not initialized");
    return;
  }

  try {
    frameWriter.writeFrame(timestampUs, Buffer.from(data));
    console.log(
      `[Main] Frame written: ${timestampUs}, size: ${data.length} bytes, count: ${frameWriter.count}`,
    );
  } catch (err) {
    console.error("[Main] Error writing frame:", err);
  }
});

ipcMain.handle("focus-wizard:quit-app", () => {
  app.quit();
});

ipcMain.handle("focus-wizard:open-wallet-page", () => {
  shell.openExternal("http://localhost:8000/wallet");
});
