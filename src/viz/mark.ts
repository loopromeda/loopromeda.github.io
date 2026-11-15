/**
 * The app's mark, as the icons, the favicon and the splash draw it: an
 * infinity leaning at 45 degrees (a loop, and an 8 tipped over), its loops
 * two rounded squares meeting corner to corner in the middle, up and to
 * the right of each other, drawn as one stroke that crosses itself there,
 * the upright strand over the level one (a gap of the ground either side
 * of it), its ink shading along the diagonal from its upper end to its
 * lower.
 *
 * Drawn on two grids: the icons' 512 units (scripts/icons.ts), and the
 * favicon's 32, where every straight edge falls on a whole unit, so that
 * at 16 and 32 px (a tab's, a high-density tab's) its strands and holes
 * stand on whole pixels instead of smearing across two (asked for by
 * ashon, 2026-11-15: "파비콘을 svg로 하자는 것은 좀 더 깔끔하게 표현하면
 * 좋겠다는 생각에서"). Pure: no imports, so scripts/icons.ts runs it in
 * Node as it is.
 */

/** A grid the mark is drawn on, in its own units */
export interface MarkGrid {
  /** The square's side */
  readonly size: number
  /** Each loop's side, along the middle of the stroke */
  readonly side: number
  /** A loop's corners' radius, along the middle of the stroke */
  readonly corner: number
  readonly stroke: number
  /** The ground left either side of the upright strand, at the crossing */
  readonly gap: number
  /** The square's own corners, where the icon is rounded */
  readonly radius: number
}

/** The icons': the mark as it stood when first drawn, on 512 units */
export const ICON_GRID: MarkGrid = {
  size: 512,
  side: 146,
  corner: 66,
  stroke: 72,
  gap: 13,
  radius: 112,
}

/**
 * The favicon's: 32 units, a pixel each at 32 px, every straight edge (the
 * strands' through the middle, the holes', the mark's reach, the gap's)
 * on an even unit, so on a whole pixel at 16 px too. Thinner and larger
 * than the icons', with wider holes, so that they stay open in a tab, and
 * a wider gap, a pixel at 16, so that the crossing still reads; its
 * corners as round as the icons' (0.45 of a side). Chosen from renders
 * at 16 and 32 px beside the icons' mark, which smears there.
 */
export const FAVICON_GRID: MarkGrid = {
  size: 32,
  side: 10,
  corner: 4.5,
  stroke: 4,
  gap: 2,
  radius: 7,
}

/** The mark's strokes on a grid, and where its shading runs */
export interface MarkPaths {
  /** The infinity, one closed stroke crossing itself in the middle */
  readonly loop: string
  readonly stroke: number
  /** The ground's stroke that cuts the level strand at the crossing */
  readonly cut: string
  readonly cutWidth: number
  /** The upright strand, drawn over the cut */
  readonly over: string
  /** The shading's ends: the upper loop's far corner, the lower's */
  readonly from: readonly [number, number]
  readonly to: readonly [number, number]
}

/** The colours the mark is drawn in */
export interface MarkInks {
  /** The ground it stands on, and the gap at its crossing */
  readonly ground: string
  /** Its upper end, and its lower */
  readonly light: string
  readonly deep: string
}

const fixed = (n: number) => n.toFixed(1)

/**
 * The mark on a grid at scale (1 fills a rounded icon; less leaves the
 * margin a launcher's mask may cut)
 */
export function markPaths(grid: MarkGrid, scale = 1): MarkPaths {
  const side = grid.side * scale
  const corner = grid.corner * scale
  const stroke = grid.stroke * scale
  const gap = grid.gap * scale
  const c = grid.size / 2
  // A quarter turn: right (clockwise) round the upper loop, left round
  // the lower, as a figure of eight goes
  const turn = (right: boolean, x: number, y: number) =>
    `A${fixed(corner)} ${fixed(corner)} 0 0 ${right ? 1 : 0} ${fixed(x)} ${fixed(y)}`
  const loop = [
    // Up the upper loop's left side from the crossing, round it, and back
    // along its foot
    `M${c} ${c}V${fixed(c - side + corner)}`,
    turn(true, c + corner, c - side),
    `H${fixed(c + side - corner)}`,
    turn(true, c + side, c - side + corner),
    `V${fixed(c - corner)}`,
    turn(true, c + side - corner, c),
    // On through the crossing along the lower loop's top, round it, and
    // up its right side to the crossing
    `H${fixed(c - side + corner)}`,
    turn(false, c - side, c + corner),
    `V${fixed(c + side - corner)}`,
    turn(false, c - side + corner, c + side),
    `H${fixed(c - corner)}`,
    turn(false, c, c + side - corner),
    'Z',
  ].join('')
  // The gap cuts only the level strand; the upright one drawn over it
  // runs further (a quarter of the stroke at least), so that no seam
  // shows where the gap ends
  const cut = stroke / 2 + gap
  const reach = Math.max(stroke, cut + stroke / 4)
  return {
    loop,
    stroke,
    cut: `M${c} ${fixed(c + cut)}V${fixed(c - cut)}`,
    cutWidth: stroke + 2 * gap,
    over: `M${c} ${fixed(c + reach)}V${fixed(c - reach)}`,
    from: [c + side, c - side],
    to: [c - side, c + side],
  }
}

/**
 * The mark as an SVG file's text: on its ground, a square rounded (a
 * favicon, a manifest's icon) or to its edges (for a platform that cuts
 * its own shape), at scale on the grid
 */
export function markSvg(
  grid: MarkGrid,
  inks: MarkInks,
  { rounded = true, scale = 1 }: { rounded?: boolean; scale?: number } = {}
): string {
  const { loop, stroke, cut, cutWidth, over, from, to } = markPaths(grid, scale)
  const { size } = grid
  const corner = rounded ? ` rx="${grid.radius}"` : ''
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}"${corner} fill="${inks.ground}"/>`,
    '<defs><linearGradient id="ink" gradientUnits="userSpaceOnUse"',
    ` x1="${fixed(from[0])}" y1="${fixed(from[1])}"`,
    ` x2="${fixed(to[0])}" y2="${fixed(to[1])}">`,
    `<stop offset="0" stop-color="${inks.light}"/>`,
    `<stop offset="1" stop-color="${inks.deep}"/>`,
    '</linearGradient></defs>',
    `<path d="${loop}" fill="none" stroke="url(#ink)"`,
    ` stroke-width="${fixed(stroke)}" stroke-linejoin="round"/>`,
    `<path d="${cut}" stroke="${inks.ground}"`,
    ` stroke-width="${fixed(cutWidth)}"/>`,
    `<path d="${over}" stroke="url(#ink)" stroke-width="${fixed(stroke)}"/>`,
    '</svg>\n',
  ].join('')
}
