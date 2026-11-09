# Loopromeda — Initial Setup Plan

A polyphonic synthesizer that runs in mobile browsers (iOS Safari, Android Chrome),
played by touch, installable as a PWA.

Status: **accepted, 2026-11-09** — the recommended defaults in §7 were confirmed;
development runs over the tailnet (`tailscale serve`) instead of LAN + mkcert.

---

## 1. Guiding principles

1. **Riskiest thing first.** Getting sound out of a phone reliably (silent switch,
   unlock gesture, glitches, latency) is the main technical risk. Prove it on real
   devices before building features (M1).
2. **Audio thread owns time.** All DSP and all timing (envelopes, later the
   sequencer clock) run inside one `AudioWorkletProcessor`. The main thread only
   sends intents (note on/off, param changes). Main-thread jank on phones must
   never be audible.
3. **DSP is plain TypeScript with no Web Audio dependency.** `src/dsp` is pure code
   that renders `Float32Array` blocks. That makes it unit-testable in Node, lets us
   render WAV files offline to listen to, and could be swapped for Rust/WASM later.
4. **One parameter schema.** Every parameter (id, range, default, curve, unit) is
   declared once and drives the UI knobs, the worklet, and preset serialization.
5. **Follow the house stack.** Same toolchain as the other repos (pnpm, Vite, React,
   TS, Tailwind v4, ESLint + Prettier, vitest, Playwright), so nothing new to learn
   except the audio parts.

## 2. Proposed stack

| Area                   | Choice                                                        | Why / notes                                                                                                                               |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager        | pnpm                                                          | House standard                                                                                                                            |
| Build                  | Vite + TypeScript (strict)                                    | Worklet bundled separately via `?worker&url` (verify dev **and** build in M1)                                                             |
| UI                     | React 19 + Tailwind v4                                        | House standard. Real-time paths (knob drag, keys) bypass React state: refs + pointer events, push straight to the engine, repaint via rAF |
| State                  | Small external store + `useSyncExternalStore`                 | No extra dependency needed yet                                                                                                            |
| Audio                  | Single `AudioWorkletNode`, custom DSP in TS                   | No Tone.js (main-thread scheduling, heavy, less control). Native-node graph rejected: per-voice node churn, limited per-sample modulation |
| Main→worklet transport | `port.postMessage` with a typed message union                 | SharedArrayBuffer ring buffer deferred: needs COOP/COEP headers (not possible on GitHub Pages), not needed for UI-rate events             |
| Unit tests             | vitest (DSP, param schema, presets)                           | Offline render: pitch via zero-crossings, envelope timing, no NaN/denormals, voice stealing                                               |
| E2E                    | Playwright smoke (desktop + mobile emulation)                 | Real-device checklist stays manual; emulation cannot reproduce mobile audio behavior                                                      |
| PWA                    | `vite-plugin-pwa`                                             | Manifest + offline (M4)                                                                                                                   |
| Hosting                | GitHub Pages via Actions                                      | HTTPS is mandatory (AudioWorklet needs a secure context). Move to Cloudflare Pages only if we ever need custom headers                    |
| Dev on phones          | `tailscale serve` → `https://<machine>.<tailnet>.ts.net:5173` | Real certificate, so no local CA to trust on each phone; works off the home LAN too. Vite stays on `127.0.0.1:5173`                       |
| Escape hatch           | Capacitor wrapper                                             | Only if pure web can't deliver on iOS (background audio, native audio session, MIDI) — already a known path from pacenote-mobile          |

## 3. Architecture

```
 UI (React, main thread)                 Audio thread
 ┌──────────────────────────┐           ┌───────────────────────────────┐
 │ Keyboard / Pads (touch)  │  noteOn   │ SynthProcessor (worklet)      │
 │ Knobs / Sliders          │ ────────▶ │  decode messages              │
 │ Presets                  │  param    │  dsp/Synth.process(block)     │
 │        │                 │           │   ├─ VoiceAllocator (8 voices)│
 │        ▼                 │           │   ├─ Voice: Osc→Filter→Amp    │
 │ engine/ (AudioContext,   │ ◀──────── │   │        ▲ ADSR  ▲ ADSR     │
 │  unlock, node, latency)  │  meters   │   └─ Master gain + soft clip  │
 └──────────────────────────┘           └───────────────────────────────┘
          ▲
   state/params.ts — single schema: id, min, max, default, curve, unit
```

Message protocol (sketch):

```ts
type ToWorklet =
  | { t: 'noteOn'; id: number; note: number; vel: number } // id = pointerId-derived
  | { t: 'noteOff'; id: number }
  | { t: 'param'; id: ParamId; value: number } // normalized 0..1 → schema maps
  | { t: 'panic' }
```

Worklet rules: no allocation in `process()`, preallocated voice buffers, param
smoothing (no zipper noise), denormal guard, read `sampleRate` (never hardcode 44.1/48k).

### Directory layout

```
loopromeda/
├─ src/
│  ├─ dsp/        # pure DSP: osc (polyBLEP), adsr, svf filter, voice, allocator, synth
│  ├─ worklet/    # AudioWorkletProcessor wrapping dsp/synth + message decoding
│  ├─ engine/     # AudioContext lifecycle, unlock, audioSession, node wiring, latency info
│  ├─ state/      # params schema, store, presets (versioned JSON)
│  ├─ ui/         # Keyboard, Knob, Slider, Panel, StartOverlay, DebugHUD
│  └─ main.tsx
├─ scripts/render-wav.ts   # offline render of a note/chord to WAV for listening
├─ e2e/                    # Playwright smoke tests
├─ docs/
│  ├─ plan/initial-setup.md
│  └─ platform-notes.md    # what real devices actually did (filled in during M1)
└─ .github/workflows/      # ci.yml (typecheck, lint, test, build), deploy.yml (Pages)
```

## 4. Milestones

Size: S ≈ hours, M ≈ a day, L ≈ several days. Tasks marked **[oc]** are small and
well-specified: delegate to opencode (project rule), then verify with tests.

### M0 — Repo bootstrap (S)

- [x] `git init`, `.gitignore`, `.editorconfig`, `packageManager` + `engines` pin
- [x] Vite + React + TS strict scaffold, Tailwind v4
- [x] ESLint (flat config) + Prettier, same style as sibling repos (done
      directly: the opencode wrapper needs a first commit to diff against)
- [x] vitest config + one trivial test
- [x] GitHub Actions: `ci.yml` (typecheck, lint, test, build) — written and
      actionlint-clean, not run yet (no remote)
- [x] GitHub Pages deploy workflow (`base` path set for the project page) — same
- [x] HTTPS dev over the tailnet: `pnpm dev:tailnet` (`scripts/tailnet.sh` +
      `tailscale serve`); phones only need the Tailscale app
- [x] Dev-only device report: each page load records what the browser offers in
      `device-reports.jsonl` (`scripts/vite-device-report.ts`)
- [x] Project `CLAUDE.md` (commands, architecture rules from §3) and `README.md`

**Exit:** a phone on the tailnet opens `https://<machine>.<tailnet>.ts.net:5173` as a
secure context — **met 2026-11-09** (Galaxy Z Fold line, Android 17, Chrome 156;
see `docs/platform-notes.md`). The Pages URL and green CI wait for a remote.

### M1 — Audio spike on real devices (M) — _highest risk_

- [ ] "Tap to start" overlay: create/resume `AudioContext` inside the pointer handler
- [ ] iOS: feature-detect and set `navigator.audioSession.type = 'playback'` so the
      silent switch doesn't mute us; fallback: silent looping `<audio>` unmute trick
- [ ] Load worklet via `?worker&url`; worklet plays a sine on one big touch pad
- [ ] Handle `statechange` (incl. Safari's `interrupted`) and `visibilitychange` → resume
- [ ] DebugHUD: `sampleRate`, `baseLatency`, `outputLatency`, context state
- [ ] Real-device checklist (iPhone Safari, Android Chrome, plus installed-PWA mode):
      sound with silent switch on, after lock/unlock, after a phone call / other app
      audio, after backgrounding; touch-to-sound latency feel; glitches under load
- [ ] Record findings in `docs/platform-notes.md`; debug via Safari Web Inspector
      (iOS) and `chrome://inspect` + the WebAudio panel (Android)

**Exit:** reliable sound on both platforms with the silent switch on; latency numbers
recorded; any blocker found here can still change §2 (e.g. Capacitor for iOS).

### M2 — Synth core DSP (L)

- [ ] Oscillators: sine, polyBLEP saw/square, triangle; detune; noise **[oc for sine/noise]**
- [ ] ADSR (amp + filter env), exponential segments **[oc]**
- [ ] State-variable filter (LP/HP/BP) with resonance and env/keytrack amount
- [ ] 8-voice allocator with oldest-note stealing and click-free release
- [ ] Param smoothing, master gain, soft clipper
- [ ] `params.ts` schema (single source) + normalized↔real mapping tests **[oc]**
- [ ] `scripts/render-wav.ts` (WAV writer **[oc]**) for listening checks
- [ ] Node micro-benchmark: block render time for 8 voices (budget: one 128-frame
      block at 48 kHz = 2.67 ms; aim well under a third of that)

**Exit:** vitest green (pitch, envelope timing, no NaN, stealing), WAV renders sound
right, benchmark within budget.

### M3 — Mobile playing UI (L)

- [ ] Multi-touch keyboard: pointer events, `pointerId`→voice map, pointer capture,
      octave shift; optional scale-locked pad mode
- [ ] Knob/Slider components: vertical drag, fine-adjust, double-tap reset; values go
      straight to the engine, React only for structure
- [ ] Layout: landscape-first for playing, portrait for editing; `viewport-fit=cover` + safe-area insets
- [ ] Kill browser gestures on play surfaces: `touch-action: none`, no double-tap zoom,
      no text selection / iOS long-press callout, keep away from edge-swipe zones
- [ ] Playwright smoke: page loads, start overlay unlocks, keys respond (mobile emulation)

**Exit:** 3+ finger chords play with no scrolling or zooming, UI stays smooth while
dragging knobs during notes.

### M4 — Presets & PWA (M)

- [ ] Factory presets (versioned JSON) + user presets in `localStorage`/IndexedDB
- [ ] `vite-plugin-pwa`: manifest, icons, offline cache
- [ ] Screen Wake Lock while the instrument is open (feature-detected)

**Exit:** installs to the home screen, works offline, presets survive reloads.

### M5 — The "loop" (L) — _needs decision §7.2_

- [ ] Clock inside the worklet (sample-accurate), tempo, transport
- [ ] Either a step sequencer (pattern loop) or a live loop recorder (record notes,
      overdub) — or both, sequenced in this order
- [ ] Pattern save/load alongside presets

### Backlog (post-MVP)

Effects (delay, chorus, reverb) · Web MIDI as progressive enhancement (Android/desktop
only — iOS Safari has no Web MIDI) · audio export (offline render to WAV) · more synthesis
types · Rust/WASM DSP port if the benchmark demands it · Capacitor build if §7.4 says so.

## 5. Risks

| Risk                                                                 | Mitigation                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| iOS mutes Web Audio under the silent switch                          | `audioSession.type = 'playback'` (iOS 17+), silent `<audio>` fallback; verify in M1     |
| iOS suspends audio when backgrounded (reported even with `playback`) | Resume on return; accept for a web instrument; Capacitor if background play is required |
| Glitches on low/mid-range Android                                    | Single worklet, zero allocation in `process()`, voice cap, benchmark + WebAudio panel   |
| Simulators/emulation lie about mobile audio                          | Real-device checklist is a required gate for M1 and M3                                  |
| AudioWorklet needs a secure context                                  | HTTPS everywhere, including dev (`tailscale serve` certificate)                         |
| Gesture conflicts (zoom, scroll, edge swipes, callouts)              | CSS + pointer capture in M3, tested on devices                                          |
| No Web MIDI on iOS                                                   | Treat MIDI as optional enhancement, never a core path                                   |

## 6. Definition of done for "initial setup"

M0 + M1 complete: repo, CI, deploy, HTTPS LAN dev, and a verified answer to "does
our audio architecture work on the phones we care about", written down in
`docs/platform-notes.md`. Everything after that is feature work on a proven base.

## 7. Decisions

Confirmed 2026-11-09 (the recommended defaults):

1. **Synthesis** — subtractive / virtual analog first. The voice skeleton
   (osc → filter → amp, envelopes, allocator) is the base for later oscillator
   types: wavetable next, then 2-operator FM if wanted. Sampling stays out unless
   the loop recorder needs it.
2. **"Loop"** — step sequencer (pattern loop) first; a live loop recorder may follow.
3. **Hosting** — GitHub Pages (project page under `/loopromeda/`), later:
   development stays local for now (no remote, nothing pushed), per ashon
   2026-11-09. The workflows are ready for when a repository exists.
4. **iOS delivery** — pure web/PWA first; Capacitor only if M1 forces it.
5. **Minimum targets** — iOS 17+ Safari, the last 2 major Android Chrome versions.
6. **Dev environment** — over the tailnet with `tailscale serve`.

Still open:

- **Test devices** — Android: Galaxy Z Fold line (SM-F971N). iPhone: not yet
  known (M1 checklist).
