/**
 * The cards a panel's "+" offers (an effect, an input, a chain's item):
 * the least a card is wide, CSS px, for its name and a hint of 16 letters
 * or so under it in its 88 px
 */
export const CHOICE_LEAST = 108

/** The most it is wide: a wide panel's few stay cards, not bars */
export const CHOICE_MOST = 160

/** Between two cards, across and down */
export const CHOICE_GAP = 8

/**
 * How many columns count cards stand in across width, CSS px. Up to four
 * stand in one row, however narrow (they shrink to it). More stand in as
 * few rows as the cards' least width allows, three across at the least,
 * and those rows as even as they can be: ten where seven fit stand in two
 * rows of five, not seven and three; where all fit, in one.
 */
export function choiceColumns(
  count: number,
  width: number,
  least = CHOICE_LEAST,
  gap = CHOICE_GAP
): number {
  if (count <= 4) return Math.max(count, 1)
  const fit = Math.max(3, Math.floor((width + gap) / (least + gap)))
  const rows = Math.ceil(count / fit)
  return Math.ceil(count / rows)
}

/** How wide columns of cards stand at the most, CSS px: their gaps too */
export function choicesWidth(
  columns: number,
  most = CHOICE_MOST,
  gap = CHOICE_GAP
): number {
  return columns * most + (columns - 1) * gap
}
