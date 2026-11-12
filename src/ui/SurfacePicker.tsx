import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  SCALES,
  scaleName,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'
import { pitchName } from '../viz/keyboard'
import { OPTION, OPTION_CELL, RAISED } from './controls'
import { NEUTRAL_LOOK } from './editor'
import { SmallIconButton } from './IconButton'
import { usePlacement } from './placement'
import { SurfaceIcon } from './SurfaceButton'

const KINDS: readonly { kind: SurfaceKind; label: string }[] = [
  { kind: 'keys', label: 'Keys' },
  { kind: 'pads', label: 'Pads' },
  { kind: 'xy', label: 'XY' },
]

/** C to B, as semitones above C */
const ROOTS = Array.from({ length: 12 }, (_, semitone) => semitone)

/** The popover's width, in rem, where the page has room for it */
const WANT_W = 24
/**
 * What it stands around its choices, in CSS pixels: its header (28), the
 * gap under it (8) and its padding (10 each side)
 */
const AROUND = 28 + 8 + 2 * 10

/**
 * What notes are played on, keys, pads or the XY pad, whether the mod
 * wheel stands beside them, and the key the pads play in: a root and a
 * scale. A popover from the surface's button (anchor), as the presets
 * are from the patch's (PresetBrowser): above it (below it, the controls
 * put away), the page left as it is around it, so a key can be tried on
 * the pads while it is chosen. It looks as the presets do, on the same
 * glass: a chip and a name over its choices, 10 px in from its edges,
 * the choices 44 px for the finger, on one grid: three to a row, each as
 * wide as the next (the roots six, two to one of the others' columns),
 * the mod wheel the whole row. It stands as tall as they are (the
 * pads' key takes more than the keys' line of help), up to the room the
 * page has, past which they scroll.
 */
export function SurfacePicker({
  settings,
  anchor,
  onChange,
  onClose,
}: {
  settings: SurfaceSettings
  /** The button it opens from, which places it */
  anchor: RefObject<HTMLElement | null>
  onChange: (settings: SurfaceSettings) => void
  onClose: () => void
}) {
  const set = (change: Partial<SurfaceSettings>) =>
    onChange({ ...settings, ...change })
  const contentRef = useRef<HTMLDivElement>(null)
  // As tall as its choices are, measured as they change: a rem to start
  const [wantH, setWantH] = useState(1)
  const placed = usePlacement(anchor, WANT_W, wantH)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = () => {
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const next = (content.offsetHeight + AROUND) / rem
      setWantH((was) => (Math.abs(was - next) < 0.01 ? was : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const { kind, root, scale, wheel } = settings
  const playing =
    kind === 'pads'
      ? `Pads in ${pitchName(root)} ${scaleName(scale)}`
      : kind === 'xy'
        ? 'The XY pad'
        : 'Every note'

  return (
    <section
      id="surface"
      aria-labelledby="surface-heading"
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
      {/* As the presets' header: its chip, its name, what it plays, and
          the close at its right */}
      <div className="flex h-7 shrink-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px] text-zinc-200"
          style={{
            background: '#1c1c23',
            boxShadow: `inset 0 0 0 1.5px ${NEUTRAL_LOOK.ring}`,
          }}
        >
          <SurfaceIcon kind={kind} size={14} />
        </span>
        <h2
          id="surface-heading"
          className="shrink-0 text-sm font-semibold whitespace-nowrap text-zinc-100"
        >
          Play on
        </h2>
        <span className="min-w-0 truncate text-[11px] text-zinc-400">
          {playing}
        </span>
        <SmallIconButton
          label="Close play surface"
          onClick={onClose}
          path="M5 5l8 8M13 5l-8 8"
          className="ml-auto"
        />
      </div>

      <div className="-mx-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5">
        <div ref={contentRef} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div
              role="group"
              aria-label="Surface"
              className="grid grid-cols-3 gap-1.5"
            >
              {KINDS.map((each) => (
                <button
                  key={each.kind}
                  type="button"
                  aria-pressed={kind === each.kind}
                  onClick={() => set({ kind: each.kind })}
                  className={OPTION}
                >
                  <SurfaceIcon kind={each.kind} />
                  {each.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={wheel}
              onClick={() => set({ wheel: !wheel })}
              className={OPTION}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden
                className="shrink-0"
              >
                <rect x="6" y="2" width="6" height="14" rx="2" />
                <path d="M6 10.5h6" strokeWidth="2" />
              </svg>
              Mod wheel at the left
            </button>
          </div>

          {kind === 'keys' && (
            <p className="px-1 text-[13px] leading-snug text-zinc-500">
              Keys play every note. Pads play the notes of one key: choose Pads,
              then its root and scale.
            </p>
          )}
          {kind === 'xy' && (
            <p className="px-1 text-[13px] leading-snug text-zinc-500">
              XY plays a note under each finger: across, its pitch, gliding with
              no steps between the lines; up, its Slide, for what a route from
              Slide moves.
            </p>
          )}
          {kind === 'pads' && (
            <>
              <Choices id="surface-root" label="Root">
                <div className="grid grid-cols-6 gap-1.5">
                  {ROOTS.map((each) => (
                    <button
                      key={each}
                      type="button"
                      aria-pressed={root === each}
                      onClick={() => set({ root: each })}
                      className={OPTION_CELL}
                    >
                      {pitchName(each)}
                    </button>
                  ))}
                </div>
              </Choices>
              <Choices id="surface-scale" label="Scale">
                <div className="grid grid-cols-3 gap-1.5">
                  {SCALES.map((each) => (
                    <button
                      key={each.id}
                      type="button"
                      aria-pressed={scale === each.id}
                      onClick={() => set({ scale: each.id })}
                      className={OPTION_CELL}
                    >
                      {each.name}
                    </button>
                  ))}
                </div>
              </Choices>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/** A labelled group of options */
function Choices({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3
        id={id}
        className="px-1 text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
      >
        {label}
      </h3>
      {children}
    </div>
  )
}
