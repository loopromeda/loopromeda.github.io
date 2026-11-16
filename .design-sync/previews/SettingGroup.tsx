import { useState, type ReactNode } from 'react'
import {
  CARD,
  ChoiceRow,
  SettingGroup,
  SmallIconButton,
  SwitchRow,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The settings dialog's Performance: choices and a switch, hints under */
export function Performance() {
  const [voices, setVoices] = useState(16)
  const [latency, setLatency] = useState<'low' | 'normal' | 'high'>('normal')
  const [waveform, setWaveform] = useState(true)
  return (
    <Stage>
      <div className={`${CARD} flex max-w-md flex-col gap-3 p-2.5`}>
        <SettingGroup title="Performance">
          <ChoiceRow
            label="Voices"
            options={[8, 12, 16, 24, 32].map((value) => ({
              value,
              label: `${value}`,
            }))}
            value={voices}
            onChange={setVoices}
          />
          <ChoiceRow
            label="Latency"
            hint="Higher gives a slow phone more time for each block, and delays every note. Changing it restarts the audio."
            options={[
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
            ]}
            value={latency}
            onChange={setLatency}
          />
          <SwitchRow label="Waveform" value={waveform} onChange={setWaveform} />
        </SettingGroup>
      </div>
    </Stage>
  )
}

/** The dialog itself: its header, then two groups, a gap between */
export function SettingsDialog() {
  const [appearance, setAppearance] = useState<'system' | 'dark' | 'light'>(
    'dark'
  )
  const [velocity, setVelocity] = useState<'touch' | 'full'>('touch')
  const [awake, setAwake] = useState(true)
  return (
    <Stage>
      <div className={`${CARD} flex max-w-md flex-col gap-1.5 p-2.5`}>
        <div className="flex h-7 items-center justify-end gap-1.5">
          <h2 className="mr-auto min-w-0 truncate px-1 text-[13px] font-semibold text-(--ink-200)">
            Settings
          </h2>
          <SmallIconButton
            label="Close settings"
            onClick={() => undefined}
            path="M5 5l8 8M13 5l-8 8"
          />
        </div>
        <div className="flex flex-col gap-3">
          <SettingGroup title="Look">
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
          </SettingGroup>
          <SettingGroup title="Playing">
            <ChoiceRow
              label="Velocity"
              hint="Touch: lower on a key or a pad plays louder. Full: every note at full velocity."
              options={[
                { value: 'touch', label: 'Touch' },
                { value: 'full', label: 'Full' },
              ]}
              value={velocity}
              onChange={setVelocity}
            />
            <SwitchRow
              label="Keep screen on"
              hint="While the audio runs and this page is in front."
              value={awake}
              onChange={setAwake}
            />
          </SettingGroup>
        </div>
      </div>
    </Stage>
  )
}
