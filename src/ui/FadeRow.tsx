import {
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

/** How far in from a side the fade reaches, where there is more that way */
const FADE = 24

/**
 * A row that pans sideways when long, by a finger or a wheel and without a
 * scrollbar, faded out at a side with more past it: a button cut short
 * there reads as the row going on, not as cut. The fade follows the row
 * as it pans and as it or what it holds resizes, set on the row itself
 * (--fade-l, --fade-r) and not through React. className places and sizes
 * the scroller; row lays out what it holds (a gap, a padding at its ends
 * to stand them in from the card's edges, which the row runs to).
 */
export function FadeRow({
  className = '',
  row = '',
  children,
  ...attributes
}: {
  className?: string
  row?: string
  children: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const inner = rowRef.current
    if (!scroller || !inner) return
    const measure = () => {
      const end = scroller.scrollWidth - scroller.clientWidth
      // A pixel either way, for a scroll position's rounding
      const left = scroller.scrollLeft > 1
      const right = scroller.scrollLeft < end - 1
      scroller.style.setProperty('--fade-l', left ? `${FADE}px` : '0px')
      scroller.style.setProperty('--fade-r', right ? `${FADE}px` : '0px')
    }
    measure()
    // The row's own box is as wide as what it holds (w-max)
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    observer.observe(inner)
    scroller.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', measure)
    }
  }, [])
  return (
    <div
      ref={scrollerRef}
      {...attributes}
      className={`overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,#000_var(--fade-l,0px),#000_calc(100%_-_var(--fade-r,0px)),transparent)] ${className}`}
    >
      <div ref={rowRef} className={`flex w-max ${row}`}>
        {children}
      </div>
    </div>
  )
}
