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
import { neutralLook } from './editor'
import { SmallIconButton } from './IconButton'
import { usePlacement } from './placement'
import { SurfaceIcon } from './SurfaceButton'

const KINDS: readonly { kind: SurfaceKind; label: string }[] = [
  { kind: 'keys', label: 'Keys' },
  { kind: 'pads', label: 'Pads' },
  { kind: 'xy', label: 'XY' },
]

/**
 * A surface's option, four to a row: as wide as its cell, its picture and
 * its name close together
 */
const SURFACE =
  'flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] bg-(--lift) px-1 text-xs font-semibold tracking-wider whitespace-nowrap text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)'

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
 * What notes are played on, keys, pads or the XY pad, or put in on the
 * step sequencer (Seq, which keeps the surface it took the place of for
 * when it is left again), whether the mod wheel stands beside them (not
 * asked on Seq, which has none), and the key the pads play in: a root
 * and a scale. Given kit, the track picked is a kit: its pads or the
 * sequencer, and no more. A popover
 * from the surface's button (anchor), as the presets are from the
 * patch's (PresetBrowser): above it (below it, the controls put away),
 * the page left as it is around it, so a key can be tried on the pads
 * while it is chosen. It looks as the presets do, on the same glass: a
 * chip and a name over its choices, 10 px in from its edges, the choices
 * 44 px for the finger: the surfaces in one row, each as wide as the
 * next, the mod wheel the whole row, the scales three to a row (the
 * roots six, two to one of their columns). It stands as tall as they are
 * (the pads' key takes more than the keys' line of help), up to the room
 * the page has, past which they scroll.
 */
export function SurfacePicker({
  settings,
  kit,
  anchor,
  onChange,
  onClose,
}: {
  settings: SurfaceSettings
  /** The track picked is a kit: its pads, or the sequencer */
  kit: boolean
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

  const { kind, root, scale, wheel, seq } = settings
  /** The surface a finger plays, the sequencer aside: a kit's is its pads */
  const played = kit ? 'pads' : kind
  const playing = seq
    ? 'Steps of the loop'
    : kit
      ? 'The kit’s pads'
      : kind === 'pads'
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
          className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px] text-(--ink-200)"
          style={{
            background: 'var(--tile)',
            boxShadow: `inset 0 0 0 1.5px ${neutralLook().ring}`,
          }}
        >
          <SurfaceIcon kind={seq ? 'seq' : played} size={14} />
        </span>
        <h2
          id="surface-heading"
          className="shrink-0 text-sm font-semibold whitespace-nowrap text-(--ink-100)"
        >
          Play on
        </h2>
        <span className="min-w-0 truncate text-[11px] text-(--ink-400)">
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
              className={`grid gap-1.5 ${kit ? 'grid-cols-2' : 'grid-cols-4'}`}
            >
              {kit ? (
                <button
                  type="button"
                  aria-pressed={!seq}
                  onClick={() => set({ seq: false })}
                  className={SURFACE}
                >
                  <SurfaceIcon kind="pads" />
                  Pads
                </button>
              ) : (
                KINDS.map((each) => (
                  <button
                    key={each.kind}
                    type="button"
                    aria-pressed={!seq && kind === each.kind}
                    onClick={() => set({ kind: each.kind, seq: false })}
                    className={SURFACE}
                  >
                    <SurfaceIcon kind={each.kind} />
                    {each.label}
                  </button>
                ))
              )}
              <button
                type="button"
                aria-pressed={seq}
                onClick={() => set({ seq: true })}
                className={SURFACE}
              >
                <SurfaceIcon kind="seq" />
                Seq
              </button>
            </div>
            {!seq && (
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
            )}
          </div>

          {seq && (
            <p className="px-1 text-[13px] leading-snug text-(--ink-500)">
              Seq puts notes on the steps of this track’s loop: tap a step for a
              note, tap a note to take it away. Drag up or down from a note for
              how hard it plays{kit ? '' : ', sideways for how long'}.
            </p>
          )}
          {!seq && !kit && kind === 'keys' && (
            <p className="px-1 text-[13px] leading-snug text-(--ink-500)">
              Keys play every note. Pads play the notes of one key: choose Pads,
              then its root and scale.
            </p>
          )}
          {!seq && !kit && kind === 'xy' && (
            <p className="px-1 text-[13px] leading-snug text-(--ink-500)">
              XY plays a note under each finger: across, its pitch, gliding with
              no steps between the lines; up, its Slide, for what a route from
              Slide moves.
            </p>
          )}
          {!seq && !kit && kind === 'pads' && (
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
        className="px-1 text-[11px] font-medium tracking-widest text-(--ink-500) uppercase"
      >
        {label}
      </h3>
      {children}
    </div>
  )
}
