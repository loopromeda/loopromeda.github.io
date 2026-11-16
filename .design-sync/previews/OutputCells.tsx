import { useState, type ReactNode } from 'react'
import {
  CARD,
  KNOB_COLUMN,
  KNOB_LABEL,
  KNOB_READOUT,
  KNOB_SIZE,
  MUTE_FACE,
  OutputCells,
  SOLO_FACE,
  ValueKnob,
  knobRow,
  neutralArc,
  themeOf,
  type MasterViewKind,
  type ValueSpec,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css). Each is a 20 rem card, its cell 346 px: its
 * card's columns are never narrower (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="w-fit max-w-full" data-ds-min={320 + 26}>
      {children}
    </div>
  )
}

/** The Default theme's chain inks in the dark: bus A's, bus B's */
const { chains } = themeOf('default').dark

/** A fader's level, or a send's: 0..1, quadratic (state/sound/kinds.ts) */
const LEVEL: ValueSpec = {
  min: 0,
  max: 1,
  default: 1,
  curve: 'quadratic',
  step: 0,
  unit: '%',
}
/** A strip's balance, -1..1, the middle at 0 */
const BALANCE: ValueSpec = {
  min: -1,
  max: 1,
  default: 0,
  curve: 'linear',
  step: 0,
  unit: 'pan',
}

/** Half a cell's height, by its word: Mute over Solo (Mutes.tsx) */
const TOGGLE =
  'flex min-h-0 flex-1 items-center justify-center rounded-md text-[11px] font-semibold tracking-wider'

/**
 * The track's Mute and Solo, a knob's size, one over the other, as the
 * app's MutesCell stands them in the mutes slot; under them Track and
 * what it is (Silent: heard by neither, while another is soloed)
 */
function Heard({
  name,
  start,
  silent = false,
}: {
  name: string
  start: { mute: boolean; solo: boolean }
  silent?: boolean
}) {
  const [{ mute, solo }, set] = useState(start)
  const state = mute ? 'Muted' : solo ? 'Soloed' : silent ? 'Silent' : 'On'
  return (
    <div className={`${KNOB_COLUMN} self-start`}>
      <div
        role="group"
        aria-label="Heard"
        className={`${KNOB_SIZE} flex aspect-square flex-col gap-1`}
      >
        <button
          type="button"
          aria-pressed={mute}
          aria-label={`Mute ${name}`}
          onClick={() => set({ mute: !mute, solo })}
          className={`${TOGGLE} ${MUTE_FACE}`}
        >
          Mute
        </button>
        <button
          type="button"
          aria-pressed={solo}
          aria-label={`Solo ${name}`}
          onClick={() => set({ mute, solo: !solo })}
          className={`${TOGGLE} ${SOLO_FACE}`}
        >
          Solo
        </button>
      </div>
      <span className={KNOB_LABEL}>Track</span>
      <span className={KNOB_READOUT}>{state}</span>
    </div>
  )
}

/**
 * A track's strip, as its panel stands it: the header, then one knob row
 * of the fader's level and balance, a send to each bus in its colour,
 * the track's Mute and Solo, and the views its tiles show
 */
function Strip({
  name,
  level,
  balance,
  sends,
  heard,
  start,
}: {
  name: string
  level: number
  balance: number
  sends: readonly [number, number]
  heard: ReactNode
  start: MasterViewKind
}) {
  const [shown, setShown] = useState<MasterViewKind>(start)
  return (
    <Stage>
      <div className={`${CARD} flex w-80 flex-col gap-2 p-2.5`}>
        <div className="flex h-7 items-center gap-2 px-1">
          <h3 className="shrink-0 text-sm font-semibold text-(--ink-100)">
            {name}
          </h3>
          <span className="min-w-0 truncate text-[11px] text-(--ink-400)">
            Its level and balance, then a send to each bus
          </span>
        </div>
        <div className={knobRow(6)}>
          <ValueKnob
            label="Level"
            spec={LEVEL}
            value={level}
            color={neutralArc()}
          />
          <ValueKnob
            label="Balance"
            spec={BALANCE}
            value={balance}
            color={neutralArc()}
          />
          <ValueKnob
            label="A Reverb"
            spec={LEVEL}
            value={sends[0]}
            color={chains[0]}
          />
          <ValueKnob
            label="B Delay"
            spec={LEVEL}
            value={sends[1]}
            color={chains[1]}
          />
          <OutputCells mutes={heard} shown={shown} choose={setShown} />
        </div>
      </div>
    </Stage>
  )
}

/** A bass's strip, heard: Mute and Solo off, its tiles showing the scope */
export function TrackStrip() {
  return (
    <Strip
      name="Bass"
      level={0.8}
      balance={0}
      sends={[0.25, 0]}
      heard={<Heard name="Bass" start={{ mute: false, solo: false }} />}
      start="scope"
    />
  )
}

/** A lead muted, amber, its tiles showing the spectrum */
export function Muted() {
  return (
    <Strip
      name="Lead"
      level={0.7}
      balance={-0.2}
      sends={[0.4, 0.3]}
      heard={<Heard name="Lead" start={{ mute: true, solo: false }} />}
      start="spectrum"
    />
  )
}

/** Drums soloed, emerald, the spectrogram shown, its readout cut short */
export function Soloed() {
  return (
    <Strip
      name="Drums"
      level={0.9}
      balance={0}
      sends={[0.15, 0]}
      heard={<Heard name="Drums" start={{ mute: false, solo: true }} />}
      start="spectrogram"
    />
  )
}

/** A pad silent while another is soloed: neither lit, Silent under them */
export function SilentForASolo() {
  return (
    <Strip
      name="Pad"
      level={0.6}
      balance={0.3}
      sends={[0.6, 0.45]}
      heard={<Heard name="Pad" start={{ mute: false, solo: false }} silent />}
      start="stereo"
    />
  )
}

/** The master's panel: its level, then the views alone, no track's cell */
export function Master() {
  const [shown, setShown] = useState<MasterViewKind>('spectrum')
  return (
    <Stage>
      <div className={`${CARD} flex w-80 flex-col gap-2 p-2.5`}>
        <div className="flex h-7 items-center gap-2 px-1">
          <h3 className="shrink-0 text-sm font-semibold text-(--ink-100)">
            Master
          </h3>
          <span className="min-w-0 truncate text-[11px] text-(--ink-400)">
            The mix’s level, then what its tile shows
          </span>
        </div>
        <div className={knobRow(2)}>
          <ValueKnob
            label="Level"
            spec={LEVEL}
            value={0.85}
            color={neutralArc()}
          />
          <OutputCells shown={shown} choose={setShown} />
        </div>
      </div>
    </Stage>
  )
}
