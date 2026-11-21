import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { factoryPreset, kitSession, presetSession } from './phrase.ts'
import {
  loopSeconds,
  onlyTracks,
  render,
  withoutBuses,
  withoutMasterEffects,
} from './render.ts'
import { wavFile } from './wav.ts'

const saw = factoryPreset('saw bass')!

describe('render', () => {
  it('plays a preset through the audio thread', async () => {
    const out = await render(presetSession(saw), { seconds: 1 })
    expect(out.seconds).toBeCloseTo(1, 2)
    expect(out.left.length).toBe(out.right.length)
    expect(out.peak).toBeGreaterThan(0.01)
    expect(out.peak).toBeLessThan(1)
    expect(Number.isFinite(out.lufs)).toBe(true)
    expect(out.tracks).toEqual([expect.objectContaining({ name: 'Saw Bass' })])
    expect(out.tracks[0]!.rms).toBeGreaterThan(0)
  })

  it('is silent with every track muted', async () => {
    const out = await render(onlyTracks(presetSession(saw), []), {
      seconds: 0.5,
    })
    expect(out.peak).toBe(0)
  })

  it('plays the factory kit, a pad a beat', async () => {
    const kit = kitSession()
    expect(kit.tracks[0]!.kind).toBe('kit')
    const out = await render(kit, { seconds: 1 })
    expect(out.peak).toBeGreaterThan(0.01)
  })
})

describe('the session helpers', () => {
  const session = presetSession(saw)

  it('times a loop once through', () => {
    // 4 bars of sixteenths at 100 quarters a minute
    expect(loopSeconds(session)).toBeCloseTo((64 * 15) / 100)
  })

  it('turns buses down and takes the master effects off', () => {
    const dry = withoutBuses(session, ['b', 'c'])
    const levels = dry.mix.buses.map((bus) => [bus.id, bus.values.level])
    expect(levels.filter(([id]) => id === 'b' || id === 'c')).toEqual([
      ['b', 0],
      ['c', 0],
    ])
    expect(withoutMasterEffects(session).mix.master.effects).toEqual([])
  })
})

describe('wavFile', () => {
  it('writes a stereo float WAV', () => {
    const file = wavFile(new Float32Array([0.5]), new Float32Array([-1]), 48e3)
    expect(file.toString('ascii', 0, 4)).toBe('RIFF')
    expect(file.readUInt16LE(20)).toBe(3)
    expect(file.readUInt32LE(24)).toBe(48000)
    expect(file.readFloatLE(44)).toBe(0.5)
    expect(file.readFloatLE(48)).toBe(-1)
  })
})

describe('pnpm render', () => {
  it('runs on Node as it stands, its imports resolved', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        './scripts/render/resolve.ts',
        'scripts/render/cli.ts',
        'Sub Bass',
        '--seconds',
        '0.25',
        '--json',
      ],
      { encoding: 'utf8' }
    )
    expect(run.stderr).toBe('')
    const measured = JSON.parse(run.stdout)
    expect(measured.name).toBe('Sub Bass')
    expect(measured.peak).toBeGreaterThan(0)
    expect(measured.left).toBeUndefined()
  })
})
