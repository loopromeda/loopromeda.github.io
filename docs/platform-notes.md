# Platform notes

What real devices actually did. Reports come from the dev server's device
report (`device-reports.jsonl`, `scripts/vite-device-report.ts`); audio
findings are added by hand during the M1 checklist.

## Samsung SM-F971N (Galaxy Z Fold line) · Android 17 · Chrome 156.0.8078.79

2026-11-09, dev server over the tailnet (`tailscale serve`).

| Check             | Result | Note                                                         |
| ----------------- | ------ | ------------------------------------------------------------ |
| Secure context    | yes    | ts.net certificate via `tailscale serve`                     |
| AudioWorklet      | yes    |                                                              |
| Audio Session API | no     | Expected: WebKit only, and Android has no silent-switch mute |
| Web MIDI          | yes    |                                                              |
| Screen Wake Lock  | yes    |                                                              |
| maxTouchPoints    | 5      | Upper bound for simultaneous keys / chords                   |

- The user agent string is reduced (`Android 10; K`); the real model and OS
  version come from User-Agent Client Hints only.
- Client Hints report `mobile: false` on this foldable (large inner screen),
  so layout must not branch on "mobile"; size the play surface from the
  viewport, and expect the aspect ratio to change on fold/unfold (M3).
- Audio behavior (unlock, latency, glitches): not tested yet (M1).
