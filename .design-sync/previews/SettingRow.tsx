import { useState, type ReactNode } from 'react'
import { CARD, Dropdown, SMALL_BUTTON, SettingRow } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css). A Card's cell needs 346 px: its card's columns
 * are never narrower (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The settings dialog's card, as wide as a phone held upright gives it */
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CARD} flex w-80 flex-col gap-3 p-2.5`}
      data-ds-min={320 + 26}
    >
      {children}
    </div>
  )
}

/** Offline, saved: its state in green and a button, the hint reporting */
export function Offline() {
  const [checking, setChecking] = useState(false)
  return (
    <Stage>
      <Card>
        <SettingRow
          label="Offline"
          labelId="offline-label"
          hint={
            checking
              ? 'Looking for a new version, and saving it if there is one…'
              : 'Saved in the browser: it starts and plays with no network. A new version is saved as it comes, and waits for Update; Check for update looks now, and takes it.'
          }
          hintId="offline-hint"
          live
        >
          <span className="flex items-center gap-3">
            <span className="text-[13px] text-(--ok)">ready</span>
            <button
              type="button"
              aria-describedby="offline-hint"
              disabled={checking}
              onClick={() => setChecking(true)}
              className={`${SMALL_BUTTON} disabled:text-(--ink-500)`}
            >
              {checking ? 'Checking…' : 'Check for update'}
            </button>
          </span>
        </SettingRow>
      </Card>
    </Stage>
  )
}

/** Saving: the state read only, dim at the right, the hint saying why */
export function Saving() {
  return (
    <Stage>
      <Card>
        <SettingRow
          label="Offline"
          labelId="saving-label"
          hint="Saving the site in the browser, to start and play with no network."
          hintId="saving-hint"
          live
        >
          <span className="text-[13px] text-(--ink-500)">saving…</span>
        </SettingRow>
      </Card>
    </Stage>
  )
}

/** Measure CPU: an action's button, and what it times said under it */
export function MeasureCpu() {
  const [running, setRunning] = useState(false)
  return (
    <Stage>
      <Card>
        <SettingRow
          label="CPU"
          labelId="cpu-label"
          hint={
            running
              ? 'The audio stops for a moment while the audio thread times the heaviest sound.'
              : 'Times the heaviest sound at 8 to 32 voices on the audio thread, to choose Voices by.'
          }
          hintId="cpu-hint"
          live
        >
          <button
            type="button"
            aria-describedby="cpu-hint"
            disabled={running}
            onClick={() => setRunning(true)}
            className={SMALL_BUTTON}
          >
            {running ? 'Measuring…' : 'Measure'}
          </button>
        </SettingRow>
      </Card>
    </Stage>
  )
}

/** About: two links as small buttons, a group read by the row's name */
export function About() {
  return (
    <Stage>
      <Card>
        <SettingRow
          label="Loopromeda"
          labelId="about-label"
          hint="© 2026 ashon, under the MIT License. Licences lists the software it is built with, each under its own."
          hintId="about-hint"
        >
          <div
            role="group"
            aria-labelledby="about-label"
            aria-describedby="about-hint"
            className="flex flex-wrap gap-1.5"
          >
            <a href="#licences" className={SMALL_BUTTON}>
              Licences
            </a>
            <a href="#source" className={SMALL_BUTTON}>
              Source
            </a>
          </div>
        </SettingRow>
      </Card>
    </Stage>
  )
}

/** Theme: the app's own dropdown in the control's place, swatches in it */
export function ThemePicker() {
  const [theme, setTheme] = useState('default')
  return (
    <Stage>
      <Card>
        <SettingRow
          label="Theme"
          labelId="theme-label"
          hint="The chains' colours, the modulation colour and the accent, together. The letters stay, so colour is never the only cue."
          hintId="theme-hint"
        >
          <Dropdown
            labelId="theme-label"
            hintId="theme-hint"
            options={[
              {
                value: 'default',
                label: 'Default',
                swatch: ['#34d399', '#ff8904', '#a684ff', '#bbf451'],
              },
              {
                value: 'tidal',
                label: 'Tidal',
                swatch: ['#2dd4bf', '#60a5fa', '#bbf451', '#f6339a'],
              },
              {
                value: 'neon',
                label: 'Neon',
                swatch: ['#fff04d', '#ff4fd8', '#3ee7ff', '#c6ff3d'],
              },
            ]}
            value={theme}
            onChange={setTheme}
          />
        </SettingRow>
      </Card>
    </Stage>
  )
}
