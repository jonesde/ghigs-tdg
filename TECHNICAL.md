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
│   ├── persist.ts               # Persistent meta-progression: gems, unlocks, difficulty, map progress, random-map preferences, last-selected theme (localStorage)
│   ├── ui.ts                    # UI overlay state: confirm dialogs, notifications, menu/skill-tree/stats/help/minimap context, debug panel, enemy commander selection, random-map panel, wasPlaying flags for pause/skill-tree/help
│   └── mapTheme.ts              # Map theme state: activeTheme, defaultTheme, availableThemes, preload/load actions
├── composables/
│   ├── cameraUtils.ts           # Vue composable: reactive camera CTM transform + world/screen coordinate conversion
│   └── Input.ts                 # Keyboard input composable: dispatches to Pinia stores + engine via the command seam
├── components/
│   ├── GameScreen.vue           # Root game layout: SvgGameRoot + HUD + shop + tower panel + wave countdown + debug + wave graph + pause menu
│   ├── SvgGameRoot.vue          # Single SVG root: creates the simulation Web Worker, owns SnapshotStore (render loop reads snapshots) and WorkerCommandDispatcher, imperative DOM rendering, SpawnManager
│   ├── TextGameRoot.vue         # Second passive renderer: monospaced <pre> static base grid + canvas overlay; own rAF loop reads getLatestSnapshot() (no worker, no ack, no input)
│   ├── MinimapPanel.vue         # Movable hovering panel (copy of TowerPanel drag pattern) hosting TextGameRoot; toggled by uiStore.showMinimap
│   ├── GameHud.vue              # Top HUD bar: lives, gold, gems, wave, speed/pause/menu buttons
│   ├── GameShop.vue             # Tower shop bar: build selection with cost display and discount support
│   ├── TowerPanel.vue           # Tower detail panel: stats, targeting, upgrade/sell, specialization
│   ├── WaveCountdown.vue        # Inter-wave countdown overlay shown before each wave spawns
│   ├── WaveGraph.vue            # Per-wave graph overlay: damage, gold, gems, max enemy HP
│   ├── PauseMenu.vue            # Pause menu overlay: resume, skill tree, options, quit
│   ├── HelpDialog.vue           # Help/controls overlay (toggled from in-game menu)
│   ├── MainMenu.vue             # Main menu: new game, resume, skill tree, difficulty slider, profile reset
│   ├── MapSelect.vue            # Map selection grid: unlock status, best waves, region info
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
│   ├── EnemyWalk.ts             # Base shape vertex generation and path-d string conversion
│   ├── ProjectileManager.ts     # Game-side projectile simulation: travel, hits, splash, chain, burn, knockback
│   ├── ParticleSystem.ts        # Game-side particle simulation: spawn, motion, life/expiry
│   ├── WaveGraphTracker.ts      # Per-wave graph data tracking: damage, gold, gems, peak enemy HP
│   ├── grid/
│   │   ├── Grid.ts              # Grid data structure: path, base, spawn queries, build validation
│   │   └── Map.ts               # Procedural map generation: 36 maps, 3 regions, 6 layout styles
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
│       ├── cameraUtils.ts       # fitToGrid() and screenToWorld()/worldToScreen() helpers (pixel space)
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
- **GameEngine (Logic, in Web Worker):** Orchestrates all game logic (enemy movement, tower targeting, projectile updates, wave management). Constructor takes plain `PersistState` + `ThemeBundle` + `HostBindings` + `mapIndex` (plus optional `randomMapParams` and `particleSpawner`) — no Pinia, no canvas reference. `GameRunState` is created internally in `_initMap`, not passed in. `handleClick()` accepts world coordinates; `setHover` was removed (hover is main-thread-only UI state). The engine runs inside the Web Worker (`src/sim/WorkerEntry.ts`), not on the main thread.
- **Direct DOM (Imperative Rendering):** A main-thread `requestAnimationFrame` loop reads the latest `SimulationSnapshot` from the `SnapshotStore` and writes per-frame properties via `setAttribute` and `style.transform`. It does not call the engine directly — all intent flows in as `Command`s and all state flows out as snapshots. Bypasses Vue's reactivity system for hot paths.

The SVG structure is:

```
<svg class="game-svg" viewBox="0 0 W H">
  <defs>  <!-- <symbol> templates, filters, per-map gradients -->
  <g class="grid-layer" v-html="gridContent"></g>  <!-- Static, Vue-managed -->
  <g ref="worldLayer" class="camera-wrapper">  <!-- Imperative camera transform -->
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
- CTM-based input: Mouse coordinates are converted to world space via `worldLayer.getScreenCTM().inverse()`, which includes the camera transform (unlike `svgRoot.getScreenCTM()` which only accounts for the viewBox).
- Click handling is centralized on the SVG root — no per-element `@click` handlers. `gameEngine.handleClick(worldX, worldY)` determines what was hit programmatically.

`GameScreen.vue` renders `<SvgGameRoot>` as a sibling with HUD/shop/tower panel overlays. Vue does **not** touch per-frame rendering. The component creates the Web Worker, posts `lifecycle:init` (with `persistState` + `themeBundle`), owns `SnapshotStore` and the `WorkerCommandDispatcher`, reads the reactive snapshot mirror from Pinia stores, and cleans up on unmount (posts `lifecycle:dispose`, awaits the worker's `disposed` ack, then terminates). The SVG mounts/unmounts with the `/game` route.

### Four Pinia Stores

- **`gameStore`** — reactive mirror/projection of the simulation `SimulationSnapshot`. The worker is authoritative for simulation state; `gameStore` holds the subset the Vue UI binds to (lives, gold, wave, game state, selection, time scale, dialog visibility, frame id, run gem/boss counters, milestone breakdown, end-screen data) and is updated by snapshot diffs each frame. Main-thread-only state (camera, hover tile, hover-upgrade-button, tower/panel positions, random-map params, worker reference) also lives here. Reset when starting a new map.
- **`persistStore`** — persistent meta-progression (gems, unlocked skills, map progress, difficulty, general add-ons, random-map preferences, last-selected theme) and LLM commander configurations (`llmCommanders` array). Auto-saved to `localStorage` via manual `save()` calls.
- **`uiStore`** — UI overlay visibility and confirm dialog state, plus notifications, minimap toggle, enemy commander selection ("none"/"stubby"/"stubbs"), random-map panel visibility, and wasPlaying flags for pause/skill-tree/help (so closing these overlays restores the prior playing/paused state).
- **`mapThemeStore`** — map theme state: `defaultTheme` (preloaded at app init for synchronous access by non-game screens) and `activeTheme` (resolved for the current run), plus `availableThemes` and preload/load actions.

### Confirm Dialogs as a Single Component

`ConfirmDialog.vue` is mounted globally in `App.vue` and uses `<Teleport to="body">` to render above all layers. Driven by `uiStore.confirmDialog` state.

### Simulation Spine (Worker / Snapshot / Command)

The simulation runs in a Web Worker; the main thread renders and produces intent. They communicate only through a **snapshot + command stream** (the "spine"), as detailed in `plans/ArchitecturePlan.md` §3.

- **Worker owns the engine.** `src/sim/WorkerEntry.ts` constructs `GameEngine` (with plain `GameRunState` + `PersistState` + `HostBindings` + `ThemeBundle`, not Pinia), runs a `setTimeout` fixed-timestep loop, drains a command queue at the start of each tick, and posts a `SimulationSnapshot` every tick. `requestAnimationFrame` is unavailable in a worker, so a `setTimeout`-driven loop is used instead.
- **Commands in (`src/sim/Command.ts`).** All intent is a typed `Command`: `input:*` (e.g. `input:click`), `action:*` (pause, cycle speed, upgrade, sell, select tower/build type, targeting, …), `lifecycle:*` (`init`/`dispose`), and future `llm:*`. The main thread dispatches via `commandBus.dispatchCommand` → `WorkerCommandDispatcher`, which forwards through `postMessage`. Hover and camera are main-thread-only and never become commands.
- **Snapshots out (`src/sim/SimulationSnapshot.ts`, `SnapshotSerializer.ts`).** Each tick the worker serializes plain-data DTOs — `enemies`, `towers`, `projectiles`, `particleSpawns` (sparse spawn requests, consumed once by the main thread), `spawnStates`, `paths`/`pathsVersion` (worker-authoritative enemy paths for highlight rendering), `waveGraphDots`/`waveGraphDotsGeneration` (per-interval wave-graph data, shipped only when generation changes), `gridLayout` (constant map layout for the commander worker, omitted once cached), `lightningEffects`/`stunEffects` (ephemeral visual effects, consumed and cleared each build), plus a `meta` scalar block (lives, gold, wave, selection, `lastScaledDt`, etc.) and a `persistDirty` flag. `SnapshotSerializer.buildSnapshot` reads entity fields directly; the render managers' `syncFromGameEngine` signatures now take these snapshot arrays.
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
  post. The main thread's rAF render loop sends `{ type: "snapshotAck" }` once
  per *rendered* frame (after the render-manager `syncFromGameEngine` calls,
  before rescheduling rAF). The worker clears `awaitingAck` on `snapshotAck`. A
  running-idle tick with `awaitingAck === true` drops the build+post entirely.
- **Forced posts bypass the gate** (so input latency stays ≤1 frame): the
  *baseline* (first snapshot after `(re)init`) and any tick where a `Command`
  mutated visible state (`stateMutatedThisTick`, paused **or** running). A
  running-command post sets `awaitingAck = true` (next running tick throttles
  again); a paused-command post sets `awaitingAck = false` so a follow-up forced
  post isn't swallowed. Plain paused-idle posts nothing.
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

**Lifecycle** (`src/commanders/index.ts`): every `setEnemyCommander(id)`, including built-ins and `"none"`, calls `stopEnemyCommander()` before a new relay starts. That dispatches `llm:routeGroup(enemyIds, hold: false, [])` and `llm:setTargeting(enemyIds, mode: "default")` for every live enemy, then stops the relay. The route command returns held enemies to default pathing. The targeting command clears an engagement policy, which `releaseToDefault` leaves in place.

**LLM Commanders:** For custom external LLM integration, `persistStore` maintains an array of `LlmCommanderConfig` entries (id, name, endpointUrl, token, modelName, contextLimit, commanderInstructions, systemPrompt, requestTimeoutMs, pauseForCommander). When an LLM commander is activated via `setEnemyCommander(id)`, the relay starts with `"llm"` mode and passes a plain copy of the config. The store value is a Pinia proxy, and `postMessage` throws `DataCloneError` on that proxy, which would leave the worker running with no start message. The worker's LLM brain (`src/commanders/llm/brain.ts`) resends the conversation transcript on each call: the system prompt, prior snapshots and deltas, and the model's own replies. Later turns send a delta of new and changed enemies (including removals, routing, targeting, and distanceToBase), changed towers, and removed towers. Each live tower includes `distanceToBase`, snapped to the nearest path, spawn, or base tile; a tower at 0 hp is omitted and listed in `removedTowers`. The wave summary includes base hp and the inter-wave countdown. A full snapshot replaces that transcript when the context budget is exceeded or the instructions change. A markdown fence around the JSON is stripped; a rejected reply is not kept, and the next user message includes the rejection reason. Identical failure toasts are suppressed until a reply is accepted. `apiClient.ts` posts to the configured endpoint at temperature 0.2. The abort timer is `requestTimeoutMs` (default 30 seconds, save version 4). `pauseForCommander` defaults off and is backfilled on load without a save-version bump. When it is set, the worker posts a hold for the in-flight request; the sim applies `action:commanderHold`, which stops the clock while the run stays `playing`, because `GameState.PAUSED` makes the worker skip decide. The hold releases when the reply is applied, the request fails, or the relay stops. The HUD shows "Paused for commander". A draggable `EnemyChat.vue` panel lets players send messages and edit commander instructions; an edit is posted with `postUpdateInstructions()` and saved on the active commander only when the text changed. Deleting the active commander deactivates it. The commanders form can test the unsaved endpoint without saving or starting the relay.

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

**Commanders:** snapshot ships `navField` (relay-cached); Stubbs uses live distances and issues `llm:siegeTower`.

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
| `src/stores/persist.ts` | Persistent state: gems, unlocks, difficulty, map progress, random-map preferences, last-selected theme, localStorage I/O |
| `src/stores/ui.ts` | UI state: confirm dialog, notifications, main menu / skill tree / stats / help / minimap overlay flags, debug panel visibility, enemy commander selection, random-map panel, wasPlaying flags for pause/skill-tree/help |
| `src/stores/mapTheme.ts` | Map theme state: activeTheme, defaultTheme (preloaded at app init), availableThemes, preload/load actions |

### Map Theme

| File | Description |
|---|---|
| `src/render/themes/index.ts` | Theme registry: `MAP_THEME_MANIFEST` (id/label entries), lazy loaders, `MapThemeData`/`TowerVisualMeta`/`EnemyVisualMeta`/`RegionVisualMeta` types |
| `src/render/themes/normalize.ts` | `normalizeThemeImages(theme)`: walks theme object, fetches external SVG path/URL refs, replaces with inlined SVG text |
| `src/render/themes/data/default-map-theme.json` | Default theme data: tower/enemy SVG sprites, tile images (path + 4 terrain heights per region), base 3×3 SVG per region |

### Vue Components

| File | Description |
|---|---|
| `src/components/GameScreen.vue` | Game layout container: SvgGameRoot, HUD, shop, tower panel, wave countdown, debug panel, wave graph, pause menu overlay |
| `src/components/SvgGameRoot.vue` | Single SVG root: RAF loop, GameEngine lifecycle (receives active theme), imperative DOM rendering, CTM-based input, SpawnManager initialization |
| `src/components/GameHud.vue` | Top bar: lives, gold, gems, wave counter, speed/pause/menu controls; uses `getMapDisplayName` for map label |
| `src/components/GameShop.vue` | Bottom bar: tower build selection with cost (from constants) and themed name/color/icon (from active theme) |
| `src/components/TowerPanel.vue` | Right panel: tower stats, targeting mode, upgrade/sell, specialization; themed name/color/icon from active theme |
| `src/components/WaveCountdown.vue` | Inter-wave countdown overlay shown before each wave spawns |
| `src/components/WaveGraph.vue` | Per-wave graph overlay: damage dealt, gold earned, gems earned, max enemy HP across all waves |
| `src/components/PauseMenu.vue` | Pause menu overlay: resume, skill tree, difficulty adjustment, quit to main menu |
| `src/components/HelpDialog.vue` | Help/controls overlay (toggled from the in-game pause menu) |
| `src/components/MainMenu.vue` | Main menu: new game, resume, skill tree, difficulty slider, profile reset |
| `src/components/MapSelect.vue` | Map grid: 36 maps with unlock status, best waves, region info; theme drop-down, responsive grid (`auto-fill`), awaits theme resolution before navigation |
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
| `src/composables/Input.ts` | Keyboard input composable: dispatches build/upgrade/sell/speed/pause intents to Pinia stores and the engine via the command seam |
| `src/sim/EnemyWalk.ts` | Base shape vertex generation and path-d string conversion |
| `src/sim/ProjectileManager.ts` | Game-side projectile simulation: travel, hits, splash, chain, burn, knockback |
| `src/sim/ParticleSystem.ts` | Game-side particle simulation: spawn, motion, life/expiry |
| `src/sim/WaveGraphTracker.ts` | Per-wave graph data: damage dealt, gold earned, gems earned, peak enemy HP per wave |
| `src/sim/physics/PhysicsWorld.ts` | Rapier2d physics world: static geometry (base/towers/corridor walls), dynamic enemy bodies driven by velocity |
| `src/sim/physics/rapierContext.ts` | Lazy WASM loader for Rapier2d; gates physics initialization until resolved |

### Grid & Maps

| File | Description |
|---|---|
| `src/sim/grid/Grid.ts` | Grid data structure: path tiles, base/spawn locations, build validation |
| `src/sim/grid/Map.ts` | Procedural map generation: 36 maps, 3 regions, 6 layout styles (open, canyon, serpentine, split, bastion, battlefield); `name` computed lazily via `getMapDisplayName(map, theme)` |
| `src/sim/navmesh/*` | Recast navmesh, DetourCrowd, distance field, path metrics |
| `src/sim/physics/ForceFieldSystem.ts` | Continuous radial/directional force fields for future push/pull towers |
| `src/sim/physics/ContactProcessor.ts` | Rapier collision events → siege/base attack + projectile hits |

### Towers

| File | Description |
|---|---|
| `src/sim/towers/Tower.ts` | Tower entity: stats, targeting modes, level scaling, variants, sell value, milestone bonuses; accepts `visualMeta` param (color, icon, name, animation, walking) from active theme |
| `src/sim/towers/TowerManager.ts` | Tower placement, upgrade, sell with refund/discount modes; receives visual meta from GameEngine |
| `src/sim/towers/SkillTree.ts` | Gem upgrade costs, unlock/refund logic, variant definitions, general add-on config |

### Enemies & Waves

| File | Description |
|---|---|
| `src/sim/enemies/Enemy.ts` | Enemy entity: types, stats, pathfinding, status effects (slow, stun, shield); accepts `visualMeta` param (color, shape, name, walking, hitReaction) from active theme |
| `src/sim/enemies/EnemyManager.ts` | Enemy lifecycle: spawning, movement, death, base reach; receives visual meta from GameEngine |
| `src/sim/waves/WaveManager.ts` | Wave composition, enemy count scaling, boss cadence, inter-wave timer |

### Rendering

| File | Description |
|---|---|
| `src/render/svg/EnemyManager.ts` | Enemy rendering pool: `<use>` elements with `<symbol>` href animation, hit flash circles, slow filter application |
| `src/render/svg/TowerManager.ts` | Tower rendering pool: `<use>` elements with barrel rotation, level pip `<circle>` elements |
| `src/render/svg/ProjectileManager.ts` | Projectile rendering pool: `<circle>` bullets, `<line>` beams |
| `src/render/svg/ParticleManager.ts` | Particle rendering pool: `<circle>` elements with fade/expansion |
| `src/render/svg/EffectManager.ts` | Lightning paths, stun aura paths, build preview rect, range circle, upgrade button SVG elements |
| `src/render/svg/UiOverlayManager.ts` | HP bars, shield bars, boss HP text as pooled `<rect>` and `<text>` elements |
| `src/render/svg/SpawnManager.ts` | Spawn point rendering pool: `<use>` elements for spawn location indicators |
| `src/render/svg/useSvgStaticContent.ts` | Composable: builds `<defs>` (symbols from active theme's tower/enemy frames, region gradients, filters) and grid layer SVG strings (tile images + base art from theme) |
| `src/render/svg/cameraUtils.ts` | `fitToGrid()` plus pixel-space `screenToWorld()`/`worldToScreen()` helpers for the SVG camera |
| `src/render/svg/types.ts` | Shared types for render proxies and managers |
| `src/render/text/TextGridBuilder.ts` | Static char buffer (3×3 chars per tile) for the `<pre>` monochrome base grid (terrain `·`, path empty, base `#`, spawn `S`) |
| `src/render/text/TextTowerManager.ts` | Draws each tower theme `icon` in theme `color` at its tile-center on the canvas overlay |
| `src/render/text/TextEnemyManager.ts` | Draws each enemy theme glyph (via `getEnemyGlyph(shape)`) in theme `color` at the enemy's scaled `enemy.x/enemy.y` on the canvas overlay |
| `src/render/text/TextPathRenderer.ts` | Draws worker-authoritative enemy paths as faint polylines on the canvas overlay, caching the last non-null paths across cleared frames |
| `src/render/text/TextOverlayRenderer.ts` | Canvas overlay: projectile dots, thin HP bars, lightning lines, stun marks (mirrors svg Projectile/UiOverlay/Effect managers) |
| `src/render/text/types.ts` | `TextRenderScale` (separate x/y world→canvas scales) and `TextThemeAccess` interfaces |
| `src/components/TextGameRoot.vue` | Second passive renderer: renders a `<pre>` static base grid + a `<canvas>` overlay, driven by its own rAF loop reading `getLatestSnapshot()`; no worker, no `snapshotAck`, no input |
| `src/components/MinimapPanel.vue` | Movable hovering panel (TowerPanel drag-by-header pattern, uses `gameStore.minimapPanelPos`) hosting `TextGameRoot`; toggled by `uiStore.showMinimap` |
| `src/components/SvgGameRoot.vue` | Single SVG root: creates the simulation Web Worker, owns `SnapshotStore` (render loop reads snapshots) and `WorkerCommandDispatcher` (click/key intents → commands); rAF render loop does imperative DOM writes; CTM-based mouse→world coordinate conversion, centralized click routing; passes theme bundle to worker at `lifecycle:init` and to `useSvgStaticContent`; initializes SpawnManager |
| `src/composables/cameraUtils.ts` | Vue composable: reactive camera CTM transform (`useCameraCTM`) and world/screen coordinate conversion backed by `gameStore.camera` |

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

Camera state (`x`, `y`, `zoom`) lives on `gameStore.camera` and is shared between the Vue UI and SVG rendering. Vue-side reactive transforms/conversions are provided by `src/composables/cameraUtils.ts` (`useCameraCTM`), while pixel-space helpers (`fitToGrid`, `screenToWorld`) live in `src/render/svg/cameraUtils.ts`. There is no longer a separate `services/` directory.

## Game Content Packs (Zod)

Declarative balance and copy live under `src/content/data/` as split JSON packs, validated once at load via Zod (`src/content/loadGameContent.ts` → `getGameContent()`). Call sites keep importing `@/sim/Constants*.js` facades so the sim/UI import graph stays stable.

| Pack | Contents |
|---|---|
| `towers.json` | meta/base stats, combat tuning scalars, variants (`settings` + `statOps`), addon effects |
| `enemies.json` | enemy type table, HP mult coeffs, wave/boss scalars |
| `economy.json` | gems, milestones, difficulty, general-addon costs/effect arrays, starting gold/health |
| `maps.json` | MAP_LEVELS (36), map-gen scalars |
| `skill-tree.json` | level/addon costs, variant/addon labels, general-addon defs/categories |

**Stays code (not packs):** engine loop constants (`FIXED_DT`, `MAX_ACCUM`), `GameState`, UI layout/wave-graph colors, skill unlock/refund logic, `applyVariantOps` interpreter, combat behavior in Tower/ProjectileManager.

**Variant ops:** `TOWER_VARIANTS` no longer carry `apply` functions. Ops (`set`, `mul`, `mulTier`, `setTier`, `add`, `addPerTier`, `mulPowTier`) are interpreted in `src/content/applyVariantOps.ts` with `tierIdx = level - 5`.

**Other Zod boundaries:** raw map themes (`RawMapThemeSchema` before normalize), LLM commander replies (`validateLlmResponse`), post-migrate persist save (`PersistStateSchema.safeParse` in `persistStore.load`).

**How to change balance:** edit the relevant JSON pack; keep formulas/behavior hooks in TS. Run `npm run check`. Adding a new tower still needs theme frames + any new behavior code paths, but numbers/copy go in packs.

## Map Theme System

A theme swaps the visual identity of towers, enemies, and map tiles on `/game`, while leaving all gameplay stats, effects, overlays, and non-`/game`/`/map-select` screens untouched. The current polygon-based art is the default theme (`id: "default"`). Raw theme JSON is Zod-validated before `normalizeThemeImages`.

### How It Works

1. **Theme registry** (`src/render/themes/index.ts`): `MAP_THEME_MANIFEST` lists available themes with `{id, label}`. Lazy loaders resolve theme JSON files on demand (parsed with `RawMapThemeSchema`).
2. **Theme store** (`src/stores/mapTheme.ts`): `useMapThemeStore` holds `defaultTheme` (preloaded at app init for synchronous access by non-game screens) and `activeTheme` (resolved for the current run).
3. **Theme JSON** (`src/render/themes/data/`): `default-map-theme.json` (default polygon art) and `the-aftermath.json` (alternate theme). Each contains tower frames (SVG `<svg>` strings), enemy walking/hit-reaction frames, per-region tile images (path + 4 terrain heights), and base 3×3 SVG art.
4. **Symbol ID contract**: IDs stay `tower-${type}-f${i}`, `enemy-${type}-f${i}`, `enemy-${type}-hit-f${i}`. Themes swap only the *content* inside `<symbol>`s and the color/name/icon metadata. Render managers need zero changes.
5. **Stats vs visuals split:** gameplay numbers live in `src/content/data/` (via Constants facades). Only visual/displayed fields (name, color, icon, shape, animation frames, tile images) live in the theme JSON.

### Scope

- **In scope** (`/game` only): Tower SVG sprites + color/icon/name, enemy SVG sprites + color/shape/name, per-region tile images + base art + display names.
- **Out of scope**: All gameplay data, all effects/overlays (particles, lightning, HP bars, range circles, etc.), non-`/game`/`/map-select` screens (Skill Tree uses default theme), in-game theme switching, audio.

### UI Integration

- **MapSelect**: Theme drop-down selects active theme; grid uses responsive `auto-fill` layout; `startMap` awaits theme resolution before navigating to `/game`.
- **GameShop / TowerPanel / StatsPanel / GameHud**: Read themed name/color/icon from `mapThemeStore.activeTheme` on `/game`.
- **SkillTree / HistoryScreen / EndScreen**: Read from `mapThemeStore.defaultTheme` (not active theme).
- **SvgGameRoot**: Passes `activeTheme` to `GameEngine` constructor and `useSvgStaticContent` composable.
- **Router guard**: `/game` requires `mapThemeStore.activeTheme` to be non-null.

## Persistence

Game progress (gems, unlocks, difficulty, map progress) is saved to `localStorage` under the key `lol_ya_tdg_save_1` (legacy `gempath_save_v1` data is auto-migrated on load). The `persistStore.load()` call in `main.ts` restores saved state on app startup. The `mapThemeStore.preloadDefault()` call in `main.ts` preloads the default theme synchronously before `app.mount()`. Profile reset is available from the main menu.

## Game Routes

| Route | Component | Description |
|---|---|---|
| `/` | `MainMenu.vue` | Main menu with difficulty slider and navigation |
| `/map-select` | `MapSelect.vue` | Map selection grid with theme drop-down, responsive layout, awaits theme resolution before navigation |
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
| `tests/unit/` | 27 unit test files covering all source modules (includes `map-theme.test.ts`, `spawn-manager.test.ts`, `enemy-attack.test.ts`, `snapshot-store.test.ts`, `snapshot-merge.test.ts`, `text-grid-builder.test.ts`, `text-render.test.ts`) |
| `tests/unit/sim/` | Simulation unit tests: `applyCommand.test.ts`, `enemy-routing.test.ts`, `snapshot.test.ts` |
| `tests/unit/commanders/` | Commander unit tests: `observation.test.ts`, `stubby-brain.test.ts`, `stubbs-brain.test.ts` |
| `tests/unit/components/` | Vue component tests (15 files, includes `pause-menu.test.ts`, `text-game-root.test.ts`) |
| `tests/integration/` | End-to-end wave simulation (`integration.test.ts`), worker command→snapshot round-trip (`worker-roundtrip.test.ts`), and commander worker round-trip (`commander.test.ts`) |
| `tests/helpers/` | Shared mocks: `mock-stores.ts`, `mock-grid.ts`, `mock-managers.ts`, `mockDefaultTheme` |
| `tests/setup.ts` | Global test setup: in-memory localStorage, Canvas 2D mock, performance.now |

**~1000 tests** across all files.

### What's Covered

| System | Test File(s) | Key Behaviors |
|---|---|---|
| Game Engine | `game-engine.test.ts` | Loop, buy/upgrade/sell, pause, timeScale, gem economy, difficulty scaling; WaveGraphTracker covered indirectly |
| Grid & Navmesh | `grid.test.ts`, `tests/unit/sim/navmesh/*` | Tile queries, Recast corridor, DetourCrowd motion, tower obstacles |
| Maps | `map.test.ts` | All 36 maps have valid spawn-to-base paths, region metadata, gem rewards |
| Towers | `towers.test.ts` | Stats with caching, level/variant/addon/terrain/milestone bonuses, sell value |
| Enemies | `enemies.test.ts` | HP/speed formulas, wave scaling, status effects (slow/stun/burn/shield/heal) |
| Waves | `waves.test.ts` | Composition, boss placement, level calculation, inter-wave timing |
| Tower Manager | `tower-manager.test.ts` | Build, sell, update, towerAt |
| Enemy Manager | `enemy-manager.test.ts` | Spawn, cull, getEnemiesInRange |
| Enemy Attack | `enemy-attack.test.ts` | Enemy base/tower attack behavior, damage, and cooldowns |
| Skill Tree | `skill-tree.test.ts` | Unlock/refund/cost logic for all towers and general addons |
| Projectiles | `projectile-manager.test.ts`, `game-projectile-manager.test.ts` | Render pool (`<circle>`/`<line>`) and game-side simulation: all 8 tower types × 2 variants (16 projectile behaviors), splash, chain, burn, knockback |
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
