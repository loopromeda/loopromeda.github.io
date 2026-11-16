import type { ReactNode } from 'react'
import type { Appearance } from '../state/settings'
import { useTheme } from './appearance'
import { DEFAULT_THEME, type ThemeId } from './theme'

/**
 * The page in a theme and an appearance, for a screen built of the
 * design system (src/ds): the roles' colours (the accent, the secondary,
 * the modulation colour), a pop theme's tinted surfaces, the mode that
 * turns index.css's surfaces and inks to the light, the browser's bar and
 * the tab's icon, set on the page before paint as the app sets them
 * (useTheme). Without it the page wears the Default theme in the dark,
 * index.css's first paint. Its children as they are: one, at the root.
 *
 * @category Theme
 */
export function ThemeRoot({
  theme = DEFAULT_THEME,
  appearance = 'dark',
  children,
}: {
  /** One of THEMES: default, tidal, ember, orchard, neon, candy, arcade */
  theme?: ThemeId
  /** Dark, light, or the device's (system) */
  appearance?: Appearance
  children?: ReactNode
}) {
  useTheme(theme, appearance)
  return children
}
