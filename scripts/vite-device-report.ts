import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Larger bodies are not reports (src/platform.ts sends well under 1 KB) */
const MAX_BODY = 64 * 1024

/**
 * Dev server only: takes the platform report each page load POSTs
 * (src/platform.ts sendReport) and appends it, timestamped, to `file` in the
 * project root, one JSON object per line. Real phones' findings land on this
 * machine as they are, for docs/platform-notes.md.
 */
export function deviceReport(file = 'device-reports.jsonl'): Plugin {
  return {
    name: 'loopromeda:device-report',
    apply: 'serve',
    configureServer(server) {
      const out = path.resolve(server.config.root, file)
      server.middlewares.use('/__device-report', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => {
          body += chunk
          if (body.length > MAX_BODY) req.destroy()
        })
        req.on('end', () => {
          let report: { userAgent?: unknown }
          try {
            report = JSON.parse(body) as { userAgent?: unknown }
          } catch {
            res.statusCode = 400
            res.end()
            return
          }
          const line = { at: new Date().toISOString(), ...report }
          appendFile(out, JSON.stringify(line) + '\n').then(
            () => {
              server.config.logger.info(
                `device report: ${String(report.userAgent)}`,
                { timestamp: true }
              )
              res.statusCode = 204
              res.end()
            },
            (error: unknown) => {
              server.config.logger.error(`device report: ${String(error)}`)
              res.statusCode = 500
              res.end()
            }
          )
        })
      })
    },
  }
}
