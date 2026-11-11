import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Engine } from '../engine/engine'
import {
  addChain,
  addInput,
  addItem,
  addModulator,
  movePart,
  removePart,
  setRef,
  setSend,
  type Added,
} from '../state/sound/edit'
import {
  AMP_SPEC,
  CHAIN_SPEC,
  INPUT_KINDS,
  ITEM_KINDS,
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MODULATOR_KINDS,
  SEND_SPEC,
  VOICE_SPEC,
  type DestSpec,
  type InputKind,
  type ItemKind,
  type ModulatorKind,
} from '../state/sound/kinds'
import {
  AMP,
  VOICE,
  findPart,
  partName,
  refLoops,
  sendKey,
  type Sound,
} from '../state/sound/sound'
import {
  BUTTON,
  BUTTON_DANGER,
  KNOB_ROW,
  KNOB_SIZE,
  SMALL_BUTTON,
  TALL_HIT,
} from './controls'
import {
  GLYPHS,
  MOD_COLOR,
  MOD_LOOK,
  NEUTRAL_LOOK,
  VOICE_LOOK,
  addingTo,
  chainLetter,
  chainLook,
  destName,
  glyphOf,
  lookOf,
  type Look,
} from './editor'
import { Knob, NEUTRAL_ARC } from './Knob'
import { knoblessDests, routesTo } from '../state/sound/knob'
import {
  OUTLINE_HEIGHT,
  OUTLINE_WIDTH,
  outlineFill,
  outlineKind,
  outlinePath,
} from './outline'

/** One kind a "+" offers: its pictogram, name and what it does */
interface Choice {
  readonly label: string
  readonly hint: string
  readonly glyph: string
  readonly look: Look
  /** Adds it; none at the limit */
  readonly add: (() => void) | undefined
}

/** One action of the "⋯" menu */
interface Action {
  readonly label: string
  readonly run: (() => void) | undefined
  readonly danger?: boolean
}

/** A chain an input may feed, as a toggle: on while it takes the input */
interface Feed {
  readonly chain: string
  readonly letter: string
  readonly look: Look
  readonly on: boolean
  readonly toggle: () => void
}

/** A destination that no knob holds, beside the knobs: tap to route */
interface Knobless {
  readonly part: string
  readonly dest: DestSpec
  readonly count: number
}

/** Where a modulator's route goes */
interface Target {
  readonly id: string
  readonly label: string
  readonly target: string
  readonly key: string
  /** The modulator only scales this route, another source's */
  readonly via: boolean
}

/** What the panel shows for the tile picked */
interface View {
  readonly title: string
  readonly kind: string
  readonly chip: { look: Look; glyph?: string; mark?: string; add?: boolean }
  readonly knobs: readonly { part: string; key: string; hot?: string }[]
  /** The knobs' arc: a chain's colour on its own parts, else neutral */
  readonly color: string
  /** A picture of the part beside its name, in this colour */
  readonly outline?: string
  readonly refs?: ReactNode
  /** An input's chains, each a toggle: which ones it feeds */
  readonly feeds?: readonly Feed[]
  /** Destinations no knob holds (the voice's pitch), routed by a tap */
  readonly knobless?: readonly Knobless[]
  /** A modulator's routes, by where each goes; it routes from source */
  readonly targets?: { source: string; to: readonly Target[] }
  readonly note?: string
  readonly choices?: readonly Choice[]
  readonly choiceNote?: string
  readonly actions?: readonly Action[]
  readonly actionNote?: string
}

const INPUT_HINTS: Record<InputKind, string> = {
  osc: 'Wave and FM',
  noise: 'White noise',
  ring: 'One × another',
}
const ITEM_HINTS: Record<ItemKind, string> = {
  filter: 'LP, HP or BP',
  drive: 'Soft clip',
}
const MODULATOR_HINTS: Record<ModulatorKind, string> = {
  env: 'Attack to release',
  lfo: 'Shape and rate',
}
const KIND_GLYPHS = {
  osc: GLYPHS.saw,
  noise: GLYPHS.noise,
  ring: GLYPHS.ring,
  filter: GLYPHS.lowpass,
  drive: GLYPHS.drive,
  env: GLYPHS.env,
  lfo: GLYPHS.sine,
}

/**
 * The panel under the graph: the knobs of the tile picked, in its chain's
 * colour; for a "+", the kinds it adds; behind "⋯", moving the part and
 * removing it. An input picks the chains it feeds here, an oscillator its
 * FM source, a ring its two inputs.
 */
export function PartPanel({
  engine,
  sound,
  picked,
  pick,
  focus,
  menu,
  onMenu,
  onRoute,
  onMap,
}: {
  engine: Engine
  sound: Sound
  picked: string
  pick: (id: string, input?: string) => void
  focus: string | undefined
  menu: boolean
  onMenu: (open: boolean) => void
  /** Opens the routes into a destination: a knob held, a target tapped */
  onRoute: (target: string, key: string) => void
  /** Routes from source into the tiles picked, starting at target */
  onMap: (source: string, target?: string) => void
}) {
  const view = viewOf(engine, sound, picked, focus, pick)
  const open = menu && view.actions !== undefined
  const { chip } = view

  return (
    <section
      aria-label={view.title}
      className="flex min-h-[8.5rem] min-w-0 flex-col gap-2 rounded-xl bg-white/5 px-2.5 py-2"
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-extrabold"
          style={
            chip.add
              ? {
                  border: `1.5px dashed ${chip.look.ink}`,
                  color: chip.look.ink,
                }
              : {
                  background: '#1c1c23',
                  boxShadow: `inset 0 0 0 1.5px ${chip.look.ring}`,
                  color: chip.look.ink,
                }
          }
        >
          {chip.mark ??
            (chip.glyph && (
              <svg viewBox="0 0 18 12" width={15} height={10}>
                <path
                  d={chip.glyph}
                  fill="none"
                  stroke={chip.look.ink}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ))}
        </span>
        <h2 className="shrink-0 text-sm font-semibold whitespace-nowrap text-zinc-100">
          {view.title}
        </h2>
        <span className="min-w-0 truncate text-[11px] text-zinc-400">
          {view.kind}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {view.outline && (
            <Outline engine={engine} part={picked} color={view.outline} />
          )}
          {view.refs}
          {view.actions && (
            <button
              type="button"
              aria-label="Move or remove"
              aria-expanded={open}
              onClick={() => onMenu(!open)}
              className={`${SMALL_BUTTON} w-7 justify-center px-0 text-sm aria-expanded:bg-white/15`}
            >
              ⋯
            </button>
          )}
        </span>
      </div>

      {open ? (
        <>
          <div className="flex gap-2">
            {view.actions?.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={!action.run}
                onClick={action.run}
                className={`${action.danger ? BUTTON_DANGER : BUTTON} flex-1 px-2`}
              >
                {action.label}
              </button>
            ))}
          </div>
          {view.actionNote && (
            <p className="text-[11px] leading-snug text-zinc-500">
              {view.actionNote}
            </p>
          )}
        </>
      ) : view.choices ? (
        <>
          <div className="flex gap-2">
            {view.choices.map((choice) => (
              <button
                key={choice.label}
                type="button"
                disabled={!choice.add}
                onClick={choice.add}
                className="flex h-[54px] max-w-[108px] flex-1 flex-col items-start justify-center gap-[3px] rounded-[7px] bg-[#1c1c23] px-2.5 text-left text-zinc-100 disabled:opacity-40"
                style={{ boxShadow: `inset 0 0 0 1.5px ${choice.look.ring}` }}
              >
                <span className="flex items-center gap-1.5">
                  <svg viewBox="0 0 18 12" width={18} height={12} aria-hidden>
                    <path
                      d={choice.glyph}
                      fill="none"
                      stroke={choice.look.ink}
                      strokeWidth={1.7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-xs font-semibold">{choice.label}</span>
                </span>
                <span className="text-[10px] whitespace-nowrap text-zinc-400">
                  {choice.hint}
                </span>
              </button>
            ))}
          </div>
          {view.choiceNote && (
            <p className="text-[11px] leading-snug text-zinc-500">
              {view.choiceNote}
            </p>
          )}
        </>
      ) : (
        <>
          {view.feeds && view.feeds.length > 0 && (
            <Feeds title={view.title} feeds={view.feeds} />
          )}
          {view.knobs.length > 0 || view.knobless?.length ? (
            <div className={KNOB_ROW}>
              {view.knobs.map(({ part, key, hot }) => (
                <Knob
                  key={`${part} ${key}`}
                  engine={engine}
                  part={part}
                  knob={key}
                  color={view.color}
                  hot={hot}
                  onHold={(dest) => onRoute(part, dest)}
                />
              ))}
              {view.knobless?.map(({ part, dest, count }) => (
                <button
                  key={`${part} ${dest.key}`}
                  type="button"
                  aria-label={`Route to ${view.title} ${dest.label}`}
                  onClick={() => onRoute(part, dest.key)}
                  className="flex min-w-0 flex-col items-center gap-0.5"
                >
                  <span
                    aria-hidden
                    style={{ border: `1.5px dashed ${MOD_LOOK.ring}` }}
                    className={`${KNOB_SIZE} relative flex aspect-square items-center justify-center rounded-full`}
                  >
                    <svg viewBox="0 0 18 12" width={18} height={12}>
                      <path
                        d={GLYPHS.route}
                        fill="none"
                        stroke={MOD_COLOR}
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="text-[11px] leading-tight whitespace-nowrap text-zinc-400">
                    {dest.label}
                  </span>
                  <span className="font-mono text-[11px] leading-tight whitespace-nowrap text-zinc-200">
                    {count === 0
                      ? 'Route'
                      : count === 1
                        ? '1 route'
                        : `${count} routes`}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            view.note && (
              <p className="text-xs leading-snug text-zinc-400">{view.note}</p>
            )
          )}
          {view.targets && (
            <Targets {...view.targets} onRoute={onRoute} onMap={onMap} />
          )}
        </>
      )}
    </section>
  )
}

/**
 * The chains an input feeds, one toggle per chain in its colour: on, the
 * chain takes the input at full level; off, not at all. Moving an input
 * to another chain is turning that one on and its own off.
 */
function Feeds({ title, feeds }: { title: string; feeds: readonly Feed[] }) {
  const none = !feeds.some((feed) => feed.on)
  return (
    <div
      role="group"
      aria-label={`Chains ${title} feeds`}
      className="flex shrink-0 items-center gap-1.5"
    >
      <span className="mr-0.5 text-[11px] text-zinc-500">Into</span>
      {feeds.map((feed) => (
        <button
          key={feed.chain}
          type="button"
          aria-pressed={feed.on}
          aria-label={`Chain ${feed.letter}`}
          onClick={feed.toggle}
          className={`${TALL_HIT} flex h-7 w-9 items-center justify-center rounded-md text-xs font-extrabold`}
          style={
            feed.on
              ? {
                  background: feed.look.tint,
                  boxShadow: `inset 0 0 0 1.5px ${feed.look.ink}`,
                  color: feed.look.ink,
                }
              : {
                  border: `1.5px dashed ${feed.look.ring}`,
                  color: feed.look.ring,
                }
          }
        >
          {feed.letter}
        </button>
      ))}
      {none && (
        <span className="ml-1 text-[11px] text-zinc-500">
          Silent: tap a chain
        </span>
      )}
    </div>
  )
}

/**
 * The part's picture (outline.ts): an envelope, an LFO's cycles, a
 * filter's response. It follows the knobs by setting the path itself, so
 * a knob turning re-renders nothing.
 */
function Outline({
  engine,
  part,
  color,
}: {
  engine: Engine
  part: string
  color: string
}) {
  const lineRef = useRef<SVGPathElement>(null)
  const fillRef = useRef<SVGPathElement>(null)
  useLayoutEffect(() => {
    let shown = ''
    const draw = () => {
      const line = outlinePath(engine.getSound(), part)
      if (line === shown) return
      shown = line
      lineRef.current?.setAttribute('d', line)
      fillRef.current?.setAttribute('d', outlineFill(line))
    }
    draw()
    return engine.subscribeSound(draw)
  }, [engine, part])
  return (
    <svg
      viewBox={`0 0 ${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
      className="h-6 w-24 shrink"
    >
      <path ref={fillRef} fill={color} fillOpacity={0.12} />
      <path
        ref={lineRef}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * Where a modulator goes: Route, which turns the panel into its depths on
 * each tile picked, then a chip per route, which does so on that route's
 * tile (or, for a route the modulator only scales, opens that route's
 * destination)
 */
function Targets({
  source,
  to,
  onRoute,
  onMap,
}: {
  source: string
  to: readonly Target[]
  onRoute: (target: string, key: string) => void
  onMap: (source: string, target?: string) => void
}) {
  return (
    <div
      role="group"
      aria-label="Routes"
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto overscroll-x-contain"
    >
      <button
        type="button"
        onClick={() => onMap(source)}
        style={{
          background: MOD_LOOK.tint,
          boxShadow: `inset 0 0 0 1.5px ${MOD_COLOR}`,
        }}
        className={`${TALL_HIT} flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold tracking-wider text-sky-100`}
      >
        <svg viewBox="0 0 18 12" width={15} height={10} aria-hidden>
          <path
            d={GLYPHS.route}
            fill="none"
            stroke={MOD_COLOR}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Route
      </button>
      {to.length === 0 ? (
        <span className="text-[11px] leading-snug text-zinc-500">
          then tap a tile and turn its knobs
        </span>
      ) : (
        <>
          <span className="mx-0.5 text-[11px] text-zinc-500">To</span>
          {to.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() =>
                target.via
                  ? onRoute(target.target, target.key)
                  : onMap(source, target.target)
              }
              style={{ boxShadow: `inset 0 0 0 1.5px ${MOD_LOOK.ring}` }}
              className={`${TALL_HIT} flex h-7 shrink-0 items-center rounded-md px-2.5 text-[11px] font-semibold whitespace-nowrap text-sky-100`}
            >
              {target.label}
            </button>
          ))}
        </>
      )}
    </div>
  )
}

/** Whether chain chainId of sound takes input inputId at all */
function feeds(sound: Sound, chainId: string, inputId: string): boolean {
  const chain = sound.chains.find((each) => each.id === chainId)
  return (chain?.sends[inputId] ?? 0) > 0
}

/** What the panel holds for picked */
function viewOf(
  engine: Engine,
  sound: Sound,
  picked: string,
  focus: string | undefined,
  pick: (id: string, input?: string) => void
): View {
  // Every edit here applies to the engine's sound as it is when tapped:
  // sound, from the last redraw, misses knobs turned since

  /** Adds a part to the sound playing, and picks the new part */
  const added = (add: (current: Sound) => Added) => {
    const { sound: next, id } = add(engine.getSound())
    engine.setSound(next)
    if (id !== null) pick(id)
  }
  const knobsOf = (part: string, keys: readonly { key: string }[]) =>
    keys.map(({ key }) => ({ part, key }))
  const knoblessOf = (part: string): Knobless[] =>
    knoblessDests(sound, part).map((dest) => ({
      part,
      dest,
      count: routesTo(sound, part, dest.key).length,
    }))

  const adding = addingTo(picked)
  if (adding !== undefined) {
    return addView(sound, adding, added)
  }
  if (picked === AMP) {
    return {
      title: 'Amp',
      kind: 'Out',
      chip: { look: NEUTRAL_LOOK, glyph: GLYPHS.env },
      knobs: knobsOf(AMP, AMP_SPEC.knobs),
      knobless: knoblessOf(AMP),
      color: NEUTRAL_ARC,
      outline: NEUTRAL_LOOK.ink,
    }
  }
  if (picked === VOICE) {
    return {
      title: 'Voice',
      kind: 'Mode and glide',
      chip: { look: VOICE_LOOK, mark: 'V' },
      knobs: knobsOf(VOICE, VOICE_SPEC.knobs),
      knobless: knoblessOf(VOICE),
      color: NEUTRAL_ARC,
    }
  }

  const found = findPart(sound, picked)
  /** Moves the part picked by one place, earlier or later */
  const move = (by: number) => {
    if (!found) return undefined
    const to = found.index + by
    const count =
      found.type === 'item'
        ? found.chain.items.length
        : found.type === 'input'
          ? sound.inputs.length
          : found.type === 'chain'
            ? sound.chains.length
            : sound.modulators.length
    if (to < 0 || to >= count) return undefined
    return () => engine.edit((current) => movePart(current, picked, to))
  }
  /** Removes the part picked, then picks after: its chain, or the first */
  const remove =
    (after = '') =>
    () => {
      engine.edit((current) => removePart(current, picked))
      pick(after)
    }
  const look = lookOf(sound, picked)
  const title = partName(sound, picked)

  switch (found?.type) {
    case 'item': {
      const { part, chain } = found
      return {
        title,
        kind: ITEM_KINDS[part.kind].label,
        chip: { look, glyph: glyphOf(sound, picked) },
        knobs: knobsOf(picked, ITEM_KINDS[part.kind].knobs),
        color: look.ink,
        outline: outlineKind(sound, picked) ? look.ink : undefined,
        actions: [
          { label: '◂ Move left', run: move(-1) },
          { label: 'Move right ▸', run: move(1) },
          { label: 'Remove', run: remove(chain.id), danger: true },
        ],
        actionNote: 'Or hold the tile and drag it, into another chain too.',
      }
    }
    case 'chain': {
      const level = { part: picked, key: CHAIN_SPEC.knobs[0]?.key ?? 'level' }
      return {
        title,
        kind: 'Its level, then how much of each input',
        chip: { look, mark: chainLetter(found.index) },
        knobs: [
          level,
          ...sound.inputs.map((input) => ({
            part: picked,
            key: sendKey(input.id),
            hot: focus === input.id ? look.ink : undefined,
          })),
        ],
        color: look.ink,
        actions: [
          { label: '▴ Move up', run: move(-1) },
          { label: 'Move down ▾', run: move(1) },
          { label: 'Remove', run: remove(), danger: true },
        ],
        actionNote:
          'Removing a chain removes its items. Or hold its letter and drag the row up or down.',
      }
    }
    case 'modulator': {
      const routes = sound.routes.filter(
        (route) => route.source === picked || route.via === picked
      )
      const count = routes.length
      const kind = MODULATOR_KINDS[found.part.kind].label
      return {
        title,
        kind: `${kind} · ${count === 0 ? 'routed nowhere yet' : count === 1 ? '1 route' : `${count} routes`}`,
        chip: { look: MOD_LOOK, glyph: glyphOf(sound, picked) },
        knobs: knobsOf(picked, MODULATOR_KINDS[found.part.kind].knobs),
        targets: {
          source: picked,
          to: routes.map((route) => ({
            id: route.id,
            label: `${destName(sound, route.target, route.key)}${route.source === picked ? '' : ' (via)'}`,
            target: route.target,
            key: route.key,
            via: route.source !== picked,
          })),
        },
        color: NEUTRAL_ARC,
        outline: MOD_COLOR,
        actions: [
          { label: '◂ Earlier', run: move(-1) },
          { label: 'Later ▸', run: move(1) },
          { label: 'Remove', run: remove(), danger: true },
        ],
        actionNote:
          'Removing a modulator removes its routes. Or hold the tile and drag it along the rack.',
      }
    }
    case 'input': {
      const { part } = found
      const actions: Action[] = [
        { label: '▴ Move up', run: move(-1) },
        { label: 'Move down ▾', run: move(1) },
        { label: 'Remove', run: remove(), danger: true },
      ]
      const feeding: Feed[] = sound.chains.map((chain, index) => ({
        chain: chain.id,
        letter: chainLetter(index),
        look: chainLook(index),
        on: feeds(sound, chain.id, picked),
        toggle: () =>
          engine.edit((current) =>
            setSend(
              current,
              chain.id,
              picked,
              feeds(current, chain.id, picked) ? 0 : SEND_SPEC.max
            )
          ),
      }))
      const base = {
        title,
        kind: INPUT_KINDS[part.kind].label,
        chip: { look: NEUTRAL_LOOK, glyph: glyphOf(sound, picked) },
        color: NEUTRAL_ARC,
        feeds: feeding,
        actions,
        actionNote: 'Removing an input removes its sends and routes.',
      }
      if (part.kind === 'osc') {
        return {
          ...base,
          knobs: knobsOf(picked, INPUT_KINDS.osc.knobs),
          refs: (
            <RefPicker
              engine={engine}
              sound={sound}
              input={picked}
              refName="fmSource"
              label="FM"
            />
          ),
        }
      }
      if (part.kind === 'ring') {
        return {
          ...base,
          knobs: [],
          refs: (
            <>
              <RefPicker
                engine={engine}
                sound={sound}
                input={picked}
                refName="a"
                label="A"
              />
              <RefPicker
                engine={engine}
                sound={sound}
                input={picked}
                refName="b"
                label="B"
              />
            </>
          ),
          note: 'A ring multiplies two inputs: pick them above. How much of it a chain takes is on the chain’s knobs.',
        }
      }
      return {
        ...base,
        knobs: [],
        note: 'Noise has no knobs of its own. How much of it a chain takes is on the chain’s knobs.',
      }
    }
    default:
      return {
        title,
        kind: '',
        chip: { look: NEUTRAL_LOOK },
        knobs: [],
        color: NEUTRAL_ARC,
      }
  }
}

/** The panel for a "+" tile: the kinds it adds */
function addView(
  sound: Sound,
  adding: string,
  added: (add: (current: Sound) => Added) => void
): View {
  if (adding === 'input') {
    const room = sound.inputs.length < MAX_INPUTS
    const into = sound.chains[0] ? chainLetter(0) : undefined
    return {
      title: 'Add an input',
      kind: 'A new tile in the first column',
      chip: { look: NEUTRAL_LOOK, glyph: GLYPHS.plus, add: true },
      knobs: [],
      color: NEUTRAL_ARC,
      choices: (Object.keys(INPUT_KINDS) as InputKind[]).map((kind) => ({
        label: INPUT_KINDS[kind].label,
        hint: INPUT_HINTS[kind],
        glyph: KIND_GLYPHS[kind],
        look: NEUTRAL_LOOK,
        add: room ? () => added((s) => addInput(s, kind)) : undefined,
      })),
      choiceNote: into
        ? `It goes into chain ${into} at full level; its own panel sends it to other chains.`
        : 'It feeds nothing until a chain takes it.',
    }
  }
  if (adding === 'chain') {
    const next = sound.chains.length
    const look = chainLook(next)
    return {
      title: 'Add a chain',
      kind: 'A new row',
      chip: { look, glyph: GLYPHS.plus, add: true },
      knobs: [],
      color: NEUTRAL_ARC,
      choices: [
        {
          label: `Chain ${chainLetter(next)}`,
          hint: 'Takes nothing yet',
          glyph: GLYPHS.sum,
          look,
          add: next < MAX_CHAINS ? () => added(addChain) : undefined,
        },
      ],
      choiceNote:
        'It takes no input until one is sent to it: pick an input and tap its letter.',
    }
  }
  if (adding === 'modulator') {
    const room = sound.modulators.length < MAX_MODULATORS
    return {
      title: 'Add a modulator',
      kind: 'Into the rack',
      chip: { look: MOD_LOOK, glyph: GLYPHS.plus, add: true },
      knobs: [],
      color: NEUTRAL_ARC,
      choices: (Object.keys(MODULATOR_KINDS) as ModulatorKind[]).map(
        (kind) => ({
          label: MODULATOR_KINDS[kind].label,
          hint: MODULATOR_HINTS[kind],
          glyph: KIND_GLYPHS[kind],
          look: MOD_LOOK,
          add: room ? () => added((s) => addModulator(s, kind)) : undefined,
        })
      ),
      choiceNote: 'It moves nothing until it is routed to a knob.',
    }
  }
  // A chain's "+": an item at its end
  const found = findPart(sound, adding)
  const chain = found?.type === 'chain' ? found : undefined
  const letter = chain ? chainLetter(chain.index) : ''
  const look = chain ? chainLook(chain.index) : NEUTRAL_LOOK
  const last = chain?.part.items[chain.part.items.length - 1]
  const room = chain !== undefined && chain.part.items.length < MAX_ITEMS
  return {
    title: `Add to Chain ${letter}`,
    kind: last ? `After ${partName(sound, last.id)}` : 'First in the chain',
    chip: { look, glyph: GLYPHS.plus, add: true },
    knobs: [],
    color: NEUTRAL_ARC,
    choices: (Object.keys(ITEM_KINDS) as ItemKind[]).map((kind) => ({
      label: ITEM_KINDS[kind].label,
      hint: ITEM_HINTS[kind],
      glyph: KIND_GLYPHS[kind],
      look,
      add: room ? () => added((s) => addItem(s, adding, kind)) : undefined,
    })),
    choiceNote:
      'The new tile goes where the dashed one is. A longer chain pans right.',
  }
}

/**
 * Which input an input's reference reads (an oscillator's FM, a ring's A
 * or B), as a native select: none, an input, or itself for feedback FM.
 * One that would read itself back through another is offered disabled.
 */
function RefPicker({
  engine,
  sound,
  input,
  refName,
  label,
}: {
  engine: Engine
  sound: Sound
  input: string
  refName: string
  label: string
}) {
  const found = findPart(sound, input)
  if (found?.type !== 'input') return null
  const current = found.part.refs[refName] ?? null
  return (
    <select
      aria-label={`${partName(sound, input)} ${label} source`}
      value={current ?? ''}
      onChange={(event) => {
        const to = event.target.value || null
        engine.edit((sound) => setRef(sound, input, refName, to))
      }}
      className="h-7 max-w-28 min-w-0 rounded-md bg-white/[0.08] px-2 text-[11px] font-semibold text-zinc-200"
    >
      <option value="">{label}: none</option>
      {sound.inputs.map((other) => (
        <option
          key={other.id}
          value={other.id}
          disabled={refLoops(sound.inputs, input, refName, other.id)}
        >
          {label}: {other.id === input ? 'itself' : partName(sound, other.id)}
        </option>
      ))}
    </select>
  )
}
