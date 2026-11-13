import { describe, expect, it } from 'vitest'
import type { ToWorklet } from './protocol'
import { ReductionWatchers } from './reductions'

type Watch = Extract<ToWorklet, { t: 'watchReduction' }>

function watchers() {
  const told: Watch[] = []
  return { told, reductions: new ReductionWatchers((m) => told.push(m)) }
}

/** A report for the list of message, of dbs in its order */
const report = (message: Watch, dbs: readonly number[]) => ({
  version: message.version,
  dbs: Float64Array.from(dbs),
})

describe('ReductionWatchers', () => {
  it('tells the audio thread each new list, under a new version', () => {
    const { told, reductions } = watchers()
    expect(reductions.watching).toBe(false)
    const stopMaster = reductions.watch({ id: 'e2' }, () => {})
    const stopInsert = reductions.watch({ track: 't1', id: 'f1' }, () => {})
    expect(told.map((m) => m.at)).toEqual([
      [{ id: 'e2' }],
      [{ id: 'e2' }, { track: 't1', id: 'f1' }],
    ])
    expect(told[1]?.version).toBeGreaterThan(told[0]?.version ?? 0)
    expect(reductions.watching).toBe(true)
    stopMaster()
    expect(told[2]?.at).toEqual([{ track: 't1', id: 'f1' }])
    stopInsert()
    expect(told[3]?.at).toEqual([])
    expect(reductions.watching).toBe(false)
    expect(reductions.message).toBe(told[3])
  })

  it('tells each effect’s listeners its own depth, in the list’s order', () => {
    const { told, reductions } = watchers()
    const heard: string[] = []
    reductions.watch({ id: 'e1' }, (db) => heard.push(`e1 ${db}`))
    reductions.watch({ track: 't1', id: 'e1' }, (db) => heard.push(`t1 ${db}`))
    const last = told[told.length - 1] as Watch
    reductions.receive(report(last, [-3, -0.5]))
    expect(heard).toEqual(['e1 -3', 't1 -0.5'])
  })

  it('tells both of the same effect, and one more asks nothing anew', () => {
    const { told, reductions } = watchers()
    const tile: number[] = []
    const panel: number[] = []
    const stopTile = reductions.watch({ id: 'e2' }, (db) => tile.push(db))
    const stopPanel = reductions.watch({ id: 'e2' }, (db) => panel.push(db))
    expect(told).toHaveLength(1)
    reductions.receive(report(reductions.message, [-6]))
    expect([tile, panel]).toEqual([[-6], [-6]])
    // The panel goes: the tile goes on, the list as it was
    stopPanel()
    stopPanel()
    expect(told).toHaveLength(1)
    reductions.receive(report(reductions.message, [-2]))
    expect([tile, panel]).toEqual([[-6, -2], [-6]])
    stopTile()
    expect(told).toHaveLength(2)
  })

  it('drops a report made for a list since changed', () => {
    const { told, reductions } = watchers()
    const heard: number[] = []
    reductions.watch({ id: 'e1' }, (db) => heard.push(db))
    const old = told[0] as Watch
    reductions.watch({ id: 'e2' }, () => {})
    reductions.receive(report(old, [-9]))
    expect(heard).toEqual([])
  })
})
