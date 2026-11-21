/**
 * Renders a session offline through the app's own audio thread
 * (src/worklet/processor.ts) under a small AudioWorklet shim, posting the
 * messages the engine's start() posts, and measures what comes out: the
 * master's peak and integrated loudness, each track's level at its tap, and
 * what the audio thread's blocks cost.
 */
import { LoudnessMeter } from '../../src/dsp/loudness.ts'
import { OUTPUTS } from '../../src/engine/protocol.ts'
import { lanesPlayed } from '../../src/state/lanes.ts'
import { barSteps, beatSteps } from '../../src/state/meter.ts'
import type { Session } from '../../src/state/project.ts'
import { loopOf, loopOn, playedNotes } from '../../src/state/song.ts'
import type { Track } from '../../src/state/tracks.ts'

export const SAMPLE_RATE = 48000
const BLOCK = 128
/** The blocks of the first second are left out of the worst block's cost */
const WARM_UP = SAMPLE_RATE
/** Blocks played stopped before the transport starts, about 20 ms */
const SETTLE = 8

export interface RenderOptions {
  readonly seconds: number
  /** The voice pool, as Settings sets it */
  readonly voices?: number
  /** The bar to start at, the first 1 */
  readonly fromBar?: number
}

export interface TrackLevel {
  readonly name: string
  /** Over both sides and the whole render, linear */
  readonly rms: number
  readonly peak: number
}

export interface Rendered {
  readonly left: Float32Array
  readonly right: Float32Array
  readonly sampleRate: number
  readonly seconds: number
  /** The master's, linear */
  readonly peak: number
  /** The master's integrated loudness, BS.1770 (src/dsp/loudness.ts) */
  readonly lufs: number
  readonly tracks: readonly TrackLevel[]
  /** Wall-clock time the whole render took, in ms */
  readonly took: number
  /** A block's cost in ms: the mean, and the worst after the first second */
  readonly meanBlock: number
  readonly worstBlock: number
}

interface Port {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown): void
}

interface Processor {
  readonly port: Port
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

type ProcessorClass = new () => Processor

let processorClass: ProcessorClass | undefined

/** The processor's class, loaded once under the shim */
async function loadProcessor(): Promise<ProcessorClass> {
  if (processorClass) return processorClass
  const scope = globalThis as Record<string, unknown>
  scope.sampleRate = SAMPLE_RATE
  scope.currentFrame = 0
  scope.currentTime = 0
  scope.AudioWorkletProcessor = class {
    readonly port: Port = { onmessage: null, postMessage: () => {} }
  }
  scope.registerProcessor = (_name: string, found: ProcessorClass) => {
    processorClass = found
  }
  // Imported by URL, not a path tsc follows: the processor is typed for the
  // audio thread's globals, which this config does not have
  const url = new URL('../../src/worklet/processor.ts', import.meta.url)
  await import(url.href)
  if (!processorClass) throw new Error('the processor did not register')
  return processorClass
}

/** How long a session's longest loop takes once through, in seconds */
export function loopSeconds(session: Session): number {
  const { song } = session
  let steps = 0
  for (const track of session.tracks) {
    steps = Math.max(steps, loopOf(song, track.id).steps)
  }
  // A step is a sixteenth, and the tempo counts quarters
  return (steps * 15) / song.tempo
}

/** The session with only these tracks heard, the rest muted */
export function onlyTracks(session: Session, keep: readonly number[]): Session {
  return {
    ...session,
    mix: {
      ...session.mix,
      strips: session.mix.strips.map((strip, k) =>
        keep.includes(k) ? strip : { ...strip, mute: true as const }
      ),
    },
  }
}

/** The session with these buses (by id: 'b', 'c') turned down to nothing */
export function withoutBuses(
  session: Session,
  ids: readonly string[]
): Session {
  return {
    ...session,
    mix: {
      ...session.mix,
      buses: session.mix.buses.map((bus) =>
        ids.includes(bus.id)
          ? { ...bus, values: { ...bus.values, level: 0 } }
          : bus
      ),
    },
  }
}

/** The session with the master's effects (its limiter) taken off */
export function withoutMasterEffects(session: Session): Session {
  const { master } = session.mix
  return {
    ...session,
    mix: { ...session.mix, master: { ...master, effects: [] } },
  }
}

/** A track's name as the mixer shows it */
function nameOf(track: Track, k: number): string {
  const preset = track.kind === 'synth' ? track.current?.name : undefined
  return track.name ?? preset ?? `Track ${k + 1}`
}

export async function render(
  session: Session,
  options: RenderOptions
): Promise<Rendered> {
  const Processor = await loadProcessor()
  const processor = new Processor()
  const post = (data: unknown) => processor.port.onmessage?.({ data })
  const { tracks, mix, song } = session

  // As the engine's start() does: the mix, the voices, the tracks laid out,
  // the mix again (strips apply to tracks built), each sound, the tempo,
  // each loop, then the transport
  post({ t: 'mix', mix })
  post({ t: 'voices', count: options.voices ?? 16 })
  post({ t: 'layout', tracks: tracks.map(({ id, kind }) => ({ id, kind })) })
  post({ t: 'mix', mix })
  for (const track of tracks) {
    if (track.kind === 'synth') {
      post({ t: 'sound', sound: track.sound, track: track.id })
      continue
    }
    track.pads.forEach((pad, k) =>
      post({ t: 'sound', sound: pad.sound, track: track.id, pad: k })
    )
    post({ t: 'kitChain', track: track.id, chain: track.chain })
    post({
      t: 'padNotes',
      track: track.id,
      notes: track.pads.map((pad) => pad.note),
    })
  }
  post({
    t: 'tempo',
    tempo: song.tempo,
    swing: song.swing,
    bar: barSteps(song.meter),
    beat: beatSteps(song.meter),
  })
  for (const track of tracks) {
    const loop = loopOf(song, track.id)
    const on = loopOn(song, track.id)
    const sound = track.kind === 'synth' ? track.sound : undefined
    post({
      t: 'loop',
      track: track.id,
      steps: loop.steps,
      notes: on ? playedNotes(loop) : [],
      lanes: on ? lanesPlayed(loop, sound) : [],
    })
  }
  const outputs = Array.from({ length: OUTPUTS }, () => [
    new Float32Array(BLOCK),
    new Float32Array(BLOCK),
  ])
  const scope = globalThis as Record<string, unknown>
  let frame = 0
  const step = () => {
    for (const pair of outputs) for (const side of pair) side.fill(0)
    scope.currentFrame = frame
    scope.currentTime = frame / SAMPLE_RATE
    processor.process([], outputs)
    frame += BLOCK
  }
  // Stopped a moment first, as the app is between a session's loading and
  // Play: the faders glide to where the mix puts them (a muted track's to
  // nothing) before a note sounds
  for (let k = 0; k < SETTLE; k++) step()
  const fromBar = options.fromBar ?? 1
  post({
    t: 'transport',
    playing: true,
    ...(fromBar > 1 && { from: (fromBar - 1) * barSteps(song.meter) }),
  })

  const frames = Math.ceil((options.seconds * SAMPLE_RATE) / BLOCK) * BLOCK
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  const sums = tracks.map(() => 0)
  const peaks = tracks.map(() => 0)
  const loudness = new LoudnessMeter(SAMPLE_RATE)
  const master = outputs[0]!
  let worst = 0
  const started = performance.now()
  for (let at = 0; at < frames; at += BLOCK) {
    const before = performance.now()
    step()
    const cost = performance.now() - before
    if (at >= WARM_UP) worst = Math.max(worst, cost)
    const l = master[0]!
    const r = master[1]!
    loudness.process(l, r, BLOCK)
    left.set(l, at)
    right.set(r, at)
    for (let k = 0; k < tracks.length; k++) {
      const tap = outputs[k + 1]!
      const a = tap[0]!
      const b = tap[1]!
      let sum = 0
      let peak = peaks[k]!
      for (let i = 0; i < BLOCK; i++) {
        const x = a[i]!
        const y = b[i]!
        sum += x * x + y * y
        peak = Math.max(peak, Math.abs(x), Math.abs(y))
      }
      sums[k]! += sum
      peaks[k] = peak
    }
  }
  const took = performance.now() - started

  let peak = 0
  for (let i = 0; i < frames; i++) {
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!))
  }
  return {
    left,
    right,
    sampleRate: SAMPLE_RATE,
    seconds: frames / SAMPLE_RATE,
    peak,
    lufs: loudness.integrated,
    tracks: tracks.map((track, k) => ({
      name: nameOf(track, k),
      rms: Math.sqrt(sums[k]! / (2 * frames)),
      peak: peaks[k]!,
    })),
    took,
    meanBlock: took / (frames / BLOCK),
    worstBlock: worst,
  }
}

/** A linear level in dB, -inf for silence */
export function decibels(level: number): number {
  return level > 0 ? 20 * Math.log10(level) : -Infinity
}
