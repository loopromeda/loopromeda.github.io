/**
 * The colour scale levels are drawn in, the spectrogram's: one hue, the
 * theme's accent. In the dark it runs from the views' background, for
 * nothing, through the accent to near white, for the loudest; in the
 * light from the light views' background through the accent to near
 * black. The scale's ends carry the accent's hue too, a breath of it, so
 * the hue holds all along (ashon, 2026-11-21: "스펙트로그램도 기존 단색
 * 기반으로 가 보면 좋겠는데", the one hue it was drawn in until a colour
 * scale of many, 2026-11-14, replaced it). Along it the lightness
 * (OKLab's L) moves evenly, so that equal steps in dB are equal steps in
 * lightness wherever they fall; between its stops it is mixed in OKLab, a
 * colour outside sRGB losing chroma, never its lightness or hue. It is
 * read from a table of 256 colours made once a scale. Pure: no DOM.
 */

/** An OKLab colour: lightness, then green to red, then blue to yellow */
export type Lab = readonly [number, number, number]

/** The mode a scale is drawn in */
export type ScaleMode = 'dark' | 'light'

/**
 * Where a scale ends, by its mode: the lightness, and the chroma at the
 * accent's hue. Near white in the dark (as emerald-50 was), near black
 * in the light.
 */
const END: Readonly<Record<ScaleMode, readonly [number, number]>> = {
  dark: [0.975, 0.03],
  light: [0.22, 0.05],
}

/** How many colours a scale's table holds */
const SIZE = 256

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

const toGamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055

/** A colour written #rrggbb in OKLab, as Björn Ottosson defines it */
export function oklab(hex: string): Lab {
  const r = toLinear(parseInt(hex.slice(1, 3), 16) / 255)
  const g = toLinear(parseInt(hex.slice(3, 5), 16) / 255)
  const b = toLinear(parseInt(hex.slice(5, 7), 16) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** An OKLab colour in linear sRGB, unclamped: red, green, blue */
function linear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Whether an OKLab colour is one sRGB can show, within rounding */
function shown(lab: Lab): boolean {
  return linear(lab).every((c) => c >= -1e-4 && c <= 1 + 1e-4)
}

/**
 * An OKLab colour sRGB can show: the colour itself, or, outside, the
 * one of its lightness and hue with as much of its chroma as fits
 */
function inGamut(lab: Lab): Lab {
  if (shown(lab)) return lab
  const [L, a, b] = lab
  let low = 0
  let high = 1
  for (let k = 0; k < 24; k++) {
    const share = (low + high) / 2
    if (shown([L, a * share, b * share])) low = share
    else high = share
  }
  return [L, a * low, b * low]
}

/** An OKLab colour in sRGB, its channels 0 to 255 */
function rgb(lab: Lab): [number, number, number] {
  const [r, g, b] = linear(lab)
  const byte = (c: number) =>
    Math.round(toGamma(Math.min(1, Math.max(0, c))) * 255)
  return [byte(r), byte(g), byte(b)]
}

/** An OKLab colour written #rrggbb */
function hexOf(lab: Lab): string {
  return `#${rgb(lab)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`
}

/** A scale's stop: its colour, and where along the scale it stands, 0 to 1 */
export interface ScaleStop {
  readonly hex: string
  readonly at: number
}

/** A colour scale, its table made once */
export interface ColourScale {
  /**
   * Its stops: the ground, the accent and the end, and where along the
   * scale each stands, which is how far its lightness has moved from the
   * ground's, the ground at 0 and the end at 1
   */
  readonly stops: readonly ScaleStop[]
  /**
   * Writes the opaque RGBA colour at t along the scale into out[at ..
   * at + 3]: t is clamped to 0..1, NaN taken as 0 (the background), and
   * the colour is the table's nearest. Allocates nothing.
   */
  colour(t: number, out: Uint8ClampedArray, at: number): void
  /**
   * The scale as a CSS gradient towards direction ('to right', say), for
   * its key: the table's colours at every sixteenth of the way, close
   * enough that the browser's mixing between them matches OKLab's
   */
  gradient(direction: string): string
}

/** A scale through colours, their lightness moving one way all along */
function colourScale(labs: readonly Lab[]): ColourScale {
  const first = (labs[0] as Lab)[0]
  const last = (labs[labs.length - 1] as Lab)[0]
  const stops = labs.map((lab) => ({
    hex: hexOf(lab),
    // A share of the way, never -0 where the lightness falls
    at: Math.abs((lab[0] - first) / (last - first)),
  }))

  /** The colour at t along the scale, between the stops about it */
  const mix = (t: number): Lab => {
    let k = 1
    while (k < stops.length - 1 && (stops[k] as ScaleStop).at < t) k++
    const from = stops[k - 1] as ScaleStop
    const to = stops[k] as ScaleStop
    const u = (t - from.at) / (to.at - from.at)
    const a = labs[k - 1] as Lab
    const b = labs[k] as Lab
    return [
      a[0] + (b[0] - a[0]) * u,
      a[1] + (b[1] - a[1]) * u,
      a[2] + (b[2] - a[2]) * u,
    ]
  }

  /** The table: SIZE opaque RGBA colours, evenly along it */
  const table = new Uint8ClampedArray(SIZE * 4)
  for (let i = 0; i < SIZE; i++) {
    const [r, g, b] = rgb(inGamut(mix(i / (SIZE - 1))))
    table.set([r, g, b, 255], i * 4)
  }

  return {
    stops,
    colour(t, out, at) {
      const from = entry(t)
      out[at] = table[from] as number
      out[at + 1] = table[from + 1] as number
      out[at + 2] = table[from + 2] as number
      out[at + 3] = 255
    },
    gradient(direction) {
      const steps: string[] = []
      for (let k = 0; k <= 16; k++) {
        const from = entry(k / 16)
        const rgb = `${table[from]} ${table[from + 1]} ${table[from + 2]}`
        steps.push(`rgb(${rgb}) ${(k / 16) * 100}%`)
      }
      return `linear-gradient(${direction}, ${steps.join(', ')})`
    },
  }
}

/** Which of a table's colours stands at t along its scale */
function entry(t: number): number {
  const clamped = t > 0 ? (t < 1 ? t : 1) : 0
  return Math.round(clamped * (SIZE - 1)) * 4
}

/** The scales made, by mode, ground and accent */
const MADE = new Map<string, ColourScale>()

/**
 * The spectrogram's scale in a mode: from the views' ground as the theme
 * gives it (a pop theme's page, tinted), so that nothing is drawn in the
 * page's own colour, through the theme's accent to the mode's end, near
 * white or near black in the accent's hue. Made once a mode, ground and
 * accent.
 */
export function scaleFor(
  mode: ScaleMode,
  ground: string,
  accent: string
): ColourScale {
  const key = `${mode}${ground}${accent}`
  const made = MADE.get(key)
  if (made) return made
  const tint = oklab(accent)
  const hue = Math.atan2(tint[2], tint[1])
  const [L, chroma] = END[mode]
  const end = inGamut([L, chroma * Math.cos(hue), chroma * Math.sin(hue)])
  const scale = colourScale([oklab(ground), tint, end])
  MADE.set(key, scale)
  return scale
}
