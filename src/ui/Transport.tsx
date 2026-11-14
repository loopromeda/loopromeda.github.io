import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
  type RefObject,
} from 'react'
import { MAX_SWING, MAX_TEMPO, MIN_SWING, MIN_TEMPO } from '../dsp/sequencer'
import type { Engine } from '../engine/engine'
import { setSwing, setTempo } from '../state/song'
import { COLUMNS } from '../viz/steps'
import { ICON_BUTTON, RAISED } from './controls'
import { NEUTRAL_LOOK } from './editor'
import { IconButton, SmallIconButton } from './IconButton'
import { usePlacement } from './placement'

/**
 * Starts the sequencer, every track's loop from its first step, and
 * stops it: lit while it plays. In the play surface's header, whichever
 * surface is up.
 */
export function PlayButton({ engine }: { engine: Engine }) {
  const playing = useSyncExternalStore(
    engine.subscribeTransport,
    engine.getPlaying
  )
  return (
    <IconButton
      label={playing ? 'Stop' : 'Play'}
      path={playing ? 'M5 5h8v8H5z' : 'M6 4l8 5-8 5z'}
      pressed={playing}
      onClick={() => (playing ? engine.stop() : engine.play())}
    />
  )
}

const TEMPO_BUTTON =
  'flex h-11 w-14 shrink-0 items-center justify-center rounded-[10px] bg-(--lift) font-mono text-[13px] text-(--ink-200) aria-expanded:bg-(--lift-2)'

/**
 * Beside Play: the song's tempo, in beats a minute, as its face. A tap
 * opens the tempo and the swing, a popover standing on it (TempoPicker,
 * which ref places), and closes it again.
 */
export function TempoButton({
  ref,
  engine,
  open,
  onToggle,
}: {
  ref?: Ref<HTMLButtonElement>
  engine: Engine
  open: boolean
  onToggle: () => void
}) {
  const tempo = useTempo(engine)
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls="tempo"
      aria-label={`Tempo: ${tempo} beats a minute`}
      onClick={onToggle}
      className={TEMPO_BUTTON}
    >
      {tempo}
    </button>
  )
}

const useTempo = (engine: Engine): number =>
  useSyncExternalStore(engine.subscribeSong, () => engine.getSong().tempo)

const useSwing = (engine: Engine): number =>
  useSyncExternalStore(engine.subscribeSong, () => engine.getSong().swing)

/** As wide as it wants to be, in rem: two rows of a slider and its ends */
const WANT_W = 20

/** Around its choices, in CSS px: the header, a gap, the padding (p-2.5) */
const AROUND = 28 + 8 + 2 * 10

const SLIDER = 'h-11 min-w-0 flex-1 accent-[var(--accent)]'

/**
 * The song's tempo and its swing, a popover on the tempo's button: the
 * tempo on a slider with a beat down and a beat up at its ends, the swing
 * (the share of each pair of sixteenths the first takes) from straight to
 * a triplet's and a little past. Each change plays at once. Escape and
 * the cross close it; so does a tap outside (the page's, App.tsx).
 */
export function TempoPicker({
  engine,
  anchor,
  onClose,
}: {
  engine: Engine
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const tempo = useTempo(engine)
  const swing = useSwing(engine)
  const percent = Math.round(swing * 100)
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

  const turn = (value: number) =>
    engine.editSong((song) => setTempo(song, value))
  // From the tempo as it stands, not as it was drawn: two taps are two beats
  const nudge = (by: number) =>
    engine.editSong((song) => setTempo(song, song.tempo + by))
  const swung = (value: number) =>
    engine.editSong((song) => setSwing(song, value / 100))

  return (
    <section
      id="tempo"
      aria-labelledby="tempo-heading"
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
        <span
          aria-hidden
          className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px] text-(--ink-200)"
          style={{
            background: 'var(--tile)',
            boxShadow: `inset 0 0 0 1.5px ${NEUTRAL_LOOK.ring}`,
          }}
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
          >
            <path d="M6.5 2.5h5l3 13h-11zM9 11.5l4-7" />
          </svg>
        </span>
        <h2
          id="tempo-heading"
          className="shrink-0 text-sm font-semibold whitespace-nowrap text-(--ink-100)"
        >
          Tempo
        </h2>
        <span className="min-w-0 truncate font-mono text-[11px] text-(--ink-400)">
          {tempo} BPM
        </span>
        <SmallIconButton
          label="Close tempo"
          onClick={onClose}
          path="M5 5l8 8M13 5l-8 8"
          className="ml-auto"
        />
      </div>

      <div className="-mx-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5">
        <div ref={contentRef} className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="A beat a minute slower"
              disabled={tempo <= MIN_TEMPO}
              onClick={() => nudge(-1)}
              className={ICON_BUTTON}
            >
              <Stroke path="M4.5 9h9" />
            </button>
            <input
              type="range"
              aria-label="Tempo, beats a minute"
              min={MIN_TEMPO}
              max={MAX_TEMPO}
              step={1}
              value={tempo}
              onChange={(event) => turn(Number(event.target.value))}
              className={SLIDER}
            />
            <button
              type="button"
              aria-label="A beat a minute faster"
              disabled={tempo >= MAX_TEMPO}
              onClick={() => nudge(1)}
              className={ICON_BUTTON}
            >
              <Stroke path="M4.5 9h9M9 4.5v9" />
            </button>
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between px-1">
              <h3
                id="tempo-swing"
                className="text-[11px] font-medium tracking-widest text-(--ink-500) uppercase"
              >
                Swing
              </h3>
              <span className="font-mono text-[11px] text-(--ink-400)">
                {percent <= MIN_SWING * 100 ? 'Straight' : `${percent}%`}
              </span>
            </div>
            <div className="flex px-1">
              <input
                type="range"
                aria-labelledby="tempo-swing"
                min={MIN_SWING * 100}
                max={MAX_SWING * 100}
                step={1}
                value={percent}
                onChange={(event) => swung(Number(event.target.value))}
                className={SLIDER}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** An 18 px stroked picture on a 44 px button */
function Stroke({ path }: { path: string }) {
  return (
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
  )
}

const LIGHT =
  'size-1.5 shrink-0 rounded-full bg-(--lift-3) data-on:bg-(--accent)'
const BEAT_LIGHT =
  'size-2 shrink-0 rounded-full bg-(--lift-4) data-on:bg-(--accent)'

/**
 * A bar of sixteenths as a row of lights, the beats' larger: the one the
 * sequencer plays lit as it passes, none while it is stopped. Lit outside
 * React, a step at a time as the audio thread tells of them; it leads
 * what is heard by the output's latency.
 */
export function StepLights({
  engine,
  className = '',
}: {
  engine: Engine
  className?: string
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    let lit = -1
    const show = (step: number) => {
      const next = step < 0 ? -1 : step % COLUMNS
      if (next === lit) return
      if (lit >= 0) row.children[lit]?.removeAttribute('data-on')
      if (next >= 0) row.children[next]?.setAttribute('data-on', '')
      lit = next
    }
    // Steps are told of as they change: the one playing now is read
    show(engine.step)
    return engine.watchSteps(show)
  }, [engine])

  return (
    <div
      ref={rowRef}
      aria-hidden
      className={`flex items-center justify-between ${className}`}
    >
      {Array.from({ length: COLUMNS }, (_, step) => (
        <span key={step} className={step % 4 === 0 ? BEAT_LIGHT : LIGHT} />
      ))}
    </div>
  )
}
