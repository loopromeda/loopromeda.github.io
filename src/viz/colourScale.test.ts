import { describe, expect, it } from 'vitest'
import {
  oklab,
  scaleOn,
  SCALES,
  type ColourScale,
  type ScaleStop,
} from './colourScale'

const DARK = SCALES.dark
const LIGHT = SCALES.light
const SCALE_STOPS = DARK.stops
type Stop = ScaleStop

/** The colour at t along a scale (the dark's), as #rrggbb */
function hexAt(t: number, scale: ColourScale = DARK): string {
  const out = new Uint8ClampedArray(4)
  scale.colour(t, out, 0)
  return `#${Array.from(out.slice(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** A colour's hue in OKLab, degrees */
const hueOf = (hex: string) => {
  const [, a, b] = oklab(hex)
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}

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

describe('the dark colour scale', () => {
  it('runs from the views’ background to near white', () => {
    expect(hexAt(0)).toBe('#0b0b10')
    expect(hexAt(1)).toBe('#fdfce1')
    expect(SCALE_STOPS[0]?.at).toBe(0)
    expect(SCALE_STOPS[SCALE_STOPS.length - 1]?.at).toBe(1)
  })

  it('stands each stop where its lightness is, each further on', () => {
    for (let k = 1; k < SCALE_STOPS.length; k++) {
      const stop = SCALE_STOPS[k] as Stop
      expect(stop.at).toBeGreaterThan((SCALE_STOPS[k - 1] as Stop).at)
      // The table's nearest colour, within a step of 256
      const [L] = oklab(hexAt(stop.at))
      expect(Math.abs(L - oklab(stop.hex)[0])).toBeLessThan(0.006)
    }
  })

  it('grows evenly lighter along it', () => {
    const first = oklab('#0b0b10')[0]
    const last = oklab('#fdfce1')[0]
    let before = -1
    for (let i = 0; i <= 255; i++) {
      const t = i / 255
      const [L] = oklab(hexAt(t))
      expect(L).toBeGreaterThan(before)
      // Off the straight line only by the rounding to 8 bits
      expect(Math.abs(L - (first + (last - first) * t))).toBeLessThan(0.006)
      before = L
    }
  })

  it('turns its hue as it rises: indigo, blue, teal, emerald, yellow', () => {
    const hue = (t: number) => {
      const [, a, b] = oklab(hexAt(t))
      return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
    }
    const [, indigo, blue, teal, emerald, yellow] = SCALE_STOPS.map((s) =>
      hue(s.at)
    )
    expect(indigo).toBeGreaterThan(280)
    expect(blue).toBeGreaterThan(235)
    expect(blue).toBeLessThan(265)
    expect(teal).toBeGreaterThan(180)
    expect(teal).toBeLessThan(210)
    expect(emerald).toBeGreaterThan(150)
    expect(emerald).toBeLessThan(175)
    expect(yellow).toBeGreaterThan(95)
    expect(yellow).toBeLessThan(125)
  })

  it('clamps t, takes NaN as 0 and writes only its four bytes', () => {
    expect(hexAt(-3)).toBe('#0b0b10')
    expect(hexAt(NaN)).toBe('#0b0b10')
    expect(hexAt(7)).toBe('#fdfce1')
    const out = new Uint8ClampedArray(12).fill(9)
    DARK.colour(0.5, out, 4)
    expect(Array.from(out.slice(0, 4))).toEqual([9, 9, 9, 9])
    expect(out[7]).toBe(255)
    expect(Array.from(out.slice(8))).toEqual([9, 9, 9, 9])
  })

  it('writes the scale as a CSS gradient of seventeen steps', () => {
    const css = DARK.gradient('to right')
    expect(css.startsWith('linear-gradient(to right, rgb(11 11 16) 0%,')).toBe(
      true
    )
    expect(css.endsWith(', rgb(253 252 225) 100%)')).toBe(true)
    expect(css.match(/rgb\(/g)).toHaveLength(17)
  })
})

describe('the light colour scale', () => {
  it('runs from the light views’ background to near black', () => {
    expect(hexAt(0, LIGHT)).toBe('#e9e9ee')
    expect(hexAt(1, LIGHT)).toBe('#1e0e33')
    expect(LIGHT.stops[0]?.at).toBe(0)
    expect(LIGHT.stops[LIGHT.stops.length - 1]?.at).toBe(1)
  })

  it('grows evenly darker along it', () => {
    const first = oklab('#e9e9ee')[0]
    const last = oklab('#1e0e33')[0]
    let before = 2
    for (let i = 0; i <= 255; i++) {
      const t = i / 255
      const [L] = oklab(hexAt(t, LIGHT))
      expect(L).toBeLessThan(before)
      expect(Math.abs(L - (first + (last - first) * t))).toBeLessThan(0.006)
      before = L
    }
  })

  it('meets the dark scale’s hues the other way round', () => {
    const [, yellow, emerald, teal, blue, indigo] = LIGHT.stops.map((s) =>
      hueOf(hexAt(s.at, LIGHT))
    )
    expect(yellow).toBeGreaterThan(95)
    expect(yellow).toBeLessThan(125)
    expect(emerald).toBeGreaterThan(150)
    expect(emerald).toBeLessThan(175)
    expect(teal).toBeGreaterThan(180)
    expect(teal).toBeLessThan(210)
    expect(blue).toBeGreaterThan(235)
    expect(blue).toBeLessThan(265)
    expect(indigo).toBeGreaterThan(275)
  })
})

describe('scaleOn', () => {
  it("is the mode's own scale on the neutral ground", () => {
    expect(scaleOn('dark', '#0b0b10')).toBe(SCALES.dark)
    expect(scaleOn('light', '#e9e9ee')).toBe(SCALES.light)
  })

  it('starts from a tinted ground, the rest of the way as it was', () => {
    const scale = scaleOn('dark', '#0e0818')
    expect(scale.stops[0]?.hex).toBe('#0e0818')
    expect(scale.stops.slice(1).map((stop) => stop.hex)).toEqual(
      SCALES.dark.stops.slice(1).map((stop) => stop.hex)
    )
    const out = new Uint8ClampedArray(4)
    scale.colour(0, out, 0)
    expect([...out]).toEqual([0x0e, 0x08, 0x18, 255])
  })

  it('makes a ground once', () => {
    expect(scaleOn('light', '#f5e5eb')).toBe(scaleOn('light', '#f5e5eb'))
  })
})
