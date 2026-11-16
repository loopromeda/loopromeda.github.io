import { useState, type ReactNode } from 'react'
import {
  CARD,
  FadeRow,
  LanePicker,
  SMALL_OPTION,
  type Curve,
  type LaneGroup,
  type LaneKnob,
  type Unit,
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

type Spec = LaneKnob['spec']

/** A knob's spec, as the sound's kinds give it (state/sound/kinds.ts) */
function spec(
  key: string,
  label: string,
  unit: Unit,
  [min, max]: [number, number],
  initial: number,
  curve: Curve = 'linear',
  step = 0
): Spec {
  return { key, label, unit, min, max, default: initial, curve, step }
}
const level = (key: string, label: string, initial: number) =>
  spec(key, label, '%', [0, 1], initial, 'quadratic')
const share = (key: string, label: string, initial = 0) =>
  spec(key, label, '%', [0, 1], initial)
const time = (key: string, label: string, initial: number) =>
  spec(key, label, 's', [0.001, 10], initial, 'exponential')

/** A part's knobs under its name, each named A Filter · Cutoff */
function group(part: string, name: string, specs: readonly Spec[]) {
  return {
    part,
    name,
    knobs: specs.map((each) => ({
      part,
      key: each.key,
      spec: each,
      name: `${name} · ${each.label}`,
    })),
  }
}

/** The fader's two, a kit's only lanes */
const FADER = group('fader', 'Fader', [
  level('level', 'Level', 1),
  spec('pan', 'Balance', 'pan', [-1, 1], 0),
])

/** The Acid Bass preset's knobs that turn, as laneGroups gives them */
const ACID_BASS: readonly LaneGroup[] = [
  group('i1', 'IN 1', [
    spec('octave', 'Octave', 'oct', [-2, 2], 0, 'linear', 1),
    spec('semi', 'Semi', 'st', [-12, 12], 0, 'linear', 1),
    spec('fine', 'Fine', 'ct', [-100, 100], 0),
    spec('width', 'Width', '%', [0.05, 0.95], 0.5),
    spec('fm', 'FM', '%', [0, 1], 0, 'quadratic'),
  ]),
  group('c1', 'Chain A', [
    level('level', 'Level', 1),
    level('send.i1', 'IN 1', 1),
  ]),
  group('x1', 'A Filter', [
    spec('cutoff', 'Cutoff', 'Hz', [20, 20000], 20000, 'exponential'),
    share('resonance', 'Reso'),
    share('keytrack', 'Key'),
  ]),
  group('m1', 'ENV 1', [
    time('attack', 'Attack', 0.005),
    time('decay', 'Decay', 0.3),
    share('sustain', 'Sustain'),
    time('release', 'Release', 0.3),
  ]),
  group('amp', 'Amp', [
    time('attack', 'Attack', 0.005),
    time('decay', 'Decay', 0.3),
    share('sustain', 'Sustain', 0.7),
    time('release', 'Release', 0.3),
    share('velocity', 'Velocity', 0.5),
    spec('pan', 'Pan', 'pan', [-1, 1], 0),
    // Its ghost notes': how loud, how short, how muffled, how scraped
    share('ghostLevel', 'Level', 0.55),
    spec('ghostDecay', 'Decay', 's', [0.02, 0.4], 0.1, 'exponential'),
    spec('ghostTone', 'Tone', 'Hz', [250, 4000], 760, 'exponential'),
    share('ghostClick', 'Click', 0.35),
  ]),
  group('voice', 'Voice', [
    spec('glide', 'Glide', 's', [0, 2], 0, 'quadratic'),
  ]),
  group('sends', 'Sends', [
    level('a', 'A', 1),
    level('b', 'B', 0),
    level('c', 'C', 0),
    level('d', 'D', 0),
  ]),
  FADER,
]

/** A lane of a loop of one bar: a value at each sixteenth */
function lane(part: string, key: string, from: number, to: number) {
  return {
    part,
    key,
    glide: true,
    on: true,
    values: Array.from(
      { length: 16 },
      (_, step) => from + ((to - from) * step) / 15
    ),
  }
}

/** The session's tracks, as the Seq tab's chips name them */
const TRACKS = ['Bass', 'Lead', 'Drums']

/**
 * The Seq card with the picker open over its grid: the tracks' chips
 * above, the picker standing in the grid's place (it fills the box it is
 * given), each knob added becoming a lane
 */
function SeqCard({
  shown,
  groups,
  start,
  height = '22rem',
}: {
  shown: string
  groups: readonly LaneGroup[]
  start: ReturnType<typeof lane>[]
  /** The grid's room, which the picker fills: its list scrolls past it */
  height?: string
}) {
  const [lanes, setLanes] = useState(start)
  return (
    <Stage>
      <div className={`${CARD} flex w-80 flex-col gap-2 py-2.5`}>
        <FadeRow className="shrink-0" row="items-center gap-1 px-2.5">
          {TRACKS.map((track) => (
            <button
              key={track}
              type="button"
              aria-pressed={track === shown}
              className={`${SMALL_OPTION} max-w-32`}
            >
              <span className="truncate">{track}</span>
            </button>
          ))}
        </FadeRow>
        <div className="px-2.5">
          <div className="relative" style={{ height }}>
            <LanePicker
              groups={groups}
              lanes={lanes}
              onAdd={(knob) =>
                setLanes((was) => [
                  ...was,
                  lane(
                    knob.part,
                    knob.key,
                    knob.spec.default,
                    knob.spec.default
                  ),
                ])
              }
              onClose={() => undefined}
            />
          </div>
        </div>
      </div>
    </Stage>
  )
}

/**
 * A synth's loop: its sound's knobs part by part, two already in lanes
 * (greyed), the list scrolling on past the Amp to the Voice, the Sends and
 * the Fader
 */
export function SynthTrack() {
  return (
    <SeqCard
      shown="Bass"
      groups={ACID_BASS}
      start={[
        lane('x1', 'cutoff', 180, 2400),
        lane('fader', 'level', 0.4, 0.9),
      ]}
    />
  )
}

/** A kit's loop: its pads are sounds of their own, so the fader alone */
export function KitTrack() {
  return <SeqCard shown="Drums" groups={[FADER]} start={[]} height="11rem" />
}

/** Eight lanes, the most a loop holds: every knob greyed, the limit said */
export function EightLanes() {
  return (
    <SeqCard
      shown="Bass"
      groups={ACID_BASS}
      start={[
        lane('x1', 'cutoff', 180, 2400),
        lane('x1', 'resonance', 0.3, 0.8),
        lane('m1', 'decay', 0.1, 0.6),
        lane('amp', 'release', 0.05, 0.4),
        lane('voice', 'glide', 0, 0.12),
        lane('sends', 'a', 0.2, 0.7),
        lane('sends', 'b', 0, 0.5),
        lane('fader', 'level', 0.4, 0.9),
      ]}
    />
  )
}
