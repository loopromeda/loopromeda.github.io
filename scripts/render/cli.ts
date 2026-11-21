// pnpm render <what> [options]: renders a project file, a factory preset or
// the factory kit offline through the audio thread, and tells how loud it
// came out and what it cost (render.ts). --help lists the options.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { FACTORY_PRESETS } from '../../src/state/factory.ts'
import {
  readProjectFile,
  type Project,
  type Session,
} from '../../src/state/project.ts'
import { kitSession, factoryPreset, presetSession } from './phrase.ts'
import {
  decibels,
  loopSeconds,
  onlyTracks,
  render,
  withoutBuses,
  withoutMasterEffects,
} from './render.ts'
import { wavFile } from './wav.ts'

const HELP = `Usage: pnpm render <what> [options]

<what>  a project file (.json, as Projects exports it), a factory
        preset's name ("Saw Bass"), or "kit" for the factory kit

Options:
  --seconds <s>        how long (default: once through the longest loop)
  --from <bar>         start at this bar (the first is 1)
  --only <tracks>      hear only these tracks: numbers from 1, or names,
                       comma-separated ("2,Lead")
  --mute-bus <ids>     turn these buses down, comma-separated ("b,c")
  --dry                turn down every bus but A: no delay, no reverb
  --no-master          take the master's effects (its limiter) off
  --voices <n>         the voice pool (default 16)
  --out <file.wav>     write the master as a 32-bit float WAV
  --mp3 <file.mp3>     write it as an MP3 too (ffmpeg)
  --spectrogram <png>  draw its spectrogram (ffmpeg)
  --json               print the measurements as JSON
  --list               list the factory presets by category
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: 'string' },
    from: { type: 'string' },
    only: { type: 'string' },
    'mute-bus': { type: 'string' },
    dry: { type: 'boolean' },
    'no-master': { type: 'boolean' },
    voices: { type: 'string' },
    out: { type: 'string' },
    mp3: { type: 'string' },
    spectrogram: { type: 'string' },
    json: { type: 'boolean' },
    list: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

/** pnpm runs scripts from the package; paths are the caller's */
const here = process.env.INIT_CWD ?? process.cwd()
const at = (file: string) => path.resolve(here, file)

function fail(message: string): never {
  console.error(`render: ${message}`)
  process.exit(1)
}

function number(name: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) {
    fail(`--${name} wants a positive number, not "${text}"`)
  }
  return value
}

/** The session <what> names: a project file, a preset or the kit */
function sessionOf(what: string): Project {
  if (what.toLowerCase() === 'kit') return kitSession()
  if (what.endsWith('.json')) {
    try {
      return readProjectFile(JSON.parse(readFileSync(at(what), 'utf8')))
    } catch (error) {
      fail(`${what}: ${error instanceof Error ? error.message : error}`)
    }
  }
  const preset = factoryPreset(what)
  if (!preset) fail(`no project file or factory preset "${what}" (--list)`)
  return presetSession(preset)
}

/** The places of the tracks --only names */
function tracksNamed(session: Session, list: string): number[] {
  return list.split(',').map((given) => {
    const wanted = given.trim()
    const place = Number(wanted)
    if (Number.isInteger(place) && place >= 1) {
      if (place > session.tracks.length) fail(`no track ${place}`)
      return place - 1
    }
    const found = session.tracks.findIndex(
      (track) => track.name?.toLowerCase() === wanted.toLowerCase()
    )
    if (found < 0) fail(`no track named "${wanted}"`)
    return found
  })
}

function ffmpeg(args: string[]) {
  const run = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    {
      stdio: 'inherit',
    }
  )
  if (run.error) fail(`ffmpeg: ${run.error.message}`)
  if (run.status !== 0) fail('ffmpeg failed')
}

async function main() {
  if (values.help) {
    process.stdout.write(HELP)
    return
  }
  if (values.list) {
    for (const preset of FACTORY_PRESETS) {
      console.log(`${preset.category.padEnd(8)} ${preset.name}`)
    }
    return
  }
  const what = positionals[0]
  if (!what) fail('say what to render (--help)')

  const { name, ...picked } = sessionOf(what)
  let session: Session = picked
  if (values.only)
    session = onlyTracks(session, tracksNamed(session, values.only))
  const buses = values.dry
    ? session.mix.buses.map((bus) => bus.id).filter((id) => id !== 'a')
    : (values['mute-bus']?.split(',').map((id) => id.trim()) ?? [])
  if (buses.length) session = withoutBuses(session, buses)
  if (values['no-master']) session = withoutMasterEffects(session)

  const seconds = number('seconds', values.seconds) ?? loopSeconds(session)
  const rendered = await render(session, {
    seconds,
    voices: number('voices', values.voices),
    fromBar: number('from', values.from),
  })

  const wav = wavFile(rendered.left, rendered.right, rendered.sampleRate)
  let input = values.out && at(values.out)
  let scratch: string | undefined
  if (input) writeFileSync(input, wav)
  if ((values.mp3 || values.spectrogram) && !input) {
    scratch = mkdtempSync(path.join(tmpdir(), 'loopromeda-render-'))
    input = path.join(scratch, 'render.wav')
    writeFileSync(input, wav)
  }
  if (values.mp3) {
    ffmpeg(['-i', input!, '-c:a', 'libmp3lame', '-b:a', '192k', at(values.mp3)])
  }
  if (values.spectrogram) {
    ffmpeg([
      '-i',
      input!,
      '-lavfi',
      'showspectrumpic=s=1200x500:legend=1:fscale=log:color=intensity',
      at(values.spectrogram),
    ])
  }
  if (scratch) rmSync(scratch, { recursive: true, force: true })

  const db = (level: number) =>
    level > 0 ? decibels(level).toFixed(1) : '-inf'
  if (values.json) {
    const measured = { name, ...rendered, left: undefined, right: undefined }
    console.log(JSON.stringify(measured, null, 2))
    return
  }
  const share = (rendered.took / 1000 / rendered.seconds) * 100
  console.log(
    `${name}: ${rendered.seconds.toFixed(1)} s in ` +
      `${(rendered.took / 1000).toFixed(1)} s (${share.toFixed(1)}% of real ` +
      `time; a block ${rendered.meanBlock.toFixed(3)} ms on average, ` +
      `${rendered.worstBlock.toFixed(2)} ms at worst)`
  )
  console.log(
    `  master  peak ${db(rendered.peak)} dBFS, ` +
      `${rendered.lufs.toFixed(1)} LUFS integrated`
  )
  rendered.tracks.forEach((track, k) => {
    console.log(
      `  ${String(k + 1).padStart(2)} ${track.name.padEnd(18)} ` +
        `rms ${db(track.rms).padStart(6)}  peak ${db(track.peak).padStart(6)} dBFS`
    )
  })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
