import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import type { Engine } from '../engine/engine'
import type { BenchReport } from '../engine/protocol'
import {
  VOICE_LIMITS,
  type AppSettings,
  type Latency,
  type VelocityMode,
} from '../state/settings'
import { BUTTON, OPTION } from './controls'
import { IconButton } from './IconButton'

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

/**
 * The player's settings for this device, apart from the sound: what the
 * phone is asked to do, how a touch plays, and what the screen shows about
 * the audio. It opens from the status line over the controls, as the
 * presets do, and Escape closes it.
 *
 * Debug holds Measure CPU: the audio thread times the heaviest sound at 8
 * to 32 voices, to choose Voices by. onBench gets its results too (the dev
 * server keeps them in device-reports.jsonl).
 */
export function SettingsSheet({
  engine,
  settings,
  onChange,
  onClose,
  onBench,
}: {
  engine: Engine
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
  onBench?: (report: BenchReport) => void
}) {
  const set = (change: Partial<AppSettings>) =>
    onChange({ ...settings, ...change })

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <section
      id="settings"
      aria-labelledby="settings-heading"
      className="absolute inset-0 z-10 flex flex-col gap-2 rounded-xl bg-[#16161c] px-3 pt-1.5 pb-3 shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
    >
      <div className="flex h-11 shrink-0 items-center justify-end gap-1.5">
        <h2
          id="settings-heading"
          className="mr-auto min-w-0 truncate px-1 text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
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
      </div>
    </section>
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
