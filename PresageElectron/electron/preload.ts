/**
 * preload.ts — Electron preload script
 *
 * Exposes a safe API to the renderer process via contextBridge.
 * The renderer (React app) uses window.focusWizard to interact
 * with the bridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface FocusWizardAPI {
  /** Start the C++ bridge (optionally with an API key) */
  startBridge: (apiKey?: string) => Promise<{ success: boolean; message?: string }>;
  /** Stop the C++ bridge */
  stopBridge: () => Promise<{ success: boolean }>;
  /** Get bridge running status */
  getBridgeStatus: () => Promise<{ running: boolean }>;
  /** Check if Docker is available */
  checkDocker: () => Promise<{ available: boolean }>;

  /**
   * Send a webcam frame to the main process for writing to the
   * Docker shared volume.
   * @param timestampUs - Frame timestamp in microseconds
   * @param data        - JPEG image data as ArrayBuffer
   */
  sendFrame: (timestampUs: number, data: ArrayBuffer) => void;

  /** Listen for focus state updates */
  onFocus: (callback: (data: unknown) => void) => () => void;
  /** Listen for raw metrics updates */
  onMetrics: (callback: (data: unknown) => void) => () => void;
  /** Listen for edge metrics updates */
  onEdge: (callback: (data: unknown) => void) => () => void;
  /** Listen for status messages */
  onStatus: (callback: (status: string) => void) => () => void;
  /** Listen for error messages */
  onError: (callback: (message: string) => void) => () => void;
  /** Listen for bridge ready */
  onReady: (callback: () => void) => () => void;
  /** Listen for bridge close */
  onClosed: (callback: (code: number) => void) => () => void;
}

function createListener(channel: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (callback: (...args: any[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  };
}

contextBridge.exposeInMainWorld('focusWizard', {
  startBridge: (apiKey?: string) => ipcRenderer.invoke('bridge:start', apiKey),
  stopBridge: () => ipcRenderer.invoke('bridge:stop'),
  getBridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  checkDocker: () => ipcRenderer.invoke('docker:check'),

  // Fire-and-forget: send frame data to main process for disk write
  sendFrame: (timestampUs: number, data: ArrayBuffer) => {
    ipcRenderer.send('frame:data', timestampUs, data);
  },

  onFocus: createListener('bridge:focus'),
  onMetrics: createListener('bridge:metrics'),
  onEdge: createListener('bridge:edge'),
  onStatus: createListener('bridge:status'),
  onError: createListener('bridge:error'),
  onReady: createListener('bridge:ready'),
  onClosed: createListener('bridge:closed'),
} satisfies FocusWizardAPI);
