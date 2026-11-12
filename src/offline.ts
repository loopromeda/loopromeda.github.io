/**
 * The page's side of the offline copy (src/sw/sw.ts): it registers the
 * service worker in a build, never on the dev server (whose files change
 * under it), and tells what the worker holds. The status line offers a
 * newer version once it is saved (Update), and the page reloads onto it;
 * the sound, the sheet open and the tile picked come back with a reload.
 * Settings can also look for one at once (Check for update) and take it
 * as soon as it is saved: an installed app has no reload of its own.
 */

/**
 * - off: no service worker (the dev server, a browser without one, or one
 *   that failed to save the site)
 * - saving: the first copy is being saved
 * - ready: the site is saved, and plays offline
 * - update: ready, and a newer version is saved and waits to take over
 */
export type OfflineState = 'off' | 'saving' | 'ready' | 'update'

/** The workers of a registration, as ServiceWorkerRegistration has them */
export interface Workers {
  readonly installing: unknown
  readonly waiting: unknown
  readonly active: unknown
}

/**
 * What the registration's workers mean for the player. A worker waiting
 * with none active is the first one, about to take over: still saving.
 */
export function offlineState(workers: Workers | undefined): OfflineState {
  if (!workers) return 'off'
  if (workers.active) return workers.waiting ? 'update' : 'ready'
  return workers.installing || workers.waiting ? 'saving' : 'off'
}

/** The worker's message (sw.ts): take over now */
const SKIP_WAITING = 'skip-waiting'

/**
 * What a check for a new version found:
 * - found: one is saved, and waits to take over
 * - latest: the site's version is the one running
 * - unreachable: the site could not be reached (no network), or the new
 *   version could not be saved
 */
export type CheckResult = 'found' | 'latest' | 'unreachable'

/** A service worker, as the check watches one install */
export interface WorkerLike {
  readonly state: string
  addEventListener(type: 'statechange', listener: () => void): void
  removeEventListener(type: 'statechange', listener: () => void): void
}

/** A registration, as the check asks it for an update */
export interface RegistrationLike {
  readonly installing: WorkerLike | null
  readonly waiting: WorkerLike | null
  update(): Promise<unknown>
}

/**
 * Whether a worker installing is saved (true) or failed (false), once it
 * is one or the other
 */
export function installed(worker: WorkerLike): Promise<boolean> {
  return new Promise((resolve) => {
    const look = () => {
      if (worker.state === 'parsed' || worker.state === 'installing') return
      worker.removeEventListener('statechange', look)
      resolve(worker.state !== 'redundant')
    }
    worker.addEventListener('statechange', look)
    look()
  })
}

/**
 * Asks the site for its version now (the browser compares sw.js, which
 * holds the hash of everything else) and waits while a new one is saved
 */
export async function findUpdate(
  registration: RegistrationLike
): Promise<CheckResult> {
  if (registration.waiting) return 'found'
  try {
    await registration.update()
  } catch {
    return 'unreachable'
  }
  // A new version is installing once update() has found it
  const installing = registration.installing
  if (installing && !(await installed(installing))) return 'unreachable'
  return registration.waiting ? 'found' : 'latest'
}

/**
 * The offline copy's state for React (subscribe, getSnapshot), and the
 * update. A page left open for days (an installed app is rarely closed)
 * looks for a new version each time it comes back to the front, as the
 * browser does by itself on a launch.
 */
export class Offline {
  #state: OfflineState = 'off'
  #registration: ServiceWorkerRegistration | undefined
  #updating = false
  readonly #listeners = new Set<() => void>()

  get state(): OfflineState {
    return this.#state
  }

  readonly getSnapshot = (): OfflineState => this.#state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Registers the worker at url, where the browser has service workers */
  async register(url: string): Promise<void> {
    if (!('serviceWorker' in navigator)) return
    const container = navigator.serviceWorker
    let registration: ServiceWorkerRegistration
    try {
      registration = await container.register(url)
    } catch {
      // No worker, no offline copy: the site still plays online
      return
    }
    this.#registration = registration
    const follow = () => this.#set(offlineState(registration))
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', follow)
      follow()
    })
    container.addEventListener('controllerchange', () => {
      if (this.#updating) location.reload()
      else follow()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      registration.update().catch(() => {
        // Offline, or the server is away: the next return tries again
      })
    })
    follow()
  }

  /**
   * Looks for a new version now and, once it is saved, takes it (the page
   * reloads onto it); otherwise tells what was found
   */
  readonly check = async (): Promise<CheckResult> => {
    const registration = this.#registration
    if (!registration) return 'unreachable'
    const found = await findUpdate(registration)
    if (found === 'found') this.update()
    return found
  }

  /**
   * Hands the page to the version waiting: it takes over, and the page
   * reloads onto it
   */
  readonly update = (): void => {
    const waiting = this.#registration?.waiting
    if (!waiting) return
    this.#updating = true
    waiting.postMessage(SKIP_WAITING)
  }

  #set(state: OfflineState) {
    if (state === this.#state) return
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}
