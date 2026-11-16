/* global process, console */
// Checks that every Tailwind class written in the given files (className
// strings and template literals) exists in the compiled DS stylesheet
// (dist-ds/styles.css). It holds the classes the repo uses and the
// vocabulary src/ds/ds.css adds; a preview (or the conventions file) naming
// a class outside both would render unstyled.
// Usage: node .design-sync/classcheck.mjs <file>... [--css path]
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const ci = args.indexOf('--css')
const cssPath = ci >= 0 ? args.splice(ci, 2)[1] : 'dist-ds/styles.css'
const css = readFileSync(cssPath, 'utf8')
const escape = (c) => c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
const has = (c) => {
  const e = '.' + escape(c)
  let i = css.indexOf(e)
  while (i >= 0) {
    const next = css[i + e.length]
    if (next === undefined || /[\s{,:.[>)~+]/.test(next)) return true
    i = css.indexOf(e, i + 1)
  }
  return false
}
let missing = 0
for (const f of args) {
  const src = readFileSync(f, 'utf8')
  const strings = [
    ...src.matchAll(/className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g),
  ].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' '))
  const seen = new Set()
  for (const s of strings) {
    for (const c of s.split(/\s+/).filter(Boolean)) {
      if (seen.has(c)) continue
      seen.add(c)
      if (!has(c)) {
        missing++
        console.log(`${f}: missing class ${c}`)
      }
    }
  }
}
if (!missing)
  console.log(`ok: every class in ${args.length} file(s) is in ${cssPath}`)
process.exit(missing ? 1 : 0)
