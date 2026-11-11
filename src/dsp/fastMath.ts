/**
 * Cheaper stand-ins for the Math functions the voices call per sample,
 * close enough to be inaudible: Math.tanh and Math.sin cost several times
 * a few multiplications, and a voice can call them a dozen times a sample.
 */

/**
 * Where tanhApprox reaches 1: past it the rational function would rise
 * above 1, so it holds there. tanh is within 1e-4 of 1 by then.
 */
const TANH_EDGE = 4.9718

/**
 * tanh(x) within 1e-4 everywhere (far closer near 0): the [7/6] Padé
 * approximant, Lambert's continued fraction cut short, held at ±1 past
 * ±TANH_EDGE. Odd, rising, within [-1, 1]; NaN stays NaN.
 */
export function tanhApprox(x: number): number {
  if (x > TANH_EDGE) return 1
  if (x < -TANH_EDGE) return -1
  const x2 = x * x
  return (
    (x * (135135 + x2 * (17325 + x2 * (378 + x2)))) /
    (135135 + x2 * (62370 + x2 * (3150 + 28 * x2)))
  )
}

/**
 * sin(2π·t), t in cycles, within 1e-9: folded onto a quarter cycle
 * (sin is odd and mirrors about a quarter), then its Taylor series to
 * the 13th power. About a third of Math.sin's time. Any finite t;
 * NaN stays NaN.
 */
export function sinCycles(t: number): number {
  let u = t - Math.floor(t)
  u = u < 0.5 ? u : u - 1
  if (u > 0.25) u = 0.5 - u
  else if (u < -0.25) u = -0.5 - u
  const x = 2 * Math.PI * u
  const x2 = x * x
  return (
    x *
    (1 -
      (x2 / 6) *
        (1 -
          (x2 / 20) *
            (1 -
              (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - x2 / 156))))))
  )
}
