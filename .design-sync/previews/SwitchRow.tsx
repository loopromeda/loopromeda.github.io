import { useState, type ReactNode } from 'react'
import { CARD, SwitchRow } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css). A Card's cell needs 346 px: its card's columns
 * are never narrower (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** A card as wide as a phone held upright gives the settings */
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CARD} flex w-80 flex-col gap-1.5 p-2.5`}
      data-ds-min={320 + 26}
    >
      {children}
    </div>
  )
}

/** On, with what it does under it: the switch lit in the accent */
export function OnWithHint() {
  const [awake, setAwake] = useState(true)
  return (
    <Stage>
      <Card>
        <SwitchRow
          label="Keep screen on"
          hint="While the audio runs and this page is in front."
          value={awake}
          onChange={setAwake}
        />
      </Card>
    </Stage>
  )
}

/** Off, and nothing under it: the Debug group's plain toggles */
export function OffNoHint() {
  const [details, setDetails] = useState(false)
  const [timing, setTiming] = useState(false)
  return (
    <Stage>
      <Card>
        <SwitchRow
          label="Audio details"
          value={details}
          onChange={setDetails}
        />
        <SwitchRow
          label="Waveform timing"
          value={timing}
          onChange={setTiming}
        />
      </Card>
    </Stage>
  )
}

/** A browser without the feature: off, the hint saying what happens */
export function Unsupported() {
  const [awake, setAwake] = useState(false)
  return (
    <Stage>
      <Card>
        <SwitchRow
          label="Keep screen on"
          hint="This browser cannot keep the screen on: it dims as usual."
          value={awake}
          onChange={setAwake}
        />
      </Card>
    </Stage>
  )
}

/** The transport's popover: the click and the count-in, each with a hint */
export function Transport() {
  const [click, setClick] = useState(true)
  const [countIn, setCountIn] = useState(false)
  return (
    <Stage>
      <Card>
        <SwitchRow
          label="Click"
          hint="Each beat, the bar's first higher."
          value={click}
          onChange={setClick}
        />
        <SwitchRow
          label="Count-in"
          hint="A bar of beats before the first step."
          value={countIn}
          onChange={setCountIn}
        />
      </Card>
    </Stage>
  )
}

/** The transport's Loops: each track's loop on or off, by its name */
export function Loops() {
  const [on, setOn] = useState([true, true, false, true])
  const names = ['Synth 1', 'Kit 2', 'Warm Pad', 'Bass']
  return (
    <Stage>
      <Card>
        {names.map((name, k) => (
          <SwitchRow
            key={name}
            label={name}
            value={on[k] ?? false}
            onChange={(value) =>
              setOn((was) => was.map((each, i) => (i === k ? value : each)))
            }
          />
        ))}
      </Card>
    </Stage>
  )
}

/** A name too long to stand beside its switch: the switch goes under it */
export function LongName() {
  const [on, setOn] = useState(true)
  return (
    <Stage>
      <div className={`${CARD} flex w-52 flex-col gap-1.5 p-2.5`}>
        <SwitchRow
          label="Warm pad under the slow chorus"
          value={on}
          onChange={setOn}
        />
      </div>
    </Stage>
  )
}
