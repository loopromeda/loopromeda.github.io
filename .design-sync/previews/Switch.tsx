import { useState, type ReactNode } from 'react'
import { CARD, Switch } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** On: the knob at the right, in the accent, the track a share of it */
export function On() {
  const [on, setOn] = useState(true)
  return (
    <Stage>
      <Switch checked={on} onChange={setOn} label="Keep screen on" />
    </Stage>
  )
}

/** Off: the knob at the left, dim, on the well */
export function Off() {
  const [on, setOn] = useState(false)
  return (
    <Stage>
      <Switch checked={on} onChange={setOn} label="Waveform timing" />
    </Stage>
  )
}

/** Beside its name, on a card, as a setting's row stands it */
export function OnACard() {
  const [waveform, setWaveform] = useState(true)
  const [details, setDetails] = useState(false)
  return (
    <Stage>
      <div className={`${CARD} flex w-72 flex-col gap-3 p-3`}>
        <div className="flex items-center justify-between gap-3 px-1">
          <span id="waveform" className="text-[13px] text-(--ink-300)">
            Waveform
          </span>
          <Switch
            checked={waveform}
            onChange={setWaveform}
            labelledBy="waveform"
          />
        </div>
        <div className="flex items-center justify-between gap-3 px-1">
          <span id="details" className="text-[13px] text-(--ink-300)">
            Audio details
          </span>
          <Switch
            checked={details}
            onChange={setDetails}
            labelledBy="details"
          />
        </div>
      </div>
    </Stage>
  )
}
