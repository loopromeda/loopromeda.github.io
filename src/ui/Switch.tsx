import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'
import { SMALL_GROUP, SMALL_OPTION } from './controls'

export interface SwitchOption {
  id: string
  label: string
  /** Levels or amounts: while any is not 0 the option shows a lit dot */
  lit?: readonly ParamId[]
}

/**
 * A row of buttons picking which page of a panel shows, one pressed at a
 * time. An option with levels lights a dot while any of them is not 0, so
 * a sound source on a hidden page is still seen to sound; the dots follow
 * the engine directly, without re-rendering React.
 */
export function Switch({
  engine,
  label,
  options,
  shown,
  onShow,
}: {
  engine: Engine
  label: string
  options: readonly SwitchOption[]
  shown: number
  onShow: (index: number) => void
}) {
  const dotsRef = useRef<(HTMLSpanElement | null)[]>([])

  useLayoutEffect(() => {
    const light = (index: number) => {
      const lit = options[index]?.lit
      const dot = dotsRef.current[index]
      if (!lit || !dot) return
      const on = lit.some((id) => engine.getParam(id) !== 0)
      dot.dataset.on = on ? 'true' : 'false'
    }
    options.forEach((_, index) => light(index))
    return engine.onParam((id) => {
      options.forEach((option, index) => {
        if (option.lit?.includes(id)) light(index)
      })
    })
  }, [engine, options])

  return (
    <div role="group" aria-label={label} className={SMALL_GROUP}>
      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={index === shown}
          onClick={() => onShow(index)}
          className={SMALL_OPTION}
        >
          {option.label}
          {option.lit && (
            <span
              ref={(dot) => {
                dotsRef.current[index] = dot
              }}
              aria-hidden="true"
              className="size-1.5 rounded-full bg-white/15 data-[on=true]:bg-emerald-400"
            />
          )}
        </button>
      ))}
    </div>
  )
}
