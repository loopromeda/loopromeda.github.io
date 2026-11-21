import { describe, expect, it } from 'vitest'
import { oklab, scaleFor, type ColourScale } from './colourScale'

/** The Default theme's accents, and the views' neutral grounds */
const ORANGE = { dark: '#ff754a', light: '#be440c' }
const GROUND = { dark: '#0b0b0b', light: '#ebebeb' }

const DARK = scaleFor('dark', GROUND.dark, ORANGE.dark)
const LIGHT = scaleFor('light', GROUND.light, ORANGE.light)

/** The colour at t along a scale, as #rrggbb */
function hexAt(t: number, scale: ColourScale): string {
  const out = new Uint8ClampedArray(4)
  scale.colour(t, out, 0)
  return `#${Array.from(out.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** A colour's hue in OKLab, degrees */
const hueOf = (hex: string) => {
  const [, a, b] = oklab(hex)
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}

/** A colour's chroma in OKLab */
const chromaOf = (hex: string) => {
  const [, a, b] = oklab(hex)
  return Math.hypot(a, b)
}

/** How far apart two hues stand, the short way round, degrees */
const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

describe('oklab', () => {
  it('puts black at 0 and white at 1, both without hue', () => {
    const black = oklab('#000000')
    const white = oklab('#ffffff')
    expect(black[0]).toBeCloseTo(0, 6)
    expect(white[0]).toBeCloseTo(1, 4)
    for (const k of [1, 2]) {
      expect(black[k]).toBeCloseTo(0, 6)
      expect(white[k]).toBeCloseTo(0, 4)
    }
  })

  it('reads a colour as Ottosson’s reference does', () => {
    // #34d399 is L 0.773, its chroma 0.153 at hue 163°
    const [L, a, b] = oklab('#34d399')
    expect(L).toBeCloseTo(0.773, 3)
    expect(Math.hypot(a, b)).toBeCloseTo(0.153, 3)
    expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(163, 0)
  })
})

describe.each([
  ['dark', DARK, 1],
  ['light', LIGHT, -1],
] as const)('the %s scale', (mode, scale, way) => {
  const [ground, accent, end] = scale.stops

  it('runs from the ground through the accent to its end', () => {
    expect(scale.stops).toHaveLength(3)
    expect(ground).toEqual({ hex: GROUND[mode], at: 0 })
    expect(accent?.hex).toBe(ORANGE[mode])
    expect(end?.at).toBe(1)
    expect(hexAt(0, scale)).toBe(GROUND[mode])
    expect(hexAt(1, scale)).toBe(end?.hex)
    // The accent drawn as it is, within the table's step of 256
    const [L, a, b] = oklab(hexAt(accent?.at as number, scale))
    const [La, aa, ba] = oklab(ORANGE[mode])
    expect(Math.hypot(L - La, a - aa, b - ba)).toBeLessThan(0.01)
  })

  it('ends near white in the dark, near black in the light', () => {
    const [L] = oklab(end?.hex as string)
    if (mode === 'dark') expect(L).toBeGreaterThan(0.96)
    else expect(L).toBeLessThan(0.25)
  })

  it('moves its lightness evenly along it, one way', () => {
    const first = oklab(GROUND[mode])[0]
    const last = oklab(end?.hex as string)[0]
    let before = way > 0 ? -1 : 2
    for (let i = 0; i <= 255; i++) {
      const t = i / 255
      const [L] = oklab(hexAt(t, scale))
      expect((L - before) * way).toBeGreaterThan(0)
      // Off the straight line only by the rounding to 8 bits
      expect(Math.abs(L - (first + (last - first) * t))).toBeLessThan(0.006)
      before = L
    }
  })

  it('holds the accent’s hue all along', () => {
    const hue = hueOf(ORANGE[mode])
    for (let i = 8; i <= 255; i++) {
      const hex = hexAt(i / 255, scale)
      // Where a colour has any chroma to tell its hue by, off it only by
      // the rounding to 8 bits, most in the darkest
      if (chromaOf(hex) < 0.02) continue
      expect(turn(hueOf(hex), hue)).toBeLessThan(4)
    }
  })

  it('clamps t, takes NaN as 0 and writes only its four bytes', () => {
    expect(hexAt(-3, scale)).toBe(GROUND[mode])
    expect(hexAt(NaN, scale)).toBe(GROUND[mode])
    expect(hexAt(7, scale)).toBe(end?.hex)
    const out = new Uint8ClampedArray(12).fill(9)
    scale.colour(0.5, out, 4)
    expect(Array.from(out.slice(0, 4))).toEqual([9, 9, 9, 9])
    expect(out[7]).toBe(255)
    expect(Array.from(out.slice(8))).toEqual([9, 9, 9, 9])
  })

  it('writes the scale as a CSS gradient of seventeen steps', () => {
    const css = scale.gradient('to right')
    const n = Number.parseInt(GROUND[mode].slice(1, 3), 16)
    expect(
      css.startsWith(`linear-gradient(to right, rgb(${n} ${n} ${n}) 0%,`)
    ).toBe(true)
    expect(css.endsWith(' 100%)')).toBe(true)
    expect(css.match(/rgb\(/g)).toHaveLength(17)
  })
})

describe('scaleFor', () => {
  it('makes a scale once a mode, ground and accent', () => {
    expect(scaleFor('dark', GROUND.dark, ORANGE.dark)).toBe(DARK)
    expect(scaleFor('light', '#f5e5eb', '#786d03')).toBe(
      scaleFor('light', '#f5e5eb', '#786d03')
    )
    expect(scaleFor('dark', GROUND.dark, '#34d399')).not.toBe(DARK)
  })

  it('gives emerald for the Emerald theme’s accent, as it once was', () => {
    const scale = scaleFor('dark', GROUND.dark, '#34d399')
    expect(scale.stops[1]?.hex).toBe('#34d399')
    // Where the one emerald scale stood it, about 0.7 of the way
    expect(scale.stops[1]?.at).toBeGreaterThan(0.65)
    expect(scale.stops[1]?.at).toBeLessThan(0.8)
    expect(turn(hueOf(hexAt(0.4, scale)), 163)).toBeLessThan(3)
  })

  it('starts from a tinted ground, its own colour first', () => {
    const scale = scaleFor('dark', '#0e0818', '#fff04d')
    expect(scale.stops[0]?.hex).toBe('#0e0818')
    const out = new Uint8ClampedArray(4)
    scale.colour(0, out, 0)
    expect([...out]).toEqual([0x0e, 0x08, 0x18, 255])
  })

  it('keeps a bright accent’s colours in sRGB, its hue held', () => {
    // A laser yellow near white: the way up from it leaves the gamut
    // unless its chroma is cut
    const scale = scaleFor('dark', '#0b0b0b', '#fff04d')
    const hue = hueOf('#fff04d')
    for (let i = 16; i <= 255; i++) {
      const hex = hexAt(i / 255, scale)
      if (chromaOf(hex) < 0.02) continue
      expect(turn(hueOf(hex), hue)).toBeLessThan(4)
    }
  })
})
