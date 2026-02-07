import React from 'react'
import ReactDOM from 'react-dom/client'
import { SetupPage } from './components/SetupPage'
import './index.css'
import './components/Settings.css'

ReactDOM.createRoot(document.getElementById('setup-root')!).render(
  <React.StrictMode>
    <SetupPage />
  </React.StrictMode>,
)
