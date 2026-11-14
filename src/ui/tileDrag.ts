import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import type { Box } from '../viz/graph'
import { CARD_FACE, HOLD } from './controls'
import { keepHeld } from './held'

/** A mouse moved this far (CSS px) with its button down drags the tile */
const SLOP = 6
/** A touch moved this far before its hold is a pan, not a hold */
const TOUCH_SLOP = 10
/** Within this of an edge of what pans (CSS px), a drag pans it */
const EDGE = 32
/** How far it pans a frame at the edge, less further in */
const PAN = 12
/** A click this soon after a tile is put down (ms) is the drag's own */
const SWALLOW = 400

/** Which ways a tile follows the finger */
export type Axis = 'x' | 'y' | 'xy'

/** Where a tile would be put down: the marker showing it, in its colour */
export interface Spot {
  readonly marker: Box
  readonly color: string
}

/** What a surface of tiles tells the drag */
export interface DragSurface<T extends Spot> {
  /** What pans, near its edges, while a tile is dragged */
  readonly scroller: RefObject<HTMLElement | null>
  /** What the tiles stand in (positioned): its pixels are the drag's */
  readonly content: RefObject<HTMLElement | null>
  /** The marker, standing in content, hidden until shown */
  readonly marker: RefObject<HTMLElement | null>
  readonly axis: (id: string) => Axis
  /** The elements that move with a tile: itself, or a chain's whole row */
  readonly moving?: (id: string, tile: HTMLElement) => HTMLElement[]
  /** Where id, dragged to (x, y) of content, would go, if anywhere */
  readonly locate: (id: string, x: number, y: number) => T | undefined
  /** Puts id down there */
  readonly drop: (id: string, at: T) => void
  /** id is lifted (it is picked, say) */
  readonly lift?: (id: string) => void
}

/** What a draggable tile takes, spread onto its button */
export interface DragProps {
  readonly 'data-drag': string
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void
  readonly onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void
}

/**
 * Tiles dragged to a new place (docs/plan/sound-chains.md, The editor).
 * A touch kept still for HOLD lifts the tile, since a touch that moves
 * pans the graph; a mouse lifts it once it moves. Lifted, the tile (and
 * whatever moves with it) follows the finger, the marker stands where it
 * would go, and near an edge the surface pans; let go there, it goes.
 * Escape, or a finger let go off the surface, puts it back.
 *
 * Like a knob, the drag sets styles straight on the elements: nothing
 * re-renders while a tile moves.
 */
export function useTileDrag<T extends Spot>(
  surface: DragSurface<T>
): (id: string) => DragProps {
  const surfaceRef = useRef(surface)
  useLayoutEffect(() => {
    surfaceRef.current = surface
  })
  const gesture = useRef({
    id: '',
    pointerId: -1,
    mouse: false,
    startX: 0,
    startY: 0,
    clientX: 0,
    clientY: 0,
    /** The pending hold's timer, 0 for none */
    hold: 0,
    lifted: false,
    tile: null as HTMLElement | null,
    moving: [] as HTMLElement[],
    axis: 'xy' as Axis,
    /** Where the tile stood, and was grabbed, in content's pixels */
    box: { x: 0, y: 0, w: 0, h: 0 } as Box,
    grabX: 0,
    grabY: 0,
    at: undefined as T | undefined,
    frame: 0,
    /** When the last lifted tile was let go */
    released: -Infinity,
    /** Escape's listener while a tile is lifted */
    escape: null as ((event: KeyboardEvent) => void) | null,
  })

  /** The pointer, in content's pixels */
  const local = (clientX: number, clientY: number) => {
    const rect = surfaceRef.current.content.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }

  /** The tile and the marker where the pointer is now */
  const follow = () => {
    const g = gesture.current
    const { content, scroller, marker, locate } = surfaceRef.current
    const at = local(g.clientX, g.clientY)
    // Kept inside content, which would otherwise grow under it and pan on
    const width = content.current?.offsetWidth ?? 0
    const height = content.current?.offsetHeight ?? 0
    const dx =
      g.axis === 'y'
        ? 0
        : clamp(at.x - g.grabX, -g.box.x, width - g.box.x - g.box.w)
    const dy =
      g.axis === 'x'
        ? 0
        : clamp(at.y - g.grabY, -g.box.y, height - g.box.y - g.box.h)
    const scale = g.moving.length === 1 ? ' scale(1.04)' : ''
    for (const element of g.moving) {
      element.style.transform = `translate(${dx}px, ${dy}px)${scale}`
    }
    const rect = scroller.current?.getBoundingClientRect()
    const over =
      rect !== undefined &&
      g.clientX >= rect.left - EDGE &&
      g.clientX <= rect.right + EDGE &&
      g.clientY >= rect.top - EDGE &&
      g.clientY <= rect.bottom + EDGE
    g.at = over ? locate(g.id, at.x, at.y) : undefined
    const mark = marker.current
    if (!mark) return
    if (!g.at) {
      mark.style.display = ''
      return
    }
    const { marker: box, color } = g.at
    Object.assign(mark.style, {
      display: 'block',
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.w}px`,
      height: `${box.h}px`,
      background: color,
      boxShadow: `0 0 0 2px ${CARD_FACE}, 0 0 10px ${color}`,
    })
  }

  /** Pans the scroller while the pointer is near its edges, every frame */
  const pan = () => {
    const g = gesture.current
    if (!g.lifted) return
    const scroller = surfaceRef.current.scroller.current
    if (scroller) {
      const rect = scroller.getBoundingClientRect()
      const by = (near: number, far: number) =>
        near < EDGE && near > -EDGE
          ? -speed(near)
          : far < EDGE && far > -EDGE
            ? speed(far)
            : 0
      const left = scroller.scrollLeft
      const top = scroller.scrollTop
      if (g.axis !== 'y') {
        scroller.scrollLeft += by(g.clientX - rect.left, rect.right - g.clientX)
      }
      if (g.axis !== 'x') {
        scroller.scrollTop += by(g.clientY - rect.top, rect.bottom - g.clientY)
      }
      if (scroller.scrollLeft !== left || scroller.scrollTop !== top) follow()
    }
    g.frame = requestAnimationFrame(pan)
  }

  const lift = () => {
    const g = gesture.current
    const tile = g.tile
    const { content, moving, axis } = surfaceRef.current
    if (!tile || !content.current) return
    window.clearTimeout(g.hold)
    g.hold = 0
    g.lifted = true
    g.axis = axis(g.id)
    g.moving = moving?.(g.id, tile) ?? [tile]
    g.box = {
      x: tile.offsetLeft,
      y: tile.offsetTop,
      w: tile.offsetWidth,
      h: tile.offsetHeight,
    }
    const grab = local(g.clientX, g.clientY)
    g.grabX = grab.x
    g.grabY = grab.y
    for (const element of g.moving) {
      element.style.zIndex = '10'
      element.style.filter = 'drop-shadow(0 6px 10px var(--shadow))'
    }
    if (!g.mouse) {
      navigator.vibrate?.(10)
      keepHeld(g.pointerId)
    }
    g.escape = (event) => {
      if (event.key === 'Escape') end()
    }
    document.addEventListener('keydown', g.escape)
    surfaceRef.current.lift?.(g.id)
    follow()
    g.frame = requestAnimationFrame(pan)
  }

  /** Puts everything back as it stood; the drop, if any, is the caller's */
  const end = () => {
    const g = gesture.current
    window.clearTimeout(g.hold)
    cancelAnimationFrame(g.frame)
    if (g.lifted) {
      for (const element of g.moving) {
        element.style.transform = ''
        element.style.zIndex = ''
        element.style.filter = ''
      }
      const mark = surfaceRef.current.marker.current
      if (mark) mark.style.display = ''
    }
    if (g.escape) document.removeEventListener('keydown', g.escape)
    g.escape = null
    g.hold = 0
    g.lifted = false
    g.pointerId = -1
    g.tile = null
    g.moving = []
    g.at = undefined
  }

  // Lifted, a touch's moves drag the tile instead of panning: only a
  // listener there from the start, and not passive, may say so
  useEffect(() => {
    const scroller = surface.scroller.current
    if (!scroller) return
    const hold = (event: TouchEvent) => {
      if (gesture.current.lifted && event.cancelable) event.preventDefault()
    }
    scroller.addEventListener('touchmove', hold, { passive: false })
    return () => scroller.removeEventListener('touchmove', hold)
  }, [surface.scroller])

  // The tiles going away mid-drag leave no listener behind
  useEffect(() => () => end(), [])

  return (id: string): DragProps => ({
    'data-drag': id,
    onPointerDown: (event) => {
      const g = gesture.current
      if (g.pointerId !== -1) return
      const mouse = event.pointerType === 'mouse'
      if (mouse && event.button !== 0) return
      g.id = id
      g.pointerId = event.pointerId
      g.mouse = mouse
      g.tile = event.currentTarget
      g.startX = g.clientX = event.clientX
      g.startY = g.clientY = event.clientY
      // A touch is the tile's until it lets go; a mouse is made so
      if (mouse) event.currentTarget.setPointerCapture(event.pointerId)
      else g.hold = window.setTimeout(lift, HOLD)
    },
    onPointerMove: (event) => {
      const g = gesture.current
      if (event.pointerId !== g.pointerId) return
      g.clientX = event.clientX
      g.clientY = event.clientY
      if (g.lifted) {
        follow()
        return
      }
      const far = Math.hypot(g.clientX - g.startX, g.clientY - g.startY)
      // A touch that moves before its hold pans the graph instead
      if (g.mouse && far >= SLOP) lift()
      else if (!g.mouse && far >= TOUCH_SLOP) end()
    },
    onPointerUp: (event) => {
      const g = gesture.current
      if (event.pointerId !== g.pointerId) return
      const { lifted, at } = g
      if (lifted) g.released = event.timeStamp
      const id = g.id
      end()
      if (lifted && at) surfaceRef.current.drop(id, at)
    },
    onPointerCancel: (event) => {
      if (event.pointerId === gesture.current.pointerId) end()
    },
    onClickCapture: (event) => {
      // The click a mouse makes letting go of a tile is not a tap on it
      if (event.timeStamp - gesture.current.released < SWALLOW) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
  })
}

/** How far to pan a frame with the pointer at distance from an edge */
function speed(distance: number): number {
  return Math.ceil(PAN * Math.min(1, (EDGE - distance) / EDGE))
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}
