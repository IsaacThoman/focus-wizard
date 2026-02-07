import { useState, useEffect, useRef } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/electron-vite.animate.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const [showTitlebar, setShowTitlebar] = useState(false)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)

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

  return (
    <>
      <div className={`window-titlebar ${showTitlebar ? 'visible' : ''}`} />
      <div>
        <a href="https://electron-vite.github.io" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
