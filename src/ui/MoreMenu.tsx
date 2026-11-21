import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { RAISED, SMALL_ICON_BUTTON } from './controls'
import { usePlacement } from './placement'

/** Three dots in an 18 px box: what More shows */
const DOTS = 'M4 9h.01M9 9h.01M14 9h.01'

/** The menu's want, rem wide: a picture, a name as long as Rename…'s */
const WANT_W = 10

/** In CSS px: a row, the gap between two, the card's padding, a line */
const ROW = 32
const GAP = 2
const AROUND = 2 * 4
const LINE = 1 + 2 * 2

/** What a menu's items picture, each a path on a 14 px square */
export const MENU_GLYPHS = {
  /** A plus */
  new: 'M7 2.5v9M2.5 7h9',
  /** A pencil, its point at the bottom left */
  rename:
    'M2.5 11.5l.6-2.6 6.2-6.2a1.35 1.35 0 0 1 1.9 1.9L5 10.8zM8.3 3.7l1.9 1.9',
  /** An arrow up out of a tray */
  export: 'M7 8.5v-6M4.5 5L7 2.5 9.5 5M2.5 8v3.5h9V8',
  /** An arrow down into one */
  import: 'M7 2.5v6M4.5 6L7 8.5 9.5 6M2.5 8v3.5h9V8',
  /** A bin and its lid */
  delete: 'M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.6 7.5h5.8l.6-7.5',
  /** Two sheets, one over the other: a copy */
  copy: 'M5 5h6.5v6.5H5zM2.5 9V2.5H9',
  /** Chevrons: a move left, a move right */
  left: 'M8.5 3.5L5 7l3.5 3.5',
  right: 'M5.5 3.5L9 7l-3.5 3.5',
  /** A round, its arrow at its top: a loop */
  loop: 'M11.5 7a4.5 4.5 0 1 1-1.32-3.18M10.5 1.5v2.5H8',
  /** A level line: nothing played, silence */
  silent: 'M3 7h8',
} as const

/** The tick a menu's item picked shows at its right */
const TICK = 'M2.5 7.5l3 3 6-6.5'

/** A menu's items that can be picked, in order */
function items(menu: HTMLElement | null): HTMLButtonElement[] {
  return [
    ...(menu?.querySelectorAll<HTMLButtonElement>(
      '[role^="menuitem"]:not(:disabled)'
    ) ?? []),
  ]
}

/** One of a menu's items: a picture and a name, and what it does */
export interface MenuItem {
  readonly label: string
  /** A path on a 14 px square (MENU_GLYPHS) */
  readonly glyph: string
  readonly onSelect: () => void
  readonly disabled?: boolean
  /**
   * It loses something (Delete): told by its glyph, in the others' grey
   * (red is recording's: theme.ts)
   */
  readonly danger?: boolean
  /**
   * One of a choice (a radio's), picked or not: a tick at its right where
   * it is the one picked
   */
  readonly checked?: boolean
  /** What it holds, dim at its right: 2 bars · Verse */
  readonly detail?: string
}

/**
 * More, a 28 px header button of three dots (a popover's, a panel's), and
 * the menu that falls from it (MenuButton's): its items in groups, a line
 * between two, each a picture and a name on a row of 32 px, on the card
 * every popover here wears (RAISED), its right under the button's. Near
 * the page's foot it turns and stands on the button instead. A tap on an
 * item closes the menu and does what it says, within the tap (Import's
 * file picker and Export's share sheet need it). The keyboard is a
 * menu's: the arrows walk the items that can be picked, Home and End
 * jump, Enter or Space picks, Escape and Tab close it back onto the
 * button, so the popover keeps its own Escape for what it is. A tap
 * anywhere else closes it, and so does a scroll of what holds the button,
 * which would else part them. Lit, the button shows one of its items at
 * hand under it (a name to type, a deletion to confirm). The menu is put
 * on the page itself (on a modal dialog's, in one), not where the button
 * stands: a popover's glass would hold it inside.
 *
 * @category Overlays
 */
export function MoreMenu({
  groups,
  label = 'More',
  lit = false,
}: {
  /** The items, in groups; one empty is left out, and its line */
  groups: readonly (readonly MenuItem[])[]
  label?: string
  lit?: boolean
}) {
  return (
    <MenuButton
      groups={groups}
      label={label}
      lit={lit}
      className={`${SMALL_ICON_BUTTON} aria-expanded:bg-(--lift-2) data-lit:bg-(--lift-2)`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={DOTS} />
      </svg>
    </MenuButton>
  )
}

/**
 * A button of its own (its face and what it shows: a loop's letter) and
 * the menu that falls from it, as More's does: an item one of a choice
 * shows a tick where it is the one picked, and an item may say what it
 * holds, dim at its right. Under the button its right edge, or (start)
 * its left; as wide as asked, in rem, within the page.
 *
 * @category Overlays
 */
export function MenuButton({
  groups,
  label,
  lit = false,
  className,
  width = WANT_W,
  align = 'end',
  children,
}: {
  /** The items, in groups; one empty is left out, and its line */
  groups: readonly (readonly MenuItem[])[]
  /** The button's name for a screen reader */
  label: string
  lit?: boolean
  /** The button's face */
  className: string
  /** The menu's want, rem wide */
  width?: number
  /** Which of the button's edges the menu's stands under */
  align?: 'start' | 'end'
  /** What the button shows */
  children: ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  /** Where the menu is put while open: the page, or a modal dialog */
  const [host, setHost] = useState<Element>()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const shown = groups.filter((group) => group.length > 0)
  const rows = shown.reduce((sum, group) => sum + group.length, 0)
  const lines = Math.max(0, shown.length - 1)
  const tall = AROUND + rows * ROW + lines * LINE + (rows + lines - 1) * GAP
  const placed = usePlacement(trigger, width, tall / 16, 'below', align)

  // Placed (and so seen), the first item has the focus: the arrows walk
  // from there
  const ready = open && placed !== undefined
  useLayoutEffect(() => {
    if (ready) items(menu.current)[0]?.focus()
  }, [ready])

  // A tap elsewhere closes it; a scroll of what holds the button parts
  // button and menu (the menu stands fixed), so that closes it too
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      const at = event.target as Node
      if (!menu.current?.contains(at) && !trigger.current?.contains(at)) {
        setOpen(false)
      }
    }
    const scrolled = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('scroll', scrolled, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('scroll', scrolled, true)
    }
  }, [open])

  const show = () => {
    setHost(trigger.current?.closest('dialog') ?? document.body)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const pick = (item: MenuItem) => {
    close()
    item.onSelect()
  }

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = items(menu.current)
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    const go = (to: number) => all[(to + all.length) % all.length]?.focus()
    if (event.key === 'ArrowDown') go(at + 1)
    else if (event.key === 'ArrowUp') go(at - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(-1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      // The popover behind keeps its Escape (a form backed out of, the
      // cross)
      event.stopPropagation()
      close()
    } else return
    event.preventDefault()
  }

  return (
    <>
      <button
        ref={trigger}
        id={`${id}-button`}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        data-lit={lit || undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || open) return
          event.preventDefault()
          show()
        }}
        className={className}
      >
        {children}
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-labelledby={`${id}-button`}
            onKeyDown={keys}
            // Unseen until placed, a frame after it opens
            style={
              placed && {
                left: placed.left,
                top: placed.top,
                width: placed.width,
                height: placed.height,
              }
            }
            className={`fixed z-40 flex flex-col gap-0.5 overflow-y-auto overscroll-contain p-1 ${RAISED} ${placed ? '' : 'invisible'}`}
          >
            {shown.map((group, at) => (
              <Fragment key={group.map((item) => item.label).join()}>
                {at > 0 && (
                  <div
                    role="separator"
                    className="mx-2 my-0.5 h-px shrink-0 bg-(--lift-2)"
                  />
                )}
                {group.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role={
                      item.checked === undefined ? 'menuitem' : 'menuitemradio'
                    }
                    aria-checked={item.checked}
                    disabled={item.disabled}
                    onClick={() => pick(item)}
                    className={`flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[11px] font-semibold tracking-wider outline-none hover:bg-(--lift) focus-visible:bg-(--lift) active:bg-(--lift-2) disabled:opacity-40 text-(--ink-200)`}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0 text-(--ink-400)"
                    >
                      <path d={item.glyph} />
                    </svg>
                    <span className="min-w-0 shrink-0 truncate">
                      {item.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-right font-mono font-normal tracking-normal text-(--ink-500)">
                      {item.detail}
                    </span>
                    {item.checked !== undefined && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className={`shrink-0 text-(--secondary) ${item.checked ? '' : 'invisible'}`}
                      >
                        <path d={TICK} />
                      </svg>
                    )}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>,
          host
        )}
    </>
  )
}
