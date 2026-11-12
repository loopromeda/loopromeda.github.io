import { describe, expect, it } from 'vitest'
import {
  findUpdate,
  installed,
  offlineState,
  type RegistrationLike,
  type WorkerLike,
} from './offline'

const worker = {}

describe('offlineState', () => {
  it('is off with no registration, or one with no worker', () => {
    expect(offlineState(undefined)).toBe('off')
    expect(
      offlineState({ installing: null, waiting: null, active: null })
    ).toBe('off')
  })

  it('is saving while the first worker installs or is about to start', () => {
    expect(
      offlineState({ installing: worker, waiting: null, active: null })
    ).toBe('saving')
    expect(
      offlineState({ installing: null, waiting: worker, active: null })
    ).toBe('saving')
  })

  it('is ready once a worker is active, a newer one installing or not', () => {
    expect(
      offlineState({ installing: null, waiting: null, active: worker })
    ).toBe('ready')
    expect(
      offlineState({ installing: worker, waiting: null, active: worker })
    ).toBe('ready')
  })

  it('offers the update once a newer worker waits', () => {
    expect(
      offlineState({ installing: null, waiting: worker, active: worker })
    ).toBe('update')
  })
})

/** A worker whose state the test moves on */
class FakeWorker implements WorkerLike {
  readonly #listeners = new Set<() => void>()
  constructor(public state: string) {}
  addEventListener(_type: 'statechange', listener: () => void) {
    this.#listeners.add(listener)
  }
  removeEventListener(_type: 'statechange', listener: () => void) {
    this.#listeners.delete(listener)
  }
  get listening() {
    return this.#listeners.size
  }
  move(state: string) {
    this.state = state
    for (const listener of [...this.#listeners]) listener()
  }
}

/**
 * A registration whose update() finds newer (installing, then waiting or
 * not), nothing, or fails
 */
class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null
  updates = 0
  constructor(
    private readonly found: 'new' | 'broken' | 'none' | 'unreachable'
  ) {}
  update() {
    this.updates += 1
    if (this.found === 'unreachable') {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    if (this.found !== 'none') {
      const worker = new FakeWorker('installing')
      this.installing = worker
      // The browser saves it after update() resolves
      setTimeout(() => {
        this.installing = null
        if (this.found === 'new') {
          this.waiting = worker
          worker.move('installed')
        } else {
          worker.move('redundant')
        }
      }, 0)
    }
    return Promise.resolve(this)
  }
}

describe('installed', () => {
  it('waits for an install to end, saved or not', async () => {
    const saving = new FakeWorker('installing')
    const saved = installed(saving)
    saving.move('installed')
    await expect(saved).resolves.toBe(true)
    expect(saving.listening).toBe(0)

    const failing = new FakeWorker('installing')
    const failed = installed(failing)
    failing.move('redundant')
    await expect(failed).resolves.toBe(false)
  })

  it('answers at once for a worker past installing', async () => {
    await expect(installed(new FakeWorker('activated'))).resolves.toBe(true)
    await expect(installed(new FakeWorker('redundant'))).resolves.toBe(false)
  })
})

describe('findUpdate', () => {
  it('finds a new version once it is saved', async () => {
    const registration = new FakeRegistration('new')
    await expect(findUpdate(registration)).resolves.toBe('found')
    expect(registration.waiting?.state).toBe('installed')
  })

  it('tells when the version running is the latest', async () => {
    await expect(findUpdate(new FakeRegistration('none'))).resolves.toBe(
      'latest'
    )
  })

  it('tells when the site is out of reach or the version fails', async () => {
    await expect(findUpdate(new FakeRegistration('unreachable'))).resolves.toBe(
      'unreachable'
    )
    await expect(findUpdate(new FakeRegistration('broken'))).resolves.toBe(
      'unreachable'
    )
  })

  it('takes a version already waiting without asking again', async () => {
    const registration = new FakeRegistration('none')
    registration.waiting = new FakeWorker('installed')
    await expect(findUpdate(registration)).resolves.toBe('found')
    expect(registration.updates).toBe(0)
  })
})
