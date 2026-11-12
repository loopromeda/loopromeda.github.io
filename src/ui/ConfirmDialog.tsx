import { useLayoutEffect, useRef, type MouseEvent } from 'react'
import { BUTTON, BUTTON_DANGER, CARD } from './controls'

/**
 * A modal question before something that cannot be taken back (removing a
 * part): what goes, what goes with it, and the two answers. Cancel has the
 * focus, so Enter keeps the part; Escape, Back and a tap outside cancel
 * too. Shown while mounted.
 */
export function ConfirmDialog({
  title,
  message,
  confirm,
  onConfirm,
  onCancel,
}: {
  /** The question: Remove Chain A? */
  title: string
  /** What else it takes with it */
  message: string
  /** The answer that goes ahead: Remove */
  confirm: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef(onCancel)
  useLayoutEffect(() => {
    cancelRef.current = onCancel
  })
  // Open from its first paint; the browser closing it (Escape) cancels.
  // Unmounted, it closes quietly.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const closed = () => {
      if (!dialog.open) cancelRef.current()
    }
    dialog.addEventListener('close', closed)
    return () => {
      dialog.removeEventListener('close', closed)
      if (dialog.open) dialog.close()
    }
  }, [])
  // A tap on the backdrop: the dialog's own, outside its box
  const outside = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    const within =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    if (!within) onCancel()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onClick={outside}
      className={`m-auto w-[calc(100%_-_1.5rem)] max-w-xs flex-col gap-3 p-4 text-inherit open:flex backdrop:bg-black/70 ${CARD}`}
    >
      <h2 id="confirm-title" className="text-sm font-semibold text-zinc-100">
        {title}
      </h2>
      <p
        id="confirm-message"
        className="text-[13px] leading-snug text-zinc-400"
      >
        {message}
      </p>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className={`${BUTTON} flex-1`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`${BUTTON_DANGER} flex-1`}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  )
}
