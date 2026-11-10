import { Fragment, useState } from 'react'
import type { Engine } from '../engine/engine'
import type { BenchReport } from '../engine/protocol'
import type { ParamId } from '../state/params'
import { KNOB_ROW, SMALL_BUTTON } from './controls'
import { Knob } from './Knob'

const KNOBS: readonly ParamId[] = ['voice.mode', 'voice.glide', 'amp.velocity']

/** The voice counts a measurement times */
const BENCH_VOICES = [8, 16, 24, 32] as const

/** Frames the audio thread renders per call: the Web Audio render quantum */
const RENDER_QUANTUM = 128

type Bench =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; report: BenchReport; blockMs: number }

/**
 * How notes are played: Poly (a voice each), Mono or Legato (one voice;
 * Legato keeps the envelopes going under a held note), the glide from one
 * note's pitch to the next, and how far velocity sets loudness.
 *
 * Given onBench (the dev server), it also offers Measure CPU: the audio
 * thread times the heaviest patch at 8 to 32 voices, the results take the
 * caption's place, and onBench gets them (into device-reports.jsonl).
 */
export function VoicePanel({
  engine,
  onBench,
}: {
  engine: Engine
  onBench?: (report: BenchReport) => void
}) {
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
    <section
      aria-labelledby="voice-heading"
      className="flex h-full flex-col rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2
          id="voice-heading"
          className="flex h-7 items-center text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
        >
          Voice
        </h2>
        {onBench && (
          <button
            type="button"
            disabled={bench.state === 'running'}
            onClick={() => void measure()}
            className={SMALL_BUTTON}
          >
            {bench.state === 'running' ? 'Measuring…' : 'Measure CPU'}
          </button>
        )}
      </div>
      <p aria-live="polite" className="text-[11px] leading-snug text-zinc-500">
        {bench.state === 'done' ? (
          <BenchResults report={bench.report} blockMs={bench.blockMs} />
        ) : bench.state === 'running' ? (
          'The audio stops for a moment while the audio thread times the heaviest patch.'
        ) : (
          'Lower on a key plays louder. A finger held on a key and slid up or down drives Slide, a source on the MOD tab.'
        )}
      </p>
      <div className={`${KNOB_ROW} grid-cols-4`}>
        {KNOBS.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
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
      Heaviest patch, a block of {blockMs.toFixed(2)} ms:{' '}
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
