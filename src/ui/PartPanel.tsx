import {
  useState,
  type FormEvent,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import type { Engine, OutputSource } from '../engine/engine'
import type { EffectAt } from '../engine/protocol'
import {
  addChain,
  addEffect,
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
  PAD_NOTE_MAX,
  PAD_NOTE_MIN,
  padName,
  type PartKind,
} from '../state/kit'
import type { Library, LibrarySnapshot, PresetRef } from '../state/library'
import {
  MAX_NAME_LENGTH,
  cleanName,
  type PresetCategory,
} from '../state/presets'
import {
  MAX_TRACKS,
  kindLabel,
  trackName,
  tracksWithoutBus,
} from '../state/tracks'
import {
  AMP_SPEC,
  CHAIN_SPEC,
  EFFECT_KINDS,
  EFFECT_KIND_ORDER,
  INPUT_KINDS,
  ITEM_KINDS,
  MAX_CHAINS,
  MAX_EFFECTS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MODULATOR_KINDS,
  SEND_SPEC,
  VOICE_SPEC,
  reduces,
  type DestSpec,
  type EffectKind,
  type InputKind,
  type ItemKind,
  type ModulatorKind,
} from '../state/sound/kinds'
import {
  MASTER,
  addBus,
  addMixEffect,
  busLetter,
  busName,
  findMixPart,
  masterLimited,
  moveMixEffect,
  ownedBy,
  removeMixPart,
  stripId,
  type Mix,
  type MixAdded,
  type MixOwner,
} from '../state/mix'
import {
  AMP,
  SENDS,
  VOICE,
  findPart,
  partName,
  refLoops,
  sendKey,
  type Sound,
} from '../state/sound/sound'
import {
  knobRow,
  KNOB_SIZE,
  OPTION,
  PANEL_BODY,
  SMALL_BUTTON,
  SMALL_CONFIRM,
  SMALL_FIELD,
  SMALL_ICON_BUTTON,
  SMALL_OPTION,
  TALL_HIT,
} from './controls'
import {
  EFFECT_GLYPHS,
  GLYPHS,
  MOD_COLOR,
  MOD_LOOK,
  NEUTRAL_LOOK,
  PAD_TILE,
  VOICE_LOOK,
  addingTo,
  busLook,
  chainLetter,
  chainLook,
  destName,
  fmTargets,
  glyphOf,
  heardThrough,
  isMixId,
  lookOf,
  mixAddingTo,
  mixId,
  mixPartName,
  mixPartOf,
  toggleFm,
  type Look,
} from './editor'
import { ConfirmDialog } from './ConfirmDialog'
import { Loudness, Reduction } from './Dynamics'
import { FadeRow } from './FadeRow'
import { Knob, MixKnob, NEUTRAL_ARC } from './Knob'
import { ColourKey, MASTER_VIEWS, type MasterViewKind } from './MasterViews'
import { Mutes } from './Mutes'
import { knoblessDests, routesTo } from '../state/sound/knob'
import { noteName } from '../viz/keyboard'

/** One kind a "+" offers: its pictogram, name and what it does */
interface Choice {
  readonly label: string
  readonly hint: string
  readonly glyph: string
  readonly look: Look
  /** Adds it; none at the limit */
  readonly add: (() => void) | undefined
}

/** One of a part's actions, a small button in the panel's header */
interface Action {
  /** What it does, for a screen reader and a pointer's tooltip */
  readonly label: string
  /** Its picture: a stroked path in an 18×18 box */
  readonly icon: string
  /** Does it; none where it cannot (the first part moving earlier) */
  readonly run: (() => void) | undefined
  readonly danger?: boolean
  /** Asked first, with this said of what goes with it */
  readonly confirm?: string
}

/** The actions' pictures, in an 18×18 box */
const ICONS = {
  // Arrows move a part; the bar under a chevron puts the panel away
  left: 'M14 9H4M8 5L4 9l4 4',
  right: 'M4 9h10M10 5l4 4-4 4',
  up: 'M9 14V4M5 8l4-4 4 4',
  down: 'M9 4v10M5 10l4 4 4-4',
  remove: 'M3.5 5h11M7.5 5V3.5h3V5M5 5l.8 9.5h6.4L13 5M7.8 8v4M10.2 8v4',
  // A pencil: a track's name
  rename: 'M3.5 14.5l.8-3.3 7.4-7.4 2.5 2.5-7.4 7.4zM10.2 5.3l2.5 2.5',
  hide: 'M4 4l5 5 5-5M4 14h10',
  // Corners pulled out: the master's views, large
  open: 'M10.5 3.5h4v4M14.5 3.5l-4.5 4.5M7.5 14.5h-4v-4M3.5 14.5L8 10',
} as const

/** A header's small square button, and the one that removes */
const ACTION_BUTTON = SMALL_ICON_BUTTON
const REMOVE_BUTTON = `${TALL_HIT} flex size-7 shrink-0 items-center justify-center rounded-md bg-red-500/15 text-red-200`
/**
 * A row of buttons that pans sideways when long (FadeRow): it runs to the
 * panel's edges, its buttons stood in from them as far as the panel's
 * inset, and fades out where there are more. It stands 8 px taller above
 * and below, for their hit areas (TALL_HIT), and as much drawn back into
 * the gaps around it, so it neither scrolls up and down (a scroller
 * holding what reaches past it does) nor cuts them.
 */
function PanRow({
  children,
  ...attributes
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <FadeRow
      {...attributes}
      className="-mx-2.5 -my-2 shrink-0 overflow-y-hidden overscroll-x-contain py-2"
      row="items-center gap-1.5 px-2.5"
    >
      {children}
    </FadeRow>
  )
}

/** A stroked 14 px picture in an action's button */
function ActionIcon({ path, className }: { path: string; className?: string }) {
  return (
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
      className={className}
    >
      <path d={path} />
    </svg>
  )
}

/** A chain an input may feed, as a toggle: on while it takes the input */
interface Feed {
  readonly chain: string
  readonly letter: string
  readonly look: Look
  readonly on: boolean
  readonly toggle: () => void
}

/** An oscillator an input may be the FM of, as a toggle: on while it is */
interface FmInto {
  readonly target: string
  readonly name: string
  readonly on: boolean
  /** None where reading the input would loop back */
  readonly toggle: (() => void) | undefined
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

/** A name the panel's header gives, in its title's place */
interface Naming {
  /** What is named: the form is for it alone */
  readonly id: string
  /** Its own name; none, it goes by another (fallback) */
  readonly name: string | undefined
  readonly fallback: string
  /** Names it; blank, it goes by fallback again */
  readonly set: (name: string) => void
}

/** What the panel shows for the tile picked */
interface View {
  readonly title: string
  readonly kind: string
  /** A name of its own to give it, in the title's place: a track's */
  readonly naming?: Naming
  readonly chip: { look: Look; glyph?: string; mark?: string; add?: boolean }
  /** A knob of a part, under its own label or another (→ IN 1) */
  readonly knobs: readonly {
    part: string
    key: string
    hot?: string
    label?: string
  }[]
  /**
   * After them, knobs of the session's mix: a bus's, an effect's; before
   * them with mixFirst, as a strip's fader stands before its sends
   */
  readonly mixKnobs?: readonly { part: string; key: string }[]
  readonly mixFirst?: boolean
  /**
   * The views of an output, the one its tiles show (the sound's in the
   * Out and the mix's strip, the master's in the Master) chosen in a row
   */
  readonly views?: {
    readonly shown: MasterViewKind
    readonly choose: (view: MasterViewKind) => void
  }
  /** Before the views, in their row: a track's Mute and Solo (Mutes) */
  readonly mutes?: ReactNode
  /** The knobs' arc: a chain's colour on its own parts, else neutral */
  readonly color: string
  readonly refs?: ReactNode
  /** An input's chains, each a toggle: which ones it feeds */
  readonly feeds?: readonly Feed[]
  /** Where an input no chain takes is heard instead (heardThrough) */
  readonly through?: string
  /** The oscillators an input may be the FM of, each a toggle */
  readonly fm?: readonly FmInto[]
  /** Destinations no knob holds (the voice's pitch), routed by a tap */
  readonly knobless?: readonly Knobless[]
  /** A modulator's routes, by where each goes; it routes from source */
  readonly targets?: { source: string; to: readonly Target[] }
  readonly note?: string
  /** Under the knobs: how far a compressor or a limiter turns it down */
  readonly reduction?: EffectAt
  /** Under the knobs: how loud the output is (the master's) */
  readonly loudness?: boolean
  readonly choices?: readonly Choice[]
  readonly choiceNote?: string
  readonly actions?: readonly Action[]
  /** In the knobs' place, what a part of no knobs holds: a pad's presets */
  readonly body?: ReactNode
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
/** Each under its name on a choice, in its 88 px: 16 letters or so */
const EFFECT_HINTS: Record<EffectKind, string> = {
  chorus: 'Wide and moving',
  delay: 'Echoes, in time',
  reverb: 'A room around it',
  eq: 'Lows to highs',
  compressor: 'Evens the level',
  limiter: 'Caps the peaks',
  haas: 'One side later',
  doubler: 'Detuned apart',
  width: 'Narrow to wide',
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
 * colour; for a "+", the kinds it adds. Its header moves the part a place
 * either way and removes it (asked first: ConfirmDialog), and hides the
 * panel (onHide), the graph taking its room. An input picks the chains it
 * feeds here, an oscillator its FM source, a ring its two inputs. From
 * the other side, an input is turned on as another oscillator's FM, and
 * how much is set, here too: a knob for each oscillator its FM reads it.
 */
export function PartPanel({
  engine,
  library,
  sound,
  output,
  picked,
  pick,
  focus,
  onRoute,
  onMap,
  onHide,
  viewOf: outputView,
  chooseView,
  onMaster,
  onPresets,
  inMix = false,
}: {
  engine: Engine
  /** The presets: a pad's mapped onto it */
  library: Library
  sound: Sound
  /** The part played's place in the mix: its strip, its own output */
  output: number
  picked: string
  pick: (id: string, input?: string) => void
  focus: string | undefined
  /** The view an output's tiles show, and choosing another */
  viewOf: (source: OutputSource) => MasterViewKind
  chooseView: (source: OutputSource, view: MasterViewKind) => void
  /** Opens the master's views, large; none, no button for it */
  onMaster?: () => void
  /** Opens the presets' popover; none, no button for it */
  onPresets?: () => void
  /** In the mix, where the sound's panel is its part's strip's (Synth) */
  inMix?: boolean
  /** Opens the routes into a destination: a knob held, a target tapped */
  onRoute: (target: string, key: string) => void
  /** Routes from source into the tiles picked, starting at target */
  onMap: (source: string, target?: string) => void
  /** Hides the panel, for the graph to have its room */
  onHide: () => void
}) {
  /** An output's views, as its panel chooses them */
  const views = (source: OutputSource) => ({
    shown: outputView(source),
    choose: (kind: MasterViewKind) => chooseView(source, kind),
  })
  const presets = useSyncExternalStore(library.subscribe, library.getSnapshot)
  // A pad's note changes without its sound doing so
  const padNotes = useSyncExternalStore(
    engine.subscribeSound,
    engine.getPadNotes
  )
  /** The track being named in the header, by its id */
  const [named, setNamed] = useState<string>()
  const view =
    picked === SENDS
      ? sendsView(
          engine.getMix(),
          views(output),
          output,
          engine.getPart(),
          inMix ? trackStrip(engine, (id) => setNamed(id)) : undefined,
          <Mutes
            engine={engine}
            place={output}
            name={trackName(engine.getTrack(), output)}
          />
        )
      : isMixId(picked)
        ? mixView(engine, library, picked, views('master'), onMaster, pick)
        : picked === PAD_TILE
          ? padView(
              presets,
              engine.getPad(),
              padNotes[engine.getPad()] ?? PAD_NOTE_MIN,
              (note) => {
                engine.setPadNote(engine.getPad(), note)
                tryPad(engine, engine.getPad())
              },
              library.load.bind(library),
              onPresets
            )
          : viewOf(
              engine,
              sound,
              picked,
              focus,
              pick,
              engine.getPart() === 'kit'
            )
  const { chip } = view
  const mixKnobs = view.mixKnobs?.map(({ part, key }) => (
    <MixKnob
      key={`mix ${part} ${key}`}
      engine={engine}
      part={part}
      knob={key}
      color={view.color}
    />
  ))
  /** The action being asked about, and the part it was for */
  const [asking, setAsking] = useState<{ id: string; action: Action }>()
  const question = asking?.id === picked ? asking.action : undefined
  const naming = view.naming?.id === named ? view.naming : undefined

  return (
    <section
      aria-label={view.title}
      className="flex min-h-[8.5rem] min-w-0 flex-col gap-2 rounded-xl p-2.5"
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
        {naming ? (
          <NameForm
            key={naming.id}
            naming={naming}
            onDone={() => setNamed(undefined)}
          />
        ) : (
          <>
            <h2 className="min-w-0 shrink truncate text-sm font-semibold whitespace-nowrap text-zinc-100">
              {view.title}
            </h2>
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">
              {view.kind}
            </span>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {view.refs && <span className="mr-1 flex gap-1.5">{view.refs}</span>}
          {(naming ? [] : (view.actions ?? [])).map((action) => (
            <button
              key={action.label}
              type="button"
              aria-label={`${action.label}: ${view.title}`}
              title={action.label}
              disabled={!action.run}
              onClick={
                action.confirm === undefined
                  ? action.run
                  : () => setAsking({ id: picked, action })
              }
              className={action.danger ? REMOVE_BUTTON : ACTION_BUTTON}
            >
              <ActionIcon path={action.icon} />
            </button>
          ))}
          {/* Down, the way the panel goes; beside the graph, to the right */}
          <button
            type="button"
            aria-label="Hide the knobs"
            title="Hide the knobs"
            onClick={onHide}
            className={`${ACTION_BUTTON} ml-1`}
          >
            <ActionIcon
              path={ICONS.hide}
              className="side:-rotate-90 tall:rotate-0"
            />
          </button>
        </span>
      </div>
      {question && (
        <ConfirmDialog
          title={`${question.label} ${view.title}?`}
          message={question.confirm ?? ''}
          confirm={question.label}
          onConfirm={() => {
            setAsking(undefined)
            question.run?.()
          }}
          onCancel={() => setAsking(undefined)}
        />
      )}

      {!view.choices && view.feeds && view.feeds.length > 0 && (
        <Feeds
          title={view.title}
          feeds={view.feeds}
          through={view.through}
          fm={view.fm}
        />
      )}
      <div className={PANEL_BODY}>
        {view.body ??
          (view.choices ? (
            <>
              <div
                className={
                  // More than a row of four stand three to a row
                  view.choices.length > 4
                    ? 'grid grid-cols-[repeat(3,minmax(0,108px))] gap-2'
                    : 'flex gap-2'
                }
              >
                {view.choices.map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    disabled={!choice.add}
                    onClick={choice.add}
                    className="flex h-[54px] min-w-0 max-w-[108px] flex-1 flex-col items-start justify-center gap-[3px] rounded-[7px] bg-[#1c1c23] px-2.5 text-left text-zinc-100 disabled:opacity-40"
                    style={{
                      boxShadow: `inset 0 0 0 1.5px ${choice.look.ring}`,
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <svg
                        viewBox="0 0 18 12"
                        width={18}
                        height={12}
                        aria-hidden
                      >
                        <path
                          d={choice.glyph}
                          fill="none"
                          stroke={choice.look.ink}
                          strokeWidth={1.7}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="text-xs font-semibold">
                        {choice.label}
                      </span>
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
              {view.knobs.length > 0 ||
              view.knobless?.length ||
              view.mixKnobs?.length ? (
                <div
                  className={knobRow(
                    view.knobs.length +
                      (view.knobless?.length ?? 0) +
                      (view.mixKnobs?.length ?? 0)
                  )}
                >
                  {view.mixFirst && mixKnobs}
                  {view.knobs.map(({ part, key, hot, label }) => (
                    <Knob
                      key={`${part} ${key}`}
                      engine={engine}
                      part={part}
                      knob={key}
                      label={label}
                      color={view.color}
                      hot={hot}
                      onHold={(dest) => onRoute(part, dest)}
                    />
                  ))}
                  {!view.mixFirst && mixKnobs}
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
                        <svg viewBox="0 0 18 12" width={24} height={16}>
                          <path
                            d={GLYPHS.route}
                            fill="none"
                            stroke={MOD_COLOR}
                            strokeWidth={1.4}
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
                  <p className="text-xs leading-snug text-zinc-400">
                    {view.note}
                  </p>
                )
              )}
              {view.reduction && (
                <Reduction
                  engine={engine}
                  at={view.reduction}
                  color={view.color}
                />
              )}
              {view.loudness && <Loudness engine={engine} />}
              {view.targets && (
                <Targets {...view.targets} onRoute={onRoute} onMap={onMap} />
              )}
              {view.views && (
                <PanRow>
                  {view.mutes && (
                    <div
                      role="group"
                      aria-label="Heard"
                      className="flex shrink-0 items-center gap-1.5"
                    >
                      {view.mutes}
                      <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
                    </div>
                  )}
                  <div
                    role="group"
                    aria-label="The output shows"
                    className="flex shrink-0 items-center gap-1.5"
                  >
                    {MASTER_VIEWS.map(({ view: kind, label }) => (
                      <button
                        key={kind}
                        type="button"
                        aria-pressed={view.views?.shown === kind}
                        onClick={() => view.views?.choose(kind)}
                        className={`${SMALL_OPTION} shrink-0`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {view.views.shown === 'spectrogram' && (
                    <>
                      <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
                      <ColourKey />
                    </>
                  )}
                </PanRow>
              )}
            </>
          ))}
      </div>
    </section>
  )
}

/** The touch a pad tried from its panel is: no finger's, no computer key's */
const TRY_ID = -1
/** How long a pad tried is held, in ms: a hit, then let go */
const TRY_MS = 180
let trying: ReturnType<typeof setTimeout> | undefined

/** Strikes pad once, for its note just set to be heard */
function tryPad(engine: Engine, pad: number): void {
  if (trying !== undefined) {
    clearTimeout(trying)
    engine.noteOff(TRY_ID)
  }
  engine.hit(TRY_ID, pad)
  trying = setTimeout(() => {
    trying = undefined
    engine.noteOff(TRY_ID)
  }, TRY_MS)
}

/** The steps a pad's note takes: a semitone and an octave, down and up */
const NOTE_STEPS = [
  { by: -12, label: '\u221212', say: 'An octave down' },
  { by: -1, label: '\u22121', say: 'A semitone down' },
  { by: 1, label: '+1', say: 'A semitone up' },
  { by: 12, label: '+12', say: 'An octave up' },
] as const

/**
 * The note a pad plays its preset at: its name between the steps down and
 * the steps up, one that would leave MIDI's notes off.
 */
function PadNote({
  name,
  note,
  onNote,
}: {
  name: string
  note: number
  onNote: (note: number) => void
}) {
  const step = ({ by, label, say }: (typeof NOTE_STEPS)[number]) => (
    <button
      key={by}
      type="button"
      aria-label={say}
      disabled={note + by < PAD_NOTE_MIN || note + by > PAD_NOTE_MAX}
      onClick={() => onNote(note + by)}
      className={`${SMALL_BUTTON} tabular-nums`}
    >
      {label}
    </button>
  )
  return (
    <div
      role="group"
      aria-label={`${name} note`}
      className="flex items-center gap-1.5"
    >
      <span className="mr-auto text-[11px] text-zinc-400">Note</span>
      {NOTE_STEPS.slice(0, 2).map(step)}
      <output
        aria-label={`${name} plays at`}
        className="w-11 shrink-0 text-center text-xs font-semibold text-zinc-100 tabular-nums"
      >
        {noteName(note)}
      </output>
      {NOTE_STEPS.slice(2).map(step)}
    </div>
  )
}

/**
 * The kit's pad picked (PAD_TILE): the preset mapped onto it, played as
 * it is, at the pad's note (set here: setNote); the presets of its
 * category in a row, a tap mapping another (map: onto the pad picked);
 * and all of them, the presets' popover (onPresets). A pad of no preset
 * (its own deleted) offers the Drums.
 */
function padView(
  presets: LibrarySnapshot,
  pad: number,
  note: number,
  setNote: (note: number) => void,
  map: (ref: PresetRef) => void,
  onPresets: (() => void) | undefined
): View {
  const current = presets.pads[pad]
  const mine = current?.source === 'user'
  const preset =
    current &&
    (mine ? presets.user : presets.factory).find(
      (each) => each.name === current.name
    )
  const category: PresetCategory = preset?.category ?? 'Drums'
  const refs = (source: PresetRef['source']) =>
    (source === 'user' ? presets.user : presets.factory)
      .filter((each) => each.category === category)
      .map((each): PresetRef => ({ source, name: each.name }))
  // As the presets list them: the user's first
  const choices = [...refs('user'), ...refs('factory')]
  const name = `Pad ${pad + 1}`
  return {
    title: padName(current, pad),
    kind: preset ? `${name} · ${category}${mine ? ', mine' : ''}` : 'No preset',
    chip: { look: NEUTRAL_LOOK, mark: String(pad + 1) },
    knobs: [],
    color: NEUTRAL_ARC,
    body: (
      <>
        <PanRow role="group" aria-label={`${category} presets for ${name}`}>
          {choices.map((ref) => (
            <button
              key={`${ref.source}:${ref.name}`}
              type="button"
              aria-pressed={
                current?.source === ref.source && current.name === ref.name
              }
              onClick={() => map(ref)}
              className={`${OPTION} shrink-0`}
            >
              {ref.name}
            </button>
          ))}
        </PanRow>
        <PadNote name={name} note={note} onNote={setNote} />
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-zinc-500">
            {preset
              ? 'Plays its preset as it is: saved over in a synth, the preset changes here too.'
              : 'Its preset is gone: it keeps the sound it had.'}
          </p>
          {onPresets && (
            <button
              type="button"
              onClick={onPresets}
              className={`${SMALL_BUTTON} shrink-0`}
            >
              All presets
            </button>
          )}
        </div>
      </>
    ),
  }
}

/**
 * The chains an input feeds, one toggle per chain in its colour: on, the
 * chain takes the input at full level; off, not at all. Moving an input
 * to another chain is turning that one on and its own off. They stand
 * right under the header, outside the centred body: from input to input
 * they keep their place, whether knobs or a note follow. Feeding none, it
 * is silent, unless another input reads it (through: IN 1's FM). After
 * them, the oscillators it may be the FM of, a toggle each (fm): on, that
 * one's FM reads it in place of what it read, and says where it is heard
 * without the line; the row pans when long.
 */
function Feeds({
  title,
  feeds,
  through,
  fm,
}: {
  title: string
  feeds: readonly Feed[]
  through?: string
  fm?: readonly FmInto[]
}) {
  // The FM toggles lit say where it is heard already
  const none = !feeds.some((feed) => feed.on) && !fm?.some((into) => into.on)
  return (
    <PanRow role="group" aria-label={`Chains ${title} feeds`}>
      <span className="mr-0.5 shrink-0 text-[11px] text-zinc-500">Into</span>
      {feeds.map((feed) => (
        <button
          key={feed.chain}
          type="button"
          aria-pressed={feed.on}
          aria-label={`Chain ${feed.letter}`}
          onClick={feed.toggle}
          className={`${TALL_HIT} flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-xs font-extrabold`}
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
      {fm && fm.length > 0 && (
        <>
          <span className="mr-0.5 ml-1.5 shrink-0 text-[11px] whitespace-nowrap text-zinc-500">
            FM →
          </span>
          {fm.map((into) => (
            <button
              key={into.target}
              type="button"
              aria-pressed={into.on}
              aria-label={`${into.name}'s FM`}
              disabled={!into.toggle}
              onClick={into.toggle}
              className={`${TALL_HIT} flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[11px] font-bold whitespace-nowrap disabled:opacity-30`}
              style={
                into.on
                  ? {
                      background: NEUTRAL_LOOK.tint,
                      boxShadow: `inset 0 0 0 1.5px ${NEUTRAL_LOOK.ink}`,
                      color: NEUTRAL_LOOK.ink,
                    }
                  : {
                      border: `1.5px dashed ${NEUTRAL_LOOK.ring}`,
                      color: '#a1a1aa',
                    }
              }
            >
              {into.name}
            </button>
          ))}
        </>
      )}
      {none && (
        <span className="ml-1 shrink-0 text-[11px] whitespace-nowrap text-zinc-500">
          {through ? `Heard through ${through}` : 'Silent: tap a chain'}
        </span>
      )}
    </PanRow>
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
    <PanRow role="group" aria-label="Routes">
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
    </PanRow>
  )
}

/** Whether chain chainId of sound takes input inputId at all */
function feeds(sound: Sound, chainId: string, inputId: string): boolean {
  const chain = sound.chains.find((each) => each.id === chainId)
  return (chain?.sends[inputId] ?? 0) > 0
}

/** What a strip's panel has of its track in the mix */
interface TrackStrip {
  readonly title: string
  readonly naming: Naming
  readonly actions: readonly Action[]
}

/**
 * The track played's, for its strip's panel in the mix: its name, the
 * giving of one (onName opens the form), and its header's actions: a
 * place up or down among the tracks, its strip with it in their column,
 * and its removal, asked first (never the only track's)
 */
function trackStrip(engine: Engine, onName: (id: string) => void): TrackStrip {
  const track = engine.getTrack()
  const place = engine.getPlace()
  const count = engine.getTracks().length
  const { id } = track
  const kit = track.kind === 'kit'
  const move = (to: number) =>
    to < 0 || to >= count ? undefined : () => engine.moveTrack(id, to)
  return {
    title: trackName(track, place),
    naming: {
      id,
      name: track.name,
      fallback: `${kindLabel(track.kind)} ${place + 1}`,
      set: (name) => engine.renameTrack(id, name),
    },
    actions: [
      { label: 'Move up', icon: ICONS.up, run: move(place - 1) },
      { label: 'Move down', icon: ICONS.down, run: move(place + 1) },
      { label: 'Rename', icon: ICONS.rename, run: () => onName(id) },
      {
        label: 'Remove',
        icon: ICONS.remove,
        run: count > 1 ? () => engine.removeTrack(id) : undefined,
        danger: true,
        confirm: kit
          ? 'Its pads and its chain go with it, and its strip’s level and balance. The presets its pads play stay.'
          : 'Its sound goes with it, and its strip’s level and balance. A preset saved from it stays.',
      },
    ],
  }
}

/**
 * The panel of the sound's output (its Out tile, its track's strip in the
 * mix, there under the track's name): its part's fader, a level and a
 * balance, the session's (a preset loaded plays at them, as a desk's
 * channel would), then how much it sends to each of the session's buses
 * (the synth's, its sound's own, kept with its preset; the kit's, its
 * chain's, kept with the kit, the same for every pad), then its track's
 * Mute and Solo and the view of its part's own output that both show
 */
function sendsView(
  mix: Mix,
  views: NonNullable<View['views']>,
  place: number,
  part: PartKind,
  track: TrackStrip | undefined,
  mutes: ReactNode
): View {
  const strip = stripId(place)
  const kit = part === 'kit'
  return {
    title: track ? track.title : kit ? 'Kit Out' : 'Out',
    naming: track?.naming,
    actions: track?.actions,
    kind: kit
      ? 'The kit’s level and balance, then its send to each bus'
      : 'Its level and balance, then a send to each bus',
    chip: { look: NEUTRAL_LOOK, glyph: GLYPHS.sends },
    knobs: mix.buses.map((bus) => ({
      part: SENDS,
      key: bus.id,
      label: `${busLetter(bus.id)} ${busName(bus)}`,
    })),
    mixKnobs: [
      { part: strip, key: 'level' },
      { part: strip, key: 'pan' },
    ],
    mixFirst: true,
    views,
    mutes,
    color: NEUTRAL_ARC,
    note:
      mix.buses.length === 0
        ? 'The mix has no bus: add one there to hear the sound.'
        : kit
          ? 'Level and Balance are the mix’s; the sends, the kit’s, the same for every pad, kept with the kit.'
          : 'Level and Balance are the mix’s; the sends, the sound’s own, kept with its preset.',
  }
}

/**
 * The panel of a mix tile: a bus's level and balance after the part
 * played's send to it (Send: the synth's sound's own, kept with its
 * preset; the kit's, its chain's, kept with the kit; the rest the
 * session's); an effect's knobs, on a bus or the master; the master's
 * level, the views its tile may show, and the button that opens them
 * large; for a "+", the kinds it adds, or a new bus
 */
function mixView(
  engine: Engine,
  library: Library,
  picked: string,
  views: NonNullable<View['views']>,
  onMaster: (() => void) | undefined,
  pick: (id: string) => void
): View {
  // Every edit applies to the engine's mix as it is when tapped
  const mix = engine.getMix()
  const edit = (change: (current: Mix) => Mix) =>
    engine.setMix(change(engine.getMix()))
  /** Adds to the mix playing, and picks what was added */
  const added = (add: (current: Mix) => MixAdded) => {
    const { mix: next, id } = add(engine.getMix())
    engine.setMix(next)
    if (id !== null) pick(mixId(id))
  }
  const adding = mixAddingTo(picked)
  if (adding === 'bus') return addBusView(mix, added)
  if (adding === 'track') {
    return addTrackView(engine.getTracks().length, (kind) => {
      // The one added is the one played: its strip, picked
      if (library.addTrack(kind) !== undefined) pick(SENDS)
    })
  }
  if (adding !== undefined) {
    return addMixEffectView(mix, adding as MixOwner, added)
  }

  const part = mixPartOf(picked) ?? MASTER
  const found = findMixPart(mix, part)
  switch (found?.type) {
    case 'bus': {
      const { bus } = found
      const letter = busLetter(bus.id)
      const look = busLook(bus.id)
      const kit = engine.getPart() === 'kit'
      return {
        title: `Bus ${letter}`,
        kind: `${busName(bus)} · every sound sends to it`,
        chip: { look, mark: letter },
        knobs: [{ part: SENDS, key: bus.id, label: 'Send' }],
        mixKnobs: [
          { part: bus.id, key: 'level' },
          { part: bus.id, key: 'pan' },
        ],
        color: look.ink,
        note: kit
          ? 'Send is the kit’s, the same for every pad, kept with the kit.'
          : 'Send is the sound’s own, kept with its preset.',
        actions: [
          {
            label: 'Remove',
            icon: ICONS.remove,
            run: () => {
              // Those after it move up a letter, every track's sends
              // with them
              edit((current) => removeMixPart(current, bus.id))
              engine.setTracks(tracksWithoutBus(engine.getTracks(), bus.id))
              pick(mixId(MASTER))
            },
            danger: true,
            confirm:
              bus.effects.length === 0
                ? 'The buses after it move up a letter, the sound’s sends with them.'
                : 'Its effects go with it. The buses after it move up a letter, the sound’s sends with them.',
          },
        ],
      }
    }
    case 'effect': {
      const { effect, owner, index } = found
      const row = ownedBy(mix, owner) ?? []
      const move = (by: number) => {
        const to = index + by
        if (to < 0 || to >= row.length) return undefined
        return () => edit((current) => moveMixEffect(current, effect.id, to))
      }
      const where =
        owner === MASTER ? 'on the master' : `on bus ${busLetter(owner)}`
      const look = busLook(owner)
      return {
        title: mixPartName(mix, effect.id),
        kind: `${EFFECT_HINTS[effect.kind]} · ${where}`,
        chip: { look, glyph: EFFECT_GLYPHS[effect.kind] },
        knobs: [],
        mixKnobs: EFFECT_KINDS[effect.kind].knobs.map(({ key }) => ({
          part: effect.id,
          key,
        })),
        color: owner === MASTER ? NEUTRAL_ARC : look.ink,
        reduction: reduces(effect.kind) ? { id: effect.id } : undefined,
        actions: [
          { label: 'Move left', icon: ICONS.left, run: move(-1) },
          { label: 'Move right', icon: ICONS.right, run: move(1) },
          {
            label: 'Remove',
            icon: ICONS.remove,
            run: () => {
              edit((current) => removeMixPart(current, effect.id))
              pick(mixId(owner))
            },
            danger: true,
            confirm: 'Its knobs go with it; its tail stops.',
          },
        ],
      }
    }
    default:
      return {
        title: 'Master',
        kind: masterLimited(mix)
          ? 'Every bus, through its effects, the limiter last'
          : 'Every bus, through its effects, then the soft clip',
        chip: { look: NEUTRAL_LOOK, glyph: GLYPHS.master },
        knobs: [],
        mixKnobs: [{ part: MASTER, key: 'level' }],
        loudness: true,
        views,
        color: NEUTRAL_ARC,
        actions: onMaster
          ? [{ label: 'Open the views', icon: ICONS.open, run: onMaster }]
          : undefined,
      }
  }
}

/**
 * The "+" after the strips: a track after the last, a synth or a kit,
 * which is then the one played
 */
function addTrackView(count: number, add: (kind: PartKind) => void): View {
  const room = count < MAX_TRACKS
  return {
    title: 'Add a track',
    kind: room
      ? `Track ${count + 1} of ${MAX_TRACKS} at most`
      : `${MAX_TRACKS} tracks at most`,
    chip: { look: NEUTRAL_LOOK, glyph: GLYPHS.plus, add: true },
    knobs: [],
    color: NEUTRAL_ARC,
    choices: [
      {
        label: 'Synth',
        hint: 'One sound, on keys',
        glyph: GLYPHS.saw,
        look: NEUTRAL_LOOK,
        add: room ? () => add('synth') : undefined,
      },
      {
        label: 'Kit',
        hint: '16 pads of presets',
        glyph: GLYPHS.pads,
        look: NEUTRAL_LOOK,
        add: room ? () => add('kit') : undefined,
      },
    ],
    choiceNote:
      'A synth starts on the first preset, a kit as the factory’s, each with a strip at full level sending to A. It is the one played once added.',
  }
}

/**
 * A name given in the panel's header: a field holding the name it has
 * (or none, showing the one it goes by without), and Done, which names it
 * and puts the form away; blank, it goes by the other again
 */
function NameForm({ naming, onDone }: { naming: Naming; onDone: () => void }) {
  const [name, setName] = useState(naming.name ?? '')
  const send = (event: FormEvent) => {
    event.preventDefault()
    naming.set(cleanName(name))
    onDone()
  }
  return (
    <form onSubmit={send} className="flex min-w-0 flex-1 gap-1.5">
      <input
        aria-label="Name"
        value={name}
        placeholder={naming.fallback}
        maxLength={MAX_NAME_LENGTH}
        autoFocus
        enterKeyHint="done"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setName(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        // WebKit inherits the page's user-select: none, which stops typing
        className={`${SMALL_FIELD} flex-1 select-text`}
      />
      <button type="submit" className={SMALL_CONFIRM}>
        Done
      </button>
    </form>
  )
}

/**
 * The "+ Bus" panel: a bus after the last, on the next letter and in its
 * colour, dry or with an effect on it to start with
 */
function addBusView(
  mix: Mix,
  added: (add: (current: Mix) => MixAdded) => void
): View {
  const next = addBus(mix).id
  const room = next !== null
  const look = busLook(next ?? '')
  /** A new bus, with an effect of kind on it if given */
  const withEffect = (kind?: EffectKind) => (current: Mix) => {
    const bus = addBus(current)
    if (bus.id === null || kind === undefined) return bus
    const { mix: next } = addMixEffect(bus.mix, bus.id as MixOwner, kind)
    return { mix: next, id: bus.id }
  }
  return {
    title: 'Add a bus',
    kind: room
      ? `Bus ${next.toUpperCase()}: every sound sends to it`
      : 'Every letter has its bus',
    chip: { look, glyph: GLYPHS.plus, add: true },
    knobs: [],
    color: NEUTRAL_ARC,
    choices: [
      {
        label: 'Dry',
        hint: 'Straight to the master',
        glyph: GLYPHS.sends,
        look,
        add: room ? () => added(withEffect()) : undefined,
      },
      ...EFFECT_KIND_ORDER.map((kind) => ({
        label: EFFECT_KINDS[kind].label,
        hint: EFFECT_HINTS[kind],
        glyph: EFFECT_GLYPHS[kind],
        look,
        add: room ? () => added(withEffect(kind)) : undefined,
      })),
    ],
    choiceNote:
      'A sound sends to a bus by its letter, kept with its preset: one already sending to it is heard through it at once.',
  }
}

/** A bus's "+", or the master's: an effect at the end of its row */
function addMixEffectView(
  mix: Mix,
  owner: MixOwner,
  added: (add: (current: Mix) => MixAdded) => void
): View {
  const row = ownedBy(mix, owner)
  const room = row !== undefined && row.length < MAX_EFFECTS
  const last = row?.[row.length - 1]
  const onMaster = owner === MASTER
  const name = onMaster ? 'the master' : `Bus ${busLetter(owner)}`
  const look = busLook(owner)
  return {
    title: `Add to ${name}`,
    kind: last
      ? `After ${mixPartName(mix, last.id)}`
      : onMaster
        ? 'First on the master'
        : 'First on the bus',
    chip: { look, glyph: GLYPHS.plus, add: true },
    knobs: [],
    color: onMaster ? NEUTRAL_ARC : look.ink,
    choices: EFFECT_KIND_ORDER.map((kind) => ({
      label: EFFECT_KINDS[kind].label,
      hint: EFFECT_HINTS[kind],
      glyph: EFFECT_GLYPHS[kind],
      look,
      add: room ? () => added((m) => addMixEffect(m, owner, kind)) : undefined,
    })),
    choiceNote: onMaster
      ? `Every bus goes through it, before the master’s level: up to ${MAX_EFFECTS}, in the order they stand. A limiter last takes the soft clip’s place.`
      : `Up to ${MAX_EFFECTS}, in the order they stand. Its Mix at 100%, it is a return: the wet alone.`,
  }
}

/** What the panel holds for picked, a part of the sound or a "+" */
function viewOf(
  engine: Engine,
  sound: Sound,
  picked: string,
  focus: string | undefined,
  pick: (id: string, input?: string) => void,
  /** The kit played: the inserts are its chain's, after every pad's amp */
  kit: boolean
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
    return addView(sound, adding, added, kit)
  }
  if (picked === AMP) {
    return {
      title: 'Amp',
      kind: 'Each voice’s envelope, velocity and pan',
      chip: { look: NEUTRAL_LOOK, glyph: GLYPHS.env },
      knobs: knobsOf(AMP, AMP_SPEC.knobs),
      knobless: knoblessOf(AMP),
      color: NEUTRAL_ARC,
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
            : found.type === 'effect'
              ? sound.effects.length
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
        actions: [
          { label: 'Move left', icon: ICONS.left, run: move(-1) },
          { label: 'Move right', icon: ICONS.right, run: move(1) },
          {
            label: 'Remove',
            icon: ICONS.remove,
            run: remove(chain.id),
            danger: true,
            confirm: 'The routes into it go with it.',
          },
        ],
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
          { label: 'Move up', icon: ICONS.up, run: move(-1) },
          { label: 'Move down', icon: ICONS.down, run: move(1) },
          {
            label: 'Remove',
            icon: ICONS.remove,
            run: remove(),
            danger: true,
            confirm:
              found.part.items.length === 0
                ? 'The routes into it go with it.'
                : `Its ${found.part.items.length === 1 ? 'item goes' : `${found.part.items.length} items go`} with it, and the routes into them.`,
          },
        ],
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
        actions: [
          { label: 'Move earlier', icon: ICONS.left, run: move(-1) },
          { label: 'Move later', icon: ICONS.right, run: move(1) },
          {
            label: 'Remove',
            icon: ICONS.remove,
            run: remove(),
            danger: true,
            confirm:
              count === 0
                ? 'Nothing is routed from it.'
                : `Its ${count === 1 ? 'route goes' : `${count} routes go`} with it.`,
          },
        ],
      }
    }
    case 'effect': {
      const { kind } = found.part
      return {
        title: kit ? `Kit ${title}` : title,
        kind: `${EFFECT_HINTS[kind]} · ${kit ? 'on the kit, after every pad’s amp' : 'after the amp'}`,
        chip: { look: NEUTRAL_LOOK, glyph: EFFECT_GLYPHS[kind] },
        knobs: knobsOf(picked, EFFECT_KINDS[kind].knobs),
        color: NEUTRAL_ARC,
        reduction: reduces(kind)
          ? { track: engine.getTrack().id, id: picked }
          : undefined,
        note: kit
          ? 'The kit’s, the same for every pad, kept with the kit: every pad goes through it once summed.'
          : undefined,
        actions: [
          { label: 'Move left', icon: ICONS.left, run: move(-1) },
          { label: 'Move right', icon: ICONS.right, run: move(1) },
          {
            label: 'Remove',
            icon: ICONS.remove,
            run: remove(AMP),
            danger: true,
            confirm: 'Its knobs go with it; its tail stops.',
          },
        ],
      }
    }
    case 'input': {
      const { part } = found
      const actions: Action[] = [
        { label: 'Move up', icon: ICONS.up, run: move(-1) },
        { label: 'Move down', icon: ICONS.down, run: move(1) },
        {
          label: 'Remove',
          icon: ICONS.remove,
          run: remove(),
          danger: true,
          confirm:
            'Its sends go with it, and the routes into it; what reads it (FM, a ring) stops.',
        },
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
      const targets = fmTargets(sound, picked)
      // How much of it each oscillator whose FM reads it takes, on that
      // one's FM knob; a foot's peg tapped marks it (focus: that one's id)
      const into = targets
        .filter((target) => target.on)
        .map((target) => ({
          part: target.id,
          key: 'fm',
          label: `→ ${partName(sound, target.id)}`,
          hot: focus === target.id ? NEUTRAL_LOOK.ink : undefined,
        }))
      const base = {
        title,
        kind: INPUT_KINDS[part.kind].label,
        chip: { look: NEUTRAL_LOOK, glyph: glyphOf(sound, picked) },
        color: NEUTRAL_ARC,
        feeds: feeding,
        through: heardThrough(sound, picked),
        fm: targets.map((target) => ({
          target: target.id,
          name: partName(sound, target.id),
          on: target.on,
          toggle:
            target.loops && !target.on
              ? undefined
              : () =>
                  engine.edit((current) =>
                    toggleFm(current, target.id, picked)
                  ),
        })),
        actions,
      }
      if (part.kind === 'osc') {
        return {
          ...base,
          knobs: [...knobsOf(picked, INPUT_KINDS.osc.knobs), ...into],
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
          knobs: into,
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
        knobs: into,
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
  added: (add: (current: Sound) => Added) => void,
  /** The kit played: an effect goes on its chain, after every pad's amp */
  kit: boolean
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
  if (adding === 'effect') {
    const room = sound.effects.length < MAX_EFFECTS
    const last = sound.effects[sound.effects.length - 1]
    return {
      title: kit ? 'Add to the kit' : 'Add an effect',
      kind: last
        ? `After ${kit ? 'Kit ' : ''}${partName(sound, last.id)}`
        : kit
          ? 'After every pad’s amp'
          : 'After the amp',
      chip: { look: NEUTRAL_LOOK, glyph: GLYPHS.plus, add: true },
      knobs: [],
      color: NEUTRAL_ARC,
      choices: EFFECT_KIND_ORDER.map((kind) => ({
        label: EFFECT_KINDS[kind].label,
        hint: EFFECT_HINTS[kind],
        glyph: EFFECT_GLYPHS[kind],
        look: NEUTRAL_LOOK,
        add: room ? () => added((s) => addEffect(s, kind)) : undefined,
      })),
      choiceNote: kit
        ? `Every pad goes through it, in stereo, once summed, the same whichever is picked: up to ${MAX_EFFECTS}, in the order they stand.`
        : `Every voice goes through it, in stereo, once summed: up to ${MAX_EFFECTS}, in the order they stand.`,
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
      className="select-chevron h-7 max-w-28 min-w-0 truncate rounded-md bg-white/[0.08] pr-6 pl-2.5 text-[11px] font-semibold text-zinc-200"
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
