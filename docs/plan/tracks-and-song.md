# Tracks, kits and a song

Asked for by ashon, 2026-11-13 ("신스와 키트들을 잘 관리할 수 있게 한번
만들어 볼 수 있나? 한개 트랙당 단일 신스나.. 키트가 배치되고.. 키트는
기존의 신스를 기반으로 만들어 지고.. 키트에 등록할 패치는 신스와 그
음계까지도 매핑할 수 있게.. 믹스에서는 키트 신스 등을 여러개 배치하고
시퀀스를 각자 넣고 곡을 만들 수 있게"). Read as five things:

1. Synths and kits are managed well: added, named, removed, kept.
2. **A track holds one instrument**, a synth or a kit.
3. **A kit is made of synths that exist**: presets mapped onto its pads,
   as now (`effects-parts-sequencer.md`, 2).
4. **A pad maps a preset and its note** ("음계"): read as the note the
   pad plays its preset at, so one preset can stand on several pads at
   different pitches (a row of toms, a bass line's notes, a scale).
5. **In the Mix, several synths and kits stand side by side**, each
   with a sequence of its own, and together they make a song.

This revises two things chosen on 2026-11-12 (`effects-parts-
sequencer.md`, "What ashon chose"): the two fixed parts and their
Synth | Kit switch become tracks, as many as are added; and the
sequencer's one pattern (the kit's lanes and one synth track) becomes a
sequence for each track. What that plan says of the kit itself (pads
mapping presets by reference, one chain for the kit, in the Sound view)
stands.

## The stages

Each builds on the last and is usable by itself.

### A. A note for each pad

Built 2026-11-13.

- A pad holds its **note** beside its preset (`KitPad.note`,
  `src/state/kit.ts`): a MIDI note, C4 (`PAD_NOTE`) where none is
  given, so every kit kept before reads as it played. Kept with the kit
  (`loopromeda.kit`, still version 1: the field is new, nothing else
  moved).
- A hit plays the pad's sound at its note (`Engine.hit`); the worklet
  needs nothing new, a note being named by every noteOn already.
- **The pad's panel** (`PartPanel`) sets it: the note's name between
  buttons a semitone and an octave down and up. A pad's tile and the
  surface's pad show the note when it is not C4.
- Mapping a preset onto a pad keeps the pad's note: the note is the
  pad's, the sound the preset's.

### B. Tracks

Built 2026-11-13.

- **A track** is one instrument and its place in the mix
  (`src/state/tracks.ts`): an id, a kind, a name of its own or its
  kind's and number (Synth 1, Kit 2), and for a synth its sound and the
  preset it came from, for a kit its sixteen pads and its chain. Up to
  eight (`MAX_TRACKS`): the worklet's node has its outputs fixed when
  it is made (one for each track's view after the master's), and a
  phone's block has room for about that (below).
- **The session** keeps the tracks in one place (`loopromeda.tracks`),
  read at first from what was kept before: the synth's sound
  (`loopromeda.session`) as track 1 and the kit (`loopromeda.kit`) as
  track 2, so a session opens as it was left. The mix's strips
  (`Mix.strips`) stay an array beside the tracks, one fader each, added
  to, removed from and reordered with them.
- **The audio thread** builds a part for each track when the layout
  comes (a message, never in `process()`): a synth track a `ChainSynth`
  of the device's voices in a strip; a kit track sixteen of four voices
  in a group. Parts are kept by track id across layouts, so a track
  added or removed leaves the others' notes sounding. Every message
  that named a pad names a track too.
- **The engine** edits the track picked (and its pad, for a kit), as it
  edited the part played. The library's presets load into the picked
  synth track; a preset saved over plays anew on every pad of every kit
  mapped to it.
- **The surface**: the Synth | Kit switch becomes the track's button
  (`src/ui/TrackPicker.tsx`), its name, opening the tracks as a popover
  (each its number, its name and what it plays; "+ Synth" and "+ Kit"
  under them) to pick one. The keys play the track picked.
- **The Mix**: a strip for each track, down one column at the left, as
  a sound's inputs stand before its chains, and under the last a
  "+ Track" that adds a Synth or a Kit, in the row of "+ Bus" and
  "+ FX". The mixing goes on to the right as chains: each bus a row,
  then the master's effects and the Master. More tracks make the mix
  taller, never wider (ashon, 2026-11-13; they stood in columns of two
  before, a "+" in a column beside them, which pushed the buses and the
  Master off a phone's screen): a strip is 62 px tall at least, for its
  view under its name; the column and the rows stand as tall as the
  taller of them, the rows growing up to twice their height and then
  standing in the Master's middle; past the frame's height (22rem, or
  45% of the screen's) the mix pans down. A strip is 84 px wide at rest
  (it was 72), for a name by kind and place and its level on one line;
  a longer name is cut short. Tapping a strip picks its track; its
  panel renames it (a field in the panel's header; blank, its kind's
  and place's name again), moves it up or down and removes it (asked
  first, `ConfirmDialog`; never the last one).
- **As built, where it differs or was left open**:
  - A track without a name of its own is called by its kind and its
    place (Synth 1, Kit 2), so moving it renames it; its id (t1, t2, …)
    is what the audio thread and the pick hold.
  - A new synth starts on the first factory preset, a new kit as the
    factory's (`Library.addTrack`), with a strip at full level sending
    to A, and is the one played once added.
  - The session's keys of before (`loopromeda.session`,
    `loopromeda.kit`) are read once and left where they are;
    `loopromeda.part` now keeps the track picked and the pad.
  - A track's part is built in the worklet's message handler when the
    layout comes: an added synth track (its voices) may cost a block
    there. Not heard on the M3 Max; not tried on a phone.
  - A strip's view (Scope, Spectrum, …) is kept by place, so it does
    not follow a track that moves.
  - What redraws on the tracks follows `tracksKey` (their ids, kinds
    and names), never the tracks themselves: every knob turned
    replaces them.
- **Cost**: a track at rest is passed over (0.002 ms for the whole kit
  at rest, M3 Max). Sounding, the Fold measured 0.68 ms for 16 voices of
  the heaviest sound, of a 2.67 ms block whose third is the budget
  (0.89 ms): every synth track at full voices does not fit, as two do
  not today. The voices' limit stays each synth track's for now; a
  budget shared by all tracks, the oldest voice of any stolen, comes
  with the sequencer, which is when many tracks sound at once.

### C. Kit files

A kit saved and loaded whole, as a preset is: its pads (each a preset's
reference, its sound as kept, its note) and its chain. A kit track's
button lists kits as a synth track's lists presets. A factory kit or
two beside the first.

### D. A sequence for each track

Built 2026-11-13.

- **The clock on the audio thread** (`src/dsp/sequencer.ts`): counted
  in frames, sixteenths at the tempo (30 to 240, to a hundredth of a
  beat since 2026-11-15, so a tracker's 112.5 keeps time), each pair split by
  the swing (even to 75%). Each track has a lane, its loop played
  round at the loop's own length. A note starts on the frame its step
  falls on and is let go on the frame of the step it ends at: a strip
  keeps a queue of what is to start and stop within the next block
  (`src/dsp/output.ts`) and renders up to each in turn. The main thread
  sends the transport, the tempo and each loop whole as it changes; the
  worklet tells of each step as it passes (`step`, -1 as it stops).
- **The song** (`src/state/song.ts`, kept as `loopromeda.song`): the
  tempo, the swing and each track's loops, by the track's id, apart
  from the track's sound, so a preset loaded leaves the loop alone and
  a track removed takes its own. A track holds a list of loops, of
  which this stage plays and edits the first (E adds the rest). A loop
  is one to four bars of sixteenths (256 bars, 4096 steps, since
  2026-11-15, so a whole song fits one loop, and a long take: H) and
  its notes, each a step, a key,
  a length and a velocity: a synth's key is the note, a kit's the pad.
  More than one note at a step is a chord. A loop made shorter keeps
  the notes past its end, unplayed.
- **A kit's note** plays its pad at the pad's own note and is held for
  its step's length. Up to 32 notes of a lane sound at once.
- **Seq is a setting beside the surface's kind** (`surface.seq`), not a
  fourth kind: Keys, Pads or XY is kept under it and comes back. One
  setting for every track; a kit's surface button offers Pads and Seq.
  Since moved up, to a tab of the editor's rail (G).
- **The step grid** (`src/ui/StepGrid.tsx`, its geometry in
  `src/viz/steps.ts`): a bar of sixteen columns, a row for each key,
  as many as stand 20 px each (a synth's chromatic from C3, a kit's
  sixteen pads), moved up and down by the rows shown. A tap puts a
  note and, stopped, sounds it; a tap on a note takes it away; a drag
  up or down from a note sets how hard it plays, sideways (a synth's)
  how long. Bars are picked by number, added and taken at the end;
  Clear asks first. The column playing and the bar's number are lit
  outside React. While it plays the grid shows the bar playing, a page
  at a time, as the position over it counts the bars (ashon: "위쪽에서는
  1 -> 2 -> 3 -> 4 로 가는데 아래쪽 노트는 그대로 있어서"), until a bar
  is tapped; the bar playing is ringed, not underlined, and a note is one
  colour, no lighter edge at its start.
- **The transport** (Play and the tempo, `src/ui/Transport.tsx`) stands
  in the play surface's header whichever surface is up, in a header 600
  px wide or more; in a narrower one (a phone upright) in a row of its
  own under it, with sixteen lights for the bar, since the track, the
  patch, the surface and Hide leave it no room. The tempo's button
  opens the tempo and the swing, a popover. Since moved to the tab
  rail, with the position, a click, a count-in and each loop on or off
  (`transport-and-midi.md`, 1): the header keeps it only while the rail
  is put away.
- The column lit leads what is heard by the output's latency.
- Not built: a voice budget shared by all tracks (B, Cost), a hat's
  choke. Recording what is played into a loop: since H.

### E. A song

Chosen by ashon, 2026-11-13, asked whether loops, scenes or a timeline:
all three ("전부 가능하면 좋을 것 같아. 루프를 만들고 씬을 돌리면서
타임라인으로 레코딩 하기도 해야하거든"). Read as layers, each built on
the last:

1. **Loops**: a track holds several loops (D keeps the list already)
   and plays one of them, or none.
2. **Scenes**: a scene names a loop, or none, for each track. A scene,
   or one track's loop, is started by hand and comes in on the bar.
3. **A timeline, recorded**: with recording on, what is started is
   written along the song's bars as it is played: which loop each track
   plays from which bar. The timeline plays that back, and is edited
   afterwards.

What is recorded is the starting of loops and scenes, not sound: to be
confirmed with ashon. To be built in that order, each usable by itself.

### F. Knob lanes

Asked for by ashon, 2026-11-15 ("트랙에서 각종 노브 다이나믹도 컨트롤
가능하게 만들어 보면 좋겠네"), and chosen from options: automation lanes,
drawn in Seq, one knob's value at every sixteenth of a track's loop;
not per-step locks, not a Steps modulator, not recording alone. A demo
came first; ashon took its defaults ("좋아"): a new lane at Step, a lane
as long as its loop, drawn with a finger or filled, and each lane its
own Step or Glide, on or off, and removed. Built 2026-11-15.

- **A loop's lanes** (`src/state/song.ts`): up to eight, each a knob (a
  part of the track's sound and a key, or `FADER`, the track's fader),
  Step or Glide, on or off, and a value for each step in the knob's
  own units. A new lane is flat at the knob's own value. A loop made
  longer repeats its lanes' values from the first; made shorter, it
  keeps them, as it keeps its notes. Clear takes the notes, not the
  lanes.
- **The knobs a lane may move** (`src/state/lanes.ts`): a synth track's
  sound, part by part in the editor's order (its inputs, its chains'
  levels and sends, their items, its modulators, its inserts, the amp,
  the voice, its sends), every knob that turns and is shown (not a
  choice, not a synced delay's time), then the fader's level and
  balance. A kit's pads are each a sound of their own: a kit's lanes
  move its fader.
- **On the audio thread** (`src/dsp/automation.ts`): each block, once
  the sequencer has moved, each lane hands its knob its value where the
  song stands: held to the next step, or a line to it (in ratios for a
  knob that turns so, a cutoff, a time). A lane's value stands in place
  of the knob's own (`SoundPlayer.move`, `Part.moveLevel`), which is
  kept: a knob turned while its lane plays is heard once the lane lets
  go, as the song stops, a lane is put off or removed, or panic. A muted
  track stays silent whatever its fader's lane says. Lanes play only
  while the loop is on, and the engine sends them with the loop,
  resolved on the track's sound, again when a sound changed moves them
  elsewhere.
- **In Seq** (`src/ui/LaneStrip.tsx`, `src/viz/laneStrip.ts`): one lane
  under the grid (since G, every lane, one over another), the bar
  shown, its sixteen columns in line with the grid's, the knob's own
  value dashed across it, the step playing lit;
  at its left, under the grid's names, the value playing, or stopped the
  knob's own. A finger drawn over it writes each step it passes, a quick
  stroke on a line; a lane off is put on by it. Over it: its name (a tap
  lists the loop's lanes and the knobs a lane may take, in the grid's
  place, `src/ui/LanePicker.tsx`), Step or Glide, on or off, Fill (Flat
  at the knob's own value, Rise, Fall, Peak, Random, over the whole
  loop) and remove, which asks first. With no lanes, Lane stands in the
  grid's header (since G, always, and the lane's name only names it).
- **Room**: a lane under it, the grid keeps three rows and the lane's
  strip gives way to 24 px; where even that does not fit (a phone
  upright with the sound editor open) the lane is cut off: the surface
  raised shows it whole. G gave the grid the editor's room instead.
- Not built: recording a knob turned while it plays into its lane;
  lanes for a kit's chain (its inserts, its sends), the buses or the
  master; the panel's knob turning with its lane; a route's amount.

### G. The sequencer up top

Asked for by ashon, 2026-11-15, as the lanes made Seq fuller ("시퀀스
안에 기능이 많이 들어오고 있는데 하단 패널은 그냥 컨트롤 할 수 있는
부분으로 두고 시퀀스를 상단으로 빼는게 어떨까? 그러면 다른 트랙을
빠르게 컨트롤 할 때는 아래를 쓰고 시퀀스는 위에서 쓰거나 할 수 있을 것
같은데.."). Asked whether the top's sequence follows the track played
below or is picked on its own, ashon chose its own ("따로 고르기"): a
bass's loop written above while a lead is played under it. Built
2026-11-15. This undoes the place chosen for it at first
(`effects-parts-sequencer.md`: a play surface under the editor).

- **The Seq tab** (`src/ui/SeqView.tsx`): the editor's rail reads Sound,
  Seq, Mix, and Seq fills the editor's card: a chip for each track, by
  its name, and under them the step grid of the one picked, its lanes
  stacked under it, panned up and down past 45% of the height. No knob
  panel stands over it; the sound's tiles are a tab away, while the
  play surface below still plays.
- **The track it shows** (`Engine.getSeqTrack`, kept as
  `loopromeda.seq`): picked on its chips, apart from the track played
  (`getTrack`), which a project opened sets to its first, as it does
  the track played. A track removed hands it to the one after, as the
  track played is; one gone otherwise shows the track played.
- **Heard and picked from the grid**: a row's name plays its key on the
  tab's track, whichever is played (`Engine.playKey`), and on a kit
  picks the pad only where the kit is the track played.
- **The play surface** keeps Keys, Pads and XY, a kit its pads; a Seq
  of before is let be when the surface's settings are read.
- **Room**: held upright, the grid takes what the surface leaves, more
  rows than it had under the editor. On a phone on its side the editor
  is short: three rows and no lane until the surface is put away (its
  fold button), which gives the grid the height.

### H. Recording

Asked for by ashon, 2026-11-15, looking at the Seq tab on a phone ("여기서
레코드 버튼을 눌러서 아래 컨트롤에서 시퀀스를 녹화할 수 있게 할 수
있을까?"): a record button, and what is played on the play surface below
written into a sequence. Asked, ashon chose: the notes go to the track
played below, and the Seq tab moves to it; both Overdub and Replace, a
choice; the button on the tab rail beside Play, which, stopped, plays
too. Built 2026-11-15.

- **Record** (`RecordButton`, `src/ui/Transport.tsx`): a dot beside Play
  on the tab rail, and in the play surface's header while the rail is
  put away; filled red while it records. Stopped, it plays from where
  Play would, after a bar counted in where asked. It stops with the
  transport, or tapped again.
- **Overdub or Replace** (the device's `record`, `src/state/settings.ts`):
  in the transport's popover, under the count-in, not beside the button
  as first offered: the rail has no room for it. Overdub adds to what
  is there, a note on the same step and key in its place. Replace first
  empties the loop of the track played a step ahead of the sequencer,
  one time round, keeping what is recorded on the way, then overdubs.
- **A loop of no notes** (ashon, 2026-11-15: "최대 길이를 그냥 무한대로
  해도 되지 않을까"; of three ways offered, this one): recorded into, it
  does not go round but grows, a bar ahead of the bar playing, as long
  as the take lasts, up to 256 bars (eight and a half minutes at 120:
  4096 steps, the limit ashon set).
  Where recording stops, on the bar line nearest, is its length, long
  enough for every note to start in it, a note held past it cut there;
  nothing played, it keeps the length it had. A loop with notes goes
  round as before, in Overdub or Replace. Endless was not offered: a
  loop's steps and its lanes' values are held whole, in the audio
  thread and in localStorage.
- **What is written** (`src/state/record.ts`, pure): each note started
  while recording, into the loop of the track it sounds on, the track
  played below (Engine.setRecording shows it in the Seq tab, and the
  tab follows a track picked while recording): on the sixteenth nearest
  where it was heard, as long as it was held (a kit's pad a step), as
  hard as it was played, on the semitone nearest the pitch it started
  on (the XY pad's are between them; its bends are not kept). A beat
  counted in holds no note, but one played just ahead of the downbeat
  is its first step. The loop is put on as it is written.
- **When**: the audio thread tells the page where the sequencer stands
  as each note starts and ends (`stamp`, `src/worklet/processor.ts`);
  the engine takes the output's latency off, so a note lands where it
  was heard, not where the thread was. A note is written once let go,
  and only after its step has played: one played just ahead of its step
  sounds as played, not a second time from the loop.
- **Room**: under 512 px wide (a phone held upright: the Fold 8's
  cover, 416) the rail's three tabs fold into a dropdown, the one shown
  and a chevron, without the tabs' frame (both ashon's asks); the
  project's name gives way next, and under 384 px the position, so
  Record still fits (the Seq tab follows the bar playing). The pad
  panel's presets (Kick, Snare…) are 28 px, as its note's steps are, at
  ashon's ask. In the play surface's header
  (600 px wide or more) the keys' navigator keeps 64 px at least, the
  patch's name giving way first: moving the header's threshold to 644
  instead put the navigator in a row of its own on the Fold 8's cover on
  its side (657 wide), and cut the knob panel above it.
- Not built: recording a knob turned (F); a step other than the
  sixteenth to land on; undoing a take; recording the loops started
  along the song's timeline (E, 3).

### I. Ornaments

Asked for by ashon, 2026-11-15 ("루프에서 꾸밈음같은것도 넣도록
바꿔보고 싶은디 가능할까?"). Asked, ashon chose an ornament attached to a
note ("노트에 붙이기"), not notes of its own, and all four kinds offered;
a demo of the editor and its marks was approved with the EQ's ("둘다
좋네"), and the work begun after it was committed ("좋아 커밋하고 꾸밈음
작업 진행하자"). Built 2026-11-15.

- **What a note plays** (`src/dsp/ornament.ts`, pure): none, the note
  alone; a **grace**, one to three notes a semitone or more (to an
  octave) from it, up or down, before its step or on it, the note after
  them; a **mordent** (the note, its neighbour, the note) or a **trill**
  (on and on, to the note's end); a **roll**, strokes flat, rising or
  falling; an **arpeggio** of a chord (eight: Maj, Min, Sus4, 5th, Oct,
  Maj7, Min7, Dim), up, down or up and down. Each at 2, 3, 4, 6 or 8
  sounds a sixteenth. A trill or an arpeggio moves the pitch of the note
  sounding, as a tracker does, or strikes each sound anew. A kit's pad
  has no pitch to move: it takes a grace (a flam, a drag, a ruff, softer)
  and a roll only. A note expands to its sounds, 1024 at most.
- **Kept** (`src/state/song.ts`): a note's `ornament`, read back
  cleaned; a note made longer, softer or harder keeps it.
- **Played** (`src/dsp/sequencer.ts`): each note's sounds on their own
  frames within the step's swung length, a grace before the step taken
  from the step before (looked for two steps ahead); a pitch moved is a
  move on its strip's queue (`src/dsp/output.ts`), the voice's pitch
  jumping at once (ChainSynth.bend). A note going on as its loop is
  edited goes on where the same note is still there; one changed on its
  step and key (its ornament, its velocity, its length, a ghost or not)
  carries on as it now is from the next step, its pitch moved there at
  once, the note it holds ending where the new one's would. At Play, a
  grace before the first step is not heard; the second time round it is.
- **Heard while edited**: stopped, each change plays the note alone, its
  ornament and all, at the song's tempo (Engine.auditionNote,
  Sequencer.audition), the one heard before stopped at once (a choke of
  a few ms, ChainSynth.cut), not let go through its release; playing,
  the note sounding takes the change from the next step, and the loop
  plays it so after. ashon, 2026-11-16: a change should be heard at
  once, even as the note is held ("꾸밈음이 바뀔 때 음이 지속된다고 해도
  바로 바뀌면 좋겠는데"), where the release had sounded under the next
  and a trill changed under it had stopped where it stood.
- **Edited** (`src/ui/StepGrid.tsx`, `src/ui/OrnamentPanel.tsx`): a note
  held still, or tapped with Ornaments on (a trill's zigzag beside
  Lane), is picked and ringed. The panel stands in the lanes' place
  while Ornaments is on: the kinds, then what the kind plays (the
  interval, with the note it reaches; how many graces; the speed, with
  a sound's length in ms; where; the chord and its order; whether each
  sound restarts), each row panned sideways where it is longer than the
  grid is wide. It is as tall whatever it shows, so a row of the grid
  stays under a finger. With Ornaments on a tap picks a note instead of
  taking it away, and an empty step gets a note, picked. A kind left
  keeps what it was set to while the panel is open.
- **Marks** (`src/viz/ornament.ts`): a grace a box half a row tall on
  its own row (a flam on its pad's, before it), a stroke where the note
  strikes again (a roll, a restart, the note after graces on the beat),
  a zigzag through a mordent or a trill, stairs through an arpeggio; a
  grace before the loop's first step shown at its end, where it plays.
- Not built: a recorded note's ornament (a take writes none); an
  ornament for several notes at once; a trill to the scale's next note
  (semitones only); swing within an ornament.

### J. Ghost notes

Asked for by ashon, 2026-11-15, after the ornaments, for a guitar's
ghost notes ("꾸밈음 말고 꾸밈음효과를 가지고 고스트 노트같은것도 넣어보고
싶어. 기타를 표현하는 경우 고스트 노트가 필요할 수 있거든."). Asked, ashon
chose a note that is itself a ghost (not a mark beside one), played as a
real mute rather than only softer, and a demo first; the demo's proposals
were approved ("좋아"). Built 2026-11-16.

- **A note may be a ghost** (`src/state/song.ts`: `ghost`, set only when
  true, read back only where it is true): it keeps its step, key, length,
  velocity and ornament, and an ornament given or a drag keeps it a
  ghost. A loop of no ghosts reads as before.
- **How a ghost sounds** is the sound's: four knobs on its Amp part
  (`GHOST_KNOBS` in `src/state/sound/kinds.ts`), under a Ghost notes
  heading of their own in its panel. Level (55%): how loud beside a
  note; on a synth, Decay (0.1 s): the time it takes to fall away; Tone
  (760 Hz): the lowpass it is shut down to; Click (35%): a pick's
  scrape. A sound saved before them plays its ghosts at these.
- **A synth plays a ghost muted** (`src/dsp/chainVoice.ts`,
  `GHOST_MUTE`): the voice's own sound through a lowpass at Tone (a state
  variable filter, Q 0.7) with a scrape added (noise in a band at
  2.6 kHz, falling with a 4 ms time constant), through an envelope of its
  own in the amp's place (1.5 ms up, to nothing within Decay), whatever
  the amp's envelope, at Level. Gone, the voice is free while its key is
  still held. In mono play a ghost strikes afresh, never legato, and so
  does the note after one, or the note held under it once it ends.
- **A kit's pad plays a ghost softly** (`GHOST_SOFT`): the hit as it
  is, at the Level of the preset mapped onto it (set on a synth's Amp,
  kept with the preset; Decay, Tone and Click unheard there).
- **Played** (`src/dsp/sequencer.ts`): a ghost note's start, and each
  sound of its ornament (a roll of muted scrapes), goes to the target as
  a ghost (`Target.on`'s ghost): a synth's strip queues it muted, a kit's
  pad soft (`src/dsp/output.ts`). A note made a ghost as the loop plays
  is a note of its own: what was being played out of it stops.
- **Edited** (`src/ui/StepGrid.tsx`): Ghost (a hollow note with an x,
  beside Ornaments, the one or the other) makes a tap on an empty step
  put a ghost, and a tap on a note make it a ghost or a note again;
  drags set a ghost's velocity and length as a note's. The ornament
  panel's first row has a Ghost switch for the note picked. Stopped,
  each change is heard (Engine.auditionNote). A ghost is drawn hollow
  with an x in its first step (none where its ornament marks the box),
  its graces hollow, its ornament's marks in the accent.
- Not built: a ghost recorded or played by hand (a take writes notes);
  a ghost's own velocity curve; a ghost on a kit muted.

### K. Meter

Asked for by ashon, 2026-11-17 ("시퀀서의 루프의 마디를 정할 때 박자도
정의할 수 있을까?"). Proposed: one meter for the whole song, beside the
tempo and the swing, the steps still sixteenths and the tempo still in
quarters, of quarters or eighths, a loop keeping its bars when the meter
changes; ashon agreed ("좋아 진행 해 보자"). Built 2026-11-17: the
engine's part by Main, the screen's by UX.

- **A song has a meter** (`src/state/meter.ts`, `Song.meter`): so many
  quarters or eighths to a bar, a bar of 32 steps at most (8/4, 16/8:
  the step grid shows a bar across); four-four unless set, and a song
  kept before meters, or in one longer, reads as four-four. A bar is that
  many sixteenths: 12 steps in 3/4 and 6/8, 20 in 5/4, 14 in 7/8.
- **A beat** is a quarter in x/4; in x/8 a dotted quarter where the
  eighths go in threes (6/8, 9/8, 12/8, 15/8), an eighth where they do
  not (3/8, 5/8, 7/8). The click sounds each, the bar's first higher;
  the count-in is a bar of them; the arrow keys move by them, and Play
  starts on one (a cue between beats in a new meter goes back to the
  beat it falls in).
- **The tempo still counts quarters** (`src/dsp/clock.ts`), so a synced
  delay or LFO keeps its time in any meter. A bar and a beat are always
  an even number of steps, so the swing's pairs stay whole.
- **A loop is whole bars of the meter** (`Loop.steps`), as many as 4096
  steps hold (256 of 4/4, 341 of 3/4, 204 of 5/4). A meter set
  (`setMeter`) keeps each loop's bars: two bars of 4/4 are 24 steps in
  3/4, the notes kept on their steps, those past the new end not played
  (back with the old meter, or the loop made longer), its lanes repeated
  to the new length. A take into a loop of no notes grows by the meter's
  bars and ends on its bar line nearest.
- **On the audio thread** (`src/dsp/sequencer.ts`, `setMeter`): the
  bar's steps and the beat's, sent with the tempo (`tempo` message); the
  lanes play round at their own lengths as before.
- **Picked** in the tempo popover (`src/ui/Transport.tsx`), under the
  swing: 2/4, 3/4, 4/4 and 5/4, then 6/8, 7/8, 9/8 and 12/8 (24 steps
  at most, so a phone's outer screen gives each column some 10 px), a
  song's own beside them where it is in another; its beats a bar beside
  the heading, and the meter after the tempo in the popover's note.
- **Shown in it**: the step grid a bar of the meter across, each beat's
  first shaded (`src/ui/StepGrid.tsx`, `src/viz/steps.ts`), the knob
  lanes (`LaneStrip.tsx`) and the ornaments' marks with it, the bar's
  lights a bar of the meter (the beats' larger), and the position as
  bar, beat and step within the beat (`src/viz/position.ts`), the
  count-in's beats left (−3 in 3/4, −2 in 6/8).
- Not built: a loop's own meter (polymeter), a meter that changes within
  the song, beats grouped unevenly (7/8 as 2+2+3), x/16.

## Projects

Asked for by ashon, 2026-11-13 ("시퀀스와 현재 악기 구성을 전부 저장할
수 있는 기능도 있으면 좋겠는데 가능할까?"): the sequences and the whole
set of instruments, saved. Built 2026-11-13.

- **A project is a session kept under a name** (`src/state/project.ts`):
  the tracks (each synth's sound, each kit's pads and chain), the mix
  and the song (the tempo, the swing, each track's loops). The user's
  presets are not part of it: a synth's track holds its own sound, and
  a kit's pad the sound it last played, which it plays again where its
  preset is gone; where the preset is still there the pad follows it,
  as a kit does (so a project opened plays as the presets are now).
- **Kept on the device** (`src/state/projects.ts`): every project under
  one key (`loopromeda.projects`), and the name of the one the session
  came from under another (`loopromeda.project`). The session itself is
  kept as before, so a reload brings back what was playing, saved or
  not. A synth and a kit make about 12 KB; storage that is full, or
  refuses, says so in the popover and leaves the projects working for
  the visit.
- **Edited** is told by whether the tracks, the mix and the song are
  still the objects that were saved or opened, not by comparing what
  they hold on every change: an edit taken back by hand still reads as
  edited until the project is opened again or the page reloaded (which
  compare closely). Picking a track or a pad is no edit.
- **The projects' button** stands on the status line, left of Settings,
  with the current project's name and a dot once it is edited; it opens
  a popover (`src/ui/ProjectBrowser.tsx`, `#/project`): Save over the
  current project, Save as… under a new name (a name taken gets a
  number, so none is written over), and under More: New (a first
  visit's session), Rename, Delete, Export and Import. A tap on a
  project opens it in the session's place, stopping the transport;
  with edits unsaved it asks first, and a tap on the current one offers
  to go back to it as saved. Deleting the current project leaves what
  plays playing, in no project.
- **A file holds one project** (`format: 'loopromeda-project'`,
  version 1), shared where the device shares files and downloaded
  elsewhere, to keep off the device or move to another. A file
  imported is added to the list, not opened; what it holds is read as
  untrusted, as the session's keys are.
- Not built: a project's own presets (so it opens the same whatever
  became of them), a copy of a project, an undo for Delete.

## Mute and solo

Asked for by ashon, 2026-11-13 ("트랙을 뮤트하는 기능도 있으면 좋겠네.
솔로나."). Built 2026-11-13.

- **Two flags on a track's strip in the mix** (`src/state/mix.ts`:
  `mute`, `solo`, set only when on). A strip muted is silent; while any
  strip is soloed, only those soloed are heard; one both is muted
  (`stripState`: on, mute, solo, or off for another's solo). They are
  the mix's, so they are kept with it, saved with a project, and a
  toggle marks the project edited.
- **Silent is the fader at 0** (`applyMix` in `src/worklet/sound.ts`):
  the track's level goes to nothing, smoothed as any fader's move, so
  nothing of it reaches its sends or its meter, while its sequence and
  its voices play on in time and it comes back mid-phrase. What it
  sent to a bus before rings out there. Nothing in `src/dsp` changed.
- **Where**: Mute and Solo stand in the strip's panel in the Mix and in
  the Out tile's panel in the Sound view (`src/ui/Mutes.tsx`), and as a
  small M and S on each row of the tracks' popover, which stays open.
  In the Mix a strip's tile reads Mute or Solo in its level's place
  and is dim while not heard, and the track's button carries a dot
  (emerald soloed, amber muted or silent for another's solo) and says
  so to a screen reader.
- **What follows from it**: a track added while another is soloed is
  silent until it is soloed too or the solo lifted; a muted track's
  keys and pads make no sound either (the dot on its button is the
  sign).
- Not built: M and S on the Mix's strip tile itself (it is one 84 px
  button), a solo that clears the others, mutes for a kit's pads or
  for the buses. Not tried at 390 px or on a phone.
