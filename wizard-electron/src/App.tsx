import { useEffect, useRef, useState } from "react";
import {
  type GetProductivityConfidenceRequest,
  getProductivityConfidenceResponseSchema,
} from "@shared/productivitySchemas";
import { SpriteManager, SpriteSheet } from "./sprites";
import "./App.css";

const PRODUCTIVITY_ENDPOINT = "http://localhost:8000/getProductivityConfidence";
const CANVAS_WIDTH = 80;
const CANVAS_HEIGHT = 120;

export type WizardEmotion = "happy" | "neutral" | "mad";

const EMOTION_ROW: Record<WizardEmotion, number> = {
  happy: 1,
  neutral: 2,
  mad: 0,
};

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
  const [emotion, setEmotion] = useState<WizardEmotion>("happy");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenshotInFlightRef = useRef(false);
  const spriteManagerRef = useRef<SpriteManager | null>(null);
  const animFrameRef = useRef<number>(0);

  const handleWandHover = (hovering: boolean) => {
    const manager = spriteManagerRef.current;
    if (!manager) return;
    const wand = manager.get("wand");
    if (wand && wand.kind === "animated") {
      wand.row = hovering ? 1 : 0;
    }
  };

  const handleWandAreaClick = () => {
    window.focusWizard?.openSettings();
  };

  // When emotion changes, update the wizard sprite's active row
  useEffect(() => {
    const manager = spriteManagerRef.current;
    if (!manager) return;
    const wizard = manager.get("wizard");
    if (wizard && wizard.kind === "animated") {
      wizard.row = EMOTION_ROW[emotion];
    }
  }, [emotion]);

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
      } catch (err) {
        console.error("Failed to load sprites:", err);
        if (!cancelled) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }
      }
    };

    void setup();

    // Animation loop
    let lastTime = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const delta = now - lastTime;
      lastTime = now;

      manager.update(delta);
      manager.draw(ctx);

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

          // Drive wizard emotion from productivity score
          if (confidence >= 0.8) {
            setEmotion("happy");
          } else if (confidence >= 0.2) {
            setEmotion("neutral");
          } else {
            setEmotion("mad");
          }
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
        <div className="confidence-pill">
          Confidence: {productivityConfidence === null
            ? "--"
            : productivityConfidence.toFixed(2)}
        </div>
      </main>
    </>
  );
}

export default App;
