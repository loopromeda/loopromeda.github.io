import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { Engine, OutputSource } from '../engine/engine'
import type { EffectAt } from '../engine/protocol'
import { PAD_NOTE, padName } from '../state/kit'
import type { Library } from '../state/library'
import { moveItem, movePart } from '../state/sound/edit'
import {
  MAX_BUSES,
  MAX_CHAINS,
  MAX_EFFECTS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  effectTile,
  reduces,
} from '../state/sound/kinds'
import {
  MASTER,
  busLetter,
  busName,
  findMixPart,
  mixValue,
  stripId,
} from '../state/mix'
import { MAX_TRACKS, trackName, tracksKey, type Track } from '../state/tracks'
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
import {
  mixGeometry,
  mixSends,
  type EffectBox,
  type MixThread,
} from '../viz/mixGraph'
import {
  lanePath,
  runMiddle,
  runPath,
  THREAD,
  threadOpacity,
  threadWidth,
  type Run,
} from '../viz/threads'
import {
  MOD_LOOK,
  NEUTRAL_LOOK,
  PAD_TILE,
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
import { CARD, CARD_FACE, RAISED, TALL_HIT } from './controls'
import { TileReduction } from './Dynamics'
import {
  MasterView,
  Meters,
  keepView,
  readView,
  type MasterViewKind,
} from './MasterViews'
import { outlineKind } from './outline'
import { STATE_WORDS, useStripState } from './Mutes'
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
  modulators: MAX_MODULATORS,
}
/**
 * Kept clear between the tiles and the panel over them, past the graph's
 * own end (GRAPH.end, 8): nothing more, so they stand 8 apart as the tiles
 * stand from the card's edges
 */
const DOCK_GAP = 0
/** How far in the dock stands from the card's edges (2) */
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
   * Picks id, showing the panel if hidden; a send's thread picks the
   * chain with the input it is for
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
 * The editor): the Sound and Mix switch in a thin panel over the card,
 * the modulators in a lane across the graph's head, the inputs in a
 * column, a row per chain (its
 * head, its items, the amp at the end of every row, its inserts and the
 * sound's out after it), and under it all the panel of the tile picked
 * (beside the graph on a wider screen). The panel's switch shows the
 * session's mix in the graph's place instead (MixGraph: the sound, the
 * returns, the master), the panel then the mix's; each keeps its tile
 * picked, and the two ask the card for the same height, so the keys
 * under it stay put. The sound's sends are turned in either: the Out's
 * panel and the mix's strip's are the same. The voice is called from the
 * track's popover (TrackPicker.tsx): its Voice button opens the sound pane
 * and picks the voice, the panel with it. Tapping a tile picks it; the
 * thread between an input and a chain picks the chain, its knob for that
 * input lit, and one between an input and the oscillator whose FM reads
 * it picks the input, its knob for that FM lit (threads.ts: a tap target
 * 44 by 28 about the middle of each). Picking a chain's head lights its
 * threads, from its inputs to the amp, and dims the rest of the chains'
 * and the inputs' to a quarter; picking an input lights its own and dims
 * the other inputs'; a bus's head does as a chain's in the mix. The panel
 * stands over the graph's card and hides (its header's last button),
 * showing the canvas under it, the tiles as they were; a bar where it
 * stood brings it back, and so does picking a tile.
 *
 * It redraws when the sound's shape changes (shapeKey: a part added, an
 * input feeding a chain, a wave changed); a knob turning redraws only the
 * knob and the line or thread that shows it.
 *
 * The panel turns to routing in two ways (RoutePanels.tsx). Holding a
 * knob shows the routes into it. A modulator's Route shows the picked
 * tile's knobs as depths from it, while tiles are picked as before; so
 * does asking (asked), for a source with no tile, the mod wheel.
 *
 * Held, a tile lifts to be dragged (tileDrag.ts): an item along its chain
 * or into another, a chain's head (its row with it) up or down, a
 * modulator along the lane. Inputs stand beside the chains they feed, so
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
  voiceAsked,
  onMaster,
  onPresets,
}: {
  engine: Engine
  /** The presets: the names of the pads, and a pad's mapped onto it */
  library: Library
  scope?: OutputViews
  asked?: RoutesAsked
  /**
   * The track popover's Voice: each new ask opens the sound pane and shows
   * the voice's panel once (the same way as asked routes)
   */
  voiceAsked?: number
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
  // A new Voice ask shows the voice's panel, the sound pane and the panel
  // brought up: once, as it comes (as the wheel's Route above)
  const [voiced, setVoiced] = useState(voiceAsked)
  if (voiceAsked !== undefined && voiceAsked !== voiced) {
    setVoiced(voiceAsked)
    choosePane('sound')
    pick(VOICE)
    show(true)
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
  // so the keys below it stay put: 7.75rem and a knob (--knob, KNOB_SIZE)
  // hold the tallest panel most parts make, a header, a row of knobs and
  // a row of 28 px controls (chains, routes, the views, a reduction): its
  // insets (2 x 10 px), the header and the row (2 x 28), the gaps between
  // (2 x 8) and the knob's two lines under it (31.5), with half a pixel to
  // spare, so nothing scrolls a pixel or two for nothing. More scrolls in
  // it. The knob is 48 px, or
  // on a wider screen held upright (a Fold open) up to 72 px with the
  // width, the keys giving up the height. Short of room, the graph gives
  // way first, down to a row of tiles; the panel shrinks only past that
  // (its room: all but the graph's least and the gap). Beside the graph,
  // the panel takes the graph's height and never makes the row taller: it
  // scrolls instead, its knobs at 48 px. It is 22rem wide, and on a wider
  // screen a little over a third of the row, up to 40rem. Both fill the
  // height the page gives the editor beside (App.tsx: what the keys
  // leave), the tiles at the top of theirs, and the graph pans only past
  // it. On a tall
  // one (index.css) the panel stands under the graph again, the whole
  // width, its knobs 72 px in a row over the keys (knobRow), and the graph
  // takes the rest of the height. Held upright or beside, the tab panel
  // stands in a card of its own over the graph's; beside (index.css: a
  // wider screen, or a phone on its side, whose graph has width to spare
  // and little height), the panel of the tile picked stands at the graph's
  // right.
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
    <div className="relative isolate flex min-h-0 flex-1 flex-col [--dock:calc(7.75rem_+_var(--knob)_+_0.5rem)] [--knob:clamp(3rem,calc((100vw_-_4.5rem)/8.5),4.5rem)] side:[--dock:0px] side:[--knob:3rem] tall:[--knob:4.5rem]">
      {/* The two panes, in a panel of their own over the card: the switch,
          slim as a header row, and where the mix or the kit is shown,
          what it is */}
      <div
        className={`mb-2 flex h-10 shrink-0 items-center gap-2 px-1 ${CARD}`}
      >
        <PaneSwitch pane={pane} onPane={choosePane} />
        {(pane === 'mix' || kitView) && (
          <p className="min-w-0 truncate text-[11px] text-zinc-500">
            {kitView
              ? 'Each pad plays a preset as it is: make sounds in a synth.'
              : 'The session’s mix: a preset keeps only its sound’s sends.'}
          </p>
        )}
      </div>
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
            source={from}
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
        className={`absolute inset-x-2 bottom-2 z-20 h-[calc(7.75rem_+_var(--knob))] max-h-[calc(100%-9.25rem)] min-h-0 side:inset-y-2 side:right-2 side:left-auto side:h-auto side:max-h-none side:w-[clamp(22rem,36%,40rem)] tall:top-auto tall:left-2 tall:h-[calc(7.75rem_+_var(--knob))] tall:max-h-[calc(100%-9.25rem)] tall:w-auto ${panel ? `grid overflow-y-auto overscroll-contain ${DOCKED}` : 'pointer-events-none'}`}
      >
        {!panel && (
          <button
            type="button"
            aria-label={`Show the knobs: ${shownName}`}
            onClick={() => show(true)}
            className={`pointer-events-auto absolute inset-x-0 bottom-0 flex h-9 items-center gap-2 px-3 text-left side:inset-x-auto side:inset-y-0 side:right-0 side:h-auto side:w-11 side:justify-center side:px-0 tall:inset-x-0 tall:top-auto tall:h-9 tall:w-auto tall:justify-start tall:px-3 ${DOCKED}`}
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
              className="shrink-0 text-zinc-300 side:-rotate-90 tall:rotate-0"
            >
              <path d="M4 11l5-5 5 5" />
            </svg>
            <span
              aria-hidden
              className="text-xs font-semibold text-zinc-200 side:hidden tall:inline"
            >
              Show the knobs
            </span>
            <span
              aria-hidden
              className="min-w-0 truncate text-[11px] text-zinc-400 side:hidden tall:inline"
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
 * Sound or Mix, the two the editor shows: first in the panel over the
 * card, where it stands in both. Its buttons are of the panel's 28 px
 * class, their touch reaching 44 (TALL_HIT).
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
      className="flex shrink-0 gap-0.5 rounded-lg bg-black/25 p-0.5"
    >
      {PANES.map(({ pane: each, label }) => (
        <button
          key={each}
          type="button"
          aria-pressed={pane === each}
          onClick={() => onPane(each)}
          className={`${TALL_HIT} h-7 rounded-md px-3 text-[11px] font-semibold tracking-wider text-zinc-400 aria-pressed:bg-white/10 aria-pressed:text-white`}
        >
          {label}
        </button>
      ))}
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
      // the panel, it takes the card's height, the editor
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
 * laid out by graphGeometry: the modulators stand in a lane across the
 * head, above the inputs, their blocks left to right and the "+" at the
 * lane's right, each held to be dragged along it; the tiles share the
 * frame's width, the out
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
  source,
  scope,
  dock,
  docked,
}: Picking & {
  focus: string | undefined
  /** The source being routed from: its modulators are outlined in sky */
  source: string | null
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
  /** The track played, whose inserts these are */
  const track = engine.getTrack().id
  /** The chain each item stands in, for its look and its neighbours */
  const chainOf = new Map<string, number>()
  sound.chains.forEach((chain, c) => {
    chainOf.set(chain.id, c)
    for (const item of chain.items) chainOf.set(item.id, c)
  })
  const isChain = (id: string) => sound.chains.some((chain) => chain.id === id)
  /** The chain picked whole (its head), or the input: its threads lit */
  const whole = isChain(picked) ? picked : undefined
  const input = sound.inputs.some((each) => each.id === picked)
    ? picked
    : undefined
  /** How an input's thread shows: lit, or dim beside a chain or another's */
  const fromInput = (lit: boolean, focused: boolean): Shown =>
    focused
      ? 'focus'
      : lit
        ? 'lit'
        : whole !== undefined || input !== undefined
          ? 'dim'
          : undefined
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
  const modMarkerRef = useRef<HTMLSpanElement>(null)
  /** The lane's blocks, for the modulator drag to find its own tiles */
  const modulatorId = new Set(sound.modulators.map((modulator) => modulator.id))
  // A modulator dragged moves along the lane, the lane's own rule
  const dragMod = useTileDrag<Place>({
    scroller: frameRef,
    content: contentRef,
    marker: modMarkerRef,
    axis: () => 'x',
    // Measured: the blocks stand in a row of their own sizes
    locate: (id, x) => {
      const tiles = Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>('[data-drag]') ?? []
      ).filter((tile) => modulatorId.has(tile.dataset.drag ?? ''))
      const from = tiles.findIndex((tile) => tile.dataset.drag === id)
      const tile = tiles[from]
      const spans = tiles.map((each) => ({
        start: each.offsetLeft,
        end: each.offsetLeft + each.offsetWidth,
      }))
      const at = tile && spanDrop(spans, from, x, GRAPH.modGap, 0)
      if (!tile || !at) return undefined
      const seam = at.middle - MARK / 2
      return {
        to: at.to,
        color: MOD_LOOK.ink,
        marker: { x: seam, y: tile.offsetTop, w: MARK, h: tile.offsetHeight },
      }
    },
    drop: (id, at) => engine.edit((current) => movePart(current, id, at.to)),
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
      {geometry.mods.map(({ mod, box }) => (
        <Tile
          key={mod}
          engine={engine}
          drag={dragMod(mod)}
          label={tileLabel(sound, mod)}
          look={MOD_LOOK}
          picked={picked === mod}
          member={source === mod}
          reach={reach.has(mod)}
          routed={routed.has(mod)}
          aria={partName(sound, mod)}
          onClick={() => pick(mod)}
          // A block, its shape under its name, as its knobs turn
          picture={mod}
          stacked
          style={place(box)}
          small
        />
      ))}
      {geometry.addMod && (
        <Tile
          engine={engine}
          label="+"
          look={MOD_LOOK}
          picked={picked === addId('modulator')}
          dashed="add"
          aria="Add a modulator"
          onClick={() => pick(addId('modulator'))}
          style={place(geometry.addMod)}
          small
        />
      )}
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
            // A source's column has no room for a line: its threads say
            // where it goes
            line={
              tile.box.h >= 60 && tile.column === 0 ? tile.input : undefined
            }
            glyph={glyphOf(sound, tile.input)}
            look={NEUTRAL_LOOK}
            picked={picked === tile.input}
            reach={reach.has(tile.input)}
            routed={routed.has(tile.input)}
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
        // Down the seam before the amp, where the chains' levels land
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
        // the amp; a seam lights when either side is picked, and the
        // whole row with the head, the rest dim beside another's
        const parts = [chain.id, ...chain.items.map((item) => item.id), AMP]
        const shown = (k: number): Shown =>
          member || picked === parts[k] || picked === parts[k + 1]
            ? 'lit'
            : whole !== undefined
              ? 'dim'
              : undefined
        const last = row.stitches.length - 1
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
                foot
                aria={`Add an item to chain ${letter}`}
                onClick={() => pick(addId(chain.id))}
                style={place(row.add)}
              />
            )}
            {row.stitches.slice(0, last).map((run, k) => (
              <Thread
                key={k}
                row={chain.id}
                run={run}
                color={look.ink}
                shown={shown(k)}
              />
            ))}
            {row.stitches[last] && (
              <LevelThread
                engine={engine}
                chain={chain.id}
                run={row.stitches[last]}
                look={look}
                shown={shown(last)}
                // Onto the bus, where it stands: no hole there
                end={!geometry.bus}
              />
            )}
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
        const run = geometry.fxStitches[k]
        return (
          <div key={effect} className="contents">
            {run && (
              <Thread
                run={run}
                color={NEUTRAL_LOOK.ink}
                shown={
                  picked === effect || picked === before ? 'lit' : undefined
                }
              />
            )}
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
              reduction={insertReduction(sound, track, effect)}
            />
          </div>
        )
      })}
      <Thread
        run={geometry.outStitch}
        color={NEUTRAL_LOOK.ink}
        shown={
          picked === SENDS ||
          picked === (sound.effects[sound.effects.length - 1]?.id ?? AMP)
            ? 'lit'
            : undefined
        }
      />
      <Tile
        engine={engine}
        label="Out"
        text={<SendsLine engine={engine} across={geometry.out.h >= 60} />}
        look={NEUTRAL_LOOK}
        picked={picked === SENDS}
        clear="left"
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

      {geometry.reads.map((read) => (
        <ReadThread
          key={`${read.from}>${read.to}`}
          engine={engine}
          read={read}
          shown={fromInput(
            picked === read.from || picked === read.to,
            picked === read.from && focus === read.to
          )}
          // FM: the input read, its knob for the reader marked; a ring's
          // side has no amount of its own, so the ring
          onClick={() =>
            read.as === 'FM' ? pick(read.from, read.to) : pick(read.to)
          }
        />
      ))}
      {geometry.sends.map((send) => (
        <SendThread
          key={`${send.input}>${send.chain}`}
          engine={engine}
          input={send.input}
          chain={send.chain}
          run={send.run}
          look={chainLook(chainOf.get(send.chain) ?? 0)}
          shown={fromInput(
            picked === send.input || picked === send.chain,
            picked === send.chain && focus === send.input
          )}
          onClick={() => pick(send.chain, send.input)}
        />
      ))}
      <Marker ref={markerRef} />
      <Marker ref={modMarkerRef} />
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
/**
 * Where an insert of sound (or the kit's chain) plays, for its tile to
 * show how far it turns down: only a compressor's or a limiter's
 */
function insertReduction(
  sound: Sound,
  track: string,
  id: string
): EffectAt | undefined {
  const kind = sound.effects.find((effect) => effect.id === id)?.kind
  return kind && reduces(kind) ? { track, id } : undefined
}

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
  /** The kit played, whose chain this is */
  const track = engine.getTrack().id
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
        const run = geometry.fxStitches[k]
        return (
          <div key={effect} className="contents">
            {run && (
              <Thread
                run={run}
                color={NEUTRAL_LOOK.ink}
                shown={
                  picked === effect || picked === before ? 'lit' : undefined
                }
              />
            )}
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
              reduction={insertReduction(sound, track, effect)}
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
          foot
        />
      )}
      <Thread
        run={geometry.outStitch}
        color={NEUTRAL_LOOK.ink}
        shown={picked === SENDS || picked === last ? 'lit' : undefined}
      />
      <Tile
        engine={engine}
        label="Kit Out"
        text={<SendsLine engine={engine} across={geometry.out.h >= 60} />}
        look={NEUTRAL_LOOK}
        picked={picked === SENDS}
        clear="left"
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
 * another track (more tracks than the frame is tall for pan down); each
 * bus a row, its letter's head, its effects and its "+"; the master's
 * effects and the master, which holds the output's view and its meters,
 * wider. Threads join them: from each track's strip to the head of each
 * bus it sends anything to, as thick as the send, down that bus's lane
 * (its sends' bars are the Out's: the view has the strip), and along each
 * bus's row into the master, the last run as thick as the bus's level. A
 * strip makes its track the one played and picks its sends, lighting its
 * threads and dimming the other tracks'; a send's thread makes its track
 * the one played and picks its bus; a bus's head lights its threads, the
 * tracks' to it and its row's, and dims the other buses'.
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
  /** The bus picked whole (its head): its threads lit, the others' dim */
  const whole = mix.buses.find((bus) => mixId(bus.id) === picked)?.id
  /** The buses each track sends anything to, by place, live */
  const sending = useSyncExternalStore(engine.subscribeSound, () =>
    engine
      .getTracks()
      .map((track) =>
        engine
          .getMix()
          .buses.filter((bus) => (sendsOf(track)[bus.id] ?? 0) > 0)
          .map((bus) => bus.id)
          .join(' ')
      )
      .join('|')
  )
  const threads = mixSends(
    geometry,
    sending.split('|').map((buses) => (buses ? buses.split(' ') : []))
  ).map((thread) => {
    const lit =
      (strip && thread.strip === output) || picked === mixId(thread.bus)
    const shown: Shown = lit
      ? 'lit'
      : strip || (whole !== undefined && whole !== thread.bus)
        ? 'dim'
        : undefined
    return { ...thread, shown }
  })
  // The lit over the rest, where they share a lane
  threads.sort((a, b) => Number(a.shown === 'lit') - Number(b.shown === 'lit'))
  /** How a thread of bus's shows: lit, or dim beside another's */
  const shown = (bus: string, lit: boolean): Shown =>
    lit ? 'lit' : whole !== undefined && whole !== bus ? 'dim' : undefined
  /** What the buses' threads come into: the master's first effect, or it */
  const into = mixId(geometry.masterEffects[0]?.effect ?? MASTER)
  /** A row's effects' tiles */
  const effects = (row: readonly EffectBox[], where: string, look: Look) =>
    row.map(({ effect, box }) => {
      const id = mixId(effect)
      const found = findMixPart(mix, effect)
      const kind = found?.type === 'effect' ? found.effect.kind : 'chorus'
      return (
        <div key={effect} className="contents">
          <Tile
            engine={engine}
            label={effectTile(kind)}
            text={
              geometry.icons ? undefined : (
                <MixLine engine={engine} part={effect} />
              )
            }
            glyph={
              geometry.icons || box.h >= 60 ? EFFECT_GLYPHS[kind] : undefined
            }
            icon={geometry.icons}
            look={look}
            picked={picked === id}
            aria={`${mixPartName(mix, effect)}, ${where}`}
            onClick={() => pick(id)}
            style={place(box)}
            reduction={reduces(kind) ? { id: effect } : undefined}
          />
        </div>
      )
    })
  /** The master's row, its effects then it, by id */
  const stages = [
    ...geometry.masterEffects.map(({ effect }) => mixId(effect)),
    master,
  ]
  return (
    <Frame
      frameRef={frameRef}
      rest={Math.max(graphGeometry(sound, LIMITS).rest, mixRest(engine))}
      room={room}
      docked={docked}
      width={geometry.width}
      height={geometry.height}
    >
      {geometry.strips.map((box, k) => {
        // The track played's strip carries its sends; another's, tapped,
        // makes its track the one played
        const track = tracks[k]
        if (!track) return null
        const played = k === output
        const name = trackName(track, k)
        return (
          <StripTile
            key={track.id}
            place={k}
            engine={engine}
            label={name}
            text={<StripLine engine={engine} place={k} />}
            inline
            look={NEUTRAL_LOOK}
            picked={played && strip}
            // Its sends' holes down its right edge
            clear="right"
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
        // Each run's neighbours: the head or an effect, then an effect or
        // what the buses come into; a run lights when either is picked
        const parts = [id, ...bus.effects.map((effect) => mixId(effect.id))]
        const lit = (k: number) =>
          picked === id ||
          picked === parts[k] ||
          picked === (parts[k + 1] ?? into)
        const last = row.stitches.length - 1
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
            {effects(row.effects, `on bus ${letter}`, look)}
            {row.add && (
              <Tile
                engine={engine}
                label={row.add.w < 60 ? '+' : '+ FX'}
                look={look}
                picked={picked === mixAddId(bus.id)}
                member={member}
                dashed="add"
                foot
                aria={`Add an effect to bus ${letter}`}
                onClick={() => pick(mixAddId(bus.id))}
                style={place(row.add)}
              />
            )}
            {row.stitches.slice(0, last).map((run, k) => (
              <Thread
                key={k}
                run={run}
                color={look.ink}
                shown={shown(bus.id, lit(k))}
              />
            ))}
            {row.stitches[last] && (
              <BusLevelThread
                engine={engine}
                bus={bus.id}
                run={row.stitches[last]}
                shown={shown(bus.id, lit(last) || picked === master)}
              />
            )}
          </div>
        )
      })}
      {effects(geometry.masterEffects, 'on the master', NEUTRAL_LOOK)}
      {geometry.masterStitches.map((run, k) => (
        <Thread
          key={k}
          run={run}
          color={NEUTRAL_LOOK.ink}
          shown={
            picked === stages[k] || picked === stages[k + 1] ? 'lit' : undefined
          }
        />
      ))}
      <Tile
        engine={engine}
        label="Master"
        text={<MixLine engine={engine} part={MASTER} />}
        look={NEUTRAL_LOOK}
        picked={picked === master}
        // The buses' holes down its left edge
        clear="left"
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
      {threads.map((thread) => (
        <MixSendThread
          key={`${thread.strip}>${thread.bus}`}
          engine={engine}
          thread={thread}
          onClick={() => {
            const track = tracks[thread.strip]
            if (track && thread.strip !== output) engine.pickTrack(track.id)
            pick(mixId(thread.bus))
          }}
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

/**
 * A track's strip under its name: Mute or Solo where it is one, in the
 * toggle's colour (src/ui/Mutes.tsx), else its level
 */
function StripLine({ engine, place }: { engine: Engine; place: number }) {
  const state = useStripState(engine, place)
  if (state === 'mute') return <span className="text-amber-200">Mute</span>
  if (state === 'solo') return <span className="text-emerald-200">Solo</span>
  return <MixLine engine={engine} part={stripId(place)} />
}

/**
 * A track's strip in the mix: a tile, dim while the track is not heard
 * (muted, or silent while another is soloed), and saying so
 */
function StripTile({
  place,
  ...tile
}: { place: number } & ComponentProps<typeof Tile>) {
  const state = useStripState(tile.engine, place)
  const words = STATE_WORDS[state]
  return (
    <Tile
      {...tile}
      aria={words ? `${tile.aria}; ${words}` : tile.aria}
      className={state === 'mute' || state === 'off' ? 'opacity-55' : ''}
    />
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

/**
 * How a thread shows beside what is picked: lit with it (focused, the
 * knob for it lit in the panel), dim beside another lit whole, or as it
 * is (undefined)
 */
type Shown = 'lit' | 'focus' | 'dim' | undefined

/** How strongly a seam's stitch shows, unless lit or dim */
const STITCH_OPACITY = 0.8
/** Room around a thread's run for its holes and its glow */
const THREAD_PAD = 8

/**
 * A thread's run across a seam (threads.ts), in an SVG of its own just
 * big enough, over the tiles: width wide and opacity strong, a seam's
 * stitch unless given, with a hole at either end (none at the end on a
 * bus), an S across the seam or along a lane down it; lit, full and
 * glowing, focused the more; dim, at a quarter. Marked
 * with the chain whose row it moves with, when that is dragged.
 */
function Thread({
  run,
  lane,
  color,
  width = THREAD.stitch,
  opacity = STITCH_OPACITY,
  shown,
  row,
  end = true,
}: {
  run: Run
  /** Where it turns down the seam, if it keeps to a lane (lanePath) */
  lane?: number
  color: string
  width?: number
  opacity?: number
  shown: Shown
  row?: string
  end?: boolean
}) {
  const left = Math.min(run.from.x, run.to.x) - THREAD_PAD
  const top = Math.min(run.from.y, run.to.y) - THREAD_PAD
  const glow =
    shown === 'focus'
      ? `drop-shadow(0 0 2px ${color}) drop-shadow(0 0 5px ${color})`
      : shown === 'lit'
        ? `drop-shadow(0 0 3px ${color})`
        : undefined
  return (
    <svg
      aria-hidden
      data-row={row}
      width={Math.abs(run.to.x - run.from.x) + 2 * THREAD_PAD}
      height={Math.abs(run.to.y - run.from.y) + 2 * THREAD_PAD}
      className="pointer-events-none absolute z-[3] overflow-visible"
      style={{
        left,
        top,
        opacity:
          shown === 'dim' ? THREAD.dim : shown === undefined ? opacity : 1,
        filter: glow,
      }}
    >
      <path
        d={
          lane === undefined
            ? runPath(run, left, top)
            : lanePath(run, lane, left, top)
        }
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <circle
        cx={run.from.x - left}
        cy={run.from.y - top}
        r={THREAD.hole}
        fill={color}
      />
      {end && (
        <circle
          cx={run.to.x - left}
          cy={run.to.y - top}
          r={THREAD.hole}
          fill={color}
        />
      )}
    </svg>
  )
}

/** A run's tap target: THREAD.hitW by hitH about its middle */
function hitAbout(run: Run): Box {
  const { x, y } = runMiddle(run)
  return {
    x: x - THREAD.hitW / 2,
    y: y - THREAD.hitH / 2,
    w: THREAD.hitW,
    h: THREAD.hitH,
  }
}

/** A thread's tap target, over it at box */
function ThreadHit({
  box,
  label,
  onClick,
}: {
  box: Box
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute z-[3] rounded-md"
      style={place(box)}
    />
  )
}

/** A thread as thick and as strong as level, 0 to 1 */
const carrying = (level: number) => ({
  width: threadWidth(level),
  opacity: threadOpacity(level),
})

/**
 * An input's send to a chain, its thread: as thick and as strong as the
 * send; a tap picks the chain, its knob for the input lit
 */
function SendThread({
  engine,
  input,
  chain,
  run,
  look,
  shown,
  onClick,
}: {
  engine: Engine
  input: string
  chain: string
  run: Run
  look: Look
  shown: Shown
  onClick: () => void
}) {
  const level = useLive(engine, (sound) => {
    return sound.chains.find((each) => each.id === chain)?.sends[input] ?? 0
  })
  const sound = engine.getSound()
  return (
    <>
      <Thread run={run} color={look.ink} shown={shown} {...carrying(level)} />
      <ThreadHit
        box={hitAbout(run)}
        label={`${partName(sound, input)} into ${partName(sound, chain)}, ${Math.round(level * 100)}%. Tap to set it.`}
        onClick={onClick}
      />
    </>
  )
}

/**
 * A read's thread, from the input read to its reader: as thick and as
 * strong as the reader's FM (a ring's side, full), as a send's is as its
 * send. Tapped, it picks as onClick says.
 */
function ReadThread({
  engine,
  read,
  shown,
  onClick,
}: {
  engine: Engine
  read: GraphGeometry['reads'][number]
  shown: Shown
  onClick: () => void
}) {
  const level = useLive(engine, (sound) =>
    read.as === 'FM'
      ? (sound.inputs.find((input) => input.id === read.to)?.values.fm ?? 0)
      : 1
  )
  const sound = engine.getSound()
  const from = partName(sound, read.from)
  const to = partName(sound, read.to)
  return (
    <>
      <Thread
        run={read.run}
        color={NEUTRAL_LOOK.ink}
        shown={shown}
        {...carrying(level)}
      />
      <ThreadHit
        box={hitAbout(read.run)}
        label={
          read.as === 'FM'
            ? `${from} into ${to}'s FM, ${Math.round(level * 100)}%. Tap to set it.`
            : `${from} into ${to}, a side of its ring`
        }
        onClick={onClick}
      />
    </>
  )
}

/**
 * A chain's last run, into the amp (or onto the bus): as thick and as
 * strong as the chain's level; it moves with the chain's row
 */
function LevelThread({
  engine,
  chain,
  run,
  look,
  shown,
  end,
}: {
  engine: Engine
  chain: string
  run: Run
  look: Look
  shown: Shown
  end: boolean
}) {
  const level = useLive(engine, (sound) => {
    return sound.chains.find((each) => each.id === chain)?.values.level ?? 0
  })
  return (
    <Thread
      run={run}
      row={chain}
      color={look.ink}
      shown={shown}
      end={end}
      {...carrying(level)}
    />
  )
}

/** What a track sends to each bus: a synth's sound's, a kit's chain's */
const sendsOf = (track: Track) =>
  track.kind === 'synth' ? track.sound.sends : track.chain.sends

/**
 * A track's send to a bus, its thread down the bus's lane: as thick and
 * as strong as the send, live; a tap makes the track the one played and
 * picks the bus
 */
function MixSendThread({
  engine,
  thread,
  onClick,
}: {
  engine: Engine
  thread: MixThread & { readonly shown: Shown }
  onClick: () => void
}) {
  const { strip, bus } = thread
  const level = useSyncExternalStore(engine.subscribeSound, () => {
    const track = engine.getTracks()[strip]
    return track ? (sendsOf(track)[bus] ?? 0) : 0
  })
  const track = engine.getTracks()[strip]
  const name = track ? trackName(track, strip) : 'A track'
  return (
    <>
      <Thread
        run={thread.run}
        lane={thread.lane}
        color={busLook(bus).ink}
        shown={thread.shown}
        {...carrying(level)}
      />
      <ThreadHit
        box={thread.hit}
        label={`${name} into bus ${bus.toUpperCase()}, ${Math.round(level * 100)}%. Tap to set it.`}
        onClick={onClick}
      />
    </>
  )
}

/** A bus's last run, into the master: as thick and as strong as its level */
function BusLevelThread({
  engine,
  bus,
  run,
  shown,
}: {
  engine: Engine
  bus: string
  run: Run
  shown: Shown
}) {
  const level = useLiveMix(engine, bus, 'level')
  return (
    <Thread
      run={run}
      color={busLook(bus).ink}
      shown={shown}
      {...carrying(level)}
    />
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
 * edges, its corners rounded as the tile's. An icon is its pictogram
 * alone, larger, its name left to its label for the ear. A "+" a thread
 * runs over (a row's) has its label at its foot, out of the thread's way,
 * and a view a thread comes into stands clear of its holes.
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
  dashed,
  foot = false,
  aria,
  onClick,
  style,
  className = '',
  small = false,
  aside: view,
  clear,
  picture,
  stacked = false,
  inline = false,
  text,
  reduction,
  icon = false,
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
  dashed?: 'add' | 'copy'
  /** Its label at its foot: a row's "+", a thread running over its middle */
  foot?: boolean
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
  /**
   * The edge whose holes the view stands clear of, under the label: a
   * thread's holes, THREAD.inset inside it
   */
  clear?: 'left' | 'right'
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
  /** A compressor's or limiter's: how far it turns down, rising over it */
  reduction?: EffectAt
  /** Its pictogram alone, for a tile too narrow for words: a mix's effect */
  icon?: boolean
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
  if (icon && pictogram) {
    content = (
      <svg viewBox="0 0 18 12" width={26} height={17} aria-hidden>
        <path
          d={pictogram}
          fill="none"
          stroke={look.ink}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  } else if (mark !== undefined) {
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
            : foot
              ? 'flex-col justify-end px-1 pb-1'
              : `justify-center ${column ? 'flex-col gap-1 px-1' : 'gap-[7px] px-1.5'}`
      } ${picked ? 'z-[2]' : 'z-[1]'} ${className}`}
    >
      {reduction && (
        // Under its picture, as it rises: on the face, inside the ring
        <TileReduction engine={engine} at={reduction} color={look.ink} />
      )}
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
        <span
          className={`flex min-h-0 w-full flex-1 gap-1 ${
            clear === 'left' ? 'pl-1.5' : clear === 'right' ? 'pr-1.5' : ''
          }`}
        >
          {view}
        </span>
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
