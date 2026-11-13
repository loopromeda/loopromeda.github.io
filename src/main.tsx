import '@fontsource-variable/recursive/mono.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Engine } from './engine/engine'
import type { BenchReport } from './engine/protocol'
import './index.css'
import { Offline } from './offline'
import { readPlatform, sendReport } from './platform'
import { FACTORY_KIT, FACTORY_PRESETS } from './state/factory'
import { Library } from './state/library'
import { loadMix, saveMix } from './state/mix'
import { readSettings } from './state/settings'
import { loadSong, saveSong } from './state/song'
import { readPick, writePick } from './state/tracks'
import { touchHeld } from './ui/held'
import type { ScopeStats } from './ui/Scope'
import { ScreenAwake } from './wakeLock'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')

const platform = readPlatform()
const engine = new Engine()
const awake = new ScreenAwake(
  'wakeLock' in navigator ? navigator.wakeLock : undefined,
  document
)

// The offline copy, in a build only: the dev server's files change under
// it. Registered once the page has loaded, so that saving the site does
// not compete with loading it.
const offline = new Offline()
if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void offline.register(`${import.meta.env.BASE_URL}sw.js`)
  })
}

/** localStorage, or none where the browser refuses it (a private window) */
function localStore(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const SELECTABLE = 'input, textarea, [contenteditable], .select-text'

/**
 * What may be selected and long-pressed for its menu: a field to type in
 * (a preset's name) and text the page marks select-text (the start
 * screen's error and browser), not a select's label. A text node answers
 * for its element.
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
// at selectstart; user-select: none (index.css) is the first guard. A
// touch held (a knob's, a tile's) selects nothing even over a field: what
// is under it changed when it was held (held.ts).
const guard = (event: Event) => {
  if (touchHeld() || !selectable(event.target)) event.preventDefault()
}
document.addEventListener('contextmenu', guard)
document.addEventListener('selectstart', guard)
// Nor is it zoomed: Chrome keeps to the viewport's user-scalable=no and
// touch-action (index.css), Safari on iOS to neither, but a pinch's
// gesture events turned away stop it there (Safari's own, never fired
// elsewhere)
const still = (event: Event) => event.preventDefault()
for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(type, still)

const storage = localStore()
// The device's settings that reach the audio go in before it starts: a
// latency is the context's for life, and the voices go to each new worklet
const settings = readSettings(storage)
engine.setVoices(settings.voices)
engine.setLatency(settings.latency)
// The last session's tracks (or a synth on the first preset and the
// factory kit), then the one played and its pad picked, are set before
// audio starts; the engine hands every value to the worklet as it loads
const library = new Library(engine, FACTORY_PRESETS, storage, FACTORY_KIT)
library.restore()
let pick = readPick(storage, engine.getTracks())
engine.pickTrack(pick.track, pick.pad)
engine.subscribeSound(() => {
  const now = engine.getPick()
  if (now.track === pick.track && now.pad === pick.pad) return
  pick = now
  writePick(storage, now)
})
// The session's mix (the returns, the master), kept apart from the sound:
// a preset brings its own sends, never the room they send to
engine.setMix(loadMix(storage))
let mixTimer: ReturnType<typeof setTimeout> | undefined
const keepMix = () => {
  if (mixTimer === undefined) return
  clearTimeout(mixTimer)
  mixTimer = undefined
  saveMix(storage, engine.getMix())
}
engine.subscribeMix(() => {
  clearTimeout(mixTimer)
  mixTimer = setTimeout(keepMix, 500)
})
// The session's song (the tempo, each track's loop), after the tracks it
// is for: loops of tracks there are not are left out
engine.setSong(loadSong(storage))
let songTimer: ReturnType<typeof setTimeout> | undefined
const keepSong = () => {
  if (songTimer === undefined) return
  clearTimeout(songTimer)
  songTimer = undefined
  saveSong(storage, engine.getSong())
}
engine.subscribeSong(() => {
  clearTimeout(songTimer)
  songTimer = setTimeout(keepSong, 500)
})
// The sound, the mix and the song are kept a moment after each change; a
// page going away (a tab closed, a phone switching apps) keeps them at once
const keep = () => {
  library.flush()
  keepMix()
  keepSong()
}
window.addEventListener('pagehide', keep)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') keep()
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

// Audio starts as the page loads where the browser's autoplay rules allow
// it (Chrome's: an installed app, a site the user has played on); one held
// suspended waits for the cover's tap (App.tsx), which resumes it
void engine.start()

createRoot(root).render(
  <StrictMode>
    <App
      platform={platform}
      engine={engine}
      library={library}
      storage={storage}
      offline={offline}
      awake={awake}
      onScopeStats={reportScope}
      onBench={reportBench}
    />
  </StrictMode>
)
