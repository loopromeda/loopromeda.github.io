import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  NEUTRAL,
  SECONDARY,
  THEMES,
  contrastRatio,
  ground,
  groundOf,
  isThemeId,
  markInks,
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

/** Recording's red in each mode (index.css's --record) */
const RECORD: Readonly<Record<Mode, string>> = {
  dark: '#eb1645',
  light: '#b80e39',
}

/** The inks every surface is read in, whatever the theme */
const NEUTRAL_INKS: Readonly<
  Record<Mode, { neutral: string; quiet: string; dim: string }>
> = {
  dark: { neutral: '#e5e5e5', quiet: '#d4d4d4', dim: '#a3a3a3' },
  light: { neutral: '#262626', quiet: '#404040', dim: '#525252' },
}

describe('a theme', () => {
  for (const theme of THEMES) {
    for (const tone of MODES) {
      const roles = theme[tone]
      const name = `${theme.name} (${tone})`
      // What every colour has to be read on: the theme's tile's face, a
      // card's and the raised face's over them (index.css's --tile,
      // --panel and --raised); a menu's (--raised-2) holds inks and marks
      const { tile, panel, raised, raised2 } = surfacesOf(theme, tone)
      const faces = [tile, panel, raised]

      it(`reads ${name} on a tile's face, a card's and a raised one's`, () => {
        const colours = [
          ...roles.chains,
          roles.modulator,
          roles.accent,
          roles.secondary,
        ]
        for (const face of faces) {
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
        for (const face of faces) {
          expect(contrastRatio(neutral, face)).toBeGreaterThanOrEqual(10)
          expect(contrastRatio(quiet, face)).toBeGreaterThanOrEqual(7)
          expect(contrastRatio(dim, face)).toBeGreaterThanOrEqual(4.5)
        }
      })

      it(`reads ${name}'s inks and marks on a menu's face`, () => {
        const { neutral, quiet, dim } = NEUTRAL_INKS[tone]
        expect(contrastRatio(neutral, raised2)).toBeGreaterThanOrEqual(10)
        expect(contrastRatio(quiet, raised2)).toBeGreaterThanOrEqual(7)
        expect(contrastRatio(dim, raised2)).toBeGreaterThanOrEqual(4.5)
        // A swatch, a pictogram, the chosen one's check: marks, not letters
        const marks = [
          ...roles.chains,
          roles.modulator,
          roles.accent,
          roles.secondary,
        ]
        for (const mark of marks) {
          expect(contrastRatio(mark, raised2)).toBeGreaterThanOrEqual(3)
        }
      })

      it(`raises ${name}'s faces a step at a time over its cards`, () => {
        const lightness = (hex: string) => oklabDistance(hex, '#000000')
        if (tone === 'dark') {
          // A step each (OKLab lightness, out of 100) that a phone's
          // screen shows: a panel never wears the card under it, nor a
          // menu the popover
          expect(lightness(raised) - lightness(panel)).toBeGreaterThan(3)
          expect(lightness(raised2) - lightness(raised)).toBeGreaterThan(3)
        } else {
          // White over the paper, the shadow telling it off
          expect(raised).toBe('#ffffff')
          expect(raised2).toBe('#ffffff')
          expect(lightness(raised)).toBeGreaterThan(lightness(panel))
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

  it('stands the first five on the neutral, the pop themes on their own', () => {
    const quiet = ['default', 'emerald', 'tidal', 'ember', 'orchard'] as const
    for (const id of quiet) {
      expect(surfacesOf(themeOf(id), 'dark')).toBe(NEUTRAL.dark)
      expect(surfacesOf(themeOf(id), 'light')).toBe(NEUTRAL.light)
    }
    for (const id of ['neon', 'candy', 'arcade'] as const) {
      expect(surfacesOf(themeOf(id), 'dark')).not.toBe(NEUTRAL.dark)
    }
  })

  it('stands the neutral surfaces in greys with no tint', () => {
    // Red, green and blue alike: no blue in the dark's near-black
    const grey = (hex: string) => /^#(..)\1\1$/.test(hex)
    for (const tone of MODES) {
      for (const surface of Object.values(NEUTRAL[tone])) {
        expect(grey(surface)).toBe(true)
      }
      expect(grey(SECONDARY[tone])).toBe(true)
    }
  })

  it('shows what is picked by brightness in every built-in theme', () => {
    for (const theme of THEMES) {
      expect(theme.dark.secondary).toBe(SECONDARY.dark)
      expect(theme.light.secondary).toBe(SECONDARY.light)
      // Never the accent's colour: play's, not what is picked
      expect(theme.dark.secondary).not.toBe(theme.dark.accent)
    }
  })

  it("keeps the app's first colours as the Emerald theme", () => {
    const { dark, light } = themeOf('emerald')
    expect(dark.chains).toEqual(['#ff8904', '#a684ff', '#bbf451', '#f6339a'])
    expect(dark.modulator).toBe('#38bdf8')
    expect(dark.accent).toBe('#34d399')
    expect(light.chains).toEqual(['#aa5405', '#7357ce', '#1d7d00', '#cf0288'])
    expect(light.modulator).toBe('#05749e')
    expect(light.accent).toBe('#027c56')
  })

  it("stands the default's orange apart from its chains and recording", () => {
    for (const tone of MODES) {
      const { chains, accent } = themeOf(DEFAULT_THEME)[tone]
      // No chain an orange beside it: a note's colour is play's alone
      for (const ink of chains) {
        expect(oklabDistance(accent, ink)).toBeGreaterThanOrEqual(15)
      }
      // Play lit beside Record lit, told apart: orange, then crimson
      expect(oklabDistance(accent, RECORD[tone])).toBeGreaterThanOrEqual(8)
    }
  })

  it("leads the default's chains with the violet, the aqua last", () => {
    const { dark, light } = themeOf(DEFAULT_THEME)
    expect(dark.chains).toEqual(['#a684ff', '#bbf451', '#f6339a', '#28effe'])
    expect(light.chains).toEqual(['#7357ce', '#1d7d00', '#cf0288', '#05397e'])
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

describe('markInks', () => {
  it('gives the Emerald theme the icons’ own, near enough to see none', () => {
    const { ground, light, deep } = markInks(themeOf('emerald'), 'dark')
    expect(ground).toBe(NEUTRAL.dark.page)
    expect(oklabDistance(light, '#6ee7b7')).toBeLessThan(1.5)
    expect(oklabDistance(deep, '#059669')).toBeLessThan(1.5)
  })

  it('stands out of its page in every theme and mode', () => {
    for (const theme of THEMES) {
      for (const tone of ['dark', 'light'] as const) {
        const { ground, light, deep } = markInks(theme, tone)
        expect(contrastRatio(light, ground)).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(deep, ground)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('shades from lighter to deeper, its hue the accent’s', () => {
    for (const theme of THEMES) {
      const { light, deep } = markInks(theme, 'dark')
      expect(contrastRatio(light, '#000000')).toBeGreaterThan(
        contrastRatio(deep, '#000000')
      )
    }
  })
})
