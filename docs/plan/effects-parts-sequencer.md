# Effects, parts and a sequencer

Asked for by ashon, 2026-11-12 ("1,2,3 작업을 진행해 보면 좋겠네"): three
pieces of work, in this order, each building on the last:

1. **Effects** after the voices: chorus, delay, reverb.
2. **Parts**: the synth and a drum kit of 16 pad sounds, side by side.
3. **A step sequencer** playing the kit and the synth.

## What ashon chose

Asked as four choices, 2026-11-12:

- **Effects are a free chain**, not a fixed Chorus → Delay → Reverb and
  not one global set: added, removed and reordered as a chain's items
  are, up to four, kept with each sound. Revised by ashon the same day,
  before it was committed (below): a sound keeps only its inserts, and
  the delay and the reverb are the session's, every part sending to them.
- **A Part switch** (Synth | Kit) in the header. With Kit, the editor
  edits the picked pad's sound and the play area shows 16 pads, a tap
  playing and picking one; with Synth, Keys, Pads and XY as now. Ruled
  out: the Pads surface always playing the kit.
- **The sequencer's scope**: the kit's 16 lanes as a drum grid, plus one
  synth track (a note, a length and a velocity per step); tempo, swing,
  a pattern 16 to 64 steps long, one pattern kept in the session. Ruled
  out for now: the kit alone; patterns A to D chained into a song.
- **The sequencer's place**: a new play surface, Seq, beside Keys, Pads
  and XY, its transport and tempo in the surface's header. The editor
  stays above it, so sounds can be edited while it plays. Ruled out: a
  sheet of its own (#/seq).

Then, asked whether an instrument usually holds its own delay and reverb
("인스트루먼트에서는 딜레이 리버브가 빠지고, 이후에 거는 방식은 별로인가?"),
ashon chose a mixer's way: inserts on each part, two shared returns
after them, and a master, its output shown well, more than the scope
("마스터링 되는 사운드도 파형이나 주파수 시각화가 잘 나오면 좋겠네").
The master was to stand at the end of the sound's graph, showing a
spectrum, a spectrogram, the two sides against each other and the
levels. Then ashon asked for the instrument and the mix after it to be
seen apart ("인스트루먼트 체인과, 이후에 조합하는 체인을 나누어서 볼 수
있게 하는건 어때?"), and chose a Sound | Mix switch in the editor, the
sends turned in either. Last, the spectrogram showed a faint line over
every sine ("위에 보면 선이 쭉 남잖아 이게 궁금한거야"): the third
harmonic the master's tanh made, 52 dB under the note. ashon chose a
clip that leaves everything under a knee untouched ("진행해 줘").

Then ashon asked why the delay and the reverb stood side by side in the
mix rather than in a chain ("왜 여기서는 둘이 공존하는거야? 여기서도 fx가
다양하게 체인될 수 있도록"), and for the wet and dry channels to be the
user's to build too ("웻 드라이 채널도 사용자가 직접 구성할 수 있게"):
the two returns became buses, up to four, each a row of effects, the dry
path one of them, and the master a row of its own. Last, ashon asked
for a delay and a reverb to come in at a Mix of about 30% ("100%는
일반적이진 않은 것 같아"). Then, looking at it on a phone: the Out's
name over its view, as the other tiles stand ("레이블이 위에 있고 하단에
시각화가 오도록"); the meters as black as the views and a little wider;
bus B becoming A when A is removed ("Bus A가 지워지면 B가 다시 A가
되도록"); a colour for each bus ("각 버스별로 색상이 들어가서"); a pan
for each bus besides its level ("각 버스별로 볼륨과 팬을"); and the
page's margins and the gaps between its cards as a card's inside, 8 px
("전체 컨테이너 패딩도 8픽셀로", "메인 컨테이너의 갭도 8픽셀로").

## 1. Effects

Done 2026-11-12, not committed yet.

### The model

A channel strip per part, then the session's mix, since 2026-11-12 its
buses (before them two fixed returns, a delay and a reverb, and a dry
path straight to the master):

```
part: voices → inserts → fader ─┬─ send A → Bus A: its effects → level ─┐
                                ├─ send B → Bus B: its effects → level ─┤
                                ├─ send C → Bus C: its effects → level ─┤
                                └─ send D → Bus D: its effects → level ─┴→
                                      Master: its effects → level → clip
```

- **Inserts** (`Sound.effects`, `src/state/sound/sound.ts`): each an id
  (`f1`, `f2`, …), a kind and its knobs, in the order they run, up to
  `MAX_EFFECTS` (4), of the three kinds below.
- **Sends** (`Sound.sends`): how much of the sound, after its inserts,
  goes to each bus, by its letter (A to D), 0 to 100%, kept with the
  sound and its presets: all of it to A, none to the others, unless set.
  A sound saved before sends sends to A alone; one saved before buses
  (sends to a delay and a reverb) sends all of itself to A, its delay's
  to B and its reverb's to C, where the starting mix has them.
- **A strip's fader** (`Mix.strips`, `STRIP_SPEC`), since 2026-11-13,
  asked for by ashon ("각 사운드별 아웃풋 레벨도 조절할 수 있어야
  제대로 믹싱할 수 있을 것 같아. 악기의 밸런스도 제대로 잡고"): each
  part's Level, 0 to 100%, and Balance (as a bus's), after its
  inserts and before its sends, so that its echoes follow it down, as a
  desk's post-fader sends do. The session's, as the buses are, by the
  part's place (`p1`, the sound's, the only one so far, `PARTS`): a
  preset loaded plays at the level its part was given, so a balance set
  between instruments stays. A mix kept before strips reads at full in
  the middle; the worklet glides to a new value over a block.
- **The mix** (`src/state/mix.ts`): up to four buses (`MAX_BUSES`),
  lettered by their place, A first, as a desk numbers its aux sends,
  each its effects (`e1`, `e2`, …, unique in the mix), a Level and a
  Balance; and the master, its effects and its Level. A bus added comes
  after the last; one removed takes its effects with it, those after it
  move up a letter (their effects keep their ids), and so do the sound's
  sends to them (`sendsWithout`), the last letter's going to 0. A preset
  kept in the library keeps its letters. Kept with the
  session in localStorage (`loopromeda.mix`, version 2), never with a
  preset, sent to the worklet whole (`{ t: 'mix' }`). A session starts
  as the mix before buses sounded: A dry (no effects), B a delay, C a
  reverb, the master bare. A version 1 mix (the two returns' knobs and
  the master's) is read as those buses, at the returns' knobs and
  levels.

| part       | knobs                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chorus     | Rate 0.05–5 Hz (0.6), Depth (50%), Mix (50%)                                                                                                                  |
| Delay      | Time 0.01–2 s (0.35), Feedback (40%), Tone (60%), Mode: Stereo or Ping-pong, Mix (30%)                                                                        |
| Reverb     | Size (60%), Decay 0.2–10 s (2), Damp (50%), Mix (30%)                                                                                                         |
| Haas       | Time 1–40 ms (15), Later: Right or Left, Mix (100%)                                                                                                           |
| Doubler    | Detune 1–50 ct (9), Delay 2–40 ms (12), Spread (100%), Mix (50%)                                                                                              |
| Width      | Width 0–200% (100%), Mono Below 20–500 Hz (Off at 20)                                                                                                         |
| EQ         | Low Cut 10–500 Hz (Off at 10), Low ±15 dB (0), Low Freq 30–500 Hz (100), Mid ±15 dB (0), Mid Freq 150 Hz–8 kHz (1k), High ±15 dB (0), High Freq 2–16 kHz (8k) |
| Compressor | Threshold −60–0 dB (−18), Ratio 1–20:1 (2), Attack 0.1–100 ms (10), Release 10 ms–2 s (150 ms), Makeup 0–24 dB (0), Mix (100%)                                |
| Limiter    | Gain 0–24 dB (0), Ceiling −12–0 dB (−1), Release 10 ms–1 s (100 ms)                                                                                           |
| Bus        | Level (100%), Pan (the middle): a balance                                                                                                                     |
| Master     | Level (100%), after its effects and before the clip (a guard at full scale, after a limiter last)                                                             |

Mix keeps an effect's dry signal whole up to its middle and the wet
whole past it. Every effect comes in at its kind's defaults, wherever it
is added: an insert, on a bus, on the master. The starting mix's delay
and reverb are wet only, at 100%: they are returns, a sound's dry
reaching the master through A. At 30% they would pass the dry on too,
and every preset sending to them would come out louder and drier than
it did. A bus with no effects is a dry path, named Dry; one with some is
named by its first (Delay, Delay +1). No route moves an effect's knob, a
send or the mix: a route's sources are each voice's own, and the
effects hear all the voices at once.

### The sound

`src/dsp/effects.ts`, pure: an `EffectRack` holds four slots (a part's
inserts, a bus's, the master's), each playing the kind set on it. A
slot's processor of a kind is built the first time it is set to that
kind (`setKind`, on the message that sets it, never in `process`) and
kept: a delay holds a megabyte of lines, and most racks never play one.

- **Chorus**: a copy of each side read 12 ms behind, swept 6 ms either
  way by a sine, the right a quarter cycle behind the left: width from
  one channel.
- **Delay**: up to 2 s, a time change gliding over 50 ms (a tape's
  pitch bend, no click); feedback up to 0.95 through a lowpass (Tone,
  500 Hz to 20 kHz), so the echoes darken; Ping-pong sends the first
  echo left, the next right, and so on.
- **Reverb**: an eight-line feedback delay network (lines 29.7 to 73.1
  ms, scaled by Size down to 0.3, Householder mixing), each line's gain
  set for Decay to be its fall to −60 dB, each line damped by a lowpass
  (20 kHz down to 1 kHz), after four allpass diffusers; the two sides
  read the lines with opposite signs, so they are uncorrelated.
- **EQ**, **Compressor** and **Limiter**, since 2026-11-13: the
  mastering tools (below).
- A rack **rests** once its input has been silent and its output under
  −120 dB for 2.5 s, and wakes with the next sound.

The output path (`src/dsp/output.ts`): a `Strip` is a sound's synth
(its clip off, its voices summed in stereo, each where the amp's pan
puts it, since 2026-11-12), its inserts and a send to each bus, each
gliding (`Ramp`). A `Part` is a fader (a level and a balance,
`setFader`, since 2026-11-13) over its strips: the synth's one, the
kit's sixteen (2, below); at full in the middle the fader leaves the
block untouched. The `Mixer` renders every part's strips, each through
its inserts and its part's fader, sums each into the buses that are on,
runs each bus through its effects and adds it at its level and its
balance, then runs the master's effects, scales by the master and soft
clips each side. A strip's and a bus's balance (`sideGain`) moves
nothing: in the middle both sides as they are, so a bus at its default
sounds as before it had one; towards a side the other falls as a
quarter cosine, −3 dB halfway, silent at the edge. A voice's Pan (the
Amp's) moves the voice itself, equal power. The two were both named
Pan until 2026-11-13, when ashon chose to call the strip's and the
buses' Balance ("밸런스로 가자"); the key stays `pan`, so what was kept
reads as it was. A bus turned off
stops where it is: on again, it starts from silence, so the buses after
one removed restart their tails as they move up. The worklet's node
outputs two channels.

The clip (`src/dsp/clip.ts`) passes everything up to a knee at −6 dBFS
untouched and bends past it, `k + (1 − k)·tanh((|x| − k)/(1 − k))`
with k = 0.5, its value, slope and curvature meeting the straight line
at the knee, towards ±1, never beyond. tanh alone bent from the first
sample. A sine's harmonics, all of them over its fundamental:

| Into the clip | tanh, out | tanh, harmonics | Knee, out | Knee, harmonics |
| ------------- | --------- | --------------- | --------- | --------------- |
| −20 dBFS      | −20.0 dB  | 0.083%          | −20.0 dB  | none            |
| −12 dBFS      | −12.2 dB  | 0.52%           | −12.0 dB  | none            |
| −6 dBFS       | −6.7 dB   | 2.0%            | −6.0 dB   | none            |
| −3 dBFS       | −4.3 dB   | 3.7%            | −3.1 dB   | 0.61%           |
| 0 dBFS        | −2.4 dB   | 6.7%            | −1.1 dB   | 4.5%            |
| +3 dBFS       | −1.0 dB   | 11.3%           | −0.2 dB   | 12.2%           |
| +6 dBFS       | −0.3 dB   | 17.3%           | −0.0 dB   | 20.9%           |

So a sound played as loud as the Init sound's note (−15 dBFS) comes out
as it went in, where tanh gave it a third harmonic 52 dB under it. Sine
chords at full velocity, the loudest product at a sum or difference
(f₁ + f₂ − f₃, 2f₁ − f₂) under the notes, tanh then the knee: C4 G4
(peaks at −9.1 dBFS) −42.6 dB, none; C4 E4 G4 (−5.6) −36.7 dB, none;
C4 E4 G4 C5 (−3.6, past the knee 4.5% of the time) −37.0 dB, −71.5 dB,
and none with the master at 70%. Under tanh those products came and
went about once a second in the spectrogram: equal temperament's fifth
is 2 cents narrow, so 3 × C4 and 2 × G4 are 0.9 Hz apart, and products
that nearly meet beat at that rate. Past about +2 dBFS the knee gives a
little more than tanh did, nearing full scale sooner. A knee at −3 dBFS
was the other choice: clean to −3, 2.8% at 0 dBFS, 22% at +6.

Measured (M3 Max, one 128-frame block, `pnpm bench`): the heaviest
sound's 16 voices 0.81 ms; through a full rack of choruses and both
returns 0.86 ms. Since the pan, the heaviest sound routes random to it
and every voice is placed anew each sample: through the effects 0.89
ms. Since the buses, the heaviest output is that sound through a full
rack of inserts, sent whole to four buses, each a full rack, and the
master a full rack too (24 effects, choruses and reverbs in turn):
1.02 ms of the block's 2.67 (1.06 with the buses' pan, within the
noise). A full rack of each kind: four choruses
0.038 ms, four reverbs 0.031, four delays 0.006. Measure CPU times the
whole output (`chainStressOutput`). On the Fold (SM-F971N, Chrome 157,
the deployed site), 2026-11-13: 0.41, 0.68, 0.98 and 1.28 ms for 8, 16,
24 and 32 voices, 15% to 48% of a 2.67 ms block, where the sound alone
took 0.51 to 2.13 ms before its Math was made cheaper (2026-11-11). At
the default 16 voices the heaviest output, every effect slot taken, is
within the budget of a third of a block (0.89 ms); 24 voices just past
it, 32 within half. The browser's JIT runs it faster than the Node bench
does (1.04 ms for 16 voices), so the two are not compared.

### Mastering

Asked for by ashon, 2026-11-13, after the spectrogram looked nearly
full and the answer was that the mix had none of what a master is
checked with ("표시 대비도 조정 해 보자. 그리고 말처럼 마스터링 도구가
부족한데 추가해 줘"): three effect kinds, for an insert, a bus or the
master like the rest, and two readouts.

- **EQ**: a low cut (12 dB an octave, Butterworth, Off at its lowest),
  a low shelf, a broad bell (Q 0.7) and a high shelf, the cookbook's
  biquads (shelves at S = 1). A knob glides over about 20 ms, the bands
  worked out again each block while it does; a band at 0 dB and a cut
  that is Off cost nothing, so a flat EQ passes the sound untouched.
- **Compressor**: both sides' louder peak each sample, in dB, turned
  down above Threshold by Ratio over a 6 dB soft knee, the turn
  deepening over Attack and letting go over Release, then Makeup; Mix
  blends it with what came in, as every effect's Mix does, so half and
  half is parallel compression.
- **Limiter**: Gain drives the sound up, then it is held 2 ms
  (the lookahead, 95 samples at 48 kHz, which is what it delays by)
  while the gain each sample needs to stay under Ceiling is found: the
  least over the lookahead (a running minimum), averaged over as long
  again, so the gain is down by the time a peak arrives, in a slope,
  and comes back over Release. Nothing comes out past the Ceiling; a
  last clamp keeps rounding from passing it.
- **A limiter last on the master** takes the soft clip's place
  (`masterLimited`, `Mixer.setLimited`): the clip would bend what the
  limiter had already brought under its ceiling, so the output is only
  guarded at full scale. The master's Level comes after its effects
  and goes no higher than 100%, so it only lowers the ceiling with the
  rest. The master's meters then read the samples as they are, not
  through the clip's inverse. Anything after the limiter brings the
  clip back.
- **Gain reduction**: a compressor's or limiter's panel shows how far it
  turns the sound down, a bar growing from the right, 24 dB full, and
  the depth named (−3.2 dB): the audio thread keeps the deepest since it
  last told (`takeReduction`) and tells those watched 30 times a
  second while any turns down, once more as they let go
  (`watchReduction`, by the effect's id and, for an insert or a kit's
  chain, its track's).
- **On the tile**, asked for the same day ("컴프나 리미터 등이 걸릴
  때에 리덕션을 블럭에서도 볼 수 있게"), then as the whole tile
  filling ("전체 블록이 차오르는 느낌으로"): every compressor's and
  limiter's tile on screen, on an insert, the kit's chain, a bus or the
  master, has its ink rise over its face from the foot as it turns the
  sound down, to the top at 24 dB, a line in full ink on its surface,
  behind the label as a picture stands. Many are watched at once, one
  by its tile and its panel together: the page keeps who watches which
  (`src/engine/reductions.ts`) and tells the audio thread the list
  under a version; a report for a list since changed is dropped, so a
  tile added or gone never shows another's depth.
- **Loudness**: the worklet measures its whole output as ITU-R BS.1770
  does (`src/dsp/loudness.ts`): both sides K-weighted (libebur128's
  filters for any sample rate), in 100 ms steps; momentary over 400 ms,
  short-term over 3 s, and integrated since Play or Reset, gated (blocks
  under −70 LUFS left out, then those 10 LU under the rest; the blocks
  are kept as a histogram of 0.1 LU, so nothing grows over a long
  take). A 1 kHz sine at −20 dBFS on both sides reads −20.0 LUFS; 10 s
  at −20 then 10 s at −40 reads −20 integrated (−20.06, the blocks
  across the change counted, as the standard has them). Told ten times
  a second while the Master's panel or the sheet shows it, under −70 a
  dash.

The spectral views' **range**, the same day: how far under their top
(−10 dB) the spectrum and the spectrogram reach, 50, 70 or 90 dB, kept
on the device (`loopromeda.spectrumRange`), chosen beside the views in
the panel when one of them is shown, and in the sheet's header. 90 is
how they were, down to the analyser's floor, where a reverb's tail and
the window's skirts 70 dB under the mix filled the picture; 70, the
default, leaves out what a dense mix covers anyway; 50 shows only what
stands out. The choice went on 2026-11-14, when the spectrogram took
the colour scale (below) and ashon asked whether it was still needed
("스펙트로그램에 컬러링이 되었는데 그래서 50 70 90 데시벨 같은
기준선은 이제 없어도 되지 않나?"): the colours tell the levels apart
that the range was there to spread, so both views reach 70 dB under
their top, −80 dB, and the key kept on a device is left unread.

The spectrogram's **colour scale**, 2026-11-14, asked for by ashon
("스펙트로그램에서 데시벨 표현도 들어가야 하니 이 부분은 적절히
컬러링을 넣어보는것은 어떨까? 컬러 스케일을 하나 만들어 두면
좋겠네"; `src/viz/colourScale.ts`): from the views' background, for
−80 dB and under, through indigo, blue, teal and the app's emerald to
yellow and near white, for −10 dB. Each stop stands along it where its
lightness (OKLab's L) puts it, and it is mixed in OKLab between them, so
the lightness rises evenly with the level, the same step for every dB,
while the hue turns: a level reads by its colour as well as by how
light it is. Before, it was one hue, the background to emerald to
white, where −40 and −30 differed only in lightness. A table of 256
colours made once; a pixel's colour is a lookup. Its key, a bar of it
from −80 to −10 dB with a tick every 10 dB, stands in the panel's row
when the spectrogram is shown and at the lower left of the sheet's.

Measured (M3 Max, `pnpm bench`), a full rack of four: compressors
0.015 ms a block, EQs 0.009 (0.009 gliding), limiters 0.009; the
loudness 0.009, all the while. The stress rack stays the chorus and
the reverb, still the heaviest.

### Stereo

Asked for by ashon, 2026-11-13 ("스테레오 감을 추가할 때
더블링/듀얼패스/하스이펙트 등을 넣기도 하는데 이런 효과도 넣어볼 수
있을까?"): three more kinds, for an insert, a bus or the master like
the rest, listed after the reverb and before the mastering tools
(numbered after them, 6 to 8, so no session or preset reads its effects
as others).

- **Haas**: one side held back by Time, 1 to 40 ms, the other untouched,
  so the sound seems to come from the side heard first and to stand
  wider. Later picks the side; Mix blends that side's delay with
  itself, wholly late at 100%. The time glides over about 50 ms, so it
  turns without a click.
- **Doubler**, the dual path: each side its own copy a little apart,
  as a part played twice is. Each is a pitch shifter of two taps half a
  cycle apart on a 30 ms window, the left Detune cents up, the right as
  far down; each tap fades in over a tenth of its cycle and out over
  another while the other is whole, so the jump back is never heard.
  The right's least delay is half again the left's (Delay, 12 ms: 12
  and 18), so the two never line up. Spread at 100% puts each path on
  its side, at 0 both in the middle; Mix blends the pair with the dry.
- **Width**: the sound as what both sides share (mid) and what sets them
  apart (side), the side scaled by Width, 0 mono, 100% as it was, 200%
  twice as wide, the mid untouched; Mono Below takes the side away under
  its corner (a highpass of 12 dB an octave, Off at 20 Hz), so the lows
  stand in the middle whatever is wider above them.
- **In mono**, summed to one side as a phone's speaker or a club does,
  a Width changes nothing (the mid is all that is left), but a Haas or
  a doubler combs: a delay of 15 ms against the dry cuts notches
  66.7 Hz apart. Kept short and the Mix low, or on a bus that is not
  the only path, it holds up.

Measured (M3 Max, `pnpm bench`), a full rack of four: doublers 0.027 ms
a block (0.017 at the median), Haas delays 0.007, widths 0.005. The
stress rack stays the chorus and the reverb.

### What the output looks like

The engine taps the node's output (`src/engine/engine.ts`): a splitter
into an analyser per side (2048 samples), the two merged again into the
scope's analyser, then one for the spectrum (4096 bins, smoothing 0.7,
−100 to 0 dB) before the speakers. Since 2026-11-13, asked for by ashon
("사운드에서는 사운드 아웃풋이 시각화로 보이게 해 줘. 믹스에서는 전체
아웃풋에 대한 시각화. 믹스에서는 각 사운드 채널별로 시각화가 별도로"),
the node has an output for each part after the master's
(`PART_OUTPUTS`, one until the parts come): the part's own sound, after
its inserts and its fader and before its sends (what it gives the mix,
so that the strips' meters compare as their faders set them), unclipped,
copied there as the mixer
renders it (`Mixer.render`'s taps). Each is tapped as the master is and
reaches the speakers through a gain of 0, so that every browser renders
its analysers and none is heard twice. The Sound's Out and the Mix's
strip show the part's; the Mix's Master and the sheet the master's. A
part's meters read its levels as they are (`sampleLevels`), the
master's what went into the clip (`unclippedLevels`). Each output has
a view of its own, since 2026-11-13, asked for by ashon ("시각화
스타일이 각각 다르게 설정항 수 있으면 좋겠어"): the sound's (its Out and
its strip, one picture of one output) chosen in its panel, the
master's in the Master's, each kept in localStorage
(`loopromeda.partViews`, by part, `loopromeda.masterView`); a part with
none kept shows the master's. `OutputTap`
(`src/ui/frames.ts`), one for each output, reads them once a display
frame however many views draw it, since a second read of the spectrum
would smooth it twice. Checked in a frame with the sound's send to A at
0: a note held moves the Out's and the strip's views, the Master's not.
On the Fold (Chrome 157, the deployed site) the part's views and meter
move with its sound (ashon, 2026-11-13: "나머지도 잘 동작하네"), so
Chrome renders an analyser reached through a gain of 0; Safari on iOS
is still to try. The views
(`src/ui/MasterViews.tsx`, their math in `src/viz/master.ts`), each a
canvas drawn every frame while the audio runs:

- **Scope**: the waveform, as before.
- **Spectrum**: 20 Hz to 20 kHz on a logarithmic axis, its levels from
  −10 dB down to −80 (Mastering, above), filled under its line, a line
  of the peaks falling 18 dB a second over it. Below about a kilohertz
  a bin spans several columns, and the columns between bins
  read a monotone cubic through them (`levelAt`), round where straight
  lines cornered and never above a bin. A sine there shows the
  analyser's window (Blackman, fixed): a sidelobe each side about 60 dB
  under it, four bins off, a small hump apart from the peak at the low
  end, where the bins stand furthest apart.
- **Spectrogram**: the spectrum over time, scrolling 40 px a second,
  its levels on the colour scale (Mastering, above), a line across at
  each decade and a line down each second, drawn into the picture so
  that they scroll away with it (how long a tail rings is counted in
  them); in the sheet the decades and the colours are named, and where
  it is wider than 16rem the lines' second too.
- **Stereo**: a goniometer of the latest 1024 samples (mid up, side
  across) and the two sides' correlation, −1 to +1.
- **Meters**: each side's RMS and peak going into the clip, recovered
  from the clipped output (the clip's inverse), −60 to +6 dB, amber
  past 0 dB, where the clip is driven hard; the highest peak held is
  named. After a limiter last on the master, the output as it is. A part's is one bar, since 2026-11-13, asked for by ashon
  ("사운드의 경우 모노 악기일 수 있을텐데 볼륨 막대가 두개일 필요는
  없을 것 같아"): its peak the louder side's, its RMS the two sides'
  together, so that a mono sound reads as either side does; the
  master keeps its two.

### The editor

The rack's first switch shows the sound or the mix in the graph's place;
each keeps its tile picked, the panel follows, and both ask the card for
the same height, so the keys under them stay put.

- **Sound**: the inserts stand after the amp, item-sized and as tall as
  it; "+ FX" stands in the "+" row under them. The **Out** tile ends the
  row, filling what the rest leave of the frame: its name over the
  sends, a short bar for each bus in its colour, by its letter (across,
  two to a line for four), and under them the output's view and a
  sliver of meters, as a filter's picture stands under its name. A
  short Out (one slot) keeps them beside its name. The meters are as
  black as the views (their tracks a breath lighter): the sound's one
  bar 10 px wide in the Out and the strip, the master's two 14 in the
  Master. The Amp's line reads Env, since 2026-11-13 (ashon: "amp out
  보다 env 로 바꾸거나 없애도 좋겠네"): it read Out from before the Out
  tile, which left two Outs side by side.
- **Squares**, 2026-11-12, asked for by ashon ("In 블록 쪽 가로폭을 조금
  줄이고 앰프나 필터 부분은 최대한 정사각형"): a frame with room over
  the graph at rest gives it first to the items, the amp and its
  inserts, until each is as wide as it is tall; then the "+" and the out
  widen as before, up to twice, and the inputs and their sources only
  to one and a half times (102 px, was 136). A tile already wider than
  tall (a row of one slot) stays as it is, and a frame with no room
  (a phone held upright) keeps them as they were, so the graph pans no
  more than before (`src/viz/graph.ts`). Measured in frames, the
  sound's IN 1, Filter, Amp and Out: on a fold's 948 × 579 102 × 62,
  130 × 130, 130 × 130, 192 × 130 (were 136, 120 and 104 wide), at
  1000 × 600 140 squares, at 844 × 390 a 94 square filter, a 115 amp;
  at 454 × 622 part of the way (82 × 94, 79 × 94).
- **Mix** (`src/viz/mixGraph.ts`): the sound's strip (Synth) at the left,
  as tall as the buses beside it (two rows at least), under its name,
  its fader's level and its sends the sound's own view and meter, as
  the Out has them (the strips since 2026-11-13 as below); each bus a
  row, as a chain is, in its letter's colour (the chains' colours, A
  orange, B violet, C lime, D pink, so that a letter wears one colour in
  either view): a head with its letter and level, its effects after it
  and a "+" filling the row to the longest; then the master's effects,
  as tall as the strip, and the **Master**, which fills the rest with
  its name over the output's view and wider meters. Under the rows
  "+ Bus" (until every letter has one), and "+ FX" under the master's
  effects. Since 2026-11-14 threads join them, as they join a sound's
  tiles (`sound-chains.md`, Threads): from each track's strip, a hole for
  each bus it sends to down its right edge in their order, to each bus's
  head, as thick as its send. At first only the track played had them,
  and a send of nothing showed faintly; ashon asked the same day for
  those to go and for every track's to show ("믹스에서는 샌드가 0인것은
  안보여도 좋을 것 같고 다른 인풋이 어디랑 연결되어있는지 잘 보이면
  좋겠어"). Threads from many strips into a few heads would tangle in
  one seam, so each bus has a lane of its own down it, 4 px from the
  next, the bus whose threads reach furthest nearest the strips. A
  thread bends about its bus's lane as a sound's threads bend across
  their seam, an S of two cubic Béziers, each half leaving its hole level
  and turning over half the height, but with its middle upright on the
  lane, so that threads into one bus run down its lane together and
  apart from another's ("믹스에서도 꺾인선보다 곡선으로"; drawn first as
  a run down the lane with turns no rounder than the seam's width, they
  still read as corners: "베지어 기반으로 잘 조정해 봐"). Along each
  bus's row a thread runs over its "+", into the master's first effect
  or the master at the row's own middle, the last run as thick as the
  bus's level, and on through the master's effects. They replace a peg
  on the seam to each bus, as long as its send, and a bus down the seam
  after the rows with each bus's level a peg on it. The seam between the
  strips and the heads is 12 px (was 4), 16 with four buses for their
  lanes; on a 412 px phone the mix of icons below is 389 px (393 with
  four buses), in a frame of 396. A bus's head lights its threads, every
  track's into it and its row's, and dims the other buses'; a strip
  picked lights its threads and dims the other tracks'; a thread tapped
  plays its track and picks its bus. Every strip's view and the Master's
  stand clear of their holes.
- **Icons**, 2026-11-13, asked for by ashon ("작은 모바일 화면에서
  믹스에서 코러스 딜레이 리버브 이런 부분들을 아이콘으로 만들고 사각형
  블록으로"): a frame narrower than the mix at rest makes every effect
  in it, on a bus or the master, a block of its pictogram alone, 44 px
  wide (a touch's width; as tall as its row), its name left to the
  label for the ear and to its panel. Nothing widens then, and the
  master takes what is left. On a 412 px phone (a frame of 396) two
  effects on a row and the Master now fit, where the mix was 413 wide
  and panned; three or more on a row still pan. A frame wide enough for
  the tiles at rest names them again.
- **Panels**: the Out and the strip open the same panel (named Out in
  the Sound, Synth in the Mix): the strip's fader, Level and Balance, the
  mix's, first, then a send to each bus, the sound's, and the view of
  the sound's output; a bus's
  panel holds the sound's send to it, its level and its balance, and
  removes it; an effect's its knobs, and moves it along its row or
  removes it; "+ Bus" adds a bus after the last, dry or with a first
  effect; a
  row's "+" an effect at its end (more than four kinds stand three to
  a row); the Master's its level, the loudness, the views,
  and a button that opens them all at size (#/master,
  `src/ui/MasterSheet.tsx`) over the editor, the keys left playable
  under them: the spectrum over the spectrogram and the stereo, the
  meters at the right. Where the views are at least two and a half
  times as wide as tall (a phone or a fold on its side, asked for by
  ashon: "폴드 넓은 화면에서는 스테레오가 우측에 더 크게"), the stereo
  stands beside them instead, a square as tall as both: 185 px on a
  fold's 833 × 510, 125 on a phone's 844 × 390, where it was 88 and 58.

### Factory presets

Pads, plucks and keys send to the session's delay and reverb, on B and
C since the buses, a few through a chorus of their own: Warm Pad and Strings a chorus and the reverb; PWM,
Glass, Choir and Breath Pad, Kalimba, Marimba, FM Bell, Vibes, Clap,
Riser and Wind the reverb; E-Piano and Organ a chorus alone; Saw Lead
the delay; Blips the delay, and Soft Pluck the delay and the reverb.
The delay is the session's now, so Blips' and Soft Pluck's echoes are
stereo or ping-pong as the session's delay is, no longer as the preset
had it. Each, through the default mix, stays under the clip and has
rung out ten seconds after the key (`src/state/factory.test.ts`).

### Later

A delay's time in beats once the sequencer has a tempo; more effect
kinds (a phaser; the EQ and the compressor came, 2026-11-13); an EQ's
curve and a compressor's on its tile; a compressor keyed by another
sound (side-chain); true peak in the meters (the limiter holds the
samples, not what lies between them); a picture on an effect's tile;
dragging an effect to move it, along its row or to another, as an item
is dragged; a bus fed by another (a delay into the reverb's bus) rather
than in a row.

## 2. Parts and the kit

Under way since 2026-11-13, asked for by ashon before the sequencer
("2단계 먼저 진행하면 될 것 같아"): the kit plays, maps presets onto its
pads and is kept in the session. Still to do: the kit as its own preset kind (a kit
file, saved and loaded whole), and a hat's choke.

### The kit

- **Sixteen pads** (`src/state/kit.ts`), each a preset mapped onto it,
  any of them, played as it is up to its amp (inputs, chains,
  modulators, routes), its name the preset's or its place's (Pad 1). A
  pad's sound keeps the inserts and sends its preset has, as any sound
  does, but in the kit they go unheard: the kit's chain stands in their
  place (below). The session keeps the pads beside the synth's sound
  (`loopromeda.kit`, version 1: each pad's preset and its sound as last
  played, and the kit's chain), a pad read as a preset file is, so a
  bad one reads as what can be made of it. The part played and the pad
  picked are the device's (`loopromeda.part`).
- **Mapped, not edited**, chosen by ashon 2026-11-13. Asked first
  whether the kit could be the user's to edit ("여러 보이싱들을 키트에
  매핑하고 쓸 수 있으면 좋을 것 같거든. 다만 이 키트에서는 별도 체인
  구성은 하지 않도록"), ashon chose, of the readings put to them, the
  pads mapping presets alone ("패드에선 매핑만"), and a pad following its
  preset ("따라 바뀜 (참조)"). A sound is made in the synth and saved as
  a preset; the kit maps presets onto its pads and edits nothing of
  their sounds, only its own chain. A pad refers to its preset: saved
  over in the synth, the preset plays anew on every pad it is mapped
  onto, and a reload maps each pad again as its preset is then (a new
  version's factory preset too); a preset renamed is renamed on its
  pads, one deleted leaves its pads the sound they had, of no preset.
  The pads as first built were copies, each edited in the kit and saved
  as a preset of its own.
- **The factory kit** (`FACTORY_KIT`, `src/state/factory.ts`), the
  bottom row first: Kick, Snare, Closed Hat, Open Hat, Low Tom, Tom,
  High Tom, Clap; then Rim, Cowbell, Shaker, Crash, Boom, Conga, Clave
  and Zap. Eight are new Drums presets (Low Tom, High Tom, Rim, Shaker,
  Crash, Boom, Conga, Clave), under the clip and rung out as every
  preset is (`factory.test.ts`). A session with no kit kept starts with
  it; a kit kept stays as it was.
- **One chain for the kit**, chosen by ashon 2026-11-13 ("킷 안에 개별
  사운드마다 믹서 체인을 다르게 해야하던데.. 이 부분은 하나로 관리하게
  할 수는 없을까?"): the pads, each up to its amp, are summed, then go
  through the kit's inserts (up to four), its fader (a level and a
  balance) and its sends, the same whichever pad is picked, as a desk's
  group or a drum bus. The inserts and the sends are the kit's chain
  (`KitChain`), kept with the kit (`loopromeda.kit`, and with a kit
  file when there is one), as a sound keeps its own with its preset;
  the fader is the mix's, as the synth's is. A bus removed moves the
  kit's sends up a letter, as it does the synth's.
- **In the Sound view, not the Mix**, asked by ashon the same day ("키트
  디자인 부분을 사운드 채널 안으로 다 넣는건 어떨까"), the shape
  recommended chosen ("권장안으로"): the chain stood first on the kit's
  strip in the Mix, a row of inserts after it as a bus's, which widened
  the synth's strip and moved every bus along. The synth's chain is in
  its sound; the kit is an instrument as much, so its chain stands in
  its sound's place and travels with the kit. Pads lost their own
  inserts with it: none of the factory kit's had any, and two rows of
  FX after a pad's amp, its own and the kit's, read as one too many. A
  pad's own sends were the first build's, before either: ashon found
  each pad wanting its mix set apart.
- **A pad is gated**: a touch strikes its sound at C4 (`PAD_NOTE`) and
  lifting the finger releases it, so a pad held sustains as a key held
  does; the touch's place on the pad gives its velocity, and moving the
  finger up or down its Slide, as on the Pads surface.

### The audio thread

- The worklet plays **two parts**, the synth and the kit, into the one
  mixer, in the mix's order (`PARTS`, `src/state/mix.ts`), its outputs
  after the master each part's own sound, for its views. The kit is a
  group (`Part` with inserts, `src/dsp/output.ts`): its strips summed
  into one block, which goes once through the kit's chain's inserts,
  its fader and its sends. A pad's player holds its synth alone, so its
  sound's own inserts are never set (`src/worklet/processor.ts`); the
  chain comes whole on each change (`kitChain`, `protocol.ts`). A strip
  silent (no voice sounding, its inserts at rest) is passed over, its
  synth still stepped so its LFOs run on; so is the kit's sum when no
  pad sounds and its inserts rest.
- **Each pad is a ChainSynth of its own**, of four voices
  (`PAD_VOICES`): a hit rarely overlaps more than a few of its own, and
  a fifth steals the oldest; the pads' state never mixes. A note, a
  Slide, a sound or a knob names its pad (`protocol.ts`); the wheel
  turns every sound's, panic silences both parts.
- **Measured** (M3 Max, `pnpm bench`, `src/state/kit.bench.ts`), one
  128-frame block of the whole mix: the factory kit, every pad's four
  voices sounding, summed through the kit's chain, 0.27 ms, a quarter
  of the heaviest output at 16 voices (1.01 ms); the kit at rest 0.002 ms. By that ratio about
  0.2 ms on the Fold, not measured there: Measure CPU does not time the
  kit yet.

### The surface and the editor

The two fixed parts became tracks on 2026-11-13 (`tracks-and-song.md`,
B): the Part switch below is now the track's button and its popover
(`src/ui/TrackPicker.tsx`), and the Mix holds a strip for each track,
84 px wide at rest. What follows is as it was built before that.

- **The Part switch** (`src/ui/PartSwitch.tsx`), Synth | Kit, at the
  left of the keyboard's header before the patch. In a header under
  26rem only the part chosen stands, and a tap on it switches; the
  patch's chevron goes there, its room the name's. At 360 px the patch
  reads four or five letters, as before the switch it read eight or
  nine; at 320 px none.
- **With Kit** the surface is the kit's 16 pads (`src/ui/KitPads.tsx`),
  laid out by `kitGrid` (`src/viz/pads.ts`) as the grid of the most
  square pads: 8 × 2 in a window 730 px wide, 4 × 4 at 360. A tap
  plays a pad and picks it, ringed, its preset the patch's and the
  panel's. The octave buttons and the surface's picker go; the mod
  wheel stays, turning every pad's routes from it, its Route dimmed:
  routes are a sound's, made in the synth. Computer keys A to ; and Q
  to Y play them.
- **The editor** shows the part played: the synth's sound, or with Kit
  the kit in its place (`KitGraph`, laid out by `src/viz/kitGraph.ts`):
  the 16 pads in a block, four by four as the surface stands them, each
  its preset's name, then the kit's chain, its FX, their "+" and the
  Kit Out holding the kit's output, whose panels say they are the kit's
  (Kit Chorus, on the kit, after every pad's amp). The rack holds only
  the Sound | Mix switch and a line saying a pad plays a preset as it
  is. A pad's tile picks that pad; its panel names its preset and maps
  another with a tap, from a row of its category's presets (the Drums
  for a pad of none), or from all of them, the presets' popover, which
  then says it maps onto the pad and has no Save. Under the editor the
  engine takes only the chain of an edit made with a pad picked
  (`kitChainOf`, through `setSound`): a pad's sound is its preset's.
  The Mix stands the two parts' strips one over the other (Synth, Kit)
  at the left of the buses, faders alone, each with its own view and
  meter; each shows its sends by its threads (Mix, above). Tapping the
  other one plays it.
- **The strips' views**, 2026-11-13, asked for by ashon ("믹스
  탭에서도 신스나 키트 부분에 시각화가 하단에 올 수 있게"): two strips
  in the column of two rows were 44 px each, too short for a view under
  the name, so it stood beside it, a sliver 10 px wide on a phone. The
  strips now go on down the "+" row under the buses, where nothing
  stood (no "+" there: "+ Bus" starts at the heads), so the mix asks
  the frame for no more height; and each strip's name and level share
  one line (`Tile`'s `inline`), its view and meter under them, as the
  Master's are. At rest with one or two buses each strip is 72 × 62;
  measured in a frame 412 × 640, a strip 72 × 67, its view 52 × 40 (was
  10 wide); in one 900 × 600, 108 × 106, its view 88 × 79. The played
  strip's bars of its sends went, the pegs (now the threads) showing
  them, for the view to have the room.

## 3. The sequencer

Not started, and revised on 2026-11-13 by `tracks-and-song.md` (D and
E): a sequence for each track, and a song of them. What it needs:

- **The clock on the audio thread** (the audio thread owns time): the
  worklet steps through the pattern at the tempo, with swing, and plays
  each step's notes on the kit and the synth itself, sample-accurate,
  the main thread only sending the pattern and the transport.
- **A pattern**: 16 to 64 steps; 16 kit lanes, each step on or off with
  a velocity; one synth track, each step a note, a length and a
  velocity. Kept in the session.
- **The Seq surface**: the grid, the transport (play, stop) and the
  tempo in its header, the step playing lit as it passes (reported back
  as the glides are).
