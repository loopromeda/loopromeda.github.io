import {
  Fragment,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import type { Engine } from '../engine/engine'
import type { BenchReport } from '../engine/protocol'
import type { CheckResult, OfflineState } from '../offline'
import type { PlatformReport } from '../platform'
import {
  VOICE_LIMITS,
  type AppSettings,
  type Appearance,
  type Latency,
  type VelocityMode,
} from '../state/settings'
import { RAISED, SMALL_BUTTON, TALL_HIT } from './controls'
import { FadeRow } from './FadeRow'
import { SmallIconButton } from './IconButton'
import { PlatformChecks } from './PlatformChecks'
import { ChoiceRow, SettingRow, SwitchRow } from './SettingRows'
import { mode as pageMode } from './theme'
import { ThemePicker } from './ThemePicker'

/** The dialog's tabs, a section of the settings each */
type Tab =
  'appearance' | 'performance' | 'playing' | 'debug' | 'browser' | 'about'

const TABS: readonly { readonly tab: Tab; readonly label: string }[] = [
  { tab: 'appearance', label: 'Appearance' },
  { tab: 'performance', label: 'Performance' },
  { tab: 'playing', label: 'Playing' },
  { tab: 'debug', label: 'Debug' },
  { tab: 'browser', label: 'Browser' },
  { tab: 'about', label: 'About' },
]

/** The arrow keys' steps along the tabs */
const TAB_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowLeft: -1,
}

/** Each latencyHint as the player picks it, lowest first */
const LATENCY_LABELS: readonly { value: Latency; label: string }[] = [
  { value: 'interactive', label: 'Low' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'playback', label: 'High' },
]

const APPEARANCE_LABELS: readonly { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const VELOCITY_LABELS: readonly { value: VelocityMode; label: string }[] = [
  { value: 'touch', label: 'Touch' },
  { value: 'full', label: 'Full' },
]

/** The voice counts a measurement times */
const BENCH_VOICES = [8, 16, 24, 32] as const

/** Frames the audio thread renders per call: the Web Audio render quantum */
const RENDER_QUANTUM = 128

/** Where the code is */
const SOURCE = 'https://github.com/loopromeda/loopromeda.github.io'

/**
 * The player's settings for this device, apart from the sound: what the
 * phone is asked to do, how a touch plays, and what the screen shows about
 * the audio. It opens from the status line as a dialog over the whole
 * screen, modal: nothing under it plays until it closes. Escape, Back
 * (Chrome on Android closes a modal dialog first), the cross or a tap
 * outside it closes it, and the settings button has the focus again.
 *
 * Its sections are tabs (ashon, 2026-11-17: "설정 모달에서 각 섹션을
 * 탭으로 나누고"), a row of them under its header that pans where they
 * do not fit (FadeRow), the arrow keys moving along them; the dialog is
 * as tall whichever is shown, so it stands still as they change.
 * Appearance shows the themes as samples in their own colours
 * (ThemePicker), in the mode the page is in, and the mode.
 *
 * Debug holds Measure CPU: the audio thread times the heaviest sound at 8
 * to 32 voices, to choose Voices by. onBench gets its results too (the dev
 * server keeps them in device-reports.jsonl). Browser lists what this
 * browser offers the synth, and whether the site is saved to play offline
 * (src/offline.ts), with the update when a newer version waits, or a
 * check for one that takes it at once (an installed app has no reload of
 * its own). About
 * says whose it is, and opens the licences (licences.txt,
 * scripts/vite-licences.ts) and the source.
 */
export function SettingsDialog({
  engine,
  platform,
  settings,
  offline,
  onUpdate,
  onCheck,
  onChange,
  onClose,
  onBench,
}: {
  engine: Engine
  platform: PlatformReport
  settings: AppSettings
  /** Where the site's offline copy stands */
  offline: OfflineState
  /** Reloads the page onto the version waiting */
  onUpdate: () => void
  /** Looks for a new version now, and takes one if it is found */
  onCheck: () => Promise<CheckResult>
  onChange: (settings: AppSettings) => void
  onClose: () => void
  onBench?: (report: BenchReport) => void
}) {
  // The themes' samples in the mode the page is in
  const mode = pageMode()
  const set = (change: Partial<AppSettings>) =>
    onChange({ ...settings, ...change })

  const id = useId()
  const [tab, setTab] = useState<Tab>('appearance')
  const show = (next: Tab, button: HTMLElement | null | undefined) => {
    setTab(next)
    // Into view in the row, where it pans: a tap does not focus a button
    // in Safari, so focusing does not bring it
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = TAB_STEPS[event.key]
    if (!by) return
    event.preventDefault()
    const at = TABS.findIndex((each) => each.tab === tab)
    const next = TABS[(at + by + TABS.length) % TABS.length]?.tab
    if (!next) return
    const button = event.currentTarget.querySelector<HTMLElement>(
      `[data-tab="${next}"]`
    )
    show(next, button)
    button?.focus()
  }

  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })
  // Open from its first paint. When the browser closes it (Escape, Back),
  // the sheet closes with it; put away by the page, it closes quietly and
  // gives the focus back. A close event comes a task late: one that finds
  // the dialog open again (shown again since) is not this one's.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const closed = () => {
      if (!dialog.open) closeRef.current()
    }
    dialog.addEventListener('close', closed)
    return () => {
      dialog.removeEventListener('close', closed)
      if (dialog.open) dialog.close()
    }
  }, [])
  // A tap on the backdrop: the dialog's own, outside its box
  const outside = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    const within =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    if (!within) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      id="settings"
      aria-labelledby="settings-heading"
      onClick={outside}
      className={`m-auto h-[min(36rem,calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)))] max-h-none w-[calc(100%_-_1.5rem)] max-w-lg flex-col gap-1.5 p-2.5 text-inherit open:flex backdrop:bg-(--backdrop) ${RAISED}`}
    >
      <div className="flex h-7 shrink-0 items-center justify-end gap-1.5">
        <h2
          id="settings-heading"
          className="mr-auto min-w-0 truncate px-1 text-[13px] font-semibold text-(--ink-200)"
        >
          Settings
        </h2>
        <SmallIconButton
          label="Close settings"
          onClick={onClose}
          path="M5 5l8 8M13 5l-8 8"
        />
      </div>

      {/* The tabs' touch reaches 8 px above and below them (TALL_HIT): the
          row stands them in that much, so it does not clip it */}
      <FadeRow className="-mx-2.5 -my-2 shrink-0" row="px-2.5 py-2">
        <div
          role="tablist"
          aria-label="Settings"
          onKeyDown={step}
          className="flex gap-0.5 rounded-lg bg-(--under)/25 p-0.5"
        >
          {TABS.map(({ tab: each, label }) => (
            <button
              key={each}
              type="button"
              role="tab"
              id={`${id}-${each}`}
              aria-selected={tab === each}
              aria-controls={`${id}-panel`}
              tabIndex={tab === each ? 0 : -1}
              data-tab={each}
              onClick={(event) => show(each, event.currentTarget)}
              className={`${TALL_HIT} h-7 shrink-0 rounded-md px-3 text-[11px] font-semibold tracking-wider whitespace-nowrap text-(--ink-400) aria-selected:bg-(--lift-2) aria-selected:text-(--ink-0)`}
            >
              {label}
            </button>
          ))}
        </div>
      </FadeRow>

      {/* Keyed by its tab, so each opens scrolled to its top */}
      <div
        key={tab}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        tabIndex={0}
        className="-mx-2.5 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-2.5 pt-1.5 pb-1"
      >
        {tab === 'appearance' && (
          <>
            <ThemePicker
              label="Theme"
              hint="The chains' colours, the modulation colour and the accent, together. The letters stay, so colour is never the only cue."
              value={settings.theme}
              mode={mode}
              onChange={(theme) => set({ theme })}
            />
            <ChoiceRow
              label="Mode"
              hint="Dark or light, or as the device is set."
              options={APPEARANCE_LABELS}
              value={settings.appearance}
              onChange={(appearance) => set({ appearance })}
            />
          </>
        )}

        {tab === 'performance' && (
          <>
            <ChoiceRow
              label="Voices"
              options={VOICE_LIMITS.map((voices) => ({
                value: voices,
                label: `${voices}`,
              }))}
              value={settings.voices}
              onChange={(voices) => set({ voices })}
            />
            <ChoiceRow
              label="Latency"
              hint="Higher gives a slow phone more time for each block, and delays every note. Changing it restarts the audio."
              options={LATENCY_LABELS}
              value={settings.latency}
              onChange={(latency) => set({ latency })}
            />
            <SwitchRow
              label="Waveform"
              value={settings.waveform}
              onChange={(waveform) => set({ waveform })}
            />
          </>
        )}

        {tab === 'playing' && (
          <>
            <ChoiceRow
              label="Velocity"
              hint="Touch: lower on a key or a pad plays louder. Full: every note at full velocity."
              options={VELOCITY_LABELS}
              value={settings.velocity}
              onChange={(velocity) => set({ velocity })}
            />
            <SwitchRow
              label="Keep screen on"
              hint={
                platform.checks['Screen Wake Lock']
                  ? 'While the audio runs and this page is in front.'
                  : 'This browser cannot keep the screen on: it dims as usual.'
              }
              value={settings.keepAwake}
              onChange={(keepAwake) => set({ keepAwake })}
            />
          </>
        )}

        {tab === 'debug' && (
          <>
            <SwitchRow
              label="Audio details"
              value={settings.audioDetails}
              onChange={(audioDetails) => set({ audioDetails })}
            />
            <SwitchRow
              label="Waveform timing"
              value={settings.waveformTiming}
              onChange={(waveformTiming) => set({ waveformTiming })}
            />
            <MeasureCpu engine={engine} onBench={onBench} />
          </>
        )}

        {tab === 'browser' && (
          <>
            <PlatformChecks platform={platform} />
            <OfflineRow state={offline} onUpdate={onUpdate} onCheck={onCheck} />
          </>
        )}

        {tab === 'about' && <About />}
      </div>
    </dialog>
  )
}

/** The offline copy's state, as the row reads it */
const OFFLINE_LABELS: Readonly<Record<OfflineState, string>> = {
  off: 'off',
  saving: 'saving…',
  ready: 'ready',
  update: 'ready',
}

const OFFLINE_HINTS: Readonly<Record<OfflineState, string>> = {
  off: 'A build served over HTTPS saves itself in the browser; this page is not saved, so it needs the network to start.',
  saving: 'Saving the site in the browser, to start and play with no network.',
  ready:
    'Saved in the browser: it starts and plays with no network. A new version is saved as it comes, and waits for Update; Check for update looks now, and takes it.',
  update:
    'A new version is saved. Update reloads the page onto it; the sound and this view come back.',
}

/** What Check for update found, said in the row's hint */
const CHECK_HINTS: Readonly<Record<CheckResult | 'checking', string>> = {
  checking: 'Looking for a new version, and saving it if there is one…',
  found: 'A new version is saved: the page reloads onto it.',
  latest: 'This is the newest version.',
  unreachable:
    'The site could not be reached, or the new version could not be saved: this one goes on playing. Try again with the network.',
}

/**
 * Whether the site is saved to play offline; once it is, a check for a
 * new version that takes it as soon as it is saved, and once a newer
 * version waits, the update
 */
function OfflineRow({
  state,
  onUpdate,
  onCheck,
}: {
  state: OfflineState
  onUpdate: () => void
  onCheck: () => Promise<CheckResult>
}) {
  const id = useId()
  const [check, setCheck] = useState<CheckResult | 'checking'>()
  const look = () => {
    setCheck('checking')
    onCheck().then(setCheck, () => setCheck('unreachable'))
  }
  const hint =
    state === 'ready' && check ? CHECK_HINTS[check] : OFFLINE_HINTS[state]
  return (
    <SettingRow
      label="Offline"
      labelId={`${id}-label`}
      hint={hint}
      hintId={`${id}-hint`}
      live
    >
      {state === 'ready' ? (
        <span className="flex items-center gap-3">
          <span className="text-[13px] text-(--ok)">
            {OFFLINE_LABELS[state]}
          </span>
          <button
            type="button"
            aria-describedby={`${id}-hint`}
            disabled={check === 'checking' || check === 'found'}
            onClick={look}
            className={`${SMALL_BUTTON} disabled:text-(--ink-500)`}
          >
            {check === 'checking' ? 'Checking…' : 'Check for update'}
          </button>
        </span>
      ) : state === 'update' ? (
        <button
          type="button"
          aria-describedby={`${id}-hint`}
          onClick={onUpdate}
          className={SMALL_BUTTON}
        >
          Update
        </button>
      ) : (
        <span className="text-[13px] text-(--ink-500)">
          {OFFLINE_LABELS[state]}
        </span>
      )}
    </SettingRow>
  )
}

/**
 * Whose it is and under what licence, and links (in a new tab, the synth
 * left playing) to the licences of what it is built with and to the code
 */
function About() {
  const id = useId()
  return (
    <SettingRow
      label="Loopromeda"
      labelId={`${id}-label`}
      hint="© 2026 ashon, under the MIT License. Licences lists the software it is built with, each under its own."
      hintId={`${id}-hint`}
    >
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        className="flex flex-wrap gap-1.5"
      >
        <a
          href={`${import.meta.env.BASE_URL}licences.txt`}
          target="_blank"
          rel="noreferrer"
          className={SMALL_BUTTON}
        >
          Licences
        </a>
        <a
          href={SOURCE}
          target="_blank"
          rel="noreferrer"
          className={SMALL_BUTTON}
        >
          Source
        </a>
      </div>
    </SettingRow>
  )
}

type Bench =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; report: BenchReport; blockMs: number }

/**
 * Times the heaviest sound on the audio thread at each of BENCH_VOICES,
 * and shows each count's block time and its share of a block
 */
function MeasureCpu({
  engine,
  onBench,
}: {
  engine: Engine
  onBench?: (report: BenchReport) => void
}) {
  const id = useId()
  const [bench, setBench] = useState<Bench>({ state: 'idle' })

  const measure = async () => {
    setBench({ state: 'running' })
    const report = await engine.bench(BENCH_VOICES)
    const sampleRate = engine.snapshot.sampleRate
    if (!report || !sampleRate) {
      setBench({ state: 'idle' })
      return
    }
    const blockMs = (RENDER_QUANTUM / sampleRate) * 1000
    setBench({ state: 'done', report, blockMs })
    onBench?.(report)
  }

  return (
    <SettingRow
      label="CPU"
      labelId={`${id}-label`}
      hintId={`${id}-hint`}
      live
      hint={
        bench.state === 'done' ? (
          <BenchResults report={bench.report} blockMs={bench.blockMs} />
        ) : bench.state === 'running' ? (
          'The audio stops for a moment while the audio thread times the heaviest sound.'
        ) : (
          'Times the heaviest sound at 8 to 32 voices on the audio thread, to choose Voices by.'
        )
      }
    >
      <button
        type="button"
        aria-labelledby={`${id}-label ${id}-button`}
        aria-describedby={`${id}-hint`}
        id={`${id}-button`}
        disabled={bench.state === 'running'}
        onClick={() => void measure()}
        className={SMALL_BUTTON}
      >
        {bench.state === 'running' ? 'Measuring…' : 'Measure'}
      </button>
    </SettingRow>
  )
}

/** "16 v 0.23 ms (9%)" for each count: a block's time and its share */
function BenchResults({
  report,
  blockMs,
}: {
  report: BenchReport
  blockMs: number
}) {
  return (
    <>
      Heaviest sound, a block of {blockMs.toFixed(2)} ms:{' '}
      {report.results.map((result, index) => (
        // The line breaks between results, never inside one
        <Fragment key={result.voices}>
          {index > 0 && ' · '}
          <span className="whitespace-nowrap">
            <span className="text-(--ink-300)">
              {result.voices} v {result.meanMs.toFixed(2)} ms
            </span>{' '}
            ({Math.round((result.meanMs / blockMs) * 100)}%)
          </span>
        </Fragment>
      ))}
    </>
  )
}
