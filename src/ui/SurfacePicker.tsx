import type { ReactNode, RefObject } from 'react'
import {
  SCALES,
  scaleName,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'
import { pitchName } from '../viz/keyboard'
import { OPTION, OPTION_CELL, SECTION_HEADING } from './controls'
import { Popover } from './Popover'
import { SurfaceIcon } from './SurfaceButton'

const KINDS: readonly { kind: SurfaceKind; label: string }[] = [
  { kind: 'keys', label: 'Keys' },
  { kind: 'pads', label: 'Pads' },
  { kind: 'xy', label: 'XY' },
]

/**
 * A surface's option, three to a row: as wide as its cell, its picture and
 * its name close together
 */
const SURFACE =
  'flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] bg-(--lift) px-1 text-xs font-semibold tracking-wider whitespace-nowrap text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)'

/** C to B, as semitones above C */
const ROOTS = Array.from({ length: 12 }, (_, semitone) => semitone)

/** The popover's width, in rem, where the page has room for it */
const WANT_W = 24

/**
 * What notes are played on, keys, pads or the XY pad, whether the mod
 * wheel stands beside them, and the key the pads play in: a root and a
 * scale. Given kit, the track picked is a kit: its pads, and no more.
 * The step sequencer is the editor's Seq tab (SeqView), no longer a
 * surface here (ashon, 2026-11-15). A popover
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
  /** The track picked is a kit: its pads */
  kit: boolean
  /** The button it opens from, which places it */
  anchor: RefObject<HTMLElement | null>
  onChange: (settings: SurfaceSettings) => void
  onClose: () => void
}) {
  const set = (change: Partial<SurfaceSettings>) =>
    onChange({ ...settings, ...change })

  const { kind, root, scale, wheel } = settings
  /** The surface a finger plays: a kit's is its pads */
  const played = kit ? 'pads' : kind
  const playing = kit
    ? 'The kit’s pads'
    : kind === 'pads'
      ? `Pads in ${pitchName(root)} ${scaleName(scale)}`
      : kind === 'xy'
        ? 'The XY pad'
        : 'Every note'

  return (
    <Popover
      id="surface"
      anchor={anchor}
      width={WANT_W}
      chip={<SurfaceIcon kind={played} size={14} />}
      title="Play on"
      note={playing}
      closeLabel="Close play surface"
      onClose={onClose}
      bodyClassName="gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <div
          role="group"
          aria-label="Surface"
          className="grid grid-cols-3 gap-1.5"
        >
          {kit ? (
            <button type="button" aria-pressed className={SURFACE}>
              <SurfaceIcon kind="pads" />
              Pads
            </button>
          ) : (
            KINDS.map((each) => (
              <button
                key={each.kind}
                type="button"
                aria-pressed={kind === each.kind}
                onClick={() => set({ kind: each.kind })}
                className={SURFACE}
              >
                <SurfaceIcon kind={each.kind} />
                {each.label}
              </button>
            ))
          )}
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

      {!kit && kind === 'keys' && (
        <p className="px-1 text-[13px] leading-snug text-(--ink-500)">
          Keys play every note. Pads play the notes of one key: choose Pads,
          then its root and scale.
        </p>
      )}
      {!kit && kind === 'xy' && (
        <p className="px-1 text-[13px] leading-snug text-(--ink-500)">
          XY plays a note under each finger: across, its pitch, gliding with no
          steps between the lines; up, its Slide, for what a route from Slide
          moves.
        </p>
      )}
      {!kit && kind === 'pads' && (
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
    </Popover>
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
      <h3 id={id} className={`px-1 ${SECTION_HEADING}`}>
        {label}
      </h3>
      {children}
    </div>
  )
}
