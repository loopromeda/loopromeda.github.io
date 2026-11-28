/**
 * Loopromeda's design system: what a screen of the app is built from, in
 * one place (docs/design-system.md). Three layers, each built on the one
 * before:
 *
 * - Foundations: the tokens (index.css: the surfaces, the inks, the
 *   roles' colours, the light), the face (Recursive, its sans and its
 *   Mono), the themes (ui/theme.ts) and ThemeRoot, which puts one on the
 *   page.
 * - Recipes: the controls' shared sizes and faces as class strings
 *   (ui/controls.ts): a 44 px BUTTON, a 28 px SMALL_BUTTON, an OPTION, a
 *   FIELD, a CARD, a RAISED panel over it, a MENU over that, a knobRow's
 *   grid. Tailwind classes over the tokens, so a screen's own glue reads
 *   as the app's.
 * - Components that stand without the engine: controls (ValueKnob,
 *   Switch, the icon buttons, Dropdown), overlays, settings rows,
 *   navigators, play surfaces (Keys, Pads, KitPads, XyPad, played through
 *   Hands), and panels. The app's knobs of the sound and the mix
 *   (Knob, MixKnob) are ValueKnob's dial with the engine behind it.
 *
 * Built into dist-ds/ (pnpm build:ds, vite.ds.config.ts) for Claude
 * Design (.design-sync/); the app imports its parts from src/ui as ever.
 */
import '@fontsource-variable/recursive/mono.css'
import './ds.css'

// Foundations
export {
  DEFAULT_THEME,
  NEUTRAL,
  SECONDARY,
  THEMES,
  THEME_IDS,
  alpha,
  contrastRatio,
  surfacesOf,
  themeOf,
  type Mode,
  type Palette,
  type Surfaces,
  type Theme,
  type ThemeId,
} from '../ui/theme'
export { useTheme } from '../ui/appearance'
export { ThemeRoot } from '../ui/ThemeRoot'
export type { Appearance } from '../state/settings'

// Recipes
export * from '../ui/controls'

// Controls
export { ValueKnob, neutralArc } from '../ui/Knob'
export {
  clampValue,
  formatValue,
  type Curve,
  type Unit,
  type ValueSpec,
} from '../state/params'
export { Switch } from '../ui/Switch'
export { BarIconButton, IconButton, SmallIconButton } from '../ui/IconButton'
export { Dropdown } from '../ui/Dropdown'

// Overlays
export { Popover } from '../ui/Popover'
export {
  MENU_GLYPHS,
  MenuButton,
  MoreMenu,
  type MenuItem,
} from '../ui/MoreMenu'
export { ConfirmDialog } from '../ui/ConfirmDialog'

// Settings
export {
  ChoiceRow,
  SettingGroup,
  SettingRow,
  SwitchRow,
} from '../ui/SettingRows'

// Layout
export { FadeRow } from '../ui/FadeRow'

// Navigation
export { KeysNavigator } from '../ui/KeysNavigator'
export { RowNavigator } from '../ui/RowNavigator'

// Play: the surfaces, the hands that hold their notes, their geometry
export { Keys } from '../ui/Keys'
export { Pads } from '../ui/Pads'
export { KitPads } from '../ui/KitPads'
export { XyPad } from '../ui/XyPad'
export { Hands, type Player } from '../ui/hands'
export { kitGrid, padGrid, padNote, type PadGrid } from '../viz/pads'
export {
  MIDDLE_C,
  computerStart,
  isBlack,
  keysFit,
  noteName,
  pitchName,
} from '../viz/keyboard'

// Panels
export { OrnamentPanel } from '../ui/OrnamentPanel'
export type { Ornament } from '../dsp/ornament'
export { StepInputPanel } from '../ui/StepInputPanel'
export type { Meter } from '../state/meter'
export { AlgorithmChart } from '../ui/AlgorithmChart'
export { LanePicker } from '../ui/LanePicker'
export type { LaneGroup, LaneKnob } from '../state/lanes'
export { OutputCells } from '../ui/OutputCells'
export type { MasterViewKind } from '../ui/MasterViews'
export { SurfacePicker } from '../ui/SurfacePicker'
export {
  DEFAULT_SURFACE,
  SCALES,
  scaleName,
  scaleSteps,
  type ScaleId,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'

// Toolbar
export { SurfaceButton, SurfaceIcon } from '../ui/SurfaceButton'
export { SettingsButton } from '../ui/SettingsButton'
export { UpdateButton } from '../ui/UpdateButton'
