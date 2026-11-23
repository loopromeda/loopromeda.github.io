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
  and FM from another input), a chip (a wave held in steps, on its DAC's
  DC, since 2026-11-16: The chip, below), noise, or a ring (the product
  of two other inputs). An input is heard only through the chains that
  take it, and read raw by the inputs that name it.
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

## The chip

A chip's channel, an input of its own (ashon, 2026-11-16: "오실레이터
종류를 좀 나누면 좋지 않을까 싶고", then "chip으로 진행 해 보자"). Its
waves held in steps came first, on the oscillator, 2026-11-15 ("파형을 만들어
낼 때 계단형으로 파형을 만들어 내도록 하는 기능을 넣어보면 어때?"); with a DC
knob as well the oscillator would have held nine knobs, so the steps
moved here and the oscillator went back to its six.

| knob   | choices                                  | shown               |
| ------ | ---------------------------------------- | ------------------- |
| Wave   | Pulse, Triangle, Saw, Sine               | always              |
| Duty   | 12.5%, 25%, 50%, 75%                     | with Pulse          |
| Octave | −2 to 2, Semi −12 to 12, Fine ±100 cents | always              |
| Steps  | 4, 8, 16, 32 (the default), 64           | with any other wave |
| Bits   | Off (the default), 1 to 8                | with any other wave |
| DC     | 0 to 100% (the default 100%)             | always              |

- **The wave** is the oscillator's, held in steps: a step's level is the
  wave at its middle (a triangle at 32 steps is the 2A03's, 16 levels),
  Bits rounds it to 2^bits values across −1..1, and each step's jump is
  band-limited, the steps fading into the smooth wave where they come
  closer than a sample allows (`src/dsp/oscillator.ts`). A pulse is not
  held in steps: its duties are whole eighths already, the 2A03's.
- **DC**: a chip's DAC puts out 0 up to its level, never below, so its
  wave stands on a DC as high as the wave's own middle, which steps as
  each note starts and ends; the console's output, a highpass, turns
  each step into a low thump. That is what a chiptune's recording has in
  its lows that a wave about its mean has not (the FXXL'S GXLD port,
  2026-11-16: the port's lows under 60 Hz 12.7 dB off the original's on
  average, 7.3 with the thumps simulated). At 100% the wave's lowest is
  0: a triangle, a saw or a sine spans 0..2, a pulse of duty w its
  0..2 too, its mean 2w; at 0 it plays about its mean, as an oscillator
  does. The voice adds it to the wave before the chains, so a lowpass
  keeps it, a highpass takes it off and a drive bends the wave
  unevenly, as the chip's own would.
- **The highpass** after the voices (one per side, in `ChainSynth`) is a
  one-pole at 10 Hz, whole at the Nyquist frequency: the DC of a note
  held falls to a third in about 17 ms, and a note let go thumps the
  other way. It runs only while a chip on DC sounds, and on after the
  last voice until it is silent, so every other sound renders as before,
  sample for sample. Its corner is fixed, chosen by rendering the port
  with every chip preset on DC: 5, 10 and 20 Hz came within 0.03 dB of
  one another at 50%, and at 100%, the default, 10 Hz was nearest the
  recording (its mean log-mel error 4.376 dB, 4.404 at 5 Hz).
- **No FM**: a chip has no FM of its own, and its Duty is not routed (a
  chip's width is one of four); its pitch is (Octave, Semi and Fine
  route to it). An oscillator may read a chip as its FM, DC and all.
- **Saved before**: an oscillator saved held in steps (Steps and Bits,
  2026-11-15 to 16, never deployed) reads as a chip of its wave, pitch,
  steps and bits, at no DC, as it sounded; its FM goes
  (`src/state/sound/read.ts`).

## FM6

A six-operator FM voice after the Yamaha DX7, an input of its own
(ashon, 2026-11-22: "야마하 DX-7 의 그런 톤을 넣어보고 싶은데 기본
프리셋으로 추가해 볼 수 있을까 최대한 복각 해 보면 좋겠어"; then a new
6-op input rather than presets on the two-operator FM, and eight voices of
ROM 1A rather than one or all 32). Its knobs are the DX7's own numbers, so
a voice is written as its sheet gives it and sounds as it did. The editor's
screen is UX's (`src/ui/fm6Pages.ts`, `AlgorithmChart.tsx`).

| group     | knobs                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| the voice | Alg 1 to 32, Fdbk 0 to 7, Sync (the oscillators' key sync), Trans ±24 semitones, Engine (Clean, DX7)                    |
| OP 1 to 6 | Mode (Ratio, Fixed), Coarse 0 to 31, Fine 0 to 99, Detune ±7, Level 0 to 99, Vel 0 to 7, R1 to R4 and L1 to L4 0 to 99, |
|           | Rate Sc 0 to 7, Break A-1 to C8, L and R Depth 0 to 99, L and R Curve (−Lin, −Exp, +Exp, +Lin), AMS 0 to 3              |
| Pitch Env | R1 to R4 and L1 to L4, 0 to 99 (50 is the note)                                                                         |
| LFO       | Wave (Triangle, Saw Down, Saw Up, Square, Sine, S&H), Speed, Delay, PMD, AMD 0 to 99, Sync, PMS 0 to 7                  |

Routes move its pitch (Trans holds it) and each operator's level (its
Level knob holds it, a whole its 99 steps). It starts as the DX7's initial
voice: OP1 alone at 99, a sine.

- **Sources.** The numbers come from the DX7's firmware (v1.8, as ajxs's
  disassembly reads it: its numbers taken as facts, nothing copied, as it
  carries no licence), from msfa (Raph Levien's engine, Apache-2.0) and his
  notes, and from Ken Shirriff's reading of the chips. Dexed is GPL: none
  of its code or tables, only its measured detune, as a fact. The code in
  `src/dsp/fm6.ts` is our own.
- **Levels** are msfa's, in its log units: an operator at Level 99,
  envelope 99, no velocity is L 15, and each unit below halves it. The
  output level and velocity are the firmware's: an attenuation of 127
  less the level (its low steps from a table) and the keys' scaling, then
  doubled and the velocity's added, 0.375 dB a step.
- **Velocity** is the firmware's two tables: at Vel 7 a full velocity
  plays about 4 dB over the level Vel 0 holds every note at, a soft one
  far under it.
- **Level scaling** is the firmware's: the keys in groups of three from
  the breakpoint (Break 39 is C3, the DX7's name for MIDI 60), a linear
  or exponential table either side, a negative curve turning down.
  **Rate scaling** is msfa's: a note's rates up by Rate Sc × (⌊note / 3⌋
  − 7) / 8, rounded down, from MIDI 24 up.
- **Modulation**: an operator's phase moves by its modulators' outputs
  times 2^(17/16) cycles (13.1 radians at full, as Yamaha's chip did).
  Feedback is msfa's, the last two outputs averaged and scaled by
  2^(Fdbk − 8); algorithms 4 and 6 run a real loop (OP4, or OP5, back to
  OP6). The carriers are averaged, as the DX7 turns each down by how many
  there are. A Fdbk turned glides there over a step, unclicked.
- **The engines** (ashon, 2026-11-22, the old E-Piano sounding far
  better than the port: "DX-7 을 잘 복각한 것 맞아? 음향 분석자료를
  인터넷에서 제대로 찾고 구현해 줘"). The voices' numbers were the DX7's,
  but not how its chips work them out, nor what its output does after.
  **DX7**, a new FM6's, works as Ken Shirriff read the chips off their
  dies ([the log-sine ROM](https://www.righto.com/2021/12/yamaha-dx7-reverse-engineering-part-iii.html),
  [the output](https://www.righto.com/2022/02/yamaha-dx7-chip-reverse-engineering.html)):
  - a phase's top 12 bits read a quarter wave of 1024 logs of a sine,
    unread between its steps;
  - the envelope's level (12 bits) adds to the log;
  - 1024 powers of two and a shift take it back to 14 bits and a sign;
  - the carriers are turned down in the log by how many there are
    (round(1024 · log2 n));
  - each voice's sum goes through the converter, whose 12 bits are
    shifted up by as many as its leading zeros allow (0 to 3), so a quiet
    note keeps every bit and a loud one loses its lowest three;
  - each voice then goes through the output's lowpass, before the chains.

  **Clean** is the arithmetic in floating point, the sine read between,
  and no converter or filter. On a sine the two stay within −60 dB of
  each other.

- **The output filter** Shirriff gives only as "a sharp low-pass filter
  around 16 kHz using a Sallen-Key topology". Here it is a fourth-order
  Butterworth at 16 kHz (0.45 of the sample rate where that is lower), in
  each voice, so only the FM6 is filtered, not what is mixed with it.
- **A held note hears its knobs**: a knob turned, or a lane moving it, on
  an operator's frequency, level, velocity or scalings works out again
  for every note playing. An envelope at rest (sustaining, or over)
  stands at its level anew, so a level turned to 0 and back stands where
  it stood; one moving moves by what its level moved and goes on with its
  stage. What is heard eases after it over 10 ms (a time constant, in
  the log), unclicked. A Fixed turned on takes the mode with it, and the
  Engine changed under a note takes over the other's levels.
- **Routes to a level** turn the Level knob, no further than 0 and 99,
  and step for step as the knob does (its low steps from the table). A
  note ends on its carriers' envelopes, with any route that turns them up:
  a route or the LFO turning them down never cuts it short. On the DX7
  engine a carrier under the least level its chip plays is over, a fourth
  level held there too. Its chains ring out before the voice is freed.
- **The envelope** runs on the DX7's clock, 49096 Hz: a rate's speed is
  its qrate's (R × 41 / 64 plus the rate scaling), the attack adding
  more the lower it starts and jumping the last stretch, a level held as
  msfa holds it. It steps every 16 samples, the gains gliding between, so
  a block costs little. A note on a quiet voice starts at L4.
- **Frequencies**: a ratio is the firmware's, in 4096ths of an octave
  (14 plays 14.0025, 1.5 a hair flat); Coarse 0 is a half. Fixed is
  10^(Coarse mod 4 + Fine / 100) Hz, which follows the pitch envelope and
  the LFO but not the note. Detune is Dexed's measured size, an octave's
  share falling as the note rises; on a fixed operator it goes up only.
- **The pitch envelope** is the firmware's levels (in 32nds of an
  octave, 50 the note) and rates, one per voice, back to L4 as a note
  starts on a quiet voice.
- **The LFO** is the voice's, one for every note, as the DX7's: Speed
  from 0.065 to 50.9 Hz, Delay held then risen as msfa's, Sync
  restarting it with each note. PMD × PMS moves the pitch; AMD only turns
  levels down, by each operator's AMS.
- **DC** (ashon, 2026-11-22, the E-Piano still sounding strange
  overtones: "여전히 이상한 배음이 들리네"): a 1:1 ratio puts a sideband
  at 0 Hz, a DC as the note's envelope moves or a swell of a few hertz
  between operators detuned apart (OP5 and OP6 in E.PIANO 1), as much as
  an eighth of a note's power under 20 Hz. The one-pole at 10 Hz after
  the voices (The chip, above) left −19 to −28 dB of it (under 20 Hz
  against the whole, C3 to C6, velocity 76 to 127). The DX7's output is
  coupled through capacitors, so each FM6 voice now ends in a
  second-order Butterworth highpass at 20 Hz too, on both engines (its
  corner not read off a DX7): −40 to −57 dB.
- **Velocity** (the same request): a DX7's keys send no more than about
  100 ([players' reports](https://yamahamusicians.com/forum/threads/keyboard-velocity-range.7315/post-36234),
  [and more](https://yamahamusicians.com/forum/threads/observations-on-dx7-and-dx7ii-key-velocity-issues.15649/)),
  so its voices were voiced for that, and Arturia's DX7 V plays them so
  by default ([its DX7 and Full modes](https://www.kvraudio.com/forum/viewtopic.php?p=8135357)).
  Here a computer key plays 127, every note harder and brighter than the
  DX7's keys could. The FM6's Velocity knob: **DX7**, the default, takes
  MIDI's 127 for 100 (velocity × 100/127); **Full** takes it as it comes.
  A sound's other parts hear velocity as before. With DX7, the E-Piano's
  C4 at MIDI 100 has its second, third and fourth harmonics 1.4, 9.9 and
  19 dB under the first.
- **Cost**: one 128-frame block of 16 voices here (M3 Max), an FM6 on
  the DX7 engine 0.21 ms, six of them as inputs 0.98 ms; one is under the
  0.89 ms budget (a saw 0.036). The voice alone, the DX7's engine costs
  1.4 times Clean's (0.17 ms against 0.12).

Unsettled, each a choice that can move without changing a voice's data:
the detune's size (Dexed's measurement, not the firmware's); whether a
fixed operator follows the note's pitch moves; the feedback's and the
loops' absolute scale (msfa's); AMS 1 and 2 (msfa's 0.26 and 0.43); the
output filter's order (Shirriff gives none); whether the feedback hears a
carrier's turning down (here it does not, as msfa's does not). Not
there yet: the mod wheel and aftertouch adding to PMD and AMD, as the
DX7's do, which wants destinations of their own.

Heard, not a fault: the E-Piano's fourth harmonic stands out from about
D5 to D6 (MIDI 74 to 86), as loud as the first from F#5 to A5 at the
hardest velocity, the DX7's 100. OP4 into OP3, a 1:1 pair at about 5
radians, puts it there (its Bessel sidebands), on msfa's arithmetic as
on this one's. It is not aliasing: Clean at 48 kHz and at 192 kHz give
the same harmonics up to C6. Its decay quickens a step at F#3, D#4, A4,
F#5, D#6 and A6, where rate scaling 3 steps, as the firmware quantizes
it. And velocity moves its overtones up and down, not evenly, as an FM
index does.

The voices are written as the ROM's sheets give them
(`src/state/factory.ts`, where the `dx7()` helper reads a voice written
by the DX7's names). Each is dressed as it was heard on its records and
stages (`dxSound`), and trimmed to its role's loudness by its sends; the
voice's data is left as it was. They ran dry and in mono at first,
beside presets with a chorus, a tremolo and a room on them.

| Preset           | Voice     | Alg | Fdbk | Category | Dressed with                           | LUFS  |
| ---------------- | --------- | --- | ---- | -------- | -------------------------------------- | ----- |
| FM E-Piano       | E.PIANO 1 | 5   | 6    | Keys     | Ensemble, Tremolo (Pan 1), keys, room  | −23.0 |
| FM Brass         | BRASS 1   | 22  | 7    | Brass    | Ensemble, spread, room                 | −21.0 |
| FM Electric Bass | BASS 1    | 16  | 7    | Bass     | a light chorus, its lows in the middle | −22.1 |
| FM Tubular Bells | TUB BELLS | 5   | 7    | Bell     | keys, a large room                     | −22.0 |
| FM Marimba       | MARIMBA   | 7   | 0    | Bell     | keys, room                             | −22.0 |
| FM Strings       | STRINGS 1 | 2   | 7    | Strings  | a deep Ensemble, spread, room          | −23.9 |
| FM Flute         | FLUTE 1   | 16  | 5    | Lead     | delay, room                            | −17.0 |
| FM Clav          | CLAV 1    | 3   | 5    | Keys     | dry, keys                              | −24.9 |

Here "keys" means its notes laid out low to high, left to right
(keyPan), and "room" means its send to the reverb. Played as from the
DX7's keys, the Electric Bass, the Strings and the Clav sit 1.9 to 2.9
dB under their targets, their sends at full (a trim only turns a sound
down). A phaser on the Clav took 2.3 dB
off it, more than its send could give back, so it plays dry, as funk's
clavinets did.

## The kit

The factory kit rebuilt from what is published of the drum machines'
circuits (ashon, 2026-11-23: "드럼 키트도 좋은 신디.드럼 롬이 있거나
알려진 자료가 있으면 그걸로 좀 수정해 줘. 킥에 음이.들어가서 이 부분을
좀 더 제대로 다듬을 필요가 있겠어"). Not from a ROM's samples: those are
licensed, and the app plays only what it synthesizes. The TR-808's
service notes describe each voice's circuit and give each its tone (a
period and its hertz, its Tuning at noon) and its decay; two papers
measure its bass drum and its metal. The TR-909's notes give no such
table, so only Punch Kick follows it, as Sound On Sound reads its bass
drum.

The kick's note was its old body's: a chip's triangle, its third
harmonic 20 dB under the note (at 165 Hz), swept over 30 semitones as
slowly as a note bends. The 808's bridged-T rings a sine: its first
cycles more than an octave higher, for about 6 ms, heard as its punch,
not as a pitch; then its sigh, a few hertz over a tenth of a second
(Werner, Abel and Smith). The Kick does that now, fitted to the paper's
first zero crossings, its tail's harmonics 66 dB and more under it.

| Pad        | The 808's, as its notes give it                                                                                            | Here, at C4                                                                                           | LUFS  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| Kick       | BD: a bridged-T near 49.5 Hz (56 typical), its decay 50, 300 or 800 ms                                                     | a sine on A1; a punch of 27 st (τ 3.5 ms), a sigh of 2.5 st (τ 54 ms); a click its velocity brightens | −23.9 |
| Snare      | SD: 238 and 476 Hz, 60 ms; its snappy, noise through a highpass                                                            | the two sines; white noise through a highpass at 1.5 kHz, falling in 100 ms                           | −24.4 |
| Closed Hat | CH: six squares, 205.3 to 800 Hz, through a band near 7.1 kHz, 50 ms                                                       | the six, free-running; a band at 7.1 kHz, a highpass at 6 kHz                                         | −30.9 |
| Open Hat   | OH: the same, 90, 450 or 600 ms                                                                                            | 450 ms; a highpass at 5.5 kHz                                                                         | −26.1 |
| Low Tom    | LT: 80, 90 or 100 Hz, 200 ms; pink noise a little longer                                                                   | 90 Hz, falling 5 st into it; noise through a lowpass at 1.5 kHz                                       | −24.8 |
| Tom        | MT: 120, 135 or 160 Hz, 130 ms                                                                                             | 135 Hz                                                                                                | −25.9 |
| High Tom   | HT: 165, 185 or 220 Hz, 100 ms                                                                                             | 185 Hz                                                                                                | −26.7 |
| Clap       | HC: noise in a band, a sawtooth's bursts until its 30 ms pulse ends halfway through the third; a reverb longer, 100 ms     | a band at 1 kHz, bursts 12 ms apart, the reverb 100 ms                                                | −23.1 |
| Rim        | RS: 455 and 1667 Hz, 10 ms                                                                                                 | the two, driven for its crack                                                                         | −31.2 |
| Cowbell    | CB: squares at 540 and 800 Hz in a band, a drop and then a tail, 50 ms                                                     | the two, free-running, a band at 800 Hz; a strike falling in 10 ms over a tail of 130                 | −26.4 |
| Crash      | CY: the six in a band near 3.4 kHz and one near 7.1, its top band short past a highpass near 10.5 kHz; 350, 800 or 1200 ms | the three bands, the top one gone in 100 ms; 800 ms                                                   | −26.3 |
| Boom       | BD, its decay up                                                                                                           | the Kick's on G1, ringing 4 s                                                                         | −23.4 |
| Conga      | MC: 250, 280 or 310 Hz, 100 ms                                                                                             | 280 Hz                                                                                                | −26.6 |
| Clave      | CL: 2.5 kHz, 25 ms                                                                                                         | 2.5 kHz, its last octave past an oscillator's tuning lifted by an envelope held open                  | −30.1 |

What it took:

- **A decay read as about −27 dB.** The notes do not say what their
  decay measures; read as the time a voice falls to about −27 dB, an
  envelope's decay (to −80 dB) is three times it: the tom's 130 ms a
  decay of 0.39 s.
- **Where no figure was found, a choice**: the toms' and the congas'
  drop (the notes say only that two diodes raise the start; 5 st, τ 5
  ms here), the hats' highpasses, the cowbell's band (measured in a
  paper behind a paywall), the snare's highpass and its snappy's decay,
  the clap's band (a blog's 1 kHz) and its reverb's level.
- **Struck once.** Every pad's amp lets go over its decay, and the
  envelopes shaping it (`struck`) too, so a step's end cuts nothing: the
  old pads' releases, 30 to 60 ms, chopped them at a sixteenth's end.
- **A pad levelled by its parts, never by `trim`**: a kit replaces a
  preset's sends, and `trim` turns those down, so the Crash came 12 dB
  too loud into the kit until its six sends were turned down instead (a
  test holds every kit pad's A send at 1).
- **The clap's bursts from two LFOs.** An LFO stops at 50 Hz, so each
  12 ms burst is half a saw's cycle: the first half falling in one
  chain, the second, a square lifting it from under zero, in another;
  its 30 ms pulse, an envelope falling as another rises, their sum near
  1 until it ends.
- **The toms and Deep Kick 1.8 to 3.7 LU under their target**: a sine at
  its full level is all one voice gives, short as the 808's are (the old
  kit's stood as far under).

Punch Kick is the 909's: a triangle through a drive at 0.14, which
rounds it into a near sine (its third harmonic 55 dB under, its fifth
39), its pitch thrown 20 st up and falling (τ 22 ms) onto G1, and a
click of noise lowpassed at 5 kHz. The old one's drive put its third
harmonic 12 dB under the note. Deep Kick keeps its sine, driven 0.05
where it was 0.15 (its third harmonic 34 dB under, from 18) and let go
over 1 s.

The kit at its heaviest (16 pads, 4 voices each, all sounding) costs
0.55 ms a block on this Mac, 0.41 before: the hats' and the crash's six
oscillators.

Sources: the TR-808's service notes,
<https://www.manualslib.com/manual/1294765/Roland-Tr-808.html?page=14>
(its tones and decays) and
<https://www.manualslib.com/manual/1294765/Roland-Tr-808.html?page=6>
(its voices' circuits); its bass drum,
<https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf>;
its cymbal and hats,
<https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf>; the
909's bass drum,
<https://www.soundonsound.com/techniques/practical-bass-drum-synthesis>;
the clap's band, <https://www.baratatronix.com/blog/cascadia-808-clap-synthesis>.

## The library

Asked for by ashon, 2026-11-17, through Main: "사운드 쪽으로 넘겨서
신디로 만들 수 있는 음원들을 인터넷에서 더 많이 찾아보고 구현작업도 해
달라고 지시해 줘. 퀄리티는 프로급으로 쓸 수 있을 정도로 뽑히면 좋겠어."
The sounds producers reach for were gathered by genre (84 of them, The
list, below, each with where its recipe was learned: tutorials, papers
and manuals, never a preset bank), the parts most of the missing ones
needed were built, the factory presets were brought to targets measured
offline, and new presets were made from the list.

A second round followed the same day, ashon again: "사운드 프리셋을 더
다양하게 만들고 카테고라이징도 깔끔하게 정돈하면 좋겠어." The categories
became the roles a sound is played as (The categories, below), and 51
presets more filled each one's gaps, from acoustic instruments the first
round had not reached (a harpsichord, an accordion, a banjo, a trumpet) to
starting points of one input each.

### The parts it added

- **Hard sync** (an oscillator's Sync, 0 to 48 semitones, Off at 0): the
  wave runs Sync semitones above the note and restarts each time the
  note's own cycle comes round, so the note heard is the note's and Sync
  its colour; each restart and each of the wave's own jumps rounded by
  polyBLEP. A route sweeps it (an envelope, the wheel): the sync lead.
- **Phase** (an oscillator's and a super's, Reset or Free): Reset starts
  each note's wave at the same place, so every note strikes alike, as a
  kick, a sub, an 808 and an FM pair want; Free starts it anywhere,
  drawn as each note starts, so a chord's notes never start as one on
  their peaks (the in-phase onset: four notes of a pad peaking together
  at 1.6 times their held peak, 1.0 since). A new oscillator is Free; a
  sound saved before reads Reset, as it played.
- **Super** (an input): a stack of 2 to 8 voices of one wave, the outer
  ones Detune cents either way, the others spread a little unevenly
  between, so no two pairs beat at one pace; Blend sets the outer
  voices' level against the middle's, all of them together as loud as
  one. Free, each voice starts anywhere of its own; Reset, at fixed
  places apart. Its detune and width are routed. The supersaw, the
  hoover, unison pads.
- **Comb** (a chain item): a delay tuned to the note (Tune semitones
  above it), fed back so it rings for Decay (to −60 dB) through a
  damping lowpass (Damp), read between samples by a Hermite curve and
  held under a soft ceiling. A short burst into it is a plucked string
  (Karplus-Strong); anything else takes on its pitch, a resonator's.
  The guitar, the harp, the koto.
- **Formant** (a chain item): three bandpasses at a vowel's first three
  formants, a tenor's A, E, I, O and U, Vowel (0 to 4) morphing between
  them, Shift moving them all, Reso narrowing them; a saw comes through
  about as loud. The choir, the talking lead, the growl.
- **Phaser** (an effect): 4, 6 or 8 first-order allpasses around 700 Hz
  swept by an LFO (Rate, Depth), each side's sweep a quarter cycle from
  the other's, with Feedback. The string machine, the whoosh.
- **Ensemble** (an effect; ashon, 2026-11-22: "루프로메다에 부족한
  FX들이나 필터가 있다면 그런 부분들도 구현해서 넣어보면 좋겠네"): the
  string machines' and the dimension chorus's. Both sides go into one
  line, read at three taps around 6 ms, a third of a cycle apart on a
  slow LFO (Rate, ±2 ms at full Depth) and a fast one ten times as fast
  (±0.4 ms). The left hears the first tap and half the second, the right
  the third and half the second, as loud as one, the wet dulled at 8 kHz
  as a bucket brigade's filters dull it. It spreads a sound without a beat
  of its own: the FM keys and strings of the 1980s. Its LFOs are read every
  16 samples, the taps gliding between: four in a rack 0.012 ms a block.
- **Tremolo** (an effect): both sides' level swayed by one LFO, Depth of
  the way down at its foot, Shape rounding the sine towards a square.
  Pan puts the right side up to half a cycle behind, so at 1 the sound
  swings from side to side, as an electric piano's stereo tremolo does,
  the two sides together whole. Rate in hertz, or synced (on for one
  added, as the delay's and the LFO's), its top on the beat while the
  song plays: one started or moved catches up over some 25 ms,
  unclicked.
- **The drive at twice the rate**: besides its first-order antialiasing
  (ADAA), a drive now runs at twice the sample rate, the sound brought up
  and back down by a halfband of two allpass paths (six sections, flat to
  20 kHz at 48 kHz, 74 dB down past 28 kHz of the doubled rate), so only
  what it makes past 1.5 times the rate folds back: a driven saw high up
  went from −21 dB of aliasing to −43. About three samples late; at a
  drive of nothing the sound passes exactly as it came, and as it starts
  to drive it fades over to the doubled path in 2 ms, so nothing clicks.
- **The width's mono corner at 24 dB an octave** (two 12 dB sections in a
  row, −6 dB at the corner): a bass's side 50 Hz under a 200 Hz corner
  now 45 dB down, not 20, so the lows stay in the middle.

Two ways of playing the new parts recur in the presets. A **plucked
string** is a burst of noise into a comb: its send stands at a hair over
nothing (0.01), an envelope opens it for a few milliseconds and a second,
slower one (attack twice the burst, held, released over 10 s) shuts it
again, so nothing but the burst reaches the comb while the note rings
(`plucked` in `src/state/factory.ts`). A **chord from one key** (the
stabs) is four or five oscillators at fixed intervals, each Free, so the
chord never starts on all its peaks at once.

The comb's and the formant's pictures in the editor are their responses
as `combGain` and `formantGain` (`src/dsp`) work them out.

### The targets

Every factory preset is played offline through the app's own path (a
Strip, its SoundPlayer, the Mixer with the session's first mix: B a
delay, C a reverb), the master's soft clip off so what would reach it
shows, and measured. Each is played as its role is, a phrase in its
range: a lead a melody from C4, a bass a sixteenth line from C2, a pad
four chords of four or five notes, a pluck an arpeggio, keys chords
struck and let go, a bell a few struck notes, brass and an organ
chords, a drum five hits, an effect a held note. The chip presets keep
their port's levels (The chip) and are not held to these.

| Measure   | Target                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loudness  | its role's, every preset within ±1.5 LU (integrated, over its phrase): a lead −17 LUFS, a bass and an organ −20, a pad and brass −21, a pluck and a bell −22, keys −23, an effect −18                                             |
| A drum's  | by its loudest 400 ms (momentary), bare (no inserts, no sends: a pad's chain is the kit's), ±1.5 LU: a kick, a snare, a tom, a clap −23; an open hat, a crash, a cowbell, a conga −26; a closed hat, a shaker, a rim, a clave −30 |
| Peak      | under 0.45 (−6.9 dBFS) on its phrase: nothing reaches the soft clip at −6 dBFS                                                                                                                                                    |
| The lows  | a bass's and a kick's side under 150 Hz at least 20 dB under its middle; any sound's mono sum within 3 LU of its stereo                                                                                                           |
| Clicks    | the highs (over 6 kHz) in 5 ms windows as a note ends, no more than 3 dB over the held note's; as it starts, over 5 ms of attack, against the 200 ms after it (a stab's bright start is no click)                                 |
| Zipper    | the wheel swept in steps adds no more than 3 dB of highs (over 9 kHz) to it held still                                                                                                                                            |
| Aliasing  | across the top octave of its range, at most −40 dB under the note (the note against itself rendered at four times the rate)                                                                                                       |
| Denormals | a block of a dying tail costs no more than 1.2 times a held note's                                                                                                                                                                |
| Velocity  | a hard note (1) at least 3 dB louder than a soft one (0.35); a plucked, struck or blown sound's at least 10% brighter too (its spectral centroid)                                                                                 |
| The wheel | routed, and moving the sound by at least 1 dB (its bands' levels, the wheel down against up)                                                                                                                                      |
| The range | its ends within 6 dB of its middle                                                                                                                                                                                                |
| Cost      | 8 voices of the heaviest preset under the stress sound's 8 (`src/dsp/chainStress.ts`), and `pnpm bench` in its budget                                                                                                             |

The roles' loudness is what their sounds can hold with their peaks at
0.45, rounded down: a pad's chord peaks higher over its loudness than a
lead's one note, a struck key's onset higher still, so the roles differ
by their shapes, and within a role one preset is as loud as the next.
A drum's hit is too short for the integrated loudness to hear as an ear
does, so its loudest moment is held instead, at a kit's balance: the
kick and the snare up front, the hats under them.

### The categories

A preset's category is what it is played as, one each, in the order a
browser lists them (`PRESET_CATEGORIES`, `src/state/presets.ts`); the
factory's are listed in that order (`byCategory`, `src/state/factory.ts`),
each category's in the order written.

| Category | What it holds                                                                                | Presets |
| -------- | -------------------------------------------------------------------------------------------- | ------- |
| Basic    | the starting points: Init, and one input each (a sine, a saw, a square, a super, an FM pair) | 6       |
| Bass     | a line under 200 Hz, its lows in the middle                                                  | 21      |
| Lead     | one line over a track, most of them mono or legato                                           | 21      |
| Pad      | chords held, slow to come and go                                                             | 12      |
| Keys     | played as a keyboard is: pianos, organs, a harpsichord, an accordion                         | 12      |
| Pluck    | plucked and let ring: strings, a synth's plucks                                              | 10      |
| Bell     | struck and chimed: FM bells, mallets, a music box, a steel drum                              | 12      |
| Chord    | a chord from one key: the stabs                                                              | 8       |
| Strings  | bowed: a section, a machine, a swell, a tremolo, pizzicato                                   | 8       |
| Brass    | blown: a section, a horn, a trumpet                                                          | 6       |
| Vocal    | voices: choirs, a chop                                                                       | 5       |
| Atmos    | the beds and textures under a track: drones, wind, the sea                                   | 5       |
| Drums    | the kit's pads                                                                               | 21      |
| FX       | a moment, not a note: risers, impacts, zaps                                                  | 11      |

There were two sets as well, Analog (the analog poly's ports) and Chip;
ashon chose, 2026-11-18, to play both by role, so their presets went to
the categories they are played as, their character kept in their names
(Poly Brass, Chip Lead, NES Triangle, 4-bit Lead). A preset saved under
either reads as Basic (`readCategory`), as any category not ours does.
The kit's pad panel lists only the presets of its own preset's category,
so every drum stays in Drums.

### The list

The sounds, by where they are heard (the first round's 84, then the
second's 30 in the last three groups, besides the rows of the first it
built), each with the factory preset that makes it (or one near it, in brackets; — none yet, with what it wants) and
the source its recipe was learned from (the research notes kept more of each:
the recipe, the numbers, two or three sources). The names are the sounds',
never a product's or a player's.

**Pop and EDM**

| Sound                | Heard in                    | Preset                                  | Source                                                                                                        |
| -------------------- | --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Supersaw lead        | trance, big room, pop       | Supersaw Lead                           | <https://musicproductionwiki.com/articles/how-to-recreate-the-supersaw>                                       |
| Big room lead        | big room, festival          | Festival Lead                           | <https://www.syntorial.com/tutorials/crafting-the-supersaw-edm-dance-synth-lead-a-step-by-step-guide>         |
| Trance pluck         | trance, melodic house       | Trance Pluck                            | <https://www.avid.com/resource-center/how-to-make-trance-plucks>                                              |
| Trance gate pad      | trance                      | Gate Pad                                | <https://www.musicradar.com/news/20-speedy-synth-and-synthesis-tips>                                          |
| Future bass chords   | future bass, pop            | Future Chords                           | <https://musicproductionwiki.com/articles/how-to-recreate-future-bass-chords>                                 |
| House pluck          | progressive house, tropical | Soft Pluck, Square Pluck                | <https://ask.audio/articles/how-to-create-big-room-synth-plucks-in-logic-pro-x>                               |
| Wobble bass          | dubstep                     | Wobble Bass                             | <https://musicradar.com/how-to/lfo-wobble-bass>                                                               |
| Growl, riddim bass   | dubstep, riddim             | Growl Bass, Riddim Bass                 | <https://www.musicradar.com/tuition/tech/how-to-make-a-growling-bass-sound-using-fm-synthesis-606919>         |
| Whistle lead         | tropical house, pop         | Whistle                                 | <https://www.adsrsounds.com/ni-massive-tutorials/tropical-house-whistle-lead-in-massive/>                     |
| Sine sub bass        | pop, trap, house            | Sub Bass                                | <https://beatkitchen.io/guides/electronic-music/04-bass-design/>                                              |
| Chip lead, arpeggio  | chiptune, game              | Chip Lead, Chip Pulse 12, Chip Pulse 25 | <https://www.nesdev.org/wiki/APU_basics>                                                                      |
| Talking formant lead | electro, French house       | Talk Lead                               | <https://unison.audio/formant-filters/>                                                                       |
| FM bell              | pop, future bass, trap      | FM Bell                                 | <https://www.pluginboutique.com/articles/1873-FM-Synthesis-Cookbook-Five-Classic-FM-Sounds-and-How-They-Work> |

**House**

| Sound                 | Heard in                | Preset            | Source                                                                                 |
| --------------------- | ----------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Deep house chord stab | deep house, garage      | Deep Stab         | <https://www.attackmagazine.com/technique/beat-dissected/dusted-deep-house/>           |
| Organ bass            | 90s house, garage       | Organ Bass        | <https://www.attackmagazine.com/technique/video-tutorials/retro-90s-house-organ-bass/> |
| House organ stab      | classic house           | Organ, Organ Stab | <https://www.soundonsound.com/techniques/synthesizing-tonewheel-organs-part-1>         |
| House piano           | piano house             | House Piano       | <https://soundonsound.com/techniques/synthesizing-acoustic-pianos-roland-jx10-1102>    |
| Rolling bass          | tech house              | (Saw Bass, near)  | <https://www.attackmagazine.com/technique/tutorials/warehouse-rolling-techno-bass/>    |
| Rave chord stab       | rave, breakbeat, garage | Rave Stab         | <https://musicradar.com/how-to/rave-chord-stab>                                        |

**Techno**

| Sound            | Heard in           | Preset                           | Source                                                                                         |
| ---------------- | ------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Acid bass        | acid house, techno | Acid Bass                        | <https://www.image-line.com/support/flstudio_online_manual/html/plugins/Transistor%20Bass.htm> |
| Rumble kick      | techno             | — (wants ducking)                | <https://www.attackmagazine.com/technique/beat-dissected/dark-techno-rumble/>                  |
| Dub chord        | dub techno         | Dub Chord                        | <https://www.attackmagazine.com/technique/synth-secrets/dub-techno-synth-chords/>              |
| Techno stab      | techno, tech house | Minor Stab                       | <https://www.attackmagazine.com/technique/synth-secrets/techy-stabs-in-ni-massive/>            |
| Melodic sequence | melodic techno     | (Poly Pluck, Future Pluck, near) | <https://www.musicradar.com/how-to/how-to-program-a-melodic-techno-synth-sound>                |
| Metallic bell    | techno, electro    | (Poly Mod Bell, near)            | <https://docs.cycling74.com/max7/tutorials/06_synthesischapter05>                              |

**Hip-hop, trap and lo-fi**

| Sound               | Heard in             | Preset                    | Source                                                                                                              |
| ------------------- | -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Boom bass           | trap, hip-hop, drill | Trap Bass, Boom           | <https://ampedstudio.com/blog/secrets-of-808-bass/>                                                                 |
| Distorted boom bass | trap, drill          | Dirty Trap Bass           | <https://unison.audio/808-sound-design/>                                                                            |
| Trap bell           | trap, R&B            | FM Bell                   | <https://rosetta.to/u/venustheory/uvi-falcon-2-sound-design-tutorial-creating-plucks-bells-and-keys-trap-ambient-e> |
| Dark trap pad       | trap, cloud rap      | Dark Pad                  | <https://violetrecording.com/how-to-make-trap-beats/>                                                               |
| Whine lead          | West Coast hip-hop   | Whine Lead                | <https://flypaper.soundfly.com/discovery/how-to-create-the-iconic-synth-sound-in-gin-and-juice/>                    |
| Lo-fi keys          | lo-fi, neo-soul      | Lo-fi Keys (no crush yet) | <https://blog.native-instruments.com/how-to-make-lofi-music/>                                                       |
| Lo-fi tape pad      | lo-fi, chillwave     | Tape Pad                  | <https://splice.com/blog/lo-fi-hip-hop-beat-10-minutes>                                                             |
| Vinyl crackle       | lo-fi                | — (wants a dust source)   | <https://www.ujam.com/tutorials/the-ultimate-guide-to-lofi-hip-hop/>                                                |
| Breathy flute       | lo-fi, ambient, film | Breath Flute              | <https://github.com/rupa/synth-secrets>                                                                             |

**Synthwave**

| Sound                | Heard in             | Preset                | Source                                                                   |
| -------------------- | -------------------- | --------------------- | ------------------------------------------------------------------------ |
| Driving bass         | synthwave, outrun    | Saw Bass, Analog Bass | <https://www.native-instruments.com/blogs/blog/synthwave>                |
| Synthwave lead       | synthwave, retro pop | Saw Lead              | <https://www.edmprod.com/how-to-make-synthwave/>                         |
| Retro arpeggio pluck | synthwave, italo     | Square Pluck          | <https://www.native-instruments.com/blogs/blog/synthwave>                |
| Neon pad             | synthwave, 80s pop   | Warm Pad              | <https://www.musicradar.com/how-to/how-to-build-a-classic-80s-pad-sound> |
| Gated snare          | synthwave, 80s pop   | — (wants a gate)      | <https://www.edmprod.com/how-to-make-synthwave/>                         |

**Ambient, film and trailer**

| Sound          | Heard in              | Preset                     | Source                                                                                                |
| -------------- | --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Evolving pad   | ambient, film         | Velvet Pad, Poly Sweep     | <https://www.musicradar.com/tuition/tech/how-to-create-an-evolving-multi-oscillator-pad-sound-619017> |
| Shimmer pad    | ambient, post-rock    | — (wants a shimmer reverb) | <https://www.musicradar.com/how-to/how-to-create-an-ambient-synth-pad-from-scratch>                   |
| Drone          | ambient, film         | Drone                      | <https://musicradar.com/how-to/create-ambient-drone-dune-3>                                           |
| Glass pad      | ambient, new age      | Glass Pad, Crystal Pad     | <https://www.musicradar.com/how-to/atmospheric-pad-polysynth>                                         |
| Wind, ocean    | ambient, film, games  | Wind, Ocean                | <https://babel.speldesign.uu.se/?p=2064998>                                                           |
| Braam          | trailer, film         | Braam                      | <https://www.ableton.com/en/blog/learn-how-to-make-high-impact-sounds-for-movies-and-trailers/>       |
| Impact         | trailer, drops        | Impact                     | <https://blog.native-instruments.com/5-quick-tips-for-epic-movie-trailer-impacts/>                    |
| Sub drop       | trailer, EDM, trap    | Sub Drop                   | <https://outlierstudios.co/intres/impacts>                                                            |
| Ostinato pulse | trailer, hybrid score | Staccato Strings           | <https://violetrecording.com/sound-design-for-trailers/>                                              |

**Transitions**

| Sound       | Heard in          | Preset     | Source                                                                                      |
| ----------- | ----------------- | ---------- | ------------------------------------------------------------------------------------------- |
| Noise riser | EDM, pop, trailer | Riser      | <https://violetrecording.com/how-to-make-risers-and-sweeps/>                                |
| Downlifter  | EDM, pop, trailer | Downlifter | <https://musictech.net/tutorials/weekend-workshop-make-risers-and-downlifters-with-odin-2/> |
| Whoosh      | film, transitions | Whoosh     | <https://www.musicradar.com/how-to/synth-sweep-fx>                                          |

**Keys, organs, strings, brass and choirs**

| Sound               | Heard in                 | Preset                                         | Source                                                                                   |
| ------------------- | ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Poly brass          | synthwave, 80s pop, film | Poly Brass, Brass Stab                         | <https://www.soundonsound.com/techniques/creating-analogue-sounds-digital-synths-part-3> |
| Solo brass          | film, funk               | Trumpet, French Horn                           | <https://www.soundonsound.com/techniques/synthesizing-brass-instruments>                 |
| String machine      | disco, new wave, ambient | String Machine                                 | <https://www.soundonsound.com/techniques/synthesizing-strings-string-machines>           |
| PWM pad             | synthwave, ambient       | PWM Pad, Hollow Pulse                          | <https://www.soundonsound.com/techniques/synthesizing-strings-pwm-string-sounds>         |
| Synth strings       | pop, film, trance        | Strings, Poly Strings, String Swell            | <https://www.soundonsound.com/techniques/synthesizing-strings-string-machines>           |
| Choir               | ambient, trance, film    | Formant Choir, Choir Pad, Aah Choir, Ooh Choir | <https://csound.com/docs/manual/MiscFormants.html>                                       |
| Tine electric piano | neo-soul, lo-fi, house   | E-Piano                                        | <https://chicagoelectricpiano.com/?p=198>                                                |
| FM electric piano   | 80s ballad, city pop     | FM E-Piano                                     | <https://www.attackmagazine.com/technique/tutorials/fm-electric-piano/>                  |
| Drawbar organ       | gospel, rock, house      | Organ                                          | <https://www.soundonsound.com/techniques/synthesizing-tonewheel-organs-part-2>           |

**Leads and basses**

| Sound           | Heard in               | Preset                   | Source                                                                                 |
| --------------- | ---------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Reese bass      | drum and bass, techno  | Reese Bass               | <https://www.attackmagazine.com/technique/tutorials/reese-bass-redux/>                 |
| Hoover          | rave, hardcore         | Hoover                   | <https://www.wikiwand.com/en/articles/Hoover_sound>                                    |
| Sync lead       | new wave, electro      | Sync Lead                | <https://craiganderton.org/understanding-synthesizer-hard-sync/>                       |
| Mono lead       | prog, funk, synthwave  | Saw Lead, Unison Lead    | <https://www.soundonsound.com/techniques/brass-synthesis-minimoog>                     |
| Fat analog bass | funk, synth-pop, house | Analog Bass, Unison Bass | <https://www.musicradar.com/news/5-house-bass-sounds>                                  |
| FM bass         | 80s pop, synthwave     | FM Bass                  | <https://www.musictech.net/tutorials/learn-advanced-fm-synthesis-with-dexed/>          |
| FM slap bass    | 80s funk, city pop     | Slap Bass                | <https://yamahasynth.com/learn/synth-programming/basics-of-fm-synthesis-lesson-5-new/> |

**Plucked and struck**

| Sound                   | Heard in                | Preset         | Source                                                                                        |
| ----------------------- | ----------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| Plucked guitar          | pop, lo-fi, ambient     | Plucked String | <https://ccrma.stanford.edu/~jos/pasp/Extended_Karplus_Strong_Algorithm.html>                 |
| Harp                    | film, ambient           | Harp           | <https://www.soundonsound.com/techniques/synthesizing-plucked-strings>                        |
| Koto                    | world, game, ambient    | Koto           | <https://crypto.stanford.edu/~blynn/sound/karplusstrong.html>                                 |
| Marimba                 | pop, tropical, film     | Marimba        | <https://ccrma.stanford.edu/CCRMA/Courses/150/percussion.html>                                |
| Vibraphone              | jazz, lo-fi, film       | Vibes          | <https://ccrma.stanford.edu/CCRMA/Courses/150/percussion.html>                                |
| Glockenspiel, xylophone | film, pop               | Glock          | <https://orchestrationonline.com/orchestration-tip-harmonic-spectra-of-xylophone-vs-marimba/> |
| Kalimba                 | lo-fi, ambient, afropop | Kalimba        | <https://acoustics.org/pressroom/httpdocs/155th/chapman.htm>                                  |
| Tubular bell            | film, ambient           | Tubular Bell   | <https://www.soundonsound.com/techniques/synthesizing-bells>                                  |

**Drums**

| Sound      | Heard in               | Preset                      | Source                                                                                |
| ---------- | ---------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| Kick       | house, techno, hip-hop | Kick, Punch Kick, Deep Kick | <https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf> |
| Snare      | all                    | Snare, Tight Snare          | <https://www.manualslib.com/manual/1294765/Roland-Tr-808.html?page=14>                |
| Clap       | house, pop, trap       | Clap                        | <https://www.manualslib.com/manual/1294765/Roland-Tr-808.html?page=6>                 |
| Hats       | all electronic         | Closed Hat, Open Hat        | <https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf>                        |
| Cymbal     | electronic, synthwave  | Crash, Ride                 | <https://github.com/rupa/synth-secrets>                                               |
| Toms       | synthwave, 80s, techno | Tom, Low Tom, High Tom      | <https://www.manualslib.com/manual/1294765/Roland-Tr-808.html?page=14>                |
| Cowbell    | house, Latin           | Cowbell                     | <https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf>                        |
| Rim, clave | electro, house         | Rim, Clave                  | <https://www.manualslib.com/manual/1294765/Roland-Tr-808.html?page=14>                |
| Shaker     | house, pop, lo-fi      | Shaker                      | <https://cim.mcgill.ca/~clark/nordmodularbook/nm_percussion.html>                     |

**Starting points**

| Sound           | Heard in | Preset                              | Source                                                                           |
| --------------- | -------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| Single waves    | anywhere | Basic Sine, Basic Saw, Basic Square | <https://www.soundonsound.com/techniques/synth-school-part-4>                    |
| Supersaw stack  | anywhere | Basic Super                         | <https://www.adamszabo.com/internet/adam_szabo_how_to_emulate_the_super_saw.pdf> |
| Two-operator FM | anywhere | Basic FM                            | <https://www.soundonsound.com/techniques/introduction-frequency-modulation>      |

**Acoustic instruments**

| Sound               | Heard in             | Preset          | Source                                                                                   |
| ------------------- | -------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| Upright bass        | jazz, soul, lo-fi    | Upright Bass    | <https://www.adsrsounds.com/zebra-tutorials/upright-bass/>                               |
| Pan flute           | world, film, new age | Pan Flute       | <https://www.soundonsound.com/techniques/synthesizing-pan-pipes>                         |
| Reed electric piano | soul, funk, lo-fi    | Reed Piano      | <https://www.muzines.co.uk/articles/practically-fm/3945>                                 |
| Harpsichord         | baroque, film, pop   | Harpsichord     | <https://www.ee.columbia.edu/~dpwe/e6820/papers/ValPK04-harpsi.pdf>                      |
| Pipe organ          | church, film         | Pipe Organ      | <https://www.colinpykett.org.uk/baroque-vs-romantic-principals.htm>                      |
| Accordion           | folk, chanson, film  | Accordion       | <https://www.libertybellows.com/general-accordion-questions.htm>                         |
| Palm-muted guitar   | rock, pop            | Muted Guitar    | <https://www.dsprelated.com/freebooks/pasp/Electric_Guitars.html>                        |
| Banjo               | folk, country        | Banjo           | <https://acoustics.org/pressroom/httpdocs/159th/dickey.htm>                              |
| Music box           | film, lullabies      | Music Box       | <https://en.wikipedia.org/wiki/Euler%E2%80%93Bernoulli_beam_theory>                      |
| Celesta             | film, holidays       | Celesta         | <https://wiki.ubc.ca/Course:Phys341_2020/Celeste>                                        |
| Steel drum          | calypso, tropical    | Steel Drum      | <https://www.hangblog.org/the-caribbean-steelpan-and-some-offsprings>                    |
| Pizzicato           | film, pop            | Pizzicato       | <https://www.syntorial.com/tutorials/synth-quickie-strings/>                             |
| Tremolo strings     | film, trailer        | Tremolo Strings | <https://cmtext.com/synthesis/chapter4_modulation3.php>                                  |
| Horn section        | funk, soul, film     | Horn Section    | <https://www.soundonsound.com/techniques/creating-analogue-sounds-digital-synths-part-3> |
| Tambourine          | pop, soul, gospel    | Tambourine      | <https://jefftk.com/p/what-noise-does-a-tambourine-make>                                 |
| Woodblock           | Latin, film          | Woodblock       | <https://github.com/thestk/stk/blob/master/src/ModalBar.cpp>                             |

**Synth sounds**

| Sound             | Heard in                | Preset         | Source                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthwave bass    | synthwave, outrun       | Synthwave Bass | <https://www.attackmagazine.com/technique/synth-secrets/how-to-make-a-synthwave-laser-gun-bassline/>                                                                                                                                                      |
| Rubber bass       | hip-hop, G-funk         | Rubber Bass    | <https://www.musicradar.com/tuition/tech/how-to-create-punchy-hip-hop-808-bass-570807>                                                                                                                                                                    |
| Glide lead        | EDM, trance             | Glide Lead     | <https://www.musicradar.com/how-to/glide-and-rise-synth-patch>                                                                                                                                                                                            |
| Lush supersaw pad | trance, pop             | Lush Pad       | <https://www.musicradar.com/how-to/supersaw-synth-sound>                                                                                                                                                                                                  |
| Future bass pluck | future bass, pop        | Future Pluck   | <https://violetrecording.com/how-to-make-future-bass/>                                                                                                                                                                                                    |
| Ninth chord       | neo-soul, R&B           | Ninth Chord    | <https://www.soundonsound.com/techniques/synth-chords-masterclass>                                                                                                                                                                                        |
| Vocal chop        | future bass, house, pop | Vox Chop       | <https://www.adsrsounds.com/reaktor-tutorials/ni-razor-vowel-synth/>                                                                                                                                                                                      |
| Deep-space drone  | ambient, film           | Deep Space     | <https://www.musicradar.com/tuition/tech/how-to-create-a-generative-evolving-ambient-drone-sound-in-ableton-live-590880>                                                                                                                                  |
| Metallic drone    | industrial, film        | Metal Drone    | <https://www.soundonsound.com/techniques/amplitude-modulation>                                                                                                                                                                                            |
| Laser zap         | techno, electro, games  | Laser          | <https://www.musicradar.com/tutorials/music-production-tutorials/how-did-the-zap-migrate-from-its-association-with-klingons-to-its-more-common-description-of-hi-q-how-to-conjure-the-spirit-of-early-techno-and-trigger-your-own-retro-zaps-in-software> |
| Bubbles           | film, games             | Bubbles        | <https://www.musicradar.com/tuition/tech/10-classic-synth-fx-and-how-to-create-them-634904>                                                                                                                                                               |

### Measured

All 141 presets held to the targets (the factory's 150 but Init and the
eight chip presets) meet every one above, measured 2026-11-18 by an
offline harness (kept outside the repository) rendering each through
Strip, SoundPlayer and Mixer: 59 from before, 31 new in the first round
and 51 in the second. The new ones, by the categories they stand in:

| Category | The first round                                                                      | The second                                                      |
| -------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Basic    |                                                                                      | Basic Sine, Basic Saw, Basic Square, Basic Super, Basic FM      |
| Bass     | Trap Bass, Dirty Trap Bass, Riddim Bass, Organ Bass                                  | Upright Bass, Synthwave Bass, Rubber Bass, Slap Bass            |
| Lead     | Supersaw Lead, Festival Lead, Sync Lead, Talk Lead, Breath Flute, Whine Lead, Hoover | Pan Flute, Whistle, Glide Lead                                  |
| Pad      | Gate Pad                                                                             | Lush Pad, Dark Pad, Tape Pad, Crystal Pad                       |
| Keys     | House Piano                                                                          | Reed Piano, Harpsichord, Pipe Organ, Lo-fi Keys, Accordion      |
| Pluck    | Trance Pluck, Plucked String, Harp, Koto                                             | Muted Guitar, Banjo, Future Pluck                               |
| Bell     | Tubular Bell, Glock                                                                  | Music Box, Celesta, Steel Drum                                  |
| Chord    | Deep Stab, Rave Stab, Dub Chord, Future Chords                                       | Organ Stab, Minor Stab, Ninth Chord                             |
| Strings  | String Machine                                                                       | String Swell, Staccato Strings, Tremolo Strings, Pizzicato      |
| Brass    |                                                                                      | Horn Section, Trumpet, French Horn                              |
| Vocal    | Formant Choir                                                                        | Aah Choir, Ooh Choir, Vox Chop                                  |
| Atmos    | Drone                                                                                | Ocean, Deep Space, Metal Drone                                  |
| Drums    |                                                                                      | Punch Kick, Deep Kick, Tight Snare, Tambourine, Ride, Woodblock |
| FX       | Braam, Impact, Sub Drop, Downlifter, Whoosh                                          | Laser, Bubbles                                                  |

What it took, besides each sound's own recipe: a level (`trim` in
`PLAYING`) for each, taken from its loudness or, where its peak bound it
first, from that (a sound only ever turned down); a drive inside the
voice where a sound's peaks stood too far over its loudness (the plucked
strings, the noise of the effects), since an insert after the amp would
flatten its velocity; less drive, FM and octave-up layering up the keys,
where they would fold back past the top; the House Piano's FM pairs
Free, as a sine's FM sounds alike from any phase, so its chords never
start on their peaks together.

The second round learned four things more:

- **A plucked string's level is its drive's**, its burst's length and
  its comb's decay, not its send's: the pluck's envelope opens the send
  to about 1 whatever it stood at, so raising it does nothing.
- **A super stack wants Free written out** (`phase: 'Free'`): the
  presets' `free` frees oscillators only, and a stack left Reset starts
  its saws in phase on every note, its range's ends 6 dB under its
  middle (the String Swell's, before).
- **A lowpass after a drive, not before it**: a drive after the lowpass
  brings the highs back however soft the note, so velocity no longer
  brightens it (the Vox Chop's, before).
- **A comb rung short and bright reads as aliasing**: its peaks broad
  and many past the top octave (the Muted Guitar at −30 dB, before); it
  rings longer and duller now, and the amp mutes it.

Checked afterwards against the research notes for the second round (a
source for each of the 51, its recipe and numbers), each preset stood as
written but two, which took the second mode of a struck bar where they
had a ratio near it: the Celesta's FM at 2.76 times its note (it had 4,
whose sidebands are harmonics), the Woodblock's partial at 2.777 (it had
2.52). Where a sound departs from its source on purpose it is to meet the
targets: the Harpsichord answers velocity, which a harpsichord does not,
as every keyed preset here does.

The heaviest new preset at 8 voices costs 0.20 ms a block (the
Harpsichord, then the Vox Chop at 0.19), the stress sound 0.74 ms on the
same run, and `pnpm bench` stays in its budget.

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

- **Tiles.** Inputs stand in the first column; each chain is a group
  (since 2026-11-15, ashon: "사운드 쪽에서도 체인을 그룹처럼 다뤄보면
  좋겠어", as the Mix's buses had just become): a head across its top
  (letter and level, 22 px), its items squares inside, as many to a
  line as the frame has room for at rest (60 px squares: with a column
  of inputs and no inserts, two to a line need a frame 386 px wide, so
  a 412 px phone has two and a narrower one stands them one under
  another), every group breaking its lines alike, and the "+" in the
  place after them, to the end of that line, or in a line of its own
  30 px tall after a full one. A scrollbar that takes room keeps it,
  scrolling or not: a group broken into more lines, taller, scrolled,
  and left too little width to mend them. A taller frame grows the
  squares, up to 120 px, and a wider one widens them before the rest. A
  chain's row is as tall as its group, or as its inputs need, the group
  in its middle. Then the amp, which stands at the end of every row
  (since 2026-11-12 at most two slots tall, or three fifths of its
  width: past that it stands in the rows' middle and a bus down the seam
  takes every row to it). Until 2026-11-15 a chain was a row: its head
  (as tall as its items, in the row's middle since 2026-11-14: it kept
  the row's height for the pegs, and ashon saw it need not once threads
  bent into it), then its items side by side, at most two slots tall, a
  longer chain panning the graph right; on a phone the frame stood
  mostly empty under it. Modulators sit
  in a rack above, the voice at its end (since 2026-11-12 at its start,
  over the inputs whose pitch it sets; from md up, and on a phone on its
  side, the rack is a column at the graph's left, which has width to
  spare and little height). Held upright, its tiles stand as tall as the
  graph's, 44 px (56 until 2026-11-12, ashon: the rack hard to take in
  on a phone); in the column, 56 px squares, 56 by 44 on a screen under
  30rem tall (ashon, 2026-11-12: on a phone on its side the column
  showed the voice and half a modulator). A tile
  is flat, outlined by a ring; picked, its ring is heavier and it takes a
  tint; a group is outlined in its chain's colour. A graph wider or
  taller than its frame pans.
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
  that no two threads cross. A head took a hole for each input that
  feeds it; a group's (2026-11-15) took one at its left, where every
  send ended, the thread running down from it into the first square.
  On the phone the same day ashon found that climb to the head and
  turn back down awkward ("좌측 공간 살짝 양보하면서 체인 표현도
  어색하게 꺾이지 않도록"): each send now ends in a hole of its own down
  the left edge of the chain's first item (of its head, holding none),
  about its middle, closer where they would not fit, an S across the
  seam and no turn. From the first the thread runs across from square
  to square along a line, from a line's last (at its foot) into the
  next's first (at its top), and from the last square, over the "+",
  into the amp or onto the bus. A send's thread, a chain's last run
  (its level, into the amp or onto the bus) and a read's are as thick
  and as strong as what they carry, 1 px and 35% for nothing to 3 px
  and full for all; the stitches between a chain's items, and after the
  amp, are 2 px. The seam an input's threads bend across, before the
  groups, is 18 px since 2026-11-15, the inputs 62 px wide for it where
  they were 68 (the room ashon asked them to give), so a sound stands no
  wider; it was 4, then 12: the storyboard's 14 made a sound of one item
  398 px wide, 2 px more than a 412 px phone's frame, so it panned. Each
  send's and read's thread has a tap target of 44 × 28 px about its
  middle, picking as its peg did. Picking a chain's head lights its
  threads from its inputs to the amp, the rest of the chains' and the
  inputs' dimmed to a quarter; picking an input lights its own, the
  other inputs' dimmed; an item lights the runs on either side of it. A
  "+" in a row has its label at its foot, out of the thread's way, and
  the Out's view stands clear of its hole. In the session's mix the same
  threads run from every track to the buses it sends to, each bus's in a
  lane of its own, and from every bus down a lane of their own into the
  master (`effects-parts-sequencer.md`, Mix).
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
  confirmed). Its last button, a cross, closes it, and a tile tapped
  opens it again; a tile held to be dragged leaves it closed. Closed,
  it leaves no tile picked on the graph, in the kit or in the mix:
  every tile, thread and ring shows as at rest, and the panel opens
  again on the pick kept, or on the tile tapped (since 2026-11-15,
  ashon: "블록을 선택한 다음 노브 패널이 닫힐때는 블록쪽 강조 표현도
  디폴트가 되도록"; the tile had stayed picked, its threads lit and
  the others' dimmed, with no panel for it). Until
  2026-11-15 the button folded it away (ashon, 2026-11-12: for the
  graph to show more chains) into a bar under the graph, or a narrow
  column beside it from md, which brought it back; then ashon asked for
  it to close and open instead ("노브 패널은 접을 필요없이, 닫고
  열도록"), and the bar went. Since 2026-11-12 it stands over the
  graph's card, not beside it: the tiles keep to the room it leaves
  them (`roomBeside` in `src/viz/graph.ts`) and the editor asks the
  page for the same height whether it shows or not, so closing it
  shows the canvas under it and moves neither the tiles nor the keys.
  Before that, hidden, it had given the keys and the tiles its room,
  both growing, and ashon asked for them to keep their size, the panel
  over the canvas. Beside the graph the tiles take its whole width,
  the panel open or closed, and the panel stands over the last of
  them, the graph panning them out (ashon, 2026-11-12: the canvas left
  for the panel on a phone on its side was room wasted, and the tiles
  should not resize as it shows; they kept clear of its bar while it
  had one); under the graph they keep clear of the whole dock. Its card
  face is opaque. From 2026-11-12 it let a little through, the canvas
  under it blurred (ashon asked for a blur, a hue and a grain, then
  found the knobs lost on that busier glass and kept the blur alone).
  2026-11-17 the blur went: the views under it, drawn each display
  frame, had a phone's GPU blur them again every frame, and with the mix
  choppy ashon took it for the cause ("마스터 패널의 반투명 패널이
  문제같긴 하네"). The frames' report showed none missed for it (the
  chunks of Bluetooth's audio were the cause, `docs/platform-notes.md`),
  and the face stayed opaque.
- **Margins.** In the editor's card everything stands 8 px from the
  card's edges, and its blocks 8 px apart: the rack (a row or a column),
  the graph's tiles, and the panel, which stands in from the
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
  that has room (to the seam nearest the finger on the group's line
  nearest it: a line's end and the next one's start both take it to
  the same place), a chain held by its group takes its row up or down
  (its letter and colour follow its new place), a modulator moves
  along the rack.
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
  dark strip under the status bar, whose letters stay white. Then the
  pop themes (ashon, 2026-11-15: "좀더 팝한 테마들도 넣어보면 좋겠어"):
  Neon (hot pink, cyan, lime and orange on violet-black, a laser yellow
  accent), Candy (bubblegum, mint, apricot and periwinkle on
  berry-black, a lemon accent) and Arcade (yellow, sky, green and
  magenta on navy, an orange accent). A theme may give the surfaces
  too (the page, a card, a tile, a key, a black key): each the
  neutral's lightness tinted toward the theme's hue, the light's tiles
  and keys left white. The page puts them over index.css's tokens, the
  canvases draw on them and draw again when the theme changes, and the
  spectrogram's scale starts from the theme's page. In the light no
  yellow reads on white: each yellow goes gold, and hues turn until
  the chains stand ΔE 20 apart. A fourth, Citrus (orange, lemon, lime
  and raspberry), was left out: deepened for the light, its orange,
  lemon and lime came within ΔE 12 of one another. A theme of one's own
  (a colour for each role, lifted until it passes the checks) waits:
  ashon was unsure it is needed.

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
