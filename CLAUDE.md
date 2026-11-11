# Loopromeda

A polyphonic synthesizer for mobile browsers (iOS Safari, Android Chrome),
played by touch, installable as a PWA. The plan and the decisions behind it:
`docs/plan/initial-setup.md`; the sound built from inputs, chains and
modulators, under way: `docs/plan/sound-chains.md`. What real devices did:
`docs/platform-notes.md`.

## Commands

```sh
pnpm dev            # Vite on 127.0.0.1:5173 (this machine only)
pnpm dev:tailnet    # same, plus https://<machine>.<tailnet>.ts.net:5173 for phones
pnpm tailnet:off    # stop serving 5173 to the tailnet
pnpm typecheck      # tsc: app, audio thread (tsconfig.worklet.json), configs
pnpm lint           # eslint
pnpm format:check   # prettier (pnpm format to fix)
pnpm test           # vitest, once
pnpm bench          # render-time budget: every voice, one 128-frame block
pnpm build          # typecheck + vite build into dist/
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
              sources and destinations; chainStress.ts is the heaviest
              sound it can hold, for measuring
src/worklet/  the AudioWorkletProcessor around src/dsp; own globals and
              tsconfig (tsconfig.worklet.json), loaded via ?worker&url;
              sound.ts loads a sound document onto the ChainSynth and
              sets its knobs one by one (Node-testable)
src/engine/   AudioContext lifecycle, unlock, node wiring; the sound,
              held here and edited, sent whole or as the knobs that
              moved; protocol.ts is the message types both threads share
              (plain data only)
src/state/    params.ts: the knob schema and the old parameters;
              presets.ts: the preset and file format (version 2 holds
              sounds); factory.ts: the shipped presets; library.ts: user
              presets and the last sound, kept in localStorage;
              surface.ts: keys or pads, the pads' key (root and scale);
              settings.ts: the device's settings (voices, latency,
              velocity, what the screen shows); sound/: a sound as a
              document of inputs, chains, modulators and routes, its
              edits, reading it from JSON and from the old parameters,
              a knob by part and key and the routes into it (knob.ts),
              and the knobs that moved between two (diff.ts)
src/viz/      pure display math (scope trigger and decimation, envelope
              and LFO outlines, filter response, keyboard and pad grid
              geometry, the sound editor's input column and chain rows
              in graph.ts, hit-testing, velocity and Slide from a touch's
              position)
src/ui/       React components; SoundEditor.tsx the sound as tiles
              (editor.ts: their names, lines, pictograms and colours),
              its amp holding Scope.tsx, the output waveform;
              PartPanel.tsx the picked tile's knobs, adds and moves
              (outline.ts: its picture); RoutePanels.tsx routing in the
              panel's place: the routes into a knob held, or a source's
              depths on the tiles picked; Knob.tsx turns one knob of one
              part (or a source's depth into one), PlaySurface.tsx plays
              notes on Keys.tsx or Pads.tsx (hands.ts: who holds which
              note),
              PresetBrowser.tsx loads, saves and moves presets,
              SettingsSheet.tsx holds the settings and Measure CPU
scripts/      dev tooling: tailnet.sh, the device-report Vite plugin
```

Dev-only device reports: every page load, every audio state change and,
every 5 s while it draws, the waveform display's frame cost on a phone are
appended to `device-reports.jsonl` (gitignored), and so is the audio
thread's render time when Settings' Measure CPU is tapped (the
heaviest sound, `src/dsp/chainStress.ts`, at 8 to 32 voices). Read it after a
device test instead of asking for numbers to be retyped.

## Repository

Local only for now: there is no remote. Do not create a GitHub repository,
add a remote or push until ashon asks; commit only when asked.

## Conventions

- Prettier: no semicolons, single quotes, 80 columns, trailing commas (es5).
- Tests sit next to the code: `foo.ts` → `foo.test.ts`.
- GitHub Actions are pinned by commit SHA with the version in a comment.
- Repository text (code, comments, docs, commits) is in English.
- Small, well-specified tasks with a command that proves them done are
  delegated to opencode (the opencode-delegate skill) and verified here.
