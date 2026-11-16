import { useEffect, useRef, type RefObject } from 'react'
import {
  masterFrame,
  type Engine,
  type MasterFrame,
  type OutputSource,
} from '../engine/engine'

/**
 * Backing-store pixels per CSS pixel, at most, as the scope has it: 3x
 * phone screens get 2x, a line still sharp, under half the pixels to fill
 */
export const MAX_SCALE = 2

/** What a canvas drawn every frame does: useFrames calls it */
export interface Frames {
  /** The canvas was sized: device pixels, and pixels per CSS pixel */
  resize(width: number, height: number, scale: number): void
  /** Draws the frame of now (requestAnimationFrame's time, ms) */
  draw(now: number): void
  /**
   * What it shows is about to go, the canvas resized or let go: a view
   * that builds its picture over time keeps it here, to draw again
   */
  keep?(): void
}

/**
 * A canvas drawn by frames comes in from nothing: hidden until its first
 * frame is drawn (useFrames, Scope), then faded in, never the black of a
 * canvas not yet drawn (asked for by ashon, 2026-11-15: "캔버스 시각화가
 * 전환될 때 페이드로 부드럽게 전환될 수 있게 ... 지금은 까만색으로 깜빡
 * 깜빡 하면서 전환되거든")
 */
export const FADE_IN =
  'opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none'

/** Shows a canvas FADE_IN hides, once it has been drawn */
export function shown(canvas: HTMLCanvasElement): void {
  if (canvas.style.opacity !== '1') canvas.style.opacity = '1'
}

/**
 * The time of the latest display frame any canvas drew, ms: a canvas
 * drawn between frames (resized) draws at it, so that an output read for
 * that frame (OutputTap) is not read again
 */
let frameAt = 0

/** A display frame drawn at now: what between gives until the next */
export function drewAt(now: number): void {
  frameAt = now
}

/** The time to draw at between frames: the latest frame's, while running */
export function between(running: boolean): number {
  return running && frameAt > 0 ? frameAt : performance.now()
}

/** A view drawn each display frame, by its name for the frames' report */
interface Drawer {
  readonly name: string
  readonly draw: (now: number) => void
}

/** Every view drawn each display frame, in the order they came */
const drawers: Drawer[] = []
let loopRaf = 0

/**
 * One display frame of every view drawn each frame (useFrames, the
 * scope, an EQ's spectrum): one requestAnimationFrame callback for all of
 * them, each drawn in turn at the same time, so the output is read once
 * (OutputTap) and the frame's whole cost is told in one place
 * (watchFrames)
 */
function displayFrame(now: number): void {
  loopRaf = requestAnimationFrame(displayFrame)
  drewAt(now)
  const metering = meter.listener !== undefined
  if (metering) meter.begin(now)
  for (let d = 0; d < drawers.length; d++) {
    const drawer = drawers[d] as Drawer
    if (!metering) {
      drawer.draw(now)
      continue
    }
    const began = performance.now()
    drawer.draw(now)
    meter.add(drawer.name, performance.now() - began)
  }
  if (metering) meter.end(now)
}

/**
 * Draws draw each display frame from the next on, as name (what the
 * frames' report counts it as): until the way back it returns is called
 */
export function drawEachFrame(
  name: string,
  draw: (now: number) => void
): () => void {
  const drawer: Drawer = { name, draw }
  drawers.push(drawer)
  if (!loopRaf) loopRaf = requestAnimationFrame(displayFrame)
  return () => {
    const at = drawers.indexOf(drawer)
    if (at >= 0) drawers.splice(at, 1)
    if (drawers.length > 0 || !loopRaf) return
    cancelAnimationFrame(loopRaf)
    loopRaf = 0
  }
}

/** What the views' display frames cost, over a report's span */
export interface FrameStats {
  /** ms the span lasted, from its first frame to its last */
  readonly span: number
  /** Display frames a second the views were drawn on */
  readonly fps: number
  /**
   * The display's own interval, ms: the gap between two frames that came
   * on time (the shortest tenth's)
   */
  readonly interval: number
  /** Frames that came more than half an interval late: one missed, or more */
  readonly late: number
  /** Display frames missed, counted by the intervals the late ones took */
  readonly missed: number
  /**
   * Main-thread ms drawing every view in a frame: the mean, the 95th
   * percentile, the worst
   */
  readonly drawMs: number
  readonly drawP95: number
  readonly drawMax: number
  /** Each kind of view: how many drew, and their mean ms a frame together */
  readonly views: Readonly<Record<string, { count: number; ms: number }>>
  /** Panels on glass on the page (index.css): what stands over the views */
  readonly glass: number
  /**
   * The audio the views were drawn from, where the audio clock was told
   * (watchFrames): how many times a second it had moved on since the
   * frame before (new audio to show), the frames it had not (the views
   * drew what they had), and its steps, ms (the mean and the largest):
   * the audio thread renders a callback's frames at once
   */
  readonly audio?: {
    readonly updates: number
    readonly stale: number
    readonly stepMs: number
    readonly stepMax: number
  }
}

/** The frames a report spans: five seconds' */
const REPORT_MS = 5000
/** Room for a span's frames, at 120 a second and more */
const MAX_FRAMES = 1024

/** The display frames' costs, gathered while someone listens */
const meter = {
  listener: undefined as ((stats: FrameStats) => void) | undefined,
  /** The audio clock, s, and what it did over the span */
  clock: undefined as (() => number | undefined) | undefined,
  clockAt: Number.NaN,
  updates: 0,
  stale: 0,
  stepTotal: 0,
  stepMax: 0,
  /** Each frame's time and its views' drawing, in the span so far */
  times: new Float64Array(MAX_FRAMES),
  draws: new Float64Array(MAX_FRAMES),
  count: 0,
  /** The frame being drawn: its views' ms, and each kind's */
  drawing: 0,
  byName: new Map<string, { ms: number; calls: number }>(),

  begin(now: number): void {
    if (this.count === MAX_FRAMES) this.report()
    this.times[this.count] = now
    this.drawing = 0
    const at = this.clock?.()
    if (at === undefined) return
    const step = at - this.clockAt
    if (step > 0) {
      this.updates++
      this.stepTotal += step
      this.stepMax = Math.max(this.stepMax, step)
    } else if (step === 0) this.stale++
    this.clockAt = at
  },

  add(name: string, ms: number): void {
    this.drawing += ms
    const each = this.byName.get(name)
    if (each) {
      each.ms += ms
      each.calls++
    } else this.byName.set(name, { ms, calls: 1 })
  },

  end(now: number): void {
    this.draws[this.count] = this.drawing
    this.count++
    if (now - (this.times[0] as number) >= REPORT_MS) this.report()
  },

  /** The span so far told, and a new one begun */
  report(): void {
    const count = this.count
    const listener = this.listener
    if (count > 2 && listener) {
      const times = this.times
      const gaps: number[] = []
      for (let f = 1; f < count; f++) {
        gaps.push((times[f] as number) - (times[f - 1] as number))
      }
      gaps.sort((a, b) => a - b)
      const interval = gaps[Math.floor(gaps.length / 10)] as number
      let late = 0
      let missed = 0
      for (const gap of gaps) {
        if (gap <= interval * 1.5) continue
        late++
        missed += Math.round(gap / interval) - 1
      }
      const draws = Array.from(this.draws.subarray(0, count)).sort(
        (a, b) => a - b
      )
      let total = 0
      for (const ms of draws) total += ms
      const span = (times[count - 1] as number) - (times[0] as number)
      const views: Record<string, { count: number; ms: number }> = {}
      for (const [name, { ms, calls }] of this.byName) {
        views[name] = {
          count: Math.round(calls / count),
          ms: round(ms / count),
        }
      }
      listener({
        span: Math.round(span),
        fps: Math.round(((count - 1) * 1000) / span),
        interval: round(interval),
        late,
        missed,
        drawMs: round(total / count),
        drawP95: round(draws[Math.floor(count * 0.95)] as number),
        drawMax: round(draws[count - 1] as number),
        views,
        glass: document.querySelectorAll('.glass').length,
        ...(this.clock &&
          this.updates > 0 && {
            audio: {
              updates: Math.round((this.updates * 1000) / span),
              stale: this.stale,
              stepMs: round((this.stepTotal * 1000) / this.updates),
              stepMax: round(this.stepMax * 1000),
            },
          }),
      })
    }
    this.restart()
  },

  /** A new span, from nothing */
  restart(): void {
    this.count = 0
    this.byName.clear()
    this.updates = 0
    this.stale = 0
    this.stepTotal = 0
    this.stepMax = 0
  },
}

const round = (ms: number) => Math.round(ms * 1000) / 1000

/**
 * Tells listener what the views' display frames cost, every five seconds
 * of them while any draws (FrameStats): what a device report keeps, in
 * development. With clock (the audio clock, s), how often the audio they
 * show moved on too. Returns the way to stop.
 */
export function watchFrames(
  listener: (stats: FrameStats) => void,
  clock?: () => number | undefined
): () => void {
  meter.listener = listener
  meter.clock = clock
  meter.clockAt = Number.NaN
  meter.restart()
  return () => {
    if (meter.listener !== listener) return
    meter.listener = undefined
    meter.clock = undefined
  }
}

/**
 * Draws canvasRef's canvas every display frame while the audio runs, as
 * the scope does (Scope.tsx): opaque, its backing store the device's
 * pixels (devicePixelContentBoxSize where the browser has it) up to
 * MAX_SCALE, sized before the first frame, the loop stopped while the
 * audio is not running (and by the browser in a background tab). start
 * makes what draws it, once per canvas and key: a new key, a new start.
 * Resized, it is drawn again at once, before the page is painted (a
 * canvas resized is blank, and opaque, black), and its first frame shows
 * it (FADE_IN).
 */
export function useFrames(
  engine: Engine,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  start: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Frames,
  key = '',
  name = 'view'
): void {
  // The latest start, without restarting the loop when it changes
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const frames = startRef.current(canvas, ctx)
    let sized = false
    let scale = 1
    /** The way to stop drawing each frame, while it does */
    let stop: (() => void) | undefined

    const resize = (width: number, height: number, next: number) => {
      if (
        sized &&
        width === canvas.width &&
        height === canvas.height &&
        next === scale
      )
        return
      if (sized) frames.keep?.()
      canvas.width = width
      canvas.height = height
      scale = next
      // Squeezed to nothing for a moment (a tile laid out again): nothing
      // to size the view's buffers to, nor to draw, until it has room
      sized = width > 0 && height > 0
      if (!sized) return
      frames.resize(width, height, next)
      // The resized canvas is blank: drawn now, not on the next frame
      frames.draw(between(stop !== undefined))
      shown(canvas)
    }
    const frame = (now: number) => {
      if (sized && canvas.width && canvas.height) frames.draw(now)
    }
    const sync = () => {
      if (engine.snapshot.state === 'running') {
        stop ??= drawEachFrame(name, frame)
      } else {
        stop?.()
        stop = undefined
      }
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const dpr = window.devicePixelRatio || 1
      // Exact device pixels: Chromium and Firefox; Safari has no such box
      const exact = (
        entry.devicePixelContentBoxSize as
          readonly ResizeObserverSize[] | undefined
      )?.[0]
      if (exact && dpr <= MAX_SCALE) {
        resize(exact.inlineSize, exact.blockSize, dpr)
        return
      }
      const box = entry.contentBoxSize[0]
      if (!box) return
      const capped = Math.min(dpr, MAX_SCALE)
      resize(
        Math.round(box.inlineSize * capped),
        Math.round(box.blockSize * capped),
        capped
      )
    })
    try {
      observer.observe(canvas, { box: 'device-pixel-content-box' })
    } catch {
      observer.observe(canvas)
    }
    const unsubscribe = engine.subscribe(sync)
    sync()
    return () => {
      stop?.()
      stop = undefined
      unsubscribe()
      observer.disconnect()
      if (sized) frames.keep?.()
    }
    // canvasRef is a ref; key names what start draws
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key, name])
}

/**
 * An output as its views read it (Engine.readOutput), once a display
 * frame however many of them draw it: every view's frame has the same
 * requestAnimationFrame time, and a second read of the spectrum would
 * smooth it twice.
 */
export class OutputTap {
  readonly #engine: Engine
  readonly #source: OutputSource
  readonly #frame = masterFrame()
  #at = Number.NaN
  #read = false

  constructor(engine: Engine, source: OutputSource) {
    this.#engine = engine
    this.#source = source
  }

  /**
   * Whether it is read after the soft clip (the master's), its levels
   * going into it recovered from what came out (unclippedLevels)
   */
  get clipped(): boolean {
    return this.#source === 'master'
  }

  /** The output at now (a frame's time), or undefined before the audio */
  read(now: number): MasterFrame | undefined {
    if (now !== this.#at) {
      this.#at = now
      this.#read = this.#engine.readOutput(this.#frame, this.#source)
    }
    return this.#read ? this.#frame : undefined
  }
}

const taps = new WeakMap<Engine, Map<OutputSource, OutputTap>>()

/** The engine's one OutputTap for an output, the master's unless named */
export function outputTap(
  engine: Engine,
  source: OutputSource = 'master'
): OutputTap {
  let bySource = taps.get(engine)
  if (!bySource) {
    bySource = new Map()
    taps.set(engine, bySource)
  }
  let tap = bySource.get(source)
  if (!tap) {
    tap = new OutputTap(engine, source)
    bySource.set(source, tap)
  }
  return tap
}
