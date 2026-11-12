/**
 * Keeps the screen on while the synth plays: a phone that dims and locks
 * in the middle of a song stops its audio. The lock is asked for while it
 * is wanted (the audio running, Settings' Keep screen on) and the page is
 * in front. The browser lets go of it when the page goes to the back, so
 * it is asked for again on the way back. Where the browser has no Screen
 * Wake Lock, or refuses it (a battery saver), the screen dims as before.
 */
export class ScreenAwake {
  readonly #lock: Pick<WakeLock, 'request'> | undefined
  readonly #page: Pick<Document, 'visibilityState'>
  #wanted = false
  #held: WakeLockSentinel | undefined
  #asking = false

  /**
   * lock is the browser's (navigator.wakeLock), or none; page is the
   * document, whose visibility changes ask again
   */
  constructor(
    lock: Pick<WakeLock, 'request'> | undefined,
    page: Pick<Document, 'visibilityState' | 'addEventListener'>
  ) {
    this.#lock = lock
    this.#page = page
    page.addEventListener('visibilitychange', () => void this.#follow())
  }

  /** True while the screen is kept on */
  get held(): boolean {
    return this.#held !== undefined
  }

  /** Whether the screen should stay on, the page in front */
  want(wanted: boolean): void {
    this.#wanted = wanted
    void this.#follow()
  }

  get #due(): boolean {
    return this.#wanted && this.#page.visibilityState === 'visible'
  }

  /** Asks for the lock, or lets it go, as it is due */
  async #follow(): Promise<void> {
    if (!this.#due) {
      const held = this.#held
      this.#held = undefined
      await held?.release().catch(() => undefined)
      return
    }
    if (this.#held || this.#asking || !this.#lock) return
    this.#asking = true
    let sentinel: WakeLockSentinel
    try {
      sentinel = await this.#lock.request('screen')
    } catch {
      // Refused (a battery saver, a page not in front): it dims as before
      return
    } finally {
      this.#asking = false
    }
    // Let go while it was asked for: given back at once
    if (!this.#due) {
      await sentinel.release().catch(() => undefined)
      return
    }
    this.#held = sentinel
    sentinel.addEventListener('release', () => {
      if (this.#held === sentinel) this.#held = undefined
    })
  }
}
