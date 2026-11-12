import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ensurePpDebug } from './features/pairing/ppDebug'
import { syncRelayFromUrl } from './features/pairing/relay'
import './styles.css'

ensurePpDebug()
syncRelayFromUrl()
createRoot(document.getElementById('root')!).render(<App />)
