import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { Engine } from '../engine/engine'
import type { LaneKnob } from '../state/lanes'
import { formatValue, toNormalized, toValue } from '../state/params'
import {
  editLane,
  removeLane,
  setLaneGlide,
  setLaneOn,
  setLaneValues,
  type KnobLane,
  type Loop,
} from '../state/song'
import {
  FILLS,
  fillLevels,
  laneColumn,
  laneLevel,
  laneOutline,
  readout,
  stroke,
  type Fill,
  type LanePoint,
} from '../viz/laneStrip'
import { COLUMNS } from '../viz/steps'
import { ConfirmDialog } from './ConfirmDialog'
import { SMALL_BUTTON, SMALL_OPTION } from './controls'
import { SmallIconButton } from './IconButton'
import { Switch } from './Switch'

const CROSS = 'M5 5l8 8M13 5l-8 8'

const CELL = 'border-r border-(--under)/50 bg-(--over)/7'
const BEAT_CELL = 'border-r border-(--under)/50 bg-(--over)/12'

/** The lane's name: its knob's */
const NAME =
  'flex h-7 min-w-0 flex-1 items-center gap-1.5 px-1 text-[11px] font-semibold text-(--ink-200)'

/** How far an arrow key moves the step focused, of the knob's turn */
const KEY_STEP = 0.05

/** The steps of the bar shown, read from a lane of those values */
function valueAt(values: readonly number[], step: number, own: number) {
  return values.length === 0 ? own : (values[step % values.length] ?? own)
}

/** A finger drawing on the strip, and where it last stood */
interface Draw {
  readonly pointer: number
  last: LanePoint
}

/**
 * One knob lane of the Seq tab's loop, under its step grid (docs/plan/
 * tracks-and-song.md, F): its knob's value at each step of the bar shown,
 * the columns in line with the grid's, the knob's own value dashed across
 * it. A finger drawn over it writes the steps it passes, in the knob's
 * turn (the top its highest); a lane off is put on by it. Over it: the
 * lane's name, Step or Glide, on or off, Fill (a shape over the whole
 * loop) and remove. At its left the value playing, or stopped the knob's
 * own. The step playing is lit outside React, as the audio thread tells
 * of it.
 */
export function LaneStrip({
  engine,
  loop,
  lane,
  knob,
  own,
  bar,
  aside,
  label,
  onHint,
}: {
  engine: Engine
  loop: Loop
  lane: KnobLane
  /** Its knob on the track: none where the sound has it no longer */
  knob: LaneKnob | undefined
  /** The knob's own value, in its units */
  own: number
  bar: number
  /** Whether a row navigator stands at the grid's left */
  aside: boolean
  /** The grid's labels' width: the readout stands under them */
  label: string
  onHint: (hint: string) => void
}) {
  const headRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef<HTMLSpanElement>(null)
  const unitRef = useRef<HTMLSpanElement>(null)
  const drawRef = useRef<Draw | null>(null)
  const [filling, setFilling] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [focus, setFocus] = useState(0)
  const { part, key } = lane
  const name = knob?.name ?? `${part} · ${key}`
  const spec = knob?.spec

  // The step playing lit in the bar shown, and the value it plays
  useEffect(() => {
    const head = headRef.current
    const value = valueRef.current
    const unit = unitRef.current
    if (!head || !value || !unit) return
    const show = (step: number) => {
      const at = step < 0 ? -1 : step % loop.steps
      const playing = at < 0 ? -1 : Math.floor(at / COLUMNS)
      head.hidden = playing !== bar
      if (playing === bar) {
        head.style.left = `${((at % COLUMNS) / COLUMNS) * 100}%`
      }
      const now = at >= 0 && lane.on ? valueAt(lane.values, at, own) : own
      const [top, bottom] = spec ? readout(formatValue(spec, now)) : ['']
      if (value.textContent !== top) value.textContent = top
      if (unit.textContent !== (bottom ?? '')) unit.textContent = bottom ?? ''
    }
    show(engine.step)
    return engine.watchSteps(show)
  }, [engine, loop.steps, bar, lane, own, spec])

  // A finger still down as the strip goes leaves no hint behind
  useEffect(() => () => onHint(''), [onHint])

  /** Writes levels at the loop's steps from from on, the lane put on */
  const write = (from: number, levels: readonly number[]) => {
    if (!spec) return
    const values = levels.map((level) => toValue(spec, level))
    engine.editSeqLoop((each) =>
      editLane(each, part, key, (was) =>
        setLaneOn(setLaneValues(was, from, values), true)
      )
    )
  }

  const pointAt = (event: PointerEvent<HTMLDivElement>): LanePoint => {
    const box = event.currentTarget.getBoundingClientRect()
    const column = laneColumn((event.clientX - box.left) / box.width)
    return {
      step: bar * COLUMNS + column,
      level: laneLevel((event.clientY - box.top) / box.height),
    }
  }

  const hint = (level: number) => {
    if (spec) onHint(`${spec.label} ${formatValue(spec, toValue(spec, level))}`)
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!spec || drawRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointAt(event)
    const { from, levels } = stroke(undefined, point)
    write(from, levels)
    hint(point.level)
    setFocus(point.step % COLUMNS)
    drawRef.current = { pointer: event.pointerId, last: point }
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const draw = drawRef.current
    if (!draw || draw.pointer !== event.pointerId) return
    const point = pointAt(event)
    if (point.step === draw.last.step && point.level === draw.last.level) {
      return
    }
    const { from, levels } = stroke(draw.last, point)
    write(from, levels)
    hint(point.level)
    draw.last = point
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    const draw = drawRef.current
    if (!draw || draw.pointer !== event.pointerId) return
    drawRef.current = null
    onHint('')
  }

  const levelAt = (step: number) =>
    spec ? toNormalized(spec, valueAt(lane.values, step, own)) : 0
  const focused = bar * COLUMNS + focus

  // The arrows move the step focused, and its value
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const by = event.key === 'ArrowRight' ? 1 : COLUMNS - 1
      setFocus((was) => (was + by) % COLUMNS)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const by = event.key === 'ArrowUp' ? KEY_STEP : -KEY_STEP
      const level = Math.min(1, Math.max(0, levelAt(focused) + by))
      write(focused, [level])
    } else {
      return
    }
    event.preventDefault()
  }

  const levels = Array.from({ length: COLUMNS }, (_, column) =>
    levelAt(bar * COLUMNS + column)
  )
  const next = levelAt(((bar + 1) * COLUMNS) % loop.steps)
  const outline = laneOutline(levels, next, lane.glide)
  const ownLevel = spec ? toNormalized(spec, own) : 0.5
  const ink = lane.on && spec ? 'text-(--modulator)' : 'text-(--ink-500)'

  const fill = (shape: Fill) => {
    setFilling(false)
    write(0, fillLevels(shape, loop.steps, ownLevel))
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        {filling ? (
          <>
            <div
              role="group"
              aria-label={`Fill the ${name} lane`}
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
            >
              {FILLS.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => fill(shape)}
                  className={SMALL_OPTION}
                >
                  {shape}
                </button>
              ))}
            </div>
            <SmallIconButton
              label="No fill"
              path={CROSS}
              onClick={() => setFilling(false)}
            />
          </>
        ) : (
          <>
            <h4 className={NAME}>
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full bg-current ${ink}`}
              />
              <span className="truncate">
                {knob ? name : `${name} · not on this sound`}
              </span>
            </h4>
            <div
              role="group"
              aria-label={`${name}: between steps`}
              className="flex shrink-0 gap-1"
            >
              <button
                type="button"
                aria-pressed={!lane.glide}
                onClick={() =>
                  engine.editSeqLoop((each) =>
                    editLane(each, part, key, (was) => setLaneGlide(was, false))
                  )
                }
                className={SMALL_OPTION}
              >
                Step
              </button>
              <button
                type="button"
                aria-pressed={lane.glide}
                onClick={() =>
                  engine.editSeqLoop((each) =>
                    editLane(each, part, key, (was) => setLaneGlide(was, true))
                  )
                }
                className={SMALL_OPTION}
              >
                Glide
              </button>
            </div>
            <Switch
              checked={lane.on}
              label={`${name} lane`}
              onChange={(on) =>
                engine.editSeqLoop((each) =>
                  editLane(each, part, key, (was) => setLaneOn(was, on))
                )
              }
            />
            <button
              type="button"
              disabled={!spec}
              onClick={() => setFilling(true)}
              className={SMALL_BUTTON}
            >
              Fill
            </button>
            <SmallIconButton
              label={`Remove the ${name} lane`}
              path={CROSS}
              onClick={() => setRemoving(true)}
            />
          </>
        )}
      </div>

      <div className="flex h-12 shrink-0 gap-1">
        {aside && <div aria-hidden className="w-4 shrink-0" />}
        <div
          aria-hidden
          className={`flex shrink-0 flex-col items-end justify-center pr-1 font-mono text-[10px] leading-tight ${label} ${ink}`}
        >
          <span ref={valueRef} />
          <span ref={unitRef} className="text-(--ink-400)" />
        </div>
        <div
          role="slider"
          tabIndex={spec ? 0 : -1}
          aria-label={`${name}, step ${focus + 1} of bar ${bar + 1}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(levelAt(focused) * 100)}
          aria-valuetext={
            spec ? formatValue(spec, valueAt(lane.values, focused, own)) : ''
          }
          aria-disabled={!spec}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onKeyDown={keyDown}
          className="group relative min-w-0 flex-1 touch-none overflow-hidden rounded-md outline-none"
        >
          <div className="absolute inset-0 grid grid-cols-16">
            {Array.from({ length: COLUMNS }, (_, column) => (
              <div
                key={column}
                className={column % 4 === 0 ? BEAT_CELL : CELL}
              />
            ))}
          </div>
          <div
            ref={headRef}
            hidden
            className="pointer-events-none absolute inset-y-0 w-[6.25%] bg-(--lift-3)"
          />
          <svg
            aria-hidden
            viewBox={`0 0 ${COLUMNS} 1`}
            preserveAspectRatio="none"
            className={`pointer-events-none absolute inset-0 size-full ${ink}`}
          >
            <path d={outline.area} fill="currentColor" fillOpacity={0.25} />
            <path
              d={outline.line}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {spec && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-(--ink-400)"
              style={{ top: `${(1 - ownLevel) * 100}%` }}
            />
          )}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 hidden w-[6.25%] rounded-sm shadow-[inset_0_0_0_1.5px_var(--accent)] group-focus-visible:block"
            style={{ left: `${(focus / COLUMNS) * 100}%` }}
          />
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          title="Remove this lane?"
          message={`${name} plays its own value again, in every bar.`}
          confirm="Remove"
          onConfirm={() => {
            setRemoving(false)
            engine.editSeqLoop((each) => removeLane(each, part, key))
          }}
          onCancel={() => setRemoving(false)}
        />
      )}
    </div>
  )
}
