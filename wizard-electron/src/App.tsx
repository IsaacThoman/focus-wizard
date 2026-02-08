import { useEffect, useRef, useState, useCallback } from "react";
import {
  type GetProductivityConfidenceRequest,
  getProductivityConfidenceResponseSchema,
  type GetAttentivenessRequest,
  getAttentivenessResponseSchema,
} from "@shared/productivitySchemas";
import { SpriteManager, SpriteSheet, NumberRenderer } from "./sprites";
import type { NumberColor } from "./sprites";
import "./App.css";

const PRODUCTIVITY_ENDPOINT = "http://localhost:8000/getProductivityConfidence";
const ATTENTIVENESS_ENDPOINT = "http://localhost:8000/getAttentiveness";
const CANVAS_WIDTH = 80;
const CANVAS_HEIGHT = 120;

export type WizardEmotion = "happy" | "neutral" | "mad";

const EMOTION_ROW: Record<WizardEmotion, number> = {
  happy: 1,
  neutral: 2,
  mad: 0,
};

interface PomodoroSettings {
  pomodoroEnabled: boolean
  pomodoroWorkMinutes: number
  pomodoroBreakMinutes: number
  pomodoroIterations: number
}

interface PomodoroState {
  enabled: boolean
  isRunning: boolean
  timeRemaining: number
  mode: 'work' | 'break'
  iteration: number
  totalIterations: number
}

/** Load an image from a URL and return a promise that resolves when loaded. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function spriteUrl(filename: string): string {
  return new URL(`./sprites/${filename}`, window.location.href).toString();
}

function App() {
  const [productivityConfidence, setProductivityConfidence] = useState<
    number | null
  >(null);
  const [attentiveness, setAttentiveness] = useState<number | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<string>("");
  const productivityConfidenceRef = useRef<number | null>(null);
  const attentivenessRef = useRef<number | null>(null);
  const lastConfidenceAtRef = useRef<number>(0);
  const halfAttentiveSinceRef = useRef<number | null>(null);
  const latestGazeRef = useRef<{ gaze_x: number; gaze_y: number } | null>(null);
  const attentivenessInFlightRef = useRef(false);
  const [emotion, setEmotion] = useState<WizardEmotion>("happy");
  const emotionRef = useRef<WizardEmotion>("happy");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenshotInFlightRef = useRef(false);
  const spriteManagerRef = useRef<SpriteManager | null>(null);
  const numberRendererRef = useRef<NumberRenderer | null>(null);
  const animFrameRef = useRef<number>(0);

  // Pomodoro timer state
  const [pomodoroState, setPomodoroState] = useState<PomodoroState>({
    enabled: false,
    isRunning: false,
    timeRemaining: 25 * 60,
    mode: "work",
    iteration: 1,
    totalIterations: 4,
  });
  const pomodoroIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number>(Date.now());
  const pomodoroStateRef = useRef(pomodoroState);
  const cycleCompletionInFlightRef = useRef(false);

  const handleWandHover = (hovering: boolean) => {
    const manager = spriteManagerRef.current;
    if (!manager) return;
    const wand = manager.get("wand");
    if (wand && wand.kind === "animated") {
      wand.row = hovering ? 1 : 0;
    }
  };

  // Keep pomodoroStateRef in sync for the draw loop
  useEffect(() => {
    pomodoroStateRef.current = pomodoroState;
  }, [pomodoroState]);

  const handleWandAreaClick = () => {
    window.focusWizard?.openSettings();
  };

  const applyEmotionFromSignals = useCallback(() => {
    const now = Date.now();
    const conf = productivityConfidenceRef.current;
    const attn = attentivenessRef.current;

    // Attentiveness override rules
    if (attn === 0) {
      setEmotion("mad");
      return;
    }

    if (attn === 0.5) {
      if (halfAttentiveSinceRef.current === null) {
        halfAttentiveSinceRef.current = now;
      }
      if (now - halfAttentiveSinceRef.current >= 4000) {
        setEmotion("neutral");
        return;
      }
    } else {
      halfAttentiveSinceRef.current = null;
    }

    // Prefer confidence if it's recent; otherwise fall back to attentiveness.
    const confidenceIsFresh = conf !== null && (now - lastConfidenceAtRef.current) < 15000;

    if (confidenceIsFresh) {
      if (conf >= 0.8) setEmotion("happy");
      else if (conf >= 0.2) setEmotion("neutral");
      else setEmotion("mad");
      return;
    }

    if (attn === 1) {
      setEmotion("happy");
    } else if (attn === 0.5) {
      // If we're here, it hasn't been 4s yet—don't force neutral early.
      setEmotion(emotionRef.current);
    } else if (attn === 0) {
      setEmotion("mad");
    }
  }, []);

  // When emotion changes, update the wizard sprite's active row and play poof
  useEffect(() => {
    const prevEmotion = emotionRef.current;
    emotionRef.current = emotion;
    const manager = spriteManagerRef.current;
    if (!manager) return;
    const wizard = manager.get("wizard");
    if (wizard && wizard.kind === "animated") {
      wizard.row = EMOTION_ROW[emotion];
    }

    // Play poof overlay on emotion transitions (skip initial mount)
    if (prevEmotion !== emotion) {
      const poof = manager.get("poof");
      if (poof && poof.kind === "animated") {
        // Row 0 = angry poof at 8fps, Row 1 = other transitions at 6fps
        const isAngryTransition = emotion === "mad";
        poof.row = isAngryTransition ? 0 : 1;
        poof.fps = isAngryTransition ? 8 : 6;
        poof._col = 0;
        poof._elapsed = 0;
        poof.playing = true;
        poof.visible = true;
      }
    }
  }, [emotion]);

  // Load pomodoro settings from localStorage
  const loadPomodoroSettings = useCallback((): PomodoroSettings => {
    const saved = localStorage.getItem("focus-wizard-settings");
    const defaults: PomodoroSettings = {
      pomodoroEnabled: false,
      pomodoroWorkMinutes: 25,
      pomodoroBreakMinutes: 5,
      pomodoroIterations: 4,
    };
    if (saved) {
      try {
        return { ...defaults, ...JSON.parse(saved) };
      } catch (e) {
        console.error("Failed to parse pomodoro settings:", e);
      }
    }
    return defaults;
  }, [])

  // Save pomodoro state to localStorage (for settings window to read)
  const savePomodoroState = useCallback((state: PomodoroState) => {
    localStorage.setItem("focus-wizard-pomodoro-status", JSON.stringify(state));
  }, [])

  // Complete a pomodoro cycle - notify backend to move SOL from vault to earned
  const completePomodoroCycle = useCallback(async () => {
    // Guard against duplicate fires (React strict mode, rapid timer ticks)
    if (cycleCompletionInFlightRef.current) {
      console.log("Cycle completion already in flight, skipping duplicate");
      return;
    }
    cycleCompletionInFlightRef.current = true;

    try {
      const response = await fetch("http://localhost:8000/wallet/complete-cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.warn(
          `Cycle completion failed (${response.status}):`,
          errData.error || "Unknown error"
        );
        return;
      }

      const data = await response.json();
      
      if (data.success) {
        console.log(
          `Pomodoro cycle completed! Earned ${data.rewardAmount} SOL` +
          (data.earnedUsd != null ? ` ($${data.earnedUsd.toFixed(2)} USD)` : "") +
          `. Total earned: ${(data.earnedBalance ?? 0).toFixed(4)} SOL`
        );
      } else {
        console.log("Cycle completed but no SOL moved:", data.error || "Unknown reason");
      }
    } catch (error) {
      console.error("Failed to complete pomodoro cycle:", error);
    } finally {
      cycleCompletionInFlightRef.current = false;
    }
  }, [])

  // Handle timer tick - counts down when happy/neutral, up when mad
  const handleTimerTick = useCallback(() => {
    const now = Date.now();
    const elapsed = Math.floor((now - lastTickRef.current) / 1000);
    if (elapsed <= 0) return;
    // Only advance by the whole seconds consumed, preserving the sub-second remainder
    lastTickRef.current += elapsed * 1000;

    const currentEmotion = emotionRef.current;

    setPomodoroState((prev) => {
      if (!prev.enabled || !prev.isRunning) return prev;

      let newTimeRemaining = prev.timeRemaining;

      // Count down when happy/neutral, count up when mad (penalty)
      if (currentEmotion === "happy" || currentEmotion === "neutral") {
        newTimeRemaining = Math.max(0, prev.timeRemaining - elapsed);
      } else {
        // When mad, add time (penalty)
        const workMinutes = loadPomodoroSettings().pomodoroWorkMinutes;
        const maxPenalty = workMinutes * 60; // Cap at work session length
        newTimeRemaining = Math.min(maxPenalty, prev.timeRemaining + elapsed);
      }

      // Check if timer completed
      if (newTimeRemaining === 0 && currentEmotion !== "mad") {
        // Switch modes
        const newMode = prev.mode === "work" ? "break" : "work";
        const settings = loadPomodoroSettings();
        const newTime = newMode === "work"
          ? settings.pomodoroWorkMinutes * 60
          : settings.pomodoroBreakMinutes * 60;

        // If we just finished a break, increment iteration
        const newIteration = prev.mode === "break"
          ? prev.iteration + 1
          : prev.iteration;

        // When a work session completes successfully, move SOL from vault to earned
        if (prev.mode === "work") {
          void completePomodoroCycle();
        }

        // Stop if all iterations are complete (finished last break)
        if (newIteration > prev.totalIterations) {
          const doneState: PomodoroState = {
            ...prev,
            isRunning: false,
            timeRemaining: 0,
            mode: "work",
            iteration: prev.totalIterations,
          };
          savePomodoroState(doneState);
          return doneState;
        }

        const newState: PomodoroState = {
          ...prev,
          timeRemaining: newTime,
          mode: newMode,
          iteration: newIteration,
        };
        savePomodoroState(newState);
        return newState;
      }

      const newState = { ...prev, timeRemaining: newTimeRemaining };
      savePomodoroState(newState);
      return newState;
    });
  }, [loadPomodoroSettings, savePomodoroState])

  // Keep a ref to the latest handleTimerTick so the interval always calls the latest version
  const handleTimerTickRef = useRef(handleTimerTick);
  useEffect(() => {
    handleTimerTickRef.current = handleTimerTick;
  }, [handleTimerTick]);

  // Initialize pomodoro state from localStorage on mount (runs once)
  useEffect(() => {
    const settings = loadPomodoroSettings();
    const savedState = localStorage.getItem("focus-wizard-pomodoro-status");

    if (savedState && settings.pomodoroEnabled) {
      try {
        const parsed = JSON.parse(savedState);
        const restoredMode = parsed.mode ?? "work";
        // Reset timeRemaining to the full duration on app launch instead of
        // restoring the persisted value — the countdown should not survive
        // an app restart.
        const freshTime = restoredMode === "work"
          ? settings.pomodoroWorkMinutes * 60
          : settings.pomodoroBreakMinutes * 60;
        setPomodoroState({
          enabled: settings.pomodoroEnabled,
          isRunning: parsed.isRunning ?? false,
          timeRemaining: freshTime,
          mode: restoredMode,
          iteration: parsed.iteration ?? 1,
          totalIterations: settings.pomodoroIterations,
        });
      } catch (e) {
        console.error("Failed to parse saved pomodoro state:", e);
        setPomodoroState({
          enabled: settings.pomodoroEnabled,
          isRunning: settings.pomodoroEnabled,
          timeRemaining: settings.pomodoroWorkMinutes * 60,
          mode: "work",
          iteration: 1,
          totalIterations: settings.pomodoroIterations,
        });
      }
    } else {
      setPomodoroState({
        enabled: settings.pomodoroEnabled,
        isRunning: settings.pomodoroEnabled,
        timeRemaining: settings.pomodoroWorkMinutes * 60,
        mode: "work",
        iteration: 1,
        totalIterations: settings.pomodoroIterations,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run the pomodoro timer interval (stable, runs once)
  useEffect(() => {
    lastTickRef.current = Date.now();

    // Start the timer interval — uses ref so callback identity never causes re-setup
    pomodoroIntervalRef.current = setInterval(() => {
      handleTimerTickRef.current();
    }, 1000);

    return () => {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
      }
    };
  }, []);

  // Listen for settings changes from storage events
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "focus-wizard-settings" && e.newValue) {
        try {
          const settings = JSON.parse(e.newValue);
          setPomodoroState((prev) => {
            const newState: PomodoroState = {
              ...prev,
              enabled: settings.pomodoroEnabled ?? prev.enabled,
              totalIterations: settings.pomodoroIterations ?? prev.totalIterations,
            };
            // If enabling and wasn't enabled before, reset
            if (settings.pomodoroEnabled && !prev.enabled) {
              newState.isRunning = true;
              newState.timeRemaining = (settings.pomodoroWorkMinutes ?? 25) * 60;
              newState.mode = "work";
              newState.iteration = 1;
            }
            savePomodoroState(newState);
            return newState;
          });
        } catch (err) {
          console.error("Failed to parse settings update:", err);
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [savePomodoroState])

  // Main render loop: sets up the SpriteManager, loads sprites, runs animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    const manager = new SpriteManager(CANVAS_WIDTH, CANVAS_HEIGHT);
    spriteManagerRef.current = manager;

    let cancelled = false;

    const setup = async () => {
      try {
        // Load pot sprite sheet (320x128, 80x128 frames = 4 frames in a row)
        const potImg = await loadImage(spriteUrl("pot-sheet.png"));
        if (cancelled) return;

        const potSheet = new SpriteSheet(potImg, 80, 128, { frameCount: 4 });
        const potX = Math.floor((CANVAS_WIDTH - 80) / 2);
        const potY = CANVAS_HEIGHT - 128;
        manager.addAnimated("pot", potSheet, potX, potY, {
          fps: 5,
          loop: true,
          playing: true,
          z: 0,
        });

        // Load wizard sprite sheet (400x384, 80x128 frames = 5 cols x 3 rows)
        // Rows: 0=happy, 1=neutral, 2=mad
        const wizardImg = await loadImage(spriteUrl("wizard-sprites.png"));
        if (cancelled) return;

        const wizardSheet = new SpriteSheet(wizardImg, 80, 128);
        const wizX = Math.floor((CANVAS_WIDTH - 80) / 2);
        const wizY = CANVAS_HEIGHT - 128;
        manager.addAnimated("wizard", wizardSheet, wizX, wizY, {
          fps: 5,
          loop: true,
          playing: true,
          row: EMOTION_ROW[emotion],
          z: 1,
        });

        // Load wand-hand sprite sheet (160x256, 80x128 frames = 2 cols x 2 rows)
        // Row 0 = idle wand, Row 1 = sparkle wand (on hover)
        const wandImg = await loadImage(spriteUrl("wand-hand.png"));
        if (cancelled) return;

        const wandSheet = new SpriteSheet(wandImg, 80, 128);
        const wandX = Math.floor((CANVAS_WIDTH - 80) / 2);
        const wandY = CANVAS_HEIGHT - 128;
        manager.addAnimated("wand", wandSheet, wandX, wandY, {
          fps: 2,
          loop: true,
          playing: true,
          row: 0,
          z: 2,
        });

        // Load poof sprite sheet (480x256, 80x128 frames = 6 cols x 2 rows)
        // Row 0 = angry transition poof (smoke), Row 1 = other transitions (sparkle)
        const poofImg = await loadImage(spriteUrl("wizard-poof.png"));
        if (cancelled) return;

        const poofSheet = new SpriteSheet(poofImg, 80, 128);
        const poofX = Math.floor((CANVAS_WIDTH - 80) / 2);
        const poofY = CANVAS_HEIGHT - 128;
        manager.addAnimated("poof", poofSheet, poofX, poofY, {
          fps: 8,
          loop: false,
          playing: false,
          visible: false,
          row: 0,
          z: 3,
          onComplete: () => {
            const p = manager.get("poof");
            if (p && p.kind === "animated") {
              p.visible = false;
            }
          },
        });

        // Load number sprites for pomodoro timer display on the pot
        const numberImg = await loadImage(spriteUrl("number-sprites.png"));
        if (cancelled) return;
        numberRendererRef.current = new NumberRenderer(numberImg);
      } catch (err) {
        console.error("Failed to load sprites:", err);
        if (!cancelled) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }
      }
    };

    void setup();

    // Helper: pick number sprite colour based on pomodoro state
    const getTimerColor = (): NumberColor => {
      const ps = pomodoroStateRef.current;
      if (ps.mode === "break") return "green";
      // During work: blue when counting down, red when counting up (penalty)
      if (emotionRef.current === "mad") return "red";
      return "blue";
    };

    // Animation loop
    let lastTime = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const delta = now - lastTime;
      lastTime = now;

      manager.update(delta);
      manager.draw(ctx);

      // Draw pomodoro timer on the pot using sprite numbers
      const ps = pomodoroStateRef.current;
      const nr = numberRendererRef.current;
      if (ps.enabled && nr) {
        const mins = Math.floor(Math.abs(ps.timeRemaining) / 60);
        const secs = Math.abs(ps.timeRemaining) % 60;
        const timeStr =
          mins.toString().padStart(2, "0") +
          ":" +
          secs.toString().padStart(2, "0");
        const color = getTimerColor();

        // Centre the time string on the pot (canvas centre, near bottom)
        nr.drawTextCentered(ctx, timeStr, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 24, color);
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animFrameRef.current);
      spriteManagerRef.current = null;
    };
  }, []);

  // Screenshot submission — triggered by main process via IPC when screen
  // content changes significantly or after an idle timeout.
  useEffect(() => {
    let isMounted = true;

    const captureAndSubmitScreenshot = async () => {
      if (screenshotInFlightRef.current) return;
      if (!window.focusWizard?.capturePageScreenshot) return;

      screenshotInFlightRef.current = true;

      try {
        const screenshotBase64 = await window.focusWizard
          .capturePageScreenshot();

        const payload: GetProductivityConfidenceRequest = {
          screenshotBase64,
          capturedAt: new Date().toISOString(),
        };

        // Read positive/negative prompts from settings and attach to payload
        try {
          const savedSettings = localStorage.getItem("focus-wizard-settings");
          if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            if (parsed.positivePrompt) {
              payload.positivePrompt = parsed.positivePrompt;
            }
            if (parsed.negativePrompt) {
              payload.negativePrompt = parsed.negativePrompt;
            }
          }
        } catch (e) {
          console.error("Failed to read prompts from settings:", e);
        }

        const response = await fetch(PRODUCTIVITY_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          return;
        }

        const json = await response.json();
        const parsed = getProductivityConfidenceResponseSchema.safeParse(json);

        if (parsed.success && isMounted) {
          const confidence = parsed.data.productivityConfidence;
          setProductivityConfidence(confidence);

          productivityConfidenceRef.current = confidence;
          lastConfidenceAtRef.current = Date.now();

          applyEmotionFromSignals();
        }
      } catch (error) {
        console.error("Failed to submit screenshot:", error);
      } finally {
        screenshotInFlightRef.current = false;
      }
    };

    // Listen for trigger signals from the main process screen-diff monitor
    const unsubscribe = window.focusWizard?.onTriggerScreenshot(() => {
      void captureAndSubmitScreenshot();
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  // Subscribe to bridge focus + status so we can fetch attentiveness.
  useEffect(() => {
    const api = window.wizardAPI;
    if (!api) return;

    const unsubs = [
      api.onFocus((data: any) => {
        if (data && typeof data.gaze_x === "number" && typeof data.gaze_y === "number") {
          latestGazeRef.current = { gaze_x: data.gaze_x, gaze_y: data.gaze_y };
        }
      }),
      api.onStatus((s: string) => {
        setBridgeStatus(s);
      }),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, []);

  // Fetch attentiveness from Deno every second (independent of screenshot logic)
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (attentivenessInFlightRef.current) return;

      const gaze = latestGazeRef.current;
      if (!gaze) return;

      attentivenessInFlightRef.current = true;
      try {
        const payload: GetAttentivenessRequest = {
          gaze_x: gaze.gaze_x,
          gaze_y: gaze.gaze_y,
          bridgeStatus: bridgeStatus || "unknown",
          capturedAt: new Date().toISOString(),
        };

        const resp = await fetch(ATTENTIVENESS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) return;

        const json = await resp.json();
        const parsed = getAttentivenessResponseSchema.safeParse(json);
        if (!parsed.success) return;

        if (!cancelled) {
          setAttentiveness(parsed.data.attentiveness);
          attentivenessRef.current = parsed.data.attentiveness;
          applyEmotionFromSignals();
        }
      } catch {
        // ignore - keep last value
      } finally {
        attentivenessInFlightRef.current = false;
      }
    };

    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [bridgeStatus, applyEmotionFromSignals]);

  return (
    <>
      <main className="pixel-stage">
        <div className="wizard-area">
          <canvas
            ref={canvasRef}
            className="pixel-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{ cursor: "default" }}
          />
          <div
            className="wand-hotspot"
            onMouseEnter={() => handleWandHover(true)}
            onMouseLeave={() => handleWandHover(false)}
            onClick={handleWandAreaClick}
          />
        </div>

        <div className="confidence-monitor">
          Conf: {productivityConfidence === null
            ? "--"
            : productivityConfidence.toFixed(2)}
          {"  "}
          Attn: {attentiveness === null ? "--" : attentiveness.toFixed(2)}
        </div>
      </main>
    </>
  );
}

export default App;
