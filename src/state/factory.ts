import type { Preset, PresetCategory } from './presets'
import {
  writeSound,
  type WrittenChain,
  type WrittenKnobs,
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
    return { name, category, sound: writeSound(written) }
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
 * The analog presets (the Analog category) are a six-voice analog poly's
 * sounds, a Prophet-6's (ashon, 2026-11-16: "프로펫6급에 대한 사운드
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
export const FACTORY_PRESETS: readonly Preset[] = [
  // A new patch's sound: a saw into an open lowpass (initSound)
  preset('Init', 'Basic', {
    inputs: { saw: { kind: 'osc' } },
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
        sends: { saw: 1, sub: 0.5 },
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
      widened(1.2, 160),
    ],
  }),
  preset('Sub Bass', 'Bass', {
    inputs: {
      sub: { kind: 'osc', wave: 'Sine', octave: -1 },
      // An octave up, so a phone speaker hears the note at all
      body: { kind: 'osc', wave: 'Triangle' },
    },
    chains: { main: { sends: { sub: 1, body: 0.35 } } },
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
    effects: [pingPong(0.18, 0.4), widened(1, 150)],
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
    routes: [{ from: 'env', to: 'carrier.fm', by: 0.4 }],
    amp: { attack: 0.002, decay: 0.5, sustain: 0.6, release: 0.1 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'doubler', detune: 5, time: 0.008, mix: 0.3 },
      widened(1.2, 160),
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
        sends: { saw: 1, detuned: 0.7 },
        items: { filter: { kind: 'filter', cutoff: 260, resonance: 0.5 } },
      },
    },
    modulators: { lfo: { kind: 'lfo', shape: 'Triangle', rate: 3 } },
    routes: [{ from: 'lfo', to: 'filter.cutoff', by: 3 }],
    amp: { attack: 0.003, sustain: 1, release: 0.1 },
    voice: { mode: 'Mono' },
    effects: [
      { kind: 'chorus', rate: 0.5, depth: 0.4, mix: 0.3 },
      widened(1.15, 160),
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
      widened(1.3, 180),
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
      widened(1.2, 160),
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
        sends: { saw: 1, detuned: 0.8 },
        items: {
          filter: {
            kind: 'filter',
            cutoff: 2800,
            resonance: 0.2,
            keytrack: 0.5,
          },
        },
      },
    },
    modulators: {
      filterEnv: { kind: 'env', decay: 0.4, sustain: 0.3 },
      vibrato: { kind: 'lfo', rate: 5.5 },
    },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 2 },
      // Vibrato only while the finger slides up or down its key
      { from: 'vibrato', to: 'voice.pitch', by: 0.6, via: 'slide' },
    ],
    amp: { sustain: 0.85, release: 0.25 },
    voice: { mode: 'Legato', glide: 0.08 },
    effects: [
      { kind: 'doubler', detune: 9, time: 0.014, spread: 0.8, mix: 0.35 },
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
            keytrack: 0.5,
          },
          drive: { kind: 'drive', drive: 0.3 },
        },
      },
    },
    modulators: { vibrato: { kind: 'lfo', rate: 5.5, fade: 0.4 } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.25 }],
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
            keytrack: 0.7,
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
  preset('Strings', 'Pad', {
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
  preset('Choir Pad', 'Pad', {
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
  preset('Kalimba', 'Pluck', {
    inputs: {
      tine: { kind: 'osc', wave: 'Sine', fm: 0.05, fmSource: 'strike' },
      // Near 3:1, struck bright and gone at once
      strike: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
    },
    chains: { main: { sends: { tine: 1 } } },
    modulators: { strikeEnv: { kind: 'env', attack: 0.001, decay: 0.07 } },
    routes: [
      { from: 'strikeEnv', to: 'tine.fm', by: 0.45 },
      // The tines laid out across, each struck a little off its place
      keyPan(1),
      spread(0.12),
    ],
    amp: { attack: 0.001, decay: 0.9, sustain: 0, release: 0.4, velocity: 0.6 },
    sends: { c: 0.4 },
  }),
  preset('Marimba', 'Pluck', {
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
  preset('FM Bell', 'Keys', {
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.2, fmSource: 'modulator' },
      // 22 semitones up, a 3.56:1 modulator: inharmonic, like a bell
      modulator: { kind: 'osc', wave: 'Sine', octave: 2, semi: -2 },
    },
    chains: { main: { sends: { carrier: 1 } } },
    modulators: { env: { kind: 'env', decay: 1.5 } },
    routes: [
      { from: 'env', to: 'carrier.fm', by: 0.35 },
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
    modulators: { rotor: { kind: 'lfo', rate: 6.5, trigger: 'Free' } },
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
    inputs: { pulse: { kind: 'osc', wave: 'Square', width: 0.15 } },
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
      { from: 'filterEnv', to: 'filter.cutoff', by: 2 },
      { from: 'velocity', to: 'filter.cutoff', by: 1 },
      keyPan(0.6),
    ],
    amp: {
      attack: 0.001,
      decay: 0.5,
      sustain: 0.25,
      release: 0.08,
      velocity: 0.6,
    },
    effects: [
      { kind: 'doubler', detune: 6, time: 0.008, mix: 0.25 },
      widened(1.2, 150),
    ],
    sends: { c: 0.15 },
  }),
  preset('Vibes', 'Keys', {
    inputs: {
      bar: { kind: 'osc', wave: 'Sine' },
      overtone: { kind: 'osc', wave: 'Sine', octave: 2 },
    },
    chains: { main: { sends: { bar: 1, overtone: 0.15 } } },
    // The vibraphone's fans: a tremolo on the voice's gain
    modulators: { fans: { kind: 'lfo', rate: 5, trigger: 'Free' } },
    routes: [
      { from: 'fans', to: 'amp.gain', by: -0.35 },
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
      main: { sends: { body: 0.7 } },
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
        sends: { noise: 0.6, metal: 0.5 },
        items: {
          filter: { kind: 'filter', type: 'HP', cutoff: 7000, resonance: 0.2 },
        },
      },
    },
    amp: {
      attack: 0.001,
      decay: 0.06,
      sustain: 0,
      release: 0.05,
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
        sends: { noise: 0.6, metal: 0.5 },
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
          crack: { kind: 'drive', drive: 0.3 },
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
      decay: 0.22,
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
        sends: { low: 0.42, high: 0.42 },
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
      decay: 0.28,
      sustain: 0,
      release: 0.25,
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
        sends: { click: 1, noise: 0.75 },
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
        sends: { noise: 0.7 },
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
        sends: { noise: 0.57, metal: 0.33 },
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
        sends: { sine: 1 },
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
        items: { filter: { kind: 'filter', cutoff: 6000 } },
      },
    },
    amp: {
      attack: 0.001,
      decay: 0.05,
      sustain: 0,
      release: 0.04,
      velocity: 0.6,
      pan: -0.4,
    },
  }),

  preset('Blips', 'FX', {
    inputs: { square: { kind: 'osc', wave: 'Square' } },
    chains: {
      main: {
        sends: { square: 1 },
        items: { filter: { kind: 'filter', cutoff: 3000, resonance: 0.4 } },
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
    inputs: { saw: { kind: 'osc' } },
    chains: { main: { sends: { saw: 1 } } },
    modulators: { drop: { kind: 'env', decay: 0.15 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 30 }, spread(0.5)],
    amp: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.15 },
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
  preset('Wind', 'FX', {
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
    'Analog',
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
    'Analog',
    analog({
      // A saw and a pulse, the filter thrown open and shut at once
      inputs: {
        saw: { kind: 'osc' },
        pulse: { kind: 'osc', wave: 'Square', width: 0.42, fine: -5 },
      },
      mix: { saw: 0.8, pulse: 0.6 },
      lp: { cutoff: 490, resonance: 0.2, keytrack: 0.5, env: 4, velocity: 1 },
      hp: 160,
      filterEnv: { attack: 0.004, decay: 0.28, sustain: 0.18, release: 0.2 },
      slop: { saw: 3, pulse: -3 },
      spread: 0.35,
      amp: {
        attack: 0.003,
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
    'Analog',
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
    'Analog',
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
    'Analog',
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
    'Analog',
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
    'Analog',
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
    'Analog',
    analog({
      // A saw and a square, the filter's snap and a little ring, echoed
      inputs: {
        saw: { kind: 'osc' },
        square: { kind: 'osc', wave: 'Square', fine: 7 },
      },
      mix: { saw: 1, square: 0.7 },
      lp: { cutoff: 300, resonance: 0.3, keytrack: 0.6, env: 4.5, velocity: 1 },
      hp: 140,
      filterEnv: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
      slop: { saw: 2, square: -2 },
      spread: 0.4,
      amp: {
        attack: 0.001,
        decay: 0.8,
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
    'Analog',
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
    'Analog',
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
    'Analog',
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
    'Analog',
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
        widened(1.1, 160),
      ],
    })
  ),
  preset(
    'Unison Bass',
    'Analog',
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
        widened(1.2, 170),
      ],
    })
  ),

  // A chiptune's channels, its chips' (the 2A03's and the N163's): the
  // basses, the leads, the chords and the middle line's pulses
  preset('Chip Bass', 'Chip', chipBass(-1)),
  // The same two octaves down, through a lowpass: the bass's lowest notes
  preset(
    'Chip Sub',
    'Chip',
    chipBass(-2, { filter: { kind: 'filter', cutoff: 1500 } })
  ),
  preset('NES Triangle', 'Chip', {
    // The 2A03's triangle: 32 steps of 16 levels on its DAC's DC, and no
    // volume of its own
    inputs: { triangle: { kind: 'chip', wave: 'Triangle', octave: -1 } },
    chains: { main: { sends: { triangle: 1 } } },
    amp: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.01, velocity: 0 },
    voice: { mode: 'Mono' },
  }),
  preset('Chip Lead', 'Chip', {
    ...chipPulse('25%'),
    // The vibrato sets in after the note starts
    modulators: { vibrato: { kind: 'lfo', rate: 5.5, fade: 0.25 } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.3 }],
    voice: { mode: 'Mono' },
  }),
  preset('4-bit Lead', 'Chip', {
    // A wave-table chip's (the N163's, the Game Boy's): a sine in 32 steps
    // of 16 levels, its vibrato setting in after the note starts
    inputs: { wave: { kind: 'chip', wave: 'Sine', bits: 4 } },
    chains: { main: { sends: { wave: 1 } } },
    modulators: { vibrato: { kind: 'lfo', rate: 6, fade: 0.3 } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.3 }],
    amp: { attack: 0.001, decay: 0.15, sustain: 0.8, release: 0.05 },
    voice: { mode: 'Mono' },
  }),
  preset('Chip Chords', 'Chip', {
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
  preset('Chip Pulse 12', 'Chip', chipPulse('12.5%', CHIP_MID_EQ)),
  preset('Chip Pulse 25', 'Chip', chipPulse('25%', CHIP_MID_EQ)),
]

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
