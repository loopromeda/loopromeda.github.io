/**
 * A touch that has been held: a knob's routes opened, a tile lifted. What
 * stands under the finger changes then (the routes take the panel's
 * place), and Android's own long press comes after ours, on whatever is
 * there now. Until the touch lets go, it opens no menu and selects no text
 * anywhere (main.tsx asks touchHeld).
 */
let held: number | null = null

/** pointerId was held: it is guarded until it lets go */
export function keepHeld(pointerId: number): void {
  held = pointerId
  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    if (held === pointerId) held = null
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
  }
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
}

/** A held touch is down */
export function touchHeld(): boolean {
  return held !== null
}
