import type { Edges } from './graph'

/**
 * Where a popover stands (the presets, opened from the patch's button):
 * its box in CSS pixels from the viewport's top left, and on which side
 * of the button it opens
 */
export interface Placement {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly side: 'above' | 'below'
}

/**
 * A popover of the size it wants (w by h), placed by the button it opens
 * from (anchor) within bounds (the page inside its margins): as wide as
 * it wants or as the bounds, its left at the button's left and moved in
 * to keep within them. Above the button, gap clear of it, as tall as it
 * wants or as the room above; below it where the room above is short of
 * that and the room below is more (a button at the top of the page). Its
 * height does not follow what it holds, so a list filtered shorter moves
 * nothing. The side it prefers (above, as the app's popovers stand on
 * their buttons; below, as a dropdown's list falls from its box) is the
 * side it gets, unless it is short of what is wanted and the other has
 * more (a dropdown at the page's foot opens above).
 */
export function placePopover(
  anchor: Edges,
  bounds: Edges,
  want: { readonly w: number; readonly h: number },
  gap: number,
  prefer: 'above' | 'below' = 'above'
): Placement {
  const width = Math.max(0, Math.min(want.w, bounds.right - bounds.left))
  const left = Math.max(
    bounds.left,
    Math.min(anchor.left, bounds.right - width)
  )
  const above = Math.max(0, anchor.top - gap - bounds.top)
  const below = Math.max(0, bounds.bottom - anchor.bottom - gap)
  const first = prefer === 'below' ? below : above
  const other = prefer === 'below' ? above : below
  const side: 'above' | 'below' =
    first >= want.h || first >= other
      ? prefer
      : prefer === 'below'
        ? 'above'
        : 'below'
  const height = Math.min(want.h, side === 'above' ? above : below)
  return {
    left,
    top: side === 'above' ? anchor.top - gap - height : anchor.bottom + gap,
    width,
    height,
    side,
  }
}
