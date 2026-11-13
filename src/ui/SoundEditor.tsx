import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { Engine, OutputSource } from '../engine/engine'
import { PAD_NOTE, padName } from '../state/kit'
import type { Library } from '../state/library'
import { moveItem, movePart } from '../state/sound/edit'
import {
  EFFECT_KINDS,
  MAX_BUSES,
  MAX_CHAINS,
  MAX_EFFECTS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
} from '../state/sound/kinds'
import {
  MASTER,
  busLetter,
  busName,
  findMixPart,
  mixValue,
  stripId,
} from '../state/mix'
import { MAX_TRACKS, trackName, tracksKey } from '../state/tracks'
import {
  AMP,
  SENDS,
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
import { noteName } from '../viz/keyboard'
import { kitGeometry } from '../viz/kitGraph'
import { mixGeometry, type EffectBox, type MixPeg } from '../viz/mixGraph'
import {
  MOD_LOOK,
  NEUTRAL_LOOK,
  PAD_TILE,
  VOICE_LOOK,
  addId,
  busLook,
  chainLetter,
  chainLook,
  EFFECT_GLYPHS,
  glyphOf,
  heardThrough,
  inputLine,
  mixAddId,
  mixId,
  mixLine,
  mixPartName,
  mixShapeKey,
  modulated,
  pickedName,
  reachOf,
  shapeKey,
  stillKitPicked,
  stillMixPicked,
  stillPicked,
  tileLabel,
  tileLine,
  type Look,
} from './editor'
import { CARD, CARD_FACE, RAISED } from './controls'
import {
  MasterView,
  Meters,
  keepView,
  readView,
  type MasterViewKind,
} from './MasterViews'
import { outlineKind } from './outline'
import { PartPanel } from './PartPanel'
import { Picture } from './Picture'
import { RoutesFrom, RoutesInto, type RouteTarget } from './RoutePanels'
import type { ScopeStats } from './Scope'
import { useTileDrag, type DragProps, type Spot } from './tileDrag'

/** The output's view the Out and the Master hold, if they show one */
export interface OutputViews {
  /** The scope's drawing cost is shown */
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

const LIMITS = {
  inputs: MAX_INPUTS,
  chains: MAX_CHAINS,
  items: MAX_ITEMS,
  effects: MAX_EFFECTS,
}
/** The space between the rack's tiles (gap-1) */
const RACK_GAP = 4
/**
 * Kept clear between the tiles and the panel over them, past the graph's
 * own end (GRAPH.end, 8): nothing more, so they stand 8 apart as the rack
 * and the tiles do
 */
const DOCK_GAP = 0
/** How far in the dock stands from the card's edges (2): the rack's too */
const DOCK_INSET = 8
/**
 * The bar the hidden panel leaves in the dock: beside the graph its width
 * (w-11), under it its height (h-9)
 */
const BAR_BESIDE = 44
const BAR_UNDER = 36
/** The panel, or its bar, standing over the graph's card: raised */
const DOCKED = RAISED

/** Where a tile dragged goes: its index, and the chain an item goes into */
type Place = Spot & { readonly to: number; readonly chain?: string }

/** The tile picked, kept for the tab: a reload picks it again */
const PICKED_KEY = 'loopromeda.picked'
/** The mix's tile picked, kept the same way, and the kit's */
const MIX_PICKED_KEY = 'loopromeda.mixPicked'
const KIT_PICKED_KEY = 'loopromeda.kitPicked'
/** Kept for the tab too: '0' while the panel is hidden */
const PANEL_KEY = 'loopromeda.panel'
/** And which of the two the editor shows */
const PANE_KEY = 'loopromeda.pane'

/** What the editor shows: the sound's graph, or the session's mix */
export type Pane = 'sound' | 'mix'

const PANES: readonly { readonly pane: Pane; readonly label: string }[] = [
  { pane: 'sound', label: 'Sound' },
  { pane: 'mix', label: 'Mix' },
]

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

function readKept(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function keep(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
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
  /**
   * The part played's own output, its place in the mix: the synth's, or
   * the kit's, whose pad picked is the sound
   */
  readonly output: number
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
  /**
   * What an output's tiles show of it, each its own (the sound's in the
   * Out and the mix's strip, the master's in the Master), and choosing it
   */
  readonly viewOf: (source: OutputSource) => MasterViewKind
  readonly chooseView: (source: OutputSource, view: MasterViewKind) => void
}

/**
 * The sound as flat tiles flowing left to right (docs/plan/sound-chains.md,
 * The editor): the modulators' rack and the voice above (beside, at the
 * left, on a wider screen), the inputs in a column, a row per chain (its
 * head, its items, the amp at the end of every row, its inserts and the
 * sound's out after it), and under it all the panel of the tile picked
 * (beside the graph on a wider screen). The rack's first switch shows the
 * session's mix in the graph's place instead (MixGraph: the sound, the
 * returns, the master), the panel then the mix's; each keeps its tile
 * picked, and the two ask the card for the same height, so the keys
 * under it stay put. The sound's sends are turned in either: the Out's
 * panel and the mix's strip's are the same. Tapping a tile picks it; a
 * peg between an input and a chain picks the chain, its knob for that
 * input lit, and one between an input and the oscillator
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
 *
 * With the kit played, the sound's place holds the kit (KitGraph): its
 * pads, each its preset's name, and its chain after them, its effects
 * and its out; the panel maps a preset onto the pad picked, or turns the
 * chain's knobs. Nothing of a pad's sound is edited there: it is made in
 * the synth and saved as a preset, which the pad plays as it is.
 */
export function SoundEditor({
  engine,
  library,
  scope,
  asked,
  onMaster,
  onPresets,
}: {
  engine: Engine
  /** The presets: the names of the pads, and a pad's mapped onto it */
  library: Library
  scope?: OutputViews
  asked?: RoutesAsked
  /** Opens the master's views, large (#/master) */
  onMaster?: () => void
  /** Opens the presets' popover (#/presets), for a pad to map one */
  onPresets?: () => void
}) {
  useSyncExternalStore(engine.subscribeSound, () => shapeKey(engine.getSound()))
  useSyncExternalStore(engine.subscribeMix, () => mixShapeKey(engine.getMix()))
  const part = useSyncExternalStore(engine.subscribeSound, engine.getPart)
  // The pad picked: its preset in the kit's view, whatever its shape
  useSyncExternalStore(engine.subscribeSound, engine.getPad)
  // The tracks: which there are, in their order, and what they are called
  useSyncExternalStore(engine.subscribeSound, () =>
    tracksKey(engine.getTracks())
  )
  const output = useSyncExternalStore(engine.subscribeSound, engine.getPlace)
  const sound = engine.getSound()
  const [chosen, setChosen] = useState(() => readKept(PICKED_KEY))
  const [mixChosen, setMixChosen] = useState(() => readKept(MIX_PICKED_KEY))
  const [kitChosen, setKitChosen] = useState(() => readKept(KIT_PICKED_KEY))
  const [pane, setPane] = useState<Pane>(() =>
    readKept(PANE_KEY) === 'mix' ? 'mix' : 'sound'
  )
  const [focus, setFocus] = useState<string | undefined>(undefined)
  const [panel, setPanel] = useState(readPanel)
  const [routing, setRouting] = useState<RouteTarget | null>(null)
  const [views, setViews] = useState(() => ({
    master: readView('master'),
    parts: Array.from({ length: MAX_TRACKS }, (_, k) => readView(k)),
  }))
  const viewOf = (source: OutputSource) =>
    source === 'master' ? views.master : (views.parts[source] ?? views.master)
  const chooseView = (source: OutputSource, next: MasterViewKind) => {
    setViews((now) =>
      source === 'master'
        ? { ...now, master: next }
        : {
            ...now,
            parts: now.parts.map((view, k) => (k === source ? next : view)),
          }
    )
    keepView(source, next)
  }
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
      // Its routes go into the sound's tiles
      setPane('sound')
      keep(PANE_KEY, 'sound')
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
    keep(PICKED_KEY, id)
    setFocus(undefined)
    setRouting(null)
  }
  const pick = (id: string, input?: string) => {
    hold(id)
    setFocus(input)
    if (!panel) show(true)
  }
  const mix = engine.getMix()
  const mixed = stillMixPicked(mix, mixChosen)
  const pickMix = (id: string) => {
    setMixChosen(id)
    keep(MIX_PICKED_KEY, id)
    if (!panel) show(true)
  }
  /** Shows a pane, the routing of the other put away */
  const choosePane = (next: Pane) => {
    setPane(next)
    keep(PANE_KEY, next)
    setRouting(null)
    setMapping(null)
  }
  // The kit played: its pads and its chain in the sound's place
  const kitView = part === 'kit' && pane === 'sound'
  const kitPicked = stillKitPicked(sound, kitChosen)
  const pickKit = (id: string) => {
    setKitChosen(id)
    keep(KIT_PICKED_KEY, id)
    if (!panel) show(true)
  }
  const shownName =
    pane === 'mix'
      ? mixed === SENDS
        ? trackName(engine.getTrack(), output)
        : pickedName(sound, mix, mixed)
      : !kitView
        ? pickedName(sound, mix, picked)
        : kitPicked === PAD_TILE
          ? padName(library.snapshot.pads[engine.getPad()], engine.getPad())
          : kitPicked === addId('effect')
            ? 'Add to the kit'
            : `Kit ${pickedName(sound, mix, kitPicked)}`
  const picking: Picking = {
    engine,
    sound,
    output,
    picked,
    pick,
    hold,
    reach: reachOf(sound, from ?? picked),
    viewOf,
    chooseView,
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
    <div className="relative isolate flex min-h-0 flex-1 flex-col [--dock:calc(7.5rem_+_var(--knob)_+_0.5rem)] [--knob:clamp(3rem,calc((100vw_-_4.5rem)/8.5),4.5rem)] side:[--dock:0px] side:[--knob:3rem] wide:[--knob:4.5rem]">
      <section
        aria-label={
          pane === 'mix'
            ? 'The mix: the sound, the buses and the master'
            : kitView
              ? 'The kit: its pads, then its chain'
              : 'The sound, flowing left to right'
        }
        className={`flex min-h-[8rem] min-w-0 flex-1 flex-col overflow-hidden side:flex-row ${CARD}`}
      >
        <Rack
          {...picking}
          source={from}
          pane={pane}
          kit={kitView}
          onPane={choosePane}
        />
        {kitView ? (
          <KitGraph
            {...picking}
            library={library}
            picked={kitPicked}
            pick={pickKit}
            scope={scope}
            dock={dock}
            docked={panel}
          />
        ) : pane === 'sound' ? (
          <Graph
            {...picking}
            focus={picked === chosen ? focus : undefined}
            scope={scope}
            dock={dock}
            docked={panel}
          />
        ) : (
          <MixGraph
            {...picking}
            picked={mixed}
            pick={pickMix}
            scope={scope}
            dock={dock}
            docked={panel}
          />
        )}
      </section>
      <div
        ref={setDock}
        className={`absolute inset-x-2 bottom-2 z-20 h-[calc(7.5rem_+_var(--knob))] max-h-[calc(100%-9.25rem)] min-h-0 side:inset-y-2 side:right-2 side:left-auto side:h-auto side:max-h-none side:w-[clamp(22rem,36%,40rem)] wide:top-auto wide:left-2 wide:h-[calc(7.5rem_+_var(--knob))] wide:max-h-[calc(100%-9.25rem)] wide:w-auto ${panel ? `grid overflow-y-auto overscroll-contain ${DOCKED}` : 'pointer-events-none'}`}
      >
        {!panel && (
          <button
            type="button"
            aria-label={`Show the knobs: ${shownName}`}
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
              {shownName}
            </span>
          </button>
        )}
        {panel &&
          (pane === 'mix' ? (
            <PartPanel
              {...picking}
              library={library}
              picked={mixed}
              pick={pickMix}
              focus={undefined}
              onRoute={route}
              onMap={map}
              onHide={() => show(false)}
              onMaster={onMaster}
              inMix
            />
          ) : kitView ? (
            // No routes: nothing of a pad's sound is edited in the kit
            <PartPanel
              {...picking}
              library={library}
              picked={kitPicked}
              pick={pickKit}
              focus={undefined}
              onRoute={() => undefined}
              onMap={() => undefined}
              onHide={() => show(false)}
              onMaster={onMaster}
              onPresets={onPresets}
            />
          ) : into ? (
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
              library={library}
              focus={picked === chosen ? focus : undefined}
              onRoute={route}
              onMap={map}
              onHide={() => show(false)}
              onMaster={onMaster}
            />
          ))}
      </div>
    </div>
  )
}

/**
 * The rack's strip, over the graph or beside it at its left: 8 px in from
 * the card's edges, as the dock is (DOCK_INSET), and 8 from the tiles,
 * which stand that far into their frame (GRAPH.top, GRAPH.inputX)
 */
const RACK =
  'mx-2 mt-2 flex h-14 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.03] pr-0.5 pl-1.5 side:mr-0 side:mb-2 side:h-auto side:w-[4.25rem] side:flex-col side:px-0 side:pt-1.5 side:pb-0.5'

/**
 * Sound or Mix, the two the editor shows: first in the rack, where it
 * stands in both (beside the graph, stacked)
 */
function PaneSwitch({
  pane,
  onPane,
}: {
  pane: Pane
  onPane: (pane: Pane) => void
}) {
  return (
    <div
      role="group"
      aria-label="The editor shows"
      className="flex shrink-0 gap-0.5 rounded-lg bg-black/25 p-0.5 side:w-14 side:flex-col"
    >
      {PANES.map(({ pane: each, label }) => (
        <button
          key={each}
          type="button"
          aria-pressed={pane === each}
          onClick={() => onPane(each)}
          className="h-10 rounded-md px-2 text-[11px] font-semibold text-zinc-500 aria-pressed:bg-white/10 aria-pressed:text-zinc-100 side:h-7 side:px-0"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * Sound or Mix first (PaneSwitch). Showing the sound, the voice, a block
 * over the inputs, whose pitch it sets: where a
 * note comes in, its mode under its name. Then the modulators in a row,
 * each a block drawing its shape, and a "+" while there is room. Held
 * upright its tiles stand as tall as the graph's (44 px), wider than
 * tall; beside the graph, 56 px squares, and on a short screen (a phone
 * on its side) 56 by 44, for more of them to show; and there the
 * modulators give up height, down to 44 px, before their column scrolls,
 * so that a column that almost fits is not one to scroll a few pixels
 * (the switch over it took room, the Fold open on its side was short of
 * a few). The row scrolls under
 * the voice, which clips at its padding: there is room in it for a tile's
 * rings (a reach ring stands 3.5 px out). Beside the graph (a wider
 * screen, a phone on its side) it is a column at the graph's left, the
 * voice on top, scrolling down
 * (it asks no height of the card: the graph sets that). The source being
 * routed from is outlined in sky. A modulator dragged moves along it.
 * Showing the mix, what the mix is: the session's, but for each sound's
 * sends.
 */
function Rack({
  engine,
  sound,
  picked,
  pick,
  hold,
  reach,
  source,
  pane,
  kit,
  onPane,
}: Picking & {
  source: string | null
  pane: Pane
  /** The kit's view: no voice, no modulators, its sounds its presets' */
  kit: boolean
  onPane: (pane: Pane) => void
}) {
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
  const divider = (
    <span
      aria-hidden
      className="h-8 w-px shrink-0 bg-white/10 side:h-px side:w-10"
    />
  )
  if (pane === 'mix' || kit) {
    return (
      <div className={RACK}>
        <PaneSwitch pane={pane} onPane={onPane} />
        {divider}
        <p className="line-clamp-2 min-w-0 pr-1.5 text-[11px] leading-snug text-zinc-500 side:hidden">
          {kit
            ? 'Each pad plays a preset as it is: make sounds in a synth.'
            : 'The session’s mix: a preset keeps only its sound’s sends.'}
        </p>
      </div>
    )
  }
  return (
    <div className={RACK}>
      <PaneSwitch pane={pane} onPane={onPane} />
      {divider}
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
      {divider}
      <div
        ref={scrollerRef}
        aria-label="Modulators"
        className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain px-1 py-1.5 side:min-h-0 side:basis-0 side:flex-col side:self-stretch side:overflow-x-hidden side:overflow-y-auto side:overscroll-y-contain side:px-1.5 side:py-1"
      >
        <div
          ref={contentRef}
          className="relative flex shrink-0 gap-1 side:min-h-0 side:shrink side:flex-col"
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
              className="h-11 w-16 shrink-0 side:size-14 side:min-h-11 side:shrink short:h-11"
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
 * The room a frame leaves its tiles, measured as it and the panel's dock
 * over it change: 0 by 0 until it is (roomBeside)
 */
function useRoom(
  frameRef: RefObject<HTMLDivElement | null>,
  dock: HTMLElement | null
): Room {
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
        BAR_BESIDE,
        DOCK_INSET
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
    // frameRef is a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dock])
  return room
}

/**
 * The frame both panes' tiles stand in: at rest it asks the card for the
 * taller of the two (rest), so that showing one or the other moves
 * nothing under them; it pans the tiles out from under the panel over it,
 * or from under its bar with the panel hidden.
 */
function Frame({
  frameRef,
  rest,
  room,
  docked,
  width,
  height,
  contentRef,
  children,
}: {
  frameRef: RefObject<HTMLDivElement | null>
  rest: number
  room: Room
  docked: boolean
  width: number
  height: number
  contentRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
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
      style={{ '--rest': `${rest}px` } as CSSProperties}
      className="relative min-h-0 grow basis-[calc(min(var(--rest),22rem,45dvh)_+_var(--dock,0px))] overflow-auto overscroll-contain side:min-w-0 side:basis-0"
    >
      {/* Room to pan the tiles out from under the panel over the frame,
          or from under its bar with the panel hidden */}
      {(room.right > 0 || room.bottom > 0) && (
        <span
          aria-hidden
          className="pointer-events-none absolute size-px"
          style={{
            left: width + clear(room.right, BAR_BESIDE) - 1,
            top: height + clear(room.bottom, BAR_UNDER) - 1,
          }}
        />
      )}
      <div
        ref={contentRef}
        className="relative min-w-full"
        style={{ width, height }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * An output's view and meters: the sound's own in the Out's tile and the
 * mix's strip, everything after the master in the Master's
 */
function OutputAside({
  engine,
  view,
  source,
  scope,
  meter,
}: {
  engine: Engine
  view: MasterViewKind
  source: OutputSource
  /** Given, the scope's drawing cost is shown and reported */
  scope: OutputViews | undefined
  /** The meters' width: a sliver in the Out, wider in the Master */
  meter: string
}) {
  return (
    <>
      <MasterView
        engine={engine}
        view={view}
        source={source}
        timing={scope?.timing}
        onStats={scope?.onStats}
        className="h-full min-w-0 flex-1 rounded-[4px]"
      />
      <Meters
        engine={engine}
        source={source}
        className={`h-full shrink-0 overflow-hidden rounded-[4px] ${meter}`}
      />
    </>
  )
}

/**
 * The inputs, the chains, the amp and its inserts, and the sound's out,
 * laid out by graphGeometry: the tiles share the frame's width, the out
 * filling what they leave and holding the output's view (the scope, the
 * spectrum, the spectrogram or the two sides, as its panel chooses) and
 * its meters under its name and the sound's sends to the mix's buses.
 * The frame takes the room the page leaves it, up to a cap, the tiles
 * what the panel's dock over it leaves of that (beside, what its bar
 * leaves, the panel standing over the last of them), and it pans what it
 * cannot show.
 */
function Graph({
  engine,
  sound,
  output,
  picked,
  pick,
  hold,
  reach,
  viewOf,
  focus,
  scope,
  dock,
  docked,
}: Picking & {
  focus: string | undefined
  scope: OutputViews | undefined
  /** The panel's dock, over the frame: the tiles keep to what it leaves */
  dock: HTMLElement | null
  /**
   * Whether the panel is in it: the frame pans the tiles from under it,
   * or with the panel hidden from under its bar
   */
  docked: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const room = useRoom(frameRef, dock)
  const geometry = graphGeometry(
    sound,
    LIMITS,
    room.w || undefined,
    room.h || undefined
  )
  const showView = scope !== undefined && geometry.out.w >= GRAPH.outW
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

  return (
    <Frame
      frameRef={frameRef}
      // As tall as the mix asks, so switching to it moves nothing
      rest={Math.max(geometry.rest, mixRest(engine))}
      room={room}
      docked={docked}
      width={geometry.width}
      height={geometry.height}
      contentRef={contentRef}
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
        picture={AMP}
        look={NEUTRAL_LOOK}
        picked={picked === AMP}
        reach={reach.has(AMP)}
        routed={routed.has(AMP)}
        aria="Amp: each voice’s envelope"
        onClick={() => pick(AMP)}
        style={place(geometry.amp)}
      />
      {geometry.effects.map(({ effect, box }, k) => {
        // Its seam lights when it or the tile before it is picked
        const before = k === 0 ? AMP : sound.effects[k - 1]?.id
        const x = geometry.fxJoints[k] ?? box.x
        return (
          <div key={effect} className="contents">
            <Joint
              x={x}
              y={box.y + box.h / 2}
              height={18}
              look={NEUTRAL_LOOK}
              lit={picked === effect || picked === before}
            />
            <Tile
              engine={engine}
              label={tileLabel(sound, effect)}
              line={effect}
              glyph={box.h >= 60 ? glyphOf(sound, effect) : undefined}
              look={NEUTRAL_LOOK}
              picked={picked === effect}
              aria={`${partName(sound, effect)}, ${tileLine(sound, effect)}, after the amp`}
              onClick={() => pick(effect)}
              style={place(box)}
            />
          </div>
        )
      })}
      <Joint
        x={geometry.outJoint}
        y={geometry.out.y + geometry.out.h / 2}
        height={18}
        look={NEUTRAL_LOOK}
        lit={
          picked === SENDS ||
          picked === (sound.effects[sound.effects.length - 1]?.id ?? AMP)
        }
      />
      <Tile
        engine={engine}
        label="Out"
        text={<SendsLine engine={engine} across={geometry.out.h >= 60} />}
        look={NEUTRAL_LOOK}
        picked={picked === SENDS}
        aria="Out: the sound’s level and balance in the mix, and what it sends to each bus"
        onClick={() => pick(SENDS)}
        style={place(geometry.out)}
        aside={
          showView && (
            <OutputAside
              engine={engine}
              view={viewOf(output)}
              source={output}
              scope={scope}
              meter="w-2.5"
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
      {geometry.addEffect && (
        <Tile
          engine={engine}
          label="+ FX"
          look={NEUTRAL_LOOK}
          picked={picked === addId('effect')}
          dashed="add"
          aria="Add an effect after the amp"
          onClick={() => pick(addId('effect'))}
          style={place(geometry.addEffect)}
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
    </Frame>
  )
}

/**
 * The kit played, in the sound's place, laid out by kitGeometry: its 16
 * pads in a block, each its preset's name, the pad picked ringed (picking
 * one picks the kit's pad, PAD_TILE in the panel); after them the kit's
 * chain, its effects, its "+" and its out, holding the kit's output and
 * meters as the sound's out holds the sound's. The frame asks as much at
 * rest as the sound's does, the mix's at least, and pans what it cannot
 * show.
 */
function KitGraph({
  engine,
  library,
  sound,
  output,
  picked,
  pick,
  viewOf,
  scope,
  dock,
  docked,
}: Picking & {
  library: Library
  scope: OutputViews | undefined
  dock: HTMLElement | null
  docked: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const room = useRoom(frameRef, dock)
  const { pads } = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const padNotes = useSyncExternalStore(
    engine.subscribeSound,
    engine.getPadNotes
  )
  const pad = engine.getPad()
  const geometry = kitGeometry(
    sound.effects,
    MAX_EFFECTS,
    room.w || undefined,
    room.h || undefined
  )
  const showView = scope !== undefined && geometry.out.w >= GRAPH.outW
  const middle = geometry.block.y + geometry.block.h / 2
  const last = sound.effects[sound.effects.length - 1]?.id ?? PAD_TILE
  return (
    <Frame
      frameRef={frameRef}
      rest={Math.max(geometry.rest, mixRest(engine))}
      room={room}
      docked={docked}
      width={geometry.width}
      height={geometry.height}
    >
      {geometry.pads.map((box, k) => {
        const name = padName(pads[k], k)
        const lit = picked === PAD_TILE && k === pad
        // The note it plays at, said where it is not the one all start at
        const note = padNotes[k] ?? PAD_NOTE
        const at = note === PAD_NOTE ? undefined : noteName(note)
        return (
          <button
            key={k}
            type="button"
            aria-label={`Pad ${k + 1}: ${name}${at ? `, at ${at}` : ''}`}
            aria-pressed={lit}
            aria-current={k === pad ? 'true' : undefined}
            onClick={() => {
              engine.pickTrack(engine.getPick().track, k)
              pick(PAD_TILE)
            }}
            style={{
              ...place(box),
              background: lit
                ? `linear-gradient(${NEUTRAL_LOOK.tint}, ${NEUTRAL_LOOK.tint}), ${FACE}`
                : FACE,
              boxShadow: lit
                ? `inset 0 0 0 2px ${NEUTRAL_LOOK.ink}, 0 0 0 3px ${NEUTRAL_LOOK.tint}`
                : `inset 0 0 0 1.5px ${k === pad ? NEUTRAL_LOOK.ink : NEUTRAL_LOOK.ring}`,
              color: pads[k] ? TEXT : ADD_TEXT,
            }}
            className={`flex flex-col items-center justify-center overflow-hidden rounded-[7px] px-1 text-center text-[11px] leading-tight font-semibold ${lit ? 'z-[2]' : 'z-[1]'}`}
          >
            <span
              className={
                at ? 'line-clamp-1 break-all' : 'line-clamp-2 break-words'
              }
            >
              {name}
            </span>
            {at && (
              <span className="text-[9px] leading-none font-medium text-zinc-400 tabular-nums">
                {at}
              </span>
            )}
          </button>
        )
      })}
      {geometry.effects.map(({ effect, box }, k) => {
        const before = k === 0 ? PAD_TILE : sound.effects[k - 1]?.id
        return (
          <div key={effect} className="contents">
            <Joint
              x={geometry.fxJoints[k] ?? box.x}
              y={middle}
              height={18}
              look={NEUTRAL_LOOK}
              lit={picked === effect || picked === before}
            />
            <Tile
              engine={engine}
              label={tileLabel(sound, effect)}
              line={effect}
              glyph={box.h >= 60 ? glyphOf(sound, effect) : undefined}
              look={NEUTRAL_LOOK}
              picked={picked === effect}
              aria={`Kit ${partName(sound, effect)}, ${tileLine(sound, effect)}, after every pad`}
              onClick={() => pick(effect)}
              style={place(box)}
            />
          </div>
        )
      })}
      {geometry.add && (
        <Tile
          engine={engine}
          label="+ FX"
          look={NEUTRAL_LOOK}
          picked={picked === addId('effect')}
          dashed="add"
          aria="Add an effect to the kit, after every pad"
          onClick={() => pick(addId('effect'))}
          style={place(geometry.add)}
        />
      )}
      <Joint
        x={geometry.outJoint}
        y={middle}
        height={18}
        look={NEUTRAL_LOOK}
        lit={picked === SENDS || picked === last}
      />
      <Tile
        engine={engine}
        label="Kit Out"
        text={<SendsLine engine={engine} across={geometry.out.h >= 60} />}
        look={NEUTRAL_LOOK}
        picked={picked === SENDS}
        aria="Kit Out: the kit’s level and balance in the mix, and what it sends to each bus"
        onClick={() => pick(SENDS)}
        style={place(geometry.out)}
        aside={
          showView && (
            <OutputAside
              engine={engine}
              view={viewOf(output)}
              source={output}
              scope={scope}
              meter="w-2.5"
            />
          )
        }
      />
    </Frame>
  )
}

/**
 * The session's mix, laid out by mixGeometry: the tracks' strips, down
 * one column as a sound's inputs are, each its track's name and level on
 * a line over its own output's view and meter, and under them a "+" for
 * another track (more tracks than the frame is tall for pan down); the
 * track played's sends pegs on the seam to the buses, as long as each
 * (its sends' bars are the Out's: the view has the strip); each bus a row,
 * its letter's head, its effects and its "+"; each bus's level a peg on
 * the bus down the seam into the master's effects and the master, which
 * holds the output's view and its meters, wider. A strip makes its track
 * the one played and picks its sends, a send's peg its bus.
 */
function MixGraph({
  engine,
  sound,
  output,
  picked,
  pick,
  viewOf,
  scope,
  dock,
  docked,
}: Picking & {
  scope: OutputViews | undefined
  dock: HTMLElement | null
  docked: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const room = useRoom(frameRef, dock)
  // The editor redraws on the mix's shape (mixShapeKey) and the tracks'
  const mix = engine.getMix()
  const tracks = engine.getTracks()
  const geometry = mixGeometry(
    mix,
    MIX_LIMITS,
    room.w || undefined,
    room.h || undefined
  )
  const showView = scope !== undefined && geometry.master.w >= GRAPH.outW
  const strip = picked === SENDS
  const master = mixId(MASTER)
  const line = (style: CSSProperties) => (
    <span
      aria-hidden
      className="pointer-events-none absolute z-[2] rounded-full"
      style={{ background: NEUTRAL_LOOK.ring, ...style }}
    />
  )
  /**
   * A row's effects, each with the joint before it (at joints, unless
   * none), lit with it or the tile before it: the first's is before
   */
  const effects = (
    row: readonly EffectBox[],
    joints: readonly (number | undefined)[],
    before: string,
    where: string,
    look: Look
  ) =>
    row.map(({ effect, box }, k) => {
      const id = mixId(effect)
      const previous = k === 0 ? before : mixId(row[k - 1]?.effect ?? '')
      const found = findMixPart(mix, effect)
      const kind = found?.type === 'effect' ? found.effect.kind : 'chorus'
      return (
        <div key={effect} className="contents">
          {joints[k] !== undefined && (
            <Joint
              x={joints[k]}
              y={box.y + box.h / 2}
              height={18}
              look={look}
              lit={picked === id || picked === previous}
            />
          )}
          <Tile
            engine={engine}
            label={EFFECT_KINDS[kind].label}
            text={<MixLine engine={engine} part={effect} />}
            glyph={box.h >= 60 ? EFFECT_GLYPHS[kind] : undefined}
            look={look}
            picked={picked === id}
            aria={`${mixPartName(mix, effect)}, ${where}`}
            onClick={() => pick(id)}
            style={place(box)}
          />
        </div>
      )
    })
  const lastMaster = geometry.masterEffects[geometry.masterEffects.length - 1]
  return (
    <Frame
      frameRef={frameRef}
      rest={Math.max(graphGeometry(sound, LIMITS).rest, mixRest(engine))}
      room={room}
      docked={docked}
      width={geometry.width}
      height={geometry.height}
    >
      {geometry.bus &&
        line({
          left: geometry.bus.x - 1,
          top: geometry.bus.y,
          width: 2,
          height: geometry.bus.h,
        })}
      {geometry.strips.map((box, k) => {
        // The track played's strip carries its sends; another's, tapped,
        // makes its track the one played
        const track = tracks[k]
        if (!track) return null
        const played = k === output
        const id = stripId(k)
        const name = trackName(track, k)
        return (
          <Tile
            key={track.id}
            engine={engine}
            label={name}
            text={<MixLine engine={engine} part={id} />}
            inline
            look={NEUTRAL_LOOK}
            picked={played && strip}
            aria={
              track.kind === 'kit'
                ? `${name}, a kit: its pads summed through its chain, at its level and balance, sent to each bus`
                : `${name}, a synth: the sound at its level and balance, sent to each bus`
            }
            onClick={() => {
              if (!played) engine.pickTrack(track.id)
              pick(SENDS)
            }}
            style={place(box)}
            aside={
              scope !== undefined && (
                <OutputAside
                  engine={engine}
                  view={viewOf(k)}
                  source={k}
                  scope={undefined}
                  meter="w-2.5"
                />
              )
            }
          />
        )
      })}
      {geometry.addTrack && (
        <Tile
          engine={engine}
          label="+ Track"
          look={NEUTRAL_LOOK}
          picked={picked === mixAddId('track')}
          dashed="add"
          aria="Add a track"
          onClick={() => pick(mixAddId('track'))}
          style={place(geometry.addTrack)}
        />
      )}
      {geometry.buses.map((row) => {
        const bus = mix.buses.find((each) => each.id === row.bus)
        if (!bus) return null
        const id = mixId(bus.id)
        const letter = busLetter(bus.id)
        const look = busLook(bus.id)
        const member =
          picked === id ||
          picked === mixAddId(bus.id) ||
          bus.effects.some((effect) => picked === mixId(effect.id))
        return (
          <div key={bus.id} className="contents">
            <Tile
              engine={engine}
              label=""
              mark={letter}
              text={<MixLine engine={engine} part={bus.id} />}
              look={look}
              picked={member}
              aria={`Bus ${letter}, ${busName(bus)}, which every sound sends to`}
              onClick={() => pick(id)}
              style={place(row.head)}
            />
            {effects(row.effects, row.joints, id, `on bus ${letter}`, look)}
            {row.add && (
              <Tile
                engine={engine}
                label={row.add.w < 60 ? '+' : '+ FX'}
                look={look}
                picked={picked === mixAddId(bus.id)}
                member={member}
                dashed="add"
                aria={`Add an effect to bus ${letter}`}
                onClick={() => pick(mixAddId(bus.id))}
                style={place(row.add)}
              />
            )}
          </div>
        )
      })}
      {effects(
        geometry.masterEffects,
        // The first stands after the buses' seam, their levels joining it
        [undefined, ...geometry.masterJoints],
        '',
        'on the master',
        NEUTRAL_LOOK
      )}
      {lastMaster && (
        <Joint
          x={geometry.masterJoints[geometry.masterJoints.length - 1] ?? 0}
          y={geometry.master.y + geometry.master.h / 2}
          height={18}
          look={NEUTRAL_LOOK}
          lit={picked === master || picked === mixId(lastMaster.effect)}
        />
      )}
      <Tile
        engine={engine}
        label="Master"
        text={<MixLine engine={engine} part={MASTER} />}
        look={NEUTRAL_LOOK}
        picked={picked === master}
        aria="Master: every bus, through its effects, then the soft clip"
        onClick={() => pick(master)}
        style={place(geometry.master)}
        aside={
          showView && (
            <OutputAside
              engine={engine}
              view={viewOf('master')}
              source="master"
              scope={scope}
              meter="w-3.5"
            />
          )
        }
      />
      {geometry.addBus && (
        <Tile
          engine={engine}
          label="+ Bus"
          look={NEUTRAL_LOOK}
          picked={picked === mixAddId('bus')}
          dashed="add"
          aria="Add a bus"
          onClick={() => pick(mixAddId('bus'))}
          style={place(geometry.addBus)}
        />
      )}
      {geometry.addMaster && (
        <Tile
          engine={engine}
          label="+ FX"
          look={NEUTRAL_LOOK}
          picked={picked === mixAddId(MASTER)}
          dashed="add"
          aria="Add an effect to the master"
          onClick={() => pick(mixAddId(MASTER))}
          style={place(geometry.addMaster)}
        />
      )}
      {geometry.sends.map((peg) => (
        <MixSendPeg
          key={peg.bus}
          engine={engine}
          peg={peg}
          lit={strip || picked === mixId(peg.bus)}
          onClick={() => pick(mixId(peg.bus))}
        />
      ))}
      {geometry.levels.map((peg) => (
        <BusLevel
          key={peg.bus}
          engine={engine}
          peg={peg}
          lit={picked === mixId(peg.bus) || picked === master}
        />
      ))}
    </Frame>
  )
}

/** The mix's limits, as mixGeometry reads them */
const MIX_LIMITS = {
  buses: MAX_BUSES,
  effects: MAX_EFFECTS,
  tracks: MAX_TRACKS,
}

/** The mix's height at rest, which either pane asks of its frame */
function mixRest(engine: Engine): number {
  return mixGeometry(engine.getMix(), MIX_LIMITS).rest
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

/** A mix tile's line (mixLine), as its knobs move */
function MixLine({ engine, part }: { engine: Engine; part: string }) {
  return useSyncExternalStore(engine.subscribeMix, () =>
    mixLine(engine.getMix(), part)
  )
}

/** What follows the mix live: a bus's level */
function useLiveMix(engine: Engine, part: string, key: string): number {
  return useSyncExternalStore(
    engine.subscribeMix,
    () => mixValue(engine.getMix(), part, key) ?? 0
  )
}

/**
 * The part played's sends under a tile's name (the synth's sound's, or
 * the kit's): a short bar for each bus of the mix, by its letter, as
 * long as the send to it; one under another, or across, over a view
 * (two to a line, for four)
 */
function SendsLine({
  engine,
  across = false,
}: {
  engine: Engine
  across?: boolean
}) {
  const letters = useSyncExternalStore(engine.subscribeMix, () =>
    engine
      .getMix()
      .buses.map((bus) => bus.id)
      .join('')
  )
  // The part played's: the synth's sound's own, or the kit's chain's
  const sends = useLive(engine, (sound) =>
    [...letters].map((id) => sound.sends[id] ?? 0).join(' ')
  )
  const levels = sends.split(' ').map(Number)
  const columns = letters.length > 3 ? 2 : Math.max(1, letters.length)
  return (
    <span
      aria-hidden
      className={
        across
          ? 'mt-0.5 grid gap-x-1.5 gap-y-[3px]'
          : 'mt-1 flex flex-col gap-[3px]'
      }
      style={across ? { gridTemplateColumns: `repeat(${columns}, auto)` } : {}}
    >
      {[...letters].map((id, k) => (
        <span key={id} className="flex items-center gap-1">
          <span className="w-[7px] text-[9px] leading-none text-zinc-500">
            {id.toUpperCase()}
          </span>
          <span
            className={`relative h-[3px] overflow-hidden rounded-full bg-white/10 ${across ? 'w-3.5' : 'w-7'}`}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${(levels[k] ?? 0) * 100}%`,
                background: busLook(id).ink,
              }}
            />
          </span>
        </span>
      ))}
    </span>
  )
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
  /** The chain whose row it moves with, if it stands in one */
  row?: string
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

/**
 * The part played's send to a bus, its peg: as long as the send; a tap
 * picks the bus
 */
function MixSendPeg({
  engine,
  peg,
  lit,
  onClick,
}: {
  engine: Engine
  peg: MixPeg
  lit: boolean
  onClick: () => void
}) {
  const level = useLive(engine, (sound) => sound.sends[peg.bus] ?? 0)
  return (
    <button
      type="button"
      aria-label={`The part played into bus ${peg.bus.toUpperCase()}, ${Math.round(level * 100)}%. Tap to set it.`}
      onClick={onClick}
      className="absolute z-[3] flex h-11 w-5 items-center justify-center"
      style={{ left: peg.x - 10, top: peg.y - 22 }}
    >
      <span
        className="block w-2 rounded"
        style={{
          height: pegLength(level),
          opacity: lit ? 1 : pegOpacity(level),
          ...pillStyle(busLook(peg.bus), lit),
        }}
      />
    </button>
  )
}

/** A bus's level, its peg on the bus into the master: as long as it */
function BusLevel({
  engine,
  peg,
  lit,
}: {
  engine: Engine
  peg: MixPeg
  lit: boolean
}) {
  const level = useLiveMix(engine, peg.bus, 'level')
  const height = pegLength(level)
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-[3] w-2 rounded"
      style={{
        left: peg.x - 4,
        top: peg.y - height / 2,
        height,
        opacity: lit ? 1 : pegOpacity(level),
        ...pillStyle(busLook(peg.bus), lit),
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
  aside: view,
  picture,
  stacked = false,
  inline = false,
  text,
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
   * The output's view, filling the rest of the tile 3 px inside its edges,
   * as a picture does (round it at 4 px): under the label in a tall tile
   * (or inline), beside it in a short one
   */
  aside?: ReactNode
  /** The part whose picture fills the tile: a filter's response, a drive's */
  picture?: string
  /** Its picture under its label however tall it is: a modulator's block */
  stacked?: boolean
  /**
   * Its text beside its label, one line over its view however tall it
   * is, for the view to have the most of it: a part's strip in the mix
   */
  inline?: boolean
  /** A line under the label of its own, live: the mix's, the sends */
  text?: ReactNode
}) {
  const height = typeof style?.height === 'number' ? style.height : 26
  const width = typeof style?.width === 'number' ? style.width : Infinity
  const tall = !dashed && !small && height >= 60
  const under = picture !== undefined && (tall || stacked)
  const viewUnder = Boolean(view) && (tall || inline)
  const aside = Boolean(view) && !viewUnder
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
        {(line !== undefined || text !== undefined) && (
          <span className="font-mono text-[10px] leading-tight whitespace-nowrap text-zinc-400">
            {line === undefined ? text : <Line engine={engine} id={line} />}
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
          className={`flex min-w-0 ${
            inline
              ? 'max-w-full items-baseline gap-1.5'
              : `flex-col ${column ? 'items-center' : 'items-start'}`
          }`}
        >
          <span
            // A name too long for its line (a track's own) is cut short
            className={`${small ? 'text-[11px]' : 'text-xs'} leading-tight font-semibold whitespace-nowrap ${inline ? 'min-w-0 truncate' : ''}`}
          >
            {label}
          </span>
          {(line !== undefined || text !== undefined) && (
            <span className="shrink-0 font-mono text-[10px] leading-tight whitespace-nowrap text-zinc-400">
              {text ??
                (line !== undefined && <Line engine={engine} id={line} />)}
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
          : under || viewUnder
            ? tall && !inline
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
          {view}
        </>
      ) : (
        content
      )}
      {viewUnder && (
        <span className="flex min-h-0 w-full flex-1 gap-1">{view}</span>
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
