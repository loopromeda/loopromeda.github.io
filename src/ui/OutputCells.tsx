import type { ReactNode } from 'react'
import { KNOB_COLUMN, KNOB_LABEL, KNOB_READOUT, KNOB_SIZE } from './controls'
import { GLYPHS } from './editor'
import { MASTER_VIEWS, type MasterViewKind } from './MasterViews'

/**
 * An output's own controls in its panel's knob row, after the knobs, so
 * that the panel ends with them (asked for by ashon, 2026-11-15: "여기
 * 아래 블럭도 패널에 그리드 칸을 사용해서 위로 올리면 어떨까?", the room
 * under them left empty). Each cell is a knob's size, standing where a
 * knob's face stands (ashon: "노브 크기에 맞게"), named under it as a knob
 * is ("컨트롤 아래에 레이블도 있으면 좋을 것 같아"): its track's Mute over
 * its Solo, when it has a track (MutesCell), then the four views its
 * tiles may show, each a pictogram, two by two, the one shown pressed.
 * Under the views' name, the one shown (ashon: "View 아래에 레이블이
 * 있어도 나쁘지 않을 것 같은데"), Spectrogram cut to Spectro. (ashon:
 * "Spectrogram -> Spectro. 이렇게 줄이는건 어떨까?"), no wider than
 * Spectrum: in full it is as wide as two narrow columns, and would run
 * off the panel in a row of eight. Its button keeps the whole name.
 */

/** The view shown, as its cell reads it */
const READOUTS: Record<MasterViewKind, string> = {
  scope: 'Scope',
  spectrum: 'Spectrum',
  spectrogram: 'Spectro.',
  stereo: 'Stereo',
}

/** A view's button: an option's face (SMALL_OPTION's), square */
const VIEW =
  'flex min-h-0 min-w-0 items-center justify-center rounded-md bg-(--lift) text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)'

export function OutputCells({
  mutes,
  shown,
  choose,
}: {
  /** A track's Mute and Solo (MutesCell), if it has one */
  mutes?: ReactNode
  shown: MasterViewKind
  choose: (view: MasterViewKind) => void
}) {
  return (
    <>
      {mutes}
      <div className={`${KNOB_COLUMN} self-start`}>
        <div
          role="group"
          aria-label="The output shows"
          className={`${KNOB_SIZE} grid aspect-square grid-cols-2 grid-rows-2 gap-1`}
        >
          {MASTER_VIEWS.map(({ view, label }) => (
            <button
              key={view}
              type="button"
              aria-pressed={shown === view}
              aria-label={label}
              title={label}
              onClick={() => choose(view)}
              className={VIEW}
            >
              <svg
                viewBox="0 0 18 12"
                aria-hidden
                className="h-auto w-[65%] max-w-[18px]"
              >
                <path
                  d={GLYPHS[view]}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
        </div>
        <span className={KNOB_LABEL}>View</span>
        <span className={KNOB_READOUT}>{READOUTS[shown]}</span>
      </div>
    </>
  )
}
