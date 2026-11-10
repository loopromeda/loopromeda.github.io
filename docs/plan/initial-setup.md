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
  | { t: 'param'; id: ParamId; value: number } // in the param's own units
  | { t: 'panic' }
```

Worklet rules: no allocation in `process()`, preallocated voice buffers, param
smoothing (no zipper noise), denormal guard, read `sampleRate` (never hardcode 44.1/48k).

Parameter values travel in their own units (semitones, cents, 0..1 level),
not as knob positions: presets stay readable, and the audio thread never
needs a knob's curve. A knob maps its travel to a value with the schema
(`toValue`/`toNormalized`), and the engine keeps the main thread's copy of
every value and sends them all to a new worklet.

### Instruments are patches, not code

One voice implementation makes every instrument; an instrument is data.
Confirmed with ashon 2026-11-09.

```
Patch   parameter values (versioned JSON, the §1.4 schema)   bass, pad, kick…
Part    one Patch + its own voice pool                      a sequencer track
Voice   osc ×2 + noise → filter → amp, envelopes, LFO       the only DSP code
Engine  N Parts → mixer → effects, all in the one worklet
```

- New sounds are new presets, never new DSP code.
- Several Parts at once make the synth multitimbral: each sequencer track (M5)
  plays its own Part.
- The voice carries enough blocks to span the instruments the step sequencer
  needs: two oscillators with detune, noise, filter envelope, **pitch
  envelope** (kicks, plucks), LFO, glide, velocity. With noise + high-pass a
  patch makes hats and snares; a pitch-swept sine makes a kick.
- Out of reach for this voice: realistic acoustic instruments (sampling or
  physical modelling); bells and electric pianos wait for the FM oscillator.
- Fixed architecture, not user patching: a modular cable UI does not fit a
  phone screen. A small modulation matrix can open it up later.
- CPU budget is voices × Parts: one global voice cap, checked by the M2
  benchmark. Drums may move to a lighter dedicated voice only if that
  benchmark says so.

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

- [x] "Tap to start" screen: create/resume `AudioContext` inside the **click**
      (on touch screens pointerdown is not a user activation; click is)
- [x] iOS: feature-detect and set `navigator.audioSession.type = 'playback'` so the
      silent switch doesn't mute us — written, untested until an iPhone tries it
- [ ] Fallback if that is not enough: silent looping `<audio>` unmute trick
- [x] Load worklet via `?worker&url`; worklet plays a sine on one big touch pad —
      loads in dev and in the production build (desktop Chrome, 2026-11-09)
- [x] Handle `statechange` (incl. Safari's `interrupted`) and `visibilitychange` → resume
- [x] DebugHUD: `sampleRate`, `baseLatency`, `outputLatency`, context state; every
      engine state change also lands in `device-reports.jsonl`. Since
      2026-11-10, asked for by ashon, a one-line status bar under the
      keyboard (`src/ui/StatusBar.tsx`); the base/output split is its title
- [ ] Real-device checklist (iPhone Safari, Android Chrome, plus installed-PWA mode):
      sound with silent switch on, after lock/unlock, after a phone call / other app
      audio, after backgrounding; touch-to-sound latency feel; glitches under load
- [ ] Record findings in `docs/platform-notes.md`; debug via Safari Web Inspector
      (iOS) and `chrome://inspect` + the WebAudio panel (Android)

**Exit:** reliable sound on both platforms with the silent switch on; latency numbers
recorded; any blocker found here can still change §2 (e.g. Capacitor for iOS).

### M2 — Synth core DSP (L)

Order, decided by ashon 2026-11-10: the voice's sound blocks come before
presets (M4), so presets start from a voice that can make the instruments.
Filter and filter envelope first (the widest change in sound), then the
second oscillator with detune and noise, the pitch envelope, the LFO, glide
and velocity.

- [ ] Oscillators: sine, polyBLEP saw/square, triangle; detune; noise **[oc for sine/noise]**
  - [x] `src/dsp/oscillator.ts` 2026-11-10: sine, polyBLAMP triangle, polyBLEP
        saw/square, one phase across wave changes. Measured at 1220 Hz, 48 kHz:
        aliasing 13–16 dB below the sharp-edged waves (tests hold it above 10).
  - [ ] detune (second oscillator), noise
  - [x] Oscillator knobs on the test note, asked for by ashon 2026-11-10: Wave,
        Octave, Semi, Fine, Level (`src/ui/Knob.tsx`, `OscillatorPanel.tsx`).
        A knob turns by vertical drag (160 px end to end), double-tap resets
        it, and the arrow, Page and Home/End keys move it. A knob with up to 8
        stops marks each with a white dot (Wave, Octave; not Semi's 25).
- [ ] ADSR (amp + filter env), exponential segments **[oc]**; pitch envelope; LFO
  - [x] Filter envelope, 2026-11-10: the same ADSR, on the ENV tab behind
        an Amp/Filter switch (the storyboard's Envelope board); defaults
        5 ms, 300 ms, 0%, 300 ms, so turning Env up gives a pluck.
  - [x] Amp ADSR, 2026-11-10 (`src/dsp/adsr.ts`, written by opencode from a
        spec, reviewed here): one-pole segments toward an overshoot target
        (attack curved, decay and release exponential), restarts from the
        current level, a 3 ms linear choke for steals, sustain changes glide
        (5 ms), also mid-decay. Knobs on the ENV tab, times 1 ms–10 s on an
        exponential curve, with an outline drawn from the same curves.
- [x] State-variable filter (LP/HP/BP) with resonance and env/keytrack amount
      (2026-11-10). `src/dsp/filter.ts` (written by opencode from a spec,
      reviewed here): Simper's trapezoidal SVF, stable while the cutoff moves
      every sample; resonance 0..1 maps to Q 0.71..12 on a log scale, and the
      lowpass and bandpass peak at Q. Per voice: oscillator → filter → amp;
      cutoff 20 Hz–20 kHz (glided in log2 Hz), the filter envelope moves it
      up to ±10 octaves at Env ±100%, keytracking around C4. FILTER tab with
      the response curve (`src/viz/filter.ts`). Checked in desktop Chrome on
      a saw at C4: at a 317 Hz cutoff the 2nd harmonic falls 10 dB and the
      8th 33 dB; Env +50% opens it back to the open sound.
- [x] 8-voice allocator with oldest-note stealing and click-free release
      (2026-11-10, `src/dsp/allocator.ts`, `voice.ts`, `synth.ts`): a new note
      takes the voice silent longest, else the one released longest ago,
      else the oldest held note. A sounding voice chokes over 3 ms and the
      new note starts on the next block. Desktop Chrome, 9 keys held: 8
      pitches in the output, the first-pressed one gone.
- [ ] Param smoothing, master gain, soft clipper (level smoothing done:
      `src/dsp/smoother.ts`, one-pole, 5 ms; a tanh soft clip on the mix,
      each voice at 0.25 so four full voices sum to 1)
- [x] `params.ts` schema (single source) + normalized↔real mapping tests **[oc]**
      (2026-11-10; osc params so far, more as the voice grows)
- [ ] `scripts/render-wav.ts` (WAV writer **[oc]**) for listening checks
- [x] Node micro-benchmark: block render time for 8 voices (budget: one 128-frame
      block at 48 kHz = 2.67 ms; aim well under a third of that).
      `pnpm bench` (`src/dsp/synth.bench.ts`, fails over a third): 8 saw
      voices 0.0066 ms a block on an Apple M3 Max, 2026-11-10. With the filter:
      0.012 ms, and 0.016 ms when every voice's cutoff moves each sample (a
      new tan each sample).

**Exit:** vitest green (pitch, envelope timing, no NaN, stealing), WAV renders sound
right, benchmark within budget.

### M3 — Mobile playing UI (L)

- [ ] Multi-touch keyboard: pointer events, `pointerId`→voice map, pointer capture,
      octave shift; optional scale-locked pad mode
  - [x] `src/ui/Keyboard.tsx`, 2026-11-10, laid out as in the storyboard:
        as many octaves as fit at 40 px a white key (one on an upright
        phone, three on a laptop), octave arrows, a sliding finger moves its
        note from key to key, keys light through data attributes (no React
        render per touch). Computer keys A–; play and Z/X shift, for desktop
        testing. Checked in desktop Chrome by synthetic pointer and key
        events; real multi-touch waits for a phone.
- [ ] Knob/Slider components: vertical drag, fine-adjust, double-tap reset; values go
      straight to the engine, React only for structure
- [ ] Layout: landscape-first for playing, portrait for editing; `viewport-fit=cover` + safe-area insets
  - [x] Side-by-side panels keep at least 16rem each and wrap (2026-11-10):
        768 px wide shows two columns, 932 px and up three. Measured with the
        FILTER panel added: 932×566 keys 132 px, 390×844 keys 309 px,
        768×1024 keys 317 px, no page overflow.
  - [x] 2026-11-10, after ashon's screenshot from a wide Android screen
        (about 930×566 CSS px) where the keyboard was squeezed to about 20
        px: from 768 px wide the panels stand side by side without tabs, the
        scope's height follows the screen (64–144 px), the keys keep at
        least 112 px. Measured in frames: 930×566 keys 143 px, 390×844 keys
        321 px, neither scrolls.
  - [ ] A phone on its side (844×390) still runs 74 px over and scrolls: it
        needs the playing layout this item is about
- [ ] Kill browser gestures on play surfaces: `touch-action: none`, no double-tap zoom,
      no text selection / iOS long-press callout, keep away from edge-swipe zones
- [ ] Playwright smoke: page loads, start overlay unlocks, keys respond (mobile emulation)
- [x] Output waveform display (`src/ui/Scope.tsx`), asked for by ashon
      2026-11-10: AnalyserNode tap in the output path, rising-edge trigger
      placed between samples (a whole-sample trigger shook a 440 Hz trace by
      up to 1.5 px a frame; sub-sample, 0.1 px or less), one opaque canvas with
      a pre-rendered grid, min/max decimation, no per-frame allocation, idle
      when silent. Desktop Chrome, 3392×288: 0.08 ms a frame. Not used, on
      purpose: `desynchronized` (an input-latency hint, no throughput gain, tearing risk)
      and an OffscreenCanvas worker (the analyser lives on the main thread, so
      every frame would be copied across for less work than it saves).

**Exit:** 3+ finger chords play with no scrolling or zooming, UI stays smooth while
dragging knobs during notes.

### M4 — Presets & PWA (M)

- [ ] Factory presets (versioned JSON) + user presets in `localStorage`/IndexedDB:
      a starter set across bass, lead, pad, pluck and a drum kit, all from the
      one voice (§3, "Instruments are patches")
- [ ] `vite-plugin-pwa`: manifest, icons, offline cache
- [ ] Screen Wake Lock while the instrument is open (feature-detected)

**Exit:** installs to the home screen, works offline, presets survive reloads.

### M5 — The "loop" (L) — _needs decision §7.2_

- [ ] Clock inside the worklet (sample-accurate), tempo, transport
- [ ] Multiple Parts in the engine, one per track, each with its own Patch
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
