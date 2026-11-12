import type { Preset, PresetCategory } from './presets'
import { writeSound, type WrittenSound } from './sound/write'

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
  }),
  preset('Wobble Bass', 'Bass', {
    inputs: {
      saw: { kind: 'osc', octave: -1 },
      detuned: { kind: 'osc', octave: -1, fine: 10 },
    },
    chains: {
      main: {
        sends: { saw: 1, detuned: 0.7 },
        items: { filter: { kind: 'filter', cutoff: 260, resonance: 0.5 } },
      },
    },
    modulators: { lfo: { kind: 'lfo', shape: 'Triangle', rate: 3 } },
    routes: [{ from: 'lfo', to: 'filter.cutoff', by: 3 }],
    amp: { attack: 0.003, sustain: 1, release: 0.1 },
    voice: { mode: 'Mono' },
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
  }),

  preset('Saw Lead', 'Lead', {
    inputs: {
      saw: { kind: 'osc' },
      detuned: { kind: 'osc', fine: 12 },
    },
    chains: {
      main: {
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
    sends: { b: 0.4 },
  }),
  preset('Chip Lead', 'Lead', {
    inputs: { square: { kind: 'osc', wave: 'Square', width: 0.25 } },
    chains: { main: { sends: { square: 1 } } },
    // The vibrato sets in after the note starts
    modulators: { vibrato: { kind: 'lfo', rate: 6.5, fade: 0.35 } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.35 }],
    amp: { attack: 0.002, decay: 0.1, sustain: 0.8, release: 0.1 },
    voice: { mode: 'Mono' },
  }),
  preset('Fifth Lead', 'Lead', {
    inputs: {
      root: { kind: 'osc' },
      fifth: { kind: 'osc', semi: 7, fine: 6 },
    },
    chains: {
      main: {
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
  }),

  preset('Warm Pad', 'Pad', {
    inputs: {
      saw: { kind: 'osc' },
      detuned: { kind: 'osc', fine: 9 },
    },
    chains: {
      main: {
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
    },
    routes: [
      { from: 'filterEnv', to: 'filter.cutoff', by: 2 },
      { from: 'drift', to: 'filter.cutoff', by: 0.8 },
    ],
    amp: { attack: 0.8, decay: 1, sustain: 0.9, release: 2.5, velocity: 0.2 },
    effects: [{ kind: 'chorus', rate: 0.4, depth: 0.5, mix: 0.4 }],
    sends: { c: 0.6 },
  }),
  preset('PWM Pad', 'Pad', {
    inputs: {
      square: { kind: 'osc', wave: 'Square' },
      detuned: { kind: 'osc', wave: 'Square', fine: -7 },
    },
    chains: {
      main: {
        sends: { square: 0.8, detuned: 0.8 },
        items: { filter: { kind: 'filter', cutoff: 2600, keytrack: 0.3 } },
      },
    },
    modulators: {
      pwm: { kind: 'lfo', rate: 0.6, trigger: 'Free' },
      pwm2: { kind: 'lfo', shape: 'Triangle', rate: 0.45, trigger: 'Free' },
    },
    routes: [
      { from: 'pwm', to: 'square.width', by: 0.3 },
      { from: 'pwm2', to: 'detuned.width', by: 0.3 },
    ],
    amp: { attack: 0.5, decay: 1, sustain: 0.9, release: 1.8, velocity: 0.2 },
    sends: { c: 0.5 },
  }),
  preset('Glass Pad', 'Pad', {
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.12, fmSource: 'modulator' },
      // A 3:1 modulator: 19 semitones up
      modulator: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
    },
    chains: { main: { sends: { carrier: 1 } } },
    modulators: {
      shimmer: { kind: 'lfo', shape: 'Smooth', rate: 0.15, trigger: 'Free' },
    },
    routes: [{ from: 'shimmer', to: 'carrier.fm', by: 0.08 }],
    amp: { attack: 1, decay: 1.5, sustain: 0.8, release: 3, velocity: 0.2 },
    sends: { c: 0.8 },
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
    },
    routes: [
      { from: 'ensemble', to: 'left.pitch', by: 0.12 },
      { from: 'ensemble', to: 'right.pitch', by: -0.12 },
      // Every note a little brighter or darker than the last
      { from: 'random', to: 'filter.cutoff', by: 0.3 },
    ],
    amp: { attack: 0.6, decay: 1, sustain: 0.9, release: 1.5, velocity: 0.3 },
    effects: [{ kind: 'chorus', rate: 0.5, depth: 0.4, mix: 0.35 }],
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
        sends: { saw: 0.7, detuned: 0.7 },
        items: {
          first: { kind: 'filter', type: 'BP', cutoff: 750, resonance: 0.5 },
        },
      },
      high: {
        level: 0.7,
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
    },
    routes: [{ from: 'vowel', to: 'second.cutoff', by: 0.3 }],
    amp: { attack: 0.4, decay: 1, sustain: 0.9, release: 1.5, velocity: 0.2 },
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
        sends: { saw: 0.8, detuned: 0.8 },
        items: {
          filter: { kind: 'filter', cutoff: 1100, keytrack: 0.4 },
        },
      },
      breath: {
        level: 0.6,
        sends: { air: 0.5 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 2500, resonance: 0.6 },
        },
      },
    },
    modulators: {
      swell: { kind: 'env', attack: 1.5, decay: 2, sustain: 0.6, release: 2 },
      gust: { kind: 'lfo', shape: 'Smooth', rate: 0.4, trigger: 'Free' },
    },
    routes: [
      { from: 'swell', to: 'filter.cutoff', by: 1.5 },
      { from: 'gust', to: 'band.cutoff', by: 1 },
    ],
    amp: { attack: 0.9, decay: 1, sustain: 0.9, release: 2, velocity: 0.2 },
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
    ],
    amp: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.5, velocity: 0.7 },
    sends: { b: 0.5, c: 0.4 },
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
    routes: [{ from: 'filterEnv', to: 'filter.cutoff', by: 4.5 }],
    amp: { attack: 0.001, decay: 0.35, sustain: 0, velocity: 0.6 },
  }),
  preset('Kalimba', 'Pluck', {
    inputs: {
      tine: { kind: 'osc', wave: 'Sine', fm: 0.05, fmSource: 'strike' },
      // Near 3:1, struck bright and gone at once
      strike: { kind: 'osc', wave: 'Sine', octave: 1, semi: 7 },
    },
    chains: { main: { sends: { tine: 1 } } },
    modulators: { strikeEnv: { kind: 'env', attack: 0.001, decay: 0.07 } },
    routes: [{ from: 'strikeEnv', to: 'tine.fm', by: 0.45 }],
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
    routes: [{ from: 'strike', to: 'main.send.overtone', by: 0.5 }],
    amp: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.3, velocity: 0.6 },
    sends: { c: 0.3 },
  }),

  preset('E-Piano', 'Keys', {
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.08, fmSource: 'modulator' },
      // A sine at the same pitch: a 1:1 modulator
      modulator: { kind: 'osc', wave: 'Sine' },
    },
    chains: { main: { sends: { carrier: 1 } } },
    modulators: { tineEnv: { kind: 'env', decay: 0.9 } },
    // Harder notes ring brighter at first
    routes: [{ from: 'tineEnv', to: 'carrier.fm', by: 0.2, via: 'velocity' }],
    amp: {
      attack: 0.002,
      decay: 2,
      sustain: 0.15,
      release: 0.5,
      velocity: 0.6,
    },
    effects: [{ kind: 'chorus', rate: 0.8, depth: 0.4, mix: 0.4 }],
  }),
  preset('FM Bell', 'Keys', {
    inputs: {
      carrier: { kind: 'osc', wave: 'Sine', fm: 0.2, fmSource: 'modulator' },
      // 22 semitones up, a 3.56:1 modulator: inharmonic, like a bell
      modulator: { kind: 'osc', wave: 'Sine', octave: 2, semi: -2 },
    },
    chains: { main: { sends: { carrier: 1 } } },
    modulators: { env: { kind: 'env', decay: 1.5 } },
    routes: [{ from: 'env', to: 'carrier.fm', by: 0.35 }],
    amp: { attack: 0.001, decay: 3, sustain: 0, release: 2 },
    sends: { c: 0.6 },
  }),
  preset('Organ', 'Keys', {
    inputs: {
      sine: { kind: 'osc', wave: 'Sine' },
      octave: { kind: 'osc', wave: 'Sine', octave: 1 },
    },
    chains: { main: { sends: { sine: 1, octave: 0.6 } } },
    modulators: { vibrato: { kind: 'lfo', rate: 6.5, trigger: 'Free' } },
    routes: [{ from: 'vibrato', to: 'voice.pitch', by: 0.08 }],
    amp: { attack: 0.004, decay: 0.1, sustain: 1, release: 0.06, velocity: 0 },
    effects: [{ kind: 'chorus', rate: 0.9, depth: 0.3, mix: 0.35 }],
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
    ],
    amp: {
      attack: 0.001,
      decay: 0.5,
      sustain: 0.25,
      release: 0.08,
      velocity: 0.6,
    },
  }),
  preset('Vibes', 'Keys', {
    inputs: {
      bar: { kind: 'osc', wave: 'Sine' },
      overtone: { kind: 'osc', wave: 'Sine', octave: 2 },
    },
    chains: { main: { sends: { bar: 1, overtone: 0.15 } } },
    // The vibraphone's fans: a tremolo on the voice's gain
    modulators: { fans: { kind: 'lfo', rate: 5, trigger: 'Free' } },
    routes: [{ from: 'fans', to: 'amp.gain', by: -0.35 }],
    amp: { attack: 0.001, decay: 2.5, sustain: 0, release: 0.8, velocity: 0.6 },
    sends: { c: 0.5 },
  }),

  preset('Kick', 'Drums', {
    inputs: { sine: { kind: 'osc', wave: 'Sine', octave: -1 } },
    chains: { main: { sends: { sine: 1 } } },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.09 } },
    // Three octaves down to the key's pitch in a tenth of a second
    routes: [{ from: 'drop', to: 'voice.pitch', by: 36 }],
    amp: { attack: 0.001, decay: 0.4, sustain: 0, velocity: 0.6 },
  }),
  preset('Snare', 'Drums', {
    inputs: {
      body: { kind: 'osc', wave: 'Triangle' },
      noise: { kind: 'noise' },
    },
    chains: {
      main: {
        sends: { body: 0.6, noise: 0.75 },
        items: { filter: { kind: 'filter', cutoff: 9000 } },
      },
    },
    modulators: { drop: { kind: 'env', attack: 0.001, decay: 0.04 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 12 }],
    amp: {
      attack: 0.001,
      decay: 0.2,
      sustain: 0,
      release: 0.18,
      velocity: 0.6,
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
    routes: [{ from: 'bursts', to: 'amp.gain', by: -0.9, via: 'flutter' }],
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
        sends: { low: 0.7, high: 0.7 },
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
    // A random note within an octave up, eight times a second
    routes: [{ from: 'steps', to: 'voice.pitch', by: 12 }],
    sends: { b: 0.6 },
  }),
  preset('Zap', 'FX', {
    inputs: { saw: { kind: 'osc' } },
    chains: { main: { sends: { saw: 1 } } },
    modulators: { drop: { kind: 'env', decay: 0.15 } },
    routes: [{ from: 'drop', to: 'voice.pitch', by: 30 }],
    amp: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.15 },
  }),
  preset('Riser', 'FX', {
    // Held, noise sweeps up a resonant band and a saw climbs an octave
    inputs: {
      air: { kind: 'noise' },
      saw: { kind: 'osc' },
    },
    chains: {
      sweep: {
        sends: { air: 0.8 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 300, resonance: 0.6 },
        },
      },
      climb: {
        level: 0.5,
        sends: { saw: 0.7 },
        items: { filter: { kind: 'filter', cutoff: 800, keytrack: 0.5 } },
      },
    },
    modulators: { rise: { kind: 'env', attack: 4, sustain: 1, release: 1 } },
    routes: [
      { from: 'rise', to: 'band.cutoff', by: 5 },
      { from: 'rise', to: 'saw.pitch', by: 12 },
      { from: 'rise', to: 'filter.cutoff', by: 3 },
    ],
    amp: { attack: 0.5, sustain: 1, release: 1 },
    sends: { c: 0.7 },
  }),
  preset('Wind', 'FX', {
    // Noise in two resonant bands, each blown about by a gust of its own
    inputs: { air: { kind: 'noise' } },
    chains: {
      low: {
        sends: { air: 1 },
        items: {
          band: { kind: 'filter', type: 'BP', cutoff: 600, resonance: 0.8 },
        },
      },
      high: {
        level: 0.8,
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
    ],
    amp: { attack: 0.8, sustain: 1, release: 1.5, velocity: 0.2 },
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
    routes: [{ from: 'wail', to: 'voice.pitch', by: 7 }],
    amp: { attack: 0.02, sustain: 1, release: 0.3 },
    voice: { mode: 'Mono' },
  }),
]
