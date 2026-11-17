# Loopromeda's design system

What a screen of Loopromeda is built from, in one place: the tokens and the
face, the recipes the controls share, and the components that stand without
the engine. It is the app's own code, gathered (`src/ds/index.ts`), not a
copy: the app imports the same parts from `src/ui` as ever, and a screen
drawn elsewhere (Claude Design) builds with the very components the app
ships.

## Three layers

Each is built on the one before.

### 1. Foundations

**Tokens** are CSS custom properties on `:root` (`src/index.css`), each
redefined under `:root[data-mode='light']`. A screen uses them through
Tailwind's arbitrary-property form, `bg-(--panel)`, `text-(--ink-400)`,
`ring-(--lift-2)`, never a raw colour.

| Family   | Tokens                                                                 | For                                                                  |
| -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Surfaces | `--bg`, `--panel`, `--tile`, `--key`, `--key-black`                    | the page; a card; a tile's face, a popover; a key or pad             |
| Inks     | `--ink` (the page's text), `--ink-0`, `--ink-100` … `--ink-600`        | brightest (chosen) to dimmest (a hint), zinc's ladder                |
| Lifts    | `--lift`, `--lift-2`, `--lift-3`, `--lift-4`, `--over`                 | a control at rest, pressed or chosen, rings, shares of `--over`      |
| Depths   | `--well`, `--under`, `--veil`, `--scrim`, `--backdrop`, `--shadow`     | a field's well, a seam, what lies over or under a view               |
| Roles    | `--accent`, `--secondary`, `--modulator`, `--on-colour`                | focus and the go button; what is picked; modulation; a label on them |
| Statuses | `--ok`, `--warn`, `--danger`, `--ok-ink`, `--warn-ink`, `--danger-ink` | what went well, what to mind, what deletes, and labels on each       |
| Keys     | `--key-held`, `--key-root`, `--key-black-held`, `--mod-ink`            | mixed from the accent and the modulator                              |

**The face** is Recursive, one variable font in two cuts: names in its sans
(`font-sans`), readouts in its Mono (`font-mono`, the same face with its
MONO axis turned up). Labels are semibold and spaced (`tracking-wider`), what
is named or typed is 13 px, a section's heading is 11 px small capitals
(`SECTION_HEADING`).

**Themes** (`src/ui/theme.ts`) give the colour roles their values in each
mode: the four chains' inks (A to D), the modulation colour, the accent and
the secondary. `THEME_IDS`: Default, Tidal, Ember and Orchard stand on the
neutral greys; Neon, Candy and Arcade, the pop themes, tint the surfaces
toward their colours too. Every value is held to the same checks
(`theme.test.ts`): readable on a tile and on a card, told apart from its
neighbours. `themeOf(id)[mode]` reads a theme's palette in JS (a chain's
ink for a knob's arc).

**ThemeRoot** (`src/ui/ThemeRoot.tsx`) puts a theme and an appearance
(`system`, `dark`, `light`) on the page: it sets the roles' variables and
`data-mode` on the document's root. Without it the page is the Default
theme in the dark, as `index.css` gives it.

**Layout variants** (`index.css`): `side:` (a panel beside the graph: 48 rem
wide, or a phone on its side), `upright:` (the rest), `short:` (under
30 rem tall), `tall:` (48 rem both ways) and `broad:` (the master's views,
a container at least 5:2).

### 2. Recipes

The controls' shared sizes and faces as class strings (`src/ui/controls.ts`),
so that controls side by side line up. Two heights only:

- **44 px** (`h-11`), the touch target: everything outside a panel, a
  panel's actions, a list's rows. Rounded at 10 px, labels at 12 px.
  `BUTTON`, `BUTTON_DANGER`, `BUTTON_CONFIRM`, `OPTION` (one of a row,
  chosen by `aria-pressed`), `OPTION_CELL`, `ICON_BUTTON`, `FIELD`.
- **28 px** (`h-7`): a panel's header row and the rows of a panel raised
  over the page. Rounded at 6 px, labels at 11 px, the touch still 44 px
  tall (`TALL_HIT`). `SMALL_BUTTON`, `SMALL_DANGER`, `SMALL_CONFIRM`,
  `SMALL_OPTION`, `SMALL_ICON_BUTTON`, `SMALL_FIELD`, `SMALL_SELECT`.
- The play surface's header stands its buttons at 36 px (`BAR_ICON_BUTTON`,
  its touch 44 px by `BAR_HIT`).

Surfaces: `CARD` (a panel's face, rounded 12 px), `RAISED` (the same face,
opaque, with a shadow and a faint ring, for what stands over the cards:
nothing under it is blurred, which a phone's GPU paid for every frame the
views under it were drawn). A card
keeps its contents 12 px (`p-3`) from its edges where its controls are
44 px, 10 px (`p-2.5`) where they are 28 px. Knobs stand in `knobRow(n)`,
a grid whose cells `KNOB_SIZE` fits: a knob is a sixth of its row's width
(less the gaps), or `--knob` (3 rem unless a panel sets it) at most.
`MUTE_FACE` and `SOLO_FACE` are a track's Mute (amber) and Solo (emerald).

Rules the recipes keep: disabled is 40% opaque everywhere; pressed or
chosen is `--lift-2`; cards and the controls on them are fills only, rings
belong to the graph's tiles and to states (picked, keyboard focus).

### 3. Components

Engine-free: each takes plain props and callbacks. Grouped by the
`@category` tag in each one's JSDoc.

| Category   | Components                                                                          |
| ---------- | ----------------------------------------------------------------------------------- |
| Controls   | `ValueKnob`, `Switch`, `IconButton`, `SmallIconButton`, `BarIconButton`, `Dropdown` |
| Overlays   | `Popover`, `MoreMenu`, `ConfirmDialog`                                              |
| Settings   | `SettingGroup`, `SettingRow`, `SwitchRow`, `ChoiceRow`                              |
| Layout     | `FadeRow`                                                                           |
| Navigation | `KeysNavigator`, `RowNavigator`                                                     |
| Play       | `Keys`, `Pads`, `KitPads`, `XyPad` (played through `Hands`)                         |
| Panels     | `OrnamentPanel`, `LanePicker`, `OutputCells`, `SurfacePicker`                       |
| Toolbar    | `SurfaceButton`, `SurfaceIcon`, `SettingsButton`, `UpdateButton`                    |
| Theme      | `ThemeRoot`                                                                         |

`ValueKnob` is the knob of the sound and the mix with no engine behind it:
a value in a `ValueSpec`'s range (`src/state/params.ts`: min, max, default,
curve, step, unit, choices), turned by a drag, finer with the finger off to
the side, the arrow keys, a double tap for the default. A spec of two
choices stands it upright as a switch. The app's `Knob`, `DepthKnob` and
`MixKnob` are its dial with the engine behind them, following the sound
instead of a value of their own.

The play surfaces take a `Hands` (`src/ui/hands.ts`), which holds who
plays which note: `new Hands(player)`, the player's `noteOn`, `noteOff`,
`slide` and `bend` the engine's in the app, no-ops for a picture. Their
geometry is exported beside them (`padGrid`, `kitGrid`, `padNote`,
`keysFit`, `MIDDLE_C`, `scaleSteps`, `SCALES`).

What stays out: anything that needs the engine or the session (the sound
editor and its tiles, the step grid, the mix, the transport, the sheets).
They are built of these parts; they are not parts themselves.

## Adding a component

1. Make it engine-free: props in, callbacks out (a knob of the engine's
   wraps a controlled one, as `Knob` wraps `ValueKnob`'s dial).
2. Give its export a JSDoc ending in `@category <Group>`, one of the
   groups above or a new one.
3. Export it from `src/ds/index.ts`, with the types its props name.
4. Author its stories in `.design-sync/previews/<Name>.tsx`, on the
   machine that syncs, and re-sync (`.design-sync/NOTES.md`).

## Building and syncing

- `pnpm build:ds` builds the package into `dist-ds/` (`vite.ds.config.ts`,
  lib mode; `tsconfig.ds.json` for its types): `index.js`, `styles.css`
  (the app's stylesheet, the fonts inlined, and `src/ds/ds.css`'s
  vocabulary: Tailwind's spacing, sizing, layout and type on its scale and
  every token as a fill, an ink, a line and a ring, built whether the app
  uses them or not) and the types.
- The Claude Design project is synced from it with the design-sync skill:
  its config, notes, conventions and stories are under `.design-sync/`,
  which stays on the machine that syncs (gitignored), not in the
  repository.
