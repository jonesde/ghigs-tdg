# Technical Details

Everything a developer (human or LLM) needs to orient to, navigate, and modify the codebase.

## Rendering Architecture

The entire rendered area of the game uses a single `<svg>` root element where every map tile, tower, enemy, projectile, and visual effect is an SVG element. Sprite definitions are generated from `<symbol>` templates in `<defs>` and instantiated via `<use>` elements with imperatively-set `href` attributes. A single `requestAnimationFrame` loop on the main thread drives imperative DOM writes by reading the latest `SimulationSnapshot` produced by the simulation, which runs in a Web Worker. This eliminates the previous hybrid Canvas + DOM overlay architecture. See the new "Simulation Spine (Worker / Snapshot / Command)" design decision below.

## Directory Structure

```
src/
├── App.vue                      # Root component: <router-view> + global ConfirmDialog
├── main.ts                      # Entry point: createApp, Pinia, Router, persistStore.load()
├── shims-vue.d.ts               # Vue module declarations (*.vue as DefineComponent)
├── content/                     # Zod-validated game content packs (balance tables, skill copy)
│   ├── data/                    # JSON packs: towers, enemies, economy, maps, skill-tree
│   ├── schemas/                 # Zod schemas (game content, theme, LLM response, persist)
│   ├── loadGameContent.ts       # Parse + freeze all packs into GameContent
│   ├── gameContent.ts           # Singleton getGameContent()
│   ├── applyVariantOps.ts       # Declarative tower variant stat-op interpreter
│   └── formulas.ts              # Enemy HP mult etc. from pack coeffs
├── router/
│   └── index.ts                 # Route definitions + navigation guards (dispose engine on route change)
├── stores/
│   ├── game.ts                  # Volatile per-run state: base health, gold, wave, game state, selection, time scale (mirror only), camera, tower/base-panel/minimap/shop positions, hover state, frame id, run gem/boss counters, milestone breakdown, end-screen data, random-map params, worker reference
│   ├── persist.ts               # Persistent meta-progression: gems, unlocks, difficulty, map progress, random-map and progressive-map preferences, last-selected theme and map, sound preference (localStorage)
│   ├── ui.ts                    # UI overlay state: confirm dialogs, notifications, menu/skill-tree/stats/help/minimap context, debug panel, enemy commander selection, random-map panel, single overlayPausedSim flag for the pause an overlay takes
│   └── mapTheme.ts              # Map theme state: activeTheme, defaultTheme, availableThemes, preload/load actions, resolvedMaps (active world's maps catalog), regionNames, ensureActiveTheme
├── composables/
│   ├── Input.ts                 # Keyboard input composable: dispatches to Pinia stores + engine via the command seam
│   ├── usePanelDrag.ts          # Header-drag composable shared by every floating panel (mouse + touch, optional viewport clamp)
│   └── progressivePlacement.ts  # Offer selection / rotation / site probing helpers shared by the keyboard and the SVG click path
├── components/
│   ├── GameScreen.vue           # Root game layout: SvgGameRoot + HUD + shop + tower/base panels + wave countdown + debug + wave graph + overlays
│   ├── BasePanel.vue            # Base detail panel: health, both sentry gun stat blocks, upgrade/downgrade, targeting
│   ├── SvgGameRoot.vue          # Single SVG root: creates the simulation Web Worker, owns SnapshotStore (render loop reads snapshots) and WorkerCommandDispatcher, imperative DOM rendering, SpawnManager
│   ├── TextGameRoot.vue         # Second passive renderer: monospaced <pre> static base grid + canvas overlay; own rAF loop reads getLatestSnapshot() (no worker, no ack, no input)
│   ├── MinimapPanel.vue         # Movable hovering panel (copy of TowerPanel drag pattern) hosting TextGameRoot; toggled by uiStore.showMinimap
│   ├── GameHud.vue              # Top HUD bar: lives, gold, gems, wave, speed/sound/pause/menu buttons
│   ├── GameShop.vue             # Tower shop bar: build selection with cost display and discount support
│   ├── TowerPanel.vue           # Tower detail panel: stats, targeting, upgrade/sell, specialization
│   ├── WaveCountdown.vue        # Inter-wave countdown overlay shown before each wave spawns
│   ├── WaveGraph.vue            # Per-wave graph overlay: damage, gold, gems, max enemy HP
│   ├── PauseMenu.vue            # Pause menu overlay: resume, skill tree, options, quit
│   ├── ProgressivePlacement.vue # Block-offer cards (5×5 previews shaded by tile height with the active theme's region tiles, rotation, site hint) plus the paused post-placement undo button
│   ├── BonusPicker.vue          # Three-card reward picker for a supply drop or map cache: locked cache shows unlock-fee + Leave it, card copy, wave-scaled fee or Free, dismiss
│   ├── HelpDialog.vue           # Help/controls overlay: How to Play / Towers / Enemies tabs (WAI-ARIA tablist) + shortcut table
│   ├── HelpTowerTab.vue         # Towers tab: per-tower stat table at a chosen level, variant rows from level 5
│   ├── HelpEnemyTab.vue         # Enemies tab: per-enemy stat table at a chosen wave
│   ├── progressivePreview.ts    # Shared block-preview markup: 5x5 cell rects + the on-map ghost wrapper
│   ├── detailPanel.css          # Panel chrome shared by TowerPanel and BasePanel, namespaced under .detail-panel
│   ├── MainMenu.vue             # Main menu: large theme buttons (faded menuBackground preview per theme, persisted select), New Game section (Select Map / Progressive Run / Generate Map buttons), skill tree, commanders, run history, difficulty slider
│   ├── MapSelect.vue            # Map selection: region tabs + themed region map with level/progressive markers (last map index persisted, region tab derived from it, first level pre-selected when none) + header buttons opening the shared GeneratedMapDialog / ProgressiveMapDialog custom-run dialogs
│   ├── GeneratedMapDialog.vue   # Generated-map custom-run dialog (teleported to body): region/level/style/width/height/seed form on persistStore, validates, resolves the active theme, starts the run via gameStore + /game
│   ├── ProgressiveMapDialog.vue # Progressive-map custom-run dialog (teleported to body): region/level/base-entries/seed form on persistStore, validates, starts the run via gameStore + /game
│   ├── RegionMap.vue            # Region map SVG renderer: mapImage background, connection lines, level/progressive markers with tooltips, select/start events
│   ├── SkillTree.vue            # Skill tree: tower levels, specializations, add-ons, general upgrades
│   ├── EndScreen.vue            # Game over / victory screen: gem breakdown and navigation
│   ├── ConfirmDialog.vue        # Reusable modal dialog (teleported to body)
│   ├── DebugPanel.vue           # Debug buttons: gold/gems/lives injection, wave skip, map unlock, time scale
│   ├── StatsPanel.vue           # Wave composition, enemy list, and run statistics
│   ├── HistoryScreen.vue        # Run history entries with gem breakdown formatting
│   ├── CommandersScreen.vue     # LLM commander management UI: create/edit/delete custom commanders, activate built-in or LLM commanders
│   └── EnemyChat.vue            # Draggable in-game chat panel for interacting with active LLM enemy commander
├── sim/
│   ├── Command.ts               # Command discriminated-union types (input/action/lifecycle/llm) for simulation intent
│   ├── CommandDispatcher.ts     # CommandDispatcher interface — the dispatch seam every intent flows through
│   ├── GameRunState.ts          # Per-run plain simulation state interface + pure helper functions (formerly gameStore logic)
│   ├── HostBindings.ts          # HostBindings interface — the only way the sim reaches the outside world (sound/UI/persist/confirm/gridTowerSync)
│   ├── PersistState.ts          # Plain persist state interface + pure mutation helpers (formerly persistStore logic)
│   ├── SimulationSnapshot.ts    # SimulationSnapshot + entity/meta snapshot types
│   ├── SnapshotSerializer.ts    # buildSnapshot(): serializes the engine into a plain SimulationSnapshot
│   ├── SnapshotStore.ts         # Main-thread store: holds latest snapshot and mirrors meta into gameStore
│   ├── WorkerCommandDispatcher.ts # Main-thread dispatcher: forwards commands to the worker via postMessage
│   ├── WorkerEntry.ts           # Web Worker entry: owns GameEngine, fixed-timestep loop, command-queue drain, snapshot post
│   ├── WorkerHostBindings.ts    # Worker-side HostBindings: posts sound/UI/persist/confirm messages to main thread
│   ├── WorkerProtocol.ts        # Worker↔main thread message protocol types (snapshot, playSound, notifyUi, schedulePersistSave, gridTowerSync, requestConfirm, workerReady, workerError, setTheme, dispose, snapshotAck, init, command, confirmResult)
│   ├── applyCommand.ts          # Maps a Command → GameEngine method (shared by worker and main-thread dispatcher)
│   ├── commandBus.ts            # Module-level dispatch seam (setCommandDispatcher / dispatchCommand)
│   ├── GameEngine.ts            # Core simulation: update(dt), state transitions, rewards (no RAF, no rendering; loop lives in WorkerEntry)
│   ├── Constants.ts             # Facade: economy/maps from content packs + FIXED_DT/GameState/UI wiring
│   ├── ConstantsTower.ts        # Facade: tower tables from src/content/data/towers.json
│   ├── ConstantsEnemy.ts        # Facade: enemy tables from src/content/data/enemies.json
│   ├── ProjectileManager.ts     # Game-side projectile simulation: travel, hits, splash, chain, burn, knockback
│   ├── ParticleSystem.ts        # Game-side particle simulation: spawn, motion, life/expiry
│   ├── WaveGraphTracker.ts      # Per-wave graph data tracking: damage, gold, gems, peak enemy HP
│   ├── MapSiteManager.ts        # Claimable site lists (buildings, caches, supply drops), tile reservations, package placement
│   ├── bossAbilities.ts         # Boss ability pool, per-wave roll without replacement, ability ticks, Mend source suppression
│   ├── mapSites.ts              # Site placement rules: clearances, rank hash, progressive stamp reconcile; site icons, building details, cache unlocked flag
│   ├── runBonuses.ts            # Bonus cards: offer rolls, typed and specialist draws, 1.2x typed mults, wave-scaled purses and cache fee, summary parts
│   ├── grid/
│   │   ├── Grid.ts              # Grid data structure: path, base, spawn queries, build validation
│   │   ├── Map.ts               # Procedural map generation: 36 maps, 3 regions, 6 layout styles
│   │   └── ProgressiveMap.ts    # Progressive board, stamp log replay, placement legality, generated map
│   ├── towers/
│   │   ├── Tower.ts             # Tower stats, behavior, targeting, upgrades, variants, sell value
│   │   ├── TowerManager.ts      # Tower placement, upgrade, sell, sell-value refund/discount
│   │   └── SkillTree.ts         # Gem upgrade costs, unlock logic, variant definitions, general add-ons
│   ├── enemies/
│   │   ├── Enemy.ts             # Enemy types, stats, behavior, pathfinding, status effects
│   │   └── EnemyManager.ts      # Enemy spawning, lifecycle, death handling
│   ├── waves/
│   │   └── WaveManager.ts       # Wave composition, boss cadence, inter-wave timer
│   ├── navmesh/
│   │   ├── CrowdManager.ts      # DetourCrowd agents: path follow + avoidance → Rapier linvel
│   │   ├── NavMeshBuilder.ts    # Tiled navmesh + TileCache tower obstacles + findPath
│   │   ├── NavDistanceField.ts  # Tower-aware distance-to-base + path metrics
│   │   ├── recastContext.ts     # Lazy WASM loader for recast-navigation
│   │   ├── navmeshConfig.ts     # Clearance / corridor chamfer tuning
│   │   └── coords.ts            # Game (x,y) ↔ Recast (x,0,z) mapping
│   └── physics/
│       ├── PhysicsWorld.ts      # Rapier2d: static geometry, enemies, projectiles, EventQueue step
│       ├── ForceFieldSystem.ts  # Continuous push/pull fields (future towers)
│       ├── ContactProcessor.ts  # Collision event drain → base/tower/projectile hits
│       ├── ColliderUserData.ts  # Body tags (base/tower/enemy/projectile/sensor)
│       └── rapierContext.ts     # Lazy WASM loader for Rapier2d
├── sim-adapters/
│   └── MainThreadHostBindings.ts      # Main-thread HostBindings adapter: SoundManager/uiStore/persistStore
├── render/
│   ├── themes/
│   │   ├── index.ts             # Theme registry: MAP_THEME_MANIFEST, lazy loaders, visual meta types
│   │   ├── normalize.ts         # normalizeThemeImages: fetches external SVG refs, inlines them
│   │   ├── MapThemeHowTo.md     # Guide for creating new map themes
│   │   ├── scripts/             # Theme asset generators (Python): apply_enemies.py, gen_enemies_aftermath.py
│   │   └── data/
│   │       ├── default-map-theme.json   # Default theme data: tower/enemy sprites, tile images, base art
│   │       └── the-aftermath.json       # Alternate "Aftermath" theme data
│   └── svg/
│       ├── EnemyManager.ts      # Enemy rendering pool: <use> elements, hit flash, slow filters
│       ├── TowerManager.ts      # Tower rendering pool: <use> elements, barrel rotation, level pips
│       ├── ProjectileManager.ts # Projectile rendering pool: <circle> bullets, <line> beams
│       ├── ParticleManager.ts   # Particle rendering pool: <circle> elements
│       ├── EffectManager.ts     # Lightning, stun aura, build preview, range circle, upgrade button
│       ├── UiOverlayManager.ts  # HP bars, shield bars, boss HP text rendering
│       ├── SpawnManager.ts      # Spawn point rendering pool: <use> elements for spawn indicators
│       ├── MapSiteLayer.ts      # Site glyph markup (pulsing drop ring, icon glyphs, caches with HP bars, buildings) keyed by a signature cache
│       ├── siteHover.ts         # Site hover hit test (package radius, building box, nearest wins) plus tooltip copy per site state
│       ├── useSvgStaticContent.ts # Composable: builds <defs> symbols/filters + grid layer from active theme
│       ├── cameraFrame.ts       # View frame: fit, zoom, pan, reveal, wheel factor. The SVG viewBox is this frame
│       └── types.ts             # Shared types for render proxies and managers
│   └── text/
│       ├── TextGridBuilder.ts   # Static char buffer (3×3 per tile) for the <pre> monochrome base layer
│       ├── TextTowerManager.ts  # Draws tower theme icon at tile center on the canvas overlay
│       ├── TextEnemyManager.ts  # Draws enemy theme glyph at scaled enemy.x/enemy.y on the canvas overlay
│       ├── TextPathRenderer.ts  # Draws worker-authoritative enemy paths as polylines on the canvas overlay
│       ├── TextOverlayRenderer.ts # Canvas: projectile dots, HP bars, lightning lines, stun marks
│       └── types.ts             # TextRenderScale + TextThemeAccess shared interfaces
├── commanders/
│   │   ├── index.ts                 # Lifecycle: setEnemyCommander(start/stop) + stopEnemyCommander (releases held enemies via llm:routeGroup)
│   │   ├── CommanderWorker.ts       # Web Worker entry: owns CommanderBrain + memory, dispatches decide() per observation, posts commands back
│   │   ├── relay.ts                 # Main-thread relay: ~4 Hz poll of SnapshotStore, builds throttled slice, posts to worker, forwards commands via dispatchCommand
│   │   ├── protocol.ts              # Main↔worker message protocol: CommanderSnapshotSlice, MainToCommanderMessage, CommanderToMainMessage
│   │   ├── observation.ts           # Pure projection from CommanderSnapshotSlice → CommanderObservation (enemy world→tile, tower hp rename)
│   │   ├── brain.ts                 # CommanderBrain interface + CommanderMemory state + createBrain() factory
│   │   ├── stubby/brain.ts          # Sergeant Stubby: hold-then-rush (holds emerging enemies, rushes wave to base when wave completes)
│   │   └── stubbs/brain.ts          # Commander Stubbs: aggressive routing to highest-HP live tower ahead of the group; re-routes on tower-set change
│   └── llm/
│       ├── types.ts                 # LlmCommanderConfig interface + DEFAULT_LLM_SYSTEM_PROMPT constant
│       ├── schema.ts                # Message schemas for LLM API communication
│       ├── apiClient.ts             # HTTP client for posting observations and receiving commands from LLM endpoint
│       ├── systemPrompt.ts          # System prompt template for enemy commander behavior
│       └── brain.ts                 # LLM-based CommanderBrain that uses apiClient to communicate with external model
└── sound/
    └── SoundManager.ts          # Lightweight WebAudio synth for game sounds
```

## Key Design Decisions

### Single SVG Root with Imperative DOM Rendering

The game uses a single `<svg>` root element managed by `SvgGameRoot.vue`, replacing the previous two-layer Canvas + DOM overlay architecture. All visual content — grid tiles, towers, enemies, projectiles, particles, and effects — is rendered as SVG elements.

- **Vue (Declarative):** Manages structural changes (map loading, building/selling towers, opening shops). Mounts the root SVG and static layers via `v-html` for the grid.
- **GameEngine (Logic, in Web Worker):** Orchestrates all game logic (enemy movement, tower targeting, projectile updates, wave management). Constructor takes plain `PersistState` + `ThemeBundle` + `HostBindings` + `mapIndex` (plus optional `randomMapParams` and `particleSpawner`) — no Pinia, no canvas reference. `loadMap(mapIndex)` loads catalog maps; `loadRandomMap(...)` and `loadProgressiveMap(config)` load custom runs (`CUSTOM_RANDOM_MAP_INDEX` / `CUSTOM_PROGRESSIVE_MAP_INDEX`). `GameRunState` is created internally in `_initMap`, not passed in. `handleClick()` accepts world coordinates; `setHover` was removed (hover is main-thread-only UI state). The engine runs inside the Web Worker (`src/sim/WorkerEntry.ts`), not on the main thread.
- **Direct DOM (Imperative Rendering):** A main-thread `requestAnimationFrame` loop reads the latest `SimulationSnapshot` from the `SnapshotStore` and writes per-frame properties via `setAttribute` and `style.transform`. It does not call the engine directly — all intent flows in as `Command`s and all state flows out as snapshots. Bypasses Vue's reactivity system for hot paths.

The SVG structure is:

```
<svg class="game-svg" viewBox="originX originY width height">  <!-- viewBox is the camera -->
  <defs>  <!-- <symbol> templates, filters, per-map gradients -->
  <g ref="worldLayer" class="camera-wrapper">  <!-- identity transform; grid and entities share it -->
    <g class="grid-layer" v-html="gridContent"></g>
    <g ref="entityLayer"></g>      <!-- Towers & Enemies as <use> elements -->
    <g ref="uiOverlayLayer"></g>   <!-- HP bars, shield bars, boss text -->
    <g ref="projectileLayer"></g>  <!-- Projectiles as <circle>/<line> -->
    <g ref="effectLayer"></g>     <!-- Particles, lightning, stuns -->
  </g>
</svg>
```

**Key SVG concepts:**

- `<symbol>`/`<use>`: Sprite definitions are `<symbol>` templates in `<defs>`, instantiated as `<use>` elements. Animation is driven by updating the `href` attribute each frame.
- CSS transforms on SVG: Elements use `transform-box: fill-box; transform-origin: 0 0;` for predictable positioning.
- CTM-based input: Mouse coordinates are converted to world space via `worldLayer.getScreenCTM().inverse()`. The viewBox is the camera and `worldLayer` keeps an identity transform, so that CTM is the viewBox mapping. A transform on the group would be included too, which is why the group is not also scaled.
- Click handling is centralized on the SVG root — no per-element `@click` handlers. `gameEngine.handleClick(worldX, worldY)` determines what was hit programmatically.

`GameScreen.vue` renders `<SvgGameRoot>` as a sibling with HUD/shop/tower panel overlays. Vue does **not** touch per-frame rendering. The component creates the Web Worker, posts `lifecycle:init` (with `persistState` + `themeBundle`), owns `SnapshotStore` and the `WorkerCommandDispatcher`, reads the reactive snapshot mirror from Pinia stores, and cleans up on unmount (posts `lifecycle:dispose`, awaits the worker's `disposed` ack, then terminates). The SVG mounts/unmounts with the `/game` route.

**Worker disposal has exactly one owner per leave, and `GameScreen` is never it.** On a route change away from `/game` the router guard (`awaitDisposeWorker`, module-private to `router/index.ts`) runs first — before the old view unmounts — and posts `lifecycle:dispose`, waits for the `disposed` ack (with a short safety timeout), terminates, calls `gameStore.clearWorker()`, and saves progress. `SvgGameRoot.onUnmounted` is the fallback owner for unmounts the guard does not see: it runs the same dispose/terminate sequence only while `gameStore.worker` still names its worker (so a leave the guard already handled is skipped rather than double-disposed against a terminated worker), and it detaches the terminate behind `void promise.then(...)` so unmount is never blocked. Vue runs child `onUnmounted` before parent `onUnmounted`, so this all happens before `GameScreen.onUnmounted`, which only removes its popstate listener.

**Overlay gating is split.** `GameScreen` gates `WaveCountdown`, `PauseMenu`, `SkillTree`, `StatsPanel`, `MinimapPanel`, and `HelpDialog` with `v-if` on the `uiStore`/`gameStore` flag. `BonusPicker`, `ProgressivePlacement`, `TowerPanel`, and `BasePanel` are mounted unconditionally and gate their own content (the first two on their store state, the last two on the resolved selection), so the parent cannot be the single place that decides what is on screen.

### Four Pinia Stores

- **`gameStore`** — reactive mirror/projection of the simulation `SimulationSnapshot`. The worker is authoritative for simulation state; `gameStore` holds the subset the Vue UI binds to (lives, gold, wave, game state, selection, time scale, dialog visibility, frame id, run gem/boss counters, milestone breakdown, end-screen data) and is updated by snapshot diffs each frame. Main-thread-only state (camera, hover tile, hover-upgrade-button, tower/base-panel/minimap/shop positions, random-map params, worker reference) also lives here. Reset when starting a new map. `timeScale` is in the mirrored set and is **not** written by the UI.
- **`persistStore`** — persistent meta-progression (gems, unlocked skills, map progress, difficulty, general add-ons, random-map and progressive-map preferences, last-selected theme and map) and LLM commander configurations (`llmCommanders` array). Auto-saved to `localStorage` via manual `save()` calls.
- **`uiStore`** — UI overlay visibility and confirm dialog state, plus notifications, minimap toggle, enemy commander selection ("none"/"stubby"/"stubbs"), random-map panel visibility, and one `overlayPausedSim` flag that owns the pause the overlays take. `beginOverlayPause()` pauses only when the sim is actually running (so opening a second overlay on top of a paused one does not dispatch a second toggle), and `endOverlayPause()` resumes only when the last of `showPauseMenu` / `showSkillTree` / `showStatsPanel` / `showHelpDialog` has closed — the getter `anyPauseOverlayOpen` is what it tests. One flag, not four `wasPlayingWhen…` booleans: with per-panel flags, closing an overlay underneath another one resumed the run behind the overlay that was still up. Resume authority is the flag rather than `gameStore.state`, since the flag is set exactly when this store dispatched the pause. `Space` follows the same model — it calls `closeAllDialogs()` when `anyPauseOverlayOpen`, and only falls through to toggling the sim when nothing is up.
- **`mapThemeStore`** — map theme state: `defaultTheme` (preloaded at app init for synchronous access by non-game screens) and `activeTheme` (resolved for the current run), plus `availableThemes` and preload/load actions. Also exposes `resolvedMaps` (the active world's effective maps catalog, `theme.maps` absent when the theme carries no override), `regionNames` (per-region display names, active theme over default over `Region N` fallback), and `ensureActiveTheme()` (resolves `activeTheme` to `persistStore.lastSelectedThemeId` before a run starts, so the main thread and worker both use the active world's catalog).

### Confirm Dialogs as a Single Component

`ConfirmDialog.vue` is mounted globally in `App.vue` and uses `<Teleport to="body">` to render above all layers. Driven by `uiStore.confirmDialog` state.

### Simulation Spine (Worker / Snapshot / Command)

The simulation runs in a Web Worker; the main thread renders and produces intent. They communicate only through a **snapshot + command stream** (the "spine"), as detailed in `plans/ArchitecturePlan.md` §3.

- **Worker owns the engine.** `src/sim/WorkerEntry.ts` constructs `GameEngine` (with plain `GameRunState` + `PersistState` + `HostBindings` + `ThemeBundle`, not Pinia), runs a `setTimeout` fixed-timestep loop, drains a command queue at the start of each tick, and posts a `SimulationSnapshot` every tick. `requestAnimationFrame` is unavailable in a worker, so a `setTimeout`-driven loop is used instead.
- **Commands in (`src/sim/Command.ts`).** All intent is a typed `Command`: `input:*` (e.g. `input:click`), `action:*` (pause, cycle speed, upgrade, sell, select tower/build type, targeting, …), `lifecycle:*` (`init`/`dispose`), and future `llm:*`. The main thread dispatches via `commandBus.dispatchCommand` → `WorkerCommandDispatcher`, which forwards through `postMessage`. Hover and camera are main-thread-only and never become commands.
- **Snapshots out (`src/sim/SimulationSnapshot.ts`, `SnapshotSerializer.ts`).** Each tick the worker serializes plain-data DTOs — `enemies`, `towers`, `projectiles`, `particleSpawns` (sparse spawn requests), `spawnStates`, `paths`/`pathsVersion` (worker-authoritative enemy paths for highlight rendering), `waveGraphDots`/`waveGraphDotsGeneration` (per-interval wave-graph data, shipped only when generation changes), `gridLayout` (constant map layout for the commander worker, omitted once cached), `progressivePlacements` (progressive stamp log, shipped only when `layoutGeneration` changes), `lightningEffects`/`stunEffects` (ephemeral visual effects, `undefined` when their buffers are empty), plus a `meta` scalar block (lives, gold, wave, selection, `lastScaledDt`, etc.) and a `persistDirty` flag. Snapshots are versioned: `SNAPSHOT_SCHEMA_VERSION` is stamped on every snapshot and `SnapshotStore.apply` rejects a snapshot from another schema version (warn once, keep the previous). Enemy animation payloads (walking/hitReaction/attack theme objects with inline SVG) are **not** shipped — they are constant per type and the render proxies resolve frames from the active theme; only timing marks (`hitAnimTime`, `attackAnimTime`, `gameSeconds`) ride the snapshot. `SnapshotSerializer.buildSnapshot` reads entity fields directly; effects are *peeked* (never consumed) during build, and `WorkerEntry` consumes the particle/lightning/stun buffers only after a successful `postMessage`, so a built-but-not-posted snapshot re-ships the same effects instead of dropping them. The render managers' `syncFromGameEngine` signatures take these snapshot arrays.
- **Reactive mirror (`src/sim/SnapshotStore.ts`).** On the main thread, `SnapshotStore` holds the latest snapshot and diff-mirrors `meta` into `gameStore` (the reactive projection). The rAF render loop reads from the `SnapshotStore`, never from the engine. `gameStore` is a cache; the worker is authoritative, and reconciliation happens within one frame.
- **HostBindings seam (`src/sim/HostBindings.ts`).** The sim reaches the outside world only through `HostBindings`: `playSound`, `notifyUi`, `schedulePersistSave`, `syncGridTower`, `requestConfirm`. Implemented twice — `WorkerHostBindings` (worker → `postMessage`) and `MainThreadHostBindings` in `src/sim-adapters/` (main thread → `SoundManager`/`uiStore`/`persistStore`). This seam is what made the worker migration behavior-preserving at every step.
- **Persistence batching.** The worker sets `persistDirty` on persist mutations and the host flushes `schedulePersistSave` only on significant events (wave change, game-over/victory, new milestone claim, or a 5s fallback), avoiding a `localStorage` write per mutation.

### Snapshot Backpressure (Worker → Main Ack Gate)

The worker simulates at a fixed 60 Hz unconditionally, but `buildSnapshot()` +
`postMessage()` are **gated** on the main thread having consumed the previous
snapshot. This avoids allocating and structured-cloning a snapshot on ticks the
renderer never drained (underpowered machines, 30 Hz displays, brief main-thread
stalls). The gate never blocks the simulation — only the snapshot build/post.

- **Handshake:** the worker sets a module-level `awaitingAck = true` after each
  post and records `lastPostedFrameId`. The main thread's rAF render loop sends
  `{ type: "snapshotAck", frameId }` once per *rendered* frame (after the
  render-manager `syncFromGameEngine` calls, before rescheduling rAF). The worker
  clears `awaitingAck` only when `frameId >= lastPostedFrameId`, so a stale ack
  (a duplicate render, a late ack after a newer post) cannot release the gate
  early. A running-idle tick with `awaitingAck === true` drops the build+post
  entirely.
- **Forced posts bypass the gate** (so input latency stays ≤1 frame): the
  *baseline* (first snapshot after `(re)init`) and any tick where a `Command`
  mutated visible state (`stateMutatedThisTick`, paused **or** running). A
  running-command post sets `awaitingAck = true` (next running tick throttles
  again); a paused-command post sets `awaitingAck = false` so a follow-up forced
  post isn't swallowed. Plain paused-idle posts nothing. A placement hold that
  has not yet ridden a posted snapshot is forced the same way
  (`placementHoldPosted` in `decideSnapshotPost`). The hold pauses the run inside
  the arming tick, so without that force the ack gate drops the frame and every
  later tick is paused-idle.
- **Behavior-preserving:** the renderer always shows the latest snapshot, so
  dropped intermediate frames are automatically replaced by current state at the
  next post. `startLoop()` resets `awaitingAck = false` so a fresh run starts
  unblocked; the terminal branch posts unconditionally before `stopLoop()`.
- **Over-acking is harmless:** if the main thread renders a stale snapshot twice
  (e.g. 60 Hz main / 30 Hz effective worker) it acks twice; the worker may post
  one redundant snapshot. No semantic change.

**Multiple consumers (future).** The gate assumes a *single* acking consumer:
the next post is released by the one `snapshotAck` the main thread sends. If a
second consumer (e.g. a replay recorder, a second view, or a debug inspector)
reads the stream, the single-ack model is insufficient — a slow or absent second
consumer would stall the stream for the primary renderer. Supporting multiple
consumers will require either (a) a per-consumer ack with the worker releasing a
post only when *all* registered consumers have acked, or (b) monotonic snapshot
sequence ids so each consumer acks independently and the worker posts when the
*latest* snapshot has been consumed by the slowest consumer. A safety
max-latency fallback (post anyway if `awaitingAck` has been true beyond N ms)
 should also be reconsidered then so a stalled consumer cannot starve the others.
This is the main open design point before introducing additional stream readers.

### Second Renderer (Text Minimap)

The **Minimap** is a fun second renderer that consumes the same `SimulationSnapshot`
data the SVG renderer drains, but draws the map as a monospaced text grid (3×3
characters per tile) with a thin dot/line canvas overlay for projectiles and
minimized effects. It is the first concrete test of the "multiple consumers"
open design point above.

**It is a passive second consumer of the snapshot, not a second acking reader.**
The simulation's snapshot stream is single-ack gated (§"Snapshot Backpressure"),
and `SvgGameRoot.vue` is the *sole* acker. To avoid that gate entirely, the Minimap
reads the snapshot via the existing module-level `getLatestSnapshot()` exported
from `src/sim/SnapshotStore.ts` (the same seam `StatsPanel` uses). `TextGameRoot.vue`
runs its own `requestAnimationFrame` loop, clears + redraws its `<canvas>` overlay
each frame from `getLatestSnapshot()`, and **never posts `snapshotAck`** (and never
touches the worker). This makes it a true "second view" of the already-drained
snapshot — behavior-preserving, no worker/ack changes. No `gameStore` snapshot field
is introduced; the panel resets on a new run automatically because
`uiStore.initForRun` resets `showMinimap` to its default (`false`).

**Layering.** A single `<pre>` cannot be per-cell colored, so rendering splits:
- the `<pre>` base layer is the static, dim monochrome grid (`TextGridBuilder`),
  built once on mount — terrain `·`, path spaces, base `#`, spawn `S`;
- the `<canvas>` overlay draws all dynamic content each frame: tower glyphs
  (theme `icon`/`color`) at tile centers, enemy glyphs (theme `shape` →
  `getEnemyGlyph` → glyph, in theme `color`) at the enemy's scaled continuous
  `enemy.x/enemy.y`, plus projectile dots, HP bars, lightning lines, and stun marks
  (`TextTowerManager` / `TextEnemyManager` / `TextOverlayRenderer`).

**Coordinate mapping.** Because monospace glyphs are taller than wide, the overlay
uses *separate* x/y scales so glyphs sit exactly in their `<pre>` cells:
`cellWidthPx` (char advance) and `cellHeightPx` (line box) are measured on mount
(with a non-zero `fontSize`-derived fallback when `measureText` returns 0, e.g.
jsdom). Canvas size = `grid.width*3*cellWidthPx` × `grid.height*3*cellHeightPx`;
`scaleX = (3*cellWidthPx)/36`, `scaleY = (3*cellHeightPx)/36`. The `<pre>` and the
`<canvas>` share one computed font/line-height so they align. The canvas managers
take the `CanvasRenderingContext2D` as a constructor-free `render(ctx, …)` parameter
(rather than calling `canvas.getContext` internally) so they are testable with the
global `mockCtx` from `tests/setup.ts`.

### LLM Enemy Commander

A pluggable AI layer that issues `llm:*` commands to influence enemy behavior
(hold positions, route to waypoints, set targeting). Two built-in "brains" ship as
stubs for future LLM integration.

**Architecture.** Three pieces:

- **Relay** (`src/commanders/relay.ts`): Main-thread, passive `SnapshotStore` reader
  at ~4 Hz. Builds a `CommanderSnapshotSlice` (throttled, not full snapshot), posts
  to the commander worker, and forwards returned `Command[]` via
  `commandBus.dispatchCommand`. Owns a `gridLayout` cache keyed to `runId` so the
  one-shot feed-off toggle stays valid across worker restarts within a run. Does
  **not** post `snapshotAck` — the single-ack backpressure gate (§"Snapshot
  Backpressure") is untouched. A run restart (engine reloads a map → `runId` bumps)
  drops the stale `gridLayout` cache so the previous map is never forwarded to the
  worker for the new run.
- **CommanderWorker** (`src/commanders/CommanderWorker.ts`): Dedicated worker running
  the brain. Receives `start`/`stop`/`observation` messages. On each observation,
  builds a `CommanderObservation` from the slice, calls `brain.decide(observation,
  memory)`, and posts the returned `Command[]` back. Resets memory on `runId` change.
- **Brains** (`src/commanders/brain.ts`, `src/commanders/stubby/brain.ts`,
  `src/commanders/stubbs/brain.ts`): Pure functions of `CommanderObservation` +
  `CommanderMemory` → `Command[]`. `CommanderMemory` is worker-owned scratch (phase,
  seen-by-wave, last-rush-wave, tower signature, cached grid layout).

**Observation** (`src/commanders/observation.ts`): Pure projection — enemy world x/y
→ tile via `meta.tileSize`, tower `health/maxHealth` → `hp/maxHp`, pending spawn
count summed across `spawnStates`. Field names are intentionally stable for a future
LLM commander (§ArchitecturePlan §4.3).

**Protocol** (`src/commanders/protocol.ts`): `CommanderSnapshotSlice` is the
intentional input contract — a throttled, abstracted slice of the full
`SimulationSnapshot` (enemies, towers, spawnStates, meta) plus a `gridLayout`
cache supplied by the relay, not the whole thing.

**Two built-in brains:**

- **Sergeant Stubby** (`src/commanders/stubby/brain.ts`): Hold-then-rush. While a
  wave is still emerging (`remainingScheduledSpawns > 0` or `pendingEnemyCount > 0`),
  holds each newly-seen enemy at its current tile via `llm:routeGroup(enemyIds,
  hold: true, holdTile)`. Once the wave finishes emerging, releases all held enemies
  of that wave in one `llm:routeGroup(enemyIds, hold: false, [])` rush to the base.
  State keyed by wave number so
  spillover never dilutes a prior wave's rush.
- **Commander Stubbs** (`src/commanders/stubbs/brain.ts`): Aggressive, never holds.
  Reads the live nav distance field. For each newly-seen enemy, picks the highest-HP
  live tower that is *ahead* (strictly closer to the base on that field) of the group's
  representative tile, snaps a terrain tower to the nearest path tile for the distance
  read, and issues `llm:siegeTower`. Re-routes whenever the tower set signature changes.

**Lifecycle** (`src/commanders/index.ts`): every `setEnemyCommander(id)`, including built-ins and `"none"`, calls `stopEnemyCommander()` before a new relay starts. That dispatches `llm:routeGroup(enemyIds, hold: false, [])` and `llm:setTargeting(enemyIds, mode: "default")` for every live enemy, then `llm:setSpawnOrder` with `clear: true`, then stops the relay. The route command returns held enemies to default pathing. The targeting command clears an engagement policy, which `releaseToDefault` leaves in place. The clear drops a latched emerge order so the next wave is not parked after this commander is gone.

**LLM Commanders:** For custom external LLM integration, `persistStore` maintains an array of `LlmCommanderConfig` entries (id, name, endpointUrl, token, modelName, contextLimit, commanderInstructions, systemPrompt, requestTimeoutMs, pauseForCommander, decisionIntervalMs, reasoningEnabled). The model may also emit `llm:setSpawnOrder` (a standing order applied inside `EnemyManager.spawn`) and `llm:releaseHeld` (release living holders, optionally by wave and spawn index). When an LLM commander is activated via `setEnemyCommander(id)`, the relay starts with `"llm"` mode and passes a plain copy of the config. The store value is a Pinia proxy, and `postMessage` throws `DataCloneError` on that proxy, which would leave the worker running with no start message. The worker's LLM brain (`src/commanders/llm/brain.ts`) resends the conversation transcript on each call: the system prompt, prior snapshots and deltas, and the model's own replies. Later turns send a delta of new and changed enemies (including removals, routing, targeting, and distanceToBase), changed towers, and removed towers. Each live tower includes `distanceToBase`, snapped to the nearest path, spawn, or base tile; a tower at 0 hp is omitted and listed in `removedTowers`. The wave summary includes base hp and the inter-wave countdown. A full snapshot replaces that transcript when the context budget is exceeded or the instructions change. A markdown fence around the JSON is stripped; a rejected reply is not kept, and the next user message includes the rejection reason. Identical failure toasts are suppressed until a reply is accepted. `apiClient.ts` posts to the configured endpoint at temperature 0.2. The abort timer is `requestTimeoutMs` (default 30 seconds, save version 4). `pauseForCommander` defaults off and is backfilled on load without a save-version bump. When it is set, the worker posts a hold for the in-flight request; the sim applies `action:commanderHold`, which stops the clock while the run stays `playing`, because `GameState.PAUSED` makes the worker skip decide. The hold releases when the reply is applied, the request fails, or the relay stops. The HUD shows "Paused for commander". The worker waits `decisionIntervalMs` (default 1 s, range 1–10 s) after a request finishes before the next one. Missing or out-of-range values backfill to 1 s on load, still without a save-version bump. A draggable `EnemyChat.vue` panel lets players send messages, edit commander instructions, and change pause, the Reasoning checkbox, and that delay on the running commander via `postUpdateCallSettings`. Reasoning off sends the chat-completions disable fields (`reasoning_effort: "none"`, `enable_thinking: false`, `chat_template_kwargs`, `thinking.type: "disabled"`, `reasoning.enabled: false`). Reasoning on sends the matching enable fields with effort `medium`. Missing `reasoningEnabled` backfills to false without a save-version bump. Its Log column shows the raw model body and a per-turn command summary from a worker `trace` message; the log is in-memory, capped at 50, and cleared when the commander changes. A repeated failure is still traced when its toast is suppressed. An empty `content` field uses `reasoning_content`, then `reasoning`, as that body. An instruction edit is posted with `postUpdateInstructions()` and saved on the active commander only when the text changed. Deleting the active commander deactivates it. The commanders form can test the unsaved endpoint without saving or starting the relay.

### Physics + Navmesh (Rapier2d + Recast/DetourCrowd)

Full-physics motion: DetourCrowd owns path follow + local avoidance; Rapier owns hard collision, impulses/forces, projectile bodies, and contact events. See `plans/FullPhysics.md`.

**Tick order:** `preStep` → `crowd.update` → `forceFieldSystem.apply` → `projectile.prePhysics` → `physics.step(EventQueue)` → contact drain → `postStep` → `projectile.postPhysics`.

**Rapier (`PhysicsWorld`):**
- Static: base cuboid, tower cuboids (tagged), corridor walls with convex-corner chamfers.
- Dynamic enemy circles (mass by type, CCD for fast runners); enemy–enemy collisions off (Crowd avoidance).
- Traveling projectiles as kinematic velocity bodies; beams stay query/`castShape`.
- Impulse knockback + ballistic window; `ForceFieldSystem` continuous push/pull seam (no push towers yet).
- Contact events for enemy↔base / enemy↔tower / projectile↔enemy.

**Recast (`NavMeshBuilder` + `CrowdManager`):**
- Tiled navmesh + TileCache tower obstacles; choke/full block is legal.
- Siege mode: enemies attack blocking towers until ghost, then repath to base.
- Per-type crowd profiles; move-target caching; sparse agent resync on body drift.
- `NavDistanceField`: tower-aware distance-to-base + path metrics for commanders/UI.
- Wall-block cornering: path-tower cuboids get the same corner chamfer terrain
  towers do wherever the tower corner juts into open corridor (wall-pair S-bends);
  a default-routing enemy pinned on tower contact gets a walk-only recovery
  (corridor re-plan + alternating tangential nudge) — pins never convert to siege.
  The breach decision anchors on the nearest tower-free tile so a body rounding a
  chamfered corner (center inside the blocked tile) cannot misread its lane as
  sealed and misfire a siege.

**Commanders:** snapshot ships `navField` (relay-cached); Stubbs uses live distances and issues `llm:siegeTower`.

### Progressive Maps

Map indexes `PROGRESSIVE_MAP_INDEX_BASE` (36) through the next 12 entries are the progressive variants in `maps.json` (`progressive.variants`: 3 regions × entry counts 1–4). `resolveGeneratedMap` builds the starting board with `createProgressiveBoard`. The generated map's `style` is `"progressive"`.

**Custom progressive maps.** The "Progressive Map" dialog (`ProgressiveMapDialog.vue`, opened from the map-select header or the main menu's New Game section) starts a custom run from a player-chosen `ProgressiveConfig` (region, level 1–12, base entries 1–4, seed with auto-roll when blank). Custom progressive runs use `mapIndex` `CUSTOM_PROGRESSIVE_MAP_INDEX` (-2) and carry their config as `progressiveMapParams` on the worker init message and on the run-history entry (custom "Generated Map" runs use `CUSTOM_RANDOM_MAP_INDEX` (-1) + `randomMapParams` the same way). Run-time code recovers the config from the live map via `progressiveConfigFromMap(map)` — `boardToGeneratedMap` writes `regionId` / `level` / `entryCount` / `seed` back onto every rebuild — so `gameStore`, `SvgGameRoot`, `ProgressivePlacement`, and `GameEngine` need no config plumbing for custom runs; `progressiveConfigForIndex` remains only where a catalog index is the input (MapSelect variant entries, `resolveGeneratedMap`). Gem map multipliers are `gemMultiplierForRegionLevel(regionId, level)` (`MAP_GEM_MULTIPLIERS[regionId * 12 + level - 1]`) for every map kind, custom runs included. Custom runs of either kind skip map-progress persistence (best waves, unlocks, first clears, milestone claims) because those key on `mapIndex >= 0`.

The board uses absolute block coordinates. The base block is `(0, 0)` and north is negative Y. Each block is 5×5 tiles. `generateProgressiveCatalog` builds 12 templates from the variant seed: path patterns (straight, jogged straight, elbows, ringed elbow, tee, plus; the open-center variants carve the middle tile as terrain) plus two terrain fills. Terrain height is `slope`, `peak`, `roughSlope`, or `scatter`, stored on the template tiles as height 1–4. Path tiles are height 1.

`boardToGeneratedMap` writes `originTileX` / `originTileY` from the block bounds minus a one-block margin. `Grid.worldOriginX/Y` is that origin times the 36px tile size. West or north growth lowers the origin so an existing tile keeps its world position. `Grid.replaceFromMap` returns `shiftX` / `shiftY` and applies that shift to `blocked`, `terrainTowers`, and `ghostTowers`. Callers add the same shift to tower tile indexes and enemy route tiles. Enemy and tower world positions are not moved.

The worker's `progressivePlacements` array is the authoritative layout. Each stamp is a template index, rotation, block coordinates, and `fill`. `SnapshotSerializer` ships the array only when `layoutGeneration` differs from `lastPostedLayoutGeneration`, then records that generation, the same gating the wave-graph dots use. `layoutGeneration` 0 is the start board and ships on the first snapshot. `SnapshotStore` calls `gameStore.applyProgressiveLayout`, which replays `generateProgressiveMap(config, stamps)` into a new main-thread `map` and `Grid`. The main thread does not share the worker's grid object.

A hold opens every `PROGRESSIVE_PLACEMENT_INTERVAL` (3) waves when the wave is greater than 0 and less than `VICTORY_WAVE`. `onWaveCleared` arms resume mode `"countdown"`. `onWaveExpired` arms `"expire-advance"`. `armPlacementHold` draws 2 offers, or 3 when `generalAddons.progressiveThirdChoice` is set, sets `progressivePlacementHold`, pauses the run, clears the selected tower and build type, and sets `WaveManager.advanceHeld`. The snapshot that first carries that hold is forced through the ack gate (`decideSnapshotPost`). The run pauses inside the arming tick, and later paused ticks post nothing until a command, so an unforced drop leaves the block cards hidden until a key. Pause and speed inputs are ignored for the duration (`Input.ts`, `togglePause`, `cycleSpeed`). Shop clicks and tower digits 4–9 are ignored too. Digits 1–3, Tab, and Shift+Tab select an offer on the main thread. `R` and a second click on the selected card rotate through quarter-turns that have a legal site. Arrow keys move `progressiveSelectedSite` among the sites at that rotation. Enter places that site. While the hold is open, a right click on a placement space rotates the block through the same probe the `R` key uses (`rotateProgressiveBlockAt` in `src/composables/progressivePlacement.ts`, which the click handler in `SvgGameRoot.vue` calls before any tower interaction; non-primary buttons are ignored everywhere else). Selecting or rotating a block also cancels build mode and clears the selected tower. The place command carries the quarter-turn count.

`drawBlockOffer` keeps the templates unique. When any template can extend an opening (a legal site that docks onto an existing path mouth and leaves at least one new mouth), one of those templates is reserved before the rest of the slots are filled, then the offer is shuffled. Terrain-only offers happen only when no path template extends. `action:rerollProgressiveOffer` spends `PROGRESSIVE_REROLL_GOLD_PER_WAVE` (10) times `currentWave` gold and draws again. Wave 3 costs 30. It does not spend, and does not read `progressiveRng`, when gold is short or `offerHasAlternative` says the current set is the only valid one. The command returns true so the paused worker still posts the new offer.

A click on a pattern ghost dispatches `action:placeProgressiveBlock`. A click that misses a site does not select a tower. The worker checks that the template is in the current offer, then probes the walk mesh on a throwaway grid built from the player stamp alone (hole fills are non-walkable terrain and do not move spawns, so they do not change the mesh). A failed probe calls `notifyUi` with a placement toast and returns without `commitPlacement`, so `progressiveRng`, the stamp log, and the hold are unchanged. On success, `commitPlacement` records the player stamp and any single-mouth hole fills (`fill: true`, terrain templates 10 or 11), `replaceFromMap` grows the live grid, and a keeper `NavMeshBuilder` is built on that grid. If the keeper build fails, the grid layout snapshot is restored and the stamp log is truncated back. `installWalkMesh` then rebuilds the corridor, swaps the crowd, and refreshes the distance fields. Only after that does `layoutGeneration` increment, `gridLayoutEnabled` turn back on, and `completeProgressivePlacement` close the hold: it stashes `progressivePlacementUndo` (`{ stampCount, offer }`) while `progressiveResumeMode` stays armed and the run stays paused, for both `"countdown"` and `"expire-advance"`. The countdown or `startNextWave` is applied by `applyPendingProgressiveResume` from `togglePause` on the first unpause, which also drops the stash, so no countdown is shown while the run sits in the undo window. `action:undoProgressivePlacement` (engine `undoProgressivePlacement`) is true only while that stash exists: it truncates the stamp log to `stampCount`, replays the board (`replayProgressiveBoard` → `boardToGeneratedMap` → `replaceFromMap` + keeper `NavMeshBuilder`, then the same shift/reindex/mesh tail as a place), and re-opens the hold with the stashed offer via `openPlacementHold`, leaving the run paused and the resume mode armed; `layoutGeneration` increments, but the main-thread RNG is not rewound, so an undo restores the board exactly without replaying offer/reroll luck. The stash is cleared by the unpause, `releasePlacementHold`, `openPlacementHold`, a wave skip, and map load/reset. While it is live, `SnapshotSerializer` sets `meta.progressiveUndoAvailable` (mirrored to `gameStore.progressiveUndoAvailable` by `SnapshotStore`) and `ProgressivePlacement.vue` swaps its offer cards for an "Undo placement" button that dispatches the command; the cards come back after the undo reopens the hold.

Spawns keep ids across a placement. `EnemyManager.reindexSpawns` and `WaveManager.resizeSpawnStatesById` follow those ids so pending queues and spawn visuals stay with the same mouth.

The commander turns the `gridLayout` / `heights` feed off after it caches a rectangle. A placement clears `gridLayoutCache` and `gridHeightsCache` and re-enables the feed. `CommanderWorker` sees the new `layoutGeneration`, caches the new rectangle, and turns the feed off again. `meta.worldOriginX/Y` is how observations convert world coordinates after an origin shift.

The SVG fit rectangle is `originTile * 36, size * 36`. On a progressive origin or size change, `SvgGameRoot.vue` tweens that viewBox over 320ms. A new run snaps. Offer cards in `ProgressivePlacement.vue` shade terrain cells by tile height (lightest at 1, darkest at 4) and keep path on its own color, with every fill read from the active theme's region tiles (`terrain1`–`terrain4` and `path`, variant 0's field fill via `fieldFillOf`) and a neutral ramp as the fallback when no region visual resolves. The on-map preview uses that same pattern, in the current rotation, at every legal site. The keyboard site is drawn stronger and stroked. Rotation and `progressiveSelectedSite` live on the main thread. When a hold or a new offer arrives, `syncProgressiveCursor` snaps to a quarter-turn that has a site and selects one, so the pattern is visible before any key.

### Boss Abilities & Run Bonuses

**Boss abilities** (`src/sim/bossAbilities.ts`). Each boss rolls one ability from a pool of five (`spawnMinions`, `healAura` "Mend", `speedAura` "Haste", `shieldPulse` "Shield", `towerShot` "Bombard") — or none. The draw is `rollBossAbilities(mapSeed, waveNumber, count, vanillaFirst)`: a seeded stream separate from `WaveManager`'s wave-composition stream, without replacement inside a wave, and with `vanillaFirst` forcing the first boss of a run (`bossesSpawned === 0`) to none without consuming a pool entry. Stamping happens the moment a wave's entries are generated: `WaveManager.startNextWave` calls the engine's `bossAbilityStamper` callback, so every caller of `startNextWave` (countdown expiry, timer expiry, debug tools) is covered, and the between-wave preview (`refreshBossPreview`, same seed and inputs) always matches what actually spawns. `configureBossAbility` writes the runtime fields when the boss body is created (`onEnemySpawned`), so a boss that dies in the pending queue never consumes its ability.

Ability ticks run in `BossAbilityRuntime.tick` (engine-owned services; no per-tick context literal): minion pulses emit `min(max(1, round(0.5 × wave)), 8)` bounty-less minions under the gameplay cap every 30s; Mend heals self and allies within 2.5 tiles at 2%/s reusing the healer animation, with two Mend bosses suppressed to the nearest eligible source — `GameEngine.update` rebuilds that source list once per tick into a reused buffer (`collectMendSourcesInto`) and the per-boss `mendSuppresses` closure reads it only within the same tick; Haste sets the boss to 1.2× and allies within 3 tiles to 1.5× (reset + reapplied each tick, so it holds only while in range); Shield refreshes up to 25% max HP within 2.5 tiles every 15s; Bombard telegraphs 1.5s and then hits the nearest tower within 6 tiles for 30% of the boss attack via `Tower.takeAbilityDamage`, which bypasses terrain towers' `enemyAttackImmune` (contact attacks stay immune).

**Run bonuses** (`src/sim/runBonuses.ts`). Bosses drop a supply package on death; terrain caches are destructible by tower fire (only while no enemy is in range) or openable for gold. Both open the `BonusPicker`: pause, pick 1 of 3, resume to the pre-open state. The pool is 10 base cards — 7 persistent mults (Sharpened, Quick Hands, Fortify, Far Sight, Bounty, Heavy Frost, Armor) that stack multiplicatively per run, plus Small Purse, Large Purse, Field Repair — and 4 typed variants (one tower type, excluded Sturdy Wall) drawn into at most one offer slot. Three separate seeded streams keyed `mapSeed + packageId` keep draws stable across dismiss/reopen: the offer (`bonusOfferSeed`), the specialist type (`specialistSeed`, weighted by live tower counts), and the Heavy Frost curation pass (`curationSeed`, swaps the card out once on first open when no tower can apply a slow). Purses and the cache fee scale together (`smallPurseGold(wave)`), so an intact cache costs exactly one Small Purse and the no-reward pressure holds late into a run.

The four typed cards pay `TYPED_PERSISTENT_FACTOR` (1.2) instead of the 1.1 the base cards use, which is what makes one tower type worth more than all of them at once; the card copy carries the themed tower name from `BonusContext.themeTowerName` (`mapThemeStore.getTowerVisual(typeId)?.name`, shipped as a plain string so `src/sim` never imports a store), e.g. `Sharpened · Sub Tractor (Basic)` over `Sub Tractor (Basic) tower damage`.

Caches are gated: clicking an intact cache opens the picker locked — no gold check on the click, so a short purse still reaches the button — showing only `Unlock for N gold` and `Leave it`. `GameEngine.unlockCache` charges `cacheOpenGold(wave)` once and sets `cache.unlocked`; `pickBonus` refuses while locked, and `cacheOpenCost` reports 0 once the site is unlocked or broken, so a dismiss after paying never recharges. Breaking the cache with tower fire sets `unlocked` at hp 0 and opens it for free, which is what keeps the damage path and the paid path on the same flag.

A cache broken by fire keeps its tile, offer, and reservation at hp 0 (towers stop targeting it; the click claim is free). Because the break happens inside `engine.update` while a picker may already be open, `pendingBrokenCaches` queues the break with the open picker's `wasPlaying` flag; `closeBonusPicker` drains the queue so a chain of simultaneous breaks holds the pause and resumes exactly once at the end, and a progressive placement hold that refuses the open retries on completion (`completeProgressivePlacement` → drain). Offer and specialist type resolve from the site at open time, which is what keeps a dismiss + reopen on the same roll. On the worker side, a picker opened mid-tick (not by a command) forces a snapshot post through the ack gate the same way the placement hold does (`bonusPickerPosted` latch in `decideSnapshotPost`).

### Floating Panel Drag and Detail-Panel Positions

Every floating in-game panel (tower, base, minimap, debug, shop, enemy chat) is
dragged by its header, and each one needed the same gesture. `usePanelDrag`
(`src/composables/usePanelDrag.ts`) is the single implementation: it records the
position at `mousedown`/`touchstart`, applies the pointer delta to a `read`/`write`
pair (so the panel tracks from wherever it already sits), and owns the gesture
listeners. Both paths end on the same set of events — `mouseup`, `touchend`, window
`blur`, document `touchcancel` — because a focus loss or an interrupted touch
otherwise leaves the panel still tracking the pointer once the user comes back.
Touch rides the same `applyMove` path as the mouse, and all six headers bind both.

Cleanup also runs in the composable's `onUnmounted`, so a component torn down
mid-drag drops its listeners. That is not the same as a panel disappearing: these
components keep their root element behind a `v-if` while the component itself stays
mounted, so hiding a panel mid-drag does **not** fire `onUnmounted` and the gesture
listeners survive it. The `v-if` case is why the gesture-ending events above are the
real guarantee.

`clampToViewport` bounds the panel to `window.innerWidth/innerHeight` minus its own
`offsetWidth/offsetHeight`. Without it a drag can push a panel fully off screen with
no way to drag it back, which is why `GameShop` had that logic inline for its resize
handler alone. The clamp needs the panel element for its size, so `panelRef` is a
required option. A viewport shrink can strand a clamped panel off screen just as
effectively as a drag, so the composable also re-clamps on `resize`; `GameShop`
passes `clampOnResize: false` because its own resize handler repins the bar to
whichever edge it was nearest, and that has to be the only writer for its position.

`TowerPanel` and `BasePanel` are two different panels, so they hold two different
positions: `gameStore.towerPanelPos` and `gameStore.basePanelPos`. They never render
at the same time (`resolveSelectedTower` finds no tower whose id is `"base"`, so the
tower selection is null and `TowerPanel` self-gates), which had masked the coupling
when both wrote one slot. Neither position survives `initMap`, so the arrangement is
per run.

### Worker-TimeScale Is Snapshot-Only

`gameStore.timeScale` is a mirror of `snapshot.meta.timeScale`, written only by
`SnapshotStore.apply`. The UI therefore expresses a speed change by dispatching
`action:cycleSpeed` and lets the mirror update the label. It used to also call
`gameStore.cycleSpeed()` locally as an optimistic prediction; that made the store a
second writer for a worker-authoritative field, and a mirror landing between two
rapid presses could revert the base the second press computed from. `DebugPanel`'s
time-scale debug command already dispatched only. `TIME_SCALES` in
`src/sim/Constants.ts` is the one list of accepted values — the engine cycles it,
`validateCommand` whitelists it for the debug `setTimeScale` command, and `DebugPanel`
reads it.

### Router Navigation Guards

`router.beforeEach` disposes the game engine and saves progress when leaving `/game`. Auto-redirects to `/game-over` or `/victory` when the game state transitions.

## Source & Configuration Files

### Configuration

| File | Description |
|---|---|
| `index.html` | Entry HTML with `<div id="app">` mount point |
| `package.json` | Dependencies: Vue 3, Pinia, Vue Router, Vite, Zod |
| `vite.config.ts` | Vite config: Vue plugin, `@/` alias for `src/`, dev server on port 3000 |
| `vitest.config.ts` | Vitest config: Vue plugin, `@/` alias, jsdom environment, test glob `tests/**/*.test.ts` |
| `tsconfig.json` | TypeScript config: `strict: true`, `allowJs: false`, `noEmit: true`, `moduleResolution: bundler` |
| `src/render/themes/MapThemeHowTo.md` | Guide for creating new map themes (sprite format, registration, scope) |

### Entry & Routing

| File | Description |
|---|---|
| `src/main.ts` | App bootstrap: createPinia, load persisted state, mount router |
| `src/App.vue` | Root component with `<router-view>` and global `<ConfirmDialog>` |
| `src/router/index.ts` | Route definitions and navigation guards |

### State Management

| File | Description |
|---|---|
| `src/stores/game.ts` | Volatile game state: base health, gold, wave, selection, time scale (mirror only), camera, `towerPanelPos` / `basePanelPos` / `minimapPanelPos` / `gameShopPos`, hover state, `bonusPickerLocked` (cache site at hp > 0 and not unlocked, gating the picker and the digit shortcuts), frame id, run gem/boss counters, milestone breakdown, end-screen data, random-map params, worker reference |
| `src/stores/persist.ts` | Persistent state: gems, unlocks, difficulty, map progress, random-map and progressive-map preferences, last-selected theme and map, sound on/off preference, localStorage I/O |
| `src/stores/ui.ts` | UI state: confirm dialog, notifications, main menu / skill tree / stats / help / minimap overlay flags, debug panel visibility, enemy commander selection, random-map panel, the `overlayPausedSim` flag plus the `beginOverlayPause` / `endOverlayPause` / `anyPauseOverlayOpen` trio that make the pause a single owner's problem |
| `src/stores/mapTheme.ts` | Map theme state: activeTheme, defaultTheme (preloaded at app init), availableThemes, preload/load actions |

### Map Theme

| File | Description |
|---|---|
| `src/render/themes/index.ts` | Theme registry: `MAP_THEME_MANIFEST` (id/label/file entries), lazy loaders, `MapThemeData`/`TowerVisualMeta`/`EnemyVisualMeta`/`RegionVisualMeta` types, `RegionMapLayout`/`RegionMapNode`/`RegionMapConnection` region map types |
| `src/render/themes/normalize.ts` | `normalizeThemeImages(theme)`: walks theme object, fetches external SVG path/URL refs, replaces with inlined SVG text (including the top-level `menuBackground`) |
| `src/render/themes/data/default-map-theme.json` | Default theme data: tower/enemy SVG sprites, tile images (path + 4 terrain heights per region), base 3×3 SVG per region, region map image + level layout per region, optional `menuBackground` SVG |

### Vue Components

| File | Description |
|---|---|
| `src/components/GameScreen.vue` | Game layout container: SvgGameRoot, HUD, shop, tower + base panels, wave countdown, debug panel, wave graph, and the parent-gated overlays. Owns the popstate leave-guard and the terminal-state redirect; does not own worker disposal |
| `src/components/SvgGameRoot.vue` | Single SVG root: RAF loop, GameEngine lifecycle (receives active theme), imperative DOM rendering, CTM-based input, SpawnManager initialization |
| `src/components/GameHud.vue` | Top bar: base health, integer gold (floored, since Bounty pays fractional), gems, wave counter, speed/sound/pause/minimap/stats/help/menu controls (every button carries an `aria-label`; the state-stable toggles — sound, minimap — report `aria-pressed`, while the pause button does not, because its label already flips Pause/Resume and the two together announce "Resume, pressed". Sound toggles `persistStore.soundEnabled`, mirrored onto the live SoundManager by SvgGameRoot). The `Effects xN` chip is a real `<button aria-expanded>` whose popup opens on click, hover, or focus-within (anchored to the chip's right edge so long themed names cannot overflow, and itself focusable so the `overflow-x` list is reachable). Notifications are one `setTimeout` per notification against the store's absolute `expires`, not a poll interval — the toast's visibility is read straight off `uiStore.notification`, so there is no second flag to keep in step. The bar owns its own layout and publishes its measured height as `--hud-height` on `<html>` (mount + `ResizeObserver`) for the play area, the toast, and `EnemyChat` to clear. Uses `getMapDisplayName` for the map label |
| `src/components/GameShop.vue` | Bottom bar: tower build selection with cost (from constants) and themed name/color/icon (from active theme). Cards are real `<button>`s with `:disabled` and `aria-pressed`. Header drag + touch drag come from `usePanelDrag`; the resize edge-pinning handler is local |
| `src/components/TowerPanel.vue` | Floating detail panel: tower stats, targeting mode, upgrade/sell, specialization, fixed-aim pad; themed name/color/icon from active theme. Position is `gameStore.towerPanelPos`; shared panel chrome lives in `detailPanel.css` |
| `src/components/BasePanel.vue` | Floating detail panel for the base: health, the short/long sentry gun stat blocks, targeting, upgrade/downgrade. Position is `gameStore.basePanelPos`, deliberately separate from `towerPanelPos` so dragging one panel cannot move the other; shared chrome lives in `detailPanel.css` |
| `src/components/WaveCountdown.vue` | Inter-wave countdown overlay shown before each wave spawns; the label carries the next wave's rolled boss abilities |
| `src/components/BonusPicker.vue` | Three-card reward picker for a supply drop or a map cache: card copy with current → next mults, themed specialist tower name (`Sharpened · Rifle Tower (Basic)`), wave-scaled cache fee or Free for a broken cache, dismiss leaves the package claimable. An intact cache opens locked — only `Unlock for N gold` and `Leave it`, dispatching `action:unlockCache` — and shows the cards once unlocked |
| `src/components/WaveGraph.vue` | Per-wave graph overlay: damage dealt, gold earned, gems earned, max enemy HP across all waves |
| `src/components/PauseMenu.vue` | Pause menu overlay: resume, skill tree, difficulty adjustment, quit to main menu |
| `src/components/HelpDialog.vue` | Help overlay: three tabs in a WAI-ARIA `tablist` (roving `tabindex`; ArrowLeft/ArrowRight/Home/End move and select, and `selectTab` moves DOM focus onto the newly selected tab on the next tick — with a roving tabindex the selected tab is the strip's only tab stop, so focus has to follow the selection). `aria-controls` is bound only on the selected tab, because the inactive panels are not rendered. The shortcut table quotes the active world's re-roll price via `progressiveRerollGoldPerWave`, not the content-pack default |
| `src/components/MainMenu.vue` | Main menu: large theme buttons (faded `menuBackground` preview per theme, persisted selection), New Game section (Select Map /map-select, Progressive Run and Generate Map buttons opening the shared `ProgressiveMapDialog` / `GeneratedMapDialog`), skill tree, commanders, run history, difficulty slider |
| `src/components/GeneratedMapDialog.vue` | Generated-map custom-run dialog (`show` prop + `close` emit, teleported to body, closes on Escape while shown): region/level/style/width/height/seed form bound to `persistStore` random-map preferences (blank seed = auto-roll), validation via `alert()`, then `themeStore.ensureActiveTheme()`, `generateRandomMap` with `themeStore.resolvedMaps`, `gameStore.initMap(CUSTOM_RANDOM_MAP_INDEX, …)` + `randomMapParams`, push `/game` |
| `src/components/ProgressiveMapDialog.vue` | Progressive-map custom-run dialog (same API): region/level/base-entries/seed form bound to `persistStore` progressive-map preferences (blank seed = auto-roll), validation via `alert()`, then `generateProgressiveMap(config)`, `gameStore.initMap(CUSTOM_PROGRESSIVE_MAP_INDEX, …)`, push `/game` (no theme resolve — the board is built from config only and the worker recovers it via `progressiveConfigFromMap`) |
| `src/components/MapSelect.vue` | Map selection screen: header row with the 3 region tabs on the left and theme drop-down / "Generate" / "Progressive" / Back controls on the right (narrow screens stack to two centered rows with the controls above the tabs); each tab shows a `RegionMap` with 12 level + 4 progressive markers (unlock status, best waves, gem multipliers in tooltips); click selects a marker (details panel with Play button plus an on-map play button under the marker), double-click plays, locked markers never start; the selected map index persists (region tab derived from it; switching tabs pre-selects that region's first map level, so the details panel always shows a map) and restores on load, falling back to the default region's first level when nothing was saved; awaits theme resolution before navigation; "Generate" / "Progressive" buttons open the shared `GeneratedMapDialog` / `ProgressiveMapDialog` components (one at a time, parent-owned `show` refs), which render their custom-run forms teleported to body |
| `src/components/RegionMap.vue` | Region map SVG renderer: theme `mapImage` background (nested `<svg>` via `v-html`), connection lines resolved from `RegionMapLayout.connections`, per-node markers (`RegionMapNodeView`: label, tooltip, locked/selected/progressive states, `tabindex`/`role`); emits `select(mapIndex)` on click/Enter, `start(mapIndex)` on double-click or the on-map play button under the selected marker (never for locked markers) |
| `src/components/SkillTree.vue` | Skill tree: tower level unlocks, specializations, add-ons, general upgrades; reads default theme (not active theme) |
| `src/components/EndScreen.vue` | Victory/game-over screen: gem breakdown, wave count, navigation buttons; reads default theme for region names |
| `src/components/ConfirmDialog.vue` | Global modal dialog (teleported to body, driven by uiStore) |
| `src/components/DebugPanel.vue` | Debug overlay: gold/gems/lives injection, wave skip, enemy clear, map unlock |
| `src/components/StatsPanel.vue` | Wave composition, enemy list, and run statistics; reads enemy name/color/shape from active theme |
| `src/components/HistoryScreen.vue` | Run history entries with gem breakdown formatting; reads default theme for region names |
| `src/components/CommandersScreen.vue` | LLM commander management UI: create/edit/delete custom commanders, activate built-in or LLM commanders |
| `src/components/EnemyChat.vue` | Draggable in-game chat panel for interacting with an active LLM enemy commander. Resting position sits below the published `--hud-height` (16px gap) so it never covers the map title or the health/gold/gems readouts, including under a wrapped mobile bar; drag clamps to the viewport |
| `src/components/HelpTowerTab.vue` | Towers help tab: per-tower stat table for a chosen level, with both specialization rows from level 5 |
| `src/components/HelpEnemyTab.vue` | Enemies help tab: per-enemy stat table for a chosen wave, dimming types that cannot spawn yet |
| `src/components/progressivePreview.ts` | `progressiveCellRects` (5x5 block cells in absolute coordinates, filled from the region's theme tiles) and `progressivePatternMarkup` (the on-map ghost, cells + selection stroke). Both take the region's `RegionVisualMeta`; both the offer cards and the SVG ghost go through the one cell builder |
| `src/components/detailPanel.css` | Panel chrome shared by `TowerPanel` and `BasePanel`, every rule namespaced under `.detail-panel`. Imported once from `App.vue` because Vue cannot scope an `@import`ed stylesheet. Each panel's `<style scoped>` block holds only its own differences, and it has to out-specify these rules deliberately: a shared descendant rule like `.detail-panel .action-btn` is (0,2,0), which **ties** a scoped `.action-btn[data-v-x]` rather than losing to it, so the winner is decided by CSS chunk load order. An override therefore repeats the panel's own identity class — `.tower-panel .sell-btn` compiles to (0,3,0) and wins on specificity alone |

### Game Engine

| File | Description |
|---|---|
| `src/sim/GameEngine.ts` | Simulation core: no rendering. Takes plain `GameRunState` + `PersistState` + `HostBindings` + `ThemeBundle`; runs inside the Web Worker (`src/sim/WorkerEntry.ts`) on a `setTimeout` fixed-timestep loop; produces a `SimulationSnapshot` each tick and applies `Command`s via `applyCommand`; passes visual meta to Tower/Enemy constructors |
| `src/sim/Constants.ts` | Facade over content packs + engine/UI wiring: wave/economy/map tables from `getGameContent()`, plus FIXED_DT, `TIME_SCALES`, `progressiveRerollGoldPerWave(worldMaps)` (the active world's re-roll price, falling back to the pack default — shared by the engine, `ProgressivePlacement`, and the help dialog so the quoted cost cannot disagree with the charge), GameState, wave-graph colors. The old `HEADER_HEIGHT` / `FOOTER_HEIGHT` UI-layout exports are gone: chrome heights are CSS custom properties |
| `src/sim/ConstantsTower.ts` | Facade: TowerIds, TOWER_BASE/META/VARIANTS/ADDON_EFFECTS and combat scalars from `src/content/data/towers.json` |
| `src/sim/ConstantsEnemy.ts` | Facade: ENEMY_TYPES and enemy/wave scalars from `src/content/data/enemies.json` |
| `src/content/data/*.json` | Declarative balance/content packs (towers, enemies, economy, maps, skill-tree) validated by Zod at load |
| `src/content/schemas/*` | Zod schemas for game content, raw map themes, LLM responses, persist save shape |
| `src/composables/Input.ts` | Keyboard input composable: dispatches build/upgrade/sell/speed/pause intents through the command seam, and Page Up/Down, Ctrl+arrow pan, plus arrow-key follow through the camera actions. Speed keys dispatch only — `gameStore.timeScale` is a snapshot mirror, so the UI never writes it. `Space` calls `uiStore.closeAllDialogs()` whenever `anyPauseOverlayOpen` and only toggles the sim when nothing is up, so it cannot resume a run behind a modal that is still showing |
| `src/composables/usePanelDrag.ts` | Header-drag behavior for every floating in-game panel: one implementation of the mouse and touch gesture against a `read`/`write` pair, ownership of the gesture listeners (released on `mouseup`/`touchend`/`blur`/`touchcancel` and on unmount), and an optional viewport clamp that needs the panel element for its size. `panelRef` is required; `clampOnResize: false` opts a caller out of the automatic re-clamp on viewport resize |
| `src/composables/progressivePlacement.ts` | Main-thread placement helpers shared by the keyboard path and the SVG click path: offer selection/rotation, site probing, and the right-click rotate entry point |
| `src/sim/ProjectileManager.ts` | Game-side projectile simulation: travel, hits, splash, chain, burn, knockback. `computeMaxHitCount` is the single pierce-total helper for every tower path; bounce falloff scales damage and burn/slow/stun magnitudes together; `creditDamage` is the public out-of-band credit entry used by burn ticks |
| `src/sim/ParticleSystem.ts` | Game-side particle simulation: spawn, motion, life/expiry |
| `src/sim/WaveGraphTracker.ts` | Per-wave graph data: damage dealt, gold earned, gems earned, peak enemy HP per wave |
| `src/sim/physics/PhysicsWorld.ts` | Rapier2d physics world: static geometry (base/towers/corridor walls), dynamic enemy bodies driven by velocity |
| `src/sim/physics/rapierContext.ts` | Lazy WASM loader for Rapier2d; gates physics initialization until resolved |

### Grid & Maps

| File | Description |
|---|---|
| `src/sim/grid/Grid.ts` | Grid data structure: path tiles, base/spawn locations, build validation |
| `src/sim/grid/Map.ts` | Procedural map generation: 36 maps, 3 regions, 6 layout styles (open, canyon, serpentine, split, bastion, battlefield); `name` computed lazily via `getMapDisplayName(map, theme)`. `carveWidePath` half-extent is `floor(width/2)` (width 1 = one tile); serpentine is a single winding pass honoring `width`; every spawn is inset at least one tile from the map border; `invalidateMapCache()` drops the per-index cache |
| `src/sim/navmesh/*` | Recast navmesh, DetourCrowd, distance field, path metrics |
| `src/sim/physics/ForceFieldSystem.ts` | Continuous radial/directional force fields for future push/pull towers |
| `src/sim/physics/ContactProcessor.ts` | Rapier collision events → siege/base attack + projectile hits |

### Map Sites & Rewards

| File | Description |
|---|---|
| `src/sim/mapSites.ts` | Site placement rules for buildings, caches, and supply drops: clearance constants (building ring, cache-to-building, cache-to-path, spawn/base), rank hash of the world position, quota fill for the opening board, and the progressive stamp reconcile |
| `src/sim/MapSiteManager.ts` | Owns the board's claimable site lists and the reserved-tile set derived from them (sites block construction but stay out of the navmesh); nearest-package click test, free corridor tile for a drop, shift/snap when the layout moves |
| `src/sim/runBonuses.ts` | Run rewards: bonus id pool, three-card offer rolls keyed by map seed + package id, Heavy Frost curation on first open, specialist type draw weighted by live towers, `TYPED_PERSISTENT_FACTOR` (1.2) for the four typed cards, themed card copy via `BonusContext.themeTowerName`, wave-scaled purse and cache-fee helpers, run bonus mult records, `runBonusSummaryParts` for the HUD effects list |

### Towers

| File | Description |
|---|---|
| `src/sim/towers/Tower.ts` | Tower entity: stats, targeting modes, level scaling, variants, sell value, milestone bonuses; accepts `visualMeta` param (color, icon, name, animation, walking) from active theme. Milestone tiers are capped by `milestoneMaxTiers`; the stats cache key encodes the capped tiers plus `addons.join(",")`. Terrain damage multiplier is capped by `terrainDamageBonusMaxMult`; ghost restore time is clamped by `ghostRestoreMinSeconds`; `recomputeMaxHealth` keeps float precision; thorn reflect and electric fence credit `totalDamageDealt`/`waveDamage` |
| `src/sim/towers/TowerManager.ts` | Tower placement, upgrade, sell with refund/discount modes; receives visual meta from GameEngine |
| `src/sim/towers/SkillTree.ts` | Gem upgrade costs, unlock/refund logic, variant definitions, general add-on config. `isAvailable`/`tryUnlock` share one precondition helper; individual general-addon refunds (`canRefundGeneral`/`tryRefundGeneral`) mirror the bulk path, including per-flag `sellOption` refunds and clearing `sellActive` when the active mode is refunded |

### Enemies & Waves

| File | Description |
|---|---|
| `src/sim/enemies/Enemy.ts` | Enemy entity: types, stats, pathfinding, status effects (slow, stun, shield); accepts `visualMeta` param (color, shape, name, walking, hitReaction) from active theme. `takeDamage` returns shield-absorbed + HP damage for telemetry; burn stacks track `sourceTowerId` and credit the inflicting tower via `EnemyManager.creditDamage` while still bypassing shields and applying resist; `knockResist` scales knockback; `postPhysics` falls back to crowd-agent or kinematic integration when no Rapier body exists |
| `src/sim/enemies/EnemyManager.ts` | Enemy lifecycle: spawning, movement, death, base reach; receives visual meta from GameEngine. Owns the `setDamageCreditSink`/`creditDamage` bridge used by burn ticks |
| `src/sim/waves/WaveManager.ts` | Wave composition, enemy count scaling, boss cadence, inter-wave timer |
| `src/sim/bossAbilities.ts` | Boss ability pool and labels, per-wave roll without replacement (vanilla-first boss), `configureBossAbility`, ability ticks (minion pulse, Mend aura, haste aura, shield pulse, bombard telegraph), per-tick Mend source collection and nearest-source suppression |

### Rendering

| File | Description |
|---|---|
| `src/render/svg/EnemyManager.ts` | Enemy rendering pool: `<use>` elements with `<symbol>` href animation, hit flash circles, slow filter application |
| `src/render/svg/TowerManager.ts` | Tower rendering pool: `<use>` elements with barrel rotation, level pip `<circle>` elements |
| `src/render/svg/ProjectileManager.ts` | Projectile rendering pool: `<circle>` bullets, `<line>` beams |
| `src/render/svg/ParticleManager.ts` | Particle rendering pool: `<circle>` elements with fade/expansion |
| `src/render/svg/EffectManager.ts` | Lightning paths, stun aura paths, build preview rect, range circle, upgrade button SVG elements |
| `src/render/svg/UiOverlayManager.ts` | HP bars (enemy bars only while hp < maxHp, matching the text renderer; tower bars only while damaged), shield bars, boss HP text as pooled `<rect>` and `<text>` elements |
| `src/render/svg/SpawnManager.ts` | Spawn point rendering pool: `<use>` elements for spawn location indicators |
| `src/render/svg/MapSiteLayer.ts` | Site glyph markup (supply drops with the `site-drop-pulse` halo ring and `aria-label`, caches with HP bars plus icon and wave-scaled lock/unlock label, buildings with icon and `buildingBlurb` detail) behind a signature cache that includes `unlocked`, so the layer only rewrites when a site, its unlock state, or the wave changes |
| `src/render/svg/siteHover.ts` | Map-site hover: `siteHoverAt` (package click radius, ±9-unit building box, nearest package wins over the building behind it) and `siteHoverText` (per-state tooltip copy for drops, locked/unlocked/broken caches, buildings); consumed by `SvgGameRoot` into the `.site-hover` tooltip div |
| `src/render/svg/useSvgStaticContent.ts` | Composable: builds `<defs>` (symbols from active theme's tower/enemy frames, region gradients, filters) and grid layer SVG strings (tile images + base art from theme) |
| `src/render/svg/cameraFrame.ts` | Pure view-frame math: `fitFrame`, `zoomFrame`, `panFrame`, `revealPoint`, `wheelZoomFactor`, plus frame constants (`EDGE_BUFFER_FRACTION`, `ARROW_PAN_FRACTION`, zoom/step limits). `SvgGameRoot` writes the result into the SVG `viewBox` |
| `src/render/svg/types.ts` | Shared types for render proxies and managers |
| `src/render/text/TextGridBuilder.ts` | Static char buffer (3×3 chars per tile) for the `<pre>` monochrome base grid (terrain `·`, path empty, base `#`, spawn `S`) |
| `src/render/text/TextTowerManager.ts` | Draws each tower theme `icon` in theme `color` at its tile-center on the canvas overlay |
| `src/render/text/TextEnemyManager.ts` | Draws each enemy theme glyph (via `getEnemyGlyph(shape)`) in theme `color` at the enemy's scaled `enemy.x/enemy.y` on the canvas overlay |
| `src/render/text/TextPathRenderer.ts` | Draws worker-authoritative enemy paths as faint polylines on the canvas overlay, caching the last non-null paths across cleared frames |
| `src/render/text/TextOverlayRenderer.ts` | Canvas overlay: projectile dots, thin HP bars, lightning lines, stun marks (mirrors svg Projectile/UiOverlay/Effect managers) |
| `src/render/text/types.ts` | `TextRenderScale` (separate x/y world→canvas scales) and `TextThemeAccess` interfaces |
| `src/components/TextGameRoot.vue` | Second passive renderer: renders a `<pre>` static base grid + a `<canvas>` overlay, driven by its own rAF loop reading `getLatestSnapshot()`; no worker, no `snapshotAck`, no input |
| `src/components/MinimapPanel.vue` | Movable hovering panel (drag from `usePanelDrag`, uses `gameStore.minimapPanelPos`) hosting `TextGameRoot`; toggled by `uiStore.showMinimap` |
| `src/components/SvgGameRoot.vue` | Single SVG root: creates the simulation Web Worker, owns `SnapshotStore` (render loop reads snapshots) and `WorkerCommandDispatcher` (click/key intents → commands); rAF render loop does imperative DOM writes; the SVG viewBox is the camera (wheel zoom, right-drag / Alt+left-drag / inert-point left-drag pan); CTM-based mouse→world coordinate conversion; passes theme bundle to worker at `lifecycle:init` and to `useSvgStaticContent`; initializes SpawnManager; owns map-site hover (`siteHoverAt` on the pointer, `.site-hover` tooltip div, suppressed while the picker or a pan is active) |

### Audio

| File | Description |
|---|---|
| `src/sound/SoundManager.ts` | WebAudio synth: shoot, hit, boss death, base hit, upgrade sounds |

### Enemy Commanders

| File | Description |
|---|---|
| `src/commanders/index.ts` | Lifecycle: `setEnemyCommander` starts/stops relay; `stopEnemyCommander` releases held enemies via `llm:routeGroup` before termination |
| `src/commanders/CommanderWorker.ts` | Web Worker entry: owns `CommanderBrain` + memory, dispatches `decide()` per observation, posts commands back to main thread |
| `src/commanders/relay.ts` | Main-thread relay: ~4 Hz poll of `SnapshotStore`, builds throttled slice, posts to worker, forwards commands via `dispatchCommand`; owns `gridLayout` cache keyed to `runId` |
| `src/commanders/protocol.ts` | Main↔worker message protocol: `CommanderSnapshotSlice` (throttled snapshot slice), `MainToCommanderMessage`, `CommanderToMainMessage` |
| `src/commanders/observation.ts` | Pure projection from `CommanderSnapshotSlice` → `CommanderObservation` (enemy world→tile, tower hp rename, pending spawn sum) |
| `src/commanders/brain.ts` | `CommanderBrain` interface + `CommanderMemory` state + `createBrain()` factory |
| `src/commanders/stubby/brain.ts` | Sergeant Stubby: hold-then-rush (holds emerging enemies, rushes wave to base when wave completes) |
| `src/commanders/stubbs/brain.ts` | Commander Stubbs: aggressive routing to highest-HP live tower ahead of the group; re-routes on tower-set change |
| `src/commanders/llm/types.ts` | `LlmCommanderConfig` interface + `DEFAULT_LLM_SYSTEM_PROMPT` constant |
| `src/commanders/llm/schema.ts` | Message schemas for LLM API communication |
| `src/commanders/llm/apiClient.ts` | HTTP client for posting observations and receiving commands from LLM endpoint |
| `src/commanders/llm/systemPrompt.ts` | System prompt template for enemy commander behavior |
| `src/commanders/llm/brain.ts` | LLM-based `CommanderBrain` that uses `apiClient` to communicate with external model |

### Camera

The SVG `viewBox` is the camera. `gameStore.camera` holds `centerX`, `centerY`, `viewHeight`, and `followsMap`. While `followsMap` is true, `SvgGameRoot` frames the smallest viewport-aspect rectangle that contains the map and tweens that frame when a progressive board grows. A zoom or pan clears `followsMap`. Page Down, or a zoom out that reaches the fit frame, sets it again. A progressive placement hold also sets it, and the same 320ms ease pulls a zoomed frame back out to the whole board so the sites are visible. A zoom or pan during the hold takes the frame back. `worldLayer` stays at identity so the frame is not applied a second time. Wheel, right-drag, Alt+left-drag, and a primary-button drag on a point whose click would not change run state (decided on the main thread by `src/render/svg/clickHasEffect.ts`, which mirrors `GameEngine.handleClick`) are handled on the SVG. Page Up/Down, Ctrl+arrow pan (`panCameraByFraction`, `ARROW_PAN_FRACTION` of the frame per axis), and arrow-key follow go through `Input.ts` into `zoomCamera`, `panCameraByFraction`, and `revealCameraPoint`. An arrow pans only when the highlighted build tile, selected tower, or placement-site center is closer to an edge than 20% of the frame width, and only on the axes that cross that line, far enough to put the point on it. The same width fraction is used for the vertical edges. A point already inside that inset does not move the frame, and a pan that the map clamp absorbs does not clear `followsMap`. The frame math is in `src/render/svg/cameraFrame.ts`. Camera state stays on the main thread and is not part of `SimulationSnapshot`.

## Game Content Packs (Zod)

Declarative balance and copy live under `src/content/data/` as split JSON packs, validated once at load via Zod (`src/content/loadGameContent.ts` → `getGameContent()`). Call sites keep importing `@/sim/Constants*.js` facades so the sim/UI import graph stays stable.

| Pack | Contents |
|---|---|
| `towers.json` | meta/base stats (incl. `groundOnly` — tower cannot target or hit flying enemies; the cannon Anti-Air addon clears it), combat tuning scalars (`milestoneMaxTiers`, `ghostRestoreMinSeconds`, `terrainDamageBonusMaxMult`), variants (`settings` + `statOps`), addon effects. Dead knobs `deepFreezeSlowMult` and `cannonFragmentSplashTiers` were removed (the ice addon uses its inline `slowMult`, cannon-A its inline statOp tiers); lightning omits `base.projSpeed` (chain lightning is instant and the schema now allows it) |
| `enemies.json` | enemy type table (with optional `knockResist` per type), HP mult coeffs, wave/boss scalars, `bountyLevelGrowth`, `bountyFullThroughWave`, `laterWaveBountyMult` |
| `economy.json` | gems, milestones, difficulty, general-addon costs/effect arrays, starting gold/health |
| `maps.json` | MAP_LEVELS (36), map-gen scalars |
| `skill-tree.json` | level/addon costs, variant/addon labels, general-addon defs/categories |

**Stays code (not packs):** engine loop constants (`FIXED_DT`, `MAX_ACCUM`), `TIME_SCALES`, `GameState`, wave-graph colors, skill unlock/refund logic, `applyVariantOps` interpreter, combat behavior in Tower/ProjectileManager. UI layout heights are not here either — they are CSS custom properties in `App.vue`.

**Variant ops:** `TOWER_VARIANTS` no longer carry `apply` functions. Ops (`set`, `mul`, `mulTier`, `setTier`, `add`, `addPerTier`, `mulPowTier`) are interpreted in `src/content/applyVariantOps.ts` with `tierIdx = level - 5`.

**Other Zod boundaries:** raw map themes (`RawMapThemeSchema` before normalize), LLM commander replies (`validateLlmResponse`), post-migrate persist save (`PersistStateSchema.safeParse` in `persistStore.load`).

**Content immutability:** `loadGameContent()` recursively deep-freezes the parsed content (objects and arrays), not just the top level, so a stray writer cannot mutate nested balance tables at runtime. ESM strict mode makes such writes throw.

### Block E1 Behavior Notes (for balance validation)

E1 was a telemetry/correctness pass, but a few of its fixes are combat-visible and belong in any balance model:

- **Shield telemetry:** `Enemy.takeDamage` now returns shield-absorbed + HP damage, so the DPS graph and milestone progression count damage consumed by enemy shields. Kill/removal and gold-on-kill logic still read `hp`/`removed` and are unchanged.
- **Burn telemetry:** burn stacks track `sourceTowerId`; each tick credits the inflicting tower. Burn still bypasses shields and still applies enemy `resist` (resist was already applied by `takeDamage`; the change is credit, not mitigation).
- **Knockback resist:** per-type `knockResist` scales every knockback impulse by `max(0, 1 - knockResist)`. Content values: boss `0.8`, tank `0.3`, every other type absent (0). Bosses/tanks now take 20%/70% of prior knockback displacement.
- **Bounce status falloff:** a bounced shot scales burn DPS, slow factor, stun duration, and splash-stun by `bounceDamageFalloff` (0.8) in addition to damage, so secondary hits are uniformly weaker.
- **Milestone cap:** `milestoneMaxTiers` (5) caps the compounding milestone damage/fire-rate bonus; `currentMilestoneBonus()` reports the capped tier count.
- **Ghost restore floor:** `ghostRestoreMinSeconds` (5) clamps restore time; before, level ≥ 10 restored instantly (0 or negative seconds).
- **Terrain cap:** `terrainDamageBonusMaxMult` (2.0) caps the total terrain damage multiplier. Behavior-preserving today (current max is 1.8x).
- **Map geometry (traversal-length impact):** `carveWidePath` half-extent is now `floor(width/2)`, so split paths went from 3-wide to 1-wide and open-style width-3 paths from 5-wide to 3-wide; serpentine is a single winding corridor instead of three overlapping passes; every spawn is inset one tile from the border. Path lengths and therefore wave travel times change on most maps.
- **sellOption refunds:** an individual general-addon refund of a purchased sell mode now refunds `SELL_OPTION_GEM_COST` and clears `sellActive` when that mode was active (previously only "Refund All" could recover it).

### Block E2 Gem Income and Balance Anchors

**Gem income.** Wave clears, pre-emptive expiry, and debug wave jumps do not pay gems. `regionGemRewards` was removed from `economy.json`. It was unused until it was wired up as a flat `[1, 2, 4]` paycheck on every clear, and that paycheck was also folded into the first-full-clear ×2. That is what made gem income too high. Level 3 (`levelCosts[2] === 16`) is not funded by a single region-0 run. `HistoryScreen.vue` still renders a Wave Clears block when an older saved entry has `gemBreakdown.waveClears`. New runs do not.

**Pacing.** Gems come from milestones (`MILESTONE_GEMS` 2/3/5 at waves 15/30/50, doubled the first time a map claims them), boss kills (base 1, then difficulty and map multiplier), and the end-of-run `bonusGemBase` (1.12) completion award. A region-0 run through wave 20 earns the first-time wave-15 milestone (4) plus any bosses killed and, if the run ends there, a completion bonus of 2. `bonusGemBase` stays 1.12. `floor(1.12 ^ n)` and `floor(1.10 ^ n)` pay the same completion bonus through wave 60, so lowering the base would not change the awards a player sees before the late waves.

**Balance anchors (map-0 placement oracle).** `tests/unit/sim/balance-wall.test.ts` builds map index 0 (`getMap(0)`, region 0, level 1, serpentine, seed 7777) and spends gold with the real `WaveManager.generateWave` / `Enemy.bounty` / `Enemy.maxHp` numbers. Gold is `startingGoldByRegion[0]` (80) plus bounties of earlier waves. Legal towers are basic and ice, placed only on terrain tiles so the corridor stays open. Time-on-target is the ordered-path chord inside each tower's range; overlapping towers stack. Ice coverage slows the boss by `slowFactor = max(minSlowFactor, 1 - slowAmt * (1 - slowResist))`. Raw damage on that crossing clears the wave's non-boss HP and shields first; the remainder hits the boss after resist (0.3). A fresh profile has levels 1 and 2 unlocked, so "no gem purchase" means basic and ice stop at level 2. Level 3 is the 16-gem unlock.

Measured on difficulty tick 0:

- Wave 10, budget 374 (80 starting + 294 kill gold). Boss HP 1505, trash HP 2038. A level-2 basic/ice spend deals boss damage 49 (0.03× HP) — raw damage barely clears the trash, and the boss keeps about 97%. The wall pins the boss surviving at least half its HP.
- Wave 20, budget 1007 (80 + 927). Boss HP 4239, trash HP 9507. The level-2 cap deals zero boss damage: raw 4839 is fully absorbed by the trash, so the wall is the trash and the boss keeps full HP. With basic allowed to level 3 (all 12 basics at level 3), raw damage rises to 6799, but the boss still takes none and keeps full HP. The wall pins the boss surviving at least half its HP under both caps, and the level-3 unlock raising raw damage above the level-2 cap.
- `bountyLevelGrowth` stays 0.5, so a higher map level still pays more per kill. `laterWaveBountyMult` (0.25) applies only after `bountyFullThroughWave` (10). That is the gold cut between the two bosses. Boss `baseHp` is 192. Starting gold stays `[80, 70, 60]`.
- `milestoneThreshold` is 2000, the 1000-floor of one level-2 basic's post-mitigation damage across waves 1–20 on this map, and it sits above that tower's damage through wave 10. `milestoneMaxTiers` stays 5. The addon is not part of the fresh-profile fights.

**How to change balance:** edit the relevant JSON pack; keep formulas/behavior hooks in TS. Run `npm run check`. Adding a new tower still needs theme frames + any new behavior code paths, but numbers/copy go in packs.

## Map Theme System

A theme swaps the visual identity of towers, enemies, and map tiles on `/game`, and (via the optional `menuBackground` field) the main-menu background and theme-button previews on `/`, while leaving all gameplay stats, effects, and overlays untouched. The current polygon-based art is the default theme (`id: "default"`). Raw theme JSON is Zod-validated before `normalizeThemeImages`.

### How It Works

1. **Theme registry** (`src/render/themes/index.ts`): `MAP_THEME_MANIFEST` lists available themes with `{id, label, file}`. Lazy loaders resolve theme JSON files on demand (parsed with `RawMapThemeSchema`).
2. **Theme store** (`src/stores/mapTheme.ts`): `useMapThemeStore` holds `defaultTheme` (preloaded at app init for synchronous access by non-game screens), `activeTheme` (resolved for the current run), and a `loadedThemes` cache so re-selecting an already-loaded theme is instant (`loadActive` / `ensureThemeLoaded` reuse it).
3. **Theme JSON** (`src/render/themes/data/`): `default-map-theme.json` (default polygon art) and `the-aftermath.json` (alternate theme). Each contains tower frames (SVG `<svg>` strings), enemy walking/hit-reaction frames, per-region tile images (path + 4 terrain heights), base 3×3 SVG art, region map image + layout, and an optional top-level `menuBackground` SVG (the `/` main-menu background and the faded theme-button previews).
4. **Symbol ID contract**: IDs stay `tower-${type}-f${i}`, `enemy-${type}-f${i}`, `enemy-${type}-hit-f${i}`. Themes swap only the *content* inside `<symbol>`s and the color/name/icon metadata. Render managers need zero changes.
5. **Stats vs visuals split:** gameplay numbers live in `src/content/data/` (via Constants facades). Only visual/displayed fields (name, color, icon, shape, animation frames, tile images) live in the theme JSON.

### Scope

- **In scope**: Tower SVG sprites + color/icon/name, enemy SVG sprites + color/shape/name, per-region tile images + base art + display names, and the main-menu background (`menuBackground` on `/`, read from the active theme).
- **Out of scope**: All gameplay data, all effects/overlays (particles, lightning, HP bars, range circles, etc.), the Skill Tree (uses default theme), in-game theme switching, audio.

### UI Integration

- **MainMenu**: Large theme buttons (one per manifest entry, same width as the menu card, each rendering its own `menuBackground` as a faded preview) set the persisted selection (`persistStore.lastSelectedThemeId`) and `loadActive` it; the full-screen background renders `activeTheme.menuBackground` (falls back to a solid dark background when the field is absent).
- **MapSelect**: Theme drop-down selects active theme; "Generate" / "Progressive" header buttons open the shared `GeneratedMapDialog` / `ProgressiveMapDialog` components with the custom-run forms (same buttons on the main menu's New Game section); grid uses responsive `auto-fill` layout; `startMap` awaits `themeStore.ensureActiveTheme()` before navigating to `/game`, and the `GeneratedMapDialog` play action does the same (the progressive dialog needs no theme resolve — its board is built from config only).
- **GameShop / TowerPanel / StatsPanel / GameHud**: Read themed name/color/icon from `mapThemeStore.activeTheme` on `/game`.
- **SkillTree / HistoryScreen / EndScreen**: Read from `mapThemeStore.defaultTheme` (not active theme).
- **SvgGameRoot**: Passes `activeTheme` to `GameEngine` constructor and `useSvgStaticContent` composable.
- **Router guard**: `/game` requires `mapThemeStore.activeTheme` to be non-null.

## Persistence

Game progress (gems, unlocks, difficulty, map progress) is saved to `localStorage` under the key `ghigs_save_1` (legacy `lol_ya_tdg_save_1` and `gempath_save_v1` data is auto-migrated on load). The `persistStore.load()` call in `main.ts` restores saved state on app startup. The `mapThemeStore.preloadDefault()` call in `main.ts` preloads the default theme synchronously before `app.mount()`. Profile reset is available from the main menu.

## Game Routes

| Route | Component | Description |
|---|---|---|
| `/` | `MainMenu.vue` | Main menu: large theme buttons (faded themed previews, persisted selection), New Game section (Select Map / Progressive Run / Generate Map), difficulty slider and navigation |
| `/map-select` | `MapSelect.vue` | Region tabs + themed region map with level/progressive markers, theme drop-down, Generate / Progressive header buttons opening custom-run dialogs, awaits theme resolution before navigation |
| `/skill-tree` | `SkillTree.vue` | Gem-based upgrade tree |
| `/game` | `GameScreen.vue` | Active gameplay with single SVG root + UI overlays |
| `/commanders` | `CommandersScreen.vue` | LLM commander management: create/edit/delete custom commanders, activate built-in or LLM commanders |
| `/game-over` | `EndScreen.vue` | Game over screen (`won: false`) |
| `/victory` | `EndScreen.vue` | Victory screen (`won: true`) |
| `/history` | `HistoryScreen.vue` | Run history with gem breakdown |

## CSS Theming

CSS custom properties are defined in `App.vue` for consistent theming. The UI palette is
warm: a dark warm neutral scale with a single brass accent (`--color-accent`), plus status
and map tokens:

```css
/* surfaces and lines */
--color-bg, --color-panel, --color-panel-soft, --color-border,
--color-surface, --color-surface-subtle, --color-surface-hover,
--color-line, --color-line-strong, --color-scrim, --color-scrim-heavy
/* accent (one solid primary per screen; tinted secondary via -soft/-border) */
--color-accent, --color-accent-soft, --color-accent-hover,
--color-accent-border, --color-accent-strong, --color-on-accent
/* status */
--color-gold, --color-gem, --color-danger, --color-danger-soft,
--color-danger-border, --color-danger-hover, --color-success, --color-success-soft,
--color-success-border, --color-warning, --color-region-0/1/2
/* text and fonts */
--color-text, --color-text-dim, --font-main
/* game screen chrome heights */
--hud-height, --build-bar-header-height, --build-bar-footer-height
```

The three chrome heights are layout rather than palette, but they sit in the same
`:root` block because the `/game` layout is built from them: `SvgGameRoot`'s wrapper
insets its play area by `--hud-height` and `--build-bar-footer-height`, the
notification toast below the HUD offsets by `--hud-height`, `EnemyChat`'s resting
position clears it, and `GameShop` sizes its header and shop row by the other two.
Nothing reads a chrome height from TypeScript any more — the old `HEADER_HEIGHT` /
`FOOTER_HEIGHT` exports in `src/sim/Constants.ts` are gone (one of them named the
build-bar header, not the HUD, which is what made the pair confusing). `GameShop`
measures its own rendered size for the resting position rather than restating either
the CSS button width or the header-plus-row height.

`--hud-height` is measured, not written twice. `GameHud`'s bar owns its own layout
(40px row, `height: auto` wrap under 720px) and is sized from neither the token nor
a hand-counted wrapped height: on mount and on every `ResizeObserver` callback the
component publishes `barRef.offsetHeight` as `--hud-height` on `<html>` (the root
element is what both sibling consumers inherit; a scoped `:root` inside `GameHud`
would compile to `:root[data-v-x]` and match nothing). The `:root` value in
`App.vue` is only the pre-measurement default. `EnemyChat` re-anchors under the
published value on mount, so the panel clears a wrapped mobile bar instead of
sitting under it at a hard-coded `y = 56`.

Theme JSON files hold map art colors only; gameplay effect colors (lightning, HP ramp,
build validity) are intentionally not tokenized. Wave-graph series constants in
`src/sim/Constants.ts` stay hex (sim-adjacent) but their values track the gold, gem,
danger, and success palette values.

All component styles use `<style scoped>` to prevent leakage. Two places are global
by necessity, not by choice: the `:root` token block and the `@keyframes site-drop-pulse` rule in `App.vue`
(site glyphs are written into the SVG with `innerHTML`, so a scoped selector cannot
reach them), and `src/components/detailPanel.css`, which holds the chrome shared by
`TowerPanel` and `BasePanel` — Vue cannot apply a scope id to an `@import`ed
stylesheet. Every rule in that file is namespaced under `.detail-panel`, and both
panels keep a scoped block for their own differences.

That last arrangement has a specificity trap worth writing down, because the naive
version of it is wrong. Vue compiles `.action-btn` in a scoped block to
`.action-btn[data-v-x]` = (0,2,0), and the shared file's `.detail-panel .action-btn`
is *also* (0,2,0). A tie is not a win: the outcome then depends on which stylesheet
the browser sees later, and Vite puts the entry chunk (`index-*.css`, which carries
`detailPanel.css`) before the lazy chunk (`GameScreen-*.css`, which carries the
scoped blocks). It happens to work today, and it silently stops working the moment
import order changes. So an override in a scoped block repeats the panel's own
identity class — `.tower-panel .sell-btn` → (0,3,0) — and wins on specificity instead
of on file order. The same applies to the `.ghost-row` and `.cancel-btn` overrides in
`TowerPanel`.

**One lint gap worth knowing.** `biome.json` keeps `noUnusedVariables` and
`noUnusedImports` off for `**/*.vue`, because Biome does not read the `<template>`
block: every binding referenced only by a template expression reports as unused, and
its autofix would delete working code (`GameHud`'s `gameStore`, every handler passed
to `@click`). `tsc` is blinder still — it does not parse a `.vue` file's script block
at all (only the `*.vue` module shim), and this `tsconfig.json` does not enable
`noUnusedLocals` either. Dead-code detection inside a single-file component therefore
rests on its tests — which is part of why `usePanelDrag` exists, to shrink the surface
that has to be checked by hand. It also means an import that only a template used has
to be removed by hand: nothing will flag it.

## Testing

### Structure

| Directory | Description |
|---|---|
| `tests/unit/` | Unit test files covering all source modules (includes `map-theme.test.ts`, `spawn-manager.test.ts`, `enemy-attack.test.ts`, `snapshot-store.test.ts`, `snapshot-merge.test.ts`, `text-grid-builder.test.ts`, `text-render.test.ts`) |
| `tests/unit/sim/` | Simulation unit tests: `applyCommand.test.ts`, `enemy-routing.test.ts`, `snapshot.test.ts`, `balance-wall.test.ts` (map-0 placement oracle), `gem-income.test.ts` (per-wave gem award paths), `run-bonuses.test.ts` (bonus offers and one-shot cache unlock), `map-sites.test.ts` (site placement rules), `command-validation.test.ts`, `boss-abilities.test.ts` |
| `tests/unit/commanders/` | Commander unit tests: `observation.test.ts`, `stubby-brain.test.ts`, `stubbs-brain.test.ts` |
| `tests/unit/components/` | Vue component tests (22 files, includes `game-screen.test.ts` (which children are mounted and which overlays the parent gates), `base-panel.test.ts`, `use-panel-drag.test.ts` (drag, touch, viewport clamp, gesture-ending events, resize re-clamp, unmount cleanup), `pause-menu.test.ts`, `text-game-root.test.ts`, `bonus-picker.test.ts` locked/unlocked views, `game-hud.test.ts` gold floor / effects chip / notification timer / accessible names, `help-dialog.test.ts` roving tabindex and focus movement) |
| `tests/unit/render/` | Render math tests: `camera-frame.test.ts`, `view-box-tween.test.ts`, `click-has-effect.test.ts`, `snapshot-anim-dt.test.ts`, `site-hover.test.ts` (site hover hit test and copy). Also `tests/unit/svg-map-site-layer.test.ts` for the site glyph layer |
| `tests/integration/` | End-to-end wave simulation (`integration.test.ts`), worker command→snapshot round-trip (`worker-roundtrip.test.ts`), and commander worker round-trip (`commander.test.ts`) |
| `tests/helpers/` | Shared mocks: `mock-stores.ts`, `mock-grid.ts`, `mock-managers.ts`, `mockDefaultTheme` |
| `tests/setup.ts` | Global test setup: in-memory localStorage, Canvas 2D mock, performance.now |

**1946 tests** across all files.

### What's Covered

| System | Test File(s) | Key Behaviors |
|---|---|---|
| Game Engine | `game-engine.test.ts` | Loop, buy/upgrade/sell, pause, timeScale, gem economy, difficulty scaling; WaveGraphTracker covered indirectly |
| Grid & Navmesh | `grid.test.ts`, `tests/unit/sim/navmesh/*` | Tile queries, Recast corridor, DetourCrowd motion, tower obstacles |
| Maps | `map.test.ts` | All 36 maps have valid spawn-to-base paths, region metadata, gem rewards, inset spawns, cache invalidation |
| Map sites | `tests/unit/sim/map-sites.test.ts` | Site quota per region/level, ring-disjoint buildings, caches clear of buildings/path/navmesh, fill-then-stamp reconcile determinism and stamp caps |
| Towers | `towers.test.ts` | Stats with caching, level/variant/addon/terrain/milestone bonuses (with tier cap), sell value, float health precision, ghost restore clamp, thorn credit |
| Enemies | `enemies.test.ts`, `enemy-manager.test.ts` | HP/speed formulas, wave scaling, status effects (slow/stun/burn/shield/heal), shield/burn damage returns and credit, knockResist, headless `postPhysics` |
| Waves | `waves.test.ts` | Composition, boss placement, level calculation, inter-wave timing |
| Boss abilities | `tests/unit/sim/boss-abilities.test.ts` | Ability roll on a stream of its own, vanilla-first first boss, bombard/minion/haste/Mend behavior, per-tick source collection, debug-jump stamping matches the preview |
| Bonus economy | `tests/unit/sim/run-bonuses.test.ts` | Offer distinctness and the one-typed-card rule, 1.2x typed mults, specialist draw weights, Heavy Frost curation for caches and drops, wave-scaled purses and cache fee break-even, one-shot cache unlock (short-purse refusal, no re-charge after dismiss, free break), typed hp/range/rate refresh, armor and bounty application, package placement, chained broken-cache claims |
| Content packs | `content/game-content.test.ts` | Zod parse, facade constants, variant ops, recursive deep freeze |
| Balance wall | `tests/unit/sim/balance-wall.test.ts` | Map-0 placement oracle: wave-10 basic+ice level-2 boss survival, wave-20 level-2 boss survival, wave-20 basic level-3 boss survival plus raw-damage step-up, milestone threshold, region boss cadence |
| Gem income | `tests/unit/sim/gem-income.test.ts` | Clears, expiry, and debug jumps pay no gems; wave 15 pays the first-time milestone only; first full clear doubles boss, milestone, and completion; custom maps still use the region/level boss multiplier |
| Tower Manager | `tower-manager.test.ts` | Build, sell, update, towerAt |
| Enemy Manager | `enemy-manager.test.ts` | Spawn, cull, getEnemiesInRange |
| Enemy Attack | `enemy-attack.test.ts` | Enemy base/tower attack behavior, damage, and cooldowns |
| Skill Tree | `skill-tree.test.ts` | Unlock/refund/cost logic for all towers and general addons, individual-vs-bulk sellOption refund parity |
| Projectiles | `projectile-manager.test.ts`, `game-projectile-manager.test.ts` | Render pool (`<circle>`/`<line>`) and game-side simulation: all 8 tower types × 2 variants (16 projectile behaviors), splash, chain, burn, knockback, centralized pierce totals, bounce status falloff |
| Particles | `particles.test.ts` | Spawn, update, render, fade, expire, count limits |
| Spawn Manager | `spawn-manager.test.ts` | Spawn element pool initialization, syncFromGameEngine DOM writes, element recycling |
| SVG Render Managers | `svg-effect-manager.test.ts` | Effect pool allocation, syncFromGameEngine DOM writes, element recycling, visibility toggling |
| Map site layer | `tests/unit/svg-map-site-layer.test.ts` | Site glyphs and boss rings built once, layer rewritten only when the signature changes |
| Sound | `sound-manager.test.ts` | WebAudio synth, all sound names, dispose, enabled flag |
| Stores | `game-store.test.ts`, `persist-store.test.ts`, `ui-store.test.ts`, `map-theme.test.ts` | State, getters, actions, save/load, schema migration; theme registry, loader, normalize, store preload/load/visual getters. `ui-store.test.ts` also pins the overlay pause ownership: pause-on-open, no second toggle for a stacked overlay, and resume only when the last pause overlay closes |
| Snapshot Store | `snapshot-store.test.ts`, `sim/snapshot.test.ts` | Latest-snapshot holding, meta mirroring into gameStore, snapshot serialization/round-trip |
| Enemy Commanders | `tests/unit/commanders/observation.test.ts`, `lifecycle.test.ts`, `stubby-brain.test.ts`, `stubbs-brain.test.ts`, `tests/unit/sim/enemy-targeting.test.ts`, `integration/commander.test.ts`, `integration/commander-llm.test.ts` | Observation projection (world→tile, hp rename, type, targetingMode, base hp, countdown), switch clears route and targeting, Stubby hold-then-rush per wave, Stubbs ahead-tower routing + tower-set re-route, engagement-policy tower selection including snapped terrain towers, LLM transcript resend, tower distance, zero-hp removal, fence recovery, delta removals, instruction-change rebuild, chat forwarding |
| Physics | `tests/unit/sim/physics/enemy-physics.test.ts`, `tests/unit/sim/physics/physics-world.test.ts`, `integration/physics-motion.test.ts` | Rapier2d body/collider creation, static geometry (base/towers/corridor), dynamic enemy motion, velocity integration, collision with walls and towers |
| Router | `router.test.ts` | Navigation guards, block without map, save on leave, redirects, activeTheme requirement |
| Input | `input.test.ts` | Keyboard dispatch, timeScale, pause, upgrade/sell, escape handling, `Space` closing a modal instead of resuming the sim behind it |
| Components | 22 files in `tests/unit/components/` | Rendering, user interactions, store bindings. `game-screen.test.ts` stubs all sixteen children so it asserts GameScreen's own gating and the terminal-state redirect; `use-panel-drag.test.ts` covers the shared drag composable including its viewport clamp, the gesture-ending events, and the resize re-clamp |
| Integration | `integration.test.ts`, `worker-roundtrip.test.ts` | Single wave simulation: kill enemies, gold economy, boss mechanics, victory; command→snapshot worker round-trip |
