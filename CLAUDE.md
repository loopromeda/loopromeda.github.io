# Loopromeda

A polyphonic synthesizer for mobile browsers (iOS Safari, Android Chrome),
played by touch, installable as a PWA. The plan and the decisions behind it:
`docs/plan/initial-setup.md`; the sound built from inputs, chains and
modulators: `docs/plan/sound-chains.md`; effects, then parts and a drum
kit, then a step sequencer, under way:
`docs/plan/effects-parts-sequencer.md`; tracks (a synth or a kit each,
as many as are added), a sequence for each, then a song, under way,
knob lanes in a loop, the sequencer up top (a tab of the editor's
rail), recording what is played into a loop, a note's ornaments, ghost
notes, and projects (a session saved under a name):
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
              in Slide for a note placed on the XY pad; a ghost note
              muted, its own envelope, lowpass and scrape, or soft,
              a kit's; its drives at twice the rate); oscillator.ts
              the waves (a super's stack, hard sync, a phase Free or
              Reset); comb.ts a delay tuned to the note, fed back (a
              plucked string, Karplus-Strong, or a resonator);
              formant.ts a vowel's three formants; fm6.ts a
              six-operator FM voice after the DX7 (its 32
              algorithms, each operator's envelope, velocity and
              scaling, a pitch envelope and the voice's LFO, all
              in the DX7's own numbers; two engines: Clean, in
              floating point, or the DX7's, its chips' log-sine
              and powers in integers, its converter's 12 bits and
              its output's lowpass at 16 kHz; on both its output's
              coupling, a highpass at 20 Hz, and velocity as the
              DX7's keys send it, 127 their 100, or MIDI's in full);
              slots.ts
              numbers the parts,
              sources and destinations; effects.ts the chorus, the
              ensemble (a string machine's three taps on two
              LFOs), the phaser, the tremolo (an auto-pan at Pan
              1), delay and reverb (its tail swelling first, a
              loop of allpasses before its lines, every line
              swaying as it does, the loop thinning its lows lap
              by lap, a resonant Tone on what blooms: Bloom), the
              stereo tools (a Haas delay, a doubler
              of two paths, a width) and the mastering tools (an EQ,
              a compressor, a limiter), in stereo, in racks: a sound's
              inserts, the kit's, a bus's, the master's; eq.ts the
              EQ's six points (a kind, a frequency, a gain, a Q), the
              cookbook's biquads it and its curve both use; loudness.ts
              the output's loudness as BS.1770 measures it
              (momentary, short-term, integrated, in LUFS);
              output.ts a sound's strip
              (its synth, inserts and sends), a part (a fader over
              strips: the synth's one; the kit's sixteen, a group
              summed through the kit's chain, its inserts and sends;
              a lane moves its fader in the mix's place) and the mixer
              after them (up to four buses, the master, the clip, only
              a guard at full scale after a limiter last); clip.ts
              the soft
              clip the output ends in, untouched up to -6 dBFS, and
              its inverse for the meters; chainStress.ts is the
              heaviest sound it can hold, and the effects after it,
              for measuring; fastMath.ts the
              cheaper tanh and sine the voices call per sample;
              ornament.ts a loop note's ornament (a grace or a
              kit's flam, a mordent, a trill, a roll, an arpeggio)
              and the sounds it expands to;
              sequencer.ts the step sequencer's clock, counted in
              frames (from a beat given, moved by beats in time, a
              bar counted in first, if asked; a bar and a beat the
              song's meter's, in steps), and a lane
              for each track playing its loop (and a scene's
              launched, from the next bar's first step) into the track's
              strips, each note and each sound of its ornament on
              its own frame (a strip's queue of what starts, stops
              and moves its pitch within a block), a ghost's muted
              on a synth and soft on a kit's pad, and, stopped, a
              note on its own, auditioned; clock.ts the
              song's time the sequencer keeps (the tempo, and the
              beat each block starts on), which a synced delay and
              LFO follow; click.ts the transport's click, a blip on
              each beat; automation.ts a track's knob lanes, each
              knob's value where the song stands, held or gliding
src/worklet/  the AudioWorkletProcessor around src/dsp; own globals and
              tsconfig (tsconfig.worklet.json), loaded via ?worker&url;
              sound.ts loads a sound document onto the ChainSynth and
              its effects, and sets its knobs one by one (a lane's
              value in place of a knob's own, kept: move), the mix (a
              track muted, or silent for another's solo, its fader at
              nothing), the kit's chain, and where a track's lanes
              hand their values (TrackKnobs) (Node-testable); the
              processor keeps a part, a sequencer's lane and knob
              lanes for each track, by the track's id, auditions a
              note of one's loop while stopped, and tells of
              each step as it passes, while recording where it stands
              as each note starts and ends, how far
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
              output (each side, read where a display frame stands, the
              samples heard then however the audio comes, presentAt;
              the spectrum analysed from them), the
              master's and each track's own (the node's later outputs),
              never the click's (the last, straight to the speakers);
              the tracks, the one picked edited and played, and the
              one the Seq tab shows, picked apart; the
              song, held here and edited, its tempo and each loop sent
              as it changes (its lanes resolved on the track's sound),
              the transport, and the step playing, a scene launched
              on the next bar (each loop counted from where it came
              in: origin, loopStep), and recording (a
              Recorder fed where each note was heard, the output's
              latency taken off), and a note of the Seq tab's loop
              heard on its own while stopped (auditionNote); the
              compressors' and limiters' reductions (reductions.ts:
              who watches which, many at once, the list told under a
              version) and the loudness, watched;
              protocol.ts is the message types both threads share
              (plain data only)
src/state/    params.ts: the knob schema and the old parameters;
              presets.ts: the preset and file format (version 2 holds
              sounds); factory.ts: the shipped presets and the factory
              kit, written by name (sound/write.ts), the DX7's
              voices as their sheets give them (dx7()), the kit's
              pads the TR-808's voices as its service notes give
              them, each struck once (struck()); library.ts: user
              presets and the session's tracks, kept in localStorage;
              surface.ts: keys, pads or XY, the pads' key (root and
              scale), the mod wheel;
              kit.ts: a kit's 16 pads, each a preset mapped onto
              it and played as it is at the pad's note, and its
              chain (the inserts and sends after them, every
              pad's), and a pad shown with the chain;
              kit.bench.ts the kit's cost;
              tracks.ts: the session's tracks, each a synth (its
              sound) or a kit (its pads and chain), up to eight,
              named, added, moved and removed, and the track played
              and the pad picked, and the Seq tab's track kept;
              song.ts: the session's song (the tempo, the swing, the
              meter and each track's loops, by the track's id; a loop
              whole bars of sixteenths in the meter, up to 4096 steps,
              and its notes, each a step, a
              key (a synth's note, a kit's pad), a length, a
              velocity, an ornament or none and whether it is a
              ghost, and its knob lanes,
              a knob's value at each
              step; and its scenes, each a name and the loop each
              track plays in it, or none, the loops shared and only
              added, a copy a variation), its edits, kept in
              localStorage; meter.ts: the
              song's meter (so many quarters or eighths to a bar: a
              bar's steps, a beat's, the click's, as dotted quarters
              in 6/8, the longest loop in it); lanes.ts: the
              knobs a track's lanes may move (its sound's, its
              fader's) and its lanes as they play; record.ts: what
              is played while recording written into a loop (on the
              sixteenth nearest, as long as held, after its step has
              played), Overdub or Replace, a loop of no notes growing
              with the take, which sets its length;
              project.ts: a project, the session (the tracks, the mix,
              the song) kept under a name, the list of them and a
              project's file; projects.ts: the projects kept in
              localStorage, the one the session came from, whether it
              was edited since, and Save, Save as, Open, New, Rename,
              Delete, Export and Import;
              settings.ts: the device's settings (voices, latency,
              velocity, how recording meets a loop, what the screen
              shows); mix.ts: the session's
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
              and LFO outlines, filter response, drive curve, a comb's
              peaks at a note's harmonics (comb.ts), a formant's humps
              (formant.ts), keyboard
              and pad grid geometry, the sound editor's input column
              (and left of it what each input reads) and chains as
              groups (a head, the items squares in lines inside) in
              graph.ts, the kit's pads and chain in its place in
              kitGraph.ts, the mix's strips, its buses as groups (a
              head, the effects squares in lines inside) and the
              master's group (its effects over its view) in
              mixGraph.ts (the squares icons in a frame too narrow for
              their names), the threads
              stitched between their tiles
              (a hole for each, a run across each seam) in threads.ts,
              the master's views (spectrum,
              spectrogram, stereo, meters, how many stand side by
              side, and whether a box holds them as the master's sheet
              stands them) and the mastering tools'
              readouts (a reduction, a loudness) in master.ts, the
              time a display frame shows in the audio (the heard, behind
              the chunks rendered) in presentClock.ts, an output's
              spectrum as an analyser reads it in spectrum.ts, the
              colour scales the spectrogram's levels take, the dark's
              and the light's, in colourScale.ts, and where a
              tile dragged goes in
              drop.ts, hit-testing, velocity and Slide from a touch's
              position, a knob turning finer as the finger strays
              sideways in fine.ts, the mod wheel's turn, double tap and
              ridges in wheel.ts, the XY pad's pitch, Slide, lines and
              a glide's dot (where the note sounds, across and up) in
              xy.ts, where a popover stands by its
              button in popover.ts, the step grid's cells (a bar's
              steps across, as the song's meter makes it), a note's
              box and what a drag from a note makes of it, and the
              keys a scene's track row frames, in steps.ts,
              where the song stands (bar, beat and step, or the
              count-in's beats left, in its meter) in position.ts,
              a knob lane's strip (a stroke's steps, Fill's shapes,
              its outline) in laneStrip.ts, a note's ornament's
              marks on the grid (a grace's box on its row, a
              stroke, a trill's zigzag, an arpeggio's stairs) and its
              editor's interval and a sound's ms in ornament.ts, an
              EQ's curve, where its
              points stand and what a drag or a pinch makes of one in
              eq.ts,
              and the app's mark, on the icons' grid and the
              favicon's, in mark.ts)
src/ui/       React components; SoundEditor.tsx the sound as tiles
              (editor.ts: their names, lines, pictograms and colours),
              with the kit its pads and its chain, or, switched to Seq,
              SeqView.tsx (All, then a chip for each track, the one
              picked there apart from the one played, with scenes
              the letter of the loop it plays; All, ScenesView.tsx:
              the song's scenes in a row, one tapped launched and
              blinking until it comes in, More's New scene,
              Duplicate, Rename, Move and Delete, and under them a
              row for each track, the bar it plays with its step
              lit, its loop's letter (a picker of its loops, Silent,
              New loop and a copy) and where it stands in the loop,
              a tap opening the loop; a track's chip its
              StepGrid.tsx:
              its loop a bar at a time, each as many steps as the
              song's meter makes it, its beats shaded, the bar
              playing followed, counted from the loop's start, a
              tap puts a note or takes it away, a drag from one sets
              how hard and how long, one held (or tapped with
              Ornaments on) is picked for its ornament, which
              OrnamentPanel.tsx sets in the lanes' place, heard
              while stopped; with Ghost on a tap puts a ghost note,
              hollow with an x, or makes a note one and back;
              RowNavigator.tsx a camera over
              its rows; under it LaneStrip.tsx its knob lanes, one
              over another, drawn on, and LanePicker.tsx in its
              place adds one), or, switched to Mix,
              the session's mix, under its tab rail (Sound | Seq | Mix,
              a Dropdown.tsx under 32rem wide, then
              the transport: Transport.tsx's Play, Record, the
              position and the tempo, whose popover holds the tempo,
              the swing, the meter (2/4 to 5/4, 6/8 to 12/8), the
              click, the count-in, Overdub or Replace and each
              track's loop on or off;
              transportKeys.ts Space, the arrows and Home on it);
              the sound's Out and the
              mix's Master hold views of the output, as many side by
              side as keep their shapes (ViewsAcross), or the Master
              with room as its sheet stands them (MasterBoard;
              MasterViews.tsx:
              Scope.tsx's waveform, the spectrum, the spectrogram and
              its colours' key within it, the stereo, the meters; frames.ts
              draws them a display frame at a time, every view in one
              requestAnimationFrame, the output read once a frame, each
              faded in once first drawn, the spectrogram going on from
              what it showed, and in development what the frames cost
              and how the audio under them came), its filters,
              drives, modulators and EQs their pictures (Picture.tsx,
              drawn from outline.ts); EqGraph.tsx an EQ's curve in its
              panel's place of knobs, over the spectrum of what it is
              heard in (its track's own, the master's), its points
              dragged, pinched and typed (eqAccess.ts: the sound's or
              the mix's knobs it reads and writes, and the output it is
              heard in), small on the master's sheet;
              MasterSheet.tsx all the views at size
              (MasterBoard, #/master), under the tab rail, with the
              loudness and the
              master's knobs (its level, its effects', one added);
              Dynamics.tsx a compressor's or limiter's gain reduction
              (in its panel, in a knob's cell on the master's sheet,
              and rising over its tile) and the loudness (there, and in
              the master's knob row), drawn as the audio thread tells
              them;
              PartPanel.tsx the
              picked tile's knobs (the Amp's ghost notes' under a
              heading of their own), adds and moves (ConfirmDialog.tsx asks
              before a removal), after an output's knobs
              OutputCells.tsx's cells, each a knob's size: its track's
              Mute and Solo, and the views its tiles show;
              RoutePanels.tsx routing in the panel's place: the routes into
              a knob held, or a source's depths on the tiles picked;
              tileDrag.ts holds a tile and drags it to a new place; Knob.tsx
              turns one knob of one part (or a source's depth into one),
              finer with the finger off to the side; TrackPicker.tsx
              picks the track played, a popover on its button, and adds
              one (a track is renamed, moved and removed on its strip in
              the Mix); Mutes.tsx a track's Mute and Solo, in its
              strip's panel (a cell of its knob row), the Out tile's
              and the tracks' popover,
              and what the strip is for them; PlaySurface.tsx plays
              notes on Keys.tsx, Pads.tsx or XyPad.tsx, or the kit on
              KitPads.tsx (hands.ts: who
              holds which note, bends it, and on the XY pad places it,
              its Slide from the start), with the lights for the
              bar's steps in its header, or in a row under a narrow
              one (Play and the tempo there too while the rail is put
              away);
              KeysNavigator.tsx moves the keys a white key at a
              time over C−1 to G9 (all of MIDI's notes), ModWheel.tsx the mod wheel at their
              left (the Wheel source) and its Route, PresetBrowser.tsx
              loads, saves and moves presets, a popover on the patch's
              button (placement.ts places it), SurfacePicker.tsx one on
              the surface's (keys, pads or XY, the pads' key; a kit's
              pads), ProjectBrowser.tsx one on the status
              line's project button, left of Settings (the projects
              kept, the session saved under a name, one opened in its
              place, a project's file out and in; #/project), the
              More of their headers MoreMenu.tsx, a menu falling from
              it (New, Rename, Export, Import, Delete apart; as
              MenuButton, from a button of its own, its items one of
              a choice ticked, each with what it holds),
              SettingsDialog.tsx, a modal dialog, holds the settings
              (the theme in Dropdown.tsx, the app's own select, its
              list on the page, out of a panel's glass),
              Measure CPU and the browser's checks; Splash.tsx the
              mark and the name a moment as the page opens, and the
              first tap anywhere starting audio held back; theme.ts the
              colour roles and the themes that give them values, in
              the dark and the light (a pop theme its surfaces too),
              and the mark's inks from the accent; appearance.ts
              setting them, the mode (index.css's tokens) and the
              favicon on the page; pages.ts gives each
              sheet an address (#/presets), so a reload keeps it and Back
              closes it; Popover.tsx the shell every popover stands in
              (its header, its place by its button, its height
              measured, Escape); SettingRows.tsx a titled group of
              settings, a setting's row, a choice's and a switch's
              (Switch.tsx);
              controls.ts the shared sizes, the insets, the section
              heading and the card every panel stands on; FadeRow.tsx
              a row that
              pans sideways, faded out where there is more
scripts/      dev tooling: tailnet.sh, the device-report Vite plugin,
              vite-licences.ts, which gathers LICENSE and the licences
              of what the site ships into licences.txt, vite-offline.ts,
              which builds sw.js and lists in it everything else the
              build ships, and icons.ts, which draws public/'s icons
              and the favicon
public/       copied beside index.html: the manifest, the icons and
              the favicon
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
