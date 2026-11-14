import { useEffect, useRef, type PointerEvent } from 'react'
import type { GlideReport } from '../engine/protocol'
import { noteName } from '../viz/keyboard'
import {
  xyGlide,
  xyLines,
  xyNote,
  xySlide,
  xyTuning,
  type XyFinger,
} from '../viz/xy'
import type { Hands } from './hands'

/** The ring under a finger, and the line down the pad at its pitch */
const MARK =
  'pointer-events-none absolute top-0 left-0 size-11 -translate-1/2 rounded-full bg-(--accent)/15 shadow-[inset_0_0_0_2px_var(--accent)]'
const STEM =
  'pointer-events-none absolute inset-y-0 left-0 w-px bg-(--accent)/50'
const TUNING =
  'pointer-events-none absolute top-0 left-0 rounded bg-black/60 px-1 font-mono text-[11px] whitespace-nowrap text-(--accent)'
/** Where a gliding note sounds, and its way left to the finger, turned */
const SOUND =
  'pointer-events-none absolute top-0 left-0 hidden size-3 -translate-1/2 rounded-full bg-(--accent) shadow-[0_0_8px_var(--accent)]'
const TRAIL =
  'pointer-events-none absolute top-0 left-0 hidden h-0.5 origin-left -translate-y-1/2 rounded-full bg-(--accent)/45'
/** The ring's radius, CSS px (size-11): the trail stops at its edge */
const RING = 22
/** The pitch stands over the ring, or under it this near the pad's top */
const TUNING_FLIP = 52

/**
 * What stands for a finger on the pad: its ring, its line, its pitch, and
 * while its note glides, where that sounds and the way left
 */
interface Mark extends XyFinger {
  readonly ring: HTMLDivElement
  readonly stem: HTMLDivElement
  readonly tuning: HTMLDivElement
  readonly sound: HTMLDivElement
  readonly trail: HTMLDivElement
  left: number
  top: number
  width: number
  height: number
  semitone: number
  glide: number
  slide: number
}

/**
 * The XY pad: each finger plays a note, across its pitch from lowest up
 * octaves octaves with no steps (a line at every semitone, the Cs named,
 * the black keys' fainter), up its Slide, 0 at the bottom to 1 at the
 * top. A finger moving bends its note (Hands.bend) rather than playing
 * another, and its Slide follows; it keeps its note off the pad's edges.
 * Every note plays at full velocity, and starts with its finger's Slide.
 * A note gliding to its finger (the sound's glide) shows where it sounds,
 * a dot that runs to the ring as the audio thread reports it
 * (watchGlides): from the last note's pitch, and from its Slide too in a
 * sound that reads the Slide, so straight from where that finger was. The
 * rings under the fingers, their lines, pitches and glides are drawn
 * straight onto the page, as the keys are lit, so a touch never
 * re-renders React.
 */
export function XyPad({
  hands,
  watchGlides,
  lowest,
  octaves,
  label,
}: {
  hands: Hands
  /** Follows the notes still gliding (Engine.watchGlides) */
  watchGlides: (listener: (report: GlideReport) => void) => () => void
  lowest: number
  octaves: number
  label: string
}) {
  /** The pad's box, measured as each touch starts */
  const boxRef = useRef<DOMRect | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const marks = useRef(new Map<number, Mark>())

  // Each finger's glide, as the audio thread reports it
  useEffect(
    () =>
      watchGlides((report) => {
        for (const [id, mark] of marks.current) {
          let glide = 0
          let slide = 0
          for (let i = 0; i < report.count; i++) {
            if (report.keys[i] !== id) continue
            glide = report.amounts[i] ?? 0
            slide = report.slides[i] ?? 0
          }
          if (glide === mark.glide && slide === mark.slide) continue
          mark.glide = glide
          mark.slide = slide
          drawGlide(mark)
        }
      }),
    [watchGlides]
  )

  // Fingers still down when the pad goes let go, and their marks go too
  useEffect(() => {
    const held = marks.current
    return () => {
      hands.stopTouches()
      for (const mark of held.values()) unmark(mark)
      held.clear()
    }
  }, [hands])

  /** Where a touch is, across and down the pad (0..1, or past its edges) */
  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current ?? event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  /** Draws finger id's mark where it is, playing note */
  const place = (id: number, x: number, y: number, note: number) => {
    let mark = marks.current.get(id)
    const layer = layerRef.current
    if (!mark) {
      if (!layer) return
      mark = {
        stem: add(layer, STEM),
        trail: add(layer, TRAIL),
        ring: add(layer, MARK),
        sound: add(layer, SOUND),
        tuning: add(layer, TUNING),
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        semitone: 0,
        glide: 0,
        slide: 0,
      }
      marks.current.set(id, mark)
    }
    const box = boxRef.current
    if (!box) return
    const left = Math.min(Math.max(x, 0), 1) * box.width
    const top = Math.min(Math.max(y, 0), 1) * box.height
    mark.left = left
    mark.top = top
    mark.width = box.width
    mark.height = box.height
    mark.semitone = box.width / (12 * octaves)
    drawGlide(mark)
    mark.stem.style.transform = `translateX(${left}px)`
    mark.ring.style.left = `${left}px`
    mark.ring.style.top = `${top}px`
    mark.tuning.style.left = `${left}px`
    mark.tuning.style.top = `${top}px`
    mark.tuning.style.transform =
      top < TUNING_FLIP
        ? 'translate(-50%, 1.75rem)'
        : 'translate(-50%, calc(-100% - 1.75rem))'
    const { note: nearest, cents } = xyTuning(note)
    mark.tuning.textContent =
      cents === 0
        ? noteName(nearest)
        : `${noteName(nearest)} ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Keep this finger's moves even when it slides off the pad
    event.currentTarget.setPointerCapture(event.pointerId)
    boxRef.current = event.currentTarget.getBoundingClientRect()
    const { x, y } = pointAt(event)
    const note = xyNote(x, lowest, octaves)
    // The note starts with the finger's Slide, and glides to it
    hands.press(event.pointerId, note, 1, y, xySlide(y))
    place(event.pointerId, x, y, note)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const id = event.pointerId
    if (!hands.holds(id)) return
    const { x, y } = pointAt(event)
    const note = xyNote(x, lowest, octaves)
    hands.bend(id, note)
    hands.move(id, xySlide(y))
    place(id, x, y, note)
  }

  // pointerup is followed by lostpointercapture; stop() ignores the second
  const up = (event: PointerEvent<HTMLDivElement>) => {
    hands.stop(event.pointerId)
    const mark = marks.current.get(event.pointerId)
    if (!mark) return
    unmark(mark)
    marks.current.delete(event.pointerId)
  }

  return (
    <div
      role="group"
      aria-label={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      className="absolute inset-0 touch-none overflow-hidden rounded-lg bg-[#1b1b21] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
    >
      {/* Slide's quarters, faint across the pad */}
      {[0.25, 0.5, 0.75].map((at) => (
        <div
          key={at}
          aria-hidden
          style={{ top: `${at * 100}%` }}
          className="pointer-events-none absolute inset-x-0 h-px bg-white/[0.04]"
        />
      ))}
      {xyLines(lowest, octaves).map((line) => (
        <div
          key={line.note}
          aria-hidden
          style={{ left: `${line.x * 100}%` }}
          className={`pointer-events-none absolute inset-y-0 w-px ${line.c ? 'bg-(--accent)/30' : line.black ? 'bg-white/[0.04]' : 'bg-white/[0.09]'}`}
        >
          {line.c && (
            <span
              className={`absolute bottom-1.5 font-mono text-[11px] text-zinc-500 ${line.x === 1 ? 'right-1.5' : 'left-1.5'}`}
            >
              {noteName(line.note)}
            </span>
          )}
        </div>
      ))}
      <div ref={layerRef} aria-hidden className="absolute inset-0" />
    </div>
  )
}

/** A new element of className in layer */
function add(layer: HTMLElement, className: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  layer.appendChild(element)
  return element
}

/**
 * Shows where mark's note sounds while it glides, and the way left to the
 * ring's edge, turned towards the finger; nothing once it lands
 */
function drawGlide(mark: Mark): void {
  const { sound, trail } = mark
  const glide = xyGlide(mark, RING)
  if (!glide) {
    sound.style.display = ''
    trail.style.display = ''
    return
  }
  sound.style.display = 'block'
  sound.style.left = `${glide.x}px`
  sound.style.top = `${glide.y}px`
  if (glide.length > 0) {
    trail.style.display = 'block'
    trail.style.left = `${glide.x}px`
    trail.style.top = `${glide.y}px`
    trail.style.width = `${glide.length}px`
    trail.style.rotate = `${glide.angle}rad`
  } else {
    trail.style.display = ''
  }
}

function unmark(mark: Mark): void {
  mark.ring.remove()
  mark.stem.remove()
  mark.tuning.remove()
  mark.sound.remove()
  mark.trail.remove()
}
