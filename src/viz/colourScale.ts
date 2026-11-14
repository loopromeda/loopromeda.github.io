/**
 * The colour scale levels are drawn in, the spectrogram's (asked for by
 * ashon, 2026-11-14: "스펙트로그램에서 데시벨 표현도 들어가야 하니 이
 * 부분은 적절히 컬러링을 넣어보는것은 어떨까? 컬러 스케일을 하나 만들어
 * 두면 좋겠네"): from the views' background, for nothing, through indigo,
 * blue, teal and the app's emerald to yellow and near white, for the
 * loudest. Its lightness (OKLab's L) rises evenly along it, so that equal
 * steps in dB are equal steps in lightness wherever they fall, and its hue
 * turns as it rises, so that a level is told by its colour as well as by
 * how light it is. Between its stops it is mixed in OKLab, and read from
 * a table of 256 colours made once. Pure: no DOM.
 */

/** An OKLab colour: lightness, then green to red, then blue to yellow */
export type Lab = readonly [number, number, number]

/**
 * The scale's colours, from nothing to the loudest: the views'
 * background, indigo, blue, teal, emerald (the app's), yellow and near
 * white, each lighter than the one before
 */
const COLOURS = [
  '#0b0b10',
  '#311969',
  '#125a98',
  '#0c9999',
  '#34d399',
  '#e1e950',
  '#fdfce1',
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

const LABS = COLOURS.map(oklab)
const FIRST = (LABS[0] as Lab)[0]
const LAST = (LABS[LABS.length - 1] as Lab)[0]

/**
 * The scale's stops: each colour, and where along the scale it stands,
 * 0 to 1, which is how light it is, the first at 0 and the last at 1
 */
export const SCALE_STOPS: readonly {
  readonly hex: string
  readonly at: number
}[] = COLOURS.map((hex, k) => ({
  hex,
  at: ((LABS[k] as Lab)[0] - FIRST) / (LAST - FIRST),
}))

/** The colour at t along the scale, 0 to 1, between the stops about it */
function mix(t: number): Lab {
  let k = 1
  while (
    k < SCALE_STOPS.length - 1 &&
    (SCALE_STOPS[k] as { at: number }).at < t
  )
    k++
  const from = SCALE_STOPS[k - 1] as { at: number }
  const to = SCALE_STOPS[k] as { at: number }
  const u = (t - from.at) / (to.at - from.at)
  const a = LABS[k - 1] as Lab
  const b = LABS[k] as Lab
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ]
}

/** The scale's table: SIZE opaque RGBA colours, evenly along it */
const TABLE = new Uint8ClampedArray(SIZE * 4)
for (let i = 0; i < SIZE; i++) {
  const lab = mix(i / (SIZE - 1))
  for (let k = 0; k < 3; k++) TABLE[i * 4 + k] = channel(lab, k) * 255
  TABLE[i * 4 + 3] = 255
}

/** Which of the table's colours stands at t along the scale */
function entry(t: number): number {
  const clamped = t > 0 ? (t < 1 ? t : 1) : 0
  return Math.round(clamped * (SIZE - 1)) * 4
}

/**
 * Writes the opaque RGBA colour at t along the scale into out[at ..
 * at + 3]: t is clamped to 0..1, NaN taken as 0 (the background), and
 * the colour is the table's nearest. Allocates nothing.
 */
export function scaleColour(
  t: number,
  out: Uint8ClampedArray,
  at: number
): void {
  const from = entry(t)
  out[at] = TABLE[from] as number
  out[at + 1] = TABLE[from + 1] as number
  out[at + 2] = TABLE[from + 2] as number
  out[at + 3] = 255
}

/**
 * The scale as a CSS gradient towards direction ('to right', say), for
 * its key: the table's colours at every sixteenth of the way, close
 * enough that the browser's mixing between them matches OKLab's
 */
export function scaleGradient(direction: string): string {
  const steps: string[] = []
  for (let k = 0; k <= 16; k++) {
    const from = entry(k / 16)
    const rgb = `${TABLE[from]} ${TABLE[from + 1]} ${TABLE[from + 2]}`
    steps.push(`rgb(${rgb}) ${(k / 16) * 100}%`)
  }
  return `linear-gradient(${direction}, ${steps.join(', ')})`
}
