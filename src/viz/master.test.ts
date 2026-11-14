import { describe, expect, it } from 'vitest'
import { softClip } from '../dsp/clip'
import {
  METER_MIN_DB,
  MeterBallistics,
  REDUCTION_RANGE,
  SPECTRUM_MAX_HZ,
  SPECTRUM_MIN_HZ,
  Ticks,
  correlation,
  dbToY,
  holdPeaks,
  hzToX,
  levelAt,
  levelsOf,
  lighten,
  lufsText,
  reductionFill,
  reductionText,
  spectrogramColour,
  spectrogramRows,
  spectrumColumns,
  toDb,
  unclip,
  sampleLevels,
  unclippedLevels,
  vectorPoint,
  xToHz,
} from './master'
import { scaleColour } from './colourScale'

const SAMPLE_RATE = 48000
const BINS = 2048
const COLUMNS = 240
const WIDTH = 640

/** Deterministic pseudo-noise in -1..1 (mulberry32), never Math.random. */
function noise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length)
  let s = seed >>> 0
  for (let i = 0; i < length; i++) {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 0x100000000) * 2 - 1
  }
  return out
}

describe('hzToX and xToHz', () => {
  it('maps 20 Hz to 0 and 20 kHz to the full width', () => {
    expect(hzToX(SPECTRUM_MIN_HZ, WIDTH)).toBe(0)
    expect(hzToX(SPECTRUM_MAX_HZ, WIDTH)).toBeCloseTo(WIDTH, 9)
    expect(xToHz(0, WIDTH)).toBeCloseTo(SPECTRUM_MIN_HZ, 9)
    expect(xToHz(WIDTH, WIDTH)).toBeCloseTo(SPECTRUM_MAX_HZ, 6)
  })

  it('puts the log middle, about 632.46 Hz, at half the width', () => {
    const middle = Math.sqrt(SPECTRUM_MIN_HZ * SPECTRUM_MAX_HZ)
    expect(middle).toBeCloseTo(632.46, 2)
    expect(hzToX(middle, WIDTH)).toBeCloseTo(WIDTH / 2, 6)
    expect(xToHz(WIDTH / 2, WIDTH)).toBeCloseTo(middle, 6)
  })

  it('round trips a frequency within 1e-9 relative', () => {
    for (const hz of [20, 50, 333.3, 1000, 6324.5, 12000, 20000]) {
      const rt = xToHz(hzToX(hz, WIDTH), WIDTH)
      expect(Math.abs(rt / hz - 1)).toBeLessThan(1e-9)
    }
  })
})

describe('spectrumColumns', () => {
  const binHz = SAMPLE_RATE / (2 * BINS)

  it('puts a lone bin in exactly one column, the one holding it', () => {
    const db = new Float32Array(BINS).fill(-100)
    const bin = Math.round(5000 / binHz) // near 5 kHz at 48 kHz
    db[bin] = -10
    const out = new Float32Array(COLUMNS)
    spectrumColumns(db, SAMPLE_RATE, out)
    const loud: number[] = []
    for (let c = 0; c < COLUMNS; c++) {
      const v = out[c] as number
      if (v === -10) loud.push(c)
      else expect(v).toBe(-100)
    }
    expect(loud).toEqual([
      Math.floor(hzToX((bin * SAMPLE_RATE) / (2 * BINS), COLUMNS)),
    ])
  })

  it('interpolates a low column that holds no bin', () => {
    const db = new Float32Array(BINS).fill(-100)
    db[1] = -30
    db[2] = -50
    const out = new Float32Array(COLUMNS)
    spectrumColumns(db, SAMPLE_RATE, out)
    // The first column spans 20 Hz to about 20.6 Hz, holding no bin
    // (bins sit at multiples of 11.71875 Hz), and its centre falls
    // between bins 1 and 2.
    const centre = xToHz(0.5, COLUMNS) / binHz
    expect(centre).toBeGreaterThan(1)
    expect(centre).toBeLessThan(2)
    expect(out[0]).toBeCloseTo(levelAt(db, centre), 4)
    expect(out[0]).toBeLessThan(-30)
    expect(out[0]).toBeGreaterThan(-50)
  })

  it('gives -Infinity for a silent analyser, never NaN', () => {
    const db = new Float32Array(BINS).fill(-Infinity)
    const out = new Float32Array(COLUMNS).fill(7)
    spectrumColumns(db, SAMPLE_RATE, out)
    for (let c = 0; c < COLUMNS; c++) {
      expect(out[c]).toBe(-Infinity)
    }
  })

  it('treats a NaN bin like -Infinity in the loudest-of-bins max', () => {
    const db = new Float32Array(BINS).fill(-Infinity)
    db[100] = NaN
    const out = new Float32Array(COLUMNS)
    spectrumColumns(db, SAMPLE_RATE, out)
    for (let c = 0; c < COLUMNS; c++) {
      expect(out[c]).toBe(-Infinity)
    }
  })
})

describe('levelAt', () => {
  /** Bins in dB, the rest at the floor */
  const bins = (levels: readonly number[]) => {
    const db = new Float32Array(64).fill(-100)
    db.set(levels, 10)
    return db
  }

  it('reads each bin at its place', () => {
    const db = bins([-60, -30, -31, -60])
    for (let k = 10; k < 14; k++) expect(levelAt(db, k)).toBe(db[k])
  })

  it('draws a peak as measured: never above its bin, nor between bins', () => {
    const db = bins([-60, -30, -31, -60])
    for (let p = 9; p <= 14; p += 0.05) {
      const k = Math.floor(p)
      const a = db[k] as number
      const b = db[k + 1] as number
      const v = levelAt(db, p)
      expect(v).toBeLessThanOrEqual(Math.max(a, b) + 1e-9)
      expect(v).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9)
    }
  })

  it('meets each bin at one slope, either side', () => {
    const db = bins([-80, -50, -35, -40, -70])
    const h = 1e-6
    for (const k of [11, 12, 13]) {
      const left = (levelAt(db, k) - levelAt(db, k - h)) / h
      const right = (levelAt(db, k + h) - levelAt(db, k)) / h
      expect(right).toBeCloseTo(left, 3)
    }
    // The peak's bin, where the lines turn: flat there
    expect((levelAt(db, 12 + h) - levelAt(db, 12)) / h).toBeCloseTo(0, 3)
  })

  it('keeps a straight run of bins straight', () => {
    const db = bins([-90, -80, -70, -60, -50])
    expect(levelAt(db, 11.25)).toBeCloseTo(-77.5, 9)
    expect(levelAt(db, 12.5)).toBeCloseTo(-65, 9)
  })

  it('gives -Infinity next to a bin that is', () => {
    const db = bins([-40, -50])
    db[12] = -Infinity
    expect(levelAt(db, 11.5)).toBe(-Infinity)
    expect(levelAt(db, 63.5)).toBe(-Infinity)
    expect(Number.isFinite(levelAt(db, 10.5))).toBe(true)
  })
})

describe('dbToY', () => {
  it('maps maxDb to the top and minDb to the bottom', () => {
    expect(dbToY(0, 100, METER_MIN_DB, 0)).toBe(0)
    expect(dbToY(METER_MIN_DB, 100, METER_MIN_DB, 0)).toBe(100)
  })

  it('puts the middle of the range at half the height', () => {
    expect(dbToY(-30, 100, METER_MIN_DB, 0)).toBe(50)
  })

  it('clamps levels outside the range', () => {
    expect(dbToY(12, 100, METER_MIN_DB, 0)).toBe(0)
    expect(dbToY(-120, 100, METER_MIN_DB, 0)).toBe(100)
  })

  it('gives the bottom for -Infinity and NaN', () => {
    expect(dbToY(-Infinity, 100, METER_MIN_DB, 0)).toBe(100)
    expect(dbToY(NaN, 100, METER_MIN_DB, 0)).toBe(100)
  })
})

describe('holdPeaks', () => {
  it('takes the new level when it rises above the peak', () => {
    const levels = Float32Array.from([-20, -40])
    const peaks = Float32Array.from([-50, -30])
    holdPeaks(levels, peaks, 3)
    expect(Array.from(peaks)).toEqual([-20, -33])
  })

  it('falls by fall when the level is -Infinity or NaN', () => {
    const levels = new Float32Array([-Infinity, NaN])
    const peaks = Float32Array.from([-20, -20])
    holdPeaks(levels, peaks, 2.5)
    expect(Array.from(peaks)).toEqual([-22.5, -22.5])
  })

  it('takes the level when the peak is -Infinity or NaN', () => {
    const levels = Float32Array.from([-12, -8])
    const peaks = Float32Array.from([-Infinity, NaN])
    holdPeaks(levels, peaks, 1)
    expect(Array.from(peaks)).toEqual([-12, -8])
  })
})

describe('levelsOf', () => {
  it('gives peak about 1 and rms about 0.7071 for a full-scale sine', () => {
    const samples = new Float32Array(4800) // 44 cycles of 440 Hz
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
    }
    const { peak, rms } = levelsOf(samples)
    expect(peak).toBeCloseTo(1, 3)
    expect(rms).toBeCloseTo(0.7071, 3)
  })

  it('measures a known trio exactly', () => {
    const samples = Float32Array.from([0.6, -0.8, 0])
    const { peak, rms } = levelsOf(samples)
    expect(peak).toBeCloseTo(0.8, 6)
    expect(rms).toBeCloseTo(Math.sqrt(1 / 3), 6)
  })

  it('gives 0 for both on an empty array', () => {
    expect(levelsOf(new Float32Array(0))).toEqual({ peak: 0, rms: 0 })
  })
})

describe('toDb', () => {
  it('is 0 at full scale', () => {
    expect(toDb(1)).toBe(0)
  })

  it('is about -6.02 dB at half scale', () => {
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2)
  })

  it('floors at METER_MIN_DB for zero, negatives and NaN', () => {
    expect(toDb(0)).toBe(METER_MIN_DB)
    expect(toDb(-1)).toBe(METER_MIN_DB)
    expect(toDb(NaN)).toBe(METER_MIN_DB)
    expect(toDb(0.0001)).toBe(METER_MIN_DB)
  })
})

describe('MeterBallistics', () => {
  const FALL = 20 // dB per second
  const HOLD = 1 // seconds

  it('starts at METER_MIN_DB', () => {
    const m = new MeterBallistics(FALL, HOLD)
    expect(m.level).toBe(METER_MIN_DB)
    expect(m.peak).toBe(METER_MIN_DB)
  })

  it('rises at once', () => {
    const m = new MeterBallistics(FALL, HOLD)
    m.update(-10, 0.02)
    expect(m.level).toBe(-10)
    expect(m.peak).toBe(-10)
  })

  it('falls at fallDbPerSecond', () => {
    const m = new MeterBallistics(FALL, HOLD)
    m.update(-10, 0.02)
    m.update(METER_MIN_DB, 0.05)
    expect(m.level).toBeCloseTo(-11, 9)
  })

  it('holds the peak for holdSeconds, then falls with the level', () => {
    const m = new MeterBallistics(FALL, HOLD)
    m.update(-10, 0.02)
    m.update(METER_MIN_DB, 0.5) // still within the hold
    expect(m.peak).toBe(-10)
    expect(m.level).toBeCloseTo(-20, 9)
    m.update(METER_MIN_DB, 0.6) // past the hold, the peak falls too
    expect(m.peak).toBeCloseTo(-22, 6)
  })

  it('restarts the hold when a new peak arrives', () => {
    const m = new MeterBallistics(FALL, HOLD)
    m.update(-10, 0.02)
    m.update(METER_MIN_DB, 1.5) // the peak has begun to fall
    expect(m.peak).toBeLessThan(-10)
    m.update(-12, 0.02)
    expect(m.peak).toBe(-12)
    m.update(METER_MIN_DB, 0.5) // the hold started again
    expect(m.peak).toBe(-12)
  })

  it('never lets either go below METER_MIN_DB', () => {
    const m = new MeterBallistics(FALL, HOLD)
    m.update(-6, 0.02)
    for (let i = 0; i < 100; i++) m.update(-Infinity, 0.1)
    expect(m.level).toBe(METER_MIN_DB)
    expect(m.peak).toBe(METER_MIN_DB)
  })

  it('treats a non-finite level as METER_MIN_DB', () => {
    const m = new MeterBallistics(FALL, HOLD)
    m.update(-10, 0.02)
    m.update(NaN, 0.05)
    expect(m.level).toBeCloseTo(-11, 9)
  })

  it('returns both to METER_MIN_DB on reset', () => {
    const m = new MeterBallistics(FALL, HOLD)
    m.update(-6, 0.02)
    m.reset()
    expect(m.level).toBe(METER_MIN_DB)
    expect(m.peak).toBe(METER_MIN_DB)
  })
})

describe('correlation', () => {
  it('is +1 for the same signal on both sides', () => {
    expect(correlation(noise(1024, 1), noise(1024, 1))).toBeCloseTo(1, 9)
  })

  it('is -1 when one side is the other negated', () => {
    const l = noise(1024, 2)
    const r = new Float32Array(l.length)
    for (let i = 0; i < l.length; i++) r[i] = -(l[i] as number)
    expect(correlation(l, r)).toBeCloseTo(-1, 9)
  })

  it('is near 0 for two unrelated pseudo-random sequences', () => {
    const c = correlation(noise(1024, 3), noise(1024, 4))
    expect(Math.abs(c)).toBeLessThan(0.05)
  })

  it('is 0 when either side is silent', () => {
    const l = noise(512, 5)
    expect(correlation(l, new Float32Array(512))).toBe(0)
    expect(correlation(new Float32Array(512), l)).toBe(0)
  })

  it('uses only the shorter of the two lengths', () => {
    const l = noise(64, 6)
    const r = noise(32, 7)
    expect(correlation(l, r)).toBe(correlation(l.slice(0, 32), r))
  })

  it('stays within -1..1 even after scaling', () => {
    const l = noise(512, 8)
    const r = new Float32Array(l.length)
    for (let i = 0; i < l.length; i++) r[i] = (l[i] as number) * 1000
    expect(correlation(l, r)).toBeLessThanOrEqual(1)
    expect(correlation(l, r)).toBeCloseTo(1, 6)
  })
})

describe('vectorPoint', () => {
  it('draws a vertical line for a mono signal', () => {
    for (const v of [0.9, 0.2, -0.7]) {
      const p = vectorPoint(v, v)
      expect(p.x).toBe(0)
      expect(p.y).toBeCloseTo((2 * v) / Math.SQRT2, 12)
    }
  })

  it('leans to the upper left for the left channel alone', () => {
    const p = vectorPoint(0.6, 0)
    expect(p.x).toBeLessThan(0)
    expect(p.y).toBeGreaterThan(0)
    expect(p.x).toBeCloseTo(-0.6 / Math.SQRT2, 12)
    expect(p.y).toBeCloseTo(0.6 / Math.SQRT2, 12)
  })

  it('leans to the upper right for the right channel alone', () => {
    const p = vectorPoint(0, 0.6)
    expect(p.x).toBeGreaterThan(0)
    expect(p.y).toBeGreaterThan(0)
  })
})

describe('spectrogramColour', () => {
  const MIN = -60
  const MAX = 0

  it('writes the background at t 0, at the given offset only', () => {
    const out = new Uint8ClampedArray(8).fill(9)
    spectrogramColour(MIN, MIN, MAX, out, 4)
    expect(Array.from(out.slice(0, 4))).toEqual([9, 9, 9, 9])
    expect(Array.from(out.slice(4))).toEqual([11, 11, 16, 255])
  })

  it('writes the colour scale’s near white at t 1', () => {
    const out = new Uint8ClampedArray(4)
    spectrogramColour(MAX, MIN, MAX, out, 0)
    expect(Array.from(out)).toEqual([253, 252, 225, 255])
  })

  it('colours a level as the scale does at its place in the range', () => {
    const out = new Uint8ClampedArray(4)
    const scale = new Uint8ClampedArray(4)
    for (const t of [0.2, 0.5, 0.75]) {
      spectrogramColour(MIN + t * (MAX - MIN), MIN, MAX, out, 0)
      scaleColour(t, scale, 0)
      expect(Array.from(out)).toEqual(Array.from(scale))
    }
  })

  it('clamps outside the range and takes -Infinity and NaN as t 0', () => {
    const hot = new Uint8ClampedArray(4)
    spectrogramColour(10, MIN, MAX, hot, 0)
    expect(Array.from(hot)).toEqual([253, 252, 225, 255])
    const dead = new Uint8ClampedArray(4)
    spectrogramColour(-Infinity, MIN, MAX, dead, 0)
    expect(Array.from(dead)).toEqual([11, 11, 16, 255])
    const broken = new Uint8ClampedArray(4)
    spectrogramColour(NaN, MIN, MAX, broken, 0)
    expect(Array.from(broken)).toEqual([11, 11, 16, 255])
  })

  it('always writes an opaque alpha', () => {
    const out = new Uint8ClampedArray(12)
    spectrogramColour(-45, MIN, MAX, out, 0)
    spectrogramColour(-18, MIN, MAX, out, 4)
    spectrogramColour(0, MIN, MAX, out, 8)
    expect([out[3], out[7], out[11]]).toEqual([255, 255, 255])
  })
})

describe('unclip and unclippedLevels', () => {
  it('undoes the soft clip, finitely at full scale', () => {
    for (const x of [-2, -0.5, 0, 0.3, 1, 2.5]) {
      expect(unclip(softClip(x))).toBeCloseTo(x, 9)
    }
    // As near full scale as 0.99999: +10.6 dB
    expect(toDb(unclip(1))).toBeCloseTo(10.6, 1)
    expect(unclip(-1)).toBe(-unclip(1))
    expect(Number.isFinite(unclip(5))).toBe(true)
  })

  it('measures what went into the clip', () => {
    const samples = Float32Array.from([0.5, -2, 1.5, 0].map(softClip))
    const out = { peak: 0, rms: 0 }
    unclippedLevels(samples, out)
    expect(out.peak).toBeCloseTo(2, 5)
    expect(out.rms).toBeCloseTo(Math.sqrt((0.25 + 4 + 2.25) / 4), 5)
    unclippedLevels(new Float32Array(0), out)
    expect(out).toEqual({ peak: 0, rms: 0 })
  })

  it('measures a part’s own sound as it is, past full scale too', () => {
    const samples = Float32Array.from([0.5, -2, 1.5, 0])
    const out = { peak: 0, rms: 0 }
    sampleLevels(samples, out)
    expect(out.peak).toBe(2)
    expect(out.rms).toBeCloseTo(Math.sqrt((0.25 + 4 + 2.25) / 4), 5)
    sampleLevels(new Float32Array(0), out)
    expect(out).toEqual({ peak: 0, rms: 0 })
  })
})

describe('the spectrogram’s grid', () => {
  it('finds the row that holds each frequency, low notes at the bottom', () => {
    const height = 300
    const rows = spectrogramRows([100, 1000, 10000], height)
    expect(rows).toHaveLength(3)
    // Higher up for a higher note
    expect(Array.from(rows)).toEqual([...rows].sort((a, b) => b - a))
    ;[100, 1000, 10000].forEach((hz, k) => {
      // The row's span on the axis, counted from the bottom, holds it
      const c = height - 1 - (rows[k] as number)
      expect(xToHz(c, height)).toBeLessThanOrEqual(hz)
      expect(xToHz(c + 1, height)).toBeGreaterThan(hz)
    })
    // Off the axis: no row
    expect(spectrogramRows([10, 30000], height)).toHaveLength(0)
  })

  it('lightens a pixel towards white, its alpha kept', () => {
    const data = new Uint8ClampedArray([0, 100, 255, 255])
    lighten(data, 0, 0)
    expect(Array.from(data)).toEqual([0, 100, 255, 255])
    lighten(data, 0, 0.5)
    expect(Array.from(data)).toEqual([128, 178, 255, 255])
    lighten(data, 0, 1)
    expect(Array.from(data)).toEqual([255, 255, 255, 255])
  })

  it('ticks once a period of columns, without drifting', () => {
    const ticks = new Ticks()
    ticks.reset(80)
    const at: number[] = []
    for (let k = 1; k <= 400; k++) if (ticks.next()) at.push(k)
    expect(at).toEqual([80, 160, 240, 320, 400])
    // A period not whole: 2.5 columns, ticks two and three apart
    ticks.reset(2.5)
    const half: number[] = []
    for (let k = 1; k <= 10; k++) if (ticks.next()) half.push(k)
    expect(half).toEqual([3, 5, 8, 10])
  })
})

describe('the mastering tools’ readouts', () => {
  it('names a gain reduction to a tenth, and fills its meter by it', () => {
    expect(reductionText(0)).toBe('0 dB')
    expect(reductionText(-0.04)).toBe('0 dB')
    expect(reductionText(-3.24)).toBe('\u22123.2 dB')
    expect(reductionText(-18)).toBe('\u221218.0 dB')
    // Never a gain: nothing turned down
    expect(reductionText(2)).toBe('0 dB')
    expect(reductionFill(0)).toBe(0)
    expect(reductionFill(-REDUCTION_RANGE / 2)).toBe(0.5)
    expect(reductionFill(-100)).toBe(1)
    expect(reductionFill(3)).toBe(0)
  })

  it('names a loudness to a tenth, signed, a dash under the gate', () => {
    expect(lufsText(-14.04)).toBe('\u221214.0')
    expect(lufsText(-9.96)).toBe('\u221210.0')
    expect(lufsText(0.02)).toBe('0.0')
    expect(lufsText(1.5)).toBe('+1.5')
    expect(lufsText(-70)).toBe('–')
    expect(lufsText(-Infinity)).toBe('–')
    expect(lufsText(Number.NaN)).toBe('–')
  })
})
