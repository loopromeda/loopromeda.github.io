import { useSyncExternalStore } from 'react'

/**
 * Whether the surfaces have a computer keyboard to be played from, so the
 * keys show the computer keys' letters: from the start where the pointer
 * is fine (a mouse: a desktop's), or once a computer key has played or
 * moved a surface since the page opened (a Bluetooth keyboard on a
 * phone), then for as long as the page stays open. A phone with no
 * keyboard never shows them.
 */
const FINE = '(pointer: fine)'

let pressed = false
const listeners = new Set<() => void>()

/** A computer key played a note or a pad, or moved a surface */
export function computerKeyPressed(): void {
  if (pressed) return
  pressed = true
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const fine = window.matchMedia?.(FINE)
  fine?.addEventListener('change', listener)
  return () => {
    listeners.delete(listener)
    fine?.removeEventListener('change', listener)
  }
}

const snapshot = () => pressed || (window.matchMedia?.(FINE).matches ?? false)

/** True while the keys should show the computer keys' letters */
export function useComputerKeys(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
