/**
 * Draws the site's icons into public/ from the mark (src/viz/mark.ts):
 * icon.svg (the manifest's icon at any size), favicon.svg (a tab's, on
 * the favicon's grid, in the default theme's colours: the page sets it to
 * the theme's as it runs, appearance.ts), favicon.ico at 32 px from it for
 * browsers that take no SVG, the icon's PNGs at 192 and 512 px, a maskable
 * PNG that Android's launchers cut to their own shapes, and the 180 px
 * apple-touch-icon iOS puts on the home screen.
 *
 * Run by hand when the mark changes: node scripts/icons.ts. The PNGs are
 * drawn by rsvg-convert (librsvg), which has to be on the PATH; they are
 * kept in the repository, so a build needs neither.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_THEME, markInks, themeOf } from '../src/ui/theme.ts'
import { FAVICON_GRID, ICON_GRID, markSvg } from '../src/viz/mark.ts'

/**
 * The icons' colours, as they were first drawn: the page's background
 * (index.css), and the mark's ends, emerald-300 above, emerald-600 below
 * (markInks finds the default theme's near enough to these to see none)
 */
const ICON_INKS = { ground: '#0b0b10', light: '#6ee7b7', deep: '#059669' }

const root = path.join(import.meta.dirname, '..')
const out = (file: string) => path.join(root, 'public', file)
const work = mkdtempSync(path.join(tmpdir(), 'loopromeda-icons-'))

/** Draws svg (a file's text) into a PNG of size px at target, a path */
function png(svg: string, size: number, target: string) {
  const source = path.join(work, `${path.basename(target)}.svg`)
  writeFileSync(source, svg)
  execFileSync('rsvg-convert', [
    '-w',
    `${size}`,
    '-h',
    `${size}`,
    source,
    '-o',
    target,
  ])
}

/**
 * Wraps a PNG of size px (under 256) into an .ico of one image, as every
 * browser since Windows Vista's icons reads it: a 6-byte header, one
 * 16-byte entry, the PNG's bytes
 */
function ico(pngFile: string, size: number, target: string) {
  const image = readFileSync(pngFile)
  const head = Buffer.alloc(22)
  head.writeUInt16LE(1, 2) // an icon, not a cursor
  head.writeUInt16LE(1, 4) // one image
  head.writeUInt8(size, 6) // width
  head.writeUInt8(size, 7) // height
  head.writeUInt16LE(1, 10) // colour planes
  head.writeUInt16LE(32, 12) // bits a pixel
  head.writeUInt32LE(image.length, 14)
  head.writeUInt32LE(head.length, 18) // where the image starts
  writeFileSync(target, Buffer.concat([head, image]))
}

try {
  const rounded = markSvg(ICON_GRID, ICON_INKS)
  writeFileSync(out('icon.svg'), rounded)
  const tab = markSvg(FAVICON_GRID, markInks(themeOf(DEFAULT_THEME), 'dark'))
  writeFileSync(out('favicon.svg'), tab)
  const favicon = path.join(work, 'favicon-32.png')
  png(tab, 32, favicon)
  ico(favicon, 32, out('favicon.ico'))
  png(rounded, 192, out('icon-192.png'))
  png(rounded, 512, out('icon-512.png'))
  // A launcher keeps the circle of 80% in the middle: the loop stands
  // inside it with room to spare
  png(
    markSvg(ICON_GRID, ICON_INKS, { rounded: false, scale: 0.8 }),
    512,
    out('icon-maskable-512.png')
  )
  // iOS rounds the corners itself, and shows any transparency black
  png(
    markSvg(ICON_GRID, ICON_INKS, { rounded: false }),
    180,
    out('apple-touch-icon.png')
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
