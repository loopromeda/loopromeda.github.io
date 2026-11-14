import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  NEUTRAL,
  THEMES,
  contrastRatio,
  ground,
  groundOf,
  isThemeId,
  mode,
  oklabDistance,
  palette,
  setTheme,
  surfaces,
  surfacesOf,
  themeId,
  themeOf,
  type Mode,
} from './theme'

// The checks a theme owes its colours (docs/plan/sound-chains.md): the
// colours are roles, so each theme's values pass the same tests the app's
// own colours were held to, in each mode.

/**
 * What a label reads on a role's colour (index.css's --on-colour): the
 * go button's on the accent, a knob's badge on the modulation colour
 */
const ON_COLOUR: Readonly<Record<Mode, string>> = {
  dark: '#000000',
  light: '#ffffff',
}

const MODES = ['dark', 'light'] as const

/** The inks every surface is read in, whatever the theme */
const NEUTRAL_INKS: Readonly<
  Record<Mode, { neutral: string; quiet: string; dim: string }>
> = {
  dark: { neutral: '#e4e4e7', quiet: '#d4d4d8', dim: '#a1a1aa' },
  light: { neutral: '#27272a', quiet: '#3f3f46', dim: '#52525b' },
}

describe('a theme', () => {
  for (const theme of THEMES) {
    for (const tone of MODES) {
      const roles = theme[tone]
      const name = `${theme.name} (${tone})`
      // What every colour has to be read on: the theme's tile's face and
      // card's (index.css's --tile and --panel)
      const { tile, panel } = surfacesOf(theme, tone)

      it(`reads ${name} on a tile's face and a card's`, () => {
        const colours = [
          ...roles.chains,
          roles.modulator,
          roles.accent,
          roles.secondary,
        ]
        for (const face of [tile, panel]) {
          for (const colour of colours) {
            expect(contrastRatio(colour, face)).toBeGreaterThanOrEqual(4.7)
          }
        }
      })

      it(`tells ${name}'s chains apart`, () => {
        roles.chains.forEach((ink, index) => {
          for (const other of roles.chains.slice(index + 1)) {
            expect(oklabDistance(ink, other)).toBeGreaterThanOrEqual(20)
          }
        })
      })

      it(`tells ${name}'s modulation colour from its chains`, () => {
        for (const ink of roles.chains) {
          expect(oklabDistance(ink, roles.modulator)).toBeGreaterThanOrEqual(12)
        }
      })

      it(`reads the inks on ${name}'s surfaces`, () => {
        const { neutral, quiet, dim } = NEUTRAL_INKS[tone]
        for (const face of [tile, panel]) {
          expect(contrastRatio(neutral, face)).toBeGreaterThanOrEqual(10)
          expect(contrastRatio(quiet, face)).toBeGreaterThanOrEqual(7)
          expect(contrastRatio(dim, face)).toBeGreaterThanOrEqual(4.5)
        }
      })

      it(`reads a label on ${name}'s accent and modulation colour`, () => {
        for (const colour of [roles.accent, roles.modulator]) {
          expect(contrastRatio(ON_COLOUR[tone], colour)).toBeGreaterThanOrEqual(
            4.5
          )
        }
      })
    }
  }

  it('stands the first four on the neutral, the pop themes on their own', () => {
    for (const id of ['default', 'tidal', 'ember', 'orchard'] as const) {
      expect(surfacesOf(themeOf(id), 'dark')).toBe(NEUTRAL.dark)
      expect(surfacesOf(themeOf(id), 'light')).toBe(NEUTRAL.light)
    }
    for (const id of ['neon', 'candy', 'arcade'] as const) {
      expect(surfacesOf(themeOf(id), 'dark')).not.toBe(NEUTRAL.dark)
    }
  })

  it("keeps the default theme at the app's own colours in the dark", () => {
    const roles = themeOf(DEFAULT_THEME).dark
    expect(roles.chains).toEqual(['#ff8904', '#a684ff', '#bbf451', '#f6339a'])
    expect(roles.modulator).toBe('#38bdf8')
    expect(roles.accent).toBe('#34d399')
  })
})

describe('oklabDistance', () => {
  it('measures white from black as OKLab does: 100', () => {
    expect(oklabDistance('#ffffff', '#000000')).toBeCloseTo(100, 1)
  })

  it('finds no colour in a grey: white is all lightness', () => {
    // A misread matrix leaves white a tint of its own
    expect(oklabDistance('#ffffff', '#ffffff')).toBe(0)
    expect(oklabDistance('#808080', '#7f7f7f')).toBeLessThan(0.5)
  })
})

describe('isThemeId', () => {
  it('accepts the themes and nothing else', () => {
    for (const theme of THEMES) expect(isThemeId(theme.id)).toBe(true)
    expect(isThemeId('sepia')).toBe(false)
    expect(isThemeId('')).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
    expect(isThemeId(0)).toBe(false)
  })
})

describe('setTheme', () => {
  it('moves the surfaces and the ground with a pop theme', () => {
    setTheme('neon', 'dark')
    expect(themeId()).toBe('neon')
    expect(surfaces()).toBe(surfacesOf(themeOf('neon'), 'dark'))
    expect(ground().page).toBe(surfaces().page)
    expect(ground().tile).toBe(surfaces().tile)
    expect(groundOf('light').page).toBe(
      surfacesOf(themeOf('neon'), 'light').page
    )
    setTheme(DEFAULT_THEME, 'dark')
    expect(surfaces()).toBe(NEUTRAL.dark)
    expect(ground().page).toBe(NEUTRAL.dark.page)
  })

  it('moves the palette and the ground with the theme and the mode', () => {
    setTheme('tidal', 'dark')
    expect(palette()).toBe(themeOf('tidal').dark)
    expect(mode()).toBe('dark')
    setTheme('tidal', 'light')
    expect(palette()).toBe(themeOf('tidal').light)
    expect(ground()).toBe(groundOf('light'))
    setTheme(DEFAULT_THEME, 'dark')
    expect(palette()).toBe(themeOf(DEFAULT_THEME).dark)
    expect(ground()).toBe(groundOf('dark'))
  })
})

describe('a ground', () => {
  it("reads its inks on its tiles, as index.css's tokens do", () => {
    for (const tone of MODES) {
      const { tile, neutral, quiet, dim } = groundOf(tone)
      expect(contrastRatio(neutral, tile)).toBeGreaterThanOrEqual(10)
      expect(contrastRatio(quiet, tile)).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(dim, tile)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
