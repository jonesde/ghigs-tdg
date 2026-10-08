# Creating a New Map Theme

A map theme swaps the visual identity of towers, enemies, and map tiles on the `/game` screen without affecting gameplay stats, effects, overlays, or non-game screens. The existing polygon-based art is the default theme (`id: "default"`).

## File Location & Registration

1. Create a JSON file under `src/render/themes/data/` (e.g., `fantasy-map-theme.json`).
2. Register it in `src/render/themes/index.ts`:
   - Add an entry to `MAP_THEME_MANIFEST` with `{ id, label, file }`.
   - Call `registerThemeLoader(id, () => loadRawTheme(() => import('./data/your-theme.json')))`, which parses the file through `RawMapThemeSchema` before the store sees it.
   - If the theme carries a `menuBackground`, also add the sidecar file `your-theme-menu.json` (a one-field file duplicating just that `menuBackground`) and call `registerMenuBackgroundLoader(id, () => import('./data/your-theme-menu.json'))` directly below the theme loader. The main-menu card previews load the sidecar instead of the full theme, so the two copies must stay byte-equal; both writers write it — `gen_theme_images.py` for every shipped theme, and `gen_chrithmath_theme.py` for its own, each reading the sidecar back after writing to confirm it round-trips — and they must produce byte-identical text, so a menu-art edit goes out in one run with no required ordering between the two scripts.

## JSON Structure

```json
{
  "id": "your-theme-id",
  "label": "Display Name",
  "menuBackground": "",
  "towers": { /* one entry per tower id */ },
  "enemies": { /* one entry per enemy id */ },
  "regions": [ /* 3 region objects */ ],
  "spawns": { "closed": "", "open": "", "transition": "" },
  "sites": {
    "buildings": {
      "armory": "", "magazine": "", "beacon": "", "foundry": "", "clocktower": "", "aviary": ""
    },
    "caches": { "sealed": "", "unlocked": "", "broken": "" },
    "supplyDrop": ""
  }
}
```

`menuBackground`, `spawns`, and `sites` are optional. If `menuBackground` is omitted, the main menu falls back to a plain dark background. If `spawns` is omitted, spawn tiles fall back to a translucent red rectangle. If `sites` is omitted, map sites (buildings, caches, boss packages) fall back to the procedural marks in `MapSiteLayer.ts`.

Current tower ids: `basic`, `ice`, `sniper`, `cannon`, `lightning`, `railgun`, `sturdyWall`, `shotgunTank`.

Current enemy ids: `minion`, `runner`, `tank`, `shielded`, `healer`, `boss`.

Each `image` value is either an inline `<svg>...</svg>` string or a relative path/URL to an external SVG file. External references are fetched and inlined automatically by `normalizeThemeImages`.

---

## Image Sets Reference

Every image set is an animation with a `duration` (seconds per full cycle) and an array of `frames`, each containing one `image` (SVG string or path). The renderers cycle through frames based on elapsed time.

### Tower Image Sets

Each tower type has a firing `animation` and an optional `walking` record:

| Tower Type Key | animation (firing) | walking (stored, not drawn) |
|---|---|---|
| `basic` | `towers.basic.animation` | `towers.basic.walking` |
| `ice` | `towers.ice.animation` | `towers.ice.walking` |
| `sniper` | `towers.sniper.animation` | `towers.sniper.walking` |
| `cannon` | `towers.cannon.animation` | `towers.cannon.walking` |
| `lightning` | `towers.lightning.animation` | `towers.lightning.walking` |
| `railgun` | `towers.railgun.animation` | `towers.railgun.walking` |
| `sturdyWall` | `towers.sturdyWall.animation` | `towers.sturdyWall.walking` |
| `shotgunTank` | `towers.shotgunTank.animation` | `towers.shotgunTank.walking` |

`useSvgStaticContent.ts` builds tower `<symbol>` elements from `animation.frames` only. Frame 0 is what `TowerManager` shows whenever the tower is not inside a fire cycle. `walking` is parsed and kept on the theme object, and nothing instantiates it. A one-frame `walking` copy of frame 0 matches the shipped themes.

Each tower entry also requires `name` (string), `color` (CSS color), and `icon` (single-character display glyph). The shop and the minimap draw `icon`. Projectiles and the tower panel use `color`.

### Enemy Image Sets

Each enemy type has a walking cycle, an optional hit reaction, and an optional attack:

| Enemy Type Key | walking | hitReaction | attack |
|---|---|---|---|
| `minion` | `enemies.minion.walking` | `enemies.minion.hitReaction` | `enemies.minion.attack` |
| `runner` | `enemies.runner.walking` | `enemies.runner.hitReaction` | `enemies.runner.attack` |
| `tank` | `enemies.tank.walking` | `enemies.tank.hitReaction` | `enemies.tank.attack` |
| `shielded` | `enemies.shielded.walking` | `enemies.shielded.hitReaction` | `enemies.shielded.attack` |
| `healer` | `enemies.healer.walking` | `enemies.healer.hitReaction` | `enemies.healer.attack` |
| `mender` | `enemies.mender.walking` | `enemies.mender.hitReaction` | `enemies.mender.attack` |
| `flyer` | `enemies.flyer.walking` | `enemies.flyer.hitReaction` | `enemies.flyer.attack` |
| `jet` | `enemies.jet.walking` | `enemies.jet.hitReaction` | `enemies.jet.attack` |
| `aegis` | `enemies.aegis.walking` | `enemies.aegis.hitReaction` | `enemies.aegis.attack` |
| `skyhold` | `enemies.skyhold.walking` | `enemies.skyhold.hitReaction` | `enemies.skyhold.attack` |
| `broodwing` | `enemies.broodwing.walking` | `enemies.broodwing.hitReaction` | `enemies.broodwing.attack` |
| `boss` | `enemies.boss.walking` | `enemies.boss.hitReaction` | `enemies.boss.attack` |

Each enemy entry also requires `name` (string), `color` (CSS color), and `shape` (string — used for stats panel display).

The default (Polymath) theme's enemy frames are hand-authored polygons in `default-map-theme.json`, unlike the Aftermath and Chrithmath themes whose frames are generated by `gen_aftermath_theme.py` / `gen_chrithmath_theme.py` from `ENEMY_DRAW` + `ENEMY_META`. A hand-added enemy row needs the same contract the generators enforce and `tests/unit/map-theme.test.ts` asserts: 8 walking frames, 3 hit-reaction frames, 3 attack frames with `attack.duration` 0.2, the declared `color` present as a fill in its own art, no ground-shadow `#120e0c` paint, and ink inside the `±1` clip box.

### Region Tile Image Sets (15 total)

Each region has 5 tile images:

| Region ID | Region Name (default) | Tiles |
|---|---|---|
| `0` | Verdant Marches | `regions[0].tiles.path`, `terrain1`, `terrain2`, `terrain3`, `terrain4` |
| `1` | Sunscorch Coast | `regions[1].tiles.path`, `terrain1`, `terrain2`, `terrain3`, `terrain4` |
| `2` | Thornpeak Wilds | `regions[2].tiles.path`, `terrain1`, `terrain2`, `terrain3`, `terrain4` |

- `path`: walkable path tiles and spawn tiles.
- `terrain1` through `terrain4`: buildable terrain tiles, ordered by height value (1 = lowest, 4 = highest). Each region's terrain shades should form a visual gradient.

### Region Base Image Sets (3 total)

| Region ID | Base Art Field |
|---|---|
| `0` | `regions[0].base` |
| `1` | `regions[1].base` |
| `2` | `regions[2].base` |

An empty string (`""`) falls back to the default procedurally-generated base structure.

### Region Map Image & Layout (3 sets)

Each region has a map image and a level layout, used by the `/map-select` screen (one tab per region):

| Region ID | Map Art Field | Layout Field |
|---|---|---|
| `0` | `regions[0].mapImage` | `regions[0].mapLayout` |
| `1` | `regions[1].mapImage` | `regions[1].mapLayout` |
| `2` | `regions[2].mapImage` | `regions[2].mapLayout` |

- `mapImage`: the region map background — an inline `<svg>...</svg>` string or an external SVG ref (same convention as every other image).
- `mapLayout`: where the map levels sit on that image and how they connect. Node `x`/`y` coordinates are in the `mapImage`'s viewBox space.

`mapLayout` fields:

| Field | Value |
|---|---|
| `viewBox` | Four numbers, e.g. `"0 0 1100 700"`. Must match the `viewBox` of `mapImage` |
| `nodes` | Exactly 16 entries: `{ "kind", "level", "x", "y" }` |
| `connections` | 15 entries: `{ "from": { "kind", "level" }, "to": { "kind", "level" } }` |

Node `kind` and `level`:

- `"kind": "level"` — one node per map level 1–12; `level` is the map level. This is the generated map `regionId * 12 + level - 1`.
- `"kind": "progressive"` — one node per progressive variant; `level` is the branch level the variant unlocks with (1, 5, 9, or 12 — the levels of `progressive.variants` in `src/content/data/maps.json`).

Connections describe the current level progression: 11 chain links (`level` 1→2, 2→3, … 11→12) plus 4 branch links (`level` 1→`progressive` 1, `level` 5→`progressive` 5, `level` 9→`progressive` 9, `level` 12→`progressive` 12). Every endpoint must reference an existing node.

`RawMapThemeSchema` enforces the structure: no duplicate `(kind, level)` nodes, exactly the 12 level nodes 1–12, exactly 4 progressive nodes, and no connection to a missing node. The branch level set (1, 5, 9, 12) is matched against `maps.json` at load time in `MapSelect.vue` (an unmatched progressive node is skipped with a warning).

### Spawn Image Set (optional)

| Field | Symbol id | Shown when |
|---|---|---|
| `spawns.closed` | `spawn-closed` | The spawn is shut |
| `spawns.transition` | `spawn-transition` | The hatch is between shut and open |
| `spawns.open` | `spawn-open` | The spawn is open |

Spawn art is a 36×36 symbol drawn on top of the path tile. The symbol itself is not rotated. The path tile under it is.

Spawn art is also exempt from the rotated-sprite rules below, and so is every other image the renderer never rotates: map site art, region base art, region map images and the menu background. `MapSiteLayer.ts` and `SpawnManager.ts` contain no transform at all, so none of those is ever turned, and they may use elevation, a horizon and a light direction freely. The exact scope and the reasoning are under "Rotated Sprites" in Image Sizing Guidelines.

### Main Menu Background (optional)

| Field | Used on |
|---|---|
| `menuBackground` | The `/` main menu screen, behind the menu card and theme buttons |
| `menuBackground` | The theme selection buttons on the main menu, as a faded preview of each theme |

`menuBackground` is the main menu background — an inline `<svg>...</svg>` string or an external SVG ref (same convention as every other image). Author it with a 16:9 `viewBox` (e.g. `0 0 1600 900`) and `preserveAspectRatio="xMidYMid slice"` so it covers the viewport at any aspect ratio. The same image is rendered as a slightly faded preview on each theme selection button, where it is scaled to the button's width and clipped to its shorter height. Keep it low-contrast so the menu card and theme button labels stay readable. The value is duplicated into the theme's `*-menu.json` sidecar, which is what the main-menu card previews actually load (see File Location & Registration).

---

## Image Sizing Guidelines

The map tile size is **36px**. Camera zoom scales every sprite. Draw for the base sizes below. The outer `<svg viewBox>` on an image string is stripped; the `<symbol>` viewBox below is the coordinate system that actually clips the drawing. Ink outside that box is not visible.

`url(#...)` gradients and filters inside a sprite are unreliable once the drawing is cloned with `<use>`, and duplicate ids collide. Paint with flat fills.

### Rotated Sprites

Two rules govern the sprites the renderer turns. They cover tower frames and enemy frames only; the exemption list is at the end of this section.

**A rotated sprite must read as a plan view.** `TowerManager.ts:262-264` writes `rotate(tower.angle × 180/π, halfSize, halfSize)` into the `<use>` transform, and `EnemyManager.ts:104-116` writes `rotate(enemy.angle × 180/π, …)` for every enemy, mirroring with `scale(-1, 1)` when `cos(angle) < 0`. Both turn the whole element, so every pixel of the drawing travels with the body. Three conditions follow:

- **The body is radially coherent about the sprite centre.** Parts are arranged around the centre, not stacked along a vertical.
- **The facing axis is the only meaningful axis.** Facing is +X at 0°, expressed by one mark on +X — a barrel, a muzzle, a snout, a nose plate. Nothing on ±Y may mean anything.
- **Nothing may imply gravity.** No standing figure, no legs below a body, no ears or a hat on top, no vertical stack with a distinguishable top and bottom, no horizon line, no light direction. A top-lit rim and a cast-shadow ellipse are the same defect drawn differently.

This is a renderer constraint, not a style preference. A tracking tower sweeps its sprite through a full 360° and an enemy turns through 360° with its movement direction, so a drawing that reads correctly at one heading reads wrongly at all the others: a gingerbread man with its head at −y and its legs at +y does not re-aim when the sprite turns 40°, it tips over. `default-map-theme.json` is the reference — its `basic` tower is a `<circle r="8">`, an arc and a `<line x1="8" y1="0" x2="16" y2="0">` barrel, and its `minion` is a single `<circle r="0.37">`. Aftermath takes the same convention in a richer form: legs arranged radially with a forward head shape on +X.

Two of the renderer's angles are standing review checkpoints. A new tower starts at `-π/4`, and `sturdyWall` has `range: 0`, never fires, and therefore **stays at −45° for the entire run** — any top/bottom asymmetry in its drawing is visible for every second of every game. A square footprint hides that asymmetry by luck; nothing else does.

**No frame may bake a ground shadow.** The renderer injects none: `tests/unit/map-theme.test.ts` has a describe block named *"Entity symbol frames carry no injected ground shadow"*, whose cases assert both that a `<symbol>` starts from the theme's own frame content and that no shipped theme paints a shadow into a rotated sprite. Because the rotation carries a painted ellipse around with the body, an artist's shadow turns edge-on as the unit turns and reads as a dark smear hanging off the wrong edge. `default-map-theme.json` has zero shadow ellipses in its sprite frames and reads correctly; both theme generators refuse to write the ground-shadow color into a tower or enemy frame.

**Altitude is expressed by scale, because there is nothing else to express it with.** `flyingHeight` is sim-side state and rides the snapshot, but nothing under `src/render/` reads it and no render manager offsets an element's position by it, so the renderer cannot lift an airborne unit. Draw an airborne type smaller than a ground unit; in a plan view a smaller sprite reads as further from the camera. `gen_chrithmath_theme.py` and `gen_aftermath_theme.py` both compute `AIRBORNE_SPRITE_SCALE` as `1 - flyingHeight / 12`, which turns the heights in `src/content/data/enemies.json` into 0.92 / 0.83 / 0.75 / 0.67 / 0.58 of a ground unit for `broodwing: 1`, `flyer: 2`, `aegis: 3`, `skyhold: 4`, `jet: 5`. `AIRBORNE_FLYING_HEIGHT` in both generators is a hand-maintained mirror of those five pack heights: a new airborne type needs a row there as well as its scale, and a mismatch is a wrong sprite scale rather than an error.

**The perspective rule cannot be machine-enforced.** Whether a drawing contains a cue that only makes sense with gravity is a review-time judgement, and two geometric metrics were built and defeated trying to replace it (`plans/ChrithmathV2.md` §9.2 has the numbers): intersection-over-union of a sprite against itself rotated 90° (median 0.41 for both generated themes, because a coherent plan-view body with a nose on +X is also asymmetric in pixels) and against itself flipped top-to-bottom (the default theme's `ice` hexagon scores 1.00, identical to a nutcracker with a hat). So the check is the generator's contact sheet **rotation strip**: `gen_chrithmath_theme.py`'s `rotation_strip()` renders one row per sprite at 0/45/90/135/180/225/270/315, each angle drawn at a 72px detail size beside the 27px game size, towers contributing their rest frame and enemies their first walking frame. `gen_aftermath_theme.py`'s contact sheet does not carry the strip yet; a new generator should build one. The generators do check the neighbouring machine-checkable property — a frame whose ink leaves its clip box is refused, because a `<symbol>` viewBox scales to fit rather than clipping, so an overshooting frame silently rescales the sprite — but frame bounds say nothing about perspective.

**Exempt: everything the renderer never rotates.** Tower and enemy frames are the whole scope of the two rules above. Spawn symbols, map site art, region base art, region map images and the menu background are never rotated: `MapSiteLayer.ts` and `SpawnManager.ts` contain no transform at all, `useSvgStaticContent.ts` rotates only tile cells, and neither `RegionMap.vue`, `MainMenu.vue` nor `SvgGameRoot.vue` applies a rotation to theme art (base art gets a `translate` to reach its block corner, which changes position and nothing else). So all of them may use elevation, a horizon and a light direction freely. Tiles do rotate, but only in 90° steps from the map seed, and they answer to the edge-band and fine-line rules under Tile Images instead.

### Tower Sprites

| Property | Value |
|---|---|
| **Authoring viewBox** | `-16 -16 32 32` |
| **Symbol viewBox** | `-16 -16 32 32` (hardcoded in `useSvgStaticContent.ts`) |
| **Element size** | 27 × 27 px (`36 * 0.75`, `TOWER_SCALED_SIZE`) |

Towers are centered on their tile and the whole sprite rotates to `tower.angle`. Put the barrel on +X (to the right at 0°), and read "Rotated Sprites" above before drawing — the +X mark is the only mark the drawing is allowed, since the renderer sweeps the sprite through a full 360°. A new tower starts at `-π/4`. `sturdyWall` has no range, so it never fires and stays at that angle for the whole run, which is exactly why any top/bottom asymmetry is a defect and not a style choice: a square footprint happens to survive the −45°, but nothing else does. Projectile origin is `tileSize * 0.45` (16.2px) from the tower center, past the 13.5px sprite edge, so the muzzle should sit on +X at the right edge of the clip. No tower frame may carry a baked ground shadow.

`TowerManager` sets `style.color` from the theme color. `currentColor` in the sprite picks that up. Hard-coded fills do not. Ghost towers are drawn by lowering the element's opacity.

Level pips are 2px circles along the bottom of the sprite (`tower.y + 12`). A tower shows `level - 1` pips. Pip color comes from the pip index, not the level: pips 1-3 are silver and pips 4-6 are gold, so a level-5 tower reads as three silver pips plus one gold rather than flipping all three. The base defense draws the same row under the same rule.

### Enemy Sprites

Every enemy `<use>` is the same 27 × 27 px (`ENEMY_SCALED_SIZE`). The boss is not a larger element. A bigger creature is one whose drawing fills more of the viewBox.

| Property | Value |
|---|---|
| **Authoring viewBox** | `-1 -1 2 2` |
| **Symbol viewBox** | `-1 -1 2 2` (hardcoded) |
| **Element size** | 27 × 27 px |

Enemies face +X. When `cos(angle) < 0`, `EnemyManager` mirrors the sprite with `scale(-1, 1)` so it does not turn upside down. That mirror is not a substitute for the plan-view rule in "Rotated Sprites" above: every enemy turns through a full 360° with its movement direction, so a body with a head at −y and feet at +y tips over at every heading. Do not put text in the drawing. Hit reaction does not scale the element; a flinch has to be in the frames. Slow is a saturate filter on the `<use>`. No enemy frame may carry a baked ground shadow, and an airborne type is drawn smaller than a ground unit to carry its height.

### Tile Images

| Property | Value |
|---|---|
| **viewBox** | `0 0 36 36` |
| **Base Size** | 36 x 36 px |
| **Symbol viewBox** | `0 0 36 36` (hardcoded) |

Tiles fill each grid cell exactly. Each tile, including path and the tile under a spawn, is rotated by a random multiple of 90° from the map seed (`useSvgStaticContent.ts`). A lane stripe will not follow the path.

Two consequences for the art:

- **Nothing structural may reach inside 3px of a cell edge.** Rotated neighbours have to meet on identical pixels, so a stroke or a shape that crosses the band shows as a seam. The Polymath tiles hold this line by keeping every blob out of the band and repeating one rotationally symmetric inner ring instead. The Aftermath and Chrithmath tiles take the opposite route on purpose: they cross the edge with low-opacity tonal smears (0.24-0.28), which read as one continuous ground tone under rotation because a smear has no direction to give away. Pick one convention per theme and hold it — mixed conventions seam.
- **Fine line work does not survive rotation.** Concentric arcs with a per-tile random start angle, and marks under ~2px, read as scratches and speckle rather than ground, because neighbouring cells show unrelated fragments. Large soft shapes do survive: field fill plus a few low-opacity ellipses is what all shipped themes use.

The first `fill="#..."` in a tile string must be the full-bleed 36x36 field rect. The region backdrop tone and the progressive block preview both parse that first fill (`src/render/themes/fieldFill.ts`), so a tile that leads with anything else silently loses its field color.

`terrain1` is the lowest ground and `terrain4` is the highest. Height is a gameplay input, so the four steps need a clear light-to-dark ramp: the four terrain fills must read as a monotonically non-increasing luminance ramp from `terrain1` to `terrain4`, and the `path` fill is the darkest value in the region, sitting below every terrain fill. The Chrithmath generator encodes the rule numerically — a 0.4 luminance span floor across the ramp, a 0.10 floor per step, and every terrain fill at least 0.02 above the path — which is a useful bar for a hand-authored theme too.

**Variants.** A tile field is either one image string or an array of variant strings with the primary art first:

```json
"terrain2": ["<svg viewBox=\"0 0 36 36\">…primary…</svg>", "<svg …>…variant 2…</svg>"]
```

One image per kind repeats a single stamp across a whole height blob, and the seeded rotation only supplies four looks. The renderer emits one `<symbol>` per variant (`tile-r{regionId}-{kind}` for variant 0, `tile-r{regionId}-{kind}-v{n}` beyond) and picks a variant per cell from a hash of the map seed and that cell's absolute tile position, so a cell keeps its variant across a progressive board rebuild (`src/render/themes/tileArt.ts`). Every variant of a kind must share the field fill — the preview reads variant 0's.

All shipped themes ship three variants per kind, generated from a per-region palette by a seeded scatter rather than hand-placed. Give every variant of a kind the same construction (the same element types in the same order, the same opacity ranges, the same drift radius band) or the extra looks read as patches of a different material. Variant 0 is the one the progressive block preview and the region backdrop tone parse, so keep it the strongest of the three.

### Map Site Art

The optional `sites` block replaces the procedural building, cache, and boss-package marks in `MapSiteLayer.ts`.

| Property | Value |
|---|---|
| **viewBox** | `0 0 36 36` (same authoring space as tile art) |
| **Element size** | 26 x 26 px, centred on the site |
| **Symbol ids** | `site-building-{armory,magazine,beacon,foundry,clocktower,aviary}`, `site-cache-{sealed,unlocked,broken}`, `site-supply-drop` |
| **Selection** | `sealed` while intact, `unlocked` once paid for, `broken` at 0 hp |
| **Draw order** | Site art paints under the pulsing ring a boss package keeps |

Buildings and caches have to read as distinct silhouettes at 26px, in any case, since a map can hold twenty of them at once. The boss package's pulsing ring stays markup in `MapSiteLayer` rather than theme art: its CSS animation targets stroke paint, so that element has to stay a stroked shape.

### Region Base Art

| Property | Value |
|---|---|
| **viewBox** | Freeform (use `0 0 108 108`) |
| **Base Size** | 108 x 108 px — the full 3 x 3 tile block (`3 * 36`) |
| **Placement** | Translated to `(base.x - 1) * 36, (base.y - 1) * 36` |

The base art replaces the default procedural base. If left as `""`, the default base renderer (rounded rectangle with gems and hexagonal emblem) is used instead. Your SVG is inserted directly into a `<g transform="translate(...)">` wrapper at the block's top-left corner, so author on the full 108 x 108 block. The procedural default's visible body is the 97.2 px rounded rectangle (`2.7 * 36`) inset 5.4 px inside that block — a 97 px drawing anchored at the block corner leaves an ~11 px rim of the underlying tiles showing along the bottom and right.

### Region Map Art

| Property | Value |
|---|---|
| **viewBox** | Freeform `0 0 W H`; `mapLayout.viewBox` must match it exactly |
| **Placement** | Nested `<svg>` filling the Map Select map area (aspect ratio preserved) |
| **Node markers** | Drawn by `RegionMap.vue` on top (circle + label); leave headroom around node coordinates |

The mapImage is background art behind the level markers and connection lines. Keep it low-contrast so the markers, labels, and connection lines stay readable. Node `x`/`y` values in `mapLayout` are in the same user space as the viewBox.

---

## Symbol ID Contract

The renderers generate `<symbol>` elements with specific IDs. Your theme's frame index determines which symbol is referenced. Do not change these IDs:

| Entity | Symbol id |
|---|---|
| Tower type `basic`, animation frame 0 | `tower-basic-f0` |
| Enemy type `minion`, walking frame 0 | `enemy-minion-f0` |
| Enemy type `minion`, hit frame 0 | `enemy-minion-hit-f0` |
| Enemy type `minion`, attack frame 0 | `enemy-minion-attack-f0` |
| Spawn hatch | `spawn-closed`, `spawn-open`, `spawn-transition` |
| Region 1 path tile, variant 0 / variant 2 | `tile-r1-path`, `tile-r1-path-v2` |
| Armory building / sealed cache | `site-building-armory`, `site-cache-sealed` |

Pattern: `tower-{type}-f{index}`, `enemy-{type}-f{index}`, `enemy-{type}-hit-f{index}`, `enemy-{type}-attack-f{index}`, `tile-r{region}-{kind}[-v{index}]`, `site-building-{kind}`, `site-cache-{state}`.

Tower frame 0 is the resting picture. Later animation frames play across `animation.duration`, then the renderer returns to frame 0. Enemy hit and attack replace the walking frame while their timers are running, then walking resumes. There is no separate tower walking symbol.

---

## Animation Timing

- **Tower animation duration**: Time for the firing animation to complete before reverting to idle. Typical range: 0.3–1.0 seconds.
- **Tower walking duration**: Cycle time for the idle animation. Typical range: 0.5–1.0 seconds.
- **Enemy walking duration**: Full cycle time for the walking bob/wobble. Typical range: 0.5–1.5 seconds.
- **Enemy hit reaction duration**: How long the hit flash/stutter plays. Default: 0.12 seconds (fast, snappy feedback).

Frame count per cycle (what the shipped themes use; the renderer accepts any positive count):
- Tower animation: frame 0 at rest, then one or more firing frames. Polymath uses 2. Aftermath and Chrithmath use 3 (rest, discharge, leftover smoke).
- Tower walking: 1 frame, unused by the renderer.
- Enemy walking: 8 frames.
- Enemy hit reaction: 3 frames.
- Enemy attack: 3 frames (windup, strike toward +X, recover). Omit `attack` and the enemy has no attack sprite.

---

## Image Format

Each `image` in a frame can be:

1. **Inline SVG**: A complete `<svg>` element as a string, e.g. `"<svg viewBox=\"-16 -16 32 32\"><circle .../></svg>"`.
2. **External path**: A relative path like `"./sprites/tower-basic-f0.svg"` or a URL. The `normalizeThemeImages` function fetches and inlines these at load time.

The normalizer strips XML prologues, HTML comments, and whitespace. For inline SVGs, the outer `<svg>` tag and its attributes are stripped when building `<symbol>` content — only the inner elements are preserved.

---

## Complete Image Set Count

Per theme:

| Category | Count |
|---|---|
| Tower animation sets | 8 |
| Tower walking sets | 8 (stored; not drawn) |
| Enemy walking sets | 9 |
| Enemy hit reaction sets | 9 |
| Enemy attack sets | 9 |
| Region tile kinds | 15 (3 regions × 5 tile types) |
| Region base sets | 3 |
| Region map images | 3 (plus a `mapLayout` data structure each) |
| Map site images | 10 (6 buildings, 3 cache states, supply drop) |
| Spawn images | 3 |
| Main menu background | 1 |
| **Total image sets per theme** | **78** |
| **Total image sets, all three shipped themes** | **234** |

A set is not one image: each enemy set carries 8 walking, 3 hit, and 3 attack frames, each tower set 2 or 3 animation frames, and each tile kind ships 3 images, so one theme holds a little over 200 individual images.

Both totals are unchanged by the rules under "Rotated Sprites", and neither is waived by them: all three shipped themes draw tower and enemy frames as plan views and bake no ground shadow into any of them. A fourth theme inherits both rules.

---

## Testing Your Theme

1. Register the theme fully (manifest entry, `registerThemeLoader`, and — if it has a `menuBackground` — the `*-menu.json` sidecar plus `registerMenuBackgroundLoader`).
2. Run `npm run dev` and navigate to `/map-select`.
3. Select your theme from the dropdown.
4. Start any map and verify:
   - Tower sprites render correctly with proper colors and rotation.
   - Enemy sprites walk, bob, and flash on hit.
   - Tile images fill grid cells without gaps, and the height ramp reads light to dark.
   - Base art appears at the correct location.
   - Buildings, caches, and boss packages read as distinct shapes; a cache hover tooltip lines up with its glyph.
5. Run the test suite: `npm run test` (includes `map-theme.test.ts` for theme loading/normalization).
