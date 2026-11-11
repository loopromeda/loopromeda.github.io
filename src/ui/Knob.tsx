import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { Engine } from '../engine/engine'
import {
  formatAmount,
  formatValue,
  toNormalized,
  toValue,
  type ValueSpec,
} from '../state/params'
import { AMOUNT_SPEC } from '../state/sound/kinds'
import {
  depthOf,
  knobDest,
  knobReach,
  knobSpec,
  knobValue,
  routesTo,
  setDepth,
  setKnob,
  type PartDest,
} from '../state/sound/knob'
import { FINE_ZONES, fineZone, type FineZone } from '../viz/fine'
import { HOLD, KNOB_SIZE } from './controls'
import { MOD_COLOR } from './editor'
import { keepHeld } from './held'

/** CSS pixels of vertical drag that sweep a knob from end to end */
const TRAVEL = 160
const FULL_SPEED = FINE_ZONES[0] as FineZone
/** A second tap within this many ms puts the knob back to its default */
const DOUBLE_TAP = 300
/** A touch that moves less than this (CSS px) is a tap, not a drag */
const TAP_SLOP = 4
/** Knob travel the arrow keys move a continuous knob by */
const KEY_STEP = 0.01
/** The knob turns through 270°, from 7:30 to 4:30 on a clock face */
const SWEEP = 270
const RADIUS = 18
const CENTER = 24
/**
 * A stepped knob with at most this many stops shows each one as a dot
 * around its arc (Wave, Octave); with more (Semi's 25) the dots would crowd
 * into a ring, so it shows none
 */
const MAX_DETENTS = 8
/** The dots sit just outside the arc, which is 4 wide around RADIUS */
const DETENT_RADIUS = 22.5
/**
 * Where the routes take a knob: a thin sky arc outside its own, where a
 * stepped knob's dots would be (none of those is a destination)
 */
const REACH_RADIUS = 22.5

/** Where on the arc (in degrees from 12 o'clock) a knob position falls */
const angleOf = (normalized: number) => (normalized - 0.5) * SWEEP

/** The point `radius` from the centre at `degrees` from 12 o'clock */
const polar = (degrees: number, radius: number) => {
  const radians = (degrees * Math.PI) / 180
  return {
    x: CENTER + radius * Math.sin(radians),
    y: CENTER - radius * Math.cos(radians),
  }
}

/** The arc at radius; a value is a dash along it (pathLength 100) */
const arcAt = (radius: number) => {
  const at = (degrees: number) => {
    const { x, y } = polar(degrees, radius)
    return `${x.toFixed(3)} ${y.toFixed(3)}`
  }
  return `M ${at(-SWEEP / 2)} A ${radius} ${radius} 0 1 1 ${at(SWEEP / 2)}`
}
const ARC = arcAt(RADIUS)
const REACH_ARC = arcAt(REACH_RADIUS)

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** A knob's arc where nothing colours it: zinc-300 */
export const NEUTRAL_ARC = '#d4d4d8'

/**
 * Counts the fine drags under way, on any knob, on the document: while
 * there are any, every knob but theirs dims (the wrapper's in-data-fine)
 */
function countFine(change: 1 | -1) {
  const root = document.documentElement
  const count = Number(root.dataset.fine ?? 0) + change
  if (count > 0) root.dataset.fine = `${count}`
  else delete root.dataset.fine
}

/** Where a stepped knob's stops fall on the dial, or none (see MAX_DETENTS) */
function detents(spec: ValueSpec): { x: number; y: number }[] {
  if (!(spec.step > 0)) return []
  const count = Math.round((spec.max - spec.min) / spec.step) + 1
  if (count < 2 || count > MAX_DETENTS) return []
  return Array.from({ length: count }, (_, i) =>
    polar(angleOf(toNormalized(spec, spec.min + i * spec.step)), DETENT_RADIUS)
  )
}

/**
 * One knob of the sound, by part and key (src/state/sound/knob.ts), as a
 * rotary knob: drag up or down anywhere on it (each finger its own knob),
 * double-tap for the default, arrow keys, Page Up/Down and Home/End from
 * the keyboard. A drag goes straight to the engine and the knob redraws
 * by setting SVG attributes and text: no React state, so nothing
 * re-renders while it turns. It also follows its value changed from
 * elsewhere (a preset loaded).
 *
 * A finger that strays sideways while it drags turns the knob finer, a
 * quarter or a tenth as fast (src/viz/fine.ts), from where it stands: a
 * long way up or down for a small change, the knob in sight. The knob
 * lights up in its colour while a finger turns it; while it turns finely
 * it shows how finely (÷4, ÷10, under its arc), every other knob dims, a
 * line runs from it to the finger, and each change of speed ticks the
 * phone (where it can vibrate).
 *
 * A two-sided range (Octave, Semi, Fine) lights the arc from its zero, a
 * one-sided range from its minimum, in `color`: a chain's, or neutral. A
 * knob with a few stops (Wave, Octave) marks each with a white dot around
 * the arc. A `hot` label is drawn in that colour (the input a chain's
 * peg was tapped for).
 *
 * A knob that a route can move (knobDest) is held to route to it: a touch
 * kept still for HOLD, a right click, or Enter calls onHold. Sky marks
 * the routes into it: a count, and an arc outside its own from where it
 * stands to where they take it at full.
 */
export function Knob({
  engine,
  part,
  knob,
  color = NEUTRAL_ARC,
  hot,
  onHold,
  label,
  format,
}: {
  engine: Engine
  part: string
  knob: string
  color?: string
  hot?: string
  /** Opens the routes into the knob's destination */
  onHold?: (dest: string) => void
  /** Its name, if not the knob's own (a route's amount by its source) */
  label?: string
  /** Its readout, if not the knob's own (an amount in its target's units) */
  format?: (value: number) => string
}) {
  const spec = knobSpec(engine.getSound(), part, knob)
  if (!spec) return null
  return (
    <Dial
      engine={engine}
      address={`${part} ${knob}`}
      turns={{
        spec: label === undefined ? spec : { ...spec, label },
        read: () => knobValue(engine.getSound(), part, knob),
        write: (value) =>
          engine.edit((sound) => setKnob(sound, part, knob, value)),
        format: format ?? ((value) => formatValue(spec, value)),
      }}
      color={color}
      hot={hot}
      routed={{ part, knob, onHold }}
    />
  )
}

/**
 * How far source moves a destination of target, as a sky knob from -100%
 * to +100% around nothing, read in the destination's units: turned from
 * 0 it adds the route, turned back (or double-tapped) it removes it
 * (setDepth). The editor's knobs turn into these while it routes a source.
 */
export function DepthKnob({
  engine,
  source,
  target,
  at: { key, label, dest },
}: {
  engine: Engine
  source: string
  target: string
  at: PartDest
}) {
  return (
    <Dial
      engine={engine}
      address={`${source} ${target} ${key}`}
      turns={{
        spec: { ...AMOUNT_SPEC, label },
        read: () => depthOf(engine.getSound(), source, target, key),
        write: (amount) =>
          engine.edit((sound) => setDepth(sound, source, target, key, amount)),
        format: (amount) => (amount === 0 ? 'Off' : formatAmount(dest, amount)),
      }}
      color={MOD_COLOR}
      hot={undefined}
    />
  )
}

/** What a dial turns: a value in its spec's range, read and written */
interface Turns {
  readonly spec: ValueSpec & { readonly label: string }
  readonly read: () => number
  readonly write: (value: number) => void
  readonly format: (value: number) => string
}

/** The knob of the sound a dial turns: its routes drawn, held to route */
interface Routed {
  readonly part: string
  readonly knob: string
  readonly onHold: ((dest: string) => void) | undefined
}

function Dial({
  engine,
  address,
  turns,
  color,
  hot,
  routed,
}: {
  engine: Engine
  /** What it turns, as a key: a new one, a new listener */
  address: string
  turns: Turns
  color: string
  hot: string | undefined
  routed?: Routed
}) {
  const { spec } = turns
  /** The latest of what it turns, for the listener set up once per dial */
  const turnsRef = useRef(turns)
  /** The value drawn last, so a change elsewhere in the sound draws nothing */
  const shownRef = useRef(Number.NaN)
  const rootRef = useRef<HTMLDivElement>(null)
  const arcRef = useRef<SVGPathElement>(null)
  const pointerRef = useRef<SVGLineElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const reachRef = useRef<SVGPathElement>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const tagRef = useRef<HTMLSpanElement>(null)
  const tetherRef = useRef<SVGSVGElement>(null)
  const tieRef = useRef<SVGLineElement>(null)
  /** The routes drawn last, as a key, so an unrelated change draws nothing */
  const routesShownRef = useRef('')
  /** The latest knob it turns, for a hold that fires after a redraw */
  const routedRef = useRef(routed)
  /** The drag in progress, and when the last tap ended */
  const gesture = useRef({
    pointerId: -1,
    /** Where the finger came down across, and where it was last up */
    startX: 0,
    lastY: 0,
    /**
     * Where the drag has the knob, 0 to 1, not snapped: a stepped knob
     * follows the finger between its steps
     */
    n: 0,
    moved: false,
    /** How fast it turns, by how far the finger has strayed sideways */
    zone: FULL_SPEED,
    /** The knob's centre and radius on the screen, for the line */
    cx: 0,
    cy: 0,
    r: 0,
    lastTap: -Infinity,
    /** The pending hold's timer, 0 for none */
    hold: 0,
  })

  const origin = spec.min < 0 && spec.max > 0 ? toNormalized(spec, 0) : 0

  const read = () => turnsRef.current.read()

  /** Draws `value` into the SVG, the readout and the slider's ARIA state */
  const show = (value: number) => {
    const { spec, format } = turnsRef.current
    shownRef.current = value
    const normalized = toNormalized(spec, value)
    const from = Math.min(origin, normalized) * 100
    const to = Math.max(origin, normalized) * 100
    arcRef.current?.setAttribute('stroke-dasharray', `${to - from} 200`)
    arcRef.current?.setAttribute('stroke-dashoffset', `${-from}`)
    pointerRef.current?.setAttribute(
      'transform',
      `rotate(${angleOf(normalized)} ${CENTER} ${CENTER})`
    )
    const text = format(value)
    if (textRef.current) textRef.current.textContent = text
    const root = rootRef.current
    if (root) {
      root.setAttribute('aria-valuenow', `${value}`)
      root.setAttribute('aria-valuetext', text)
    }
  }

  /**
   * Draws the routes into the knob: their count on the badge, and the arc
   * from where it stands to where they take it (none when they move it as
   * another destination, a pitch)
   */
  const showRoutes = () => {
    const at = routedRef.current
    if (!at) return
    const { part, knob } = at
    const sound = engine.getSound()
    const dest = knobDest(sound, part, knob)
    const count = dest === undefined ? 0 : routesTo(sound, part, dest).length
    const reach = knobReach(sound, part, knob)
    const key = `${dest} ${count} ${reach?.join(' ')}`
    if (key === routesShownRef.current) return
    routesShownRef.current = key
    const arc = reachRef.current
    if (arc) {
      const [from, to] = reach ?? [0, 0]
      const low = Math.min(from, to) * 100
      const high = Math.max(from, to) * 100
      arc.setAttribute('stroke-dasharray', `${high - low} 200`)
      arc.setAttribute('stroke-dashoffset', `${-low}`)
      arc.style.display = reach && high > low ? '' : 'none'
    }
    const badge = badgeRef.current
    if (badge) {
      badge.textContent = `${count}`
      badge.style.display = count > 0 ? '' : 'none'
    }
    const root = rootRef.current
    if (root) {
      const routes =
        count === 0 ? '' : count === 1 ? '1 route. ' : `${count} routes. `
      if (dest === undefined) root.removeAttribute('aria-description')
      else root.setAttribute('aria-description', `${routes}Hold to route.`)
    }
  }

  const set = (value: number) => {
    turnsRef.current.write(value)
    show(read())
  }

  /** Opens the routes into the knob, if it has a destination */
  const hold = () => {
    const at = routedRef.current
    if (!at?.onHold) return
    const dest = knobDest(engine.getSound(), at.part, at.knob)
    if (dest !== undefined) at.onHold(dest)
  }

  /** Runs the line from the knob's edge to the finger at x, y */
  const tie = (x: number, y: number) => {
    const line = tieRef.current
    if (!line) return
    const { cx, cy, r } = gesture.current
    const dx = x - cx
    const dy = y - cy
    const away = Math.hypot(dx, dy)
    // Over the knob, there is nothing to tie
    line.style.display = away > r ? '' : 'none'
    if (away <= r) return
    line.setAttribute('x1', `${cx + (dx / away) * r}`)
    line.setAttribute('y1', `${cy + (dy / away) * r}`)
    line.setAttribute('x2', `${x}`)
    line.setAttribute('y2', `${y}`)
  }

  /**
   * Turns at `zone`'s speed from here on, and shows it: its tag, and while
   * it is slow the other knobs dimmed and the line to the finger
   */
  const pace = (zone: FineZone) => {
    const g = gesture.current
    if (zone === g.zone) return
    const was = g.zone.speed < 1
    const is = zone.speed < 1
    g.zone = zone
    const tag = tagRef.current
    if (tag) {
      tag.textContent = zone.tag
      tag.style.display = is ? '' : 'none'
    }
    if (is === was) return
    countFine(is ? 1 : -1)
    wrapRef.current?.toggleAttribute('data-fine', is)
    const tether = tetherRef.current
    if (tether) tether.style.display = is ? '' : 'none'
    const root = rootRef.current
    if (is && root) {
      const box = root.getBoundingClientRect()
      g.cx = box.left + box.width / 2
      g.cy = box.top + box.height / 2
      g.r = box.width / 2
    }
  }

  /** The finger is off the knob: it stops lighting up and turns at full */
  const release = () => {
    rootRef.current?.removeAttribute('data-turning')
    pace(FULL_SPEED)
  }

  // Before the first paint: the knob never flashes a wrong position
  useLayoutEffect(() => {
    turnsRef.current = turns
    routedRef.current = routed
    show(read())
    showRoutes()
  })

  // A value set elsewhere: a preset loaded, the sound read back; a route
  // added, turned or removed
  useLayoutEffect(
    () =>
      engine.subscribeSound(() => {
        const value = read()
        if (value !== shownRef.current) show(value)
        showRoutes()
      }),
    // show, showRoutes and read use only refs; address names what they read
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, address]
  )

  // A hold still pending when the knob goes away fires nothing, and a fine
  // drag on it leaves the other knobs lit
  useEffect(() => {
    const g = gesture.current
    return () => {
      window.clearTimeout(g.hold)
      if (g.zone.speed < 1) countFine(-1)
    }
  }, [])

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (g.pointerId !== -1) return
    if (event.timeStamp - g.lastTap < DOUBLE_TAP) {
      g.lastTap = -Infinity
      set(spec.default)
      return
    }
    // Keep receiving this finger's moves even when it leaves the knob
    const target = event.currentTarget
    const { pointerId } = event
    target.setPointerCapture(pointerId)
    g.pointerId = pointerId
    g.startX = event.clientX
    g.lastY = event.clientY
    g.n = toNormalized(spec, read())
    g.moved = false
    if (routedRef.current?.onHold) {
      g.hold = window.setTimeout(() => {
        g.hold = 0
        if (g.pointerId !== pointerId || g.moved) return
        // Held: this touch neither turns the knob nor counts as a tap
        g.pointerId = -1
        g.lastTap = -Infinity
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId)
        }
        navigator.vibrate?.(10)
        keepHeld(pointerId)
        hold()
      }, HOLD)
    }
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (event.pointerId !== g.pointerId) return
    const { clientX: x, clientY: y } = event
    if (!g.moved) {
      const slop = Math.max(Math.abs(g.lastY - y), Math.abs(g.startX - x))
      if (slop < TAP_SLOP) return
      // A drag from here on; measured from here, so the knob does not jump
      g.moved = true
      g.lastY = y
      window.clearTimeout(g.hold)
      rootRef.current?.setAttribute('data-turning', '')
    }
    const before = g.zone
    pace(fineZone(x - g.startX, g.zone))
    if (g.zone !== before) navigator.vibrate?.(5)
    if (g.zone.speed < 1) tie(x, y)
    // Up turns it up, by each step at the speed it moved at
    g.n = clamp01(g.n + ((g.lastY - y) / TRAVEL) * g.zone.speed)
    g.lastY = y
    const value = toValue(spec, g.n)
    if (value !== read()) set(value)
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    // pointerup is followed by lostpointercapture: act on the first only
    if (event.pointerId !== g.pointerId) return
    window.clearTimeout(g.hold)
    g.pointerId = -1
    g.lastTap = g.moved ? -Infinity : event.timeStamp
    release()
  }

  // A right click holds the knob too; a touch's long press is the timer's
  const menu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const { pointerType } = event.nativeEvent as globalThis.PointerEvent
    if (pointerType !== 'touch' && pointerType !== 'pen') hold()
  }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const value = read()
    const normalized = toNormalized(spec, value)
    // A stepped knob moves a step at a time, a continuous one by KEY_STEP
    const nudge = (direction: number, times = 1) =>
      spec.step > 0
        ? value + direction * spec.step * times
        : toValue(spec, clamp01(normalized + direction * KEY_STEP * times))
    let next: number
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = nudge(1)
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        next = nudge(-1)
        break
      case 'PageUp':
        next = nudge(1, 10)
        break
      case 'PageDown':
        next = nudge(-1, 10)
        break
      case 'Home':
        next = spec.min
        break
      case 'End':
        next = spec.max
        break
      case 'Enter':
        event.preventDefault()
        hold()
        return
      default:
        return
    }
    event.preventDefault()
    set(next)
  }

  return (
    <div
      ref={wrapRef}
      className="flex min-w-0 flex-col items-center gap-0.5 transition-opacity duration-150 in-data-fine:opacity-30 data-fine:opacity-100"
    >
      <div
        ref={rootRef}
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onContextMenu={menu}
        onKeyDown={key}
        style={{ '--tone': color } as CSSProperties}
        className={`${KNOB_SIZE} relative aspect-square touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 data-turning:bg-[color-mix(in_oklab,var(--tone)_18%,transparent)] data-turning:shadow-[0_0_0_1.5px_var(--tone)]`}
      >
        <svg viewBox="0 0 48 48" className="block size-full" aria-hidden>
          <path
            ref={reachRef}
            d={REACH_ARC}
            pathLength={100}
            fill="none"
            stroke={MOD_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            style={{ display: 'none' }}
          />
          {detents(spec).map(({ x, y }, i) => (
            <circle key={i} cx={x} cy={y} r={1.25} className="fill-white" />
          ))}
          <path
            d={ARC}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            className="text-white/10"
          />
          <path
            ref={arcRef}
            d={ARC}
            pathLength={100}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <circle cx={CENTER} cy={CENTER} r={12} className="fill-zinc-800" />
          <line
            ref={pointerRef}
            x1={CENTER}
            y1={14}
            x2={CENTER}
            y2={19}
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="text-zinc-100"
          />
        </svg>
        <span
          ref={badgeRef}
          aria-hidden
          style={{ display: 'none', background: MOD_COLOR }}
          className="absolute -top-0.5 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-bold text-zinc-950"
        />
        {/* How finely it turns, in the gap at the foot of the arc */}
        <span
          ref={tagRef}
          aria-hidden
          style={{ display: 'none', background: color }}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full px-1 py-px text-[9px] leading-none font-bold text-zinc-950"
        />
      </div>
      {/* The line from the knob to a finger turning it finely, over all */}
      {createPortal(
        <svg
          ref={tetherRef}
          aria-hidden
          style={{ display: 'none' }}
          className="pointer-events-none fixed inset-0 z-50 size-full"
        >
          <line
            ref={tieRef}
            stroke={color}
            strokeOpacity={0.7}
            strokeWidth={1.5}
            strokeDasharray="3 4"
            strokeLinecap="round"
          />
        </svg>,
        document.body
      )}
      <span
        style={hot ? { color: hot } : undefined}
        className="text-[11px] leading-tight whitespace-nowrap text-zinc-400"
      >
        {spec.label}
      </span>
      <span
        ref={textRef}
        className="font-mono text-[11px] leading-tight whitespace-nowrap text-zinc-200 tabular-nums"
      />
    </div>
  )
}
