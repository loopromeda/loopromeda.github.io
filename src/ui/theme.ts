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
 * / 기본 액센트 / 세컨더리 색상 등 전부 컨트롤"). The pop themes, louder
 * colours on surfaces tinted toward them (ashon, 2026-11-15: "좀더 팝한
 * 테마들도 넣어보면 좋겠어"), give the surfaces too; the others stand on
 * the neutral greys. A pure data file, no React, so the state may read
 * it (state/settings.ts).
 */

export const THEME_IDS = [
  'default',
  'tidal',
  'ember',
  'orchard',
  'neon',
  'candy',
  'arcade',
] as const
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

/**
 * The surfaces the page is built of, in one mode (index.css's --bg,
 * --panel, --tile, --key and --key-black): the page, a card, a tile's
 * face (a popover's too), a key or pad at rest, a black key at rest
 */
export interface Surfaces {
  readonly page: string
  readonly panel: string
  readonly tile: string
  readonly key: string
  readonly keyBlack: string
}

/** The surfaces as index.css gives them: zinc's neutral greys */
export const NEUTRAL: Readonly<Record<Mode, Surfaces>> = {
  dark: {
    page: '#0b0b10',
    panel: '#16161c',
    tile: '#1c1c23',
    key: '#2a2a31',
    keyBlack: '#111116',
  },
  light: {
    page: '#e9e9ee',
    panel: '#f5f5f8',
    tile: '#ffffff',
    key: '#ffffff',
    keyBlack: '#2e2e35',
  },
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
  /**
   * A pop theme's own surfaces: the neutral's, each at its lightness,
   * tinted toward the theme's hue (the light's tiles and keys left
   * white). Without them, the neutral.
   */
  readonly surfaces?: Readonly<Record<Mode, Surfaces>>
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
  {
    id: 'neon',
    name: 'Neon',
    // A club at night: hot pink, electric cyan, acid lime and orange on
    // violet-black, the accent a laser yellow
    dark: roles(
      ['#ff4fd8', '#3ee7ff', '#c6ff3d', '#ffa23d'],
      '#b49bff',
      '#fff04d'
    ),
    // No yellow reads on white: the accent a deep gold, the lime a green
    light: roles(
      ['#c601a5', '#0171b1', '#217c01', '#b14f03'],
      '#7c4fd8',
      '#7c6c04'
    ),
    surfaces: {
      dark: {
        page: '#0e0818',
        panel: '#191324',
        tile: '#1f192b',
        key: '#2d273a',
        keyBlack: '#140e1f',
      },
      light: {
        page: '#ebe7f4',
        panel: '#f7f3ff',
        tile: '#ffffff',
        key: '#ffffff',
        keyBlack: '#302d37',
      },
    },
  },
  {
    id: 'candy',
    name: 'Candy',
    // Sweets: bubblegum, mint, apricot and periwinkle on berry-black, the
    // modulation colour an ice blue, the accent lemon
    dark: roles(
      ['#ff6fbf', '#45f0a8', '#ffb070', '#8aa0ff'],
      '#7fe0ff',
      '#fff07a'
    ),
    // Deepened, the bubblegum and the periwinkle met the violet: the
    // modulation colour a purple, set apart from both
    light: roles(
      ['#cf0288', '#027d23', '#aa5405', '#216db9'],
      '#9333ea',
      '#786d03'
    ),
    surfaces: {
      dark: {
        page: '#15060d',
        panel: '#211119',
        tile: '#28171f',
        key: '#36252d',
        keyBlack: '#1b0c13',
      },
      light: {
        page: '#f5e5eb',
        panel: '#fff1f7',
        tile: '#ffffff',
        key: '#ffffff',
        keyBlack: '#372b30',
      },
    },
  },
  {
    id: 'arcade',
    name: 'Arcade',
    // A cabinet's primaries: yellow, sky blue, green and magenta on navy,
    // the accent orange
    dark: roles(
      ['#ffd23f', '#4db5ff', '#34e0a1', '#ff5ccd'],
      '#b18cff',
      '#ff9248'
    ),
    // The yellow deepened goes orange, the accent's place: it goes gold
    light: roles(
      ['#ae5200', '#0372af', '#147c15', '#c61b9a'],
      '#8453bf',
      '#836801'
    ),
    surfaces: {
      dark: {
        page: '#040a1e',
        panel: '#0c162b',
        tile: '#121c32',
        key: '#202a41',
        keyBlack: '#081025',
      },
      light: {
        page: '#e3eaf8',
        panel: '#f1f6fe',
        tile: '#ffffff',
        key: '#ffffff',
        keyBlack: '#2a2f39',
      },
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

/** A theme's surfaces in a mode: its own, or the neutral */
export function surfacesOf(theme: Theme, mode: Mode): Surfaces {
  return theme.surfaces?.[mode] ?? NEUTRAL[mode]
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
    page: NEUTRAL.dark.page,
    tile: NEUTRAL.dark.tile,
    over: '255, 255, 255',
    neutral: '#e4e4e7',
    quiet: '#d4d4d8',
    dim: '#a1a1aa',
    hot: '#fbbf24',
  },
  light: {
    page: NEUTRAL.light.page,
    tile: NEUTRAL.light.tile,
    over: '0, 0, 0',
    neutral: '#27272a',
    quiet: '#3f3f46',
    dim: '#52525b',
    hot: '#d97706',
  },
}

/** Each theme's grounds: the neutral's inks on its own surfaces */
const THEMED: Readonly<Record<ThemeId, Readonly<Record<Mode, Ground>>>> =
  Object.fromEntries(
    THEMES.map((theme) => {
      const on = (mode: Mode): Ground => {
        const { page, tile } = surfacesOf(theme, mode)
        return { ...GROUNDS[mode], page, tile }
      }
      return [theme.id, { dark: on('dark'), light: on('light') }]
    })
  ) as Record<ThemeId, Record<Mode, Ground>>

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

/** The theme the page is drawn in: what a canvas draws again for */
export function themeId(): ThemeId {
  return current.id
}

/** The palette the tiles, the accent and the secondary read */
export function palette(): Palette {
  return current[tone]
}

/** The surfaces the page is built of, in its theme and mode */
export function surfaces(): Surfaces {
  return surfacesOf(current, tone)
}

/** The neutral colours JS draws with, in the page's theme and mode */
export function ground(): Ground {
  return THEMED[current.id][tone]
}

/** A mode's neutral colours in the page's theme, whatever its mode */
export function groundOf(mode: Mode): Ground {
  return THEMED[current.id][mode]
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
