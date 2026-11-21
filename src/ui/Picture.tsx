import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import {
  OUTLINE_HEIGHT,
  OUTLINE_MIDDLE,
  OUTLINE_WIDTH,
  outlineFill,
  outlineKind,
  outlineLit,
  outlinePath,
} from './outline'
import { subscribeTurning, turning } from './turning'

/**
 * A part's picture (outline.ts): a line drawing, its chain's colour on
 * the line and not over an area (theme.ts), the area under it (an EQ's,
 * between it and 0 dB) filled only where fillOpacity asks, stretched to
 * the box className gives it (the stroke keeps its width). It follows the
 * knobs by setting the paths itself, so a knob turning re-renders
 * nothing, and leaves them be while the picture stays the same.
 *
 * While one of its part's knobs is turned (turning.ts), the piece of it
 * the knob moves is drawn bright and heavier over the rest, which dims
 * (outlineLit: an envelope's stage, a filter's corner); the turn ended,
 * both fade back.
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
  const svgRef = useRef<SVGSVGElement>(null)
  const lineRef = useRef<SVGPathElement>(null)
  const fillRef = useRef<SVGPathElement>(null)
  const litRef = useRef<SVGPathElement>(null)
  useLayoutEffect(() => {
    let shown = ''
    let litShown = ''
    const draw = () => {
      const sound = engine.getSound()
      const line = outlinePath(sound, part)
      if (line !== shown) {
        shown = line
        const base =
          outlineKind(sound, part) === 'eq' ? OUTLINE_MIDDLE : OUTLINE_HEIGHT
        lineRef.current?.setAttribute('d', line)
        fillRef.current?.setAttribute('d', outlineFill(line, base))
      }
      const now = turning()
      const lit = now?.part === part ? outlineLit(sound, part, now.knob) : ''
      // The piece last lit stays drawn as it fades out
      if (lit !== '' && lit !== litShown) {
        litShown = lit
        litRef.current?.setAttribute('d', lit)
      }
      svgRef.current?.toggleAttribute('data-lit', lit !== '')
    }
    draw()
    const stopSound = engine.subscribeSound(draw)
    const stopTurning = subscribeTurning(draw)
    return () => {
      stopSound()
      stopTurning()
    }
  }, [engine, part])
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
      className={`group ${className}`}
    >
      <path
        ref={fillRef}
        fill={color}
        fillOpacity={fillOpacity}
        className={FADING}
      />
      <path
        ref={lineRef}
        fill="none"
        stroke={color}
        strokeOpacity={lineOpacity}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={FADING}
      />
      <path
        ref={litRef}
        fill="none"
        stroke={color}
        strokeWidth={2.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={LIT}
      />
    </svg>
  )
}

/**
 * The picture's line and area, dimmed while a piece of it is lit: quickly
 * as the turn starts, slowly back as it ends
 */
const FADING =
  'transition-opacity duration-500 group-data-lit:opacity-35 group-data-lit:duration-100'

/** The piece lit: shown while the turn lasts, faded out after */
const LIT =
  'opacity-0 transition-opacity duration-500 group-data-lit:opacity-100 group-data-lit:duration-75'
