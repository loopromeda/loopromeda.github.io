# Loopromeda

A polyphonic synthesizer for mobile browsers (iOS Safari, Android Chrome),
played by touch, installable as a PWA. The plan and the decisions behind it:
`docs/plan/initial-setup.md`. What real devices did: `docs/platform-notes.md`.

## Commands

```sh
pnpm dev            # Vite on 127.0.0.1:5173 (this machine only)
pnpm dev:tailnet    # same, plus https://<machine>.<tailnet>.ts.net:5173 for phones
pnpm tailnet:off    # stop serving 5173 to the tailnet
pnpm typecheck      # tsc: app, audio thread (tsconfig.worklet.json), configs
pnpm lint           # eslint
pnpm format:check   # prettier (pnpm format to fix)
pnpm test           # vitest, once
pnpm bench          # render-time budget: 8 voices, one 128-frame block
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
- **One parameter schema** (`src/state/params.ts`, from M2): id, range, default,
  curve and unit, used by the UI, the worklet and presets alike.
- **Real-time UI bypasses React state.** Knob drags and key presses go straight
  to the engine through refs and pointer events; React renders structure.
- **Secure context everywhere.** AudioWorklet needs HTTPS: Pages in production,
  `tailscale serve` in development.

## Layout

```
src/dsp/      pure DSP (oscillators, envelopes, LFOs, filters, voices);
              mod.ts numbers the matrix's sources and destinations;
              synth.ts is the whole instrument: voice pool, allocator,
              mono/legato, matrix, mix
src/worklet/  the AudioWorkletProcessor around src/dsp; own globals and
              tsconfig (tsconfig.worklet.json), loaded via ?worker&url;
              patch.ts maps parameter values onto the Synth (Node-testable)
src/engine/   AudioContext lifecycle, unlock, node wiring; protocol.ts is
              the message types both threads share (plain data only)
src/state/    params.ts: the parameter schema; presets.ts: the preset and
              file format; factory.ts: the shipped presets; library.ts:
              user presets and the last sound, kept in localStorage
src/viz/      pure display math (scope trigger and decimation, envelope
              and LFO outlines, filter response, keyboard geometry,
              hit-testing, velocity and Slide from a touch's position)
src/ui/       React components; Scope.tsx draws the output waveform,
              Knob.tsx turns one parameter, Keyboard.tsx plays notes,
              PresetBrowser.tsx loads, saves and moves presets
scripts/      dev tooling: tailnet.sh, the device-report Vite plugin
```

Dev-only device reports: every page load, every audio state change and,
every 5 s while it draws, the waveform display's frame cost on a phone are
appended to `device-reports.jsonl` (gitignored), and so is the audio
thread's render time when the VOICE tab's Measure CPU is tapped (the
heaviest patch, `src/dsp/stress.ts`, at 8 to 32 voices). Read it after a
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
