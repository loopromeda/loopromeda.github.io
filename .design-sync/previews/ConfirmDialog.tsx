import { useState, type ReactNode } from 'react'
import {
  CARD,
  ConfirmDialog,
  SECTION_HEADING,
  SMALL_BUTTON,
  SMALL_DANGER,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * The page under the dialog: the app's <main>, dark, as tall as the
 * card's frame. The dialog stands over it, modal, on its backdrop.
 */
function Screen({ children }: { children: ReactNode }) {
  const [inset] = useState(
    () => 2 * (parseFloat(getComputedStyle(document.body).paddingTop) || 0)
  )
  return (
    <main
      className="rounded-xl bg-(--bg) p-4 font-sans text-(--ink)"
      style={{ height: `calc(100vh - ${inset}px)` }}
    >
      {children}
    </main>
  )
}

/**
 * A question asked as the story opens, over the panel it was asked from:
 * either answer closes it, and the button that asked asks again
 */
function Asked({
  title,
  message,
  confirm,
  heading,
  ask,
}: {
  title: string
  message: string
  confirm: string
  /** The panel the question came from, by its name */
  heading: string
  /** The button that asks it, in the panel's header */
  ask: string
}) {
  const [asking, setAsking] = useState(true)
  return (
    <Screen>
      <div className={`${CARD} flex max-w-sm flex-col gap-2 p-2.5`}>
        <div className="flex h-7 items-center gap-1.5">
          <h2 className={`min-w-0 flex-1 truncate px-1 ${SECTION_HEADING}`}>
            {heading}
          </h2>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className={ask === 'Clear' ? SMALL_BUTTON : SMALL_DANGER}
          >
            {ask}
          </button>
        </div>
        <div className="grid h-24 grid-cols-8 gap-1">
          {Array.from({ length: 32 }, (_, i) => (
            <span
              key={i}
              className={`rounded-sm ${[0, 6, 11, 18, 20, 27].includes(i) ? 'bg-(--accent)' : 'bg-(--over)/7'}`}
            />
          ))}
        </div>
      </div>
      {asking && (
        <ConfirmDialog
          title={title}
          message={message}
          confirm={confirm}
          onConfirm={() => setAsking(false)}
          onCancel={() => setAsking(false)}
        />
      )}
    </Screen>
  )
}

/** The step grid's Clear: every note of the loop goes */
export function ClearLoop() {
  return (
    <Asked
      title="Clear this loop?"
      message="Every note of it goes, in every bar."
      confirm="Clear"
      heading="Bass · bar 1 of 4"
      ask="Clear"
    />
  )
}

/** A knob lane's cross: the knob plays its own value again */
export function RemoveLane() {
  return (
    <Asked
      title="Remove this lane?"
      message="Cutoff plays its own value again, in every bar."
      confirm="Remove"
      heading="Lane · A Filter · Cutoff"
      ask="Remove"
    />
  )
}

/** A track's Remove, its message long enough to wrap onto three lines */
export function RemoveTrack() {
  return (
    <Asked
      title="Remove Drums?"
      message="Its pads and its chain go with it, and its strip’s level and balance. The presets its pads play stay."
      confirm="Remove"
      heading="Drums · kit"
      ask="Remove"
    />
  )
}
