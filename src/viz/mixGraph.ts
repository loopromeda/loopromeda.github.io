/**
 * Where the mix's tiles go (docs/plan/effects-parts-sequencer.md), laid
 * out as the sound's graph lays out a sound (graph.ts): the tracks'
 * strips at the left in one column, one under another, as a sound's
 * inputs stand, each with room for its view under its name, and under
 * the last the "+" that adds a track; then each bus a group, one under
 * another: a box in its letter's colour, its head across the top (the
 * letter and the level), and under it its effects as squares, a line of
 * them after another, its "+" in the next place filling the rest of its
 * line; then the master a group too, its head, its effects and its "+"
 * the same way (its "+" after its effects taking one place only, its
 * line as long as the frame), and under them the view of the output it
 * holds, filling the rest of the frame's width. Asked for by ashon,
 * 2026-11-15 ("AB 버스도 그룹 형태로 묶어서.. 정사각형 형태로 FX 블록들을
 * 이어보는건 어떨까? 마스터링도 마스터링 FX를 안에 배치할 수 있게 하면
 * 공간을 더 아낄 수 있을 것 같네"), where each bus had been a row of tiles
 * as long as its effects, and the master's effects tiles of their own
 * before it.
 *
 * Threads join them (threads.ts), as they join a sound's tiles: from each
 * track's strip into each bus it sends to, a hole for each down the
 * strip's edge and a lane down the seam for each bus (mixSends), into
 * the bus's first effect at its left (its head, with none); in each
 * group across to the next effect in its line, and turning across to
 * the first of the next line; then from the last, its level's, out of
 * the group's right edge. The buses' threads go on into the master the
 * same way, down a lane of their own in the seam before it, into its
 * first effect at its left (its head, with none): asked for by ashon,
 * 2026-11-15 ("버스에서 마스터링으로 갈 때도, 인풋에서 버스로 가는
 * 메커니즘과 동일하게"), where they had come onto a bus down the seam
 * that took them into it, and the tracks' into each head, then down into
 * its first effect ("체인 표현도 어색하게 꺾이지 않도록"). In the master
 * they run on in the same way, ending at the last effect: none runs on
 * into the view, which shows what comes out and is no stage of it
 * ("마스터 블록 안의 체인들과 그 하단에 시각화는 굳이 연결하지 않아도",
 * ashon, 2026-11-15). Along the foot, the "+"s: a track's under the
 * strips and "+ Bus" under the groups. More tracks make the mix taller,
 * never wider: the strips, and the groups and the master in the middle
 * beside them, stand as tall as the tallest of them, and a frame shorter
 * than that pans down. Pure math, no DOM.
 */
import type { Box } from './graph'
import { across, holes, THREAD, type Point, type Run } from './threads'

/**
 * The mix in pixels at rest: a strip 62 tall at least (its view under its
 * name) and 84 wide (a track's name by its kind and place and its level
 * on a line), 6 between strips and between groups, 12 between the strips
 * and the groups (THREAD.gap),
 * or more where the buses' lanes down it need more (16 for four:
 * stripGap); a group's head 22 tall, its squares 4 inside its edges, an
 * effect's square 60 (44 as an icon), 3 between squares in a line and 8
 * between lines (room for the thread turning across); 12 between the
 * groups and the master, where the buses' threads bend (THREAD.gap); the
 * master 96 wide at least, its view half as tall as it is wide, from 56
 * to 200, and in a taller frame up to 360; the "+" row 30 tall.
 *
 * At rest each bus's group holds its squares in one line, as long as the
 * longest bus's, and the master's in one line too. A frame narrower than
 * that breaks the groups' lines, as few at a time as fit, two squares to
 * a line at least, the master taking what is left with as many to a line
 * as it holds; and narrower still makes every effect an icon, its
 * pictogram alone, 44 square (a touch's width), breaking them again. A
 * frame narrower than that pans.
 *
 * A wider frame widens the strip and the squares by a third of what it
 * has past the mix at rest, in proportion, up to stretch times theirs,
 * and the master takes the rest. A taller one grows the strips, up to
 * stretch times at rest, and the master's view, up to half as tall as
 * it is wide, the groups and the master standing in their middle; the
 * frame's rest is left empty past that.
 */
export const MIX_GRAPH = {
  top: 8,
  x: 8,
  end: 8,
  rowGap: 6,
  strip: 62,
  stripW: 84,
  head: 22,
  pad: 4,
  itemW: 60,
  iconW: 44,
  itemSeam: 3,
  lineGap: 8,
  busSeam: THREAD.gap,
  masterW: 96,
  viewTall: 0.5,
  viewMin: 56,
  viewMax: 200,
  viewMost: 360,
  addRow: 30,
  stretch: 2,
} as const

/**
 * What the layout reads of a mix: its tracks' strips (one, unless given),
 * its buses and effects, by id
 */
export interface MixGraphMix {
  readonly strips?: readonly unknown[]
  readonly buses: readonly {
    readonly id: string
    readonly effects: readonly { readonly id: string }[]
  }[]
  readonly master: { readonly effects: readonly { readonly id: string }[] }
}

/**
 * How many buses a mix holds, and effects in a group, at most; and
 * tracks, where one can be added from here (without, no "+" stands for
 * one)
 */
export interface MixLimits {
  readonly buses: number
  readonly effects: number
  readonly tracks?: number
}

/**
 * How wide the seam between the strips and the groups stands for buses:
 * THREAD.gap, or a lane for each, THREAD.lane apart and laneMargin inside
 * its edges, where that is wider
 */
export const stripGap = (buses: number) =>
  Math.max(THREAD.gap, THREAD.lane * (buses - 1) + 2 * THREAD.laneMargin)

/**
 * A track's thread to a bus: from its strip (by place) to the bus's head,
 * bending about the bus's lane, and its tap target over its hole
 */
export interface MixThread {
  readonly strip: number
  readonly bus: string
  readonly run: Run
  /** Where it bends, upright, in the seam: the bus's lane (lanePath) */
  readonly lane: number
  readonly hit: Box
}

/** An effect's tile */
export interface EffectBox {
  readonly effect: string
  readonly box: Box
}

/**
 * A bus's thread into the master: from the group's right edge (or its
 * last effect's, standing there) into the master's first effect at its
 * left (its head, with none), bending about the lane down the seam
 * (lanePath), and its tap target over the group's edge about its hole
 * and the seam
 */
export interface BusOut {
  readonly run: Run
  readonly lane: number
  readonly hit: Box
}

/** A bus's group: its box, its head, its effects and its "+" (unless full) */
export interface BusGroup {
  readonly bus: string
  /** The group, its head and its squares inside it */
  readonly box: Box
  /**
   * Its head across the top, its letter and level: where the tracks'
   * threads come in while it holds no effects
   */
  readonly head: Box
  readonly effects: readonly EffectBox[]
  /** The "+" in the place after its effects, to the end of that line */
  readonly add: Box | undefined
  /**
   * The thread's runs through it, from each effect to the next (across,
   * or turning across to the next line)
   */
  readonly stitches: readonly Run[]
  /**
   * Its level's run from the last effect (or the head) to its hole in
   * the group's right edge, over the "+" after it: none where the last
   * stands at that edge, its own hole the thread's
   */
  readonly level: Run | undefined
  /** Its level's thread on, into the master */
  readonly out: BusOut
}

export interface MixGeometry {
  /** Whether its effects stand as icons, MIX_GRAPH.iconW square */
  readonly icons: boolean
  /** The content, which pans when wider or taller than its frame */
  readonly width: number
  readonly height: number
  /** Its height at rest (its lines whole): what it asks of a frame */
  readonly rest: number
  /**
   * Each track's strip, in the mix's order, down the one column: as tall
   * as each other, sharing it down to the "+" row (to its foot, with no
   * "+" for another)
   */
  readonly strips: readonly Box[]
  /**
   * The dashed "+" that adds a track, under the last strip in the "+"
   * row, unless there are the most
   */
  readonly addTrack: Box | undefined
  /** The buses' groups, in their order, as wide as each other */
  readonly buses: readonly BusGroup[]
  /** The master's group: its head, its squares and its view inside it */
  readonly master: Box
  readonly masterHead: Box
  readonly masterEffects: readonly EffectBox[]
  /** Its "+", in the place after its effects, unless full */
  readonly masterAdd: Box | undefined
  /** Where the output's view stands in it, under its squares */
  readonly view: Box
  /**
   * The runs from each of the master's effects to the next, across or
   * turning across to the next line: none into the view, which shows the
   * output and is not a stage of it. The first effect has none of its
   * own: the buses' threads come into it
   */
  readonly masterStitches: readonly Run[]
  /** The dashed "+ Bus" under the groups */
  readonly addBus: Box | undefined
}

/** The places in a group: its effects, and its "+" unless full */
const slotsOf = (effects: number, limits: MixLimits) =>
  effects + (effects < limits.effects ? 1 : 0)

/** How wide n squares fx wide stand in a line */
const lineW = (n: number, fx: number) => n * fx + (n - 1) * MIX_GRAPH.itemSeam

/** How wide a group stands holding cols squares to a line */
const groupW = (cols: number, fx: number) => 2 * MIX_GRAPH.pad + lineW(cols, fx)

/**
 * Whether a group's "+" stands in a line of its own, its effects filling
 * the lines before it, perLine to a line
 */
const alone = (effects: number, perLine: number, limits: MixLimits) =>
  effects < limits.effects && effects % perLine === 0

/**
 * How tall a group's lines stand, perLine to a line: each a square's
 * height, but a line holding the "+" alone the "+" row's
 */
function linesH(
  effects: number,
  perLine: number,
  fx: number,
  limits: MixLimits
): number {
  const g = MIX_GRAPH
  const lines = Math.max(1, Math.ceil(slotsOf(effects, limits) / perLine))
  const last = alone(effects, perLine, limits) ? g.addRow : fx
  return (lines - 1) * (fx + g.lineGap) + last
}

/** How many strips stand in the column, and whether a "+" under them */
function stripsOf(mix: MixGraphMix, limits: MixLimits) {
  const parts = Math.max(1, mix.strips?.length ?? 1)
  return {
    parts,
    more: limits.tracks !== undefined && parts < limits.tracks,
  } as const
}

/** The most places a bus's group holds, and the master's */
function placesOf(mix: MixGraphMix, limits: MixLimits) {
  const most = Math.max(
    1,
    ...mix.buses.map((bus) => slotsOf(bus.effects.length, limits))
  )
  return { most, master: slotsOf(mix.master.effects.length, limits) }
}

/**
 * How wide the mix stands, its strip and squares s times their own (or
 * icons), its groups cols squares to a line and the master need wide
 */
function extent(
  mix: MixGraphMix,
  cols: number,
  fx: number,
  s: number,
  need: number
): number {
  const g = MIX_GRAPH
  const left = g.x + g.stripW * s + stripGap(mix.buses.length)
  return left + groupW(cols, fx) + g.busSeam + need + g.end
}

/** The mix at rest, s times its own: every group's squares in one line */
function restExtent(mix: MixGraphMix, limits: MixLimits, s: number) {
  const { most, master } = placesOf(mix, limits)
  const fx = MIX_GRAPH.itemW * s
  const need = Math.max(MIX_GRAPH.masterW, groupW(master, fx))
  return extent(mix, most, fx, s, need)
}

/**
 * How the mix stands in a frame fill wide: its effects icons or not, how
 * many squares to a group's line, and how far the strip and the squares
 * widen (MIX_GRAPH)
 */
function layoutFor(mix: MixGraphMix, limits: MixLimits, fill?: number) {
  const g = MIX_GRAPH
  const { most, master } = placesOf(mix, limits)
  const at1 = restExtent(mix, limits, 1)
  if (fill === undefined) return { icons: false, cols: most, s: 1 }
  if (fill >= at1) {
    const s = 1 + (fill - at1) / 3 / (restExtent(mix, limits, 2) - at1)
    return { icons: false, cols: most, s: Math.min(g.stretch, s) }
  }
  const least = Math.min(2, most)
  for (const icons of [false, true]) {
    const fx = icons ? g.iconW : g.itemW
    // The master two to a line at least, where it holds two
    const need = Math.max(g.masterW, groupW(Math.min(2, master), fx))
    for (let cols = most; cols >= least; cols--) {
      if (extent(mix, cols, fx, 1, need) <= fill) return { icons, cols, s: 1 }
    }
  }
  return { icons: true, cols: least, s: 1 }
}

/**
 * The places of a group at x, y, its squares fx square, cols to a line:
 * the nth's box
 */
function placer(x: number, y: number, fx: number, cols: number) {
  const g = MIX_GRAPH
  return (n: number): Box => ({
    x: x + g.pad + (n % cols) * (fx + g.itemSeam),
    y: y + g.head + Math.floor(n / cols) * (fx + g.lineGap),
    w: fx,
    h: fx,
  })
}

/** The middle of a box, down */
const middleOf = (box: Box) => box.y + box.h / 2

/**
 * The run from one square into the next: across where they share a
 * line, else turning across from the one's foot at its right into the
 * next's top at its left, clear of their pictograms and names
 */
function onward(from: Box, to: Box): Run {
  if (from.y === to.y) return across(from, to, middleOf(from))
  return {
    from: {
      x: from.x + from.w - THREAD.inset,
      y: from.y + from.h - THREAD.inset,
    },
    to: { x: to.x + THREAD.inset, y: to.y + THREAD.inset },
    upright: true,
  }
}

/**
 * Where everything in the mix is drawn, in a frame fill wide and room
 * tall (the room the frame leaves the tiles); unframed, as MIX_GRAPH has
 * it at rest. A frame too small pans.
 */
export function mixGeometry(
  mix: MixGraphMix,
  limits: MixLimits,
  fill?: number,
  room?: number
): MixGeometry {
  const g = MIX_GRAPH
  const count = mix.buses.length
  const { icons, cols, s } = layoutFor(mix, limits, fill)
  const fx = icons ? g.iconW : Math.floor(g.itemW * s)
  const stripW = Math.floor(g.stripW * s)
  const headX = g.x + stripW + stripGap(count)
  const gw = groupW(cols, fx)
  const masterX = headX + gw + g.busSeam
  const { master: masterSlots } = placesOf(mix, limits)
  const masterW =
    fill === undefined
      ? Math.max(g.masterW, groupW(masterSlots, fx))
      : Math.max(g.masterW, fill - masterX - g.end)
  // The master's squares, as many to a line as it holds, and its view
  const inner = masterW - 2 * g.pad
  const perLine = Math.max(
    1,
    Math.floor((inner + g.itemSeam) / (fx + g.itemSeam))
  )
  const masterLinesH = linesH(mix.master.effects.length, perLine, fx, limits)
  // Its view at rest, and as tall as a taller frame lets it grow
  const half = Math.round(inner * g.viewTall)
  const viewRest = Math.min(g.viewMax, Math.max(g.viewMin, half))
  const viewMost = Math.max(viewRest, Math.min(g.viewMost, half))
  const masterOwn = g.head + masterLinesH + g.lineGap + g.pad

  // The groups, each as tall as its lines, down one column
  const tallOf = mix.buses.map(
    (bus) => g.head + linesH(bus.effects.length, cols, fx, limits) + g.pad
  )
  const groupsH =
    tallOf.reduce((sum, h) => sum + h, 0) + Math.max(0, count - 1) * g.rowGap

  // How tall everything stands: the strips' column and, beside it, the
  // groups and the master over the "+" row, which is always there; a
  // taller frame grows the strips
  const { parts, more } = stripsOf(mix, limits)
  const foot = g.rowGap + g.addRow
  const under = more ? foot : 0
  const column = (h: number) => parts * (h + g.rowGap) - g.rowGap + under
  const beside = (view: number) => Math.max(groupsH, masterOwn + view) + foot
  const rest = Math.max(column(g.strip), beside(viewRest))
  const most = Math.max(column(g.strip * g.stretch), beside(viewMost))
  const body =
    room === undefined
      ? rest
      : Math.min(most, Math.max(rest, room - g.top - g.end))
  const span = body - foot
  // The view takes what the span has past the master at rest
  const viewH = Math.min(viewMost, Math.max(viewRest, span - masterOwn))
  const masterH = masterOwn + viewH
  // The strips grow with the frame up to twice theirs, not past that
  // with the master's view: the "+" for another under the last
  const own =
    Math.min(body, Math.max(rest, column(g.strip * g.stretch))) - under
  const strip = Math.floor((own + g.rowGap) / parts) - g.rowGap

  // The master in the middle: its squares, its "+" and its view
  const masterY = g.top + Math.floor((span - masterH) / 2)
  const master = { x: masterX, y: masterY, w: masterW, h: masterH }
  const masterHead = { x: masterX, y: masterY, w: masterW, h: g.head }
  const masterPlace = placer(masterX, masterY, fx, perLine)
  const masterEffects = mix.master.effects.map((effect, f) => ({
    effect: effect.id,
    box: masterPlace(f),
  }))
  /** A "+" in its place, filling the rest of its line in a group x, w */
  const toEnd = (box: Box, x: number, w: number, own: boolean) => ({
    ...box,
    w: x + w - g.pad - box.x,
    h: own ? g.addRow : box.h,
  })
  // The master's "+" fills a line of its own only: after its effects it
  // takes its place, the master's line as long as the frame leaves it
  const masterOwnLine = alone(mix.master.effects.length, perLine, limits)
  const masterPlus = masterPlace(mix.master.effects.length)
  const masterAdd =
    mix.master.effects.length < limits.effects
      ? masterOwnLine
        ? toEnd(masterPlus, masterX, masterW, true)
        : masterPlus
      : undefined
  const view = {
    x: masterX + g.pad,
    y: masterY + g.head + masterLinesH + g.lineGap,
    w: inner,
    h: viewH,
  }
  const stages = masterEffects.map(({ box }) => box)
  // Where every bus's thread comes into the master, as the tracks' come
  // into a bus: its first effect's left, at its middle (its head's, with
  // none)
  const into = holes(stages[0] ?? masterHead, 'left', 1)[0] as Point

  // The groups in the middle, each its squares and its "+"
  let y = g.top + Math.floor((span - groupsH) / 2)
  const groups = mix.buses.map((bus, k) => {
    const box = { x: headX, y, w: gw, h: tallOf[k] ?? 0 }
    y += box.h + g.rowGap
    const head = { x: headX, y: box.y, w: gw, h: g.head }
    const place = placer(headX, box.y, fx, cols)
    const effects = bus.effects.map((effect, f) => ({
      effect: effect.id,
      box: place(f),
    }))
    const add =
      bus.effects.length < limits.effects
        ? toEnd(
            place(bus.effects.length),
            headX,
            gw,
            alone(bus.effects.length, cols, limits)
          )
        : undefined
    const last = effects[effects.length - 1]?.box ?? head
    return { bus: bus.id, box, head, effects, add, last }
  })

  // Each bus's level out of its group's right edge, then down the lane
  // in the seam into the master
  const lane = masterX - g.busSeam / 2
  const buses: BusGroup[] = groups.map(({ last, ...group }) => {
    const tiles = group.effects.map(({ box }) => box)
    const stitches = tiles
      .slice(1)
      .map((tile, t) => onward(tiles[t] ?? tile, tile))
    const y = middleOf(last)
    const right = group.box.x + group.box.w
    const own = last.x + last.w - THREAD.inset
    const edge = right - THREAD.inset
    // The last standing at the edge: its own hole is the group's
    const level =
      edge - own > THREAD.spacing
        ? { from: { x: own, y }, to: { x: edge, y } }
        : undefined
    const from = { x: level ? edge : own, y }
    return {
      ...group,
      stitches,
      level,
      out: {
        run: { from, to: into },
        lane,
        hit: {
          x: right - THREAD.spacing,
          y: y - THREAD.hitH / 2,
          w: masterX - right + THREAD.spacing,
          h: THREAD.hitH,
        },
      },
    }
  })

  const addY = g.top + span + g.rowGap
  const trackY = g.top + own + g.rowGap
  const strips = Array.from({ length: parts }, (_, k) => {
    const at = k * (strip + g.rowGap)
    return {
      x: g.x,
      y: g.top + at,
      w: stripW,
      h: k === parts - 1 ? own - at : strip,
    }
  })
  return {
    icons,
    width: masterX + masterW + g.end,
    height: g.top + body + g.end,
    rest: g.top + rest + g.end,
    strips,
    addTrack: more ? { x: g.x, y: trackY, w: stripW, h: g.addRow } : undefined,
    buses,
    master,
    masterHead,
    masterEffects,
    masterAdd,
    view,
    masterStitches: stages
      .slice(1)
      .map((box, f) => onward(stages[f] ?? box, box)),
    addBus:
      count < limits.buses
        ? { x: headX, y: addY, w: gw, h: g.addRow }
        : undefined,
  }
}

/**
 * The tracks' threads to the buses' heads, sends[k] the buses strip k
 * sends anything to: from a hole for each down the strip's right edge,
 * in the buses' order, each into its bus's head at its middle, bending
 * about that bus's lane in the seam. The lanes stand in the seam's middle,
 * one for each bus sent to, and the one whose threads run longest (from
 * the strips furthest from its head) stands nearest the strips, so that
 * threads to buses above and below bend with fewer crossings. A thread's tap
 * target covers the strip's edge about its hole, THREAD.spacing into it,
 * and the seam: THREAD.hitH tall, or THREAD.spacing where holes stand
 * that close.
 */
export function mixSends(
  geometry: MixGeometry,
  sends: readonly (readonly string[])[]
): MixThread[] {
  // Into the bus's first effect at its left, or its head with none
  const into = new Map(
    geometry.buses.map((row) => [
      row.bus,
      holes(row.effects[0]?.box ?? row.head, 'left', 1)[0],
    ])
  )
  const runs: { strip: number; bus: string; run: Run; tall: number }[] = []
  geometry.strips.forEach((strip, k) => {
    const to = geometry.buses.filter((row) => sends[k]?.includes(row.bus))
    const from = holes(strip, 'right', to.length)
    to.forEach((row, n) => {
      runs.push({
        strip: k,
        bus: row.bus,
        run: { from: from[n] as Point, to: into.get(row.bus) as Point },
        tall: to.length > 1 ? THREAD.spacing : THREAD.hitH,
      })
    })
  })
  // How far each bus's lane runs, top to bottom, its head's middle too
  const reach = new Map<string, number>()
  for (const row of geometry.buses) {
    const ys = runs
      .filter((each) => each.bus === row.bus)
      .map((each) => each.run.from.y)
    if (ys.length === 0) continue
    const y = (into.get(row.bus) as Point).y
    reach.set(row.bus, Math.max(y, ...ys) - Math.min(y, ...ys))
  }
  const order = geometry.buses
    .map((row) => row.bus)
    .filter((bus) => reach.has(bus))
    .sort((a, b) => (reach.get(b) ?? 0) - (reach.get(a) ?? 0))
  const strip = geometry.strips[0]
  const head = geometry.buses[0]?.head
  if (!strip || !head) return []
  const left = strip.x + strip.w
  const middle = (left + head.x) / 2
  const lane = (bus: string) =>
    middle + (order.indexOf(bus) - (order.length - 1) / 2) * THREAD.lane
  return runs.map(({ strip: k, bus, run, tall }) => ({
    strip: k,
    bus,
    run,
    lane: lane(bus),
    hit: {
      x: left - THREAD.spacing,
      y: run.from.y - tall / 2,
      w: head.x - left + THREAD.spacing,
      h: tall,
    },
  }))
}
