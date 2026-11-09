/**
 * Index of the first rising zero crossing in samples[from..to): the signal
 * must first be at or below -hysteresis, and the returned index is the first
 * sample after that which is >= 0. -1 when there is none.
 */
export function findRisingEdge(
  samples: Float32Array,
  from: number,
  to: number,
  hysteresis: number
): number {
  const until = to < samples.length ? to : samples.length
  let armed = false
  for (let i = from > 0 ? from : 0; i < until; i++) {
    const v = samples[i] as number
    if (armed) {
      if (v >= 0) return i
    } else if (v <= -hysteresis) {
      armed = true
    }
  }
  return -1
}

/**
 * Where a rising edge from findRisingEdge crosses zero between its two
 * samples, read off the straight line through samples[edge - 1] and
 * samples[edge]: 0 is at edge - 1, 1 is at edge. A pair that does not rise
 * puts the crossing at edge (1).
 */
export function crossingFraction(samples: Float32Array, edge: number): number {
  if (!Number.isInteger(edge) || edge < 1 || edge >= samples.length) {
    throw new RangeError(`no sample pair ends at ${edge} of ${samples.length}`)
  }
  const before = samples[edge - 1] as number
  const after = samples[edge] as number
  if (!(after > before)) return 1
  const t = -before / (after - before)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Splits samples[start..start+length) into `columns` consecutive ranges and
 * writes each range's minimum and maximum into outMin[c] and outMax[c].
 * Column c covers floor(c*length/columns) .. floor((c+1)*length/columns)
 * (relative to start), so every sample belongs to exactly one column.
 */
export function minMaxColumns(
  samples: Float32Array,
  start: number,
  length: number,
  columns: number,
  outMin: Float32Array,
  outMax: Float32Array
): void {
  if (
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > length ||
    columns > outMin.length ||
    columns > outMax.length ||
    start < 0 ||
    start + length > samples.length
  ) {
    throw new RangeError(
      `cannot split ${samples.length} samples from ${start} into ${columns}`
    )
  }
  for (let c = 0; c < columns; c++) {
    const begin = start + Math.floor((c * length) / columns)
    const stop = start + Math.floor(((c + 1) * length) / columns)
    let min = Infinity
    let max = -Infinity
    for (let i = begin; i < stop; i++) {
      const v = samples[i] as number
      if (v < min) min = v
      if (v > max) max = v
    }
    outMin[c] = min
    outMax[c] = max
  }
}

/** True when every sample in samples[start..end) has |v| <= threshold */
export function isSilent(
  samples: Float32Array,
  threshold: number,
  start = 0,
  end = samples.length
): boolean {
  const from = start > 0 ? start : 0
  const until = end < samples.length ? end : samples.length
  for (let i = from; i < until; i++) {
    if (Math.abs(samples[i] as number) > threshold) return false
  }
  return true
}
