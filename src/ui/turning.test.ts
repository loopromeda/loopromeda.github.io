import { describe, expect, it, vi } from 'vitest'
import { endTurning, startTurning, subscribeTurning, turning } from './turning'

describe('turning', () => {
  it('holds the knob turned from its start to its end, and tells each', () => {
    const heard = vi.fn()
    const stop = subscribeTurning(heard)
    startTurning('amp', 'decay')
    expect(turning()).toEqual({ part: 'amp', knob: 'decay' })
    // The same knob again tells nothing new
    startTurning('amp', 'decay')
    expect(heard).toHaveBeenCalledTimes(1)
    endTurning('amp', 'decay')
    expect(turning()).toBeUndefined()
    expect(heard).toHaveBeenCalledTimes(2)
    stop()
    startTurning('amp', 'attack')
    expect(heard).toHaveBeenCalledTimes(2)
    endTurning('amp', 'attack')
  })

  it('keeps a second knob turned when the first one ends', () => {
    startTurning('amp', 'decay')
    startTurning('x1', 'cutoff')
    endTurning('amp', 'decay')
    expect(turning()).toEqual({ part: 'x1', knob: 'cutoff' })
    endTurning('x1', 'cutoff')
    expect(turning()).toBeUndefined()
  })
})
