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

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)

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

  return (
    <div className="settings-page">
      <div className="settings-panel standalone">
        <div className="settings-header">
          <h2>Settings</h2>
        </div>

        <div className="settings-content">
          <section className="settings-section">
            <h3>Pomodoro Timer</h3>
            <div className="settings-field">
              <label htmlFor="work-minutes">Work Duration (minutes)</label>
              <input
                id="work-minutes"
                type="number"
                min="1"
                max="240"
                value={settings.pomodoroWorkMinutes}
                onChange={handleWorkMinutesChange}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="break-minutes">Break Duration (minutes)</label>
              <input
                id="break-minutes"
                type="number"
                min="1"
                max="60"
                value={settings.pomodoroBreakMinutes}
                onChange={handleBreakMinutesChange}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>Employer Verification</h3>
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
