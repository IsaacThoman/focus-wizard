import { useEffect, useRef, useState } from 'react'
import {
  getProductivityConfidenceResponseSchema,
  type GetProductivityConfidenceRequest,
} from '@shared/productivitySchemas'
import './App.css'

const PRODUCTIVITY_ENDPOINT = 'http://localhost:8000/getProductivityConfidence'
const SCREENSHOT_INTERVAL_MS = 20_000

function App() {
  const [productivityConfidence, setProductivityConfidence] = useState<number | null>(null)
  const [currentSprite, setCurrentSprite] = useState('wizard-happy.png')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const screenshotInFlightRef = useRef(false)

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Keep a tiny internal resolution; CSS scales it up.
    canvas.width = 64
    canvas.height = 64

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    type SmoothingContext2D = CanvasRenderingContext2D & {
      mozImageSmoothingEnabled?: boolean
      webkitImageSmoothingEnabled?: boolean
      msImageSmoothingEnabled?: boolean
    }

    const sctx = ctx as SmoothingContext2D
    sctx.imageSmoothingEnabled = false
    sctx.mozImageSmoothingEnabled = false
    sctx.webkitImageSmoothingEnabled = false
    sctx.msImageSmoothingEnabled = false

    const img = new Image()
    img.decoding = 'async'
    img.src = new URL(`./sprites/${currentSprite}`, window.location.href).toString()

    const draw = () => {
      ctx.clearRect(0, 0, 64, 64)

      const scale = Math.min(64 / img.width, 64 / img.height)
      const dw = Math.max(1, Math.floor(img.width * scale))
      const dh = Math.max(1, Math.floor(img.height * scale))
      const dx = Math.floor((64 - dw) / 2)
      const dy = Math.floor((64 - dh) / 2)

      ctx.drawImage(img, dx, dy, dw, dh)
    }

    const drawFallback = () => {
      ctx.clearRect(0, 0, 64, 64)
      // Don't fill with black - leave transparent
    }

    img.onload = draw
    img.onerror = drawFallback

    // Initial paint while the image loads.
    drawFallback()

    return () => {
      img.onload = null
      img.onerror = null
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
            width={64} 
            height={64}
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
