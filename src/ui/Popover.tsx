import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { RAISED } from './controls'
import { neutralLook } from './editor'
import { SmallIconButton } from './IconButton'
import { usePlacement } from './placement'

/** Around a measured popover's content, in CSS px: the header, a gap, p-2.5 */
const AROUND = 28 + 8 + 2 * 10

/** The cross that closes a popover, in an 18 px box */
const CROSS = 'M5 5l8 8M13 5l-8 8'

/**
 * A popover standing on the button it opens from (anchor): above it as
 * the app's popovers stand, below where the room above is short (a
 * button on the tab rail), placed by usePlacement a frame after it opens
 * and unseen until then. A panel's header first: its chip (what the
 * popover is about, small, on a tile's face), its name, a note on what
 * it shows, and at its right its actions and the cross that closes it.
 * Escape closes it, or backs out of what onEscape says first (a form).
 * A tap outside closes it too (the page's, App.tsx).
 *
 * Given height (rem), it stands that tall and its content lays itself
 * out under the header (a list that scrolls, a form). Without, it is as
 * tall as its content, measured as that changes, up to the room the
 * page has, past which it scrolls; the content is a column of
 * bodyClassName's gaps.
 */
export function Popover({
  id,
  anchor,
  width,
  height,
  chip,
  title,
  note,
  actions,
  closeLabel,
  onClose,
  onEscape,
  onPlaced,
  bodyClassName = 'gap-2',
  children,
}: {
  /** Its element's id (the buttons' aria-controls), its heading's after it */
  id: string
  anchor: RefObject<HTMLElement | null>
  /** As wide as it wants to be, in rem */
  width: number
  /** As tall, in rem: measured from its content where not given */
  height?: number
  chip: ReactNode
  title: string
  note?: ReactNode
  /** In the header, before the cross */
  actions?: ReactNode
  /** The cross's name, for a screen reader */
  closeLabel: string
  onClose: () => void
  /** What Escape does, if not closing it */
  onEscape?: () => void
  /** Told once it is placed, before it is seen: its list has a size */
  onPlaced?: () => void
  bodyClassName?: string
  children: ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  // As tall as its content is, measured as it changes: a rem to start
  const [measured, setMeasured] = useState(1)
  const placed = usePlacement(anchor, width, height ?? measured)
  useLayoutEffect(() => {
    const content = contentRef.current
    if (height !== undefined || !content) return
    const measure = () => {
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const next = (content.offsetHeight + AROUND) / rem
      setMeasured((was) => (Math.abs(was - next) < 0.01 ? was : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [height])

  const shown = placed !== undefined
  useLayoutEffect(() => {
    if (shown) onPlaced?.()
    // Once, as it is first placed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  const escape = onEscape ?? onClose
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escape()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [escape])

  const heading = `${id}-heading`
  return (
    <section
      id={id}
      aria-labelledby={heading}
      // Unseen until placed, a frame after it opens
      style={
        placed && {
          left: placed.left,
          top: placed.top,
          width: placed.width,
          height: placed.height,
        }
      }
      className={`fixed z-10 flex flex-col gap-2 p-2.5 ${RAISED} ${placed ? '' : 'invisible'}`}
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        <PopoverChip>{chip}</PopoverChip>
        <h2
          id={heading}
          className="shrink-0 text-sm font-semibold whitespace-nowrap text-(--ink-100)"
        >
          {title}
        </h2>
        {note !== undefined && (
          <span className="min-w-0 truncate text-[11px] text-(--ink-400)">
            {note}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          <SmallIconButton
            label={closeLabel}
            onClick={onClose}
            path={CROSS}
            className={actions === undefined ? '' : 'ml-1'}
          />
        </span>
      </div>
      {height !== undefined ? (
        children
      ) : (
        <div className="-mx-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5">
          <div ref={contentRef} className={`flex flex-col ${bodyClassName}`}>
            {children}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * What a popover is about, small, on a tile's face with a tile's ring, as
 * a panel's header has it: an icon of 14 px, or a figure
 */
function PopoverChip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px] font-mono text-[11px] font-semibold text-(--ink-200)"
      style={{
        background: 'var(--tile)',
        boxShadow: `inset 0 0 0 1.5px ${neutralLook().ring}`,
      }}
    >
      {children}
    </span>
  )
}
