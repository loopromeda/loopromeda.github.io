import { sinCycles } from './fastMath'

/**
 * A six-operator FM voice after the Yamaha DX7's (docs/plan/sound-chains.md,
 * FM6): six sine operators, each with its own frequency, level and
 * envelope, joined by one of 32 algorithms, one of them feeding back.
 * Every number is the DX7's own (0..99 levels and rates, 0..7
 * sensitivities), so a patch carries over as it was written.
 */

/** Operators in a voice */
export const FM6_OPS = 6

/**
 * One algorithm: for each operator (0 is OP1), the operators whose
 * outputs modulate its phase; which operators are heard; and the
 * feedback, the operator whose last output is fed back (`from`) into the
 * phase of `to`, the same one but in algorithms 4 and 6, where it
 * closes a loop from OP4 (or OP5) back to OP6
 */
export interface Fm6Algorithm {
  readonly modulators: readonly (readonly number[])[]
  readonly carriers: readonly number[]
  readonly feedback: { readonly from: number; readonly to: number }
}

/**
 * An algorithm written as the DX7's chart draws it, operators numbered
 * from 1: each arrow `a>b` (a modulates b), the carriers, and the
 * feedback `from>to` (an operator onto itself, or a loop)
 */
function algorithm(
  arrows: string,
  carriers: readonly number[],
  feedback: string
): Fm6Algorithm {
  const modulators: number[][] = Array.from({ length: FM6_OPS }, () => [])
  for (const arrow of arrows.split(' ').filter(Boolean)) {
    const [a, b] = arrow.split('>').map(Number)
    modulators[(b as number) - 1]?.push((a as number) - 1)
  }
  const [from, to] = feedback.split('>').map(Number)
  return {
    modulators,
    carriers: carriers.map((op) => op - 1),
    feedback: { from: (from as number) - 1, to: (to as number) - 1 },
  }
}

/** The DX7's 32 algorithms, algorithm 1 first */
export const FM6_ALGORITHMS: readonly Fm6Algorithm[] = [
  algorithm('2>1 6>5 5>4 4>3', [1, 3], '6>6'),
  algorithm('2>1 6>5 5>4 4>3', [1, 3], '2>2'),
  algorithm('3>2 2>1 6>5 5>4', [1, 4], '6>6'),
  algorithm('3>2 2>1 6>5 5>4', [1, 4], '4>6'),
  algorithm('2>1 4>3 6>5', [1, 3, 5], '6>6'),
  algorithm('2>1 4>3 6>5', [1, 3, 5], '5>6'),
  algorithm('2>1 4>3 5>3 6>5', [1, 3], '6>6'),
  algorithm('2>1 4>3 5>3 6>5', [1, 3], '4>4'),
  algorithm('2>1 4>3 5>3 6>5', [1, 3], '2>2'),
  algorithm('3>2 2>1 5>4 6>4', [1, 4], '3>3'),
  algorithm('3>2 2>1 5>4 6>4', [1, 4], '6>6'),
  algorithm('2>1 4>3 5>3 6>3', [1, 3], '2>2'),
  algorithm('2>1 4>3 5>3 6>3', [1, 3], '6>6'),
  algorithm('2>1 4>3 5>4 6>4', [1, 3], '6>6'),
  algorithm('2>1 4>3 5>4 6>4', [1, 3], '2>2'),
  algorithm('2>1 3>1 5>1 4>3 6>5', [1], '6>6'),
  algorithm('2>1 3>1 5>1 4>3 6>5', [1], '2>2'),
  algorithm('2>1 3>1 4>1 5>4 6>5', [1], '3>3'),
  algorithm('3>2 2>1 6>4 6>5', [1, 4, 5], '6>6'),
  algorithm('3>1 3>2 5>4 6>4', [1, 2, 4], '3>3'),
  algorithm('3>1 3>2 6>4 6>5', [1, 2, 4, 5], '3>3'),
  algorithm('2>1 6>3 6>4 6>5', [1, 3, 4, 5], '6>6'),
  algorithm('3>2 6>4 6>5', [1, 2, 4, 5], '6>6'),
  algorithm('6>3 6>4 6>5', [1, 2, 3, 4, 5], '6>6'),
  algorithm('6>4 6>5', [1, 2, 3, 4, 5], '6>6'),
  algorithm('3>2 5>4 6>4', [1, 2, 4], '6>6'),
  algorithm('3>2 5>4 6>4', [1, 2, 4], '3>3'),
  algorithm('2>1 5>4 4>3', [1, 3, 6], '5>5'),
  algorithm('4>3 6>5', [1, 2, 3, 5], '6>6'),
  algorithm('5>4 4>3', [1, 2, 3, 6], '5>5'),
  algorithm('6>5', [1, 2, 3, 4, 5], '6>6'),
  algorithm('', [1, 2, 3, 4, 5, 6], '6>6'),
]

/**
 * The algorithms flattened for the voice's loop: each operator's targets
 * (the operators it modulates), algorithm a's operator k's from
 * TARGET_FROM[a·7 + k] to TARGET_FROM[a·7 + k + 1] in TARGETS; what each
 * operator adds to the output (the carriers' mean, as the DX7 turns each
 * down as there are more, the others nothing); the feedback's ends
 */
const TARGET_FROM = new Uint16Array(FM6_ALGORITHMS.length * (FM6_OPS + 1))
const TARGETS = new Uint8Array(FM6_ALGORITHMS.length * FM6_OPS * FM6_OPS)
const CARRIER_WEIGHT = new Float64Array(FM6_ALGORITHMS.length * FM6_OPS)
const FEEDBACK_FROM = new Uint8Array(FM6_ALGORITHMS.length)
const FEEDBACK_TO = new Uint8Array(FM6_ALGORITHMS.length)
FM6_ALGORITHMS.forEach((algorithm, a) => {
  let at = a * FM6_OPS * FM6_OPS
  for (let k = 0; k < FM6_OPS; k++) {
    TARGET_FROM[a * (FM6_OPS + 1) + k] = at
    algorithm.modulators.forEach((from, to) => {
      if (from.includes(k)) TARGETS[at++] = to
    })
    if (algorithm.carriers.includes(k)) {
      CARRIER_WEIGHT[a * FM6_OPS + k] = 1 / algorithm.carriers.length
    }
  }
  TARGET_FROM[a * (FM6_OPS + 1) + FM6_OPS] = at
  FEEDBACK_FROM[a] = algorithm.feedback.from
  FEEDBACK_TO[a] = algorithm.feedback.to
})

/** The sine table's size: a cycle in 4096 steps, as the DX7's ROM has it */
const SINE_SIZE = 4096
const SINE_MASK = SINE_SIZE - 1
/** sin(2π·i/SINE_SIZE), and one past for the last step's line */
const SINE = Float32Array.from({ length: SINE_SIZE + 1 }, (_, i) =>
  Math.sin((2 * Math.PI * i) / SINE_SIZE)
)

/**
 * An FM6's engines. Clean: the DX7's arithmetic, its sine read between
 * the table's steps, its output whole. DX7: its chips' and converter's
 * steps too (Shirriff, righto.com, 2021-2022), and its output's lowpass.
 */
export const FM6_ENGINE_CLEAN = 0
export const FM6_ENGINE_DX7 = 1

/**
 * How an FM6 hears a note's velocity. DX7: as from its own keys, which
 * send no more than about 100 (players' reports; Arturia's DX7 V plays
 * its presets so by default), so MIDI's 127 is its hardest note; Full:
 * MIDI's as it comes, a hard note brighter than its keys could play it
 */
export const FM6_VELOCITY_DX7 = 0
export const FM6_VELOCITY_FULL = 1
/** The DX7's keys' hardest velocity over MIDI's */
const DX7_KEYS = 100 / 127

/**
 * The DX7's operator chip (YM21280): a phase's top 12 bits look up a
 * quarter wave of 1024 logs of the sine, -log2(sin((n + 0.5)/1024 · π/2))
 * in 1024ths of an octave (14 bits; Shirriff rounds it with .5002), the
 * top two bits its sign and its mirror. The envelope's attenuation adds
 * to the log, and 1024 powers of two (12 bits, round(2^(f/1024) · 2048))
 * and a shift of 0 to 15 take it back: a 14-bit amplitude and its sign.
 */
const LOG_SINE = Uint16Array.from({ length: 1024 }, (_, n) =>
  Math.floor(
    -Math.log2(Math.sin(((n + 0.5) / 1024) * (Math.PI / 2))) * 1024 + 0.5002
  )
)
const POWERS = Uint16Array.from({ length: 1024 }, (_, f) =>
  Math.round(2 ** (f / 1024) * 2048)
)
/** The most attenuation the chip's 14 bits hold: 14 octaves and all */
const CHIP_ATTENUATION = 16383
/** The chip's amplitudes in this file's: 8192 is 1 (a level of 15) */
const CHIP_UNIT = 8192
/**
 * Under this level (2, -78 dB) the chip's amplitude is 0 even at the
 * sine's peak: its least step, (2048 << 2) >> 13, needs an attenuation
 * of 14335 at most, an envelope's 12 bits of 513 at least
 */
const CHIP_AUDIBLE = 513 / 256

/** The chip's amplitude (0..16376) at an attenuation (1024ths of an octave) */
function chipAmplitude(attenuation: number): number {
  if (attenuation > CHIP_ATTENUATION) return 0
  const x = CHIP_ATTENUATION - attenuation
  return ((POWERS[x & 1023] as number) << (x >> 10)) >> 13
}

/**
 * A carrier turned down by how many there are, as the chip does it: in
 * the log, round(1024 · log2(n)) (its COM bits, Shirriff)
 */
const CARRIER_ATTENUATION = Uint16Array.from({ length: FM6_OPS + 1 }, (_, n) =>
  n > 1 ? Math.round(1024 * Math.log2(n)) : 0
)
/** Each algorithm's carriers, how many */
const CARRIER_COUNT = Uint8Array.from(
  FM6_ALGORITHMS,
  (algorithm) => algorithm.carriers.length
)

/**
 * A voice's sample (the chip's 15 bits, its carriers summed) as the
 * DX7's converter takes it: 12 bits of it to the DAC, shifted up by as
 * many as its leading zeros (ones, under 0) allow, five or more 3, four
 * 2, three 1, and turned down as much after it (Shirriff, part V), so a
 * quiet sample keeps every bit and a loud one loses its lowest three
 */
export function fm6Converted(sample: number): number {
  const v = sample < -16384 ? -16384 : sample > 16383 ? 16383 : sample
  // Its leading ones, for a sample under 0, as its leading zeros
  const m = v < 0 ? -1 - v : v
  const step = m < 1024 ? 1 : m < 2048 ? 2 : m < 4096 ? 4 : 8
  return Math.floor(v / step) * step
}

/**
 * The DX7's output filter, after its converter: "a sharp low-pass filter
 * around 16 kHz using a Sallen-Key topology" (Shirriff, part V), its
 * order not read off it. Here a fourth-order Butterworth, two sections of
 * these Qs, short of the Nyquist frequency at a low sample rate.
 */
const OUTPUT_CORNER = 16000
const OUTPUT_Q1 = 1 / (2 * Math.cos(Math.PI / 8))
const OUTPUT_Q2 = 1 / (2 * Math.cos((3 * Math.PI) / 8))

/**
 * The DX7's output is coupled through capacitors, its DC taken off: a
 * pair at 1:1 puts a sideband on 0 Hz (a DC as the note's envelope moves,
 * or a few hertz between operators detuned apart, OP5 and OP6 in
 * E.PIANO 1), as much as an eighth of the note's power under 20 Hz, of
 * which the one-pole after the voices (chainSynth.ts, DC_CORNER) left
 * about a hundredth. Here a second-order Butterworth highpass at 20 Hz in
 * each voice, on both engines, its corner not read off a DX7.
 */
const COUPLING_CORNER = 20

/**
 * The coupling's coefficients at a sample rate (the cookbook's highpass,
 * prewarped): b0 (b1 -2 times it, b2 it), a1 and a2, into to
 */
function couplingSection(sampleRate: number, to: Float64Array): void {
  const k = Math.tan((Math.PI * COUPLING_CORNER) / sampleRate)
  const q = Math.SQRT1_2
  const norm = 1 / (1 + k / q + k * k)
  to[0] = norm
  to[1] = 2 * (k * k - 1) * norm
  to[2] = (1 - k / q + k * k) * norm
}

/**
 * A lowpass section's coefficients at a sample rate (the cookbook's,
 * prewarped): b0 (b1 twice it, b2 it), a1 and a2, into to at from
 */
function lowpassSection(
  sampleRate: number,
  q: number,
  to: Float64Array,
  from: number
): void {
  const corner = Math.min(OUTPUT_CORNER, 0.45 * sampleRate)
  const k = Math.tan((Math.PI * corner) / sampleRate)
  const norm = 1 / (1 + k / q + k * k)
  to[from] = k * k * norm
  to[from + 1] = 2 * (k * k - 1) * norm
  to[from + 2] = (1 - k / q + k * k) * norm
}

/** The LFO's waves, in the DX7's order */
export const FM6_LFO_TRIANGLE = 0
export const FM6_LFO_SAW_DOWN = 1
export const FM6_LFO_SAW_UP = 2
export const FM6_LFO_SQUARE = 3
export const FM6_LFO_SINE = 4
export const FM6_LFO_SAMPLE_HOLD = 5

/** A level scaling's curves, in the DX7's order */
export const FM6_CURVE_NEG_LIN = 0
export const FM6_CURVE_NEG_EXP = 1
export const FM6_CURVE_POS_EXP = 2
export const FM6_CURVE_POS_LIN = 3

/** The MIDI note a breakpoint of 0 stands at (the DX7's A-1, an A0) */
export const FM6_BREAKPOINT_NOTE = 21

/**
 * The envelopes and the LFO step this many samples at a time, their
 * levels gliding between the steps sample by sample
 */
export const FM6_STEP = 16

/**
 * Where the DX7's numbers come from. The tables and the arithmetic its
 * CPU does (the levels, velocity, level scaling, the pitch envelope, the
 * LFO, the frequencies' words) are its firmware's (v1.8, as ajxs's
 * annotated disassembly reads it: numbers only, not its code); what its
 * envelope chip does is Raph Levien's measurement of the hardware (his
 * notes in music-synthesizer-for-android, msfa, Apache-2.0) and msfa's
 * code where nothing else tells; Ken Shirriff read the rest off the chips
 * (righto.com, 2021-2022). The code is this file's own.
 *
 * A level here is msfa's: log2 of an operator's amplitude, plus 15, so
 * that 15 (an output level and an envelope level of 99, Velocity 0) is
 * an amplitude of 1, and a modulator there shifts its carrier's phase by
 * 13.1 radians (Yamaha's own figure, FM Theory and Applications), 2.09
 * cycles: MOD_INDEX.
 */
const LEVEL_FULL = 15

/** Cycles a modulator of amplitude 1 shifts its carrier by: π·2^(33/16) rad */
const MOD_INDEX = 2 ** (17 / 16)

/** The DX7's sample rate, its envelopes' clock (Shirriff) */
const DX7_RATE = 49096

/** An output level under 20's own steps; above, 28 plus the level */
const LOW_LEVELS = [
  0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46,
]

/** An output level (0..99) on the DX7's own scale (0..127) */
export function fm6ScaledLevel(level: number): number {
  const l = Math.round(clampTo(level, 0, 99))
  return l >= 20 ? 28 + l : (LOW_LEVELS[l] as number)
}

/** Velocity (MIDI's, by fours) to the firmware's index into VELOCITY_TABLE */
const VELOCITY_INDEX = [
  110, 100, 90, 85, 80, 75, 70, 65, 58, 54, 50, 46, 42, 38, 34, 30, 28, 26, 24,
  22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1, 0,
]

/** How far down a velocity takes a sensitivity of 7 (its index by fours) */
const VELOCITY_TABLE = [
  0, 4, 12, 21, 30, 40, 46, 52, 58, 64, 70, 76, 82, 88, 94, 100, 103, 106, 109,
  112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 131, 132, 133,
]

/**
 * How far velocity (MIDI's 0..127) at a sensitivity (0..7) turns an
 * operator down, in 0.375 dB steps, as the firmware works it out: 15 at
 * any velocity for a sensitivity of 0, at 7 from 1 (127) through 46 (64)
 * to 113 (1)
 */
export function fm6VelocityAttenuation(
  velocity: number,
  sensitivity: number
): number {
  const v = Math.round(clampTo(velocity, 0, 127))
  const s = Math.round(clampTo(sensitivity, 0, 7))
  const index = VELOCITY_INDEX[v >> 2] as number
  const t = VELOCITY_TABLE[index >> 2] as number
  return ((32 * s * t) >> 8) + 15 - 2 * s
}

/**
 * An operator's output level (0..99), its keyboard scaling (fm6ScaleLevel,
 * output level steps up) and velocity's attenuation in, as the envelope
 * takes it: in 32nds of an output level step, msfa's outlevel, the
 * firmware's attenuation of 4 (its least) to 255 below 4304/16
 */
export function fm6OutLevel(
  level: number,
  scaling: number,
  velocity: number
): number {
  const a = clampTo(127 - fm6ScaledLevel(level) - scaling, 0, 127)
  return 4304 - 16 * clampTo(2 * a + velocity, 4, 255)
}

/** A linear level scaling's steps by groups of three keys, the firmware's */
const LIN_SCALE = Array.from({ length: 36 }, (_, i) =>
  i === 22 ? 178 : i < 32 ? 8 * i : 255
)

/** An exponential level scaling's steps by groups of three keys */
const EXP_SCALE = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 19, 23, 28, 33, 39, 47, 57, 67, 80,
  95, 113, 134, 160, 190, 224, 255, 255, 255, 255, 255, 255, 255, 255,
]

/**
 * What the keyboard's level scaling adds to an operator's output level at
 * a MIDI note (transposed), in output level steps (0.75 dB): a depth
 * (0..99) and a curve each side of the breakpoint (0..99, A0 to C8), the
 * firmware's groups of three keys, the breakpoint's group the first of
 * the right side's
 */
export function fm6ScaleLevel(
  note: number,
  breakpoint: number,
  leftDepth: number,
  rightDepth: number,
  leftCurve: number,
  rightCurve: number
): number {
  const group = Math.floor((Math.round(note) - 1) / 3)
  const d = group + 1 - Math.floor((Math.round(breakpoint) + 19) / 3)
  const right = d > 0
  const curve = right ? rightCurve : leftCurve
  const depth = (660 * Math.round(right ? rightDepth : leftDepth)) >> 8
  const table =
    curve === FM6_CURVE_NEG_LIN || curve === FM6_CURVE_POS_LIN
      ? LIN_SCALE
      : EXP_SCALE
  const step = table[Math.min(right ? d : -d, table.length - 1)] as number
  const x = Math.min(127, (step * depth) >> 8)
  return curve < FM6_CURVE_POS_EXP ? 0 - x : x
}

/** What the keyboard's rate scaling (0..7) adds to a rate at a MIDI note */
export function fm6ScaleRate(note: number, sensitivity: number): number {
  const x = clampTo(Math.trunc(Math.round(note) / 3) - 7, 0, 31)
  return (Math.round(clampTo(sensitivity, 0, 7)) * x) >> 3
}

/**
 * How fast an envelope's rate (0..99, its rate scaling added) moves a
 * level, per second: falling, steadily, in levels (6 dB each); rising,
 * so many times the gap left under 17
 */
export function fm6RateSpeed(rate: number, scaling: number): number {
  const q = Math.min(
    63,
    ((Math.round(clampTo(rate, 0, 99)) * 41) >> 6) + scaling
  )
  // A sample's step at the DX7's clock, in 2^-24ths of a level (Levien:
  // 0.2819 dB a second at 0, twice that every 4)
  const increment = (4 + (q & 3)) * 2 ** (2 + (q >> 2))
  return (increment / 2 ** 24) * DX7_RATE
}

/**
 * The level an envelope's level (0..99) stands for, an operator's
 * output level, velocity and scaling given (outLevel, in the scale's
 * 32nds of a step); never under 16/256, a hair over silence
 */
export function fm6EnvTarget(envLevel: number, outLevel: number): number {
  const level = (fm6ScaledLevel(envLevel) >> 1) * 64 + outLevel - 4256
  return (level < 16 ? 16 : level) / 256
}

/** Where a rising envelope jumps to first, if under it: a little over -50 dB */
const ATTACK_FLOOR = 1716 / 256

/** An operator's amplitude at a level: 1 at LEVEL_FULL */
function levelGain(level: number): number {
  return 2 ** (level - LEVEL_FULL)
}

/**
 * Feedback (0..7) as the share of the last two outputs' sum (msfa's
 * amplitudes, twice this file's) it adds to a phase: a quarter at 7, up to
 * a cycle
 */
function feedbackScale(feedback: number): number {
  return feedback === 0 ? 0 : 2 ** (feedback - 8)
}

/**
 * A Ratio operator's frequency over its note's: Coarse (0 a half) times
 * 1 + Fine/100, as the DX7 shows it (Detune aside), on the firmware's
 * 4096ths of an octave (3 a hair flat, 14 a hair sharp)
 */
export function fm6Ratio(coarse: number, fine: number): number {
  const c = Math.round(clampTo(coarse, 0, 31))
  const f = Math.round(clampTo(fine, 0, 99))
  const word =
    (c === 0 ? -4096 : 4 * Math.round(1024 * Math.log2(c))) +
    Math.floor(4096 * Math.log2(1 + f / 100))
  return 2 ** (word / 4096)
}

/**
 * A Fixed operator's frequency in hertz: 10 to the power of Coarse's last
 * two bits (1, 10, 100 or 1000 Hz) times 10^(Fine/100), as the DX7 shows
 * it (Detune aside)
 */
export function fm6FixedHz(coarse: number, fine: number): number {
  const c = Math.round(clampTo(coarse, 0, 31))
  const f = Math.round(clampTo(fine, 0, 99))
  return 10 ** ((c & 3) + f / 100)
}

/** A Fixed operator's Detune step upwards, in octaves (about a cent) */
const FIXED_DETUNE = 13457 / 2 ** 24

/**
 * An operator's frequency at a MIDI note, in hertz: fm6Ratio of the
 * note's, or fm6FixedHz, Detune (-7..7) nudging it. A Ratio's Detune
 * moves it by a share of its pitch in octaves that shrinks as the pitch
 * rises, as measured on a DX7 (msfa's dx7note.cc, as Dexed has it); a
 * Fixed one's only upwards, about a cent a step (msfa).
 */
export function fm6Frequency(
  note: number,
  fixed: boolean,
  coarse: number,
  fine: number,
  detune: number
): number {
  const d = Math.round(clampTo(detune, -7, 7))
  if (fixed) {
    return fm6FixedHz(coarse, fine) * 2 ** (d > 0 ? d * FIXED_DETUNE : 0)
  }
  let octaves = Math.log2(440) + (note - 69) / 12
  octaves += ((0.0209 * Math.exp(-0.396 * octaves)) / 7) * octaves * d
  return 2 ** octaves * fm6Ratio(coarse, fine)
}

function clampTo(value: number, low: number, high: number): number {
  return value > low ? (value < high ? value : high) : low
}

/** An operator's settings, the DX7's numbers, and what they come to */
class Fm6Operator {
  fixed = false
  coarse = 1
  fine = 0
  detune = 0
  level = 0
  velocity = 0
  rateScale = 0
  ams = 0
  readonly rates = new Float64Array([99, 99, 99, 99])
  readonly levels = new Float64Array([99, 99, 99, 0])
  breakpoint = 39
  leftDepth = 0
  rightDepth = 0
  leftCurve = FM6_CURVE_NEG_LIN
  rightCurve = FM6_CURVE_NEG_LIN
}

/**
 * An FM6's settings, which every voice playing it reads: its algorithm
 * and feedback, its operators, its pitch envelope and its LFO, in the
 * DX7's numbers (set by the synth as its knobs turn), and what they come
 * to. Allocates nothing once made.
 */
export class Fm6Patch {
  /** 0..31: FM6_ALGORITHMS' place */
  algorithm = 0
  /** 0..7 */
  feedback = 0
  /** Whether each note starts every operator at the top of its cycle */
  keySync = true
  /** FM6_ENGINE_CLEAN or FM6_ENGINE_DX7 */
  engine = FM6_ENGINE_DX7
  /** FM6_VELOCITY_DX7 or FM6_VELOCITY_FULL */
  velocityRange = FM6_VELOCITY_DX7
  /**
   * Counts the changes to what a note works out as it starts (an
   * operator's frequency, level, velocity and scalings), so a note held
   * hears them too
   */
  version = 0
  readonly ops: readonly Fm6Operator[] = Array.from(
    { length: FM6_OPS },
    () => new Fm6Operator()
  )
  readonly pitchRates = new Float64Array([99, 99, 99, 99])
  readonly pitchLevels = new Float64Array([50, 50, 50, 50])
  lfoWave = FM6_LFO_TRIANGLE
  lfoSpeed = 35
  lfoDelay = 0
  lfoPitch = 0
  lfoAmp = 0
  lfoSync = true
  lfoPms = 3
  /**
   * The LFO, one for every note playing the patch as the DX7's is one:
   * where it stands (cycles), the seconds since a key last went down,
   * its delay's wait and fade-in (seconds), its S&H's value
   */
  lfoPhase = 0
  #lfoAge = 0
  #lfoWait = 0
  #lfoRise = 0
  #lfoHeld = 0.5
  #random = 1
  /**
   * What the LFO does as it stands: the pitch it bends every note by
   * (octaves), and the levels it takes off at an AMS of 3 (0..7)
   */
  vibrato = 0
  tremolo = 0
  readonly #sampleRate: number

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    ;(this.ops[0] as Fm6Operator).level = 99
  }

  /** The algorithm (1..32), feedback (0..7) and Key Sync */
  setVoice(algorithm: number, feedback: number, keySync: boolean): void {
    this.algorithm =
      Math.round(clampTo(algorithm, 1, FM6_ALGORITHMS.length)) - 1
    this.feedback = Math.round(clampTo(feedback, 0, 7))
    this.keySync = keySync
  }

  /** The engine: FM6_ENGINE_CLEAN or FM6_ENGINE_DX7 */
  setEngine(engine: number): void {
    this.engine =
      Math.round(engine) === FM6_ENGINE_CLEAN
        ? FM6_ENGINE_CLEAN
        : FM6_ENGINE_DX7
  }

  /** How velocity is heard: FM6_VELOCITY_DX7 or FM6_VELOCITY_FULL */
  setVelocityRange(range: number): void {
    const next =
      Math.round(range) === FM6_VELOCITY_FULL
        ? FM6_VELOCITY_FULL
        : FM6_VELOCITY_DX7
    if (next === this.velocityRange) return
    this.velocityRange = next
    // A note held hears it too
    this.version++
  }

  /**
   * Operator op's (0 is OP1): Fixed or Ratio, Coarse (0..31), Fine
   * (0..99), Detune (-7..7), Level (0..99), velocity sensitivity (0..7),
   * rate scaling (0..7) and amplitude modulation sensitivity (0..3)
   */
  setOperator(
    op: number,
    fixed: boolean,
    coarse: number,
    fine: number,
    detune: number,
    level: number,
    velocity: number,
    rateScale: number,
    ams: number
  ): void {
    const o = this.ops[op]
    if (!o) return
    coarse = Math.round(clampTo(coarse, 0, 31))
    fine = Math.round(clampTo(fine, 0, 99))
    detune = Math.round(clampTo(detune, -7, 7))
    level = clampTo(level, 0, 99)
    velocity = Math.round(clampTo(velocity, 0, 7))
    rateScale = Math.round(clampTo(rateScale, 0, 7))
    ams = Math.round(clampTo(ams, 0, 3))
    // Every FM6 knob set sets every operator: only a change is worked out
    // again for the notes held
    if (
      o.fixed === fixed &&
      o.coarse === coarse &&
      o.fine === fine &&
      o.detune === detune &&
      o.level === level &&
      o.velocity === velocity &&
      o.rateScale === rateScale &&
      o.ams === ams
    )
      return
    o.fixed = fixed
    o.coarse = coarse
    o.fine = fine
    o.detune = detune
    o.level = level
    o.velocity = velocity
    o.rateScale = rateScale
    o.ams = ams
    this.version++
  }

  /** Operator op's envelope: its four rates and levels, 0..99 */
  setEnvelope(
    op: number,
    r1: number,
    r2: number,
    r3: number,
    r4: number,
    l1: number,
    l2: number,
    l3: number,
    l4: number
  ): void {
    const o = this.ops[op]
    if (!o) return
    set4(o.rates, r1, r2, r3, r4)
    set4(o.levels, l1, l2, l3, l4)
  }

  /**
   * Operator op's level scaling: its breakpoint (0..99, A0 to C8), the
   * depth (0..99) and curve (FM6_CURVE_NEG_LIN...) either side
   */
  setScaling(
    op: number,
    breakpoint: number,
    leftDepth: number,
    rightDepth: number,
    leftCurve: number,
    rightCurve: number
  ): void {
    const o = this.ops[op]
    if (!o) return
    breakpoint = Math.round(clampTo(breakpoint, 0, 99))
    leftDepth = Math.round(clampTo(leftDepth, 0, 99))
    rightDepth = Math.round(clampTo(rightDepth, 0, 99))
    leftCurve = Math.round(clampTo(leftCurve, 0, 3))
    rightCurve = Math.round(clampTo(rightCurve, 0, 3))
    if (
      o.breakpoint === breakpoint &&
      o.leftDepth === leftDepth &&
      o.rightDepth === rightDepth &&
      o.leftCurve === leftCurve &&
      o.rightCurve === rightCurve
    )
      return
    o.breakpoint = breakpoint
    o.leftDepth = leftDepth
    o.rightDepth = rightDepth
    o.leftCurve = leftCurve
    o.rightCurve = rightCurve
    this.version++
  }

  /** The pitch envelope: its four rates and levels, 0..99, 50 the note */
  setPitchEnvelope(
    r1: number,
    r2: number,
    r3: number,
    r4: number,
    l1: number,
    l2: number,
    l3: number,
    l4: number
  ): void {
    set4(this.pitchRates, r1, r2, r3, r4)
    set4(this.pitchLevels, l1, l2, l3, l4)
  }

  /**
   * The LFO: its wave (FM6_LFO_TRIANGLE...), speed and delay (0..99),
   * how far it moves the pitch and the levels (0..99), Key Sync, and the
   * pitch's sensitivity to it (0..7)
   */
  setLfo(
    wave: number,
    speed: number,
    delay: number,
    pitch: number,
    amp: number,
    sync: boolean,
    pms: number
  ): void {
    this.lfoWave = Math.round(clampTo(wave, 0, FM6_LFO_SAMPLE_HOLD))
    this.lfoSpeed = Math.round(clampTo(speed, 0, 99))
    this.lfoDelay = Math.round(clampTo(delay, 0, 99))
    this.lfoPitch = clampTo(pitch, 0, 99)
    this.lfoAmp = clampTo(amp, 0, 99)
    this.lfoSync = sync
    this.lfoPms = Math.round(clampTo(pms, 0, 7))
    // The delay's wait, then its fade in, at the firmware's tick (msfa's
    // 25190424ths of 2^32 a second); none at 0
    const a = 99 - this.lfoDelay
    const count = (16 + (a & 15)) * 2 ** (1 + (a >> 4))
    const rise = Math.max(0x80, count & 0xff80)
    this.#lfoWait = a === 99 ? 0 : 2 ** 31 / (count * 25190424)
    this.#lfoRise = a === 99 ? 0 : 2 ** 31 / (rise * 25190424)
    this.#lfoOut()
  }

  /**
   * A key goes down: the LFO's delay starts over for every note, and with
   * Key Sync on it starts half way through its cycle, as the DX7's does
   */
  keyOn(): void {
    if (this.lfoSync) this.lfoPhase = 0.5
    this.#lfoAge = 0
    this.#lfoOut()
  }

  /** Moves the LFO on by samples, as the DX7's ticks (every 2.6 ms) */
  advance(samples: number): void {
    const seconds = samples / this.#sampleRate
    const phase = this.lfoPhase + fm6LfoHertz(this.lfoSpeed) * seconds
    if (phase >= 1) {
      // The S&H's next value, once a cycle
      this.#random = (this.#random * 179 + 17) & 0xff
      this.#lfoHeld = ((this.#random ^ 0x80) + 1) / 256
    }
    this.lfoPhase = phase - Math.floor(phase)
    this.#lfoAge += seconds
    this.#lfoOut()
  }

  /** The vibrato and the tremolo where the LFO stands */
  #lfoOut(): void {
    const age = this.#lfoAge
    const wait = this.#lfoWait
    const fade =
      age < wait
        ? 0
        : age < wait + this.#lfoRise
          ? (age - wait) / this.#lfoRise
          : 1
    const value = lfoWave(this.lfoWave, this.lfoPhase, this.#lfoHeld)
    // PMD and AMD as the firmware scales them, 0..255
    const pmd = (660 * Math.round(this.lfoPitch)) >> 8
    const pms = PMS[this.lfoPms] as number
    this.vibrato = (pmd * pms * fade * (value - 0.5)) / 2 ** 15
    // It only ever turns down, most at the wave's foot: the amplitude a
    // line, 42 dB under at most (AMS 3)
    const m = fade * ((660 * Math.round(this.lfoAmp)) >> 8) * (1 - value)
    this.tremolo = m > 0 ? Math.min(7, Math.log2(256 / (256 - m))) : 0
  }
}

function set4(
  into: Float64Array,
  a: number,
  b: number,
  c: number,
  d: number
): void {
  into[0] = clampTo(a, 0, 99)
  into[1] = clampTo(b, 0, 99)
  into[2] = clampTo(c, 0, 99)
  into[3] = clampTo(d, 0, 99)
}

/**
 * Samples at 44.1 kHz a stage spends standing still (its level already
 * where it heads), by its rate (0..76; above, 20 a rate under 99): the
 * DX7 counts out the stage's time even then
 */
const STATIC_SAMPLES = [
  1764000, 1764000, 1411200, 1411200, 1190700, 1014300, 992250, 882000, 705600,
  705600, 584325, 507150, 502740, 441000, 418950, 352800, 308700, 286650,
  253575, 220500, 220500, 176400, 145530, 145530, 125685, 110250, 110250, 88200,
  88200, 74970, 61740, 61740, 55125, 48510, 44100, 37485, 31311, 30870, 27562,
  27562, 22050, 18522, 17640, 15435, 14112, 13230, 11025, 9261, 9261, 7717,
  6615, 6615, 5512, 5512, 4410, 3969, 3969, 3439, 2866, 2690, 2249, 1984, 1896,
  1808, 1411, 1367, 1234, 1146, 926, 837, 837, 705, 573, 573, 529, 441, 441,
]

/** Seconds a stage still at rate (its scaling added) lasts */
export function fm6StaticTime(rate: number): number {
  const r = Math.min(99, Math.round(clampTo(rate, 0, 199)))
  const samples = r < 77 ? (STATIC_SAMPLES[r] as number) : 20 * (99 - r)
  return samples / 44100
}

/** The pitch envelope's levels (0..99), in 32nds of an octave: 50 none */
const PITCH_LEVELS = [
  -128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43, -41, -39,
  -37, -35, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23, -22, -21,
  -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4,
  -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 38, 40,
  43, 46, 49, 53, 58, 65, 73, 82, 92, 103, 115, 127,
]

/** The pitch envelope's rates (0..99): 21.3ths of an octave a second */
const PITCH_RATES = [
  1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
  13, 14, 14, 15, 16, 16, 17, 18, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  30, 31, 33, 34, 36, 37, 38, 39, 41, 42, 44, 46, 47, 49, 51, 53, 54, 56, 58,
  60, 62, 64, 66, 68, 70, 72, 74, 76, 79, 82, 85, 88, 91, 94, 98, 102, 106, 110,
  115, 120, 125, 130, 135, 141, 147, 153, 159, 165, 171, 178, 185, 193, 202,
  211, 232, 243, 254, 255,
]

/** A pitch envelope level (0..99) in octaves: 50 the note, 0 and 99 ±4 */
export function fm6PitchLevel(level: number): number {
  return (PITCH_LEVELS[Math.round(clampTo(level, 0, 99))] as number) / 32
}

/** How fast a pitch envelope's rate (0..99) moves it, octaves a second */
export function fm6PitchSpeed(rate: number): number {
  return (PITCH_RATES[Math.round(clampTo(rate, 0, 99))] as number) / 21.3
}

/** The LFO's speed (0..99) in hertz: 0.065 at 0, 5.8 at 35, 51 at 99 */
export function fm6LfoHertz(speed: number): number {
  const s = Math.round(clampTo(speed, 0, 99))
  let rate = s === 0 ? 1 : (660 * s) >> 8
  rate *= rate < 160 ? 11 : 11 + ((rate - 160) >> 2)
  return (rate * 25190424) / 2 ** 32
}

/** The pitch's sensitivity to the LFO (0..7), out of 255 */
const PMS = [0, 10, 20, 33, 55, 92, 153, 255]

/** An operator's amplitude sensitivity to the LFO (0..3), out of 1 */
const AMS = [0, 4342338 / 2 ** 24, 7171437 / 2 ** 24, 1]

/** An envelope's stage past its fourth: over, at its last level */
const DONE = 4

/** An envelope's least level (fm6EnvTarget's floor): -90 dB */
const ENV_FLOOR = 16 / 256

/** Below this an operator is silent: -88 dB, over an envelope's floor */
const SILENT = 4e-5

/**
 * Under this a carrier whose envelope is over is quiet enough to end its
 * note (-80 dB): an envelope's lowest level is under it, a fourth level
 * held above 0 is not
 */
const QUIET = 1e-4

/** 1 / CHIP_UNIT */
const FROM_CHIP = 1 / CHIP_UNIT

/**
 * How long a knob turned under a note held takes to be heard there (the
 * time constant, seconds): its envelope is there at once, what is heard
 * eases after it, unclicked
 */
const KNOB_EASE = 0.01

/**
 * One FM6 note: its six operators' phases and envelopes, the pitch
 * envelope, the LFO and the feedback's last two samples. start() plays
 * a note, release() lets it go, render() adds it into a buffer at the
 * note's pitch sample by sample, as the patch's engine does it. The
 * envelopes and the LFO move every FM6_STEP samples, the operators'
 * gains gliding between (their levels, the DX7's). Allocates nothing.
 */
export class Fm6Voice {
  readonly #sampleRate: number
  /** Each operator's phase, in cycles, and its frequency's ratio */
  readonly #phase = new Float64Array(FM6_OPS)
  readonly #ratio = new Float64Array(FM6_OPS)
  /** Whether each operator's frequency is Fixed, as its ratio was taken */
  readonly #fixed = new Uint8Array(FM6_OPS)
  /** Each operator's envelope: its level, stage, target and speed */
  readonly #level = new Float64Array(FM6_OPS)
  readonly #stage = new Int8Array(FM6_OPS).fill(DONE)
  readonly #target = new Float64Array(FM6_OPS)
  readonly #speed = new Float64Array(FM6_OPS)
  readonly #rising = new Uint8Array(FM6_OPS)
  /** Seconds left of a stage standing still */
  readonly #still = new Float64Array(FM6_OPS)
  /**
   * Each operator's keyboard scaling (output level steps) and velocity's
   * attenuation at the note, and what they and its output level come to
   * (32nds of a step), and its rates' scaling
   */
  readonly #scaling = new Float64Array(FM6_OPS)
  readonly #velocityDown = new Float64Array(FM6_OPS)
  readonly #outLevel = new Float64Array(FM6_OPS)
  readonly #rateScaling = new Float64Array(FM6_OPS)
  /**
   * The level each operator's envelope stands at as heard, a route
   * turning it up in, nothing turning it down: what ends a note
   */
  readonly #heard = new Float64Array(FM6_OPS)
  /** Each operator's gain as the last step ended, and its glide a sample */
  readonly #gain = new Float64Array(FM6_OPS)
  readonly #glide = new Float64Array(FM6_OPS)
  /** The same as levels, for the DX7's engine: its chip glides in the log */
  readonly #now = new Float64Array(FM6_OPS)
  readonly #levelGlide = new Float64Array(FM6_OPS)
  /** The engine the gains above last moved for */
  #engine = FM6_ENGINE_DX7
  /**
   * How far what is heard of each operator's level stands from its
   * envelope's, a knob turned (#refresh), and the share of it left a step
   * on
   */
  readonly #eased = new Float64Array(FM6_OPS)
  readonly #ease: number
  /** What modulates each operator this sample: its modulators' sum */
  readonly #out = new Float64Array(FM6_OPS)
  /**
   * Each operator's phase step this run: a ratio's times the note's step
   * (by), a fixed one's its own (plus)
   */
  readonly #by = new Float64Array(FM6_OPS)
  readonly #plus = new Float64Array(FM6_OPS)
  /** The feedback operator's last two outputs, this file's amplitudes */
  #fb1 = 0
  #fb2 = 0
  /** The DX7's output filter: its two sections' coefficients and state */
  readonly #lowpass = new Float64Array(6)
  readonly #filtered = new Float64Array(4)
  /** The output's coupling (both engines'): its coefficients and state */
  readonly #coupling = new Float64Array(3)
  readonly #coupled = new Float64Array(2)
  /** The feedback's scale, and its glide a sample to the patch's */
  #fbScale = 0
  #fbGlide = 0
  /** The pitch envelope: its pitch (octaves), stage, target, speed */
  #pitch = 0
  #pitchStage = DONE
  #pitchTarget = 0
  #pitchSpeed = 0
  /** The pitch the steps play at (octaves): its envelope's and the LFO's */
  #bend = 0
  /** The note (MIDI's, transposed) and its velocity, and the patch's version */
  #note = 60
  #velocity = 0
  #version = -1
  /** Whether its key is down */
  #down = false
  #untilStep = 0

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    this.#ease = Math.exp(-FM6_STEP / (sampleRate * KNOB_EASE))
    lowpassSection(sampleRate, OUTPUT_Q1, this.#lowpass, 0)
    lowpassSection(sampleRate, OUTPUT_Q2, this.#lowpass, 3)
    couplingSection(sampleRate, this.#coupling)
  }

  /**
   * Whether its key is up and every carrier heard is over and quiet (or
   * silent): a fourth level above 0 holds a note on, as on the DX7
   */
  done(patch: Fm6Patch): boolean {
    if (this.#down) return false
    const carriers = (FM6_ALGORITHMS[patch.algorithm] as Fm6Algorithm).carriers
    const chip = patch.engine === FM6_ENGINE_DX7
    for (let c = 0; c < carriers.length; c++) {
      const op = carriers[c] as number
      const level = this.#heard[op] as number
      const over = this.#stage[op] === DONE
      // The chip plays nothing under CHIP_AUDIBLE: an envelope there, over
      // or falling, is done
      if (chip && level < CHIP_AUDIBLE && (over || this.#rising[op] === 0)) {
        continue
      }
      if (levelGain(level) > (over ? QUIET : SILENT)) return false
    }
    return true
  }

  /**
   * Starts note (a MIDI number, transposed) at velocity (MIDI's 0..127):
   * afresh, from silence (a note begun on this voice), or from where its
   * envelopes stand (a mono note retriggered)
   */
  start(
    patch: Fm6Patch,
    note: number,
    velocity: number,
    afresh: boolean
  ): void {
    this.#down = true
    this.#note = note
    this.#velocity = velocity
    this.#version = patch.version
    for (let k = 0; k < FM6_OPS; k++) {
      const o = patch.ops[k] as Fm6Operator
      this.#setUp(patch, k)
      if (afresh) {
        // An idle voice stands at its fourth level: a note starts there
        const rest = fm6EnvTarget(
          o.levels[3] as number,
          this.#outLevel[k] as number
        )
        this.#level[k] = rest
        this.#gain[k] = o.levels[3] === 0 ? 0 : levelGain(rest)
        this.#now[k] = o.levels[3] === 0 ? 0 : rest
        this.#glide[k] = 0
        this.#levelGlide[k] = 0
        this.#eased[k] = 0
        if (patch.keySync) this.#phase[k] = 0
      }
      this.#heard[k] = this.#level[k] as number
      this.#advance(patch, k, 0)
    }
    if (afresh) {
      this.#fb1 = 0
      this.#fb2 = 0
      this.#fbScale = feedbackScale(patch.feedback)
      this.#fbGlide = 0
      this.#filtered.fill(0)
      this.#coupled.fill(0)
      this.#engine = patch.engine
      this.#pitch = fm6PitchLevel(patch.pitchLevels[3] as number)
    }
    this.#pitchAdvance(patch, 0)
    patch.keyOn()
    this.#untilStep = 0
  }

  /** Lets go of the note: every envelope heads for its fourth level */
  release(patch: Fm6Patch): void {
    if (!this.#down) return
    this.#down = false
    for (let k = 0; k < FM6_OPS; k++) this.#advance(patch, k, 3)
    this.#pitchAdvance(patch, 3)
  }

  /**
   * Adds the note into out over [0, length): steps[j] the note's phase
   * step per sample (its pitch, glide and routes in, its Transpose too);
   * levels[k], if any, what routes add to operator k's output level per
   * sample, a whole its 99 steps
   */
  render(
    patch: Fm6Patch,
    out: Float32Array,
    steps: Float32Array,
    length: number,
    levels: readonly (Float32Array | undefined)[]
  ): void {
    if (this.#version !== patch.version) this.#refresh(patch)
    if (this.#engine !== patch.engine) this.#switch(patch.engine)
    if (patch.engine === FM6_ENGINE_DX7) {
      this.#renderChip(patch, out, steps, length, levels)
    } else {
      this.#renderClean(patch, out, steps, length, levels)
    }
  }

  /** render() in floating point, the sine read between the table's steps */
  #renderClean(
    patch: Fm6Patch,
    out: Float32Array,
    steps: Float32Array,
    length: number,
    levels: readonly (Float32Array | undefined)[]
  ): void {
    const a = patch.algorithm
    const from = TARGET_FROM
    const targets = TARGETS
    const base = a * (FM6_OPS + 1)
    const weight = CARRIER_WEIGHT
    const weights = a * FM6_OPS
    const fbFrom = FEEDBACK_FROM[a] as number
    const fbTo = FEEDBACK_TO[a] as number
    const phase = this.#phase
    const gain = this.#gain
    const glide = this.#glide
    const input = this.#out
    const by = this.#by
    const plus = this.#plus
    let fb1 = this.#fb1
    let fb2 = this.#fb2
    let fbScale = this.#fbScale
    const coupling = this.#coupling
    const h0 = coupling[0] as number
    const h1 = coupling[1] as number
    const h2 = coupling[2] as number
    const coupled = this.#coupled
    let w1 = coupled[0] as number
    let w2 = coupled[1] as number
    let j = 0
    while (j < length) {
      if (this.#untilStep === 0) {
        this.#step(patch, levels, j)
        this.#untilStep = FM6_STEP
      }
      const run = Math.min(this.#untilStep, length - j)
      const fbGlide = this.#fbGlide
      this.#steps()
      for (let n = 0; n < run; n++, j++) {
        const step = steps[j] as number
        let sum = 0
        let fed = 0
        fbScale += fbGlide
        for (let k = FM6_OPS - 1; k >= 0; k--) {
          const g = (gain[k] as number) + (glide[k] as number)
          gain[k] = g
          let p = (phase[k] as number) + step * (by[k] as number)
          p += plus[k] as number
          p -= p | 0
          phase[k] = p
          // What modulates it, taken: the next sample's starts from 0, as
          // only higher operators modulate a lower one
          const into = input[k] as number
          input[k] = 0
          let y = 0
          if (g > SILENT) {
            let x = p + into * MOD_INDEX
            if (k === fbTo) x += (fb1 + fb2) * fbScale
            // The sine read off a table, as the DX7 reads its ROM: what
            // modulates a phase never takes it more than 64 cycles back
            const t = (x + 64) * SINE_SIZE
            const i = t | 0
            const at = i & SINE_MASK
            const s0 = SINE[at] as number
            y = (s0 + ((SINE[at + 1] as number) - s0) * (t - i)) * g
          }
          for (
            let m = from[base + k] as number;
            m < (from[base + k + 1] as number);
            m++
          ) {
            const to = targets[m] as number
            input[to] = (input[to] as number) + y
          }
          sum += y * (weight[weights + k] as number)
          if (k === fbFrom) fed = y
        }
        fb2 = fb1
        fb1 = fed
        // Through the output's coupling (transposed direct form II)
        const y = h0 * sum + w1
        w1 = -2 * h0 * sum - h1 * y + w2
        w2 = h0 * sum - h2 * y
        out[j] = (out[j] as number) + y
      }
      this.#untilStep -= run
    }
    this.#fb1 = fb1
    this.#fb2 = fb2
    this.#fbScale = fbScale
    coupled[0] = flush(w1)
    coupled[1] = flush(w2)
  }

  /**
   * render() as the DX7's chip works it: a phase's 12 bits look up the
   * log of a sine, the envelope's level (12 bits) adds to it, a power of
   * two takes it back to 14 bits and a sign; the carriers, each turned
   * down in the log by how many there are, summed, converted as its
   * DAC takes them (fm6Converted) and filtered as its output is
   */
  #renderChip(
    patch: Fm6Patch,
    out: Float32Array,
    steps: Float32Array,
    length: number,
    levels: readonly (Float32Array | undefined)[]
  ): void {
    const a = patch.algorithm
    const from = TARGET_FROM
    const targets = TARGETS
    const base = a * (FM6_OPS + 1)
    const weight = CARRIER_WEIGHT
    const weights = a * FM6_OPS
    const carrierDown = CARRIER_ATTENUATION[
      CARRIER_COUNT[a] as number
    ] as number
    const fbFrom = FEEDBACK_FROM[a] as number
    const fbTo = FEEDBACK_TO[a] as number
    const phase = this.#phase
    const now = this.#now
    const glide = this.#levelGlide
    const input = this.#out
    const by = this.#by
    const plus = this.#plus
    let fb1 = this.#fb1
    let fb2 = this.#fb2
    let fbScale = this.#fbScale
    const lowpass = this.#lowpass
    const b0 = lowpass[0] as number
    const a1 = lowpass[1] as number
    const a2 = lowpass[2] as number
    const c0 = lowpass[3] as number
    const c1 = lowpass[4] as number
    const c2 = lowpass[5] as number
    const filtered = this.#filtered
    let u1 = filtered[0] as number
    let u2 = filtered[1] as number
    let v1 = filtered[2] as number
    let v2 = filtered[3] as number
    const coupling = this.#coupling
    const h0 = coupling[0] as number
    const h1 = coupling[1] as number
    const h2 = coupling[2] as number
    const coupled = this.#coupled
    let w1 = coupled[0] as number
    let w2 = coupled[1] as number
    let j = 0
    while (j < length) {
      if (this.#untilStep === 0) {
        this.#step(patch, levels, j)
        this.#untilStep = FM6_STEP
      }
      const run = Math.min(this.#untilStep, length - j)
      const fbGlide = this.#fbGlide
      this.#steps()
      for (let n = 0; n < run; n++, j++) {
        const step = steps[j] as number
        let sum = 0
        let fed = 0
        fbScale += fbGlide
        for (let k = FM6_OPS - 1; k >= 0; k--) {
          const level = (now[k] as number) + (glide[k] as number)
          now[k] = level
          let p = (phase[k] as number) + step * (by[k] as number)
          p += plus[k] as number
          p -= p | 0
          phase[k] = p
          const into = input[k] as number
          input[k] = 0
          let y = 0
          if (level >= CHIP_AUDIBLE) {
            let x = p + into * MOD_INDEX
            if (k === fbTo) x += (fb1 + fb2) * fbScale
            // The phase's top 12 bits: a quarter wave's place, mirrored in
            // the second and fourth quarters, the sign in the second half
            const i = ((x + 64) * SINE_SIZE) | 0
            const q = i & 1023
            const e = 4096 - ((level * 256) | 0)
            const down =
              (LOG_SINE[i & 1024 ? 1023 - q : q] as number) +
              (e > 0 ? e << 2 : 0)
            const m = chipAmplitude(down)
            const negative = (i & 2048) !== 0
            y = (negative ? -m : m) * FROM_CHIP
            if ((weight[weights + k] as number) > 0) {
              const c = chipAmplitude(down + carrierDown)
              sum += negative ? -c : c
            }
          }
          for (
            let m = from[base + k] as number;
            m < (from[base + k + 1] as number);
            m++
          ) {
            const to = targets[m] as number
            input[to] = (input[to] as number) + y
          }
          if (k === fbFrom) fed = y
        }
        fb2 = fb1
        fb1 = fed
        // Through the output filter's two sections (transposed direct
        // form II)
        const x = fm6Converted(sum) * FROM_CHIP
        const y = b0 * x + u1
        u1 = 2 * b0 * x - a1 * y + u2
        u2 = b0 * x - a2 * y
        const z = c0 * y + v1
        v1 = 2 * c0 * y - c1 * z + v2
        v2 = c0 * y - c2 * z
        // And its coupling
        const o = h0 * z + w1
        w1 = -2 * h0 * z - h1 * o + w2
        w2 = h0 * z - h2 * o
        out[j] = (out[j] as number) + o
      }
      this.#untilStep -= run
    }
    this.#fb1 = fb1
    this.#fb2 = fb2
    this.#fbScale = fbScale
    // Its high-Q section never settles on 0 by itself (its a2 over 0.5):
    // flushed, so a note dying out costs no denormals
    filtered[0] = flush(u1)
    filtered[1] = flush(u2)
    filtered[2] = flush(v1)
    filtered[3] = flush(v2)
    coupled[0] = flush(w1)
    coupled[1] = flush(w2)
  }

  /**
   * The engine changed under a note: the levels the other engine glided
   * taken over, held to the next step, and its output filter cleared
   */
  #switch(engine: number): void {
    this.#engine = engine
    for (let k = 0; k < FM6_OPS; k++) {
      if (engine === FM6_ENGINE_DX7) {
        const gain = this.#gain[k] as number
        this.#now[k] = gain > 0 ? Math.log2(gain) + LEVEL_FULL : 0
      } else {
        const level = this.#now[k] as number
        this.#gain[k] = level > 0 ? levelGain(level) : 0
      }
      this.#glide[k] = 0
      this.#levelGlide[k] = 0
    }
    if (engine === FM6_ENGINE_DX7) this.#filtered.fill(0)
  }

  /** Each operator's phase step for the run: a ratio's follows the note's */
  #steps(): void {
    const bend = 2 ** this.#bend
    const toCycles = 1 / this.#sampleRate
    for (let k = 0; k < FM6_OPS; k++) {
      const r = (this.#ratio[k] as number) * bend
      const fixed = this.#fixed[k] === 1
      this.#by[k] = fixed ? 0 : r
      this.#plus[k] = fixed ? r * toCycles : 0
    }
  }

  /**
   * What operator k comes to at the note and its velocity: its level's
   * and rates' scalings, velocity's attenuation, its frequency
   */
  #setUp(patch: Fm6Patch, k: number): void {
    const o = patch.ops[k] as Fm6Operator
    const note = this.#note
    const key = Math.round(note)
    const scaling = fm6ScaleLevel(
      key,
      o.breakpoint,
      o.leftDepth,
      o.rightDepth,
      o.leftCurve,
      o.rightCurve
    )
    const velocity =
      patch.velocityRange === FM6_VELOCITY_DX7
        ? this.#velocity * DX7_KEYS
        : this.#velocity
    const velocityDown = fm6VelocityAttenuation(velocity, o.velocity)
    this.#scaling[k] = scaling
    this.#velocityDown[k] = velocityDown
    this.#outLevel[k] = fm6OutLevel(o.level, scaling, velocityDown)
    this.#rateScaling[k] = fm6ScaleRate(key, o.rateScale)
    const f = fm6Frequency(note, o.fixed, o.coarse, o.fine, o.detune)
    // A ratio's frequency over the note's; a fixed one's in hertz
    this.#fixed[k] = o.fixed ? 1 : 0
    this.#ratio[k] = o.fixed ? f : f / (440 * 2 ** ((note - 69) / 12))
  }

  /**
   * The patch's operators changed under a note held (a knob turned, a
   * lane moving one): each works its scalings and frequency out again.
   * An envelope resting (sustaining, or over) stands at its level anew,
   * one moving is moved by what its output level moved and goes on with
   * its stage; what is heard eases after it (#eased)
   */
  #refresh(patch: Fm6Patch): void {
    this.#version = patch.version
    for (let k = 0; k < FM6_OPS; k++) {
      const before = this.#outLevel[k] as number
      const was = this.#level[k] as number
      this.#setUp(patch, k)
      const outLevel = this.#outLevel[k] as number
      const o = patch.ops[k] as Fm6Operator
      const stage = this.#stage[k] as number
      if (stage >= DONE || (stage === 3 && this.#down)) {
        // At rest: its level's target, worked out again, so a level turned
        // down to nothing and back stands where it stood
        const held = stage >= DONE ? 3 : 2
        this.#level[k] = fm6EnvTarget(o.levels[held] as number, outLevel)
      } else {
        const level = was + (outLevel - before) / 256
        this.#level[k] = level > ENV_FLOOR ? level : ENV_FLOOR
      }
      this.#eased[k] =
        (this.#eased[k] as number) + was - (this.#level[k] as number)
      if (stage >= DONE) continue
      const target = fm6EnvTarget(o.levels[stage] as number, outLevel)
      this.#target[k] = target
      this.#rising[k] = target > (this.#level[k] as number) ? 1 : 0
      this.#speed[k] = fm6RateSpeed(
        o.rates[stage] as number,
        this.#rateScaling[k] as number
      )
    }
  }

  /**
   * One step of the envelopes and the LFO, FM6_STEP samples on: each
   * operator's gain (and level) set to glide to where its envelope will
   * stand, its level routes (read at sample at) and the LFO's tremolo
   * in, and the feedback to the patch's
   */
  #step(
    patch: Fm6Patch,
    levels: readonly (Float32Array | undefined)[],
    at: number
  ): void {
    const dt = FM6_STEP / this.#sampleRate
    this.#pitchMove(patch, dt)
    this.#fbGlide = (feedbackScale(patch.feedback) - this.#fbScale) / FM6_STEP
    for (let k = 0; k < FM6_OPS; k++) {
      this.#envMove(patch, k, dt)
      const o = patch.ops[k] as Fm6Operator
      const eased = this.#eased[k] as number
      this.#eased[k] = eased > 1e-4 || eased < -1e-4 ? eased * this.#ease : 0
      let level = (this.#level[k] as number) + eased
      let heard = level
      const route = levels[k]
      if (route) {
        // A route turns the output level, no further than 0 and 99
        const routed = clampTo(o.level + (route[at] as number) * 99, 0, 99)
        const by =
          (fm6OutLevel(
            routed,
            this.#scaling[k] as number,
            this.#velocityDown[k] as number
          ) -
            (this.#outLevel[k] as number)) /
          256
        level += by
        if (by > 0) heard = level
      }
      this.#heard[k] = heard
      level -= patch.tremolo * (AMS[o.ams] as number)
      this.#levelGlide[k] = (level - (this.#now[k] as number)) / FM6_STEP
      const next = level > 0 ? levelGain(level) : 0
      this.#glide[k] = (next - (this.#gain[k] as number)) / FM6_STEP
    }
  }

  /** Operator k's envelope dt seconds on */
  #envMove(patch: Fm6Patch, k: number, dt: number): void {
    const stage = this.#stage[k] as number
    // The fourth heads off only once the key is up
    if (stage >= DONE || (stage === 3 && this.#down)) return
    const still = this.#still[k] as number
    if (still > 0) {
      const left = still - dt
      this.#still[k] = left > 0 ? left : 0
      if (left <= 0) this.#advance(patch, k, stage + 1)
      return
    }
    let level = this.#level[k] as number
    const target = this.#target[k] as number
    const speed = (this.#speed[k] as number) * dt
    if (this.#rising[k] === 1) {
      if (level < ATTACK_FLOOR) level = ATTACK_FLOOR
      level += Math.floor(17 - level) * speed
      if (level >= target) {
        this.#level[k] = target
        this.#advance(patch, k, stage + 1)
        return
      }
    } else {
      level -= speed
      if (level <= target) {
        this.#level[k] = target
        this.#advance(patch, k, stage + 1)
        return
      }
    }
    this.#level[k] = level
  }

  /** Operator k's envelope into stage (0..3; 4 over) */
  #advance(patch: Fm6Patch, k: number, stage: number): void {
    this.#stage[k] = stage
    this.#still[k] = 0
    if (stage >= DONE) return
    const o = patch.ops[k] as Fm6Operator
    const level = o.levels[stage] as number
    const target = fm6EnvTarget(level, this.#outLevel[k] as number)
    const current = this.#level[k] as number
    this.#target[k] = target
    this.#rising[k] = target > current ? 1 : 0
    const rate = o.rates[stage] as number
    const scaling = this.#rateScaling[k] as number
    this.#speed[k] = fm6RateSpeed(rate, scaling)
    if (target === current || (stage === 0 && level === 0)) {
      // Already there: the stage still takes its time
      this.#still[k] = fm6StaticTime(rate + scaling)
    }
  }

  /** The pitch envelope dt seconds on, and the pitch it and the LFO make */
  #pitchMove(patch: Fm6Patch, dt: number): void {
    const stage = this.#pitchStage
    if (stage < DONE && !(stage === 3 && this.#down)) {
      const target = this.#pitchTarget
      const speed = this.#pitchSpeed * dt
      let pitch = this.#pitch
      if (pitch < target) {
        pitch += speed
        if (pitch >= target) {
          pitch = target
          this.#pitchAdvance(patch, stage + 1)
        }
      } else {
        pitch -= speed
        if (pitch <= target) {
          pitch = target
          this.#pitchAdvance(patch, stage + 1)
        }
      }
      this.#pitch = pitch
    }
    this.#bend = this.#pitch + patch.vibrato
  }

  /** The pitch envelope into stage (0..3; 4 over) */
  #pitchAdvance(patch: Fm6Patch, stage: number): void {
    this.#pitchStage = stage
    if (stage >= DONE) return
    this.#pitchTarget = fm6PitchLevel(patch.pitchLevels[stage] as number)
    this.#pitchSpeed = fm6PitchSpeed(patch.pitchRates[stage] as number)
  }
}

/**
 * The LFO's wave at phase (cycles), 0..1, an S&H at held: msfa's, its
 * triangle's peak, its saws' leaps and its square's fall half way, where
 * Key Sync starts it
 */
function lfoWave(wave: number, phase: number, held: number): number {
  switch (wave) {
    case FM6_LFO_TRIANGLE:
      return phase < 0.5 ? 2 * phase : 2 - 2 * phase
    case FM6_LFO_SAW_DOWN:
      return phase < 0.5 ? 0.5 - phase : 1.5 - phase
    case FM6_LFO_SAW_UP:
      return phase < 0.5 ? phase + 0.5 : phase - 0.5
    case FM6_LFO_SQUARE:
      return phase < 0.5 ? 1 : 0
    case FM6_LFO_SINE:
      return 0.5 + 0.5 * sinCycles(phase)
    default:
      return held
  }
}

/** value, or 0 where it nears the denormals */
function flush(value: number): number {
  return value > 1e-20 || value < -1e-20 ? value : 0
}
