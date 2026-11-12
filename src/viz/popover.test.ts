import { describe, expect, it } from 'vitest'
import { placePopover } from './popover'

// A fold open on its side: the page inside its margins, the patch's
// button at the left of the keyboard's header
const bounds = { left: 16, top: 16, right: 984, bottom: 591 }
const button = { left: 16, top: 330, right: 208, bottom: 374 }
const want = { w: 416, h: 480 }

describe('placePopover', () => {
  it('opens above the button, as tall as the room there', () => {
    expect(placePopover(button, bounds, want, 8)).toEqual({
      left: 16,
      top: 16,
      width: 416,
      height: 306,
      side: 'above',
    })
  })

  it('is as tall as it wants where the room allows', () => {
    const low = { ...button, top: 700, bottom: 744 }
    const tall = { ...bounds, bottom: 900 }
    const placed = placePopover(low, tall, want, 8)
    expect(placed.height).toBe(480)
    expect(placed.top + placed.height).toBe(692)
    expect(placed.side).toBe('above')
  })

  it('opens below a button with no room above (the controls put away)', () => {
    const top = { ...button, top: 16, bottom: 60 }
    expect(placePopover(top, bounds, want, 8)).toEqual({
      left: 16,
      top: 68,
      width: 416,
      height: 480,
      side: 'below',
    })
  })

  it('opens below only where the room below is more', () => {
    // 150 above, 100 below: above, short as it is
    const placed = placePopover(
      { ...button, top: 174, bottom: 218 },
      { ...bounds, bottom: 326 },
      want,
      8
    )
    expect(placed.side).toBe('above')
    expect(placed.height).toBe(150)
  })

  it('is no wider than the bounds, and kept within them', () => {
    const phone = { left: 16, top: 16, right: 374, bottom: 828 }
    const placed = placePopover(
      { ...button, top: 500, bottom: 544 },
      phone,
      want,
      8
    )
    expect(placed.left).toBe(16)
    expect(placed.width).toBe(358)
    const right = placePopover(
      { left: 900, top: 330, right: 980, bottom: 374 },
      bounds,
      want,
      8
    )
    expect(right.left + right.width).toBe(984)
  })

  it('has no size, not a negative one, with no room at all', () => {
    const none = { left: 16, top: 16, right: 16, bottom: 60 }
    const placed = placePopover(
      { ...button, top: 16, bottom: 60 },
      none,
      want,
      8
    )
    expect(placed.width).toBe(0)
    expect(placed.height).toBe(0)
  })
})
