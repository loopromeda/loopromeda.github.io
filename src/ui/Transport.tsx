import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type Ref,
  type RefObject,
} from 'react'
import {
  BAR_STEPS,
  MAX_SWING,
  MAX_TEMPO,
  MIN_SWING,
  MIN_TEMPO,
} from '../dsp/sequencer'
import type { Engine } from '../engine/engine'
import type { AppSettings } from '../state/settings'
import { loopOn, setLoopOn, setSwing, setTempo } from '../state/song'
import { trackName, tracksKey } from '../state/tracks'
import { COLUMNS } from '../viz/steps'
import { ICON_BUTTON, SECTION_HEADING, TALL_HIT } from './controls'
import { IconButton, SmallIconButton } from './IconButton'
import { Popover } from './Popover'
import { SettingGroup, SwitchRow } from './SettingRows'
import { transportKey } from './transportKeys'

/** Play's triangle, and Stop's square, in an 18 px box */
const PLAY = 'M6 4l8 5-8 5z'
const STOP = 'M5 5h8v8H5z'

/**
 * Starts the sequencer, every track's loop from its first step (a bar
 * counted in first, where the settings ask for it), and stops it: lit
 * while it plays. On the tab rail (small), or in the play surface's
 * header while the rail is put away with the controls.
 */
export function PlayButton({
  engine,
  small = false,
}: {
  engine: Engine
  small?: boolean
}) {
  const playing = useSyncExternalStore(
    engine.subscribeTransport,
    engine.getPlaying
  )
  const props = {
    label: playing ? 'Stop' : 'Play',
    path: playing ? STOP : PLAY,
    pressed: playing,
    onClick: () => (playing ? engine.stop() : engine.play()),
  }
  return small ? <SmallIconButton {...props} /> : <IconButton {...props} />
}

/**
 * The transport's keys on the page, for a desktop (transportKeys.ts):
 * Space plays and stops, the arrows move a beat back and on (with Shift a
 * bar), Home goes to the first
 */
export function useTransportKeys(engine: Engine): void {
  useEffect(() => {
    // The Space that played presses no button focused as it comes up
    let spaceTaken = false
    const down = (event: KeyboardEvent) => {
      const action = transportKey(event)
      if (action === undefined) return
      event.preventDefault()
      if (action.kind === 'toggle') {
        spaceTaken = true
        if (event.repeat) return
        if (engine.getPlaying()) engine.stop()
        else engine.play()
      } else if (action.kind === 'start') {
        engine.rewind()
      } else {
        engine.seek(action.beats)
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !spaceTaken) return
      spaceTaken = false
      event.preventDefault()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [engine])
}

/** Where the song is: bar, beat and sixteenth from 1, or the count's beats */
export function positionText(step: number, counting: boolean): string {
  if (counting) return `\u2212${Math.ceil(-step / 4)}`
  if (step < 0) return '1.1.1'
  const bar = Math.floor(step / BAR_STEPS) + 1
  const beat = Math.floor((step % BAR_STEPS) / 4) + 1
  return `${bar}.${beat}.${(step % 4) + 1}`
}

/**
 * Where the song is, beside Play on the tab rail: bar, beat and sixteenth
 * (`3.2.1`), the beats left while it counts in (`−4`), and while stopped
 * the beat Play starts from, dim. Written outside React a step at a time,
 * as the audio thread tells of them; it leads what is heard by the
 * output's latency.
 */
export function Position({ engine }: { engine: Engine }) {
  const textRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const text = textRef.current
    if (!text) return
    let shown = ''
    const show = () => {
      const playing = engine.getPlaying()
      const counting = engine.countingIn
      const step = engine.step
      // Stopped, or not yet told of a step: the beat Play starts from
      const at = counting || (playing && step >= 0) ? step : engine.cue
      const next = positionText(at, counting)
      if (next !== shown) {
        text.textContent = next
        shown = next
      }
      text.dataset.state = counting ? 'count' : playing ? 'play' : 'stop'
    }
    show()
    const stopSteps = engine.watchSteps(show)
    const stopTransport = engine.subscribeTransport(show)
    return () => {
      stopSteps()
      stopTransport()
    }
  }, [engine])
  return (
    <span
      ref={textRef}
      role="timer"
      aria-label="Position: bar, beat and sixteenth"
      className="min-w-[6ch] shrink-0 text-center font-mono text-[11px] text-(--ink-200) tabular-nums data-[state=count]:text-(--accent) data-[state=stop]:text-(--ink-500)"
    >
      1.1.1
    </span>
  )
}

const TEMPO_BUTTON =
  'flex h-11 w-14 shrink-0 items-center justify-center rounded-[10px] bg-(--lift) font-mono text-[13px] text-(--ink-200) aria-expanded:bg-(--lift-2)'

/** On the tab rail: the panel's 28 px class, its face lit when open */
const RAIL_TEMPO_BUTTON = `${TALL_HIT} flex h-7 min-w-9 shrink-0 items-center justify-center rounded-md bg-(--lift) px-1.5 font-mono text-[11px] text-(--ink-200) aria-expanded:bg-(--lift-2) aria-expanded:text-(--ink-0)`

/**
 * Beside Play: the song's tempo, in beats a minute, as its face. A tap
 * opens the transport's popover (TransportPicker, which ref places) and
 * closes it again. On the tab rail (rail), at the panel's 28 px.
 */
export function TempoButton({
  ref,
  engine,
  open,
  onToggle,
  rail = false,
}: {
  ref?: Ref<HTMLButtonElement>
  engine: Engine
  open: boolean
  onToggle: () => void
  rail?: boolean
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
      className={rail ? RAIL_TEMPO_BUTTON : TEMPO_BUTTON}
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

/** A metronome, its arm off to the right, in an 18 px box */
const METRONOME = 'M6.5 2.5h5l3 13h-11zM9 11.5l4-7'

const SLIDER = 'h-11 min-w-0 flex-1 accent-[var(--accent)]'

/**
 * The transport, a popover on the tempo's button (below it on the tab
 * rail, above it in the play surface's header): the song's tempo on a
 * slider with a beat down and a beat up at its ends, the swing (the
 * share of each pair of sixteenths the first takes) from straight to a
 * triplet's and a little past; the click and the count-in (the device's
 * settings); and each track with its loop on or off (the song's). Each
 * change plays at once. Escape and the cross close it; so does a tap
 * outside (the page's, App.tsx).
 */
export function TransportPicker({
  engine,
  settings,
  onSettings,
  anchor,
  onClose,
}: {
  engine: Engine
  settings: AppSettings
  onSettings: (next: AppSettings) => void
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const tempo = useTempo(engine)
  const swing = useSwing(engine)
  const song = useSyncExternalStore(engine.subscribeSong, engine.getSong)
  // The tracks: which there are, in their order, and what they are called
  useSyncExternalStore(engine.subscribeSound, () =>
    tracksKey(engine.getTracks())
  )
  const tracks = engine.getTracks()
  const percent = Math.round(swing * 100)

  const turn = (value: number) =>
    engine.editSong((song) => setTempo(song, value))
  // From the tempo as it stands, not as it was drawn: two taps are two beats
  const nudge = (by: number) =>
    engine.editSong((song) => setTempo(song, song.tempo + by))
  const swung = (value: number) =>
    engine.editSong((song) => setSwing(song, value / 100))

  return (
    <Popover
      id="tempo"
      anchor={anchor}
      width={WANT_W}
      chip={
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
          <path d={METRONOME} />
        </svg>
      }
      title="Transport"
      note={`${tempo} BPM`}
      closeLabel="Close the transport"
      onClose={onClose}
      bodyClassName="gap-3"
    >
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
          <h3 id="tempo-swing" className={SECTION_HEADING}>
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

      <div className="flex flex-col gap-1.5">
        <SwitchRow
          label="Click"
          hint="Each beat, the bar's first higher."
          value={settings.click}
          onChange={(click) => onSettings({ ...settings, click })}
        />
        <SwitchRow
          label="Count-in"
          hint="A bar of beats before the first step."
          value={settings.countIn}
          onChange={(countIn) => onSettings({ ...settings, countIn })}
        />
      </div>

      <SettingGroup title="Loops">
        {tracks.map((track, k) => (
          <SwitchRow
            key={track.id}
            label={trackName(track, k)}
            value={loopOn(song, track.id)}
            onChange={(on) =>
              engine.editSong((each) => setLoopOn(each, track.id, on))
            }
          />
        ))}
      </SettingGroup>
    </Popover>
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
