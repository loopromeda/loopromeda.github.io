/** What this browser offers the synth */
export interface PlatformReport {
  userAgent: string
  /** Launched from the home screen (installed PWA) */
  standalone: boolean
  /** Tells an iPad, which reports a Mac user agent, from a Mac */
  maxTouchPoints: number
  checks: Record<string, boolean>
}

export function readPlatform(): PlatformReport {
  // navigator.standalone: Safari's own flag for home-screen launches
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    userAgent: navigator.userAgent,
    standalone:
      matchMedia('(display-mode: standalone)').matches ||
      nav.standalone === true,
    maxTouchPoints: navigator.maxTouchPoints,
    checks: {
      // Without a secure context there is no AudioWorklet
      'Secure context': window.isSecureContext,
      AudioWorklet: typeof AudioWorkletNode !== 'undefined',
      // WebKit only: lets Web Audio play through the iOS silent switch
      'Audio Session API': 'audioSession' in navigator,
      'Web MIDI': 'requestMIDIAccess' in navigator,
      'Screen Wake Lock': 'wakeLock' in navigator,
    },
  }
}

/** Chromium's User-Agent Client Hints (not in TypeScript's DOM types) */
interface UADataLike {
  getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>
}

/**
 * Dev only: hands the report to the dev server, which keeps it in
 * device-reports.jsonl (scripts/vite-device-report.ts), so what a phone
 * offers is on record without anyone retyping it. On Chromium it adds the
 * device model and OS version, which the reduced user agent string hides
 * ("Android 10; K" on every Android phone).
 */
export async function sendReport(report: PlatformReport): Promise<void> {
  const nav = navigator as Navigator & { userAgentData?: UADataLike }
  const device = await nav.userAgentData
    ?.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList'])
    .catch(() => undefined)
  await fetch(`${import.meta.env.BASE_URL}__device-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...report, device }),
    keepalive: true,
  }).catch(() => {
    // A report is a convenience; the page works without one
  })
}
