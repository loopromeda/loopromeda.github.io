import { describe, expect, it } from 'vitest'
import { SHEETS, hashOf, sheetOf } from './pages'

describe('pages', () => {
  it('reads each sheet back from its hash', () => {
    for (const sheet of SHEETS) expect(sheetOf(hashOf(sheet))).toBe(sheet)
    expect(hashOf(null)).toBe('')
  })

  it('takes a hash with or without its slash, and nothing else', () => {
    expect(sheetOf('#presets')).toBe('presets')
    expect(sheetOf('#/settings')).toBe('settings')
    expect(sheetOf('')).toBeNull()
    expect(sheetOf('#/')).toBeNull()
    expect(sheetOf('#/editor')).toBeNull()
    expect(sheetOf('#/presets/x')).toBeNull()
  })
})
