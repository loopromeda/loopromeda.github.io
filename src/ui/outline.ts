/**
 * A part's picture: an envelope's shape (the amp's, an Env's), an LFO's
 * cycles, a filter's response, a drive's curve, a comb's peaks, a
 * formant's humps, an EQ's curve. Their
 * tiles draw it as knobs turn (Picture.tsx): a chain's items, the amp,
 * the modulators in the rack, an EQ among the inserts. Pure: it reads the
 * sound and returns SVG path data.
 */
import { toNormalized } from '../state/params'
import { knobSpec, knobValue } from '../state/sound/knob'
import { AMP, findPart, type Sound } from '../state/sound/sound'
import { COMB_POINTS, combResponse } from '../viz/comb'
import { DRIVE_POINTS, driveCurve } from '../viz/drive'
import { EQ_OUTLINE_POINTS, eqOutline, eqPoints } from '../viz/eq'
import { OUTLINE_POINTS, STAGE_POINTS, envelopeOutline } from '../viz/envelope'
import {
  HIGHEST_HZ,
  LOWEST_HZ,
  RESPONSE_POINTS,
  filterResponse,
} from '../viz/filter'
import { FORMANT_POINTS, formantResponse } from '../viz/formant'
import { LFO_CYCLES, LFO_POINTS, lfoOutline } from '../viz/lfo'

/** The box an outline is drawn in, in SVG units */
export const OUTLINE_WIDTH = 96
export const OUTLINE_HEIGHT = 24
/** Room above and below for the stroke */
const PAD = 2

/** Reused between drawings: a knob drag draws many */
const ENVELOPE = new Float32Array(OUTLINE_POINTS * 2)
const LFO = new Float32Array(LFO_POINTS * 2)
const RESPONSE = new Float32Array(RESPONSE_POINTS * 2)
const DRIVE = new Float32Array(DRIVE_POINTS * 2)
const COMB = new Float32Array(COMB_POINTS * 2)
const FORMANT = new Float32Array(FORMANT_POINTS * 2)
const EQ = new Float32Array(EQ_OUTLINE_POINTS * 2)

type OutlineKind =
  'envelope' | 'lfo' | 'filter' | 'drive' | 'comb' | 'formant' | 'eq'

/** What picture part has, if any */
export function outlineKind(
  sound: Sound,
  part: string
): OutlineKind | undefined {
  if (part === AMP) return 'envelope'
  const found = findPart(sound, part)
  if (found?.type === 'modulator') {
    return found.part.kind === 'env' ? 'envelope' : 'lfo'
  }
  if (found?.type === 'item') return found.part.kind
  if (found?.type === 'effect' && found.part.kind === 'eq') return 'eq'
  return undefined
}

/** An outline's points, x, y pairs in 0..1 (y up), and how many */
interface Trace {
  readonly points: Float32Array
  readonly count: number
}

/** The points of part's outline, drawn into its kind's buffer; or none */
function trace(sound: Sound, part: string): Trace | undefined {
  const value = (key: string) => knobValue(sound, part, key)
  const travel = (key: string) => {
    const spec = knobSpec(sound, part, key)
    return spec ? toNormalized(spec, value(key)) : 0
  }
  switch (outlineKind(sound, part)) {
    case 'envelope':
      envelopeOutline(
        ENVELOPE,
        travel('attack'),
        travel('decay'),
        value('sustain'),
        travel('release')
      )
      return { points: ENVELOPE, count: OUTLINE_POINTS }
    case 'lfo':
      lfoOutline(LFO, value('shape'), value('fade') * value('rate'))
      return { points: LFO, count: LFO_POINTS }
    case 'filter':
      filterResponse(
        RESPONSE,
        value('type'),
        value('cutoff'),
        value('resonance')
      )
      return { points: RESPONSE, count: RESPONSE_POINTS }
    case 'drive':
      driveCurve(DRIVE, value('drive'))
      return { points: DRIVE, count: DRIVE_POINTS }
    case 'comb':
      combResponse(COMB, value('decay'), value('damp'), value('mix'))
      return { points: COMB, count: COMB_POINTS }
    case 'formant':
      formantResponse(
        FORMANT,
        value('vowel'),
        value('shift'),
        value('resonance'),
        value('mix')
      )
      return { points: FORMANT, count: FORMANT_POINTS }
    case 'eq': {
      const found = findPart(sound, part)
      if (found?.type !== 'effect') return undefined
      eqOutline(EQ, eqPoints(found.part.values))
      return { points: EQ, count: EQ_OUTLINE_POINTS }
    }
    default:
      return undefined
  }
}

/**
 * The outline of part as path data in OUTLINE_WIDTH by OUTLINE_HEIGHT,
 * y down; '' for a part with none. The fill under it closes the same line
 * along the bottom (outlineFill).
 */
export function outlinePath(sound: Sound, part: string): string {
  const drawn = trace(sound, part)
  return drawn ? path(drawn.points, 0, drawn.count - 1) : ''
}

/**
 * The knobs that shape each kind's picture: turning one lights the piece
 * of it the knob moves (outlineLit), the whole line where it moves all
 * of it. An EQ's points are moved on its own graph (EqGraph).
 */
const SHAPED_BY: Readonly<Record<OutlineKind, readonly string[]>> = {
  envelope: ['attack', 'decay', 'sustain', 'release'],
  lfo: ['shape', 'rate', 'fade'],
  filter: ['type', 'cutoff', 'resonance'],
  drive: ['drive'],
  comb: ['decay', 'damp', 'mix'],
  formant: ['vowel', 'shift', 'resonance', 'mix'],
  eq: [],
}

/**
 * How far either side of a filter's cutoff its pieces reach, as a share
 * of the frequency axis: the cutoff's the corner, the resonance's the
 * peak at it
 */
const CORNER = 0.14
const PEAK = 0.05

/**
 * The piece of part's outline that knob moves, as path data drawn as
 * outlinePath's is, for the picture to light while the knob is turned
 * (asked for by ashon, 2026-11-21, after Teenage Engineering's OP-1,
 * whose knobs light the piece of the screen they move): an envelope's
 * stage (the attack's rise, the decay's fall, the sustain's hold, the
 * release's), a filter's corner for its cutoff and the peak at it for
 * its resonance, an LFO's fade-in for its fade, and the whole line for a
 * knob that moves all of it (a shape, a drive). '' for a knob the
 * picture does not follow, or a piece of no length (a fade of none).
 */
export function outlineLit(sound: Sound, part: string, knob: string): string {
  const kind = outlineKind(sound, part)
  if (!kind || !SHAPED_BY[kind].includes(knob)) return ''
  const drawn = trace(sound, part)
  if (!drawn) return ''
  const last = drawn.count - 1
  const at = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * last)
  if (kind === 'envelope') {
    const stage = SHAPED_BY.envelope.indexOf(knob)
    // The start, a stage's points each, the sustain's end, the release's
    const ends = [0, STAGE_POINTS, 2 * STAGE_POINTS, 2 * STAGE_POINTS + 1]
    const from = ends[stage] ?? 0
    const to = ends[stage + 1] ?? last
    return path(drawn.points, from, to)
  }
  if (kind === 'filter' && knob !== 'type') {
    const hz = knobValue(sound, part, 'cutoff')
    const x = Math.log2(hz / LOWEST_HZ) / Math.log2(HIGHEST_HZ / LOWEST_HZ)
    const reach = knob === 'cutoff' ? CORNER : PEAK
    return path(drawn.points, at(x - reach), at(x + reach))
  }
  if (kind === 'lfo' && knob === 'fade') {
    const cycles =
      knobValue(sound, part, 'fade') * knobValue(sound, part, 'rate')
    const to = at(cycles / LFO_CYCLES)
    return to > 0 ? path(drawn.points, 0, to) : ''
  }
  return path(drawn.points, 0, last)
}

/** Where an EQ's 0 dB stands in the outline's box: its middle */
export const OUTLINE_MIDDLE = OUTLINE_HEIGHT / 2

/**
 * The area under an outline's path: from each end of the line straight
 * down to base (the bottom; an EQ's, its 0 dB, OUTLINE_MIDDLE), and along
 * it. An envelope ends where its release does, short of the right edge,
 * and its area with it.
 */
export function outlineFill(line: string, base = OUTLINE_HEIGHT): string {
  if (line === '') return ''
  const first = /^M([\d.]+)/.exec(line)?.[1] ?? '0'
  const last = /([\d.]+) [\d.]+$/.exec(line)?.[1] ?? `${OUTLINE_WIDTH}`
  return `${line}L${last} ${base}L${first} ${base}Z`
}

/**
 * The x, y pairs (0..1, y up) from from to to, both included, as path
 * data in the outline's box
 */
function path(points: Float32Array, from: number, to: number): string {
  let d = ''
  for (let i = from; i <= to; i++) {
    const x = (points[2 * i] ?? 0) * OUTLINE_WIDTH
    const y = PAD + (1 - (points[2 * i + 1] ?? 0)) * (OUTLINE_HEIGHT - 2 * PAD)
    d += `${i === from ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}
