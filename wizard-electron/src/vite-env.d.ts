/// <reference types="vite/client" />

interface Window {
  focusWizard?: {
    capturePageScreenshot: () => Promise<string>
  }
}
