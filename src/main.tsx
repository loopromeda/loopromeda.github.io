import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Engine } from './engine/engine'
import type { BenchReport } from './engine/protocol'
import './index.css'
import { readPlatform, sendReport } from './platform'
import { FACTORY_PRESETS } from './state/factory'
import { Library } from './state/library'
import { readSettings } from './state/settings'
import type { ScopeStats } from './ui/Scope'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')

const platform = readPlatform()
const engine = new Engine()

/** localStorage, or none where the browser refuses it (a private window) */
function localStore(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const SELECTABLE = 'input, textarea, select, [contenteditable], .select-text'

/**
 * What may be selected and long-pressed for its menu: a field to type in
 * (a preset's name) and text the page marks select-text (the start
 * screen's error and browser). A text node answers for its element.
 */
function selectable(target: EventTarget | null): boolean {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
  return Boolean(element?.closest(SELECTABLE))
}

// An instrument, not a document: a long press anywhere else, a pad, a key,
// the status line under them, selects no text and opens no menu. Android
// starts a selection from the long press's context menu, iOS (and a mouse)
// at selectstart; user-select: none (index.css) is the first guard.
document.addEventListener('contextmenu', (event) => {
  if (!selectable(event.target)) event.preventDefault()
})
document.addEventListener('selectstart', (event) => {
  if (!selectable(event.target)) event.preventDefault()
})

const storage = localStore()
// The device's settings that reach the audio go in before it starts: a
// latency is the context's for life, and the voices go to each new worklet
const settings = readSettings(storage)
engine.setVoices(settings.voices)
engine.setLatency(settings.latency)
// The last session's sound (or the first preset) is set before audio
// starts; the engine hands every value to the worklet as it loads
const library = new Library(engine, FACTORY_PRESETS, storage)
library.restore()
// The sound is kept a moment after each change; a page going away (a tab
// closed, a phone switching apps) keeps it at once
window.addEventListener('pagehide', library.flush)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') library.flush()
})
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
  // The audio thread's render time, measured by hand in the settings
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
      library={library}
      storage={storage}
      onScopeStats={reportScope}
      onBench={reportBench}
    />
  </StrictMode>
)
