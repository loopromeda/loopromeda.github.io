import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'
import { KNOB_ROW } from './controls'
import { Knob } from './Knob'

const KNOBS: readonly ParamId[] = ['voice.mode', 'voice.glide', 'amp.velocity']

/**
 * How notes are played: Poly (a voice each), Mono or Legato (one voice;
 * Legato keeps the envelopes going under a held note), the glide from one
 * note's pitch to the next, and how far velocity sets loudness. How many
 * voices the phone plays at once is a setting, not part of the sound.
 */
export function VoicePanel({ engine }: { engine: Engine }) {
  return (
    <section
      aria-labelledby="voice-heading"
      className="flex h-full flex-col rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <h2
        id="voice-heading"
        className="mb-2 flex h-7 items-center text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
      >
        Voice
      </h2>
      <p className="text-[11px] leading-snug text-zinc-500">
        Lower on a key or a pad plays louder, unless Settings plays every note
        at full velocity. A finger held and slid up or down drives Slide, a
        source on the MOD tab.
      </p>
      <div className={`${KNOB_ROW} grid-cols-4`}>
        {KNOBS.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
  )
}
