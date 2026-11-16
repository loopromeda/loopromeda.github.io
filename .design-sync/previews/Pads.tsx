import { useState, type ReactNode } from 'react'
import {
  Hands,
  Pads,
  noteName,
  padGrid,
  padNote,
  pitchName,
  scaleName,
  scaleSteps,
  type Player,
  type ScaleId,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css). A wide one takes its card's whole row; `min`
 * is the width its cell needs, for a story of a fixed width, so that its
 * card's columns are never narrower (card.module.css lists each).
 */
function Stage({
  wide,
  min,
  children,
}: {
  wide?: boolean
  min?: number
  children: ReactNode
}) {
  return (
    <div
      className="w-fit max-w-full"
      data-ds-wide={wide ? '' : undefined}
      data-ds-min={min}
    >
      {children}
    </div>
  )
}

/** A player that plays nothing: the pads for a picture */
const SILENT: Player = {
  noteOn() {},
  noteOff() {},
  slide() {},
  bend() {},
}

/**
 * The pads in a box of width x height CSS px, as many as fit, playing
 * scale up from root in octave 3, as the app starts them
 */
function Grid({
  root,
  scale,
  width,
  height,
  wide,
}: {
  root: number
  scale: ScaleId
  width: number
  height: number
  wide?: boolean
}) {
  const [hands] = useState(() => new Hands(SILENT))
  const grid = padGrid(width, height)
  const lowest = 48 + root
  const steps = scaleSteps(scale)
  const notes = Array.from({ length: grid.columns * grid.rows }, (_, index) =>
    padNote(index, lowest, steps)
  )
  const range = `${noteName(lowest)} – ${noteName(notes[notes.length - 1] ?? lowest)}`
  return (
    <Stage wide={wide} min={wide ? undefined : width + 26}>
      <div className="relative" style={{ width, height }}>
        <Pads
          hands={hands}
          grid={grid}
          notes={notes}
          root={root}
          label={`Pads ${range} in ${pitchName(root)} ${scaleName(scale)}. Computer keys A to ; and Q to P play them; Z and X shift the octave`}
        />
      </div>
    </Stage>
  )
}

/** C minor on four by four, each C the key's home in the accent */
export function CMinor() {
  return <Grid root={0} scale="minor" width={300} height={290} />
}

/** A minor pentatonic on eight by two, a wide surface's: three octaves */
export function MinorPentatonic() {
  return (
    <Grid root={9} scale="minor-pentatonic" width={560} height={150} wide />
  )
}

/** D major on five by three, as a phone held upright fits them */
export function DMajor() {
  return <Grid root={2} scale="major" width={360} height={200} />
}
