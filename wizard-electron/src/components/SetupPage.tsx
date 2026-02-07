import { useEffect, useState } from 'react'
import './Settings.css'

export interface SettingsData {
  pomodoroWorkMinutes: number
  pomodoroBreakMinutes: number
  pomodoroIterations: number
  employerCode: string
}

const DEFAULT_SETTINGS: SettingsData = {
  pomodoroWorkMinutes: 25,
  pomodoroBreakMinutes: 5,
  pomodoroIterations: 4,
  employerCode: '',
}

interface ClickSparkle {
  id: number
  x: number
  y: number
  angle: number
  distance: number
}

export function SetupPage() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)
  const [clickSparkles, setClickSparkles] = useState<ClickSparkle[]>([])

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

  const handleStart = async () => {
    localStorage.setItem('focus-wizard-settings', JSON.stringify(settings))
    await window.focusWizard?.startSession()
    window.close()
  }

  const handleQuitApp = () => {
    window.focusWizard?.quitApp()
  }

  const handleEmployerCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6)
    setSettings({ ...settings, employerCode: value })
  }

  const handleWorkMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === '') {
      setSettings({ ...settings, pomodoroWorkMinutes: '' as any })
    } else {
      const num = parseInt(value, 10)
      if (!isNaN(num) && num > 0 && num <= 240) {
        setSettings({ ...settings, pomodoroWorkMinutes: num })
      }
    }
  }

  const handleBreakMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === '') {
      setSettings({ ...settings, pomodoroBreakMinutes: '' as any })
    } else {
      const num = parseInt(value, 10)
      if (!isNaN(num) && num > 0 && num <= 60) {
        setSettings({ ...settings, pomodoroBreakMinutes: num })
      }
    }
  }

  const handleWorkMinutesBlur = () => {
    if (settings.pomodoroWorkMinutes === '' || settings.pomodoroWorkMinutes === 0) {
      setSettings({ ...settings, pomodoroWorkMinutes: DEFAULT_SETTINGS.pomodoroWorkMinutes })
    }
  }

  const handleBreakMinutesBlur = () => {
    if (settings.pomodoroBreakMinutes === '' || settings.pomodoroBreakMinutes === 0) {
      setSettings({ ...settings, pomodoroBreakMinutes: DEFAULT_SETTINGS.pomodoroBreakMinutes })
    }
  }

  const handleIterationsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === '') {
      setSettings({ ...settings, pomodoroIterations: '' as any })
    } else {
      const num = parseInt(value, 10)
      if (!isNaN(num) && num > 0 && num <= 100) {
        setSettings({ ...settings, pomodoroIterations: num })
      }
    }
  }

  const handleIterationsBlur = () => {
    if (settings.pomodoroIterations === '' || settings.pomodoroIterations === 0) {
      setSettings({ ...settings, pomodoroIterations: DEFAULT_SETTINGS.pomodoroIterations })
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    const baseId = Date.now()
    const newSparkles: ClickSparkle[] = []
    
    // Create 6 sparkles that spew outward in different directions
    for (let i = 0; i < 6; i++) {
      const angle = (i * 60) + (Math.random() - 0.5) * 30 // Evenly spread with some randomness
      const distance = 30 + Math.random() * 40 // Random distance between 30-70px
      
      newSparkles.push({
        id: baseId + i,
        x: e.clientX,
        y: e.clientY,
        angle,
        distance,
      })
    }
    
    setClickSparkles((prev) => [...prev, ...newSparkles])
    
    // Remove sparkles after animation completes
    setTimeout(() => {
      setClickSparkles((prev) => prev.filter((s) => s.id < baseId || s.id >= baseId + 6))
    }, 1000)
  }

  return (
    <div className="settings-page" onClick={handleClick}>
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
      {clickSparkles.map((sparkle) => {
        const angleRad = (sparkle.angle * Math.PI) / 180
        const offsetX = Math.cos(angleRad) * sparkle.distance
        const offsetY = Math.sin(angleRad) * sparkle.distance
        
        return (
          <div
            key={sparkle.id}
            className="sparkle-click"
            style={{
              left: `${sparkle.x}px`,
              top: `${sparkle.y}px`,
              '--offset-x': `${offsetX}px`,
              '--offset-y': `${offsetY}px`,
            } as React.CSSProperties}
          />
        )
      })}
      <div className="settings-panel standalone">
        <div className="settings-header">
          <h2>⚙ WIZARD SETUP ⚙</h2>
        </div>

        <div className="settings-content">
          <section className="settings-section">
            <h3>Pomodoro Timer</h3>
            <div className="settings-field">
              <label htmlFor="work-minutes">Focus Time (minutes)</label>
              <input
                id="work-minutes"
                type="number"
                min="1"
                max="240"
                value={settings.pomodoroWorkMinutes}
                onChange={handleWorkMinutesChange}
                onBlur={handleWorkMinutesBlur}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="break-minutes">Rest Time (minutes)</label>
              <input
                id="break-minutes"
                type="number"
                min="1"
                max="60"
                value={settings.pomodoroBreakMinutes}
                onChange={handleBreakMinutesChange}
                onBlur={handleBreakMinutesBlur}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="iterations">Number of Iterations</label>
              <input
                id="iterations"
                type="number"
                min="1"
                max="100"
                value={settings.pomodoroIterations}
                onChange={handleIterationsChange}
                onBlur={handleIterationsBlur}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>Employer Link</h3>
            <div className="settings-field">
              <label htmlFor="employer-code">6-Digit Verification Code</label>
              <input
                id="employer-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={settings.employerCode}
                onChange={handleEmployerCodeChange}
              />
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <button className="settings-button primary full-width" onClick={handleStart}>
            Start
          </button>
        </div>
        <div className="settings-footer-quit">
          <button className="settings-button danger quit-btn" onClick={handleQuitApp}>
            Quit App
          </button>
        </div>
      </div>
    </div>
  )
}
