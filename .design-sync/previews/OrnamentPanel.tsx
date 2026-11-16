import { useState, type ReactNode } from 'react'
import { CARD, OrnamentPanel, noteName, type Ornament } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The factory kit's pads, by name, from the bottom left */
const KIT = [
  'Kick',
  'Snare',
  'Closed Hat',
  'Open Hat',
  'Low Tom',
  'Tom',
  'High Tom',
  'Clap',
]

/**
 * The panel as the step grid holds it, under the grid in the Seq card: the
 * note picked, its ornament and whether it is a ghost, each change kept
 */
function Picked({
  noteKey,
  start,
  ghost = false,
  pitched = true,
}: {
  noteKey: number | undefined
  start?: Ornament
  ghost?: boolean
  pitched?: boolean
}) {
  const [ornament, setOrnament] = useState<Ornament | undefined>(start)
  const [isGhost, setGhost] = useState(ghost)
  return (
    <Stage>
      {/* As wide as the Seq card on a phone held on its side: every kind
          in its row, what the kind plays panning under it */}
      <div className={`${CARD} flex flex-col p-2.5`} style={{ width: '31rem' }}>
        <OrnamentPanel
          note={
            noteKey === undefined
              ? undefined
              : { key: noteKey, ornament, ghost: isGhost }
          }
          pitched={pitched}
          tempo={120}
          keyName={(key) => (pitched ? noteName(key) : (KIT[key] ?? ''))}
          onChange={setOrnament}
          onGhost={setGhost}
          onClose={() => undefined}
        />
      </div>
    </Stage>
  )
}

/** A synth's E4 trilled a whole tone up, four a step, its pitch moving */
export function Trill() {
  return (
    <Picked
      noteKey={64}
      start={{ kind: 'trill', interval: 2, speed: 4, restart: false }}
    />
  )
}

/** Two grace notes from a semitone under A3, six a step, before the beat */
export function Grace() {
  return (
    <Picked
      noteKey={57}
      start={{
        kind: 'grace',
        interval: -1,
        count: 2,
        speed: 6,
        place: 'before',
      }}
    />
  )
}

/** C4 arpeggiated as a minor seventh, up and down, each sound restruck */
export function Arpeggio() {
  return (
    <Picked
      noteKey={60}
      start={{
        kind: 'arp',
        chord: 'min7',
        order: 'updown',
        speed: 4,
        restart: true,
      }}
    />
  )
}

/** A kit's Snare: only a flam and a roll, the flam's notes and speed */
export function KitFlam() {
  return (
    <Picked
      noteKey={1}
      pitched={false}
      start={{
        kind: 'grace',
        interval: -1,
        count: 1,
        speed: 4,
        place: 'before',
      }}
    />
  )
}

/** D3 with no ornament, made a ghost note: Ghost lit, the note alone */
export function GhostNote() {
  return <Picked noteKey={50} ghost />
}

/** Ornaments on, no note tapped yet: the kinds dim, a hint under them */
export function NoNotePicked() {
  return <Picked noteKey={undefined} />
}
