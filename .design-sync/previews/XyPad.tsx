import { useState, type ReactNode } from 'react'
import { Hands, XyPad, noteName, type Player } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** A player that plays nothing: the pad for a picture */
const SILENT: Player = {
  noteOn() {},
  noteOff() {},
  slide() {},
  bend() {},
}

/** Nothing glides where nothing plays */
const NO_GLIDES = () => () => {}

/** The XY pad from lowest, octaves across, in a box of width x height */
function Surface({
  lowest,
  octaves,
  width,
  height,
}: {
  lowest: number
  octaves: number
  width: number
  height: number
}) {
  const [hands] = useState(() => new Hands(SILENT))
  const range = `${noteName(lowest)} – ${noteName(lowest + 12 * octaves)}`
  return (
    <Stage>
      <div className="relative" style={{ width, height }}>
        <XyPad
          hands={hands}
          watchGlides={NO_GLIDES}
          lowest={lowest}
          octaves={octaves}
          label={`XY pad ${range}: across, a note's pitch with no steps; up, its Slide. Computer keys A to K play notes; Z and X shift it an octave`}
        />
      </div>
    </Stage>
  )
}

/** Two octaves from C3: a line at each semitone, the Cs named */
export function TwoOctaves() {
  return <Surface lowest={48} octaves={2} width={600} height={240} />
}

/** One octave from C3, as a phone held upright fits it */
export function OneOctave() {
  return <Surface lowest={48} octaves={1} width={360} height={220} />
}
