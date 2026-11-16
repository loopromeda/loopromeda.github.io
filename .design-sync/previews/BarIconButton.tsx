import { useState, type ReactNode } from 'react'
import { BAR_HIT, BarIconButton, noteName } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The pictures, each in an 18 px box */
const LEFT = 'M11 4l-5 5 5 5'
const RIGHT = 'M7 4l5 5-5 5'
const PLAY = 'M6 4l8 5-8 5z'
const STOP = 'M5 5h8v8H5z'

/** The keys' range between the arrows, as the header names it */
const RANGE = 'font-mono text-[13px] whitespace-nowrap text-(--ink-400)'

/** Record's 36 px button beside Play, red while lit */
const RECORD = `${BAR_HIT} flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--lift) text-(--ink-200) aria-pressed:bg-(--danger)/20 aria-pressed:text-(--danger-ink)`

/** The tempo's 36 px button beside them: the song's tempo as its face */
const TEMPO = `${BAR_HIT} flex h-9 w-12 shrink-0 items-center justify-center rounded-lg bg-(--lift) font-mono text-[13px] text-(--ink-200) aria-expanded:bg-(--lift-2)`

/** The play surface's header: an octave down and up around the keys' range */
function Octaves({ start }: { start: number }) {
  const [lowest, setLowest] = useState(start)
  const LOW = 0
  const HIGH = 96
  return (
    <div className="flex h-9 items-center gap-2">
      <BarIconButton
        label="Octave down"
        disabled={lowest <= LOW}
        onClick={() => setLowest(lowest - 12)}
        path={LEFT}
      />
      <span className={RANGE}>
        {`${noteName(lowest)} – ${noteName(lowest + 23)}`}
      </span>
      <BarIconButton
        label="Octave up"
        disabled={lowest >= HIGH}
        onClick={() => setLowest(lowest + 12)}
        path={RIGHT}
      />
    </div>
  )
}

/** An octave down and an octave up, the keys' two octaves between them */
export function OctaveShift() {
  return (
    <Stage>
      <Octaves start={48} />
    </Stage>
  )
}

/** At the lowest octave MIDI has: down waits, disabled */
export function AtTheLowest() {
  return (
    <Stage>
      <Octaves start={0} />
    </Stage>
  )
}

/**
 * Play, Record and the tempo in the header while the tab rail is put
 * away: Play lit as Stop while the loop plays
 */
export function Transport() {
  const [playing, setPlaying] = useState(true)
  const [recording, setRecording] = useState(false)
  return (
    <Stage>
      <div className="flex h-9 items-center gap-2">
        <BarIconButton
          label={playing ? 'Stop' : 'Play'}
          path={playing ? STOP : PLAY}
          pressed={playing}
          onClick={() => setPlaying(!playing)}
        />
        <button
          type="button"
          aria-label="Record"
          aria-pressed={recording}
          onClick={() => setRecording(!recording)}
          className={RECORD}
        >
          <svg width={16} height={16} viewBox="0 0 18 18" aria-hidden="true">
            <circle
              cx="9"
              cy="9"
              r="4.5"
              fill={recording ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Tempo: 120 beats a minute"
          aria-expanded={false}
          className={TEMPO}
        >
          120
        </button>
      </div>
    </Stage>
  )
}
