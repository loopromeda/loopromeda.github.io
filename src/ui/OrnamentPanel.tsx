import { useEffect, useState, type ReactNode } from 'react'
import {
  CHORD_NAMES,
  MAX_GRACES,
  ORNAMENT_DEFAULTS,
  ORNAMENT_KINDS,
  SPEEDS,
  playsOn,
  type ArpOrder,
  type Chord,
  type GracePlace,
  type Ornament,
  type OrnamentKind,
  type RollShape,
  type Speed,
} from '../dsp/ornament'
import { soundMs, stepInterval } from '../viz/ornament'
import { GHOST_ICON, SMALL_OPTION } from './controls'
import { FadeRow } from './FadeRow'
import { SmallIconButton } from './IconButton'

const CROSS = 'M5 5l8 8M13 5l-8 8'

/** An option of a group, as narrow as its label lets it be */
const OPTION = `${SMALL_OPTION} px-2`

/** A group's name, before its options */
const NAME = 'shrink-0 text-[11px] text-(--ink-500)'

/** A readout between a stepper's buttons: as wide as its widest */
const READOUT =
  'min-w-[5.5rem] shrink-0 text-center font-mono text-[11px] text-(--ink-200)'

/** Each kind's name, a kit's grace a flam */
function kindName(kind: OrnamentKind, pitched: boolean): string {
  switch (kind) {
    case 'grace':
      return pitched ? 'Grace' : 'Flam'
    case 'mordent':
      return 'Mordent'
    case 'trill':
      return 'Trill'
    case 'roll':
      return 'Roll'
    case 'arp':
      return 'Arp'
  }
}

/** A grace's count by its name: a flam, a drag, a ruff */
const COUNTS = Array.from({ length: MAX_GRACES }, (_, k) => k + 1)

const PLACES: readonly [GracePlace, string][] = [
  ['before', 'Before'],
  ['on', 'On the beat'],
]
const SHAPES: readonly [RollShape, string][] = [
  ['flat', 'Flat'],
  ['rise', 'Rise'],
  ['fall', 'Fall'],
]
const ORDERS: readonly [ArpOrder, string][] = [
  ['up', 'Up'],
  ['down', 'Down'],
  ['updown', 'Up-down'],
]
const EACH: readonly [boolean, string][] = [
  [false, 'Pitch moves'],
  [true, 'Restarts'],
]

/**
 * The ornament of the note picked on the step grid (StepGrid.tsx), under
 * the grid in its lanes' place: its kind (none, a grace or a kit's flam,
 * a mordent, a trill, a roll, an arpeggio; a kit's pad takes only a flam
 * and a roll) and what it plays (src/dsp/ornament.ts), each row panned
 * sideways where it is longer than the grid is wide. A kind left keeps
 * what it was set to, for as long as the panel is open. With no note
 * picked it asks for one. As tall whatever it shows, so the grid's rows
 * stay under a finger. Beside the kinds, Ghost makes the note a ghost
 * note or a note again. Escape or the cross closes it.
 */
export function OrnamentPanel({
  note,
  pitched,
  tempo,
  keyName,
  onChange,
  onGhost,
  onClose,
}: {
  /** The note picked: its key, its ornament and whether a ghost, or none */
  note:
    | {
        readonly key: number
        readonly ornament?: Ornament
        readonly ghost?: boolean
      }
    | undefined
  /** A synth's note (its pitch moves), or a kit's pad */
  pitched: boolean
  /** The song's, for how long a sound lasts */
  tempo: number
  /** A key's name: a synth's note, a kit's pad */
  keyName: (key: number) => string
  onChange: (ornament: Ornament | undefined) => void
  /** The note made a ghost, or a note again */
  onGhost: (ghost: boolean) => void
  onClose: () => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  // What each kind was last set to, so a kind left and come back to
  // keeps it
  const [kept, setKept] = useState<Partial<Record<OrnamentKind, Ornament>>>({})
  const ornament = note?.ornament
  const change = (next: Ornament | undefined) => {
    if (next) setKept((was) => ({ ...was, [next.kind]: next }))
    onChange(next)
  }
  const choose = (kind: OrnamentKind | undefined) => {
    if (kind === ornament?.kind) return
    change(kind ? (kept[kind] ?? ORNAMENT_DEFAULTS[kind]) : undefined)
  }
  const kinds = ORNAMENT_KINDS.filter((kind) => playsOn(kind, pitched))

  return (
    <div
      role="group"
      aria-label={note ? `Ornament of ${keyName(note.key)}` : 'Ornaments'}
      className="flex shrink-0 flex-col gap-2"
    >
      <div className="flex h-7 items-center gap-1.5">
        <span className="w-9 shrink-0 truncate font-mono text-[11px] text-(--ink-300)">
          {note ? keyName(note.key) : ''}
        </span>
        <FadeRow className="min-w-0 flex-1" row="flex gap-1">
          <Option
            pressed={!!note && !ornament}
            disabled={!note}
            onClick={() => choose(undefined)}
            label="None"
          />
          {kinds.map((kind) => (
            <Option
              key={kind}
              pressed={ornament?.kind === kind}
              disabled={!note}
              onClick={() => choose(kind)}
              label={kindName(kind, pitched)}
            />
          ))}
        </FadeRow>
        <SmallIconButton
          label="Ghost note"
          path={GHOST_ICON}
          pressed={!!note?.ghost}
          disabled={!note}
          onClick={() => onGhost(!note?.ghost)}
        />
        <SmallIconButton
          label="Close the ornaments"
          path={CROSS}
          onClick={onClose}
        />
      </div>
      {/* As tall with none as with one: the grid's rows stay put */}
      {note && ornament ? (
        <FadeRow className="h-7" row="flex h-7 items-center gap-1">
          <Settings
            ornament={ornament}
            pitched={pitched}
            tempo={tempo}
            noteName={(off) => keyName(note.key + off)}
            onChange={change}
          />
        </FadeRow>
      ) : (
        <p className="flex h-7 items-center truncate text-[11px] text-(--ink-400)">
          {note ? 'The note alone' : 'Tap a note to ornament it'}
        </p>
      )}
    </div>
  )
}

/** What the ornament plays, by its kind: a group of options for each */
function Settings({
  ornament,
  pitched,
  tempo,
  noteName,
  onChange,
}: {
  ornament: Ornament
  pitched: boolean
  tempo: number
  /** The note's name, off semitones from the note picked */
  noteName: (off: number) => string
  onChange: (ornament: Ornament) => void
}) {
  const speed = (
    <Group name={`Speed · ${soundMs(tempo, ornament.speed)} ms`}>
      {SPEEDS.map((each: Speed) => (
        <Option
          key={each}
          pressed={ornament.speed === each}
          onClick={() => onChange({ ...ornament, speed: each })}
          label={`×${each}`}
          name={`${each} a step`}
        />
      ))}
    </Group>
  )
  switch (ornament.kind) {
    case 'grace':
      return (
        <>
          {pitched && (
            <Interval
              interval={ornament.interval}
              noteName={noteName}
              onChange={(interval) => onChange({ ...ornament, interval })}
            />
          )}
          <Group name="Notes">
            {COUNTS.map((count) => (
              <Option
                key={count}
                pressed={ornament.count === count}
                onClick={() => onChange({ ...ornament, count })}
                label={String(count)}
              />
            ))}
          </Group>
          {speed}
          <Choice
            name="Where"
            options={PLACES}
            value={ornament.place}
            onChange={(place) => onChange({ ...ornament, place })}
          />
        </>
      )
    case 'mordent':
    case 'trill':
      return (
        <>
          <Interval
            interval={ornament.interval}
            noteName={noteName}
            onChange={(interval) => onChange({ ...ornament, interval })}
          />
          {speed}
          <Choice
            name="Each"
            options={EACH}
            value={ornament.restart}
            onChange={(restart) => onChange({ ...ornament, restart })}
          />
        </>
      )
    case 'roll':
      return (
        <>
          {speed}
          <Choice
            name="Level"
            options={SHAPES}
            value={ornament.shape}
            onChange={(shape) => onChange({ ...ornament, shape })}
          />
        </>
      )
    case 'arp':
      return (
        <>
          <Choice
            name="Chord"
            options={Object.entries(CHORD_NAMES) as [Chord, string][]}
            value={ornament.chord}
            onChange={(chord) => onChange({ ...ornament, chord })}
          />
          <Choice
            name="Order"
            options={ORDERS}
            value={ornament.order}
            onChange={(order) => onChange({ ...ornament, order })}
          />
          {speed}
          <Choice
            name="Each"
            options={EACH}
            value={ornament.restart}
            onChange={(restart) => onChange({ ...ornament, restart })}
          />
        </>
      )
  }
}

/** Semitones to the neighbour, or to the grace nearest: a stepper */
function Interval({
  interval,
  noteName,
  onChange,
}: {
  interval: number
  noteName: (off: number) => string
  onChange: (interval: number) => void
}) {
  const sign = interval > 0 ? '+' : '−'
  return (
    <Group name="Interval">
      <SmallIconButton
        label="A semitone lower"
        path="M4.5 9h9"
        onClick={() => onChange(stepInterval(interval, -1))}
      />
      <span aria-live="polite" className={READOUT}>
        {`${sign}${Math.abs(interval)} st · ${noteName(interval)}`}
      </span>
      <SmallIconButton
        label="A semitone higher"
        path="M4.5 9h9M9 4.5v9"
        onClick={() => onChange(stepInterval(interval, 1))}
      />
    </Group>
  )
}

/** A group of options, one chosen */
function Choice<T extends string | boolean>({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <Group name={name}>
      {options.map(([each, label]) => (
        <Option
          key={String(each)}
          pressed={value === each}
          onClick={() => onChange(each)}
          label={label}
        />
      ))}
    </Group>
  )
}

/** A name, then what stands under it; the groups a little apart */
function Group({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={name}
      className="flex items-center gap-1 pr-2"
    >
      <span className={NAME}>{name}</span>
      {children}
    </div>
  )
}

function Option({
  pressed,
  disabled,
  onClick,
  label,
  name,
}: {
  pressed: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  /** For a screen reader, where the label is a sign */
  name?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      aria-label={name}
      onClick={onClick}
      className={OPTION}
    >
      {label}
    </button>
  )
}
