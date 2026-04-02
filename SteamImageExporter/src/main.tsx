import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

const installScrollBounceGuard = (container: HTMLElement) => {
  let lastTouchY = 0

  container.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) {
        return
      }
      lastTouchY = event.touches[0].clientY
    },
    { passive: true },
  )

  container.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 1) {
        return
      }

      const currentTouchY = event.touches[0].clientY
      const deltaY = currentTouchY - lastTouchY
      const atTop = container.scrollTop <= 0
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1

      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        event.preventDefault()
      }

      lastTouchY = currentTouchY
    },
    { passive: false },
  )
}

installScrollBounceGuard(rootElement)

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
