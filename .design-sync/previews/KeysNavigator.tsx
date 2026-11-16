import { useState, type ReactNode } from 'react'
import { BarIconButton, KeysNavigator } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** White keys C−1 to G9 hold: the navigator's whole reach */
const REACH = 75

/** A white key's name, counted up from C−1: 35 is C4 */
function whiteName(white: number): string {
  const octave = Math.floor(white / 7) - 1
  const name = 'CDEFGAB'[white % 7] ?? 'C'
  return `${name}${octave < 0 ? `−${-octave}` : octave}`
}

/** What the keys on screen read out: F2 – F5 */
const rangeOf = (position: number, whites: number) =>
  `${whiteName(position)} – ${whiteName(position + whites - 1)}`

/** A navigator alone, as wide as the header gives it, at its 28 px */
function Alone({ start, whites }: { start: number; whites: number }) {
  const [position, setPosition] = useState(start)
  return (
    <Stage>
      <div style={{ width: '20rem' }}>
        <KeysNavigator
          position={position}
          whites={whites}
          range={rangeOf(position, whites)}
          onMove={setPosition}
          className="h-7 w-full"
        />
      </div>
    </Stage>
  )
}

/**
 * Under a phone's header: Play, then the navigator taking the room left,
 * two octaves from C3 framed
 */
export function UnderTheHeader() {
  const [position, setPosition] = useState(28)
  const [playing, setPlaying] = useState(false)
  const whites = 15
  return (
    <Stage>
      <div className="flex h-9 items-center gap-2" style={{ width: '20rem' }}>
        <BarIconButton
          label={playing ? 'Stop' : 'Play'}
          path={playing ? 'M5 5h8v8H5z' : 'M6 4l8 5-8 5z'}
          pressed={playing}
          onClick={() => setPlaying(!playing)}
        />
        <KeysNavigator
          position={position}
          whites={whites}
          range={rangeOf(position, whites)}
          onMove={setPosition}
          className="h-7 min-w-0 flex-1"
        />
        <BarIconButton
          label="Hide the controls"
          path="M4 7l5 5 5-5"
          onClick={() => undefined}
        />
      </div>
    </Stage>
  )
}

/** Beside the octave buttons and the range they read, as a wide header */
export function WithOctaves() {
  const [position, setPosition] = useState(21)
  const whites = 15
  return (
    <Stage>
      <div className="flex h-9 items-center gap-2" style={{ width: '20rem' }}>
        <KeysNavigator
          position={position}
          whites={whites}
          range={rangeOf(position, whites)}
          onMove={setPosition}
          className="h-7 min-w-16 flex-1"
        />
        <BarIconButton
          label="Octave down"
          disabled={position < 7}
          onClick={() => setPosition(Math.max(position - 7, 0))}
          path="M11 4l-5 5 5 5"
        />
        <span className="font-mono text-[13px] whitespace-nowrap text-(--ink-400)">
          {rangeOf(position, whites)}
        </span>
        <BarIconButton
          label="Octave up"
          disabled={position + whites + 7 > REACH}
          onClick={() => setPosition(position + 7)}
          path="M7 4l5 5-5 5"
        />
      </div>
    </Stage>
  )
}

/** Four octaves on a wide screen, C2 to C6: a wider frame */
export function FourOctaves() {
  return <Alone start={21} whites={29} />
}

/** At the bottom of the reach, C−1: nothing dimmed at the left */
export function AtTheBottom() {
  return <Alone start={0} whites={15} />
}

/** At the top, G9 the last key: nothing dimmed at the right */
export function AtTheTop() {
  return <Alone start={REACH - 15} whites={15} />
}
