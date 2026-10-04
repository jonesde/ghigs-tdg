# Default Theme Visual Overhaul (Polymath)

Status: Ready to execute. Self-contained implementation plan for raising the in-game map surface of the default theme ("Polymath") to a professional game look, staying fully SVG.

Decisions are locked in from the design review; a fresh context can execute this document top to bottom without re-researching. P5 (region-map and menu-background art) is explicitly deferred to a later round.

## 1. Locked Decisions

| Decision | Value | Rationale |
|---|---|---|
| Scope | P0–P4 (this round) | Map surface + base/spawns + elevation feedback + entity polish. P5 menu art deferred. |
| Art voice | Engineering-drawing / blueprint | Flat field fills + sparse precise line-work (contour arcs, ticks, shard outlines). Extends the theme's existing math identity (line-art towers, math-symbol region maps) and stays distinct from Aftermath's organic blob textures. |
| Height ramp | Darker with height | Existing majority convention: Polymath region 0, Aftermath, and the progressive preview all already darken with height. Only region 1 (broken) and region 2 (inverted) need fixing. |
| Grid lines | Contour-only | No always-on graph grid. Lines only at height changes and terrain/path boundaries. |

## 2. Architecture Review (how the map is rendered)

Read this section before touching code; it is the complete map-rendering picture.

**Static grid pipeline** — `src/render/svg/useSvgStaticContent.ts`:
- The theme JSON gives each region 5 tile images: `path`, `terrain1`–`terrain4` (36×36 SVG strings). `buildTileSymbols` (useSvgStaticContent.ts:215) turns them into `<symbol id="tile-r{regionId}-{kind}" viewBox="0 0 36 36">` entries in `<defs>` via `mapDefsContent` (computed, useSvgStaticContent.ts:289).
- The `gridContent` computed (useSvgStaticContent.ts:305) builds one static SVG string per map, injected into the grid layer via `v-html` in `SvgGameRoot.vue:10`. Order in the string:
  1. Background rect over map bounds, `fill="rgba(40,40,40,1)"` (useSvgStaticContent.ts:324-332; `BACKGROUND_RGB = "40,40,40"`).
  2. One tile per non-void cell: `<g transform="translate(x,y)"><svg x="0" y="0" width="36" height="36" viewBox="0 0 36 36" overflow="hidden">[<g transform="rotate(N 18 18)">]<use href="#tile-r{regionId}-{kind}" width="36" height="36"/></g></svg></g>` (getTileSvg, useSvgStaticContent.ts:241-264). The nested `<svg overflow=hidden>` clips theme ink that overflows the cell; rotation is around the cell center.
  3. Rotation: catalog maps draw `Math.floor(mulberry32(map.seed)() * 4) * 90` per tile (useSvgStaticContent.ts:334-341); progressive maps use `progressiveTileRotation(map.seed, worldX, worldY) * 90` from `src/sim/grid/ProgressiveMap.ts`. So **the seeded 90° rotation is the only built-in per-tile variation** — art may be asymmetric; the rotation supplies 4 looks per tile type.
  4. Full-grid stroke path, `stroke="rgba(40,40,40,0.8)" stroke-width="0.7"` (useSvgStaticContent.ts:346-376). Catalog maps: one path of all vertical + horizontal grid lines (note: drawn at `column * TILE_SIZE, 0` with no origin offset — fine because catalog maps have origin 0). Progressive maps: per-tile exposed edges via a `drawnEdges` dedupe set (useSvgStaticContent.ts:347-367).
  5. Spawn markers: `<use id="spawn-{i}" href="#spawn-closed" x y width=36 height=36>` (useSvgStaticContent.ts:378-383). `SpawnManager` (src/render/svg/SpawnManager.ts) finds `#spawn-{i}` and swaps `href` between `#spawn-closed/transition/open` per frame state.
  6. Base: themed SVG if `region.base` is non-empty, else the procedural fallback `renderBaseSvg` (useSvgStaticContent.ts:16-103 — rounded rect + 4 gems + hex emblem, uses `url(#base-gradient)` and `var(--color-accent)` / `var(--color-gem)`). Wrapped in `<g id="base-structure" transform="translate(...)">` at `(base.x-1)*36, (base.y-1)*36` (useSvgStaticContent.ts:271-278).
  7. Red base-edge glow: one `<line>` per exposed base edge from `grid.getBaseEdgeSegments()`, `stroke="rgba(255,40,40,0.85)" stroke-width="2" filter="url(#glow)"` (useSvgStaticContent.ts:393-398).
- The layer is rebuilt only when `currentMap` changes (map load, progressive board growth). It is **not** touched per frame; per-frame work lives in the entity/projectile/effect/ui layers. Static art richness is free at runtime; only the one-time string size grows.

**Theme contract** — `src/content/schemas/theme.ts` + `src/render/themes/MapThemeHowTo.md`:
- `RegionVisualSchema` (theme.ts:83): `tiles` is exactly `{ path, terrain1, terrain2, terrain3, terrain4 }`, plus `base`, `mapImage`, `mapLayout`. Top-level optional: `menuBackground`, `spawns { closed, open, transition }`.
- **Hard test rule** — `tests/unit/map-theme.test.ts:385-411` "paints sprites without document-scoped paint servers": for every tower frame, enemy frame, tile, base, and spawn string, asserts `image.includes("url(#") === false` and `image.includes("<filter") === false`; `mapImage` and `menuBackground` get the same two assertions in separate blocks (`:421-427`, `:450-453`). All theme art is flat fills/strokes only. CSS `var(...)` is allowed (the procedural base already uses `var(--color-gem)` = `#9be7ff`, `var(--color-accent)` = `#d9a441`).
- Tile edges: the outer ~3px must be one flat fill so rotated neighbors meet; keep motifs ~3px in from the edge (MapThemeHowTo.md:191). A straight lane stripe on path tiles is ruled out — random rotation would point it in random directions.
- Symbol ID contract, asserted by tests: `tile-r{regionId}-{path,terrain1..4}`, `spawn-{i}` use elements, `rotate((90|180|270) 18 18)` format, `<g id="base-structure">` wrapper, procedural fallback uses `url(#base-gradient)` when `region.base` is empty (map-theme.test.ts:641-719).
- Terrain height 1–4 is gameplay data: `terrainHeightRangeBonus [0.25, 0.5, 1.0]` tiles per height step and `terrainHeightBonusPct [0.05, 0.1, 0.2]` damage, in `src/content/data/economy.json`; applied in `Tower.ts:529-540` (`range += bonusPerHeight * this.terrainHeight`, `damage *= min(TERRAIN_DAMAGE_BONUS_MAX_MULT, 1 + bonusPct * this.terrainHeight)`, gated on the `terrainHeightRangeBonus` / `terrainHeightBonus` general addons being unlocked). The height ramp is the most gameplay-relevant thing the map art encodes.

## 3. Current State of Polymath (baseline facts)

`src/render/themes/data/default-map-theme.json` (119 KB). Full current tile values:

| Region | Path | terrain1 → terrain4 |
|---|---|---|
| 0 Verdant Marches | `#4a3d28` | `#4e824e → #427542 → #366836 → #2a5a2a` (even ramp, darker with height — good) |
| 1 Sunscorch Coast | `#b8a56a` | `#1a3a5c → #a0896a → #6b5a3e → #0d0d0d` (blue → sand → brown → near-black: non-monotonic, broken) |
| 2 Thornpeak Wilds | `#3a322a` | `#4e443a → #6a5d52 → #7a6c5e → #8a7d6a` (lighter with height — inverted vs convention) |

Every terrain tile is `<svg viewBox="0 0 36 36"><rect width="36" height="36" fill="{color}"/><path d="M7.2,7.2 L28.8,28.8 M28.8,7.2 L7.2,28.8" stroke="rgba(0,0,0,0.12)" stroke-width="0.5"/></svg>` — a flat fill plus a near-invisible placeholder X. Path tiles are the bare flat-fill rect only. All three regions ship `base: ""` (procedural fallback). Spawns are a thin red `#e85a6a` crosshair (closed) / 4-chevron (open) / mixed (transition) at 2.5px stroke. Towers are line-art math glyphs using `currentColor`. Aftermath (`the-aftermath.json`, 438 KB) is the in-repo proof that the flat-fill rule can look rich: layered ellipses/blobs at varying opacity, ~672–950 bytes per tile.

**Reference quality data points:**
- Aftermath height ramp: `#d4b494 → #b08a68 → #8c6244 → #6a4630` (darker with height).
- Progressive preview palette (`src/components/progressivePreview.ts:3-4`): `PATH_FILL = "#d7b072"`, `TERRAIN_FILLS = ["#6e8f7a", "#4d6658", "#2c3a32", "#1b2620"]` — hardcoded, matches no region, and is darker-with-height.
- `--color-gem: #9be7ff`, `--color-accent: #d9a441` (src/App.vue:14-33).

## 4. Work Items

### P0 — Rework the 15 Polymath tile images

New generator `src/render/themes/scripts/gen_polymath_tiles.py`, following the existing conventions in `src/render/themes/scripts/gen_theme_images.py` and `region_map_art.py`:
- Deterministic/seeded emission of the 15 tile SVG strings (plus the P2 base/spawn strings in the same script, or a sibling `gen_polymath_basics.py` — implementer's choice, one script preferred).
- Patches the JSON **in place, line by line**, preserving all other bytes (the `gen_theme_images.py` pattern: regex `^([ \t]*"terrain1": ")(.*)(",)$` per field). Do not re-serialize the whole JSON.
- Writes a preview to `tmp/polymath-tile-preview/` (project tmp/ dir per AGENTS.md): one HTML page showing all 15 tiles × 4 rotations at 36px, 108px, and 324px, in region order. Regenerate previews before committing the JSON patch. From P2 on, the page also renders the three region bases (unrotated) and the three spawn states.
- Generator invariant: the **first** `fill="#..."` in each tile SVG is the field-fill rect (full 36×36). The shared `fieldFillOf` helper (P1/P3) relies on this.

**Ramps** (darker with height, perceptually even steps; starting points for the generator to refine):
- Region 0 Verdant (path `#4a3d28`): keep `#4e824e → #427542 → #366836 → #2a5a2a`.
- Region 1 Sunscorch (path `#b8a56a`): replace with `#a08a5c → #8a734a → #6f5a3a → #52422c`.
- Region 2 Thornpeak (path `#3a322a`): flip to `#8a7d6a → #746a59 → #5f5748 → #4e443a`.

**Motif families** (engineering-drawing voice; 2–4 line elements per tile; strokes in the field color darkened ~25% at ~35–50% opacity, 0.5–1px width, ≥3px inside the edge):
- Verdant: grass-tick groups (2–3 short near-parallel strokes), small meadow arcs. Height 4 adds a pair of short concentric contour arcs.
- Sunscorch: dune swash arcs (open arcs, round line caps), 2 pebble dots. Height 4 adds angular crack polylines (2–3 segment zigzags).
- Thornpeak: rock-shard polygon outlines (3–5 sides), thorn V-ticks. Height 4 adds contour arcs.
- All heights: a short concentric arc "contour" stroke set whose count scales with height (1→none or 1 arc, 2→2, 3→3, 4→4 + motif) — the topographic height cue.
- **Inner edge ring on every tile** (path + terrain, all heights): a 2px rotationally-symmetric ring of the field color darkened ~30% at ~10% opacity. This replaces the gray grid as the cell-separation cue, and being symmetric it survives the random rotation.
- **Path tiles**: rotation-safe radial worn center — a central ellipse (~70% tile diameter) in the field color lightened ~10% at ~12% opacity, plus 2 small pebble dots. No straight stripe.
- Asymmetry is fine and desirable: the seeded 90° rotation gives 4 looks per tile type.
- Byte budget 300–900 per tile (Aftermath reference: 672–950).

### P1 — Grid, background, lighting (`src/render/svg/useSvgStaticContent.ts`)

**Contour edge pass** replaces the uniform grid stroke (useSvgStaticContent.ts:346-376):
- One edge walk over each non-void tile's right and down neighbors (dedupe as today), every coordinate offset by `originX`/`originY` — the current progressive branch already does this (useSvgStaticContent.ts:358-361); the catalog branch's unoffset lines are replaced. Classify each interior edge into up to three `<path>` d-strings:
  - **Nothing**: same-height terrain↔terrain (Δ=0) and path↔path (spawns count as path; base counts as path).
  - **Curb**: terrain↔path boundary (any height): `stroke="rgba(0,0,0,0.35)" stroke-width="0.75"`.
  - **Cliff**: terrain↔terrain with Δ≥1: `stroke="rgba(0,0,0,0.45)"`, width 1.2 for Δ=1, 1.8 for Δ≥2. The higher tile's side is the cliff face (the edge segment is shared; one stroke suffices, but the color/width comes from the Δ).
  - **Map border**: non-void tile edge meeting void/out-of-bounds: `stroke="rgba(0,0,0,0.5)" stroke-width="1"`. For progressive maps the border is the stamped board footprint (replaces the current per-tile exposed-edge loop, useSvgStaticContent.ts:347-367). Applies to catalog maps too — one consistent treatment (moved here from §9, which had it as a decided "open" item).
- All three paths share `fill="none"` `stroke-linecap="round"` `stroke-linejoin="round"`.
- Tile heights for classification: `map.tiles` (`tile.height`, terrain 1–4; path/spawn/base height 1). Void tiles are `type: "void"`.
- The `getBaseEdgeSegments()` red glow layer (useSvgStaticContent.ts:393-398) is unchanged and stays last.

**Vignette:**
- Add `<radialGradient id="map-vignette">` to `mapDefsContent` (useSvgStaticContent.ts:289): stops transparent at ~55%, `rgba(0,0,0,0.32)` at 100%, `cx/cy 50%`, `r 75%`.
- Draw one `<rect>` over the map bounds (same bounds as the background rect, originX/originY + width/height in px) **after** the contour paths and **before** the spawn markers, so spawns, base art, and the red edge glow stay bright.
- Gradients in code-generated `<defs>` are fine — the paint-server test only covers theme sprite strings.

**Region-toned backdrop:**
- Replace `BACKGROUND_RGB = "40,40,40"` (useSvgStaticContent.ts:324) with a per-region derived tone: parse the first `fill="#..."` of the active theme's region `terrain2` tile SVG and scale its RGB toward black by ~35%. Parse via a new shared `fieldFillOf` in `src/render/themes/fieldFill.ts` (created in this step; P3's progressive preview fills import the same parser — one parser, no duplicated regex); only the scale-to-black math stays local (~15 lines). Falls back to `40,40,40` if parsing fails.
- Do **not** add a top-light gradient this round; revisit only if the vignette reads flat.

### P2 — Base and spawn art (theme JSON, via the generator)

**Three 108×108 region bases** (viewBox `0 0 108 108`, placed by the existing wrapper at `(base.x-1)*36, (base.y-1)*36` spanning 3×3 tiles; the current procedural base is ~97px of content in a 108 box, useSvgStaticContent.ts:16-22). **Authoring caveat:** `renderBaseStructure` runs the themed base through `stripSvgWrapper` (useSvgStaticContent.ts:271-278), so the outer `<svg viewBox="0 0 108 108">` is discarded and the content is inserted 1:1 into the translated `<g>` — the authored viewBox is decorative, coordinates must be absolute 0–108, and there is no overflow clipping (unlike tiles' nested `<svg overflow="hidden">`), so keep all ink inside 0–108. Design, all flat fills/strokes:
- Chamfered-square plinth inset ~8px: fill = region dark tone (terrain3 color darkened ~20%), stroke = region accent at ~60% opacity, 1.5px.
- 8-ray compass rose centered, accent color at ~25% opacity, 1px.
- Nested hex core (radius ~26/14): outer hex accent-soft (accent at ~18% opacity), inner hex accent fill, plus a small white highlight dot at ~45% opacity (mirrors the procedural emblem's grammar).
- Four gem inlays near the plinth corners: `fill="var(--color-gem)"` circles r≈4 with a white highlight dot (same pattern as renderBaseSvg, useSvgStaticContent.ts:59-69).
- Region accent choices (generator finalizes): Verdant green `#6abf6a`, Sunscorch amber `#d9a441`, Thornpeak bone/steel `#b8b0a0`. Verdant is byte-identical to the existing `--color-region-0` and Sunscorch to `--color-accent` (App.vue:22,41); emit the literal hexes so the theme stays self-contained, with the CSS vars remaining the canonical UI copy.
- Must pass the paint-server test (no `url(#`, no `<filter>`) and keep working inside the existing `<g id="base-structure">` wrapper (map-theme.test.ts:683-719 assert the wrapper id and that a non-empty `region.base` is inserted verbatim and without `url(#base-gradient)`).

**Three spawn states (36×36)**, keeping the universal red `#e85a6a` (entry = danger):
- closed: solid ring r≈12 (2px) + 4 cardinal hatch ticks (8px long, 2px, round caps) + center dot r≈2.5.
- transition: dashed ring (`stroke-dasharray="5 4"`) + 4 inward ticks.
- open: solid ring + 4 outward chevrons (replacing the current 4-line burst).
- Spawn symbols are theme-global (one set for all regions) — the `spawns` object, not per-region.

### P3 — Elevation feedback

**Range-bonus visualization in the build preview:**
- `SvgGameRoot.vue:180-190` already computes `buildRangeTiles` = base range + `TERRAIN_HEIGHT_RANGE_BONUS[rangeTier] * terrainHeight` when the addon is unlocked, and passes it at SvgGameRoot.vue:930 into `EffectManager.syncBuildPreview` (EffectManager.ts:454-557), which draws `buildRangeCircleEl` at the boosted radius (EffectManager.ts:517-526).
- Draw the unboosted base-radius circle inside `syncBuildPreview` itself — no new parameter, no signature change, no signature-string change: the method already receives `selectedTowerType` and has `TOWER_BASE` imported (EffectManager.ts:521), the base radius is a pure function of tower type, and visibility reduces to `buildRangeTiles > baseRange`, so the existing preview signature (`posKey|type|valid|origin|rangeKey`, EffectManager.ts:466) already dirty-checks every input.
- The new element: a dashed accent-colored circle (`stroke="var(--color-accent)"` `stroke-opacity="0.7"`, `stroke-dasharray="4 3"`, no fill) created in `init`, shown at the base radius inside the existing solid boosted-radius circle only when boosted > base, so the +0.25…+1.0 tile contribution is legible while placing; hide it in the no-preview else branch (EffectManager.ts:550-555). Keep it accent-colored regardless of build validity — only the boosted circle flips red when invalid (EffectManager.ts:525). Splash circle unchanged.

**Progressive preview palette** (`src/components/progressivePreview.ts`):
- Drop the hardcoded `PATH_FILL`/`TERRAIN_FILLS` (lines 3-4).
- Reuse `fieldFillOf` from `src/render/themes/fieldFill.ts` (created with P1's backdrop parse) — returns the first `fill="(#[0-9a-fA-F]{3,8})"` match (the generator guarantees the field rect is the first fill), with a neutral fallback.
- Thread a theme + region reference into `progressivePreviewFill` and `progressivePatternMarkup`:
  - `ProgressivePlacement.vue:74` (block offer cards, `progressivePreviewFill` call in `previewCells`) — `themeStore` is at ProgressivePlacement.vue:13/17; region id from `gameStore.map.regionId ?? 0`.
  - `SvgGameRoot.vue:210` (on-map ghost, `progressiveGhost` computed) — has `themeStore` (SvgGameRoot.vue:105).
  - `progressivePatternMarkup` calls `progressivePreviewFill` internally (progressivePreview.ts:37) — thread the args through that internal call too.
- The card/ghost fills then match the live tiles of the active theme and region.

### P4 — Entity polish

**Ground shadows** (injected in `buildSymbolsFromConstants`, useSvgStaticContent.ts:138-193, so they apply to every theme uniformly):
- Tower symbols (viewBox `-16 -16 32 32`): prepend `<ellipse cx="0" cy="0" rx="9.5" ry="9.5" fill="rgba(0,0,0,0.30)"/>` to each frame's inner content. Symmetric, so tower barrel rotation is safe.
- Enemy symbols (viewBox `-1 -1 2 2`): prepend `<ellipse cx="0" cy="0.62" rx="0.72" ry="0.3" fill="rgba(0,0,0,0.30)"/>` to walking, hit, and attack frames (boss rx≈0.85 — the boss body fills more of the viewBox; detect boss frames by the theme record key `typeId === "boss"` in `activeTheme.enemies`). Symmetric under the `scale(-1,1)` mirror flip EnemyManager applies; a static shadow under the walking bob reads as grounding.
- Apply to hit/attack frames too so there is no shadow pop when frames swap.

**Build/selection circle styling** (`src/render/svg/EffectManager.ts`):
- Selected-tower range circle (EffectManager.ts:126-131 created; :607-611 shown): add `fill="rgba(0,255,0,0.05)"` **at creation** — the show branch only rewrites stroke/r/transform, so creation is the one cached place to set it; keep the shown `rgba(0,255,0,0.6)` stroke (the white `rgba(255,255,255,0.4)` at creation is overridden whenever the circle is shown).
- Build preview range circle: add `fill="rgba(255,255,255,0.04)"` (EffectManager.ts:517-526); the `stroke-dasharray="4,3"` is already set at creation (EffectManager.ts:146), so no change there.
- Build preview tile rect fill already green/red at 0.3 alpha (EffectManager.ts:480) — unchanged.

**Spawn pulse:**
- Add `class="spawn-marker"` to the spawn `<use>` elements in gridContent (useSvgStaticContent.ts:382; SpawnManager only touches `href`, so the class survives).
- Global keyframes in `src/App.vue` next to the existing `siteDropPulse` (App.vue:86-103): `@keyframes spawnPulse { 0%,100% { opacity: 0.75; } 50% { opacity: 1; } }` and `.spawn-marker { animation: spawnPulse 2.4s ease-in-out infinite; }`. Respect the existing `prefers-reduced-motion` block if present around App.vue:103.

**HP bars: no change.** Background, border, and green/yellow/red value ramp already exist (UiOverlayManager.ts:54-77 for the pool, :257 and :360 for the ramp).

**Deferred (not this round):** animated path-flow dashes along the worker-shipped `paths` polylines (the text renderer already consumes them, TextPathRenderer.ts); P5 region-map/menu art via `region_map_art.py` / `menu_background_art.py`.

## 5. Files Touched

| File | Change |
|---|---|
| `src/render/themes/data/default-map-theme.json` | 15 tiles + 3 bases + 3 spawns re-authored (via generator, in-place line patch) |
| `src/render/themes/scripts/gen_polymath_tiles.py` | New deterministic generator: emits tile/base/spawn SVG, patches JSON lines, writes `tmp/polymath-tile-preview/` |
| `src/render/themes/fieldFill.ts` | New: shared `fieldFillOf` first-fill parser (created with the P1 backdrop parse; P3 preview fills reuse it) |
| `src/render/svg/useSvgStaticContent.ts` | Contour edge pass (replaces uniform grid), vignette gradient + rect, region-toned backdrop, entity shadow injection in `buildSymbolsFromConstants`, `spawn-marker` class on spawn uses |
| `src/render/svg/EffectManager.ts` | Dashed base-radius circle in build preview (base range computed from `TOWER_BASE` inside `syncBuildPreview`), selected/build circle fills |
| `src/components/SvgGameRoot.vue` | Pass theme/region into `progressivePatternMarkup` (SvgGameRoot.vue:210) |
| `src/components/ProgressivePlacement.vue` | Pass theme/region into `progressivePreviewFill` (line 74) |
| `src/components/progressivePreview.ts` | Theme-driven fills replacing hardcoded palette (theme/region args threaded through both functions and the internal call at progressivePreview.ts:37) |
| `src/App.vue` | `spawnPulse` keyframes + `.spawn-marker` class |
| `tests/unit/map-theme.test.ts` | New tests (below); keep all existing assertions |
| `tests/unit/components/progressive-preview.test.ts` | Update to theme-driven fills/signature (palette asserted at :15-24, :56-58, :199-205; details in §6) |

## 6. Tests

**Keep (must not break):**
- `tile-r{regionId}-{path,terrainN}` `<use>` hrefs in gridContent (map-theme.test.ts:654-655).
- Per-tile viewport markup `<svg x="0" y="0" width="36" height="36" viewBox="0 0 36 36" overflow="hidden">` and rotation format `rotate((90|180|270) 18 18)` (map-theme.test.ts:656-662).
- Spawn `<use id="spawn-N" href="#spawn-closed" x=".." y=".." width="36" height="36"/>` — asserted as an exact substring via `toContain` (map-theme.test.ts:677-679). Adding the `spawn-marker` class anywhere inside that tag breaks the match, so **update those three expected strings to include the class** (e.g. `class="spawn-marker"` before `/>`) in the same change.
- Base placement: `<g id="base-structure">` wrapper, verbatim themed base insertion, no `url(#base-gradient)` when themed (map-theme.test.ts:683-718).
- Paint-server rule on all sprite strings (map-theme.test.ts:385-411) — the new art must pass it.

**Add:**
- Ramp monotonicity: parse each region's terrain1–4 field fill (first `fill="#..."`), compute relative luminance, assert non-increasing across height for both shipped themes (Aftermath already complies).
- First-fill invariant: for every shipped theme tile (Polymath and Aftermath), the first `fill="#..."` is a full-bleed `36×36` rect at `0,0` — P1's backdrop parse, P3's `fieldFillOf`, and the ramp test all read through this invariant, and P1's failure mode is a silent fallback to `40,40,40`, so pin it directly.
- Contour pass: a small map with a height step (e.g. terrain h1 next to terrain h2, plus a terrain/path border) produces the cliff/curb stroke paths — give each classified `<path>` a `data-edge="curb|cliff|border"` marker and assert on that, not on `rgba(...)` strings — and same-height terrain neighbors produce no interior edge segment.
- progressivePreview: `progressivePreviewFill` returns the theme's field fills for a mock theme whose tile SVGs carry known fills. Updating the existing suite touches three palette-assertion sites (tests/unit/components/progressive-preview.test.ts:15-24, :56-58, :199-205) and two direct `progressivePatternMarkup` calls that must pass the new args (:195, :206); the mounted `ProgressivePlacement` card test has no theme in the store (`defaultTheme` stays `null` until the async `preloadDefault()`, stores/mapTheme.ts:19,24), so it preloads a mock theme or asserts the fallback.
- Shadow injection: `staticDefsContent` for a mock theme contains the shadow ellipse in tower and enemy symbols (mock theme's own art is unchanged apart from the prepended shadow — assert the ellipse string).

## 7. Verification

1. `npm run check` (biome lint + `tsc --noEmit` + `scripts/check-sim-boundary.sh` + vitest) after each work item.
2. Generator previews in `tmp/polymath-tile-preview/` (15 tiles × 4 rotations at 36/108/324px; from P2 on, the three bases and three spawn states) reviewed before the JSON patch lands.
3. Dev-server (`npm run dev`, port 3000) visual pass:
   - One catalog map per region (3 regions, a few seeds each) at fit-zoom and ~3× zoom: ramp readability, motif density, contour lines, vignette, backdrop tone.
   - A progressive run: block offer cards and the on-map ghost use the live region palette (P3), placement + undo still renders correctly, progressive contour/border edges.
   - Build preview on height-1 vs height-4 terrain with the range addon unlocked: dashed base-radius circle appears inside the boosted circle.
   - Spawn pulse, base art per region, entity shadows at 3× zoom.
   - Aftermath theme still loads and passes the paint-server test (untouched, regression check only). P4's shadow injection applies to every theme uniformly, so spot-check Aftermath tower/enemy shadows at zoom too.

## 8. Execution Order

1. P0: generator + tile rework + preview review → JSON patch.
2. P1: contour pass + vignette + backdrop → `npm run check`.
3. Visual checkpoint (fit + zoom).
4. P2: base + spawn art via generator.
5. P3: range-bonus circle + progressive preview palette.
6. P4: shadows, circle styling, spawn pulse.
7. Test additions, full `npm run check`, dev-server pass per §7.

## 9. Open Items (decide during implementation, no user input needed)

- Exact motif counts/opacities: tune against the 36px preview first (that is the gameplay zoom), then confirm at 3× zoom.
- Vignette strength (0.32 at edge) and backdrop scale factor (0.35) are starting points; nudge ±20% if the map reads too dark or too flat.

---

# Round 2: Tile Art And Site Art Redesign

Sections 1–9 above are the original round and are left exactly as executed. Everything below is
additive: §10 records where the execution diverged from §1–9, §11 is the plan this round executes.
The grid contour pass, the vignette, the region-toned backdrop, the progressive preview palette, the
build-preview base-radius circle, and the spawn pulse all shipped and are kept as-is.

## 10. Differences From The Original Plan (as executed)

| Area | Plan said | What shipped | Why |
|---|---|---|---|
| P4 ground shadows | Inject a `rgba(0,0,0,0.30)` ellipse into every tower and enemy symbol frame | **Removed.** Entity symbols start directly with the theme frame content | Manual follow-up tweak: at map zoom the ellipses read as dirt halos under every unit and flattened the sprites against the tiles. `tests/unit/map-theme.test.ts` now pins the absence so it cannot creep back. |
| Spawn marker ownership | Spawn `<use>` elements emitted inside the `gridContent` `v-html` string, plus a `spawn-marker` class for the pulse | `SpawnManager` creates and owns its `<use>` nodes in a dedicated `<g class="spawn-layer">` (`SvgGameRoot.vue:11`), still carrying the class | The `v-html` grid layer replaces its children whenever the string changes (`currentMap`, the active theme, or `currentGrid` all feed it), which detached the nodes `SpawnManager` had captured, so the closed/transition/open href flips stopped reaching the DOM after any grid rebuild. Positions are byte-identical to the old `originX + spawn.x * TILE_SIZE` math. |
| `spawns.open` color | Keep the universal red `#e85a6a` for all three states (entry = danger) | `open` is green `#6abf6a`; `closed` and `transition` stay red | Green reads as "flowing" rather than "safe", and the three states are already separated by geometry (hatch ticks / dashed ring + inward ticks / outward chevrons). Kept as a deliberate deviation. |
| Terrain motif family | Engineering-drawing line work: contour arcs plus 2–4 region marks per tile | Shipped, then rejected on visual review — see §11.1 | Concentric arcs with a per-tile random start angle and 0.5–1.6px specks at 0.18 opacity read as noise, and only 4 rotations exist per tile kind, so any mark becomes a stamp. |
| `data-edge` test markers | One marker per classified path | `cliff` was emitted for both the Δ1 and the Δ≥2 path | Two `<path>` elements with the same `data-edge` value; the count helper matched only the first. Split into `cliff-thin` / `cliff-thick` in this round. |
| Paint-server test | Keep the existing single-theme sweep (`map-theme.test.ts:385`) | Generalized to both shipped themes in the new `Theme tile art` block | The new both-themes sweep subsumes it; the old duplicate is deleted. Extended to site art this round. |
| Generator asserts | Flat-paint rule, first-fill invariant, byte budget, preview page | All shipped, plus an in-bounds coordinate check | The bounds check caught nothing in round 1 but is the cheap guard that lets art be re-tuned freely. |

Kept exactly as planned: the contour edge pass (including the catalog origin-offset fix and the
map border), the vignette gradient and its draw order, the region-toned backdrop parsed through the
new `src/render/themes/fieldFill.ts`, the three 108×108 region bases, the three spawn states, the
dashed base-radius circle in the build preview, the selected/build circle fills, and the theme-driven
progressive preview fills. The per-tile inner ring also stays — it is the softened cell separation,
and it is rotationally symmetric so random rotation cannot break it.

## 11. Plan: Soft-Blob Terrain Tiles And Custom Site Art

### 11.1 Why the shipped terrain art failed, and the replacement

Every shipped terrain tile is `<field rect><inner ring><4 concentric arcs><4-6 scattered marks>`:

- `contour_arcs` (the shipped generator) emitted up to 4 arcs of radius 6.5→14, 100° sweep, at
  0.4 opacity with a **per-tile random start angle** (`base_angle = rng.uniform(0, 360)`). Rotated
  neighbors therefore show arc fragments that do not continue each other, which is exactly the
  "odd pattern" read.
- `motif_scatter` emitted 0.5–1.6px marks (dots, dashes, ticks, L-hooks, chevrons, crosses) at
  0.18–0.2 opacity — below the threshold where a mark reads as texture and above the threshold where
  it reads as intentional, so it registered as sensor noise.

**Replacement: a soft-blob terrain tile.** Field rect + inner ring + three large low-opacity ellipses,
nothing else. This is the construction that already ships in `the-aftermath.json` (region 0
`terrain1`: field + `ellipse rx=11 ry=8 fill=#e0c4a4 opacity=0.42` + `ellipse rx=6 ry=5` +
`ellipse …`, 743 bytes) and it survives random rotation and repetition because a soft blob has no
recognizable orientation and no silhouette to memorize.

| Element | Spec |
|---|---|
| Field rect | Unchanged: first `fill="#…"`, full-bleed 36×36, the height ramp color. The first-fill invariant (`fieldFillOf`, the backdrop parse, the ramp test) depends on this staying first. |
| Inner ring | Unchanged: `rect x=1 y=1 width=34 height=34 stroke-width=2 opacity=0.1`, field darkened 30%. Symmetric, so rotation is free. |
| Light pool | 1 ellipse, rx/ry 8–11, field lightened 5–7%, opacity 0.30 (height 1) → 0.42 (height 4). |
| Shadow drift | 1 ellipse, rx/ry 7–10.5, field darkened 6–8%, opacity 0.28 → 0.40. |
| Accent drift | 1 small ellipse, rx/ry 4.5–6.5, field darkened 10%, opacity 0.22 → 0.32. |
| Nothing else | No arcs, no specks, no strokes. |

Geometry constraints the generator asserts per variant: ellipse centers within ±5 of (18,18); every
extent inside `[3.5, 32.5]` so the outer band stays one flat fill and rotated neighbors meet; all four
heights share the same construction so the family reads as one continuous surface with only the ramp
color and the blob amplitude changing. The generator enforces a 350–900 byte budget per tile; the
shipped terrain tiles land at 429–436 bytes and the path tiles at 412–483.

**Path tiles keep their construction.** Same `path_tile()` build — field rect + inner ring + worn
center ellipse + 2–3 small marks — and the same seed (`9000 + regionId * 100 + kindIndex` with
`kindIndex == 0` for `path`), so the validated path art stays put. The one addition is the edge-band
constraint below, which shifts a mark by fractions of a pixel (the shipped Thornpeak path tile has a
0.74px pebble at cx 32.43, so it reaches 33.17 and has to move in).

Ramps are unchanged from §4 P0 (darker with height): Verdant `#4e824e → #427542 → #366836 → #2a5a2a`,
Sunscorch `#a08a5c → #8a734a → #6f5a3a → #52422c`, Thornpeak `#8a7d6a → #746a59 → #5f5748 → #4e443a`.

### 11.2 Tile variants (the repetition fix)

Five images per region over a 30×20 board means one stamp per height blob, and rotation only supplies
4 looks. Fix: 3 variants per tile kind.

- **Schema** (`src/content/schemas/theme.ts:83`): each `tiles` field becomes
  `z.union([z.string(), z.array(z.string()).min(1)])`.
- **Normalize** (`src/render/themes/normalize.ts:85`): every tile field resolves to `string[]`, variant 0
  first, so `the-aftermath.json` keeps its current single-string form untouched and `RegionVisualMeta.tiles`
  (index.ts:70) becomes `Record<TileKind, string[]>`.
- **New module** `src/render/themes/tileArt.ts`: `TILE_KINDS`, `tileImagesOf(tiles, kind)`, and
  `tileSymbolId(regionId, kind, variantIndex)` → `tile-r{regionId}-{kind}` for variant 0 (the id
  documented in `MapThemeHowTo.md` and asserted in `map-theme.test.ts`) and `tile-r{regionId}-{kind}-v{n}`
  beyond it.
- **Symbols** (`useSvgStaticContent.ts:216`): 45 symbols for a 3-variant theme instead of 15. Static
  content, rebuilt only on theme/map change, so runtime cost is one-time.
- **Variant pick** (`getTileSvg`, `useSvgStaticContent.ts:242`): a hash of `(map.seed, absoluteTileX,
  absoluteTileY)`, mirroring `progressiveTileRotation` (`ProgressiveMap.ts:168`). Deliberately a hash
  and not the sequential `mulberry32(map.seed)` cursor used for rotation, so a tile's variant is stable
  across progressive board growth and independent of iteration order.
- `fieldFillOf` reads variant 0, so the region-toned backdrop and the progressive preview fills are
  unaffected.
- Generator preview grows to 15 kinds × 3 variants × 4 rotations, each variant row at 36px and
  108px plus a 324px hero of variant 0, and gains a stitched 14×9 map mosaic per region at 36px and
  72px — a mosaic is the only view that shows whether a variant set still repeats visibly, because a
  real map groups a height into a contiguous blob rather than alternating cells.

### 11.3 Building / cache / boss-package art

Today these are procedural marks in `MapSiteLayer.ts`: `cacheGlyph` (:119) and `buildingGlyph` (:145)
draw a flat 16px `rect` plus an `<text>` glyph (`iconText`, :155) from `BUILDING_ICONS` (`mapSites.ts:47`),
and `dropGlyph` (:102) draws a diamond plus a pulsing ring.

- **New optional theme block** (`RawMapThemeSchema`, theme.ts:100):
  `sites: { buildings: { armory, magazine, ward, beacon }, caches: { sealed, unlocked, broken }, supplyDrop?: string }`,
  normalized to a `SiteArtMeta` in `themes/index.ts` + `normalize.ts`. Aftermath ships none and keeps
  the current procedural marks.
- **Symbols** from `buildSymbolsFromConstants` (theme-static defs, present before `mapSiteLayer.init`):
  `site-building-{kind}`, `site-cache-{state}`, `site-supply-drop`, all `viewBox="0 0 36 36"` so site
  art is authored in the same coordinate space as tiles and base art.
- **Size**: `GLYPH_SIZE` 16 → **26** world px, authored at 36×36. `siteHover.ts:6`
  `BUILDING_HOVER_HALF` 9 → 14 to match (13 half-width plus the pixel of grace the constant has always
  carried). `PACKAGE_CLICK_RADIUS_TILES` (0.75 tiles = 27px) is the
  click/hover agreement contract and does not change. The cache HP bar re-anchors above the 26px box.
- **Art**: each building is a silhouette that reads without color (armory = blade rack, magazine =
  stacked shells, ward = buttressed shield, beacon = lamp tower), three tones — footprint shadow
  `rgba(0,0,0,0.25)`, body, highlight — in its existing `BUILDING_COLORS` hue with a 1px `#1a1a1a`
  outline, standing on a plinth so it sits on the tile instead of floating. Caches keep the current
  browns (`#8a6230` body / `#4a3018` outline / `#f4e6cc` ink) and separate the three states by
  geometry: `sealed` = shut lid + lock plate, `unlocked` = lid raised + light shaft, `broken` = lid
  ajar, cracked plates, spilled contents.
- **Supply drop**: the pulsing ring stays its own stroked `<circle class="site-drop-pulse">` — the
  keyframes in `App.vue:86-100` animate `stroke-opacity`/`stroke-width`, so that element must remain
  stroked — and only the inner diamond is replaced by theme art.
- `siteGlyphMarkup` takes the site art so the progressive placement ghost (`SvgGameRoot.vue:276`) draws
  the same marks as the live layer.
- `aria-label` text is unchanged (it feeds `svg-map-site-layer.test.ts` and the hover tooltip).

### 11.4 Review fixes folded into this round

1. `useSvgStaticContent.ts:341-342` emits `data-edge="cliff"` twice (Δ1 and Δ≥2). Split into
   `cliff-thin` / `cliff-thick`; the count helper in `map-theme.test.ts` only ever matched the first.
2. `regionBackdropRgb` (`useSvgStaticContent.ts:357`) runs `parseInt` over a hex slice with no
   validation while `fieldFillOf` accepts 3–8 digits, so an `#rrggbbaa` or malformed fill yields
   `rgba(NaN,NaN,NaN,1)` — invalid paint, backdrop silently gone, no fallback. Add one
   `hexChannels` helper to `fieldFill.ts`, guard non-finite, fall back to `40,40,40`. The same helper
   replaces the hex-expansion copy in the test's `relativeLuminanceOfHex`.
3. Delete the duplicate single-theme paint-server test (`map-theme.test.ts:385`); the both-themes
   sweep supersedes it. Extend that sweep to site art.
4. `EffectManager.ts:539` — the dashed base-radius circle shares `stroke-width=1.5` and
   `stroke-dasharray="4,3"` with the boosted circle, so at the smallest boost (0.25 tiles = 9px) the
   two dash patterns merge. Inner circle gets `stroke-dasharray="2 4"`.
5. `MapThemeHowTo.md:191` is wrong twice: the "0.7px grid stroke over the tile boundary" no longer
   exists (the contour pass replaced it), and the shipped tiles deliberately stroke the edge band
   with the symmetric inner ring. Rewrite the rule, document variants, add a Site Art section and
   the new symbol ids.

### 11.5 Files touched

| File | Change |
|---|---|
| `src/content/schemas/theme.ts` | Tile image union; new optional `sites` block |
| `src/render/themes/index.ts` | `RegionVisualMeta.tiles` → `string[]`; new `SiteArtMeta` |
| `src/render/themes/normalize.ts` | Tile fields → arrays; `normalizeSiteArt` |
| `src/render/themes/tileArt.ts` | New: `TILE_KINDS`, `tileImagesOf`, `tileSymbolId` |
| `src/render/themes/fieldFill.ts` | Add `hexChannels`; shared by backdrop and tests |
| `src/render/svg/useSvgStaticContent.ts` | Variant symbols + hashed variant pick, site symbols, `cliff-thin`/`cliff-thick`, `hexChannels` guard |
| `src/render/svg/MapSiteLayer.ts` | Site-art parameter, `<use>` glyphs at 26px, procedural fallbacks kept |
| `src/render/svg/siteHover.ts` | `BUILDING_HOVER_HALF` 13 |
| `src/render/svg/EffectManager.ts` | Inner base-range circle dash pattern |
| `src/components/SvgGameRoot.vue` | Pass `activeTheme.sites` to `mapSiteLayer.init` and `siteGlyphMarkup` |
| `src/render/themes/scripts/gen_polymath_tiles.py` → `gen_polymath_art.py` | Soft-blob terrain, 3 variants, edge-band asserts, site art |
| `src/render/themes/data/default-map-theme.json` | 45 tile variants + 3 bases + 3 spawns + `sites` |
| `src/render/themes/MapThemeHowTo.md` | Tile edge rule, variants, Site Art section, symbol ids |
| `tests/unit/map-theme.test.ts` | Drop duplicate paint-server test, extend to site art, cliff markers, variant coverage |
| `tests/unit/svg-map-site-layer.test.ts` | Site-art `<use>` markup plus the fallback path |
| `tests/unit/components/progressive-preview.test.ts` | Array-shaped tile fills |

### 11.6 Tests

- Every tile kind of every shipped theme: all variants parse, each variant's first fill is the
  full-bleed 36×36 rect, no variant paints inside the 3px edge band, ramps stay monotonically darker.
- `gridContent` references `tile-r0-terrain2` for variant 0 and a `-v{n}` id otherwise, and the same
  tile coordinates resolve to the same variant across two builds.
- Site symbols exist in `staticDefsContent`; `MapSiteLayer` emits `<use href="#site-building-armory" …>`
  with its `aria-label` when art is present and the rect + `<text>` icon when it is not.
- `hexChannels` expands a 3-digit hex, parses a 6-digit hex, and returns `null` for both alpha forms
  (`#rgba`, `#rrggbbaa`) and non-hex strings, so `regionBackdropRgb` falls back instead of painting
  `rgba(NaN,NaN,NaN,1)`.

### 11.7 Execution order

1. Review fixes (§11.4 items 1, 2, 4) → `npm run check`.
2. Variant plumbing: schema → types → normalize → `tileArt.ts` → symbols + hashed pick → preview fills.
3. Generator rewrite; preview review at 36px then 108px; JSON patch.
4. Site art plumbing, then generator site art.
5. Docs, tests, full `npm run check`, dev-server pass per §7 (one map per region at fit and 3× zoom, a
   progressive run for the card/ghost palette, hover over a building and a cache for tooltip alignment).
