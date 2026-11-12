import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { Engine } from '../engine/engine'
import { moveItem, movePart } from '../state/sound/edit'
import {
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
} from '../state/sound/kinds'
import {
  AMP,
  VOICE,
  destOf,
  isSource,
  partName,
  type Sound,
} from '../state/sound/sound'
import { MARK, chainDrop, itemDrop, spanDrop } from '../viz/drop'
import {
  GRAPH,
  graphGeometry,
  roomBeside,
  type Box,
  type GraphGeometry,
  type Room,
} from '../viz/graph'
import {
  MOD_LOOK,
  NEUTRAL_LOOK,
  VOICE_LOOK,
  addId,
  chainLetter,
  chainLook,
  glyphOf,
  heardThrough,
  inputLine,
  modulated,
  reachOf,
  shapeKey,
  stillPicked,
  tileLabel,
  tileLine,
  type Look,
} from './editor'
import { CARD, CARD_FACE } from './controls'
import { outlineKind } from './outline'
import { PartPanel } from './PartPanel'
import { Picture } from './Picture'
import { RoutesFrom, RoutesInto, type RouteTarget } from './RoutePanels'
import { Scope, type ScopeStats } from './Scope'
import { useTileDrag, type DragProps, type Spot } from './tileDrag'

/** The output waveform the amp's tile holds, if it shows one */
export interface AmpScope {
  /** Its drawing cost is shown */
  readonly timing: boolean
  readonly onStats?: (stats: ScopeStats) => void
}

/** The graph's background, a card's: tiles are cut from it by a ring of it */
const GROUND = CARD_FACE
/** A tile's face */
const FACE = '#1c1c23'
/** A tile's text: zinc-100 */
const TEXT = '#f4f4f5'
/** A dashed "+" tile's text and outline at rest */
const ADD_TEXT = '#71717a'
const ADD_LINE = 'rgba(255,255,255,0.16)'

const LIMITS = { inputs: MAX_INPUTS, chains: MAX_CHAINS, items: MAX_ITEMS }
/** The space between the rack's tiles (gap-1) */
const RACK_GAP = 4
/** Kept clear between the tiles and the panel over them (gap-3) */
const DOCK_GAP = 12
/**
 * The bar the hidden panel leaves in the dock: beside the graph its width
 * (w-11), under it its height (h-9)
 */
const BAR_BESIDE = 44
const BAR_UNDER = 36
/**
 * The panel, or its bar, standing over the graph's card: frosted glass
 * (index.css), the canvas under it blurred
 */
const DOCKED =
  'glass rounded-xl shadow-[0_0_24px_rgba(0,0,0,0.6)] ring-1 ring-white/10'

/** Where a tile dragged goes: its index, and the chain an item goes into */
type Place = Spot & { readonly to: number; readonly chain?: string }

/** The tile picked, kept for the tab: a reload picks it again */
const PICKED_KEY = 'loopromeda.picked'
/** Kept for the tab too: '0' while the panel is hidden */
const PANEL_KEY = 'loopromeda.panel'

function readPanel(): boolean {
  try {
    return sessionStorage.getItem(PANEL_KEY) !== '0'
  } catch {
    return true
  }
}

function keepPanel(shown: boolean): void {
  try {
    sessionStorage.setItem(PANEL_KEY, shown ? '1' : '0')
  } catch {
    // As with the tile picked: it is hidden all the same
  }
}

function readPicked(): string {
  try {
    return sessionStorage.getItem(PICKED_KEY) ?? ''
  } catch {
    return ''
  }
}

function keepPicked(id: string): void {
  try {
    sessionStorage.setItem(PICKED_KEY, id)
  } catch {
    // A private window may refuse it: the tile is picked all the same
  }
}

/**
 * A source's routes asked for from outside the editor (the mod wheel's
 * Route): each new ask opens them once
 */
export interface RoutesAsked {
  readonly source: string
}

/** What the editor's parts share: the engine, what is picked, picking */
interface Picking {
  readonly engine: Engine
  readonly sound: Sound
  readonly picked: string
  /**
   * Picks id, showing the panel if hidden; a chain's peg picks the chain
   * with the input it is for
   */
  readonly pick: (id: string, input?: string) => void
  /** Picks the tile held to be dragged, leaving the panel as it is */
  readonly hold: (id: string) => void
  /** The tiles in a sky ring: what the picked part reaches (reachOf) */
  readonly reach: ReadonlySet<string>
}

/**
 * The sound as flat tiles flowing left to right (docs/plan/sound-chains.md,
 * The editor): the modulators' rack and the voice above (beside, at the
 * left, on a wider screen), the inputs in a column, a row per chain (its
 * head, its items, the amp at the end of every row), and under it all the
 * panel of the tile picked (beside the graph on a wider screen). Tapping a
 * tile picks it; a peg between an input and a chain picks the chain, its
 * knob for that input lit, and one between an input and the oscillator
 * whose FM reads it picks the input, its knob for that FM lit. The panel
 * stands over the graph's card and hides (its header's last button),
 * showing the canvas under it, the tiles as they were; a bar where it
 * stood brings it back, and so does picking a tile.
 *
 * It redraws when the sound's shape changes (shapeKey: a part added, an
 * input feeding a chain, a wave changed); a knob turning redraws only the
 * knob and the line or peg that shows it.
 *
 * The panel turns to routing in two ways (RoutePanels.tsx). Holding a
 * knob shows the routes into it. A modulator's Route shows the picked
 * tile's knobs as depths from it, while tiles are picked as before; so
 * does asking (asked), for a source with no tile, the mod wheel.
 *
 * Held, a tile lifts to be dragged (tileDrag.ts): an item along its chain
 * or into another, a chain's head (its row with it) up or down, a
 * modulator along the rack. Inputs stand beside the chains they feed, so
 * only the panel moves them.
 */
export function SoundEditor({
  engine,
  scope,
  asked,
}: {
  engine: Engine
  scope?: AmpScope
  asked?: RoutesAsked
}) {
  useSyncExternalStore(engine.subscribeSound, () => shapeKey(engine.getSound()))
  const sound = engine.getSound()
  const [chosen, setChosen] = useState(readPicked)
  const [focus, setFocus] = useState<string | undefined>(undefined)
  const [panel, setPanel] = useState(readPanel)
  const [routing, setRouting] = useState<RouteTarget | null>(null)
  /** The source routed from while tiles are picked, if any */
  const [mapping, setMapping] = useState<string | null>(null)
  /** The panel's dock, for the graph to keep its tiles out from under */
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  // A new ask routes its source, the panel shown: once, as it comes
  const [answered, setAnswered] = useState(asked)
  if (asked !== answered) {
    setAnswered(asked)
    if (asked) {
      setRouting(null)
      setMapping(asked.source)
      setPanel(true)
      keepPanel(true)
    }
  }
  const picked = stillPicked(sound, chosen)
  // Either goes with what it names: a part removed, another preset
  const into =
    routing && destOf(sound, routing.target, routing.key) ? routing : null
  const from = mapping !== null && isSource(sound, mapping) ? mapping : null

  const show = (shown: boolean) => {
    setPanel(shown)
    keepPanel(shown)
  }
  const hold = (id: string) => {
    setChosen(id)
    keepPicked(id)
    setFocus(undefined)
    setRouting(null)
  }
  const pick = (id: string, input?: string) => {
    hold(id)
    setFocus(input)
    if (!panel) show(true)
  }
  const picking: Picking = {
    engine,
    sound,
    picked,
    pick,
    hold,
    reach: reachOf(sound, from ?? picked),
  }
  const closeRoutes = () => setRouting(null)
  const closeMap = () => setMapping(null)
  const route = (target: string, key: string) => {
    setMapping(null)
    setRouting({ target, key })
  }
  /** Routes source from here on, into target's knobs if given */
  const map = (source: string, target?: string) => {
    setRouting(null)
    setMapping(source)
    if (target !== undefined) pick(target)
  }

  // Under the graph, the panel stands at one height whatever is picked,
  // so the keys below it stay put: 7.5rem and a knob (--knob, KNOB_SIZE)
  // hold the tallest panel most parts make (a header, a row of chains or
  // routes, a row of knobs), and more scrolls in it. The knob is 48 px, or
  // on a wider screen held upright (a Fold open) up to 72 px with the
  // width, the keys giving up the height. Short of room, the graph gives
  // way first, down to a row of tiles; the panel shrinks only past that
  // (its room: all but the graph's least and the gap). Beside the graph,
  // the panel takes the graph's height and never makes the row taller: it
  // scrolls instead, its knobs at 48 px. It is 22rem wide, and on a wider
  // screen a little over a third of the row, up to 40rem. Both fill the
  // height the page gives the editor beside (App.tsx: what the keys
  // leave), the tiles at the top of theirs, and the graph pans only past
  // it. On a wide
  // one (index.css) the panel stands under the graph again, the whole
  // width, its knobs 72 px in a row over the keys (knobRow), and the graph
  // takes the rest of the height. Held upright, the rack stands over the
  // graph; beside (index.css: a wider screen, or a phone on its side,
  // whose graph has width to spare and little height), it stands at its
  // left, a column, and the panel at the graph's right.
  //
  // The panel stands over the graph's card, a dock (dock), not beside
  // it: the card fills the editor and the tiles keep to the room the dock
  // leaves them (roomBeside), so hiding the panel moves nothing else. The
  // editor asks the page for the same height either way (--dock, what the
  // graph's frame asks besides its own), so the keys under it stay put
  // too. Hidden, the dock keeps its place and holds only a bar at its
  // bottom, or at its right beside (the panel's own side: a short screen
  // has no height for a bar). Under the graph the tiles keep clear of the
  // whole dock, the canvas they leave showing where the panel stood when
  // it hides; beside it, only of the bar, the panel standing over the
  // last of them, shown. Either way the frame pans them out from under
  // the panel or the bar, and showing it resizes nothing.
  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col [--dock:calc(7.5rem_+_var(--knob)_+_0.75rem)] [--knob:clamp(3rem,calc((100vw_-_4.5rem)/8.5),4.5rem)] side:[--dock:0px] side:[--knob:3rem] wide:[--knob:4.5rem]">
      <section
        aria-label="The sound, flowing left to right"
        className={`flex min-h-[8rem] min-w-0 flex-1 flex-col overflow-hidden side:flex-row ${CARD}`}
      >
        <Rack {...picking} source={from} />
        <Graph
          {...picking}
          focus={picked === chosen ? focus : undefined}
          scope={scope}
          dock={dock}
          docked={panel}
        />
      </section>
      <div
        ref={setDock}
        className={`absolute inset-x-0 bottom-0 z-20 h-[calc(7.5rem_+_var(--knob))] max-h-[calc(100%-8.75rem)] min-h-0 side:inset-y-0 side:right-0 side:left-auto side:h-auto side:max-h-none side:w-[clamp(22rem,36%,40rem)] wide:top-auto wide:left-0 wide:h-[calc(7.5rem_+_var(--knob))] wide:max-h-[calc(100%-8.75rem)] wide:w-auto ${panel ? `grid overflow-y-auto overscroll-contain ${DOCKED}` : 'pointer-events-none'}`}
      >
        {!panel && (
          <button
            type="button"
            aria-label={`Show the knobs: ${partName(sound, picked)}`}
            onClick={() => show(true)}
            className={`pointer-events-auto absolute inset-x-0 bottom-0 flex h-9 items-center gap-2 px-3 text-left side:inset-x-auto side:inset-y-0 side:right-0 side:h-auto side:w-11 side:justify-center side:px-0 wide:inset-x-0 wide:top-auto wide:h-9 wide:w-auto wide:justify-start wide:px-3 ${DOCKED}`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 text-zinc-300 side:-rotate-90 wide:rotate-0"
            >
              <path d="M4 11l5-5 5 5" />
            </svg>
            <span
              aria-hidden
              className="text-xs font-semibold text-zinc-200 side:hidden wide:inline"
            >
              Show the knobs
            </span>
            <span
              aria-hidden
              className="min-w-0 truncate text-[11px] text-zinc-400 side:hidden wide:inline"
            >
              {partName(sound, picked)}
            </span>
          </button>
        )}
        {panel &&
          (into ? (
            <RoutesInto
              engine={engine}
              sound={sound}
              at={into}
              onClose={closeRoutes}
            />
          ) : from !== null ? (
            <RoutesFrom
              engine={engine}
              sound={sound}
              source={from}
              picked={picked}
              onSource={setMapping}
              onClose={closeMap}
            />
          ) : (
            <PartPanel
              {...picking}
              focus={picked === chosen ? focus : undefined}
              onRoute={route}
              onMap={map}
              onHide={() => show(false)}
            />
          ))}
      </div>
    </div>
  )
}

/**
 * The voice first, a block over the inputs, whose pitch it sets: where a
 * note comes in, its mode under its name. Then the modulators in a row,
 * each a block drawing its shape, and a "+" while there is room. Held
 * upright its tiles stand as tall as the graph's (44 px), wider than
 * tall; beside the graph, 56 px squares, and on a short screen (a phone
 * on its side) 56 by 44, for more of them to show. The row scrolls under
 * the voice, which clips at its padding: there is room in it for a tile's
 * rings (a reach ring stands 3.5 px out). Beside the graph (a wider
 * screen, a phone on its side) it is a column at the graph's left, the
 * voice on top, scrolling down
 * (it asks no height of the card: the graph sets that). The source being
 * routed from is outlined in sky. A modulator dragged moves along it.
 */
function Rack({
  engine,
  sound,
  picked,
  pick,
  hold,
  reach,
  source,
}: Picking & { source: string | null }) {
  const routed = modulated(sound)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  /** Whether the rack stands as a column, read as a drag starts */
  const downRef = useRef(false)
  const drag = useTileDrag<Place>({
    scroller: scrollerRef,
    content: contentRef,
    marker: markerRef,
    axis: () => {
      const content = contentRef.current
      downRef.current =
        content !== null && getComputedStyle(content).flexDirection === 'column'
      return downRef.current ? 'y' : 'x'
    },
    // Measured: the tiles stand in a row (or a column) of their own sizes
    locate: (id, x, y) => {
      const down = downRef.current
      const tiles = Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>('[data-drag]') ?? []
      )
      const from = tiles.findIndex((tile) => tile.dataset.drag === id)
      const tile = tiles[from]
      const spans = tiles.map((each) =>
        down
          ? { start: each.offsetTop, end: each.offsetTop + each.offsetHeight }
          : { start: each.offsetLeft, end: each.offsetLeft + each.offsetWidth }
      )
      const at = tile && spanDrop(spans, from, down ? y : x, RACK_GAP, 0)
      if (!tile || !at) return undefined
      const seam = at.middle - MARK / 2
      return {
        to: at.to,
        color: MOD_LOOK.ink,
        marker: down
          ? { x: tile.offsetLeft, y: seam, w: tile.offsetWidth, h: MARK }
          : { x: seam, y: tile.offsetTop, w: MARK, h: tile.offsetHeight },
      }
    },
    drop: (id, at) => engine.edit((current) => movePart(current, id, at.to)),
    lift: (id) => hold(id),
  })
  return (
    <div className="mx-2 mt-2 mb-1 flex h-14 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.03] pr-0.5 pl-1.5 side:mr-1 side:mb-2 side:h-auto side:w-[4.25rem] side:flex-col side:px-0 side:pt-1.5 side:pb-0.5">
      <Tile
        engine={engine}
        label="Voice"
        line={VOICE}
        look={VOICE_LOOK}
        picked={picked === VOICE}
        routed={routed.has(VOICE)}
        reach={reach.has(VOICE)}
        aria="Voice"
        onClick={() => pick(VOICE)}
        className="h-11 w-14 shrink-0 side:size-14 short:h-11"
        small
      />
      <span
        aria-hidden
        className="h-8 w-px shrink-0 bg-white/10 side:h-px side:w-10"
      />
      <div
        ref={scrollerRef}
        aria-label="Modulators"
        className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain px-1 py-1.5 side:min-h-0 side:basis-0 side:flex-col side:self-stretch side:overflow-x-hidden side:overflow-y-auto side:overscroll-y-contain side:px-1.5 side:py-1"
      >
        <div
          ref={contentRef}
          className="relative flex shrink-0 gap-1 side:flex-col"
        >
          {sound.modulators.map((modulator) => (
            <Tile
              key={modulator.id}
              engine={engine}
              drag={drag(modulator.id)}
              label={tileLabel(sound, modulator.id)}
              look={MOD_LOOK}
              picked={picked === modulator.id}
              member={source === modulator.id}
              reach={reach.has(modulator.id)}
              routed={routed.has(modulator.id)}
              aria={partName(sound, modulator.id)}
              onClick={() => pick(modulator.id)}
              // A block, its shape under its name, as its knobs turn
              picture={modulator.id}
              stacked
              className="h-11 w-16 shrink-0 side:size-14 short:h-11"
              small
            />
          ))}
          {sound.modulators.length < MAX_MODULATORS && (
            <Tile
              engine={engine}
              label="+"
              look={MOD_LOOK}
              picked={picked === addId('modulator')}
              dashed="add"
              aria="Add a modulator"
              onClick={() => pick(addId('modulator'))}
              className="h-11 w-7 shrink-0 side:h-7 side:w-14"
              small
            />
          )}
          <Marker ref={markerRef} />
        </div>
      </div>
    </div>
  )
}

/**
 * The inputs, the chains and the amp, laid out by graphGeometry: the
 * tiles share the frame's width, the amp holding the output waveform over
 * its envelope (the envelope alone when it has no waveform). The frame
 * takes the room the page leaves it, up to a cap, the tiles what the
 * panel's dock over it leaves of that (beside, what its bar leaves, the
 * panel standing over the last of them), and it pans what it cannot
 * show.
 */
function Graph({
  engine,
  sound,
  picked,
  pick,
  hold,
  reach,
  focus,
  scope,
  dock,
  docked,
}: Picking & {
  focus: string | undefined
  scope: AmpScope | undefined
  /** The panel's dock, over the frame: the tiles keep to what it leaves */
  dock: HTMLElement | null
  /**
   * Whether the panel is in it: the frame pans the tiles from under it,
   * or with the panel hidden from under its bar
   */
  docked: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  /** The room the frame leaves the tiles, measured: 0 until it is */
  const [room, setRoom] = useState<Room>({ w: 0, h: 0, right: 0, bottom: 0 })
  useLayoutEffect(() => {
    const element = frameRef.current
    if (!element) return
    const measure = () => {
      // The frame inside its scrollbars, and the dock where it stands
      const at = element.getBoundingClientRect()
      const frame = {
        left: at.left,
        top: at.top,
        right: at.left + element.clientWidth,
        bottom: at.top + element.clientHeight,
      }
      // Beside, the tiles keep clear of the panel's bar, shown or hidden
      const next = roomBeside(
        frame,
        dock?.getBoundingClientRect(),
        DOCK_GAP,
        BAR_BESIDE
      )
      setRoom((was) =>
        was.w === next.w &&
        was.h === next.h &&
        was.right === next.right &&
        was.bottom === next.bottom
          ? was
          : next
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (dock) observer.observe(dock)
    return () => observer.disconnect()
  }, [dock])
  const geometry = graphGeometry(
    sound,
    LIMITS,
    room.w || undefined,
    room.h || undefined
  )
  const showScope = scope !== undefined && geometry.amp.w >= GRAPH.ampFill
  const routed = modulated(sound)
  /** The chain each item stands in, for its look and its neighbours */
  const chainOf = new Map<string, number>()
  sound.chains.forEach((chain, c) => {
    chainOf.set(chain.id, c)
    for (const item of chain.items) chainOf.set(item.id, c)
  })
  const isChain = (id: string) => sound.chains.some((chain) => chain.id === id)
  const contentRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const drag = useTileDrag<Place>({
    scroller: frameRef,
    content: contentRef,
    marker: markerRef,
    axis: (id) => (isChain(id) ? 'y' : 'xy'),
    // A chain's head takes its row along: everything marked with its id
    moving: (id, tile) =>
      isChain(id)
        ? Array.from(
            contentRef.current?.querySelectorAll<HTMLElement>(
              `[data-row="${id}"]`
            ) ?? []
          )
        : [tile],
    // Marked in the colour of the chain moved, or the item's new one
    locate: (id, x, y) => {
      const ink = (chain: string) => chainLook(chainOf.get(chain) ?? 0).ink
      if (isChain(id)) {
        const at = chainDrop(geometry, id, y)
        return at && { ...at, color: ink(id) }
      }
      const at = itemDrop(geometry, id, x, y, MAX_ITEMS)
      return at && { ...at, color: ink(at.chain) }
    },
    drop: (id, at) =>
      engine.edit((current) =>
        at.chain === undefined
          ? movePart(current, id, at.to)
          : moveItem(current, id, at.chain, at.to)
      ),
    lift: (id) => hold(id),
  })

  /** How far past the tiles the frame pans, of reach the dock covers */
  const clear = (reach: number, bar: number) =>
    reach > 0 ? (docked ? reach : Math.min(reach, bar + DOCK_GAP)) : 0

  return (
    <div
      ref={frameRef}
      // Held upright, its height at rest is what it asks of the card, the
      // slots grown or not (at most 45% of the screen, and the panel's
      // dock under the tiles besides): a card given more grows it. Beside
      // the rack and the panel, it takes the card's height, the editor
      // filling what the keys leave. The slots fill what the dock leaves.
      style={{ '--rest': `${geometry.rest}px` } as CSSProperties}
      className="relative min-h-0 grow basis-[calc(min(var(--rest),22rem,45dvh)_+_var(--dock,0px))] overflow-auto overscroll-contain side:min-w-0 side:basis-0"
    >
      {/* Room to pan the tiles out from under the panel over the frame,
          or from under its bar with the panel hidden */}
      {(room.right > 0 || room.bottom > 0) && (
        <span
          aria-hidden
          className="pointer-events-none absolute size-px"
          style={{
            left: geometry.width + clear(room.right, BAR_BESIDE) - 1,
            top: geometry.height + clear(room.bottom, BAR_UNDER) - 1,
          }}
        />
      )}
      <div
        ref={contentRef}
        className="relative min-w-full"
        style={{ width: geometry.width, height: geometry.height }}
      >
        {geometry.inputs.map((tile) => {
          const into = tile.chains.map((chain) => chainOf.get(chain) ?? 0)
          if (tile.copy && tile.column > 0) {
            // Beside readers, as the inputs' column is: neutral
            const readers = tile.readers
              .map((reader) => {
                const ring = sound.inputs.some(
                  (input) => input.id === reader && input.kind === 'ring'
                )
                return `${partName(sound, reader)}'s ${ring ? 'ring' : 'FM'}`
              })
              .join(' and ')
            return (
              <Tile
                key={`${tile.input}<${tile.column} ${tile.first}`}
                engine={engine}
                label={tileLabel(sound, tile.input)}
                glyph={glyphOf(sound, tile.input)}
                look={NEUTRAL_LOOK}
                picked={picked === tile.input}
                dashed="copy"
                aria={`${partName(sound, tile.input)} again: the same input, into ${readers}`}
                onClick={() => pick(tile.input)}
                style={place(tile.box)}
              />
            )
          }
          if (tile.copy) {
            const c = into[0] ?? 0
            return (
              <Tile
                key={`${tile.input}@${tile.chains[0]}`}
                engine={engine}
                label={tileLabel(sound, tile.input)}
                glyph={glyphOf(sound, tile.input)}
                look={chainLook(c)}
                picked={picked === tile.input}
                dashed="copy"
                aria={`${partName(sound, tile.input)} again: the same input, into chain ${chainLetter(c)}`}
                onClick={() => pick(tile.input)}
                style={place(tile.box)}
              />
            )
          }
          const feeds = sound.chains.flatMap((chain, c) =>
            (chain.sends[tile.input] ?? 0) > 0 ? [c] : []
          )
          const through = heardThrough(sound, tile.input)
          return (
            <Tile
              key={tile.input}
              engine={engine}
              label={tileLabel(sound, tile.input)}
              // A source's column has no room for a line: its pegs say
              // where it goes
              line={
                tile.box.h >= 60 && tile.column === 0 ? tile.input : undefined
              }
              glyph={glyphOf(sound, tile.input)}
              look={NEUTRAL_LOOK}
              picked={picked === tile.input}
              reach={reach.has(tile.input)}
              routed={routed.has(tile.input)}
              dots={feeds.map((c) => chainLook(c).ink)}
              aria={`${partName(sound, tile.input)}, ${inputLine(sound, tile.input)}${
                feeds.length > 0
                  ? `, into ${feeds.map(chainLetter).join(' and ')}`
                  : through
                    ? `, into no chain, heard through ${through}`
                    : ', into nothing'
              }`}
              onClick={() => pick(tile.input)}
              style={place(tile.box)}
            />
          )
        })}

        {geometry.bus && (
          // Down the seam before the amp, under the chains' level pegs
          <span
            aria-hidden
            className="pointer-events-none absolute z-[2] w-0.5 rounded-full"
            style={{
              left: geometry.bus.x - 1,
              top: geometry.bus.y,
              height: geometry.bus.h,
              background: NEUTRAL_LOOK.ring,
            }}
          />
        )}
        {geometry.chains.map((row, c) => {
          const chain = sound.chains[c]
          if (!chain) return null
          const look = chainLook(c)
          const letter = chainLetter(c)
          const member = picked === chain.id
          // Each seam's neighbours: the head or an item, then an item or
          // the amp; a seam lights when either side is picked
          const parts = [chain.id, ...chain.items.map((item) => item.id), AMP]
          const lit = (k: number) =>
            member || picked === parts[k] || picked === parts[k + 1]
          const cy = row.row.y + row.row.h / 2
          const last = row.joints.length - 1
          return (
            <div key={chain.id} className="contents">
              <Tile
                engine={engine}
                drag={drag(chain.id)}
                row={chain.id}
                label=""
                mark={letter}
                line={chain.id}
                look={look}
                picked={member}
                reach={reach.has(chain.id)}
                routed={routed.has(chain.id)}
                aria={`Chain ${letter}`}
                onClick={() => pick(chain.id)}
                style={place(row.head)}
              />
              {row.items.map(({ item, box }) => (
                <Tile
                  key={item}
                  engine={engine}
                  drag={drag(item)}
                  row={chain.id}
                  label={tileLabel(sound, item)}
                  line={item}
                  glyph={box.h >= 60 ? glyphOf(sound, item) : undefined}
                  picture={outlineKind(sound, item) ? item : undefined}
                  look={look}
                  picked={picked === item}
                  member={member}
                  reach={reach.has(item)}
                  routed={routed.has(item)}
                  aria={`${partName(sound, item)}, ${tileLine(sound, item)}`}
                  onClick={() => pick(item)}
                  style={place(box)}
                />
              ))}
              {row.add && (
                <Tile
                  engine={engine}
                  row={chain.id}
                  label={row.add.w < 60 ? '+' : '+ Item'}
                  look={look}
                  picked={picked === addId(chain.id)}
                  member={member}
                  dashed="add"
                  aria={`Add an item to chain ${letter}`}
                  onClick={() => pick(addId(chain.id))}
                  style={place(row.add)}
                />
              )}
              {row.joints.slice(0, last).map((x, k) => (
                <Joint
                  key={x}
                  row={chain.id}
                  x={x}
                  y={cy}
                  height={18}
                  look={look}
                  lit={lit(k)}
                />
              ))}
              <LevelJoint
                engine={engine}
                chain={chain.id}
                row={chain.id}
                x={row.joints[last] ?? 0}
                y={cy}
                look={look}
                lit={lit(last)}
              />
            </div>
          )
        })}

        <Tile
          engine={engine}
          label="Amp"
          line={AMP}
          glyph={geometry.amp.h >= 60 ? glyphOf(sound, AMP) : undefined}
          picture={showScope ? undefined : AMP}
          look={NEUTRAL_LOOK}
          picked={picked === AMP}
          reach={reach.has(AMP)}
          routed={routed.has(AMP)}
          aria="Amp, out"
          onClick={() => pick(AMP)}
          style={place(geometry.amp)}
          aside={
            showScope && (
              <Scope
                engine={engine}
                timing={scope.timing}
                onStats={scope.onStats}
                className="h-full min-w-0 flex-1 rounded-[4px]"
                picture={AMP}
                pictureColor={NEUTRAL_LOOK.ink}
              />
            )
          }
        />
        {geometry.addInput && (
          <Tile
            engine={engine}
            label="+ Input"
            look={NEUTRAL_LOOK}
            picked={picked === addId('input')}
            dashed="add"
            aria="Add an input"
            onClick={() => pick(addId('input'))}
            style={place(geometry.addInput)}
          />
        )}
        {geometry.addChain && (
          <Tile
            engine={engine}
            label="+ Chain"
            look={chainLook(sound.chains.length)}
            picked={picked === addId('chain')}
            dashed="add"
            aria="Add a chain"
            onClick={() => pick(addId('chain'))}
            style={place(geometry.addChain)}
          />
        )}

        {geometry.reads.map((peg) => (
          <ReadPeg
            key={`${peg.from}>${peg.to}`}
            engine={engine}
            peg={peg}
            lit={picked === peg.from || picked === peg.to}
            focused={picked === peg.from && focus === peg.to}
            // FM: the input read, its knob for the reader marked; a ring's
            // side has no amount of its own, so the ring
            onClick={() =>
              peg.as === 'FM' ? pick(peg.from, peg.to) : pick(peg.to)
            }
          />
        ))}
        {geometry.pegs.map((peg) => {
          const c = chainOf.get(peg.chain) ?? 0
          return (
            <SendPeg
              key={`${peg.input}>${peg.chain}`}
              engine={engine}
              input={peg.input}
              chain={peg.chain}
              x={peg.x}
              y={peg.y}
              look={chainLook(c)}
              lit={picked === peg.input || picked === peg.chain}
              focused={picked === peg.chain && focus === peg.input}
              onClick={() => pick(peg.chain, peg.input)}
            />
          )
        })}
        <Marker ref={markerRef} />
      </div>
    </div>
  )
}

/**
 * Where a tile dragged would go: a bar on a seam, placed and coloured by
 * the drag (tileDrag.ts), hidden until then
 */
function Marker({ ref }: { ref: RefObject<HTMLSpanElement | null> }) {
  return (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute z-[9] hidden rounded-full"
    />
  )
}

/** A box as absolute position and size */
function place(box: Box): CSSProperties {
  return {
    position: 'absolute',
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
  }
}

/** What follows the sound live: a tile's line, a peg's length */
function useLive<T extends string | number>(
  engine: Engine,
  read: (sound: Sound) => T
): T {
  return useSyncExternalStore(engine.subscribeSound, () =>
    read(engine.getSound())
  )
}

/** A tile's line, as its knobs move: for part id */
function Line({ engine, id }: { engine: Engine; id: string }) {
  return useLive(engine, (sound) => tileLine(sound, id))
}

/** A pill's length for a level 0..1: 10 px at none, 28 at full */
const pegLength = (level: number) => 10 + 18 * level
/** A pill's opacity for a level, unless lit */
const pegOpacity = (level: number) => 0.35 + 0.65 * level

/** A pill on a seam, cut from the ground; it glows when lit */
function pillStyle(look: Look, lit: boolean, ring = false): CSSProperties {
  return {
    background: look.ink,
    boxShadow: `0 0 0 2px ${GROUND}${ring ? `, 0 0 0 4px ${look.ink}` : lit ? `, 0 0 10px ${look.ink}` : ''}`,
  }
}

/**
 * A read's peg, on the seam between an input read and its reader: as long
 * as the reader's FM (a ring's side, full), as a send's peg is as long as
 * its send. Tapped, it picks as onClick says.
 */
function ReadPeg({
  engine,
  peg,
  lit,
  focused,
  onClick,
}: {
  engine: Engine
  peg: GraphGeometry['reads'][number]
  lit: boolean
  focused: boolean
  onClick: () => void
}) {
  const level = useLive(engine, (sound) =>
    peg.as === 'FM'
      ? (sound.inputs.find((input) => input.id === peg.to)?.values.fm ?? 0)
      : 1
  )
  const sound = engine.getSound()
  const from = partName(sound, peg.from)
  const to = partName(sound, peg.to)
  const label =
    peg.as === 'FM'
      ? `${from} into ${to}'s FM, ${Math.round(level * 100)}%. Tap to set it.`
      : `${from} into ${to}, a side of its ring`
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute z-[3] flex h-11 w-5 items-center justify-center"
      style={{ left: peg.x - 10, top: peg.y - 22 }}
    >
      <span
        className="block w-2 rounded"
        style={{
          height: pegLength(level),
          opacity: lit || focused ? 1 : pegOpacity(level),
          ...pillStyle(NEUTRAL_LOOK, lit, focused),
        }}
      />
    </button>
  )
}

/** The joint between two tiles of a chain */
function Joint({
  row,
  x,
  y,
  height,
  look,
  lit,
}: {
  /** The chain whose row it moves with */
  row: string
  x: number
  y: number
  height: number
  look: Look
  lit: boolean
}) {
  return (
    <span
      aria-hidden
      data-row={row}
      className="pointer-events-none absolute z-[3] w-2 rounded"
      style={{
        left: x - 4,
        top: y - height / 2,
        height,
        opacity: lit ? 1 : 0.8,
        ...pillStyle(look, lit),
      }}
    />
  )
}

/** The joint before the amp: as long as the chain's level */
function LevelJoint({
  engine,
  chain,
  row,
  x,
  y,
  look,
  lit,
}: {
  engine: Engine
  chain: string
  /** The chain whose row it moves with */
  row: string
  x: number
  y: number
  look: Look
  lit: boolean
}) {
  const level = useLive(engine, (sound) => {
    return sound.chains.find((each) => each.id === chain)?.values.level ?? 0
  })
  const height = pegLength(level)
  return (
    <span
      aria-hidden
      data-row={row}
      className="pointer-events-none absolute z-[3] w-2 rounded"
      style={{
        left: x - 4,
        top: y - height / 2,
        height,
        opacity: lit ? 1 : pegOpacity(level),
        ...pillStyle(look, lit),
      }}
    />
  )
}

/** A send's peg: as long as the send; a tap picks its chain */
function SendPeg({
  engine,
  input,
  chain,
  x,
  y,
  look,
  lit,
  focused,
  onClick,
}: {
  engine: Engine
  input: string
  chain: string
  x: number
  y: number
  look: Look
  lit: boolean
  focused: boolean
  onClick: () => void
}) {
  const level = useLive(engine, (sound) => {
    return sound.chains.find((each) => each.id === chain)?.sends[input] ?? 0
  })
  const sound = engine.getSound()
  const label = `${partName(sound, input)} into ${partName(sound, chain)}, ${Math.round(level * 100)}%. Tap to set it.`
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute z-[3] flex h-11 w-5 items-center justify-center"
      style={{ left: x - 10, top: y - 22 }}
    >
      <span
        className="block w-2 rounded"
        style={{
          height: pegLength(level),
          opacity: lit || focused ? 1 : pegOpacity(level),
          ...pillStyle(look, lit, focused),
        }}
      />
    </button>
  )
}

/**
 * One tile: flat, its face cut from the ground, outlined by a ring in its
 * look. Picked, the ring is heavier and the face takes the tint; a member
 * of the picked chain is outlined in its ink; reached by the modulation
 * picked, a sky ring stands outside it. Dashed: a "+" that adds, or a
 * copy of an input standing in another chain's row. Given drag, it is
 * held to be dragged (tileDrag.ts). Given a picture, it draws that part's
 * (outline.ts) in its ink, live, in place of its pictogram: under the
 * label in a tall tile (two slots and up), its line and the area under
 * it; behind the label in a short one, the area alone, so that no line
 * runs through the letters. Either way it stands 3 px inside the tile's
 * edges, its corners rounded as the tile's.
 */
function Tile({
  engine,
  drag,
  row,
  label,
  line,
  glyph,
  mark,
  look,
  picked = false,
  member = false,
  reach = false,
  routed = false,
  dots,
  dashed,
  aria,
  onClick,
  style,
  className = '',
  small = false,
  aside,
  picture,
  stacked = false,
}: {
  engine: Engine
  drag?: DragProps
  /** The chain whose row it moves with, when that is dragged */
  row?: string
  label: string
  /** The part whose line (tileLine) shows under the label, live */
  line?: string
  glyph?: string
  /** A chain's letter, large, in its ink */
  mark?: string
  look: Look
  picked?: boolean
  member?: boolean
  reach?: boolean
  routed?: boolean
  dots?: readonly string[]
  dashed?: 'add' | 'copy'
  aria: string
  onClick: () => void
  style?: CSSProperties
  className?: string
  small?: boolean
  /**
   * Beside the label, filling the rest of the tile 3 px inside its edges,
   * as a picture does (round it at 4 px): the amp's waveform
   */
  aside?: ReactNode
  /** The part whose picture fills the tile: a filter's response, a drive's */
  picture?: string
  /** Its picture under its label however tall it is: a modulator's block */
  stacked?: boolean
}) {
  const height = typeof style?.height === 'number' ? style.height : 26
  const width = typeof style?.width === 'number' ? style.width : Infinity
  const tall = !dashed && !small && height >= 60
  const under = picture !== undefined && (tall || stacked)
  // A picture stands in for the pictogram
  const pictogram = picture === undefined ? glyph : undefined
  // A short tile stacks a line under its label only without a pictogram;
  // a narrow one (a source's) its pictogram over it
  const column =
    under ||
    tall ||
    width < 64 ||
    mark !== undefined ||
    (line !== undefined && !pictogram)

  let shadow = `inset 0 0 0 1.5px ${look.ring}`
  if (picked) shadow = `inset 0 0 0 2px ${look.ink}, 0 0 0 3px ${look.tint}`
  else if (member) shadow = `inset 0 0 0 1.5px ${look.ink}`
  if (!picked && reach)
    shadow += `, 0 0 0 2px ${GROUND}, 0 0 0 3.5px ${MOD_LOOK.ink}`

  const face: CSSProperties =
    dashed === undefined
      ? {
          background: picked
            ? `linear-gradient(${look.tint}, ${look.tint}), ${FACE}`
            : FACE,
          boxShadow: shadow,
          color: TEXT,
        }
      : {
          border: `1.5px dashed ${
            dashed === 'copy'
              ? picked
                ? look.ink
                : look.ring
              : picked
                ? look.ink
                : member
                  ? look.ring
                  : ADD_LINE
          }`,
          background: picked ? look.tint : 'transparent',
          color:
            dashed === 'copy'
              ? picked
                ? '#fafafa'
                : '#d4d4d8'
              : picked
                ? look.ink
                : ADD_TEXT,
        }

  let content: ReactNode
  if (mark !== undefined) {
    content = (
      <>
        <span
          aria-hidden
          className="text-lg leading-none font-extrabold"
          style={{ color: look.ink }}
        >
          {mark}
        </span>
        {line !== undefined && (
          <span className="font-mono text-[10px] leading-tight whitespace-nowrap text-zinc-400">
            <Line engine={engine} id={line} />
          </span>
        )}
      </>
    )
  } else {
    content = (
      <>
        {pictogram && (
          <svg
            viewBox="0 0 18 12"
            width={tall ? 22 : small ? 15 : 18}
            height={tall ? 15 : small ? 10 : 12}
            aria-hidden
            className="shrink-0"
            style={{ opacity: dashed === 'copy' && !picked ? 0.6 : 1 }}
          >
            <path
              d={pictogram}
              fill="none"
              stroke={look.ink}
              strokeWidth={tall ? 1.7 : 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span
          className={`flex min-w-0 flex-col ${column ? 'items-center' : 'items-start'}`}
        >
          <span
            className={`${small ? 'text-[11px]' : 'text-xs'} leading-tight font-semibold whitespace-nowrap`}
          >
            {label}
          </span>
          {line !== undefined && (
            <span className="font-mono text-[10px] leading-tight whitespace-nowrap text-zinc-400">
              <Line engine={engine} id={line} />
            </span>
          )}
          {dots && dots.length > 0 && (
            <span aria-hidden className="mt-[3px] flex gap-[3px]">
              {dots.map((color, k) => (
                <span
                  key={k}
                  className="size-1.5 rounded-full"
                  style={{ background: color }}
                />
              ))}
            </span>
          )}
        </span>
      </>
    )
  }

  return (
    <button
      type="button"
      {...drag}
      data-row={row}
      aria-label={aria}
      aria-pressed={picked}
      onClick={onClick}
      style={{
        ...style,
        ...face,
      }}
      className={`relative flex items-center overflow-hidden rounded-[7px] ${
        aside
          ? 'justify-start gap-2 py-[3px] pr-[3px] pl-2'
          : under
            ? tall
              ? 'flex-col justify-start gap-1 px-[3px] pt-2.5 pb-[3px]'
              : 'flex-col justify-start gap-[3px] px-[3px] pt-1.5 pb-[3px]'
            : `justify-center ${column ? 'flex-col gap-1 px-1' : 'gap-[7px] px-1.5'}`
      } ${picked ? 'z-[2]' : 'z-[1]'} ${className}`}
    >
      {picture !== undefined && !under && (
        // Behind the label: on the face, inside the ring, under the content
        <Picture
          engine={engine}
          part={picture}
          color={look.ink}
          lineOpacity={0}
          fillOpacity={0.16}
          className="absolute top-[3px] left-[3px] -z-10 size-[calc(100%-6px)] rounded-[4px]"
        />
      )}
      {aside ? (
        <>
          <span className="flex shrink-0 flex-col items-center gap-1">
            {content}
          </span>
          {aside}
        </>
      ) : (
        content
      )}
      {picture !== undefined && under && (
        <Picture
          engine={engine}
          part={picture}
          color={look.ink}
          className="min-h-0 w-full flex-1 rounded-[4px]"
        />
      )}
      {routed && (
        <span
          aria-hidden
          className="absolute top-[5px] right-[5px] size-1.5 rounded-full"
          style={{ background: MOD_LOOK.ink }}
        />
      )}
    </button>
  )
}
