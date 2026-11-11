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
import { GRAPH, graphGeometry, type Box } from '../viz/graph'
import {
  MOD_LOOK,
  NEUTRAL_LOOK,
  VOICE_LOOK,
  addId,
  chainLetter,
  chainLook,
  glyphOf,
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

/** Where a tile dragged goes: its index, and the chain an item goes into */
type Place = Spot & { readonly to: number; readonly chain?: string }

/** The tile picked, kept for the tab: a reload picks it again */
const PICKED_KEY = 'loopromeda.picked'

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

/** What the editor's parts share: the engine, what is picked, picking */
interface Picking {
  readonly engine: Engine
  readonly sound: Sound
  readonly picked: string
  /** Picks id; a chain's peg picks the chain with the input it is for */
  readonly pick: (id: string, input?: string) => void
  /** The tiles in a sky ring: what the picked part reaches (reachOf) */
  readonly reach: ReadonlySet<string>
}

/**
 * The sound as flat tiles flowing left to right (docs/plan/sound-chains.md,
 * The editor): the modulators' rack and the voice above (beside, at the
 * left, on a wider screen), the inputs in a column, a row per chain (its
 * head, its items, the amp at the end of every row), and under it all the
 * panel of the tile picked. Tapping a
 * tile picks it; a peg between an input and a chain picks the chain, its
 * knob for that input lit.
 *
 * It redraws when the sound's shape changes (shapeKey: a part added, an
 * input feeding a chain, a wave changed); a knob turning redraws only the
 * knob and the line or peg that shows it.
 *
 * The panel turns to routing in two ways (RoutePanels.tsx). Holding a
 * knob shows the routes into it. A modulator's Route shows the picked
 * tile's knobs as depths from it, while tiles are picked as before.
 *
 * Held, a tile lifts to be dragged (tileDrag.ts): an item along its chain
 * or into another, a chain's head (its row with it) up or down, a
 * modulator along the rack. Inputs stand beside the chains they feed, so
 * only the panel moves them.
 */
export function SoundEditor({
  engine,
  scope,
}: {
  engine: Engine
  scope?: AmpScope
}) {
  useSyncExternalStore(engine.subscribeSound, () => shapeKey(engine.getSound()))
  const sound = engine.getSound()
  const [chosen, setChosen] = useState(readPicked)
  const [focus, setFocus] = useState<string | undefined>(undefined)
  const [menu, setMenu] = useState(false)
  const [routing, setRouting] = useState<RouteTarget | null>(null)
  /** The source routed from while tiles are picked, if any */
  const [mapping, setMapping] = useState<string | null>(null)
  const picked = stillPicked(sound, chosen)
  // Either goes with what it names: a part removed, another preset
  const into =
    routing && destOf(sound, routing.target, routing.key) ? routing : null
  const from = mapping !== null && isSource(sound, mapping) ? mapping : null

  const pick = (id: string, input?: string) => {
    setChosen(id)
    keepPicked(id)
    setFocus(input)
    setMenu(false)
    setRouting(null)
  }
  const picking: Picking = {
    engine,
    sound,
    picked,
    pick,
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
  // screen a little over a third of the row, up to 40rem. On a roomy
  // screen both fill the height the page gives the editor (App.tsx), the
  // tiles at the top of theirs, and the graph pans only past it. On a wide
  // one (index.css) the panel stands under the graph again, the whole
  // width, its knobs 72 px in a row over the keys (knobRow), and the graph
  // takes the rest of the height. Held upright, the rack stands over the
  // graph; on a wider screen, whose graph has width to spare and little
  // height, it stands at its left, a column.
  return (
    <div className="flex min-h-0 flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_clamp(22rem,36%,40rem)] md:grid-rows-[minmax(0,1fr)] max-md:flex-1 roomy:flex-1 wide:flex">
      <section
        aria-label="The sound, flowing left to right"
        className={`flex min-h-[8.75rem] min-w-0 flex-col overflow-hidden max-md:flex-1 md:flex-row wide:flex-1 ${CARD}`}
      >
        <Rack {...picking} source={from} />
        <Graph
          {...picking}
          focus={picked === chosen ? focus : undefined}
          scope={scope}
        />
      </section>
      <div className="grid h-[calc(7.5rem_+_var(--knob))] max-h-[calc(100%-9.5rem)] min-h-0 shrink-0 overflow-y-auto overscroll-contain rounded-xl [--knob:clamp(3rem,calc((100vw_-_4.5rem)/8.5),4.5rem)] md:h-0 md:max-h-none md:min-h-full md:[--knob:3rem] wide:h-[calc(7.5rem_+_var(--knob))] wide:min-h-0 wide:[--knob:4.5rem]">
        {into ? (
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
            menu={menu}
            onMenu={setMenu}
            onRoute={route}
            onMap={map}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The voice first, a block over the inputs, whose pitch it sets: where a
 * note comes in, its mode under its name. Then the modulators in a row,
 * each a block drawing its shape, and a "+" while there is room. The row
 * scrolls sideways under the voice, which clips at its padding: there is
 * room in it for a tile's rings (a reach ring stands 3.5 px out). From md
 * up it is a column at the graph's left, the voice on top, scrolling down
 * (it asks no height of the card: the graph sets that). The source being
 * routed from is outlined in sky. A modulator dragged moves along it.
 */
function Rack({
  engine,
  sound,
  picked,
  pick,
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
    lift: (id) => pick(id),
  })
  return (
    <div className="mx-2 mt-2 mb-1 flex h-[4.25rem] shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.03] pr-0.5 pl-1.5 md:mr-1 md:mb-2 md:h-auto md:w-[4.25rem] md:flex-col md:px-0 md:pt-1.5 md:pb-0.5">
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
        className="size-14 shrink-0"
        small
      />
      <span
        aria-hidden
        className="h-10 w-px shrink-0 bg-white/10 md:h-px md:w-10"
      />
      <div
        ref={scrollerRef}
        aria-label="Modulators"
        className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain px-1 py-1.5 md:min-h-0 md:basis-0 md:flex-col md:self-stretch md:overflow-x-hidden md:overflow-y-auto md:overscroll-y-contain md:px-1.5 md:py-1"
      >
        <div
          ref={contentRef}
          className="relative flex shrink-0 gap-1 md:flex-col"
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
              className="size-14 shrink-0"
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
              className="h-14 w-7 shrink-0 md:h-7 md:w-14"
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
 * takes the room the page leaves it, up to a cap, and pans what it cannot
 * show.
 */
function Graph({
  engine,
  sound,
  picked,
  pick,
  reach,
  focus,
  scope,
}: Picking & { focus: string | undefined; scope: AmpScope | undefined }) {
  const frameRef = useRef<HTMLDivElement>(null)
  /** The frame's size, measured: 0 until it is */
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const element = frameRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      const w = Math.floor(box?.width ?? 0)
      const h = Math.floor(box?.height ?? 0)
      setFrame((was) => (was.w === w && was.h === h ? was : { w, h }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const geometry = graphGeometry(
    sound,
    LIMITS,
    frame.w || undefined,
    frame.h || undefined
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
    lift: (id) => pick(id),
  })

  return (
    <div
      ref={frameRef}
      // Its height at rest is what it asks of the card, the slots grown or
      // not (held upright, at most 45% of the screen; beside the rack, from
      // md up, at most 22rem): a card given more (the editor filling the
      // page) grows it, and the slots fill it
      style={{ '--rest': `${geometry.rest}px` } as CSSProperties}
      className="relative min-h-0 grow basis-[min(var(--rest),22rem,45dvh)] overflow-auto overscroll-contain md:h-[min(var(--rest),22rem)] md:max-h-full md:min-w-0 md:basis-0 roomy:h-auto roomy:max-h-none"
    >
      <div
        ref={contentRef}
        className="relative min-w-full"
        style={{ width: geometry.width, height: geometry.height }}
      >
        {geometry.inputs.map((tile) => {
          const into = tile.chains.map((chain) => chainOf.get(chain) ?? 0)
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
          return (
            <Tile
              key={tile.input}
              engine={engine}
              label={tileLabel(sound, tile.input)}
              line={tile.box.h >= 60 ? tile.input : undefined}
              glyph={glyphOf(sound, tile.input)}
              look={NEUTRAL_LOOK}
              picked={picked === tile.input}
              reach={reach.has(tile.input)}
              routed={routed.has(tile.input)}
              dots={feeds.map((c) => chainLook(c).ink)}
              aria={`${partName(sound, tile.input)}, ${tileLine(sound, tile.input)}${
                feeds.length > 0
                  ? `, into ${feeds.map(chainLetter).join(' and ')}`
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
  const tall = !dashed && !small && height >= 60
  const under = picture !== undefined && (tall || stacked)
  // A picture stands in for the pictogram
  const pictogram = picture === undefined ? glyph : undefined
  // A short tile stacks a line under its label only without a pictogram
  const column =
    under || tall || mark !== undefined || (line !== undefined && !pictogram)

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
