import { useEffect, type ReactNode } from 'react'
import type { Engine } from '../engine/engine'
import { CARD } from './controls'
import { IconButton } from './IconButton'
import { Loudness } from './Dynamics'
import {
  Meters,
  Spectrogram,
  Spectrum,
  SpectrumRangePicker,
  Vectorscope,
} from './MasterViews'

/**
 * The master's views at size, opened from its panel (#/master): the
 * spectrum with its decades and levels named, the spectrogram with its
 * decades named and a line down each second, the two
 * sides against each other with their correlation, and the levels going
 * into the clip with the highest peak named (or out of the limiter, one
 * last on the master), and over them the loudness, in LUFS, and how deep
 * the spectral views reach. The stereo stands under the
 * spectrum, or, where the views are broad (a phone or a fold on its
 * side), at their right, as tall as both. Like the presets it covers
 * the editor and leaves what is played on below it, so the output can be
 * watched while it is played.
 */
export function MasterSheet({
  engine,
  onClose,
}: {
  engine: Engine
  onClose: () => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <section
      id="master"
      aria-labelledby="master-heading"
      className={`absolute inset-0 z-10 flex flex-col gap-2 p-3 ${CARD}`}
    >
      <div className="flex h-11 shrink-0 items-center justify-end gap-1.5">
        <h2
          id="master-heading"
          className="mr-auto min-w-0 truncate px-1 text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
        >
          Master
        </h2>
        <SpectrumRangePicker />
        <IconButton
          label="Close master"
          onClick={onClose}
          path="M5 5l8 8M13 5l-8 8"
        />
      </div>
      <div className="shrink-0 sm:max-w-[28rem]">
        <Loudness engine={engine} />
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
      <div className="min-h-0 flex-1 [container:master/size]">
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
    </section>
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
        className="pointer-events-none absolute top-1 right-1.5 text-[9px] font-medium tracking-widest text-zinc-600 uppercase"
      >
        {name}
      </span>
    </div>
  )
}
