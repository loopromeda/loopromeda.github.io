/* global console, document, getComputedStyle, process */
// Opens each card at the viewport its first line declares and says whether
// its content fits (no scroll either way) and whether anything spills past
// a cell's edge (an element clipped inside the cell ends where it is cut),
// with the scale Claude Design shows it at (728 x 500 px, never enlarged).
// With --sweep, every grid and column card is drawn too at each width from
// 700 to 1600 px (every 20), 700 and 900 tall, as a pane or a thumbnail
// draws it: any spill or sideways scroll there is listed by its size.
// Run it after a story or a viewport changes, the bundle served:
// node .design-sync/fit.mjs <bundle> <port> [--sweep]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '../.ds-sync/node_modules/playwright/index.mjs'

const args = process.argv.slice(2)
const sweep = args.includes('--sweep')
const [bundle = 'ds-bundle', port] = args.filter((a) => a !== '--sweep')
if (!port)
  throw new Error('usage: node .design-sync/fit.mjs <bundle> <port> [--sweep]')

/** The page's scroll size, and each cell its content runs past (by px) */
const measure = (page) =>
  page.evaluate(() => {
    const de = document.documentElement
    const spill = []
    for (const cell of document.querySelectorAll('.ds-cell')) {
      const r = cell.getBoundingClientRect()
      let right = r.right
      for (const el of cell.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (!b.width) continue
        let edge = b.right
        for (let a = el.parentElement; a && a !== cell; a = a.parentElement)
          if (getComputedStyle(a).overflowX !== 'visible')
            edge = Math.min(edge, a.getBoundingClientRect().right)
        right = Math.max(right, edge)
      }
      if (right - r.right > 1)
        spill.push(
          `${cell.querySelector('h4')?.textContent}+${Math.round(right - r.right)}`
        )
    }
    return { sh: de.scrollHeight, sw: de.scrollWidth, spill }
  })

const browser = await chromium.launch()
let bad = 0
for (const g of readdirSync(join(bundle, 'components')).sort()) {
  for (const n of readdirSync(join(bundle, 'components', g)).sort()) {
    const rel = `components/${g}/${n}/${n}.html`
    const html = readFileSync(join(bundle, rel), 'utf8')
    const mode = /var MODE="(\w+)"/.exec(html)?.[1] ?? ''
    const vp = /viewport="(\d+)x(\d+)"/.exec(html)
    const [w, h] = vp ? [Number(vp[1]), Number(vp[2])] : [900, 700]
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(`http://127.0.0.1:${port}/${rel}`)
    await page.waitForTimeout(500)
    const m = await measure(page)
    const scale = Math.min(1, 728 / w, 500 / h)
    const ok = m.sh <= h && m.sw <= w && !m.spill.length
    if (!ok) bad++
    console.log(
      `${ok ? 'ok ' : 'BAD'} ${n.padEnd(16)} ${mode.padEnd(6)} ${w}x${h} content ${m.sw}x${m.sh} at ${scale.toFixed(2)} ${m.spill.join(' ')}`
    )
    if (sweep && mode !== 'single') {
      const off = []
      for (const height of [700, 900])
        for (let width = 700; width <= 1600; width += 20) {
          await page.setViewportSize({ width, height })
          await page.waitForTimeout(120)
          const s = await measure(page)
          if (s.spill.length || s.sw > width)
            off.push(`${width}x${height} ${s.spill.join(' ') || `sw ${s.sw}`}`)
        }
      if (off.length) bad++
      console.log(`    sweep ${off.length ? off.join(' | ') : 'ok'}`)
    }
    await page.close()
  }
}
await browser.close()
process.exitCode = bad ? 1 : 0
