/**
 * Draws the site's icons into public/: icon.svg (the favicon, and the
 * manifest's icon at any size), favicon.ico at 32 px for browsers that
 * take no SVG, its PNGs at 192 and 512 px, a maskable
 * PNG that Android's launchers cut to their own shapes, and the 180 px
 * apple-touch-icon iOS puts on the home screen. The mark: an infinity
 * leaning at 45 degrees (a loop, and an 8 tipped over), its loops two
 * rounded squares, in emerald that darkens a little from its upper end to
 * its lower.
 *
 * Run by hand when the mark changes: node scripts/icons.ts. The PNGs are
 * drawn by rsvg-convert (librsvg), which has to be on the PATH; they are
 * kept in the repository, so a build needs neither.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** The page's background (index.css) and the manifest's colours */
const BACKGROUND = '#0b0b10'
/** The mark's ends: emerald-300 above, emerald-600 below */
const LIGHT = '#6ee7b7'
const DEEP = '#059669'

/** Every icon is drawn on 512 units */
const SIZE = 512
const CENTRE = SIZE / 2

const fixed = (n: number) => n.toFixed(1)

/**
 * The mark at scale (1 fills a rounded icon, less leaves the margin a
 * launcher's mask may cut): two rounded squares meeting corner to corner
 * in the middle, up and to the right of each other, drawn as one stroke
 * that crosses itself there, the upright strand over the level one (a
 * gap of the background either side of it). Its colour shades along the
 * diagonal.
 */
function mark(scale: number): string {
  /** Each loop's side, along the middle of the stroke */
  const side = 146 * scale
  const corner = 66 * scale
  const stroke = 72 * scale
  const gap = 13 * scale
  const c = CENTRE
  // A quarter turn: right (clockwise) round the upper loop, left round
  // the lower, as a figure of eight goes
  const turn = (right: boolean, x: number, y: number) =>
    `A${fixed(corner)} ${fixed(corner)} 0 0 ${right ? 1 : 0} ${fixed(x)} ${fixed(y)}`
  const path = [
    // Up the upper loop's left side from the crossing, round it, and back
    // along its foot
    `M${c} ${c}V${fixed(c - side + corner)}`,
    turn(true, c + corner, c - side),
    `H${fixed(c + side - corner)}`,
    turn(true, c + side, c - side + corner),
    `V${fixed(c - corner)}`,
    turn(true, c + side - corner, c),
    // On through the crossing along the lower loop's top, round it, and
    // up its right side to the crossing
    `H${fixed(c - side + corner)}`,
    turn(false, c - side, c + corner),
    `V${fixed(c + side - corner)}`,
    turn(false, c - side + corner, c + side),
    `H${fixed(c - corner)}`,
    turn(false, c, c + side - corner),
    'Z',
  ].join('')
  // The gap cuts only the level strand; the upright one drawn over it
  // runs further, so that no seam shows where the gap ends
  const cut = stroke / 2 + gap
  const gapPath = `M${c} ${fixed(c + cut)}V${fixed(c - cut)}`
  const over = `M${c} ${fixed(c + stroke)}V${fixed(c - stroke)}`
  return [
    '<defs><linearGradient id="ink" gradientUnits="userSpaceOnUse"',
    ` x1="${fixed(c + side)}" y1="${fixed(c - side)}"`,
    ` x2="${fixed(c - side)}" y2="${fixed(c + side)}">`,
    `<stop offset="0" stop-color="${LIGHT}"/>`,
    `<stop offset="1" stop-color="${DEEP}"/>`,
    '</linearGradient></defs>',
    `<path d="${path}" fill="none" stroke="url(#ink)"`,
    ` stroke-width="${fixed(stroke)}" stroke-linejoin="round"/>`,
    `<path d="${gapPath}" stroke="${BACKGROUND}"`,
    ` stroke-width="${fixed(stroke + 2 * gap)}"/>`,
    `<path d="${over}" stroke="url(#ink)" stroke-width="${fixed(stroke)}"/>`,
  ].join('')
}

/**
 * An icon: rounded, its corners clear (a favicon, a manifest icon), or
 * square to the edge for a platform that cuts its own shape
 */
function icon({ rounded, scale }: { rounded: boolean; scale: number }) {
  const corner = rounded ? ' rx="112"' : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}"${corner} fill="${BACKGROUND}"/>` +
    `${mark(scale)}</svg>\n`
  )
}

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
  const rounded = icon({ rounded: true, scale: 1 })
  writeFileSync(out('icon.svg'), rounded)
  const favicon = path.join(work, 'favicon-32.png')
  png(rounded, 32, favicon)
  ico(favicon, 32, out('favicon.ico'))
  png(rounded, 192, out('icon-192.png'))
  png(rounded, 512, out('icon-512.png'))
  // A launcher keeps the circle of 80% in the middle: the loop stands
  // inside it with room to spare
  png(icon({ rounded: false, scale: 0.8 }), 512, out('icon-maskable-512.png'))
  // iOS rounds the corners itself, and shows any transparency black
  png(icon({ rounded: false, scale: 1 }), 180, out('apple-touch-icon.png'))
} finally {
  rmSync(work, { recursive: true, force: true })
}
