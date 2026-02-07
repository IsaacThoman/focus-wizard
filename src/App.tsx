import { useEffect, useRef, useState } from 'react'
import './App.css'

function App() {
  const [showTitlebar, setShowTitlebar] = useState(false)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const showElements = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
      setShowTitlebar(true)
    }

    const scheduleHide = () => {
      hideTimerRef.current = setTimeout(() => {
        setShowTitlebar(false)
      }, 5000)
    }

    document.body.addEventListener('mouseenter', showElements, true)
    document.body.addEventListener('mousemove', showElements, true)
    document.body.addEventListener('mouseleave', scheduleHide, true)

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
      document.body.removeEventListener('mouseenter', showElements, true)
      document.body.removeEventListener('mousemove', showElements, true)
      document.body.removeEventListener('mouseleave', scheduleHide, true)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Keep a tiny internal resolution; CSS scales it up.
    canvas.width = 64
    canvas.height = 64

    const ctx = canvas.getContext('2d')
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
    img.src = new URL('./sprites/wizard-happy.png', window.location.href).toString()

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
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, 64, 64)
    }

    img.onload = draw
    img.onerror = drawFallback

    // Initial paint while the image loads.
    drawFallback()

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [])

  return (
    <>
      <div className={`window-titlebar ${showTitlebar ? 'visible' : ''}`} />
      <main className="pixel-stage">
        <canvas ref={canvasRef} className="pixel-canvas" width={64} height={64} />
      </main>
    </>
  )
}

export default App
