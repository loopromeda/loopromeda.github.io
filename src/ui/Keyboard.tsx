import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import type { Engine } from '../engine/engine'
import {
  BLACK_LENGTH,
  cNote,
  keyAt,
  keyboardLayout,
  noteName,
} from '../viz/keyboard'

/** The keyboard starts on C1 or higher, and its top C is C8 or lower */
const LOWEST = 1
const TOP = 8
/** Fewer octaves when a white key would be narrower than this (CSS px) */
const MIN_WHITE = 40
const MAX_OCTAVES = 3

/**
 * Computer keys (KeyboardEvent.code) and the semitones above the keyboard's
 * lowest C they play: the home row is white keys, the row above black
 */
const COMPUTER_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
}
/** Computer keys' engine ids: this minus the semitone, below any pointerId */
const COMPUTER_ID = -1000

/**
 * Who holds which note: each touch (by pointerId) and computer key holds one.
 * Lights the key elements directly, so a press never re-renders React.
 */
class Hands {
  readonly #engine: Engine
  /** The note each id holds */
  readonly #notes = new Map<number, number>()
  /** How many ids hold each note: two fingers can share a key */
  readonly #counts = new Map<number, number>()
  /** The key elements on screen, by note */
  readonly #elements = new Map<number, HTMLElement>()

  constructor(engine: Engine) {
    this.#engine = engine
  }

  holds(id: number): boolean {
    return this.#notes.has(id)
  }

  /** id plays note; an id already holding another note moves to it */
  play(id: number, note: number): void {
    const was = this.#notes.get(id)
    if (was === note) return
    if (was !== undefined) this.#light(was, -1)
    this.#notes.set(id, note)
    this.#light(note, 1)
    this.#engine.noteOn(id, note)
  }

  /** id lets go */
  stop(id: number): void {
    const was = this.#notes.get(id)
    if (was === undefined) return
    this.#notes.delete(id)
    this.#light(was, -1)
    this.#engine.noteOff(id)
  }

  /** Every computer key lets go (the window lost focus: no keyup comes) */
  stopComputerKeys(): void {
    for (const id of [...this.#notes.keys()]) {
      if (id <= COMPUTER_ID) this.stop(id)
    }
  }

  /** A key element appeared (or went: null); lit if its note is held */
  mount(note: number, element: HTMLElement | null): void {
    if (!element) {
      this.#elements.delete(note)
      return
    }
    this.#elements.set(note, element)
    this.#show(note)
  }

  #light(note: number, by: number): void {
    const count = (this.#counts.get(note) ?? 0) + by
    if (count > 0) this.#counts.set(note, count)
    else this.#counts.delete(note)
    this.#show(note)
  }

  #show(note: number): void {
    const element = this.#elements.get(note)
    if (!element) return
    if (this.#counts.has(note)) element.dataset.pressed = ''
    else delete element.dataset.pressed
  }
}

/**
 * The playing surface: as many octaves as fit at a finger's width (one on a
 * phone held upright), shifted an octave at a time. A finger that slides
 * moves its note from key to key. Touches go straight to the engine; React
 * renders only the keys, again when the octave or the width changes.
 */
export function Keyboard({ engine }: { engine: Engine }) {
  const [hands] = useState(() => new Hands(engine))
  const [start, setStart] = useState(4)
  const [octaves, setOctaves] = useState(1)
  const surfaceRef = useRef<HTMLDivElement>(null)
  /** The surface's box, measured as each touch starts */
  const boxRef = useRef<DOMRect | null>(null)
  const highest = TOP - octaves
  const first = Math.min(start, highest)
  const range = `${noteName(cNote(first))} – ${noteName(cNote(first + octaves))}`

  // As many octaves as the width allows
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      const fit = Math.floor((width / MIN_WHITE - 1) / 7)
      setOctaves(Math.min(Math.max(fit, 1), MAX_OCTAVES))
    })
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  // Computer keys, for a desktop: A to ; play, Z and X shift the octave
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.code === 'KeyZ' || event.code === 'KeyX') {
        const by = event.code === 'KeyZ' ? -1 : 1
        setStart(Math.min(Math.max(first + by, LOWEST), highest))
        return
      }
      const semitones = COMPUTER_KEYS[event.code]
      if (semitones === undefined) return
      event.preventDefault()
      hands.play(COMPUTER_ID - semitones, cNote(first) + semitones)
    }
    const up = (event: KeyboardEvent) => {
      const semitones = COMPUTER_KEYS[event.code]
      if (semitones !== undefined) hands.stop(COMPUTER_ID - semitones)
    }
    const blur = () => hands.stopComputerKeys()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [hands, first, highest])

  const noteAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current ?? event.currentTarget.getBoundingClientRect()
    return keyAt(
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
      first,
      octaves
    )
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Keep this finger's moves even when it slides off the keyboard
    event.currentTarget.setPointerCapture(event.pointerId)
    boxRef.current = event.currentTarget.getBoundingClientRect()
    hands.play(event.pointerId, noteAt(event))
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (hands.holds(event.pointerId)) hands.play(event.pointerId, noteAt(event))
  }

  // pointerup is followed by lostpointercapture; stop() ignores the second
  const up = (event: PointerEvent<HTMLDivElement>) =>
    hands.stop(event.pointerId)

  const shift = (by: number) =>
    setStart(Math.min(Math.max(first + by, LOWEST), highest))

  return (
    <section
      aria-label="Keyboard"
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <div className="flex h-11 shrink-0 items-center justify-between">
        <OctaveButton
          label="Octave down"
          disabled={first <= LOWEST}
          onClick={() => shift(-1)}
          path="M11 4l-5 5 5 5"
        />
        <span className="font-mono text-[13px] text-zinc-400">{range}</span>
        <OctaveButton
          label="Octave up"
          disabled={first >= highest}
          onClick={() => shift(1)}
          path="M7 4l5 5-5 5"
        />
      </div>
      <div
        ref={surfaceRef}
        role="group"
        aria-label={`Keys ${range}. Computer keys A to K play them; Z and X shift the octave`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        // A long press would open Android's context menu
        onContextMenu={(event) => event.preventDefault()}
        className="relative min-h-28 flex-1 touch-none"
      >
        {keyboardLayout(first, octaves).map((key) => (
          <div
            key={key.note}
            ref={(element) => {
              hands.mount(key.note, element)
              return () => hands.mount(key.note, null)
            }}
            style={{
              left: `${key.left * 100}%`,
              width: `calc(${key.width * 100}% - ${key.black ? 0 : 2}px)`,
              height: key.black ? `${BLACK_LENGTH * 100}%` : '100%',
            }}
            className={
              key.black
                ? 'absolute top-0 rounded-b-md bg-[#111116] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] data-pressed:bg-[#2a8f6c] data-pressed:shadow-[inset_0_3px_0_#6ee7b7]'
                : 'absolute top-0 flex items-end justify-center rounded-b-lg bg-[#2a2a31] pb-2.5 font-mono text-[11px] text-zinc-400 shadow-[inset_0_-3px_0_rgb(0_0_0/0.25)] data-pressed:bg-[#1e6a55] data-pressed:text-emerald-100 data-pressed:shadow-[inset_0_3px_0_#34d399]'
            }
          >
            {!key.black && key.note % 12 === 0 ? noteName(key.note) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function OctaveButton({
  label,
  disabled,
  onClick,
  path,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  path: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-[10px] bg-white/5 text-zinc-200 disabled:opacity-30"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
    </button>
  )
}
