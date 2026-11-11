/**
 * What opens over the controls (the settings as a dialog over everything),
 * each a page of its own: its address is the URL's hash (#/presets), so a
 * reload opens it again and Back closes it. A hash needs nothing of the
 * server that serves the page.
 */
export const SHEETS = ['presets', 'surface', 'settings'] as const

export type Sheet = (typeof SHEETS)[number]

/** The sheet a hash names, if any ("#/presets", or "#presets") */
export function sheetOf(hash: string): Sheet | null {
  const name = hash.replace(/^#\/?/, '')
  return (SHEETS as readonly string[]).includes(name) ? (name as Sheet) : null
}

/** A sheet's hash; none for the controls themselves */
export function hashOf(sheet: Sheet | null): string {
  return sheet === null ? '' : `#/${sheet}`
}
