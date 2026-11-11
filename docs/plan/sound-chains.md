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
output                   amp envelope → voice

modulators  [Env] [Env] [LFO] [LFO] …     sources: these, velocity, key,
routes      source → any knob × amount            slide, random
            (× via, another source)
```

- **Inputs** make sound: an oscillator (wave, octave, semi, fine, width,
  and FM from another input), noise, or a ring (the product of two other
  inputs). An input is heard only through the chains that take it, and
  read raw by the inputs that name it.
- **Chains** each take a mix of inputs (a send level per input; an input
  can feed several chains, or none) and pass it through their items in
  order. Items process: a filter, drive, more later. The chains are summed.
- **The output** is the amp envelope (and velocity) and the voice (mode,
  glide): one of each, always there.
- **Modulators** are envelopes and LFOs. **Routes** connect a source (a
  modulator, velocity, key, slide, random) to any knob that can be
  modulated, by an amount of that knob's modulation scale, optionally
  scaled by a via source. Pitch of the whole voice and the amp's gain are
  destinations too.

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
  which stands at the end of every row. Modulators sit in a rack above,
  the voice at its end. A tile is flat, outlined by a ring; picked, its
  ring is heavier and it takes a tint. A dashed "+" fills a row's free
  place; a longer chain pans the graph right.
- **Pegs.** The joints between tiles carry pegs: an input's send into a
  chain (tap to set it), the chain's level before the amp. A peg's
  length is its level.
- **Crossing.** An input is drawn once and stretches over neighbouring
  chains it feeds; where it cannot, a dashed copy of it stands in that
  chain's row (`src/viz/graph.ts` lays this out). Tapping a copy picks
  the input; picking the input lights its copies.
- **Colour by chain.** A chain's head, items, pegs, copies and knobs
  take its colour, A to D in a fixed order: orange-400, violet-400,
  lime-300, pink-500. Inputs carry a dot in the colour of each chain
  they feed. Inputs, the amp, the voice and their knobs are neutral;
  modulators are sky, which on a knob only ever means a route. The
  colours were chosen against the ones the app already gives a job
  (emerald accent, sky modulation, red errors, amber status) with the
  dataviz palette checks on the tile face (#1c1c23), any two chains:
  ΔE 22 at worst for normal vision, 14 for protanopia and deuteranopia,
  contrast 4.7:1 at least. They are lighter than a chart's band on
  purpose: rings, pegs and 6 px dots, not fills. Letters stay, so colour
  is never the only cue. A fifth colour would fail those checks: more
  chains than four would want letters on neutral tiles.
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
  into depths from it.
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
- **Later:** colour themes, as a personal choice (ashon): the colours
  are roles (chains A to D, modulation, neutral, accent, status), so a
  theme gives each a value and passes the same checks.

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
     tile's line and a peg.
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
     rest add). A modulator's panel lists where it goes. The panel's
     header pictures an envelope, an LFO or a filter's response
     (`src/ui/outline.ts`). Dragging tiles, 2026-11-11 (The editor,
     above): `src/ui/tileDrag.ts` lifts and moves them, setting styles
     straight on the elements as a knob does; `src/viz/drop.ts` finds
     the seam a tile goes into; `moveItem` in `src/state/sound/edit.ts`
     takes an item into another chain.
5. The factory presets rebuilt as sounds.
6. The drum kit on top: sixteen sounds, one per pad.
