import { useEffect, useState, useRef } from 'react'
import { useWebcam } from '../hooks/useWebcam'
import './Settings.css'

interface FocusData {
  state: 'focused' | 'distracted' | 'drowsy' | 'stressed' | 'away' | 'talking' | 'unknown'
  focus_score: number
  face_detected: boolean
  is_talking: boolean
  is_blinking: boolean
  blink_rate_per_min: number
  gaze_x: number
  gaze_y: number
  has_gaze: boolean
  pulse_bpm: number
  breathing_bpm: number
}

export interface SettingsData {
  pomodoroWorkMinutes: number
  pomodoroBreakMinutes: number
  pomodoroIterations: number
  employerCode: string
  devMode: boolean
}

const DEFAULT_SETTINGS: SettingsData = {
  pomodoroWorkMinutes: 25,
  pomodoroBreakMinutes: 5,
  pomodoroIterations: 4,
  employerCode: '',
  devMode: false,
}

interface ClickSparkle {
  id: number
  x: number
  y: number
  angle: number
  distance: number
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)
  const [clickSparkles, setClickSparkles] = useState<ClickSparkle[]>([])
  const [focusData, setFocusData] = useState<FocusData | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<string>('Not started')
  const [bridgeReady, setBridgeReady] = useState(false)
  const webcamPreviewRef = useRef<HTMLVideoElement>(null)

  // Webcam capture - only enabled when dev mode is on
  const { videoRef, isActive: webcamActive, error: webcamError } = useWebcam({
    width: 640,
    height: 480,
    fps: 15,
    quality: 0.80,
    enabled: settings.devMode && bridgeReady,
  })

  // Share the same video element for preview
  useEffect(() => {
    if (webcamPreviewRef.current && videoRef.current) {
      webcamPreviewRef.current.srcObject = videoRef.current.srcObject
    }
  }, [webcamActive, videoRef])

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

  // Subscribe to bridge events
  useEffect(() => {
    // @ts-expect-error — injected by preload
    const api = window.wizardAPI
    if (!api) return

    const unsubs = [
      api.onFocus((data: FocusData) => setFocusData(data)),
      api.onStatus((s: string) => setBridgeStatus(s)),
      api.onReady(() => {
        setBridgeReady(true)
        setBridgeStatus('Bridge ready')
      }),
      api.onError((msg: string) => {
        setBridgeStatus(`Error: ${msg}`)
        setBridgeReady(false)
      }),
      api.onClosed(() => {
        setBridgeReady(false)
        setBridgeStatus('Bridge stopped')
      }),
    ]

    return () => {
      unsubs.forEach((unsub) => unsub())
    }
  }, [])

  // Start/stop bridge based on dev mode
  useEffect(() => {
    // @ts-expect-error — injected by preload
    const api = window.wizardAPI
    if (!api) return

    if (settings.devMode) {
      // Check if Docker is available first
      api.checkDocker().then(({ available }: { available: boolean }) => {
        if (available) {
          api.startBridge().catch((err: Error) => {
            console.error('Failed to start bridge:', err)
            setBridgeStatus(`Failed to start: ${err.message}`)
          })
        } else {
          setBridgeStatus('Docker not available')
        }
      })
    } else {
      // Stop bridge when dev mode is disabled
      if (bridgeReady) {
        api.stopBridge()
      }
    }
  }, [settings.devMode, bridgeReady])

  const handleSave = () => {
    localStorage.setItem('focus-wizard-settings', JSON.stringify(settings))
    window.close()
  }

  const handleCancel = () => {
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
    if ((settings.pomodoroWorkMinutes as any) === '' || settings.pomodoroWorkMinutes === 0) {
      setSettings({ ...settings, pomodoroWorkMinutes: DEFAULT_SETTINGS.pomodoroWorkMinutes })
    }
  }

  const handleBreakMinutesBlur = () => {
    if ((settings.pomodoroBreakMinutes as any) === '' || settings.pomodoroBreakMinutes === 0) {
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
    if ((settings.pomodoroIterations as any) === '' || settings.pomodoroIterations === 0) {
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
          <h2>⚙ WIZARD SETTINGS ⚙</h2>
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

          <section className="settings-section">
            <h3>Developer Settings</h3>
            <div className="settings-field">
              <label htmlFor="dev-mode">
                <input
                  id="dev-mode"
                  type="checkbox"
                  checked={settings.devMode}
                  onChange={(e) => setSettings({ ...settings, devMode: e.target.checked })}
                  style={{ width: 'auto', marginRight: '8px' }}
                />
                Enable Dev Mode (Show Biometric Metrics)
              </label>
            </div>
          </section>

          {settings.devMode && (
            <section className="settings-section biometrics-section">
              <h3>🔬 Biometric Monitoring</h3>
              
              <div className="biometrics-status">
                <strong>Status:</strong> {bridgeStatus}
              </div>

              {bridgeReady && webcamActive && (
                <div className="biometrics-grid">
                  <div className="camera-preview">
                    <video
                      ref={webcamPreviewRef}
                      autoPlay
                      playsInline
                      muted
                      style={{
                        width: '160px',
                        height: '120px',
                        borderRadius: '8px',
                        border: '2px solid #8b6bb7',
                        objectFit: 'cover',
                      }}
                    />
                    <div className="camera-label">Camera</div>
                  </div>

                  {focusData && (
                    <div className="metrics-grid">
                      <div className="metric-item">
                        <div className="metric-label">💓 Pulse</div>
                        <div className="metric-value">
                          {focusData.pulse_bpm > 0 ? `${focusData.pulse_bpm} BPM` : 'N/A'}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">🫁 Breathing</div>
                        <div className="metric-value">
                          {focusData.breathing_bpm > 0 ? `${focusData.breathing_bpm} BPM` : 'N/A'}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">👤 Face Found</div>
                        <div className="metric-value">
                          {focusData.face_detected ? '✓ Yes' : '✗ No'}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">🚶 Is Away</div>
                        <div className="metric-value">
                          {focusData.state === 'away' ? '✓ Yes' : '✗ No'}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">🗣️ Is Talking</div>
                        <div className="metric-value">
                          {focusData.is_talking ? '✓ Yes' : '✗ No'}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">👁️ Blink Rate</div>
                        <div className="metric-value">
                          {focusData.blink_rate_per_min}/min
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">👀 Gaze</div>
                        <div className="metric-value">
                          {focusData.has_gaze
                            ? `(${focusData.gaze_x.toFixed(2)}, ${focusData.gaze_y.toFixed(2)})`
                            : 'N/A'}
                        </div>
                      </div>
                    </div>
                  )}

                  {!focusData && (
                    <div className="metrics-loading">
                      <p>Waiting for biometric data...</p>
                    </div>
                  )}

                  {webcamError && (
                    <div className="metrics-error">
                      <p>⚠️ Webcam Error: {webcamError}</p>
                    </div>
                  )}
                </div>
              )}

              {!bridgeReady && settings.devMode && (
                <div className="biometrics-loading">
                  <p>Starting biometric monitoring...</p>
                  <p style={{ fontSize: '0.9em', opacity: 0.8 }}>
                    This may take a moment on first run while Docker image builds.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="settings-footer">
          <button className="settings-button secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button className="settings-button primary" onClick={handleSave}>
            Save
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
