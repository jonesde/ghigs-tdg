# ConfigCleanup: one config import, no facade, no exported constants

## Motivation

Config values live in the Zod-validated packs under `src/content/data/*.json`, but three
facade modules still re-export them under SCREAMING_SNAKE names, and 113 files import the
facade instead of the content singleton. The facade adds a re-export layer, hand-written
duplicates of the pack's own types, and casts that hide real type information. The same
defect exists in the other direction: several pack values are hardcoded in logic because
nobody wired them up. This plan removes both.

## Research findings

**Import surface.** 113 files import from the three facade modules (60 in `src/`, 53 in
`tests/`) across 157 distinct symbols. 68 of those files import at least one config-copy
constant; 9 more import only the `TowerId`/`TowerIds` vocabulary. ~1,061 references to
copy-constant names live outside the facades.

**Two defect classes.**

1. **Facade copies.** `src/sim/Constants.ts:140-236`,
   `src/sim/ConstantsTower.ts:94-150` and `src/sim/ConstantsEnemy.ts:38-137` re-export
   `getGameContent()` values. Three exports are identity casts over the pack
   (`TOWER_META = towers.meta as Record<string, TowerMeta>`, `TOWER_ADDON_EFFECTS`,
   `ENEMY_TYPES`) that exist only because the pack's zod-inferred types were replaced by
   hand-written duplicates. Consequences already in the code:
   - `src/sim/enemies/Enemy.ts:96-115` declares `EnemyMetaRef`, a third copy of the enemy
     table, to justify `ENEMY_TYPES[type] as unknown as EnemyMetaRef` at
     `src/sim/enemies/Enemy.ts:437`. `Enemy.meta` is written at `Enemy.ts:442` and read
     nowhere in `src/`.
   - `src/sim/navmesh/CrowdManager.ts:277-278` — `void ENEMY_TYPES;` with the comment
     "Silence unused import when ENEMY_TYPES only used for documentation alignment". The
     import is genuinely unused.
   - `src/sim/ConstantsTower.ts:152-168` — `toVariantConfig()` rebuilds each variant
     object field-for-field; `TOWER_VARIANTS` is a no-op copy of `towers.variants`.
   - `src/components/StatsPanel.vue:48,100-101` reads `ENEMY_TYPES[type]?.name` and
     `?.color`. Neither field exists on the pack (names and colors live in the theme), so
     those fallbacks are permanently `undefined`.

2. **Config values hardcoded in logic instead of read from the pack.**
   - `src/sim/GameEngine.ts:871` — `afterFirstTime = afterRegion * 2` duplicates
     `economy.firstTimeMilestoneMult`.
   - `src/sim/GameEngine.ts:1003` — `const bonus = subtotal * 2` duplicates
     `economy.firstFullClearMult`.
   - `src/sim/GameEngine.ts:893` — `if (wave >= 15)` duplicates `economy.milestoneWaves[0]`.
   - `src/components/MainMenu.vue:146-147` and `src/components/PauseMenu.vue:73` — the
     difficulty slider hardcodes `min="0" max="12"`, which is
     `(difficultyMultMax - difficultyMultMin) / difficultyMultTick`.
   - `src/sim/grid/ProgressiveMap.ts:18` — `PROGRESSIVE_BLOCK_SIZE = 5` duplicates
     `maps.progressive.blockSize` (schema-pinned `z.literal(5)`), and
     `src/sim/grid/ProgressiveMap.ts:25` — `BLOCK_CENTER = 2` duplicates
     `(blockSize - 1) / 2`.
   - `src/sim/mapSites.ts:103` — `MAPS_PER_REGION = 12` duplicates `maps.mapsPerRegion`;
     `src/sim/mapSites.ts:102` — `REGION_COUNT = 3` duplicates
     `levels.length / mapsPerRegion`.

**Pack fields read by nothing.** `maps.json` `mapBaseSize`, `mapSizeScale`, `maxMapDim`,
`serpentineStep`, `serpentineDownCap`; `economy.json` `bountyBlockedRatio`,
`firstFullClearMult`, `difficultyMultMin`, `difficultyMultMax`; `towers.json` `tuning.critChance`,
`goldPerCrit`, `doubleDischargeChance`, `trueShotChance`, `markTargetDmgPct` (numerically
identical to the same keys in `addonEffects.json`, which is what the code actually reads at
`src/sim/towers/Tower.ts:579-589`), `tuning.stunShellDuration`, `tuning.multiPierceCount`;
and `towers.ids`, an array nothing reads (`TowerIds` in code is the source). Dead facade
exports: `ENABLE_SPRITE_INTERPOLATION`, `Regions`/`Region`/`RegionId` (the only use,
`tests/helpers/mock-grid.ts:106`, reads `Regions[regionId]?.name` on entries that have no
`name`, so it always falls back to `"Region"`), `WAVE_GRAPH_MAIN_OPACITY`, and the
`HEIGHT_NOISE_*` pair that `src/sim/grid/Map.ts:926-927` already reads theme-aware.

**`bountyBlockedRatio` has no rule to wire into.** `GameEngine.onEnemyKill`
(`src/sim/GameEngine.ts:940-948`) pays full bounty unconditionally. The only reference is
`tests/unit/game-engine.test.ts:285-289` ("blocked enemy gives half bounty"), which calls
`engine.earnGold(Math.ceil(2 * BOUNTY_BLOCKED_RATIO))` and asserts gold increased — a
vacuous test. Delete the field and the test.

## Rules

1. **One import for content.** `import { getGameContent } from "@/content/gameContent.js"`
   is the only way to read a pack value. No module re-exports a pack value.
2. **A pack value gets a module-local `const` only when that exact value is read 3+ times
   in the module.** Otherwise read it inline at the site. Measured across the 60 affected
   files: **73 consts justified, 214 inline sites.** The rule applies strictly, including
   per-shot and per-tick code — `getGameContent()` is a cached-null-check over a
   deep-frozen singleton (`src/content/loadGameContent.ts:11-19`), monomorphic and
   V8-inlinable.
3. **Hoisted names are camelCase, section-prefixed + pack key:** `towerBase`, `towerMeta`,
   `towerVariants`, `towerAddonEffects`, `enemyTypes`, `tierThresholds`, `mapLevels`,
   `totalMaps`, `milestoneMaxTiers`, `startingBaseHealth`.
4. **Constants are not exported.** A constant is module-local; where other modules need the
   *rule* it encodes, they get an exported **function**. Three narrow exceptions, each
   already precedented in this codebase:
   - **Protocol/vocabulary value.** `GameState` (a PascalCase enum object, 28 importers)
     and `TowerIds` (same shape, 11 importers) are vocabularies, not tunables.
   - **A value the receiver cannot compute.** `fixedDeltaSeconds` (20 test files step the
     engine by it), `gameplayEnemyCap` and `maxPendingPerSpawn`
     (`tests/unit/sim/spawn-determinism.test.ts` asserts against them), `projectileHitSlop`
     (the physics tests assert the sensor radius), `waveGraphIntervalSeconds`
     (`src/sim/SimulationSnapshot.ts:18` already exports `SNAPSHOT_SCHEMA_VERSION` the same
     way).
   - **A sentinel in a persisted or protocol field.** `customRandomMapIndex` and
     `customProgressiveMapIndex` annotate `mapIndex` in snapshots, history entries and save
     state (9 src + 4 test files). No function replaces a value you must *assign*.
5. **camelCase for every constant in the files this pass already edits.** 113 files import
   from the facades and 201 SCREAMING_SNAKE consts are *declared* inside that set. Files
   outside the set keep their current names.

## Target file layout

### Deleted

| File | Reason |
|---|---|
| `src/sim/Constants.ts` | All 76 exports relocate to owning modules (table below) |
| `src/sim/ConstantsTower.ts` | 48 of 52 exports are pack copies |
| `src/sim/ConstantsEnemy.ts` | 24 of 33 exports are pack copies |
| `src/content/index.ts` | Unused barrel; nothing imports `@/content` |

### Created

| File | Contents |
|---|---|
| `src/content/towerIds.ts` | `TowerIds`, `TowerId`, `towerTypeLabels` — the id vocabulary plus non-theme display names |
| `src/sim/towers/towerEconomy.ts` | `cashOutAmount(paid, sellActive)`, `applyUpgradeCostReduction(rawCost, tier)` |
| `src/sim/towers/towerTargeting.ts` | `towerGroundOnly(type, unlockedAddons)`, `targetsLabel(groundOnly)` |
| `src/sim/waves/waveComposition.ts` | `enemyLevelForWave`, `waveUnitCount`, `waveBossCount`, `progressiveEnemyLevel`, `progressiveWaveUnitCount`, `progressiveEarlyWaveCount`, `tierThresholdForWave` |
| `src/components/enemyOrder.ts` | `enemyOrder` — display order for `StatsPanel.vue` and `HelpEnemyTab.vue` (UI-only) |

### Changed

- `src/sim/enemies/enemyWaveStats.ts` gains `enemyLevelBounty`; drops the
  `ENEMY_LEVEL_*_MULT` closures in favour of `enemyLevelMult(level, enemyContent.levelHpMult)`
  from `src/content/formulas.ts`.
- `src/sim/grid/ProgressiveMap.ts` gains `totalMaps` and the progressive index-space
  accessors; `src/sim/GameRunState.ts` gains `GameState`, the map-index sentinels and the
  time-scale functions; `src/sim/SimulationSnapshot.ts` gains the wave-graph dot window;
  `src/sim/stepBudget.ts` owns `fixedDeltaSeconds`; `src/sim/enemies/EnemyManager.ts` owns
  the spawn caps; `src/sim/ProjectileManager.ts` owns the projectile tolerances;
  `src/content/themeMaps.ts` owns the theme-override catalog readers.

## `Constants.ts` disposition

| Export | New home | Form |
|---|---|---|
| `GameState`, `GameStateValue` | `src/sim/GameRunState.ts` | exported enum object + type |
| `CUSTOM_RANDOM_MAP_INDEX`, `CUSTOM_PROGRESSIVE_MAP_INDEX` | `GameRunState.ts` | exported sentinels, camelCase; read-only consumers use `isCustomMapIndex(index)` |
| `TIME_SCALES` | `GameRunState.ts` | local `timeScales`; export `nextTimeScale(current, direction)`, `isValidTimeScale(value)` |
| `FIXED_DT` | `src/sim/stepBudget.ts` | exported `fixedDeltaSeconds`; `maxStepsPerUpdate` and `maxAccumulatedSeconds` become locals there and in `WorkerEntry.ts` |
| `GAMEPLAY_ENEMY_CAP`, `MAX_PENDING_PER_SPAWN` | `src/sim/enemies/EnemyManager.ts` | exported, camelCase |
| `PROJECTILE_HIT_SLOP` | `src/sim/ProjectileManager.ts` | exported; `maxProjectileAge`, `projectileRetargetCorridorTileFraction` become locals |
| `BOSS_SPEED_LIMIT` | `src/sim/GameEngine.ts` | local `bossSpeedLimit` |
| `applyUpgradeCostReduction` | `src/sim/towers/towerEconomy.ts` | exported function beside `cashOutAmount` |
| `progressiveRerollGoldPerWave`, `progressivePlacementInterval` | `src/content/themeMaps.ts` | exported functions beside `resolveThemeMaps` |
| `WAVE_GRAPH_INTERVAL_SECONDS` | `src/sim/SimulationSnapshot.ts` | exported, camelCase (protocol value) |
| `WAVE_GRAPH_WIDTH`, `_DOT_SPACING`, `_MAX_SEND` | `SimulationSnapshot.ts` | module-local; export `waveGraphDotCapacity(containerWidth)` |
| `WAVE_GRAPH_COLOR_BASE_HEALTH_{GREEN,YELLOW,RED}` | `src/sim/WaveGraphTracker.ts` | one exported `baseHealthFillColor(ratio)` |
| `WAVE_GRAPH_HEIGHT`, `_DOT_SIZE`, `_DOT_OPACITY*`, 4 metric colors, dead `MAIN_OPACITY` | `src/components/WaveGraph.vue` | module-local `waveGraphHeight`, `dotSize`, `metricColors` |

Three duplicated rules die in this move:

- `src/sim/WaveGraphTracker.ts:59` and `src/sim/SnapshotStore.ts:35` each compute
  `Math.ceil(width / dotSpacing)` independently → one `waveGraphDotCapacity`.
- `src/sim/WaveGraphTracker.ts:157-163` and `src/render/svg/UiOverlayManager.ts:461-467`
  carry the same `>0.5 / >0.25` base-health color rule verbatim → one `baseHealthFillColor`.
- `src/components/DebugPanel.vue:59-60` re-implements the cycle already written at
  `src/sim/GameRunState.ts:97` → call `nextTimeScale`.

## Config-copy removal

- Delete `EnemyMetaRef`, `EnemyMeta`, `EnemyTierThreshold`, `EnemyType`, `TowerBase`,
  `TowerMeta`, `TowerAddonEffect`, `TowerVariantConfig`. Rename the schema-inferred types
  to drop the `Data` suffix (`MapStyleData`→`MapStyle`, `MapLevelConfigData`→
  `MapLevelConfig`, `TowerBaseData`→`TowerBase`, `TowerMetaData`→`TowerMeta`,
  `TowerAddonEffectData`→`TowerAddonEffect`, `EnemyMetaData`→`EnemyMeta`). `TowerVariantDef`
  already has a plain name.
- Delete `toVariantConfig` and `TOWER_VARIANTS`; read `towerVariants[type]?.[variant]` from
  the pack with its zod-inferred type.
- Drop `ENEMY_TYPES[type]?.name` / `?.color` fallbacks in `StatsPanel.vue` and the
  `void ENEMY_TYPES;` hack in `CrowdManager.ts`.
- `ENEMY_LEVEL_HP_MULT(level)` / `ENEMY_LEVEL_DAMAGE_MULT(level)` become
  `enemyLevelMult(level, enemyContent.levelHpMult)` /
  `enemyLevelMult(level, enemyContent.levelDamageMult)` — `src/content/formulas.ts` already
  exports the formula.

## Hardcoded-value wiring

Behavior-preserving; every pack value equals the literal it replaces.

- `src/sim/GameEngine.ts:871` → `economyContent.firstTimeMilestoneMult`
- `src/sim/GameEngine.ts:1003` → `economyContent.firstFullClearMult`
- `src/sim/GameEngine.ts:893` → `economyContent.milestoneWaves[0]`
- `src/components/MainMenu.vue:146-147`, `src/components/PauseMenu.vue:73` → slider `max`
  from `(difficultyMultMax - difficultyMultMin) / difficultyMultTick`
- `src/sim/grid/ProgressiveMap.ts:18` → `maps.progressive.blockSize`;
  `src/sim/grid/ProgressiveMap.ts:25` → `(progressiveBlockSize - 1) / 2`
- `src/sim/mapSites.ts:102-103` → `mapsContent.mapsPerRegion` and
  `mapsContent.levels.length / mapsPerRegion`

## Pack and schema changes

- `maps.json` / `MapsContentSchema`: remove `mapBaseSize`, `mapSizeScale`, `maxMapDim`,
  `serpentineStep`, `serpentineDownCap`. Safe for themes —
  `ThemeMapsOverrideSchema` is `MapsContentSchema.partial()`.
- `economy.json` / `EconomyContentSchema`: remove `bountyBlockedRatio`; wire
  `firstFullClearMult`, `difficultyMultMin`, `difficultyMultMax`.
- `towers.json` / `TowerTuningSchema`: remove `critChance`, `goldPerCrit`,
  `doubleDischargeChance`, `trueShotChance`, `markTargetDmgPct`, `stunShellDuration`,
  `multiPierceCount`. Remove `TowersContentSchema.ids`.
- Add `EconomyContentSchema.superRefine`: `milestoneGems` must have a key for every entry of
  `milestoneWaves`. Add `MapsContentSchema.superRefine`:
  `levels.length % mapsPerRegion === 0`. Both turn a silent 0-payout or clamped index into
  a load-time failure.
- `MILESTONE_GEMS` loses its phantom `?? 1 / 2 / 4` fallbacks; the engine reads
  `economyContent.milestoneGems[String(wave)] ?? 0`, which the new refinement makes total.

## Hoist map for the heaviest files

| File | Hoisted (3+ uses) | Inline sites |
|---|---|---|
| `tests/unit/towers.test.ts` | 11 (`towerBase` ×47, `towerMeta` ×9, `milestoneThresholdPerLevelSquared` ×19, `levelSplashMult` ×8, …) | 7 |
| `src/sim/grid/ProgressiveMap.ts` | 3 (`progressiveBlockSize` ×31, `totalMaps` ×4, `defaultMaps` ×3) | 6 |
| `src/sim/GameEngine.ts` | 4 (`victoryWave`, `startingBaseHealth`, `betweenWavesTimer`, `difficultyMultGemBase`) | 16 |
| `src/sim/ProjectileManager.ts` | 3 (`bounceDamageFalloff`, `towerBase`, `chainRange`) | 11 |
| `src/sim/waves/WaveManager.ts` | 3 (`victoryWave`, `betweenWavesTimer`, `healerMinGap`) | 3 |
| `src/sim/towers/Tower.ts` | 1 (`milestoneMaxTiers`) | 33 |
| `src/sim/enemies/Enemy.ts` | 0 | 14 |
| `src/commanders/llm/systemPrompt.ts` | 0 | 12 |
| `src/components/HelpEnemyTab.vue`, `SvgGameRoot.vue`, `HelpTowerTab.vue`, `src/sim/towers/BaseDefense.ts`, `towerCoreStats.ts` | 0 | 5, 5, 3, 5, 8 |

## Tests

32 test files import copy constants; 58 of 128 test files carry `// @ts-nocheck`. The same
treatment applies: `import { getGameContent } from "@/content/gameContent.js"` plus a
section-prefixed hoist where a value is read 3+ times. `tests/unit/map.test.ts` converts 16
`MAP_LEVELS[i]` reads to `mapLevels[i]` and 23 `TOTAL_MAPS` reads to `totalMaps`.
`tsconfig.json:24` includes `tests/`, so each phase's test edits land in the same phase as
its source change.

- Delete `tests/unit/game-engine.test.ts:285-289` (the vacuous half-bounty test).
- `tests/integration/commander-llm.test.ts:23` and
  `tests/unit/sim/physics/enemy-physics.test.ts:14` each declare their own
  `const FIXED_DT = 1 / 60` — import `fixedDeltaSeconds` instead.
- `tests/helpers/mock-grid.ts:2,106` drops the `Regions` import and its dead `?.name` read.
- Where a test re-declares a src-owned fixture (`ENEMY_GROUP` in
  `tests/unit/sim/flying-enemies.test.ts:39`, `EDGE_DELTA`/`OPPOSITE_EDGE`/`MOUTH_LOCAL` in
  `tests/unit/sim/progressive-map.test.ts:43`), import the owner's camelCase export.
- Add two tests: `Object.keys(towerMeta)` equals `Object.keys(towerVariants)` equals
  `Object.keys(towerAddonEffects)` (the invariant `towers.ids` was meant to police), and
  `difficultyMultMax` drives the slider's `max` binding.

## Execution order

Each phase ends green on `npm run check`. Because `tsconfig.json` includes `tests/`, test
edits land in the same phase as their source change.

1. **Baseline** — record a clean `npm run check`. Done: 118 files, 2201 tests pass.
2. **Types** — schema type renames; delete the 8 hand-written duplicates and the identity
   casts. Compiler-driven.
3. **Relocate survivors, delete both facades** — create the 5 new modules; move
   `cashOutAmount`, `applyUpgradeCostReduction`, `towerGroundOnly`, `targetsLabel`,
   `towerTypeLabels`, `TowerIds`, and the wave-composition functions; update the 45 src
   importers.
4. **Delete `Constants.ts`** — the disposition table above; add `nextTimeScale`,
   `isValidTimeScale`, `baseHealthFillColor`, `waveGraphDotCapacity`, `isCustomMapIndex`;
   collapse the three duplicated rules; update the remaining src importers.
5. **Apply the 3+ rule** across all 60 files: 73 hoists, 214 inline sites.
6. **camelCase pass** over the 201 SCREAMING_SNAKE consts declared inside the edit set,
   plus every name the earlier phases introduce.
7. **Wire the hardcoded copies and clean the packs** — dead fields out, `superRefine`
   checks in.
8. **Docs** — `TECHNICAL.md`: drop the three `Constants*` directory entries, add the six new
   modules, update the four prose mentions, and rewrite the content-pack paragraph that
   describes the facade.

## Verification

`npm run check` runs biome, `tsc --noEmit`, `scripts/check-sim-boundary.sh` and vitest.
Run `npm run lint:fix` at the end of each phase for import ordering.
