import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'

export interface SwitchOption {
  id: string
  label: string
  /** A level: while it is above 0 the option shows a lit dot */
  level?: ParamId
}

/**
 * A row of buttons picking which page of a panel shows, one pressed at a
 * time. An option with a level lights a dot while that level is above 0,
 * so a sound source on a hidden page is still seen to sound; the dots
 * follow the engine directly, without re-rendering React.
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
      const level = options[index]?.level
      const dot = dotsRef.current[index]
      if (!level || !dot) return
      dot.dataset.on = engine.getParam(level) > 0 ? 'true' : 'false'
    }
    options.forEach((_, index) => light(index))
    return engine.onParam((id) => {
      options.forEach((option, index) => {
        if (option.level === id) light(index)
      })
    })
  }, [engine, options])

  return (
    <div
      role="group"
      aria-label={label}
      className="flex overflow-hidden rounded-md bg-white/5"
    >
      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={index === shown}
          onClick={() => onShow(index)}
          className="flex h-7 items-center gap-1.5 px-3 text-[11px] font-semibold tracking-wider text-zinc-400 aria-pressed:bg-white/10 aria-pressed:text-white"
        >
          {option.label}
          {option.level && (
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
