# Loopromeda

A polyphonic synthesizer for mobile browsers (iOS Safari, Android Chrome),
played by touch, installable as a PWA. The plan and the decisions behind it:
`docs/plan/initial-setup.md`; the sound built from inputs, chains and
modulators: `docs/plan/sound-chains.md`; effects, then parts and a drum
kit, then a step sequencer, under way:
`docs/plan/effects-parts-sequencer.md`; tracks (a synth or a kit each,
as many as are added), a sequence for each, then a song, under way,
and projects (a session saved under a name):
`docs/plan/tracks-and-song.md`; the transport on the tab rail, then
MIDI (notes in, learn, clock out and in), under way:
`docs/plan/transport-and-midi.md`. What real devices did:
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
              chainVoice.ts one voice of it (its glide, in pitch, and
              in Slide for a note placed on the XY pad); slots.ts
              numbers the parts,
              sources and destinations; effects.ts the chorus, delay
              and reverb, the stereo tools (a Haas delay, a doubler
              of two paths, a width) and the mastering tools (an EQ,
              a compressor, a limiter), in stereo, in racks: a sound's
              inserts, the kit's, a bus's, the master's; loudness.ts
              the output's loudness as BS.1770 measures it
              (momentary, short-term, integrated, in LUFS);
              output.ts a sound's strip
              (its synth, inserts and sends), a part (a fader over
              strips: the synth's one; the kit's sixteen, a group
              summed through the kit's chain, its inserts and sends)
              and the mixer
              after them (up to four buses, the master, the clip, only
              a guard at full scale after a limiter last); clip.ts
              the soft
              clip the output ends in, untouched up to -6 dBFS, and
              its inverse for the meters; chainStress.ts is the
              heaviest sound it can hold, and the effects after it,
              for measuring; fastMath.ts the
              cheaper tanh and sine the voices call per sample;
              sequencer.ts the step sequencer's clock, counted in
              frames (from a beat given, moved by beats in time, a
              bar counted in first, if asked), and a lane
              for each track playing its loop into the track's
              strips, each note on its own frame (a strip's queue of
              what starts and stops within a block); click.ts the
              transport's click, a blip on each beat
src/worklet/  the AudioWorkletProcessor around src/dsp; own globals and
              tsconfig (tsconfig.worklet.json), loaded via ?worker&url;
              sound.ts loads a sound document onto the ChainSynth and
              its effects, and sets its knobs one by one, the mix (a
              track muted, or silent for another's solo, its fader at
              nothing) and the kit's chain (Node-testable); the
              processor keeps a
              part and a sequencer's lane for each track, by the
              track's id, and tells of each step as it passes, how far
              the compressor or limiter watched turns the sound down,
              and how loud the output is; the click goes out on an
              output of its own, the last; load.ts the
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
              master's and each track's own (the node's later outputs),
              never the click's (the last, straight to the speakers);
              the tracks, the one picked edited and played; the
              song, held here and edited, its tempo and each loop sent
              as it changes, the transport, and the step playing; the
              compressors' and limiters' reductions (reductions.ts:
              who watches which, many at once, the list told under a
              version) and the loudness, watched;
              protocol.ts is the message types both threads share
              (plain data only)
src/state/    params.ts: the knob schema and the old parameters;
              presets.ts: the preset and file format (version 2 holds
              sounds); factory.ts: the shipped presets and the factory
              kit, written by name (sound/write.ts); library.ts: user
              presets and the session's tracks, kept in localStorage;
              surface.ts: keys, pads or XY, the pads' key (root and
              scale), and whether the sequencer's steps stand in their
              place (Seq);
              kit.ts: a kit's 16 pads, each a preset mapped onto
              it and played as it is at the pad's note, and its
              chain (the inserts and sends after them, every
              pad's), and a pad shown with the chain;
              kit.bench.ts the kit's cost;
              tracks.ts: the session's tracks, each a synth (its
              sound) or a kit (its pads and chain), up to eight,
              named, added, moved and removed, and the track played
              and the pad picked;
              song.ts: the session's song (the tempo, the swing and
              each track's loops, by the track's id; a loop one to
              thirty-two bars of sixteenths and its notes, each a step, a
              key (a synth's note, a kit's pad), a length and a
              velocity), its edits, kept in localStorage;
              project.ts: a project, the session (the tracks, the mix,
              the song) kept under a name, the list of them and a
              project's file; projects.ts: the projects kept in
              localStorage, the one the session came from, whether it
              was edited since, and Save, Save as, Open, New, Rename,
              Delete, Export and Import;
              settings.ts: the device's settings (voices, latency,
              velocity, what the screen shows); mix.ts: the session's
              mix (each track's fader, a level and a balance, and
              whether it is muted or soloed, by the
              track's place; the buses every track sends to, lettered by
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
              (and left of it what each input reads) and chain rows in
              graph.ts, the kit's pads and chain in its place in
              kitGraph.ts, the mix's strip, bus rows and master in
              mixGraph.ts (its effects icons in a frame too narrow for
              their names), the threads stitched between their tiles
              (a hole for each, a run across each seam) in threads.ts,
              the master's views (spectrum,
              spectrogram, stereo, meters) and the mastering tools'
              readouts (a reduction, a loudness) in master.ts, the
              colour scales the spectrogram's levels take, the dark's
              and the light's, in colourScale.ts, and where a
              tile dragged goes in
              drop.ts, hit-testing, velocity and Slide from a touch's
              position, a knob turning finer as the finger strays
              sideways in fine.ts, the mod wheel's turn, double tap and
              ridges in wheel.ts, the XY pad's pitch, Slide, lines and
              a glide's dot (where the note sounds, across and up) in
              xy.ts, where a popover stands by its
              button in popover.ts, the step grid's cells, a note's
              box and what a drag from a note makes of it in steps.ts)
src/ui/       React components; SoundEditor.tsx the sound as tiles
              (editor.ts: their names, lines, pictograms and colours),
              with the kit its pads and its chain, or, switched to Mix,
              the session's mix, under its tab rail (Sound | Mix, then
              the transport: Transport.tsx's Play, the position and
              the tempo, whose popover holds the tempo, the swing, the
              click, the count-in and each track's loop on or off;
              transportKeys.ts Space, the arrows and Home on it);
              the sound's Out and the
              mix's Master hold a view of the output (MasterViews.tsx:
              Scope.tsx's waveform, the spectrum, the spectrogram and
              its colours' key, the stereo, the meters; frames.ts
              draws them a display frame at a time, the output read
              once a frame), its filters,
              drives and modulators their pictures (Picture.tsx, drawn
              from outline.ts); MasterSheet.tsx all the views at size
              (#/master), with the loudness; Dynamics.tsx a
              compressor's or limiter's gain reduction (in its panel,
              and rising over its tile) and the loudness, drawn as the
              audio thread tells them;
              PartPanel.tsx the
              picked tile's knobs, adds and moves (ConfirmDialog.tsx asks
              before a removal);
              RoutePanels.tsx routing in the panel's place: the routes into
              a knob held, or a source's depths on the tiles picked;
              tileDrag.ts holds a tile and drags it to a new place; Knob.tsx
              turns one knob of one part (or a source's depth into one),
              finer with the finger off to the side; TrackPicker.tsx
              picks the track played, a popover on its button, and adds
              one (a track is renamed, moved and removed on its strip in
              the Mix); Mutes.tsx a track's Mute and Solo, in its
              strip's panel, the Out tile's and the tracks' popover,
              and what the strip is for them; PlaySurface.tsx plays
              notes on Keys.tsx, Pads.tsx or XyPad.tsx, or the kit on
              KitPads.tsx (hands.ts: who
              holds which note, bends it, and on the XY pad places it,
              its Slide from the start), or with Seq shows
              StepGrid.tsx, the picked track's loop a bar at a time,
              the bar playing followed (a tap puts a note or takes
              it away, a drag from one
              sets how hard and how long; RowNavigator.tsx a camera
              over its rows), with the lights for the bar's steps in
              its header, or in a row under a narrow one (Play and the
              tempo there too while the rail is put away);
              KeysNavigator.tsx moves the keys a white key at a
              time over C−1 to G9 (all of MIDI's notes), ModWheel.tsx the mod wheel at their
              left (the Wheel source) and its Route, PresetBrowser.tsx
              loads, saves and moves presets, a popover on the patch's
              button (placement.ts places it), SurfacePicker.tsx one on
              the surface's (keys, pads, XY or Seq, the pads' key; a
              kit's pads or Seq), ProjectBrowser.tsx one on the status
              line's project button, left of Settings (the projects
              kept, the session saved under a name, one opened in its
              place, a project's file out and in; #/project),
              SettingsDialog.tsx, a modal dialog, holds the settings
              (the theme in Dropdown.tsx, the app's own select),
              Measure CPU and the browser's checks; theme.ts the
              colour roles and the themes that give them values, in
              the dark and the light, appearance.ts setting them and
              the mode (index.css's tokens) on the page; pages.ts gives each
              sheet an address (#/presets), so a reload keeps it and Back
              closes it; Popover.tsx the shell every popover stands in
              (its header, its place by its button, its height
              measured, Escape); SettingRows.tsx a titled group of
              settings, a setting's row and a switch's (Switch.tsx);
              controls.ts the shared sizes, the insets, the section
              heading and the card every panel stands on; FadeRow.tsx
              a row that
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
