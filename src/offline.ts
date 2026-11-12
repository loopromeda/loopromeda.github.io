/**
 * The page's side of the offline copy (src/sw/sw.ts): it registers the
 * service worker in a build, never on the dev server (whose files change
 * under it), and tells what the worker holds. The status line offers a
 * newer version once it is saved (Update), and the page reloads onto it;
 * the sound, the sheet open and the tile picked come back with a reload.
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
