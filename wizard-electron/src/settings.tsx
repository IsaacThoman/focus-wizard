import React from 'react'
import ReactDOM from 'react-dom/client'
import { SettingsPage } from './components/SettingsPage'
import './index.css'
import './components/Settings.css'

const params = new URLSearchParams(window.location.search)
const mode = params.get('mode') === 'setup' ? 'setup' : 'settings'

ReactDOM.createRoot(document.getElementById('settings-root')!).render(
  <React.StrictMode>
    <SettingsPage mode={mode} />
  </React.StrictMode>,
)
