import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  THEMES,
  contrastRatio,
  isThemeId,
  oklabDistance,
  palette,
  setThemeId,
  themeOf,
} from './theme'

// The checks a theme owes its colours (docs/plan/sound-chains.md): the
// colours are roles, so each theme's values pass the same tests the app's
// own colours were held to.

/** A tile's face: what every colour has to be read on */
const FACE = '#1c1c23'

describe('a theme', () => {
  for (const theme of THEMES) {
    it(`reads ${theme.name} on a tile's face`, () => {
      const colours = [
        ...theme.palette.chains,
        theme.palette.modulator,
        theme.palette.accent,
      ]
      for (const colour of colours) {
        expect(contrastRatio(colour, FACE)).toBeGreaterThanOrEqual(4.7)
      }
    })

    it(`tells ${theme.name}'s chains apart`, () => {
      theme.palette.chains.forEach((ink, index) => {
        for (const other of theme.palette.chains.slice(index + 1)) {
          expect(oklabDistance(ink, other)).toBeGreaterThanOrEqual(20)
        }
      })
    })
  }

  it("keeps the default theme at the app's own colours", () => {
    const palette = themeOf(DEFAULT_THEME).palette
    expect(palette.chains[0]).toBe('#ff8904')
    expect(palette.accent).toBe('#34d399')
  })
})

describe('isThemeId', () => {
  it('accepts the themes and nothing else', () => {
    for (const theme of THEMES) expect(isThemeId(theme.id)).toBe(true)
    expect(isThemeId('neon')).toBe(false)
    expect(isThemeId('')).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
    expect(isThemeId(0)).toBe(false)
  })
})

describe('setThemeId', () => {
  it('moves the palette, and does nothing for the theme it is on', () => {
    const start = palette()
    expect(start).toBe(themeOf(DEFAULT_THEME).palette)
    setThemeId('tidal')
    expect(palette()).toBe(themeOf('tidal').palette)
    setThemeId('tidal')
    expect(palette()).toBe(themeOf('tidal').palette)
    setThemeId(DEFAULT_THEME)
    expect(palette()).toBe(start)
  })
})
