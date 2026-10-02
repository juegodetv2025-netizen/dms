import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ActivationGate from './ActivationGate.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <ActivationGate>
    <App />
  </ActivationGate>
)
