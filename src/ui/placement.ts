import { useLayoutEffect, useState, type RefObject } from 'react'
import { placePopover, type Placement } from '../viz/popover'

/** Between a popover and the button it opens from (gap-2) */
const GAP = 8

/**
 * Where a popover opened from anchor stands (placePopover), w by h rem as
 * it wants, within the page inside its padding (its margins, the screen's
 * safe areas), on the side it prefers (above, as the app's popovers;
 * below, as a dropdown's list): measured again whenever the button moves,
 * for what stands around it resizing (the controls put away), or the page
 * does. Undefined until measured, a frame after it opens.
 */
export function usePlacement(
  anchor: RefObject<HTMLElement | null>,
  w: number,
  h: number,
  prefer: 'above' | 'below' = 'above'
): Placement | undefined {
  const [placed, setPlaced] = useState<Placement>()
  useLayoutEffect(() => {
    const button = anchor.current
    const page = button?.closest('main')
    if (!button || !page) return
    const measure = () => {
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const style = getComputedStyle(page)
      const box = page.getBoundingClientRect()
      const next = placePopover(
        button.getBoundingClientRect(),
        {
          left: box.left + parseFloat(style.paddingLeft),
          top: box.top + parseFloat(style.paddingTop),
          right: box.right - parseFloat(style.paddingRight),
          bottom: box.bottom - parseFloat(style.paddingBottom),
        },
        { w: w * rem, h: h * rem },
        GAP,
        prefer
      )
      setPlaced((was) =>
        was &&
        was.left === next.left &&
        was.top === next.top &&
        was.width === next.width &&
        was.height === next.height
          ? was
          : next
      )
    }
    // Each box from the button out: any of them resizing can move it. An
    // observer tells of each at once, which is the first measure.
    const observer = new ResizeObserver(measure)
    for (let at: Element | null = button; at; at = at.parentElement) {
      observer.observe(at)
    }
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [anchor, w, h, prefer])
  return placed
}
