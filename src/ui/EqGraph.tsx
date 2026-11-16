/**
 * A parametric EQ's six points as the curve they make together, in its
 * panel's place of knobs (asked for by ashon, 2026-11-15: "EQ는 파라메트릭
 * eq로 만들어 보면 어떨까 노브보다 훨씬 직관적일 것 같거든", then "각
 * 지점마다 Q freq gain 등을 정할 수있어야 하지 않을까?"; the demo taken
 * as it was: "둘다 좋네"). The math is src/viz/eq.ts's, the sound
 * src/dsp/eq.ts's, the same biquads, so what is drawn is what is heard.
 *
 * A point is dragged across for its frequency and up for its gain (a
 * cut's for its Q, its resonance); two fingers pinched set the picked
 * one's Q, as a wheel does; a double tap puts a point back where it does
 * nothing. A tap off the points picks the one nearest across. Under the
 * graph, the picked point's kind (a menu of the five) and its Freq, Gain
 * and Q, each dragged up or down, or the arrows, to move it a little.
 * Beside the editor's graph, where the panel is tall, a row of the six
 * points over them, to pick one by its number. Each change is written
 * to the EQ's knobs straight away (they stay knobs: presets, lanes and
 * the old saves read them), and the curve follows what they hold.
 *
 * Behind the curve, while the audio runs, the spectrum of the output the
 * EQ is heard in (EqAccess's heard: a track's own, after its inserts; the
 * master's), to watch what turning it does to the sound (asked for by
 * ashon, 2026-11-15: "EQ에서 실제 음에 대한 파형도 렌더링 되면 조정되는
 * 상황을 잘 모니터링 할 수 있을 것 같은데"). A bus's EQ has the curve
 * alone: a bus has no tap of its own.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { EQ_TYPE_NAMES, isCut, isOff } from '../dsp/eq'
import type { MasterFrame } from '../engine/engine'
import {
  DRAW_RATE,
  EQ_SHORT_NAMES,
  EQ_SPAN_DB,
  dragged,
  eqCurve,
  eqPoints,
  freqAt,
  isFlat,
  nearestAcross,
  nearestPoint,
  nudged,
  pinched,
  placeOf,
  pointText,
  pointValues,
  reset,
  retyped,
  wheeled,
  xOf,
  yOf,
  type EqField,
  type EqFrame,
  type EqPoint,
} from '../viz/eq'
import {
  SPECTRUM_FLOOR,
  SPECTRUM_TOP,
  dbToY,
  spectrumColumns,
} from '../viz/master'
import { TALL_HIT } from './controls'
import { Dropdown } from './Dropdown'
import type { EqAccess } from './eqAccess'
import { MAX_SCALE, between, drawEachFrame, outputTap } from './frames'
import { alpha, ground, mode, palette, themeId } from './theme'

/** The curve's inset from the graph's edges, so a point at an end is reached */
const PAD_X = 14
const PAD_Y = 10
/** How far from a point (CSS px) a finger still takes it */
const REACH = 26
/** A second tap on a point within this many ms puts it back */
const DOUBLE_TAP = 320
/** The least spread of a pinch, CSS px: fingers together are not 0 */
const LEAST_SPREAD = 12

/** Each kind's outline on a 14 px square, for its menu */
const KIND_GLYPHS = [
  'M1.5 11.5C4 11.5 4.5 4.5 7.5 4.5H12.5',
  'M1.5 4.5H4.5C6.5 4.5 6.5 9.5 8.5 9.5H12.5',
  'M1.5 9.5H4C5.5 9.5 5.5 3.5 7 3.5S8.5 9.5 10 9.5H12.5',
  'M1.5 9.5H5.5C7.5 9.5 7.5 4.5 9.5 4.5H12.5',
  'M1.5 4.5H6.5C9.5 4.5 10 11.5 12.5 11.5',
]

const KIND_OPTIONS = EQ_TYPE_NAMES.map((label, value) => ({
  value,
  label,
  glyph: KIND_GLYPHS[value],
}))

/** The points as a key: the same while none of their knobs moves */
function keyOf(points: readonly EqPoint[]): string {
  return points
    .map(({ type, freq, gain, q }) => `${type} ${freq} ${gain} ${q}`)
    .join(' ')
}

/** The points a key holds (keyOf's, back) */
function pointsOf(key: string): EqPoint[] {
  const numbers = key.split(' ').map(Number)
  const points: EqPoint[] = []
  for (let i = 0; i + 3 < numbers.length; i += 4) {
    points.push({
      type: numbers[i] as number,
      freq: numbers[i + 1] as number,
      gain: numbers[i + 2] as number,
      q: numbers[i + 3] as number,
    })
  }
  return points
}

/** The point to start at: the one that moves the sound most, else a bell */
function startPoint(points: readonly EqPoint[]): number {
  let best = 2
  let most = 0
  points.forEach((point, p) => {
    if (isCut(point.type) || isFlat(point)) return
    if (Math.abs(point.gain) > most) {
      most = Math.abs(point.gain)
      best = p
    }
  })
  return best
}

/**
 * An EQ's curve with its points, and under it the picked point's kind and
 * values. compact, in a row of knobs (the master's sheet): the curve
 * alone, as tall as a knob and its name, and the picked point read under
 * it, level with the knobs' readings.
 */
export function EqGraph({
  access,
  compact = false,
}: {
  access: EqAccess
  compact?: boolean
}) {
  const id = useId()
  const key = useSyncExternalStore(access.follow, () =>
    keyOf(eqPoints(access.values()))
  )
  const points = useMemo(() => pointsOf(key), [key])
  const [picked, pick] = useState(() => startPoint(points))
  const point = points[picked] ?? points[0]
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState<EqFrame>()
  // Read for the drawing: a new theme or mode draws again
  const tone = mode()
  const theme = themeId()

  /** The latest of what the wheel's listener, set up once, works with */
  const latest = useRef({ access, picked })
  useLayoutEffect(() => {
    latest.current = { access, picked }
  })

  const gesture = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    drag: undefined as { point: number; dx: number; dy: number } | undefined,
    pinch: undefined as
      { point: number; q: number; spread: number } | undefined,
    tap: { point: -1, time: -Infinity },
  })

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => {
      const { width, height } = box.getBoundingClientRect()
      setFrame((was) =>
        was?.width === width && was.height === height
          ? was
          : { width, height, padX: PAD_X, padY: compact ? 6 : PAD_Y }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [compact])

  const painter = useRef<EqPainter>(undefined)
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame || frame.width === 0 || frame.height === 0) return
    painter.current ??= new EqPainter(canvas)
    painter.current.set(frame, points, picked, compact)
    // Drawn now, the spectrum as the display frame last read it
    const { access } = latest.current
    const { engine } = access.heard
    const heard = heardAt(access, between(running(access)))
    painter.current.paint(heard?.spectrum, engine.snapshot.sampleRate)
  }, [frame, points, picked, compact, tone, theme])

  // Each display frame while the audio runs: the spectrum behind
  useEffect(() => {
    const { engine } = latest.current.access.heard
    /** The way to stop drawing each display frame, while it does */
    let drawing: (() => void) | undefined
    const draw = (now: number) => {
      const heard = heardAt(latest.current.access, now)
      painter.current?.paint(heard?.spectrum, engine.snapshot.sampleRate)
    }
    const sync = () => {
      if (engine.snapshot.state === 'running') {
        drawing ??= drawEachFrame('eq', draw)
        return
      }
      drawing?.()
      drawing = undefined
      painter.current?.paint()
    }
    const stop = engine.subscribe(sync)
    sync()
    return () => {
      drawing?.()
      stop()
    }
  }, [])

  // A wheel turns the picked point's Q; it takes the page's scroll, so
  // it is listened to unpassively, which React's onWheel is not
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const { access, picked } = latest.current
      const now = eqPoints(access.values())[picked]
      if (now) access.write(pointValues(picked, wheeled(now, event.deltaY)))
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [])

  if (!point) return null
  const write = (p: number, next: EqPoint) => access.write(pointValues(p, next))
  /** The points as the knobs hold them now, not as last drawn */
  const now = () => eqPoints(access.values())

  const local = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const spread = () => {
    const [a, b] = [...gesture.current.pointers.values()]
    if (!a || !b) return LEAST_SPREAD
    return Math.max(LEAST_SPREAD, Math.hypot(a.x - b.x, a.y - b.y))
  }

  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!frame) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const g = gesture.current
    const at = local(event)
    g.pointers.set(event.pointerId, at)
    const points = now()
    if (g.pointers.size === 2) {
      // A second finger: the point held, or the one picked, pinched
      const p = g.drag?.point ?? picked
      g.drag = undefined
      g.pinch = { point: p, q: points[p]?.q ?? 1, spread: spread() }
      return
    }
    if (g.pointers.size > 2) return
    const hit = nearestPoint(frame, points, at.x, at.y, REACH, picked)
    const held = points[hit]
    if (!held) {
      pick(nearestAcross(frame, points, at.x))
      return
    }
    pick(hit)
    if (g.tap.point === hit && event.timeStamp - g.tap.time < DOUBLE_TAP) {
      g.tap = { point: -1, time: -Infinity }
      write(hit, reset(held))
      return
    }
    g.tap = { point: hit, time: event.timeStamp }
    const place = placeOf(frame, held)
    g.drag = { point: hit, dx: place.x - at.x, dy: place.y - at.y }
  }

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    if (!frame || !g.pointers.has(event.pointerId)) return
    const at = local(event)
    g.pointers.set(event.pointerId, at)
    if (g.pinch && g.pointers.size >= 2) {
      const { point: p, q, spread: from } = g.pinch
      const was = now()[p]
      if (was) write(p, pinched(was, q, from, spread()))
      return
    }
    const drag = g.drag
    const was = drag && now()[drag.point]
    if (!drag || !was) return
    write(drag.point, dragged(frame, was, at.x + drag.dx, at.y + drag.dy))
  }

  const lift = (event: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    g.pointers.delete(event.pointerId)
    if (g.pointers.size < 2) g.pinch = undefined
    if (g.pointers.size === 0) g.drag = undefined
  }

  // On the graph, left and right pick a point, up and down its gain (a
  // cut's Q)
  const keys = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
    if (by !== undefined) {
      pick(Math.min(Math.max(picked + by, 0), points.length - 1))
    } else {
      const up = { ArrowUp: 5, ArrowDown: -5 }[event.key]
      if (up === undefined) return
      write(picked, nudged(point, isCut(point.type) ? 'q' : 'gain', up))
    }
    event.preventDefault()
  }

  const text = pointText(point)
  const kind = EQ_TYPE_NAMES[point.type] ?? ''
  const said = `Point ${picked + 1}, ${kind}: ${text.freq}${isCut(point.type) ? '' : `, ${text.gain}`}, Q ${text.q}`
  const graph = (
    <div
      ref={boxRef}
      className={
        compact
          ? 'relative h-[calc(var(--knob,3rem)+1.125rem)] w-56 shrink-0 overflow-hidden rounded-lg bg-(--over)/4'
          : 'relative min-h-16 flex-1 overflow-hidden rounded-lg bg-(--over)/4'
      }
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`The EQ’s curve. ${said}. Drag a point to move it; the arrows pick one and set its gain`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={lift}
        onPointerCancel={lift}
        onKeyDown={keys}
        className="absolute inset-0 block size-full touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
      />
    </div>
  )

  if (compact) {
    return (
      <div className="flex min-w-0 flex-col items-center gap-0.5">
        {graph}
        <span className="text-[11px] leading-tight whitespace-nowrap text-(--ink-400)">
          {`${picked + 1} ${kind} `}
          <span className="font-mono text-(--ink-200)">
            {isCut(point.type)
              ? `${text.freq} · Q ${text.q}`
              : `${text.freq} ${text.gain}`}
          </span>
        </span>
      </div>
    )
  }

  const fields: readonly {
    field: EqField
    label: string
    shown: string
    off?: boolean
  }[] = [
    { field: 'freq', label: 'Freq', shown: text.freq },
    { field: 'gain', label: 'Gain', shown: text.gain, off: isCut(point.type) },
    { field: 'q', label: 'Q', shown: text.q },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {graph}
      <div
        role="group"
        aria-label="The points"
        // Beside the editor's graph only, where the panel is tall
        className="hidden shrink-0 grid-cols-6 gap-1 side:grid short:hidden tall:hidden"
      >
        {points.map((each, p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === picked}
            aria-label={`Point ${p + 1}, ${EQ_TYPE_NAMES[each.type] ?? ''}`}
            onClick={() => pick(p)}
            className={`${TALL_HIT} flex h-7 min-w-0 items-center justify-center gap-1 rounded-md bg-(--lift) px-0.5 text-[11px] font-semibold text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0) ${isFlat(each) && p !== picked ? 'opacity-55' : ''}`}
          >
            <PointNumber p={p} lit={p === picked} />
            <span className="min-w-0 truncate">
              {EQ_SHORT_NAMES[each.type]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span id={`${id}-point`} className="flex shrink-0">
          <span className="sr-only">Point </span>
          <PointNumber p={picked} lit />
        </span>
        <Dropdown
          labelId={`${id}-point`}
          options={KIND_OPTIONS}
          value={point.type}
          onChange={(type) => write(picked, retyped(point, type))}
        />
        {fields.map(({ field, label, shown, off }) => (
          <Field
            key={field}
            label={label}
            shown={shown}
            off={off}
            short={field === 'q'}
            value={point[field]}
            onNudge={(by) =>
              write(picked, nudged(now()[picked] ?? point, field, by))
            }
          />
        ))}
      </div>
    </div>
  )
}

/** A point's number in its badge: the accent's, picked */
function PointNumber({ p, lit }: { p: number; lit: boolean }) {
  return (
    <b
      aria-hidden
      className={`flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] px-1 text-[10px] font-extrabold ${lit ? 'bg-(--accent) text-(--bg)' : 'bg-(--over)/8 text-(--ink-300)'}`}
    >
      {p + 1}
    </b>
  )
}

/**
 * One of the picked point's values: its name small over it, dragged up
 * or down (or the arrows) to move it a little; off, a cut's gain, which
 * it has none of
 */
function Field({
  label,
  shown,
  off = false,
  short = false,
  value,
  onNudge,
}: {
  label: string
  shown: string
  off?: boolean
  /** Its value a few letters (a Q's): a narrower field than the others */
  short?: boolean
  value: number
  onNudge: (by: number) => void
}) {
  const from = useRef<number | undefined>(undefined)
  return (
    <div
      role="slider"
      tabIndex={off ? -1 : 0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuetext={shown}
      aria-disabled={off}
      onPointerDown={(event) => {
        if (off) return
        event.currentTarget.setPointerCapture(event.pointerId)
        from.current = event.clientY
      }}
      onPointerMove={(event) => {
        if (from.current === undefined) return
        const by = from.current - event.clientY
        from.current = event.clientY
        if (by !== 0) onNudge(by)
      }}
      onPointerUp={() => (from.current = undefined)}
      onPointerCancel={() => (from.current = undefined)}
      onKeyDown={(event) => {
        const by = { ArrowUp: 5, ArrowDown: -5 }[event.key]
        if (by === undefined || off) return
        event.preventDefault()
        onNudge(by)
      }}
      className={`${TALL_HIT} flex h-7 min-w-0 ${short ? 'flex-[2]' : 'flex-[3]'} cursor-ns-resize touch-none flex-col justify-center rounded-md bg-(--over)/8 px-1.5 outline-none select-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] aria-disabled:cursor-default aria-disabled:opacity-45`}
    >
      <span className="text-[8.5px] leading-none font-semibold tracking-widest text-(--ink-500) uppercase">
        {label}
      </span>
      <span className="truncate font-mono text-[11px] leading-tight text-(--ink-100)">
        {shown}
      </span>
    </div>
  )
}

/** The decades' lines, and their 2s and 5s, in Hz */
const GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const DECADES = new Set([100, 1000, 10000])
const FREQ_LABELS = [
  [100, '100'],
  [1000, '1k'],
  [10000, '10k'],
] as const
const GRID_DB = [-12, -6, 6, 12]

/** Whether the audio access's EQ is heard in runs */
function running(access: EqAccess): boolean {
  return access.heard.engine.snapshot.state === 'running'
}

/**
 * The output access's EQ is heard in, at now (a display frame's time),
 * read once a frame however many views read it (OutputTap); none before
 * the audio runs, nor for a bus's EQ
 */
function heardAt(access: EqAccess, now: number): MasterFrame | undefined {
  const source = access.heard.source()
  if (source === undefined || !running(access)) return undefined
  return outputTap(access.heard.engine, source).read(now)
}

/**
 * Draws an EQ's graph on its canvas: the grid, the spectrum heard behind
 * (its own scale, SPECTRUM_FLOOR to SPECTRUM_TOP up the whole height,
 * as the spectrum view's), the picked point's own curve filled to 0 dB
 * in the accent, the curve of them all, and the points, the picked on
 * top. The curves are worked out as the points change (set), not each
 * frame; a frame of no sound after another draws nothing.
 */
class EqPainter {
  readonly #canvas: HTMLCanvasElement
  #frame: EqFrame | undefined
  #points: readonly EqPoint[] = []
  #picked = 0
  #compact = false
  /** The curve's frequencies, across, and its gains there, dB */
  #freqs = new Float64Array(0)
  #all = new Float64Array(0)
  #own = new Float64Array(0)
  /** The spectrum's level in each CSS pixel's column, dB */
  #columns = new Float32Array(0)
  /** Drawn last with no sound behind: no need to draw so again */
  #bare = false

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas
  }

  /** What it draws: the canvas sized to frame, the curves worked out */
  set(
    frame: EqFrame,
    points: readonly EqPoint[],
    picked: number,
    compact: boolean
  ): void {
    if (frame !== this.#frame) {
      const scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE)
      this.#canvas.width = Math.round(frame.width * scale)
      this.#canvas.height = Math.round(frame.height * scale)
      this.#canvas.getContext('2d')?.setTransform(scale, 0, 0, scale, 0, 0)
      const steps = Math.max(80, Math.round(frame.width / 2))
      this.#freqs = new Float64Array(steps + 1)
      for (let i = 0; i <= steps; i++) {
        this.#freqs[i] = freqAt(frame, xAt(frame, i, steps))
      }
      this.#all = new Float64Array(steps + 1)
      this.#own = new Float64Array(steps + 1)
      const across = Math.round(frame.width - 2 * frame.padX)
      this.#columns = new Float32Array(Math.max(1, across))
    }
    this.#frame = frame
    this.#points = points
    this.#picked = picked
    this.#compact = compact
    eqCurve(points, this.#freqs, this.#all)
    eqCurve(points, this.#freqs, this.#own, picked)
    this.#bare = false
  }

  /**
   * Draws it, spectrum (an analyser's bins, dB, at rate) behind the curve
   * where there is one and it is over the floor
   */
  paint(spectrum?: Float32Array, rate = DRAW_RATE): void {
    const frame = this.#frame
    const context = this.#canvas.getContext('2d')
    if (!frame || !context || frame.width === 0 || frame.height === 0) return
    const columns = this.#columns
    let heard = false
    if (spectrum) {
      spectrumColumns(spectrum, rate, columns)
      for (let c = 0; c < columns.length && !heard; c++) {
        heard = (columns[c] as number) > SPECTRUM_FLOOR
      }
    }
    if (!heard && this.#bare) return
    this.#bare = !heard

    const { width, height } = frame
    const points = this.#points
    const picked = this.#picked
    const compact = this.#compact
    const { over, neutral, dim, tile, page } = ground()
    const { accent } = palette()
    const ink = (share: number) => `rgba(${over}, ${share})`
    const font = "'Recursive Variable', ui-sans-serif, sans-serif"
    context.clearRect(0, 0, width, height)

    context.lineWidth = 1
    for (const freq of GRID_FREQS) {
      const x = Math.round(xOf(frame, freq)) + 0.5
      context.strokeStyle = ink(DECADES.has(freq) ? 0.12 : 0.06)
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
    }
    for (const db of [...GRID_DB, 0]) {
      const y = Math.round(yOf(frame, db)) + 0.5
      context.strokeStyle = ink(db === 0 ? 0.16 : 0.06)
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(width, y)
      context.stroke()
    }

    if (heard) {
      const step = (width - 2 * frame.padX) / columns.length
      const level = (c: number) =>
        dbToY(columns[c] as number, height, SPECTRUM_FLOOR, SPECTRUM_TOP)
      context.beginPath()
      context.moveTo(frame.padX, height)
      for (let c = 0; c < columns.length; c++) {
        context.lineTo(frame.padX + (c + 0.5) * step, level(c))
      }
      context.lineTo(width - frame.padX, height)
      context.closePath()
      context.fillStyle = ink(0.08)
      context.fill()
      context.beginPath()
      for (let c = 0; c < columns.length; c++) {
        context.lineTo(frame.padX + (c + 0.5) * step, level(c))
      }
      context.strokeStyle = ink(0.24)
      context.lineWidth = 1
      context.stroke()
    }

    if (!compact) {
      context.font = `600 9px ${font}`
      context.fillStyle = ink(0.4)
      context.textBaseline = 'bottom'
      for (const [freq, label] of FREQ_LABELS) {
        context.fillText(label, xOf(frame, freq) + 3, height - 3)
      }
      if (height > 150) {
        context.textBaseline = 'middle'
        for (const db of GRID_DB) {
          const sign = db > 0 ? '+' : '−'
          context.fillText(`${sign}${Math.abs(db)}`, 4, yOf(frame, db))
        }
      }
    }

    const steps = this.#all.length - 1
    /** A curve's height, held a little past the graph */
    const yAt = (db: number) =>
      yOf(frame, Math.min(Math.max(db, -EQ_SPAN_DB * 1.6), EQ_SPAN_DB * 1.6))
    const trace = (curve: Float64Array) => {
      for (let i = 0; i <= steps; i++) {
        const x = xAt(frame, i, steps)
        const y = yAt(curve[i] as number)
        if (i === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
    }

    const chosen = points[picked]
    if (chosen && !isFlat(chosen)) {
      context.beginPath()
      context.moveTo(xAt(frame, 0, steps), yOf(frame, 0))
      trace(this.#own)
      context.lineTo(xAt(frame, steps, steps), yOf(frame, 0))
      context.closePath()
      context.fillStyle = alpha(accent, 0.2)
      context.fill()
      context.beginPath()
      trace(this.#own)
      context.strokeStyle = alpha(accent, 0.8)
      context.lineWidth = 1.25
      context.stroke()
    }

    context.beginPath()
    trace(this.#all)
    context.strokeStyle = neutral
    context.lineWidth = 2
    context.lineJoin = 'round'
    context.stroke()

    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const radius = compact ? 6 : 8
    context.font = `750 ${compact ? 8 : 9.5}px ${font}`
    // The picked last, on top
    for (let k = 0; k <= points.length; k++) {
      const p = k === points.length ? picked : k
      const point = points[p]
      if (!point || (k < points.length && p === picked)) continue
      const { x, y } = placeOf(frame, point)
      const lit = p === picked
      const flat = isFlat(point)
      context.beginPath()
      context.arc(x, y, lit ? radius + 1.5 : radius, 0, 2 * Math.PI)
      context.fillStyle = lit ? accent : tile
      context.fill()
      if (!lit) {
        context.lineWidth = 1.5
        context.strokeStyle = flat ? ink(0.35) : dim
        if (isOff(point.type, point.freq)) context.setLineDash([2.5, 2.5])
        context.stroke()
        context.setLineDash([])
      }
      context.fillStyle = lit ? page : flat ? ink(0.45) : neutral
      context.fillText(`${p + 1}`, x, y + 0.5)
    }
    context.textAlign = 'start'
  }
}

/** Where step i of steps stands across the curve */
function xAt(frame: EqFrame, i: number, steps: number): number {
  return frame.padX + (i / steps) * (frame.width - 2 * frame.padX)
}
