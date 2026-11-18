import { PRESET_CATEGORIES, type Preset, type PresetCategory } from './presets'
import type { ModulatorKind } from './sound/kinds'
import {
  writeSound,
  type WrittenChain,
  type WrittenKnobs,
  type WrittenPart,
  type WrittenRoute,
  type WrittenSound,
} from './sound/write'

/**
 * A factory preset, written as a sound (src/state/sound/write.ts): its
 * parts under names of their own, choices by name, a route's amount in its
 * destination's units (octaves on a cutoff, semitones on a pitch, a share
 * of a level). A typo throws, naming the preset, so it fails the tests.
 */
function preset(
  name: string,
  category: PresetCategory,
  written: WrittenSound
): Preset {
  try {
    const sound = writeSound(playedAs(written, PLAYING[name]))
    return { name, category, sound }
  } catch (error) {
    throw new Error(`${name}: ${(error as Error).message}`, { cause: error })
  }
}

/*
 * The chip presets (Chip Bass, Chip Sub, Chip Lead, Chip Chords, Chip
 * Pulse 12 and 25), and the Kick and the Snare, are the sounds a 2A03 and
 * N163 chiptune was ported to Loopromeda with, matched to its recording
 * (2026-11-15): dry, as the chips are, each a tracker's note, struck at
 * once and cut when it ends. Since 2026-11-16 their waves are chips'
 * (docs/plan/sound-chains.md, The chip). The tones are on their DACs' DC:
 * each note thumps as it starts and ends, as the recording's do, which
 * brought the port's lows (60 to 120 Hz) from 4.3 dB under the
 * recording's to 1.7 dB, and its worst bar's chroma from 0.921 to 0.939.
 * The middle line's pulses are 12.5%, as the recording's harmonics are
 * (their 4th sounds, their 8th does not), and the drums' bodies are the
 * 2A03's triangle, off its DC.
 */

/** The chip presets' amp: struck at once, held a little under full */
const CHIP_AMP = {
  attack: 0.001,
  decay: 0.1,
  sustain: 0.85,
  release: 0.005,
  velocity: 1,
} as const

/** The chip lead's EQ: the top past 2.5 kHz 4 dB down */
const CHIP_PULSE_EQ = { kind: 'eq', high: -4, highFreq: 2500 } as const

/**
 * The chip pulses' (Chip Pulse 12 and 25) EQ: the lead's, and their 2nd
 * to 7th harmonics, around 1 kHz, 5 dB down, as the recording's middle
 * line holds them under a pulse's own
 */
const CHIP_MID_EQ = { ...CHIP_PULSE_EQ, mid: -5, midFreq: 1000 } as const

/** A chip pulse at a duty, the share of its cycle spent high */
function chipPulse(
  duty: '12.5%' | '25%',
  eq: NonNullable<WrittenSound['effects']>[number] = CHIP_PULSE_EQ
): WrittenSound {
  return {
    inputs: { pulse: { kind: 'chip', duty } },
    chains: { main: { sends: { pulse: 1 } } },
    amp: CHIP_AMP,
    effects: [eq],
  }
}

/**
 * The chip basses: an N163's saw (32 steps of 4 bits, on its DC), a
 * pulse at 6% and a sine, octaves down, the lows and the top of them
 * lifted and the middle a little down
 */
function chipBass(
  octave: number,
  items?: WrittenSound['chains'][string]['items']
): WrittenSound {
  return {
    inputs: {
      saw: { kind: 'chip', wave: 'Saw', bits: 4, octave },
      pulse: { kind: 'osc', wave: 'Square', width: 0.06, octave },
      sine: { kind: 'osc', wave: 'Sine', octave },
    },
    chains: {
      main: { sends: { saw: 0.7, pulse: 1, sine: 1 }, ...(items && { items }) },
    },
    amp: CHIP_AMP,
    effects: [
      {
        kind: 'eq',
        low: 2,
        lowFreq: 55,
        mid: -2.5,
        midFreq: 893,
        high: 5,
        highFreq: 6205,
      },
    ],
  }
}

/*
 * The analog presets (a set of their own, Analog, until 2026-11-18, when
 * they went to the categories they are played as) are a six-voice analog
 * poly's sounds, a Prophet-6's (ashon, 2026-11-16: "프로펫6급에 대한 사운드
 * 프리셋들을 준비해 보고 싶어"): brass, strings, pads, keys, plucks, a poly
 * mod bell, leads and basses. Its voice is written here with the parts
 * the engine has (analog, below): two oscillators and a sub an octave
 * under the first, into a lowpass of four poles and a highpass of two,
 * a filter envelope beside the amp's, each voice drifting a few cents of
 * its own (the poly's slop) and standing a little apart from the others
 * across the sides (its pan spread). Its poly mod is an oscillator's FM
 * from the other, moved by the filter envelope; its unison, a mono
 * sound's oscillators stacked a few cents apart.
 */

/** An analog voice's lowpass: its four poles two filters of two in a row */
interface AnalogLowpass {
  readonly cutoff: number
  /** On the second filter only, whose peak the first's slope shapes */
  readonly resonance?: number
  readonly keytrack?: number
  /** The filter envelope's depth, in octaves */
  readonly env?: number
  /** How far a hard note opens it further, in octaves */
  readonly velocity?: number
}

/** An analog voice, as analog() writes it into a sound */
interface AnalogVoice extends Omit<WrittenSound, 'chains'> {
  /** The level each input is taken into the filters at, by name */
  readonly mix: Readonly<Record<string, number>>
  readonly lp: AnalogLowpass
  /** A highpass after the lowpass, of two poles: its cutoff in Hz */
  readonly hp?: number
  /** After the filters, in the order written: a drive */
  readonly items?: WrittenChain['items']
  /** The filter envelope's knobs (filterEnv, which routes may move more) */
  readonly filterEnv: WrittenKnobs
  /**
   * How far each input drifts, by name, in cents, its sign which way: a
   * voice's slop, a smooth wander of its own (slop), which moves its
   * cutoff a tenth of an octave too
   */
  readonly slop: Readonly<Record<string, number>>
  /** How far apart the voices stand, a share of the way to a side */
  readonly spread?: number
}

/**
 * An analog voice as a sound: the inputs into lp1 and lp2 (a lowpass of
 * four poles) and an hp, the filter envelope and velocity into both
 * lowpasses, each input's slop, and each note placed by random within the
 * spread. Its own modulators and routes come after these.
 */
function analog({
  mix,
  lp,
  hp,
  items,
  filterEnv,
  slop,
  spread = 0,
  modulators,
  routes = [],
  ...sound
}: AnalogVoice): WrittenSound {
  const poles = {
    kind: 'filter',
    cutoff: lp.cutoff,
    keytrack: lp.keytrack ?? 0,
  } as const
  const lowpass: WrittenRoute[] = ['lp1', 'lp2'].flatMap((filter) => [
    ...(lp.env
      ? [{ from: 'filterEnv', to: `${filter}.cutoff`, by: lp.env }]
      : []),
    ...(lp.velocity
      ? [{ from: 'velocity', to: `${filter}.cutoff`, by: lp.velocity }]
      : []),
    { from: 'slop', to: `${filter}.cutoff`, by: 0.1 },
  ])
  return {
    ...sound,
    chains: {
      main: {
        sends: mix,
        items: {
          lp1: poles,
          lp2: { ...poles, resonance: lp.resonance ?? 0 },
          ...(hp && { hp: { kind: 'filter', type: 'HP', cutoff: hp } }),
          ...items,
        },
      },
    },
    modulators: {
      filterEnv: { kind: 'env', ...filterEnv },
      // Each voice's own wander, at a pace of its own
      slop: { kind: 'lfo', shape: 'Smooth', rate: 0.3, trigger: 'Key' },
      ...modulators,
    },
    routes: [
      ...lowpass,
      ...Object.entries(slop).map(([input, cents]) => ({
        from: 'slop',
        to: `${input}.pitch`,
        by: cents / 100,
      })),
      { from: 'random', to: 'slop.rate', by: 1 },
      ...(spread ? [{ from: 'random', to: 'amp.pan', by: spread }] : []),
      ...routes,
    ],
  }
}

/*
 * Where each preset stands across the sides (ashon, 2026-11-17: "악기들
 * 마다 스테레오감도 살려서 완성도를 전체적으로 올리고 싶은데"): a voice is
 * one signal, placed by its pan, so a sound is only as wide as its notes
 * are apart or as its inserts make it. The poly sounds place each note
 * somewhere of its own (spread), a pad's each wandering as it holds; the
 * keys, the mallets and the bells lay their notes out as a player sees
 * them, the low ones on the left (keyPan); the mono sounds stay in the
 * middle and widen above it, a doubler's or a chorus's two sides, with a
 * width after that keeps the lows below a corner in the middle
 * (widened), as a mix wants its basses; the echoes of a pluck, a lead
 * and the blips bounce from side to side (pingPong); the drums stand
 * where a kit's do, seen from the drummer's seat, the hats on the left
 * and the floor tom on the right, the kick and the snare in the middle.
 * The chip presets stay in the middle, dry, as the chips are.
 */

/** Each note placed at random within by of the middle, a side at 1 */
const spread = (by: number): WrittenRoute => ({
  from: 'random',
  to: 'amp.pan',
  by,
})

/**
 * The notes laid out low on the left to high on the right, as a player
 * sees the keys: by at C8, a quarter of it at C5
 */
const keyPan = (by: number): WrittenRoute => ({
  from: 'key',
  to: 'amp.pan',
  by,
})

/**
 * A width after a widening: the sides scaled by width, and below mono
 * hertz the lows in the middle, as a mix wants them
 */
const widened = (width: number, mono: number) =>
  ({ kind: 'width', width, mono }) as const

/**
 * The basses' mono corner: their lows, the fundamentals and the next few
 * harmonics, in the middle (docs/plan/sound-chains.md, The library: a
 * bass's side under 150 Hz 20 dB under its middle)
 */
const BASS_MONO = 220

/** An echo of the sound's own crossing from side to side, on the beat */
const pingPong = (mix: number, feedback = 0.35, beat = '1/8D') =>
  ({
    kind: 'delay',
    sync: 'On',
    beat,
    feedback,
    tone: 0.5,
    mode: 'Ping-pong',
    mix,
  }) as const

/*
 * How each preset is played (docs/plan/sound-chains.md, The library),
 * written apart from how it sounds: whether its oscillators run free, so
 * a chord's notes never start as one on their peaks (the in-phase
 * onset); how far its level comes down to its role's loudness; what
 * the mod wheel does to it; and how much brighter a harder note plays,
 * as an instrument's does. Every preset makes some use of the wheel.
 */
interface Playing {
  /** Its oscillators free-running (Phase Free), but an FM pair's */
  readonly free?: boolean
  /** Its level, dB under as written: its sends turned down together */
  readonly trim?: number
  /** What the mod wheel does */
  readonly wheel?: Wheel
  /** Velocity's say in its brightness: octaves on each lowpass, at full */
  readonly bright?: number
  /** The amp's velocity, in place of the one written */
  readonly velocity?: number
}

type Wheel =
  /** A vibrato the wheel brings in: cents at its top, at rate hertz */
  | { readonly vibrato: number; readonly rate?: number }
  /** Each lowpass opened by the wheel: octaves at its top */
  | { readonly open: number }
  /** Routes of the preset's own, from the wheel or via it */
  | {
      readonly routes: readonly WrittenRoute[]
      readonly modulators?: Readonly<Record<string, WrittenPart<ModulatorKind>>>
    }

/** written as playing has it played */
function playedAs(
  written: WrittenSound,
  playing: Playing | undefined
): WrittenSound {
  if (!playing) return written
  const lowpasses = Object.values(written.chains).flatMap((chain) =>
    Object.entries(chain.items ?? {})
      .filter(([, item]) => item.kind === 'filter' && isLowpass(item.type))
      .map(([name]) => name)
  )
  const routes: WrittenRoute[] = []
  const modulators: Record<string, WrittenPart<ModulatorKind>> = {}
  if (playing.bright) {
    for (const lp of lowpasses) {
      routes.push({ from: 'velocity', to: `${lp}.cutoff`, by: playing.bright })
    }
  }
  const wheel = playing.wheel
  if (wheel && 'vibrato' in wheel) {
    modulators.wheelVibrato = {
      kind: 'lfo',
      shape: 'Sine',
      rate: wheel.rate ?? 5.5,
    }
    routes.push({
      from: 'wheelVibrato',
      to: 'voice.pitch',
      by: wheel.vibrato / 100,
      via: 'wheel',
    })
  } else if (wheel && 'open' in wheel) {
    for (const lp of lowpasses) {
      routes.push({ from: 'wheel', to: `${lp}.cutoff`, by: wheel.open })
    }
  } else if (wheel) {
    routes.push(...wheel.routes)
    Object.assign(modulators, wheel.modulators)
  }
  const level = Math.pow(10, -(playing.trim ?? 0) / 20)
  const sends = written.sends ?? {}
  return {
    ...written,
    inputs: playing.free ? freeRunning(written.inputs) : written.inputs,
    modulators: { ...written.modulators, ...modulators },
    routes: [...(written.routes ?? []), ...routes],
    amp:
      playing.velocity === undefined
        ? written.amp
        : { ...written.amp, velocity: playing.velocity },
    sends:
      level === 1
        ? written.sends
        : Object.fromEntries(
            ['a', 'b', 'c', 'd'].map((bus) => [
              bus,
              Number(sends[bus] ?? (bus === 'a' ? 1 : 0)) * level,
            ])
          ),
  }
}

/** A filter's type as written: a lowpass unless written otherwise */
function isLowpass(type: WrittenKnobs[string] | undefined): boolean {
  return type === undefined || type === 'LP' || type === 0
}

/**
 * A plucked string's burst (Karplus-Strong): its noise into the chain's
 * comb for burst seconds, then held shut while the note sounds and long
 * after it ends, so nothing but the burst ever reaches the comb. The send
 * sits at a hair over nothing, the burst opening it, the hold closing it
 * past its release.
 */
function plucked(chain: string, input: string, burst: number) {
  return {
    modulators: {
      pluck: { kind: 'env', attack: 0.001, decay: burst },
      damper: { kind: 'env', attack: 2 * burst, sustain: 1, release: 10 },
    },
    routes: [
      { from: 'pluck', to: `${chain}.send.${input}`, by: 1 },
      { from: 'damper', to: `${chain}.send.${input}`, by: -1 },
    ],
  } as const
}

/** Each oscillator free-running, Phase Free; but one another reads as its
 * FM, and the one reading it, keep their start, so an FM sound's notes
 * strike alike
 */
function freeRunning(inputs: WrittenSound['inputs']): WrittenSound['inputs'] {
  const read = new Set(
    Object.values(inputs).flatMap((input) =>
      typeof input.fmSource === 'string' ? [input.fmSource] : []
    )
  )
  return Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [
      name,
      input.kind === 'osc' && !read.has(name) && input.fmSource === undefined
        ? { ...input, phase: 'Free' }
        : input,
    ])
  )
}

/** The wheel moving each knob named, by as much at its top */
function moves(...knobs: readonly (readonly [string, number])[]): Wheel {
  return { routes: knobs.map(([to, by]) => ({ from: 'wheel', to, by })) }
}

/** A drum's wheel: tuned up, by semitones at its top */
const tuned = moves(['voice.pitch', 5])

/** A cymbal's wheel: its highpass down an octave, more of its body */
const opened = moves(['filter.cutoff', -1])

/** How each preset is played, by its name: none for the chip's */
const PLAYING: Readonly<Record<string, Playing>> = {
  'Saw Bass': { trim: 2.6, wheel: { open: 1.5 }, bright: 1.5 },
  // The wheel brings in more of the octave: for a small speaker
  'Sub Bass': { trim: 1.5, wheel: moves(['main.send.body', 0.5]) },
  'Acid Bass': { trim: 3.4, velocity: 0.75, wheel: { open: 1.5 } },
  'FM Bass': { trim: 0.5, velocity: 0.85, wheel: moves(['carrier.fm', 0.3]) },
  // The wheel speeds the wobble up an octave
  'Wobble Bass': {
    trim: 2,
    velocity: 0.6,
    wheel: moves(['lfo.rate', 1]),
    bright: 1.2,
  },
  // The wheel pulls the two saws further apart: a faster beat
  'Reese Bass': {
    trim: 5.5,
    wheel: moves(['high.pitch', 0.3], ['low.pitch', -0.3]),
    bright: 1.2,
  },
  'Growl Bass': {
    trim: 4.7,
    wheel: moves(['drive.drive', 0.3], ['filter.cutoff', 1]),
    bright: 1,
  },
  'Saw Lead': { trim: 4.5, free: true, wheel: { vibrato: 45 }, bright: 0.8 },
  'Fifth Lead': { trim: 3.9, free: true, wheel: { open: 1.5 }, bright: 0.8 },
  // The wheel raises its scream
  'Scream Lead': {
    trim: 1.9,
    velocity: 0.8,
    wheel: moves(['band.cutoff', 1.2]),
  },
  'Feedback Lead': { trim: 3.6, wheel: { vibrato: 40 } },
  'Warm Pad': { trim: 7.9, free: true, velocity: 0.5, wheel: { open: 1.5 } },
  'PWM Pad': { trim: 8, free: true, velocity: 0.5, wheel: { open: 1.5 } },
  'Glass Pad': { trim: 7.7, velocity: 0.5, wheel: moves(['carrier.fm', 0.15]) },
  Strings: {
    trim: 8.4,
    free: true,
    velocity: 0.5,
    wheel: { vibrato: 25, rate: 5.2 },
  },
  // The wheel opens the vowel: "oo" towards "ah"
  'Choir Pad': {
    trim: 8.3,
    free: true,
    velocity: 0.5,
    wheel: moves(['first.cutoff', 0.6], ['second.cutoff', 0.6]),
  },
  // The wheel brings up its breath
  'Breath Pad': {
    trim: 8.1,
    free: true,
    velocity: 0.5,
    wheel: moves(['breath.level', 0.5]),
  },
  'Soft Pluck': { trim: 0.4, free: true, wheel: { open: 1.5 } },
  'Square Pluck': { trim: 0.4, free: true, wheel: { open: 1.5 }, bright: 1.2 },
  Kalimba: { trim: 2.6, wheel: moves(['tine.fm', 0.1]) },
  // The wheel: harder mallets
  Marimba: { trim: 0.8, wheel: moves(['main.send.overtone', 0.3]) },
  // The wheel brings in the suitcase's tremolo
  'E-Piano': {
    trim: 9.3,
    wheel: {
      routes: [{ from: 'tremolo', to: 'amp.gain', by: -0.4, via: 'wheel' }],
    },
  },
  'FM Bell': { trim: 7.6, wheel: moves(['carrier.fm', 0.2]) },
  // The wheel spins the rotor up from its chorale to its tremolo
  Organ: {
    trim: 8.2,
    free: true,
    velocity: 0.45,
    wheel: moves(['rotor.rate', 3]),
  },
  Clav: { trim: 9.7, free: true, wheel: { open: 1.5 } },
  // The wheel speeds its motor
  Vibes: { trim: 6.8, wheel: moves(['fans.rate', 1.2]) },
  Kick: { wheel: tuned },
  Snare: { wheel: tuned },
  'Closed Hat': { wheel: opened },
  'Open Hat': { wheel: opened },
  Tom: { wheel: tuned },
  // The wheel raises its band: a tighter clap
  Clap: { wheel: moves(['band.cutoff', 1]) },
  Cowbell: { wheel: tuned },
  'Low Tom': { wheel: tuned },
  'High Tom': { wheel: tuned },
  Rim: { wheel: tuned },
  Shaker: { wheel: opened },
  Crash: { wheel: opened },
  // The wheel drives it: a distorted boom
  Boom: { wheel: moves(['drive.drive', 0.4]) },
  Conga: { wheel: tuned },
  Clave: { wheel: tuned },
  // The wheel: faster blips
  Blips: { trim: 5.4, wheel: moves(['steps.rate', 1.5]) },
  Zap: { wheel: moves(['voice.pitch', 12]) },
  Riser: { trim: 5.2, wheel: moves(['band.cutoff', 1]) },
  // The wheel: a stormier wind
  Wind: { trim: 4.8, velocity: 0.5, wheel: moves(['gust.rate', 1.5]) },
  // The wheel: a faster wail
  Siren: { trim: 5.1, wheel: moves(['wail.rate', 1.5]) },
  'Poly Brass': {
    trim: 8.3,
    free: true,
    velocity: 0.55,
    wheel: { open: 1.2 },
    bright: 0.4,
  },
  'Brass Stab': { trim: 8.5, free: true, wheel: { open: 1 } },
  'Poly Strings': {
    trim: 8.3,
    free: true,
    velocity: 0.5,
    wheel: { open: 1.2 },
  },
  'Velvet Pad': { trim: 6.9, free: true, velocity: 0.5, wheel: { open: 1.5 } },
  'Hollow Pulse': {
    trim: 7.9,
    free: true,
    velocity: 0.5,
    wheel: { open: 1.5 },
  },
  'Poly Sweep': { trim: 6.8, free: true, velocity: 0.5, wheel: { open: 1.5 } },
  'Poly Keys': { trim: 10.9, free: true, wheel: { open: 1.2 } },
  'Poly Pluck': { trim: 6.7, free: true, wheel: { open: 1.2 }, bright: 0.5 },
  // The wheel: more poly mod, more clang
  'Poly Mod Bell': { trim: 3.9, velocity: 0.6, wheel: moves(['tri.fm', 0.3]) },
  'Unison Lead': { trim: 4, free: true, velocity: 0.5, bright: 0.8 },
  'Analog Bass': { trim: 0.4, velocity: 0.6, wheel: { open: 1.5 } },
  'Unison Bass': { trim: 3, velocity: 0.55, wheel: { open: 1.5 } },
  'Poly Mod Lead': { trim: 3.5 },
  // The library's
  'Supersaw Lead': {
    trim: 5.1,
    wheel: moves(['stack.detune', 0.3]),
    bright: 0.6,
  },
  'Festival Lead': {
    trim: 7.3,
    wheel: moves(['stack.detune', 0.3]),
    bright: 0.5,
  },
  // The wheel sweeps the synced saw up two octaves more
  'Sync Lead': {
    trim: 3.9,
    free: true,
    wheel: moves(['synced.sync', 16]),
    bright: 0.6,
  },
  // The wheel raises the voice
  'Talk Lead': {
    trim: 9.3,
    free: true,
    wheel: moves(['mouth.shift', 5]),
    bright: 2,
  },
  // The wheel brings up the breath
  'Breath Flute': {
    trim: 4.2,
    free: true,
    wheel: moves(['breath.level', 0.4]),
    bright: 1,
  },
  'Whine Lead': {
    trim: 7.3,
    free: true,
    velocity: 0.6,
    wheel: { open: 1 },
    bright: 1,
  },
  // The wheel pulls the low stack further out of tune
  Hoover: { trim: 8.3, wheel: moves(['low.detune', 0.5]), bright: 0.6 },
  // The wheel drives it harder
  'Trap Bass': { wheel: moves(['drive.drive', 0.5]) },
  'Dirty Trap Bass': {
    trim: 1.9,
    wheel: moves(['filter.cutoff', 1]),
    bright: 1,
  },
  // The wheel talks faster
  'Riddim Bass': { trim: 6.5, wheel: moves(['talk.rate', 1]) },
  'Organ Bass': { trim: 0.6, velocity: 0.5, wheel: { open: 1.5 } },
  'Gate Pad': { trim: 14.1, velocity: 0.5, wheel: { open: 1.5 } },
  'Future Chords': {
    trim: 11.8,
    velocity: 0.5,
    wheel: moves(['stack.detune', 0.3]),
    bright: 0.5,
  },
  'String Machine': {
    trim: 12.9,
    free: true,
    velocity: 0.5,
    wheel: { open: 1.2 },
  },
  // The wheel opens the vowel: "oh" towards "ah"
  'Formant Choir': {
    trim: 16.3,
    velocity: 0.5,
    wheel: moves(['mouth.vowel', -3]),
  },
  Drone: { trim: 16.8, free: true, velocity: 0.5, wheel: { open: 1.5 } },
  'Trance Pluck': { trim: 1.6, wheel: { open: 1.5 }, bright: 0.8 },
  // The wheel lets the string ring brighter
  'Plucked String': { wheel: moves(['body.damp', -0.3]) },
  // The wheel brightens the pluck
  Harp: { wheel: { open: 1.5 } },
  // The wheel presses the string behind its bridge: up to a whole tone
  Koto: { trim: 2.6, wheel: moves(['voice.pitch', 2]) },
  'Deep Stab': { trim: 3.1, free: true, wheel: { open: 1.5 }, bright: 0.8 },
  'Rave Stab': { trim: 8.4, free: true, wheel: { open: 1.5 }, bright: 0.8 },
  // The wheel rides the filter, as a dub mix does
  'Dub Chord': { trim: 2.1, free: true, wheel: { open: 1.5 }, bright: 0.8 },
  'House Piano': {
    trim: 10.8,
    velocity: 0.7,
    wheel: moves(['hammer.fm', 0.3]),
  },
  'Tubular Bell': { trim: 9.7, wheel: moves(['strike.fm', 0.2]) },
  // The wheel: harder mallets
  Glock: { trim: 5.3, free: true, wheel: moves(['bar.send.third', 0.3]) },
  // The wheel opens it further
  Braam: { trim: 5.8, free: true, wheel: moves(['filter.cutoff', 1.5]) },
  Impact: { trim: 0.8, wheel: moves(['voice.pitch', 12]) },
  'Sub Drop': { wheel: moves(['drive.drive', 0.4]) },
  // The wheel brings up the saw under it
  Downlifter: { trim: 2.3, wheel: moves(['tone.level', 0.5]) },
  // The wheel: a faster pass across
  Whoosh: { trim: 0.4, wheel: moves(['across.rate', 1.5]) },
  // The second round's
  'Basic Sine': { trim: 3.7, wheel: { vibrato: 40 } },
  'Basic Saw': { trim: 0.6, bright: 1, wheel: { vibrato: 40 } },
  'Basic Square': { trim: 5.2, bright: 1, wheel: { vibrato: 40 } },
  'Basic Super': { trim: 2.3, bright: 1, wheel: { vibrato: 40 } },
  'Basic FM': { trim: 2.8, wheel: moves(['carrier.fm', 0.3]) },
  // The wheel lets the string ring brighter
  'Upright Bass': { wheel: moves(['comb.damp', -0.4]) },
  'Synthwave Bass': { wheel: { open: 1.5 } },
  'Rubber Bass': { trim: 0.8, bright: 0.5, wheel: { open: 1.5 } },
  'Slap Bass': { trim: 0.3, wheel: moves(['carrier.fm', 0.3]) },
  // The wheel blows harder: more breath
  'Pan Flute': { trim: 5.9, wheel: moves(['breath.level', 0.8]) },
  Whistle: { trim: 3.9, wheel: { vibrato: 50 } },
  'Glide Lead': { trim: 2.6, free: true, bright: 1, wheel: { vibrato: 40 } },
  'Lush Pad': { trim: 12.5, velocity: 0.5, wheel: { open: 1.5 } },
  'Dark Pad': { trim: 15.7, free: true, velocity: 0.5, wheel: { open: 1.5 } },
  // The wheel wears the tape: a deeper wow
  'Tape Pad': {
    trim: 14,
    free: true,
    velocity: 0.5,
    wheel: {
      routes: [{ from: 'wow', to: 'voice.pitch', by: 0.3, via: 'wheel' }],
    },
  },
  'Crystal Pad': {
    trim: 8.3,
    velocity: 0.5,
    wheel: moves(['main.send.ice', 0.4]),
  },
  'String Swell': { trim: 14.7, velocity: 0.5, wheel: { open: 1 } },
  'Staccato Strings': { trim: 2, velocity: 0.6, wheel: { open: 1 } },
  // The wheel bows faster
  'Tremolo Strings': {
    trim: 13.2,
    velocity: 0.5,
    wheel: moves(['bowing.rate', 0.7]),
  },
  'Horn Section': { trim: 13.3, velocity: 0.6, wheel: { open: 1 } },
  Trumpet: { trim: 3, velocity: 0.6, wheel: { vibrato: 50 } },
  'French Horn': { trim: 8.2, free: true, velocity: 0.6, wheel: { open: 1 } },
  Ocean: { trim: 5.1, velocity: 0.5, wheel: { open: 1.5 } },
  'Deep Space': {
    trim: 9.3,
    velocity: 0.5,
    wheel: moves(['main.send.glint', 0.3]),
  },
  'Metal Drone': {
    trim: 4.9,
    free: true,
    velocity: 0.5,
    wheel: moves(['band.cutoff', 1.5]),
  },
  'Punch Kick': { wheel: tuned },
  'Deep Kick': { wheel: tuned },
  // The wheel tunes it up and thins it
  'Tight Snare': { wheel: moves(['voice.pitch', 5], ['lowCut.cutoff', 1]) },
  Tambourine: { wheel: tuned },
  Ride: { wheel: opened },
  Woodblock: { wheel: tuned },
  Laser: { trim: 0.6, wheel: moves(['filter.cutoff', 1.5]) },
  // The wheel bubbles faster
  Bubbles: {
    trim: 6.3,
    wheel: moves(['pick.rate', 1], ['chirp.rate', 1], ['swell.rate', 1]),
  },
  // The wheel lifts the palm: the string rings brighter
  'Muted Guitar': { wheel: moves(['body.damp', -0.5]) },
  // The wheel mutes the head: a darker ring
  Banjo: { wheel: moves(['body.damp', 0.5]) },
  'Future Pluck': { trim: 1, bright: 1, wheel: { open: 1.5 } },
  Pizzicato: { wheel: moves(['body.damp', -0.35]) },
  // The wheel deepens the tremolo
  'Reed Piano': {
    trim: 8.9,
    free: true,
    wheel: {
      routes: [{ from: 'tremolo', to: 'amp.gain', by: -0.3, via: 'wheel' }],
    },
  },
  // The wheel adds the four foot's strings
  Harpsichord: { trim: 1.5, wheel: moves(['four.level', 0.5]) },
  // The wheel pulls the two foot and the mixture
  'Pipe Organ': {
    trim: 11.6,
    free: true,
    wheel: moves(['main.send.p2', 0.3], ['main.send.fifth', 0.3]),
  },
  'Lo-fi Keys': {
    trim: 11.2,
    wheel: {
      routes: [{ from: 'wow', to: 'voice.pitch', by: 0.3, via: 'wheel' }],
    },
  },
  Accordion: { trim: 9.6, free: true, wheel: { open: 1 } },
  'Music Box': { trim: 3.6, wheel: moves(['main.send.partial', 0.3]) },
  Celesta: { trim: 4.7, wheel: moves(['plate.fm', 0.15]) },
  'Steel Drum': { trim: 5.2, free: true, wheel: moves(['pan.fm', 0.2]) },
  'Organ Stab': { free: true, wheel: { open: 1 } },
  'Minor Stab': { trim: 1.1, free: true, wheel: { open: 1.5 } },
  'Ninth Chord': { trim: 4.7, free: true, bright: 1, wheel: { open: 1 } },
  // The wheel opens the mouth: "ah" towards "ee"
  'Aah Choir': { trim: 14, velocity: 0.5, wheel: moves(['mouth.vowel', 2]) },
  // The wheel rounds the "oo" to an "oh"
  'Ooh Choir': {
    trim: 11.3,
    free: true,
    velocity: 0.5,
    wheel: moves(['mouth.vowel', -1]),
  },
  'Vox Chop': { trim: 1.1, bright: 2, wheel: moves(['mouth.shift', 4]) },
}

/**
 * The presets the app ships with, across the categories. The keyboard
 * starts at C4, and a phone's speaker barely plays below 200 Hz, so the
 * basses keep overtones above it. Each voice enters the mix at a quarter,
 * so a chain's sends add up to 2 or so at most, and a sound's chains
 * about as much: a held note's RMS near 0.15.
 *
 * 22 of them were written as the old fixed parameters until 2026-11-12
 * and are rebuilt here as the sounds those converted to (filters that did
 * nothing left out, a cutoff the old keytracking moved rounded). The
 * others use what the old synth had not: more inputs and chains, drives,
 * filters in a row, feedback FM, routes into a chain's sends and the
 * amp's gain. Since 2026-11-12 pads, plucks and keys send to the
 * session's delay and reverb, a few through a chorus of their own: to B
 * and C, the buses the session's first mix has them on (src/state/mix.ts).
 */
export const FACTORY_PRESETS: readonly Preset[] = byCategory([
  // A new patch's sound: a saw into an open lowpass (initSound)
  preset('Init', 'Basic', {
    inputs: { saw: { kind: 'osc', phase: 'Free' } },
    chains: {
      main: { sends: { saw: 1 }, items: { filter: { kind: 'filter' } } },
    },
  }),

  preset('Saw Bass', 'Bass', {
    inputs: {
      saw: { kind: 'osc', octave: -1 },
      sub: { kind: 'osc', wave: 'Square', octave: -2 },
    },
    chains: {
      main: {
        sends: { saw: 1, sub: 0.4 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 340,
            resonance: 0.25,
            keytrack: 0.3,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.25, sustain: 0.15 } },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 4 }],
    amp: { attack: 0.002, decay: 0.4, sustain: 0.8, release: 0.08 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'doubler', detune: 7, time: 0.01, mix: 0.3 },
      widened(1.2, BASS_MONO),
    ],
  }),
  preset('Sub Bass', 'Bass', {
    inputs: {
      sub: { kind: 'osc', wave: 'Sine', octave: -1 },
      // An octave up, so a phone speaker hears the note at all
      body: { kind: 'osc', wave: 'Triangle' },
    },
    chains: { main: { sends: { sub: 1, body: 0.35 } } },
    // Harder notes bring in more of the octave: brighter
    routes: [{ from: 'velocity', to: 'main.send.body', by: 0.3 }],
    amp: { attack: 0.003, decay: 0.2, sustain: 0.9, release: 0.12 },
    voice: { mode: 'Legato', glide: 0.04 },
  }),
  preset('Acid Bass', 'Bass', {
    inputs: { saw: { kind: 'osc', octave: -1 } },
    chains: {
      main: {
        sends: { saw: 1 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 155,
            resonance: 0.78,
            keytrack: 0.5,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.2 } },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 5 },
      // Harder notes open the filter further, like an accent
      { from: 'velocity', to: 'filter.cutoff', by: 1.5 },
    ],
    amp: { attack: 0.002, sustain: 0.85, release: 0.06, velocity: 0.3 },
    voice: { mode: 'Legato', glide: 0.07 },
    // In the middle, its echo off to the sides
    effects: [pingPong(0.18, 0.4), widened(1, BASS_MONO)],
  }),
  preset('FM Bass', 'Bass', {
    inputs: {
      carrier: {
        kind: 'osc',
        wave: 'Sine',
        octave: -1,
        fm: 0.35,
        fmSource: 'modulator',
      },
      // Heard only through the carrier: a 1:1 modulator
      modulator: { kind: 'osc', wave: 'Sine', octave: -1 },
    },
    chains: { main: { sends: { carrier: 1 } } },
    modulators: { env: { kind: 'env', decay: 0.25 } },
    routes: [
      { from: 'env', to: 'carrier.fm', by: 0.4 },
      // Harder notes bark: more FM
      { from: 'velocity', to: 'carrier.fm', by: 0.5 },
    ],
    amp: { attack: 0.002, decay: 0.5, sustain: 0.6, release: 0.1 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'doubler', detune: 5, time: 0.008, mix: 0.3 },
      widened(1.2, BASS_MONO),
    ],
  }),
  preset('Wobble Bass', 'Bass', {
    inputs: {
      saw: { kind: 'osc', octave: -1 },
      detuned: { kind: 'osc', octave: -1, fine: 10 },
    },
    chains: {
      main: {
        level: 0.85,
        sends: { saw: 1, detuned: 0.5 },
        // Its sweep saturated a little, as a wobble's is
        items: {
          filter: { kind: 'filter', cutoff: 260, resonance: 0.42 },
          drive: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: { lfo: { kind: 'lfo', shape: 'Triangle', rate: 3 } },
    routes: [{ from: 'lfo', to: 'filter.cutoff', by: 3 }],
    amp: { attack: 0.003, sustain: 1, release: 0.1 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'chorus', rate: 0.5, depth: 0.4, mix: 0.3 },
      widened(1.15, BASS_MONO),
    ],
  }),
  preset('Reese Bass', 'Bass', {
    // Two saws a little apart, beating, and a slow sweep under them
    inputs: {
      low: { kind: 'osc', octave: -1, fine: -14 },
      high: { kind: 'osc', octave: -1, fine: 14 },
    },
    chains: {
      main: {
        sends: { low: 0.8, high: 0.8 },
        items: {
          filter: { kind: 'filter', cutoff: 650, resonance: 0.2 },
          drive: { kind: 'drive', drive: 0.35 },
        },
      },
    },
    modulators: {
      sweep: { kind: 'lfo', shape: 'Triangle', rate: 0.25, trigger: 'Free' },
    },
    routes: [{ from: 'sweep', to: 'filter.cutoff', by: 1 }],
    amp: { attack: 0.005, sustain: 1, release: 0.15 },
    voice: { mode: 'Legato', glide: 0.05 },
    // Wide over a middle that holds still
    effects: [
      { kind: 'doubler', detune: 10, time: 0.012, mix: 0.35 },
      widened(1.3, BASS_MONO),
    ],
  }),
  preset('Growl Bass', 'Bass', {
    inputs: {
      saw: { kind: 'osc', octave: -1 },
      square: { kind: 'osc', wave: 'Square', octave: -1, width: 0.3 },
    },
    chains: {
      main: {
        sends: { saw: 1, square: 0.5 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 300,
            resonance: 0.45,
            keytrack: 0.4,
          },
          drive: { kind: 'drive', drive: 0.6 },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.3, sustain: 0.2 } },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 4 },
      // Harder notes bite: more drive
      { from: 'velocity', to: 'drive.drive', by: 0.35 },
    ],
    amp: { attack: 0.002, decay: 0.4, sustain: 0.8, release: 0.1 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'doubler', detune: 8, time: 0.01, mix: 0.3 },
      widened(1.2, BASS_MONO),
    ],
  }),

  preset('Saw Lead', 'Lead', {
    inputs: {
      saw: { kind: 'osc' },
      detuned: { kind: 'osc', fine: 12 },
    },
    chains: {
      main: {
        level: 0.9,
        sends: { saw: 1, detuned: 0.6 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 2800,
            resonance: 0.2,
            keytrack: 0.2,
          },
        },
      },
    },
    modulators: {
      filterEnv: { kind: 'env', decay: 0.4, sustain: 0.3 },
      vibrato: { kind: 'lfo', rate: 5.5 },
    },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 1.5 },
      // Vibrato only while the finger slides up or down its key
      { from: 'vibrato', to: 'voice.pitch', by: 0.6, via: 'slide' },
    ],
    amp: { sustain: 0.85, release: 0.25 },
    voice: { mode: 'Legato', glide: 0.08 },
    effects: [
      { kind: 'doubler', detune: 9, time: 0.014, spread: 0.8, mix: 0.3 },
      pingPong(0.2, 0.35),
      widened(1, 150),
    ],
    sends: { c: 0.2 },
  }),
  preset('Fifth Lead', 'Lead', {
    inputs: {
      root: { kind: 'osc' },
      fifth: { kind: 'osc', semi: 7, fine: 6 },
    },
    chains: {
      main: {
        level: 0.8,
        sends: { root: 1, fifth: 0.6 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 3000,
            resonance: 0.15,
            keytrack: 0.3,
          },
          drive: { kind: 'drive', drive: 0.3 },
        },
      },
    },
    modulators: { vibrato: { kind: 'lfo', rate: 5.5, fade: 0.4 } },
    routes: [
      { from: 'vibrato', to: 'voice.pitch', by: 0.25 },
      // Less drive up high, where it would fold back past the top
      { from: 'key', to: 'drive.drive', by: -0.5 },
    ],
    amp: { attack: 0.004, sustain: 0.9, release: 0.2 },
    voice: { mode: 'Legato', glide: 0.06 },
    effects: [
      { kind: 'chorus', rate: 0.4, depth: 0.3, mix: 0.25 },
      widened(1.15, 150),
    ],
    sends: { b: 0.2, c: 0.2 },
  }),
  preset('Scream Lead', 'Lead', {
    // Driven hard first, then a resonant band of it: a vocal edge
    inputs: { saw: { kind: 'osc' } },
    chains: {
      main: {
        sends: { saw: 1 },
        items: {
          drive: { kind: 'drive', drive: 0.8 },
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 1400,
            resonance: 0.7,
            keytrack: 0.5,
          },
          edge: { kind: 'drive', drive: 0.25 },
        },
      },
    },
    modulators: {
      filterEnv: { kind: 'env', attack: 0.05, decay: 0.6, sustain: 0.4 },
      vibrato: { kind: 'lfo', rate: 5, fade: 0.5 },
    },
    routes: [
      { from: 'filterEnv', to: 'band.cutoff', by: 1.5 },
      { from: 'vibrato', to: 'voice.pitch', by: 0.3 },
      // Blown harder, it screams higher
      { from: 'velocity', to: 'band.cutoff', by: 0.6 },
      // Less drive up high, where it would fold back past the top
      { from: 'key', to: 'drive.drive', by: -1 },
      { from: 'key', to: 'edge.drive', by: -0.5 },
    ],
    amp: { attack: 0.005, sustain: 0.9, release: 0.15 },
    voice: { mode: 'Mono', glide: 0.04 },
    // Two takes of it either side, and its fizz past 5 kHz taken down
    effects: [
      { kind: 'doubler', detune: 12, time: 0.018, mix: 0.3 },
      { kind: 'eq', high: -3, highFreq: 5000 },
    ],
    sends: { c: 0.15 },
  }),
  preset('Feedback Lead', 'Lead', {
    inputs: {
      // A sine modulating itself: the more, the nearer a saw it grows
      tone: { kind: 'osc', wave: 'Sine', fm: 0.25, fmSource: 'tone' },
      sub: { kind: 'osc', wave: 'Square', octave: -1, width: 0.4 },
    },
    chains: { main: { sends: { tone: 1, sub: 0.3 } } },
    modulators: { env: { kind: 'env', decay: 0.5, sustain: 0.3 } },
    routes: [
      { from: 'env', to: 'tone.fm', by: 0.35, via: 'velocity' },
      // Slide a finger up its key to brighten the note
      { from: 'slide', to: 'tone.fm', by: 0.3 },
      // Less up high, where its partials would fold back past the top
      { from: 'key', to: 'tone.fm', by: -0.3 },
    ],
    amp: { attack: 0.003, sustain: 0.85, release: 0.2 },
    voice: { mode: 'Legato', glide: 0.05 },
    effects: [
      { kind: 'chorus', rate: 0.6, depth: 0.35, mix: 0.3 },
      pingPong(0.15, 0.3, '1/4'),
    ],
    sends: { c: 0.2 },
  }),

  preset('Warm Pad', 'Pad', {
    inputs: {
      saw: { kind: 'osc' },
      detuned: { kind: 'osc', fine: 9 },
    },
    chains: {
      main: {
        level: 0.38,
        sends: { saw: 0.85, detuned: 0.85 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 900,
            resonance: 0.15,
            keytrack: 0.4,
          },
        },
      },
    },
    modulators: {
      filterEnv: {
        kind: 'env',
        attack: 1.2,
        decay: 2,
        sustain: 0.5,
        release: 2,
      },
      drift: { kind: 'lfo', shape: 'Triangle', rate: 0.2, trigger: 'Free' },
      // Each note's own slow wander across the sides
      wander: { kind: 'lfo', shape: 'Smooth', rate: 0.15, trigger: 'Key' },
    },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 2 },
      { from: 'drift', to: 'filter.cutoff', by: 0.8 },
      spread(0.3),
      { from: 'wander', to: 'amp.pan', by: 0.25 },
    ],
    amp: { attack: 0.8, decay: 1, sustain: 0.9, release: 2.5, velocity: 0.2 },
    effects: [
      { kind: 'chorus', rate: 0.4, depth: 0.5, mix: 0.4 },
      widened(1.1, 150),
    ],
    sends: { c: 0.6 },
  }),
  preset('PWM Pad', 'Pad', {
    inputs: {
      square: { kind: 'osc', wave: 'Square' },
      detuned: { kind: 'osc', wave: 'Square', fine: -7 },
    },
    chains: {
      main: {
        level: 0.3,
        sends: { square: 0.8, detuned: 0.8 },
        items: { filter: { kind: 'filter', cutoff: 2600, keytrack: 0.3 } },
      },
    },
    modulators: {
      pwm: { kind: 'lfo', rate: 0.6, trigger: 'Free' },
      pwm2: { kind: 'lfo', shape: 'Triangle', rate: 0.45, trigger: 'Free' },
      wander: { kind: 'lfo', shape: 'Smooth', rate: 0.15, trigger: 'Key' },
    },
    routes: [
      { from: 'pwm', to: 'square.width', by: 0.3 },
      { from: 'pwm2', to: 'detuned.width', by: 0.3 },
      spread(0.3),
      { from: 'wander', to: 'amp.pan', by: 0.25 },
    ],
    amp: { attack: 0.5, decay: 1, sustain: 0.9, release: 1.8, velocity: 0.2 },
    effects: [
      { kind: 'chorus', rate: 0.3, depth: 0.5, mix: 0.4 },
      widened(1.1, 150),
    ],
    sends: { c: 0.5 },
  }),
  preset('Glass Pad', 'Pad', {
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.12, fmSource: 'modulator' },
      // A 3:1 modulator: 19 semitones up
      modulator: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
    },
    chains: { main: { level: 0.42, sends: { carrier: 1 } } },
    modulators: {
      shimmer: { kind: 'lfo', shape: 'Smooth', rate: 0.15, trigger: 'Free' },
      wander: { kind: 'lfo', shape: 'Smooth', rate: 0.12, trigger: 'Key' },
    },
    routes: [
      { from: 'shimmer', to: 'carrier.fm', by: 0.08 },
      spread(0.3),
      { from: 'wander', to: 'amp.pan', by: 0.3 },
    ],
    amp: { attack: 1, decay: 1.5, sustain: 0.8, release: 3, velocity: 0.2 },
    effects: [
      { kind: 'chorus', rate: 0.2, depth: 0.4, mix: 0.35 },
      widened(1.1, 150),
    ],
    sends: { c: 0.65 },
  }),
  preset('Strings', 'Strings', {
    // Three saws spread apart, one an octave up, as a section is
    inputs: {
      left: { kind: 'osc', fine: -10 },
      middle: { kind: 'osc' },
      right: { kind: 'osc', fine: 10 },
      octave: { kind: 'osc', octave: 1, fine: 4 },
    },
    chains: {
      main: {
        level: 0.46,
        sends: { left: 0.6, middle: 0.6, right: 0.6, octave: 0.3 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 2200,
            resonance: 0.1,
            keytrack: 0.4,
          },
        },
      },
    },
    modulators: {
      ensemble: { kind: 'lfo', rate: 5.5, trigger: 'Free' },
      // Each note a player of its own, somewhere across the section and
      // moving a little (random brightens a note, and is not its place)
      seat: { kind: 'lfo', shape: 'Smooth', rate: 0.1, trigger: 'Key' },
    },
    routes: [
      { from: 'ensemble', to: 'left.pitch', by: 0.12 },
      { from: 'ensemble', to: 'right.pitch', by: -0.12 },
      // Every note a little brighter or darker than the last
      { from: 'random', to: 'filter.cutoff', by: 0.3 },
      { from: 'seat', to: 'amp.pan', by: 0.4 },
    ],
    amp: { attack: 0.6, decay: 1, sustain: 0.9, release: 1.5, velocity: 0.3 },
    effects: [
      { kind: 'chorus', rate: 0.5, depth: 0.4, mix: 0.35 },
      widened(1.1, 150),
    ],
    sends: { c: 0.6 },
  }),
  preset('Choir Pad', 'Vocal', {
    // The vowel "ah": a band for each of its first two formants, fixed
    // whatever the note, the second wandering a little
    inputs: {
      saw: { kind: 'osc' },
      detuned: { kind: 'osc', fine: 8 },
    },
    chains: {
      low: {
        level: 0.34,
        sends: { saw: 0.7, detuned: 0.7 },
        items: {
          first: { kind: 'filter', type: 'BP', cutoff: 750, resonance: 0.5 },
        },
      },
      high: {
        level: 0.24,
        sends: { saw: 0.7, detuned: 0.7 },
        items: {
          second: {
            kind: 'filter',
            type: 'BP',
            cutoff: 1150,
            resonance: 0.5,
          },
        },
      },
    },
    modulators: {
      vowel: { kind: 'lfo', shape: 'Smooth', rate: 0.3, trigger: 'Free' },
      // Each voice a singer of its own, standing somewhere across the choir
      singer: { kind: 'lfo', shape: 'Smooth', rate: 0.1, trigger: 'Key' },
    },
    routes: [
      { from: 'vowel', to: 'second.cutoff', by: 0.3 },
      spread(0.3),
      { from: 'singer', to: 'amp.pan', by: 0.25 },
    ],
    amp: { attack: 0.4, decay: 1, sustain: 0.9, release: 1.5, velocity: 0.2 },
    effects: [
      { kind: 'chorus', rate: 0.35, depth: 0.55, mix: 0.45 },
      widened(1.1, 150),
    ],
    sends: { c: 0.7 },
  }),
  preset('Breath Pad', 'Pad', {
    // A soft pad, and a second chain of noise in a moving band: its breath
    inputs: {
      saw: { kind: 'osc' },
      detuned: { kind: 'osc', fine: -8 },
      air: { kind: 'noise' },
    },
    chains: {
      tone: {
        level: 0.44,
        sends: { saw: 0.8, detuned: 0.8 },
        items: {
          filter: { kind: 'filter', cutoff: 1100, keytrack: 0.4 },
        },
      },
      breath: {
        level: 0.27,
        sends: { air: 0.5 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 2500, resonance: 0.6 },
        },
      },
    },
    modulators: {
      swell: { kind: 'env', attack: 1.5, decay: 2, sustain: 0.6, release: 2 },
      gust: { kind: 'lfo', shape: 'Smooth', rate: 0.4, trigger: 'Free' },
      wander: { kind: 'lfo', shape: 'Smooth', rate: 0.15, trigger: 'Key' },
    },
    routes: [
      { from: 'swell', to: 'filter.cutoff', by: 1.5 },
      { from: 'gust', to: 'band.cutoff', by: 1 },
      spread(0.3),
      { from: 'wander', to: 'amp.pan', by: 0.25 },
    ],
    amp: { attack: 0.9, decay: 1, sustain: 0.9, release: 2, velocity: 0.2 },
    effects: [
      { kind: 'chorus', rate: 0.25, depth: 0.5, mix: 0.4 },
      widened(1.1, 150),
    ],
    sends: { c: 0.6 },
  }),

  preset('Soft Pluck', 'Pluck', {
    inputs: { saw: { kind: 'osc' } },
    chains: {
      main: {
        sends: { saw: 1 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 300,
            resonance: 0.3,
            keytrack: 0.5,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.35 } },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 5.5 },
      { from: 'velocity', to: 'filter.cutoff', by: 1 },
      spread(0.35),
    ],
    amp: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.5, velocity: 0.7 },
    effects: [pingPong(0.25, 0.4), widened(1, 150)],
    sends: { c: 0.4 },
  }),
  preset('Square Pluck', 'Pluck', {
    inputs: {
      square: { kind: 'osc', wave: 'Square', width: 0.3 },
      saw: { kind: 'osc', octave: 1 },
    },
    chains: {
      main: {
        sends: { square: 1, saw: 0.3 },
        items: { filter: { kind: 'filter', cutoff: 500, keytrack: 0.6 } },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.18 } },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 4.5 }, spread(0.3)],
    amp: { attack: 0.001, decay: 0.35, sustain: 0, velocity: 0.6 },
    effects: [pingPong(0.2, 0.3)],
    sends: { c: 0.25 },
  }),
  preset('Kalimba', 'Bell', {
    inputs: {
      tine: { kind: 'osc', wave: 'Sine', fm: 0.05, fmSource: 'strike' },
      // Near 3:1, struck bright and gone at once
      strike: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
    },
    chains: { main: { sends: { tine: 1 } } },
    modulators: { strikeEnv: { kind: 'env', attack: 0.001, decay: 0.07 } },
    routes: [
      { from: 'strikeEnv', to: 'tine.fm', by: 0.45 },
      // Plucked harder, its tine rings brighter
      { from: 'velocity', to: 'tine.fm', by: 0.08 },
      // The tines laid out across, each struck a little off its place
      keyPan(1),
      spread(0.12),
    ],
    amp: { attack: 0.001, decay: 0.9, sustain: 0, release: 0.4, velocity: 0.6 },
    sends: { c: 0.4 },
  }),
  preset('Marimba', 'Bell', {
    // The bar's fourth harmonic rings only for the strike: a route into
    // its send
    inputs: {
      bar: { kind: 'osc', wave: 'Sine' },
      overtone: { kind: 'osc', wave: 'Sine', octave: 2 },
    },
    chains: { main: { sends: { bar: 1, overtone: 0.05 } } },
    modulators: { strike: { kind: 'env', attack: 0.001, decay: 0.08 } },
    routes: [
      { from: 'strike', to: 'main.send.overtone', by: 0.5 },
      // A harder mallet: more of it
      { from: 'velocity', to: 'main.send.overtone', by: 0.3 },
      // The bars laid out across, the low ones on the left
      keyPan(1),
    ],
    amp: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.3, velocity: 0.6 },
    sends: { c: 0.3 },
  }),

  preset('E-Piano', 'Keys', {
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.12, fmSource: 'modulator' },
      // A sine at the same pitch: a 1:1 modulator
      modulator: { kind: 'osc', wave: 'Sine' },
      // The tine's ding as the hammer strikes it: a sine a little over
      // seven times up, heard only for the strike, and the more the harder
      ding: { kind: 'osc', wave: 'Sine', octave: 2, semi: 10 },
    },
    chains: { main: { sends: { carrier: 1, ding: 0.01 } } },
    modulators: {
      tineEnv: { kind: 'env', decay: 0.9 },
      strike: { kind: 'env', attack: 0.001, decay: 0.1 },
      // A suitcase's tremolo, the sound swung from side to side
      tremolo: { kind: 'lfo', rate: 3.5, trigger: 'Free' },
    },
    routes: [
      // Harder notes ring brighter at first
      { from: 'tineEnv', to: 'carrier.fm', by: 0.35, via: 'velocity' },
      { from: 'strike', to: 'main.send.ding', by: 0.25, via: 'velocity' },
      { from: 'tremolo', to: 'amp.pan', by: 0.5 },
    ],
    amp: {
      attack: 0.002,
      decay: 2,
      sustain: 0.15,
      release: 0.5,
      velocity: 0.6,
    },
    effects: [
      { kind: 'chorus', rate: 0.8, depth: 0.4, mix: 0.35 },
      widened(1, 120),
    ],
    sends: { c: 0.2 },
  }),
  preset('FM Bell', 'Bell', {
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.2, fmSource: 'modulator' },
      // 22 semitones up, a 3.56:1 modulator: inharmonic, like a bell
      modulator: { kind: 'osc', wave: 'Sine', octave: 2, semi: -2 },
    },
    chains: { main: { sends: { carrier: 1 } } },
    modulators: { env: { kind: 'env', decay: 1.5 } },
    routes: [
      { from: 'env', to: 'carrier.fm', by: 0.35 },
      // Struck harder, it clangs brighter
      { from: 'velocity', to: 'carrier.fm', by: 0.2 },
      // Purer up high, as an FM bell's level scaling has it: its
      // sidebands kept under the top
      { from: 'key', to: 'carrier.fm', by: -0.6 },
      // Hung in a row, the low ones on the left, each swinging a little
      keyPan(0.8),
      spread(0.15),
    ],
    amp: { attack: 0.001, decay: 3, sustain: 0, release: 2 },
    // Its clang past 6 kHz a little down, where a phone's speaker shrills
    effects: [{ kind: 'eq', high: -3, highFreq: 6000 }],
    sends: { c: 0.6 },
  }),
  preset('Organ', 'Keys', {
    // Drawbars: the 8', the 4', the 2 2/3' (a twelfth up) and the 2'
    inputs: {
      sine: { kind: 'osc', wave: 'Sine' },
      octave: { kind: 'osc', wave: 'Sine', octave: 1 },
      twelfth: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
      fifteenth: { kind: 'osc', wave: 'Sine', octave: 2 },
    },
    chains: {
      main: {
        level: 0.42,
        sends: { sine: 1, octave: 0.6, twelfth: 0.3, fifteenth: 0.25 },
      },
    },
    // A rotating speaker's: the pitch, the side and the level moved
    // together as its horn turns
    // Its chorale, slow; the wheel spins it up to the tremolo
    modulators: { rotor: { kind: 'lfo', rate: 0.8, trigger: 'Free' } },
    routes: [
      { from: 'rotor', to: 'voice.pitch', by: 0.08 },
      { from: 'rotor', to: 'amp.pan', by: 0.3 },
      { from: 'rotor', to: 'amp.gain', by: -0.1 },
    ],
    amp: { attack: 0.004, decay: 0.1, sustain: 1, release: 0.06, velocity: 0 },
    effects: [
      { kind: 'chorus', rate: 0.9, depth: 0.3, mix: 0.35 },
      widened(1, 150),
    ],
    sends: { c: 0.15 },
  }),
  preset('Clav', 'Keys', {
    // A thin pulse through two filters in a row: lows cut, then a
    // plucked lowpass
    inputs: { pulse: { kind: 'osc', wave: 'Square', width: 0.2 } },
    chains: {
      main: {
        sends: { pulse: 1 },
        items: {
          lows: { kind: 'filter', type: 'HP', cutoff: 250 },
          filter: {
            kind: 'filter',
            cutoff: 1800,
            resonance: 0.3,
            keytrack: 0.5,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.15 } },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 1.6 },
      { from: 'velocity', to: 'filter.cutoff', by: 1 },
      keyPan(0.6),
    ],
    // Its string rings on under the snap while the key is held
    amp: {
      attack: 0.001,
      decay: 0.7,
      sustain: 0.4,
      release: 0.08,
      velocity: 0.6,
    },
    effects: [
      { kind: 'doubler', detune: 6, time: 0.008, mix: 0.25 },
      widened(1.2, 150),
    ],
    sends: { c: 0.15 },
  }),
  preset('Vibes', 'Bell', {
    inputs: {
      bar: { kind: 'osc', wave: 'Sine' },
      overtone: { kind: 'osc', wave: 'Sine', octave: 2 },
    },
    chains: { main: { sends: { bar: 1, overtone: 0.15 } } },
    // The vibraphone's fans: a tremolo on the voice's gain
    // Its motor, slow; the wheel speeds it
    modulators: { fans: { kind: 'lfo', rate: 3.5, trigger: 'Free' } },
    routes: [
      { from: 'fans', to: 'amp.gain', by: -0.35 },
      // A harder mallet: more of the bar's fourth harmonic
      { from: 'velocity', to: 'main.send.overtone', by: 0.2 },
      // The bars laid out across, the fans' pulse swaying a little
      keyPan(0.8),
      { from: 'fans', to: 'amp.pan', by: 0.15 },
    ],
    amp: { attack: 0.001, decay: 2.5, sustain: 0, release: 0.8, velocity: 0.6 },
    sends: { c: 0.5 },
  }),

  preset('Kick', 'Drums', {
    // A 2A03's triangle (32 steps, off its DC) 27 semitones under the key
    // (A1 at C4), struck 30 higher and falling to it in about a tenth of a
    // second, then held; dark noise at the strike
    inputs: {
      body: { kind: 'chip', wave: 'Triangle', octave: -2, semi: -3, dc: 0 },
      noise: { kind: 'noise' },
    },
    chains: {
      main: { sends: { body: 0.86 } },
      click: {
        level: 0,
        sends: { noise: 0.8 },
        items: { filter: { kind: 'filter', cutoff: 2200 } },
      },
    },
    modulators: {
      drop: { kind: 'env', attack: 0.001, decay: 0.3 },
      strike: { kind: 'env', attack: 0.001, decay: 0.25 },
    },
    routes: [
      { from: 'drop', to: 'voice.pitch', by: 30 },
      { from: 'strike', to: 'click.level', by: 1 },
    ],
    amp: { attack: 0.001, decay: 2, sustain: 0, release: 0.03, velocity: 0.8 },
  }),
  preset('Snare', 'Drums', {
    // Mostly a 2A03's triangle (32 steps, off its DC) near G3, falling a
    // little, with dark noise under it
    inputs: {
      body: { kind: 'chip', wave: 'Triangle', semi: -5, dc: 0 },
      noise: { kind: 'noise' },
    },
    chains: {
      tone: { sends: { body: 0.9 } },
      main: {
        sends: { noise: 0.8 },
        items: { filter: { kind: 'filter', cutoff: 2800 } },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.4 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 2 }],
    amp: {
      attack: 0.001,
      decay: 0.8,
      sustain: 0,
      release: 0.05,
      velocity: 0.8,
    },
  }),
  preset('Closed Hat', 'Drums', {
    // Two squares two octaves up, ring-modulated: metal, with noise
    inputs: {
      square: { kind: 'osc', wave: 'Square', octave: 2 },
      square2: { kind: 'osc', wave: 'Square', octave: 2, semi: 6, fine: 35 },
      noise: { kind: 'noise' },
      metal: { kind: 'ring', a: 'square', b: 'square2' },
    },
    chains: {
      main: {
        sends: { noise: 0.66, metal: 0.55 },
        items: {
          filter: { kind: 'filter', type: 'HP', cutoff: 7000, resonance: 0.2 },
        },
      },
    },
    amp: {
      attack: 0.001,
      decay: 0.08,
      sustain: 0,
      release: 0.06,
      velocity: 0.6,
      pan: -0.3,
    },
  }),
  preset('Open Hat', 'Drums', {
    inputs: {
      square: { kind: 'osc', wave: 'Square', octave: 2 },
      square2: { kind: 'osc', wave: 'Square', octave: 2, semi: 6, fine: 35 },
      noise: { kind: 'noise' },
      metal: { kind: 'ring', a: 'square', b: 'square2' },
    },
    chains: {
      main: {
        sends: { noise: 0.45, metal: 0.38 },
        items: {
          filter: { kind: 'filter', type: 'HP', cutoff: 6500, resonance: 0.2 },
        },
      },
    },
    amp: {
      attack: 0.001,
      decay: 0.45,
      sustain: 0,
      release: 0.35,
      velocity: 0.6,
      pan: -0.3,
    },
  }),
  preset('Tom', 'Drums', {
    inputs: {
      head: { kind: 'osc', wave: 'Sine' },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { head: 1, noise: 0.15 },
        items: { filter: { kind: 'filter', cutoff: 3000 } },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.12 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 9 }],
    amp: {
      attack: 0.001,
      decay: 0.35,
      sustain: 0,
      release: 0.3,
      velocity: 0.6,
      pan: 0.1,
    },
  }),
  preset('Clap', 'Drums', {
    // Noise in a band, and its first moments torn into bursts: a saw
    // LFO on the gain, faded out by an envelope
    inputs: { noise: { kind: 'noise' } },
    chains: {
      main: {
        sends: { noise: 1 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 1200, resonance: 0.3 },
          crack: { kind: 'drive', drive: 0.5 },
        },
      },
    },
    modulators: {
      bursts: { kind: 'lfo', shape: 'Saw', rate: 50 },
      flutter: { kind: 'env', attack: 0.001, decay: 0.05 },
    },
    routes: [
      { from: 'bursts', to: 'amp.gain', by: -0.9, via: 'flutter' },
      // Each clap from hands a little apart
      spread(0.12),
    ],
    amp: {
      attack: 0.001,
      decay: 0.3,
      sustain: 0,
      release: 0.2,
      velocity: 0.6,
    },
    sends: { c: 0.4 },
  }),
  preset('Cowbell', 'Drums', {
    // Two squares about 2:3 apart, in a band: the old drum machines' bell
    inputs: {
      low: { kind: 'osc', wave: 'Square', octave: 1 },
      high: { kind: 'osc', wave: 'Square', octave: 1, semi: 7, fine: -20 },
    },
    chains: {
      main: {
        sends: { low: 0.31, high: 0.31 },
        items: {
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 800,
            resonance: 0.35,
            keytrack: 1,
          },
        },
      },
    },
    amp: {
      attack: 0.001,
      decay: 0.3,
      sustain: 0,
      release: 0.2,
      velocity: 0.6,
      pan: 0.35,
    },
  }),

  preset('Low Tom', 'Drums', {
    inputs: {
      head: { kind: 'osc', wave: 'Sine', semi: -5 },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { head: 1, noise: 0.15 },
        items: { filter: { kind: 'filter', cutoff: 2500 } },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.14 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 9 }],
    amp: {
      attack: 0.001,
      decay: 0.45,
      sustain: 0,
      release: 0.35,
      velocity: 0.6,
      pan: 0.4,
    },
  }),
  preset('High Tom', 'Drums', {
    inputs: {
      head: { kind: 'osc', wave: 'Sine', semi: 5 },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { head: 1, noise: 0.15 },
        items: { filter: { kind: 'filter', cutoff: 3500 } },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.1 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 9 }],
    amp: {
      attack: 0.001,
      decay: 0.36,
      sustain: 0,
      release: 0.28,
      velocity: 0.6,
      pan: -0.2,
    },
  }),
  preset('Rim', 'Drums', {
    // A high click and a burst of noise in a band: the stick on the rim
    inputs: {
      click: { kind: 'osc', wave: 'Triangle', octave: 1, semi: 5 },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { click: 1, noise: 0.85 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 1800, resonance: 0.3 },
          // Its crack: the click's quiet body brought up to its peak
          crack: { kind: 'drive', drive: 0.4 },
        },
      },
    },
    amp: {
      attack: 0.001,
      decay: 0.04,
      sustain: 0,
      release: 0.03,
      velocity: 0.6,
      pan: -0.1,
    },
  }),
  preset('Shaker', 'Drums', {
    // Noise up high, swelling in for a moment, as the beads hit together
    inputs: { noise: { kind: 'noise' } },
    chains: {
      main: {
        sends: { noise: 0.56 },
        items: {
          filter: { kind: 'filter', type: 'HP', cutoff: 5000, resonance: 0.1 },
        },
      },
    },
    // Shaken back and forth: each shake a little off the last
    routes: [spread(0.12)],
    amp: {
      attack: 0.012,
      decay: 0.09,
      sustain: 0,
      release: 0.06,
      velocity: 0.6,
      pan: -0.45,
    },
  }),
  preset('Crash', 'Drums', {
    // The hats' metal and noise, a little lower, ringing long
    inputs: {
      square: { kind: 'osc', wave: 'Square', octave: 2 },
      square2: { kind: 'osc', wave: 'Square', octave: 2, semi: 3, fine: 20 },
      noise: { kind: 'noise' },
      metal: { kind: 'ring', a: 'square', b: 'square2' },
    },
    chains: {
      main: {
        sends: { noise: 0.32, metal: 0.19 },
        items: {
          filter: { kind: 'filter', type: 'HP', cutoff: 4500, resonance: 0.1 },
        },
      },
    },
    amp: {
      attack: 0.001,
      decay: 1.6,
      sustain: 0,
      release: 1.2,
      velocity: 0.6,
      pan: 0.4,
    },
    sends: { c: 0.3 },
  }),
  preset('Boom', 'Drums', {
    // A sine, falling only an octave and ringing on, a little driven: a
    // long, low kick
    inputs: { sine: { kind: 'osc', wave: 'Sine', octave: -1 } },
    chains: {
      main: {
        sends: { sine: 0.45 },
        items: { drive: { kind: 'drive', drive: 0.2 } },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.05 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 12 }],
    amp: {
      attack: 0.001,
      decay: 1.2,
      sustain: 0,
      release: 0.8,
      velocity: 0.5,
    },
  }),
  preset('Conga', 'Drums', {
    inputs: {
      head: { kind: 'osc', wave: 'Sine', semi: 7 },
      slap: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { head: 1, slap: 0.1 },
        items: { filter: { kind: 'filter', cutoff: 4000 } },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.03 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 5 }],
    amp: {
      attack: 0.001,
      decay: 0.22,
      sustain: 0,
      release: 0.18,
      velocity: 0.6,
      pan: 0.3,
    },
  }),
  preset('Clave', 'Drums', {
    // A triangle high up, gone at once: two sticks of hard wood
    inputs: { wood: { kind: 'osc', wave: 'Triangle', octave: 1, semi: 7 } },
    chains: {
      main: {
        sends: { wood: 1 },
        items: { filter: { kind: 'filter', cutoff: 8000 } },
      },
    },
    amp: {
      attack: 0.001,
      decay: 0.09,
      sustain: 0,
      release: 0.06,
      velocity: 0.6,
      pan: -0.4,
    },
  }),

  preset('Blips', 'FX', {
    inputs: { square: { kind: 'osc', wave: 'Square' } },
    chains: {
      main: {
        sends: { square: 1 },
        items: { filter: { kind: 'filter', cutoff: 2500, resonance: 0.4 } },
      },
    },
    modulators: { steps: { kind: 'lfo', shape: 'S&H', rate: 8 } },
    routes: [
      // A random note within an octave up, eight times a second, each
      // somewhere else across the sides
      { from: 'steps', to: 'voice.pitch', by: 12 },
      { from: 'steps', to: 'amp.pan', by: 0.6 },
    ],
    effects: [pingPong(0.3, 0.45)],
    sends: { c: 0.2 },
  }),
  preset('Zap', 'FX', {
    // A saw and a square an octave under it, falling 30 semitones
    inputs: {
      saw: { kind: 'osc' },
      square: { kind: 'osc', wave: 'Square', octave: -1 },
    },
    chains: { main: { sends: { saw: 1, square: 0.6 } } },
    modulators: { drop: { kind: 'env', decay: 0.2 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 30 }, spread(0.5)],
    amp: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.15 },
    sends: { c: 0.2 },
  }),
  preset('Riser', 'FX', {
    // Held, noise sweeps up a resonant band and a saw climbs an octave
    inputs: {
      air: { kind: 'noise' },
      saw: { kind: 'osc' },
    },
    chains: {
      sweep: {
        level: 0.7,
        sends: { air: 0.8 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 300, resonance: 0.6 },
        },
      },
      climb: {
        level: 0.35,
        sends: { saw: 0.7 },
        items: { filter: { kind: 'filter', cutoff: 800, keytrack: 0.5 } },
      },
    },
    modulators: {
      rise: { kind: 'env', attack: 4, sustain: 1, release: 1 },
      // Circling the listener, faster as it climbs
      swirl: { kind: 'lfo', rate: 0.3, trigger: 'Free' },
    },
    routes: [
      { from: 'rise', to: 'band.cutoff', by: 5 },
      { from: 'rise', to: 'saw.pitch', by: 12 },
      { from: 'rise', to: 'filter.cutoff', by: 3 },
      { from: 'swirl', to: 'amp.pan', by: 0.6 },
      { from: 'rise', to: 'swirl.rate', by: 2.5 },
    ],
    amp: { attack: 0.5, sustain: 1, release: 1 },
    effects: [
      { kind: 'chorus', rate: 0.3, depth: 0.6, mix: 0.4 },
      widened(1.15, 150),
    ],
    sends: { c: 0.7 },
  }),
  preset('Wind', 'Atmos', {
    // Noise in two resonant bands, each blown about by a gust of its own
    inputs: { air: { kind: 'noise' } },
    chains: {
      low: {
        level: 0.65,
        sends: { air: 1 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 600, resonance: 0.8 },
        },
      },
      high: {
        level: 0.52,
        sends: { air: 1 },
        items: {
          whistle: {
            kind: 'filter',
            type: 'BP',
            cutoff: 1500,
            resonance: 0.85,
          },
        },
      },
    },
    modulators: {
      gust: { kind: 'lfo', shape: 'Smooth', rate: 0.3, trigger: 'Free' },
      gust2: { kind: 'lfo', shape: 'Smooth', rate: 0.45, trigger: 'Free' },
      // A slower one moves how fast the first gusts come
      weather: { kind: 'lfo', shape: 'Smooth', rate: 0.07, trigger: 'Free' },
    },
    routes: [
      { from: 'gust', to: 'band.cutoff', by: 1.5 },
      { from: 'gust2', to: 'whistle.cutoff', by: 1 },
      { from: 'weather', to: 'gust.rate', by: 1.5 },
      // Blown from side to side
      { from: 'gust2', to: 'amp.pan', by: 0.5 },
    ],
    amp: { attack: 0.8, sustain: 1, release: 1.5, velocity: 0.2 },
    // The chorus's two sides two airs apart: the noise wide, not one
    effects: [
      { kind: 'chorus', rate: 0.15, depth: 0.8, mix: 0.5 },
      widened(1.15, 150),
    ],
    sends: { c: 0.6 },
  }),
  preset('Siren', 'FX', {
    inputs: { square: { kind: 'osc', wave: 'Square', width: 0.35 } },
    chains: {
      main: {
        sends: { square: 0.8 },
        items: { filter: { kind: 'filter', cutoff: 2500, keytrack: 0.5 } },
      },
    },
    modulators: {
      wail: { kind: 'lfo', shape: 'Triangle', rate: 0.5, trigger: 'Key' },
    },
    routes: [
      { from: 'wail', to: 'voice.pitch', by: 7 },
      // Swinging past as it wails
      { from: 'wail', to: 'amp.pan', by: 0.4 },
    ],
    amp: { attack: 0.02, sustain: 1, release: 0.3 },
    voice: { mode: 'Mono' },
    sends: { c: 0.25 },
  }),

  // An analog poly's (analog, above): brass, strings, pads, keys and
  // plucks played as chords, a poly mod bell, then the leads and basses
  preset(
    'Poly Brass',
    'Brass',
    analog({
      // Two saws a few cents apart, the filter opening a little after the
      // amp, as a section's breath does, and closing some as it holds
      inputs: { saw1: { kind: 'osc' }, saw2: { kind: 'osc', fine: 6 } },
      mix: { saw1: 0.44, saw2: 0.44 },
      lp: {
        cutoff: 720,
        resonance: 0.12,
        keytrack: 0.5,
        env: 3.2,
        velocity: 0.8,
      },
      hp: 110,
      filterEnv: { attack: 0.07, decay: 0.9, sustain: 0.45, release: 0.35 },
      slop: { saw1: 3, saw2: -3 },
      spread: 0.3,
      amp: {
        attack: 0.02,
        decay: 0.4,
        sustain: 0.9,
        release: 0.3,
        velocity: 0.4,
      },
      effects: [
        { kind: 'chorus', rate: 0.3, depth: 0.3, mix: 0.25 },
        widened(1.2, 140),
      ],
      sends: { c: 0.35 },
    })
  ),
  preset(
    'Brass Stab',
    'Brass',
    analog({
      // A saw and a pulse, the filter thrown open and shut at once
      inputs: {
        saw: { kind: 'osc' },
        pulse: { kind: 'osc', wave: 'Square', width: 0.42, fine: -5 },
      },
      mix: { saw: 0.8, pulse: 0.6 },
      lp: { cutoff: 490, resonance: 0.2, keytrack: 0.5, env: 4, velocity: 1 },
      hp: 160,
      filterEnv: { attack: 0.01, decay: 0.28, sustain: 0.18, release: 0.2 },
      slop: { saw: 3, pulse: -3 },
      spread: 0.35,
      amp: {
        attack: 0.008,
        decay: 0.35,
        sustain: 0.6,
        release: 0.18,
        velocity: 0.5,
      },
      effects: [
        { kind: 'chorus', rate: 0.4, depth: 0.3, mix: 0.2 },
        widened(1.2, 140),
      ],
      sends: { b: 0.2, c: 0.3 },
    })
  ),
  preset(
    'Poly Strings',
    'Strings',
    analog({
      // Two saws apart, the lows thinned and the top left open, slow to
      // speak and to leave, a vibrato setting in, through an ensemble
      inputs: { saw1: { kind: 'osc' }, saw2: { kind: 'osc', fine: 9 } },
      mix: { saw1: 0.45, saw2: 0.45 },
      lp: { cutoff: 3200, resonance: 0.1, keytrack: 0.6, env: 0.6 },
      hp: 280,
      filterEnv: { attack: 0.5, decay: 1.5, sustain: 0.6, release: 1.2 },
      slop: { saw1: 4, saw2: -4 },
      spread: 0.45,
      modulators: {
        vibrato: { kind: 'lfo', shape: 'Triangle', rate: 5, fade: 0.8 },
      },
      routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.08 }],
      amp: {
        attack: 0.35,
        decay: 1,
        sustain: 0.95,
        release: 1.2,
        velocity: 0.3,
      },
      effects: [
        { kind: 'chorus', rate: 0.5, depth: 0.6, mix: 0.45 },
        widened(1.1, 150),
      ],
      sends: { c: 0.5 },
    })
  ),
  preset(
    'Velvet Pad',
    'Pad',
    analog({
      // A saw and a pulse whose width wanders, the sub under them,
      // opening slowly and a little darker again as it holds, swept
      // slowly for every voice together
      inputs: {
        saw: { kind: 'osc' },
        pulse: { kind: 'osc', wave: 'Square', width: 0.35, fine: 7 },
        sub: { kind: 'osc', wave: 'Square', octave: -1 },
      },
      mix: { saw: 0.27, pulse: 0.22, sub: 0.065 },
      lp: { cutoff: 860, resonance: 0.2, keytrack: 0.4, env: 2 },
      hp: 80,
      filterEnv: { attack: 1.4, decay: 2.5, sustain: 0.55, release: 2 },
      slop: { saw: 3, pulse: -3, sub: 3 },
      spread: 0.4,
      modulators: {
        pwm: { kind: 'lfo', shape: 'Triangle', rate: 0.4, trigger: 'Free' },
        sweep: { kind: 'lfo', rate: 0.12, trigger: 'Free' },
      },
      routes: [
        { from: 'pwm', to: 'pulse.width', by: 0.25 },
        { from: 'sweep', to: 'lp1.cutoff', by: 0.4 },
        { from: 'sweep', to: 'lp2.cutoff', by: 0.4 },
      ],
      amp: { attack: 0.9, decay: 1.5, sustain: 0.9, release: 2, velocity: 0.2 },
      effects: [
        { kind: 'chorus', rate: 0.25, depth: 0.45, mix: 0.35 },
        widened(1.1, 170),
      ],
      sends: { c: 0.6 },
    })
  ),
  preset(
    'Hollow Pulse',
    'Pad',
    analog({
      // Two narrow pulses whose widths wander apart, their lows taken
      // away: hollow and airy
      inputs: {
        pulse1: { kind: 'osc', wave: 'Square', width: 0.25 },
        pulse2: { kind: 'osc', wave: 'Square', width: 0.25, fine: -8 },
      },
      mix: { pulse1: 0.45, pulse2: 0.45 },
      lp: { cutoff: 2400, keytrack: 0.4, env: 0.8 },
      hp: 380,
      filterEnv: { attack: 0.6, decay: 2, sustain: 0.5, release: 1.5 },
      slop: { pulse1: 3, pulse2: -3 },
      spread: 0.45,
      modulators: {
        pwm1: { kind: 'lfo', shape: 'Triangle', rate: 0.33, trigger: 'Free' },
        pwm2: { kind: 'lfo', shape: 'Triangle', rate: 0.47, trigger: 'Free' },
      },
      routes: [
        { from: 'pwm1', to: 'pulse1.width', by: 0.15 },
        { from: 'pwm2', to: 'pulse2.width', by: 0.15 },
      ],
      amp: { attack: 0.5, decay: 1, sustain: 0.9, release: 1.6, velocity: 0.2 },
      effects: [
        { kind: 'chorus', rate: 0.3, depth: 0.4, mix: 0.3 },
        widened(1.1, 150),
      ],
      sends: { b: 0.15, c: 0.55 },
    })
  ),
  preset(
    'Poly Sweep',
    'Pad',
    analog({
      // A ringing lowpass swept slowly over two saws, every voice's
      // together
      inputs: { saw1: { kind: 'osc' }, saw2: { kind: 'osc', fine: -7 } },
      mix: { saw1: 0.26, saw2: 0.26 },
      lp: { cutoff: 800, resonance: 0.6, keytrack: 0.3, env: 1 },
      filterEnv: { attack: 1, decay: 3, sustain: 0.3, release: 2 },
      slop: { saw1: 3, saw2: -3 },
      spread: 0.4,
      modulators: {
        sweep: { kind: 'lfo', shape: 'Triangle', rate: 0.07, trigger: 'Free' },
      },
      routes: [
        { from: 'sweep', to: 'lp1.cutoff', by: 1.8 },
        { from: 'sweep', to: 'lp2.cutoff', by: 1.8 },
      ],
      amp: { attack: 0.6, decay: 1, sustain: 0.9, release: 2.2, velocity: 0.2 },
      effects: [
        { kind: 'chorus', rate: 0.25, depth: 0.45, mix: 0.35 },
        widened(1.1, 150),
      ],
      sends: { b: 0.25, c: 0.6 },
    })
  ),
  preset(
    'Poly Keys',
    'Keys',
    analog({
      // A pulse and a saw over the sub, struck: the filter falling from
      // as far as a hard note opens it, the note dying slowly as it holds
      inputs: {
        pulse: { kind: 'osc', wave: 'Square', width: 0.35 },
        saw: { kind: 'osc', fine: 4 },
        sub: { kind: 'osc', wave: 'Square', octave: -1 },
      },
      mix: { pulse: 0.65, saw: 0.55, sub: 0.18 },
      lp: { cutoff: 650, resonance: 0.1, keytrack: 0.6, env: 3, velocity: 1.2 },
      hp: 90,
      filterEnv: { attack: 0.001, decay: 0.7, sustain: 0.2, release: 0.4 },
      slop: { pulse: 2, saw: -2, sub: 2 },
      spread: 0.3,
      routes: [keyPan(0.6)],
      amp: {
        attack: 0.002,
        decay: 1.4,
        sustain: 0.5,
        release: 0.35,
        velocity: 0.6,
      },
      effects: [
        { kind: 'chorus', rate: 0.4, depth: 0.35, mix: 0.25 },
        widened(1.15, 140),
      ],
      sends: { b: 0.15, c: 0.3 },
    })
  ),
  preset(
    'Poly Pluck',
    'Pluck',
    analog({
      // A saw and a square, the filter's snap and a little ring, echoed
      inputs: {
        saw: { kind: 'osc' },
        square: { kind: 'osc', wave: 'Square', fine: 7 },
      },
      mix: { saw: 1, square: 0.7 },
      lp: { cutoff: 300, resonance: 0.3, keytrack: 0.6, env: 4, velocity: 1 },
      hp: 140,
      filterEnv: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
      slop: { saw: 2, square: -2 },
      spread: 0.4,
      amp: {
        attack: 0.001,
        decay: 1.3,
        sustain: 0,
        release: 0.3,
        velocity: 0.6,
      },
      effects: [pingPong(0.22, 0.35)],
      sends: { c: 0.25 },
    })
  ),
  preset(
    'Poly Mod Bell',
    'Bell',
    analog({
      // Poly mod: the second oscillator, a sine at no whole ratio to the
      // first, moves its phase as far as the filter envelope (and how
      // hard the note) says, a clang falling into a bell's ring
      inputs: {
        tri: { kind: 'osc', wave: 'Triangle', fm: 0.05, fmSource: 'sine' },
        sine: { kind: 'osc', wave: 'Sine', octave: 1, semi: 5 },
      },
      mix: { tri: 0.9, sine: 0.12 },
      lp: { cutoff: 2800, keytrack: 0.6, env: 1.2, velocity: 0.6 },
      filterEnv: { attack: 0.001, decay: 1.6, sustain: 0, release: 1 },
      slop: { tri: 1.5, sine: -1.5 },
      spread: 0.35,
      routes: [
        { from: 'filterEnv', to: 'tri.fm', by: 0.4, via: 'velocity' },
        // Less up high, where its sidebands would fold back past the top
        { from: 'key', to: 'tri.fm', by: -0.3 },
        keyPan(0.6),
      ],
      amp: {
        attack: 0.001,
        decay: 2.6,
        sustain: 0,
        release: 1.4,
        velocity: 0.5,
      },
      effects: [{ kind: 'chorus', rate: 0.5, depth: 0.25, mix: 0.2 }],
      sends: { b: 0.2, c: 0.55 },
    })
  ),
  preset(
    'Poly Mod Lead',
    'Lead',
    analog({
      // Poly mod in a lead: the filter envelope sweeps the FM a sine an
      // octave up gives a saw, a sync's tear as each note starts settling
      // into the saw; the wheel brings in a vibrato
      inputs: {
        saw: { kind: 'osc', fm: 0.08, fmSource: 'sine' },
        sine: { kind: 'osc', wave: 'Sine', octave: 1 },
        sub: { kind: 'osc', wave: 'Square', octave: -1 },
      },
      mix: { saw: 0.9, sine: 0.1, sub: 0.3 },
      lp: {
        cutoff: 900,
        resonance: 0.2,
        keytrack: 0.5,
        env: 2.5,
        velocity: 0.6,
      },
      filterEnv: { attack: 0.002, decay: 0.5, sustain: 0.35, release: 0.3 },
      slop: { saw: 2, sine: -2, sub: 2 },
      modulators: { vibrato: { kind: 'lfo', rate: 5.5, fade: 0.4 } },
      routes: [
        { from: 'filterEnv', to: 'saw.fm', by: 0.5 },
        // Less up high, where its sidebands would fold back past the top
        { from: 'key', to: 'saw.fm', by: -0.4 },
        { from: 'vibrato', to: 'voice.pitch', by: 0.35, via: 'wheel' },
      ],
      amp: { attack: 0.003, decay: 0.3, sustain: 0.9, release: 0.25 },
      voice: { mode: 'Legato', glide: 0.05 },
      effects: [
        { kind: 'doubler', detune: 7, time: 0.012, mix: 0.3 },
        widened(1.2, 150),
      ],
      sends: { b: 0.3, c: 0.2 },
    })
  ),
  preset(
    'Unison Lead',
    'Lead',
    analog({
      // Unison: the voices' oscillators stacked on one note, five saws a
      // few cents apart around it and a sub; the wheel brings in a vibrato
      inputs: {
        saw1: { kind: 'osc', fine: -14 },
        saw2: { kind: 'osc', fine: -6 },
        saw3: { kind: 'osc' },
        saw4: { kind: 'osc', fine: 7 },
        saw5: { kind: 'osc', fine: 15 },
        sub: { kind: 'osc', wave: 'Square', octave: -1 },
      },
      mix: { saw1: 0.4, saw2: 0.4, saw3: 0.4, saw4: 0.4, saw5: 0.4, sub: 0.3 },
      lp: {
        cutoff: 1100,
        resonance: 0.15,
        keytrack: 0.5,
        env: 2,
        velocity: 0.5,
      },
      filterEnv: { attack: 0.005, decay: 0.6, sustain: 0.5, release: 0.3 },
      slop: { saw1: 3, saw2: -3, saw3: 2, saw4: -2, saw5: 3 },
      modulators: { vibrato: { kind: 'lfo', rate: 5.2, fade: 0.3 } },
      routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.35, via: 'wheel' }],
      amp: {
        attack: 0.004,
        decay: 0.3,
        sustain: 1,
        release: 0.25,
        velocity: 0.3,
      },
      voice: { mode: 'Legato', glide: 0.07 },
      effects: [
        { kind: 'chorus', rate: 0.3, depth: 0.3, mix: 0.25 },
        widened(1.15, 150),
      ],
      sends: { b: 0.3, c: 0.25 },
    })
  ),
  preset(
    'Analog Bass',
    'Bass',
    analog({
      // A saw and a square an octave down, a sub another under them, the
      // filter's fall the bass's pluck, its top where a phone hears it
      inputs: {
        saw: { kind: 'osc', octave: -1 },
        square: { kind: 'osc', wave: 'Square', octave: -1, fine: -4 },
        sub: { kind: 'osc', wave: 'Square', octave: -2 },
      },
      mix: { saw: 0.65, square: 0.4, sub: 0.4 },
      lp: {
        cutoff: 260,
        resonance: 0.25,
        keytrack: 0.5,
        env: 3.5,
        velocity: 1,
      },
      filterEnv: { attack: 0.001, decay: 0.3, sustain: 0.25, release: 0.15 },
      slop: { saw: 2, square: -2, sub: 2 },
      amp: {
        attack: 0.002,
        decay: 0.5,
        sustain: 0.85,
        release: 0.08,
        velocity: 0.4,
      },
      voice: { mode: 'Mono' },
      effects: [
        { kind: 'doubler', detune: 5, time: 0.008, mix: 0.2 },
        widened(1.1, BASS_MONO),
      ],
    })
  ),
  preset(
    'Unison Bass',
    'Bass',
    analog({
      // Unison under the keys: four saws apart an octave down and a sub,
      // driven after the filter, sliding from note to note held over
      inputs: {
        saw1: { kind: 'osc', octave: -1, fine: -12 },
        saw2: { kind: 'osc', octave: -1, fine: -4 },
        saw3: { kind: 'osc', octave: -1, fine: 5 },
        saw4: { kind: 'osc', octave: -1, fine: 13 },
        sub: { kind: 'osc', wave: 'Square', octave: -2 },
      },
      mix: { saw1: 0.45, saw2: 0.45, saw3: 0.45, saw4: 0.45, sub: 0.5 },
      lp: { cutoff: 260, resonance: 0.3, keytrack: 0.5, env: 3, velocity: 1 },
      items: { drive: { kind: 'drive', drive: 0.35 } },
      filterEnv: { attack: 0.001, decay: 0.4, sustain: 0.3, release: 0.2 },
      slop: { saw1: 3, saw2: -3, saw3: 3, saw4: -3 },
      amp: {
        attack: 0.002,
        decay: 0.4,
        sustain: 0.9,
        release: 0.1,
        velocity: 0.3,
      },
      voice: { mode: 'Legato', glide: 0.04 },
      effects: [
        { kind: 'chorus', rate: 0.4, depth: 0.35, mix: 0.3 },
        widened(1.2, BASS_MONO),
      ],
    })
  ),

  // A chiptune's channels, its chips' (the 2A03's and the N163's): the
  // basses, the leads, the chords and the middle line's pulses
  /*
   * The library (docs/plan/sound-chains.md, The library): sounds the
   * genres reach for, each built from a recipe learned from tutorials,
   * papers and manuals (The list), with the parts it added: the super,
   * hard sync, the comb and the formant, the phaser.
   */
  preset('Supersaw Lead', 'Lead', {
    // Seven saws, the outer ones 30 cents out, a square an octave down
    // for its body
    inputs: {
      stack: {
        kind: 'super',
        voices: 7,
        detune: 30,
        blend: 0.7,
        phase: 'Free',
      },
      body: { kind: 'osc', wave: 'Square', octave: -1 },
    },
    chains: {
      main: {
        sends: { stack: 1, body: 0.15 },
        items: {
          // A touch of drive glues the stack
          glue: { kind: 'drive', drive: 0.15 },
          filter: {
            kind: 'filter',
            cutoff: 5000,
            resonance: 0.1,
            keytrack: 0.2,
          },
          lows: { kind: 'filter', type: 'HP', cutoff: 120 },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.3, sustain: 0.5 } },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 1 },
      // None of it at the top, where it would fold back past it
      { from: 'key', to: 'glue.drive', by: -0.2 },
    ],
    amp: { attack: 0.003, sustain: 0.9, release: 0.3 },
    effects: [
      { kind: 'doubler', detune: 8, time: 0.012, spread: 1, mix: 0.2 },
      pingPong(0.15, 0.35),
      widened(1.2, 150),
    ],
    sends: { c: 0.25 },
  }),
  preset('Festival Lead', 'Lead', {
    // Eight saws wide, five more an octave up, a square under them, all
    // driven a little: the main stage's lead
    inputs: {
      stack: {
        kind: 'super',
        voices: 8,
        detune: 40,
        blend: 0.8,
        phase: 'Free',
      },
      high: {
        kind: 'super',
        octave: 1,
        voices: 5,
        detune: 30,
        blend: 0.6,
        phase: 'Free',
      },
      body: { kind: 'osc', wave: 'Square', octave: -1 },
    },
    chains: {
      main: {
        sends: { stack: 1, high: 0.45, body: 0.3 },
        items: {
          lows: { kind: 'filter', type: 'HP', cutoff: 100 },
          drive: { kind: 'drive', drive: 0.25 },
          filter: { kind: 'filter', cutoff: 6000 },
        },
      },
    },
    // Less of the octave up high, where it would fold back past the top
    routes: [
      { from: 'key', to: 'main.send.high', by: -0.6 },
      { from: 'key', to: 'drive.drive', by: -0.3 },
    ],
    amp: { attack: 0.002, sustain: 1, release: 0.25 },
    effects: [
      { kind: 'doubler', detune: 10, time: 0.015, spread: 1, mix: 0.35 },
      widened(1.4, 180),
    ],
    sends: { b: 0.15, c: 0.2 },
  }),
  preset('Sync Lead', 'Lead', {
    // A saw synced to the note, its own pitch swept down from over an
    // octave above it as the note starts, a plain saw under it
    inputs: {
      synced: { kind: 'osc', sync: 12 },
      body: { kind: 'osc', fine: -6 },
    },
    chains: {
      main: {
        sends: { synced: 1, body: 0.4 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 4500,
            resonance: 0.15,
            keytrack: 0.3,
          },
        },
      },
    },
    modulators: { sweep: { kind: 'env', decay: 0.5, sustain: 0.2 } },
    routes: [
      { from: 'sweep', to: 'synced.sync', by: 20 },
      // Harder, it sweeps from higher
      { from: 'velocity', to: 'synced.sync', by: 8 },
    ],
    amp: { attack: 0.002, sustain: 0.9, release: 0.2 },
    voice: { mode: 'Legato', glide: 0.03 },
    effects: [pingPong(0.2, 0.35), widened(1.1, 150)],
    sends: { c: 0.15 },
  }),
  preset('Talk Lead', 'Lead', {
    // A saw and a square an octave down, driven into a formant filter
    // whose vowel moves on the beat: a synth that talks
    inputs: {
      saw: { kind: 'osc' },
      square: { kind: 'osc', wave: 'Square', octave: -1, fine: 5 },
    },
    chains: {
      main: {
        sends: { saw: 1, square: 0.5 },
        items: {
          drive: { kind: 'drive', drive: 0.3 },
          mouth: { kind: 'formant', vowel: 1.5, resonance: 0.7 },
          filter: { kind: 'filter', cutoff: 1800, keytrack: 0.3 },
        },
      },
    },
    modulators: {
      talk: { kind: 'lfo', shape: 'Triangle', sync: 'On', beat: '1/4' },
    },
    routes: [
      { from: 'talk', to: 'mouth.vowel', by: 1.5 },
      // Harder, it shouts: more drive
      { from: 'velocity', to: 'drive.drive', by: 0.4 },
    ],
    amp: { attack: 0.004, sustain: 0.9, release: 0.15 },
    voice: { mode: 'Legato', glide: 0.05 },
    effects: [
      { kind: 'chorus', rate: 0.5, depth: 0.3, mix: 0.25 },
      widened(1.1, 150),
    ],
    sends: { b: 0.15, c: 0.15 },
  }),
  preset('Breath Flute', 'Lead', {
    // A triangle, breath in a band around it, and a chiff of breath as
    // each note speaks, scooped up into its pitch
    inputs: {
      pipe: { kind: 'osc', wave: 'Triangle' },
      air: { kind: 'noise' },
    },
    chains: {
      tone: {
        sends: { pipe: 1 },
        items: { filter: { kind: 'filter', cutoff: 3000, keytrack: 0.5 } },
      },
      breath: {
        level: 0.3,
        sends: { air: 1 },
        items: {
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 1500,
            resonance: 0.55,
            keytrack: 0.7,
          },
        },
      },
    },
    modulators: {
      chiff: { kind: 'env', decay: 0.08 },
      scoop: { kind: 'env', decay: 0.06 },
      vibrato: { kind: 'lfo', rate: 5, fade: 0.35 },
    },
    routes: [
      { from: 'chiff', to: 'breath.level', by: 0.5 },
      { from: 'scoop', to: 'voice.pitch', by: -0.3 },
      { from: 'vibrato', to: 'voice.pitch', by: 0.2 },
      // Blown harder, more breath
      { from: 'velocity', to: 'breath.level', by: 0.3 },
      { from: 'velocity', to: 'band.cutoff', by: 1 },
    ],
    amp: { attack: 0.06, sustain: 1, release: 0.15, velocity: 0.5 },
    voice: { mode: 'Legato', glide: 0.04 },
    effects: [pingPong(0.15, 0.3), widened(1, 150)],
    sends: { c: 0.3 },
  }),
  preset('Whine Lead', 'Lead', {
    // A narrow pulse through a resonant lowpass, always gliding, a
    // vibrato setting in: the high, whining lead of West Coast hip-hop
    inputs: { pulse: { kind: 'osc', wave: 'Square', width: 0.25 } },
    chains: {
      main: {
        sends: { pulse: 1 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 1400,
            resonance: 0.55,
            keytrack: 0.8,
          },
        },
      },
    },
    modulators: { vibrato: { kind: 'lfo', rate: 5.5, fade: 0.5 } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.25 }],
    amp: { attack: 0.01, sustain: 1, release: 0.2 },
    voice: { mode: 'Mono', glide: 0.1 },
    effects: [pingPong(0.12, 0.3), widened(1.05, 150)],
    sends: { c: 0.1 },
  }),
  preset('Hoover', 'Lead', {
    // Two stacks of saws an octave apart, far out of tune, bending up into
    // each note and gliding, driven and chorused: the rave's hoover
    inputs: {
      low: {
        kind: 'super',
        octave: -1,
        voices: 6,
        detune: 60,
        blend: 0.8,
        phase: 'Free',
      },
      high: { kind: 'super', voices: 4, detune: 45, blend: 0.7, phase: 'Free' },
    },
    chains: {
      main: {
        sends: { low: 1, high: 0.6 },
        items: {
          drive: { kind: 'drive', drive: 0.35 },
          filter: { kind: 'filter', cutoff: 2500, resonance: 0.2 },
        },
      },
    },
    modulators: { bend: { kind: 'env', decay: 0.25 } },
    routes: [
      { from: 'bend', to: 'voice.pitch', by: -3 },
      // Less drive up high, where it would fold back past the top
      { from: 'key', to: 'drive.drive', by: -0.5 },
    ],
    amp: { attack: 0.005, sustain: 1, release: 0.25 },
    voice: { mode: 'Legato', glide: 0.08 },
    effects: [
      { kind: 'chorus', rate: 0.8, depth: 0.6, mix: 0.45 },
      widened(1.4, 150),
    ],
    sends: { c: 0.15 },
  }),

  preset('Trap Bass', 'Bass', {
    // A sine falling a fifth into its note as it strikes, ringing on, an
    // octave of it for small speakers and a little drive
    inputs: {
      sine: { kind: 'osc', wave: 'Sine', octave: -1 },
      octave: { kind: 'osc', wave: 'Sine' },
    },
    chains: {
      main: {
        sends: { sine: 1, octave: 0.12 },
        items: { drive: { kind: 'drive', drive: 0.15 } },
      },
    },
    modulators: { drop: { kind: 'env', decay: 0.05 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 7 }],
    amp: {
      attack: 0.001,
      decay: 1.6,
      sustain: 0.35,
      release: 0.35,
      velocity: 0.5,
    },
    voice: { mode: 'Legato', glide: 0.08 },
  }),
  preset('Dirty Trap Bass', 'Bass', {
    // The trap bass driven hard, harder as it strikes, a saw under it, its
    // fizz past 3 kHz taken off
    inputs: {
      sine: { kind: 'osc', wave: 'Sine', octave: -1 },
      saw: { kind: 'osc', octave: -1, fine: 4 },
    },
    chains: {
      main: {
        sends: { sine: 1, saw: 0.12 },
        items: {
          drive: { kind: 'drive', drive: 0.55 },
          filter: { kind: 'filter', cutoff: 3000, keytrack: 0.3 },
        },
      },
    },
    modulators: {
      drop: { kind: 'env', decay: 0.05 },
      bite: { kind: 'env', decay: 0.3 },
    },
    routes: [
      { from: 'drop', to: 'voice.pitch', by: 7 },
      { from: 'bite', to: 'drive.drive', by: 0.3 },
      { from: 'velocity', to: 'drive.drive', by: 0.4 },
    ],
    amp: {
      attack: 0.001,
      decay: 1.6,
      sustain: 0.35,
      release: 0.35,
      velocity: 0.5,
    },
    voice: { mode: 'Legato', glide: 0.1 },
  }),
  preset('Riddim Bass', 'Bass', {
    // An FM saw talking through a formant filter, its depth and its vowel
    // wandering on the beat, driven; a sine under it for the lows
    inputs: {
      carrier: { kind: 'osc', octave: -1, fm: 0.25, fmSource: 'mod' },
      mod: { kind: 'osc', wave: 'Sine', octave: -1 },
      sub: { kind: 'osc', wave: 'Sine', octave: -1 },
    },
    chains: {
      growl: {
        sends: { carrier: 1 },
        items: {
          mouth: { kind: 'formant', vowel: 2, resonance: 0.6 },
          drive: { kind: 'drive', drive: 0.5 },
          lows: { kind: 'filter', type: 'HP', cutoff: 150 },
        },
      },
      low: { level: 0.7, sends: { sub: 1 } },
    },
    modulators: {
      talk: { kind: 'lfo', shape: 'Smooth', sync: 'On', beat: '1/8' },
    },
    routes: [
      { from: 'talk', to: 'carrier.fm', by: 0.25 },
      { from: 'talk', to: 'mouth.vowel', by: 1.5 },
      { from: 'velocity', to: 'carrier.fm', by: 0.2 },
      { from: 'velocity', to: 'mouth.shift', by: 3 },
      { from: 'velocity', to: 'drive.drive', by: 0.3 },
    ],
    amp: { attack: 0.003, sustain: 1, release: 0.1 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'chorus', rate: 0.6, depth: 0.3, mix: 0.25 },
      widened(1.2, BASS_MONO),
    ],
  }),
  preset('Organ Bass', 'Bass', {
    // A triangle down low, another two octaves and a fifth over it and a
    // square three octaves up, through a lowpass struck open: the organ
    // bass of 90s house
    inputs: {
      low: { kind: 'osc', wave: 'Triangle', octave: -1 },
      fifth: { kind: 'osc', wave: 'Triangle', octave: 1, semi: 7 },
      square: { kind: 'osc', wave: 'Square', octave: 2 },
    },
    chains: {
      main: {
        sends: { low: 1, fifth: 0.45, square: 0.25 },
        items: {
          filter: { kind: 'filter', cutoff: 600, keytrack: 0.3 },
          drive: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.3 } },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 2.5 }],
    amp: { attack: 0.002, decay: 0.6, sustain: 0.65, release: 0.2 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'chorus', rate: 0.35, depth: 0.3, mix: 0.25 },
      widened(1.1, BASS_MONO),
    ],
  }),

  preset('Gate Pad', 'Pad', {
    // A supersaw chord chopped into sixteenths by its gain, a sine on the
    // beat, so each chop swells and falls without a click
    inputs: {
      stack: {
        kind: 'super',
        voices: 7,
        detune: 25,
        blend: 0.7,
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { stack: 1 },
        items: { filter: { kind: 'filter', cutoff: 3000, keytrack: 0.3 } },
      },
    },
    modulators: {
      gate: { kind: 'lfo', sync: 'On', beat: '1/16', trigger: 'Free' },
    },
    routes: [{ from: 'gate', to: 'amp.gain', by: -1 }, spread(0.4)],
    amp: { attack: 0.005, sustain: 1, release: 0.3 },
    effects: [pingPong(0.2, 0.3), widened(1.3, 150)],
    sends: { c: 0.35 },
  }),
  preset('Future Chords', 'Chord', {
    // Supersaw chords that bend up into their notes and open as they do,
    // a saw an octave down under them, wide and bright
    inputs: {
      stack: {
        kind: 'super',
        voices: 7,
        detune: 20,
        blend: 0.6,
        phase: 'Free',
      },
      body: { kind: 'osc', octave: -1 },
    },
    chains: {
      main: {
        sends: { stack: 1, body: 0.3 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 1200,
            resonance: 0.15,
            keytrack: 0.4,
          },
        },
      },
    },
    modulators: {
      swell: { kind: 'env', decay: 0.2 },
      open: { kind: 'env', attack: 0.15, decay: 0.5, sustain: 0.4 },
    },
    routes: [
      { from: 'swell', to: 'voice.pitch', by: -2 },
      { from: 'open', to: 'filter.cutoff', by: 2 },
    ],
    amp: { attack: 0.03, decay: 0.6, sustain: 0.75, release: 0.4 },
    effects: [
      { kind: 'chorus', rate: 0.4, depth: 0.4, mix: 0.3 },
      widened(1.4, 150),
    ],
    sends: { b: 0.15, c: 0.35 },
  }),
  preset('String Machine', 'Strings', {
    // A saw and one an octave up, through an ensemble of delays and a
    // phaser: the string machine of the 70s
    inputs: {
      eight: { kind: 'osc' },
      four: { kind: 'osc', octave: 1 },
    },
    chains: {
      main: {
        sends: { eight: 1, four: 0.6 },
        items: { filter: { kind: 'filter', cutoff: 3500, keytrack: 0.4 } },
      },
    },
    amp: { attack: 0.25, decay: 1, sustain: 1, release: 1.2 },
    effects: [
      { kind: 'chorus', rate: 0.6, depth: 0.7, mix: 0.5 },
      { kind: 'phaser', rate: 0.3, depth: 0.6, feedback: 0.3, mix: 0.4 },
      widened(1.2, 150),
    ],
    sends: { c: 0.35 },
  }),
  preset('Formant Choir', 'Vocal', {
    // Four saws a little apart and a breath of noise, sung through a
    // formant filter that wanders about "oh" as it holds
    inputs: {
      voices: {
        kind: 'super',
        voices: 4,
        detune: 12,
        blend: 0.8,
        phase: 'Free',
      },
      air: { kind: 'noise' },
    },
    chains: {
      choir: {
        sends: { voices: 1, air: 0.05 },
        items: {
          mouth: { kind: 'formant', vowel: 3, resonance: 0.75 },
          filter: { kind: 'filter', cutoff: 4000 },
        },
      },
    },
    modulators: {
      morph: { kind: 'lfo', shape: 'Smooth', rate: 0.12, trigger: 'Free' },
      vibrato: { kind: 'lfo', rate: 5, fade: 0.6 },
    },
    routes: [
      { from: 'morph', to: 'mouth.vowel', by: 0.6 },
      // A saw's fundamental climbs into the first formant: less up high
      { from: 'key', to: 'amp.gain', by: -0.5 },
      { from: 'vibrato', to: 'voice.pitch', by: 0.1 },
      spread(0.35),
    ],
    amp: { attack: 0.5, decay: 1, sustain: 0.9, release: 1.5 },
    effects: [
      { kind: 'chorus', rate: 0.3, depth: 0.5, mix: 0.4 },
      widened(1.2, 150),
    ],
    sends: { c: 0.5 },
  }),
  preset('Drone', 'Atmos', {
    // Two saws beating slowly against each other over a sine an octave
    // down, a resonant lowpass wandering over them, a little driven
    inputs: {
      saw: { kind: 'osc' },
      beating: { kind: 'osc', fine: 12 },
      sub: { kind: 'osc', wave: 'Sine', octave: -1 },
    },
    chains: {
      main: {
        sends: { saw: 0.8, beating: 0.8, sub: 0.5 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 700,
            resonance: 0.45,
            keytrack: 0.3,
          },
          drive: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: {
      wander: { kind: 'lfo', shape: 'Smooth', rate: 0.06, trigger: 'Free' },
    },
    routes: [{ from: 'wander', to: 'filter.cutoff', by: 1.5 }],
    amp: { attack: 1.5, decay: 1, sustain: 1, release: 2 },
    effects: [
      { kind: 'chorus', rate: 0.15, depth: 0.5, mix: 0.3 },
      widened(1.2, 150),
    ],
    sends: { c: 0.6 },
  }),

  preset('Trance Pluck', 'Pluck', {
    // Five saws a little apart through a lowpass snapped open and shut,
    // echoed on the dotted eighth
    inputs: {
      stack: {
        kind: 'super',
        voices: 5,
        detune: 15,
        blend: 0.7,
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { stack: 1 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 500,
            resonance: 0.25,
            keytrack: 0.5,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.3 } },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 4 }, spread(0.3)],
    amp: {
      attack: 0.001,
      decay: 0.8,
      sustain: 0,
      release: 0.3,
      velocity: 0.6,
    },
    effects: [pingPong(0.35, 0.38), widened(1.2, 150)],
    sends: { c: 0.3 },
  }),
  preset('Plucked String', 'Pluck', {
    // A burst of noise, darker the softer the pluck, into a comb tuned to
    // the note: a string, plucked (Karplus-Strong), on a body
    inputs: { pick: { kind: 'noise' } },
    chains: {
      string: {
        sends: { pick: 0.01 },
        items: {
          tone: { kind: 'filter', cutoff: 2500, keytrack: 0.5 },
          body: { kind: 'comb', decay: 2.5, damp: 0.35 },
          // Driven a little, the ring stands up under the pick
          warmth: { kind: 'drive', drive: 0.35 },
        },
      },
    },
    modulators: plucked('string', 'pick', 0.01).modulators,
    routes: [
      ...plucked('string', 'pick', 0.01).routes,
      { from: 'velocity', to: 'tone.cutoff', by: 1.5 },
      keyPan(0.5),
      // A comb rings louder up high: as loud across the neck
      { from: 'key', to: 'amp.gain', by: -0.5 },
    ],
    amp: { attack: 0.001, sustain: 1, release: 0.3, velocity: 0.5 },
    effects: [
      { kind: 'eq', mid: 3, midFreq: 200 },
      { kind: 'doubler', detune: 4, time: 0.012, mix: 0.2 },
      widened(1.1, 150),
    ],
    sends: { c: 0.2 },
  }),
  preset('Harp', 'Pluck', {
    // A soft, dark burst into a comb that rings long: a harp's string
    inputs: { pick: { kind: 'noise' } },
    chains: {
      string: {
        sends: { pick: 0.01 },
        items: {
          tone: { kind: 'filter', cutoff: 1200, keytrack: 0.6 },
          body: { kind: 'comb', decay: 5, damp: 0.15 },
          // Driven a little, the ring stands up under the pick
          warmth: { kind: 'drive', drive: 0.25 },
        },
      },
    },
    modulators: plucked('string', 'pick', 0.01).modulators,
    routes: [
      ...plucked('string', 'pick', 0.01).routes,
      { from: 'velocity', to: 'tone.cutoff', by: 1 },
      keyPan(0.7),
    ],
    amp: { attack: 0.002, sustain: 1, release: 1.5, velocity: 0.5 },
    effects: [widened(1.1, 150)],
    sends: { c: 0.45 },
  }),
  preset('Koto', 'Pluck', {
    // A bright click into a comb damped fast: a thin string plucked near
    // its bridge
    inputs: { pick: { kind: 'noise' } },
    chains: {
      string: {
        sends: { pick: 0.01 },
        items: {
          tone: { kind: 'filter', cutoff: 6000, keytrack: 0.3 },
          body: { kind: 'comb', decay: 2.5, damp: 0.45 },
          // Driven a little, the ring stands up under the pick
          warmth: { kind: 'drive', drive: 0.4 },
        },
      },
    },
    modulators: plucked('string', 'pick', 0.008).modulators,
    routes: [
      ...plucked('string', 'pick', 0.008).routes,
      { from: 'velocity', to: 'tone.cutoff', by: 1 },
      // Plucked harder, it rings brighter
      { from: 'velocity', to: 'body.damp', by: -0.3 },
      keyPan(0.5),
    ],
    amp: { attack: 0.001, sustain: 1, release: 0.5, velocity: 0.5 },
    effects: [widened(1.1, 150)],
    sends: { c: 0.3 },
  }),

  preset('Deep Stab', 'Chord', {
    // A minor ninth from one key, its saws a few cents apart, through a
    // lowpass struck open: deep house's chord
    inputs: {
      root: { kind: 'osc' },
      third: { kind: 'osc', semi: 3, fine: 5 },
      fifth: { kind: 'osc', semi: 7, fine: -5 },
      seventh: { kind: 'osc', semi: 10, fine: 4 },
      ninth: { kind: 'osc', octave: 1, semi: 2, fine: -4 },
    },
    chains: {
      main: {
        sends: {
          root: 0.55,
          third: 0.55,
          fifth: 0.55,
          seventh: 0.55,
          ninth: 0.4,
        },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 550,
            resonance: 0.2,
            keytrack: 0.3,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.35 } },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 2.5 }],
    amp: {
      attack: 0.002,
      decay: 0.6,
      sustain: 0.25,
      release: 0.3,
      velocity: 0.6,
    },
    effects: [
      { kind: 'chorus', rate: 0.5, depth: 0.4, mix: 0.3 },
      pingPong(0.3, 0.35),
      widened(1.2, 150),
    ],
    sends: { c: 0.3 },
  }),
  preset('Rave Stab', 'Chord', {
    // A minor seventh of squares from one key, a saw an octave up and a
    // sine under them, struck open and held: the rave's stab
    inputs: {
      root: { kind: 'osc', wave: 'Square' },
      third: { kind: 'osc', wave: 'Square', semi: 3 },
      fifth: { kind: 'osc', wave: 'Square', semi: 7 },
      seventh: { kind: 'osc', wave: 'Square', semi: 10 },
      octave: { kind: 'osc', octave: 1, fine: 10 },
      sub: { kind: 'osc', wave: 'Sine', octave: -1 },
    },
    chains: {
      main: {
        sends: {
          root: 0.35,
          third: 0.35,
          fifth: 0.35,
          seventh: 0.35,
          octave: 0.3,
          sub: 0.5,
        },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 350,
            resonance: 0.2,
            keytrack: 0.2,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.25, sustain: 0.25 } },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 3 }],
    amp: {
      attack: 0.001,
      decay: 0.3,
      sustain: 0.8,
      release: 0.15,
      velocity: 0.6,
    },
    effects: [widened(1.2, 150)],
    sends: { c: 0.45 },
  }),
  preset('Dub Chord', 'Chord', {
    // A minor seventh of saws from one key over a square an octave down,
    // through a dark lowpass, echoing on the dotted eighth
    inputs: {
      sub: { kind: 'osc', wave: 'Square', octave: -1 },
      root: { kind: 'osc' },
      third: { kind: 'osc', semi: 3, fine: 4 },
      fifth: { kind: 'osc', semi: 7, fine: -4 },
      seventh: { kind: 'osc', semi: 10 },
    },
    chains: {
      main: {
        sends: { sub: 0.4, root: 0.4, third: 0.4, fifth: 0.4, seventh: 0.35 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 450,
            resonance: 0.3,
            keytrack: 0.2,
          },
        },
      },
    },
    modulators: { filterEnv: { kind: 'env', decay: 0.15 } },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 2 }],
    amp: {
      attack: 0.002,
      decay: 0.25,
      sustain: 0.4,
      release: 0.2,
      velocity: 0.6,
    },
    effects: [
      {
        kind: 'delay',
        sync: 'On',
        beat: '1/8D',
        feedback: 0.55,
        tone: 0.35,
        mode: 'Ping-pong',
        mix: 0.35,
      },
      widened(1.2, 150),
    ],
    sends: { c: 0.4 },
  }),
  preset('House Piano', 'Keys', {
    // Two FM pairs: a body at 1:1 and a hammer at 4:1 a few cents apart,
    // whose brightness is struck in and falls away. Free-running, so a
    // chord's notes never start on their peaks together: a sine's FM
    // sounds alike from any phase
    inputs: {
      body: {
        kind: 'osc',
        wave: 'Sine',
        fm: 0.3,
        fmSource: 'bodyMod',
        phase: 'Free',
      },
      bodyMod: { kind: 'osc', wave: 'Sine', phase: 'Free' },
      hammer: {
        kind: 'osc',
        wave: 'Sine',
        fine: 4,
        fm: 0.4,
        fmSource: 'hammerMod',
        phase: 'Free',
      },
      hammerMod: { kind: 'osc', wave: 'Sine', octave: 2, phase: 'Free' },
    },
    chains: { main: { sends: { body: 1, hammer: 0.6 } } },
    modulators: { strike: { kind: 'env', decay: 0.12 } },
    routes: [
      { from: 'strike', to: 'hammer.fm', by: 0.5 },
      { from: 'velocity', to: 'body.fm', by: 0.3 },
      { from: 'velocity', to: 'hammer.fm', by: 0.2 },
      keyPan(0.5),
    ],
    amp: {
      attack: 0.001,
      decay: 2.5,
      sustain: 0,
      release: 0.4,
      velocity: 0.6,
    },
    effects: [
      { kind: 'eq', high: 3, highFreq: 4000 },
      { kind: 'chorus', rate: 0.4, depth: 0.25, mix: 0.2 },
      widened(1.2, 150),
    ],
    sends: { c: 0.25 },
  }),
  preset('Tubular Bell', 'Bell', {
    // Two FM pairs at 1:1.4, a bell's ratio, a few cents apart so they
    // beat, bright as struck and purer as they ring
    inputs: {
      strike: { kind: 'osc', wave: 'Sine', fm: 0.25, fmSource: 'ring' },
      ring: { kind: 'osc', wave: 'Sine', semi: 6, fine: -17 },
      warble: {
        kind: 'osc',
        wave: 'Sine',
        fine: 3,
        fm: 0.25,
        fmSource: 'ring2',
      },
      ring2: { kind: 'osc', wave: 'Sine', semi: 6, fine: -14 },
    },
    chains: { main: { sends: { strike: 1, warble: 0.7 } } },
    modulators: { fade: { kind: 'env', decay: 2.5 } },
    routes: [
      { from: 'fade', to: 'strike.fm', by: 0.35 },
      { from: 'fade', to: 'warble.fm', by: 0.35 },
      { from: 'velocity', to: 'strike.fm', by: 0.2 },
      // Less FM up high, where it would fold back past the top
      { from: 'key', to: 'strike.fm', by: -0.4 },
      { from: 'key', to: 'warble.fm', by: -0.4 },
      keyPan(0.4),
    ],
    amp: {
      attack: 0.001,
      decay: 6,
      sustain: 0,
      release: 2.5,
      velocity: 0.5,
    },
    effects: [widened(1.15, 150)],
    sends: { c: 0.45 },
  }),
  preset('Glock', 'Bell', {
    // A bar's partials, 1, 2.76 and 5.4 times the note, the upper ones
    // dying sooner, and a tap of noise as the mallet strikes
    inputs: {
      first: { kind: 'osc', wave: 'Sine' },
      second: { kind: 'osc', wave: 'Sine', octave: 1, semi: 6, fine: -42 },
      third: { kind: 'osc', wave: 'Sine', octave: 2, semi: 5, fine: 19 },
      tap: { kind: 'noise' },
    },
    chains: {
      bar: { sends: { first: 1, second: 0.01, third: 0.01 } },
      mallet: {
        level: 0,
        sends: { tap: 1 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 3500, resonance: 0.4 },
        },
      },
    },
    modulators: {
      ring2: { kind: 'env', decay: 0.6 },
      ring3: { kind: 'env', decay: 0.25 },
      knock: { kind: 'env', decay: 0.006 },
    },
    routes: [
      { from: 'ring2', to: 'bar.send.second', by: 0.35 },
      { from: 'ring3', to: 'bar.send.third', by: 0.25 },
      { from: 'knock', to: 'mallet.level', by: 0.2 },
      // Struck harder, more of its upper partials
      { from: 'velocity', to: 'bar.send.second', by: 0.15 },
      { from: 'velocity', to: 'bar.send.third', by: 0.15 },
      keyPan(0.5),
    ],
    amp: {
      attack: 0.001,
      decay: 1.8,
      sustain: 0,
      release: 1,
      velocity: 0.5,
    },
    effects: [widened(1.1, 150)],
    sends: { c: 0.35 },
  }),

  preset('Braam', 'FX', {
    // Saws and a square stacked in octaves, a sine under them, through a
    // lowpass opening as the drive rises: a film trailer's brass
    inputs: {
      low: { kind: 'osc', octave: -2 },
      mid: { kind: 'osc', octave: -1, fine: 6 },
      top: { kind: 'osc', wave: 'Square', fine: -6 },
      sub: { kind: 'osc', wave: 'Sine', octave: -2 },
    },
    chains: {
      main: {
        sends: { low: 0.7, mid: 0.6, top: 0.4, sub: 0.5 },
        items: {
          drive: { kind: 'drive', drive: 0.2 },
          filter: { kind: 'filter', cutoff: 200, resonance: 0.2 },
        },
      },
    },
    modulators: {
      swell: { kind: 'env', attack: 1, decay: 2, sustain: 0.6, release: 1.5 },
    },
    routes: [
      { from: 'swell', to: 'filter.cutoff', by: 3.3 },
      { from: 'swell', to: 'drive.drive', by: 0.4 },
    ],
    amp: { attack: 0.03, decay: 2, sustain: 0.8, release: 1.5 },
    effects: [widened(1.3, 150)],
    sends: { c: 0.6 },
  }),
  preset('Impact', 'FX', {
    // A sine falling an octave, a burst of dark noise and a knock of a
    // triangle, driven, into the reverb
    inputs: {
      boom: { kind: 'osc', wave: 'Sine', octave: -2 },
      hit: { kind: 'noise' },
      knock: { kind: 'osc', wave: 'Triangle', semi: -5 },
    },
    chains: {
      body: {
        sends: { boom: 1 },
        items: { drive: { kind: 'drive', drive: 0.45 } },
      },
      noise: {
        level: 0,
        sends: { hit: 1 },
        items: {
          filter: { kind: 'filter', cutoff: 1500 },
          crush: { kind: 'drive', drive: 0.3 },
        },
      },
      thwack: { level: 0, sends: { knock: 1 } },
    },
    modulators: {
      drop: { kind: 'env', decay: 0.7 },
      burst: { kind: 'env', decay: 0.5 },
      strike: { kind: 'env', decay: 0.05 },
    },
    routes: [
      { from: 'drop', to: 'voice.pitch', by: 12 },
      { from: 'burst', to: 'noise.level', by: 0.6 },
      { from: 'strike', to: 'thwack.level', by: 0.6 },
    ],
    amp: { attack: 0.001, decay: 2.5, sustain: 0.4, release: 1.5 },

    sends: { c: 0.5 },
  }),
  preset('Sub Drop', 'FX', {
    // A sine falling two octaves from its note over a few seconds, a
    // little driven so small speakers hear it
    inputs: { sine: { kind: 'osc', wave: 'Sine', octave: -2 } },
    chains: {
      main: {
        sends: { sine: 1 },
        items: { drive: { kind: 'drive', drive: 0.45 } },
      },
    },
    modulators: { fall: { kind: 'env', decay: 2.5 } },
    routes: [{ from: 'fall', to: 'voice.pitch', by: 24 }],
    amp: { attack: 0.002, decay: 3, sustain: 0.5, release: 1.5 },
    voice: { mode: 'Mono' },
  }),
  preset('Downlifter', 'FX', {
    // Noise in a band falling from high to low, and a saw falling an
    // octave under it: a riser, reversed
    inputs: {
      air: { kind: 'noise' },
      saw: { kind: 'osc' },
    },
    chains: {
      hiss: {
        sends: { air: 1 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 200, resonance: 0.2 },
          grit: { kind: 'drive', drive: 0.5 },
        },
      },
      tone: {
        level: 0.4,
        sends: { saw: 1 },
        items: { filter: { kind: 'filter', cutoff: 2000 } },
      },
    },
    modulators: { fall: { kind: 'env', decay: 4 } },
    routes: [
      { from: 'fall', to: 'band.cutoff', by: 5.5 },
      { from: 'fall', to: 'voice.pitch', by: 12 },
    ],
    amp: { attack: 0.15, decay: 4, sustain: 0.7, release: 1.5 },
    effects: [
      { kind: 'chorus', rate: 0.3, depth: 0.5, mix: 0.1 },
      widened(1.1, 150),
    ],
    sends: { b: 0.15, c: 0.6 },
  }),
  preset('Whoosh', 'FX', {
    // Noise in a band swept up and back down, carried across the sides,
    // through a phaser: something passing
    inputs: { air: { kind: 'noise' } },
    chains: {
      main: {
        sends: { air: 1 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 300, resonance: 0.25 },
          drive: { kind: 'drive', drive: 0.4 },
        },
      },
    },
    modulators: {
      sweep: { kind: 'env', attack: 0.6, decay: 0.8, sustain: 0, release: 0.5 },
      across: { kind: 'lfo', rate: 0.7 },
    },
    routes: [
      { from: 'sweep', to: 'band.cutoff', by: 4 },
      { from: 'across', to: 'amp.pan', by: 0.6 },
    ],
    amp: { attack: 0.3, decay: 1, sustain: 0, release: 0.6 },
    effects: [
      { kind: 'phaser', rate: 0.5, depth: 0.8, feedback: 0.5, mix: 0.5 },
      widened(1.2, 150),
    ],
    sends: { c: 0.4 },
  }),

  // The library's second round (2026-11-18, docs/plan/sound-chains.md,
  // The list): the starting points, then a sound for each category's
  // gaps

  // Starting points: one input each, a lowpass velocity opens and the
  // wheel's vibrato, to build a sound from
  preset('Basic Sine', 'Basic', {
    // A hard note drives the sine a little: a few harmonics over it
    inputs: { sine: { kind: 'osc', wave: 'Sine', phase: 'Free' } },
    chains: {
      main: {
        sends: { sine: 1 },
        items: { drive: { kind: 'drive', drive: 0 } },
      },
    },
    routes: [{ from: 'velocity', to: 'drive.drive', by: 0.35 }],
    amp: { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.25 },
  }),
  preset('Basic Saw', 'Basic', {
    inputs: { saw: { kind: 'osc', phase: 'Free' } },
    chains: {
      main: {
        sends: { saw: 1 },
        items: { filter: { kind: 'filter', cutoff: 4500, keytrack: 0.2 } },
      },
    },
    amp: { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.25 },
  }),
  preset('Basic Square', 'Basic', {
    inputs: { square: { kind: 'osc', wave: 'Square', phase: 'Free' } },
    chains: {
      main: {
        sends: { square: 1 },
        items: { filter: { kind: 'filter', cutoff: 4500, keytrack: 0.2 } },
      },
    },
    amp: { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.25 },
  }),
  preset('Basic Super', 'Basic', {
    // Seven saws spread a little apart
    inputs: { stack: { kind: 'super', voices: 7, detune: 25, phase: 'Free' } },
    chains: {
      main: {
        sends: { stack: 1 },
        items: {
          filter: { kind: 'filter', cutoff: 3500 },
          glue: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    amp: { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.3 },
    effects: [widened(1.2, 150)],
  }),
  preset('Basic FM', 'Basic', {
    // A sine phase-modulated by one an octave up, the harder the brighter
    // as it strikes, settling
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.15, fmSource: 'modulator' },
      modulator: { kind: 'osc', wave: 'Sine', octave: 1 },
    },
    chains: { main: { sends: { carrier: 1 } } },
    modulators: { index: { kind: 'env', decay: 0.6, sustain: 0.3 } },
    routes: [{ from: 'index', to: 'carrier.fm', by: 0.4, via: 'velocity' }],
    amp: {
      attack: 0.005,
      decay: 0.3,
      sustain: 0.8,
      release: 0.25,
      velocity: 0.65,
    },
  }),

  preset('Upright Bass', 'Bass', {
    // A finger's soft burst into a comb tuned to the note, dark and short,
    // over a sine for the body the string's low end barely carries
    inputs: {
      pick: { kind: 'noise' },
      body: { kind: 'osc', wave: 'Sine' },
    },
    chains: {
      string: {
        sends: { pick: 0.02 },
        items: {
          tone: { kind: 'filter', cutoff: 900, keytrack: 0.5 },
          comb: { kind: 'comb', decay: 1.6, damp: 0.6 },
          warmth: { kind: 'drive', drive: 0.5 },
        },
      },
      wood: { level: 0, sends: { body: 0.9 } },
    },
    modulators: {
      ...plucked('string', 'pick', 0.012).modulators,
      thump: { kind: 'env', attack: 0.003, decay: 0.9 },
    },
    routes: [
      ...plucked('string', 'pick', 0.012).routes,
      { from: 'thump', to: 'wood.level', by: 1 },
      { from: 'velocity', to: 'tone.cutoff', by: 2.5 },
      { from: 'velocity', to: 'warmth.drive', by: 0.3 },
    ],
    amp: { attack: 0.001, sustain: 1, release: 0.12, velocity: 0.5 },
    effects: [{ kind: 'eq', mid: 3, midFreq: 120, g4: -2, f4: 900 }],
  }),
  preset('Synthwave Bass', 'Bass', {
    // A saw and a pulse an octave down, a lowpass snapped open at each
    // note: eighths and sixteenths that drive a night drive's track
    inputs: {
      saw: { kind: 'osc' },
      pulse: { kind: 'osc', wave: 'Square', width: 0.35, octave: -1 },
    },
    chains: {
      main: {
        sends: { saw: 1, pulse: 0.7 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 320,
            resonance: 0.25,
            keytrack: 0.4,
          },
          drive: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: {
      filterEnv: { kind: 'env', attack: 0.001, decay: 0.18, sustain: 0.15 },
    },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 3, via: 'velocity' },
    ],
    amp: { attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.08 },
  }),
  preset('Rubber Bass', 'Bass', {
    // A triangle and a sine under it, struck a fifth high and bounced down
    // to the note, rounded off by a drive
    inputs: {
      tri: { kind: 'osc', wave: 'Triangle' },
      sub: { kind: 'osc', wave: 'Sine', octave: -1 },
    },
    chains: {
      main: {
        sends: { tri: 0.8, sub: 0.6 },
        items: {
          filter: { kind: 'filter', cutoff: 1400, keytrack: 0.5 },
          drive: { kind: 'drive', drive: 0.3 },
        },
      },
    },
    modulators: { bounce: { kind: 'env', attack: 0.001, decay: 0.06 } },
    routes: [
      { from: 'bounce', to: 'voice.pitch', by: 7 },
      { from: 'velocity', to: 'drive.drive', by: 0.4 },
    ],
    amp: { attack: 0.002, decay: 0.45, sustain: 0.5, release: 0.1 },
  }),
  preset('Slap Bass', 'Bass', {
    // Two-operator FM at one to one, the index snapped high and let fall:
    // the string slapped, its pop dying into a round tone
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.05, fmSource: 'modulator' },
      modulator: { kind: 'osc', wave: 'Sine' },
      pop: { kind: 'osc', wave: 'Sine', octave: 2, semi: 7 },
    },
    chains: {
      main: {
        sends: { carrier: 1, pop: 0.01 },
        items: { drive: { kind: 'drive', drive: 0.2 } },
      },
    },
    modulators: {
      index: { kind: 'env', attack: 0.001, decay: 0.15, sustain: 0.1 },
      snap: { kind: 'env', attack: 0.001, decay: 0.03 },
    },
    routes: [
      { from: 'index', to: 'carrier.fm', by: 0.5, via: 'velocity' },
      { from: 'snap', to: 'main.send.pop', by: 0.2, via: 'velocity' },
    ],
    amp: { attack: 0.001, decay: 0.8, sustain: 0.35, release: 0.08 },
  }),

  preset('Pan Flute', 'Lead', {
    // A sine and a breath of noise on the note, the breath chiffing as
    // the note starts: blown across a pipe
    inputs: {
      tone: { kind: 'osc', wave: 'Sine', phase: 'Free' },
      air: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { tone: 0.9 },
        items: { drive: { kind: 'drive', drive: 0.15 } },
      },
      breath: {
        level: 0.3,
        sends: { air: 0.35 },
        items: {
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 1200,
            resonance: 0.7,
            keytrack: 1,
          },
        },
      },
    },
    modulators: {
      chiff: { kind: 'env', attack: 0.005, decay: 0.08 },
      vibrato: { kind: 'lfo', rate: 5, fade: 0.5 },
    },
    routes: [
      { from: 'chiff', to: 'breath.level', by: 0.7 },
      { from: 'velocity', to: 'breath.level', by: 0.3 },
      { from: 'velocity', to: 'drive.drive', by: 0.3 },
      { from: 'vibrato', to: 'voice.pitch', by: 0.12 },
    ],
    amp: { attack: 0.04, decay: 0.3, sustain: 0.9, release: 0.25 },
    voice: { mode: 'Legato', glide: 0.03 },
    effects: [widened(1.1, 150)],
    sends: { c: 0.45 },
  }),
  preset('Whistle', 'Lead', {
    // A sine an octave up, scooped into each note, with a vibrato and a
    // hiss of air the harder it is blown
    inputs: {
      tone: { kind: 'osc', wave: 'Sine', octave: 1, phase: 'Free' },
      air: { kind: 'noise' },
    },
    chains: {
      main: { sends: { tone: 1 } },
      breath: {
        level: 0,
        sends: { air: 0.2 },
        items: { hiss: { kind: 'filter', type: 'HP', cutoff: 5000 } },
      },
    },
    modulators: {
      scoop: { kind: 'env', attack: 0.001, decay: 0.07 },
      vibrato: { kind: 'lfo', rate: 5.5, fade: 0.3 },
    },
    routes: [
      { from: 'scoop', to: 'voice.pitch', by: -1 },
      { from: 'velocity', to: 'breath.level', by: 0.6 },
      { from: 'vibrato', to: 'voice.pitch', by: 0.15 },
    ],
    amp: { attack: 0.02, decay: 0.2, sustain: 0.9, release: 0.12 },
    voice: { mode: 'Legato', glide: 0.06 },
    effects: [pingPong(0.2, 0.3), widened(1.1, 150)],
    sends: { c: 0.3 },
  }),
  preset('Glide Lead', 'Lead', {
    // A saw and a pulse a little apart, held as one line and gliding
    // between its notes, a touch driven and echoed
    inputs: {
      saw: { kind: 'osc' },
      pulse: { kind: 'osc', wave: 'Square', width: 0.4, fine: 7 },
    },
    chains: {
      main: {
        sends: { saw: 0.7, pulse: 0.5 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 2200,
            resonance: 0.25,
            keytrack: 0.2,
          },
          drive: { kind: 'drive', drive: 0.1 },
        },
      },
    },
    modulators: {
      filterEnv: { kind: 'env', attack: 0.005, decay: 0.4, sustain: 0.4 },
    },
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 1.2 }],
    amp: { attack: 0.005, decay: 0.3, sustain: 0.85, release: 0.2 },
    voice: { mode: 'Legato', glide: 0.12 },
    effects: [pingPong(0.2, 0.35), widened(1.1, 150)],
    sends: { c: 0.2 },
  }),

  preset('Lush Pad', 'Pad', {
    // Seven saws spread wide and a softer stack an octave up, a lowpass
    // over them breathing slowly, chorused, wide and in a hall
    inputs: {
      stack: {
        kind: 'super',
        voices: 7,
        detune: 30,
        blend: 0.8,
        phase: 'Free',
      },
      high: {
        kind: 'super',
        voices: 4,
        detune: 20,
        octave: 1,
        wave: 'Triangle',
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { stack: 0.7, high: 0.4 },
        items: { filter: { kind: 'filter', cutoff: 3000, keytrack: 0.3 } },
      },
    },
    modulators: {
      breathe: { kind: 'lfo', shape: 'Smooth', rate: 0.15, trigger: 'Free' },
    },
    routes: [{ from: 'breathe', to: 'filter.cutoff', by: 0.5 }],
    amp: { attack: 0.6, decay: 1, sustain: 0.9, release: 1.6 },
    effects: [
      { kind: 'chorus', rate: 0.25, depth: 0.5, mix: 0.35 },
      widened(1.3, 150),
    ],
    sends: { c: 0.6 },
  }),
  preset('Dark Pad', 'Pad', {
    // Two saws beating under a resonant lowpass that wanders low, a sine
    // under them, driven a little: a minor chord in the dark
    inputs: {
      saw: { kind: 'osc' },
      beating: { kind: 'osc', fine: -9 },
      sub: { kind: 'osc', wave: 'Sine', octave: -1 },
    },
    chains: {
      main: {
        sends: { saw: 0.6, beating: 0.6, sub: 0.35 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 480,
            resonance: 0.3,
            keytrack: 0.3,
          },
          drive: { kind: 'drive', drive: 0.25 },
        },
      },
    },
    modulators: {
      wander: { kind: 'lfo', shape: 'Smooth', rate: 0.1, trigger: 'Free' },
    },
    routes: [{ from: 'wander', to: 'filter.cutoff', by: 0.8 }, spread(0.4)],
    amp: { attack: 1, decay: 1, sustain: 0.9, release: 2 },
    effects: [
      { kind: 'chorus', rate: 0.2, depth: 0.4, mix: 0.3 },
      widened(1.2, 150),
    ],
    sends: { c: 0.6 },
  }),
  preset('Tape Pad', 'Pad', {
    // Triangles and a soft saw dulled and saturated, the whole chord
    // wavering as a worn tape does (a slow wow, a faster flutter)
    inputs: {
      tri: { kind: 'osc', wave: 'Triangle' },
      saw: { kind: 'osc', fine: 5 },
    },
    chains: {
      main: {
        sends: { tri: 0.8, saw: 0.35 },
        items: {
          filter: { kind: 'filter', cutoff: 1800, keytrack: 0.3 },
          drive: { kind: 'drive', drive: 0.35 },
        },
      },
    },
    modulators: {
      wow: { kind: 'lfo', shape: 'Smooth', rate: 0.6, trigger: 'Free' },
      flutter: { kind: 'lfo', rate: 6.5, trigger: 'Free' },
    },
    routes: [
      { from: 'wow', to: 'voice.pitch', by: 0.15 },
      { from: 'flutter', to: 'voice.pitch', by: 0.04 },
    ],
    amp: { attack: 0.4, decay: 1, sustain: 0.85, release: 1.2 },
    effects: [
      { kind: 'eq', cut: 120, high: -6, highFreq: 6000 },
      { kind: 'chorus', rate: 0.4, depth: 0.3, mix: 0.25 },
      widened(1.1, 150),
    ],
    sends: { c: 0.45 },
  }),

  preset('String Swell', 'Strings', {
    // A section of saws growing from nothing as the bow presses, its
    // lowpass opening with it and a vibrato coming in
    inputs: {
      section: {
        kind: 'super',
        voices: 6,
        detune: 18,
        blend: 0.8,
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { section: 1 },
        items: { filter: { kind: 'filter', cutoff: 1000 } },
      },
    },
    modulators: {
      bow: { kind: 'env', attack: 1.8, decay: 1, sustain: 1, release: 1 },
      vibrato: { kind: 'lfo', rate: 5, fade: 1.2 },
    },
    routes: [
      { from: 'bow', to: 'filter.cutoff', by: 2 },
      { from: 'vibrato', to: 'voice.pitch', by: 0.1 },
      // A section's low strings carry as far as its high ones
      { from: 'key', to: 'amp.gain', by: -0.5 },
      spread(0.4),
    ],
    amp: { attack: 1.4, decay: 1, sustain: 1, release: 1.2 },
    effects: [
      { kind: 'eq', cut: 70, mid: 2, midFreq: 2500 },
      { kind: 'chorus', rate: 0.3, depth: 0.4, mix: 0.3 },
      widened(1.3, 150),
    ],
    sends: { c: 0.6 },
  }),
  preset('Staccato Strings', 'Strings', {
    // The section bowed short and hard, each stroke's start the brightest:
    // a trailer's ostinato
    inputs: {
      section: {
        kind: 'super',
        voices: 5,
        detune: 15,
        blend: 0.8,
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { section: 1 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 1100,
            resonance: 0.1,
            keytrack: 0.5,
          },
          // Glued: the section's strokes as one
          glue: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: {
      stroke: { kind: 'env', attack: 0.02, decay: 0.15, sustain: 0.3 },
    },
    routes: [
      { from: 'stroke', to: 'filter.cutoff', by: 1.5, via: 'velocity' },
      spread(0.4),
    ],
    amp: { attack: 0.015, decay: 0.3, sustain: 0.35, release: 0.12 },
    effects: [
      { kind: 'eq', cut: 120, mid: 2, midFreq: 2500 },
      widened(1.2, 150),
    ],
    sends: { c: 0.4 },
  }),
  preset('Tremolo Strings', 'Strings', {
    // The section bowed back and forth as fast as it can, each player
    // their own, under a lowpass
    inputs: {
      section: {
        kind: 'super',
        voices: 6,
        detune: 16,
        blend: 0.8,
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { section: 1 },
        items: { filter: { kind: 'filter', cutoff: 1600, keytrack: 0.5 } },
      },
    },
    modulators: {
      bowing: { kind: 'lfo', shape: 'Triangle', rate: 11 },
    },
    routes: [
      { from: 'bowing', to: 'amp.gain', by: -0.35 },
      { from: 'random', to: 'bowing.rate', by: 0.3 },
      spread(0.5),
    ],
    amp: { attack: 0.15, decay: 1, sustain: 1, release: 0.6 },
    effects: [
      { kind: 'eq', cut: 140, mid: 2, midFreq: 2500 },
      { kind: 'chorus', rate: 0.3, depth: 0.3, mix: 0.25 },
      widened(1.3, 150),
    ],
    sends: { c: 0.5 },
  }),

  preset('Horn Section', 'Brass', {
    // Saws a little apart, sung through an "ah" and driven, the lowpass
    // blooming just after each note starts: a section's blare
    inputs: {
      section: {
        kind: 'super',
        voices: 4,
        detune: 12,
        blend: 0.8,
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { section: 1 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 550,
            resonance: 0.1,
            keytrack: 0.5,
          },
          mouth: { kind: 'formant', vowel: 0, resonance: 0.5, mix: 0.35 },
          drive: { kind: 'drive', drive: 0.25 },
        },
      },
    },
    modulators: {
      blare: { kind: 'env', attack: 0.05, decay: 0.5, sustain: 0.5 },
    },
    routes: [
      { from: 'blare', to: 'filter.cutoff', by: 2.5, via: 'velocity' },
      spread(0.35),
    ],
    amp: { attack: 0.03, decay: 0.4, sustain: 0.9, release: 0.2 },
    effects: [{ kind: 'eq', cut: 120 }, widened(1.2, 150)],
    sends: { c: 0.4 },
  }),
  preset('Trumpet', 'Brass', {
    // One saw, as one player: lipped up into each note, its lowpass
    // brighter the harder it is blown, the vibrato setting in late
    inputs: { saw: { kind: 'osc' } },
    chains: {
      main: {
        sends: { saw: 1 },
        items: {
          filter: { kind: 'filter', cutoff: 800, keytrack: 0.6 },
          mouth: { kind: 'formant', vowel: 0, shift: 2, mix: 0.3 },
          drive: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: {
      lip: { kind: 'env', attack: 0.001, decay: 0.05 },
      blow: { kind: 'env', attack: 0.04, decay: 0.5, sustain: 0.6 },
      vibrato: { kind: 'lfo', rate: 5.5, fade: 0.6 },
    },
    routes: [
      { from: 'lip', to: 'voice.pitch', by: -0.8 },
      { from: 'blow', to: 'filter.cutoff', by: 2.5, via: 'velocity' },
      { from: 'vibrato', to: 'voice.pitch', by: 0.1 },
    ],
    amp: { attack: 0.03, decay: 0.3, sustain: 0.9, release: 0.15 },
    voice: { mode: 'Legato', glide: 0.03 },
    effects: [{ kind: 'eq', cut: 200, mid: 2, midFreq: 1500 }],
    sends: { c: 0.35 },
  }),
  preset('French Horn', 'Brass', {
    // A triangle and a saw low, mellow through an "oh", the lowpass
    // opening slowly: a horn's round call in a hall
    inputs: {
      tri: { kind: 'osc', wave: 'Triangle' },
      saw: { kind: 'osc', fine: -4 },
    },
    chains: {
      main: {
        sends: { tri: 0.6, saw: 0.6 },
        items: {
          filter: { kind: 'filter', cutoff: 420, keytrack: 0.5 },
          mouth: { kind: 'formant', vowel: 3, resonance: 0.4, mix: 0.4 },
        },
      },
    },
    modulators: {
      blow: { kind: 'env', attack: 0.1, decay: 0.8, sustain: 0.6 },
      vibrato: { kind: 'lfo', rate: 5, fade: 0.8 },
    },
    routes: [
      { from: 'blow', to: 'filter.cutoff', by: 2, via: 'velocity' },
      { from: 'vibrato', to: 'voice.pitch', by: 0.06 },
      spread(0.3),
    ],
    amp: { attack: 0.07, decay: 0.5, sustain: 0.9, release: 0.35 },
    effects: [widened(1.1, 150)],
    sends: { c: 0.55 },
  }),

  preset('Ocean', 'Atmos', {
    // Noise under a lowpass that rises and falls as a wave breaks every
    // ten seconds, a hiss of spray on top, washing from side to side
    inputs: { sea: { kind: 'noise' } },
    chains: {
      swell: {
        sends: { sea: 1 },
        items: {
          filter: { kind: 'filter', cutoff: 700, resonance: 0.1 },
          drive: { kind: 'drive', drive: 0.3 },
        },
      },
      spray: {
        level: 0.3,
        sends: { sea: 0.3 },
        items: { hiss: { kind: 'filter', type: 'HP', cutoff: 4000 } },
      },
    },
    modulators: {
      wave: { kind: 'lfo', rate: 0.1, trigger: 'Free' },
      surge: { kind: 'lfo', shape: 'Smooth', rate: 0.3, trigger: 'Free' },
    },
    routes: [
      { from: 'wave', to: 'filter.cutoff', by: 1.6 },
      { from: 'wave', to: 'swell.level', by: 0.4 },
      { from: 'wave', to: 'spray.level', by: 0.3 },
      { from: 'surge', to: 'filter.cutoff', by: 0.4 },
      { from: 'surge', to: 'amp.pan', by: 0.5 },
    ],
    amp: { attack: 1.5, decay: 1, sustain: 1, release: 2.5 },
    effects: [widened(1.5, 150)],
    sends: { c: 0.4 },
  }),
  preset('Deep Space', 'Atmos', {
    // A sine an octave down and a high glint of FM over it, slowly
    // changing, in a long echo and a longer hall
    inputs: {
      deep: { kind: 'osc', wave: 'Sine', octave: -1, phase: 'Free' },
      glint: {
        kind: 'osc',
        wave: 'Sine',
        octave: 2,
        fm: 0.1,
        fmSource: 'star',
      },
      star: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
      dust: { kind: 'noise' },
    },
    chains: {
      main: { sends: { deep: 0.7, glint: 0.12 } },
      nebula: {
        sends: { dust: 0.08 },
        items: {
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 2500,
            resonance: 0.6,
          },
        },
      },
    },
    modulators: {
      drift: { kind: 'lfo', shape: 'Smooth', rate: 0.07, trigger: 'Free' },
      twinkle: { kind: 'lfo', shape: 'Smooth', rate: 0.3, trigger: 'Free' },
    },
    routes: [
      { from: 'drift', to: 'band.cutoff', by: 1.5 },
      { from: 'twinkle', to: 'glint.fm', by: 0.15 },
      { from: 'twinkle', to: 'main.send.glint', by: 0.08 },
      { from: 'drift', to: 'amp.pan', by: 0.4 },
    ],
    amp: { attack: 2, decay: 1, sustain: 1, release: 3 },
    effects: [pingPong(0.3, 0.5, '1/4D'), widened(1.4, 150)],
    sends: { c: 0.7 },
  }),
  preset('Metal Drone', 'Atmos', {
    // A square and a saw a tritone apart, ring-modulated into a comb that
    // drifts: metal humming in a tunnel
    inputs: {
      square: { kind: 'osc', wave: 'Square', width: 0.3 },
      saw: { kind: 'osc', semi: 6, fine: 13 },
      metal: { kind: 'ring', a: 'square', b: 'saw' },
    },
    chains: {
      main: {
        sends: { metal: 1 },
        items: {
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 900,
            resonance: 0.4,
          },
          tube: { kind: 'comb', decay: 0.8, damp: 0.5, mix: 0.5 },
          drive: { kind: 'drive', drive: 0.4 },
        },
      },
    },
    modulators: {
      wander: { kind: 'lfo', shape: 'Smooth', rate: 0.08, trigger: 'Free' },
      sway: { kind: 'lfo', shape: 'Smooth', rate: 0.05, trigger: 'Free' },
    },
    routes: [
      { from: 'wander', to: 'band.cutoff', by: 1.5 },
      { from: 'sway', to: 'tube.tune', by: 0.4 },
      { from: 'sway', to: 'amp.pan', by: 0.5 },
    ],
    amp: { attack: 1.5, decay: 1, sustain: 1, release: 2.5 },
    effects: [
      { kind: 'phaser', rate: 0.1, depth: 0.6, feedback: 0.4, mix: 0.4 },
      widened(1.3, 150),
    ],
    sends: { c: 0.6 },
  }),

  preset('Punch Kick', 'Drums', {
    // A sine struck three octaves high and dropping to G1 in a few
    // hundredths of a second, a tick of noise on top, driven for punch
    inputs: {
      body: { kind: 'osc', wave: 'Sine', octave: -2, semi: -5 },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { body: 0.9 },
        items: { drive: { kind: 'drive', drive: 0.35 } },
      },
      click: {
        level: 0,
        sends: { noise: 0.6 },
        items: { filter: { kind: 'filter', type: 'HP', cutoff: 3000 } },
      },
    },
    modulators: {
      drop: { kind: 'env', attack: 0.001, decay: 0.05 },
      tick: { kind: 'env', attack: 0.001, decay: 0.012 },
    },
    routes: [
      { from: 'drop', to: 'voice.pitch', by: 30 },
      { from: 'tick', to: 'click.level', by: 1 },
    ],
    amp: {
      attack: 0.001,
      decay: 0.5,
      sustain: 0,
      release: 0.05,
      velocity: 0.8,
    },
  }),
  preset('Deep Kick', 'Drums', {
    // A round sine on F1, snapped down two octaves into its note and held
    // half a second, with a soft click
    inputs: {
      body: { kind: 'osc', wave: 'Sine', octave: -2, semi: -7 },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { body: 1 },
        items: { drive: { kind: 'drive', drive: 0.15 } },
      },
      click: {
        level: 0,
        sends: { noise: 0.4 },
        items: { filter: { kind: 'filter', cutoff: 1800 } },
      },
    },
    modulators: {
      drop: { kind: 'env', attack: 0.001, decay: 0.035 },
      tick: { kind: 'env', attack: 0.001, decay: 0.01 },
    },
    routes: [
      { from: 'drop', to: 'voice.pitch', by: 24 },
      { from: 'tick', to: 'click.level', by: 1 },
    ],
    amp: { attack: 0.001, decay: 1, sustain: 0, release: 0.1, velocity: 0.8 },
  }),
  preset('Tight Snare', 'Drums', {
    // Two sines a little under 200 and over 300 hertz, bent down as
    // struck, under a band of noise that snaps and is gone
    inputs: {
      low: { kind: 'osc', wave: 'Sine', semi: -5 },
      high: { kind: 'osc', wave: 'Sine', semi: 4 },
      noise: { kind: 'noise' },
    },
    chains: {
      tone: { level: 0, sends: { low: 0.5, high: 0.35 } },
      wires: {
        sends: { noise: 0.56 },
        items: {
          lowCut: { kind: 'filter', type: 'HP', cutoff: 1500 },
          filter: { kind: 'filter', cutoff: 9000 },
          crack: { kind: 'drive', drive: 0.5 },
        },
      },
    },
    modulators: {
      drop: { kind: 'env', attack: 0.001, decay: 0.03 },
      body: { kind: 'env', attack: 0.001, decay: 0.12 },
    },
    routes: [
      { from: 'drop', to: 'voice.pitch', by: 5 },
      { from: 'body', to: 'tone.level', by: 1 },
    ],
    amp: {
      attack: 0.001,
      decay: 0.3,
      sustain: 0,
      release: 0.05,
      velocity: 0.8,
    },
  }),
  preset('Tambourine', 'Drums', {
    // High squares ring-modulated into jingles and a hiss of noise, the
    // jingles rattling a few times as they settle
    inputs: {
      square: { kind: 'osc', wave: 'Square', octave: 2, semi: 9 },
      square2: { kind: 'osc', wave: 'Square', octave: 2, semi: 2, fine: 30 },
      noise: { kind: 'noise' },
      metal: { kind: 'ring', a: 'square', b: 'square2' },
    },
    chains: {
      main: {
        sends: { noise: 0.5, metal: 0.5 },
        items: {
          filter: { kind: 'filter', type: 'HP', cutoff: 6000, resonance: 0.3 },
        },
      },
    },
    modulators: { rattle: { kind: 'lfo', shape: 'Triangle', rate: 28 } },
    routes: [{ from: 'rattle', to: 'main.level', by: -0.4 }],
    amp: {
      attack: 0.001,
      decay: 0.25,
      sustain: 0,
      release: 0.1,
      velocity: 0.6,
      pan: 0.35,
    },
  }),
  preset('Ride', 'Drums', {
    // Ring-modulated squares through a highpass, ringing long, with a
    // sine's ping on top as the stick strikes near the bell
    inputs: {
      square: { kind: 'osc', wave: 'Square', octave: 1, semi: 5 },
      square2: { kind: 'osc', wave: 'Square', octave: 1, semi: 11, fine: 40 },
      ping: { kind: 'osc', wave: 'Sine', octave: 1, semi: 3 },
      noise: { kind: 'noise' },
      metal: { kind: 'ring', a: 'square', b: 'square2' },
    },
    chains: {
      main: {
        sends: { metal: 0.3, noise: 0.08 },
        items: {
          filter: { kind: 'filter', type: 'HP', cutoff: 3500, resonance: 0.2 },
        },
      },
      bell: { level: 0, sends: { ping: 0.15 } },
    },
    modulators: { strike: { kind: 'env', attack: 0.001, decay: 0.4 } },
    routes: [{ from: 'strike', to: 'bell.level', by: 1 }],
    amp: {
      attack: 0.001,
      decay: 2.5,
      sustain: 0,
      release: 0.8,
      velocity: 0.6,
      pan: 0.3,
    },
  }),
  preset('Woodblock', 'Drums', {
    // A triangle and a sine at a wooden bar's second mode, 2.777 times
    // up, both through a resonant band, struck and gone: hollow wood
    inputs: {
      tone: { kind: 'osc', wave: 'Triangle', octave: 1, semi: 2 },
      partial: { kind: 'osc', wave: 'Sine', octave: 2, semi: 8, fine: -31 },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { tone: 0.9, partial: 0.35, noise: 0.11 },
        items: {
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 1100,
            resonance: 0.6,
            keytrack: 1,
          },
        },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.02 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 2 }],
    amp: {
      attack: 0.001,
      decay: 0.09,
      sustain: 0,
      release: 0.04,
      velocity: 0.7,
      pan: -0.25,
    },
  }),

  preset('Laser', 'FX', {
    // A square diving two octaves in a few tenths of a second through a
    // resonant lowpass that dives with it, echoed side to side
    inputs: { square: { kind: 'osc', wave: 'Square', width: 0.3 } },
    chains: {
      main: {
        sends: { square: 1 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 2500,
            resonance: 0.2,
            keytrack: 1,
          },
        },
      },
    },
    modulators: { dive: { kind: 'env', attack: 0.001, decay: 0.4 } },
    routes: [
      { from: 'dive', to: 'voice.pitch', by: 24 },
      { from: 'dive', to: 'filter.cutoff', by: 2 },
      { from: 'random', to: 'amp.pan', by: 0.5 },
    ],
    amp: { attack: 0.001, decay: 0.6, sustain: 0.5, release: 0.1 },
    effects: [pingPong(0.3, 0.4, '1/16')],
    sends: { c: 0.2 },
  }),
  preset('Bubbles', 'FX', {
    // A sine chirping up from a new pitch nine times a second, each chirp
    // swelling and gone: bubbles rising through water
    inputs: { sine: { kind: 'osc', wave: 'Sine', octave: 1 } },
    chains: {
      main: {
        sends: { sine: 1 },
        items: { filter: { kind: 'filter', cutoff: 3000 } },
      },
    },
    modulators: {
      pick: { kind: 'lfo', shape: 'S&H', rate: 9 },
      chirp: { kind: 'lfo', shape: 'Saw', rate: 9 },
      swell: { kind: 'lfo', shape: 'Triangle', rate: 9 },
    },
    routes: [
      { from: 'pick', to: 'voice.pitch', by: 7 },
      { from: 'chirp', to: 'voice.pitch', by: 3 },
      { from: 'swell', to: 'amp.gain', by: -0.8 },
      { from: 'pick', to: 'amp.pan', by: 0.6 },
    ],
    amp: { attack: 0.01, decay: 1, sustain: 1, release: 0.2 },
    effects: [pingPong(0.2, 0.3, '1/16')],
    sends: { c: 0.4 },
  }),

  preset('Muted Guitar', 'Pluck', {
    // A pick's burst into a comb, cut short at once by the palm: a short,
    // dark thunk on the note
    inputs: { pick: { kind: 'noise' } },
    chains: {
      string: {
        sends: { pick: 0.03 },
        items: {
          tone: { kind: 'filter', cutoff: 2500, keytrack: 0.3 },
          body: { kind: 'comb', decay: 1, damp: 0.45 },
          warmth: { kind: 'drive', drive: 0.7 },
        },
      },
    },
    modulators: plucked('string', 'pick', 0.015).modulators,
    routes: [
      ...plucked('string', 'pick', 0.015).routes,
      { from: 'velocity', to: 'tone.cutoff', by: 1.5 },
      { from: 'key', to: 'amp.gain', by: -0.5 },
      keyPan(0.4),
    ],
    // The palm: the amp, not the string, cuts the ring short
    amp: { attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.08 },
    effects: [
      { kind: 'eq', mid: 3, midFreq: 220 },
      { kind: 'doubler', detune: 5, time: 0.01, mix: 0.25 },
      widened(1.1, 150),
    ],
    sends: { c: 0.15 },
  }),
  preset('Banjo', 'Pluck', {
    // A bright, hard pick into a comb that rings briefly, a skin head's
    // twang lifted around a kilohertz and a half
    inputs: { pick: { kind: 'noise' } },
    chains: {
      string: {
        sends: { pick: 0.015 },
        items: {
          tone: { kind: 'filter', cutoff: 2500, keytrack: 0.3 },
          body: { kind: 'comb', decay: 1.2, damp: 0.15 },
          warmth: { kind: 'drive', drive: 0.4 },
        },
      },
    },
    modulators: plucked('string', 'pick', 0.004).modulators,
    routes: [
      ...plucked('string', 'pick', 0.004).routes,
      { from: 'velocity', to: 'tone.cutoff', by: 2 },
      { from: 'key', to: 'amp.gain', by: -0.5 },
      keyPan(0.3),
    ],
    amp: { attack: 0.001, sustain: 1, release: 0.25, velocity: 0.5 },
    effects: [
      {
        kind: 'eq',
        cut: 200,
        midFreq: 1500,
        mid: 6,
        q3: 1.5,
        g4: -3,
        f4: 4500,
      },
      widened(1.1, 150),
    ],
    sends: { c: 0.2 },
  }),
  preset('Future Pluck', 'Pluck', {
    // Five saws and a sine an octave up, struck a fifth high and dropped
    // to the note, a lowpass snapped shut: a chord stab's sparkle
    inputs: {
      stack: {
        kind: 'super',
        voices: 5,
        detune: 22,
        blend: 0.8,
        phase: 'Free',
      },
      top: { kind: 'osc', wave: 'Sine', octave: 1, phase: 'Free' },
    },
    chains: {
      main: {
        sends: { stack: 1, top: 0.4 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 700,
            resonance: 0.15,
            keytrack: 0.5,
          },
          drive: { kind: 'drive', drive: 0.25 },
        },
      },
    },
    modulators: {
      snap: { kind: 'env', attack: 0.001, decay: 0.22 },
      blip: { kind: 'env', attack: 0.001, decay: 0.02 },
    },
    routes: [
      { from: 'snap', to: 'filter.cutoff', by: 3.5, via: 'velocity' },
      { from: 'blip', to: 'voice.pitch', by: 7 },
    ],
    amp: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
    effects: [
      { kind: 'chorus', rate: 0.5, depth: 0.4, mix: 0.3 },
      pingPong(0.25, 0.35),
      widened(1.3, 150),
    ],
    sends: { c: 0.35 },
  }),

  preset('Pizzicato', 'Strings', {
    // A section's fingers plucking: a soft burst into a comb whose ring a
    // wooden body takes quickly, doubled, in a hall
    inputs: { pick: { kind: 'noise' } },
    chains: {
      string: {
        sends: { pick: 0.018 },
        items: {
          tone: { kind: 'filter', cutoff: 1800, keytrack: 0.6 },
          body: { kind: 'comb', decay: 0.6, damp: 0.45 },
          warmth: { kind: 'drive', drive: 0.45 },
        },
      },
    },
    modulators: plucked('string', 'pick', 0.012).modulators,
    routes: [
      ...plucked('string', 'pick', 0.012).routes,
      { from: 'velocity', to: 'tone.cutoff', by: 1.5 },
      { from: 'key', to: 'amp.gain', by: -0.5 },
      spread(0.4),
    ],
    amp: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.15 },
    effects: [
      { kind: 'eq', mid: 4, midFreq: 300, g4: 2, f4: 2500 },
      { kind: 'doubler', detune: 8, time: 0.015, mix: 0.4 },
      widened(1.2, 150),
    ],
    sends: { c: 0.45 },
  }),

  preset('Crystal Pad', 'Pad', {
    // Triangles an octave up a little apart and a sine on the note, the
    // stack's spread breathing, phased slowly and echoed: ice
    inputs: {
      ice: {
        kind: 'super',
        wave: 'Triangle',
        voices: 4,
        detune: 15,
        octave: 1,
        phase: 'Free',
      },
      core: { kind: 'osc', wave: 'Sine', phase: 'Free' },
    },
    chains: { main: { sends: { ice: 0.6, core: 0.5 } } },
    modulators: {
      breathe: { kind: 'lfo', shape: 'Triangle', rate: 0.2, trigger: 'Free' },
    },
    routes: [{ from: 'breathe', to: 'ice.detune', by: 0.1 }, spread(0.4)],
    amp: { attack: 0.8, decay: 1, sustain: 0.9, release: 2 },
    effects: [
      { kind: 'phaser', rate: 0.15, depth: 0.5, feedback: 0.3, mix: 0.3 },
      pingPong(0.2, 0.45, '1/4D'),
      widened(1.3, 150),
    ],
    sends: { c: 0.6 },
  }),

  preset('Reed Piano', 'Keys', {
    // A triangle and a square under a lowpass the hammer throws open, the
    // reed's bark a drive that grows with the strike, its tremolo
    // swinging the level
    inputs: {
      tri: { kind: 'osc', wave: 'Triangle' },
      square: { kind: 'osc', wave: 'Square', width: 0.5 },
    },
    chains: {
      main: {
        sends: { tri: 0.8, square: 0.25 },
        items: {
          filter: { kind: 'filter', cutoff: 900, keytrack: 0.6 },
          bark: { kind: 'drive', drive: 0.15 },
        },
      },
    },
    modulators: {
      hammer: { kind: 'env', attack: 0.001, decay: 0.35, sustain: 0.2 },
      tremolo: { kind: 'lfo', rate: 5.5, trigger: 'Free' },
    },
    routes: [
      { from: 'hammer', to: 'filter.cutoff', by: 2.5, via: 'velocity' },
      { from: 'velocity', to: 'bark.drive', by: 0.4 },
      { from: 'tremolo', to: 'amp.gain', by: -0.2 },
      keyPan(0.3),
    ],
    amp: {
      attack: 0.001,
      decay: 1.6,
      sustain: 0.2,
      release: 0.25,
      velocity: 0.6,
    },
    effects: [widened(1.1, 120)],
    sends: { c: 0.2 },
  }),
  preset('Harpsichord', 'Keys', {
    // Each key's quill plucking two strings, one an octave over the other
    // (eight and four foot), bright combs that ring and are damped as the
    // key lifts
    inputs: { quill: { kind: 'noise' } },
    chains: {
      eight: {
        sends: { quill: 0.02 },
        items: {
          tone: { kind: 'filter', cutoff: 2500, keytrack: 0.3 },
          string: { kind: 'comb', decay: 3, damp: 0.15 },
          jack: { kind: 'drive', drive: 0.2 },
        },
      },
      four: {
        level: 0.5,
        sends: { quill: 0.02 },
        items: {
          tone4: { kind: 'filter', cutoff: 2500, keytrack: 0.3 },
          string4: { kind: 'comb', tune: 12, decay: 2.5, damp: 0.15 },
          jack4: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: {
      pluck: { kind: 'env', attack: 0.001, decay: 0.004 },
      damper: { kind: 'env', attack: 0.008, sustain: 1, release: 10 },
    },
    routes: [
      { from: 'pluck', to: 'eight.send.quill', by: 1 },
      { from: 'damper', to: 'eight.send.quill', by: -1 },
      { from: 'pluck', to: 'four.send.quill', by: 1 },
      { from: 'damper', to: 'four.send.quill', by: -1 },
      { from: 'velocity', to: 'tone.cutoff', by: 2 },
      { from: 'velocity', to: 'tone4.cutoff', by: 2 },
      { from: 'key', to: 'amp.gain', by: -0.5 },
      keyPan(0.4),
    ],
    amp: { attack: 0.001, sustain: 1, release: 0.12, velocity: 0.55 },
    effects: [{ kind: 'eq', cut: 120, g4: 2, f4: 3000 }, widened(1.1, 120)],
    sends: { c: 0.3 },
  }),
  preset('Pipe Organ', 'Keys', {
    // Flue pipes at eight, four and two foot and a mixture's fifth, each
    // speaking with a chiff of wind, in a stone church
    inputs: {
      p8: { kind: 'osc', wave: 'Triangle' },
      p4: { kind: 'osc', wave: 'Sine', octave: 1 },
      p2: { kind: 'osc', wave: 'Triangle', octave: 2 },
      fifth: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
      wind: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { p8: 0.6, p4: 0.4, p2: 0.12, fifth: 0.1 },
        items: { filter: { kind: 'filter', cutoff: 6000, keytrack: 0.3 } },
      },
      chiff: {
        level: 0,
        sends: { wind: 0.3 },
        items: {
          band: {
            kind: 'filter',
            type: 'BP',
            cutoff: 1500,
            resonance: 0.5,
            keytrack: 1,
          },
        },
      },
    },
    modulators: { speak: { kind: 'env', attack: 0.01, decay: 0.07 } },
    routes: [{ from: 'speak', to: 'chiff.level', by: 1 }, keyPan(0.4)],
    amp: { attack: 0.06, decay: 0.2, sustain: 1, release: 0.3 },
    effects: [widened(1.1, 120)],
    sends: { c: 0.65 },
  }),
  preset('Lo-fi Keys', 'Keys', {
    // An electric piano's FM tine, dulled and saturated, the chord
    // wavering as a worn tape's wow and flutter carry it
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.08, fmSource: 'modulator' },
      modulator: { kind: 'osc', wave: 'Sine' },
    },
    chains: {
      main: {
        sends: { carrier: 1 },
        items: {
          filter: { kind: 'filter', cutoff: 2600, keytrack: 0.3 },
          drive: { kind: 'drive', drive: 0.35 },
        },
      },
    },
    modulators: {
      tine: { kind: 'env', decay: 0.8 },
      wow: { kind: 'lfo', shape: 'Smooth', rate: 0.7, trigger: 'Free' },
      flutter: { kind: 'lfo', rate: 6, trigger: 'Free' },
    },
    routes: [
      { from: 'tine', to: 'carrier.fm', by: 0.3, via: 'velocity' },
      { from: 'wow', to: 'voice.pitch', by: 0.15 },
      { from: 'flutter', to: 'voice.pitch', by: 0.04 },
      keyPan(0.3),
    ],
    amp: {
      attack: 0.002,
      decay: 1.8,
      sustain: 0.2,
      release: 0.4,
      velocity: 0.6,
    },
    effects: [
      { kind: 'eq', cut: 70, high: -6, highFreq: 5000 },
      { kind: 'chorus', rate: 0.6, depth: 0.3, mix: 0.25 },
      widened(1.1, 120),
    ],
    sends: { c: 0.3 },
  }),
  preset('Accordion', 'Keys', {
    // Three reeds of narrow pulses, one on the note and two beating a few
    // cents either side of it (a musette), nasal, breathed by the bellows
    inputs: {
      reed: { kind: 'osc', wave: 'Square', width: 0.3 },
      sharp: { kind: 'osc', wave: 'Square', width: 0.3, fine: 12 },
      flat: { kind: 'osc', wave: 'Square', width: 0.3, fine: -12 },
    },
    chains: {
      main: {
        sends: { reed: 0.4, sharp: 0.3, flat: 0.3 },
        items: { filter: { kind: 'filter', cutoff: 2800, keytrack: 0.4 } },
      },
    },
    routes: [keyPan(0.3)],
    amp: { attack: 0.05, decay: 0.2, sustain: 1, release: 0.12 },
    effects: [
      { kind: 'eq', cut: 150, mid: 4, midFreq: 1400, q3: 1.2 },
      widened(1.1, 120),
    ],
    sends: { c: 0.25 },
  }),

  preset('Music Box', 'Bell', {
    // A comb's tines plucked by the drum's pins: sines, each
    // with a partial a little over six times up that rings only briefly,
    // and a tick of the pin
    inputs: {
      tine: { kind: 'osc', wave: 'Sine', phase: 'Free' },
      partial: { kind: 'osc', wave: 'Sine', octave: 2, semi: 8, fine: -14 },
      tick: { kind: 'noise' },
    },
    chains: {
      main: { sends: { tine: 0.8, partial: 0.01 } },
      pin: {
        level: 0,
        sends: { tick: 0.1 },
        items: { filter: { kind: 'filter', type: 'HP', cutoff: 6000 } },
      },
    },
    modulators: {
      ring: { kind: 'env', attack: 0.001, decay: 0.25 },
      click: { kind: 'env', attack: 0.001, decay: 0.008 },
    },
    routes: [
      { from: 'ring', to: 'main.send.partial', by: 0.5, via: 'velocity' },
      { from: 'click', to: 'pin.level', by: 1 },
      keyPan(0.4),
    ],
    amp: { attack: 0.001, decay: 2.5, sustain: 0, release: 1.2 },
    effects: [widened(1.1, 150)],
    sends: { c: 0.35 },
  }),
  preset('Celesta', 'Bell', {
    // A hammered bar over a resonator: a sine and its FM at the bar's
    // second mode, 2.76 times up, a metal ping for a moment, then the
    // fundamental the resonator keeps, soft and round
    inputs: {
      plate: { kind: 'osc', wave: 'Sine', fm: 0.04, fmSource: 'hammer' },
      hammer: { kind: 'osc', wave: 'Sine', octave: 1, semi: 6, fine: -43 },
    },
    chains: { main: { sends: { plate: 1 } } },
    modulators: { strike: { kind: 'env', attack: 0.001, decay: 0.3 } },
    routes: [
      { from: 'strike', to: 'plate.fm', by: 0.6, via: 'velocity' },
      keyPan(0.4),
    ],
    amp: { attack: 0.001, decay: 2.2, sustain: 0, release: 0.8 },
    effects: [widened(1.1, 150)],
    sends: { c: 0.35 },
  }),
  preset('Steel Drum', 'Bell', {
    // A pan's note: a sine, its octave and its twelfth, the octave a few
    // cents wide, struck with a little FM and a lowpass that falls
    inputs: {
      pan: { kind: 'osc', wave: 'Sine', fm: 0.05, fmSource: 'strike' },
      octave: { kind: 'osc', wave: 'Sine', octave: 1, fine: 8 },
      twelfth: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7, fine: -10 },
      strike: { kind: 'osc', wave: 'Sine' },
    },
    chains: {
      main: {
        sends: { pan: 0.7, octave: 0.35, twelfth: 0.1 },
        items: { filter: { kind: 'filter', cutoff: 1800, keytrack: 0.8 } },
      },
    },
    modulators: {
      mallet: { kind: 'env', attack: 0.001, decay: 0.15 },
      bloom: { kind: 'env', attack: 0.02, decay: 0.3 },
    },
    routes: [
      { from: 'mallet', to: 'pan.fm', by: 0.5, via: 'velocity' },
      { from: 'bloom', to: 'main.send.octave', by: 0.3 },
      { from: 'velocity', to: 'filter.cutoff', by: 1.5 },
      { from: 'velocity', to: 'main.send.twelfth', by: 0.4 },
      keyPan(0.4),
    ],
    amp: { attack: 0.001, decay: 2.6, sustain: 0, release: 0.6 },
    effects: [widened(1.1, 150)],
    sends: { c: 0.3 },
  }),

  preset('Organ Stab', 'Chord', {
    // A minor seventh of organ pipes (a triangle at each, a sine an octave
    // over the root) from one key, keyed with a click and let go short:
    // a house organ's stab
    inputs: {
      root: { kind: 'osc', wave: 'Triangle' },
      third: { kind: 'osc', wave: 'Triangle', semi: 3 },
      fifth: { kind: 'osc', wave: 'Triangle', semi: 7 },
      seventh: { kind: 'osc', wave: 'Triangle', semi: 10 },
      upper: { kind: 'osc', wave: 'Sine', octave: 1 },
      click: { kind: 'osc', wave: 'Square', octave: 2 },
    },
    chains: {
      main: {
        sends: {
          root: 0.45,
          third: 0.45,
          fifth: 0.45,
          seventh: 0.4,
          upper: 0.35,
          click: 0.01,
        },
        items: { filter: { kind: 'filter', cutoff: 1600, keytrack: 0.3 } },
      },
    },
    modulators: { keyClick: { kind: 'env', attack: 0.001, decay: 0.012 } },
    routes: [
      { from: 'keyClick', to: 'main.send.click', by: 0.25, via: 'velocity' },
      { from: 'velocity', to: 'filter.cutoff', by: 2 },
    ],
    amp: { attack: 0.002, decay: 0.35, sustain: 0.35, release: 0.12 },
    effects: [pingPong(0.15, 0.3), widened(1.1, 120)],
    sends: { c: 0.3 },
  }),
  preset('Minor Stab', 'Chord', {
    // An open minor chord of saws (the root, its fifth, its octave and the
    // minor third over it), a resonant lowpass snapped open and driven:
    // techno's stab
    inputs: {
      root: { kind: 'osc' },
      fifth: { kind: 'osc', semi: 7, fine: 4 },
      octave: { kind: 'osc', octave: 1, fine: -4 },
      third: { kind: 'osc', octave: 1, semi: 3, fine: 3 },
    },
    chains: {
      main: {
        sends: { root: 0.55, fifth: 0.55, octave: 0.45, third: 0.45 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 450,
            resonance: 0.35,
            keytrack: 0.4,
          },
          drive: { kind: 'drive', drive: 0.3 },
        },
      },
    },
    modulators: {
      snap: { kind: 'env', attack: 0.001, decay: 0.2, sustain: 0.1 },
    },
    routes: [{ from: 'snap', to: 'filter.cutoff', by: 3.5, via: 'velocity' }],
    amp: { attack: 0.001, decay: 0.4, sustain: 0.2, release: 0.15 },
    effects: [pingPong(0.3, 0.45, '1/8D'), widened(1.2, 150)],
    sends: { c: 0.35 },
  }),
  preset('Ninth Chord', 'Chord', {
    // A major ninth of soft triangles from one key, chorused and
    // wavering a little: a neo-soul player's warm chord
    inputs: {
      root: { kind: 'osc', wave: 'Triangle' },
      third: { kind: 'osc', wave: 'Triangle', semi: 4, fine: 3 },
      fifth: { kind: 'osc', wave: 'Triangle', semi: 7, fine: -3 },
      seventh: { kind: 'osc', wave: 'Triangle', semi: 11, fine: 2 },
      ninth: { kind: 'osc', wave: 'Triangle', octave: 1, semi: 2, fine: -2 },
    },
    chains: {
      main: {
        sends: {
          root: 0.45,
          third: 0.4,
          fifth: 0.4,
          seventh: 0.35,
          ninth: 0.3,
        },
        items: {
          filter: { kind: 'filter', cutoff: 1000, keytrack: 0.3 },
          drive: { kind: 'drive', drive: 0.2 },
        },
      },
    },
    modulators: {
      hammer: { kind: 'env', attack: 0.001, decay: 0.4, sustain: 0.3 },
      wow: { kind: 'lfo', shape: 'Smooth', rate: 0.5, trigger: 'Free' },
    },
    routes: [
      { from: 'hammer', to: 'filter.cutoff', by: 2.5, via: 'velocity' },
      { from: 'wow', to: 'voice.pitch', by: 0.08 },
    ],
    amp: { attack: 0.003, decay: 1.5, sustain: 0.3, release: 0.4 },
    effects: [
      { kind: 'chorus', rate: 0.5, depth: 0.4, mix: 0.3 },
      widened(1.2, 120),
    ],
    sends: { c: 0.35 },
  }),

  preset('Aah Choir', 'Vocal', {
    // Saws a little apart and a breath, sung through a bright "ah" a few
    // semitones up (higher voices), a vibrato setting in
    inputs: {
      voices: {
        kind: 'super',
        voices: 5,
        detune: 14,
        blend: 0.8,
        phase: 'Free',
      },
      air: { kind: 'noise' },
    },
    chains: {
      choir: {
        sends: { voices: 1, air: 0.05 },
        items: {
          mouth: { kind: 'formant', vowel: 0, shift: 3, resonance: 0.8 },
          filter: { kind: 'filter', cutoff: 6000 },
        },
      },
    },
    modulators: { vibrato: { kind: 'lfo', rate: 5.2, fade: 0.8 } },
    routes: [
      { from: 'vibrato', to: 'voice.pitch', by: 0.1 },
      { from: 'key', to: 'amp.gain', by: -0.5 },
      spread(0.4),
    ],
    amp: { attack: 0.4, decay: 1, sustain: 0.9, release: 1.2 },
    effects: [
      { kind: 'chorus', rate: 0.3, depth: 0.5, mix: 0.4 },
      widened(1.3, 150),
    ],
    sends: { c: 0.55 },
  }),
  preset('Ooh Choir', 'Vocal', {
    // Triangles and saws sung through a dark "oo", soft and round, low
    // voices in a hall
    inputs: {
      voices: {
        kind: 'super',
        voices: 5,
        detune: 12,
        blend: 0.8,
        phase: 'Free',
      },
      round: { kind: 'osc', wave: 'Triangle', phase: 'Free' },
    },
    chains: {
      choir: {
        sends: { voices: 0.8, round: 0.4 },
        items: {
          mouth: { kind: 'formant', vowel: 4, resonance: 0.7 },
          filter: { kind: 'filter', cutoff: 2600 },
        },
      },
    },
    modulators: { vibrato: { kind: 'lfo', rate: 4.8, fade: 1 } },
    routes: [
      { from: 'vibrato', to: 'voice.pitch', by: 0.08 },
      { from: 'key', to: 'amp.gain', by: -0.4 },
      spread(0.4),
    ],
    amp: { attack: 0.6, decay: 1, sustain: 0.9, release: 1.5 },
    effects: [
      { kind: 'chorus', rate: 0.25, depth: 0.5, mix: 0.4 },
      widened(1.3, 150),
    ],
    sends: { c: 0.6 },
  }),
  preset('Vox Chop', 'Vocal', {
    // Saws through a formant that slides from "ee" to "ah" as each note
    // is struck, cut short and echoed: a sung syllable, chopped
    inputs: {
      singer: {
        kind: 'super',
        voices: 3,
        detune: 10,
        blend: 0.7,
        phase: 'Free',
      },
    },
    chains: {
      main: {
        sends: { singer: 1 },
        items: {
          drive: { kind: 'drive', drive: 0.1 },
          mouth: { kind: 'formant', vowel: 0, shift: 4, resonance: 0.65 },
          glue: { kind: 'drive', drive: 0.25 },
          filter: { kind: 'filter', cutoff: 3000, keytrack: 0.5 },
        },
      },
    },
    modulators: { syllable: { kind: 'env', attack: 0.001, decay: 0.12 } },
    routes: [
      { from: 'syllable', to: 'mouth.vowel', by: 2 },

      // Higher notes' harmonics stand past the formants: they follow a
      // little

      { from: 'key', to: 'mouth.shift', by: 5 },
      keyPan(0.4),
    ],
    amp: {
      attack: 0.003,
      decay: 0.45,
      sustain: 0.15,
      release: 0.12,
      velocity: 0.75,
    },
    effects: [pingPong(0.25, 0.35), widened(1.2, 150)],
    sends: { c: 0.35 },
  }),

  preset('Chip Bass', 'Bass', chipBass(-1)),
  // The same two octaves down, through a lowpass: the bass's lowest notes
  preset(
    'Chip Sub',
    'Bass',
    chipBass(-2, { filter: { kind: 'filter', cutoff: 1500 } })
  ),
  preset('NES Triangle', 'Bass', {
    // The 2A03's triangle: 32 steps of 16 levels on its DAC's DC, and no
    // volume of its own
    inputs: { triangle: { kind: 'chip', wave: 'Triangle', octave: -1 } },
    chains: { main: { sends: { triangle: 1 } } },
    amp: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.01, velocity: 0 },
    voice: { mode: 'Mono' },
  }),
  preset('Chip Lead', 'Lead', {
    ...chipPulse('25%'),
    // The vibrato sets in after the note starts
    modulators: { vibrato: { kind: 'lfo', rate: 5.5, fade: 0.25 } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.3 }],
    voice: { mode: 'Mono' },
  }),
  preset('4-bit Lead', 'Lead', {
    // A wave-table chip's (the N163's, the Game Boy's): a sine in 32 steps
    // of 16 levels, its vibrato setting in after the note starts
    inputs: { wave: { kind: 'chip', wave: 'Sine', bits: 4 } },
    chains: { main: { sends: { wave: 1 } } },
    modulators: { vibrato: { kind: 'lfo', rate: 6, fade: 0.3 } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.3 }],
    amp: { attack: 0.001, decay: 0.15, sustain: 0.8, release: 0.05 },
    voice: { mode: 'Mono' },
  }),
  preset('Chip Chords', 'Chord', {
    // A chip's saw falling to under half over a second, its lows lifted
    // hard (15 dB before its DC thumped too, which they lift as well)
    inputs: { saw: { kind: 'chip', wave: 'Saw' } },
    chains: { main: { sends: { saw: 1 } } },
    amp: { ...CHIP_AMP, decay: 1.2, sustain: 0.45 },
    effects: [
      {
        kind: 'eq',
        low: 12,
        lowFreq: 82,
        mid: -0.3,
        midFreq: 2404,
        high: 2.7,
        highFreq: 4469,
      },
    ],
  }),
  preset('Chip Pulse 12', 'Lead', chipPulse('12.5%', CHIP_MID_EQ)),
  preset('Chip Pulse 25', 'Lead', chipPulse('25%', CHIP_MID_EQ)),
])

/**
 * The presets in their categories' order (PRESET_CATEGORIES), as a
 * browser lists them; within each, in the order written
 */
function byCategory(presets: readonly Preset[]): readonly Preset[] {
  return PRESET_CATEGORIES.flatMap((category) =>
    presets.filter((preset) => preset.category === category)
  )
}

/**
 * The factory kit (src/state/kit.ts): its sixteen pads, the presets above
 * by name, from the bottom left of the kit's pads along each row and on
 * up (the first row of eight on a phone held upright, of four on a wider
 * one): the kick, the snare and the hats, the toms and the clap, then
 * percussion, a crash, a long low kick and a zap
 */
export const FACTORY_KIT: readonly string[] = [
  'Kick',
  'Snare',
  'Closed Hat',
  'Open Hat',
  'Low Tom',
  'Tom',
  'High Tom',
  'Clap',
  'Rim',
  'Cowbell',
  'Shaker',
  'Crash',
  'Boom',
  'Conga',
  'Clave',
  'Zap',
]
