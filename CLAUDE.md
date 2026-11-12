# Loopromeda

A polyphonic synthesizer for mobile browsers (iOS Safari, Android Chrome),
played by touch, installable as a PWA. The plan and the decisions behind it:
`docs/plan/initial-setup.md`; the sound built from inputs, chains and
modulators: `docs/plan/sound-chains.md`; effects, then parts and a drum
kit, then a step sequencer, under way:
`docs/plan/effects-parts-sequencer.md`. What real devices did:
`docs/platform-notes.md`.

## Commands

```sh
pnpm dev            # Vite on 127.0.0.1:5173 (this machine only)
pnpm dev:tailnet    # same, plus https://<machine>.<tailnet>.ts.net:5173 for phones
pnpm tailnet:off    # stop serving 5173 to the tailnet
pnpm typecheck      # tsc: app, audio thread, service worker, configs
pnpm lint           # eslint
pnpm format:check   # prettier (pnpm format to fix)
pnpm test           # vitest, once
pnpm bench          # render-time budget: every voice, one 128-frame block
pnpm build          # typecheck + vite build into dist/
pnpm preview        # dist/ on 127.0.0.1:4173: the offline copy, which dev lacks
```

Before calling a change done: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.

## Architecture rules

- **The audio thread owns time.** All DSP and all timing (envelopes, the
  sequencer clock) run inside one `AudioWorkletProcessor`. The main thread only
  sends intents (note on/off, parameter changes) over the worklet's port.
- **`src/dsp` is pure TypeScript.** No DOM, no Web Audio, no imports from other
  `src/` folders. It renders `Float32Array` blocks and is tested in Node.
- **No allocation inside `process()`.** Preallocate voices and buffers; smooth
  parameter changes; never hardcode the sample rate (read `sampleRate`).
- **One knob schema** (`ValueSpec` in `src/state/params.ts`): range, default,
  curve and unit. Every part kind's knobs are built from it
  (`src/state/sound/kinds.ts`), for the editor, presets and the worklet alike.
  The old parameter list there (`PARAMS`) now only reads version 1 presets and
  sessions (`src/state/sound/v1.ts`).
- **Real-time UI bypasses React state.** Knob drags and key presses go straight
  to the engine through refs and pointer events; React renders structure.
- **Secure context everywhere.** AudioWorklet needs HTTPS: Pages in production,
  `tailscale serve` in development.

## Layout

```
src/dsp/      pure DSP (oscillators, envelopes, LFOs, filters, voices);
              chainSynth.ts is the whole instrument, a sound built from
              parts: voice pool, allocator, mono/legato, routes, mix;
              chainVoice.ts one voice of it; slots.ts numbers the parts,
              sources and destinations; effects.ts the chorus, delay
              and reverb, in stereo, in racks: a part's inserts, a
              bus's, the master's; output.ts a part's strip (its
              synth, inserts, fader and sends) and the mixer after
              them (up to four buses, the master, the clip); clip.ts
              the soft
              clip the output ends in, untouched up to -6 dBFS, and
              its inverse for the meters; chainStress.ts is the
              heaviest sound it can hold, and the effects after it,
              for measuring; fastMath.ts the
              cheaper tanh and sine the voices call per sample
src/worklet/  the AudioWorkletProcessor around src/dsp; own globals and
              tsconfig (tsconfig.worklet.json), loaded via ?worker&url;
              sound.ts loads a sound document onto the ChainSynth and
              its effects, and sets its knobs one by one (Node-testable);
              load.ts the
              share of its time the synth takes, for the status line
src/sw/       the service worker (own globals, tsconfig.sw.json): keeps
              what the build ships for offline, a new version waiting
              for Update; offline.ts registers it (builds only) and
              tells its state; wakeLock.ts keeps the screen on while the
              audio runs
src/engine/   AudioContext lifecycle, unlock, node wiring; the sound,
              held here and edited, sent whole or as the knobs that
              moved; the session's mix, sent whole; the analysers on the
              output (each side, the waveform, the spectrum), the
              master's and each part's own (the node's later outputs);
              protocol.ts is the message types both threads share
              (plain data only)
src/state/    params.ts: the knob schema and the old parameters;
              presets.ts: the preset and file format (version 2 holds
              sounds); factory.ts: the shipped presets, written by
              name (sound/write.ts); library.ts: user presets and the
              last sound, kept in localStorage;
              surface.ts: keys or pads, the pads' key (root and scale);
              settings.ts: the device's settings (voices, latency,
              velocity, what the screen shows); mix.ts: the session's
              mix (each part's fader, a level and a balance; the buses
              every part sends to, lettered by
              their place, each a row of effects, a level and a balance,
              and the master's effects and level), kept in
              localStorage; sound/: a sound as a
              document of inputs, chains, modulators, routes, inserts
              and sends, its edits, reading it from JSON and from the old
              parameters, a knob by part and key and the routes into it
              (knob.ts), and the knobs that moved between two (diff.ts)
src/viz/      pure display math (scope trigger and decimation, envelope
              and LFO outlines, filter response, drive curve, keyboard
              and pad grid geometry, the sound editor's input column
              (and left of it what each input reads, pegged to it) and
              chain rows in graph.ts, the mix's strip, bus rows and
              master in mixGraph.ts, the master's views (spectrum,
              spectrogram, stereo, meters) in master.ts, and where a
              tile dragged goes in
              drop.ts, hit-testing, velocity and Slide from a touch's
              position, a knob turning finer as the finger strays
              sideways in fine.ts, the mod wheel's turn, double tap and
              ridges in wheel.ts, the XY pad's pitch, Slide, lines and
              a glide's dot in xy.ts, where a popover stands by its
              button in popover.ts)
src/ui/       React components; SoundEditor.tsx the sound as tiles
              (editor.ts: their names, lines, pictograms and colours), or,
              switched to Mix, the session's mix; the sound's Out and the
              mix's Master hold a view of the output (MasterViews.tsx:
              Scope.tsx's waveform, the spectrum, the spectrogram, the
              stereo, the meters; frames.ts draws them a display frame
              at a time, the output read once a frame), its filters,
              drives and modulators their pictures (Picture.tsx, drawn
              from outline.ts); MasterSheet.tsx all the views at size
              (#/master); PartPanel.tsx the
              picked tile's knobs, adds and moves (ConfirmDialog.tsx asks
              before a removal);
              RoutePanels.tsx routing in the panel's place: the routes into
              a knob held, or a source's depths on the tiles picked;
              tileDrag.ts holds a tile and drags it to a new place; Knob.tsx
              turns one knob of one part (or a source's depth into one),
              finer with the finger off to the side; PlaySurface.tsx plays
              notes on Keys.tsx, Pads.tsx or XyPad.tsx (hands.ts: who
              holds which note, and bends it), KeysNavigator.tsx moves the keys a white key at a
              time over C−1 to G9 (all of MIDI's notes), ModWheel.tsx the mod wheel at their
              left (the Wheel source) and its Route, PresetBrowser.tsx
              loads, saves and moves presets, a popover on the patch's
              button (placement.ts places it), SurfacePicker.tsx one on
              the surface's (keys, pads or XY, the pads' key),
              SettingsDialog.tsx, a modal dialog, holds the settings,
              Measure CPU and the browser's checks; pages.ts gives each
              sheet an address (#/presets), so a reload keeps it and Back
              closes it; controls.ts the shared sizes, the insets and
              the card every panel stands on; FadeRow.tsx a row that
              pans sideways, faded out where there is more
scripts/      dev tooling: tailnet.sh, the device-report Vite plugin,
              vite-licences.ts, which gathers LICENSE and the licences
              of what the site ships into licences.txt, vite-offline.ts,
              which builds sw.js and lists in it everything else the
              build ships, and icons.ts, which draws public/'s icons
public/       copied beside index.html: the manifest and the icons
```

Dev-only device reports: every page load, every audio state change and,
every 5 s while it draws, the waveform display's frame cost on a phone are
appended to `device-reports.jsonl` (gitignored), and so is the audio
thread's render time when Settings' Measure CPU is tapped (the
heaviest sound, `src/dsp/chainStress.ts`, at 8 to 32 voices). Read it after a
device test instead of asking for numbers to be retyped.

## Repository

github.com/loopromeda/loopromeda.github.io (public), remote `origin`. Every
push to `main` deploys https://loopromeda.github.io/ (deploy.yml). Commit
only when asked, and push only when ashon asks. MIT (`LICENSE`, chosen by
ashon 2026-11-11). A new runtime dependency, or a build tool whose code
lands in the output, needs its licence file: the build fails without one.

## Conventions

- Prettier: no semicolons, single quotes, 80 columns, trailing commas (es5).
- Tests sit next to the code: `foo.ts` → `foo.test.ts`.
- GitHub Actions are pinned by commit SHA with the version in a comment.
- Repository text (code, comments, docs, commits) is in English.
- Small, well-specified tasks with a command that proves them done are
  delegated to opencode (the opencode-delegate skill) and verified here.
