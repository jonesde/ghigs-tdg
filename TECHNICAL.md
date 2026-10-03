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
│   ├── game.ts                  # Volatile per-run state: lives, gold, wave, game state, selection, camera, tower/panel positions, hover state, frame id, run gem/boss counters, milestone breakdown, end-screen data, random-map params, worker reference
│   ├── persist.ts               # Persistent meta-progression: gems, unlocks, difficulty, map progress, random-map and progressive-map preferences, last-selected theme and map, sound preference (localStorage)
│   ├── ui.ts                    # UI overlay state: confirm dialogs, notifications, menu/skill-tree/stats/help/minimap context, debug panel, enemy commander selection, random-map panel, wasPlaying flags for pause/skill-tree/help
│   └── mapTheme.ts              # Map theme state: activeTheme, defaultTheme, availableThemes, preload/load actions, resolvedMaps (active world's maps catalog), regionNames, ensureActiveTheme
├── composables/
│   └── Input.ts                 # Keyboard input composable: dispatches to Pinia stores + engine via the command seam
├── components/
│   ├── GameScreen.vue           # Root game layout: SvgGameRoot + HUD + shop + tower panel + wave countdown + debug + wave graph + pause menu
│   ├── SvgGameRoot.vue          # Single SVG root: creates the simulation Web Worker, owns SnapshotStore (render loop reads snapshots) and WorkerCommandDispatcher, imperative DOM rendering, SpawnManager
│   ├── TextGameRoot.vue         # Second passive renderer: monospaced <pre> static base grid + canvas overlay; own rAF loop reads getLatestSnapshot() (no worker, no ack, no input)
│   ├── MinimapPanel.vue         # Movable hovering panel (copy of TowerPanel drag pattern) hosting TextGameRoot; toggled by uiStore.showMinimap
│   ├── GameHud.vue              # Top HUD bar: lives, gold, gems, wave, speed/sound/pause/menu buttons
│   ├── GameShop.vue             # Tower shop bar: build selection with cost display and discount support
│   ├── TowerPanel.vue           # Tower detail panel: stats, targeting, upgrade/sell, specialization
│   ├── WaveCountdown.vue        # Inter-wave countdown overlay shown before each wave spawns
│   ├── WaveGraph.vue            # Per-wave graph overlay: damage, gold, gems, max enemy HP
│   ├── PauseMenu.vue            # Pause menu overlay: resume, skill tree, options, quit
│   ├── ProgressivePlacement.vue # Between-wave block offer: height-shaded 5×5 previews, rotation, site hint
│   ├── HelpDialog.vue           # Help/controls overlay (toggled from in-game menu)
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

### Four Pinia Stores

- **`gameStore`** — reactive mirror/projection of the simulation `SimulationSnapshot`. The worker is authoritative for simulation state; `gameStore` holds the subset the Vue UI binds to (lives, gold, wave, game state, selection, time scale, dialog visibility, frame id, run gem/boss counters, milestone breakdown, end-screen data) and is updated by snapshot diffs each frame. Main-thread-only state (camera, hover tile, hover-upgrade-button, tower/panel positions, random-map params, worker reference) also lives here. Reset when starting a new map.
- **`persistStore`** — persistent meta-progression (gems, unlocked skills, map progress, difficulty, general add-ons, random-map and progressive-map preferences, last-selected theme and map) and LLM commander configurations (`llmCommanders` array). Auto-saved to `localStorage` via manual `save()` calls.
- **`uiStore`** — UI overlay visibility and confirm dialog state, plus notifications, minimap toggle, enemy commander selection ("none"/"stubby"/"stubbs"), random-map panel visibility, and wasPlaying flags for pause/skill-tree/help (so closing these overlays restores the prior playing/paused state).
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

The board uses absolute block coordinates. The base block is `(0, 0)` and north is negative Y. Each block is 5×5 tiles. `generateProgressiveCatalog` builds 10 templates from the variant seed: path patterns (straight, elbows, tee, plus, some with an open center) plus two terrain fills. Terrain height is `flat`, `ramp`, `ridge`, or `peak`, stored on the template tiles as height 1–4. Path tiles are height 1.

`boardToGeneratedMap` writes `originTileX` / `originTileY` from the block bounds minus a one-block margin. `Grid.worldOriginX/Y` is that origin times the 36px tile size. West or north growth lowers the origin so an existing tile keeps its world position. `Grid.replaceFromMap` returns `shiftX` / `shiftY` and applies that shift to `blocked`, `terrainTowers`, and `ghostTowers`. Callers add the same shift to tower tile indexes and enemy route tiles. Enemy and tower world positions are not moved.

The worker's `progressivePlacements` array is the authoritative layout. Each stamp is a template index, rotation, block coordinates, and `fill`. `SnapshotSerializer` ships the array only when `layoutGeneration` differs from `lastPostedLayoutGeneration`, then records that generation, the same gating the wave-graph dots use. `layoutGeneration` 0 is the start board and ships on the first snapshot. `SnapshotStore` calls `gameStore.applyProgressiveLayout`, which replays `generateProgressiveMap(config, stamps)` into a new main-thread `map` and `Grid`. The main thread does not share the worker's grid object.

A hold opens every `PROGRESSIVE_PLACEMENT_INTERVAL` (3) waves when the wave is greater than 0 and less than `VICTORY_WAVE`. `onWaveCleared` arms resume mode `"countdown"`. `onWaveExpired` arms `"expire-advance"`. `armPlacementHold` draws 2 offers, or 3 when `generalAddons.progressiveThirdChoice` is set, sets `progressivePlacementHold`, pauses the run, clears the selected tower and build type, and sets `WaveManager.advanceHeld`. The snapshot that first carries that hold is forced through the ack gate (`decideSnapshotPost`). The run pauses inside the arming tick, and later paused ticks post nothing until a command, so an unforced drop leaves the block cards hidden until a key. Pause and speed inputs are ignored for the duration (`Input.ts`, `togglePause`, `cycleSpeed`). Shop clicks and tower digits 4–9 are ignored too. Digits 1–3, Tab, and Shift+Tab select an offer on the main thread. `R` and a second click on the selected card rotate through quarter-turns that have a legal site. Arrow keys move `progressiveSelectedSite` among the sites at that rotation. Enter places that site. Selecting or rotating a block also cancels build mode and clears the selected tower. The place command carries the quarter-turn count.

`drawBlockOffer` keeps the templates unique. When any template can extend an opening (a legal site that docks onto an existing path mouth and leaves at least one new mouth), one of those templates is reserved before the rest of the slots are filled, then the offer is shuffled. Terrain-only offers happen only when no path template extends. `action:rerollProgressiveOffer` spends `PROGRESSIVE_REROLL_GOLD_PER_WAVE` (10) times `currentWave` gold and draws again. Wave 3 costs 30. It does not spend, and does not read `progressiveRng`, when gold is short or `offerHasAlternative` says the current set is the only valid one. The command returns true so the paused worker still posts the new offer.

A click on a pattern ghost dispatches `action:placeProgressiveBlock`. A click that misses a site does not select a tower. The worker checks that the template is in the current offer, then probes the walk mesh on a throwaway grid built from the player stamp alone (hole fills are non-walkable terrain and do not move spawns, so they do not change the mesh). A failed probe calls `notifyUi` with a placement toast and returns without `commitPlacement`, so `progressiveRng`, the stamp log, and the hold are unchanged. On success, `commitPlacement` records the player stamp and any single-mouth hole fills (`fill: true`, terrain templates 8 or 9), `replaceFromMap` grows the live grid, and a keeper `NavMeshBuilder` is built on that grid. If the keeper build fails, the grid layout snapshot is restored and the stamp log is truncated back. `installWalkMesh` then rebuilds the corridor, swaps the crowd, and refreshes the distance fields. Only after that does `layoutGeneration` increment, `gridLayoutEnabled` turn back on, and `resumeAfterPlacement` either start the between-waves countdown or, for an expiry hold, call `startNextWave`.

Spawns keep ids across a placement. `EnemyManager.reindexSpawns` and `WaveManager.resizeSpawnStatesById` follow those ids so pending queues and spawn visuals stay with the same mouth.

The commander turns the `gridLayout` / `heights` feed off after it caches a rectangle. A placement clears `gridLayoutCache` and `gridHeightsCache` and re-enables the feed. `CommanderWorker` sees the new `layoutGeneration`, caches the new rectangle, and turns the feed off again. `meta.worldOriginX/Y` is how observations convert world coordinates after an origin shift.

The SVG fit rectangle is `originTile * 36, size * 36`. On a progressive origin or size change, `SvgGameRoot.vue` tweens that viewBox over 320ms. A new run snaps. Offer cards in `ProgressivePlacement.vue` shade terrain cells by tile height (lightest at 1, darkest at 4) and keep path on its own color. The on-map preview uses that same pattern, in the current rotation, at every legal site. The keyboard site is drawn stronger and stroked. Rotation and `progressiveSelectedSite` live on the main thread. When a hold or a new offer arrives, `syncProgressiveCursor` snaps to a quarter-turn that has a site and selects one, so the pattern is visible before any key.

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
| `src/stores/game.ts` | Volatile game state: lives, gold, wave, selection, time scale, camera, tower/panel positions, hover state, frame id, run gem/boss counters, milestone breakdown, end-screen data, random-map params, worker reference |
| `src/stores/persist.ts` | Persistent state: gems, unlocks, difficulty, map progress, random-map and progressive-map preferences, last-selected theme and map, sound on/off preference, localStorage I/O |
| `src/stores/ui.ts` | UI state: confirm dialog, notifications, main menu / skill tree / stats / help / minimap overlay flags, debug panel visibility, enemy commander selection, random-map panel, wasPlaying flags for pause/skill-tree/help |
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
| `src/components/GameScreen.vue` | Game layout container: SvgGameRoot, HUD, shop, tower panel, wave countdown, debug panel, wave graph, pause menu overlay |
| `src/components/SvgGameRoot.vue` | Single SVG root: RAF loop, GameEngine lifecycle (receives active theme), imperative DOM rendering, CTM-based input, SpawnManager initialization |
| `src/components/GameHud.vue` | Top bar: lives, gold, gems, wave counter, speed/sound/pause/menu controls (sound toggles `persistStore.soundEnabled`, mirrored onto the live SoundManager by SvgGameRoot); uses `getMapDisplayName` for map label |
| `src/components/GameShop.vue` | Bottom bar: tower build selection with cost (from constants) and themed name/color/icon (from active theme) |
| `src/components/TowerPanel.vue` | Right panel: tower stats, targeting mode, upgrade/sell, specialization; themed name/color/icon from active theme |
| `src/components/WaveCountdown.vue` | Inter-wave countdown overlay shown before each wave spawns |
| `src/components/WaveGraph.vue` | Per-wave graph overlay: damage dealt, gold earned, gems earned, max enemy HP across all waves |
| `src/components/PauseMenu.vue` | Pause menu overlay: resume, skill tree, difficulty adjustment, quit to main menu |
| `src/components/HelpDialog.vue` | Help/controls overlay (toggled from the in-game pause menu) |
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
| `src/components/EnemyChat.vue` | Draggable in-game chat panel for interacting with active LLM enemy commander |

### Game Engine

| File | Description |
|---|---|
| `src/sim/GameEngine.ts` | Simulation core: no rendering. Takes plain `GameRunState` + `PersistState` + `HostBindings` + `ThemeBundle`; runs inside the Web Worker (`src/sim/WorkerEntry.ts`) on a `setTimeout` fixed-timestep loop; produces a `SimulationSnapshot` each tick and applies `Command`s via `applyCommand`; passes visual meta to Tower/Enemy constructors |
| `src/sim/Constants.ts` | Facade over content packs + engine/UI wiring: wave/economy/map tables from `getGameContent()`, plus FIXED_DT, GameState, wave-graph colors |
| `src/sim/ConstantsTower.ts` | Facade: TowerIds, TOWER_BASE/META/VARIANTS/ADDON_EFFECTS and combat scalars from `src/content/data/towers.json` |
| `src/sim/ConstantsEnemy.ts` | Facade: ENEMY_TYPES and enemy/wave scalars from `src/content/data/enemies.json` |
| `src/content/data/*.json` | Declarative balance/content packs (towers, enemies, economy, maps, skill-tree) validated by Zod at load |
| `src/content/schemas/*` | Zod schemas for game content, raw map themes, LLM responses, persist save shape |
| `src/composables/Input.ts` | Keyboard input composable: dispatches build/upgrade/sell/speed/pause intents through the command seam, and Page Up/Down, Ctrl+arrow pan, plus arrow-key follow through the camera actions |
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
| `src/components/MinimapPanel.vue` | Movable hovering panel (TowerPanel drag-by-header pattern, uses `gameStore.minimapPanelPos`) hosting `TextGameRoot`; toggled by `uiStore.showMinimap` |
| `src/components/SvgGameRoot.vue` | Single SVG root: creates the simulation Web Worker, owns `SnapshotStore` (render loop reads snapshots) and `WorkerCommandDispatcher` (click/key intents → commands); rAF render loop does imperative DOM writes; the SVG viewBox is the camera (wheel zoom, right-drag / Alt+left-drag / inert-point left-drag pan); CTM-based mouse→world coordinate conversion; passes theme bundle to worker at `lifecycle:init` and to `useSvgStaticContent`; initializes SpawnManager |

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

**Stays code (not packs):** engine loop constants (`FIXED_DT`, `MAX_ACCUM`), `GameState`, UI layout/wave-graph colors, skill unlock/refund logic, `applyVariantOps` interpreter, combat behavior in Tower/ProjectileManager.

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

Game progress (gems, unlocks, difficulty, map progress) is saved to `localStorage` under the key `lol_ya_tdg_save_1` (legacy `gempath_save_v1` data is auto-migrated on load). The `persistStore.load()` call in `main.ts` restores saved state on app startup. The `mapThemeStore.preloadDefault()` call in `main.ts` preloads the default theme synchronously before `app.mount()`. Profile reset is available from the main menu.

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

CSS custom properties are defined in `App.vue` for consistent theming:

```css
--color-bg, --color-panel, --color-border, --color-accent,
--color-gold, --color-gem, --color-danger, --color-success,
--color-text, --color-text-dim, --font-main
```

All component styles use `<style scoped>` to prevent leakage.

## Testing

### Structure

| Directory | Description |
|---|---|
| `tests/unit/` | Unit test files covering all source modules (includes `map-theme.test.ts`, `spawn-manager.test.ts`, `enemy-attack.test.ts`, `snapshot-store.test.ts`, `snapshot-merge.test.ts`, `text-grid-builder.test.ts`, `text-render.test.ts`) |
| `tests/unit/sim/` | Simulation unit tests: `applyCommand.test.ts`, `enemy-routing.test.ts`, `snapshot.test.ts`, `balance-wall.test.ts` (map-0 placement oracle), `gem-income.test.ts` (per-wave gem award paths) |
| `tests/unit/commanders/` | Commander unit tests: `observation.test.ts`, `stubby-brain.test.ts`, `stubbs-brain.test.ts` |
| `tests/unit/components/` | Vue component tests (15 files, includes `pause-menu.test.ts`, `text-game-root.test.ts`) |
| `tests/integration/` | End-to-end wave simulation (`integration.test.ts`), worker command→snapshot round-trip (`worker-roundtrip.test.ts`), and commander worker round-trip (`commander.test.ts`) |
| `tests/helpers/` | Shared mocks: `mock-stores.ts`, `mock-grid.ts`, `mock-managers.ts`, `mockDefaultTheme` |
| `tests/setup.ts` | Global test setup: in-memory localStorage, Canvas 2D mock, performance.now |

**~1400 tests** across all files.

### What's Covered

| System | Test File(s) | Key Behaviors |
|---|---|---|
| Game Engine | `game-engine.test.ts` | Loop, buy/upgrade/sell, pause, timeScale, gem economy, difficulty scaling; WaveGraphTracker covered indirectly |
| Grid & Navmesh | `grid.test.ts`, `tests/unit/sim/navmesh/*` | Tile queries, Recast corridor, DetourCrowd motion, tower obstacles |
| Maps | `map.test.ts` | All 36 maps have valid spawn-to-base paths, region metadata, gem rewards, inset spawns, cache invalidation |
| Towers | `towers.test.ts` | Stats with caching, level/variant/addon/terrain/milestone bonuses (with tier cap), sell value, float health precision, ghost restore clamp, thorn credit |
| Enemies | `enemies.test.ts`, `enemy-manager.test.ts` | HP/speed formulas, wave scaling, status effects (slow/stun/burn/shield/heal), shield/burn damage returns and credit, knockResist, headless `postPhysics` |
| Waves | `waves.test.ts` | Composition, boss placement, level calculation, inter-wave timing |
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
| Sound | `sound-manager.test.ts` | WebAudio synth, all sound names, dispose, enabled flag |
| Stores | `game-store.test.ts`, `persist-store.test.ts`, `ui-store.test.ts`, `map-theme.test.ts` | State, getters, actions, save/load, schema migration; theme registry, loader, normalize, store preload/load/visual getters |
| Snapshot Store | `snapshot-store.test.ts`, `sim/snapshot.test.ts` | Latest-snapshot holding, meta mirroring into gameStore, snapshot serialization/round-trip |
| Enemy Commanders | `tests/unit/commanders/observation.test.ts`, `lifecycle.test.ts`, `stubby-brain.test.ts`, `stubbs-brain.test.ts`, `tests/unit/sim/enemy-targeting.test.ts`, `integration/commander.test.ts`, `integration/commander-llm.test.ts` | Observation projection (world→tile, hp rename, type, targetingMode, base hp, countdown), switch clears route and targeting, Stubby hold-then-rush per wave, Stubbs ahead-tower routing + tower-set re-route, engagement-policy tower selection including snapped terrain towers, LLM transcript resend, tower distance, zero-hp removal, fence recovery, delta removals, instruction-change rebuild, chat forwarding |
| Physics | `tests/unit/sim/physics/enemy-physics.test.ts`, `tests/unit/sim/physics/physics-world.test.ts`, `integration/physics-motion.test.ts` | Rapier2d body/collider creation, static geometry (base/towers/corridor), dynamic enemy motion, velocity integration, collision with walls and towers |
| Router | `router.test.ts` | Navigation guards, block without map, save on leave, redirects, activeTheme requirement |
| Input | `input.test.ts` | Keyboard dispatch, timeScale, pause, upgrade/sell, escape handling |
| Components | 15 files in `tests/unit/components/` | Rendering, user interactions, store bindings (includes PauseMenu, CommandersScreen, EnemyChat) |
| Integration | `integration.test.ts`, `worker-roundtrip.test.ts` | Single wave simulation: kill enemies, gold economy, boss mechanics, victory; command→snapshot worker round-trip |
