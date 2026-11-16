# Design sync notes: Loopromeda

Repo-specific facts for the next sync of `@loopromeda/ds` to Claude Design
(project in `config.json`). Read this before running anything.

## Build

- The app has no library build of its own: `pnpm build:ds`
  (`vite.ds.config.ts`, then `tsc -p tsconfig.ds.json`) builds `dist-ds/`
  with a `package.json` named `@loopromeda/ds`, `index.js`, `styles.css`
  and `types/ds/index.d.ts`. Run it before the converter whenever
  `src/ui`, `src/ds`, `src/state`, `src/viz` or `index.css` changed; the
  converter reads `dist-ds/` only.
- The converter's package dir is `dist-ds/` (it walks up from `entry` to
  the first `package.json` with a name), so `srcDir` and every path in
  `componentSrcMap` are relative to `dist-ds/` (`../src/ui/...`).
- From the repo root:
  `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --out ./ds-bundle`,
  then `node .ds-sync/package-validate.mjs ./ds-bundle`; the final build
  of a session is the driver (`resync.mjs`, the same flags, plus
  `--remote .design-sync/.cache/remote-sync.json` on a re-sync).
- Groups come from each component's JSDoc `@category` tag (the source
  path's `ui` segment says nothing). A new component without one lands in
  a generic group.
- `componentSrcMap` pins the components that share a file
  (`IconButton.tsx`'s three, `SettingRows.tsx`'s four, `SurfaceButton.tsx`'s
  two, `Knob.tsx`'s ValueKnob) and drops `Hands` (a class, exported for
  the play surfaces, not a component).
- `dtsPropsFor` holds hand-written props for the 12 components whose
  props name types the extractor left unresolved (`ValueSpec`, `MenuItem`,
  `RefObject`, `LaneGroup`/`LaneKnob`/`KnobLane`, `Ornament`,
  `MasterViewKind`, `SurfaceSettings`, `PadGrid`, `GlideReport`): their
  shapes are spelled out inline. `hands: Hands` stays named, with a
  comment saying how to make one.
- Tailwind v4 builds only the classes it reads in the repo. `src/ds/ds.css`
  adds a vocabulary with `@source inline()` (Tailwind's spacing, sizing,
  layout and type, and every token as `bg`/`text`/`border`/`ring`), so a
  screen built in Claude Design finds the classes it writes. A class
  outside both is absent and renders unstyled. Check a preview with
  `node .design-sync/classcheck.mjs <files>` (reads `dist-ds/styles.css`).
- Fonts: Recursive is inlined into `styles.css` as data URIs by the Vite
  lib build; the converter leaves `data:` URLs in place, so `fonts/` is
  empty and no `[FONT_MISSING]` fires.

## Previews

- The card's frame is `previews/card.module.css`, imported by every
  preview (a `*.module.css` compiles to `_preview/<Name>.css`, which the
  card links; a plain `.css` import is dropped): the page on `--bg` and
  `--ink` in place of the template's white, cells a `--lift-2` hairline,
  `overflow: visible`, their names in `--ink-500`. `html body` outranks
  the template's inline `body`, `.ds-grid` and `.ds-cell` rules
  (`.ds-grid.ds-col` keeps its one column).
- Claude Design does not always draw a card at its declared viewport:
  opened from the project's files it fills its pane (about 900 px wide in a
  1245 px window, taller than 768 on a large screen), and the file list's
  thumbnail draws it on a large page (ValueKnob's spill there matched
  1280 x 800). So the frame holds a card at any size, from 700 px wide:
  - The grid's columns are never narrower than a fixed-width story: Stage's
    `min` (or a Card's `data-ds-min`) is the width its cell needs (the
    story's and the cell's 26 px: 346 for a 20 rem card, 386 for a 360 px
    keyboard or pad grid), and `card.module.css` sets `--ds-min` for each
    value it lists (326, 346, 386; a new value needs its rule there).
    Without it the template's `minmax(320px, 1fr)` cut a 20 rem card by up
    to 13 px at 720, 1040 and 1380 px, a 360 px keyboard by up to 53.
  - Under the app's `tall:` (48 rem both ways) a knob row's columns are
    9 rem, wider than the 20 rem cards the stories stand in: the frame puts
    back the phone's columns there, so a story is the phone's layout
    whatever the card's size.
  - Under 700 px the wide play surfaces (Keys' TwoOctaves 640 px,
    XyPad's 600) are wider than the page.

  Check with `node .design-sync/fit.mjs ds-bundle <port> --sweep`.

- Stories stand in an unboxed `Stage`, `w-fit max-w-full`: a boxed one
  (a padded `bg-(--bg)` card, as the first sync had) is wider than its
  story and the cell cut it. `<Stage wide>` sets `data-ds-wide`, and the
  frame spans that cell across its card's row (Keys' TwoOctaves, Pads'
  MinorPentatonic, ValueKnob's Sizes).
- Every card declares a viewport (`overrides.<Name>.viewport`) its content
  fits in whole: it is captured and graded there, and where Claude Design
  draws a card at its viewport it scales it into 728 x 500 px (never
  enlarged), past its viewport only on a hover scroll. Grid cards that fit
  728 wide are 728 x their height; wider grids 900 or 1120 (three
  columns of a 346 px `min` need 1118);
  column cards (`cardMode: "column"`, one story a row) 728. No viewport
  may be 768 px or more both ways: the app's `tall:` variant fires there
  (knobRow's columns 9 rem) and the story is no longer the app's phone
  layout; `side:` fires at 768 wide alone. Measure with
  `node .design-sync/fit.mjs ds-bundle <port>` (exits 1 on a card that
  scrolls or spills; `--sweep` also draws every grid and column card from
  700 to 1600 px wide, 700 and 900 tall). A popover's own list scrolls
  where the page is too short for it, which `fit.mjs` does not see:
  Popover is 620 tall so the Transport popover shows its last loop.
- The converter's `.review.html` frames every card 340 px tall:
  `node .design-sync/review.mjs` rewrites it after each build to show
  each card as Claude Design does (its viewport, its scale, on the DS
  page).
- The play surfaces' roots are `absolute inset-0`, drawn from their box:
  each story stands one in `<div className="relative" style={{ width,
height }}>` and works out its octaves or grid from that size with the
  exported helpers, as PlaySurface does (`keysFit`, `padGrid` with
  `padNote` and `scaleSteps`, `kitGrid(w, h, 16)`). `new Hands(player)`
  once per story in `useState`, a no-op player; XyPad's `watchGlides`
  `() => () => {}`.
- KitPads' names wrap mid-word (`line-clamp-2 break-words`) on pads under
  about 50 px: its 8x2 story is 560 px wide.
- Not captured (they need a finger down): held keys, struck pads, the XY
  pad's rings, readouts and glide dots; dragging a navigator's frame,
  panning a FadeRow, focus rings, a Dropdown's open list, and the busy
  states after a click ("Checking…", "Measuring…").
- A card mounts every export of a preview on one page. ThemeRoot writes
  to `document.documentElement`, so its theme cells would all show the
  last one mounted: its card is `cardMode: "single"` on `Themes`, all
  seven themes in one grid, each panel scoping its theme with inline
  `--accent`, `--secondary`, `--modulator` and the surfaces
  (`surfacesOf(theme, 'dark')`, its `page` as `--bg`). The other cells
  (one theme each) are graded alone (`?story=`). A scoped panel does not
  reach what index.css derives on `:root` (`--key-held`, `--key-root`,
  `--key-black-held`, `--key-black-edge`, `--mod-ink`, `--scrim`), so the
  sample avoids held keys and root marks.
- Overlays: Dropdown, MoreMenu, Popover and ConfirmDialog are
  `cardMode: "single"` with a viewport and a `primaryStory` (their open
  state). A viewport change trips `[CONFIG_STALE]` on a targeted rebuild:
  it needs a full `package-build.mjs`.
- `usePlacement` (`src/ui/placement.ts`) places a list, a menu or a
  popover inside the nearest `<main>` and does nothing without one: they
  stay `invisible`. Open-state stories stand their button in a `<main>`,
  as the app does (and the conventions tell the design agent so).
- The card template gives `.ds-single` and `.ds-cell`
  `transform: translateZ(0)`, a containing block for `position: fixed`: a
  `fixed inset-0` stage collapses to 0 px, and a fixed, unportaled
  Popover lands one body padding (24 px) off under `?story=`. The stories
  size their `<main>` to `calc(100vh - 2 × body padding)` read at mount,
  and render Popover through `createPortal(…, document.body)`. Dropdown
  and MoreMenu portal themselves; ConfirmDialog is in the top layer.
- SurfacePicker (a fixed Popover) is `cardMode: "single"` with no
  viewport: its grades were keyed at the default 900x700, and a viewport
  (even `"900x700"` written out) re-keys and clears them. Its stories use
  a `Page` that, in a layout effect, translates itself to the viewport's
  corner (from its own `getBoundingClientRect()`), so it becomes the
  containing block, then mounts a sized `<main>` with the anchor and the
  popover. Works in single mode only.
- OrnamentPanel is `cardMode: "column"`: under about 31 rem its kinds row
  pans the chosen Trill or Arp out of view. LanePicker is
  `absolute inset-0`, filling a `relative` box of a set height.
- Composed by hand, not DS exports: OutputCells' `mutes` slot (the app's
  MutesCell needs the engine) rebuilt from KNOB_COLUMN, KNOB_SIZE,
  KNOB_LABEL, KNOB_READOUT, MUTE_FACE and SOLO_FACE; the status line, the
  project button and the tab rail's pane switch around SettingsButton and
  UpdateButton, copied from StatusBar.tsx and SoundEditor.tsx. LanePicker's
  lane groups are the Acid Bass preset's, through `laneGroups`.
- By design in captures: ConfirmDialog's Cancel shows the focus ring
  (autoFocus), MoreMenu's first item is lit (focused as it opens), and
  the dialog's backdrop covers the 24 px body margin as a grey frame.
- Generic components (`ChoiceRow<T>`, `Dropdown<T>`) emit an undeclared
  `T`: their `dtsPropsFor` puts `string | number` in its place. FadeRow's
  spread div attributes are listed by hand there too.
- `classcheck.mjs` reads `className="..."` and ``className={`...`}``
  only: classes in a ternary are checked by hand.
- `pnpm exec prettier` and `eslint` run from the repo root: give them
  `./.design-sync/...` paths.
- ValueKnob's size is a sixth of its row or `--knob` (3 rem), whichever
  is less: a story showing a larger `--knob` needs a row wide enough
  (Sizes: `wide`, on an 1120 px card).

## Environment

- Playwright 1.64.0 in `.ds-sync/node_modules`, matching the cached
  `chromium-1248` in `~/Library/Caches/ms-playwright` (1.65.x wants
  build 1255, not cached).
- npm's install-scripts policy blocks esbuild's postinstall in
  `.ds-sync/`; esbuild works anyway.

## Known render warns

- None. The validator measures every grid card at a 680 px grid, whatever
  its viewport: the second sync's `[GRID_OVERFLOW]` on ValueKnob,
  OutputCells, Keys and Pads (their columns narrower there than their
  stories) went with the frame's `--ds-min`, which stands them one a row
  at that width (2026-11-17). A `[GRID_OVERFLOW]` now is a fixed-width
  story without its `min`.

## Re-sync risks

- `dtsPropsFor` copies type shapes by hand: when `ValueSpec`, `Ornament`,
  `SurfaceSettings`, the lane types, `MenuItem` or a scale id changes in
  `src/`, the contract the design agent reads goes stale silently. Diff
  them against `src/state/params.ts`, `src/dsp/ornament.ts`,
  `src/state/surface.ts`, `src/state/lanes.ts`, `src/state/song.ts` and
  `src/ui/MoreMenu.tsx`.
- KitPads' stories copy the factory kit's pad names from
  `src/state/factory.ts` (FACTORY_KIT is not a DS export): a renamed pad
  leaves the story showing the old name.
- Markup copied into stories from app files outside the DS (the Mute and
  Solo cell from Mutes.tsx, the status line from StatusBar.tsx, the pane
  switch from SoundEditor.tsx) drifts when those files change.
- `card.module.css` matches `knobRow`'s classes as written
  (`tall:grid-cols-[repeat(N,9rem)]`, `src/ui/controls.ts`): a changed
  width or a ninth column leaves the cards on the tall layout again, its
  knob rows wider than their cards. `fit.mjs --sweep` at 900 tall shows it.
- A new story of a fixed width needs Stage's `min` (and its value's rule in
  `card.module.css` when it is a new one), or its card's columns cut it at
  some widths: `fit.mjs --sweep` lists them.
- `dist-ds/` is not rebuilt by the converter: a stale one ships old
  components with fresh previews.
- The playwright pin follows the cached chromium; a cleared cache or a
  new playwright needs the pair matched again.
- The `ds.css` safelist is a fixed list: a screen's class beyond it (a
  colour token's share not listed, a size past the scale) is absent.
