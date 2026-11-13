import { describe, expect, it } from 'vitest'
import { KIT_PADS, PAD_NOTE, initKitChain } from './kit'
import { fitStrips, initMix } from './mix'
import {
  PROJECT_FILE_FORMAT,
  ProjectFileError,
  UNTITLED,
  projectFile,
  sameSession,
  type Project,
  type Session,
} from './project'
import {
  CURRENT_KEY,
  PROJECTS_KEY,
  Projects,
  type ProjectStorage,
  type SessionHost,
} from './projects'
import { initSong, setTempo } from './song'
import { initSound } from './sound/sound'
import type { Track } from './tracks'

const synth = (id: string): Track => ({ id, kind: 'synth', sound: initSound() })

const kit = (id: string): Track => ({
  id,
  kind: 'kit',
  pads: Array.from({ length: KIT_PADS }, () => ({
    sound: initSound(),
    note: PAD_NOTE,
  })),
  chain: initKitChain(),
})

function session(tracks: readonly Track[], tempo = 120): Session {
  return {
    tracks,
    mix: fitStrips(initMix(), tracks.length),
    song: setTempo(initSong(), tempo),
  }
}

const FRESH = session([synth('t1'), kit('t2')])

/** What plays, held here: a session, replaced whole or edited */
class FakeHost implements SessionHost {
  session: Session
  /** How many sessions were set to play */
  sets = 0
  /** What becomes of a session set to play: as given, unless set */
  given: (session: Session) => Session = (session) => session
  readonly #listeners = new Set<() => void>()

  constructor(start: Session = FRESH) {
    this.session = start
  }

  getSession(): Session {
    return this.session
  }

  setSession(next: Session): void {
    this.sets += 1
    const { tracks, mix, song } = this.given(next)
    // Each part told of as it lands, as the engine does
    this.session = { ...this.session, tracks }
    this.tell()
    this.session = { ...this.session, mix }
    this.tell()
    this.session = { tracks, mix, song }
    this.tell()
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  fresh(): Session {
    return FRESH
  }

  /** An edit: the song at another tempo */
  edit(tempo: number): void {
    this.session = {
      ...this.session,
      song: setTempo(this.session.song, tempo),
    }
    this.tell()
  }

  /** A change that changes none of the three (the track picked) */
  tell(): void {
    for (const listener of this.#listeners) listener()
  }

  get listeners(): number {
    return this.#listeners.size
  }
}

class FakeStorage implements ProjectStorage {
  readonly items = new Map<string, string>()
  fail: Error | undefined
  readonly written: string[] = []

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.fail) throw this.fail
    this.items.set(key, value)
    this.written.push(key)
  }

  json(key: string): unknown {
    const text = this.items.get(key)
    return text === undefined ? undefined : JSON.parse(text)
  }
}

function open(host = new FakeHost(), storage = new FakeStorage()) {
  const projects = new Projects(host, storage)
  projects.restore()
  return { projects, host, storage }
}

const names = (projects: Projects) =>
  projects.snapshot.list.map((each) => each.name)

/** Storage holding list, the session coming from the one named current */
function keeping(list: readonly Project[], current?: string): FakeStorage {
  const storage = new FakeStorage()
  storage.items.set(
    PROJECTS_KEY,
    JSON.stringify({ version: 1, projects: list })
  )
  if (current !== undefined) {
    storage.items.set(
      CURRENT_KEY,
      JSON.stringify({ version: 1, name: current })
    )
  }
  return storage
}

const NIGHT: Project = { name: 'Night', ...session([synth('t1')], 96) }
const DAY: Project = { name: 'Day', ...session([kit('t1'), synth('t2')], 140) }

/** A session as it comes back from storage: through JSON */
const copy = (value: Session): Session =>
  JSON.parse(JSON.stringify(value)) as Session

describe('restoring', () => {
  it('starts with no projects, a first visit’s session unedited', () => {
    const { projects, storage } = open()
    expect(projects.snapshot).toEqual({
      list: [],
      current: undefined,
      edited: false,
      problem: undefined,
    })
    expect(storage.written).toEqual([])
  })

  it('reads the projects kept, and which the session came from', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects } = open(host, keeping([NIGHT, DAY], 'Night'))
    expect(names(projects)).toEqual(['Night', 'Day'])
    expect(projects.snapshot.current).toBe('Night')
    expect(projects.snapshot.edited).toBe(false)
  })

  it('tells a session changed since its project was kept', () => {
    const host = new FakeHost({ ...NIGHT, song: setTempo(NIGHT.song, 97) })
    const { projects } = open(host, keeping([NIGHT], 'Night'))
    expect(projects.snapshot.current).toBe('Night')
    expect(projects.snapshot.edited).toBe(true)
  })

  it('tells a session from no project that is not a new one’s', () => {
    const { projects } = open(new FakeHost(copy(NIGHT)), keeping([NIGHT]))
    expect(projects.snapshot.current).toBeUndefined()
    expect(projects.snapshot.edited).toBe(true)
  })

  it('comes from no project where the one named is gone', () => {
    const { projects } = open(new FakeHost(), keeping([NIGHT], 'Dusk'))
    expect(projects.snapshot.current).toBeUndefined()
    expect(projects.snapshot.edited).toBe(false)
  })

  it('reads what will not parse as nothing kept', () => {
    const storage = new FakeStorage()
    storage.items.set(PROJECTS_KEY, '{"version":1,"projects":[')
    storage.items.set(CURRENT_KEY, 'Night')
    const { projects } = open(new FakeHost(), storage)
    expect(projects.snapshot.list).toEqual([])
    expect(projects.snapshot.current).toBeUndefined()
  })
})

describe('saving', () => {
  it('keeps what plays under a new name, as the current project', () => {
    const { projects, host, storage } = open()
    host.edit(96)
    expect(projects.snapshot.edited).toBe(true)
    expect(projects.saveAs('  Night   drive ')).toBe('Night drive')
    expect(projects.snapshot.current).toBe('Night drive')
    expect(projects.snapshot.edited).toBe(false)
    expect(projects.snapshot.list[0]?.song.tempo).toBe(96)
    expect(storage.written).toEqual([PROJECTS_KEY, CURRENT_KEY])
    expect(storage.json(CURRENT_KEY)).toEqual({
      version: 1,
      name: 'Night drive',
    })
    expect(storage.json(PROJECTS_KEY)).toMatchObject({
      version: 1,
      projects: [{ name: 'Night drive', song: { tempo: 96 } }],
    })
  })

  it('writes over no project: a name taken gets a number', () => {
    const { projects, host } = open()
    projects.saveAs('Take')
    host.edit(90)
    expect(projects.saveAs('take')).toBe('take 2')
    expect(names(projects)).toEqual(['Take', 'take 2'])
    expect(projects.snapshot.list[0]?.song.tempo).toBe(120)
    expect(projects.snapshot.current).toBe('take 2')
  })

  it('saves nothing under no name', () => {
    const { projects, storage } = open()
    expect(projects.saveAs('   ')).toBeUndefined()
    expect(projects.snapshot.list).toEqual([])
    expect(storage.written).toEqual([])
  })

  it('keeps what plays over the current project', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects, storage } = open(host, keeping([NIGHT, DAY], 'Night'))
    host.edit(100)
    expect(projects.snapshot.edited).toBe(true)
    expect(projects.save()).toBe(true)
    expect(projects.snapshot.edited).toBe(false)
    expect(names(projects)).toEqual(['Night', 'Day'])
    expect(projects.snapshot.list[0]?.song.tempo).toBe(100)
    expect(projects.snapshot.list[1]?.song.tempo).toBe(140)
    expect(storage.written).toEqual([PROJECTS_KEY])
  })

  it('saves over nothing without a current project', () => {
    const { projects, storage } = open(new FakeHost(), keeping([NIGHT]))
    expect(projects.save()).toBe(false)
    expect(projects.snapshot.list[0]?.song.tempo).toBe(96)
    expect(storage.written).toEqual([])
  })
})

describe('opening', () => {
  it('plays a project in the session’s place, as the current one', () => {
    const { projects, host, storage } = open(
      new FakeHost(),
      keeping([NIGHT, DAY])
    )
    expect(projects.open('Day')).toBe(true)
    expect(host.sets).toBe(1)
    expect(sameSession(host.session, DAY)).toBe(true)
    expect(projects.snapshot.current).toBe('Day')
    expect(projects.snapshot.edited).toBe(false)
    expect(storage.json(CURRENT_KEY)).toEqual({ version: 1, name: 'Day' })
  })

  it('takes none of its own setting for an edit', () => {
    const { projects, host } = open(new FakeHost(), keeping([NIGHT, DAY]))
    const seen: boolean[] = []
    projects.subscribe(() => seen.push(projects.snapshot.edited))
    projects.open('Day')
    expect(seen.every((edited) => !edited)).toBe(true)
    // And one made after it is one
    host.edit(141)
    expect(projects.snapshot.edited).toBe(true)
  })

  it('is edited already where it plays as something else', () => {
    const host = new FakeHost()
    // A pad's preset changed since: the project plays at another tempo
    host.given = (given) => ({ ...given, song: setTempo(given.song, 99) })
    const { projects } = open(host, keeping([NIGHT]))
    projects.open('Night')
    expect(projects.snapshot.current).toBe('Night')
    expect(projects.snapshot.edited).toBe(true)
  })

  it('takes back the edits made to the current project', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects } = open(host, keeping([NIGHT], 'Night'))
    host.edit(100)
    projects.open('Night')
    expect(host.session.song.tempo).toBe(96)
    expect(projects.snapshot.edited).toBe(false)
  })

  it('opens nothing that is not kept', () => {
    const { projects, host } = open(new FakeHost(), keeping([NIGHT]))
    expect(projects.open('Dusk')).toBe(false)
    expect(host.sets).toBe(0)
    expect(projects.snapshot.current).toBeUndefined()
  })

  it('starts a new project: a first visit’s session, from none', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects, storage } = open(host, keeping([NIGHT], 'Night'))
    projects.fresh()
    expect(host.session).toEqual(FRESH)
    expect(projects.snapshot.current).toBeUndefined()
    expect(projects.snapshot.edited).toBe(false)
    expect(names(projects)).toEqual(['Night'])
    expect(storage.json(CURRENT_KEY)).toEqual({ version: 1, name: null })
  })
})

describe('edited', () => {
  it('follows what plays, and not a change to none of it', () => {
    const { projects, host } = open()
    let told = 0
    projects.subscribe(() => (told += 1))
    host.tell()
    expect(projects.snapshot.edited).toBe(false)
    expect(told).toBe(0)
    host.edit(121)
    expect(projects.snapshot.edited).toBe(true)
    expect(told).toBe(1)
    // Told of once, however many edits follow
    host.edit(122)
    expect(told).toBe(1)
  })

  it('stays so when the edit is taken back, until a save', () => {
    const { projects, host } = open()
    projects.saveAs('Take')
    host.edit(121)
    host.edit(120)
    expect(projects.snapshot.edited).toBe(true)
    projects.save()
    expect(projects.snapshot.edited).toBe(false)
  })

  it('stops following once disposed of', () => {
    const { projects, host } = open()
    expect(host.listeners).toBe(1)
    projects.dispose()
    expect(host.listeners).toBe(0)
  })
})

describe('renaming and removing', () => {
  it('renames a project, the current one’s name following', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects, storage } = open(host, keeping([NIGHT, DAY], 'Night'))
    expect(projects.rename('Night', ' Dusk ')).toBe('Dusk')
    expect(names(projects)).toEqual(['Dusk', 'Day'])
    expect(projects.snapshot.current).toBe('Dusk')
    expect(projects.snapshot.edited).toBe(false)
    expect(storage.written).toEqual([PROJECTS_KEY, CURRENT_KEY])
    expect(storage.json(CURRENT_KEY)).toEqual({ version: 1, name: 'Dusk' })
  })

  it('renames another, the current one as it was', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects, storage } = open(host, keeping([NIGHT, DAY], 'Night'))
    expect(projects.rename('Day', 'night')).toBe('night 2')
    expect(projects.snapshot.current).toBe('Night')
    expect(storage.written).toEqual([PROJECTS_KEY])
  })

  it('renames nothing to no name, or where it is not', () => {
    const { projects, storage } = open(new FakeHost(), keeping([NIGHT]))
    expect(projects.rename('Night', '  ')).toBeUndefined()
    expect(projects.rename('Night', 'Night')).toBeUndefined()
    expect(projects.rename('Dusk', 'Dawn')).toBeUndefined()
    expect(storage.written).toEqual([])
  })

  it('removes the current project, what plays kept nowhere', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects, storage } = open(host, keeping([NIGHT, DAY], 'Night'))
    projects.remove('Night')
    expect(names(projects)).toEqual(['Day'])
    expect(projects.snapshot.current).toBeUndefined()
    expect(projects.snapshot.edited).toBe(true)
    expect(host.sets).toBe(0)
    expect(storage.json(CURRENT_KEY)).toEqual({ version: 1, name: null })
    // A change to none of it does not make it clean again
    host.tell()
    expect(projects.snapshot.edited).toBe(true)
  })

  it('removes another, the current one as it was', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects, storage } = open(host, keeping([NIGHT, DAY], 'Night'))
    projects.remove('Day')
    expect(names(projects)).toEqual(['Night'])
    expect(projects.snapshot.current).toBe('Night')
    expect(projects.snapshot.edited).toBe(false)
    expect(storage.written).toEqual([PROJECTS_KEY])
    projects.remove('Dusk')
    expect(storage.written).toEqual([PROJECTS_KEY])
  })
})

describe('files', () => {
  it('writes what plays, edits and all, under the project’s name', () => {
    const host = new FakeHost(copy(NIGHT))
    const { projects } = open(host, keeping([NIGHT], 'Night'))
    host.edit(101)
    const file = projects.exportFile()
    expect(file.format).toBe(PROJECT_FILE_FORMAT)
    expect(file.name).toBe('Night')
    expect(file.song.tempo).toBe(101)
  })

  it('names a session from no project', () => {
    expect(open().projects.exportFile().name).toBe(UNTITLED)
  })

  it('adds a file’s project, what plays left as it is', () => {
    const { projects, host, storage } = open(
      new FakeHost(),
      keeping([NIGHT], undefined)
    )
    const file = JSON.parse(JSON.stringify(projectFile(NIGHT))) as unknown
    expect(projects.importFile(file)).toBe('Night 2')
    expect(names(projects)).toEqual(['Night', 'Night 2'])
    expect(host.sets).toBe(0)
    expect(projects.snapshot.current).toBeUndefined()
    expect(storage.written).toEqual([PROJECTS_KEY])
  })

  it('turns away what is no project file', () => {
    const { projects, storage } = open()
    expect(() => projects.importFile({ format: 'loopromeda-presets' })).toThrow(
      ProjectFileError
    )
    expect(projects.snapshot.list).toEqual([])
    expect(storage.written).toEqual([])
  })
})

describe('storage that fails', () => {
  it('says there is none, and still holds the projects this visit', () => {
    const host = new FakeHost()
    const projects = new Projects(host, undefined)
    projects.restore()
    expect(projects.snapshot.problem).toBe('This browser keeps no storage')
    expect(projects.saveAs('Take')).toBe('Take')
    expect(names(projects)).toEqual(['Take'])
    expect(projects.snapshot.problem).toBe('This browser keeps no storage')
  })

  it('says when there is no room left, and when there is again', () => {
    const { projects, host, storage } = open()
    storage.fail = new DOMException('full', 'QuotaExceededError')
    expect(projects.saveAs('Take')).toBe('Take')
    expect(projects.snapshot.problem).toBe(
      'This device has no room left for projects'
    )
    expect(names(projects)).toEqual(['Take'])
    expect(projects.snapshot.current).toBe('Take')
    storage.fail = undefined
    host.edit(90)
    projects.save()
    expect(projects.snapshot.problem).toBeUndefined()
    expect(storage.json(PROJECTS_KEY)).toMatchObject({
      projects: [{ name: 'Take', song: { tempo: 90 } }],
    })
  })

  it('says when the browser will not keep them', () => {
    const { projects, storage } = open()
    storage.fail = new Error('denied')
    projects.saveAs('Take')
    expect(projects.snapshot.problem).toBe(
      'This browser would not keep the projects'
    )
  })
})
