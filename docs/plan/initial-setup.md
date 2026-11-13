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
| Type                   | Recursive, self-hosted (`@fontsource-variable/recursive`)     | One variable face for names (sans) and readouts (MONO axis at 1); bundled, so every phone shows the same letters, offline too             |
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
 │        │                 │           │   ├─ 16-voice VoiceAllocator  │
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
      actionlint-clean; green since the first push (2026-11-11)
- [x] GitHub Pages deploy workflow — same; since 2026-11-11 it publishes the
      organisation site at the root of https://loopromeda.github.io/
- [x] HTTPS dev over the tailnet: `pnpm dev:tailnet` (`scripts/tailnet.sh` +
      `tailscale serve`); phones only need the Tailscale app
- [x] Dev-only device report: each page load records what the browser offers in
      `device-reports.jsonl` (`scripts/vite-device-report.ts`)
- [x] Project `CLAUDE.md` (commands, architecture rules from §3) and `README.md`

**Exit:** a phone on the tailnet opens `https://<machine>.<tailnet>.ts.net:5173` as a
secure context — **met 2026-11-09** (Galaxy Z Fold line, Android 17, Chrome 156;
see `docs/platform-notes.md`). The Pages URL and green CI — **met 2026-11-11**:
https://loopromeda.github.io/ starts its audio, and ci and deploy pass.

### M1 — Audio spike on real devices (M) — _highest risk_

- [x] "Tap to start" screen: create/resume `AudioContext` inside the **click**
      (on touch screens pointerdown is not a user activation; click is).
      Since 2026-11-11 (ashon: a reload always went back to the first
      page) a cover over the instrument, which a reload brings back as it
      was: each sheet has an address (`#/presets`, `#/surface`,
      `#/settings`, `src/ui/pages.ts`; Back closes it), the picked tile is
      kept for the tab (sessionStorage). The tap stays: no browser lets a
      page start audio without one. The browser checks moved to Settings,
      under Browser; only a failed start has a page of its own.
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

- [x] Oscillators: sine, polyBLEP saw/square, triangle; detune; noise **[oc for sine/noise]**
  - [x] `src/dsp/oscillator.ts` 2026-11-10: sine, polyBLAMP triangle, polyBLEP
        saw/square, one phase across wave changes. Measured at 1220 Hz, 48 kHz:
        aliasing 13–16 dB below the sharp-edged waves (tests hold it above 10).
  - [x] Second oscillator and noise, 2026-11-10: oscillator 2 has its own
        Wave, Octave, Semi, Fine (the detune) and Level, off by default;
        white noise (`src/dsp/noise.ts`, xorshift32, written by opencode
        from a spec, reviewed here) is seeded per voice, so voices' noises
        add in power, not in step. The three levels glide (5 ms) and mix
        into the filter; a source at level 0 is not computed. Parameter ids
        renamed `osc.*` → `osc1.*` while no preset depends on them. OSC tab:
        a 1 | 2 | Noise switch, each button with a dot lit while that
        source's level is up. Checked in desktop Chrome: oscillator 2 at
        +7 st adds a 392 Hz peak level with C4's; noise at 49% lifts 5 kHz
        from −197 to −69 dB.
  - [x] Pulse width, FM and ring, 2026-11-10: each oscillator's square has
        a Width (5–95%, its DC removed, so a narrow pulse does not shift
        the filter's input); oscillator 2 phase-modulates oscillator 1 (FM,
        up to a cycle of deviation at 100%, at any oscillator 2 level), and
        Ring mixes oscillator 1 × oscillator 2. The OSC tab's pages are
        1 | 2 | Mix, Mix holding the five levels. A test holds FM's first
        sideband to the Bessel functions' power ratio to three decimals;
        in desktop Chrome FM at 9% on C4 adds a sideband at 523 Hz.
  - [x] Oscillator knobs on the test note, asked for by ashon 2026-11-10: Wave,
        Octave, Semi, Fine, Level (`src/ui/Knob.tsx`, `OscillatorPanel.tsx`).
        A knob turns by vertical drag (160 px end to end), double-tap resets
        it, and the arrow, Page and Home/End keys move it. A knob with up to 8
        stops marks each with a white dot (Wave, Octave; not Semi's 25).
- [x] ADSR (amp + filter env), exponential segments **[oc]**; pitch envelope; LFO
  - [x] Mod envelope and LFOs, 2026-11-10: a third ADSR (ENV tab, Mod page;
        5 ms, 300 ms, 0%, 300 ms) is the pitch envelope once the matrix
        routes it to Pitch. Two LFOs per voice (`src/dsp/lfo.ts`, written by
        opencode from a spec, reviewed here): sine, triangle, saw, square,
        sample & hold and smooth random, 0.05–50 Hz, a fade-in up to 5 s,
        and a trigger: Key restarts the cycle with each note, Free keeps
        every voice on one shared phase. An LFO nothing routes is skipped.
        LFO tab: three cycles of the shape, fading in as set.
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
- [x] Modulation matrix, 2026-11-10 (`src/dsp/mod.ts`, `voice.ts`): 8 slots,
      each Source → Dest × Amount, scaled by a Via source. Sources: LFO 1
      and 2, the mod and filter envelopes, velocity, key (C4 = 0, ±1 four
      octaves away), Slide, a random value per note. Destinations: pitch
      (both oscillators or one, ±48 st), the pulse widths, FM, the five
      levels, cutoff (±10 oct), resonance, amp and the LFO rates (±4 oct).
      Amounts glide (5 ms); a slot without a source or an amount costs
      nothing. MOD tab: the eight routes in a 4×2 grid (lit while on; a
      button is 26 px tall, 55 px wide in the narrowest panel) and the
      picked slot's Source, Dest, Amount (in the destination's units: st,
      oct, %) and Via. The slots come routed with no amount, so turning
      Amount is the whole job. Desktop Chrome, C4: LFO 1 → Pitch at
      +1.92 st swings 237–289 Hz at 5 Hz; Mod Env → Pitch at +23.5 st
      starts at 808 Hz and lands on 261.6 Hz in about 250 ms (a kick).
- [x] Glide, mono/legato, velocity and Slide, 2026-11-10: Glide (0–2 s, 95%
      of the way in the time set) from the last note played. Mono and Legato
      play one voice from a stack of held keys, last note first, going back
      to a key still held on release; Mono retriggers the envelopes, LFOs
      and velocity on every note change, Legato only from silence. Velocity
      comes from where a key is pressed, lower louder (0.2 at the top, 1 at
      the bottom), and Velocity sets how much of the loudness it decides
      (50%). A finger held on a key and slid up or down drives Slide (±1
      over half the keyboard's height), a matrix source of that note only.
      VOICE tab: Mode, Glide, Velocity. Hard sync, unison and pan wait.
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
      new tan each sample); 0.027 ms with both oscillators and noise on too.
      With the modulation block, rerunning the previous commit alongside:
      8 saw voices 0.0133 → 0.0225 ms and all sources 0.029 → 0.044 ms (the
      mod and filter envelopes run in every voice); 0.118 ms with all eight
      slots routed, five through a Via, both LFOs, glide, FM, ring, PWM and
      resonance moving: 13% of the budget. Imported constants stay out of
      per-sample loops: Vitest's module runner reads an import through a
      getter, which inflated these numbers by 20–40% and warned.
- [x] Render time on the device, 2026-11-10: the VOICE tab's Measure CPU
      (dev server only) has the audio thread itself time the heaviest patch
      (`src/dsp/stress.ts`, shared with `pnpm bench`) at 8, 16, 24 and 32
      voices, 300 ms each, the audio stopped meanwhile; the results show in
      the panel and go to `device-reports.jsonl`. Chrome's worklet has no
      `performance`, so it times by `Date.now()` over batches of blocks.
      Desktop Chrome, M3 Max: 0.12, 0.24, 0.37, 0.48 ms, as `pnpm bench`.
      ashon's Galaxy Fold (SM-F971N, Android 17, Chrome 156), a little
      faster: 0.107, 0.212, 0.318, 0.426 ms, 4–16% of a 2.67 ms block.
- [x] 16 voices, 2026-11-10, from those numbers: ten fingers never steal a
      held note, six more voices keep release tails, and the heaviest patch
      takes 8% of a block on the Fold, so a phone four times slower still
      fits the third. A silent voice costs nothing (8 notes on a 32-voice
      pool time as 8 on 8), and each voice stays at 0.25 into the soft clip:
      a chord sounds as loud as before, sixteen loud notes clip harder.

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
        events; ashon confirmed multi-touch on the Galaxy Fold (Chrome 156)
        on 2026-11-10. 2026-11-11, after ashon found the keys too big on
        the Fold open and on a Mac window: past three octaves only where
        a white key would be wider than 60 px (four in a 1754 px window),
        and on a roomy screen (md wide, 30rem tall) the keys stand 5.5
        times as long as a white key is wide, at most 45% of the screen,
        the editor taking the rest (`keysFit` in `src/viz/keyboard.ts`).
        2026-11-12, asked for by ashon (a length that moved with the
        width made the layout hard to keep): the keys stand at most
        10rem whatever the width, still at most 45% of a short screen
        (`KEYS_SIZE` in `src/App.tsx`).
  - [x] Pads, 2026-11-10, asked for by ashon (piano keys or launchpad
        pads, either to choose): the button next to the patch opens Keys
        or Pads, and for the pads a root (C to B) and a scale (eleven,
        Chromatic to Blues, `src/state/surface.ts`), kept in
        `localStorage` apart from the sound. The pads play the scale in
        order from the bottom left, along each row and on up, the roots
        marked; a pad plays louder pressed nearer its bottom edge, and a
        finger keeps the pad it pressed (no drifting onto the next one)
        while moving it up or down sends Slide. At most 16 pads, the grid
        of them nearest square (`src/viz/pads.ts`): even a five-note scale
        stays within three octaves, so there is always an octave to shift
        to, and 16 is the drum kit's size for when Parts come. Keys start
        on C4, pads on the root in octave 3, each keeping its own octave.
        2026-11-12, asked for by ashon (an XY pad beside the keys and the
        pads; ashon chose a pitch with no steps across, and Slide up): a
        third surface, XY (`src/ui/XyPad.tsx`, `src/viz/xy.ts`). Each
        finger plays a note, its pitch rising across the pad from a C with
        no steps, as many octaves as fit at 24 px a semitone (one on a
        phone held upright, two on one on its side, at most four), its
        Slide 0 at the bottom to 1 at the top. A finger moving bends its
        note: a `bend` message moves a held note to a pitch between
        semitones, which it follows over 30 ms (`ChainSynth.bend`), and
        the note played next glides from there.
        Lines mark the semitones, the Cs named; the finger's ring, its
        line and its pitch in cents are drawn straight onto the page.
        Every note plays at full velocity. Checked in frames at 718×392
        (C3–C5) and 390×844 (C3–C4): a finger at 0.53 across read C#4
        −28¢, and the arrows moved the pad to C4–C6.
        2026-11-12, asked for by ashon (the glide shown on the XY pad): a
        bend is an offset over the note's glide, not a new target, so a
        glide under way carries on beneath a finger that moves (one
        settling as it lands used to cut it short, to the bend's 30 ms);
        a mono move starts its glide from the pitch sounding, bend and
        all. While an XY pad is showing (`Engine.watchGlides`) the audio
        thread reports the notes held still gliding, about 60 times a
        second, each one's key and the glide's way left without its bend
        (`ChainSynth.glides`); the pad draws a dot on the finger's row
        where the note sounds and a line from it to the ring
        (`xyGlide`), gone once it is within a pixel. Checked in a frame
        at 718×392 with a 2 s glide: the dot ran from C3 towards G#4 as
        the glide's curve says (186 px at 0.2 s, 397 at 0.8 s, the finger
        at 542), kept on through a 2 px move, and moved with the finger
        on a 64 px one.
        2026-11-13, asked for by ashon ("xy 패드에서 slide가 있는 경우도
        y축에 대해서도 glide가 들어가면 좋겠는데 가능할까?"): the glide
        runs up the pad too. A note that starts with a Slide given (a
        `noteOn` with `slide`: the XY pad's, placed where the finger
        is) glides its Slide from the last note's, where that finger
        went since, at the pitch glide's own pace, so the two keep step
        and the note travels a straight line across the pad
        (`ChainVoice`: the Slide's way left, added over the 5 ms
        smoothing that follows the finger; `ChainSynth.noteOn`). Notes
        with no Slide given (the keys, the pads, the kit, the
        sequencer) start as they did, and nothing changes with the
        glide at 0 or with no note before. The report tells each
        note's Slide left as well (`GlideReport.slides`; 0 in a sound
        with no route reading the Slide, where nothing would be
        heard), and the dot stands at both, its line turned towards
        the ring (`xyGlide`). Checked in a 500 px window (the pad 436
        by 132) with a 2 s glide and the Slide routed to a filter's
        cutoff: after a note at the bottom left, one held at the top
        right showed the dot starting at the first note's place and
        running straight to the finger (38% of the way at 0.33 s, 91%
        at 1.6 s, there by 4 s, as the glide's curve says), the line's
        angle the same throughout, and the same the other way; with
        the route taken out the dot kept to the finger's row. Not
        tried on a phone.
        2026-11-12, asked for by ashon: the keys stand with C4 in their
        middle, from a C for an even number of octaves (C3–C5) and from an
        F for an odd one (F3–F4 on a phone, F2–F5 on the Fold open), and
        the computer keys start on the C nearest their middle (`keysPlace`
        and `middleC` in `src/viz/keyboard.ts`). Later that day, also
        asked for by ashon: one octave starts on C4 (C4–C5), and the keys
        move a white key at a time between C1 and C8 by a navigator, the
        whole reach drawn small with the keys on screen framed, a finger
        dragging the frame or tapping beside it to bring the frame there
        (`src/ui/KeysNavigator.tsx`; to a keyboard a slider, the arrows a
        white key, Page Up and Down an octave). It stands in the header
        from a 704 px wide surface, and under it in a 24 px strip on a
        narrower one; the arrows and Z/X still move an octave. Checked in
        desktop Chrome at 390×844 (C4–C5, the strip), 844×390 and
        1000×608 (in the header): a drag moved C3–C5 to F4–F6, a tap at
        the left end to C1, End to C6–C8.
        Since 2026-11-12, asked for by ashon ("가청주파수 전역으로...
        0~12000Hz 까지"): the keys, the pads and the XY pad reach all of
        MIDI's notes, C−1 (8.2 Hz) to G9 (12.5 kHz), where they reached
        C1 to C8 (`LOWEST_NOTE`, `HIGHEST_NOTE` in `src/viz/keyboard.ts`).
        The navigator draws 75 white keys where it drew 50; a desktop
        window shows up to ten octaves where it showed seven; the pads and
        the XY pad move by octaves within it (the XY pad from C−1–C2 to
        C6–C9 at three octaves). A note under octave 0 is named with a
        minus sign, C−1. Checked in desktop Chrome at 1000×600 and
        390×844: Home on the navigator went to C−1 – C2 and C−1 – C0, End
        to G6 – G9 and G8 – G9. Nothing in the sound limits the notes
        (a phase step is held under half the sample rate, a cutoff under
        0.45 of it), but up there a saw or a square has little under the
        Nyquist frequency, and what polyBLEP leaves folds back: at 48 kHz
        the saw's aliases stand 24 dB under it at C8, 17.5 at C9 and 12.6
        at G9 (the square 29, 17 and 31; a sine none): a sine sounds
        clean there, a saw grows rough.
        Computer keys play the pads too (A–; then Q–P). Measured in frames:
        360×720 4×3 pads of 79×65 px, 390×844 4×4 of 87×73, 930×566 8×2
        of 109×66, 768×1024 4×4 of 181×130, 1280×800 8×2 of 153×160,
        844×390 8×1 of 98×112. A header narrower than 21rem (a 360 px
        phone) drops the note range so the patch's name fits.
        2026-11-12, asked for by ashon: the surface's button and the one
        that puts the controls away stand at the header's right end,
        after the octave controls, and the patch's name one width
        whatever it is: 12rem, and held upright (the navigator in its
        strip) all the room the buttons leave. A header under 26rem (a
        phone's) drops the range to fit them.
        Later that day, after ashon found a phone on its side (718×392 in
        Chrome) hard to edit on: the navigator stands in the header from
        a 600 px wide header (was a 704 px wide surface), so a phone on
        its side has it there; a phone on its side lays the editor out as
        a wider screen does (index.css: `side`), its rack a column and
        its panel at the graph's right; and beside, the keys stand at a
        playing height and the editor takes the rest, the keys giving way
        to 7rem on a screen under 30rem tall, the page's margins closing
        up (`short`). Measured in frames: at 718×392 the editor went from
        128 to 180 px (the panel, 136 px and more, had been cut short), at
        667×375 to 163, at 844×390 178; 390×844 and 1024×768 unchanged.
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
  - [x] Six panels, 2026-11-10: from 768 px wide they stand in one row
        that scrolls sideways a panel at a time (scroll snap), each at
        least 16rem, instead of wrapping into rows that take the keyboard's
        height. Measured in frames: 932×566 keys 136 px, 768×1024 keys
        541 px, 390×844 keys 309 px with the six tabs on one row.
  - [x] Control sizes, 2026-11-10, after ashon saw controls of slightly
        different sizes side by side: two heights only, set in
        `src/ui/controls.ts`. 44 px (rounded 10 px, 12 px labels) for
        everything outside a panel: tabs, the keyboard's header, the preset
        browser. 28 px (rounded 6 px, 11 px labels) in a panel's header and
        the MOD slots, with a header button's hit area reaching 44 px.
        Disabled is 40% everywhere. Every knob is sized as one of five to a
        row (at most 56 px) whatever its row holds, so a five-knob panel no
        longer has smaller knobs. From 768 px two panels share the width,
        from 896 px three, so none is cut in half. Measured in frames:
        knobs 54 px at 360×720, 56 at 390×844, 768×1024 and 1280×800, 47
        at 930×566 (keys 137 px); the only control heights are 28 and 44.
  - [x] Controls put away, 2026-11-10, after ashon's screenshot from the
        Fold folded shut (about 490×670 CSS px), where the tabs and knob
        panel took 270 px and left the pads two rows: the button after the
        surface's hides the tabs and panels (not the waveform) and is kept
        with the surface's settings. A sheet (presets, surface) brought them
        back while it was open, as it needed their room, until both became
        popovers (2026-11-12), which leave them as they are. Measured in frames,
        shown → hidden: 490×671 pads 6×2 of 73×78 px → 4×4 of 112×107,
        360×720 4×3 → 4×4, 930×566 pads 66 → 174 px tall, 844×390 8×1 and
        89 px of scroll → 8×2 and none.
  - [x] A phone on its side (844×390) ran over and scrolled, by 89 px
        after the size pass (74 before it), unless the controls were put
        away. It no longer does, 2026-11-12, measured in a frame: the
        side layout (`side`, above) took the most of it, and the last
        8 px was the status line's Settings button, its touch reaching 16
        px into a margin of 8 on a short screen, now kept to that margin.
        718×392, 390×844 and 945×555 do not scroll either.
- [ ] Kill browser gestures on play surfaces: `touch-action: none`, no double-tap zoom,
      no text selection / iOS long-press callout, keep away from edge-swipe zones
  - [x] Long presses, 2026-11-10, after ashon saw text selected by a long
        press on the Fold: the status line under the keys was the one
        selectable text outside the start screen, and is no longer. Above
        `user-select: none`, the document turns away `contextmenu` (where
        Android starts a long press's selection) and `selectstart` (iOS,
        a mouse) except in a field or text marked `select-text` (the start
        screen's error and browser), in place of each surface's own
        handler; `touch-action: manipulation` on the page stops double-tap
        zoom and leaves pinching. Checked in desktop Chrome: no selection
        by dragging or triple-clicking the status line or the checks, the
        browser line still selects, the name field still selects and
        types. Edge swipes remain.
  - [x] Pull-to-refresh, 2026-11-10, asked for by ashon:
        `overscroll-behavior: none` on `html` as well as `body` (only
        `body` had it, and Chrome reads the viewport's from the root where
        the document scrolls). To be confirmed on the Fold.
  - [x] No zoom, 2026-11-12, asked for by ashon ("모바일에서 줌 안되게"),
        with a margin at the right on the Fold ("오른쪽에 미세하게 여백이
        있는데"): the status line's Settings button reached 12 px past its
        edge into the page's margin, 8 px since that day, so it ran the
        page 4 px wider than the screen and 8 px taller, and Chrome showed
        the page that much smaller. Its hit area, and Update's, now go no
        further than the margins and the gap above them (8 px each, which
        also keeps it off the keys). The viewport has
        `maximum-scale=1, user-scalable=no`, the page
        `touch-action: pan-x pan-y` (panels still pan, no pinch or double
        tap zooms), and Safari's gesture
        events are turned away (`src/main.tsx`), as iOS lets a pinch
        through the viewport's limits. Measured in a frame: the page as
        wide and tall as the screen at 360×720, 390×844, 454×622,
        490×671, 718×392, 844×390, 945×555 and 1000×600. On the Fold the
        pinch zooms nothing (ashon, 2026-11-13, the deployed site); an
        iPhone still to try.
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
- [x] Settings, 2026-11-10, asked for by ashon (performance, debug and
      personal settings in a menu of their own, ahead of the drum kit):
      a sheet opened from the status line's right end, kept in
      `localStorage` apart from the sound (`src/state/settings.ts`).
      Performance: Voices (4, 8, 12 or 16: new notes take only the first
      that many, a note past a lowered limit plays out), Latency (the
      context's `latencyHint`; a context keeps it for life, so a change
      starts the audio again on a new one, inside the click, the
      instrument staying on screen) and the waveform on or off. Playing:
      velocity from where a finger lands, or always full. Debug: the status
      line's audio details, the waveform's frame timing, and Measure CPU,
      moved there from the VOICE tab and offered in every build (only the
      dev server records it). Desktop Chrome: Balanced moved the latency
      from 37.3 to 50.0 ms.

**Exit:** 3+ finger chords play with no scrolling or zooming, UI stays smooth while
dragging knobs during notes.

### M4 — Presets & PWA (M)

- [x] Factory presets (versioned JSON) + user presets in `localStorage`/IndexedDB:
      a starter set across bass, lead, pad, pluck and a drum kit, all from the
      one voice (§3, "Instruments are patches")
  - [x] 2026-11-10. A preset keeps only the values that differ from the
        defaults, keyed by parameter id (`src/state/presets.ts`), so a
        parameter added later loads at its default; a file is
        `{format: 'loopromeda-presets', version: 1, presets}` and a newer
        version is refused rather than misread. 21 factory presets
        (`src/state/factory.ts`) in eight categories: Init; Saw, Sub, Acid,
        FM and Wobble Bass; Saw and Chip Lead; Warm, PWM and Glass Pad;
        Soft and Square Pluck; E-Piano, FM Bell, Organ; Kick, Snare,
        Closed and Open Hat; Blips, Zap. The drum kit is single drum
        sounds for now: playing several at once, one per pad, needs the
        Parts of M5. Every preset is rendered in a test (finite, peak
        0.03–0.9, silent three seconds after the key).
  - [x] User presets and the sound itself live in `localStorage`
        (`src/state/library.ts`): the presets as a preset file, the last
        sound with the preset it came from, written 400 ms after the last
        change and at once on `pagehide`. A reload brings back the sound,
        edits and all. A preset loads in one `params` message, so every
        value applies before the next block (`src/worklet/patch.ts`).
        `navigator.storage.persist()` is asked on the first save.
  - [x] The browser opens from the patch name at the left of the
        keyboard's header and covers the waveform and the controls, not
        the keyboard, so presets can be tried as they load (a deviation
        from the storyboard's top header: the Fold's inner screen has no
        height to spare). Save, Save as… (name and category), Rename,
        Delete with an inline confirm, Export (the share sheet where the
        browser can share a file, a download otherwise) and Import, which
        is how presets move between devices. Checked in desktop Chrome at
        1000×613 and 360×600: save, reload, rename, delete.
  - [x] A popover, 2026-11-12, asked for by ashon ("팝오버 형태로
        오버레이로... 부모 레이아웃을 유지하면서"): it stands on the patch's
        button, over the page as it is, on glass like the editor's panel.
        Up to 26 × 30 rem, above the button and as tall as the room there,
        or below it where there is more room below (the controls put
        away, which it no longer brings back); its height does not follow
        the list, so filtering moves nothing (`src/viz/popover.ts`,
        `src/ui/placement.ts`). The editor under it stays live and shows
        each preset tried; a touch in the editor puts it away, one on the
        keys plays. Measured in frames: 416 × 275 above the button at
        945 × 555, 416 × 459 below it with the controls put away, 358 ×
        480 at 390 × 844, 416 × 178 at 844 × 390 (where the sheet it
        replaced was about 200 tall).
  - [x] The play surface's choices a popover too, 2026-11-12, asked for
        by ashon ("패드 선택 부분도 다른 오버레이처럼 팝오버 기반으로"):
        Keys, Pads or XY, the mod wheel, and the pads' root and scale
        stand on the surface's button as the presets do on the patch's,
        on the same glass under the same header (a chip, "Play on", what
        it plays, the close). Unlike the presets' it stands as tall as
        its choices, measured as they change (the pads' key takes more
        than the keys' line of help), up to the room the page has, past
        which they scroll (`src/ui/SurfacePicker.tsx`). The pads under it
        play while a key is chosen. Checked in a frame at 390×844, keys
        and pads, and at 1000×600, where the scales scroll. Its choices on
        one grid, the same day, asked for by ashon ("내부 버튼들 크기도 잘
        정리해 줘"): the scales, which wrapped as wide as their names, three
        to a row, each as wide as the next (a long name on two lines,
        `OPTION_CELL` in `src/ui/controls.ts`), under the kinds' three and
        the roots' six, two to a column. Measured in frames: the scales
        104 px wide at 360×720, 114 at 390×844, 117 from 454 px, no name
        cut, the popover as tall as before.
  - [x] Insets, 2026-11-12, after ashon saw the presets' close button
        6 px from the top and 12 from the side ("컨테이너들의 상하좌우 여백
        ... 정돈해 줘"): a card keeps what stands on it as far in from all
        four edges, 12 px where its controls are 44 px (the sheets, the
        dialogs; the confirm dialog was 16), 10 where they are 28 (the
        editor's panels, which were 8 at the top); the presets'
        rows stand in as far as its buttons, and the line saying what
        happened shows only while there is something to say. A row that
        pans sideways runs to the card's edges and fades out at a side
        with more past it (`src/ui/FadeRow.tsx`): the presets' categories
        and file actions, a panel's views, chains and routes.
  - [x] The presets look as the editor's panel does, 2026-11-12, asked
        for by ashon beside the knob panel ("우측처럼 룩앤필을 맞추면
        어떨까"): a neutral chip, the name and how many presets show in
        its header, 28 px controls (Save, Save as…, More, the close a
        little apart; the categories; the forms) whose touch still
        reaches 44 px, and the panel's 10 px inset; the rows stay 44 px
        for the finger that tries them. The 28 px fields, selects,
        options and icon buttons are shared (`src/ui/controls.ts`,
        `SmallIconButton`). At 390 × 844 the header now has room for its
        name, which a 44 px header hid there.
  - [ ] iOS: Safari clears script-written storage after seven days
        without a visit, home-screen apps excepted; Export is the backup.
        Check `persist()` and the file share on an iPhone.
- [x] Manifest, icons, offline cache, 2026-11-12. Not `vite-plugin-pwa`:
      Workbox's build brings a large tree of build tools for what a page
      of code does here. `public/manifest.webmanifest` (standalone, any
      orientation, the page's #0b0b10), the icons drawn by
      `scripts/icons.ts` (asked for by ashon: an infinity leaning at 45
      degrees, an 8 tipped over, its loops rounded squares, one bold
      stroke crossing over itself, green on black, shading a little from
      emerald-300 to 600; a maskable one for Android, an apple-touch-icon
      for iOS, and a 32 px favicon.ico beside the SVG favicon for browsers
      that take no SVG).
      `scripts/vite-offline.ts` builds `src/sw/sw.ts` into `sw.js` and
      writes into it every other file the build ships (public/ and
      licences.txt too) and a hash of them all as its version. The worker
      saves them all or none, past the HTTP cache, and serves them, and
      index.html for the site's address. A new version waits rather than
      taking over a page being played: the status line shows Update
      (`src/offline.ts`), which reloads onto it, and Settings, Browser
      says whether the site is saved. The dev server registers none.
      Checked in desktop Chrome on `pnpm preview`: saved 14 files, then
      with the server stopped a reload started, played (the worklet from
      the cache) and opened licences.txt; a new build showed Update, which
      reloaded onto it (#/settings kept) and dropped the old cache.
      2026-11-12, asked for by ashon (an installed app has no reload of
      its own): Settings, Browser, Offline has Check for update, which
      asks for sw.js now and, once a new version is saved, reloads onto
      it; otherwise it says this is the newest version, or that the site
      could not be reached. Checked on `pnpm preview` by changing the
      served sw.js: latest, found and reloaded (#/settings kept), and
      unreachable with the server stopped.
- [x] Screen Wake Lock while the audio runs, 2026-11-12 (`src/wakeLock.ts`):
      asked for again when the page comes back to the front, where the
      browser let it go. Settings, Playing: Keep screen on (on by
      default). To be seen on the Fold: the screen no longer dims.

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
3. **Hosting** — GitHub Pages. Development stayed local at first (no remote,
   nothing pushed), per ashon 2026-11-09. On 2026-11-11 ashon made the
   `loopromeda` organisation, so the app is its site at the root of
   https://loopromeda.github.io/, from the public repository
   `loopromeda/loopromeda.github.io` (not a project page under a path).
4. **iOS delivery** — pure web/PWA first; Capacitor only if M1 forces it.
5. **Minimum targets** — iOS 17+ Safari, the last 2 major Android Chrome versions.
6. **Dev environment** — over the tailnet with `tailscale serve`.

Still open:

- **Test devices** — Android: Galaxy Z Fold line (SM-F971N). iPhone: not yet
  known (M1 checklist).
