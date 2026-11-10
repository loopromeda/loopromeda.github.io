import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Engine } from './engine/engine'
import type { BenchReport } from './engine/protocol'
import './index.css'
import { readPlatform, sendReport } from './platform'
import type { ScopeStats } from './ui/Scope'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')

const platform = readPlatform()
const engine = new Engine()
let reportScope: ((stats: ScopeStats) => void) | undefined
let reportBench: ((report: BenchReport) => void) | undefined

if (import.meta.env.DEV) {
  // What the waveform costs to draw on this device, every 5 s while it draws
  let lastScope = -Infinity
  reportScope = (stats) => {
    if (stats.at - lastScope < 5000) return
    lastScope = stats.at
    void sendReport('scope', stats)
  }
  // The audio thread's render time, measured by hand on the VOICE tab
  reportBench = (report) =>
    void sendReport('bench', { ...engine.snapshot, ...report })
  void sendReport('platform', platform)
  // Every audio state change goes on record: start, a lock screen
  // suspending, an interruption, a resume. Latency settles a moment after
  // the start, so a running engine is reported once more 2 s later.
  let last = engine.snapshot.state
  engine.subscribe(() => {
    const { state } = engine.snapshot
    if (state === last) return
    last = state
    void sendReport('engine', engine.snapshot)
    if (state === 'running')
      setTimeout(() => {
        engine.refresh()
        void sendReport('engine', { ...engine.snapshot, settled: true })
      }, 2000)
  })
}

createRoot(root).render(
  <StrictMode>
    <App
      platform={platform}
      engine={engine}
      onScopeStats={reportScope}
      onBench={reportBench}
    />
  </StrictMode>
)
