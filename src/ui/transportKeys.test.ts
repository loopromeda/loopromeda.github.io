import { describe, expect, it } from 'vitest'
import { transportKey, type KeyPress, type KeyTarget } from './transportKeys'

/**
 * An element that is, or stands in, what selectors name: each of its
 * kinds a selector it matches, as closest would find it or an ancestor
 */
function element(...kinds: string[]): KeyTarget {
  return {
    closest: (selectors: string) =>
      selectors.split(', ').some((one) => kinds.includes(one)) ? {} : null,
  }
}

function press(key: string, given: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: element(),
    ...given,
  }
}

const TOGGLE = { kind: 'toggle' }

describe('transportKey', () => {
  it('plays and stops on Space, wherever focus is', () => {
    expect(transportKey(press(' '))).toEqual(TOGGLE)
    expect(transportKey(press(' ', { target: element('button') }))).toEqual(
      TOGGLE
    )
    expect(transportKey(press(' ', { target: null }))).toEqual(TOGGLE)
  })

  it('moves a beat back and on with the arrows, Home to the first', () => {
    expect(transportKey(press('ArrowLeft'))).toEqual({
      kind: 'move',
      beats: -1,
    })
    expect(transportKey(press('ArrowRight'))).toEqual({
      kind: 'move',
      beats: 1,
    })
    expect(transportKey(press('Home'))).toEqual({ kind: 'start' })
  })

  it('moves a bar with Shift and the arrows', () => {
    const shift = { shiftKey: true }
    expect(transportKey(press('ArrowLeft', shift))).toEqual({
      kind: 'move',
      beats: -4,
    })
    expect(transportKey(press('ArrowRight', shift))).toEqual({
      kind: 'move',
      beats: 4,
    })
    expect(transportKey(press(' ', shift))).toBeUndefined()
    expect(transportKey(press('Home', shift))).toBeUndefined()
  })

  it('leaves other keys alone, and keys with another modifier', () => {
    expect(transportKey(press('ArrowUp'))).toBeUndefined()
    expect(transportKey(press('Enter'))).toBeUndefined()
    expect(transportKey(press('KeyA'))).toBeUndefined()
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
      expect(transportKey(press(' ', { [modifier]: true }))).toBeUndefined()
      expect(
        transportKey(press('ArrowLeft', { [modifier]: true }))
      ).toBeUndefined()
    }
  })

  it('leaves Space to a field typed into, and to a list', () => {
    for (const kind of [
      'input:not([type=range])',
      'textarea',
      '[contenteditable]:not([contenteditable=false])',
      '[role=listbox]',
      '[role=option]',
    ]) {
      expect(
        transportKey(press(' ', { target: element(kind) }))
      ).toBeUndefined()
    }
  })

  it('leaves the arrows to a field, a slider and a list', () => {
    for (const kind of ['input', '[role=slider]', '[role=listbox]']) {
      expect(
        transportKey(press('ArrowLeft', { target: element(kind) }))
      ).toBeUndefined()
    }
  })

  it('leaves a key a control took already, and a dialog its keys', () => {
    expect(
      transportKey(press('ArrowRight', { defaultPrevented: true }))
    ).toBeUndefined()
    expect(transportKey(press(' ', { target: element('dialog') }))).toBe(
      undefined
    )
    expect(
      transportKey(press('Home', { target: element('[role=dialog]') }))
    ).toBeUndefined()
  })
})
