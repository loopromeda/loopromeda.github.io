/**
 * The app's colours as roles, and the themes that give the roles their
 * values (docs/plan/sound-chains.md): the colours are roles — the four
 * chains' inks in A-to-D order, the modulation colour, the accent, the
 * secondary — so a theme gives each role a value in each mode, dark and
 * light, and every value passes the same checks the roles are held to
 * (readable on a tile's face and on a card's, told apart from its
 * neighbours: theme.test.ts). The mode is the whole tone: the surfaces
 * and inks (index.css's tokens, and ground() for what JS draws) and the
 * palette both follow it (asked for by ashon, 2026-11-14: "다크 / 라이트
 * / 기본 액센트 / 세컨더리 색상 등 전부 컨트롤"). A pure data file, no
 * React, so the state may read it (state/settings.ts).
 */

export const THEME_IDS = ['default', 'tidal', 'ember', 'orchard'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** The tone the page is drawn in */
export type Mode = 'dark' | 'light'

/**
 * What a theme gives the app's colour roles: the four chains' inks in
 * A-to-D order, the modulation colour, the accent (focus, the playhead,
 * the go button, the traces, a note) and the secondary (what is picked
 * or current: a pad picked, its row, a navigator's frame). The built-in
 * themes give the secondary the accent's value; a theme of one's own
 * may part them.
 */
export interface Palette {
  readonly chains: readonly [string, string, string, string]
  readonly modulator: string
  readonly accent: string
  readonly secondary: string
}

export interface Theme {
  readonly id: ThemeId
  /** What the setting's row calls it */
  readonly name: string
  /** The roles on the dark surfaces: the app's home */
  readonly dark: Palette
  /**
   * The roles on the light ones: each a deeper shade of its dark value,
   * its hue kept or turned a little, as far as the checks ask
   */
  readonly light: Palette
}

/** The roles' values, the accent standing in for the secondary */
function roles(
  chains: Palette['chains'],
  modulator: string,
  accent: string
): Palette {
  return { chains, modulator, accent, secondary: accent }
}

/** The app's own colours, unchanged in the dark. */
export const THEMES: readonly Theme[] = [
  {
    id: 'default',
    name: 'Default',
    dark: roles(
      ['#ff8904', '#a684ff', '#bbf451', '#f6339a'],
      '#38bdf8',
      '#34d399'
    ),
    light: roles(
      ['#aa5405', '#7357ce', '#1d7d00', '#cf0288'],
      '#05749e',
      '#027c56'
    ),
  },
  {
    id: 'tidal',
    name: 'Tidal',
    dark: roles(
      ['#60a5fa', '#bbf451', '#f6339a', '#fb923c'],
      '#c084fc',
      '#2dd4bf'
    ),
    light: roles(
      ['#286dbd', '#1d7d00', '#cf0288', '#a75705'],
      '#8b4fc2',
      '#037a6d'
    ),
  },
  {
    id: 'ember',
    name: 'Ember',
    // The modulation colour a lavender: the violet it was stood too near
    // the indigo chain (C) to tell apart
    dark: roles(
      ['#fde047', '#f472b6', '#818cf8', '#2dd4bf'],
      '#d8b4fe',
      '#f97316'
    ),
    light: roles(
      ['#8c6501', '#b83b81', '#4a65c9', '#005052'],
      '#9333ea',
      '#b34e02'
    ),
  },
  {
    id: 'orchard',
    name: 'Orchard',
    dark: roles(
      ['#4ade80', '#fb923c', '#f6339a', '#818cf8'],
      '#fde047',
      '#a3e635'
    ),
    light: roles(
      ['#037d3e', '#ac5303', '#cf0288', '#5b61c9'],
      '#655702',
      '#507701'
    ),
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

/**
 * The neutral colours JS draws with where a CSS token cannot reach (a
 * canvas, an SVG's stroke, a colour handed down as a value): the same
 * values as index.css's tokens, in each mode
 */
export interface Ground {
  /** The page (--bg): the canvases' ground */
  readonly page: string
  /** A tile's face (--tile): a meter's empty track */
  readonly tile: string
  /** What lifts off the ground, as r, g, b: white, black in the light */
  readonly over: string
  /** Inputs and the amp, every chain's: zinc-200, zinc-800 in the light */
  readonly neutral: string
  /** Quieter: the voice's ink, a knob's arc nothing colours (zinc-300) */
  readonly quiet: string
  /** Quieter still: the voice's ring, the wheel unrouted (zinc-400) */
  readonly dim: string
  /** Going into the clip: amber-400, amber-600 in the light */
  readonly hot: string
}

const GROUNDS: Readonly<Record<Mode, Ground>> = {
  dark: {
    page: '#0b0b10',
    tile: '#1c1c23',
    over: '255, 255, 255',
    neutral: '#e4e4e7',
    quiet: '#d4d4d8',
    dim: '#a1a1aa',
    hot: '#fbbf24',
  },
  light: {
    page: '#e9e9ee',
    tile: '#ffffff',
    over: '0, 0, 0',
    neutral: '#27272a',
    quiet: '#3f3f46',
    dim: '#52525b',
    hot: '#d97706',
  },
}

let current = themeOf(DEFAULT_THEME)
let tone: Mode = 'dark'

/**
 * Point the app at a theme in a mode. A convention: call it only where
 * the settings are set (App.tsx), a place a render is already happening,
 * since this is module state and no render follows from it by itself.
 * The same theme and mode are left alone, so the call is safe in the
 * render.
 */
export function setTheme(id: ThemeId, mode: Mode): void {
  if (id !== current.id) current = themeOf(id)
  tone = mode
}

/** The mode the page is drawn in */
export function mode(): Mode {
  return tone
}

/** The palette the tiles, the accent and the secondary read */
export function palette(): Palette {
  return current[tone]
}

/** The neutral colours JS draws with, in the page's mode */
export function ground(): Ground {
  return GROUNDS[tone]
}

/** A mode's neutral colours, whatever the page's */
export function groundOf(mode: Mode): Ground {
  return GROUNDS[mode]
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
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
