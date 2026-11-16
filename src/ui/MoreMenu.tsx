import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
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
} as const

/** A menu's items that can be picked, in order */
function items(menu: HTMLElement | null): HTMLButtonElement[] {
  return [
    ...(menu?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)'
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
  /** It loses something (Delete): in the danger's ink */
  readonly danger?: boolean
}

/**
 * More, a 28 px header button of three dots (a popover's, a panel's), and
 * the menu that falls from it: its items in groups, a line between two,
 * each a picture and a name on a row of 32 px, on the card every popover
 * here wears (RAISED), its right under the button's. Near the page's foot
 * it turns and stands on the button instead. A tap on an item closes the
 * menu and does what it says, within the tap (Import's file picker and
 * Export's share sheet need it). The keyboard is a menu's: the arrows walk
 * the items that can be picked, Home and End jump, Enter or Space picks,
 * Escape and Tab close it back onto the button, so the popover keeps its
 * own Escape for what it is. A tap anywhere else closes it, and so does a
 * scroll of what holds the button, which would else part them. Lit, the
 * button shows one of its items at hand under it (a name to type, a
 * deletion to confirm). The menu is put on the page itself (on a modal
 * dialog's, in one), not where the button stands: a popover's glass would
 * hold it inside.
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
  const placed = usePlacement(trigger, WANT_W, tall / 16, 'below', 'end')

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
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => pick(item)}
                    className={`flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[11px] font-semibold tracking-wider outline-none hover:bg-(--lift) focus-visible:bg-(--lift) active:bg-(--lift-2) disabled:opacity-40 ${item.danger ? 'text-(--danger-ink)' : 'text-(--ink-200)'}`}
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
                      className={`shrink-0 ${item.danger ? '' : 'text-(--ink-400)'}`}
                    >
                      <path d={item.glyph} />
                    </svg>
                    <span className="min-w-0 truncate">{item.label}</span>
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
