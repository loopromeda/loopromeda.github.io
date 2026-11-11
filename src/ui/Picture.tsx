import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import {
  OUTLINE_HEIGHT,
  OUTLINE_WIDTH,
  outlineFill,
  outlinePath,
} from './outline'

/**
 * A part's picture (outline.ts): its line, and the area under it filled
 * faintly, stretched to the box className gives it (the stroke keeps its
 * width). It follows the knobs by setting the paths itself, so a knob
 * turning re-renders nothing, and leaves them be while the picture stays
 * the same.
 */
export function Picture({
  engine,
  part,
  color,
  className,
  lineOpacity = 1,
  fillOpacity = 0.12,
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
      const line = outlinePath(engine.getSound(), part)
      if (line === shown) return
      shown = line
      lineRef.current?.setAttribute('d', line)
      fillRef.current?.setAttribute('d', outlineFill(line))
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
