import { useLayoutEffect, useSyncExternalStore } from 'react'
import type { Appearance } from '../state/settings'
import {
  ground,
  palette,
  setTheme,
  surfaces,
  type Mode,
  type ThemeId,
} from './theme'

/** The device asking for the light */
const LIGHT = '(prefers-color-scheme: light)'

function subscribe(changed: () => void): () => void {
  const query = window.matchMedia?.(LIGHT)
  query?.addEventListener('change', changed)
  return () => query?.removeEventListener('change', changed)
}

const deviceLight = () => window.matchMedia?.(LIGHT).matches ?? false

/**
 * The theme and the tone the page is drawn in, set where the settings are
 * read (App): the palette and the ground JS draws with at once, in the
 * render (src/ui/theme.ts), so the render that follows a change reads
 * them; the page's mode (index.css's tokens), the roles' colours, the
 * surfaces (a pop theme's own, tinted) and the browser's bar before
 * paint, so that no frame shows the old ones. The
 * system appearance follows the device, as it changes too. Returns the
 * mode.
 */
export function useTheme(theme: ThemeId, appearance: Appearance): Mode {
  const light = useSyncExternalStore(subscribe, deviceLight, () => false)
  const mode: Mode =
    appearance === 'system' ? (light ? 'light' : 'dark') : appearance
  setTheme(theme, mode)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.mode = mode
    root.style.setProperty('--accent', palette().accent)
    root.style.setProperty('--secondary', palette().secondary)
    root.style.setProperty('--modulator', palette().modulator)
    const { page, panel, tile, key, keyBlack } = surfaces()
    root.style.setProperty('--bg', page)
    root.style.setProperty('--panel', panel)
    root.style.setProperty('--tile', tile)
    root.style.setProperty('--key', key)
    root.style.setProperty('--key-black', keyBlack)
    // Android's bar wears the page's colour, its letters chosen to read
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', ground().page)
  }, [theme, mode])
  return mode
}
