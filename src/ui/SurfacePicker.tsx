import { useEffect, type ReactNode } from 'react'
import {
  SCALES,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'
import { pitchName } from '../viz/keyboard'
import { CARD, OPTION } from './controls'
import { IconButton } from './IconButton'
import { SurfaceIcon } from './SurfaceButton'

const KINDS: readonly { kind: SurfaceKind; label: string }[] = [
  { kind: 'keys', label: 'Keys' },
  { kind: 'pads', label: 'Pads' },
]

/** C to B, as semitones above C */
const ROOTS = Array.from({ length: 12 }, (_, semitone) => semitone)

/**
 * What notes are played on, keys or pads, whether the mod wheel stands
 * beside them, and the key the pads play in: a root and a scale. Like the
 * presets it covers the waveform and the
 * controls, its buttons where theirs are, and leaves what is played on
 * below it, so a key can be tried on the pads while it is chosen.
 */
export function SurfacePicker({
  settings,
  onChange,
  onClose,
}: {
  settings: SurfaceSettings
  onChange: (settings: SurfaceSettings) => void
  onClose: () => void
}) {
  const set = (change: Partial<SurfaceSettings>) =>
    onChange({ ...settings, ...change })

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <section
      id="surface"
      aria-labelledby="surface-heading"
      className={`absolute inset-0 z-10 flex flex-col gap-2 px-3 pt-1.5 pb-3 ${CARD}`}
    >
      <div className="@container flex h-11 shrink-0 items-center justify-end gap-1.5">
        <h2
          id="surface-heading"
          className="mr-auto min-w-0 truncate px-1 text-[11px] font-medium tracking-widest text-zinc-500 uppercase @max-[17rem]:sr-only"
        >
          Play on
        </h2>
        <div role="group" aria-label="Surface" className="flex gap-1.5">
          {KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              aria-pressed={settings.kind === kind}
              onClick={() => set({ kind })}
              className={OPTION}
            >
              <SurfaceIcon kind={kind} />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={settings.wheel}
          onClick={() => set({ wheel: !settings.wheel })}
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
          {/* A phone's header keeps its picture, and drops the word */}
          <span className="@max-[21rem]:sr-only">Wheel</span>
        </button>
        <IconButton
          label="Close play surface"
          onClick={onClose}
          path="M5 5l8 8M13 5l-8 8"
        />
      </div>

      {settings.kind === 'keys' && (
        <p className="px-1 text-[13px] leading-snug text-zinc-500">
          Keys play every note. Pads play the notes of one key: choose Pads,
          then its root and scale. Wheel stands the mod wheel at their left.
        </p>
      )}
      {settings.kind === 'pads' && (
        <div className="@container -mx-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3">
          <Choices id="surface-root" label="Root">
            <div className="grid grid-cols-6 gap-1.5 @min-[34rem]:grid-cols-12">
              {ROOTS.map((root) => (
                <button
                  key={root}
                  type="button"
                  aria-pressed={settings.root === root}
                  onClick={() => set({ root })}
                  className={OPTION}
                >
                  {pitchName(root)}
                </button>
              ))}
            </div>
          </Choices>
          <Choices id="surface-scale" label="Scale">
            <div className="flex flex-wrap gap-1.5">
              {SCALES.map((scale) => (
                <button
                  key={scale.id}
                  type="button"
                  aria-pressed={settings.scale === scale.id}
                  onClick={() => set({ scale: scale.id })}
                  className={OPTION}
                >
                  {scale.name}
                </button>
              ))}
            </div>
          </Choices>
        </div>
      )}
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
