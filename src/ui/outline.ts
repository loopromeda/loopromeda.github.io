/**
 * A part's picture: an envelope's shape (the amp's, an Env's), an LFO's
 * cycles, a filter's response, a drive's curve. Their tiles draw it as
 * knobs turn (Picture.tsx): a chain's items, the amp, the modulators in
 * the rack. Pure: it reads the sound and returns SVG path data.
 */
import { toNormalized } from '../state/params'
import { knobSpec, knobValue } from '../state/sound/knob'
import { AMP, findPart, type Sound } from '../state/sound/sound'
import { DRIVE_POINTS, driveCurve } from '../viz/drive'
import { OUTLINE_POINTS, envelopeOutline } from '../viz/envelope'
import { RESPONSE_POINTS, filterResponse } from '../viz/filter'
import { LFO_POINTS, lfoOutline } from '../viz/lfo'

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

type OutlineKind = 'envelope' | 'lfo' | 'filter' | 'drive'

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
  return undefined
}

/**
 * The outline of part as path data in OUTLINE_WIDTH by OUTLINE_HEIGHT,
 * y down; '' for a part with none. The fill under it closes the same line
 * along the bottom (outlineFill).
 */
export function outlinePath(sound: Sound, part: string): string {
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
      return path(ENVELOPE, OUTLINE_POINTS)
    case 'lfo':
      lfoOutline(LFO, value('shape'), value('fade') * value('rate'))
      return path(LFO, LFO_POINTS)
    case 'filter':
      filterResponse(
        RESPONSE,
        value('type'),
        value('cutoff'),
        value('resonance')
      )
      return path(RESPONSE, RESPONSE_POINTS)
    case 'drive':
      driveCurve(DRIVE, value('drive'))
      return path(DRIVE, DRIVE_POINTS)
    default:
      return ''
  }
}

/**
 * The area under an outline's path: from each end of the line straight
 * down to the bottom, and along it. An envelope ends where its release
 * does, short of the right edge, and its area with it.
 */
export function outlineFill(line: string): string {
  if (line === '') return ''
  const first = /^M([\d.]+)/.exec(line)?.[1] ?? '0'
  const last = /([\d.]+) [\d.]+$/.exec(line)?.[1] ?? `${OUTLINE_WIDTH}`
  return `${line}L${last} ${OUTLINE_HEIGHT}L${first} ${OUTLINE_HEIGHT}Z`
}

/** count x, y pairs (0..1, y up) as path data in the outline's box */
function path(points: Float32Array, count: number): string {
  let d = ''
  for (let i = 0; i < count; i++) {
    const x = (points[2 * i] ?? 0) * OUTLINE_WIDTH
    const y = PAD + (1 - (points[2 * i + 1] ?? 0)) * (OUTLINE_HEIGHT - 2 * PAD)
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}
