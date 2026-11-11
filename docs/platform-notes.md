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
- Audio start (M1 test tone), 2026-11-09: the engine went from the tap to
  `running` in 41 ms. Reported at 48000 Hz: `baseLatency` 3 ms,
  `outputLatency` 0 ms at first and 24 ms two seconds later (it settles once
  audio flows), so about 27 ms from the context to the speaker, before touch
  input latency. Whether the tone sounded, and lock / background / other-app
  behavior: not checked yet.
- Keyboard, 2026-11-10: through the built-in speaker the touch-to-sound
  latency feels negligible; through Bluetooth earphones it is clearly late
  (ashon, by ear; not measured). Chrome reported `baseLatency` 3 ms and
  `outputLatency` 8 ms once settled. Right at `running` it twice read
  240-248 ms for about two seconds before settling, so the first reading is
  not to be trusted. Whether `outputLatency` includes the Bluetooth delay on
  this device: not checked.
- Long press, 2026-11-11 (Chrome 157): Android's own long press comes
  just after the app's 450 ms hold, on whatever stands under the finger
  by then. Holding a knob put its routes in the panel's place, and the
  long press then selected the text of the route card's "via" select and
  opened the copy menu (ashon). A held touch now opens no menu and
  selects nothing until it lets go (`src/ui/held.ts`), and a select's
  label is never selectable.
- `outputLatency`, 2026-11-11 (Chrome 157): after a reload it read 42 s
  at `running`, then fell by about 0.7 s each second (36.8 s after eight
  seconds; the status line showed 26867 ms a little later). Before that
  reload it had read 24 ms. The audio sounded as usual, so the reading,
  not the output, was wrong.

## Desktop baseline: macOS · Chrome (desktop)

2026-11-09, `127.0.0.1:5173` (dev) and `vite preview` (production build): the
worklet loads in both; 48000 Hz, `baseLatency` 5.3 ms, `outputLatency` 32 ms
(built-in output). No console errors.
