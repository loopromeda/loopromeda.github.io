import { useEffect, useState } from 'react'
import type { Engine } from '../engine/engine'
import { ICON_GRID, markPaths } from '../viz/mark'
import { markInks, mode, themeId, themeOf } from './theme'

/**
 * What the page shows as it opens (asked for by ashon, 2026-11-15:
 * "자동으로 로딩되게 하고, 스플래시는 그냥 잠깐 떠 있다가 본화면으로
 * 들어가면 되지 않을까?", where a cover asking for a tap had stood until
 * the audio started).
 *
 * The audio starts with the page where the browser lets it (main.tsx).
 * The splash, the mark over the name (asked for by ashon, 2026-11-15:
 * "Loopromeda 첫 화면에서도 아이콘이 잘 나오면 좋겠네"; the name alone
 * before), stands until the worklet has loaded and at
 * least SPLASH_MS from the page's start, seen rather than flashed, then
 * fades into the instrument as it stands. A tap lets it go at once, once
 * loaded. Where the browser holds the audio back for a tap (iOS always;
 * Chrome where the site has not been played on), the instrument is there
 * all the same, asking nothing: the first tap anywhere starts the audio
 * (useStartOnTouch), and the status line says suspended until it has. A
 * note over the instrument asked for that tap at first, and was taken
 * away (ashon: "이게 아예 안나왔으면 좋겠어 불필요한 UI 같아"). That first
 * touch may sound late or not at all: on a touch screen a press is no
 * user activation until the finger lifts.
 */

/** The least the splash stands, from the page's start, in ms */
const SPLASH_MS = 900
/** Its fade into the instrument, in ms */
const FADE_MS = 250
/** Still loading this long from the page's start, it says so, in ms */
const SLOW_MS = 2000

/** The events a browser counts as a user activation */
const ACTIVATIONS = ['keydown', 'click', 'pointerup', 'touchend'] as const

export function Splash({
  ready,
  onGone,
}: {
  /** The worklet loaded: the audio running, or held for a tap */
  ready: boolean
  /** It has faded: stable, for the timer that calls it */
  onGone: () => void
}) {
  const due = useSince(SPLASH_MS)
  const slow = useSince(SLOW_MS)
  const [tapped, setTapped] = useState(false)
  const leaving = ready && (due || tapped)
  useEffect(() => {
    if (!leaving) return
    const id = setTimeout(onGone, FADE_MS)
    return () => clearTimeout(id)
  }, [leaving, onGone])
  return (
    <div
      // The tap that starts the audio is useStartOnTouch's; this one only
      // hurries the splash away
      onClick={() => setTapped(true)}
      className={`fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-(--bg) px-8 transition-opacity duration-250 motion-reduce:transition-none ${leaving ? 'pointer-events-none opacity-0' : ''}`}
    >
      <Mark />
      <h1 className="text-3xl font-semibold tracking-tight">Loopromeda</h1>
      {/* Only long past its time, still loading: a first visit, a slow
          phone (not flashed for a moment as the worklet comes) */}
      <p
        className={`text-sm text-(--ink-400) ${slow && !ready ? '' : 'invisible'}`}
      >
        Starting…
      </p>
    </div>
  )
}

/**
 * The mark as the icons draw it, in the page's theme, on the page itself:
 * no square of its own, the gap at its crossing the page's colour
 */
function Mark() {
  const { loop, stroke, cut, cutWidth, over, from, to } = markPaths(ICON_GRID)
  const { ground, light, deep } = markInks(themeOf(themeId()), mode())
  const { size } = ICON_GRID
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="size-28 shrink-0"
      aria-hidden
    >
      <defs>
        <linearGradient
          id="splash-ink"
          gradientUnits="userSpaceOnUse"
          x1={from[0]}
          y1={from[1]}
          x2={to[0]}
          y2={to[1]}
        >
          <stop offset={0} stopColor={light} />
          <stop offset={1} stopColor={deep} />
        </linearGradient>
      </defs>
      <path
        d={loop}
        fill="none"
        stroke="url(#splash-ink)"
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
      <path d={cut} stroke={ground} strokeWidth={cutWidth} />
      <path d={over} stroke="url(#splash-ink)" strokeWidth={stroke} />
    </svg>
  )
}

/** Whether ms have passed since the page's start */
function useSince(ms: number): boolean {
  const [past, setPast] = useState(() => performance.now() >= ms)
  useEffect(() => {
    if (past) return
    const id = setTimeout(() => setPast(true), ms - performance.now())
    return () => clearTimeout(id)
  }, [past, ms])
  return past
}

/**
 * While waiting, the first user activation anywhere starts the audio:
 * caught on the way down (capture), before a control can stop it, and
 * left to go on to that control. engine.start() calls the context's
 * resume() within the event, as browsers ask.
 */
export function useStartOnTouch(engine: Engine, waiting: boolean): void {
  useEffect(() => {
    if (!waiting) return
    const start = () => void engine.start()
    for (const kind of ACTIVATIONS) {
      window.addEventListener(kind, start, { capture: true, passive: true })
    }
    return () => {
      for (const kind of ACTIVATIONS) {
        window.removeEventListener(kind, start, { capture: true })
      }
    }
  }, [engine, waiting])
}
