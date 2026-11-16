import type { ReactNode } from 'react'
import { BAR_ICON_BUTTON, OPTION, SurfaceIcon } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

const KINDS = [
  { kind: 'keys', label: 'Keys' },
  { kind: 'pads', label: 'Pads' },
  { kind: 'xy', label: 'XY' },
] as const

/** Each picture by its name, at 18 px, as the surface's choices hold it */
export function Kinds() {
  return (
    <Stage>
      <div className="flex gap-1.5">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kind === 'pads'}
            className={OPTION}
          >
            <SurfaceIcon kind={kind} />
            {label}
          </button>
        ))}
      </div>
    </Stage>
  )
}

/**
 * Its sizes: 16 on the header's 36 px button, 18 in a choice, 14 in the
 * popover's chip; stroked in whatever ink it stands in
 */
export function Sizes() {
  return (
    <Stage>
      <div className="flex items-center gap-4 text-(--ink-200)">
        {KINDS.map(({ kind }) => (
          <div key={kind} className="flex items-center gap-2">
            <span className={BAR_ICON_BUTTON}>
              <SurfaceIcon kind={kind} size={16} />
            </span>
            <SurfaceIcon kind={kind} />
            <SurfaceIcon kind={kind} size={14} />
          </div>
        ))}
      </div>
    </Stage>
  )
}
