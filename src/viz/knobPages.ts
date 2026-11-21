/** Between two columns of a panel's knobs, CSS px (gap-x-1) */
export const KNOB_GAP = 4

/** What a knob's column wants beside its face, CSS px: its name's room */
export const KNOB_SPARE = 16

/**
 * How many cells a row holds however narrow: eight (a strip's fader and
 * four sends, its Mute and Solo and its views), the knobs a little smaller
 */
export const KNOBS_LEAST = 8

/**
 * How many of a panel's cells (a knob, a route's button, a view's) stand
 * in one row width CSS px across, its knobs knob px wide: as many as get
 * their face and a little room for their names, and never fewer than
 * KNOBS_LEAST
 */
export function knobsFit(width: number, knob: number): number {
  const each = knob + KNOB_SPARE + KNOB_GAP
  return Math.max(KNOBS_LEAST, Math.floor((width + KNOB_GAP) / each))
}

/** One of a panel's pages: a run of one section's cells */
export interface KnobPage {
  /** Which of the sections its cells are of */
  readonly section: number
  /** Its first cell, of the section's, and the one after its last */
  readonly from: number
  readonly to: number
}

/**
 * A panel's sections (a part's knobs, and a group of its own: the Amp's
 * ghost notes), each its cells' widths (a cell or two: the loudness),
 * in pages where fit a row holds. None where every cell stands in one
 * row. Else a page for each section, and one too wide for a row split in
 * as few pages as hold it, as even as can be: nine where eight fit are
 * five and four.
 */
export function knobPages(
  sections: readonly (readonly number[])[],
  fit: number
): KnobPage[] | undefined {
  const sum = (cells: readonly number[]) =>
    cells.reduce((total, width) => total + width, 0)
  if (sum(sections.flat()) <= fit) return undefined
  const pages: KnobPage[] = []
  sections.forEach((cells, section) => {
    const total = sum(cells)
    if (total === 0) return
    const count = Math.ceil(total / fit)
    let from = 0
    let used = 0
    for (let page = 1; page <= count; page++) {
      const until = page === count ? total : Math.round((total * page) / count)
      let to = from
      while (to < cells.length && used + (cells[to] ?? 0) <= until) {
        used += cells[to] ?? 0
        to++
      }
      // A cell wider than its share still goes somewhere
      if (to === from && to < cells.length) used += cells[to++] ?? 0
      if (to > from) pages.push({ section, from, to })
      from = to
    }
  })
  return pages
}
