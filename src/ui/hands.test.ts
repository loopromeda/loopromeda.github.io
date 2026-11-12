import { describe, expect, it } from 'vitest'
import { COMPUTER_ID, Hands, type Player } from './hands'

/** The engine, as what it was told */
class FakePlayer implements Player {
  readonly calls: string[] = []

  noteOn(id: number, note: number, velocity: number): void {
    this.calls.push(`on ${id} ${note} ${velocity}`)
  }

  noteOff(id: number): void {
    this.calls.push(`off ${id}`)
  }

  slide(id: number, value: number): void {
    this.calls.push(`slide ${id} ${value}`)
  }

  bend(id: number, note: number): void {
    this.calls.push(`bend ${id} ${note}`)
  }
}

/** A key's element as Hands sees it: its data attributes */
const element = () => ({ dataset: {} }) as unknown as HTMLElement
const lit = (key: HTMLElement) => 'pressed' in key.dataset

function setup() {
  const player = new FakePlayer()
  const hands = new Hands(player)
  const keys = new Map<number, HTMLElement>()
  for (const note of [60, 62, 64]) {
    const key = element()
    keys.set(note, key)
    hands.mount(note, key)
  }
  const key = (note: number) => keys.get(note) as HTMLElement
  return { player, hands, key }
}

describe('Hands', () => {
  it('plays a touch at the velocity it pressed with and lights its key', () => {
    const { player, hands, key } = setup()
    hands.press(1, 60, 0.5, 0.3)
    expect(player.calls).toEqual(['on 1 60 0.5'])
    expect(lit(key(60))).toBe(true)
    expect(hands.startOf(1)).toBe(0.3)
    hands.stop(1)
    expect(player.calls).toEqual(['on 1 60 0.5', 'off 1'])
    expect(lit(key(60))).toBe(false)
    expect(hands.startOf(1)).toBeUndefined()
  })

  it('bends the note a touch holds by more than a step, and no other', () => {
    const { player, hands } = setup()
    hands.press(1, 60.25, 1, 0)
    hands.bend(1, 60.25 + 1 / 256)
    hands.bend(1, 61.5)
    hands.bend(1, 61.5 + 1 / 256)
    hands.bend(2, 70)
    hands.stop(1)
    hands.bend(1, 63)
    expect(player.calls).toEqual(['on 1 60.25 1', 'bend 1 61.5', 'off 1'])
  })

  it('keeps a key lit while anyone holds it', () => {
    const { hands, key } = setup()
    hands.press(1, 62, 1, 0)
    hands.play(COMPUTER_ID, 62)
    hands.stop(1)
    expect(lit(key(62))).toBe(true)
    hands.stop(COMPUTER_ID)
    expect(lit(key(62))).toBe(false)
  })

  it('moves a finger to a new note at its velocity, with its Slide', () => {
    const { player, hands, key } = setup()
    hands.press(1, 60, 0.5, 0.3)
    hands.move(1, 0, 62)
    expect(player.calls).toEqual(['on 1 60 0.5', 'on 1 62 0.5', 'slide 1 0'])
    expect(lit(key(60))).toBe(false)
    expect(lit(key(62))).toBe(true)
  })

  it('sends Slide only when it changes by enough to hear', () => {
    const { player, hands } = setup()
    hands.press(1, 60, 1, 0)
    hands.move(1, 0.001, 60)
    hands.move(1, 0.002)
    expect(player.calls).toEqual(['on 1 60 1'])
    hands.move(1, 0.01)
    expect(player.calls).toEqual(['on 1 60 1', 'slide 1 0.01'])
  })

  it('ignores ids that hold nothing', () => {
    const { player, hands } = setup()
    hands.move(5, 0.5, 64)
    hands.stop(5)
    expect(player.calls).toEqual([])
  })

  it('lights a key that appears under a held note', () => {
    const { hands } = setup()
    hands.press(1, 67, 1, 0)
    const late = element()
    hands.mount(67, late)
    expect(lit(late)).toBe(true)
  })

  it('lets the touches go apart from the computer keys', () => {
    const { player, hands } = setup()
    hands.press(1, 60, 1, 0)
    hands.play(COMPUTER_ID - 2, 64)
    hands.stopTouches()
    expect(hands.holds(1)).toBe(false)
    expect(hands.holds(COMPUTER_ID - 2)).toBe(true)
    hands.press(2, 62, 1, 0)
    hands.stopComputerKeys()
    expect(hands.holds(COMPUTER_ID - 2)).toBe(false)
    expect(hands.holds(2)).toBe(true)
    expect(player.calls.filter((call) => call.startsWith('off'))).toEqual([
      'off 1',
      `off ${COMPUTER_ID - 2}`,
    ])
  })
})
