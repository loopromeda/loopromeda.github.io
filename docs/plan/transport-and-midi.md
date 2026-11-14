# The transport and MIDI

Asked for by ashon, 2026-11-15 ("전체 플레이백이나 미디 컨트롤을 할 수
있는 UI가 하나 있으면 좋겠어"): one place that controls the whole
playback, and MIDI. Asked where it stands and what it does first, ashon
chose:

- **An always-on bar on the tab rail**, on every view: Play, where the
  song is, the tempo, and a MIDI button opening a popover. Chosen over a
  third tab beside Sound and Mix, and over a sheet of its own.
- **The transport first**: play and stop, the position, the tempo and
  the swing, a click and a count-in, each track's loop on or off. The
  song's several loops, scenes and timeline (`tracks-and-song.md`, E)
  come after.
- **All of MIDI's four**: notes from a keyboard into the track picked,
  knobs turned by a controller (MIDI learn), following an outside clock,
  and sending one out.

Web MIDI is Chrome's (Android, desktop) and Firefox's with a site
permission; Safari, iOS's every browser among them, has none. MIDI is
an enhancement there: its button shows only where the browser offers
it, and nothing else waits on it (`initial-setup.md`).

## The stages

Each builds on the last and is usable by itself.

### 1. The transport on the rail

- **Where**: the tab rail (Sound | Mix, the project, the settings) holds
  Play, the position and the tempo between the switch and the project,
  on every view. The play surface's header gives its own up while the
  rail is shown, and keeps it while the controls are put away (the rail
  with them); its row under a narrow header keeps the keys' navigator,
  or the bar's lights, and Hide.
- **The position** reads bar, beat and sixteenth (`3.2.1`) counted from
  Play, written outside React a step at a time as the audio thread tells
  of them; `1.1.1` dim while stopped; the beats left (`−4`) while it
  counts in.
- **The tempo's popover** becomes the transport's: the tempo and the
  swing as before, then the click and the count-in, then each track with
  its loop on or off.
- **The click** sounds each beat, the bar's first higher, on the audio
  thread (`src/dsp/click.ts`), on an output of its own wired straight to
  the speakers: heard, but never in the master's views, its meters or
  its loudness, as a studio's click goes to the monitors and not the
  mix (ashon: "click 음은 마스터링 아웃풋 시각화에 안잡혀도 좋을 것
  같은데"). A device setting, as the count-in is.
- **The count-in** is a bar of clicks before the first step, whether
  the click is on or not: the steps count from −16 and the lanes fire
  from 0.
- **A track's loop off** plays nothing from the next step on, its notes
  ending where they were going to; its keys still play, which a mute
  would silence. Kept in the song (`Song.off`, by the track's id), so a
  project keeps it. On the bar, as scenes will be, comes with E.

### 2. Notes from a MIDI keyboard

- **Access is asked for by a tap** (the MIDI popover's Connect): Chrome
  asks the player. Once given, it is asked again with the page, silently
  (`navigator.permissions`).
- **Every input, or the one chosen**, plays the track picked, on any
  channel. A synth plays the note at its velocity; pitch bend bends
  every note held, two semitones each way; the mod wheel (CC 1) turns
  the Wheel; the sustain pedal (CC 64) holds what is let go until it
  lifts. A kit plays its pads from C1 (36) up, one a semitone.
- MIDI's notes hold their own ids (`Engine.noteOn`'s), apart from
  touches, the computer's keys and the sequencer's.
- Parsing MIDI's bytes is pure (`src/engine/midi.ts`) and tested.

### 3. MIDI learn

- **Learn** (the popover's) arms the knobs: a knob tapped is picked, not
  turned, and the next controller (CC) moved turns it from then on. A
  knob bound shows its controller while learning; the popover lists
  what is bound, each removed by a tap.
- **What can be bound**: a knob of a track's sound (a synth's, or a
  kit's chain), by the track, the part and the key, whichever track is
  picked; a knob of the mix. A controller's 0 to 127 sweeps the knob's
  travel as a drag does (its curve).
- **Kept with the project** (`loopromeda.midi`, and a project's file),
  a binding to a track removed going with it.

### 4. Clock out

- Start, stop and 24 clocks a beat to every output, or the one chosen,
  while it plays (the count-in too), the first clock after Start on the
  first step as it is heard: the audio thread tells the frame each step
  fell on, which the output's timestamp turns into the page's time.
  Scheduled ahead (Web MIDI's timestamps), so the page's own hiccups do
  not move them.

### 5. Following an outside clock

- Start plays from the first step, Continue too (no song position
  yet), Stop stops. The tempo is measured from the clocks, smoothed, and
  played without being written into the song; the tempo's button shows
  it. A small correction keeps the steps in phase with the clocks.

## Not planned yet

A channel for each track, a song position, MIDI's notes recorded into a
loop, a learned knob's own range, and MIDI out for notes.
