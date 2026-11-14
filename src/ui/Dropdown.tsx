import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { RAISED, TALL_HIT } from './controls'
import { usePlacement } from './placement'

/** The list's want, rem wide: a name, its dots and the check */
const WANT_W = 11
/** A row: 28 px, the gap under it 2 px */
const ROW = (28 + 2) / 16
/** Around the rows: the card's padding, 4 px each side — tight, not a dialog */
const AROUND = 8 / 16

/** Colour dots before a name: what the themes give their options */
function Dots({ colours }: { colours: readonly string[] }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-0.5">
      {colours.map((colour) => (
        <span
          key={colour}
          className="size-2 rounded-full"
          style={{ background: colour }}
        />
      ))}
    </span>
  )
}

/**
 * The app's own choice from a list, in the browser's select's place: its
 * look and colours are this app's, not the operating system's. The button
 * reads as a select (28 px, the chevron, the chosen one's name and dots)
 * and the list falls below it, as a select's does, on the card every
 * popover here wears (usePlacement, RAISED): the chosen one lit with the
 * accent's check, the rest waiting. Near the page's foot it turns and
 * stands on the button instead. The keyboard is the select's — the arrows
 * walk the list, Home and End
 * jump, Enter or Space picks (the rows are buttons), Escape closes back
 * onto the button and stops there, so a dialog this stands in keeps its
 * own Escape for what it is. A tap anywhere else closes it, and so does a
 * scroll of what holds the button, which would else part them.
 */
export function Dropdown<T extends string | number>({
  labelId,
  hintId,
  options,
  value,
  onChange,
}: {
  /** The row's name, which both button and list are read by */
  labelId: string
  /** The row's hint, when it has one */
  hintId?: string
  options: readonly {
    value: T
    label: string
    /** The theme's colours, as dots before the name */
    readonly swatch?: readonly string[]
  }[]
  value: T
  onChange: (value: T) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const placed = usePlacement(
    trigger,
    WANT_W,
    options.length * ROW + AROUND,
    'below'
  )
  const chosen = options.find((option) => option.value === value)

  // Opened, the chosen row has the focus: the arrows walk from there
  useLayoutEffect(() => {
    if (!open) return
    const rows =
      list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
    if (!rows || rows.length === 0) return
    const at = options.findIndex((option) => option.value === value)
    rows[at < 0 ? 0 : at]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // A tap elsewhere closes it; a scroll of what holds the button parts
  // button and list (the list stands fixed), so that closes it too
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      const at = event.target as Node
      if (!list.current?.contains(at) && !trigger.current?.contains(at)) {
        setOpen(false)
      }
    }
    const scrolled = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('scroll', scrolled, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('scroll', scrolled, true)
    }
  }, [open])

  const pick = (next: T) => {
    setOpen(false)
    trigger.current?.focus()
    onChange(next)
  }

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>(
        '[role="option"]'
      ) ?? []),
    ]
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    const go = (to: number) => rows[(to + rows.length) % rows.length]?.focus()
    if (event.key === 'ArrowDown') go(at + 1)
    else if (event.key === 'ArrowUp') go(at - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(-1)
    else if (event.key === 'Escape') {
      // The dialog behind keeps its Escape (Back, the cross)
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
      return
    } else return
    event.preventDefault()
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => setOpen((was) => !was)}
        className={`group flex h-7 min-w-28 items-center gap-1.5 rounded-md bg-(--over)/8 py-0 pr-2 pl-2.5 text-[11px] font-semibold text-(--ink-200) outline-none ${TALL_HIT} hover:bg-(--lift-2) focus-visible:bg-(--lift-2) aria-expanded:bg-(--lift-2)`}
      >
        {chosen?.swatch && <Dots colours={chosen.swatch} />}
        <span className="min-w-0 truncate">{chosen?.label ?? '—'}</span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`ml-auto shrink-0 text-(--ink-500) transition-transform duration-150 group-aria-expanded:rotate-180`}
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={labelId}
          aria-describedby={hintId}
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
          className={`fixed z-30 flex flex-col gap-0.5 p-1 ${RAISED} ${placed ? '' : 'invisible'}`}
        >
          {options.map((option) => (
            <button
              key={`${option.value}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => pick(option.value)}
              className={`flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-[11px] font-semibold text-(--ink-400) outline-none hover:bg-(--lift) focus-visible:bg-(--lift) aria-selected:bg-(--lift-2) aria-selected:text-(--ink-100)`}
            >
              {option.swatch && <Dots colours={option.swatch} />}
              <span className="min-w-0 truncate">{option.label}</span>
              {option.value === value && (
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
                  className="ml-auto shrink-0 text-(--accent)"
                >
                  <path d="M2.5 7.5l3 3 6-6.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
