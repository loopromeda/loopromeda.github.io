/**
 * Who watches which compressor's or limiter's gain reduction: any number
 * at once (every tile of one on screen), the same effect by several (its
 * tile and its panel). The audio thread is told the effects watched, in
 * order, under a version that changes with the list; its reports, in that
 * order, reach each effect's listeners, and one made for a list since
 * changed is dropped. Plain data and callbacks: no Web Audio.
 */
import type { EffectAt, ReductionReport, ToWorklet } from './protocol'

type Listener = (db: number) => void
type Watch = Extract<ToWorklet, { t: 'watchReduction' }>

/** An effect's place as one string: its track's id (or none), its id */
const keyOf = (at: EffectAt) => `${at.track ?? ''}/${at.id}`

export class ReductionWatchers {
  readonly #post: (message: Watch) => void
  /** Each effect watched, by keyOf, and who watches it */
  readonly #watched = new Map<
    string,
    { readonly at: EffectAt; readonly listeners: Set<Listener> }
  >()
  /** The list as last told, in the reports' order */
  #listeners: (readonly Listener[])[] = []
  #message: Watch = { t: 'watchReduction', version: 0, at: [] }

  /** post tells the audio thread each new list */
  constructor(post: (message: Watch) => void) {
    this.#post = post
  }

  /** Whether any is watched: a new audio thread is told the list */
  get watching(): boolean {
    return this.#watched.size > 0
  }

  /** The list the audio thread is to report on, under its version */
  get message(): Watch {
    return this.#message
  }

  /**
   * listener is told of the effect at `at` from now on; the list changes
   * only for an effect no one watched. Returns the way to stop, once.
   */
  watch(at: EffectAt, listener: Listener): () => void {
    const key = keyOf(at)
    let entry = this.#watched.get(key)
    // A listener of its own, so one function watching twice stops twice
    const own: Listener = (db) => listener(db)
    if (!entry) {
      entry = { at: { ...at }, listeners: new Set([own]) }
      this.#watched.set(key, entry)
      this.#tell()
    } else {
      entry.listeners.add(own)
      this.#relist()
    }
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      const now = this.#watched.get(key)
      if (!now?.listeners.delete(own)) return
      if (now.listeners.size > 0) this.#relist()
      else {
        this.#watched.delete(key)
        this.#tell()
      }
    }
  }

  /** A report from the audio thread, for the list of its version */
  receive(report: ReductionReport): void {
    if (report.version !== this.#message.version) return
    const listeners = this.#listeners
    const count = Math.min(listeners.length, report.dbs.length)
    for (let k = 0; k < count; k++) {
      const db = report.dbs[k] as number
      for (const listener of listeners[k] as readonly Listener[]) {
        listener(db)
      }
    }
  }

  /** A new list, under the next version, told to the audio thread */
  #tell(): void {
    const at = Array.from(this.#watched.values(), (entry) => entry.at)
    this.#message = {
      t: 'watchReduction',
      version: this.#message.version + 1,
      at,
    }
    this.#relist()
    this.#post(this.#message)
  }

  /** Who is told of each place in the list, as it stands */
  #relist(): void {
    this.#listeners = Array.from(this.#watched.values(), (entry) => [
      ...entry.listeners,
    ])
  }
}
