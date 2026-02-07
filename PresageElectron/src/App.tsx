import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebcam } from './hooks/useWebcam';
import './App.css';

interface FocusData {
  state: 'focused' | 'distracted' | 'drowsy' | 'stressed' | 'away' | 'talking' | 'unknown';
  focus_score: number;
  face_detected: boolean;
  is_talking: boolean;
  is_blinking: boolean;
  blink_rate_per_min: number;
  gaze_x: number;
  gaze_y: number;
  has_gaze: boolean;
  pulse_bpm: number;
  breathing_bpm: number;
}

const STATE_EMOJI: Record<string, string> = {
  focused: '🎯',
  distracted: '👀',
  drowsy: '😴',
  stressed: '😰',
  away: '🚶',
  talking: '🗣️',
  unknown: '❓',
};

const STATE_COLOR: Record<string, string> = {
  focused: '#22c55e',
  distracted: '#f59e0b',
  drowsy: '#8b5cf6',
  stressed: '#ef4444',
  away: '#6b7280',
  talking: '#3b82f6',
  unknown: '#9ca3af',
};

function App() {
  const [focusData, setFocusData] = useState<FocusData | null>(null);
  const [status, setStatus] = useState('Waiting for bridge...');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const webcamPreviewRef = useRef<HTMLVideoElement>(null);

  // Webcam capture: enabled once bridge is ready
  const { videoRef, isActive: webcamActive, error: webcamError } = useWebcam({
    width: 640,
    height: 480,
    fps: 15,
    quality: 0.80,
    enabled: isReady,
  });

  // Share the same video element for preview
  useEffect(() => {
    if (webcamPreviewRef.current && videoRef.current) {
      webcamPreviewRef.current.srcObject = videoRef.current.srcObject;
    }
  }, [webcamActive, videoRef]);

  useEffect(() => {
    // @ts-expect-error — injected by preload
    const api = window.focusWizard;
    if (!api) {
      setError('Focus Wizard API not available (not running in Electron?)');
      return;
    }

    // Check Docker availability
    api.checkDocker().then(({ available }: { available: boolean }) => {
      setDockerAvailable(available);
      if (!available) {
        setError('Docker is not running. Please start Docker Desktop.');
      }
    });

    const unsubs = [
      api.onFocus((data: FocusData) => setFocusData(data)),
      api.onStatus((s: string) => setStatus(s)),
      api.onReady(() => {
        setIsReady(true);
        setIsStarting(false);
        setStatus('Bridge is running — analyzing webcam feed');
        setError(null);
      }),
      api.onError((msg: string) => {
        setError(msg);
        setIsStarting(false);
        if (msg.includes('No API key') || msg.includes('Could not find') || msg.includes('Docker')) {
          setShowSetup(true);
        }
      }),
      api.onClosed((code: number) => {
        setIsReady(false);
        setIsStarting(false);
        setStatus(`Bridge exited (code ${code})`);
      }),
    ];

    // Check initial status
    api.getBridgeStatus().then(({ running }: { running: boolean }) => {
      if (!running) {
        setShowSetup(true);
      }
    });

    return () => unsubs.forEach((unsub: () => void) => unsub());
  }, []);

  const handleStart = useCallback(async () => {
    // @ts-expect-error — injected by preload
    const api = window.focusWizard;
    if (!api) return;

    setError(null);
    setIsStarting(true);
    setStatus('Starting (building Docker image if needed)...');
    try {
      await api.startBridge(apiKey || undefined);
      setShowSetup(false);
    } catch (err) {
      setError(String(err));
      setIsStarting(false);
    }
  }, [apiKey]);

  const scorePercent = focusData ? Math.round(focusData.focus_score * 100) : 0;
  const stateLabel = focusData?.state ?? 'unknown';

  return (
    <div className="app">
      <header className="header">
        <h1>Focus Wizard</h1>
        <span className={`status-badge ${isReady ? 'online' : 'offline'}`}>
          {isReady ? '● Connected' : '○ Disconnected'}
        </span>
      </header>

      {error && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}

      {showSetup && !isReady && (
        <div className="setup-card">
          <h2>Setup</h2>
          <p>Enter your Presage API key to start monitoring.</p>
          <p className="hint">
            Get a free key at{' '}
            <a href="https://physiology.presagetech.com" target="_blank" rel="noreferrer">
              physiology.presagetech.com
            </a>
          </p>

          {/* Docker status indicator */}
          <div className={`docker-status ${dockerAvailable ? 'ok' : 'missing'}`}>
            {dockerAvailable === null
              ? '⏳ Checking Docker...'
              : dockerAvailable
                ? '🐳 Docker is running'
                : '⚠️ Docker not found — please start Docker Desktop'}
          </div>

          <input
            type="password"
            placeholder="Your API key..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
          />
          <button onClick={handleStart} disabled={!apiKey || !dockerAvailable || isStarting}>
            {isStarting ? 'Starting...' : 'Start Focus Tracking'}
          </button>
          <p className="hint" style={{ marginTop: '0.75rem' }}>
            📷 Camera access will be requested when tracking starts.
          </p>
        </div>
      )}

      {isReady && (
        <main className="dashboard">
          {/* Hidden video element used by useWebcam for frame capture */}
          <video
            ref={videoRef}
            style={{ display: 'none' }}
            playsInline
            muted
          />

          {/* Webcam preview (visible, small corner) */}
          {webcamActive && (
            <div className="webcam-preview">
              <video
                ref={webcamPreviewRef}
                autoPlay
                playsInline
                muted
              />
              <span className="webcam-badge">📷 LIVE</span>
            </div>
          )}

          {webcamError && (
            <div className="error-banner">
              📷 Webcam error: {webcamError}
            </div>
          )}

          {/* Focus Score Ring */}
          <div className="focus-ring" style={{ '--ring-color': STATE_COLOR[stateLabel] } as React.CSSProperties}>
            <div className="ring-inner">
              <span className="ring-emoji">{STATE_EMOJI[stateLabel]}</span>
              <span className="ring-score">{scorePercent}%</span>
              <span className="ring-label">{stateLabel}</span>
            </div>
          </div>

          {/* Vitals Grid */}
          <div className="vitals-grid">
            <div className="vital-card">
              <span className="vital-icon">💓</span>
              <span className="vital-value">
                {focusData?.pulse_bpm ? `${focusData.pulse_bpm.toFixed(0)} BPM` : '--'}
              </span>
              <span className="vital-label">Pulse</span>
            </div>
            <div className="vital-card">
              <span className="vital-icon">🫁</span>
              <span className="vital-value">
                {focusData?.breathing_bpm ? `${focusData.breathing_bpm.toFixed(0)} BPM` : '--'}
              </span>
              <span className="vital-label">Breathing</span>
            </div>
            <div className="vital-card">
              <span className="vital-icon">👁️</span>
              <span className="vital-value">
                {focusData?.face_detected ? 'Detected' : 'Not Found'}
              </span>
              <span className="vital-label">Face</span>
            </div>
            <div className="vital-card">
              <span className="vital-icon">🎯</span>
              <span className="vital-value">
                {focusData?.has_gaze
                  ? `${focusData.gaze_x.toFixed(2)}, ${focusData.gaze_y.toFixed(2)}`
                  : 'Initializing...'}
              </span>
              <span className="vital-label">Gaze (x, y)</span>
            </div>
            <div className="vital-card">
              <span className="vital-value">
                {focusData?.blink_rate_per_min != null
                  ? `${focusData.blink_rate_per_min.toFixed(0)}/min`
                  : '--'}
              </span>
              <span className="vital-label">Blink Rate</span>
            </div>
            <div className="vital-card">
              <span className="vital-icon">🗣️</span>
              <span className="vital-value">
                {focusData?.is_talking ? 'Yes' : 'No'}
              </span>
              <span className="vital-label">Talking</span>
            </div>
          </div>

          <footer className="status-bar">
            {status}
          </footer>
        </main>
      )}
    </div>
  );
}

export default App;
