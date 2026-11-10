/** The envelope is off, the level is 0 */
export const IDLE = 0
/** Rising towards 1 */
export const ATTACK = 1
/** Falling from 1 towards the sustain level */
export const DECAY = 2
/** Held at the sustain level while the gate is on */
export const SUSTAIN = 3
/** Falling from the current level towards 0 */
export const RELEASE = 4
/** Forced linear fall to 0, whatever the gate does */
export const CHOKE = 5

/** One of the stage constants above */
export type Stage = 0 | 1 | 2 | 3 | 4 | 5

/** Seconds for a full-scale fall in a choke */
export const CHOKE_TIME = 0.003

/** Seconds, one-pole time constant of the glide to a new sustain level */
export const SUSTAIN_GLIDE = 0.005

/**
 * Fraction of the gap left over at the end of the attack. A big ratio makes
 * the attack visibly curved; the decay and release use a tiny one so they
 * look like a plain exponential.
 */
export const RATIO_A = 0.3

/** Fraction of the gap left over at the end of a decay or release */
export const RATIO_DR = 0.0001

/** Closer to the sustain than this, the level lands on it */
const SUSTAIN_SNAP = 1e-9

const DEFAULT_ATTACK = 0.005
const DEFAULT_DECAY = 0.3
const DEFAULT_SUSTAIN = 0.7
const DEFAULT_RELEASE = 0.3

/**
 * Settings shared by many envelopes: every voice of a synth reads the same
 * shape. All the per-sample work is precomputed here, so Adsr only reads a
 * few numbers. A voice reads the shape on every sample, so set() takes
 * effect from the current level without a jump.
 */
export class AdsrShape {
  /** Samples per second */
  readonly sampleRate: number

  /**
   * Per-sample coefficients and offsets, recomputed by set(). Adsr reads
   * them every sample; nothing else writes them.
   */
  attackCoef = 0
  attackBase = 0
  decayCoef = 0
  decayBase = 0
  releaseCoef = 0
  releaseBase = 0

  /** Level a choke takes off per sample */
  readonly chokeStep: number

  /** Fraction of the remaining sustain gap a sample covers */
  readonly sustainCoef: number

  private attackValue = DEFAULT_ATTACK
  private decayValue = DEFAULT_DECAY
  private sustainValue = DEFAULT_SUSTAIN
  private releaseValue = DEFAULT_RELEASE

  constructor(sampleRate: number) {
    if (!isPositiveFinite(sampleRate)) {
      throw new RangeError(
        `sampleRate must be positive and finite: ${sampleRate}`
      )
    }
    this.sampleRate = sampleRate
    this.chokeStep = 1 / (CHOKE_TIME * sampleRate)
    this.sustainCoef = 1 - Math.exp(-1 / (SUSTAIN_GLIDE * sampleRate))
    this.configure(
      DEFAULT_ATTACK,
      DEFAULT_DECAY,
      DEFAULT_SUSTAIN,
      DEFAULT_RELEASE
    )
  }

  /**
   * Times in seconds, > 0 and finite; sustain in [0, 1]. A bad argument
   * throws and leaves the previous settings untouched.
   */
  set(attack: number, decay: number, sustain: number, release: number): void {
    if (!isPositiveFinite(attack)) {
      throw new RangeError(`attack must be positive and finite: ${attack}`)
    }
    if (!isPositiveFinite(decay)) {
      throw new RangeError(`decay must be positive and finite: ${decay}`)
    }
    if (!isPositiveFinite(release)) {
      throw new RangeError(`release must be positive and finite: ${release}`)
    }
    if (!(sustain >= 0 && sustain <= 1)) {
      throw new RangeError(`sustain must be in [0, 1]: ${sustain}`)
    }
    this.configure(attack, decay, sustain, release)
  }

  /** Attack time in seconds */
  get attack(): number {
    return this.attackValue
  }

  /** Decay time in seconds */
  get decay(): number {
    return this.decayValue
  }

  /** Level held while the gate is on, in [0, 1] */
  get sustain(): number {
    return this.sustainValue
  }

  /** Release time in seconds */
  get release(): number {
    return this.releaseValue
  }

  private configure(
    attack: number,
    decay: number,
    sustain: number,
    release: number
  ): void {
    this.attackValue = attack
    this.decayValue = decay
    this.sustainValue = sustain
    this.releaseValue = release
    const rate = this.sampleRate
    this.attackCoef = coefficient(attack, RATIO_A, rate)
    this.attackBase = (1 + RATIO_A) * (1 - this.attackCoef)
    this.decayCoef = coefficient(decay, RATIO_DR, rate)
    this.decayBase = (sustain - RATIO_DR) * (1 - this.decayCoef)
    this.releaseCoef = coefficient(release, RATIO_DR, rate)
    this.releaseBase = -RATIO_DR * (1 - this.releaseCoef)
  }
}

/**
 * One exponential envelope, advanced one sample at a time. The level always
 * continues from where it is, so gate and shape changes never click. Reads
 * the shape every sample and allocates nothing, safe for the audio thread.
 */
export class Adsr {
  private readonly shape: AdsrShape
  private stageValue: Stage = IDLE
  private levelValue = 0

  constructor(shape: AdsrShape) {
    this.shape = shape
  }

  /** The current stage constant */
  get stage(): Stage {
    return this.stageValue
  }

  /** Current gain, in [0, 1] */
  get level(): number {
    return this.levelValue
  }

  /** True while the envelope runs, false when it is idle at zero */
  get active(): boolean {
    return this.stageValue !== IDLE
  }

  /**
   * Starts or restarts the attack from the current level, which it never
   * resets; it also cancels a choke.
   */
  gateOn(): void {
    this.stageValue = ATTACK
  }

  /**
   * Releases from the current level. In IDLE, RELEASE or CHOKE it does
   * nothing.
   */
  gateOff(): void {
    const stage = this.stageValue
    if (stage === ATTACK || stage === DECAY || stage === SUSTAIN) {
      this.stageValue = RELEASE
    }
  }

  /** Drops straight to 0 from any stage; idle, it does nothing */
  choke(): void {
    if (this.stageValue !== IDLE) this.stageValue = CHOKE
  }

  /** Straight to idle at zero */
  reset(): void {
    this.stageValue = IDLE
    this.levelValue = 0
  }

  /** Advances one sample and returns the new level */
  next(): number {
    const shape = this.shape
    let stage = this.stageValue
    let level = this.levelValue
    switch (stage) {
      case ATTACK:
        level = shape.attackBase + level * shape.attackCoef
        if (level >= 1) {
          level = 1
          stage = DECAY
        }
        break
      case DECAY:
        // A sustain raised above the level: glide up to it, do not jump
        if (level <= shape.sustain) {
          stage = SUSTAIN
          break
        }
        level = shape.decayBase + level * shape.decayCoef
        if (level <= shape.sustain) {
          level = shape.sustain
          stage = SUSTAIN
        }
        break
      case SUSTAIN: {
        const target = shape.sustain
        level += (target - level) * shape.sustainCoef
        if (Math.abs(target - level) < SUSTAIN_SNAP) level = target
        break
      }
      case RELEASE:
        level = shape.releaseBase + level * shape.releaseCoef
        if (level <= 0) {
          level = 0
          stage = IDLE
        }
        break
      case CHOKE:
        level -= shape.chokeStep
        if (level <= 0) {
          level = 0
          stage = IDLE
        }
        break
      default:
        level = 0
    }
    this.stageValue = stage
    this.levelValue = level
    return level
  }

  /**
   * Multiplies out[start..end) by the envelope, advancing it one step per
   * sample. The state is copied into locals so the sample loop does not
   * touch `this`; the shape is still read per sample.
   */
  apply(out: Float32Array, start = 0, end = out.length): void {
    const shape = this.shape
    let stage = this.stageValue
    let level = this.levelValue
    for (let i = start; i < end; i++) {
      switch (stage) {
        case ATTACK:
          level = shape.attackBase + level * shape.attackCoef
          if (level >= 1) {
            level = 1
            stage = DECAY
          }
          break
        case DECAY:
          // A sustain raised above the level: glide up to it, do not jump
          if (level <= shape.sustain) {
            stage = SUSTAIN
            break
          }
          level = shape.decayBase + level * shape.decayCoef
          if (level <= shape.sustain) {
            level = shape.sustain
            stage = SUSTAIN
          }
          break
        case SUSTAIN: {
          const target = shape.sustain
          level += (target - level) * shape.sustainCoef
          if (Math.abs(target - level) < SUSTAIN_SNAP) level = target
          break
        }
        case RELEASE:
          level = shape.releaseBase + level * shape.releaseCoef
          if (level <= 0) {
            level = 0
            stage = IDLE
          }
          break
        case CHOKE:
          level -= shape.chokeStep
          if (level <= 0) {
            level = 0
            stage = IDLE
          }
          break
        default:
          level = 0
      }
      out[i] = (out[i] as number) * level
    }
    this.stageValue = stage
    this.levelValue = level
  }
}

/**
 * One-pole coefficient for a curve that runs to a target in `seconds`. The
 * fixed point of the filter sits a `ratio` of the span beyond the target, so
 * the level crosses the target exactly at the end of the time and settles on
 * it shortly after; after `seconds` it still covers `ratio` of the gap.
 */
function coefficient(seconds: number, ratio: number, sampleRate: number) {
  return Math.exp(-Math.log((1 + ratio) / ratio) / (seconds * sampleRate))
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
