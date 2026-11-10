/**
 * Seed for a state of 0: xorshift32 would stay 0 forever, so a seed whose
 * `| 0` is 0 (0 itself, NaN) starts here instead. It is the golden ratio
 * times 2^32, a value the generator has no special feeling for.
 */
const FALLBACK_SEED = 0x9e3779b9 | 0

/**
 * White noise for a synth voice: every frequency at equal power, from
 * Marsaglia's xorshift32 (2003), three shifts and three xors of a 32-bit
 * state. Each voice seeds its own, so two voices playing noise are not the
 * same signal; an identical pair would add up 6 dB louder and sound hollow.
 * Allocates nothing after the constructor.
 */
export class Noise {
  /** The generator's state: always a nonzero int32, set by reset() */
  #state = 1

  /** Starts the sequence at `seed`; see reset() for the seeds it changes. */
  constructor(seed = 1) {
    this.reset(seed)
  }

  /**
   * Restarts the sequence at `seed`, which becomes the state through `| 0`.
   * A state of 0 would stay 0 forever, so 0 and anything whose `| 0` is 0,
   * such as NaN, uses FALLBACK_SEED instead.
   */
  reset(seed: number): void {
    const state = seed | 0
    this.#state = state === 0 ? FALLBACK_SEED : state
  }

  /**
   * The next sample in [-1, 1): the state advanced by xorshift32's three
   * steps, read unsigned over 2^32 and stretched from [0, 1).
   */
  next(): number {
    let x = this.#state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.#state = x | 0
    return ((this.#state >>> 0) / 4294967296) * 2 - 1
  }

  /**
   * Writes next() into out[start..end), exactly as next() would; samples
   * outside the range are untouched.
   */
  process(out: Float32Array, start = 0, end = out.length): void {
    for (let i = start; i < end; i++) {
      out[i] = this.next()
    }
  }
}
