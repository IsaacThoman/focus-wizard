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
  const [currentSprite, setCurrentSprite] = useState('wizard-happy.png')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const screenshotInFlightRef = useRef(false)
  const spriteManagerRef = useRef<SpriteManager | null>(null)
  const animFrameRef = useRef<number>(0)

  const handleWizardAreaMouseEnter = () => {
    setCurrentSprite('wizard-wand.png')
  }

  const handleWizardAreaMouseLeave = () => {
    setCurrentSprite('wizard-happy.png')
  }

  const handleWandAreaMouseEnter = () => {
    setCurrentSprite('wizard-wand-sparkle.png')
  }

  const handleWandAreaMouseLeave = () => {
    setCurrentSprite('wizard-wand.png')
  }

  const handleWandAreaClick = () => {
    window.focusWizard?.openSettings()
  }

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
        // Load the pot sprite sheet (320x128, 80x128 frames = 4 frames in a row)
        if (!manager.has('pot')) {
          const potImg = await loadImage(spriteUrl('pot-sheet.png'))
          if (cancelled) return

          const potSheet = new SpriteSheet(potImg, 80, 128, { frameCount: 4 })
          // Place the pot centered on the canvas
          const potX = Math.floor((CANVAS_SIZE - 80) / 2)
          const potY = Math.floor((CANVAS_SIZE - 128) / 2)
          manager.addAnimated('pot', potSheet, potX, potY, {
            fps: 6,
            loop: true,
            playing: true,
            z: 0,
          })
        }
      } catch (err) {
        console.error('Failed to load sprites:', err)
        // Fallback: draw a black rect
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
  }, [currentSprite])

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
          setProductivityConfidence(parsed.data.productivityConfidence)
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
      {/* <div className={`window-titlebar ${showTitlebar ? 'visible' : ''}`} /> */}
      <main className="pixel-stage">
        <div 
          className="wizard-area"
          onMouseEnter={handleWizardAreaMouseEnter}
          onMouseLeave={handleWizardAreaMouseLeave}
        >
          <canvas 
            ref={canvasRef} 
            className="pixel-canvas" 
            width={CANVAS_SIZE} 
            height={CANVAS_SIZE}
            style={{ 
              cursor: 'default'
            }}
          />
          <div 
            className="wand-hotspot"
            onMouseEnter={handleWandAreaMouseEnter}
            onMouseLeave={handleWandAreaMouseLeave}
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
