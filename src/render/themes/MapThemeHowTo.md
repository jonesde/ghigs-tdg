# Creating a New Map Theme

A map theme swaps the visual identity of towers, enemies, and map tiles on the `/game` screen without affecting gameplay stats, effects, overlays, or non-game screens. The existing polygon-based art is the default theme (`id: "default"`).

## File Location & Registration

1. Create a JSON file under `src/render/themes/data/` (e.g., `fantasy-map-theme.json`).
2. Register it in `src/render/themes/index.ts`:
   - Add an entry to `MAP_THEME_MANIFEST` with `{ id, label, file }`.
   - Call `registerThemeLoader(id, () => import('./data/your-theme.json').then(m => m.default))`.

## JSON Structure

```json
{
  "id": "your-theme-id",
  "label": "Display Name",
  "menuBackground": "",
  "towers": { /* one entry per tower id */ },
  "enemies": { /* one entry per enemy id */ },
  "regions": [ /* 3 region objects */ ],
  "spawns": { "closed": "", "open": "", "transition": "" }
}
```

`menuBackground` and `spawns` are optional. If `menuBackground` is omitted, the main menu falls back to a plain dark background. If `spawns` is omitted, spawn tiles fall back to a translucent red rectangle.

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
| `flyer` | `enemies.flyer.walking` | `enemies.flyer.hitReaction` | `enemies.flyer.attack` |
| `jet` | `enemies.jet.walking` | `enemies.jet.hitReaction` | `enemies.jet.attack` |
| `aegis` | `enemies.aegis.walking` | `enemies.aegis.hitReaction` | `enemies.aegis.attack` |
| `boss` | `enemies.boss.walking` | `enemies.boss.hitReaction` | `enemies.boss.attack` |

Each enemy entry also requires `name` (string), `color` (CSS color), and `shape` (string — used for stats panel display).

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

### Main Menu Background (optional)

| Field | Used on |
|---|---|
| `menuBackground` | The `/` main menu screen, behind the menu card and theme buttons |
| `menuBackground` | The theme selection buttons on the main menu, as a faded preview of each theme |

`menuBackground` is the main menu background — an inline `<svg>...</svg>` string or an external SVG ref (same convention as every other image). Author it with a 16:9 `viewBox` (e.g. `0 0 1600 900`) and `preserveAspectRatio="xMidYMid slice"` so it covers the viewport at any aspect ratio. The same image is rendered as a slightly faded preview on each theme selection button, where it is scaled to the button's width and clipped to its shorter height. Keep it low-contrast so the menu card and theme button labels stay readable.

---

## Image Sizing Guidelines

The map tile size is **36px**. Camera zoom scales every sprite. Draw for the base sizes below. The outer `<svg viewBox>` on an image string is stripped; the `<symbol>` viewBox below is the coordinate system that actually clips the drawing. Ink outside that box is not visible.

`url(#...)` gradients and filters inside a sprite are unreliable once the drawing is cloned with `<use>`, and duplicate ids collide. Paint with flat fills.

### Tower Sprites

| Property | Value |
|---|---|
| **Authoring viewBox** | `-16 -16 32 32` |
| **Symbol viewBox** | `-16 -16 32 32` (hardcoded in `useSvgStaticContent.ts`) |
| **Element size** | 27 × 27 px (`36 * 0.75`, `TOWER_SCALED_SIZE`) |

Towers are centered on their tile and the whole sprite rotates to `tower.angle`. Put the barrel on +X (to the right at 0°). A new tower starts at `-π/4`. `sturdyWall` has no range, so it stays at that angle; a square footprint still reads after that rotation. Projectile origin is `tileSize * 0.45` (16.2px) from the tower center, past the 13.5px sprite edge, so the muzzle should sit on +X at the right edge of the clip.

`TowerManager` sets `style.color` from the theme color. `currentColor` in the sprite picks that up. Hard-coded fills do not. Ghost towers are drawn by lowering the element's opacity.

Level pips are 2px circles along the bottom of the sprite (`tower.y + 12`).

### Enemy Sprites

Every enemy `<use>` is the same 27 × 27 px (`ENEMY_SCALED_SIZE`). The boss is not a larger element. A bigger creature is one whose drawing fills more of the viewBox.

| Property | Value |
|---|---|
| **Authoring viewBox** | `-1 -1 2 2` |
| **Symbol viewBox** | `-1 -1 2 2` (hardcoded) |
| **Element size** | 27 × 27 px |

Enemies face +X. When `cos(angle) < 0`, `EnemyManager` mirrors the sprite with `scale(-1, 1)` so it does not turn upside down. Do not put text in the drawing. Hit reaction does not scale the element; a flinch has to be in the frames. Slow is a saturate filter on the `<use>`.

### Tile Images

| Property | Value |
|---|---|
| **viewBox** | `0 0 36 36` |
| **Base Size** | 36 x 36 px |
| **Symbol viewBox** | `0 0 36 36` (hardcoded) |

Tiles fill each grid cell exactly. Each tile, including path and the tile under a spawn, is rotated by a random multiple of 90° from the map seed (`useSvgStaticContent.ts`). A lane stripe will not follow the path. The edge pixels of a tile must be one flat color so neighbors meet after rotation. Keep motifs about 3px in from the edge: a 0.7px grid stroke is drawn over the tile boundary.

`terrain1` is the lowest ground and `terrain4` is the highest. Height is a gameplay input, so the four steps need a clear light-to-dark ramp.

### Region Base Art

| Property | Value |
|---|---|
| **viewBox** | Freeform (use `0 0 W H` matching your art) |
| **Base Size** | ~97 x 97 px (spans 3 x 3 tiles: `3 * 36 - tile gaps`) |
| **Placement** | Translated to `(base.x - 1) * 36, (base.y - 1) * 36` |

The base art replaces the default procedural base. If left as `""`, the default base renderer (rounded rectangle with gems and hexagonal emblem) is used instead. Your SVG is inserted directly into a `<g transform="translate(...)">` wrapper.

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

Pattern: `tower-{type}-f{index}`, `enemy-{type}-f{index}`, `enemy-{type}-hit-f{index}`, `enemy-{type}-attack-f{index}`.

Tower frame 0 is the resting picture. Later animation frames play across `animation.duration`, then the renderer returns to frame 0. Enemy hit and attack replace the walking frame while their timers are running, then walking resumes. There is no separate tower walking symbol.

---

## Animation Timing

- **Tower animation duration**: Time for the firing animation to complete before reverting to idle. Typical range: 0.3–1.0 seconds.
- **Tower walking duration**: Cycle time for the idle animation. Typical range: 0.5–1.0 seconds.
- **Enemy walking duration**: Full cycle time for the walking bob/wobble. Typical range: 0.5–1.5 seconds.
- **Enemy hit reaction duration**: How long the hit flash/stutter plays. Default: 0.12 seconds (fast, snappy feedback).

Frame count per cycle (what the shipped themes use; the renderer accepts any positive count):
- Tower animation: frame 0 at rest, then one or more firing frames. Polymath uses 2. Aftermath uses 3 (rest, discharge, leftover smoke).
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

| Category | Count |
|---|---|
| Tower animation sets | 8 |
| Tower walking sets | 8 (stored; not drawn) |
| Enemy walking sets | 6 |
| Enemy hit reaction sets | 6 |
| Enemy attack sets | 6 (optional per enemy) |
| Region tile sets | 15 (3 regions × 5 tile types) |
| Region base sets | 3 |
| Region map images | 3 (plus a `mapLayout` data structure each) |
| Spawn images | 3 (optional) |
| Main menu background | 1 (optional) |
| **Total image sets, both shipped themes** | **58** |

---

## Testing Your Theme

1. Register the theme in `MAP_THEME_MANIFEST`.
2. Run `npm run dev` and navigate to `/map-select`.
3. Select your theme from the dropdown.
4. Start any map and verify:
   - Tower sprites render correctly with proper colors and rotation.
   - Enemy sprites walk, bob, and flash on hit.
   - Tile images fill grid cells without gaps.
   - Base art appears at the correct location.
5. Run the test suite: `npm run test` (includes `map-theme.test.ts` for theme loading/normalization).
