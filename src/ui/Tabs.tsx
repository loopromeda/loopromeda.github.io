import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface Tab {
  id: string
  label: string
  panel: ReactNode
}

/**
 * Pages of controls behind a row of tabs. Every panel stays mounted in the
 * same grid cell, the inactive ones invisible: the area keeps the tallest
 * panel's height, so the keyboard below never jumps when the tab changes.
 * The arrow, Home and End keys move between tabs (WAI-ARIA tabs pattern).
 *
 * From the md breakpoint (768 px) the tabs go and the panels stand side by
 * side, all visible: a wide screen is short, and the keyboard needs the
 * height (the storyboard's Wide board). Each panel keeps at least 16rem, so
 * its knobs stay big enough to turn; ones that do not fit wrap to another
 * row. CSS only, so each panel, and each knob in it, is still mounted once.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: readonly Tab[]
  active: string
  onChange: (id: string) => void
  label: string
}) {
  const listRef = useRef<HTMLDivElement>(null)

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.id === active)
    const next = tabs[target(event.key, at, tabs.length - 1)]
    if (!next) return
    event.preventDefault()
    onChange(next.id)
    listRef.current?.querySelector<HTMLElement>(`#tab-${next.id}`)?.focus()
  }

  return (
    <div className="flex shrink-0 flex-col gap-3">
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={key}
        className="flex h-11 overflow-hidden rounded-xl bg-white/5 md:hidden"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className="flex-1 text-xs font-semibold tracking-wider text-zinc-400 aria-selected:bg-white/10 aria-selected:text-white"
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div className="grid md:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] md:gap-3">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab.id}`}
            className={`col-start-1 row-start-1 md:visible md:col-auto md:row-auto ${tab.id === active ? '' : 'invisible'}`}
          >
            {tab.panel}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The tab a key moves to from tab at (of 0..last), wrapping; -1: none */
function target(key: string, at: number, last: number): number {
  switch (key) {
    case 'ArrowRight':
      return at === last ? 0 : at + 1
    case 'ArrowLeft':
      return at === 0 ? last : at - 1
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return -1
  }
}
