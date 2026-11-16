import { useState, type ReactNode } from 'react'
import { Hands, KitPads, kitGrid, type Player } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** A player that plays nothing: the pads for a picture */
const SILENT: Player = {
  noteOn() {},
  noteOff() {},
  slide() {},
  bend() {},
}

/** The factory kit's pads, from the bottom left (state/factory.ts) */
const FACTORY_KIT = [
  'Kick',
  'Snare',
  'Closed Hat',
  'Open Hat',
  'Low Tom',
  'Tom',
  'High Tom',
  'Clap',
  'Rim',
  'Cowbell',
  'Shaker',
  'Crash',
  'Boom',
  'Conga',
  'Clave',
  'Zap',
]

const LABEL =
  "The kit's pads: a tap plays a pad and picks it, its sound in the editor. Computer keys A to ; and Q to Y play them"

/** The kit's sixteen pads in a box of width x height CSS px */
function Kit({
  first,
  marks,
  width,
  height,
}: {
  first: number
  marks?: readonly string[]
  width: number
  height: number
}) {
  const [hands] = useState(() => new Hands(SILENT))
  const [picked, setPicked] = useState(first)
  return (
    <Stage>
      <div className="relative" style={{ width, height }}>
        <KitPads
          hands={hands}
          grid={kitGrid(width, height, FACTORY_KIT.length)}
          names={FACTORY_KIT}
          marks={marks}
          picked={picked}
          onPick={setPicked}
          label={LABEL}
        />
      </div>
    </Stage>
  )
}

/** The factory kit on eight by two, a wide surface's, the Kick picked */
export function FactoryKit() {
  return <Kit first={0} width={560} height={170} />
}

/**
 * Four by four on a taller surface, the Snare picked; the toms and the
 * Boom tuned off the pads' C4, their notes small at the top right
 */
export function Tuned() {
  const marks = FACTORY_KIT.map((name) =>
    name === 'Low Tom'
      ? 'G3'
      : name === 'High Tom'
        ? 'F4'
        : name === 'Boom'
          ? 'C2'
          : ''
  )
  return <Kit first={1} marks={marks} width={360} height={240} />
}
