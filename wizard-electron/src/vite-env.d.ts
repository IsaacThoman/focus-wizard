/// <reference types="vite/client" />

interface Window {
  wizardAPI?: {
    capturePageScreenshot: () => Promise<string>;
    openSettings: () => Promise<void>;
    startSession: () => Promise<void>;
    quitApp: () => Promise<void>;
    hideWindow: () => Promise<void>;

    speak: (
      text: string,
    ) => Promise<
      | { ok: true; mimeType?: string; audio: Uint8Array }
      | { ok: false; error: string }
    >;

    startBridge: (apiKey?: string) => Promise<unknown>;
    stopBridge: () => Promise<unknown>;
    getBridgeStatus: () => Promise<{ running: boolean; status?: string }>
    checkDocker: () => Promise<{ available: boolean }>;

    sendFrame: (timestampUs: number, data: ArrayBuffer) => void;

    onFocus: (callback: (data: any) => void) => () => void;
    onMetrics: (callback: (data: any) => void) => () => void;
    onEdge: (callback: (data: any) => void) => () => void;
    onStatus: (callback: (status: string) => void) => () => void;
    onError: (callback: (message: string) => void) => () => void;
    onReady: (callback: () => void) => () => void;
    onClosed: (callback: (code?: number) => void) => () => void;
  };

  focusWizard?: {
    capturePageScreenshot: () => Promise<string>;
    openSettings: () => Promise<void>;
    startSession: () => Promise<void>;
    quitApp: () => Promise<void>;
    openWalletPage: () => Promise<void>;
    onTriggerScreenshot: (callback: () => void) => () => void;
  };
}
