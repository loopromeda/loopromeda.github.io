/* global process, console */
// Writes ds-bundle/.review.html as Claude Design shows the cards: each at
// the viewport its first line declares, scaled into the product's box
// (728 px across, 500 px tall, never enlarged), whole, on the design
// system's own page (styles.css: the tokens and the face). The converter's
// own review page frames every card 340 px tall, cutting most of them off:
// run this after each build. Usage: node .design-sync/review.mjs [bundle]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BOX_W = 728
const BOX_H = 500

const bundle = process.argv[2] ?? 'ds-bundle'
const escape = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`
  )

const groups = new Map()
for (const group of readdirSync(join(bundle, 'components')).sort()) {
  for (const name of readdirSync(join(bundle, 'components', group)).sort()) {
    const rel = `components/${group}/${name}/${name}.html`
    const head = readFileSync(join(bundle, rel), 'utf8').split('\n', 1)[0]
    const label = /group="([^"]*)"/.exec(head)?.[1] ?? group
    const vp = /viewport="(\d+)x(\d+)"/.exec(head)
    const [w, h] = vp ? [Number(vp[1]), Number(vp[2])] : [BOX_W, BOX_H]
    const scale = Math.min(1, BOX_W / w, BOX_H / h)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push({ name, rel, w, h, scale })
  }
}

const card = ({ name, rel, w, h, scale }) => {
  const sw = Math.round(w * scale)
  const sh = Math.round(h * scale)
  const shown = scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''
  return `<figure>
  <figcaption><b>${escape(name)}</b><span>${w} × ${h}${shown}</span></figcaption>
  <div class="frame" style="width:${sw}px;height:${sh}px">
    <iframe src="${escape(rel)}" title="${escape(name)}" loading="lazy" style="width:${w}px;height:${h}px;transform:scale(${scale})"></iframe>
  </div>
</figure>`
}

const total = [...groups.values()].reduce((n, cs) => n + cs.length, 0)
const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>Loopromeda design system: cards</title>
<link rel="stylesheet" href="styles.css">
<style>
  html, body { height: auto; }
  body { margin: 0; padding: 32px 16px 64px; user-select: text; }
  main { max-width: ${BOX_W}px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; color: var(--ink-100); }
  p { margin: 0 0 8px; font-size: 13px; color: var(--ink-400); }
  h2 { margin: 40px 0 12px; font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-500); }
  figure { margin: 0 0 24px; }
  figcaption { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; font-size: 13px; color: var(--ink-200); }
  figcaption span { font-family: var(--font-mono); font-size: 11px; color: var(--ink-500); }
  .frame { overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 1px var(--lift-2); }
  iframe { display: block; border: 0; transform-origin: 0 0; }
</style>
</head><body><main>
<h1>Loopromeda design system</h1>
<p>${total} cards as Claude Design shows them: each at its own size, scaled into a ${BOX_W} × ${BOX_H} box, never cut.</p>
${[...groups.entries()]
  .map(([g, cs]) => `<h2>${escape(g)}</h2>\n${cs.map(card).join('\n')}`)
  .join('\n')}
</main></body></html>
`
writeFileSync(join(bundle, '.review.html'), html)
console.log(`wrote ${join(bundle, '.review.html')}: ${total} cards`)
