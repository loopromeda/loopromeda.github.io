/**
 * The player's own settings: how hard the phone is asked to work, how a
 * key or a pad answers a touch, and what the screen shows about the audio.
 * These belong to the player and the phone they hold rather than to a
 * preset, so they are kept apart from the sound.
 */

// theme.ts is pure data, so the state reading it is safe
import { DEFAULT_THEME, isThemeId, type ThemeId } from '../ui/theme'

/** Voice counts the player may limit the synth to; the last is VOICE_COUNT */
export const VOICE_LIMITS = [4, 8, 12, 16] as const
export type VoiceLimit = (typeof VOICE_LIMITS)[number]

/** AudioContext latencyHint values, lowest latency first */
export const LATENCIES = ['interactive', 'balanced', 'playback'] as const
export type Latency = (typeof LATENCIES)[number]

/** How a touch sets a note's velocity: where it lands, or always full */
export const VELOCITY_MODES = ['touch', 'full'] as const
export type VelocityMode = (typeof VELOCITY_MODES)[number]

/**
 * The tone the page is drawn in: the device's (light or dark as it is
 * set, and as it changes), or dark or light whatever the device says
 */
export const APPEARANCES = ['system', 'dark', 'light'] as const
export type Appearance = (typeof APPEARANCES)[number]

export interface AppSettings {
  /** The most voices the synth plays at once (fewer for a slow phone) */
  readonly voices: VoiceLimit
  /**
   * The AudioContext's latencyHint: higher gives more time per block, and
   * more delay
   */
  readonly latency: Latency
  /** The output waveform is drawn, in the amp's tile */
  readonly waveform: boolean
  /**
   * touch: where a finger lands on a key or pad sets velocity;
   * full: every note at full velocity
   */
  readonly velocity: VelocityMode
  /**
   * The app's colour roles — the chains, the modulation colour, the
   * accent — as one theme (src/ui/theme.ts)
   */
  readonly theme: ThemeId
  /**
   * Dark, light or the device's: the surfaces, the inks and the theme's
   * values for that tone. Dark when nothing was chosen, the app's home.
   */
  readonly appearance: Appearance
  /** The status line shows sample rate, block and latency */
  readonly audioDetails: boolean
  /** The waveform shows what a frame costs to draw */
  readonly waveformTiming: boolean
  /** The screen stays on while the audio runs (src/wakeLock.ts) */
  readonly keepAwake: boolean
}

/** The whole synth at once, the lowest delay, everything shown */
export const DEFAULT_SETTINGS: AppSettings = {
  voices: 16,
  latency: 'interactive',
  waveform: true,
  velocity: 'touch',
  theme: DEFAULT_THEME,
  appearance: 'dark',
  audioDetails: true,
  waveformTiming: true,
  keepAwake: true,
}

/** Where the settings are kept */
export const SETTINGS_KEY = 'loopromeda.settings'

/** The part of Web Storage the settings use (localStorage) */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * The settings kept in storage: whatever is stored well, with a default for
 * every field that is missing or wrong, and the defaults whole when the
 * whole is not an object at all
 */
export function readSettings(storage?: SettingsStorage): AppSettings {
  let text: string | null
  try {
    text = storage?.getItem(SETTINGS_KEY) ?? null
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
  if (text === null) return { ...DEFAULT_SETTINGS }

  let saved: unknown
  try {
    saved = JSON.parse(text)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
    return { ...DEFAULT_SETTINGS }
  }

  const {
    voices,
    latency,
    waveform,
    velocity,
    theme,
    appearance,
    audioDetails,
    waveformTiming,
    keepAwake,
  } = saved as {
    voices: unknown
    latency: unknown
    waveform: unknown
    velocity: unknown
    theme: unknown
    appearance: unknown
    audioDetails: unknown
    waveformTiming: unknown
    keepAwake: unknown
  }
  return {
    voices: isVoiceLimit(voices) ? voices : DEFAULT_SETTINGS.voices,
    latency: isLatency(latency) ? latency : DEFAULT_SETTINGS.latency,
    waveform:
      typeof waveform === 'boolean' ? waveform : DEFAULT_SETTINGS.waveform,
    velocity: isVelocityMode(velocity) ? velocity : DEFAULT_SETTINGS.velocity,
    theme: isThemeId(theme) ? theme : DEFAULT_SETTINGS.theme,
    appearance: isAppearance(appearance)
      ? appearance
      : DEFAULT_SETTINGS.appearance,
    audioDetails:
      typeof audioDetails === 'boolean'
        ? audioDetails
        : DEFAULT_SETTINGS.audioDetails,
    waveformTiming:
      typeof waveformTiming === 'boolean'
        ? waveformTiming
        : DEFAULT_SETTINGS.waveformTiming,
    keepAwake:
      typeof keepAwake === 'boolean' ? keepAwake : DEFAULT_SETTINGS.keepAwake,
  }
}

/**
 * Keep the settings in storage, the version alongside them. Failing to
 * write is ignored: a convenience setting is no reason to spoil playing.
 */
export function writeSettings(
  storage: SettingsStorage | undefined,
  settings: AppSettings
): void {
  if (!storage) return
  try {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        version: 1,
        voices: settings.voices,
        latency: settings.latency,
        waveform: settings.waveform,
        velocity: settings.velocity,
        theme: settings.theme,
        appearance: settings.appearance,
        audioDetails: settings.audioDetails,
        waveformTiming: settings.waveformTiming,
        keepAwake: settings.keepAwake,
      })
    )
  } catch {
    // A full storage, or a private window that refuses writes
  }
}

/** True for one of the voice counts the player may choose */
function isVoiceLimit(value: unknown): value is VoiceLimit {
  return VOICE_LIMITS.some((limit) => limit === value)
}

/** True for one of the latencyHint values */
function isLatency(value: unknown): value is Latency {
  return LATENCIES.some((latency) => latency === value)
}

/** True for one of the velocity modes */
function isVelocityMode(value: unknown): value is VelocityMode {
  return VELOCITY_MODES.some((mode) => mode === value)
}

function isAppearance(value: unknown): value is Appearance {
  return APPEARANCES.some((appearance) => appearance === value)
}
