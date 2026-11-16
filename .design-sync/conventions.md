# Building with Loopromeda's design system

Loopromeda is a polyphonic synthesizer for phones, played by touch: dark
by default, dense, every touch target 44 px. Everything here is on
`window.Loopromeda`: components, recipes (class strings), themes and
helpers, e.g. `const { ValueKnob, Switch, CARD, knobRow } = window.Loopromeda`.

## Setup

- `styles.css` paints the page: `html` and `body` take `--bg` and
  `--ink`, and the face is Recursive. The Default theme in the dark needs
  no wrapper.
- Another theme or the light mode: wrap the screen once in
  `<ThemeRoot theme="ember" appearance="light">`. Themes: `default`,
  `tidal`, `ember`, `orchard`, `neon`, `candy`, `arcade`; appearance
  `system`, `dark` or `light`. It writes the colour roles and `data-mode`
  on `<html>`, so one per page.
- Play surfaces (`Keys`, `Pads`, `KitPads`, `XyPad`) take
  `hands={hands}`, made once:
  `const [hands] = useState(() => new Hands({ noteOn() {}, noteOff() {}, slide() {}, bend() {} }))`,
  and a sized box (they draw from their measured size). `XyPad` also takes
  `watchGlides={() => () => {}}`.
- Build every screen inside a `<main>`: `Dropdown`'s list, `MoreMenu`'s
  menu, `Popover` and `SurfacePicker` place themselves within the nearest
  `<main>`, and stay invisible without one.
- `Popover` and `SurfacePicker` take `anchor`, a ref to the button they
  open from.
- A knob's value is a `ValueSpec`: `{ min, max, default, curve: 'linear' |
'exponential' | 'quadratic' | 'bipolar', step, unit: '' | '%' | 's' |
'Hz' | 'oct' | 'st' | 'dB' | 'pan' | ..., choices? }`. Two choices make
  it a switch.

## Styling idiom

Tailwind v4 utilities over the tokens, written `bg-(--token)`. Never a hex
colour, never a token not listed here.

| Family   | Use                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces | `bg-(--bg)` page, `bg-(--panel)` card, `bg-(--tile)` tile or popover, `bg-(--well)` a field                                     |
| Inks     | `text-(--ink-0)` chosen, `text-(--ink-100)`/`-200` text, `text-(--ink-300)` a row's name, `text-(--ink-400)`/`-500` dim, a hint |
| Lifts    | `bg-(--lift)` a control at rest, `bg-(--lift-2)` pressed or chosen, `ring-1 ring-(--lift-2)` a hairline                         |
| Roles    | `--accent` (go, focus, a note), `--secondary` (picked), `--modulator` (modulation); shares: `bg-(--accent)/20`                  |
| Statuses | `text-(--ok)`, `bg-(--warn)/20 text-(--warn-ink)`, `bg-(--danger)/20 text-(--danger-ink)`                                       |

Recipes are class strings to compose: `CARD` (a panel, `rounded-xl
bg-(--panel)`), `RAISED` (over cards, opaque), `BUTTON`, `BUTTON_CONFIRM`,
`BUTTON_DANGER`, `OPTION` (one of a row, chosen by `aria-pressed`),
`ICON_BUTTON`, `FIELD` (44 px); `SMALL_BUTTON`, `SMALL_OPTION`,
`SMALL_ICON_BUTTON`, `SMALL_FIELD` (28 px); `SECTION_HEADING` (11 px small
capitals); `knobRow(n)` (a grid of n knobs).

Two heights only: 44 px (`h-11`, rounded 10 px, `p-3` around) and 28 px
(`h-7`, rounded 6 px, `p-2.5` around). Labels `text-xs font-semibold
tracking-wider`; names typed or chosen `text-[13px]`; readouts
`font-mono`. Gaps `gap-1.5` to `gap-3`. Disabled `opacity-40`. Cards are
fills, no borders; rings mark states. A chain's colour for a knob's
`color`: `themeOf('default').dark.chains[0]` (A to D), `.modulator`.

## Where the truth lives

- `styles.css` and the `_ds_bundle.css` it imports: the tokens on `:root`
  (and `:root[data-mode='light']`) and every class that exists.
- `guidelines/design-system.md`: the tokens, recipes and components,
  explained.
- Each component's `<Name>.d.ts` (its props) and `<Name>.prompt.md`.

## Example

```jsx
const { CARD, SECTION_HEADING, ValueKnob, Switch, knobRow, themeOf } =
  window.Loopromeda
const A = themeOf('default').dark.chains[0]
const CUTOFF = {
  min: 20,
  max: 20000,
  default: 20000,
  curve: 'exponential',
  step: 0,
  unit: 'Hz',
}
const RESO = { min: 0, max: 1, default: 0, curve: 'linear', step: 0, unit: '%' }

function FilterPanel() {
  const [cutoff, setCutoff] = React.useState(1200)
  const [sync, setSync] = React.useState(true)
  return (
    <main className="p-4">
      <div className={`${CARD} flex w-80 flex-col gap-2 p-2.5`}>
        <div className="flex items-center justify-between px-1">
          <h3 className={SECTION_HEADING}>Filter</h3>
          <Switch checked={sync} onChange={setSync} label="Key sync" />
        </div>
        <div className={knobRow(2)}>
          <ValueKnob
            label="Cutoff"
            spec={CUTOFF}
            value={cutoff}
            onChange={setCutoff}
            color={A}
          />
          <ValueKnob label="Reso" spec={RESO} value={0.35} color={A} />
        </div>
      </div>
    </main>
  )
}
```
