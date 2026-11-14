import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react'
import type { Engine } from '../engine/engine'
import { MASTER, addMixEffect } from '../state/mix'
import {
  EFFECT_KINDS,
  EFFECT_KIND_ORDER,
  MAX_EFFECTS,
  effectTile,
  reduces,
} from '../state/sound/kinds'
import {
  CARD,
  KNOB_COLUMN,
  KNOB_LABEL,
  KNOB_SIZE,
  SECTION_HEADING,
} from './controls'
import { Loudness, ReductionCell } from './Dynamics'
import { EFFECT_GLYPHS, GLYPHS, effectInRow } from './editor'
import { FadeRow } from './FadeRow'
import { IconButton } from './IconButton'
import { MixKnob, neutralArc } from './Knob'
import { Meters, Spectrogram, Spectrum, Vectorscope } from './MasterViews'

/**
 * The master's views at size, opened from its panel (#/master): the
 * spectrum with its decades and levels named, the spectrogram with its
 * decades and its colours named and a line down each second, the two
 * sides against each other with their correlation, and the levels going
 * into the clip with the highest peak named (or out of the limiter, one
 * last on the master), and over them the loudness, in LUFS. The stereo
 * stands under the spectrum, or, where the views are broad (a phone or a
 * fold on its side), at their right, as tall as both. Under them, within
 * the thumb's reach, the master's knobs (MasterKnobs): watching it is
 * turning it too (ashon, 2026-11-15: "그냥 모니터링만 가능해서 조작이
 * 불편한 것 같아"). It covers the editor's graph and panel, under the tab
 * rail, which it leaves to use ("탑레일이 전부 가려지는 문제"), and what
 * is played on below it, so the output can be watched while it is played.
 */
export function MasterSheet({
  engine,
  onClose,
  topmost = true,
}: {
  engine: Engine
  onClose: () => void
  /** False while a popover or the settings stand over it: theirs, Escape */
  topmost?: boolean
}) {
  useEffect(() => {
    if (!topmost) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, topmost])

  return (
    <section
      id="master"
      aria-labelledby="master-heading"
      // Short (a phone on its side), it scrolls: the views keep a height
      // to read, the knobs under them
      className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3 ${CARD}`}
    >
      {/* The loudness under the name, or, with room, beside it */}
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-2 sm:grid-cols-[auto_minmax(0,28rem)_1fr_auto]">
        <h2
          id="master-heading"
          className={`col-start-1 row-start-1 min-w-0 truncate px-1 ${SECTION_HEADING}`}
        >
          Master
        </h2>
        <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <Loudness engine={engine} />
        </div>
        <div className="col-start-2 row-start-1 sm:col-start-4">
          <IconButton
            label="Close master"
            onClick={onClose}
            path="M5 5l8 8M13 5l-8 8"
          />
        </div>
      </div>
      {/*
       * A size container: the grid's columns read its height (cqh) and
       * width (cqw), and its shape picks the layout (broad). Two rows;
       * the meters a column at the right. The stereo a square: under the
       * spectrum, beside the spectrogram, as tall as a row, and no wider
       * than 45% of the views' width (an upright phone's is narrower
       * than tall); or, broad, between the views and the meters, as tall
       * as both (broad, the height is at most 40% of the width).
       */}
      <div className="min-h-36 flex-1 [container:master/size]">
        <div className="grid h-full grid-cols-[minmax(0,1fr)_min(calc((100cqh_-_0.5rem)/2),calc((100cqw_-_4.5rem)*0.45))_4rem] grid-rows-2 gap-2 broad:grid-cols-[minmax(0,1fr)_min(100cqh,40cqw)_4rem]">
          <Named
            name="Spectrum"
            className="col-span-2 col-start-1 row-start-1 broad:col-span-1"
          >
            <Spectrum engine={engine} labelled className="h-full rounded-lg" />
          </Named>
          <Named name="Spectrogram" className="col-start-1 row-start-2">
            <Spectrogram
              engine={engine}
              labelled
              className="h-full rounded-lg"
            />
          </Named>
          <Named
            name="Stereo"
            className="col-start-2 row-start-2 broad:row-span-2 broad:row-start-1"
          >
            <Vectorscope
              engine={engine}
              correlated
              className="h-full rounded-lg"
            />
          </Named>
          {/* Its readout names it: no name over the meters' top */}
          <Meters
            engine={engine}
            readout
            className="col-start-3 row-span-2 row-start-1"
          />
        </div>
      </div>
      <MasterKnobs engine={engine} />
    </section>
  )
}

/**
 * The master's knobs in a row that pans when long: its level, then each of
 * its effects' in their order, a compressor's or a limiter's reduction
 * after its knobs, each effect's under its name and set off by a rule.
 * The knobs are the master panel's and each effect's panel's own, kept in
 * the mix as they turn. While there is room on the master, Add last puts
 * one on after the others, its kinds shown beside it while it is pressed:
 * a master with none has more to turn than its level. The Mix moves and
 * removes them.
 */
function MasterKnobs({ engine }: { engine: Engine }) {
  const mix = useSyncExternalStore(engine.subscribeMix, engine.getMix)
  const arc = neutralArc()
  const [adding, setAdding] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  // The kinds come in past the row's end on a phone: Add and the kinds
  // after it panned into sight, from Add on
  useEffect(() => {
    if (adding) {
      addRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'start',
        behavior: 'smooth',
      })
    }
  }, [adding])
  const room = mix.master.effects.length < MAX_EFFECTS
  return (
    <FadeRow
      aria-label="The master's knobs"
      // Its own width for KNOB_SIZE's: a knob at --knob, the panel's size
      className="-mx-3 shrink-0 @container [--knob-columns:1]"
      row="items-start px-3"
    >
      <Group name="Master">
        <MixKnob engine={engine} part={MASTER} knob="level" color={arc} />
      </Group>
      {mix.master.effects.map((effect) => (
        <Group key={effect.id} name={effectInRow(mix.master.effects, effect)}>
          {EFFECT_KINDS[effect.kind].knobs.map(({ key }) => (
            <MixKnob
              key={key}
              engine={engine}
              part={effect.id}
              knob={key}
              color={arc}
            />
          ))}
          {reduces(effect.kind) && (
            <ReductionCell engine={engine} at={{ id: effect.id }} color={arc} />
          )}
        </Group>
      ))}
      {room && (
        <Group name="Add" ref={addRef}>
          <Cell
            glyph={GLYPHS.plus}
            label="Effect"
            title="Add an effect to the master"
            pressed={adding}
            onClick={() => setAdding(!adding)}
          />
          {adding && (
            <div
              role="group"
              aria-label="Effects to add"
              className="flex items-start gap-2"
            >
              {EFFECT_KIND_ORDER.map((kind) => (
                <Cell
                  key={kind}
                  glyph={EFFECT_GLYPHS[kind]}
                  label={effectTile(kind)}
                  title={`Add ${EFFECT_KINDS[kind].label} to the master`}
                  onClick={() => {
                    engine.setMix(
                      addMixEffect(engine.getMix(), MASTER, kind).mix
                    )
                    setAdding(false)
                  }}
                />
              ))}
            </div>
          )}
        </Group>
      )}
    </FadeRow>
  )
}

/** A button a knob's size, its pictogram on its face and its name under */
function Cell({
  glyph,
  label,
  title,
  pressed,
  onClick,
}: {
  glyph: string
  label: string
  title: string
  pressed?: boolean
  onClick: () => void
}) {
  return (
    <div className={KNOB_COLUMN}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={pressed}
        title={title}
        onClick={onClick}
        className={`${KNOB_SIZE} flex aspect-square items-center justify-center rounded-[10px] bg-(--lift) text-(--ink-300) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)`}
      >
        <svg viewBox="0 0 18 12" aria-hidden className="h-auto w-[45%]">
          <path
            d={glyph}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span aria-hidden className={KNOB_LABEL}>
        {label}
      </span>
    </div>
  )
}

/** A part's knobs under its name, a rule before each but the first */
function Group({
  name,
  ref,
  children,
}: {
  name: string
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label={name}
      className="flex scroll-ml-3 flex-col gap-1 border-(--over)/10 not-first:ml-3 not-first:border-l not-first:pl-3"
    >
      <span
        aria-hidden
        className="text-[9px] font-medium tracking-widest whitespace-nowrap text-(--ink-600) uppercase"
      >
        {name}
      </span>
      <div className="flex items-start gap-2">{children}</div>
    </div>
  )
}

/** A view, its name in a corner over it */
function Named({
  name,
  className = '',
  children,
}: {
  name: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`relative min-h-0 min-w-0 ${className}`}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 right-1.5 text-[9px] font-medium tracking-widest text-(--ink-600) uppercase"
      >
        {name}
      </span>
    </div>
  )
}
