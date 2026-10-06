# Plan: Chrithmath V2 — review of ChrithmathTheme.md plus the plan-view redesign

## Motivation

`plans/ChrithmathTheme.md` specified a third map theme, "Chrithmath", and the work landed:
a 2,172-line generator, a 285,498-byte theme JSON, an 8,168-byte menu sidecar, three
registrations, a 36-level + 12-variant maps catalog override, and 16 new tests.
`npm run check` is green — lint, typecheck, sim-boundary, **2,051 tests across 117 files** —
and every mechanical claim in the original plan verifies independently (§2).

The art does not hold up. Two classes of problem, in order of severity:

1. **A perspective violation that affects every tower and every enemy.** All 8 towers and
   all 9 enemies are drawn as side elevations or character portraits, but the renderer
   rotates each sprite by a live angle. A gingerbread man drawn with its head at −y and its
   legs at +y does not re-aim when the renderer rotates it 40° — it tips over. This is a
   renderer constraint that the plan acknowledged in one clause (`plans/ChrithmathTheme.md`
   §4, "Barrel on +X at 0° per the sprite contract") and then violated everywhere.
2. **A ground shadow painted inside each sprite**, which the renderer's rotation therefore
   carries around with the body. The shadow turns edge-on as the unit turns and reads as a
   dark smear rather than a shadow. The defect is byte-identical in the shipped Aftermath
   theme, because both generators share the same helper.

Everything else found is ordinary art and layout polish: two towers that do not read as
their own type, four declared enemy colors that disagree with the sprite beside them, a
moon that renders as an eclipse, spawn frames clipped by their own viewBox, three of four
chapels hidden behind node markers, two shopfronts standing in the surf, and a set of
region tiles that deliver three palettes of one abstract construction rather than the
footprints, cracks and candle specks the plan promised.

This document records the review, then the plan. It supersedes nothing in
`ChrithmathTheme.md`; it corrects it.

## 1. Scope

| In scope | Out of scope |
|---|---|
| `src/render/themes/scripts/gen_chrithmath_theme.py` — the 17 sprite draw functions, the shadow helpers, `contact_sheet`, `validate_theme` | Tiles, bases, site art, spawns, region maps, menu background composition — none of these rotate (§4.3) |
| `src/render/themes/scripts/gen_aftermath_theme.py` — shadow removal only | Aftermath's sprites, palette, or composition |
| `src/render/themes/data/chrithmath.json`, `the-aftermath.json` — regenerated output | `maps` catalog override, all seeds, all region names |
| `src/render/themes/MapThemeHowTo.md`, `TECHNICAL.md` — the perspective and shadow rules | Renderer code — no change to `TowerManager`, `EnemyManager`, or the symbol contract |
| `tests/unit/map-theme.test.ts` — extend the existing shadow describe, add the frame-bounds and walk-cycle cases | Snapshot tests — none exist, so no golden files to update |

## 2. How each claim was verified

Nothing below is taken from the plan's own prose. Each was re-derived.

| Claim | Method | Result |
|---|---|---|
| Committed JSON matches the generator | `build_theme()` deep-compared against `chrithmath.json` in memory | identical on all 9 top-level keys |
| Reruns are byte-stable | `write_theme()`'s collapse passes re-run against the file text | byte-identical |
| `gen_theme_images.py` regenerates end to end | its `patch_line_values` path replayed in memory for all 3 themes | all 3 round-trip byte-identically |
| Sidecars equal their theme's `menuBackground` | both files compared, plus the exact `json.dumps(..., indent=2)` text | all 3 equal, byte-for-byte |
| §7 catalog triplets mirror Aftermath | 36 × `(width, height, regionId, level, style)` and 12 variant tuples compared | 36/36 and 12/12 match |
| §11.2 renderer-fidelity hashes mirror the renderer | `tileVariantIndex` and `progressiveTileRotation` extracted from `tileArt.ts:29-39` and `ProgressiveMap.ts:168-171`, evaluated in node over 224 seed/x/y samples, compared with the Python twins | 224/224 match |
| §3 palette table | all fills re-measured with the generator's own `hex_luminance` | Yule span 0.732 / min step 0.225; Sunspice 0.635 / 0.129; Icon 0.730 / 0.153; all path margins ≥ 0.032 |
| Tile seams | 45 tiles rasterized at 4 rotations, 12 random variants per kind at random rotations, over a magenta field | no cell-edge discontinuity in any of the 3 regions |
| Node marker collisions | 120 pairwise node distances per region against the marker's 34-unit radius | 0 pairs under 76 units in all 3 regions |
| Sprite and site bounds | per-primitive bounding boxes with `translate`/`rotate` group transforms applied | the overshoots in D6, D7, D8 |
| Aesthetics and perspective | headless Chrome rasterization of every frame at 27/54/96/300px, of 8-rotation strips, of stitched 12×8 boards, and of the 3 region maps with the marker overlay | see §5, §6 |
| Test count claimed in `TECHNICAL.md` | `npm run check` | 2,051 / 117, matches |

## 3. Conformance with `ChrithmathTheme.md`

Every step of §11 landed, and every §10 documentation row is present. Three items are
incomplete or wrong:

- **§11.6 owes a sidecar-equality assertion, and adding it introduced a regeneration trap.**
  See D1.
- **§3's character list is only half delivered.** The *tones* landed (path is packed snow
  in tree shadow, Sunspice has no snow, Icon Snows is deep blue with gold). The *motifs*
  did not: no footprint stamps, no cracked earth, no candle specks anywhere. See A1.
- **§4/§5 assumed a sprite contract whose perspective half was never stated.** See §4.

## 4. The perspective contract

### 4.1 What the renderer does

| Fact | Where |
|---|---|
| A tower's whole sprite rotates by `tower.angle` | `TowerManager.ts:263` — `rotate(${(tower.angle||0)*180/π}, 13.5, 13.5)` |
| `tower.angle` starts at −45° | `Tower.ts:425` — `this.angle = -Math.PI / 4` |
| and is set by `atan2` toward the live target on every shot | `Tower.ts:1015`; the fixed-aim branch at `:923-925` |
| `railgun` has `fixedAim`, so 4 headings | `towers.json:24` |
| **`sturdyWall` has `range: 0` and no `fixedAim`, so it never fires and stays at −45° for the whole run** | `towers.json:29` + `Tower.ts:1015` never reached |
| An enemy's whole sprite rotates by its movement angle, mirrored when `cos(angle) < 0` | `EnemyManager.ts:106-116` |
| Sprite boxes: towers `viewBox="-16 -16 32 32"`, enemies `"-1 -1 2 2"`, both `<use>` at 27px | `useSvgStaticContent.ts:174`, `:145/153/162`, `types.ts:3-5` |

So the exposure is: six towers sweeping a continuous 360°, one at 4 fixed headings, one
pinned at −45°, and nine enemies sweeping 360° by movement direction.

### 4.2 What the art does

Every tower and every enemy in Chrithmath is a side elevation or a character portrait:

| Sprite | World-up cue that breaks under rotation |
|---|---|
| `basic` Gingerbread Barrage | head circle at −y, icing dots as a face, legs at +y |
| `ice` Candy Cane Coil | cane hook rising to −y out of a slab at +y |
| `sniper` The Nutcracker | hat triangle at −y, jaw at +y, standing on a body |
| `cannon` Marzipan Mortar | ball perched on a crate, tube implied upward |
| `lightning` Cotton Candy Cloud | floss head at −y on a stick hanging to +y |
| `railgun` Peppermint Railgun | horizontal barrel over a breech block, read as a side profile |
| `sturdyWall` Stollen Bastion | a loaf with icing on its upper face |
| `shotgunTank` Jimmie Blaster | a crate seen from the front with buttons in a row |
| `minion` Tin Soldier | helmet at −y, legs at ±y around a body |
| `runner` All Aboard | wheels at +y under a boiler |
| `tank` Grizzly Ted | ears at −y, snout at +x |
| `shielded` Marble's the Man | spiral highlight reading as a lit top surface |
| `healer` Music Box Mender | lid band at −y over a box |
| `boss` Jack in the Box | lid hinged along the box's −y edge |
| `flyer` Paper Kite | spar cross reading as a vertical mast |
| `jet` Yo-Yo | string running up to +y |
| `aegis` Roly-Poly | band across the −y face of a bowl |

The shipped themes are the counter-example. `default-map-theme.json`'s `basic` tower is
`<circle r="8">` + an arc + `<line x1="8" y1="0" x2="16" y2="0">` — a plan view with a
barrel on +X. Its `minion` enemy is a single `<circle r="0.37">`. Aftermath follows the
same convention in a richer form: radially arranged legs with a forward head polygon on +X
(`gen_aftermath_theme.py:736-773`), which is why its art still reads when rotated even
though its pixels are not rotation-invariant.

**The rule, which `MapThemeHowTo.md:173` never states:** a sprite that the renderer rotates
must read as a plan view. Its body must be radially coherent about the sprite centre, its
only meaningful axis is the facing axis (+X before rotation), and it must contain no cue
that implies gravity — no standing figure, no feet line, no horizon, no light direction.
Facing is expressed by one mark on +X and nothing else.

### 4.3 What is exempt

`MapSiteLayer.ts` and `SpawnManager.ts` contain no `transform`, `angle` or `rotate` at all.
Site art, spawn states, base art, region map images and the menu background are never
rotated and are therefore exempt. Tiles rotate in 90° steps and already obey the
low-opacity edge-smear convention (`MapThemeHowTo.md:203`). **Scope is exactly the 17
sprite draw functions.**

### 4.4 Why not a fourth theme

Top-down is a renderer constraint, not a style preference, so a new theme faces the
identical constraint. A fourth world would cost a ~2,400-line generator, another ~285 KB
data file plus a sidecar, three registrations, three test mirrors, ~300 KB more bundle,
and a fourth card in a rail that already overflows at three (§7, D12). Meanwhile every
non-sprite asset in this theme — 45 tiles, 3 bases, 10 site images, 3 spawn states,
3 region maps, the menu background, the maps override and its 48 seeds — is correct and
reusable, as is the entire frame contract.

The concepts survive plan view intact: a gingerbread *cookie* seen from above, a
candy-cane *coil* as concentric stripes, a mortar *tube* on a round base, a Stollen
*slab* as a rectangle, a tin soldier's *helmet* disc.

**Decision: redraw in place. No fourth theme.**

## 5. Defects

### D1 — The generator deadlocks on any menu-background edit

`gen_chrithmath_theme.py:1807` calls `verify_sidecar_matches_theme()` inside
`validate_theme()`, which `main()` runs at `:2164` *before* `write_theme()` at `:2165`.
Change `chrithmath_menu_background()` and the run `SystemExit`s against the stale on-disk
sidecar and never writes the theme. The only escape is running `gen_theme_images.py`
first — an ordering stated nowhere, and `MapThemeHowTo.md` asserts the opposite ("a theme
generator writes the sidecar"). `gen_aftermath_theme.py` has no such check, so this trap
is new. Fix: write the sidecar from `gen_chrithmath_theme.py` (it already holds the
`menuBackground`) with `gen_theme_images.py` as the cross-check, or drop the pre-write
equality check and document the required order.

### D2 — The moon renders as an eclipse

`menu_background_art.py:201` draws the crescent's bite circle at `opacity="0.85"`, so
0.15 of the white limb and the sky bleed through and a hard grey crescent rim appears
between the dark disc and the white moon. Behind the moon the background is flat `#161e2c`,
so `opacity="1"` is the entire fix.

### D3 — Both non-closed spawn frames are clipped by their own viewBox

The toy-box lid is `rect(5, 9, 26, 7)` rotated about its left end:

| Frame | Transform | Ink extent | Result |
|---|---|---|---|
| `transition` | `rotate(-38 5 12.5)` | y to −6.3 | lid sliced flat by the top edge |
| `open` | `translate(-9 -7) rotate(-65 5 12.5)` | y to −19.5, x to −4.5 | ~90% of the lid off-frame; only an unidentifiable red sliver at the left edge survives |

`validate_theme` calls only `assert_paint` on spawns (`:1857-1858`); `assert_boxed_art` is
applied to site art only (`:1889-1897`). Fix both the art (≤ −30° about a hinge inside the
box, or drop the translate) and the validator.

### D4 — Two towers do not read as their own type

- `marzipan_mortar` (`:436-451`): the tube is entirely hidden behind the ball, so it reads
  as a cream disc with a brown ring on a crate — a coconut, not a mortar. The discharge
  flash floats unattached at `(8.6, -2.6)`.
- `jimmie_blaster` (`:517-539`): the muzzle `rect(8.4, -2.2, 4.4, 4.4)` sits behind the
  `INK` throat rect and reads as a light-blue tile floating free of the crate. The three
  jimmies read as buttons.

### D5 — The boss's lid is clipped at the peak of its attack

`jack_in_the_box` (`:732`) rotates the lid −70° about `(-0.5, -0.35)`, putting its far
corner at y = −1.32 inside a `viewBox="-1 -1 2 2"`. Chrome clips symbol overflow, so the
tip is cut on attack frame 1.

### D6 — Enemies are drawn at ~0.7× the scale the copied helpers assume

One root cause behind four symptoms. Bodies measured on the board at the real 27px `<use>`
against a 2-unit viewBox, shadow excluded:

| id | Chrithmath | Aftermath | id | Chrithmath | Aftermath |
|---|---|---|---|---|---|
| `minion` | 10.7 × 14.7 px | 15.1 × 14.4 px | `boss` | 15.1 × 16.8 px | 23.8 × 15.7 px |
| `runner` | 13.6 × 9.3 px | 10.2 × 2.8 px | `flyer` | 8.1 × 14.8 px | 8.2 × 15.0 px |
| `tank` | 11.4 × 14.7 px | 13.7 × 17.0 px | `jet` | 8.9 × 14.4 px | 14.2 × 5.8 px |
| `shielded` | 9.2 × 8.1 px | 16.2 × 9.6 px | `aegis` | 10.1 × 9.2 px | 10.3 × 9.6 px |
| `healer` | 10.0 × 14.7 px | 13.2 × 8.2 px | | | |

Consequences:

- **The boss fills 62% of its viewBox against Aftermath's 88%**, contradicting the plan's
  own rule at §5 that "the boss fills more of the viewBox rather than being a larger
  element".
- **The copied shadow constant no longer matches** (§6): the same 12.42px ellipse is 1.09×
  to 1.35× the body width for `minion`, `tank`, `shielded` and `healer`, against
  Aftermath's 0.77× to 0.94×.
- **`reach_arm` (`:644-648`) is an Aftermath-less invention** at 0.9 and 1.1 units — 1.5× to
  2× a body width. It pushes attack ink to +0.29 (`minion`), +0.57 (`tank`) and +0.38
  (`boss`) past the ±1 box, so the `<symbol>` viewBox rescales the whole sprite by
  `2 / (2 + over)` mid-attack — the tank shrinks to 78% and drifts right. No Aftermath
  enemy exceeds +0.05.
- `sturdyWall`'s loaf was 22.8 units wide against Aftermath's 27.5, and walls are the
  most-placed tower. (Measured before the shadow removal; the 23.8 and 33.3 figures an
  earlier pass of this document quoted included each sprite's baked contact shadow, which
  inflated the width by 21–24 units and made Aftermath's wall appear to exceed its own
  `viewBox`. It does not.)

### D7 — Frame ink exceeds its clip box

`sniper` +1.0 and `railgun` +0.8 past ±16 on the rest frame; `ice`'s discharge muzzle and
`jimmie_blaster`'s shower push to +0.8. Because a `<symbol>` viewBox scales to fit rather
than clipping, an overshooting frame silently rescales the whole sprite, so the tower
breathes in size between frames.

### D8 — All four small chapels on the Icon Snows map sit under a node marker

`region_map_art.py:1260-1261` places them at `(268,214)`, `(716,214)`, `(288,436)` and
`(608,436)`; markers P5, P9, P1 and P12 sit at `(300,260)`, `(760,250)`, `(320,480)` and
`(640,470)` — gap 0.0px in every case, so each marker covers its chapel. The
`birds_unit(500, 80, …)` is likewise hidden behind marker 6. The buildings were placed
without checking node positions.

### D9 — Two Sunspice shopfronts stand in the surf

`region_map_art.py:1227-1231` puts all three `shop_front` bottoms at y = 652. The sea
crest is `660 + 12·sin(2πx/300)`, which dips to 648.0–652.2 across shops 2 and 3, so their
bases are below the local waterline.

### D10 — Two ellipses read as flying saucers

- `gen_chrithmath_theme.py:1314` — a 42 × 13 `#e8a860` α0.28 ellipse above the Sunspice
  veranda roof, reading as a solid disc hovering over the house.
- `region_map_art.py:1240` — a 30 × 10 `#c45a48` α0.18 ellipse beside the lighthouse
  lantern, reading as a solid disc.

Both were meant as light. A plan view has no light direction, so a "glow" ellipse is
indefensible in any sprite that rotates — and neither of these does; the correct fix is a
soft radial wash or nothing at all.

### D11 — Four declared enemy colors disagree with the sprite beside them

`ENEMY_META` (`:782-792`) versus the draw functions:

| id | declared | painted |
|---|---|---|
| `runner` | `#e8b04a` amber | `TOY_RED #c84040` |
| `flyer` | `#e8e0c0` cream | `CANE_RED #d04848` |
| `jet` | `#70c0a0` green | `TOY_GOLD #e0b040` + `JIMMY_RED` |
| `aegis` | `#c0c8d0` grey | `TOY_RED` + `ICING` |

`color` and `shape` drive `TextEnemyManager.ts:21-27` and `StatsPanel.vue:123,127`, so the
minimap glyph and the HP bar show one creature and the board shows another.

### D12 — Five of nine enemies have no walk cycle

`runner`, `shielded`, `boss`, `flyer` and `jet` ignore `pose` entirely; their 8 frames
differ only by `WALK_BOB` (±0.04 units = ±2% of the viewBox, invisible at 27px). Aftermath
has 2 such enemies, the default theme 0.

### D13 — The third world card can overflow the menu

`.main-menu` is `justify-content: center` with `overflow-y: auto` (`MainMenu.vue:203-208`).
The rail is a flex column of `min-height: 132px` cards plus 12px gaps, so 2 worlds cost
288px and 3 cost 420px. On a short viewport, centered overflow clips the top of the menu
unreachably. Fix with `justify-content: safe center`.

## 6. The shadow defect

### 6.1 What it is

`enemy_frame` (`gen_chrithmath_theme.py:609-620`) prepends
`ellipse(0, 0.18, 0.46, 0.12, "#120e0c", opacity="0.4")` to every ground frame and
`ellipse(0, 0.55, 0.22, 0.05, "#120e0c", opacity="0.28")` to every airborne one. Each
tower frame prepends `contact_shadow(...)` (`:310-312`). Because `TowerManager.ts:263` and
`EnemyManager.ts:106-116` rotate the whole `<use>`, these ellipses rotate with the body:
turn 90° and a 12.4px-wide shadow becomes 3.2px-wide and 12.4px tall, lying on its side.

Per theme: **158 shadow ellipses** — 32 tower (4 per tower: 3 `animation` frames plus the
`walking` record, which reuses the rest frame, at 8 sizes, α0.38) and 126 enemy (84 ground +
42 airborne). `default-map-theme.json` has **zero**. Nine `#120e0c` strokes also remain in
`the-aftermath.json`'s region `mapImage` and `menuBackground` — road and route strokes from
`region_map_art.py` and `menu_background_art.py`, which are never rotated and are exempt.

### 6.2 Decision

`tests/unit/map-theme.test.ts:1164` is already named *"Entity symbol frames carry no
injected ground shadow"* and asserts the renderer injects nothing. Removing the baked
shadows extends that existing decision to its conclusion: nothing draws a ground shadow.
Circling the ellipse was considered and rejected — it fixes rotation but keeps a cue that a
plan view does not need, and the reference theme already ships without one.

**Altitude must be re-expressed.** `flyingHeight` is sim-side only; nothing under
`src/render/` offsets position by it, so the sprite is the only channel. The three airborne
types carry distinct heights (`enemies.json:39-41`): `flyer: 2`, `aegis: 3`, `jet: 5`. Draw
them at `1 − height/12` → **0.83, 0.75, 0.58** and keep the existing `lift = -0.12`. In a
plan view a smaller sprite reads as further from the camera, which is the standard
convention and is now honest about the actual heights.

**Aftermath is in scope for the shadow only.** Its helper is byte-identical, so the same
rotation defect is present; `gen_aftermath_theme.py` gets the same one-line removal and a
regeneration. Nothing else in that theme changes.

## 7. Aesthetic findings

**A1 — The three regions are one construction in three palettes.** `plans/ChrithmathTheme.md`
§3 promised footprint stamps on the Yule path, cracked earth on Sunspice terrain2 and gold
candle specks on Icon Snows terrain4. None exist: every tile is field fill + three interior
drifts + a stain + a pebble + three edge-crossing smears. Snow reads as bubble wrap, sand as
stained cardboard. There is headroom — tiles measure 742–907 bytes against
`TILE_BYTE_MAX = 1200` (Aftermath: 672–952), so 5–6px motifs fit inside the budget and the
≥2px survival rule at `MapThemeHowTo.md:204`.

**A2 — The two snow regions are hard to tell apart.** Yule (`#eef3f8 … #5c7186`) and Icon
Snows (`#dfe6f2 … #39435c`) are roughly 10% apart on the same neutral blue. The §3 palette
table is declared settled, so this is recorded, not changed.

**A3 — `sturdyWall` is small for its role.** Its loaf was 22.8 units wide against Aftermath's
27.5. Note that a `<symbol>` viewBox scales to fit, so a tower drawn wider than ±16 does not
render larger — it renders smaller with its ends clipped, which is why the target is a fill
just inside the box rather than over it.
A wall is the most-placed tower and should read as a wall line at any angle.

**A4 — The Sunspice base is the weakest of the three.** The D10 ellipse; a `#4a3a28` cord
at full opacity crossing the cream wall as a dark hairline (`:1330`); two `#5c88c8`
shutters that are flat rectangles with no opening behind them; trees that read as lollipops.
Yule Vale (star finial, wreath, chimney) and Icon Snows (onion dome, icon panel, garland)
both work.

**A5 — The Icon Snows map inverts the visual hierarchy.** The chapel domes are `#e0b040`
against `rgba(217,164,65,0.75)` markers — the same hue. Yule Vale and Sunspice keep content
and markers in different families.

**A6 — The menu background's signature motif fails.** The light line
(`menu_background_art.py:225-227`) is three dashed segments at `dash="3 12"` running through
the first two houses' roofs and stopping at x ≈ 1010, with six bulbs sitting on it — a dotted
trail, not a strung light. Composition is also dead-centre: all four houses sit at x 380–1160
of 1600, directly behind the centred menu card, and the onion dome is the only saturated
element in the frame. The Aftermath menu gets this right with an asymmetric diagonal.

**A7 — Two site silhouettes are weak.** `beacon` is a gold ellipse on a post — a lamp or a
pawn, with no bell flare. `foundry`'s fire (`#ff9a3c`, `:1455`) is drawn *before* the kettle
body and is entirely hidden, so the promised "fudge kettle over a fire" does not exist.
`clocktower` is the best of the six.

**A8 — The cells rotate in 90° steps but the theme offers no seasonal character.** Minor,
and covered by A1.

**Inherited, not new:** `walk_legs` (`:627-641`) splays legs vertically (`side * 0.5` in y),
putting one leg above the body centre. `gen_aftermath_theme.py:697` does exactly the same, so
this is the house convention rather than a mistake in the new file — and the plan-view
redraw in §8 replaces it anyway. The flat-blob tile character and the per-cell tone steps on
the dark path are likewise identical in both generated themes.

## 8. Sprite redesigns

Every drawing below is symmetric about the facing axis (x), contains no cue that implies
gravity, keeps its barrel or nose on +X, and keeps all ink inside its clip box.

### 8.1 Towers — `viewBox="-16 -16 32 32"`, body about the origin

| id | plan-view construction | Notes |
|---|---|---|
| `basic` | Gingerbread *cookie* from above: body disc, two arms out on ±y, icing dots, short candy-cannon barrel on +X | replaces the standing figure |
| `ice` | Concentric candy-cane stripes about a centre post, nub on +X | a spiral reads the same at any angle |
| `sniper` | Square gingerbread base plate, the hat as a red disc with a gold band seen from above, jaw slot, long thin barrel on +X | fixes the +1.0 overshoot |
| `cannon` | Round marzipan base, fat tube on +X with the bore a dark ring, ball seated in the bore | far clearer in plan; fixes D4 |
| `lightning` | Floss lobes arranged radially about a small base disc, zaps radiating on +X | the hanging stick is the side-view cue and goes |
| `railgun` | Peppermint-striped barrel on +X over a rectangular breech, candy-cane corners | fixes the +0.8 overshoot |
| `sturdyWall` | Slab rectangle, lengthwise icing stripe, sugar dots | symmetric about **both** axes, so the permanent −45° is invisible; widen the loaf from 22.8 units past Aftermath's 27.5, staying inside ±16 (A3) |
| `shotgunTank` | Wooden box from above, the jimmie spread at the muzzle on +X | fixes D4; the shower stays inside ±16 |

### 8.2 Enemies — `viewBox="-1 -1 2 2"`, body about the origin

| id | plan-view construction | Altitude scale | Notes |
|---|---|---|---|
| `minion` | Helmet disc with a red plume arc, two shoulder lobes on ±y, rifle bar on +X | 1.0 | `reach_arm` shortened to ≤0.35 units |
| `runner` | Train body rectangle, boiler circle forward, two wheels per side on ±y | 1.0 | wheel rotation gives the missing walk cycle |
| `tank` | Teddy disc, two ear lobes at the rear, snout on +X | 1.0 | |
| `shielded` | Glass sphere with an internal swirl | 1.0 | already near-invariant; swirl animates for the walk |
| `healer` | Box with a crank on +X and a note puff; symmetric about x | 1.0 | note puff animates for the walk |
| `boss` | Square box, lid as a disc rotating about the box **centre** rather than a −y hinge | 1.0 | fills toward Aftermath's 88%; removes the D5 clip |
| `flyer` | Diamond with a cross spar; symmetric about both axes | 0.83 | tail flutter for the walk |
| `jet` | Disc with a hub, string trailing to −X | 0.58 | string trail for the walk |
| `aegis` | Dome with a band; symmetric | 0.75 | roll wobble for the walk |

Declared colors for `runner`, `flyer`, `jet` and `aegis` realign to the painted sprite (D11).

## 9. Validation

### 9.1 What can be enforced

| Check | Where | Catches |
|---|---|---|
| no `#120e0c` in any tower or enemy frame | both generators' `validate_theme`, plus a new case in the existing describe at `map-theme.test.ts:1164` | D6-shadow, any future re-add |
| every frame's ink inside its clip box (`±16` towers, `±1` enemies) | `validate_theme`, reusing `non_color_numbers` / `assert_boxed_art` | D5, D7, and the spawn clipping in D3 |
| `assert_boxed_art` applied to spawn states | `validate_theme:1857` | D3 |
| every walk frame differs by more than the shared bob translate | `validate_theme` | D12 |
| each declared `color` appears as a fill in its own art | `validate_theme` | D11 |
| no shadow/body width ratio over 1.0 | subsumed by the first check | D6-shadow |

### 9.2 What cannot be enforced, and why

Two candidate metrics were built and both were defeated:

- **IoU(sprite, sprite rotated 90°)** — median 0.41 for Chrithmath and 0.41 for Aftermath.
  It measures pixel asymmetry, which a coherent plan-view body with a nose also has.
- **IoU(sprite, sprite flipped top-bottom)** — the default theme's `ice` hexagon scores 1.00,
  identical to a nutcracker with a hat. A radially symmetric plan view with a barrel on +X
  scores high on both axes, so a high score does not mean side elevation.

The distinguishing property is semantic: does the drawing contain a cue that only makes
sense with gravity? That is a review-time judgement, so it becomes a documented rule (§11)
plus a rotation strip in the contact sheet (§10).

## 10. Contact sheet gains a rotation strip

`contact_sheet()` already renders Stollen Bastion at −45° in isolation. Extend it to a
per-sprite strip at 0/45/90/135/180/225/270/315 for all 8 towers (rest frame) and all 9
enemies (walk frame 0), each with the 27px game-size copy beside the detail copy. This is
the mechanical substitute for the validator that cannot be built: tipping over becomes a
one-glance judgement instead of something you have to catch in play.

## 11. Documentation

| File | Change |
|---|---|
| `MapThemeHowTo.md:173` | Add the perspective rule: a rotated sprite must read as a plan view; body radially coherent about the centre; the only meaningful axis is the facing axis (+X); no cue that implies gravity — no standing figure, no feet line, no horizon, no light direction. Restate the −45° rest angle and the wall's permanent −45° as review checkpoints rather than a footnote about square footprints. |
| `MapThemeHowTo.md`, tower/enemy sections | Add: no baked ground shadow. Note the existing renderer decision at `map-theme.test.ts:1164` and that the default theme ships without one. Airborne units express altitude by scale. |
| `MapThemeHowTo.md`, spawn section | State the exemption explicitly: spawns, site art, base art, region maps and the menu background are never rotated, so they may use elevation. |
| `MapThemeHowTo.md`, image-set table | 234 stays; note that both generated themes now share the no-shadow and plan-view rules. |
| `TECHNICAL.md:127`, generator list | Note that all three theme generators validate the no-shadow rule and the frame-bounds rule. |
| `plans/ChrithmathTheme.md` §4/§5 | Record that the sprites are plan views and that §3's motif list was not delivered; cross-reference this document. |

## 12. Implementation steps

0. **Fix D1 first.** The pre-write sidecar check blocks any regeneration once the menu
   changes, and steps 1–8 regenerate twice.
1. **Remove the shadows** from both generators (`contact_shadow`, the `enemy_frame` shadow,
   and their call sites). Add the altitude scale for `flyer`/`aegis`/`jet`. Regenerate both
   themes; confirm a second run is byte-identical and `gen_theme_images.py` still round-trips.
   Extend `map-theme.test.ts:1164`.
2. **Redraw the 8 towers** as plan views per §8.1, fixing D4, D7 and A3 in the same pass.
3. **Redraw the 9 enemies** as plan views per §8.2, fixing D5, D6, D11 and D12 in the same pass.
4. **Add the rotation strip** to `contact_sheet()` per §10 and review all 17 sprites at all 8
   angles before calling step 2/3 done.
5. **Add the remaining validators** per §9.1.
6. **Fix the non-sprite art**: D2 (moon), D10 (both ellipses), D8 (chapels off the markers),
   D9 (shops above the waterline), A6 (menu light string and composition), A7 (beacon flare,
   foundry fire), A4 (Sunspice base).
7. **Add region tile motifs** per A1 — footprints, cracks, candle specks — inside the
   1200-byte budget and the ≥2px survival rule.
8. **Fix D13** with `justify-content: safe center`.
9. **Docs** per §11.
10. **Verify** per §13.

## 13. Verification

- `npm run check` — expect 2,052 tests (one new shadow case) across 117 files.
- Regenerate `chrithmath.json` and `the-aftermath.json` twice; both runs byte-identical.
- `gen_theme_images.py` round-trips all four data files byte-identically and all three
  sidecars match their theme's `menuBackground`.
- The rotation strip shows all 17 sprites reading correctly at 0/45/90/135/180/225/270/315.
- `npm run dev`, one run per region: walls read at their permanent −45°, tower aim sweeps
  cleanly with no size breathing between frames, flyers/jet/aegis read as airborne by scale,
  the terrain ramp still reads light-to-dark on the board and in a `ProgressivePlacement`
  block preview, the path is unmistakable against all four terrain kinds, site silhouettes
  stay distinct at 26px on terrain1, terrain3, terrain4 and path, and the main menu shows
  three cards with no clipping at 1280×720 and at 1920×1080.

## 14. Decisions taken

| Question | Decision | Rationale |
|---|---|---|
| New theme or redraw in place? | Redraw in place | Top-down is a renderer constraint; a 4th world costs ~2400 lines, ~300 KB and a 4th card for the same constraint. All non-sprite assets are correct. |
| Towers only, or towers and enemies? | All 8 towers and all 9 enemies | All 17 rotate freely and all 17 are side elevations. Enemies rotate by movement angle, so a head-up/feet-down read tips over exactly as towers do. |
| Circle the shadow or remove it? | Remove it, in both generated themes | A plan view needs no shadow; the default theme already ships without one and reads correctly. `map-theme.test.ts:1164` already decided the renderer injects nothing. |
| Can the perspective rule be a validator? | No — documented rule plus a rotation strip | Two geometric metrics were built and both were defeated by the default theme's symmetric `ice` hexagon. The property is semantic. |

## 15. Assumptions

- The Chrithmath concept survives plan view. Every one of the 17 sprites has a plan-view
  reading in §8; none required abandoning the concept.
- The §3 palette table stays settled. A2 records a legibility concern but changing a field
  fill means re-running `validate_region_palette()`.
- The maps catalog override, all 48 seeds, and the three region names are untouched. The
  theme is visuals-only.
- Removing the Aftermath shadow is acceptable as a visual change to a shipped theme. It is
  a deletion of a rotating artifact and matches the default theme, but it is the one change
  here that alters a world already in play.
- Tower `color` continues to be applied through `TowerManager.ts:220` (`el.style.color`)
  for the default theme's `currentColor` strokes. The two generated themes use literal fills,
  so neither the shadow removal nor the redraw interacts with it.