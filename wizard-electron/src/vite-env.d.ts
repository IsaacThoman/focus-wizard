/// <reference types="vite/client" />

interface Window {
  focusWizard?: {
    capturePageScreenshot: () => Promise<string>;
    openSettings: () => Promise<void>;
    startSession: () => Promise<void>;
    quitApp: () => Promise<void>;
    openWalletPage: () => Promise<void>;
    triggerSpell: () => Promise<void>;
    dismissSpell: () => Promise<void>;
    closeSpellOverlay: () => Promise<void>;
    onDismissSpell: (callback: () => void) => () => void;
    onTriggerScreenshot: (callback: () => void) => () => void;
  };
}
