import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  CARD,
  SECTION_HEADING,
  ValueKnob,
  knobRow,
  themeOf,
  type ValueSpec,
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

/** A 20 rem card's cell: the card, and the cell's padding and border */
const CARD_CELL = 320 + 26

/** The Default theme's colours in the dark: the four chains' inks, A to D */
const { chains, modulator } = themeOf('default').dark

/** A filter's knobs, as the sound's kinds give them (state/sound/kinds.ts) */
const CUTOFF: ValueSpec = {
  min: 20,
  max: 20000,
  default: 20000,
  curve: 'exponential',
  step: 0,
  unit: 'Hz',
}
const RESO: ValueSpec = {
  min: 0,
  max: 1,
  default: 0,
  curve: 'linear',
  step: 0,
  unit: '%',
}
const TYPE: ValueSpec = {
  min: 0,
  max: 2,
  default: 0,
  curve: 'linear',
  step: 1,
  unit: '',
  choices: ['LP', 'HP', 'BP'],
}
const OCTAVE: ValueSpec = {
  min: -2,
  max: 2,
  default: 0,
  curve: 'linear',
  step: 1,
  unit: 'oct',
}
const ATTACK: ValueSpec = {
  min: 0.001,
  max: 10,
  default: 0.005,
  curve: 'exponential',
  step: 0,
  unit: 's',
}
const SYNC: ValueSpec = {
  min: 0,
  max: 1,
  default: 1,
  curve: 'linear',
  step: 1,
  unit: '',
  choices: ['Off', 'On'],
}

/** A filter's panel: a knobRow of four, in chain A's colour */
export function FilterRow() {
  const [cutoff, setCutoff] = useState(1200)
  return (
    <Stage min={CARD_CELL}>
      <div className={`${CARD} flex w-80 flex-col gap-2 p-2.5`}>
        <h3 className={`px-1 ${SECTION_HEADING}`}>Filter</h3>
        <div className={knobRow(4)}>
          <ValueKnob label="Type" spec={TYPE} value={0} color={chains[0]} />
          <ValueKnob
            label="Cutoff"
            spec={CUTOFF}
            value={cutoff}
            onChange={setCutoff}
            color={chains[0]}
          />
          <ValueKnob label="Reso" spec={RESO} value={0.35} color={chains[0]} />
          <ValueKnob
            label="Octave"
            spec={OCTAVE}
            value={-1}
            color={chains[0]}
          />
        </div>
      </div>
    </Stage>
  )
}

/** Each chain's ink, and neutral where nothing colours it */
export function Colours() {
  return (
    <Stage min={CARD_CELL}>
      <div className={`${CARD} w-80 p-2.5`}>
        <div className={knobRow(5)}>
          {chains.map((color, i) => (
            <ValueKnob
              key={color}
              label={`Level ${'ABCD'[i]}`}
              spec={RESO}
              value={0.25 + i * 0.18}
              color={color}
            />
          ))}
          <ValueKnob label="Master" spec={RESO} value={0.8} />
        </div>
      </div>
    </Stage>
  )
}

/** A modulation depth: two-sided, lit from its zero, in the sky */
export function Depth() {
  const DEPTH: ValueSpec = {
    min: -1,
    max: 1,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: '%',
  }
  return (
    <Stage min={CARD_CELL}>
      <div className={`${CARD} w-80 p-2.5`}>
        <div className={knobRow(3)}>
          <ValueKnob
            label="Cutoff"
            spec={DEPTH}
            value={0.6}
            color={modulator}
          />
          <ValueKnob
            label="Pitch"
            spec={DEPTH}
            value={-0.3}
            color={modulator}
          />
          <ValueKnob label="Pan" spec={DEPTH} value={0} color={modulator} />
        </div>
      </div>
    </Stage>
  )
}

/** A knob of two choices stands upright, a switch in a dial's place */
export function Switches() {
  return (
    <Stage min={CARD_CELL}>
      <div className={`${CARD} w-80 p-2.5`}>
        <div className={knobRow(3)}>
          <ValueKnob
            label="Attack"
            spec={ATTACK}
            value={0.12}
            color={chains[1]}
          />
          <ValueKnob label="Sync" spec={SYNC} value={1} color={chains[1]} />
          <ValueKnob label="Retrig" spec={SYNC} value={0} color={chains[1]} />
        </div>
      </div>
    </Stage>
  )
}

/**
 * Its size is its row's: a sixth of the row's width (less the gaps), or
 * --knob (3rem unless a panel sets it) at most. A narrow card's six fill
 * it; a wide panel's --knob of 4.5rem shows its knobs at that size.
 */
export function Sizes() {
  return (
    <Stage wide>
      <div className="flex flex-col gap-3">
        <div className={`${CARD} w-80 p-2.5`}>
          <div className={knobRow(6)}>
            {[0.1, 0.3, 0.5, 0.7, 0.9, 0.6].map((value, i) => (
              <ValueKnob
                key={i}
                label={`Step ${i + 1}`}
                spec={RESO}
                value={value}
                color={chains[2]}
              />
            ))}
          </div>
        </div>
        <div
          className={`${CARD} p-2.5`}
          style={{ '--knob': '4.5rem', width: '30rem' } as CSSProperties}
        >
          <div className={knobRow(3)}>
            <ValueKnob
              label="Drive"
              spec={RESO}
              value={0.4}
              color={chains[3]}
            />
            <ValueKnob label="Tone" spec={RESO} value={0.7} color={chains[3]} />
            <ValueKnob label="Mix" spec={RESO} value={1} color={chains[3]} />
          </div>
        </div>
      </div>
    </Stage>
  )
}
