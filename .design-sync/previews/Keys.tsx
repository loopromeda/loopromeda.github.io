import { useState, type ReactNode } from 'react'
import { Hands, Keys, keysFit, noteName, type Player } from '@loopromeda/ds'
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

/** A player that plays nothing: the keys for a picture */
const SILENT: Player = {
  noteOn() {},
  noteOff() {},
  slide() {},
  bend() {},
}

/** The keys in a box of width x height CSS px, as many octaves as fit */
function Keyboard({
  lowest,
  width,
  height,
  wide,
}: {
  lowest: number
  width: number
  height: number
  wide?: boolean
}) {
  const [hands] = useState(() => new Hands(SILENT))
  const { octaves } = keysFit(width)
  const range = `${noteName(lowest)} – ${noteName(lowest + 12 * octaves)}`
  return (
    <Stage wide={wide} min={wide ? undefined : width + 26}>
      <div className="relative" style={{ width, height }}>
        <Keys
          hands={hands}
          lowest={lowest}
          octaves={octaves}
          label={`Keys ${range}. Computer keys A to K play them; Z and X shift them an octave`}
        />
      </div>
    </Stage>
  )
}

/** Two octaves from C3 to C5, as a phone on its side has room for */
export function TwoOctaves() {
  return <Keyboard lowest={48} width={640} height={220} wide />
}

/** One octave from middle C, as a phone held upright fits them */
export function OneOctave() {
  return <Keyboard lowest={60} width={360} height={200} />
}

/** Moved a white key at a time: an octave from A3, C4 named in it */
export function FromA() {
  return <Keyboard lowest={57} width={360} height={200} />
}
