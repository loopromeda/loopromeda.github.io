import { describe, expect, it } from 'vitest'
import {
  MASTER,
  MIX_KEY,
  addBus,
  addMixEffect,
  busName,
  findMixPart,
  fitStrips,
  initMix,
  loadMix,
  mixValue,
  moveMixEffect,
  moveStrip,
  ownedBy,
  readMix,
  removeMixPart,
  removeStrip,
  saveMix,
  setMixValue,
  setStripMute,
  setStripSolo,
  stripHeard,
  stripId,
  stripState,
  type Mix,
  type MixStorage,
} from './mix'
import { MAX_BUSES, MAX_EFFECTS } from './sound/kinds'

/** A storage in a Map, or one whose every call throws */
function storage(broken = false): MixStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem(key) {
      if (broken) throw new Error('refused')
      return map.get(key) ?? null
    },
    setItem(key, value) {
      if (broken) throw new Error('refused')
      map.set(key, value)
    },
  }
}

/** Each bus by letter, its effects by kind */
function shape(mix: Mix): string[] {
  return [
    ...mix.buses.map(
      (bus) => `${bus.id}:${bus.effects.map((e) => e.kind).join('+')}`
    ),
    `master:${mix.master.effects.map((e) => e.kind).join('+')}`,
  ]
}

describe('the mix', () => {
  it('starts as the mix before buses sounded: dry, a delay, a reverb', () => {
    const mix = initMix()
    expect(shape(mix)).toEqual(['a:', 'b:delay', 'c:reverb', 'master:'])
    // Each at full, in the middle
    expect(mix.buses.map((bus) => bus.values)).toEqual([
      { level: 1, pan: 0 },
      { level: 1, pan: 0 },
      { level: 1, pan: 0 },
    ])
    // Wet only, as the returns were
    expect(mix.buses[1]?.effects[0]).toEqual({
      id: 'e1',
      kind: 'delay',
      values: { time: 0.35, feedback: 0.4, tone: 0.6, mode: 0, mix: 1 },
    })
    expect(mix.buses[2]?.effects[0]?.values).toEqual({
      size: 0.6,
      decay: 2,
      damp: 0.5,
      mix: 1,
    })
    expect(mix.master).toEqual({ effects: [], values: { level: 1 } })
    expect(mix.buses.map(busName)).toEqual(['Dry', 'Delay', 'Reverb'])
  })

  it('finds its parts by id: a bus by letter, an effect, the master', () => {
    const mix = initMix()
    expect(findMixPart(mix, 'b')).toMatchObject({ type: 'bus', index: 1 })
    expect(findMixPart(mix, 'e2')).toMatchObject({
      type: 'effect',
      owner: 'c',
      index: 0,
    })
    expect(findMixPart(mix, MASTER)?.type).toBe('master')
    expect(findMixPart(mix, 'd')).toBeUndefined()
    expect(findMixPart(mix, 'amp')).toBeUndefined()
  })

  it('has a strip for each part, at full in the middle, kept', () => {
    const mix = initMix()
    const whole = { values: { level: 1, pan: 0 } }
    // The synth's and the kit's, faders alone: the kit's chain is the
    // kit's own (src/state/kit.ts)
    expect(mix.strips).toEqual([whole, whole])
    expect(stripId(0)).toBe('p1')
    expect(stripId(1)).toBe('p2')
    expect(findMixPart(mix, 'p1')).toMatchObject({ type: 'strip', index: 0 })
    expect(findMixPart(mix, 'p2')).toMatchObject({ type: 'strip', index: 1 })
    expect(findMixPart(mix, 'p3')).toBeUndefined()
    const quieter = setMixValue(mix, 'p1', 'level', 0.5)
    expect(mixValue(quieter, 'p1', 'level')).toBe(0.5)
    expect(quieter.buses).toBe(mix.buses)
    expect(mixValue(setMixValue(mix, 'p1', 'pan', -3), 'p1', 'pan')).toBe(-1)
    expect(setMixValue(mix, 'p1', 'level', 1)).toBe(mix)
    // Never removed: a part's strip is there as long as the part is
    expect(removeMixPart(quieter, 'p1')).toBe(quieter)
    // Kept: read back as it was, clamped; one kept before strips at full
    expect(readMix(JSON.parse(JSON.stringify(quieter))).strips).toEqual(
      quieter.strips
    )
    const odd = readMix({
      buses: [],
      strips: [{ values: { level: 4, pan: 'left' } }, { values: {} }],
    })
    expect(odd.strips).toEqual([whole, whole])
    expect(readMix({ buses: [] }).strips).toEqual(initMix().strips)
    expect(readMix({ version: 1 }).strips).toEqual(initMix().strips)
  })

  it('has no effects but on the buses and the master', () => {
    const mix = initMix()
    // A strip has no row of its own, nor sends
    expect(ownedBy(mix, 'p2')).toBeUndefined()
    expect(setMixValue(mix, 'p2', 'c', 0.4)).toBe(mix)
    // A kit strip kept with inserts and sends (as one briefly was) reads
    // as its fader alone
    const kept = readMix({
      ...mix,
      strips: [
        {},
        {
          values: { level: 0.5, a: 0.2 },
          effects: [{ id: 'e7', kind: 'chorus' }],
        },
      ],
    })
    expect(kept.strips[1]).toEqual({ values: { level: 0.5, pan: 0 } })
    expect(findMixPart(kept, 'e7')).toBeUndefined()
  })

  it('keeps a strip for each track, by place', () => {
    const mix = setMixValue(initMix(), 'p2', 'level', 0.5)
    expect(fitStrips(mix, 2)).toBe(mix)
    const more = fitStrips(mix, 4)
    expect(more.strips).toHaveLength(4)
    expect(more.strips[1]).toBe(mix.strips[1])
    expect(mixValue(more, 'p4', 'level')).toBe(1)
    expect(fitStrips(more, 1).strips).toEqual([mix.strips[0]])
    // A track moved takes its strip along; one removed, its strip with it
    const moved = moveStrip(more, 1, 3)
    expect(moved.strips.map((strip) => strip.values.level)).toEqual([
      1, 1, 1, 0.5,
    ])
    expect(moveStrip(more, 1, 1)).toBe(more)
    expect(moveStrip(more, 9, 0)).toBe(more)
    const fewer = removeStrip(moved, 0)
    expect(fewer.strips).toHaveLength(3)
    expect(mixValue(fewer, 'p3', 'level')).toBe(0.5)
    expect(removeStrip(fewer, 7)).toBe(fewer)
    // Kept with as many strips as there were tracks
    expect(readMix(JSON.parse(JSON.stringify(more))).strips).toHaveLength(4)
  })

  it('mutes a strip, and solos one: the rest silent', () => {
    const mix = fitStrips(initMix(), 3)
    const states = (of: Mix) => of.strips.map((_strip, k) => stripState(of, k))
    const heard = (of: Mix) => of.strips.map((_strip, k) => stripHeard(of, k))
    expect(states(mix)).toEqual(['on', 'on', 'on'])
    const muted = setStripMute(mix, 1, true)
    expect(states(muted)).toEqual(['on', 'mute', 'on'])
    expect(heard(muted)).toEqual([true, false, true])
    expect(muted.strips[0]).toBe(mix.strips[0])
    const soloed = setStripSolo(mix, 2, true)
    expect(states(soloed)).toEqual(['off', 'off', 'solo'])
    expect(heard(soloed)).toEqual([false, false, true])
    // Two soloed are both heard
    const both = setStripSolo(soloed, 0, true)
    expect(states(both)).toEqual(['solo', 'off', 'solo'])
    // A strip muted is muted, soloed or not; the rest stay silent for it
    const mutedSolo = setStripMute(soloed, 2, true)
    expect(states(mutedSolo)).toEqual(['off', 'off', 'mute'])
    expect(heard(mutedSolo)).toEqual([false, false, false])
    // No strip there: heard, and nothing to set
    expect(stripState(soloed, 7)).toBe('on')
    expect(stripHeard(soloed, 7)).toBe(true)
    expect(setStripMute(mix, 7, true)).toBe(mix)
    expect(setStripSolo(mix, -1, true)).toBe(mix)
  })

  it('is the same mix where a strip is muted or soloed so already', () => {
    const mix = fitStrips(initMix(), 2)
    expect(setStripMute(mix, 0, false)).toBe(mix)
    expect(setStripSolo(mix, 0, false)).toBe(mix)
    const muted = setStripMute(mix, 0, true)
    expect(setStripMute(muted, 0, true)).toBe(muted)
    // Off again leaves no trace: the strip as it was, key for key
    const back = setStripMute(setStripSolo(muted, 0, true), 0, false)
    expect(back.strips[0]).toEqual({ ...mix.strips[0], solo: true })
    expect(setStripSolo(back, 0, false)).toEqual(mix)
    expect(Object.keys(setStripSolo(back, 0, false).strips[0] ?? {})).toEqual([
      'values',
    ])
  })

  it('keeps a strip muted or soloed as its fader moves and it does', () => {
    let mix = setStripMute(fitStrips(initMix(), 3), 1, true)
    mix = setStripSolo(mix, 2, true)
    const faded = setMixValue(mix, 'p2', 'level', 0.3)
    expect(faded.strips[1]).toEqual({
      values: { level: 0.3, pan: 0 },
      mute: true,
    })
    const moved = moveStrip(faded, 1, 0)
    expect(moved.strips.map((_strip, k) => stripState(moved, k))).toEqual([
      'mute',
      'off',
      'solo',
    ])
    // The soloed track removed, the others are heard again
    const fewer = removeStrip(moved, 2)
    expect(stripState(fewer, 1)).toBe('on')
    expect(fitStrips(fewer, 4).strips[0]).toBe(moved.strips[0])
    // Kept, and read back; anything but true is not a flag
    expect(readMix(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
    const odd = readMix({
      ...moved,
      strips: [{ mute: 1, solo: 'yes' }, { mute: false }, { solo: true }],
    })
    expect(odd.strips).toEqual([
      { values: { level: 1, pan: 0 } },
      { values: { level: 1, pan: 0 } },
      { values: { level: 1, pan: 0 }, solo: true },
    ])
  })

  it('sets a knob clamped, and is the same mix when nothing changes', () => {
    const mix = initMix()
    const longer = setMixValue(mix, 'e1', 'time', 9)
    expect(mixValue(longer, 'e1', 'time')).toBe(2)
    expect(longer.buses[2]).toBe(mix.buses[2])
    expect(mixValue(mix, 'e1', 'time')).toBe(0.35)
    expect(setMixValue(mix, 'e1', 'time', 0.35)).toBe(mix)
    expect(setMixValue(mix, 'master', 'nothing', 1)).toBe(mix)
    expect(setMixValue(mix, 'master', 'level', Number.NaN)).toBe(mix)
    expect(setMixValue(mix, 'd', 'level', 0.5)).toBe(mix)
    expect(mixValue(setMixValue(mix, 'e1', 'mode', 0.8), 'e1', 'mode')).toBe(1)
    expect(mixValue(setMixValue(mix, 'b', 'level', 0.5), 'b', 'level')).toBe(
      0.5
    )
    const master = setMixValue(mix, MASTER, 'level', 0.25)
    expect(master.master.values.level).toBe(0.25)
  })

  it('letters the buses by their place: one removed, the rest move up', () => {
    const mix = initMix()
    const gone = removeMixPart(mix, 'a')
    // B's delay is A's now, C's reverb B's; their effects keep their ids
    expect(shape(gone)).toEqual(['a:delay', 'b:reverb', 'master:'])
    expect(findMixPart(gone, 'e2')).toMatchObject({ owner: 'b' })
    expect(gone.buses[0]?.values).toBe(mix.buses[1]?.values)
    // Those before it stay as they were
    const middle = removeMixPart(mix, 'b')
    expect(shape(middle)).toEqual(['a:', 'b:reverb', 'master:'])
    expect(middle.buses[0]).toBe(mix.buses[0])
  })

  it('adds buses after the last, on the next letter, up to four', () => {
    const one = removeMixPart(initMix(), 'b')
    const added = addBus(one)
    expect(added.id).toBe('c')
    expect(shape(added.mix)).toEqual(['a:', 'b:reverb', 'c:', 'master:'])
    let full = initMix()
    for (let k = 0; k < MAX_BUSES; k++) full = addBus(full).mix
    expect(full.buses.map((bus) => bus.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(addBus(full)).toEqual({ mix: full, id: null })
  })

  it('adds effects to a row, each at its defaults', () => {
    const mix = initMix()
    const room = addMixEffect(mix, 'b', 'reverb')
    expect(room.id).toBe('e3')
    expect(shape(room.mix)[1]).toBe('b:delay+reverb')
    // As an insert's: some of it, the rest dry
    expect(mixValue(room.mix, 'e3', 'mix')).toBe(0.3)
    expect(busName(room.mix.buses[1] ?? mix.buses[0]!)).toBe('Delay +1')
    const chorus = addMixEffect(mix, 'a', 'chorus')
    expect(mixValue(chorus.mix, chorus.id ?? '', 'mix')).toBe(0.5)
    const master = addMixEffect(mix, MASTER, 'reverb')
    expect(master.mix.master.effects[0]?.values.mix).toBe(0.3)
    // A row full, or a bus not there: nothing
    let full = mix
    for (let k = 0; k < MAX_EFFECTS; k++) {
      full = addMixEffect(full, MASTER, 'delay').mix
    }
    expect(addMixEffect(full, MASTER, 'delay')).toEqual({ mix: full, id: null })
    expect(addMixEffect(mix, 'd', 'delay')).toEqual({ mix, id: null })
    // A free id, never one in use elsewhere in the mix
    const freed = removeMixPart(mix, 'e1')
    expect(addMixEffect(freed, 'c', 'chorus').id).toBe('e1')
  })

  it('moves and removes effects; a bus goes with its own', () => {
    const two = addMixEffect(initMix(), 'b', 'reverb').mix
    const moved = moveMixEffect(two, 'e3', 0)
    expect(shape(moved)[1]).toBe('b:reverb+delay')
    expect(moveMixEffect(two, 'e3', 2)).toBe(two)
    expect(moveMixEffect(two, 'b', 0)).toBe(two)
    expect(shape(removeMixPart(two, 'e1'))[1]).toBe('b:reverb')
    const gone = removeMixPart(two, 'b')
    expect(findMixPart(gone, 'e3')).toBeUndefined()
    expect(shape(gone)).toEqual(['a:', 'b:reverb', 'master:'])
    expect(removeMixPart(two, MASTER)).toBe(two)
    expect(removeMixPart(two, 'nothing')).toBe(two)
  })

  it('reads what storage held, a default for what is missing or wrong', () => {
    const mix = readMix({
      version: 2,
      buses: [
        { id: 'c', effects: [{ id: 'e7', kind: 'reverb', values: {} }] },
        { id: 'a', values: { level: 3, pan: -4 } },
        { id: 'a' },
        { id: 'x' },
        {
          id: 'b',
          effects: [
            { id: 'e7', kind: 'delay', values: { time: 0.5, nope: 1 } },
            { kind: 'flanger' },
            { id: 'bad id', kind: 'chorus' },
          ],
        },
      ],
      master: { values: { level: 'loud' }, effects: 'none' },
    })
    expect(shape(mix)).toEqual(['a:', 'b:delay+chorus', 'c:reverb', 'master:'])
    expect(mix.buses[0]?.values).toEqual({ level: 1, pan: -1 })
    // The ids repeated or not an effect's get the next free ones
    expect(mix.buses[2]?.effects[0]?.id).toBe('e7')
    expect(mix.buses[1]?.effects.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(mix.buses[1]?.effects[0]?.values).toMatchObject({ time: 0.5 })
    expect(mix.master.values).toEqual({ level: 1 })
    expect(readMix({ buses: [] }).buses).toEqual([])
    // Letters missing between: those after move up, as on a removal
    const gap = readMix({ version: 2, buses: [{ id: 'a' }, { id: 'c' }] })
    expect(gap.buses.map((bus) => bus.id)).toEqual(['a', 'b'])
  })

  it('reads a mix kept before buses as the buses that sound as it did', () => {
    const mix = readMix({
      version: 1,
      delay: { time: 0.5, feedback: 'loud', level: 0.4, strange: 3 },
      reverb: { decay: 50 },
      master: { level: 0.5 },
    })
    expect(shape(mix)).toEqual(['a:', 'b:delay', 'c:reverb', 'master:'])
    expect(mixValue(mix, 'e1', 'time')).toBe(0.5)
    expect(mixValue(mix, 'e1', 'feedback')).toBe(0.4)
    expect(mixValue(mix, 'e1', 'mix')).toBe(1)
    expect(mixValue(mix, 'b', 'level')).toBe(0.4)
    expect(mixValue(mix, 'e2', 'decay')).toBe(10)
    expect(mixValue(mix, 'c', 'level')).toBe(1)
    expect(mix.master.values.level).toBe(0.5)
    expect(readMix(null)).toEqual(initMix())
    expect(readMix([1, 2])).toEqual(initMix())
  })

  it('is kept in storage and read back', () => {
    const kept = storage()
    const mix = addMixEffect(
      setMixValue(initMix(), 'e2', 'size', 0.9),
      MASTER,
      'chorus'
    ).mix
    saveMix(kept, mix)
    expect(JSON.parse(kept.map.get(MIX_KEY) ?? '')).toMatchObject({
      version: 2,
      buses: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    })
    expect(loadMix(kept)).toEqual(mix)
  })

  it('falls back to the defaults when storage fails or holds nonsense', () => {
    expect(loadMix(undefined)).toEqual(initMix())
    expect(loadMix(storage(true))).toEqual(initMix())
    expect(() => saveMix(storage(true), initMix())).not.toThrow()
    const kept = storage()
    kept.map.set(MIX_KEY, '{not json')
    expect(loadMix(kept)).toEqual(initMix())
  })
})
