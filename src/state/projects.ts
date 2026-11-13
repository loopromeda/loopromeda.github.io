import { cleanName } from './presets'
import {
  UNTITLED,
  addProject,
  projectFile,
  readProjectFile,
  readProjects,
  removeProject,
  renameProject,
  replaceProject,
  sameSession,
  type Project,
  type ProjectFile,
  type ProjectsKept,
  type Session,
} from './project'

/** The part of Web Storage the projects use (localStorage) */
export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * What plays, as the projects see it: the engine and the library behind
 * it (src/main.tsx puts them together)
 */
export interface SessionHost {
  /**
   * The tracks, the mix and the song now playing: each the same object
   * until it changes
   */
  getSession(): Session
  /** Plays session instead, whole */
  setSession(session: Session): void
  /** Calls listener after each change to any of the three */
  subscribe(listener: () => void): () => void
  /** What a new project starts from: a first visit's session */
  fresh(): Session
}

/** What the UI reads of the projects */
export interface ProjectsSnapshot {
  /** The projects kept, in the order they were saved */
  readonly list: readonly Project[]
  /** The name of the project the session came from; undefined for none */
  readonly current: string | undefined
  /**
   * True when what plays is no longer what the current project keeps
   * (with none: what a new project starts from), so replacing it loses
   * something
   */
  readonly edited: boolean
  /** Why the projects are not being kept, when storage fails */
  readonly problem: string | undefined
}

/**
 * localStorage keys: every project (ProjectsKept), and the name of the
 * one the session came from ({ version: 1, name })
 */
export const PROJECTS_KEY = 'loopromeda.projects'
export const CURRENT_KEY = 'loopromeda.project'

/**
 * The projects: sessions kept under a name on this device (src/state/
 * project.ts), and which of them is playing. Save keeps what plays (the
 * tracks, the mix, the song) over the current project, Save as under a
 * new name; a project opened plays in the session's place, and New a
 * first visit's session. The session itself is kept as before, by the
 * library and src/main.tsx, so a reload brings back what was playing,
 * saved or not; this only tells whether it is still what the project
 * keeps. A file holds one project, to keep elsewhere or move to another
 * device. Subscribe-and-snapshot, for useSyncExternalStore. Storage that
 * fails leaves the projects working for this visit and says so in
 * `problem`.
 */
export class Projects {
  readonly #host: SessionHost
  readonly #storage: ProjectStorage | undefined
  #snapshot: ProjectsSnapshot
  readonly #listeners = new Set<() => void>()
  /**
   * What played when the session was last known to be what the current
   * project keeps (with none, a new one's): undefined once it was not
   */
  #clean: Session | undefined
  /** True while a project is being set to play: no edit is being made */
  #setting = false
  readonly #unsubscribe: () => void

  constructor(host: SessionHost, storage: ProjectStorage | undefined) {
    this.#host = host
    this.#storage = storage
    this.#snapshot = {
      list: [],
      current: undefined,
      edited: true,
      problem: storage ? undefined : 'This browser keeps no storage',
    }
    this.#unsubscribe = host.subscribe(this.#changed)
  }

  get snapshot(): ProjectsSnapshot {
    return this.#snapshot
  }

  readonly getSnapshot = (): ProjectsSnapshot => this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Reads the projects kept and which the session came from, and tells
   * whether what plays (restored already) is still what it keeps
   */
  restore(): void {
    const list = this.#read(PROJECTS_KEY, readProjects) ?? []
    const name = this.#read(CURRENT_KEY, readCurrent)
    const current = list.find((project) => project.name === name)
    this.#set({ list, current: current?.name })
    this.#compare(current ?? this.#host.fresh())
  }

  /**
   * Keeps what plays over the current project. False without one: there
   * is nothing to save over.
   */
  save(): boolean {
    const { list, current } = this.#snapshot
    if (current === undefined) return false
    const session = this.#host.getSession()
    this.#clean = session
    this.#set({ list: replaceProject(list, current, session), edited: false })
    this.#writeList()
    return true
  }

  /**
   * Keeps what plays as a new project, which becomes the current one: a
   * name taken already gets a number, so none is written over. The name
   * it got, or undefined for no name.
   */
  saveAs(name: string): string | undefined {
    const clean = cleanName(name)
    if (!clean) return undefined
    const session = this.#host.getSession()
    const list = addProject(this.#snapshot.list, { name: clean, ...session })
    const added = list[list.length - 1]?.name
    this.#clean = session
    this.#set({ list, current: added, edited: false })
    this.#writeList()
    this.#writeCurrent()
    return added
  }

  /**
   * Plays the project named name in the session's place, as the current
   * one. It plays as the presets are now, so it is edited already where a
   * pad's preset was changed since. False for no such project.
   */
  open(name: string): boolean {
    const project = this.#snapshot.list.find((each) => each.name === name)
    if (!project) return false
    this.#play(project)
    this.#set({ current: project.name })
    this.#compare(project)
    this.#writeCurrent()
    return true
  }

  /** Plays a first visit's session in the session's place, from no project */
  fresh(): void {
    const session = this.#host.fresh()
    this.#play(session)
    this.#set({ current: undefined })
    this.#compare(session)
    this.#writeCurrent()
  }

  /**
   * Names the project named name next instead, a name taken already
   * getting a number. The name it got; undefined when nothing changed (no
   * such project, no name, its own).
   */
  rename(name: string, next: string): string | undefined {
    const { list, current } = this.#snapshot
    const renamed = renameProject(list, name, next)
    if (renamed === list) return undefined
    const k = list.findIndex((project) => project.name === name)
    const got = renamed[k]?.name
    this.#set({ list: renamed, current: current === name ? got : current })
    this.#writeList()
    if (current === name) this.#writeCurrent()
    return got
  }

  /**
   * Removes the project named name. What plays goes on playing: where it
   * was the current one, from no project, and kept nowhere.
   */
  remove(name: string): void {
    const { list, current } = this.#snapshot
    const without = removeProject(list, name)
    if (without === list) return
    if (current === name) {
      this.#clean = undefined
      this.#set({ list: without, current: undefined, edited: true })
      this.#writeCurrent()
    } else {
      this.#set({ list: without })
    }
    this.#writeList()
  }

  /**
   * What plays as a file, under the current project's name (or Untitled):
   * to keep elsewhere, or move to another device
   */
  exportFile(): ProjectFile {
    const name = this.#snapshot.current ?? UNTITLED
    return projectFile({ name, ...this.#host.getSession() })
  }

  /**
   * Adds the project of a file (parsed JSON) to those kept, a name taken
   * already getting a number; what plays is left as it is. The name it
   * got. Throws ProjectFileError for a file that is not a project file.
   */
  importFile(data: unknown): string {
    const list = addProject(this.#snapshot.list, readProjectFile(data))
    const added = list[list.length - 1]?.name ?? UNTITLED
    this.#set({ list })
    this.#writeList()
    return added
  }

  /** Stops following what plays */
  dispose(): void {
    this.#unsubscribe()
  }

  /** What plays changed: edited once it is no longer what was clean */
  readonly #changed = (): void => {
    if (this.#setting) return
    const edited = !this.#isClean()
    if (edited) this.#clean = undefined
    if (edited !== this.#snapshot.edited) this.#set({ edited })
  }

  #isClean(): boolean {
    const clean = this.#clean
    if (!clean) return false
    const now = this.#host.getSession()
    return (
      now.tracks === clean.tracks &&
      now.mix === clean.mix &&
      now.song === clean.song
    )
  }

  /** Plays session instead, without taking it for an edit */
  #play(session: Session): void {
    this.#setting = true
    try {
      this.#host.setSession(session)
    } finally {
      this.#setting = false
    }
  }

  /** Tells whether what plays holds the same as kept does, looking closely */
  #compare(kept: Session): void {
    const now = this.#host.getSession()
    const edited = !sameSession(now, kept)
    this.#clean = edited ? undefined : now
    if (edited !== this.#snapshot.edited) this.#set({ edited })
  }

  #read<T>(key: string, parse: (data: unknown) => T): T | undefined {
    if (!this.#storage) return undefined
    try {
      const text = this.#storage.getItem(key)
      return text === null ? undefined : parse(JSON.parse(text))
    } catch {
      // Unreadable: as if nothing were kept
      return undefined
    }
  }

  #write(key: string, data: unknown): void {
    if (!this.#storage) return
    try {
      this.#storage.setItem(key, JSON.stringify(data))
      if (this.#snapshot.problem) this.#set({ problem: undefined })
    } catch (error) {
      const problem =
        error instanceof Error && error.name === 'QuotaExceededError'
          ? 'This device has no room left for projects'
          : 'This browser would not keep the projects'
      if (problem !== this.#snapshot.problem) this.#set({ problem })
    }
  }

  #writeList(): void {
    const kept: ProjectsKept = { version: 1, projects: this.#snapshot.list }
    this.#write(PROJECTS_KEY, kept)
  }

  #writeCurrent(): void {
    this.#write(CURRENT_KEY, {
      version: 1,
      name: this.#snapshot.current ?? null,
    })
  }

  #set(change: Partial<ProjectsSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change }
    for (const listener of this.#listeners) listener()
  }
}

/** The current project's name as kept: undefined for none */
function readCurrent(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { name } = data as { name?: unknown }
  return typeof name === 'string' ? name : undefined
}
