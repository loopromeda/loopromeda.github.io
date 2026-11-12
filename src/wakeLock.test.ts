import { describe, expect, it } from 'vitest'
import { ScreenAwake } from './wakeLock'

/** A lock the browser handed out; the browser or its holder lets it go */
class FakeSentinel extends EventTarget {
  released = false

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

/** navigator.wakeLock: grants each request, or refuses, or holds it */
class FakeLock {
  readonly given: FakeSentinel[] = []
  refuse = false
  /** Set: requests wait until it is called */
  #hold: Promise<void> | undefined
  #letGo: (() => void) | undefined

  holdRequests() {
    this.#hold = new Promise((resolve) => (this.#letGo = resolve))
  }

  answer() {
    this.#letGo?.()
  }

  async request(type: 'screen'): Promise<WakeLockSentinel> {
    expect(type).toBe('screen')
    await this.#hold
    if (this.refuse) throw new DOMException('refused', 'NotAllowedError')
    const sentinel = new FakeSentinel()
    this.given.push(sentinel)
    return sentinel as unknown as WakeLockSentinel
  }
}

/** The document: in front or at the back, telling when it changes */
class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'

  show(state: DocumentVisibilityState) {
    this.visibilityState = state
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

/** Lets the promises in flight run */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup() {
  const lock = new FakeLock()
  const page = new FakePage()
  const awake = new ScreenAwake(lock, page)
  return { lock, page, awake }
}

describe('ScreenAwake', () => {
  it('keeps the screen on while wanted, and lets go when not', async () => {
    const { lock, awake } = setup()
    expect(lock.given).toHaveLength(0)
    awake.want(true)
    await settle()
    expect(lock.given).toHaveLength(1)
    expect(awake.held).toBe(true)
    awake.want(false)
    await settle()
    expect(lock.given[0]?.released).toBe(true)
    expect(awake.held).toBe(false)
  })

  it('asks once, however often it is wanted', async () => {
    const { lock, awake } = setup()
    awake.want(true)
    awake.want(true)
    await settle()
    awake.want(true)
    await settle()
    expect(lock.given).toHaveLength(1)
  })

  it('waits for the page to come to the front', async () => {
    const { lock, page, awake } = setup()
    page.visibilityState = 'hidden'
    awake.want(true)
    await settle()
    expect(lock.given).toHaveLength(0)
    page.show('visible')
    await settle()
    expect(lock.given).toHaveLength(1)
  })

  it('asks again on return, after the browser let go at the back', async () => {
    const { lock, page, awake } = setup()
    awake.want(true)
    await settle()
    // The browser releases the lock as the page goes to the back
    page.show('hidden')
    await lock.given[0]?.release()
    await settle()
    expect(awake.held).toBe(false)
    page.show('visible')
    await settle()
    expect(lock.given).toHaveLength(2)
    expect(awake.held).toBe(true)
  })

  it('gives a lock back at once if let go while asking', async () => {
    const { lock, awake } = setup()
    lock.holdRequests()
    awake.want(true)
    await settle()
    awake.want(false)
    lock.answer()
    await settle()
    expect(lock.given).toHaveLength(1)
    expect(lock.given[0]?.released).toBe(true)
    expect(awake.held).toBe(false)
  })

  it('shrugs off a refusal, and asks again when next wanted', async () => {
    const { lock, awake } = setup()
    lock.refuse = true
    awake.want(true)
    await settle()
    expect(awake.held).toBe(false)
    lock.refuse = false
    awake.want(false)
    awake.want(true)
    await settle()
    expect(awake.held).toBe(true)
  })

  it('does nothing in a browser without the lock', async () => {
    const page = new FakePage()
    const awake = new ScreenAwake(undefined, page)
    awake.want(true)
    await settle()
    expect(awake.held).toBe(false)
  })
})
