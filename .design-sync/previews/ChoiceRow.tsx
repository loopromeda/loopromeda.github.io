import { useState, type ReactNode } from 'react'
import { CARD, ChoiceRow, THEMES, type ThemeId } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css). A Card's cell needs 346 px: its card's columns
 * are never narrower (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** A card as wide as a phone held upright gives the settings */
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CARD} flex w-80 flex-col gap-1.5 p-2.5`}
      data-ds-min={320 + 26}
    >
      {children}
    </div>
  )
}

/** Numbers as options, no hint: the voices the synth may sound at once */
export function Voices() {
  const [voices, setVoices] = useState(16)
  return (
    <Stage>
      <Card>
        <ChoiceRow
          label="Voices"
          options={[8, 12, 16, 24, 32].map((value) => ({
            value,
            label: `${value}`,
          }))}
          value={voices}
          onChange={setVoices}
        />
      </Card>
    </Stage>
  )
}

/** Three options and a hint of two sentences under them */
export function Latency() {
  const [latency, setLatency] = useState<
    'interactive' | 'balanced' | 'playback'
  >('balanced')
  return (
    <Stage>
      <Card>
        <ChoiceRow
          label="Latency"
          hint="Higher gives a slow phone more time for each block, and delays every note. Changing it restarts the audio."
          options={[
            { value: 'interactive', label: 'Low' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'playback', label: 'High' },
          ]}
          value={latency}
          onChange={setLatency}
        />
      </Card>
    </Stage>
  )
}

/** The transport's Record: two options, a long hint saying each */
export function Record() {
  const [record, setRecord] = useState<'overdub' | 'replace'>('overdub')
  return (
    <Stage>
      <Card>
        <ChoiceRow
          label="Record"
          hint="Overdub adds what is played. Replace first empties the loop as it plays, once round. An empty loop grows with the take, which sets its length."
          options={[
            { value: 'overdub', label: 'Overdub' },
            { value: 'replace', label: 'Replace' },
          ]}
          value={record}
          onChange={setRecord}
        />
      </Card>
    </Stage>
  )
}

/** Where the row is narrow, the options go under the name */
export function Narrow() {
  const [appearance, setAppearance] = useState<'system' | 'dark' | 'light'>(
    'system'
  )
  return (
    <Stage>
      <div className={`${CARD} flex w-60 flex-col gap-1.5 p-2.5`}>
        <ChoiceRow
          label="Appearance"
          hint="Dark or light, or as the device is set."
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          value={appearance}
          onChange={setAppearance}
        />
      </div>
    </Stage>
  )
}

/** More options than a line holds: they wrap, the chosen one pressed */
export function ManyOptions() {
  const [theme, setTheme] = useState<ThemeId>('neon')
  return (
    <Stage>
      <Card>
        <ChoiceRow
          label="Theme"
          hint="The chains' colours, the modulation colour and the accent, together."
          options={THEMES.map((each) => ({ value: each.id, label: each.name }))}
          value={theme}
          onChange={setTheme}
        />
      </Card>
    </Stage>
  )
}
