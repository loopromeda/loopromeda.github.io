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

/** The time to draw at between frames: the latest frame's, while running */
export function between(running: boolean): number {
  return running && frameAt > 0 ? frameAt : performance.now()
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
      frames.draw(between(raf !== 0))
      shown(canvas)
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      frameAt = now
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
      if (sized) frames.keep?.()
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
