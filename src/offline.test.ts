import { describe, expect, it } from 'vitest'
import { offlineState } from './offline'

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
