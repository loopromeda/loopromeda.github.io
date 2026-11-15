import { useEffect } from 'react'
import type { LaneGroup, LaneKnob } from '../state/lanes'
import { MAX_LANES, type KnobLane } from '../state/song'
import { SECTION_HEADING, SMALL_OPTION } from './controls'
import { SmallIconButton } from './IconButton'

const CROSS = 'M5 5l8 8M13 5l-8 8'

/** A knob's button in the list: its label, or that it has a lane */
const KNOB = `${SMALL_OPTION} disabled:opacity-40`

/**
 * The knob lanes of the loop picked, in place of its step grid: those it
 * has, one tapped shown under the grid, and the knobs of its track one
 * may be added for (src/state/lanes.ts: its sound's, part by part, and its
 * fader's), each knob one lane at most, eight in all. Escape or the cross
 * closes it.
 */
export function LanePicker({
  groups,
  lanes,
  shown,
  onShow,
  onAdd,
  onClose,
}: {
  groups: readonly LaneGroup[]
  /** The loop's lanes, each by its knob's name (none: a knob gone) */
  lanes: readonly { lane: KnobLane; name: string }[]
  /** The lane shown under the grid */
  shown: KnobLane | undefined
  onShow: (lane: KnobLane) => void
  onAdd: (knob: LaneKnob) => void
  onClose: () => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const full = lanes.length >= MAX_LANES
  const has = (knob: LaneKnob) =>
    lanes.some(({ lane }) => lane.part === knob.part && lane.key === knob.key)

  return (
    <div
      role="dialog"
      aria-label="Knob lanes"
      className="absolute inset-0 z-10 flex flex-col gap-2 bg-(--panel)"
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        <h3 className={`${SECTION_HEADING} min-w-0 flex-1 truncate`}>
          Knob lanes
        </h3>
        <SmallIconButton label="Close" path={CROSS} onClick={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-1">
        {lanes.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h4 className="text-[11px] text-(--ink-400)">In this loop</h4>
            <div className="flex flex-wrap gap-1">
              {lanes.map(({ lane, name }) => (
                <button
                  key={`${lane.part}:${lane.key}`}
                  type="button"
                  aria-pressed={lane === shown}
                  onClick={() => onShow(lane)}
                  className={KNOB}
                >
                  {lane.on ? name : `${name} · off`}
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h4 className="text-[11px] text-(--ink-400)">
            {full ? `A lane for (${MAX_LANES} at most)` : 'A lane for'}
          </h4>
          {groups.map((group) => (
            <div key={group.part} className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-(--ink-300)">
                {group.name}
              </span>
              <div className="flex flex-wrap gap-1">
                {group.knobs.map((knob) => {
                  const taken = has(knob)
                  return (
                    <button
                      key={knob.key}
                      type="button"
                      disabled={full || taken}
                      aria-label={taken ? `${knob.name}, in a lane` : knob.name}
                      onClick={() => onAdd(knob)}
                      className={KNOB}
                    >
                      {knob.spec.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
