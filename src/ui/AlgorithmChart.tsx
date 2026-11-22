import { FM6_ALGORITHMS, FM6_OPS } from '../dsp/fm6'
import { CHART_COLUMNS, CHART_ROWS, algorithmChart, opRole } from '../viz/fm6'
import { neutralLook } from './editor'

/** The band under the bottom row the output's line runs in, in rows */
const BUS = 0.4
/** The chart's box in its units: a column wide, a row tall each */
const WIDTH = CHART_COLUMNS
const HEIGHT = CHART_ROWS + BUS
/**
 * An operator's box, halved, in a row's units: its button's inset-y
 * (16%) leaves it, as its inset-x (18%) leaves it 0.32 of a column
 */
const HALF_H = 0.34
/** How far a feedback's loop stands out from its operator's box */
const LOOP = 0.12
/** Where the loop's upright runs, right of its operator's middle */
const LOOP_X = 0.46

/**
 * An FM6's algorithm as the DX7's chart draws it (src/viz/fm6.ts): its
 * six operators, each a box with its number lit by its level; the
 * carriers on the bottom row, the output's line under them; each
 * modulator over what it modulates, a line down into it; the feedback a
 * loop from an operator's foot round its right side into the top of
 * itself (or, in algorithms 4 and 6, of the stack's top). Every chart on
 * the same grid (six across, four high), so an operator keeps its size
 * from one algorithm to the next, the chart in the middle of the box it
 * is given. A tap on an operator opens it (onPick).
 *
 * @category Panels
 */
export function AlgorithmChart({
  algorithm,
  levels,
  onPick,
  className = '',
}: {
  /** Which of the 32, from 1 */
  algorithm: number
  /** Each operator's output level, 0..99, OP1 first */
  levels: readonly number[]
  /** An operator tapped (0 is OP1); none, the chart is only seen */
  onPick?: (op: number) => void
  className?: string
}) {
  const at = Math.min(Math.max(Math.round(algorithm), 1), FM6_ALGORITHMS.length)
  const spec = FM6_ALGORITHMS[at - 1] ?? FM6_ALGORITHMS[0]
  if (!spec) return null
  const chart = algorithmChart(spec)
  const offset = (WIDTH - chart.columns) / 2
  const x = (op: number) => offset + (chart.ops[op]?.column ?? 0) + 0.5
  const y = (op: number) => CHART_ROWS - (chart.ops[op]?.row ?? 0) - 0.5
  const look = neutralLook()

  // A modulator's line from its foot to the top of what it modulates,
  // square where it bends: down halfway, across, down
  const links = spec.modulators.flatMap((from, target) =>
    from.map((op) => {
      const top = y(target) - HALF_H
      const foot = y(op) + HALF_H
      if (Math.abs(x(op) - x(target)) < 0.01) {
        return `M${x(op)} ${foot}V${top}`
      }
      const middle = (foot + top) / 2
      return `M${x(op)} ${foot}V${middle}H${x(target)}V${top}`
    })
  )
  // The carriers down onto the output's line, which spans them
  const bus = CHART_ROWS + BUS / 2
  const carriers = spec.carriers.map((op) => x(op))
  const busPath = [
    ...spec.carriers.map((op) => `M${x(op)} ${y(op) + HALF_H}V${bus}`),
    `M${Math.min(...carriers) - 0.2} ${bus}H${Math.max(...carriers) + 0.2}`,
  ]
  const { from, to } = spec.feedback
  const side = x(from) + LOOP_X
  const loop = `M${x(from)} ${y(from) + HALF_H}V${y(from) + HALF_H + LOOP}H${side}V${y(to) - HALF_H - LOOP}H${x(to)}V${y(to) - HALF_H}`

  return (
    <div
      role="group"
      aria-label={`Algorithm ${at}: ${spec.carriers.length === 1 ? 'OP' : 'OPs'} ${spec.carriers.map((op) => op + 1).join(', ')} heard`}
      className={`relative h-full w-full ${className}`}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden
        className="absolute inset-0 size-full"
      >
        <path
          d={[...links, ...busPath, loop].join('')}
          fill="none"
          stroke={look.ring}
          strokeWidth={1.25}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {Array.from({ length: FM6_OPS }, (_, op) => {
        const level = Math.min(Math.max(levels[op] ?? 0, 0), 99)
        const carrier = spec.carriers.includes(op)
        const box = (
          <span
            aria-hidden
            className="absolute inset-x-[18%] inset-y-[16%] flex items-center justify-center rounded-[3px] font-mono text-[10px] leading-none font-bold"
            style={{
              // Lit as loud as it is: a silent one only its ring
              background: `color-mix(in oklab, ${look.ink} ${Math.round(
                (level / 99) * 45
              )}%, var(--tile))`,
              boxShadow: `inset 0 0 0 ${carrier ? 1.5 : 1}px ${carrier ? look.ink : look.ring}`,
              color: level > 60 ? 'var(--ink-0)' : 'var(--ink-200)',
            }}
          >
            {op + 1}
          </span>
        )
        const place = {
          left: `${((x(op) - 0.5) / WIDTH) * 100}%`,
          top: `${((y(op) - 0.5) / HEIGHT) * 100}%`,
          width: `${100 / WIDTH}%`,
          height: `${100 / HEIGHT}%`,
        }
        const name = `OP ${op + 1}, ${opRole(spec, op)}, level ${Math.round(level)}`
        return onPick ? (
          <button
            key={op}
            type="button"
            aria-label={name}
            title={`OP ${op + 1}`}
            onClick={() => onPick(op)}
            style={place}
            className="absolute rounded-[4px] active:bg-(--lift)"
          >
            {box}
          </button>
        ) : (
          <span
            key={op}
            role="img"
            aria-label={name}
            style={place}
            className="absolute"
          >
            {box}
          </span>
        )
      })}
    </div>
  )
}
