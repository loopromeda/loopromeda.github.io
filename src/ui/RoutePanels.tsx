import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Engine } from '../engine/engine'
import { formatAmount } from '../state/params'
import { ROUTE_AMOUNT } from '../state/sound/diff'
import { addRoute, removePart, setRoute } from '../state/sound/edit'
import { MAX_ROUTES } from '../state/sound/kinds'
import { partDests, routesTo } from '../state/sound/knob'
import { destOf, partName, sources, type Sound } from '../state/sound/sound'
import { PANEL_BODY, SMALL_BUTTON, knobRow } from './controls'
import {
  GLYPHS,
  MOD_COLOR,
  MOD_LOOK,
  addingTo,
  destName,
  glyphOf,
} from './editor'
import { DepthKnob, Knob } from './Knob'

/** A routing panel's tint over the dock's glass: sky at 5% */
const ROUTING_TINT = 'rgba(56,189,248,0.05)'

/** A destination whose routes are edited: a part's, by key */
export interface RouteTarget {
  readonly target: string
  readonly key: string
}

/**
 * Where a source goes (docs/plan/sound-chains.md, The editor), in the
 * panel's place while the graph stays in view: the picked tile's knobs
 * that a route can move, each a depth from the source (DepthKnob), turned
 * from Off to route there and back to remove it. Tapping tiles routes the
 * source elsewhere; the tiles it moves wear a sky ring. Opened from a
 * modulator's panel; any source, a note's too, is picked in its header.
 */
export function RoutesFrom({
  engine,
  sound,
  source,
  picked,
  onSource,
  onClose,
}: {
  engine: Engine
  sound: Sound
  source: string
  picked: string
  onSource: (source: string) => void
  onClose: () => void
}) {
  const name = partName(sound, source)
  const target = picked === source || addingTo(picked) ? undefined : picked
  const dests = target === undefined ? [] : partDests(sound, target)
  const title = target === undefined ? undefined : partName(sound, target)

  return (
    <Frame
      label={`Route ${name}`}
      chip={<Chip glyph={glyphOf(sound, source) || GLYPHS.route} />}
      onClose={onClose}
      title={
        <>
          <select
            aria-label="Route from"
            value={source}
            onChange={(event) => onSource(event.target.value)}
            className="h-7 max-w-24 min-w-0 shrink-0 rounded-md bg-white/[0.08] px-1.5 text-[13px] font-semibold text-sky-100"
          >
            {sources(sound).map((each) => (
              <option key={each.id} value={each.id}>
                {each.label}
              </option>
            ))}
          </select>
          {title !== undefined && (
            <>
              <span aria-hidden className="shrink-0 text-sky-300">
                →
              </span>
              <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-100">
                {title}
              </h2>
            </>
          )}
        </>
      }
    >
      {target !== undefined && dests.length > 0 ? (
        <>
          <div className={knobRow(dests.length)}>
            {dests.map((at) => (
              <DepthKnob
                key={`${source} ${target} ${at.key}`}
                engine={engine}
                source={source}
                target={target}
                at={at}
              />
            ))}
          </div>
          <Hint>
            Turn a knob from Off to route {name} there, back to Off (or
            double-tap) to take it away. Tap another tile to route it there.
          </Hint>
        </>
      ) : (
        <Hint>
          {target === undefined
            ? `Tap a tile to route ${name} into its knobs. The tiles ${name} moves wear a sky ring.`
            : `Nothing on ${title ?? ''} can be routed. Tap another tile.`}
        </Hint>
      )}
    </Frame>
  )
}

/**
 * The routes into one destination, in the panel's place: a card per route
 * (its source's knob, in the destination's units; what scales it; its
 * removal), then the sources to add one from, which starts at nothing.
 * Opened by holding a knob. The cards pan sideways under the graph, and
 * wrap in the column beside it, which has the height.
 */
export function RoutesInto({
  engine,
  sound,
  at: { target, key },
  onClose,
}: {
  engine: Engine
  /** The sound as the editor last drew it: its routes, not their amounts */
  sound: Sound
  at: RouteTarget
  onClose: () => void
}) {
  const dest = destOf(sound, target, key)
  const routes = routesTo(sound, target, key)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [added, setAdded] = useState<string | undefined>(undefined)

  // The card a source just added stands in view
  useEffect(() => {
    if (added === undefined) return
    scrollerRef.current
      ?.querySelector(`[data-route="${added}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [added])

  if (!dest) return null
  const title = destName(sound, target, key)
  const all = sources(sound)
  const taken = new Set(routes.map((route) => route.source))
  const full = sound.routes.length >= MAX_ROUTES
  const count = routes.length

  const add = (source: string) => {
    const { sound: next, id } = addRoute(engine.getSound(), {
      source,
      target,
      key,
    })
    if (id === null) return
    engine.setSound(next)
    setAdded(id)
  }

  return (
    <Frame
      label={`Routes into ${title}`}
      chip={<Chip glyph={GLYPHS.route} />}
      onClose={onClose}
      title={
        <>
          <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-100">
            {title}
          </h2>
          <span className="shrink-0 text-[11px] text-zinc-400">
            {count === 0
              ? 'not routed'
              : count === 1
                ? '1 route'
                : `${count} routes`}
          </span>
        </>
      }
    >
      <div
        ref={scrollerRef}
        className="@container flex min-w-0 items-stretch gap-1.5 overflow-x-auto overscroll-x-contain side:flex-wrap"
      >
        {routes.map((route) => {
          const from = partName(sound, route.source)
          return (
            <div
              key={route.id}
              data-route={route.id}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-white/[0.04] py-1.5 pr-1.5 pl-1"
            >
              <Knob
                engine={engine}
                part={route.id}
                knob={ROUTE_AMOUNT}
                color={MOD_COLOR}
                label={from}
                format={(amount) => formatAmount(dest, amount)}
              />
              <div className="flex w-[5.25rem] flex-col gap-1.5">
                <select
                  aria-label={`${from} scaled by`}
                  value={route.via ?? ''}
                  onChange={(event) =>
                    engine.edit((current) =>
                      setRoute(current, route.id, {
                        via: event.target.value || null,
                      })
                    )
                  }
                  className="h-7 w-full min-w-0 rounded-md bg-black/35 px-1.5 text-[11px] text-zinc-200"
                >
                  <option value="">No via</option>
                  {all
                    .filter((source) => source.id !== route.source)
                    .map((source) => (
                      <option key={source.id} value={source.id}>
                        via {source.label}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remove the route from ${from}`}
                  onClick={() =>
                    engine.edit((current) => removePart(current, route.id))
                  }
                  className="h-7 rounded-md bg-red-500/15 text-[11px] font-semibold text-red-200"
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}
        <div
          role="group"
          aria-label={`Route to ${title} from`}
          className="flex shrink-0 flex-col justify-center gap-1 px-0.5"
        >
          <span className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500">
            {count === 0 ? 'FROM' : 'ADD FROM'}
          </span>
          <div className="grid grid-flow-col grid-rows-2 gap-1">
            {all.map((source) => (
              <button
                key={source.id}
                type="button"
                disabled={full || taken.has(source.id)}
                onClick={() => add(source.id)}
                style={{ boxShadow: `inset 0 0 0 1px ${MOD_LOOK.ring}` }}
                className="h-7 min-w-11 rounded-md px-2 text-[11px] font-semibold whitespace-nowrap text-sky-100 disabled:opacity-40"
              >
                {source.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {(count === 0 || full) && (
        <Hint>
          {full
            ? `The sound holds ${MAX_ROUTES} routes, as many as it may.`
            : `Nothing moves ${dest.label} yet: tap what will, then turn its knob.`}
        </Hint>
      )}
    </Frame>
  )
}

/**
 * A routing panel's frame, standing where the part's panel does: sky
 * edged, a header with Done; Escape is Done too, and focus starts there
 */
function Frame({
  label,
  chip,
  title,
  onClose,
  children,
}: {
  label: string
  chip: ReactNode
  title: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const doneRef = useRef<HTMLButtonElement>(null)
  /** The latest onClose, for the listener set up as the panel opens */
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    doneRef.current?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [])
  return (
    <section
      aria-label={label}
      // Tinted and ringed in sky while it routes, over the dock's glass
      style={{
        background: ROUTING_TINT,
        boxShadow: `inset 0 0 0 1px ${MOD_LOOK.ring}`,
      }}
      className="flex min-h-[8.5rem] min-w-0 flex-col gap-2 rounded-xl px-2.5 py-2"
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        {chip}
        {title}
        <button
          ref={doneRef}
          type="button"
          onClick={onClose}
          className={`${SMALL_BUTTON} ml-auto bg-emerald-500/20 text-emerald-200`}
        >
          Done
        </button>
      </div>
      <div className={PANEL_BODY}>{children}</div>
    </section>
  )
}

/** The panel's chip in sky, holding a pictogram */
function Chip({ glyph }: { glyph: string }) {
  return (
    <span
      aria-hidden
      className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px]"
      style={{
        background: '#1c1c23',
        boxShadow: `inset 0 0 0 1.5px ${MOD_LOOK.ring}`,
      }}
    >
      <svg viewBox="0 0 18 12" width={15} height={10}>
        <path
          d={glyph}
          fill="none"
          stroke={MOD_COLOR}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="shrink-0 text-[11px] leading-snug text-zinc-500">
      {children}
    </p>
  )
}
