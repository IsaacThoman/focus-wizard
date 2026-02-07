import { useEffect, useRef, useState } from 'react'
import {
  getProductivityConfidenceResponseSchema,
  type GetProductivityConfidenceRequest,
} from '@shared/productivitySchemas'
import { SpriteSheet, SpriteManager } from './sprites'
import './App.css'

const PRODUCTIVITY_ENDPOINT = 'http://localhost:8000/getProductivityConfidence'
const SCREENSHOT_INTERVAL_MS = 20_000
const CANVAS_SIZE = 128

export type WizardEmotion = 'happy' | 'neutral' | 'mad'

const EMOTION_ROW: Record<WizardEmotion, number> = {
  happy: 0,
  neutral: 1,
  mad: 2,
}

/** Load an image from a URL and return a promise that resolves when loaded. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function spriteUrl(filename: string): string {
  return new URL(`./sprites/${filename}`, window.location.href).toString()
}

function App() {
  const [productivityConfidence, setProductivityConfidence] = useState<number | null>(null)
  const [emotion, setEmotion] = useState<WizardEmotion>('happy')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const screenshotInFlightRef = useRef(false)
  const spriteManagerRef = useRef<SpriteManager | null>(null)
  const animFrameRef = useRef<number>(0)

  const handleWandAreaClick = () => {
    window.focusWizard?.openSettings()
  }

  // When emotion changes, update the wizard sprite's active row
  useEffect(() => {
    const manager = spriteManagerRef.current
    if (!manager) return
    const wizard = manager.get('wizard')
    if (wizard && wizard.kind === 'animated') {
      wizard.row = EMOTION_ROW[emotion]
    }
  }, [emotion])

  // Main render loop: sets up the SpriteManager, loads sprites, runs animation
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false

    const manager = new SpriteManager(CANVAS_SIZE, CANVAS_SIZE)
    spriteManagerRef.current = manager

    let cancelled = false

    const setup = async () => {
      try {
        // Load pot sprite sheet (320x128, 80x128 frames = 4 frames in a row)
        const potImg = await loadImage(spriteUrl('pot-sheet.png'))
        if (cancelled) return

        const potSheet = new SpriteSheet(potImg, 80, 128, { frameCount: 4 })
        const potX = Math.floor((CANVAS_SIZE - 80) / 2)
        const potY = CANVAS_SIZE - 128
        manager.addAnimated('pot', potSheet, potX, potY, {
          fps: 6,
          loop: true,
          playing: true,
          z: 0,
        })

        // Load wizard sprite sheet (400x384, 80x128 frames = 5 cols x 3 rows)
        // Rows: 0=happy, 1=neutral, 2=mad
        const wizardImg = await loadImage(spriteUrl('wizard-sprites.png'))
        if (cancelled) return

        const wizardSheet = new SpriteSheet(wizardImg, 80, 128)
        const wizX = Math.floor((CANVAS_SIZE - 80) / 2)
        const wizY = CANVAS_SIZE - 128
        manager.addAnimated('wizard', wizardSheet, wizX, wizY, {
          fps: 6,
          loop: true,
          playing: true,
          row: EMOTION_ROW[emotion],
          z: 1,
        })
      } catch (err) {
        console.error('Failed to load sprites:', err)
        if (!cancelled) {
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
        }
      }
    }

    void setup()

    // Animation loop
    let lastTime = performance.now()
    const tick = (now: number) => {
      if (cancelled) return
      const delta = now - lastTime
      lastTime = now

      manager.update(delta)
      manager.draw(ctx)

      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      spriteManagerRef.current = null
    }
  }, [])

  // Screenshot polling for productivity confidence
  useEffect(() => {
    let isMounted = true

    const captureAndSubmitScreenshot = async () => {
      if (screenshotInFlightRef.current) return
      if (!window.focusWizard?.capturePageScreenshot) return

      screenshotInFlightRef.current = true

      try {
        const screenshotBase64 = await window.focusWizard.capturePageScreenshot()

        const payload: GetProductivityConfidenceRequest = {
          screenshotBase64,
          capturedAt: new Date().toISOString(),
        }

        const response = await fetch(PRODUCTIVITY_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          return
        }

        const json = await response.json()
        const parsed = getProductivityConfidenceResponseSchema.safeParse(json)

        if (parsed.success && isMounted) {
          const confidence = parsed.data.productivityConfidence
          setProductivityConfidence(confidence)

          // Drive wizard emotion from productivity score
          if (confidence >= 0.6) {
            setEmotion('happy')
          } else if (confidence >= 0.3) {
            setEmotion('neutral')
          } else {
            setEmotion('mad')
          }
        }
      } catch (error) {
        console.error('Failed to submit screenshot:', error)
      } finally {
        screenshotInFlightRef.current = false
      }
    }

    void captureAndSubmitScreenshot()
    const intervalId = setInterval(() => {
      void captureAndSubmitScreenshot()
    }, SCREENSHOT_INTERVAL_MS)

    return () => {
      isMounted = false
      clearInterval(intervalId)
    }
  }, [])

  return (
    <>
      <main className="pixel-stage">
        <div className="wizard-area">
          <canvas 
            ref={canvasRef} 
            className="pixel-canvas" 
            width={CANVAS_SIZE} 
            height={CANVAS_SIZE}
            style={{ cursor: 'default' }}
          />
          <div 
            className="wand-hotspot"
            onClick={handleWandAreaClick}
          />
        </div>
        <div className="confidence-pill">
          Confidence:{' '}
          {productivityConfidence === null ? '--' : productivityConfidence.toFixed(2)}
        </div>
      </main>
    </>
  )
}

export default App
