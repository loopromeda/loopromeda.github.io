import { useEffect } from 'react'
import type { LaneGroup, LaneKnob } from '../state/lanes'
import { MAX_LANES, type KnobLane } from '../state/song'
import { SECTION_HEADING, SMALL_OPTION } from './controls'
import { SmallIconButton } from './IconButton'

const CROSS = 'M5 5l8 8M13 5l-8 8'

/** A knob's button in the list: its label, or that it has a lane */
const KNOB = `${SMALL_OPTION} disabled:opacity-40`

/**
 * The knobs a lane may be added for, in the step grid's place: those of
 * the loop's track (src/state/lanes.ts: its sound's, part by part, and
 * its fader's), each knob one lane at most, eight in all, one with a lane
 * already greyed. Escape or the cross closes it.
 */
export function LanePicker({
  groups,
  lanes,
  onAdd,
  onClose,
}: {
  groups: readonly LaneGroup[]
  /** The loop's lanes */
  lanes: readonly KnobLane[]
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
    lanes.some((lane) => lane.part === knob.part && lane.key === knob.key)

  return (
    <div
      role="dialog"
      aria-label="Add a knob lane"
      className="absolute inset-0 z-10 flex flex-col gap-2 bg-(--panel)"
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        <h3 className={`${SECTION_HEADING} min-w-0 flex-1 truncate`}>
          Add a knob lane
        </h3>
        <SmallIconButton label="Close" path={CROSS} onClick={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-1">
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
