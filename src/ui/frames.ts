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
}

/**
 * Draws canvasRef's canvas every display frame while the audio runs, as
 * the scope does (Scope.tsx): opaque, its backing store the device's
 * pixels (devicePixelContentBoxSize where the browser has it) up to
 * MAX_SCALE, sized before the first frame, the loop stopped while the
 * audio is not running (and by the browser in a background tab). start
 * makes what draws it, once per canvas and key: a new key, a new start.
 */
export function useFrames(
  engine: Engine,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  start: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Frames,
  key = ''
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
    let raf = 0

    const resize = (width: number, height: number, next: number) => {
      if (
        sized &&
        width === canvas.width &&
        height === canvas.height &&
        next === scale
      )
        return
      canvas.width = width
      canvas.height = height
      scale = next
      sized = true
      frames.resize(width, height, next)
      // The resized canvas is blank: a frame now if no loop will draw one
      if (!raf) frames.draw(performance.now())
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (sized && canvas.width && canvas.height) frames.draw(now)
    }
    const sync = () => {
      if (engine.snapshot.state === 'running') {
        if (!raf) raf = requestAnimationFrame(frame)
      } else {
        cancelAnimationFrame(raf)
        raf = 0
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
      cancelAnimationFrame(raf)
      raf = 0
      unsubscribe()
      observer.disconnect()
    }
    // canvasRef is a ref; key names what start draws
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key])
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
