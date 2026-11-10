import { useEffect, useRef } from 'react'
import { WAVEFORM_SIZE, type Engine } from '../engine/engine'
import {
  crossingFraction,
  findRisingEdge,
  isSilent,
  minMaxColumns,
} from '../viz/waveform'

/** Samples on screen: 21 ms at 48 kHz, about nine cycles of A4 */
const WINDOW = 1024
/** The trigger looks for its edge early enough to leave a full window */
const SEARCH_END = WAVEFORM_SIZE - WINDOW
/** Edge detection ignores wiggles smaller than this, of full scale */
const HYSTERESIS = 0.01
/** Below this everywhere on screen, a frame counts as silence */
const SILENCE = 1e-4
/**
 * Backing-store pixels per CSS pixel, at most. 3x phone screens get 2x: a
 * line still looks sharp, and there are under half the pixels to fill.
 */
const MAX_SCALE = 2
/** Vertical grid lines split the window into 128-sample divisions */
const DIVISIONS = 8

const BACKGROUND = '#0b0b10'
const GRID = 'rgba(255, 255, 255, 0.06)'
const AXIS = 'rgba(255, 255, 255, 0.14)'
const TRACE = '#34d399'

/** What drawing cost, over the last second */
export interface ScopeStats {
  /** requestAnimationFrame time of the measurement, ms */
  at: number
  /** Main-thread time to issue one frame's drawing, mean, ms */
  drawMs: number
  /** Frames drawn per second (silent frames after the first are skipped) */
  fps: number
  width: number
  height: number
  scale: number
}

/**
 * The output waveform as an oscilloscope: triggered on a rising edge so a
 * steady tone stands still. Rendering is kept cheap for phones:
 *
 * - one opaque canvas (alpha: false), so nothing is blended under it
 * - the grid is pre-rendered once per size and blitted with one drawImage,
 *   which also stands in for clearing
 * - one path and one stroke() per frame; styles are set once per size, not
 *   per frame (a resize resets them)
 * - wider than it is samples, a window is reduced to min/max per pixel
 *   column; narrower, it is a polyline through the samples
 * - nothing is allocated per frame: the buffers live as long as the canvas
 * - silence after silence is not redrawn, and the loop runs only while the
 *   engine does (requestAnimationFrame also stops in background tabs)
 * - the backing store matches device pixels (devicePixelContentBoxSize where
 *   the browser has it), capped at MAX_SCALE
 * - no text on the canvas: the cost readout is a DOM element updated once a
 *   second
 */
export function Scope({
  engine,
  onStats,
}: {
  engine: Engine
  onStats?: (stats: ScopeStats) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  // The latest callback, without restarting the loop when it changes
  const onStatsRef = useRef(onStats)
  useEffect(() => {
    onStatsRef.current = onStats
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const readout = readoutRef.current

    // Everything a frame touches, allocated here once
    const samples = new Float32Array(WAVEFORM_SIZE)
    const background = document.createElement('canvas')
    let mins = new Float32Array(0)
    let maxs = new Float32Array(0)
    let scale = 1
    /**
     * False until the first resize: a frame can run before the observer
     * first reports, while the canvas is still the default 300×150 and the
     * column buffers are empty
     */
    let sized = false
    let wasSilent = false
    let raf = 0
    let statsSince = 0
    let drawn = 0
    let drawTime = 0

    /** Half the height a full-scale sample may use, keeping the line inside */
    const reach = (height: number) => height / 2 - 2 * scale

    const paintBackground = () => {
      const { width, height } = canvas
      background.width = width
      background.height = height
      const bg = background.getContext('2d', { alpha: false })
      if (!bg) return
      bg.fillStyle = BACKGROUND
      bg.fillRect(0, 0, width, height)
      // One device pixel wide, on pixel centres: crisp at any scale
      bg.lineWidth = 1
      bg.strokeStyle = GRID
      bg.beginPath()
      for (let i = 1; i < DIVISIONS; i++) {
        const x = Math.round((i * width) / DIVISIONS) + 0.5
        bg.moveTo(x, 0)
        bg.lineTo(x, height)
      }
      for (const level of [0.5, -0.5]) {
        const y = Math.round(height / 2 - level * reach(height)) + 0.5
        bg.moveTo(0, y)
        bg.lineTo(width, y)
      }
      bg.stroke()
      bg.strokeStyle = AXIS
      bg.beginPath()
      const middle = Math.round(height / 2) + 0.5
      bg.moveTo(0, middle)
      bg.lineTo(width, middle)
      bg.stroke()
    }

    /** Draws one frame; false when there was nothing new to draw */
    const render = (): boolean => {
      const { width, height } = canvas
      if (!sized || !width || !height) return false
      if (!engine.readWaveform(samples)) samples.fill(0)
      const edge = findRisingEdge(samples, 0, SEARCH_END, HYSTERESIS)
      const start = edge < 0 ? 0 : edge
      const silent = isSilent(samples, SILENCE, start, start + WINDOW)
      // Silence after silence: the canvas already shows the flat line
      if (silent && wasSilent) return false
      wasSilent = silent

      const began = performance.now()
      ctx.drawImage(background, 0, 0)
      const middle = height / 2
      const gain = reach(height)
      ctx.beginPath()
      if (WINDOW >= 2 * width) {
        minMaxColumns(samples, start, WINDOW, width, mins, maxs)
        for (let x = 0; x < width; x++) {
          ctx.lineTo(x + 0.5, middle - (maxs[x] ?? 0) * gain)
          ctx.lineTo(x + 0.5, middle - (mins[x] ?? 0) * gain)
        }
      } else {
        // The crossing falls between two samples, and where between them
        // changes every frame unless a period is a whole number of samples
        // (440 Hz at 48 kHz is 109.09). Wide enough to see that as jitter,
        // the trace starts one sample early, shifted left by the crossing's
        // fraction, so the zero crossing itself sits at x = 0.
        const step = width / (WINDOW - 1)
        const from = edge > 0 ? edge - 1 : 0
        const offset = edge > 0 ? -crossingFraction(samples, edge) * step : 0
        // One sample more than the window, so the shifted line still reaches
        // the right edge
        for (let i = 0; i <= WINDOW; i++) {
          ctx.lineTo(
            i * step + offset,
            middle - (samples[from + i] ?? 0) * gain
          )
        }
      }
      ctx.stroke()
      drawTime += performance.now() - began
      drawn++
      return true
    }

    const resize = (width: number, height: number, nextScale: number) => {
      if (
        sized &&
        width === canvas.width &&
        height === canvas.height &&
        nextScale === scale
      )
        return
      canvas.width = width
      canvas.height = height
      scale = nextScale
      sized = true
      // A resize resets the context, so styles are set here, once per size
      ctx.lineWidth = 1.5 * scale
      ctx.lineJoin = 'round'
      ctx.strokeStyle = TRACE
      mins = new Float32Array(width)
      maxs = new Float32Array(width)
      paintBackground()
      // The resized canvas is blank: draw now if no loop will
      wasSilent = false
      if (!raf) render()
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      render()
      const elapsed = now - statsSince
      if (elapsed < 1000) return
      const stats: ScopeStats = {
        at: now,
        drawMs: drawn ? drawTime / drawn : 0,
        fps: Math.round((drawn * 1000) / elapsed),
        width: canvas.width,
        height: canvas.height,
        scale,
      }
      if (readout)
        readout.textContent = drawn
          ? `${stats.drawMs.toFixed(2)} ms · ${stats.fps} fps`
          : 'idle'
      if (drawn) onStatsRef.current?.(stats)
      statsSince = now
      drawn = 0
      drawTime = 0
    }

    const startLoop = () => {
      if (raf || engine.snapshot.state !== 'running') return
      statsSince = performance.now()
      drawn = 0
      drawTime = 0
      raf = requestAnimationFrame(frame)
    }
    const stopLoop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const sync = () =>
      engine.snapshot.state === 'running' ? startLoop() : stopLoop()

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
      stopLoop()
      unsubscribe()
      observer.disconnect()
    }
  }, [engine])

  return (
    <div className="relative h-[clamp(4rem,16dvh,9rem)] shrink-0 overflow-hidden rounded-xl contain-strict">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Output waveform"
        className="block h-full w-full"
      />
      <span
        ref={readoutRef}
        className="pointer-events-none absolute top-1.5 right-2.5 font-mono text-[10px] text-zinc-500"
      />
    </div>
  )
}
