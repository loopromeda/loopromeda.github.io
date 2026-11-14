import { useEffect, useRef } from 'react'
import { WAVEFORM_SIZE, type Engine, type OutputSource } from '../engine/engine'
import {
  crossingFraction,
  findRisingEdge,
  isSilent,
  minMaxColumns,
} from '../viz/waveform'
import {
  OUTLINE_HEIGHT,
  OUTLINE_WIDTH,
  outlineFill,
  outlinePath,
} from './outline'
import { ground, mode, palette } from './theme'

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

/** The grid's lines and the axis: what lifts off the ground, at these */
const GRID = 0.06
const AXIS = 0.14
/** A picture under the trace: its area and its line, this opaque */
const PICTURE_FILL = 0.08
const PICTURE_LINE = 0.3
/** The share of the height a picture takes, from the bottom up to the axis */
const PICTURE_SHARE = 0.5

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
 * - one path and one stroke() per frame; the pen is set once per size, not
 *   per frame (a resize resets them), the trace's colour aside: the
 *   theme's accent, read as it draws
 * - wider than it is samples, a window is reduced to min/max per pixel
 *   column; narrower, it is a polyline through the samples
 * - nothing is allocated per frame: the buffers live as long as the canvas
 * - silence after silence is not redrawn, and the loop runs only while the
 *   engine does (requestAnimationFrame also stops in background tabs)
 * - the backing store matches device pixels (devicePixelContentBoxSize where
 *   the browser has it), capped at MAX_SCALE
 * - no text on the canvas: the cost readout is a DOM element updated once a
 *   second
 *
 * Given a picture (a part's, outline.ts: the amp's envelope), it lies
 * faintly under the grid and the trace, in the lower half: from the bottom
 * up to the axis. It is painted into the background, so it costs a frame
 * nothing, and painted again only when it changes.
 */
export function Scope({
  engine,
  source = 'master',
  timing = true,
  onStats,
  className = '',
  picture,
  pictureColor,
}: {
  engine: Engine
  /** The output it shows: the master's unless another is named */
  source?: OutputSource
  /** The cost readout is shown */
  timing?: boolean
  onStats?: (stats: ScopeStats) => void
  /** Its size and shape where it stands (the amp's tile) */
  className?: string
  /** The part whose picture lies under the trace */
  picture?: string
  /** The picture's colour: the ground's neutral ink unless given */
  pictureColor?: string
}) {
  // The canvas is drawn again in the other mode: its ground, its grid
  const tone = mode()
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
    /** The picture's path data as last painted, '' for none */
    const pictureLine = () =>
      picture === undefined ? '' : outlinePath(engine.getSound(), picture)
    let shownPicture = pictureLine()

    /** Half the height a full-scale sample may use, keeping the line inside */
    const reach = (height: number) => height / 2 - 2 * scale

    const paintBackground = () => {
      const { width, height } = canvas
      const { page, over, neutral } = ground()
      background.width = width
      background.height = height
      const bg = background.getContext('2d', { alpha: false })
      if (!bg) return
      bg.fillStyle = page
      bg.fillRect(0, 0, width, height)
      if (shownPicture !== '') {
        // Scaled into place as a path, so the line keeps its width
        const room = height * PICTURE_SHARE
        const place = new DOMMatrix()
          .translate(0, height - room)
          .scale(width / OUTLINE_WIDTH, room / OUTLINE_HEIGHT)
        const area = new Path2D()
        area.addPath(new Path2D(outlineFill(shownPicture)), place)
        const line = new Path2D()
        line.addPath(new Path2D(shownPicture), place)
        bg.fillStyle = pictureColor ?? neutral
        bg.strokeStyle = pictureColor ?? neutral
        bg.lineWidth = 1.5 * scale
        bg.lineJoin = 'round'
        bg.globalAlpha = PICTURE_FILL
        bg.fill(area)
        bg.globalAlpha = PICTURE_LINE
        bg.stroke(line)
        bg.globalAlpha = 1
      }
      // One device pixel wide, on pixel centres: crisp at any scale
      bg.lineWidth = 1
      bg.strokeStyle = `rgba(${over}, ${GRID})`
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
      bg.strokeStyle = `rgba(${over}, ${AXIS})`
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
      if (!engine.readWaveform(samples, source)) samples.fill(0)
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
      // The trace wears the theme: read as it draws, so a theme change
      // shows on the next frame
      ctx.strokeStyle = palette().accent
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
      // A resize resets the context, so the pen is set here, once per
      // size; the trace's colour is read as each frame draws
      ctx.lineWidth = 1.5 * scale
      ctx.lineJoin = 'round'
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
    // The picture follows the knobs: a new background, and a frame now if
    // no loop will draw one
    const unsubscribeSound = engine.subscribeSound(() => {
      const line = pictureLine()
      if (line === shownPicture) return
      shownPicture = line
      if (!sized) return
      paintBackground()
      wasSilent = false
      if (!raf) render()
    })

    return () => {
      stopLoop()
      unsubscribe()
      unsubscribeSound()
      observer.disconnect()
    }
  }, [engine, source, picture, pictureColor, tone])

  return (
    <div className={`relative overflow-hidden contain-strict ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          source === 'master' ? 'The output’s waveform' : 'The sound’s waveform'
        }
        className="block h-full w-full"
      />
      <span
        ref={readoutRef}
        hidden={!timing}
        className="pointer-events-none absolute top-0.5 right-1 font-mono text-[9px] leading-none text-(--ink-500)"
      />
    </div>
  )
}
