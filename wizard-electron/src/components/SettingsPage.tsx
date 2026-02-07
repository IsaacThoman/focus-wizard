import { useEffect, useState, useRef, useCallback } from 'react'
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

interface WalletStatus {
  vaultAddress: string
  vaultBalanceSol: number
  connectedWallet: string | null
}

const BACKEND_URL = 'http://localhost:8000'

interface SettingsPageProps {
  mode?: 'setup' | 'settings'
}

export function SettingsPage({ mode = 'settings' }: SettingsPageProps) {
  const isSetup = mode === 'setup'
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)
  const [clickSparkles, setClickSparkles] = useState<ClickSparkle[]>([])
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [focusData, setFocusData] = useState<FocusData | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<string>('Not started')
  const [bridgeReady, setBridgeReady] = useState(false)
  const [authError, setAuthError] = useState(false)
  const webcamPreviewRef = useRef<HTMLVideoElement>(null)

  // Webcam capture - start immediately when dev mode is on (before bridge)
  const { stream, isActive: webcamActive, error: webcamError } = useWebcam({
    width: 640,
    height: 480,
    fps: 5,  // 5 fps - balance between API usage and face tracking quality
    quality: 0.80,
    enabled: settings.devMode,  // Start webcam as soon as dev mode enabled
  })

  // Connect stream to preview video element
  useEffect(() => {
    const videoEl = webcamPreviewRef.current
    if (videoEl && stream && videoEl.srcObject !== stream) {
      console.log('[SettingsPage] Connecting stream to preview video')
      videoEl.srcObject = stream
      videoEl.play().catch(err => {
        console.error('[SettingsPage] Failed to play video:', err)
      })
    }
  }, [stream, webcamActive])

  // Save settings whenever they change (for devMode to persist)
  const fetchWalletStatus = useCallback(async () => {
    setWalletLoading(true)
    setWalletError(null)
    try {
      const resp = await fetch(`${BACKEND_URL}/wallet/status`)
      if (!resp.ok) throw new Error('Backend not reachable')
      const data = await resp.json()
      setWalletStatus(data)
    } catch (_e) {
      setWalletError('Cannot reach backend. Is the Deno server running?')
      setWalletStatus(null)
    } finally {
      setWalletLoading(false)
    }
  }, [])

  const handleOpenWalletPage = () => {
    window.focusWizard?.openWalletPage()
  }

  useEffect(() => {
    localStorage.setItem('focus-wizard-settings', JSON.stringify(settings))
  }, [settings])

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
    // Also fetch wallet status on mount
    fetchWalletStatus()
  }, [fetchWalletStatus])

  // Subscribe to bridge events
  useEffect(() => {
    // @ts-expect-error — injected by preload
    const api = window.wizardAPI
    if (!api) return

    // Check initial bridge status on mount
    api.getBridgeStatus().then((status: { running: boolean; status: string }) => {
      if (status.running) {
        setBridgeReady(true)
        setBridgeStatus(status.status || 'Bridge ready')
      } else {
        setBridgeReady(false)
        setBridgeStatus(status.status || 'Bridge stopped')
      }
    }).catch(() => {
      setBridgeReady(false)
      setBridgeStatus('Bridge not initialized')
    })

    const unsubs = [
      api.onFocus((data: FocusData) => {
        console.log('[SettingsPage] Focus data received:', data)
        setFocusData(data)
      }),
      api.onMetrics((data: Record<string, unknown>) => {
        console.log('[SettingsPage] Metrics data received:', data)
        // Merge metrics into focus data if available
        if (data) {
          setFocusData(prev => ({ ...prev, ...data } as FocusData))
        }
      }),
      api.onStatus((s: string) => setBridgeStatus(s)),
      api.onReady(() => {
        setBridgeReady(true)
        setBridgeStatus('Bridge ready')
        setAuthError(false)  // Clear auth error on successful start
      }),
      api.onError((msg: string) => {
        console.error('[SettingsPage] Bridge error:', msg)
        setBridgeStatus(`Error: ${msg}`)
        
        // Check if it's an authentication/usage error
        if (msg.includes('Authentication failed') || msg.includes('usage_available') || msg.includes('Usage verification failed')) {
          setAuthError(true)
          setBridgeReady(false)
          setBridgeStatus('⚠️ API credits exhausted. Please add more usage credits to your SmartSpectra account.')
        } else {
          setBridgeReady(false)
        }
      }),
      api.onClosed(() => {
        setBridgeReady(false)
        if (!authError) {
          setBridgeStatus('Bridge stopped')
        }
      }),
    ]

    return () => {
      unsubs.forEach((unsub) => unsub())
    }
  }, [])

  // Start/stop bridge based on dev mode and webcam status
  useEffect(() => {
    // @ts-expect-error — injected by preload
    const api = window.wizardAPI
    if (!api) {
      console.error('[SettingsPage] wizardAPI not available')
      return
    }

    console.log(`[SettingsPage] Dev mode: ${settings.devMode}, Webcam active: ${webcamActive}`)

    if (settings.devMode && webcamActive && !authError) {
      // Only start bridge after webcam is actively capturing and no auth error
      console.log('[SettingsPage] Starting bridge...')
      // Check if Docker is available first
      api.checkDocker().then(({ available }: { available: boolean }) => {
        if (available) {
          console.log('[SettingsPage] Docker available, waiting 500ms then starting bridge')
          // Small delay to ensure frames are being written
          setTimeout(() => {
            api.startBridge().catch((err: Error) => {
              console.error('Failed to start bridge:', err)
              setBridgeStatus(`Failed to start: ${err.message}`)
            })
          }, 500)
        } else {
          console.error('[SettingsPage] Docker not available')
          setBridgeStatus('Docker not available')
        }
      })
    } else {
      // Stop bridge when dev mode is disabled
      if (bridgeReady) {
        console.log('[SettingsPage] Stopping bridge')
        api.stopBridge()
      }
    }
  }, [settings.devMode, webcamActive, bridgeReady, authError])

  const handleSave = () => {
    localStorage.setItem('focus-wizard-settings', JSON.stringify(settings))
    // Hide window instead of closing to keep monitoring active
    // @ts-expect-error — injected by preload
    if (window.wizardAPI?.hideWindow) {
      window.wizardAPI.hideWindow()
    } else {
      window.close()
    }
  }

  const handleStart = async () => {
    localStorage.setItem('focus-wizard-settings', JSON.stringify(settings))
    await window.focusWizard?.startSession()
    window.close()
  }

  const handleCancel = () => {
    // Hide window instead of closing to keep monitoring active
    // @ts-expect-error — injected by preload
    if (window.wizardAPI?.hideWindow) {
      window.wizardAPI.hideWindow()
    } else {
      window.close()
    }
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
    if (Number(settings.pomodoroWorkMinutes) <= 0) {
      setSettings({ ...settings, pomodoroWorkMinutes: DEFAULT_SETTINGS.pomodoroWorkMinutes })
    }
  }

  const handleBreakMinutesBlur = () => {
    if (Number(settings.pomodoroBreakMinutes) <= 0) {
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
    if (Number(settings.pomodoroIterations) <= 0) {
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
          <h2>{isSetup ? '⚙ WIZARD SETUP ⚙' : '⚙ WIZARD SETTINGS ⚙'}</h2>
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
            <h3>Solana Wallet</h3>
            {walletLoading && (
              <div className="wallet-status-msg info">Loading wallet status...</div>
            )}
            {walletError && (
              <div className="wallet-status-msg error">{walletError}</div>
            )}
            {walletStatus && (
              <>
                <div className="wallet-info-row">
                  <label>Wizard Vault Address</label>
                  <div className="wallet-address-display">
                    {walletStatus.vaultAddress}
                  </div>
                </div>
                <div className="wallet-info-row">
                  <label>Vault Balance</label>
                  <div className="wallet-balance-display">
                    {walletStatus.vaultBalanceSol.toFixed(4)} SOL
                  </div>
                </div>
                {walletStatus.connectedWallet && (
                  <div className="wallet-info-row">
                    <label>Connected Wallet</label>
                    <div className="wallet-address-display">
                      {walletStatus.connectedWallet}
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="wallet-actions">
              <button
                className="settings-button primary"
                onClick={handleOpenWalletPage}
                style={{ marginBottom: '8px' }}
              >
                Open Wallet in Browser
              </button>
              <button
                className="settings-button secondary"
                onClick={fetchWalletStatus}
                disabled={walletLoading}
              >
                Refresh Status
              </button>
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
                  onChange={(e) => {
                    setSettings({ ...settings, devMode: e.target.checked })
                    // Clear auth error when toggling to allow retry after adding credits
                    setAuthError(false)
                  }}
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

              {webcamActive && (
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
                        backgroundColor: '#000',
                      }}
                    />
                    <div className="camera-label">Camera</div>
                  </div>

                  {focusData && (
                    <div className="metrics-grid">
                      <div className="metric-item">
                        <div className="metric-label">💓 Pulse</div>
                        <div className="metric-value">
                          {focusData.pulse_bpm > 0 ? `${focusData.pulse_bpm.toFixed(1)} BPM` : `N/A (${focusData.pulse_bpm})`}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">🫁 Breathing</div>
                        <div className="metric-value">
                          {focusData.breathing_bpm > 0 ? `${focusData.breathing_bpm.toFixed(1)} BPM` : `N/A (${focusData.breathing_bpm})`}
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
                          {focusData.is_talking ? '✓ Yes' : `✗ No`}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">👁️ Blink Rate</div>
                        <div className="metric-value">
                          {focusData.blink_rate_per_min > 0 ? `${focusData.blink_rate_per_min.toFixed(1)}/min` : `N/A (${focusData.blink_rate_per_min})`}
                        </div>
                      </div>

                      <div className="metric-item">
                        <div className="metric-label">👀 Gaze</div>
                        <div className="metric-value">
                          {focusData.has_gaze
                            ? `(${focusData.gaze_x.toFixed(2)}, ${focusData.gaze_y.toFixed(2)})`
                            : `N/A (${focusData.gaze_x}, ${focusData.gaze_y})`}
                        </div>
                      </div>
                    </div>
                  )}

                  {focusData && (
                    <details style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#aaa' }}>
                      <summary style={{ cursor: 'pointer' }}>Debug: Raw Data</summary>
                      <pre style={{ 
                        background: '#1a1a1a', 
                        padding: '8px', 
                        borderRadius: '4px', 
                        overflow: 'auto',
                        maxHeight: '200px',
                        fontSize: '0.7rem'
                      }}>
                        {JSON.stringify(focusData, null, 2)}
                      </pre>
                    </details>
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
          {isSetup ? (
            <button className="settings-button primary full-width" onClick={handleStart}>
              Start
            </button>
          ) : (
            <>
              <button className="settings-button secondary" onClick={handleCancel}>
                Cancel
              </button>
              <button className="settings-button primary" onClick={handleSave}>
                Save
              </button>
            </>
          )}
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
