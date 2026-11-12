import {
  Fragment,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { Engine } from '../engine/engine'
import type { BenchReport } from '../engine/protocol'
import type { CheckResult, OfflineState } from '../offline'
import type { PlatformReport } from '../platform'
import {
  VOICE_LIMITS,
  type AppSettings,
  type Latency,
  type VelocityMode,
} from '../state/settings'
import { BUTTON, CARD, OPTION } from './controls'
import { IconButton } from './IconButton'
import { PlatformChecks } from './PlatformChecks'

/** Each latencyHint as the player picks it, lowest first */
const LATENCY_LABELS: readonly { value: Latency; label: string }[] = [
  { value: 'interactive', label: 'Low' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'playback', label: 'High' },
]

const VELOCITY_LABELS: readonly { value: VelocityMode; label: string }[] = [
  { value: 'touch', label: 'Touch' },
  { value: 'full', label: 'Full' },
]

const ON_OFF: readonly { value: boolean; label: string }[] = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
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
  const set = (change: Partial<AppSettings>) =>
    onChange({ ...settings, ...change })

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
      className={`m-auto max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-[calc(100%_-_1.5rem)] max-w-md flex-col gap-2 p-3 text-inherit open:flex backdrop:bg-black/70 ${CARD}`}
    >
      <div className="flex h-11 shrink-0 items-center justify-end gap-1.5">
        <h2
          id="settings-heading"
          className="mr-auto min-w-0 truncate px-1 text-[13px] font-semibold text-zinc-200"
        >
          Settings
        </h2>
        <IconButton
          label="Close settings"
          onClick={onClose}
          path="M5 5l8 8M13 5l-8 8"
        />
      </div>

      <div className="-mx-3 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-3">
        <Group title="Performance">
          <Choice
            label="Voices"
            options={VOICE_LIMITS.map((voices) => ({
              value: voices,
              label: `${voices}`,
            }))}
            value={settings.voices}
            onChange={(voices) => set({ voices })}
          />
          <Choice
            label="Latency"
            hint="Higher gives a slow phone more time for each block, and delays every note. Changing it restarts the audio."
            options={LATENCY_LABELS}
            value={settings.latency}
            onChange={(latency) => set({ latency })}
          />
          <Choice
            label="Waveform"
            options={ON_OFF}
            value={settings.waveform}
            onChange={(waveform) => set({ waveform })}
          />
        </Group>

        <Group title="Playing">
          <Choice
            label="Velocity"
            hint="Touch: lower on a key or a pad plays louder. Full: every note at full velocity."
            options={VELOCITY_LABELS}
            value={settings.velocity}
            onChange={(velocity) => set({ velocity })}
          />
          <Choice
            label="Keep screen on"
            hint={
              platform.checks['Screen Wake Lock']
                ? 'While the audio runs and this page is in front.'
                : 'This browser cannot keep the screen on: it dims as usual.'
            }
            options={ON_OFF}
            value={settings.keepAwake}
            onChange={(keepAwake) => set({ keepAwake })}
          />
        </Group>

        <Group title="Debug">
          <Choice
            label="Audio details"
            options={ON_OFF}
            value={settings.audioDetails}
            onChange={(audioDetails) => set({ audioDetails })}
          />
          <Choice
            label="Waveform timing"
            options={ON_OFF}
            value={settings.waveformTiming}
            onChange={(waveformTiming) => set({ waveformTiming })}
          />
          <MeasureCpu engine={engine} onBench={onBench} />
        </Group>

        <Group title="Browser">
          <PlatformChecks platform={platform} />
          <OfflineRow state={offline} onUpdate={onUpdate} onCheck={onCheck} />
        </Group>

        <Group title="About">
          <About />
        </Group>
      </div>
    </dialog>
  )
}

/** A titled run of settings */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3
        id={id}
        className="px-1 text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * One setting: its name at the left, the control at the right (under it
 * when they do not fit side by side), and what it does below
 */
function Row({
  label,
  labelId,
  hint,
  hintId,
  live = false,
  children,
}: {
  label: string
  labelId: string
  hint?: ReactNode
  hintId?: string
  /** The hint changes to report something: it is read out as it does */
  live?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span id={labelId} className="text-[13px] text-zinc-300">
          {label}
        </span>
        {children}
      </div>
      {hint !== undefined && (
        <p
          id={hintId}
          aria-live={live ? 'polite' : undefined}
          className="text-[11px] leading-snug text-zinc-500"
        >
          {hint}
        </p>
      )}
    </div>
  )
}

/** A setting chosen from a row of options, the chosen one pressed */
function Choice<T extends string | number | boolean>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string
  hint?: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <Row
      label={label}
      labelId={`${id}-label`}
      hint={hint}
      hintId={`${id}-hint`}
    >
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        className="flex flex-wrap gap-1.5"
      >
        {options.map((option) => (
          <button
            key={`${option.value}`}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={OPTION}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Row>
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
    <Row
      label="Offline"
      labelId={`${id}-label`}
      hint={hint}
      hintId={`${id}-hint`}
      live
    >
      {state === 'ready' ? (
        <span className="flex items-center gap-3">
          <span className="text-[13px] text-emerald-400">
            {OFFLINE_LABELS[state]}
          </span>
          <button
            type="button"
            aria-describedby={`${id}-hint`}
            disabled={check === 'checking' || check === 'found'}
            onClick={look}
            className={`${BUTTON} disabled:text-zinc-500`}
          >
            {check === 'checking' ? 'Checking…' : 'Check for update'}
          </button>
        </span>
      ) : state === 'update' ? (
        <button
          type="button"
          aria-describedby={`${id}-hint`}
          onClick={onUpdate}
          className={BUTTON}
        >
          Update
        </button>
      ) : (
        <span className="text-[13px] text-zinc-500">
          {OFFLINE_LABELS[state]}
        </span>
      )}
    </Row>
  )
}

/**
 * Whose it is and under what licence, and links (in a new tab, the synth
 * left playing) to the licences of what it is built with and to the code
 */
function About() {
  const id = useId()
  return (
    <Row
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
          className={BUTTON}
        >
          Licences
        </a>
        <a href={SOURCE} target="_blank" rel="noreferrer" className={BUTTON}>
          Source
        </a>
      </div>
    </Row>
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
    <Row
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
        className={BUTTON}
      >
        {bench.state === 'running' ? 'Measuring…' : 'Measure'}
      </button>
    </Row>
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
            <span className="text-zinc-300">
              {result.voices} v {result.meanMs.toFixed(2)} ms
            </span>{' '}
            ({Math.round((result.meanMs / blockMs) * 100)}%)
          </span>
        </Fragment>
      ))}
    </>
  )
}
