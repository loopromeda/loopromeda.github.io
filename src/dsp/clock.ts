/**
 * The song's time as what follows the tempo reads it: a synced delay's
 * time, a synced LFO's rate and, while the song plays, its phase
 * (docs/plan/effects-parts-sequencer.md, Synced). The sequencer
 * (sequencer.ts) keeps it, the tempo as set and the beat at the start of
 * each block; the synths and racks that follow it hold the same one.
 * Allocates nothing.
 */
export class Clock {
  /** Beats a minute */
  tempo = 120
  /**
   * Where the song is at the start of the block being rendered, in beats
   * from its first: NaN while it is stopped or counting in
   */
  beats = Number.NaN

  /**
   * How long a note value lasts at the tempo, in seconds: wholes in whole
   * notes, a bar of 4/4 being one
   */
  seconds(wholes: number): number {
    return (wholes * 240) / this.tempo
  }

  /** How many times a second a note value comes round at the tempo */
  hertz(wholes: number): number {
    return this.tempo / (wholes * 240)
  }
}
