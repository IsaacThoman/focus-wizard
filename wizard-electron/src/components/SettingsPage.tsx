import { useEffect, useState } from 'react'
import './Settings.css'

export interface SettingsData {
  pomodoroWorkMinutes: number
  pomodoroBreakMinutes: number
  employerCode: string
}

const DEFAULT_SETTINGS: SettingsData = {
  pomodoroWorkMinutes: 25,
  pomodoroBreakMinutes: 5,
  employerCode: '',
}

interface Sparkle {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  rotationSpeed: number
  settled: boolean
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)
  const [focusSparkles, setFocusSparkles] = useState<Sparkle[]>([])

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('focus-wizard-settings')
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings)
        setSettings({ ...DEFAULT_SETTINGS, ...parsed })
      } catch (e) {
        console.error('Failed to parse saved settings:', e)
      }
    }
  }, [])

  const handleSave = () => {
    localStorage.setItem('focus-wizard-settings', JSON.stringify(settings))
    window.close()
  }

  const handleCancel = () => {
    window.close()
  }

  const handleEmployerCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6)
    setSettings({ ...settings, employerCode: value })
  }

  const handleWorkMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10)
    if (!isNaN(value) && value > 0 && value <= 240) {
      setSettings({ ...settings, pomodoroWorkMinutes: value })
    }
  }

  const handleBreakMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10)
    if (!isNaN(value) && value > 0 && value <= 60) {
      setSettings({ ...settings, pomodoroBreakMinutes: value })
    }
  }

  // Physics simulation for sparkles
  useEffect(() => {
    if (focusSparkles.length === 0) return

    const GRAVITY = 0.3
    const BOUNCE_DAMPING = 0.6
    const FRICTION = 0.98
    const FLOOR_Y = window.innerHeight - 40
    const SETTLE_THRESHOLD = 0.5

    let animationFrameId: number

    const updateSparkles = () => {
      setFocusSparkles((prevSparkles) => {
        const updated = prevSparkles.map((sparkle) => {
          if (sparkle.settled) return sparkle

          let { x, y, vx, vy, rotation, rotationSpeed } = sparkle

          // Apply gravity
          vy += GRAVITY

          // Apply velocity
          x += vx
          y += vy

          // Apply friction
          vx *= FRICTION

          // Bounce off walls
          if (x <= 10 || x >= window.innerWidth - 10) {
            vx = -vx * BOUNCE_DAMPING
            x = x <= 10 ? 10 : window.innerWidth - 10
          }

          // Bounce off floor
          if (y >= FLOOR_Y) {
            y = FLOOR_Y
            vy = -vy * BOUNCE_DAMPING
            vx *= BOUNCE_DAMPING

            // Check if settled
            if (Math.abs(vy) < SETTLE_THRESHOLD && Math.abs(vx) < SETTLE_THRESHOLD) {
              return { ...sparkle, x, y, vx: 0, vy: 0, rotation, settled: true }
            }
          }

          // Update rotation
          rotation += rotationSpeed

          return { ...sparkle, x, y, vx, vy, rotation, rotationSpeed }
        })

        // Remove sparkles that have been settled for too long
        return updated.filter((s) => !s.settled || Date.now() - s.id < 5000)
      })

      animationFrameId = requestAnimationFrame(updateSparkles)
    }

    animationFrameId = requestAnimationFrame(updateSparkles)

    return () => cancelAnimationFrame(animationFrameId)
  }, [focusSparkles.length > 0])

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const rect = e.target.getBoundingClientRect()
    
    const newSparkles: Sparkle[] = []
    for (let i = 0; i < 12; i++) {
      const angle = (Math.random() * Math.PI) - Math.PI / 2 // Spray upward and to sides
      const speed = 5 + Math.random() * 8
      newSparkles.push({
        id: Date.now() + i,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 5, // Extra upward boost
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        settled: false,
      })
    }

    setFocusSparkles((prev) => [...prev, ...newSparkles])
  }

  return (
    <div className="settings-page">
      <div className="sparkle-background">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="sparkle-fall"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${3 + Math.random() * 2}s`,
            }}
          >
            ✨
          </div>
        ))}
      </div>
      {focusSparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className="sparkle-physics"
          style={{
            left: `${sparkle.x}px`,
            top: `${sparkle.y}px`,
            transform: `translate(-50%, -50%) rotate(${sparkle.rotation}deg)`,
            opacity: sparkle.settled ? 0.5 : 1,
          }}
        >
          ⭐
        </div>
      ))}
      <div className="settings-panel standalone">
        <div className="settings-header">
          <h2>⚙ WIZARD SETTINGS ⚙</h2>
        </div>

        <div className="settings-content">
          <section className="settings-section">
            <h3>Pomodoro Timer</h3>
            <div className="settings-field">
              <label htmlFor="work-minutes">🔥 Focus Time (minutes)</label>
              <input
                id="work-minutes"
                type="number"
                min="1"
                max="240"
                value={settings.pomodoroWorkMinutes}
                onChange={handleWorkMinutesChange}
                onFocus={handleInputFocus}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="break-minutes">✨ Rest Time (minutes)</label>
              <input
                id="break-minutes"
                type="number"
                min="1"
                max="60"
                value={settings.pomodoroBreakMinutes}
                onChange={handleBreakMinutesChange}
                onFocus={handleInputFocus}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>Employer Link</h3>
            <div className="settings-field">
              <label htmlFor="employer-code">🔮 6-Digit Verification Code</label>
              <input
                id="employer-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={settings.employerCode}
                onChange={handleEmployerCodeChange}
                onFocus={handleInputFocus}
              />
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <button className="settings-button secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button className="settings-button primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
