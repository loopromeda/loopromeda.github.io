/**
 * The colour scales levels are drawn in, the spectrogram's (asked for by
 * ashon, 2026-11-14: "스펙트로그램에서 데시벨 표현도 들어가야 하니 이
 * 부분은 적절히 컬러링을 넣어보는것은 어떨까? 컬러 스케일을 하나 만들어
 * 두면 좋겠네"), one for each mode. In the dark: from the views'
 * background, for nothing, through indigo, blue, teal and the app's
 * emerald to yellow and near white, for the loudest. In the light the
 * other way about: from the light views' background through a pale
 * yellow, emerald, teal, blue and indigo to near black. Along each its
 * lightness (OKLab's L) moves evenly, so that equal steps in dB are equal
 * steps in lightness wherever they fall, and its hue turns as it goes, so
 * that a level is told by its colour as well as by how light it is.
 * Between its stops it is mixed in OKLab, and read from a table of 256
 * colours made once. Pure: no DOM.
 */

/** An OKLab colour: lightness, then green to red, then blue to yellow */
export type Lab = readonly [number, number, number]

/**
 * The dark scale's colours, from nothing to the loudest: the views'
 * background, indigo, blue, teal, emerald (the app's), yellow and near
 * white, each lighter than the one before
 */
const DARK_COLOURS = [
  '#0b0b10',
  '#311969',
  '#125a98',
  '#0c9999',
  '#34d399',
  '#e1e950',
  '#fdfce1',
] as const

/**
 * The light scale's: the light views' background, a pale yellow, emerald,
 * teal, blue, indigo and near black, each darker than the one before, the
 * dark scale's hues met the other way round
 */
const LIGHT_COLOURS = [
  '#e9e9ee',
  '#dad586',
  '#50c08b',
  '#0f9293',
  '#0e5e9a',
  '#35247b',
  '#1e0e33',
] as const

/** How many colours the scale's table holds */
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

/** An OKLab colour's sRGB channel k (0 red, 1 green, 2 blue), 0 to 1 */
function channel([L, a, b]: Lab, k: number): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear =
    k === 0
      ? 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
      : k === 1
        ? -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
        : -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return toGamma(Math.min(1, Math.max(0, linear)))
}

/** A scale's stop: its colour, and where along the scale it stands, 0 to 1 */
export interface ScaleStop {
  readonly hex: string
  readonly at: number
}

/** A colour scale, its table made once */
export interface ColourScale {
  /**
   * Its stops: each colour, and where along the scale it stands, which is
   * how far its lightness has moved from the first's, the first at 0 and
   * the last at 1
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
function colourScale(colours: readonly string[]): ColourScale {
  const labs = colours.map(oklab)
  const first = (labs[0] as Lab)[0]
  const last = (labs[labs.length - 1] as Lab)[0]
  const stops = colours.map((hex, k) => ({
    hex,
    // A share of the way, never -0 where the lightness falls
    at: Math.abs(((labs[k] as Lab)[0] - first) / (last - first)),
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
    const lab = mix(i / (SIZE - 1))
    for (let k = 0; k < 3; k++) table[i * 4 + k] = channel(lab, k) * 255
    table[i * 4 + 3] = 255
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

/** The scales, by the mode they are drawn in */
export const SCALES: Readonly<Record<'dark' | 'light', ColourScale>> = {
  dark: colourScale(DARK_COLOURS),
  light: colourScale(LIGHT_COLOURS),
}
