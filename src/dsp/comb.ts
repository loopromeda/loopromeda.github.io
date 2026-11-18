/**
 * A tuned comb: a delay line as long as one cycle of a pitch, fed back
 * into itself through a lowpass, so what goes in rings at that pitch and
 * its harmonics. A short burst of noise into it is a plucked string, the
 * Karplus-Strong algorithm (Karplus and Strong, "Digital Synthesis of
 * Plucked-String and Drum Timbres", 1983; Jaffe and Smith's extensions,
 * the same year): the lowpass takes the highs away a little each time
 * round, as a string loses them, so the note darkens as it dies. Anything
 * else played into it takes on its pitch, metallic, a resonator's.
 *
 * Its decay is a time, the T60 (to 60 dB down), however high it rings,
 * and its damping's lowpass stands as many octaves over its pitch, so a
 * note sounds alike up and down the keys. The line is read between
 * samples with a cubic (4-point Hermite), its length taking off the
 * lowpass's own delay at the pitch, so the note is in tune. A level past
 * full scale in the loop is bent back towards it, so the ring can never
 * run away.
 *
 * Allocates only in its constructor.
 */

/** The lowest pitch it rings at, in hertz: its line one cycle of it */
export const COMB_MIN_HZ = 20
/** The shortest and longest decays, in seconds */
export const COMB_MIN_DECAY = 0.01
export const COMB_MAX_DECAY = 20
/**
 * How far over the pitch the damping's lowpass stands, in octaves, at a
 * damp of 0 (all but open) and 1 (the pitch itself, a dull thud)
 */
const DAMP_OCTAVES = 8
/** The pitch's length is worked out again this many samples apart */
const COMB_STEP = 8
/** A level past this in the loop is bent back towards it */
const LOOP_CEILING = 1

/** ln(1000): how far down 60 dB is, in nepers */
const T60 = Math.log(1000)

export class Comb {
  readonly #sampleRate: number
  readonly #line: Float32Array
  readonly #size: number
  #write = 0
  /** The damping's lowpass state */
  #low = 0

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    this.#size = Math.ceil(sampleRate / COMB_MIN_HZ) + 8
    this.#line = new Float32Array(this.#size)
  }

  /** Silence in its line */
  reset(): void {
    this.#line.fill(0)
    this.#write = 0
    this.#low = 0
  }

  /**
   * Rings chain[0..length) through the comb, in place: at pitches[i]
   * hertz (per sample; worked out every few), for decay seconds to 60 dB
   * down, damp 0..1 (its lowpass from far above the pitch down to it),
   * mix 0..1 of it in place of the dry signal
   */
  process(
    chain: Float32Array,
    pitches: Float32Array,
    decay: number,
    damp: number,
    mix: number,
    length: number
  ): void {
    const line = this.#line
    const size = this.#size
    const rate = this.#sampleRate
    const t60 = decay > COMB_MIN_DECAY ? decay : COMB_MIN_DECAY
    const dampAt = damp > 0 ? (damp < 1 ? damp : 1) : 0
    const wet = mix > 0 ? (mix < 1 ? mix : 1) : 0
    const dry = 1 - wet
    let write = this.#write
    let low = this.#low
    let delay = 0
    for (let start = 0; start < length; start += COMB_STEP) {
      const end = start + COMB_STEP < length ? start + COMB_STEP : length
      // The pitch where this stretch ends, its delay glided to from here
      const hz = clampHz(pitches[end - 1] as number, rate)
      const coefficient = lowpassCoefficient(hz, dampAt, rate)
      const target = rate / hz - lowpassDelay(coefficient, hz, rate)
      // At least 3 samples: the cubic reads one past where it stands
      const next = target > 3 ? (target < size - 4 ? target : size - 4) : 3
      if (start === 0) delay = next
      const delayStep = (next - delay) / (end - start)
      // Each time round loses as much as the decay asks for at this pitch
      const gain = Math.exp(-T60 / (t60 * hz))
      const a = coefficient
      for (let i = start; i < end; i++) {
        let read = write - delay
        if (read < 0) read += size
        const whole = Math.floor(read)
        const frac = read - whole
        const i0 = whole > 0 ? whole - 1 : whole - 1 + size
        const i1 = whole
        const i2 = whole + 1 < size ? whole + 1 : whole + 1 - size
        const i3 = whole + 2 < size ? whole + 2 : whole + 2 - size
        const ringing = hermite(
          line[i0] as number,
          line[i1] as number,
          line[i2] as number,
          line[i3] as number,
          frac
        )
        low += a * (ringing - low)
        if (low < 1e-20 && low > -1e-20) low = 0
        const x = chain[i] as number
        let into = x + gain * low
        // Bent back past full scale, never running away
        if (into > LOOP_CEILING) into = 2 * LOOP_CEILING - LOOP_CEILING / into
        else if (into < -LOOP_CEILING) {
          into = -2 * LOOP_CEILING - LOOP_CEILING / into
        }
        line[write] = into
        write = write + 1 < size ? write + 1 : 0
        chain[i] = x * dry + into * wet
        delay += delayStep
      }
      delay = next
    }
    this.#write = write
    this.#low = low
  }
}

/** A pitch in hertz within what the line can hold and the Nyquist */
function clampHz(hz: number, rate: number): number {
  const top = rate / 4
  if (!(hz > COMB_MIN_HZ)) return COMB_MIN_HZ
  return hz < top ? hz : top
}

/**
 * The damping lowpass's one-pole coefficient: its corner DAMP_OCTAVES
 * over the pitch at a damp of 0, down to the pitch at 1
 */
function lowpassCoefficient(hz: number, damp: number, rate: number): number {
  const corner = hz * Math.pow(2, DAMP_OCTAVES * (1 - damp))
  const a = 1 - Math.exp((-2 * Math.PI * corner) / rate)
  return a < 1 ? a : 1
}

/**
 * How late the one-pole lowpass y += a (x - y) is at hz, in samples: its
 * phase delay, which the line's length gives back so the ring is in tune
 */
function lowpassDelay(a: number, hz: number, rate: number): number {
  if (a >= 1) return 0
  const w = (2 * Math.PI * hz) / rate
  const b = 1 - a
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w
}

/** The 4-point Hermite cubic between y1 and y2, at t (0..1) */
function hermite(
  y0: number,
  y1: number,
  y2: number,
  y3: number,
  t: number
): number {
  const c1 = 0.5 * (y2 - y0)
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)
  return ((c3 * t + c2) * t + c1) * t + y1
}

/**
 * How much a comb passes at hz, a linear gain (for its picture): ringing
 * at pitch hertz for decay seconds, damped by damp, mix of it over the dry
 * signal, at rate. Its loop as it plays a quiet sound: x in, the line and
 * its lowpass fed back, H = 1 / (1 - g LP(z) z^-D); a louder one, bent
 * back at full scale, rings less high.
 */
export function combGain(
  decay: number,
  damp: number,
  pitch: number,
  hz: number,
  mix = 1,
  rate = 48000
): number {
  const at = clampHz(pitch, rate)
  const dampAt = damp > 0 ? (damp < 1 ? damp : 1) : 0
  const t60 = decay > COMB_MIN_DECAY ? decay : COMB_MIN_DECAY
  const wet = mix > 0 ? (mix < 1 ? mix : 1) : 0
  const a = lowpassCoefficient(at, dampAt, rate)
  const length = Math.max(3, rate / at - lowpassDelay(a, at, rate))
  const gain = Math.exp(-T60 / (t60 * at))
  const w = (2 * Math.PI * Math.min(hz, rate / 2)) / rate
  // LP(z) = a / (1 - (1 - a) z^-1), at z = e^jw
  const b = 1 - a
  const lr = 1 - b * Math.cos(w)
  const li = b * Math.sin(w)
  const l2 = lr * lr + li * li
  const lpr = (a * lr) / l2
  const lpi = (-a * li) / l2
  // times z^-D
  const cr = Math.cos(w * length)
  const ci = -Math.sin(w * length)
  const loopR = gain * (lpr * cr - lpi * ci)
  const loopI = gain * (lpr * ci + lpi * cr)
  // 1 / (1 - loop)
  const dr = 1 - loopR
  const di = -loopI
  const d = dr * dr + di * di
  const re = 1 - wet + (wet * dr) / d
  const im = (wet * -di) / d
  return Math.hypot(re, im)
}
