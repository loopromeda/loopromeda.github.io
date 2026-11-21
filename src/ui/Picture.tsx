import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import {
  OUTLINE_HEIGHT,
  OUTLINE_MIDDLE,
  OUTLINE_WIDTH,
  outlineFill,
  outlineKind,
  outlinePath,
} from './outline'

/**
 * A part's picture (outline.ts): a line drawing, its chain's colour on
 * the line and not over an area (theme.ts), the area under it (an EQ's,
 * between it and 0 dB) filled only where fillOpacity asks, stretched to
 * the box className gives it (the stroke keeps its width). It follows the
 * knobs by setting the paths itself, so a knob turning re-renders
 * nothing, and leaves them be while the picture stays the same.
 */
export function Picture({
  engine,
  part,
  color,
  className,
  lineOpacity = 1,
  fillOpacity = 0,
}: {
  engine: Engine
  part: string
  color: string
  className: string
  lineOpacity?: number
  fillOpacity?: number
}) {
  const lineRef = useRef<SVGPathElement>(null)
  const fillRef = useRef<SVGPathElement>(null)
  useLayoutEffect(() => {
    let shown = ''
    const draw = () => {
      const sound = engine.getSound()
      const line = outlinePath(sound, part)
      if (line === shown) return
      shown = line
      const base =
        outlineKind(sound, part) === 'eq' ? OUTLINE_MIDDLE : OUTLINE_HEIGHT
      lineRef.current?.setAttribute('d', line)
      fillRef.current?.setAttribute('d', outlineFill(line, base))
    }
    draw()
    return engine.subscribeSound(draw)
  }, [engine, part])
  return (
    <svg
      viewBox={`0 0 ${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
      className={className}
    >
      <path ref={fillRef} fill={color} fillOpacity={fillOpacity} />
      <path
        ref={lineRef}
        fill="none"
        stroke={color}
        strokeOpacity={lineOpacity}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
