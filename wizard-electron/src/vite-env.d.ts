/// <reference types="vite/client" />

interface Window {
  focusWizard?: {
    capturePageScreenshot: () => Promise<string>
    openSettings: () => Promise<void>
    startSession: () => Promise<void>
    quitApp: () => Promise<void>
    openWalletPage: () => Promise<void>
    onTriggerScreenshot: (callback: () => void) => () => void
  }
}
