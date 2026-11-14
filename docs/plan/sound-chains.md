# A sound built from parts

Asked for by ashon, 2026-11-10: instead of one fixed set of parameters
(two oscillators, noise, ring, one filter, three envelopes, two LFOs and
eight matrix slots), a sound is assembled. Oscillators are defined as
inputs; chains choose which inputs to mix, and process them with items in
any order; modulators move any knob. The drum kit (one sound per pad) is
built on the same model, so a kick, a snare and a pad synth come from one
engine, one schema and one preset format.

## The model

```
inputs      IN 1 Saw     IN 2 Square, FM from IN 1     IN 3 Noise   IN 4 Ring 1×2
               │                 │                          │            │
mix         chain A ← IN 1 100%, IN 2 60%      chain B ← IN 3 100%, IN 4 30%
               │                                            │
chains      A: [Filter LP] → [Drive]                  B: [Filter BP]
               └───────────────── sum ────────────────────┘
                                   │
output                amp envelope, pan → voice

modulators  [Env] [Env] [LFO] [LFO] …     sources: these, velocity, key,
routes      source → any knob × amount            slide, random, wheel
            (× via, another source)
```

- **Inputs** make sound: an oscillator (wave, octave, semi, fine, width,
  and FM from another input), noise, or a ring (the product of two other
  inputs). An input is heard only through the chains that take it, and
  read raw by the inputs that name it.
- **Chains** each take a mix of inputs (a send level per input; an input
  can feed several chains, or none) and pass it through their items in
  order. Items process: a filter, drive, more later. The chains are summed.
- **The output** is the amp envelope (and velocity, and the pan) and the
  voice (mode, glide): one of each, always there.
- **The pan** (since 2026-11-12, ashon: "사운드 패닝도 되도록 해 보자",
  chosen over a pan per chain and one for the whole sound) is the amp's
  last knob, -1 (L 100) to 1 (R 100), C in the middle: where each voice
  stands between the sides, the voices summed in stereo since. A route
  moves each voice from there on its own: an LFO pans it to and fro, the
  key spreads the notes across (low left, high right), random gives each
  note a place. Equal power: a quarter turn across, the sides √2·cos and
  √2·sin of it, so a voice in the middle is in each side as it was in
  mono (every sound saved before plays as it did) and is as loud
  wherever it stands, one side 3 dB up at an edge, the other silent.
- **Modulators** are envelopes and LFOs. **Routes** connect a source (a
  modulator, velocity, key, slide (a finger's on a pad, or up the XY
  pad), random, the wheel) to any knob that
  can be modulated, by an amount of that knob's modulation scale,
  optionally scaled by a via source. Pitch of the whole voice, the
  amp's gain and its pan are destinations too.
- **The wheel** (since 2026-11-12, ashon: a mod wheel beside the keys
  for dynamics) is a strip at the keys' or pads' left, 0..1, the same
  for every note; it moves nothing until a route reads it, and is grey
  until then, sky after. A finger turns it by how far it moves, so a
  touch takes it up where it was left; a double tap sets it back to 0.
  Its Route button opens its routes in the panel, as a modulator's
  does; the surface's choices hide it. It is the player's, not the
  sound's: a preset keeps the routes from it, never where it stands.

A reference to another input (FM, ring) may name any input that does
not read it back: inputs render in an order where each comes after the
ones it reads, a block at a time, and a loop has no such order. An
oscillator's FM may name the oscillator itself: feedback FM, the mean of
its own last two samples, rendered a sample at a time.

A filter's keytracking follows the note (from C4), not an input's pitch.

An input is rendered only while it is heard (a chain takes it, its send
above zero or routed) or read by one that is; a chain only while its
level is above zero or routed. A part that is not rendered costs nothing,
and an oscillator not rendered keeps its phase until it is again.

The parts sit in the voice's places in the sound's order. A change to
the structure (a part added, removed, moved or of another kind, a
reference) takes effect at the next block, every gliding value jumping
to its target; a voice sounding through it keeps each place's state, so
it may click. Noise inputs and LFOs draw from the voice's generators in
their order among their kind: the first LFO draws as the old LFO 1 did.

## Limits

Nothing is allocated on the audio thread while it plays, so the most of
each part is allocated up front and an empty place costs nothing:

| part             | at most |
| ---------------- | ------- |
| inputs           | 6       |
| chains           | 4       |
| items in a chain | 6       |
| modulators       | 8       |
| routes           | 16      |

## Identity

Every input, chain, item, modulator and route has an id (`i1`, `c2`,
`x3`, `m4`, `r5`: a prefix per part and the smallest number free), stable
while the part exists. Routes, sends and references name ids, never
positions, so moving a part changes nothing else; removing one removes
what named it (its sends, the routes to and from it) and clears
references to it. Names on screen come from position and kind ("IN 2",
"LFO 1"), never stored.

## The old sound

The fixed set (v1, `src/state/params.ts`) becomes one chain, which is
what it was:

- osc 1, osc 2 (when its level, FM or the ring use it), noise and ring
  (when their levels are above zero) become inputs; their levels become
  the chain's sends. FM is osc 1's, from osc 2.
- The filter becomes the chain's one item; its envelope, and the mod
  envelope and LFOs, become modulators when something uses them; the
  filter envelope's amount becomes a route to the cutoff.
- The eight slots become routes, those with an amount.

Saved presets and the last sound convert as they load, playing as they
did: an input is read raw wherever it is read (FM, a ring), its level
being the chain's send, as the old FM and ring read the oscillators
before the mixer. The old keytracking followed osc 1's pitch, so the
cutoff moves by what osc 1's transpose added (within 20 Hz..20 kHz), and
an LFO 2 used without LFO 1 draws its random shapes (S&H, Smooth) as LFO
1 did, being the first.

## The editor

Drawn on the design canvas with ashon, 2026-11-10/11, after panels of
knobs (stage tabs, one rack, a flow map) read as unintuitive: the sound
as a graph of flat tiles, flowing left to right.

- **Tiles.** Inputs stand in the first column; each chain is a row: its
  head (letter and level), then its items side by side, then the amp,
  which stands at the end of every row (since 2026-11-12 at most two
  slots tall, or three fifths of its width: past that it stands in the
  rows' middle and a bus down the seam takes every row to it; a chain's
  items and its "+" likewise stand at most two slots tall, in the row's
  middle, and since 2026-11-14 the head with them: it kept the row's
  height for the pegs, and ashon saw it need not once threads bent into
  it). Modulators sit
  in a rack above, the voice at its end (since 2026-11-12 at its start,
  over the inputs whose pitch it sets; from md up, and on a phone on its
  side, the rack is a column at the graph's left, which has width to
  spare and little height). Held upright, its tiles stand as tall as the
  graph's, 44 px (56 until 2026-11-12, ashon: the rack hard to take in
  on a phone); in the column, 56 px squares, 56 by 44 on a screen under
  30rem tall (ashon, 2026-11-12: on a phone on its side the column
  showed the voice and half a modulator). A tile
  is flat, outlined by a ring; picked, its ring is heavier and it takes a
  tint. A dashed "+" fills a row's free place; a longer chain pans the
  graph right.
- **Threads**, since 2026-11-14, in place of the pegs that stood on the
  seams (a pill as long as its level: an input's send into a chain, the
  chain's level before the amp). ashon asked on 2026-11-13 for the
  connections drawn as stitching ("바느질한 듯한 표현"): an input's way
  to each chain it feeds seen as one path, then for a hole for each,
  aligned down the edge ("각 버스별로 하나씩, 세로로 잘 정렬되면"),
  and for solid thread over a running stitch ("실 모양은 점선보다
  실선으로"), chosen on a storyboard. A thread runs under the tiles and
  comes up at each seam (`src/viz/threads.ts`): a run from a hole 5 px
  inside one tile's edge to a hole 5 px inside the next's, straight where
  the two stand level, an S bending in the seam where they do not. A
  tile that sends to several has a hole for each down its edge, 12 px
  apart about its middle and in their order, in each one's colour, so
  that no two threads cross; a head takes a hole for each input that
  feeds it. A send's thread, a chain's last run (its level, into the amp
  or onto the bus) and a read's are as thick and as strong as what they
  carry, 1 px and 35% for nothing to 3 px and full for all; the stitches
  between a chain's items, and after the amp, are 2 px. The seam an
  input's threads bend across, before the heads, is 12 px (it was 4):
  the storyboard's 14 made a sound of one item 398 px wide, 2 px more
  than a 412 px phone's frame, so it panned. Each send's and read's
  thread has a tap target of 44 × 28 px about its middle, picking as its
  peg did. Picking a chain's head lights its threads from its inputs to
  the amp, the rest of the chains' and the inputs' dimmed to a quarter;
  picking an input lights its own, the other inputs' dimmed; an item
  lights the runs on either side of it. A "+" in a row has its label at
  its foot, out of the thread's way, and the Out's view stands clear of
  its hole. In the session's mix the same threads run from every track
  to the buses it sends to, each bus's in a lane of its own, and along
  each bus into the master (`effects-parts-sequencer.md`, Mix).
- **Crossing.** An input is drawn once and stretches over neighbouring
  chains it feeds; where it cannot, a dashed copy of it stands in that
  chain's row (`src/viz/graph.ts` lays this out). Tapping a copy picks
  the input; picking the input lights its copies.
- **Links.** An input that another reads (its FM, a side of a ring)
  stands in a column left of the inputs, beside the inputs that read it,
  as an input stands beside the chains it feeds: one tile over readers
  next to one another, a thread to each, a dashed copy beside readers
  apart from those (`src/viz/graph.ts`). An FM's thread is as thick as
  the reader's FM, a ring's full. One that feeds a chain stands in the
  inputs' column, a copy of it beside its readers; one that feeds none
  stands only there. What a source reads stands a column further left. A
  ring takes two slots in the inputs' column, one beside each side.
  Tapped, an FM's thread picks the input read, its knob for the reader
  marked; a ring's picks the ring. Either side edits the link: the reader
  picks its FM source and sets its FM, as before, and the input read
  turns itself on as any other oscillator's FM ("FM →", next to its
  chains; on, it replaces what that one read, a quarter of FM if there
  was none) and sets how much, on a knob for each (→ IN 1, that
  oscillator's FM knob). An input no chain takes and no FM toggle shows
  heard says where it is heard instead ("Heard through IN 4's ring") or
  "Silent". Since 2026-11-12: ashon heard Glass Pad's modulator, in no
  chain, took it for a fault, and found FM alone hard to see. A line down
  the inputs' left came first; ashon wanted it shown more as the chains
  show mixing, and the source stood under its reader with a peg between,
  editable from both sides. Under its readers, one source used by three
  stood three times down the column, and ashon asked for it left of them
  instead, pegged to each.
- **Colour by chain.** A chain's head, items, threads, copies and knobs
  take its colour, A to D in a fixed order: orange-400, violet-400,
  lime-300, pink-500. Inputs carried a dot in the colour of each chain
  they feed, until the holes down their edge showed it (2026-11-14).
  Inputs, the amp, the voice and their knobs are neutral; modulators
  are sky, which on a knob only ever means a route. The
  colours were chosen against the ones the app already gives a job
  (emerald accent, sky modulation, red errors, amber status) with the
  dataviz palette checks on the tile face (#1c1c23), any two chains:
  ΔE 22 at worst for normal vision, 14 for protanopia and deuteranopia,
  contrast 4.7:1 at least. They are lighter than a chart's band on
  purpose: rings, pegs and 6 px dots (now threads), not fills. Letters
  stay, so colour is never the only cue. A fifth colour would fail
  those checks: more chains than four would want letters on neutral
  tiles.
- **The amp** takes the graph's spare width and holds the output
  waveform, which stood above the editor until 2026-11-11: on a phone
  the editor, the keys and the status line did not fit under it (ashon,
  on the Fold). The graph took the room: its tiles are 44 tall. The keys
  keep their least height (7rem under their header): on a short screen
  the graph gives way first, panning, down to a row of tiles, then the
  panel scrolls. With four chains the keys had been squeezed to nothing
  (ashon, on the Fold, 2026-11-11: about 480 by 660).
- **The panel** under the graph holds the picked tile's knobs. Routing
  happens in its place, the graph still in view (ashon found a sheet
  over the whole editor too big, 2026-11-11): hold a knob for the routes
  into it, or tap a modulator's Route and pick tiles, their knobs turned
  into depths from it. Its header moves the part a place either way
  (arrows) and removes it, asking first in a dialog (since 2026-11-12,
  ashon: the "⋯" menu that held them spelled out, and a removal
  confirmed). Its last button hides it, the graph taking its room to
  show more chains (ashon, 2026-11-12): a bar under the graph, or a
  narrow column beside it from md, brings it back, as picking a tile
  does; a tile held to be dragged leaves it hidden. Since 2026-11-12 it
  stands over the graph's card, not beside it: the tiles keep to the
  room it leaves them (`roomBeside` in `src/viz/graph.ts`) and the
  editor asks the page for the same height whether it shows or not, so
  hiding it shows the canvas under it and moves neither the tiles nor
  the keys. Hidden, it had given the keys and the tiles its room, both
  growing, and ashon asked for them to keep their size, the panel over
  the canvas. Hidden, it leaves a bar, and the graph pans its last
  tiles out from under it as from under the panel (ashon, 2026-11-12:
  on a phone on its side the bar hid the amp). Beside the graph the
  tiles keep clear of the bar only, the panel shown or hidden, and the
  panel stands over the last of them, the graph panning them out
  (ashon, 2026-11-12: the canvas left for the panel on a phone on its
  side was room wasted, and the tiles should not resize as it shows);
  under the graph they keep clear of the whole dock. Its card face lets a
  little through, the canvas under it
  blurred (since 2026-11-12: ashon asked for a blur, a hue and a grain,
  then found the knobs lost on that busier glass and kept the blur
  alone).
- **Margins.** In the editor's card everything stands 8 px from the
  card's edges, and its blocks 8 px apart: the rack (a row or a column),
  the graph's tiles, and the panel or its bar, which stands in from the
  card's edges as well rather than flush with them (since 2026-11-12,
  ashon: "전체 UI 배치 부분도 여백을 깔끔하게 정돈해 줘"; the tiles had
  stood 6 from the top, the rack 12 above them, the panel 20 past
  them). The graph's own end margin is the gap before the panel. Out
  of the card the page keeps its own: 16 px at the sides, 12 between
  the editor, the play section and the status line (8 on a short
  screen), the keyboard's header 8 above its keys.
- **Dragging.** A tile held (a touch kept still 450 ms, as a knob is
  held; a mouse moved with its button down) lifts and follows the
  finger, picked; a bar on a seam shows where it would go, and near an
  edge the graph pans. An item moves along its chain or into another
  that has room, a chain's letter takes its row up or down (its letter
  and colour follow its new place), a modulator moves along the rack.
  Let go off the graph, or Escape, and it goes back. A touch that moves
  first pans, as before. Inputs are not dragged: each stands beside the
  chains it feeds, wherever it is in their order, so the panel's buttons
  move them (renaming them).
- **Themes** (asked for by ashon, 2026-11-14, as a personal choice,
  then the whole tone: "다크 / 라이트 / 기본 액센트 / 세컨더리 색상 등
  전부 컨트롤"). The colours are roles: chains A to D, the modulation
  colour, the accent (focus, the playhead, the go button, the traces, a
  note), the secondary (what is picked or current: a pad picked, its
  row, a navigator's frame), and the neutral surfaces, inks and status
  colours under them. A theme (`src/ui/theme.ts`: Default, Tidal,
  Ember, Orchard) gives each role a value in each mode, and each value
  passes the checks the app's own colours were held to, in both: 4.7:1
  at least on a tile's face and a card's, chains ΔE 20 apart, the
  modulation colour 12 from every chain, and a label (black in the
  dark, white in the light) readable on the accent and the modulation
  colour. The built-in themes give the secondary the accent's value.
  Ember's modulation colour went from violet to lavender (2026-11-14):
  the violet stood ΔE 6 from its indigo chain. Settings' Look holds the
  theme (a dropdown of the app's own, its swatches the mode's) and the
  appearance: System, Dark (the default, the app's home) or Light.
  Built in steps: the surfaces and inks as CSS tokens (index.css), no
  visual change; then the light: each token's light value under
  `data-mode`, which App sets from the appearance (the device's,
  followed as it changes, for System), the themes' light palettes (each
  colour a deeper shade, its hue kept or turned a little, until the
  checks pass), the canvases drawn from the mode's ground (the
  spectrogram on a light scale of its own, quiet pale and loud near
  black), a held key or pad the accent mixed into it, and on iOS a
  dark strip under the status bar, whose letters stay white. Next: a
  theme of one's own, a colour for each role, lifted in lightness
  until it passes the checks, with a reset.

## Steps

1. The model: pure TypeScript in `src/state/sound/`, its parts' knobs,
   the edits (add, remove, move, set, connect), reading a sound from
   untrusted JSON, and the v1 conversion. Tested in Node. Done
   2026-11-10: every factory preset converts to a sound that reads back
   unchanged.
2. The DSP: a voice that renders inputs, chains and modulators from
   preallocated places, block by block; render time measured against the
   old voice and on the Fold. Done 2026-11-10:
   `src/dsp/chainSynth.ts`, `chainVoice.ts` and `slots.ts` beside the
   old voice, `src/worklet/sound.ts` giving it a sound. Every factory
   preset, converted, plays as the old synth did to within one float32
   step (`src/worklet/sound.test.ts`). One 128-frame block of 16 voices
   here (M3 Max): a saw 0.040 ms (old 0.045), the old stress patch 0.256
   ms (old 0.237), every slot taken 1.15 ms, over the 0.89 ms budget:
   such a sound wants fewer voices. On the Fold (Chrome 157), 2026-11-11,
   Measure CPU times it at 0.51, 1.03, 1.57 and 2.13 ms for 8, 16, 24
   and 32 voices, 19% to 80% of a 2.67 ms block, as desktop Chrome on
   the M3 Max does (0.52 to 2.03 ms): at the default 16 voices the worst
   sound fits the block but not its third. Made cheaper 2026-11-11, by
   what it spent on Math (a profile: about half the time): a moving
   cutoff's coefficients and a moving pitch's step worked out every 8
   samples and glided in between (`Filter.sweep`, `pitchesToSteps`), the
   filter's loop in locals, and drive's tanh and the sines approximated
   (`src/dsp/fastMath.ts`). Here, 16 voices: every slot 0.79 ms, under
   the budget; the old stress patch 0.20 ms; a saw 0.038 ms.
3. The engine and worklet: a sound's structure as one message, a knob as
   (part id, key, value). The old voice, synth and parameter mapping go,
   with the equivalence test that held the new one to them. Done
   2026-11-11: the engine converts the parameters to a sound as they
   change and sends the knobs that moved (`src/state/sound/diff.ts`), or
   the whole sound when its structure changed; the worklet's
   `SoundPlayer` (`src/worklet/sound.ts`) loads one and sets the other,
   as loading the changed sound would. Measure CPU times
   `chainStress.ts`.
4. The editor: inputs, chains and modulators on screen, with add, remove
   and reorder; routes from any knob. Drawn first (The editor, above);
   the input column's layout is `src/viz/graph.ts`, 2026-11-11. In two
   parts:
   - 4a, done 2026-11-11: the graph and its panel replace the tabs of
     knobs. `src/ui/SoundEditor.tsx` draws the rack and the graph
     (`graphGeometry`), `PartPanel.tsx` the picked tile's knobs and
     choices, with add, remove and move (by buttons); an input's panel
     turns each chain on or off for it, which is how an input moves to
     another chain (a chain's knobs set how much). A knob is a part's
     id and key (`src/state/sound/knob.ts`), a chain's send being
     `send.<input id>`. The engine holds the sound and takes edits to it;
     the library keeps sounds, so presets went to file version 2 here
     rather than in step 5 (a version 1 file or session converts as it
     is read). The editor redraws only when the sound's shape changes
     (`shapeKey` in `src/ui/editor.ts`); a knob turned redraws itself, a
     tile's line and a thread.
   - 4b, routes and outlines done 2026-11-11. Routing takes the panel's
     place (`src/ui/RoutePanels.tsx`), two ways. Holding a knob (a touch
     kept still 450 ms, a right click, or Enter) shows the routes into
     its destination: a card per route, its amount a knob read in the
     destination's units, its via and removal, then the sources to add
     one from, at nothing. A modulator's Route turns the panel into the
     picked tile's destinations as depths from it (`DepthKnob`,
     `setDepth` in `src/state/sound/knob.ts`): turned from Off a route
     is made, back to Off it goes; tiles are picked as before, the ones
     it moves in a sky ring, and any source (a note's too) is chosen in
     the header. An oscillator's Octave, Semi and Fine route to its
     pitch; the voice's pitch and the amp's gain, which no knob holds,
     are tapped beside the knobs. A routed knob carries a
     sky count and an arc to where its routes take it at full
     (`knobReach` in `src/state/sound/knob.ts`: octaves multiply, the
     rest add), and the sound stops at the knob's ends as the arc does:
     levels, FM, resonance and drive at 0 and 1, a cutoff in the
     filter, and since 2026-11-12 an LFO's rate at 0.05 to 50 Hz
     (`LFO_MIN_RATE`, `LFO_MAX_RATE` in `src/dsp/lfo.ts`). Unheld, a
     route took it up to 16 times its knob, an LFO swinging a cutoff at
     hundreds of hertz, which ashon heard as an overload; the output
     itself never clipped. A modulator's panel lists where it goes. The panel's
     header pictured an envelope, an LFO or a filter's response
     (`src/ui/outline.ts`); since 2026-11-12 the tiles draw them
     instead, the modulators' in the rack under their names. Dragging
     tiles, 2026-11-11 (The editor, above): `src/ui/tileDrag.ts` lifts
     and moves them, setting styles straight on the elements as a knob
     does; `src/viz/drop.ts` finds the seam a tile goes into; `moveItem`
     in `src/state/sound/edit.ts` takes an item into another chain.
5. The factory presets rebuilt as sounds. Done 2026-11-12, asked for
   by ashon: `src/state/sound/write.ts` writes a sound by names (parts
   named, choices by name, a route's amount in its destination's units)
   and throws on a typo, and `src/state/factory.ts` writes every preset
   with it. The 22 old ones are the sounds they converted to (open
   filters that did nothing left out, cutoffs the old keytracking moved
   rounded, Init now a new patch's saw); 18 new ones use what the old
   synth had not: Reese and Growl Bass (two saws beating, drives),
   Fifth, Scream and Feedback Lead (a drive before and after a band,
   feedback FM), Strings, Choir and Breath Pad (four inputs, two chains
   of formant bands, a chain of noise), Kalimba and Marimba (a route
   into a send), Clav and Vibes (two filters in a row, a tremolo on the
   amp's gain), Tom, Clap and Cowbell, and Riser, Wind and Siren (an
   LFO moving another's rate). Measured at C4, a held sound's RMS is
   about 0.1 to 0.2, as the old presets' is; every preset sounds there
   without clipping and dies within three seconds of its key
   (`src/state/factory.test.ts`).
6. The drum kit on top: sixteen sounds, one per pad.
