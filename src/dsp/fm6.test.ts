import { beforeEach, describe, expect, it } from 'vitest'
import {
  FM6_ALGORITHMS,
  FM6_CURVE_NEG_LIN,
  FM6_CURVE_POS_EXP,
  FM6_ENGINE_CLEAN,
  FM6_VELOCITY_DX7,
  FM6_VELOCITY_FULL,
  FM6_ENGINE_DX7,
  FM6_LFO_SINE,
  FM6_OPS,
  Fm6Patch,
  Fm6Voice,
  fm6EnvTarget,
  fm6Converted,
  fm6FixedHz,
  fm6Frequency,
  fm6LfoHertz,
  fm6PitchLevel,
  fm6Ratio,
  fm6RateSpeed,
  fm6ScaleLevel,
  fm6ScaleRate,
  fm6ScaledLevel,
  fm6StaticTime,
  fm6OutLevel,
  fm6VelocityAttenuation,
} from './fm6'

const SAMPLE_RATE = 48000
const NONE: readonly (Float32Array | undefined)[] = Array.from({
  length: FM6_OPS,
})

/** The engine the voice's tests play on */
let engine = FM6_ENGINE_DX7

function newPatch(sampleRate = SAMPLE_RATE): Fm6Patch {
  const patch = new Fm6Patch(sampleRate)
  patch.setEngine(engine)
  return patch
}

/** A patch of OP1 alone heard (algorithm 16), the rest silent */
function sinePatch(): Fm6Patch {
  const patch = newPatch()
  patch.setVoice(16, 0, true)
  return patch
}

/**
 * note played at velocity for seconds (released after held seconds, if
 * given), rendered in blocks of 128 as the synth does
 */
function play(
  patch: Fm6Patch,
  note: number,
  seconds: number,
  options: {
    velocity?: number
    held?: number
    voice?: Fm6Voice
    levels?: readonly (Float32Array | undefined)[]
    /** Called before each block, at its first sample */
    before?: (at: number) => void
    /** The voice's and the patch's (SAMPLE_RATE but where given) */
    sampleRate?: number
  } = {}
): Float32Array {
  const rate = options.sampleRate ?? SAMPLE_RATE
  const voice = options.voice ?? new Fm6Voice(rate)
  const length = Math.round(seconds * rate)
  const out = new Float32Array(length)
  const block = 128
  const steps = new Float32Array(block).fill(
    (440 * 2 ** ((note - 69) / 12)) / rate
  )
  const release = options.held === undefined ? Infinity : options.held * rate
  voice.start(patch, note, options.velocity ?? 100, true)
  for (let at = 0; at < length; at += block) {
    if (at >= release) voice.release(patch)
    options.before?.(at)
    const run = Math.min(block, length - at)
    const levels = options.levels ?? NONE
    voice.render(patch, out.subarray(at, at + run), steps, run, levels)
    // As the synth moves the patch's LFO on after each block
    patch.advance(run)
  }
  return out
}

function peak(buffer: Float32Array, from = 0, to = buffer.length): number {
  let max = 0
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(buffer[i]!))
  return max
}

/** Upward zero crossings a second over [from, to) */
function crossings(buffer: Float32Array, from: number, to: number): number {
  let count = 0
  for (let i = from + 1; i < to; i++) {
    if (buffer[i - 1]! < 0 && buffer[i]! >= 0) count++
  }
  return (count * SAMPLE_RATE) / (to - from)
}

/**
 * What is left of buffer over [from, to) once the sine at hertz that
 * fits it best is taken away, over its whole (RMS)
 */
function residue(
  buffer: Float32Array,
  hertz: number,
  from: number,
  to: number
): number {
  let ss = 0
  let cc = 0
  let sc = 0
  let xs = 0
  let xc = 0
  for (let i = from; i < to; i++) {
    const w = (2 * Math.PI * hertz * i) / SAMPLE_RATE
    const sin = Math.sin(w)
    const cos = Math.cos(w)
    const x = buffer[i]!
    ss += sin * sin
    cc += cos * cos
    sc += sin * cos
    xs += x * sin
    xc += x * cos
  }
  const det = ss * cc - sc * sc
  const a = (xs * cc - xc * sc) / det
  const b = (xc * ss - xs * sc) / det
  let left = 0
  let all = 0
  for (let i = from; i < to; i++) {
    const w = (2 * Math.PI * hertz * i) / SAMPLE_RATE
    const x = buffer[i]!
    left += (x - a * Math.sin(w) - b * Math.cos(w)) ** 2
    all += x * x
  }
  return Math.sqrt(left / all)
}

/** How much of buffer's energy lies above its fundamental's band */
function brightness(buffer: Float32Array, hertz: number): number {
  // The difference of a sample from the next, as a crude highpass
  let all = 0
  let high = 0
  for (let i = 1; i < buffer.length; i++) {
    all += buffer[i]! ** 2
    high += (buffer[i]! - buffer[i - 1]!) ** 2
  }
  const sine = (2 * Math.sin((Math.PI * hertz) / SAMPLE_RATE)) ** 2
  return high / all / sine
}

describe('FM6_ALGORITHMS', () => {
  it('holds the DX7s 32, OP1 heard in each', () => {
    expect(FM6_ALGORITHMS).toHaveLength(32)
    for (const algorithm of FM6_ALGORITHMS) {
      expect(algorithm.carriers).toContain(0)
    }
  })

  it('modulates an operator only from higher ones, each heard or modulating', () => {
    for (const algorithm of FM6_ALGORITHMS) {
      const modulating = new Set<number>()
      algorithm.modulators.forEach((from, to) => {
        for (const op of from) {
          expect(op).toBeGreaterThan(to)
          modulating.add(op)
        }
      })
      for (let op = 0; op < FM6_OPS; op++) {
        expect(
          algorithm.carriers.includes(op) || modulating.has(op),
          `op ${op + 1}`
        ).toBe(true)
      }
    }
  })

  it('feeds one operator back onto itself, but for 4 and 6', () => {
    FM6_ALGORITHMS.forEach((algorithm, i) => {
      const { from, to } = algorithm.feedback
      if (i === 3) expect([from, to]).toEqual([3, 5])
      else if (i === 5) expect([from, to]).toEqual([4, 5])
      else expect(from).toBe(to)
    })
  })
})

describe('the DX7s levels', () => {
  it('scales an output level to 0..127', () => {
    expect(fm6ScaledLevel(0)).toBe(0)
    expect(fm6ScaledLevel(19)).toBe(46)
    expect(fm6ScaledLevel(20)).toBe(48)
    expect(fm6ScaledLevel(99)).toBe(127)
  })

  it('makes an output level step 0.75 dB', () => {
    const step =
      fm6EnvTarget(99, fm6OutLevel(99, 0, 15)) -
      fm6EnvTarget(99, fm6OutLevel(98, 0, 15))
    // A level is 6.02 dB
    expect(step * 6.0206).toBeCloseTo(0.753, 2)
  })

  it('puts a full level and envelope at 15, never under 1/16', () => {
    expect(fm6EnvTarget(99, fm6OutLevel(99, 0, 15))).toBe(15)
    expect(fm6EnvTarget(0, fm6OutLevel(0, 0, 15))).toBe(16 / 256)
  })

  it("turns down by velocity as the firmware's tables do", () => {
    for (const velocity of [1, 64, 100, 127]) {
      expect(fm6VelocityAttenuation(velocity, 0)).toBe(15)
    }
    expect(fm6VelocityAttenuation(127, 7)).toBe(1)
    expect(fm6VelocityAttenuation(64, 7)).toBe(46)
    expect(fm6VelocityAttenuation(1, 7)).toBe(113)
    expect(fm6VelocityAttenuation(64, 3)).toBeLessThan(46)
  })

  it('louder at most 4 dB for a full velocity, its least attenuation 4', () => {
    const loud = fm6OutLevel(99, 0, fm6VelocityAttenuation(127, 7))
    const flat = fm6OutLevel(99, 0, 15)
    expect(((loud - flat) / 256) * 6.0206).toBeCloseTo(4.1, 1)
  })

  it('scales a level away from the breakpoint by its curve', () => {
    // The groups of three keys below the breakpoint's (C3, MIDI's 60) scale
    // nothing; its own is the right side's first
    expect(fm6ScaleLevel(57, 39, 99, 99, 0, 0)).toBe(0)
    expect(fm6ScaleLevel(60, 39, 99, 99, 0, 0)).toBe(-7)
    // Two octaves up, -LIN at 99: 8 steps (6 dB) every 3 keys
    const down = fm6ScaleLevel(84, 39, 0, 99, 0, FM6_CURVE_NEG_LIN)
    expect(down).toBeLessThan(-60)
    const up = fm6ScaleLevel(84, 39, 0, 99, 0, FM6_CURVE_POS_EXP)
    expect(up).toBeGreaterThan(0)
    expect(fm6ScaleLevel(36, 39, 0, 99, 0, 0)).toBe(0)
  })

  it('scales rates up the keyboard', () => {
    expect(fm6ScaleRate(20, 7)).toBe(0)
    expect(fm6ScaleRate(108, 7)).toBeGreaterThan(fm6ScaleRate(60, 7))
    expect(fm6ScaleRate(108, 0)).toBe(0)
  })
})

describe('the DX7s frequencies', () => {
  it('reads Coarse and Fine as the DX7 shows them', () => {
    expect(fm6Ratio(0, 0)).toBe(0.5)
    expect(fm6Ratio(1, 0)).toBe(1)
    expect(fm6Ratio(2, 0)).toBe(2)
    // On the firmware's 4096ths of an octave: 14 a hair sharp, 1.5 flat
    expect(fm6Ratio(14, 0)).toBeCloseTo(14.0025, 3)
    expect(fm6Ratio(1, 50)).toBeCloseTo(1.4999, 3)
    expect(fm6Ratio(1, 50)).toBeLessThan(1.5)
    expect(fm6FixedHz(0, 0)).toBe(1)
    expect(fm6FixedHz(2, 0)).toBe(100)
    expect(fm6FixedHz(6, 0)).toBe(100)
    expect(fm6FixedHz(2, 51)).toBeCloseTo(323.6, 1)
  })

  it('detunes a ratio by a few cents, more low down', () => {
    const a4 = fm6Frequency(69, false, 1, 0, 0)
    expect(a4).toBeCloseTo(440, 6)
    const cents = (note: number, detune: number) =>
      1200 *
      Math.log2(
        fm6Frequency(note, false, 1, 0, detune) /
          fm6Frequency(note, false, 1, 0, 0)
      )
    expect(cents(69, 7)).toBeGreaterThan(2)
    expect(cents(69, 7)).toBeLessThan(10)
    expect(cents(69, -7)).toBeCloseTo(-cents(69, 7), 6)
    expect(cents(33, 7)).toBeGreaterThan(cents(69, 7))
  })

  it('detunes a fixed frequency upwards only', () => {
    expect(fm6Frequency(60, true, 2, 0, -7)).toBe(100)
    expect(fm6Frequency(60, true, 2, 0, 7)).toBeGreaterThan(100)
    expect(fm6Frequency(60, true, 2, 0, 7)).toBeLessThan(101)
  })
})

describe('the DX7s times', () => {
  it('moves faster at a higher rate', () => {
    for (let rate = 1; rate <= 99; rate++) {
      expect(fm6RateSpeed(rate, 0)).toBeGreaterThanOrEqual(
        fm6RateSpeed(rate - 1, 0)
      )
    }
    expect(fm6RateSpeed(50, 10)).toBeGreaterThan(fm6RateSpeed(50, 0))
  })

  it('holds a still stage for less time at a higher rate', () => {
    expect(fm6StaticTime(0)).toBeCloseTo(40, 0)
    expect(fm6StaticTime(99)).toBe(0)
    expect(fm6StaticTime(50)).toBeLessThan(fm6StaticTime(20))
  })

  it('makes the pitch envelope 4 octaves either way, 50 the note', () => {
    expect(fm6PitchLevel(50)).toBe(0)
    expect(fm6PitchLevel(0)).toBe(-4)
    expect(fm6PitchLevel(99)).toBeCloseTo(4, 0)
  })

  it('runs the LFO from 0.065 Hz to 51, as the firmware does', () => {
    expect(fm6LfoHertz(0)).toBeCloseTo(0.0645, 3)
    expect(fm6LfoHertz(35)).toBeCloseTo(5.8, 1)
    expect(fm6LfoHertz(70)).toBeCloseTo(16.9, 1)
    expect(fm6LfoHertz(99)).toBeCloseTo(50.9, 0)
  })

  it('decays 0.28 dB a second at rate 0, as Levien measured', () => {
    expect(fm6RateSpeed(0, 0) * 6.0206).toBeCloseTo(0.2819, 3)
  })
})

describe.each([
  ['Clean', FM6_ENGINE_CLEAN],
  ['DX7', FM6_ENGINE_DX7],
])('Fm6Voice, the %s engine', (_, which) => {
  beforeEach(() => {
    engine = which
  })

  it('plays OP1 alone as a sine at the note, about full scale', () => {
    const out = play(sinePatch(), 69, 0.5)
    expect(crossings(out, 4800, 24000)).toBeCloseTo(440, -1)
    expect(peak(out, 4800)).toBeGreaterThan(0.9)
    expect(peak(out, 4800)).toBeLessThan(1.1)
  })

  it('plays a Fixed operator at its frequency, whatever the note', () => {
    const patch = sinePatch()
    patch.setOperator(0, true, 2, 0, 0, 99, 0, 0, 0)
    for (const note of [40, 69, 90]) {
      const out = play(patch, note, 0.5)
      expect(crossings(out, 4800, 24000)).toBeCloseTo(100, -1)
    }
  })

  it('brightens a carrier with its modulator', () => {
    const patch = newPatch()
    // Algorithm 1: OP2 into OP1
    patch.setVoice(1, 0, true)
    const plain = brightness(play(patch, 57, 0.5), 220)
    patch.setOperator(1, false, 1, 0, 0, 90, 0, 0, 0)
    const bright = brightness(play(patch, 57, 0.5), 220)
    expect(plain).toBeCloseTo(1, 0)
    expect(bright).toBeGreaterThan(plain * 3)
  })

  it('feeds back into a sawtooth-like wave, bounded and finite', () => {
    const patch = sinePatch()
    // Algorithm 32: OP6 feeds back on itself
    patch.setOperator(0, false, 1, 0, 0, 0, 0, 0, 0)
    patch.setOperator(5, false, 1, 0, 0, 99, 0, 0, 0)
    patch.setVoice(32, 0, true)
    const plain = brightness(play(patch, 57, 0.5), 220)
    patch.setVoice(32, 7, true)
    const out = play(patch, 57, 0.5)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(peak(out)).toBeLessThan(1.1)
    expect(brightness(out, 220)).toBeGreaterThan(plain * 3)
  })

  it('plays louder at a higher velocity, when sensitive to it', () => {
    const patch = sinePatch()
    patch.setOperator(0, false, 1, 0, 0, 99, 7, 0, 0)
    const soft = peak(play(patch, 60, 0.3, { velocity: 30 }), 4800)
    const hard = peak(play(patch, 60, 0.3, { velocity: 120 }), 4800)
    expect(hard).toBeGreaterThan(soft * 4)
  })

  it('decays to its third level and holds it while the key is down', () => {
    const patch = sinePatch()
    patch.setEnvelope(0, 99, 60, 99, 60, 99, 70, 70, 0)
    const out = play(patch, 60, 2)
    const early = peak(out, 0, 2400)
    const late = peak(out, 72000, 96000)
    // L2 70 is 29 envelope steps down: about 10.9 levels... well under
    expect(late).toBeLessThan(early * 0.5)
    expect(peak(out, 48000, 72000) / late).toBeCloseTo(1, 1)
  })

  it('is done once let go and faded, not before', () => {
    const patch = sinePatch()
    patch.setEnvelope(0, 99, 99, 99, 70, 99, 99, 99, 0)
    const voice = new Fm6Voice(SAMPLE_RATE)
    play(patch, 60, 0.2, { voice })
    expect(voice.done(patch)).toBe(false)
    play(patch, 60, 3, { voice, held: 0.1 })
    expect(voice.done(patch)).toBe(true)
  })

  it('holds a note let go at a fourth level above 0', () => {
    const patch = sinePatch()
    patch.setEnvelope(0, 99, 99, 99, 99, 99, 99, 99, 80)
    const voice = new Fm6Voice(SAMPLE_RATE)
    const out = play(patch, 60, 2, { voice, held: 0.1 })
    expect(voice.done(patch)).toBe(false)
    expect(peak(out, 72000)).toBeGreaterThan(0.01)
  })

  it('bends the pitch by its envelope, back to the note', () => {
    const patch = sinePatch()
    // From an octave up (L4 at 82: 32/32), down to the note slowly
    patch.setPitchEnvelope(40, 99, 99, 99, 50, 50, 50, 82)
    const out = play(patch, 57, 3)
    expect(crossings(out, 0, 2400)).toBeGreaterThan(330)
    expect(crossings(out, 120000, 144000)).toBeCloseTo(220, -1)
  })

  it('wobbles the pitch with the LFO', () => {
    const patch = sinePatch()
    patch.setLfo(FM6_LFO_SINE, 30, 0, 99, 0, true, 7)
    const out = play(patch, 69, 2)
    const rates: number[] = []
    for (let at = 0; at + 2400 <= out.length; at += 2400) {
      rates.push(crossings(out, at, at + 2400))
    }
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(100)
  })

  it('renders every algorithm at full levels and feedback finite, bounded', () => {
    const patch = newPatch()
    for (let op = 0; op < FM6_OPS; op++) {
      patch.setOperator(op, false, op + 1, 0, 0, 99, 0, 0, 0)
    }
    for (let a = 1; a <= 32; a++) {
      patch.setVoice(a, 7, true)
      const out = play(patch, 48, 0.1)
      expect(out.every(Number.isFinite), `algorithm ${a}`).toBe(true)
      const heard = FM6_ALGORITHMS[a - 1]!.carriers.length
      // The DX7's output filter rings on a spectrum this harsh, its peaks
      // higher than what goes in (its own impulse's sum is about 1.6); the
      // coupling, taking a DC off, moves them a little too
      const over = engine === FM6_ENGINE_DX7 ? 1.7 : 1.2
      expect(peak(out), `algorithm ${a}`).toBeLessThan(heard * over)
    }
  })
  it('turns an operator by a route no further than 0 and 99', () => {
    const route = (value: number) => {
      const levels: (Float32Array | undefined)[] = [...NONE]
      levels[0] = new Float32Array(128).fill(value)
      return levels
    }
    const full = peak(play(sinePatch(), 60, 0.3), 4800)
    const up = peak(play(sinePatch(), 60, 0.3, { levels: route(1) }), 4800)
    expect(up / full).toBeCloseTo(1, 2)
    const patch = sinePatch()
    patch.setOperator(0, false, 1, 0, 0, 50, 0, 0, 0)
    const half = peak(play(patch, 60, 0.3), 4800)
    const raised = peak(play(patch, 60, 0.3, { levels: route(0.49) }), 4800)
    expect(half).toBeLessThan(full * 0.05)
    expect(raised / full).toBeCloseTo(1, 2)
    expect(peak(play(sinePatch(), 60, 0.3, { levels: route(-1) }))).toBe(0)
  })

  it('keeps a carrier a route turns up from Level 0 going once let go', () => {
    const patch = sinePatch()
    patch.setOperator(0, false, 1, 0, 0, 0, 0, 0, 0)
    patch.setEnvelope(0, 99, 99, 99, 40, 99, 99, 99, 0)
    const levels: (Float32Array | undefined)[] = [...NONE]
    levels[0] = new Float32Array(128).fill(1)
    const voice = new Fm6Voice(SAMPLE_RATE)
    const out = play(patch, 60, 0.4, { voice, held: 0.1, levels })
    expect(voice.done(patch)).toBe(false)
    expect(peak(out, 14400)).toBeGreaterThan(0.1)
  })

  it('hears a knob turned under a note held: its level, its Fixed', () => {
    const patch = sinePatch()
    const out = play(patch, 69, 1, {
      before: (at) => {
        if (at === 24064) patch.setOperator(0, true, 2, 0, 0, 99, 0, 0, 0)
        if (at === 36096) patch.setOperator(0, true, 2, 0, 0, 60, 0, 0, 0)
      },
    })
    expect(crossings(out, 4800, 24000)).toBeCloseTo(440, -1)
    expect(crossings(out, 26400, 36000)).toBeCloseTo(100, -1)
    expect(peak(out, 38400)).toBeLessThan(peak(out, 26400, 36000) * 0.1)
  })

  it('stands where it stood when a held level is turned to 0 and back', () => {
    const patch = sinePatch()
    // Sustaining at L3 70, under its first levels
    patch.setEnvelope(0, 99, 99, 99, 99, 99, 99, 70, 0)
    const out = play(patch, 69, 1.5, {
      before: (at) => {
        if (at === 24064) patch.setOperator(0, false, 1, 0, 0, 0, 0, 0, 0)
        if (at === 36096) patch.setOperator(0, false, 1, 0, 0, 99, 0, 0, 0)
      },
    })
    const before = peak(out, 4800, 24000)
    expect(peak(out, 31200, 36000)).toBeLessThan(before * 1e-3)
    expect(peak(out, 52800) / before).toBeCloseTo(1, 2)
  })

  it('eases a level turned under a note held, unclicked', () => {
    const patch = sinePatch()
    const out = play(patch, 100, 0.6, {
      before: (at) => {
        if (at === 24064) patch.setOperator(0, false, 1, 0, 0, 0, 0, 0, 0)
      },
    })
    const before = peak(out, 4800, 24000)
    // Its first millisecond still well heard, gone in a tenth of a second
    expect(peak(out, 24064 + 24, 24064 + 48)).toBeGreaterThan(before * 0.2)
    expect(peak(out, 24064 + 4800)).toBeLessThan(before * 1e-3)
  })

  it('goes on unbroken when the engine changes under a note held', () => {
    const patch = sinePatch()
    const other = engine === FM6_ENGINE_DX7 ? FM6_ENGINE_CLEAN : FM6_ENGINE_DX7
    // A note at 2637 Hz: a cycle within a step's 16 samples and a bit
    const out = play(patch, 100, 0.6, {
      before: (at) => {
        if (at === 24064) patch.setEngine(other)
      },
    })
    const before = peak(out, 4800, 24000)
    expect(peak(out, 24064, 24064 + 24) / before).toBeCloseTo(1, 1)
    expect(peak(out, 24064 + 128) / before).toBeCloseTo(1, 1)
  })

  it('takes the DC off a pair at 1:1, as its output is coupled', () => {
    const patch = newPatch()
    // Algorithm 1: OP2 into OP1, both at the note
    patch.setVoice(1, 0, true)
    patch.setOperator(1, false, 1, 0, 0, 90, 0, 0, 0)
    const out = play(patch, 57, 1)
    let mean = 0
    let power = 0
    for (let i = 24000; i < 48000; i++) {
      mean += out[i]!
      power += out[i]! ** 2
    }
    mean /= 24000
    expect(mean ** 2 / (power / 24000)).toBeLessThan(1e-4)
  })

  it('hears velocity as its keys send it, MIDI’s 127 their 100', () => {
    const loud = (range: number, velocity: number) => {
      const patch = sinePatch()
      patch.setVelocityRange(range)
      patch.setOperator(0, false, 1, 0, 0, 99, 7, 0, 0)
      return peak(play(patch, 60, 0.3, { velocity }), 4800)
    }
    const keys = loud(FM6_VELOCITY_DX7, 127)
    expect(keys / loud(FM6_VELOCITY_FULL, 100)).toBeCloseTo(1, 2)
    expect(loud(FM6_VELOCITY_FULL, 127)).toBeGreaterThan(keys * 1.2)
  })

  it.each([44100, 24000])(
    'plays a sine whole at %i Hz, its output filter stable',
    (sampleRate) => {
      const patch = newPatch(sampleRate)
      patch.setVoice(16, 0, true)
      const out = play(patch, 69, 0.3, { sampleRate })
      expect(out.every(Number.isFinite)).toBe(true)
      expect(peak(out, sampleRate / 10)).toBeGreaterThan(0.95)
      expect(peak(out, sampleRate / 10)).toBeLessThan(1.05)
    }
  )
})

describe('the DX7 engine', () => {
  it("converts as the DX7's DAC: a quiet sample whole, a loud one less 3 bits", () => {
    expect(fm6Converted(1023)).toBe(1023)
    expect(fm6Converted(1025)).toBe(1024)
    expect(fm6Converted(4099)).toBe(4096)
    expect(fm6Converted(16383)).toBe(16376)
    expect(fm6Converted(-1024)).toBe(-1024)
    expect(fm6Converted(-1025)).toBe(-1026)
    expect(fm6Converted(-20000)).toBe(-16384)
  })

  it('plays a sine as the Clean engine does, but for its steps', () => {
    const sine = (which: number) => {
      const patch = new Fm6Patch(SAMPLE_RATE)
      patch.setEngine(which)
      patch.setVoice(16, 0, true)
      return play(patch, 69, 0.3)
    }
    const clean = sine(FM6_ENGINE_CLEAN)
    const chip = sine(FM6_ENGINE_DX7)
    // As loud (the output filter whole at 440 Hz), its steps' noise under
    // -60 dB, the Clean one's far under it
    expect(peak(chip, 4800) / peak(clean, 4800)).toBeCloseTo(1, 2)
    expect(residue(chip, 440, 4800, 14400)).toBeLessThan(1e-3)
    expect(residue(clean, 440, 4800, 14400)).toBeLessThan(
      residue(chip, 440, 4800, 14400) / 10
    )
  })

  it('takes off what lies over 16 kHz, as its output filter does', () => {
    // OP1 alone at a ratio: a C7 (2093 Hz) times 1 or 9 (18.8 kHz)
    const tone = (which: number, coarse: number) => {
      const patch = new Fm6Patch(SAMPLE_RATE)
      patch.setEngine(which)
      patch.setVoice(16, 0, true)
      patch.setOperator(0, false, coarse, 0, 0, 99, 0, 0, 0)
      return peak(play(patch, 96, 0.2), 4800)
    }
    const passed = tone(FM6_ENGINE_DX7, 1) / tone(FM6_ENGINE_CLEAN, 1)
    expect(passed).toBeCloseTo(1, 2)
    const cut = tone(FM6_ENGINE_DX7, 9) / tone(FM6_ENGINE_CLEAN, 9)
    expect(cut).toBeLessThan(0.5)
  })

  it('brightens a carrier with its modulator as the Clean engine does', () => {
    const bright = (which: number) => {
      const patch = new Fm6Patch(SAMPLE_RATE)
      patch.setEngine(which)
      patch.setVoice(1, 0, true)
      patch.setOperator(1, false, 1, 0, 0, 80, 0, 0, 0)
      return brightness(play(patch, 57, 0.5), 220)
    }
    expect(bright(FM6_ENGINE_DX7) / bright(FM6_ENGINE_CLEAN)).toBeCloseTo(1, 1)
  })

  it('takes off what lies over 16 kHz at 44.1 kHz too', () => {
    const tone = (which: number, coarse: number) => {
      const patch = new Fm6Patch(44100)
      patch.setEngine(which)
      patch.setVoice(16, 0, true)
      patch.setOperator(0, false, coarse, 0, 0, 99, 0, 0, 0)
      return peak(play(patch, 96, 0.2, { sampleRate: 44100 }), 4410)
    }
    const passed = tone(FM6_ENGINE_DX7, 1) / tone(FM6_ENGINE_CLEAN, 1)
    expect(passed).toBeCloseTo(1, 2)
    expect(tone(FM6_ENGINE_DX7, 9) / tone(FM6_ENGINE_CLEAN, 9)).toBeLessThan(
      0.5
    )
  })

  it('ends a note on a fourth level too low for its chip to play', () => {
    // L4 6 at Level 99 (velocity's least attenuation in): over the Clean
    // engine's end, under the least level the chip plays
    const held = (which: number) => {
      const patch = new Fm6Patch(SAMPLE_RATE)
      patch.setEngine(which)
      patch.setVoice(16, 0, true)
      patch.setEnvelope(0, 99, 99, 99, 99, 99, 99, 99, 6)
      const voice = new Fm6Voice(SAMPLE_RATE)
      const out = play(patch, 60, 1, { voice, held: 0.1 })
      return { done: voice.done(patch), tail: peak(out, 24000) }
    }
    const chip = held(FM6_ENGINE_DX7)
    expect(chip.done).toBe(true)
    expect(chip.tail).toBeLessThan(1e-5)
    expect(held(FM6_ENGINE_CLEAN).done).toBe(false)
  })

  it('turns six carriers down in the log, together as loud as one', () => {
    const patch = new Fm6Patch(SAMPLE_RATE)
    patch.setVoice(32, 0, true)
    for (let op = 0; op < FM6_OPS; op++) {
      patch.setOperator(op, false, 1, 0, 0, 99, 0, 0, 0)
    }
    const all = peak(play(patch, 69, 0.3), 4800)
    expect(all).toBeGreaterThan(0.97)
    expect(all).toBeLessThan(1.03)
  })
})
