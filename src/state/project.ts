import { fitStrips, readMix, type Mix } from './mix'
import { cleanName, uniqueName } from './presets'
import { fitSong, readSong, type Song } from './song'
import { readTracks, type Track } from './tracks'

/**
 * A project: a session kept under a name, to come back to. The session is
 * everything that plays: the tracks (each synth's sound, each kit's pads
 * and chain), the mix they run through and the song (the tempo, the swing
 * and each track's loops). The user's presets are not part of it: a
 * synth's track holds its own sound, and a kit's pad the sound it last
 * played, which it plays again where its preset is gone
 * (src/state/library.ts). Pure data and its edits; the store that keeps
 * the projects is src/state/projects.ts.
 */

/** What plays: the tracks, the mix after them, the song */
export interface Session {
  readonly tracks: readonly Track[]
  readonly mix: Mix
  readonly song: Song
}

/** A session kept under a name */
export interface Project extends Session {
  readonly name: string
}

/** What a project is named when its name is no name */
export const UNTITLED = 'Untitled'

/**
 * A session from parsed JSON, read as untrusted: its tracks as the
 * session's are (readTracks), the mix with a strip for each and the song
 * with the loops of those there are. Undefined for anything holding no
 * track.
 */
export function readSession(data: unknown): Session | undefined {
  const tracks = readTracks(data)
  if (!tracks) return undefined
  const { mix, song } = data as { mix?: unknown; song?: unknown }
  return {
    tracks,
    mix: fitStrips(readMix(mix), tracks.length),
    song: fitSong(
      readSong(song),
      tracks.map((track) => track.id)
    ),
  }
}

/** A project from parsed JSON: a session, and its name (or Untitled) */
export function readProject(data: unknown): Project | undefined {
  const session = readSession(data)
  if (!session) return undefined
  const { name } = data as { name?: unknown }
  const clean = typeof name === 'string' ? cleanName(name) : ''
  return { name: clean || UNTITLED, ...session }
}

/** Marks a JSON file as a Loopromeda project */
export const PROJECT_FILE_FORMAT = 'loopromeda-project'

/** The version projectFile writes */
export const PROJECT_FILE_VERSION = 1

/** A project as a file: to keep elsewhere, or move to another device */
export interface ProjectFile extends Project {
  readonly format: typeof PROJECT_FILE_FORMAT
  readonly version: number
}

/** A file that is no project file: the message says why, after its name */
export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFileError'
  }
}

/** The file object to save: the header, then the project */
export function projectFile(project: Project): ProjectFile {
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    name: project.name,
    tracks: project.tracks,
    mix: project.mix,
    song: project.song,
  }
}

/**
 * Reads parsed JSON as a project file. Throws ProjectFileError when it is
 * not one, was made by a newer version, or holds no track; what it holds
 * is read as untrusted (readProject).
 */
export function readProjectFile(data: unknown): Project {
  if (!isRecord(data) || data.format !== PROJECT_FILE_FORMAT) {
    throw new ProjectFileError('not a Loopromeda project file')
  }
  const version = data.version
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new ProjectFileError('has no usable version')
  }
  if (version > PROJECT_FILE_VERSION) {
    throw new ProjectFileError(`made by a newer version (${version})`)
  }
  const project = readProject(data)
  if (!project) throw new ProjectFileError('has no tracks')
  return project
}

/** What the device keeps of its projects */
export interface ProjectsKept {
  readonly version: 1
  readonly projects: readonly Project[]
}

/**
 * The projects kept, from parsed JSON: each that reads as one, a name
 * taken already getting a number. None for anything else.
 */
export function readProjects(data: unknown): readonly Project[] {
  if (!isRecord(data) || !Array.isArray(data.projects)) return []
  let list: readonly Project[] = []
  for (const entry of data.projects as unknown[]) {
    const project = readProject(entry)
    if (project) list = addProject(list, project)
  }
  return list
}

/** The project named name, ignoring case */
export function findProject(
  list: readonly Project[],
  name: string
): Project | undefined {
  const wanted = cleanName(name).toLowerCase()
  return list.find((project) => project.name.toLowerCase() === wanted)
}

/** The list with project last, under a name no other has */
export function addProject(
  list: readonly Project[],
  project: Project
): readonly Project[] {
  const name = uniqueName(project.name, names(list))
  return [...list, name === project.name ? project : { ...project, name }]
}

/** The list with session kept in the place of the project named name */
export function replaceProject(
  list: readonly Project[],
  name: string,
  session: Session
): readonly Project[] {
  const { tracks, mix, song } = session
  return list.map((project) =>
    project.name === name ? { name, tracks, mix, song } : project
  )
}

/**
 * The list with the project named name named next instead, unique among
 * the others; the same list for no such project or a blank name
 */
export function renameProject(
  list: readonly Project[],
  name: string,
  next: string
): readonly Project[] {
  if (!cleanName(next) || !list.some((project) => project.name === name)) {
    return list
  }
  const others = list.filter((project) => project.name !== name)
  const unique = uniqueName(next, names(others))
  if (unique === name) return list
  return list.map((project) =>
    project.name === name ? { ...project, name: unique } : project
  )
}

/** The list without the project named name */
export function removeProject(
  list: readonly Project[],
  name: string
): readonly Project[] {
  return list.some((project) => project.name === name)
    ? list.filter((project) => project.name !== name)
    : list
}

/**
 * True for two sessions that hold the same: compared as the JSON they
 * are kept as, whatever order their keys were set in (an edit taken back
 * leaves a key last that was first)
 */
export function sameSession(a: Session, b: Session): boolean {
  return same(a.tracks, b.tracks) && same(a.mix, b.mix) && same(a.song, b.song)
}

const same = (a: unknown, b: unknown): boolean =>
  a === b || canonical(a) === canonical(b)

/** value as JSON, each object's keys in order, those unset left out */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, each: unknown) => {
    if (!isRecord(each)) return each
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(each).sort()) sorted[key] = each[key]
    return sorted
  })
}

/** A file's name for project name: its letters and digits, hyphenated */
export function projectFileName(name: string): string {
  const slug = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return `loopromeda-${slug || 'project'}.json`
}

const names = (list: readonly Project[]): string[] =>
  list.map((project) => project.name)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
