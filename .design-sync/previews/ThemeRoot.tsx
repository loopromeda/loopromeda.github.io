import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  CARD,
  ChoiceRow,
  KeysNavigator,
  SECTION_HEADING,
  Switch,
  SwitchRow,
  THEMES,
  ThemeRoot,
  ValueKnob,
  knobRow,
  surfacesOf,
  themeOf,
  type Mode,
  type Theme,
  type ThemeId,
  type ValueSpec,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** A chain's level, as the sound's kinds give it */
const LEVEL: ValueSpec = {
  min: 0,
  max: 1,
  default: 0.8,
  curve: 'linear',
  step: 0,
  unit: '%',
}

/** A modulation's depth: two-sided, lit from its zero */
const DEPTH: ValueSpec = {
  min: -1,
  max: 1,
  default: 0,
  curve: 'linear',
  step: 0,
  unit: '%',
}

/**
 * What a theme colours, on real parts: the four chains' knobs (A to D)
 * and a depth in the modulation colour, a switch on in the accent, the
 * appearance chosen, and the keys' navigator framed in the secondary
 */
function Showcase({ id, mode }: { id: ThemeId; mode: Mode }) {
  const theme = themeOf(id)
  const { chains, modulator } = theme[mode]
  const [click, setClick] = useState(true)
  const [appearance, setAppearance] = useState<'system' | 'dark' | 'light'>(
    mode
  )
  const [position, setPosition] = useState(28)
  return (
    <ThemeRoot theme={id} appearance={mode}>
      <Stage>
        <div className={`${CARD} flex w-80 flex-col gap-3 p-2.5`}>
          <h3 className={`px-1 ${SECTION_HEADING}`}>
            {theme.name} · {mode}
          </h3>
          <div className={knobRow(5)}>
            {chains.map((color, i) => (
              <ValueKnob
                key={color}
                label={`Level ${'ABCD'[i]}`}
                spec={LEVEL}
                value={0.35 + i * 0.15}
                color={color}
              />
            ))}
            <ValueKnob
              label="Cutoff"
              spec={DEPTH}
              value={0.55}
              color={modulator}
            />
          </div>
          <SwitchRow
            label="Click"
            hint="Each beat, the bar's first higher."
            value={click}
            onChange={setClick}
          />
          <ChoiceRow
            label="Appearance"
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={appearance}
            onChange={setAppearance}
          />
          <KeysNavigator
            position={position}
            whites={15}
            range="C3 – C5"
            onMove={setPosition}
            className="h-7 w-full"
          />
        </div>
      </Stage>
    </ThemeRoot>
  )
}

/** Default in the dark: the app's own colours, emerald the accent */
export function Default() {
  return <Showcase id="default" mode="dark" />
}

/** Default in the light: data-mode set, the surfaces and inks turned */
export function DefaultLight() {
  return <Showcase id="default" mode="light" />
}

/** Tidal: blue, lime, pink and orange chains, a teal accent */
export function Tidal() {
  return <Showcase id="tidal" mode="dark" />
}

/** Ember: yellow to teal chains, a lavender modulation, orange accent */
export function Ember() {
  return <Showcase id="ember" mode="dark" />
}

/** Neon, a pop theme: its own violet-black surfaces, a laser yellow */
export function Neon() {
  return <Showcase id="neon" mode="dark" />
}

/** Candy, a pop theme: berry-black surfaces, a lemon accent */
export function Candy() {
  return <Showcase id="candy" mode="dark" />
}

/** Arcade, a pop theme: navy surfaces, an orange accent */
export function Arcade() {
  return <Showcase id="arcade" mode="dark" />
}

/**
 * One theme scoped to a panel: its roles and its surfaces set as CSS
 * variables on the panel's element, which its children inherit
 */
function ThemePanel({ theme }: { theme: Theme }) {
  const { chains, accent, secondary, modulator } = theme.dark
  const { page, panel, tile, key, keyBlack } = surfacesOf(theme, 'dark')
  const [click, setClick] = useState(true)
  const [velocity, setVelocity] = useState<'touch' | 'full'>('touch')
  const [position, setPosition] = useState(28)
  const scope = {
    '--accent': accent,
    '--secondary': secondary,
    '--modulator': modulator,
    '--bg': page,
    '--panel': panel,
    '--tile': tile,
    '--key': key,
    '--key-black': keyBlack,
  } as CSSProperties
  return (
    <div style={scope} className="rounded-xl bg-(--bg) p-2">
      <div className={`${CARD} flex flex-col gap-2 p-2.5`}>
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className={SECTION_HEADING}>{theme.name}</h3>
          <Switch
            checked={click}
            onChange={setClick}
            label={`Click, ${theme.name}`}
          />
        </div>
        <div className={knobRow(4)}>
          {chains.map((color, i) => (
            <ValueKnob
              key={color}
              label={`Level ${'ABCD'[i]}`}
              spec={LEVEL}
              value={0.35 + i * 0.15}
              color={color}
            />
          ))}
        </div>
        <ChoiceRow
          label="Velocity"
          options={[
            { value: 'touch', label: 'Touch' },
            { value: 'full', label: 'Full' },
          ]}
          value={velocity}
          onChange={setVelocity}
        />
        <KeysNavigator
          position={position}
          whites={15}
          range="C3 – C5"
          onMove={setPosition}
          className="h-6 w-full"
        />
      </div>
    </div>
  )
}

/**
 * Every theme side by side, each scoped to its own panel: its page and
 * card (a pop theme's tinted), its chains' knobs, the accent's switch and
 * the secondary's frame on the keys' navigator
 */
export function Themes() {
  return (
    <ThemeRoot theme="default" appearance="dark">
      <Stage>
        <div className="grid grid-cols-3 gap-2" style={{ width: '42rem' }}>
          {THEMES.map((theme) => (
            <ThemePanel key={theme.id} theme={theme} />
          ))}
        </div>
      </Stage>
    </ThemeRoot>
  )
}
