import { describe, expect, it } from 'vitest'
import { FM6_ALGORITHMS, FM6_OPS, fm6FixedHz, fm6Ratio } from '../dsp/fm6'
import {
  CHART_COLUMNS,
  CHART_ROWS,
  algorithmChart,
  fm6FrequencyText,
  opRole,
  targetsOf,
} from './fm6'

/** Algorithm n, counted from 1 as the DX7 counts them */
const alg = (n: number) => {
  const found = FM6_ALGORITHMS[n - 1]
  if (!found) throw new Error(`no algorithm ${n}`)
  return found
}

/** Where op n (from 1) stands: [column, row] */
const at = (n: number, op: number) => {
  const placed = algorithmChart(alg(n)).ops[op - 1]
  return [placed?.column, placed?.row]
}

describe('algorithmChart', () => {
  it('stands every algorithm in the chart, carriers on the bottom', () => {
    FM6_ALGORITHMS.forEach((algorithm) => {
      const chart = algorithmChart(algorithm)
      expect(chart.ops).toHaveLength(FM6_OPS)
      expect(chart.columns).toBeLessThanOrEqual(CHART_COLUMNS)
      expect(chart.rows).toBeLessThanOrEqual(CHART_ROWS)
      for (const { op, column, row } of chart.ops) {
        expect(column).toBeGreaterThanOrEqual(0)
        expect(column).toBeLessThanOrEqual(chart.columns - 1)
        expect(row === 0).toBe(algorithm.carriers.includes(op))
      }
    })
  })

  it('puts each modulator a row over what it modulates', () => {
    FM6_ALGORITHMS.forEach((algorithm) => {
      const { ops } = algorithmChart(algorithm)
      algorithm.modulators.forEach((from, target) => {
        for (const op of from) {
          expect(ops[op]?.row).toBe((ops[target]?.row ?? 0) + 1)
        }
      })
    })
  })

  it('keeps operators of a row a column apart', () => {
    FM6_ALGORITHMS.forEach((algorithm) => {
      const { ops } = algorithmChart(algorithm)
      for (const a of ops) {
        for (const b of ops) {
          if (a.op >= b.op || a.row !== b.row) continue
          expect(Math.abs(a.column - b.column)).toBeGreaterThanOrEqual(1)
        }
      }
    })
  })

  it('draws algorithm 1 as two stacks, OP1 and OP3 heard', () => {
    expect(at(1, 1)).toEqual([0, 0])
    expect(at(1, 2)).toEqual([0, 1])
    expect(at(1, 3)).toEqual([1, 0])
    expect(at(1, 6)).toEqual([1, 3])
    expect(algorithmChart(alg(1))).toMatchObject({ columns: 2, rows: 4 })
  })

  it('centres a carrier under its modulators (16) and one modulator over many (22)', () => {
    // OP1 under OP2, OP3 and OP5, side by side
    expect(at(16, 2)).toEqual([0, 1])
    expect(at(16, 3)).toEqual([1, 1])
    expect(at(16, 5)).toEqual([2, 1])
    expect(at(16, 1)).toEqual([1, 0])
    // OP6 over OP3, OP4 and OP5
    expect(at(22, 6)).toEqual([2, 1])
    // OP3 over OP1 and OP2, OP4 under OP5 and OP6
    expect(at(20, 3)).toEqual([0.5, 1])
    expect(at(20, 4)).toEqual([2.5, 0])
  })

  it('spreads algorithm 32 across all six', () => {
    expect(algorithmChart(alg(32))).toMatchObject({ columns: 6, rows: 1 })
  })
})

describe('targetsOf and opRole', () => {
  it('says what each operator does', () => {
    expect(targetsOf(alg(22), 5)).toEqual([2, 3, 4])
    expect(opRole(alg(1), 0)).toBe('Out')
    expect(opRole(alg(1), 1)).toBe('→ 1')
    expect(opRole(alg(1), 5)).toBe('→ 5 · Fb')
    expect(opRole(alg(22), 5)).toBe('→ 3 4 5 · Fb')
    expect(opRole(alg(22), 5, true)).toBe('→345')
    expect(opRole(alg(1), 0, true)).toBe('Out')
    // Algorithm 4's loop starts from OP4, back to OP6
    expect(opRole(alg(4), 3)).toBe('Out · Fb')
  })
})

describe('an operator’s frequency', () => {
  it('reads a ratio as the DX7 does', () => {
    expect(fm6Ratio(1, 0)).toBe(1)
    expect(fm6Ratio(0, 0)).toBe(0.5)
    expect(fm6Ratio(1, 41)).toBeCloseTo(1.41)
    expect(fm6Ratio(14, 0)).toBeCloseTo(14, 2)
    expect(fm6FrequencyText(false, 1, 41)).toEqual({ value: '×1.41', unit: '' })
    expect(fm6FrequencyText(false, 0, 0).value).toBe('×0.50')
  })

  it('reads a fixed frequency in Hz, from 1 to 9772', () => {
    expect(fm6FixedHz(0, 0)).toBe(1)
    expect(fm6FixedHz(2, 0)).toBe(100)
    expect(fm6FixedHz(4, 0)).toBe(1)
    expect(fm6FixedHz(3, 99)).toBeCloseTo(9772.4, 0)
    expect(fm6FrequencyText(true, 0, 0)).toEqual({ value: '1.00', unit: 'Hz' })
    expect(fm6FrequencyText(true, 1, 50).value).toBe('31.6')
    expect(fm6FrequencyText(true, 2, 64).value).toBe('437')
    expect(fm6FrequencyText(true, 3, 11)).toEqual({
      value: '1.29',
      unit: 'kHz',
    })
  })
})
