/**
 * The app's colours as roles, and the themes that give the roles their
 * values (docs/plan/sound-chains.md): the colours are roles — the four
 * chains' inks in A-to-D order, the modulation colour, the accent — so a
 * theme gives each role a value, and every value passes the same checks
 * the roles are held to (readable on a tile's face, told apart from its
 * neighbours: theme.test.ts). A pure data file, no React, so the state
 * may read it (state/settings.ts). The editor and the accents move onto
 * palette() in step 2.
 */

export const THEME_IDS = ['default', 'tidal', 'ember', 'orchard'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** What a theme gives the app's colour roles: the four chains' inks in
 * A-to-D order, the modulation colour, and the accent (focus, playhead,
 * the go button) */
export interface Palette {
  readonly chains: readonly [string, string, string, string]
  readonly modulator: string
  readonly accent: string
}

export interface Theme {
  readonly id: ThemeId
  /** What the setting's row calls it */
  readonly name: string
  readonly palette: Palette
}

/** The app's own colours, unchanged. */
export const THEMES: readonly Theme[] = [
  {
    id: 'default',
    name: 'Default',
    palette: {
      chains: ['#ff8904', '#a684ff', '#bbf451', '#f6339a'],
      modulator: '#38bdf8',
      accent: '#34d399',
    },
  },
  {
    id: 'tidal',
    name: 'Tidal',
    palette: {
      chains: ['#60a5fa', '#bbf451', '#f6339a', '#fb923c'],
      modulator: '#c084fc',
      accent: '#2dd4bf',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    palette: {
      chains: ['#fde047', '#f472b6', '#818cf8', '#2dd4bf'],
      modulator: '#a684ff',
      accent: '#f97316',
    },
  },
  {
    id: 'orchard',
    name: 'Orchard',
    palette: {
      chains: ['#4ade80', '#fb923c', '#f6339a', '#818cf8'],
      modulator: '#fde047',
      accent: '#a3e635',
    },
  },
]

/** The theme when nothing was chosen: the colours the app has always had */
export const DEFAULT_THEME: ThemeId = 'default'

/** True for a stored value that names a theme */
export function isThemeId(value: unknown): value is ThemeId {
  return THEME_IDS.some((id) => id === value)
}

const BY_ID = Object.fromEntries(
  THEMES.map((theme) => [theme.id, theme])
) as Record<ThemeId, Theme>

/** The theme under an id */
export function themeOf(id: ThemeId): Theme {
  return BY_ID[id]
}

let current = themeOf(DEFAULT_THEME)

/**
 * Point the app at a theme. A convention: call it only where the settings
 * are set (App.tsx), a place a render is already happening, since this is
 * module state and no render follows from it by itself. The same theme is
 * left alone, so the call is safe in the render.
 */
export function setThemeId(id: ThemeId): void {
  if (id === current.id) return
  current = themeOf(id)
}

/** The palette the tiles and the accent read (step 2) */
export function palette(): Palette {
  return current.palette
}

/** An #rrggbb as rgba() at the given share: what the canvases fill with */
export function alpha(hex: string, share: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r},${g},${b},${share})`
}

/** WCAG contrast between two colours, 1 (the same) to 21 (black on white) */
export function contrastRatio(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b))
  const dark = Math.min(luminance(a), luminance(b))
  return (light + 0.05) / (dark + 0.05)
}

/**
 * How far two colours stand apart in OKLab, on a 0..100 scale: perceptual,
 * so a distance means the same difference wherever the colours are
 */
export function oklabDistance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a)
  const [l2, a2, b2] = oklab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100
}

/** The colour's channels, linear-light: the maths reads light, not code */
function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    linear(((value >> 16) & 0xff) / 255),
    linear(((value >> 8) & 0xff) / 255),
    linear((value & 0xff) / 255),
  ]
}

/** An sRGB channel (0..1) as light, with the transfer function taken off */
function linear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The colour in OKLab: lightness and two colour-opponent axes */
function oklab(hex: string): readonly [number, number, number] {
  const [r, g, b] = channels(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0051845561 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
