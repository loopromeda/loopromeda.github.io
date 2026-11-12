/**
 * The service worker: keeps the site in the browser's cache, so that it
 * starts and plays with no network (an installed app on a train). The
 * build writes every file it ships, and their version, into MANIFEST
 * (scripts/vite-offline.ts); a new build is a new list, so the browser
 * finds this file changed and installs the new one beside the old.
 *
 * Installing fetches every file afresh, past the HTTP cache (which may
 * hold an older index.html), into a cache named for the version: all of
 * them or none. The new worker then waits, so that no page is changed
 * under its player, and takes over once every page of the old one has
 * closed, or when a page asks it to (src/offline.ts: the status line's
 * Update). Taking over, it drops the older caches.
 *
 * It serves a file it holds from the cache, and index.html for the
 * site's own address (a launch from the home screen). Anything else goes
 * to the network as if it were not here.
 */
export {}

declare const self: ServiceWorkerGlobalScope

/** Replaced by the build with the manifest, as JSON */
const MANIFEST = '__LOOPROMEDA_PRECACHE__'

/** A page's message (src/offline.ts): take over now */
const SKIP_WAITING = 'skip-waiting'

interface Manifest {
  /** A hash of every file's name and bytes */
  readonly version: string
  /** Each file's path from the site's root */
  readonly files: readonly string[]
}

const manifest = JSON.parse(MANIFEST) as Manifest

/** This site's caches, one per version */
const PREFIX = 'loopromeda-'
const CACHE = `${PREFIX}${manifest.version}`

/** A file's address: beside this worker, at the site's root */
const address = (file: string) => new URL(file, self.location.href).href

const HELD = new Set(manifest.files.map(address))
const ROOT = address('./')
const SHELL = address('index.html')

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          manifest.files.map(
            (file) => new Request(address(file), { cache: 'no-cache' })
          )
        )
      )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter(
        (name) => name.startsWith(PREFIX) && name !== CACHE
      )
      await Promise.all(old.map((name) => caches.delete(name)))
      // The first worker serves the page that installed it straight away
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data === SKIP_WAITING) void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  url.search = ''
  url.hash = ''
  const key = HELD.has(url.href)
    ? url.href
    : request.mode === 'navigate' && url.href === ROOT
      ? SHELL
      : undefined
  if (key === undefined) return
  event.respondWith(fromCache(key, request))
})

/** key from this version's cache; from the network if it is missing */
async function fromCache(key: string, request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  return (await cache.match(key)) ?? fetch(request)
}
