/**
 * A loop note's ornament (docs/plan/tracks-and-song.md, I): what it plays
 * around and within its step, expanded by the sequencer as it plays
 * (sequencer.ts), and by the grid for its marks. The note stays one cell;
 * its ornament is chosen from a menu (ashon, 2026-11-15: "노트에 붙이기",
 * all four kinds offered, a trill and a mordent apart). Expanded, a note
 * is its sounds: each one's start and length in steps from the note's
 * own step (below 0 is before it), how far from its key in semitones,
 * how hard, and whether it strikes a new note or moves the pitch of the
 * one sounding, as a tracker's arpeggio does. Pure: no DOM, no Web Audio.
 */

/** What an ornament plays */
export type OrnamentKind = 'grace' | 'mordent' | 'trill' | 'roll' | 'arp'

export const ORNAMENT_KINDS: readonly OrnamentKind[] = [
  'grace',
  'mordent',
  'trill',
  'roll',
  'arp',
]

/** The kinds a kit's pad takes: no pitch to move, so no trill or arp */
export const KIT_ORNAMENTS: readonly OrnamentKind[] = ['grace', 'roll']

/** Sounds a sixteenth step: how fast an ornament goes */
export const SPEEDS = [2, 3, 4, 6, 8] as const

export type Speed = (typeof SPEEDS)[number]

/** An arpeggio's chords, in semitones over the note */
export const CHORDS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  sus4: [0, 5, 7],
  fifth: [0, 7],
  oct: [0, 12],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dim: [0, 3, 6],
} as const satisfies Record<string, readonly number[]>

export type Chord = keyof typeof CHORDS

export const CHORD_NAMES: Readonly<Record<Chord, string>> = {
  maj: 'Maj',
  min: 'Min',
  sus4: 'Sus4',
  fifth: '5th',
  oct: 'Oct',
  maj7: 'Maj7',
  min7: 'Min7',
  dim: 'Dim',
}

/** An arpeggio's way through its chord */
export type ArpOrder = 'up' | 'down' | 'updown'

/** A roll's level, from its first sound to its last */
export type RollShape = 'flat' | 'rise' | 'fall'

/** Grace notes before the note's step, or on it, the note after them */
export type GracePlace = 'before' | 'on'

/** The most semitones a grace, a mordent or a trill reaches, up or down */
export const MAX_INTERVAL = 12

/** The most grace notes before a note: one, a drag of two, a ruff of three */
export const MAX_GRACES = 3

/**
 * The most sounds a note expands to: a trill or an arpeggio moves no
 * more often than this (eight bars at ×8, thirty-two at ×2), the note
 * then held where it got to, to its end
 */
export const MAX_SOUNDS = 1024

/** A grace note's velocity, a share of its note's; a kit's flam's softer */
export const GRACE_SHARE = 0.7
export const FLAM_SHARE = 0.45

/** A struck sound of a roll, or one restarting, shorter than its room */
const GATE = 0.7
const RESTART_GATE = 0.85

export interface Grace {
  readonly kind: 'grace'
  /** Semitones from the note to the grace nearest it: -12..12, not 0 */
  readonly interval: number
  /** 1 to MAX_GRACES, each a step of interval further away */
  readonly count: number
  readonly speed: Speed
  readonly place: GracePlace
}

/** A mordent (the note, its neighbour, the note) or a trill (on and on) */
export interface Shake {
  readonly kind: 'mordent' | 'trill'
  /** Semitones to the neighbour: -12..12, not 0 */
  readonly interval: number
  readonly speed: Speed
  /** Each sound struck anew, or the pitch moved (a tracker's way) */
  readonly restart: boolean
}

export interface Roll {
  readonly kind: 'roll'
  readonly speed: Speed
  readonly shape: RollShape
}

export interface Arp {
  readonly kind: 'arp'
  readonly chord: Chord
  readonly order: ArpOrder
  readonly speed: Speed
  /** Each sound struck anew, or the pitch moved (a tracker's way) */
  readonly restart: boolean
}

export type Ornament = Grace | Shake | Roll | Arp

/** Each kind as it is first chosen */
export const ORNAMENT_DEFAULTS = {
  grace: { kind: 'grace', interval: -1, count: 1, speed: 4, place: 'before' },
  mordent: { kind: 'mordent', interval: 2, speed: 4, restart: false },
  trill: { kind: 'trill', interval: 2, speed: 4, restart: false },
  roll: { kind: 'roll', speed: 2, shape: 'flat' },
  arp: { kind: 'arp', chord: 'min', order: 'up', speed: 4, restart: false },
} as const satisfies { readonly [K in OrnamentKind]: Ornament & { kind: K } }

/** One sound of a note, in steps from the note's own */
export interface Sound {
  /** Its start: below 0, before the note's step */
  readonly t: number
  /** How long it sounds (moving the pitch, until the next sound) */
  readonly d: number
  /** Semitones from the note's key */
  readonly off: number
  /** How hard, 0..1 */
  readonly v: number
  /** A note started; otherwise the pitch of the one sounding moved */
  readonly strike: boolean
}

/** Whether a kit's pad (pitched false) plays this kind */
export function playsOn(kind: OrnamentKind, pitched: boolean): boolean {
  return pitched || KIT_ORNAMENTS.includes(kind)
}

/**
 * What a note of length steps at velocity plays with ornament, on a
 * synth (pitched) or a kit's pad: its sounds, in the order they start.
 * With none, or one a pad does not take, the note alone.
 */
export function expand(
  length: number,
  velocity: number,
  ornament: Ornament | undefined,
  pitched = true
): Sound[] {
  const L = length
  const v = velocity
  const main: Sound = { t: 0, d: L, off: 0, v, strike: true }
  if (!ornament || !playsOn(ornament.kind, pitched)) return [main]
  const g = 1 / ornament.speed
  switch (ornament.kind) {
    case 'grace': {
      const { count } = ornament
      const step = pitched ? ornament.interval : 0
      const soft = v * (pitched ? GRACE_SHARE : FLAM_SHARE)
      const out: Sound[] = []
      if (ornament.place === 'before') {
        for (let k = 0; k < count; k++) {
          const far = count - k
          out.push({
            t: -far * g,
            d: g,
            off: step * far,
            v: soft,
            strike: true,
          })
        }
        out.push(main)
        return out
      }
      const gg = Math.min(g, L / (count + 1))
      for (let k = 0; k < count; k++) {
        const far = count - k
        out.push({ t: k * gg, d: gg, off: step * far, v: soft, strike: true })
      }
      out.push({ t: count * gg, d: L - count * gg, off: 0, v, strike: true })
      return out
    }
    case 'mordent': {
      const gg = Math.min(g, L / 3)
      const d = ornament.restart ? gg * RESTART_GATE : gg
      const strike = ornament.restart
      return [
        { t: 0, d, off: 0, v, strike: true },
        { t: gg, d, off: ornament.interval, v, strike },
        { t: 2 * gg, d: L - 2 * gg, off: 0, v, strike },
      ]
    }
    case 'roll': {
      const count = sounds(L, ornament.speed)
      const out: Sound[] = []
      for (let k = 0; k < count; k++) {
        const at = count > 1 ? k / (count - 1) : 1
        const level =
          ornament.shape === 'rise'
            ? 0.3 + 0.7 * at
            : ornament.shape === 'fall'
              ? 1 - 0.7 * at
              : 1
        const d = k === count - 1 ? Math.min(g * GATE, L - k * g) : g * GATE
        out.push({
          t: k * g,
          d,
          off: 0,
          v: Math.max(0.05, v * level),
          strike: true,
        })
      }
      return out
    }
    case 'trill':
    case 'arp': {
      const offs =
        ornament.kind === 'arp' ? arpOffsets(ornament) : [0, ornament.interval]
      const count = sounds(L, ornament.speed)
      const out: Sound[] = []
      for (let k = 0; k < count; k++) {
        const last = k === count - 1
        // Moving the pitch, the last holds to the note's end
        const room = last ? L - k * g : g
        const d = ornament.restart ? Math.min(room, g * RESTART_GATE) : room
        out.push({
          t: k * g,
          d,
          off: offs[k % offs.length] as number,
          v,
          strike: k === 0 || ornament.restart,
        })
      }
      return out
    }
  }
}

/** A trill's or a roll's sounds over L steps: one to MAX_SOUNDS */
function sounds(L: number, speed: Speed): number {
  return Math.min(MAX_SOUNDS, Math.max(1, Math.round(L * speed)))
}

/** An arpeggio's semitones, in its order: up and down not repeating its ends */
export function arpOffsets(arp: Arp): number[] {
  const up: number[] = [...CHORDS[arp.chord]]
  if (arp.order === 'down') return up.reverse()
  if (arp.order === 'updown') return up.concat(up.slice(1, -1).reverse())
  return up
}

/**
 * When each sound's note lets go, in steps from the note's: a struck one
 * at its own end, or, its pitch moved by those after it, at the last of
 * theirs; NaN for those that only move a pitch
 */
export function voiceEnds(sounds: readonly Sound[]): number[] {
  const ends: number[] = new Array<number>(sounds.length).fill(Number.NaN)
  let end = Number.NaN
  for (let k = sounds.length - 1; k >= 0; k--) {
    const sound = sounds[k] as Sound
    const own = sound.t + sound.d
    end = Number.isNaN(end) ? own : Math.max(end, own)
    if (sound.strike) {
      ends[k] = end
      end = Number.NaN
    }
  }
  return ends
}

/** The ornament kept (a song's, read back), or none where it is none */
export function readOrnament(value: unknown): Ornament | undefined {
  if (typeof value !== 'object' || value === null) return
  const given = value as Readonly<Record<string, unknown>>
  const kind = given.kind
  if (typeof kind !== 'string' || !isKind(kind)) return
  const speed = oneOf(given.speed, SPEEDS, ORNAMENT_DEFAULTS[kind].speed)
  switch (kind) {
    case 'grace':
      return {
        kind,
        interval: interval(given.interval, ORNAMENT_DEFAULTS.grace.interval),
        count: whole(given.count, 1, MAX_GRACES, 1),
        speed,
        place: oneOf(given.place, ['before', 'on'] as const, 'before'),
      }
    case 'mordent':
    case 'trill':
      return {
        kind,
        interval: interval(given.interval, ORNAMENT_DEFAULTS[kind].interval),
        speed,
        restart: given.restart === true,
      }
    case 'roll':
      return {
        kind,
        speed,
        shape: oneOf(given.shape, ['flat', 'rise', 'fall'] as const, 'flat'),
      }
    case 'arp':
      return {
        kind,
        chord: oneOf(given.chord, Object.keys(CHORDS) as Chord[], 'min'),
        order: oneOf(given.order, ['up', 'down', 'updown'] as const, 'up'),
        speed,
        restart: given.restart === true,
      }
  }
}

/** Whether two ornaments play the same (none and none do) */
export function sameOrnament(
  a: Ornament | undefined,
  b: Ornament | undefined
): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  const left = a as unknown as Readonly<Record<string, unknown>>
  const right = b as unknown as Readonly<Record<string, unknown>>
  return Object.keys(left).every((key) => left[key] === right[key])
}

function isKind(kind: string): kind is OrnamentKind {
  return (ORNAMENT_KINDS as readonly string[]).includes(kind)
}

function oneOf<T extends string | number>(
  value: unknown,
  options: readonly T[],
  fallback: T
): T {
  return options.includes(value as T) ? (value as T) : fallback
}

/** A whole number of semitones within reach, not 0 */
function interval(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const semitones = Math.round(value)
  if (semitones === 0) return fallback
  return Math.max(-MAX_INTERVAL, Math.min(MAX_INTERVAL, semitones))
}

function whole(value: unknown, low: number, high: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(low, Math.min(high, Math.round(value)))
}
