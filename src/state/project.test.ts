import { describe, expect, it } from 'vitest'
import { KIT_PADS, PAD_NOTE, initKitChain } from './kit'
import { fitStrips, initMix, setMixValue, stripId } from './mix'
import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  ProjectFileError,
  UNTITLED,
  addProject,
  findProject,
  projectFile,
  projectFileName,
  readProject,
  readProjectFile,
  readProjects,
  readSession,
  removeProject,
  renameProject,
  replaceProject,
  sameSession,
  type Project,
  type Session,
} from './project'
import { editLoop, initSong, putNote, setTempo } from './song'
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

/** A session of tracks, a strip for each, a note in the first's loop */
function session(tracks: readonly Track[], tempo = 96): Session {
  const first = tracks[0]?.id ?? 't1'
  const song = editLoop(setTempo(initSong(), tempo), first, (loop) =>
    putNote(loop, { step: 0, key: 60, length: 2, velocity: 0.8 })
  )
  return { tracks, mix: fitStrips(initMix(), tracks.length), song }
}

const project = (name: string, tempo = 96): Project => ({
  name,
  ...session([synth('t1'), kit('t2')], tempo),
})

/** As it comes back from storage: through JSON */
const kept = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

const names = (list: readonly Project[]) => list.map((each) => each.name)

describe('readSession', () => {
  it('reads back what was kept', () => {
    const given = session([synth('t1'), kit('t2')])
    const read = readSession(kept(given))
    expect(read).toBeDefined()
    expect(sameSession(read!, given)).toBe(true)
  })

  it('is nothing without a track', () => {
    expect(readSession(undefined)).toBeUndefined()
    expect(readSession('tracks')).toBeUndefined()
    expect(readSession({ mix: initMix(), song: initSong() })).toBeUndefined()
    expect(readSession({ tracks: [] })).toBeUndefined()
    expect(readSession({ tracks: [{ kind: 'organ' }] })).toBeUndefined()
  })

  it('gives each track a strip, whatever mix came with it', () => {
    const tracks = [synth('t1'), synth('t2'), synth('t3')]
    const none = readSession({ tracks })
    expect(none?.mix.strips).toHaveLength(3)
    const short = readSession({ tracks, mix: fitStrips(initMix(), 1) })
    expect(short?.mix.strips).toHaveLength(3)
    const long = readSession({ tracks, mix: fitStrips(initMix(), 6) })
    expect(long?.mix.strips).toHaveLength(3)
  })

  it('keeps the loops of the tracks there are, and no others', () => {
    const song = editLoop(session([synth('t1')]).song, 't9', (loop) =>
      putNote(loop, { step: 4, key: 62, length: 1, velocity: 1 })
    )
    const read = readSession(kept({ tracks: [synth('t1')], song }))
    expect(Object.keys(read?.song.loops ?? {})).toEqual(['t1'])
    expect(read?.song.tempo).toBe(96)
  })

  it('starts a song where none came', () => {
    expect(readSession({ tracks: [synth('t1')] })?.song).toEqual(initSong())
  })
})

describe('readProject', () => {
  it('reads a session and its name, cleaned', () => {
    const read = readProject(kept({ ...project('  Night   drive ') }))
    expect(read?.name).toBe('Night drive')
    expect(read?.tracks).toHaveLength(2)
  })

  it('names a project without a name', () => {
    const { tracks } = project('x')
    expect(readProject({ tracks })?.name).toBe(UNTITLED)
    expect(readProject({ name: '   ', tracks })?.name).toBe(UNTITLED)
    expect(readProject({ name: 7, tracks })?.name).toBe(UNTITLED)
  })

  it('is nothing without a track', () => {
    expect(readProject({ name: 'Empty' })).toBeUndefined()
  })
})

describe('a project file', () => {
  it('says what it is, then holds the project', () => {
    const file = projectFile(project('Night drive'))
    expect(file.format).toBe(PROJECT_FILE_FORMAT)
    expect(file.version).toBe(PROJECT_FILE_VERSION)
    expect(Object.keys(file)).toEqual([
      'format',
      'version',
      'name',
      'tracks',
      'mix',
      'song',
    ])
  })

  it('reads back as the project it was written from', () => {
    const given = project('Night drive')
    const read = readProjectFile(kept(projectFile(given)))
    expect(read.name).toBe('Night drive')
    expect(sameSession(read, given)).toBe(true)
  })

  it('turns away what is no project file', () => {
    const not = 'not a Loopromeda project file'
    expect(() => readProjectFile(undefined)).toThrow(ProjectFileError)
    expect(() => readProjectFile([])).toThrow(not)
    expect(() => readProjectFile({ tracks: [synth('t1')] })).toThrow(not)
    expect(() =>
      readProjectFile({ format: 'loopromeda-presets', version: 2 })
    ).toThrow(not)
  })

  it('turns away a version it cannot read', () => {
    const file = projectFile(project('x'))
    expect(() => readProjectFile({ ...file, version: 'one' })).toThrow(
      'has no usable version'
    )
    expect(() => readProjectFile({ ...file, version: 0 })).toThrow(
      'has no usable version'
    )
    expect(() => readProjectFile({ ...file, version: 1.5 })).toThrow(
      'has no usable version'
    )
    expect(() =>
      readProjectFile({ ...file, version: PROJECT_FILE_VERSION + 1 })
    ).toThrow(`made by a newer version (${PROJECT_FILE_VERSION + 1})`)
  })

  it('turns away a file without tracks', () => {
    const file = projectFile(project('x'))
    expect(() => readProjectFile({ ...file, tracks: [] })).toThrow(
      'has no tracks'
    )
  })
})

describe('readProjects', () => {
  it('reads each project kept', () => {
    const list = [project('One'), project('Two', 140)]
    const read = readProjects(kept({ version: 1, projects: list }))
    expect(names(read)).toEqual(['One', 'Two'])
    expect(read[1]?.song.tempo).toBe(140)
  })

  it('leaves out what does not read, and numbers a name taken', () => {
    const read = readProjects({
      version: 1,
      projects: [
        project('Take'),
        'nonsense',
        { name: 'Empty' },
        project('take'),
      ],
    })
    expect(names(read)).toEqual(['Take', 'take 2'])
  })

  it('is no projects for anything else', () => {
    expect(readProjects(undefined)).toEqual([])
    expect(readProjects({ projects: 'all' })).toEqual([])
    expect(readProjects([project('One')])).toEqual([])
  })
})

describe('the list of projects', () => {
  const list = [project('One'), project('Two'), project('Three')]

  it('finds a project by its name, ignoring case', () => {
    expect(findProject(list, ' two ')?.name).toBe('Two')
    expect(findProject(list, 'Four')).toBeUndefined()
  })

  it('adds a project last, under a name no other has', () => {
    expect(names(addProject(list, project('Four')))).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
    ])
    const again = addProject(list, project('two'))
    expect(names(again)).toEqual(['One', 'Two', 'Three', 'two 2'])
  })

  it('keeps a session in the place of a project', () => {
    const next = session([synth('t1')], 150)
    const replaced = replaceProject(list, 'Two', next)
    expect(names(replaced)).toEqual(['One', 'Two', 'Three'])
    expect(replaced[1]?.song.tempo).toBe(150)
    expect(replaced[1]?.tracks).toBe(next.tracks)
    expect(replaced[0]).toBe(list[0])
  })

  it('renames a project in its place', () => {
    const renamed = renameProject(list, 'Two', '  Second ')
    expect(names(renamed)).toEqual(['One', 'Second', 'Three'])
    expect(renamed[1]?.tracks).toBe(list[1]?.tracks)
  })

  it('keeps a new name apart from the others', () => {
    expect(names(renameProject(list, 'Two', 'one'))).toEqual([
      'One',
      'one 2',
      'Three',
    ])
    // Its own name, in other letters, is free
    expect(names(renameProject(list, 'Two', 'TWO'))).toEqual([
      'One',
      'TWO',
      'Three',
    ])
  })

  it('renames nothing to no name, to its own, or where it is not', () => {
    expect(renameProject(list, 'Two', '   ')).toBe(list)
    expect(renameProject(list, 'Two', 'Two')).toBe(list)
    expect(renameProject(list, 'Four', 'Five')).toBe(list)
  })

  it('removes a project, and nothing where it is not', () => {
    expect(names(removeProject(list, 'Two'))).toEqual(['One', 'Three'])
    expect(removeProject(list, 'Four')).toBe(list)
  })
})

describe('sameSession', () => {
  const given = session([synth('t1'), kit('t2')])

  it('is true of a session and its copy from storage', () => {
    expect(sameSession(given, given)).toBe(true)
    expect(sameSession(given, kept(given) as Session)).toBe(true)
  })

  it('looks past the order keys were set in, and those unset', () => {
    const [first, second] = given.tracks
    const turned: Session = {
      song: {
        off: given.song.off,
        loops: given.song.loops,
        swing: given.song.swing,
        tempo: given.song.tempo,
      },
      mix: given.mix,
      tracks: [{ ...first!, name: undefined }, second!],
    }
    expect(sameSession(given, turned)).toBe(true)
  })

  it('is false where a track, the mix or the song differs', () => {
    const named: Session = {
      ...given,
      tracks: [{ ...given.tracks[0]!, name: 'Bass' }, given.tracks[1]!],
    }
    expect(sameSession(given, named)).toBe(false)
    const mixed = {
      ...given,
      mix: setMixValue(given.mix, stripId(0), 'level', 0.2),
    }
    expect(mixed.mix).not.toBe(given.mix)
    expect(sameSession(given, mixed)).toBe(false)
    const faster = { ...given, song: setTempo(given.song, 97) }
    expect(sameSession(given, faster)).toBe(false)
  })
})

describe('projectFileName', () => {
  it('hyphenates the name, in small letters', () => {
    expect(projectFileName('Night Drive #2')).toBe(
      'loopromeda-night-drive-2.json'
    )
    expect(projectFileName('  a/b\\c  ')).toBe('loopromeda-a-b-c.json')
  })

  it('keeps letters of any script', () => {
    expect(projectFileName('밤 드라이브')).toBe('loopromeda-밤-드라이브.json')
  })

  it('names a project of no letters', () => {
    expect(projectFileName('***')).toBe('loopromeda-project.json')
    expect(projectFileName('')).toBe('loopromeda-project.json')
  })
})
