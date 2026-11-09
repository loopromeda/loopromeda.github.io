/** MIDI note number of A4, the tuning reference */
export const A4_NOTE = 69

/**
 * Equal-tempered frequency in Hz of a MIDI note number, with A4 tuned to
 * `a4` Hz. Fractional notes give the pitches in between (detune, bends).
 */
export function midiToFrequency(note: number, a4 = 440): number {
  return a4 * 2 ** ((note - A4_NOTE) / 12)
}
