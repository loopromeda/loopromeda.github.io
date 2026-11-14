import { useRef } from 'react'
import type { Engine, OutputSource } from '../engine/engine'
import { masterLimited } from '../state/mix'
import {
  METER_MIN_DB,
  MeterBallistics,
  Ticks,
  correlation,
  dbToY,
  holdPeaks,
  hzToX,
  blendTowards,
  spectrogramColour,
  spectrogramRows,
  spectrumColumns,
  sampleLevels,
  toDb,
  unclippedLevels,
  type Levels,
} from '../viz/master'
import { SCALES } from '../viz/colourScale'
import { outputTap, useFrames } from './frames'
import { Scope, type ScopeStats } from './Scope'
import { alpha, groundOf, mode, palette, type Mode } from './theme'

/**
 * The output's views (docs/plan/effects-parts-sequencer.md): what the
 * master sounds like, after the returns and the soft clip, or what a
 * part sounds like on its own, after its inserts and before its sends
 * (source). Each is an opaque canvas drawn every frame while the audio
 * runs (frames.ts), its output read once a frame for all of them
 * (OutputTap), nothing allocated per frame, a frame of silence after
 * silence not drawn. The output is drawn in the theme's accent, as the
 * scope draws it — read as it draws, so a theme switch shows on the next
 * frame; above 0 dB, going into the clip, in amber. The spectrogram's
 * levels are drawn on the colour scale (src/viz/colourScale.ts).
 */

/** What a view's name calls its output */
const named = (source: OutputSource) =>
  source === 'master' ? 'The output’s' : 'The sound’s'

/**
 * The views' colours in a mode (src/ui/theme.ts's ground): their ground,
 * the grid's lines and the axis, the spectrum's peak line, going into
 * the clip (amber), a meter's empty track (a tile's face), and a meter's
 * track drawn in silence: the ground, a breath lifted, so that the two
 * sides still show apart
 */
function viewColours(tone: Mode) {
  const { page, tile, over, neutral, hot } = groundOf(tone)
  const n = Number.parseInt(neutral.slice(1), 16)
  return {
    background: page,
    grid: `rgba(${over}, 0.06)`,
    axis: `rgba(${over}, 0.14)`,
    peak: `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.45)`,
    hot,
    track: tile,
    meterTrack: `rgba(${over}, 0.03)`,
    /** The spectrogram's lines: a grey, white or black (blendTowards) */
    line: tone === 'light' ? 0 : 255,
    lineColour: (share: number) => `rgba(${over}, ${share})`,
    scale: SCALES[tone],
  }
}

/**
 * The spectrum's top, dB as the analyser reads it: a full-scale sine
 * peaks near -14 (its window halves it and more), so -10 at the top. The
 * analyser reads down to -100.
 */
const SPECTRUM_TOP = -10

/**
 * How far under the top the spectrum and the spectrogram reach, dB: 70,
 * leaving out what is lost under a dense mix (down to the analyser's
 * floor, 90, every tail and the window's skirts 70 dB under the mix
 * filled the picture). Chosen on the device from 50, 70 and 90 since
 * 2026-11-13 (asked for by ashon: "표시 대비도 조정 해 보자"), and fixed
 * since 2026-11-14, when the spectrogram's levels took the colour scale
 * (ashon: "스펙트로그램에 컬러링이 되었는데 그래서 50 70 90 데시벨 같은
 * 기준선은 이제 없어도 되지 않나?")
 */
const SPECTRUM_RANGE = 70

/** The spectral views' floor, dB: darkest there, nothing under it */
const SPECTRUM_FLOOR = SPECTRUM_TOP - SPECTRUM_RANGE

/** The key's ticks: every 10 dB between the floor and the top */
const KEY_TICKS = Array.from(
  { length: SPECTRUM_RANGE / 10 - 1 },
  (_, k) => SPECTRUM_FLOOR + 10 * (k + 1)
)

/**
 * The spectrogram's key: the mode's colour scale in a bar from the
 * spectral views' floor, the background's colour, to their top, near
 * white (near black in the light), the two named at its ends and a tick
 * under it at every 10 dB between
 */
export function ColourKey({ className = '' }: { className?: string }) {
  const light = mode() === 'light'
  return (
    <span
      role="img"
      aria-label={`The spectrogram’s colours: ${SPECTRUM_FLOOR} dB ${light ? 'light' : 'dark'}, ${SPECTRUM_TOP} dB ${light ? 'near black' : 'near white'}`}
      className={`flex shrink-0 items-center gap-1 font-mono text-[9px] leading-none text-(--ink-500) ${className}`}
    >
      <span aria-hidden>{SPECTRUM_FLOOR}</span>
      <span
        aria-hidden
        className="relative h-1.5 w-20 rounded-full ring-1 ring-(--lift-3)"
        style={{
          background: SCALES[light ? 'light' : 'dark'].gradient('to right'),
        }}
      >
        {KEY_TICKS.map((db) => (
          <span
            key={db}
            className="absolute top-full mt-px h-0.5 w-px bg-(--ink-500)"
            style={{
              left: `${((db - SPECTRUM_FLOOR) / SPECTRUM_RANGE) * 100}%`,
            }}
          />
        ))}
      </span>
      <span aria-hidden>{SPECTRUM_TOP} dB</span>
    </span>
  )
}

/** How fast the spectrum's peak line falls, dB a second */
const PEAK_FALL = 18
/** Labelled under the spectrum, and lit brighter in its grid */
const DECADES = [100, 1000, 10000]
/** The grid's other lines: 50 Hz, 200 Hz and so on */
const MINOR = [50, 200, 500, 2000, 5000]
/** Its level lines, dB */
const LEVELS = [-20, -40, -60, -80]

/** How fast the spectrogram scrolls, CSS pixels a second */
const SCROLL = 40
/**
 * The spectrogram's grid, white at these opacities (black in the light):
 * a line across at each decade, as the spectrum's, and a line down each
 * second
 */
const DECADE_LINE = 0.16
const SECOND_LINE = 0.1

/** The vectorscope draws this many of the latest samples: 21 ms */
const VECTOR_SAMPLES = 1024
/** Below this everywhere, a frame counts as silence */
const SILENCE = 1e-4

/** The meters' range, dB going into the clip */
const METER_TOP = 6
/** The needle falls this fast, the peak held this long, then falls */
const NEEDLE_FALL = 24
const PEAK_HOLD = 1.5
/** The RMS bar falls more slowly, as a VU meter's */
const RMS_FALL = 12

/** The views the master can show, as its panel offers them */
export const MASTER_VIEWS = [
  { view: 'scope', label: 'Scope' },
  { view: 'spectrum', label: 'Spectrum' },
  { view: 'spectrogram', label: 'Spectrogram' },
  { view: 'stereo', label: 'Stereo' },
] as const

export type MasterViewKind = (typeof MASTER_VIEWS)[number]['view']

/**
 * Where the view each output's tiles show is kept, each its own (asked
 * for by ashon, 2026-11-13: "시각화 스타일이 각각 다르게"): the master's
 * under the key it always had, the parts' in a list by their place
 */
const VIEW_KEY = 'loopromeda.masterView'
const PART_VIEWS_KEY = 'loopromeda.partViews'

/** A view's kind, if text names one */
const kindOf = (text: unknown): MasterViewKind | undefined =>
  MASTER_VIEWS.find(({ view }) => view === text)?.view

/** The parts' views kept, by place: none where storage has none */
function readPartViews(): unknown[] {
  try {
    const kept: unknown = JSON.parse(
      localStorage.getItem(PART_VIEWS_KEY) ?? '[]'
    )
    return Array.isArray(kept) ? kept : []
  } catch {
    return []
  }
}

/**
 * The view kept for an output: the scope if none is (or storage
 * refuses); a part with none kept shows the master's, as the Out did
 * while they shared one
 */
export function readView(source: OutputSource): MasterViewKind {
  let master: MasterViewKind
  try {
    master = kindOf(localStorage.getItem(VIEW_KEY)) ?? 'scope'
  } catch {
    return 'scope'
  }
  if (source === 'master') return master
  return kindOf(readPartViews()[source]) ?? master
}

export function keepView(source: OutputSource, view: MasterViewKind): void {
  try {
    if (source === 'master') {
      localStorage.setItem(VIEW_KEY, view)
      return
    }
    const views = readPartViews()
    while (views.length < source) views.push(null)
    views[source] = view
    localStorage.setItem(PART_VIEWS_KEY, JSON.stringify(views))
  } catch {
    // Shown all the same, for this visit
  }
}

/** One of the views by kind, the scope's drawing cost reported if asked */
export function MasterView({
  engine,
  view,
  source = 'master',
  className = '',
  timing = false,
  onStats,
}: {
  engine: Engine
  view: MasterViewKind
  /** The output it shows: the master's unless another is named */
  source?: OutputSource
  className?: string
  timing?: boolean
  onStats?: (stats: ScopeStats) => void
}) {
  switch (view) {
    case 'scope':
      return (
        <Scope
          engine={engine}
          source={source}
          timing={timing}
          onStats={onStats}
          className={className}
        />
      )
    case 'spectrum':
      return <Spectrum engine={engine} source={source} className={className} />
    case 'spectrogram':
      return (
        <Spectrogram engine={engine} source={source} className={className} />
      )
    case 'stereo':
      return (
        <Vectorscope engine={engine} source={source} className={className} />
      )
  }
}

/**
 * The spectrum, 20 Hz to 20 kHz on a logarithmic axis (src/viz/master.ts):
 * the level of each column filled under its line, and a line of the
 * peaks falling slowly over it. Labelled, its decades and levels are
 * named in the DOM over it, not drawn.
 */
export function Spectrum({
  engine,
  source = 'master',
  className = '',
  labelled = false,
}: {
  engine: Engine
  source?: OutputSource
  className?: string
  labelled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Drawn again in the other mode (useFrames' key)
  const tone = mode()
  const colours = viewColours(tone)
  useFrames(
    engine,
    canvasRef,
    (canvas, ctx) => {
      const tap = outputTap(engine, source)
      const background = document.createElement('canvas')
      let columns = new Float32Array(1)
      let peaks = new Float32Array(1)
      let last = 0
      let quiet = false

      const paint = (width: number, height: number) => {
        background.width = width
        background.height = height
        const bg = background.getContext('2d', { alpha: false })
        if (!bg) return
        bg.fillStyle = colours.background
        bg.fillRect(0, 0, width, height)
        bg.lineWidth = 1
        const lines = (hz: readonly number[], style: string) => {
          bg.strokeStyle = style
          bg.beginPath()
          for (const f of hz) {
            const x = Math.round(hzToX(f, width)) + 0.5
            bg.moveTo(x, 0)
            bg.lineTo(x, height)
          }
          bg.stroke()
        }
        lines(MINOR, colours.grid)
        lines(DECADES, colours.axis)
        bg.strokeStyle = colours.grid
        bg.beginPath()
        for (const db of LEVELS) {
          if (db <= SPECTRUM_FLOOR) continue
          const y =
            Math.round(dbToY(db, height, SPECTRUM_FLOOR, SPECTRUM_TOP)) + 0.5
          bg.moveTo(0, y)
          bg.lineTo(width, y)
        }
        bg.stroke()
      }

      return {
        resize(width, height, scale) {
          // A column a CSS pixel wide: as fine as the eye reads it
          const count = Math.max(1, Math.round(width / scale))
          columns = new Float32Array(count)
          peaks = new Float32Array(count).fill(-Infinity)
          paint(width, height)
          ctx.lineWidth = 1.5 * scale
          ctx.lineJoin = 'round'
          quiet = false
        },
        draw(now) {
          const { width, height } = canvas
          const frame = tap.read(now)
          const dt = last > 0 ? Math.min(0.1, (now - last) / 1000) : 0
          last = now
          if (frame) {
            const rate = engine.snapshot.sampleRate ?? 48000
            spectrumColumns(frame.spectrum, rate, columns)
          } else {
            columns.fill(-Infinity)
          }
          holdPeaks(columns, peaks, PEAK_FALL * dt)
          let loud = false
          for (let c = 0; c < peaks.length; c++) {
            if ((peaks[c] as number) > SPECTRUM_FLOOR) {
              loud = true
              break
            }
          }
          // Silence after silence: the canvas already shows the grid alone
          if (!loud && quiet) return
          quiet = !loud
          ctx.drawImage(background, 0, 0)
          if (!loud) return
          const accent = palette().accent
          const step = width / columns.length
          const y = (db: number) =>
            dbToY(db, height, SPECTRUM_FLOOR, SPECTRUM_TOP)
          ctx.beginPath()
          ctx.moveTo(0, height)
          for (let c = 0; c < columns.length; c++) {
            ctx.lineTo((c + 0.5) * step, y(columns[c] as number))
          }
          ctx.lineTo(width, height)
          ctx.closePath()
          ctx.fillStyle = alpha(accent, 0.22)
          ctx.fill()
          ctx.beginPath()
          for (let c = 0; c < columns.length; c++) {
            ctx.lineTo((c + 0.5) * step, y(columns[c] as number))
          }
          ctx.strokeStyle = accent
          ctx.stroke()
          ctx.beginPath()
          for (let c = 0; c < peaks.length; c++) {
            ctx.lineTo((c + 0.5) * step, y(peaks[c] as number))
          }
          ctx.strokeStyle = colours.peak
          ctx.stroke()
        },
      }
    },
    `${source}:${tone}`
  )
  return (
    <div className={`relative overflow-hidden contain-strict ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${named(source)} spectrum, 20 Hz to 20 kHz`}
        className="block h-full w-full"
      />
      {labelled && (
        <span aria-hidden className="pointer-events-none">
          {DECADES.map((hz) => (
            <span
              key={hz}
              className="absolute bottom-0.5 ml-1 font-mono text-[9px] leading-none text-(--ink-500)"
              style={{ left: `${hzToX(hz, 100)}%` }}
            >
              {hz < 1000 ? hz : `${hz / 1000}k`}
            </span>
          ))}
          {LEVELS.filter((db) => db > SPECTRUM_FLOOR).map((db) => (
            <span
              key={db}
              className="absolute left-1 mt-0.5 font-mono text-[9px] leading-none text-(--ink-600)"
              style={{
                top: `${dbToY(db, 100, SPECTRUM_FLOOR, SPECTRUM_TOP)}%`,
              }}
            >
              {db}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

/**
 * The spectrum over time: a column a frame at the right, the older ones
 * scrolling left at SCROLL, low notes at the bottom on the spectrum's
 * logarithmic axis, each level on the colour scale from the background
 * through indigo, blue, teal and emerald to yellow and near white
 * (spectrogramColour), lighter by as much for every dB. A line across
 * marks each decade (100 Hz, 1 kHz, 10 kHz), and a line down each
 * second, drawn into the picture to scroll away with it: how long a tail
 * rings is counted in them. Labelled, the decades are named in the DOM
 * over it, and its colours (ColourKey) at its lower left, over the
 * oldest of the lowest notes; where it is wider than 16rem, the lines'
 * second is named at its lower right. In silence it scrolls the last
 * sound away, then rests, its lines where they were.
 */
export function Spectrogram({
  engine,
  source = 'master',
  className = '',
  labelled = false,
}: {
  engine: Engine
  source?: OutputSource
  className?: string
  labelled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Drawn again in the other mode (useFrames' key)
  const tone = mode()
  const colours = viewColours(tone)
  useFrames(
    engine,
    canvasRef,
    (canvas, ctx) => {
      const tap = outputTap(engine, source)
      let column = ctx.createImageData(1, 1)
      /** The column, a second's line drawn down it */
      let second = ctx.createImageData(1, 1)
      let rows = new Float32Array(1)
      let decades = new Int32Array(0)
      const ticks = new Ticks()
      let scale = 1
      let last = 0
      let ahead = 0
      /** Columns of silence drawn since the last sound */
      let silent = 0

      return {
        resize(width, height, next) {
          scale = next
          column = ctx.createImageData(1, height)
          second = ctx.createImageData(1, height)
          rows = new Float32Array(height)
          decades = spectrogramRows(DECADES, height)
          // A second's columns at the scroll's rate, the one at the right
          // edge a second's line
          const period = SCROLL * scale
          ticks.reset(period)
          // Empty, its lines drawn: the decades across, the seconds back
          // from the right edge
          ctx.fillStyle = colours.background
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = colours.lineColour(DECADE_LINE)
          for (let k = 0; k < decades.length; k++) {
            ctx.fillRect(0, decades[k] as number, width, 1)
          }
          ctx.fillStyle = colours.lineColour(SECOND_LINE)
          for (let x = width - 1; x >= 0; x -= period) {
            ctx.fillRect(Math.round(x), 0, 1, height)
          }
          silent = width
        },
        draw(now) {
          const { width, height } = canvas
          const dt = last > 0 ? Math.min(0.1, (now - last) / 1000) : 0
          last = now
          const frame = tap.read(now)
          ahead += dt * SCROLL * scale
          const shift = Math.min(Math.floor(ahead), width)
          if (shift < 1) return
          ahead -= shift
          if (frame) {
            const rate = engine.snapshot.sampleRate ?? 48000
            spectrumColumns(frame.spectrum, rate, rows)
          } else {
            rows.fill(-Infinity)
          }
          let loud = false
          for (let i = 0; i < rows.length; i++) {
            if ((rows[i] as number) > SPECTRUM_FLOOR) {
              loud = true
              break
            }
          }
          silent = loud ? 0 : silent + shift
          // Past a canvas's width of silence it shows nothing but that
          if (silent > width + shift) return
          const data = column.data
          for (let y = 0; y < height; y++) {
            const db = rows[height - 1 - y] as number
            spectrogramColour(
              db,
              SPECTRUM_FLOOR,
              SPECTRUM_TOP,
              colours.scale,
              data,
              y * 4
            )
          }
          for (let k = 0; k < decades.length; k++) {
            blendTowards(
              data,
              (decades[k] as number) * 4,
              DECADE_LINE,
              colours.line
            )
          }
          ctx.drawImage(canvas, -shift, 0)
          for (let k = 0; k < shift; k++) {
            if (ticks.next()) {
              second.data.set(data)
              for (let at = 0; at < second.data.length; at += 4) {
                blendTowards(second.data, at, SECOND_LINE, colours.line)
              }
              ctx.putImageData(second, width - shift + k, 0)
            } else {
              ctx.putImageData(column, width - shift + k, 0)
            }
          }
        },
      }
    },
    `${source}:${tone}`
  )
  return (
    <div
      className={`relative overflow-hidden contain-strict ${labelled ? '@container' : ''} ${className}`}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${named(source)} spectrogram: the spectrum over time, a line down each second`}
        className="block h-full w-full"
      />
      {labelled && (
        <span aria-hidden className="pointer-events-none">
          {DECADES.map((hz) => (
            <span
              key={hz}
              className="absolute left-1 -translate-y-full pb-0.5 font-mono text-[9px] leading-none text-(--ink-500)"
              style={{ top: `${100 - hzToX(hz, 100)}%` }}
            >
              {hz < 1000 ? hz : `${hz / 1000}k`}
            </span>
          ))}
          {/* Where the key leaves room for it */}
          <span className="absolute right-1.5 bottom-1 font-mono text-[9px] leading-none text-(--ink-600) @max-[16rem]:hidden">
            lines 1 s apart
          </span>
        </span>
      )}
      {labelled && (
        <ColourKey className="pointer-events-none absolute bottom-1 left-1 rounded bg-(--bg)/75 px-1 pt-0.5 pb-1.5" />
      )}
    </div>
  )
}

/**
 * The two sides against each other, a goniometer: the latest samples as
 * a line, mid up and side across (vectorPoint), so a sound the same on
 * both sides stands upright and a wide one spreads; the left's diagonal
 * leans up to the left, the right's up to the right. Under it, given
 * correlation, a bar from -1 (the sides opposed, which a phone's one
 * speaker cancels) to +1 (the same), its value over the bar's left end
 * (clear of a name its view may have at the top).
 */
export function Vectorscope({
  engine,
  source = 'master',
  className = '',
  correlated = false,
}: {
  engine: Engine
  source?: OutputSource
  className?: string
  correlated?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Drawn again in the other mode (useFrames' key)
  const tone = mode()
  const colours = viewColours(tone)
  const readoutRef = useRef<HTMLSpanElement>(null)
  useFrames(
    engine,
    canvasRef,
    (canvas, ctx) => {
      const tap = outputTap(engine, source)
      const background = document.createElement('canvas')
      const readout = readoutRef.current
      /** The bar's height under the scope, device pixels; none without it */
      let bar = 0
      let wasSilent = false
      let shown = Number.NaN
      let lastText = 0

      const paint = (width: number, height: number, scale: number) => {
        background.width = width
        background.height = height
        const bg = background.getContext('2d', { alpha: false })
        if (!bg) return
        bg.fillStyle = colours.background
        bg.fillRect(0, 0, width, height)
        const cx = width / 2
        const cy = (height - bar) / 2
        const r = Math.max(1, Math.min(width, height - bar) / 2 - 2 * scale)
        bg.lineWidth = 1
        bg.strokeStyle = colours.grid
        bg.beginPath()
        bg.arc(cx, cy, r, 0, 2 * Math.PI)
        // The sides' diagonals: L up to the left, R up to the right
        const d = r * Math.SQRT1_2
        bg.moveTo(cx - d, cy - d)
        bg.lineTo(cx + d, cy + d)
        bg.moveTo(cx + d, cy - d)
        bg.lineTo(cx - d, cy + d)
        bg.stroke()
        bg.strokeStyle = colours.axis
        bg.beginPath()
        bg.moveTo(Math.round(cx) + 0.5, cy - r)
        bg.lineTo(Math.round(cx) + 0.5, cy + r)
        bg.stroke()
        if (bar > 0) {
          bg.fillStyle = colours.track
          bg.fillRect(0, height - bar, width, bar)
          bg.fillStyle = colours.axis
          bg.fillRect(Math.round(cx), height - bar, 1, bar)
        }
      }

      return {
        resize(width, height, scale) {
          bar = correlated ? Math.round(4 * scale) : 0
          paint(width, height, scale)
          ctx.lineWidth = scale
          ctx.lineJoin = 'round'
          ctx.globalAlpha = 1
          wasSilent = false
        },
        draw(now) {
          const { width, height } = canvas
          const frame = tap.read(now)
          const { left, right } = frame ?? { left: undefined, right: undefined }
          let loudest = 0
          const from = left ? left.length - VECTOR_SAMPLES : 0
          if (left && right) {
            for (let i = from; i < left.length; i++) {
              const l = left[i] as number
              const r = right[i] as number
              loudest = Math.max(loudest, l > 0 ? l : -l, r > 0 ? r : -r)
            }
          }
          const silent = loudest < SILENCE
          if (silent && wasSilent) return
          wasSilent = silent
          const accent = palette().accent
          ctx.drawImage(background, 0, 0)
          const value = left && right && !silent ? correlation(left, right) : 0
          if (left && right && !silent) {
            const cx = width / 2
            const cy = (height - bar) / 2
            const r = Math.max(1, Math.min(width, height - bar) / 2 - 2)
            const most = r
            ctx.strokeStyle = accent
            ctx.beginPath()
            for (let i = from; i < left.length; i++) {
              const l = left[i] as number
              const s = right[i] as number
              // As vectorPoint: side across, mid up, held inside the circle
              let x = (s - l) * Math.SQRT1_2 * r
              let y = (l + s) * Math.SQRT1_2 * r
              x = x > most ? most : x < -most ? -most : x
              y = y > most ? most : y < -most ? -most : y
              ctx.lineTo(cx + x, cy - y)
            }
            ctx.globalAlpha = 0.7
            ctx.stroke()
            ctx.globalAlpha = 1
            if (bar > 0) {
              const at = ((value + 1) / 2) * width
              ctx.fillStyle = value < 0 ? colours.hot : accent
              const w = Math.max(2, Math.round(bar))
              ctx.fillRect(Math.round(at - w / 2), height - bar, w, bar)
            }
          }
          // The value as text, a few times a second
          if (readout && now - lastText > 250 && value !== shown) {
            lastText = now
            shown = value
            readout.textContent = silent
              ? 'Correlation –'
              : `Correlation ${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`
          }
        },
      }
    },
    `${source}:${tone}`
  )
  return (
    <div className={`relative overflow-hidden contain-strict ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${named(source)} two sides against each other: mid up, side across`}
        className="block h-full w-full"
      />
      {correlated && (
        <span
          ref={readoutRef}
          className="pointer-events-none absolute bottom-2 left-1 font-mono text-[9px] leading-none text-(--ink-500)"
        />
      )}
    </div>
  )
}

/** A meter's side: its peak's needle and hold, and its RMS bar */
interface Side {
  readonly needle: MeterBallistics
  readonly rms: MeterBallistics
}

/**
 * The master's two sides' levels going into the soft clip
 * (unclippedLevels), or a part's level as it is (sampleLevels), on a
 * scale from -60 dB to +6: each a bar of its RMS, a needle at its peak
 * and a tick where the peak was held, amber past 0 dB, where the clip is
 * driven hard. A part has one bar, not two (asked for by ashon,
 * 2026-11-13: "모노 악기일 수 있을텐데 볼륨 막대가 두개일 필요는"): its
 * peak the louder side's, its RMS both sides' together, so that a mono
 * sound reads as either side does. Given a readout, the highest peak
 * held is named under them (Peak -3.2 dB, Clip +1.5 dB past 0).
 */
export function Meters({
  engine,
  source = 'master',
  className = '',
  readout = false,
}: {
  engine: Engine
  source?: OutputSource
  className?: string
  readout?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Drawn again in the other mode (useFrames' key)
  const tone = mode()
  const colours = viewColours(tone)
  const textRef = useRef<HTMLSpanElement>(null)
  useFrames(
    engine,
    canvasRef,
    (canvas, ctx) => {
      const tap = outputTap(engine, source)
      const text = textRef.current
      /** A part's one bar, the master's two */
      const single = !tap.clipped
      const levels: Levels = { peak: 0, rms: 0 }
      const other: Levels = { peak: 0, rms: 0 }
      const sides: readonly Side[] = Array.from(
        { length: single ? 1 : 2 },
        () => ({
          needle: new MeterBallistics(NEEDLE_FALL, PEAK_HOLD),
          rms: new MeterBallistics(RMS_FALL, 0),
        })
      )
      let scale = 1
      let last = 0
      let lastText = 0
      let shownText = ''
      let rested = false

      return {
        resize(_width, _height, next) {
          scale = next
          rested = false
        },
        draw(now) {
          const { width, height } = canvas
          const dt = last > 0 ? Math.min(0.1, (now - last) / 1000) : 0
          last = now
          const frame = tap.read(now)
          const [left, right] = sides
          if (!left) return
          // A limiter last on the master leaves no soft clip to undo
          const clipped = tap.clipped && !masterLimited(engine.getMix())
          const measure = (samples: Float32Array | undefined, into: Levels) => {
            if (!samples) into.peak = into.rms = 0
            else if (clipped) unclippedLevels(samples, into)
            else sampleLevels(samples, into)
          }
          const update = (side: Side) => {
            side.needle.update(toDb(levels.peak), dt)
            side.rms.update(toDb(levels.rms), dt)
          }
          measure(frame?.left, levels)
          if (right) {
            update(left)
            measure(frame?.right, levels)
            update(right)
          } else {
            // One bar for both sides: the louder peak, the RMS of the two
            measure(frame?.right, other)
            levels.peak = Math.max(levels.peak, other.peak)
            levels.rms = Math.sqrt(
              (levels.rms * levels.rms + other.rms * other.rms) / 2
            )
            update(left)
          }
          const floor = (side: Side) =>
            side.needle.peak <= METER_MIN_DB && side.rms.level <= METER_MIN_DB
          // Fallen to the floor and drawn so: nothing more to draw
          if (sides.every(floor)) {
            if (rested) return
            rested = true
          } else {
            rested = false
          }
          const y = (db: number) => dbToY(db, height, METER_MIN_DB, METER_TOP)
          const zero = Math.round(y(0))
          const gap = Math.max(1, Math.round(scale))
          const barW = single
            ? width
            : Math.max(1, Math.floor((width - gap) / 2))
          ctx.fillStyle = colours.background
          ctx.fillRect(0, 0, width, height)
          const accent = palette().accent
          sides.forEach((side, k) => {
            const x = k === 0 ? 0 : width - barW
            ctx.fillStyle = colours.meterTrack
            ctx.fillRect(x, 0, barW, height)
            // The RMS, filled from the bottom, amber past 0 dB
            const top = Math.round(y(side.rms.level))
            ctx.globalAlpha = 0.6
            ctx.fillStyle = accent
            ctx.fillRect(
              x,
              Math.max(top, zero),
              barW,
              height - Math.max(top, zero)
            )
            if (top < zero) {
              ctx.fillStyle = colours.hot
              ctx.fillRect(x, top, barW, zero - top)
            }
            ctx.globalAlpha = 1
            // The needle at the peak, and the tick where it was held
            const needle = Math.round(y(side.needle.level))
            const lineH = Math.max(1, Math.round(1.5 * scale))
            ctx.fillStyle = side.needle.level > 0 ? colours.hot : accent
            if (side.needle.level > METER_MIN_DB) {
              ctx.fillRect(x, needle, barW, lineH)
            }
            const held = Math.round(y(side.needle.peak))
            ctx.fillStyle = side.needle.peak > 0 ? colours.hot : colours.peak
            if (side.needle.peak > METER_MIN_DB) {
              ctx.fillRect(x, held, barW, Math.max(1, Math.round(scale)))
            }
          })
          // 0 dB: full scale, past which the clip is driven hard
          ctx.fillStyle = colours.axis
          ctx.fillRect(0, zero, width, Math.max(1, Math.round(scale)))
          if (text && now - lastText > 200) {
            lastText = now
            const peak = Math.max(
              left.needle.peak,
              right?.needle.peak ?? METER_MIN_DB
            )
            const next =
              peak <= METER_MIN_DB
                ? 'Peak –'
                : peak > 0
                  ? `Clip +${peak.toFixed(1)} dB`
                  : `Peak ${peak.toFixed(1)} dB`
            if (next !== shownText) {
              shownText = next
              text.textContent = next
            }
          }
        },
      }
    },
    `${source}:${tone}`
  )
  return (
    <div className={`flex min-h-0 flex-col items-stretch gap-1 ${className}`}>
      <div className="relative min-h-0 flex-1 overflow-hidden contain-strict">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            source === 'master'
              ? 'Output levels, left and right, going into the clip'
              : 'The sound’s level, both sides together'
          }
          className="block h-full w-full"
        />
      </div>
      {readout && (
        <span
          ref={textRef}
          className="shrink-0 text-center font-mono text-[9px] leading-none whitespace-nowrap text-(--ink-400)"
        />
      )}
    </div>
  )
}
