import { describe, expect, it } from 'vitest'
import { VoiceAllocator } from './allocator'

/** Voices whose sounding state a test sets by hand */
function voices(count: number): { active: boolean }[] {
  return Array.from({ length: count }, () => ({ active: false }))
}

describe('VoiceAllocator', () => {
  it('rejects an empty voice set', () => {
    expect(() => new VoiceAllocator([])).toThrow(RangeError)
  })

  it('gives each held key its own voice', () => {
    const allocator = new VoiceAllocator(voices(4))
    const picked = [10, 11, 12, 13].map((key) => allocator.noteOn(key))
    expect(new Set(picked).size).toBe(4)
    for (const index of picked) expect(allocator.held(index)).toBe(true)
  })

  it('releases the voice a key held, and only that one', () => {
    const allocator = new VoiceAllocator(voices(4))
    const a = allocator.noteOn(1)
    const b = allocator.noteOn(2)
    expect(allocator.noteOff(1)).toBe(a)
    expect(allocator.held(a)).toBe(false)
    expect(allocator.held(b)).toBe(true)
    expect(allocator.noteOff(1)).toBe(-1)
    expect(allocator.noteOff(99)).toBe(-1)
  })

  it('takes the voice silent longest', () => {
    const allocator = new VoiceAllocator(voices(3))
    const a = allocator.noteOn(1)
    const b = allocator.noteOn(2)
    allocator.noteOff(2)
    allocator.noteOff(1)
    // The never-used third voice has been silent longest of all
    const c = allocator.noteOn(3)
    expect([a, b]).not.toContain(c)
    allocator.noteOff(3)
    // Then b, released before a
    expect(allocator.noteOn(4)).toBe(b)
  })

  it('prefers a silent voice to a releasing one', () => {
    const set = voices(2)
    const allocator = new VoiceAllocator(set)
    const a = allocator.noteOn(1)
    const b = allocator.noteOn(2)
    allocator.noteOff(1)
    allocator.noteOff(2)
    set[a] = { active: true } // a still rings out; b has gone quiet
    expect(allocator.noteOn(3)).toBe(b)
  })

  it('takes the voice released longest ago when all are sounding', () => {
    const set = voices(3)
    const allocator = new VoiceAllocator(set)
    const a = allocator.noteOn(1)
    const b = allocator.noteOn(2)
    const c = allocator.noteOn(3)
    for (const voice of set) voice.active = true
    allocator.noteOff(2)
    allocator.noteOff(1)
    expect(allocator.noteOn(4)).toBe(b)
    expect(allocator.noteOn(5)).toBe(a)
    expect(allocator.held(c)).toBe(true)
  })

  it('steals the oldest held note when every voice is held', () => {
    const set = voices(3)
    const allocator = new VoiceAllocator(set)
    const a = allocator.noteOn(1)
    const b = allocator.noteOn(2)
    const c = allocator.noteOn(3)
    for (const voice of set) voice.active = true
    expect(allocator.noteOn(4)).toBe(a)
    // The stolen key no longer holds anything
    expect(allocator.noteOff(1)).toBe(-1)
    expect(allocator.noteOn(5)).toBe(b)
    expect(allocator.noteOn(6)).toBe(c)
    expect(allocator.noteOn(7)).toBe(a)
  })

  it('tells which voice a key holds', () => {
    const allocator = new VoiceAllocator(voices(3))
    const a = allocator.noteOn(1)
    const b = allocator.noteOn(2)
    expect(allocator.voiceOf(1)).toBe(a)
    expect(allocator.voiceOf(2)).toBe(b)
    expect(allocator.voiceOf(3)).toBe(-1)
    allocator.noteOff(1)
    expect(allocator.voiceOf(1)).toBe(-1)
  })

  it('lets every key go at once', () => {
    const allocator = new VoiceAllocator(voices(3))
    allocator.noteOn(1)
    allocator.noteOn(2)
    allocator.releaseAll()
    for (let i = 0; i < allocator.size; i++) {
      expect(allocator.held(i)).toBe(false)
    }
    expect(allocator.noteOff(1)).toBe(-1)
  })
})
