import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { syncRelayFromUrl } from './features/pairing/relay'
import './styles.css'

syncRelayFromUrl()
createRoot(document.getElementById('root')!).render(<App />)
