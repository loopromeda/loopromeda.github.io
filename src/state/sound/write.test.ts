import { describe, expect, it } from 'vitest'
import { readSound } from './read'
import { initSound } from './sound'
import { writeSound, type WrittenSound } from './write'

/** A saw and a sub into a filter and a drive, an envelope on the cutoff */
const BASS: WrittenSound = {
  inputs: {
    saw: { kind: 'osc', octave: -1 },
    sub: { kind: 'osc', wave: 'Square', octave: -2 },
    fm: { kind: 'osc', wave: 'Sine', fmSource: 'fm', fm: 0.2 },
  },
  chains: {
    main: {
      sends: { saw: 1, sub: 0.5 },
      items: {
        lp: { kind: 'filter', cutoff: 400, resonance: 0.3 },
        hot: { kind: 'drive', drive: 0.4 },
      },
    },
    air: { level: 0.5, sends: { fm: 0.25 } },
  },
  modulators: {
    filterEnv: { kind: 'env', decay: 0.25 },
    wobble: { kind: 'lfo', shape: 'S&H', rate: 3 },
  },
  routes: [
    { from: 'filterEnv', to: 'lp.cutoff', by: 4 },
    { from: 'wobble', to: 'voice.pitch', by: 12, via: 'slide' },
    { from: 'velocity', to: 'main.send.sub', by: 0.3 },
    { from: 'key', to: 'amp.gain', by: -0.5 },
  ],
  amp: { attack: 0.002, sustain: 0.8 },
  voice: { mode: 'Mono', glide: 0.05 },
}

describe('writeSound', () => {
  it('numbers the parts in the order written', () => {
    const sound = writeSound(BASS)
    expect(sound.inputs.map((input) => input.id)).toEqual(['i1', 'i2', 'i3'])
    expect(sound.chains.map((chain) => chain.id)).toEqual(['c1', 'c2'])
    expect(sound.chains[0]?.items.map((item) => item.id)).toEqual(['x1', 'x2'])
    expect(sound.modulators.map((modulator) => modulator.id)).toEqual([
      'm1',
      'm2',
    ])
    expect(sound.chains[0]?.sends).toEqual({ i1: 1, i2: 0.5 })
    expect(sound.chains[1]?.values.level).toBe(0.5)
  })

  it('writes choices by name and leaves the rest at their defaults', () => {
    const sound = writeSound(BASS)
    expect(sound.inputs[1]?.values).toEqual({
      wave: 3,
      octave: -2,
      semi: 0,
      fine: 0,
      width: 0.5,
      fm: 0,
    })
    expect(sound.modulators[1]?.values.shape).toBe(4)
    expect(sound.voice).toEqual({ mode: 1, glide: 0.05 })
    expect(sound.amp.release).toBe(initSound().amp.release)
  })

  it('reads references by name, feedback FM too', () => {
    expect(writeSound(BASS).inputs[2]?.refs).toEqual({ fmSource: 'i3' })
  })

  it('writes route amounts in their destinations’ units', () => {
    const routes = writeSound(BASS).routes
    expect(routes.map((route) => [route.target, route.key])).toEqual([
      ['x1', 'cutoff'],
      ['voice', 'pitch'],
      ['c1', 'send.i2'],
      ['amp', 'gain'],
    ])
    // 4 of a cutoff's 10 octaves, 12 of a pitch's 48 semitones
    expect(routes.map((route) => route.amount)).toEqual([0.4, 0.25, 0.3, -0.5])
    expect(routes[1]?.via).toBe('slide')
    expect(routes[2]?.source).toBe('velocity')
  })

  it('writes a sound that reads back unchanged', () => {
    const sound = writeSound(BASS)
    expect(readSound(JSON.parse(JSON.stringify(sound)))).toEqual(sound)
  })

  it.each([
    [
      'an unknown knob',
      { inputs: { a: { kind: 'osc', pitch: 3 } }, chains: {} },
      /no knob pitch/,
    ],
    [
      'an unknown choice',
      { inputs: { a: { kind: 'osc', wave: 'Saww' } }, chains: {} },
      /no choice Saww/,
    ],
    [
      'a value out of range',
      { inputs: { a: { kind: 'osc', octave: 3 } }, chains: {} },
      /outside -2..2/,
    ],
    [
      'a value off its steps',
      { inputs: { a: { kind: 'osc', semi: 0.5 } }, chains: {} },
      /off its steps/,
    ],
    [
      'an unknown kind',
      { inputs: { a: { kind: 'sampler' } }, chains: {} },
      /no kind sampler/,
    ],
    [
      'a name used twice',
      { inputs: { a: { kind: 'noise' } }, chains: { a: { sends: {} } } },
      /name a is taken/,
    ],
    [
      'a send from nothing',
      { inputs: {}, chains: { main: { sends: { saw: 1 } } } },
      /no input named saw/,
    ],
    [
      'a send of nothing',
      {
        inputs: { a: { kind: 'noise' } },
        chains: { main: { sends: { a: 0 } } },
      },
      /not above 0/,
    ],
    [
      'references that loop',
      {
        inputs: {
          a: { kind: 'osc', fmSource: 'b' },
          b: { kind: 'osc', fmSource: 'a' },
        },
        chains: {},
      },
      /makes a loop/,
    ],
    [
      'a route to a knob that cannot move',
      {
        inputs: { a: { kind: 'osc' } },
        chains: {},
        routes: [{ from: 'velocity', to: 'a.wave', by: 1 }],
      },
      /cannot move a.wave/,
    ],
    [
      'a route past its destination',
      {
        inputs: {},
        chains: {},
        routes: [{ from: 'velocity', to: 'voice.pitch', by: 60 }],
      },
      /past its 48 st/,
    ],
    [
      'a route from no modulator',
      {
        inputs: {},
        chains: {},
        routes: [{ from: 'lfo', to: 'voice.pitch', by: 1 }],
      },
      /no modulator named lfo/,
    ],
    [
      'too many inputs',
      {
        inputs: Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => [n, { kind: 'noise' }])
        ),
        chains: {},
      },
      /7 inputs, past 6/,
    ],
  ] as const)('throws on %s', (_, written, message) => {
    expect(() => writeSound(written as unknown as WrittenSound)).toThrow(
      message
    )
  })
})
