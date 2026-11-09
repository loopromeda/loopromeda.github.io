import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { readPlatform, sendReport } from './platform'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')

const platform = readPlatform()
if (import.meta.env.DEV) void sendReport(platform)

createRoot(root).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>
)
