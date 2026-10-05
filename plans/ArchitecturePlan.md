# Architecture Plan

Status: Living document. Captures the architectural and functional goals of *Ground Held is Ground Stood* (GHiGS), the recommended architecture to introduce now (a TypeScript Web Worker for game logic, no WASM), and the architecture to target as game complexity scales (physics, RPG combat, LLM-driven enemy command). Replaces and supersedes the per-phase Web Worker migration plan circulated earlier; that plan's phase breakdown is folded into the migration phasing section below with corrections.

This document is descriptive, not prescriptive code. It is meant to be readable in one sitting and to anchor future implementation decisions. Code references use `file:line` format so they can be navigated directly.

---

## 1. Functional Goals

### 1.1 Core product vision

A browser-based tower defense game with gem-based meta-progression, an upgrade unlock system, 36 procedurally-generated maps across 3 regions, 6 tower types with specialization variants, and 6 enemy types including bosses. Built with Vue 3, Pinia, Vue Router, and Vite. The project is approximately two weeks old at the time of writing, developed by one person using AI assistance with mostly smaller locally-running LLMs. Development is iterative: the system will become what it becomes, with decisions made toward a goal rather than against a fixed spec.

### 1.2 Core invariant

**In-browser application with minimal dependencies.** No backend service, no native runtime, no heavyweight framework, no cloud dependency. The entire experience runs from a static bundle served over HTTP. Anything that would require a server, a database, or a native binary is out of scope unless it can be hosted as a static asset or fetched from a third-party API the user supplies.

This invariant is load-bearing. It shapes every architectural choice below: persistence is `localStorage`, the LLM is remote and accessed via API, multiplayer is not a goal, and any future WASM module ships as a static `.wasm` asset compiled into the bundle.

### 1.3 Rendering

Rendering is currently pure SVG: a single `<svg>` root element where every map tile, tower, enemy, projectile, and visual effect is an SVG element, with sprite definitions as `<symbol>` templates in `<defs>` instantiated via `<use>` elements. A single `requestAnimationFrame` loop drives both game logic (via `GameEngine`) and imperative DOM writes (via per-entity `Manager` classes in `src/render/svg/`). See `README.md` "Rendering Architecture" and "Single SVG Root with Imperative DOM Rendering" for the full rationale.

SVG was chosen for three reasons, in order of importance:

1. **A discipline proxy for text-serializable state.** SVG forces every renderable thing to be expressible as structured vector data with stable identifiers. This is the same property the eventual LLM-facing state stream needs. Building on SVG keeps the system honest about what state is actually serializable.
2. **A straightforward early graphics experiment.** Vector art scales without pixelation, supports CSS transforms and filters, and integrates cleanly with Vue's declarative layer for structural changes.
3. **One possible projection of the underlying simulation state — not a hard long-term render constraint.** SVG is one consumer of the simulation snapshot. A canvas or WebGL renderer could be added later as another projection without touching the simulation, provided the snapshot contract is respected.

The third point is the one that matters for architecture: **SVG is a projection, not a commitment.** The text-serializability invariant is preserved by the snapshot schema, not by SVG itself. The LLM does not need raw SVG markup — it needs semantic state, which is more token-efficient to express as structured text or JSON derived from the same snapshot.

### 1.4 Near-future simulation features

The next tier of game complexity, in roughly the order it will land:

- **Enemy–enemy collision detection.** Enemies occupy physical space and cannot overlap freely.
- **Enemy–map collision against obstacles.** Obstacles (destructible barriers) can be placed in the path. Enemies must route around or destroy them.
- **Per-enemy non-linear routing.** Enemies choose paths dynamically based on obstacles and other moving enemies, not just the precomputed BFS path (`src/grid/Pathfinding.ts`).
- **Pile-up behavior.** Enemies mass against obstacles they cannot immediately destroy, applying pressure until the obstacle breaks.
- **Physics simulation.** The above imply real collision response, separation forces, and possibly momentum.
- **RPG-style combat mechanics.** A wider variety of per-entity behaviors: damage types, resistances, status effects, abilities with cooldowns and conditions, targeted buffs/debuffs, formation bonuses.

The complexity is **per-entity behavior variety**, not entity count. The enemy cap is expected to remain around 100–200 simultaneous entities (see §1.7). The simulation cost grows by depth per entity, not by breadth.

### 1.5 LLM-driven enemy command

A remote LLM acts as the enemy **commander**. Its role is strategic, not tactical:

- Set per-enemy or per-group movement paths and waypoints.
- Set targeting modes and attack parameters (which tower to prioritize, when to use special abilities, when to hold fire).
- Organize troop formations and timing (wait for reinforcement waves, mass at chokepoints, execute coordinated assaults).
- Adapt strategy across runs based on observed tower placements.

The LLM is **remote** (accessed via API, high latency, batched/async). This is a design limit, not just a constraint: it means the LLM can only fill a commander role that issues high-level parameters which the engine then executes. There is no tight feedback loop. The simulation runs autonomously between LLM turns using the last issued command set.

The command interface is designed to be explainable to the LLM in its system prompt: each available algorithm (pathfinding, targeting mode, formation rule) is documented, and the LLM selects among them rather than emitting raw numeric parameters. This keeps the LLM's job tractable and the engine's behavior auditable.

### 1.6 Human strategic control

The human player retains strategic control on the tower side, and may also exercise algorithmic and LLM-assisted control over both enemies and towers (for example, in a "puzzle" or "replay" mode where the human commands the enemy side against a fixed tower defense). The architecture treats human input and LLM commands as symmetric producers into the same command queue (see §3.3).

### 1.7 Anti-cheat posture

**The LLM is assumed to have a full copy of the engine and simulation source code.** LLMs are getting smarter, source code is leakable, and this project intends to run against different LLMs over time. "Minimally exploitable" therefore does not mean hidden information — it means the **rules themselves must be robust to optimal play with full information.** Concretely:

- The engine is **deterministic** given the same inputs. No hidden RNG, no server-side secrets, no information asymmetry between the engine and an observer with the source.
- Win conditions and reward curves are tuned assuming the adversary plays optimally with full knowledge of the simulation.
- Any "fog of war" or information hiding is a UI concern (what the human sees), not a simulation concern (what the engine knows).

This posture has a useful side effect: deterministic engines support reproducible runs, which is valuable for debugging and for building LLM evaluation harnesses that compare strategies head-to-head.

### 1.8 Scale

- **Enemy count:** capped at roughly 100–200 simultaneous. Beyond that a human cannot reasonably comprehend or monitor the field, even with clustering and recognizable patterns. The complexity budget goes into per-entity behavior, not entity count.
- **Tower count:** tens, not hundreds. Limited by placement grid and gold economy.
- **Projectile and particle count:** can spike into the low thousands during heavy combat. These are already DTO-based for rendering (`src/game/ProjectileManager.ts:774`, `src/game/ParticleSystem.ts:70`).
- **DOM node count at 100–200 enemies:** roughly 1000–2000 live SVG nodes (entities + HP bars + status overlays). This is at the edge of comfortable SVG performance but workable. If it becomes a bottleneck, a canvas/WebGL projection can be added without touching the simulation (see §4.4).

The bounded entity count is consequential: it means **WASM is never strictly necessary for raw scale.** WASM would only be justified if per-entity physics and combat genuinely become heavy — plausible once collision, pile-up, and RPG mechanics all land, but still a measure-before-porting decision (see §4.2).

---

## 2. Architectural Principles

These principles are the load-bearing decisions. Everything else follows from them.

### 2.1 The snapshot + command stream is the spine

The simulation produces a **snapshot** of its state each tick (or throttled). Consumers (renderer, LLM adapter, Vue UI mirror, persistence) read snapshots. Producers (human input, LLM commands, UI actions) emit **commands** into a queue the simulation drains at the start of each tick.

This spine is the central abstraction. The simulation backend — TypeScript today, possibly Rust/WASM later — is a swappable inner module with a stable I/O contract defined by the snapshot and command schemas. Swapping the backend does not change any consumer or producer.

### 2.2 Consumers and producers are symmetric and pluggable

The renderer, the LLM adapter, and the Vue UI are all snapshot consumers, differing only in rate and detail level: the renderer wants 60Hz full-detail, the LLM wants 1–5Hz abstracted, the UI wants a reactive subset. Human input and LLM commands are all command producers, differing only in source and latency. Adding a new consumer (a debug overlay, a replay recorder, an evaluation harness) or a new producer (a scripted scenario, a second LLM) is additive, not architectural.

### 2.3 Projection, not source-of-truth, for Vue/UI

`gameStore` (Pinia) becomes a **reactive mirror** of the snapshot, not the source of truth. The worker is authoritative for simulation state. The store holds the subset of state the Vue UI binds to (HUD numbers, selection, camera, dialog visibility) and is updated by snapshot diffs on the main thread.

Input-driven local mutations that don't need simulation agreement — for example, opening a build menu or starting a camera pan — stay on `gameStore` and never cross the boundary. Input that does need simulation agreement — placing a tower, selecting a target — stays on `gameStore` for immediate UI feedback *and* posts a command so the sim stays in sync.

### 2.4 Abstraction seams at the boundaries that will change

Three seams are established early because they are the boundaries most likely to be swapped:

1. **`HostBindings`** — the interface the simulation uses to reach the outside world (sound, UI notifications, persistence, confirm dialogs). Implemented by a main-thread adapter today; swappable for a worker-posting adapter later. (§3.1)
2. **`SpatialIndex`** — the interface for spatial queries (range queries, neighbor lookups) that collision, pathfinding, and targeting all depend on. Implemented in TypeScript today; swappable for a WASM implementation later. (§3.5)
3. **The simulation backend itself** — today the `GameEngine` class; tomorrow a WASM module exposing the same snapshot/command contract. The seam is the contract, not a wrapper class.

Establishing these seams early is cheap. Establishing them late requires refactors smeared across `Enemy`/`EnemyManager`/`TowerManager`/`WaveManager`/`GameEngine`.

### 2.5 No hidden state; deterministic rules

Required by the anti-cheat posture (§1.7). The engine is deterministic given inputs. RNG is seeded and reproducible. Any "hidden" information is a UI-layer concern (what the human is allowed to see), never a simulation concern. This also enables replay and LLM evaluation harnesses.

### 2.6 Incremental deployability

Every escalation move (SAB ring buffer, WASM core, LLM commander plane, alternative renderer) must be independently shippable without rewriting the layers above or below. The spine stays unchanged; only one layer is swapped at a time. This means the architecture must not be designed around a single future move — for example, it must not assume COOP/COEP headers are present (they are only needed for SAB), and it must not assume the LLM commander is always present (the game must be playable without it).

### 2.7 Minimal dependencies

Consistent with the core invariant. No new runtime dependencies are introduced by the worker architecture itself — it uses standard Web APIs (`Worker`, `postMessage`, `structuredClone`). Future WASM work introduces a build-time dependency (a Rust toolchain or `wasm-pack`) but no runtime dependency beyond loading a static `.wasm` asset. No ECS library, no game engine framework, no state-management library beyond Pinia.

---

## 3. Recommended Architecture — Current (TypeScript Web Worker, no WASM)

### 3.1 Layered structure

```
┌──────────────────────────────────────────────────────────┐
│ Main thread                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Vue UI   │  │ Render   ││  │ LLM      │  │ Input    │ │
│  │ (HUD/shop│  │ adapter  ││  │ adapter  │  │ composable│ │
│  │ /dialogs)│  │ (SVG DOM)││  │ (later)  │  │          │ │
│  └────┬─────┘  └────┬─────┘┘  └────┬─────┘  └────┬─────┘ │
│       │ reactive     │ snapshot     │ snapshot    │ cmd   │
│       │ mirror       │ (60Hz)       │ (1-5Hz)     │(events)│
│  ┌────▼─────────────▼──────────────▼───────────▼──────┐ │
│  │ Host layer: snapshot store + command dispatcher    │ │
│  └────────────────────┬────────────────────────────────┘ │
└───────────────────────┼──────────────────────────────────┘
                        │ postMessage (cmd in / snapshot out)
┌───────────────────────▼──────────────────────────────────┐
│ Worker: Simulation                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ GameEngine (rules, combat, waves, economy)        │   │
│  │  - pure data I/O via HostBindings interface       │   │
│  │  - entity storage leaning SoA where cheap         │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ Hot-loop kernels (collision, pathfinding, spatial │   │
│  │ query) — TS now, WASM-pluggable later via seam    │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

The main thread hosts four categories of consumer/producer (Vue UI, render adapter, LLM adapter, input composable), a host layer that dispatches commands to the worker and distributes snapshots to consumers, and the worker itself running the simulation. The LLM adapter is shown for completeness; it is not part of the initial migration but the seam for it is established from the start.

### 3.2 The HostBindings interface

The simulation reaches the outside world exclusively through an injected `HostBindings` interface. Today this is implemented by a main-thread adapter that calls `SoundManager`, `uiStore`, and `persistStore`. When the simulation moves into a worker, the same interface is implemented by a thin shim that posts messages to the main thread. **This is the change that makes the worker migration behavior-preserving at every step** — and it is the missing piece from the earlier per-phase migration plan, which proposed "post a message" instructions at phases that had no worker to post to yet.

The interface covers the coupling points that currently exist between the engine and the main thread:

- **Sound.** `playSound(name: string): void`. Currently the engine constructs a `SoundManager` directly (`src/game/GameEngine.ts:91`) and calls `this.sound.play("boss_die")` (`GameEngine.ts:204`), `this.sound.play("base_hit")` (`GameEngine.ts:267`). Critically, the `SoundManager` is also passed into `TowerManager` (`GameEngine.ts:142`) and used at `src/towers/TowerManager.ts:136,147,157` for `place`/`sell`/`cancel` sounds, and forwarded into `Tower.update` where it fires `shoot_${type}` sounds at `src/towers/Tower.ts:808,841`. Any sound-decoupling plan must cover `TowerManager` and `Tower`, not just `GameEngine`. The `HostBindings.playSound` callback propagates through all three.
- **UI notifications.** `notifyUi(event: UiEvent): void`. Currently `useUiStore().initForRun(null)` is called at `GameEngine.ts:125`. Under `HostBindings`, this becomes a `notifyUi({type: "initForRun", payload: null})` call that the main-thread adapter routes to `uiStore`.
- **Persistence.** `schedulePersistSave(state: PersistStateSlice): void`. The engine currently calls `this.persistStore.save()` at `GameEngine.ts:202,443` and reads/writes many `persistStore` fields and methods. Under `HostBindings`, the engine holds a plain `PersistState` object (see §3.6) and posts save requests through the binding; the main-thread adapter writes to `localStorage` via `persistStore`. The `persist.ts:196` `useUiStore()` coupling for save-failure notifications stays on the main thread where it belongs.
- **Confirm dialogs.** `requestConfirm(payload: ConfirmPayload): Promise<boolean>` (or a callback-based equivalent). Currently `sellSelected()` at `GameEngine.ts:601-624` calls `useUiStore().showConfirm(...)` inline and also reads `useMapThemeStore().getDefaultTowerVisual(tower.type)` to compose the dialog message. Under `HostBindings`, the engine emits a confirm request with the raw data (tower id, sell value, is-refund flag), and the main-thread adapter enriches it with themed display data and shows the dialog. On confirmation, the adapter posts an `action:executeSell` command back into the worker. This cleanly relocates the dialog flow (the earlier plan's Phase 10) without the engine knowing about dialogs.

Establishing `HostBindings` first means the subsequent migration phases (extracting plain state, eliminating Pinia imports, moving to a worker) can each be done with the engine still fully functional at every step. The earlier plan's claim that "Phases 1-4 can be done sequentially with no breaking changes" is only true if `HostBindings` exists first.

### 3.3 The Command schema

All intent flowing into the simulation — from input, from UI actions, from the future LLM commander — is expressed as typed `Command` messages in one schema. The worker drains a command queue at the start of each tick, which eliminates the input/sim race condition the earlier plan flagged in its Risk Areas.

The schema is a discriminated union. Categories include:

- **Input events** from the keyboard composable (`src/game/Input.ts`) and the SVG click/hover handlers in `SvgGameRoot.vue`:
  - `{type: "input:click", worldX, worldY}`
  - `{type: "input:hover", worldX, worldY}`
  - `{type: "input:key", key, direction: "down"|"up"}`
- **High-level actions** that wrap common input sequences (these are the methods on `GameEngine` currently called directly by `Input.ts` and `SvgGameRoot.vue`):
  - `{type: "action:togglePause"}`
  - `{type: "action:cycleSpeed", direction: 1|-1}`
  - `{type: "action:upgradeSelected"}`
  - `{type: "action:sellSelected"}` — request a sell (engine returns a confirm payload via `HostBindings.requestConfirm` if a dialog is needed, or executes immediately if `sellActive === "discount"` early-returns per `GameEngine.ts:605-607`)
  - `{type: "action:executeSell"}` — confirmed sell, fires after the dialog resolves
  - `{type: "action:downgradeSelected"}`
  - `{type: "action:specialize", variant}`
  - `{type: "action:cancelSelected"}`
  - `{type: "action:setTargeting", mode}`
  - `{type: "action:setFixedAimDir", dir}`
  - `{type: "action:cancelBuildMode"}`
  - `{type: "action:selectTower", towerId}`
  - *(Note: `action:selectBuildType` is intentionally omitted — `selectedTowerType` is host-authoritative, updated directly on `gameStore` and echoed back in the snapshot. See §6.2.)*
- **Lifecycle commands:**
  - `{type: "lifecycle:init", persistState, theme, mapIndex}` — startup
  - `{type: "lifecycle:dispose"}` — clean shutdown
  - *(Note: `lifecycle:setTheme` is intentionally omitted — mid-run theme switching is out of scope per `README.md`. Add it if mid-run switching ever becomes in-scope.)*
- **Future LLM commands** (same schema, same queue):
  - `{type: "llm:routeGroup", enemyIds[], waypoints, hold?, holdTile?}` — `hold: true` routes enemies to `holdTile` and holds (replaces the old `llm:holdFormation`); `hold: false`/absent chains waypoints to the base
  - `{type: "llm:setTargeting", enemyIds[], mode}`
  - `{type: "llm:coordinateAssault", groupIds[], wave}`

Treating human input and LLM commands as the same kind of thing is the architectural payoff of the spine. A scripted scenario or a replay is just another command producer. A second LLM (an evaluator, an adversary in testing) is just another command producer.

### 3.4 The SimulationSnapshot DTO

The simulation produces a typed `SimulationSnapshot` each tick (optionally throttled — see §6.1). The snapshot is **plain data** — no live object references, no methods, no closures. This is what makes it safely `postMessage`-able, what makes it a clean input to a future SAB ring buffer, and what makes it a clean input to the LLM adapter.

The snapshot contains:

- **`frameId`** — monotonic counter. Consumers detect stale reads by comparing frameIds.
- **`meta`** — scalar simulation state: `wave`, `gold`, `lives`, `timeScale`, `gameState`, `selectedTowerId`, `selectedTowerType`, `hoverTile`, `waveCountdown`, `runGemsEarned`, `bossesKilledThisRun`, `bossesReachedBaseThisRun`, `lastScaledDt` (needed by the render adapter for animation timing, currently read at `SvgGameRoot.vue:308`). Camera is intentionally excluded — it is main-thread-only UI state, read directly from `gameStore.camera` by the render loop.
- **`entities`** — flat arrays of plain DTOs, one per entity type:
  - `enemies: EnemySnapshot[]` — `{id, type, x, y, hp, maxHp, shield, maxShield, angle, level, reachedBase, onPathBlocked, removed, slowFactor, slowTimer, burnTimer, hitFlash, statusEffects[], walkingFrameIndex, ...}`. Note that enemies are currently passed to the render manager as live `Enemy[]` (`SvgGameRoot.vue:309,313`); they must become snapshots.
  - `towers: TowerSnapshot[]` — `{id, type, x, y, level, variant, angle, cooldown, targeting, totalInvested, waveDamage, sellValue, ...}`. `sellValue` is pre-computed by the worker so the main-thread `TowerPanel` component doesn't need a live `Tower` method call. `TowerPanel` currently reads `gameStore.selectedTower.level`, `.type`, `.variant`, `.totalInvested`, and `.sellValue()` — these all come from the snapshot: `TowerPanel` looks up the selected tower from the `towers` array using `selectedTowerId` from `meta`. Same situation: currently live `Tower[]` (`SvgGameRoot.vue:310,314`).
  - `projectiles: ProjectileSnapshot[]` — already DTO-based via `getRenderData()` at `src/game/ProjectileManager.ts:774`. Little work.
  - `particles: ParticleSnapshot[]` — already DTO-based via `getRenderData()` at `src/game/ParticleSystem.ts:70`. Little work.
- **`spawnStates`** — for the spawn-queue overlay renderer, currently read at `SvgGameRoot.vue:329-330` as `engine.value.waveManager.spawnStates`.
- **`grid`** — static after map load; sent once at `lifecycle:init` rather than per-frame. The path-highlight renderer reads `gameStore.grid.paths` at `SvgGameRoot.vue:334,343`.
- **`persistDirty`** — a flag or hash indicating whether persist state has changed since the last save, to drive batched save messages.

The concrete work is to add a `getRenderData()` method to `Enemy` and `Tower` parallel to the ones that already exist on `ProjectileManager` and `ParticleSystem`. The render managers' `syncFromGameEngine` signatures (`src/render/svg/EnemyManager.ts:17`, `TowerManager.ts:13`, `UiOverlayManager.ts:116`) currently take live entity arrays; they will be updated to take snapshot arrays. Internally they already read plain properties off the entities (positions, hp, angles), so the change is mechanical: the source of the data changes from live objects to snapshots, the read sites stay the same.

### 3.5 SoA-leaning storage and the SpatialIndex seam

Two related but distinct decisions:

**SoA (Structure of Arrays) for new systems.** The existing entity classes (`Enemy`, `Tower`) use an AoS (Array of Structures) layout — each instance holds all its fields. This is fine for the rules layer (combat, status effects, AI), which changes frequently and benefits from class encapsulation and the existing test suite. But the **new** systems being added — collision, routing, pile-up, spatial targeting — are hot numerical loops over positions and velocities. For these, store the per-entity numeric data in `Float32Array`s indexed by entity id: `positionsX[id]`, `positionsY[id]`, `velocitiesX[id]`, `velocitiesY[id]`, `radii[id]`. This is no harder than maintaining parallel `Map<id, Enemy>` structures, and it is the substrate both WASM and a future SAB ring buffer will want.

This is **not** a full ECS rewrite. The rules layer stays class-based. Only the new numerical kernels use SoA. The two layers interoperate by reading/writing the same typed arrays — the class holds a reference to its slot index, and the hot loops iterate over the arrays directly.

**The `SpatialIndex` interface.** Define early:

```
interface SpatialIndex {
  insert(id: number, x: number, y: number, radius: number): void;
  remove(id: number): void;
  update(id: number, x: number, y: number, radius: number): void;
  queryRange(x: number, y: number, radius: number): number[];
  queryNearest(x: number, y: number, filter: (id: number) => boolean): number | null;
}
```

Implement in TypeScript now (a uniform grid or quadtree — uniform grid is simpler and fine at 100–200 entities). When WASM is eventually adopted for the numerical core (§4.2), this interface is implemented by a WASM-backed class that shares linear memory with the worker. The `GameEngine` and the new collision/routing systems depend on the interface, not the implementation, so the swap is localized.

**This is the single most important seam to establish early.** Collision and routing are exactly where WASM will pay off, and they are exactly the systems most likely to become smeared across `Enemy`/`EnemyManager`/`WaveManager`/`Pathfinding` if not given a clean boundary. Establishing the `SpatialIndex` interface before implementing the pile-up feature prevents that smearing.

### 3.6 Plain state objects: GameState and PersistState

The simulation holds plain state objects, not Pinia store references. This is the earlier plan's Phase 1, corrected.

**`GameState`** (the name is taken — `src/game/Constants.ts` exports a `GameState` enum used at `GameEngine.ts:25`; use `GameRunState` or `SimulationState` for the plain interface) mirrors the fields the engine reads and writes on `gameStore`. Crucially, the engine calls many `gameStore` *methods*, not just field mutations — the methods must be either inlined into the engine or replaced with direct field writes. The full list of `gameStore` methods currently called by the engine (from `src/stores/game.ts:153-281`): `addGold`, `setGold`, `loseLives`, `setWave`, `cycleSpeed`, `cycleSpeedReverse`, `selectTower`, `selectBuildType`, `setHoverTile`, `setHoverUpgradeBtn`, `setState`, `togglePause`, `initMap`, `setManagers`, `setCamera`, `setEngine`, `claimMilestone`, `hasClaimedMilestone`, `triggerEnd`, `resetToMenu`. The engine also reads `gameStore.grid`, `towerManager`, `enemyManager`, `map`, `mapIndex`, `randomMapParams`, `camera`, `upgradeBtnClickAnim`.

Most of these methods are thin wrappers around field writes (e.g., `addGold` is `this.gold += amount`) and translate directly. A few carry logic that must move into the engine or into a shared plain-state module: `claimMilestone` updates a set, `triggerEnd` composes the end-screen payload, `initMap` resets run state. These become plain functions operating on the plain state object.

**`PersistState`** mirrors the fields the engine touches on `persistStore`: `gems`, `difficultyMultiplier`, `generalAddons`, `mapProgress`, `milestoneClaims`. But `persistStore` also carries methods with real logic (from `src/stores/persist.ts:192-294`): `getDifficultyTick`, `updateBestWave`, `maybeUnlockNextMap`, `saveActiveWave`, `clearActiveWave`, `addRunToHistory`, `markFirstTimeMilestone`, `hasClaimedMilestone`, `markFirstClear`, `hasCleared`. These become pure functions over the plain `PersistState` object, living in a `PersistLogic.ts` module the worker imports. The `save()` method (which writes to `localStorage` and calls `useUiStore()` on failure at `persist.ts:196`) stays on the main thread; the worker posts save requests through `HostBindings.schedulePersistSave`.

**`WaveGraphTracker`** (`src/game/WaveGraphTracker.ts`) takes `gameStore` and `persistStore` Pinia refs at lines 51-57 and reads `persistStore.gems`, `gameStore.lives`, etc. It migrates to the same plain state objects. It is mentioned in the earlier plan's file list but without an approach; the approach is the same as for `GameEngine`.

### 3.7 Vue-reactive mirror on the main thread

`gameStore` becomes a projection of the snapshot. On each snapshot received from the worker, the main-thread host layer diffs the snapshot's `meta` against the current `gameStore` state and updates only the fields that changed. Vue's reactivity then drives HUD/shop/dialog updates as before.

Input-driven local mutations that don't need simulation agreement (opening the build menu, starting a camera pan, hovering a tile for preview) stay on `gameStore` for immediate UI feedback. Input that needs simulation agreement (placing a tower, confirming a sell) also posts a command; the snapshot that comes back reconciles any divergence. The two-sources-of-truth tension this introduces is real but bounded: the simulation is authoritative, the store is a cache, and reconciliation happens within one frame.

### 3.8 Persistence on the main thread

`localStorage` is main-thread-only. The worker holds plain `PersistState` and posts `persistSave` messages with a state slice when `persistDirty` is set in the snapshot. The main-thread adapter writes via `persistStore.save()` (which already serializes `this.$state` to `localStorage`). Save frequency is throttled — batched on significant events (end of wave, end of game, milestone claim) rather than on every gold increment, which is a behavior change from the current `this.persistStore.save()` at `GameEngine.ts:202,443` but an acceptable one.

### 3.9 Worker loop and timing

The current loop (`GameEngine.ts:207-232`) uses `requestAnimationFrame` for timing, calls `update(FIXED_DT)` in a fixed-timestep accumulator loop (constants at `src/game/Constants.ts:95-99`: `FIXED_DT = 1/60`, `MAX_ACCUM = 0.1`), and invokes `this.renderCallback?.()` at the end of each frame. `renderCallback` is set by `SvgGameRoot.vue:302` to do the imperative DOM writes.

In a dedicated worker, `requestAnimationFrame` is unavailable. The replacement is `setInterval` at a fixed interval (e.g., 16.67ms for a 60fps target) or — preferred — a `setTimeout`-driven loop that schedules the next tick based on elapsed time, which is more resilient to throttling than `setInterval`. Each tick: drain the command queue, compute elapsed time since the last tick, accumulate, dispatch fixed-`FIXED_DT` updates, then produce a snapshot and post it. The `renderCallback` field is removed entirely — rendering becomes a pure consumer of snapshots on the main thread, driven by its own `requestAnimationFrame` loop that reads the latest snapshot.

`performance.now()` is globally available in dedicated workers; no `self.` prefix needed. The reference at `GameEngine.ts:365` (`startTime: performance.now()`) needs no change for worker compatibility.

### 3.10 Worker lifecycle and router integration

The router guard at `src/router/index.ts:54` currently calls `gameStore.engine?.dispose()`. Under the new architecture, the engine lives in the worker. The guard posts `{type: "lifecycle:dispose"}`, waits for an acknowledgment (or a final `persistSave` message), then calls `worker.terminate()`. To avoid losing pending saves, the worker flushes any dirty persist state synchronously in its `lifecycle:dispose` handler before responding.

Engine creation currently happens at `src/components/SvgGameRoot.vue:235` (`new GameEngine(gameStore, persistStore, themeStore.activeTheme)`). Under the new architecture, `SvgGameRoot.vue` creates the `Worker`, posts `{type: "lifecycle:init", persistState, theme, mapIndex}`, and hosts the snapshot store and command dispatcher. `gameStore.setEngine(...)` at `game.ts:256` either goes away (the engine is no longer a main-thread reference) or is replaced with `gameStore.setWorker(worker)` if any code path still needs to reach the engine. Most code paths that currently call `engine.method()` are converted to command dispatch.

---

## 4. Recommended Architecture — Target (scaling moves)

Each move is independently deployable. The spine stays unchanged; only one layer is swapped at a time. None of these are committed; each is triggered by a measured bottleneck.

### 4.1 SAB-backed snapshot ring buffer

**Trigger:** `postMessage` + structured clone shows up as a measured cost in a flame chart during busy waves (boss waves, heavy projectile counts). At 100–200 enemies this is plausible but not certain — structured clone of flat typed arrays is fast, and the snapshot is mostly numeric.

**Change:** The hot per-entity arrays in the snapshot (`enemies`, `towers`, `projectiles`, `particles` — the `Float32Array`-backed fields) are written by the worker into a fixed-layout `Float32Array` over a `SharedArrayBuffer`. The main-thread render loop reads the same memory zero-copy. A frame counter at a known offset is updated last with `Atomics.store`, so the main thread can detect a complete frame by reading the counter before and after reading the entity data (a simple double-buffer or seqlock pattern). Variable-length fields (status effect lists, formation memberships) stay on `postMessage` — SAB is for fixed-layout numeric data only.

**Prerequisite:** cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`). This affects the entire origin: every external resource (theme SVG refs fetched in `src/render/themes/normalize.ts`, any CDN asset, fonts) must send CORS headers or be inlined. Vite dev server needs custom headers config. This is the single biggest hidden cost of SAB and is often the dealbreaker. **Enable COOP/COEP only at this point, not before.** The text-serializability invariant is unaffected: SAB is an internal transport, and the LLM-facing text view is produced by a separate adapter that reads the same snapshot data.

### 4.2 WASM module for the numerical core

**Trigger:** TypeScript hot loops in collision, pathfinding, and spatial query are the measured bottleneck — plausible once collision, pile-up, non-linear routing, and RPG combat all land, but still a measure-before-porting decision. At 100–200 entities with deep per-entity behavior, this is more likely to trigger than the SAB move, but not guaranteed.

**Change:** Compile a WASM module from **Rust** (not AssemblyScript — AS rejects closures, union types, and dynamic objects, all of which the rules layer uses heavily; AS's perf is also worse than Rust). Use `WebAssembly.Memory` with `shared: true` so the typed arrays are visible to JavaScript without copy. **Port only the `SpatialIndex` implementation plus collision resolution plus pathfinding** — the tight numerical loops. Leave the rules/combat/status-effect layer in TypeScript: it changes frequently, benefits from iteration speed, and the existing test suite covers it.

The `SpatialIndex` interface (§3.5) is what makes this a localized swap. A `WasmSpatialIndex` class implements the interface by calling into the WASM module; the `GameEngine` and the collision/routing systems are unchanged. The WASM module owns its own `WebAssembly.Memory` (shared with the worker's JS for direct typed-array views), and the rules layer reads/writes entity positions through the interface.

**Prerequisite:** the same cross-origin isolation as SAB (shared `WebAssembly.Memory` requires it). If SAB has already been enabled (§4.1), this prerequisite is already satisfied.

**Build-time dependency:** a Rust toolchain and `wasm-pack`. The compiled `.wasm` asset is loaded at runtime; no native runtime is introduced, consistent with the core invariant. This is the only new toolchain the architecture anticipates.

### 4.3 LLM commander plane

**Trigger:** the enemy-AI feature lands. Not part of the initial migration; the seam is established from the start by treating LLM commands as a category in the `Command` schema (§3.3).

**Change:** A separate worker (or a main-thread module — workers are preferred to keep the main thread free for rendering) consumes **abstracted** snapshots. The LLM context window cannot absorb 60fps raw entity arrays; the commander plane receives a semantic game-state view at low frequency (1–5Hz): entity groups (clustered by position and type), obstacle list with HP, wave timing and composition, tower threat zones (areas of influence per tower type), and current strategic state (which chokepoints are contested, which enemies are pinned). The abstraction is a projection of the same snapshot — the LLM and the renderer are both consumers, just at different detail levels.

The commander plane emits high-level commands (route group X along path Y, hold formation at chokepoint Z until wave N+1, target priority switch). These go into the worker's command queue identically to human input — the same `Command` schema, the same drain-at-tick-start logic. The simulation expands them into per-enemy behavior using documented algorithms the LLM was instructed about.

This cleanly separates **strategic planning (LLM, slow, high-level, remote)** from **tactical execution (simulation, fast, low-level, local)**. The remote-LLM constraint (§1.5) is accommodated naturally: the commander plane batches commands and submits them per turn (every few seconds); the simulation runs autonomously between turns with the last issued command set. No tight feedback loop is needed.

The commander plane also handles the API transport: serialization to the LLM's expected format, prompt assembly (system prompt + semantic state + command menu), response parsing, command validation (reject malformed or illegal commands, ask the LLM to retry or fall back to a default algorithm).

### 4.4 Alternative renderers as projections

**Trigger:** SVG DOM write throughput becomes the measured bottleneck. At 100–200 enemies with HP bars, status overlays, and projectiles, this is at the edge of comfortable SVG performance but workable. It becomes more likely if particle counts spike (already DTO-based, so the bottleneck would be DOM writes, not data access) or if visual complexity per entity grows.

**Change:** Add a canvas or WebGL renderer as another projection of the same snapshot. The snapshot schema (§3.4, §6.1) is render-format-agnostic — it carries positions, types, and visual state, not SVG-specific data. The SVG renderer stays as the debug/dev view and as the discipline proxy for text-serializability; the high-performance renderer is the production view. The two can coexist (toggleable) or the SVG renderer can be retired for production builds.

This is why §2.4 emphasizes that SVG is a projection, not a commitment. The text-serializability invariant is preserved by the snapshot schema, not by SVG. The LLM-facing text view is independent of render format.

---

## 5. Migration Phasing (revised from the earlier plan)

The earlier per-phase plan had a sequencing flaw: Phases 2–4 proposed "post a message" instructions at phases that had no worker to post to yet. The fix is to establish `HostBindings` first, so every subsequent phase is behavior-preserving. The revised phasing:

**Phase 0 — HostBindings interface.** Define the `HostBindings` interface and a main-thread adapter. Inject it into `GameEngine` (and `TowerManager`, `Tower` for sound). No behavior change; the adapter just calls the same things the engine called directly. This unblocks all subsequent phases.

**Phase 1 — Plain state objects.** Introduce `GameRunState` and `PersistState` plain interfaces. `GameEngine` and `WaveGraphTracker` accept plain state instead of Pinia refs. The `gameStore` methods called by the engine become plain functions over the state. `gameStore` continues to exist on the main thread for Vue reactivity. No behavior change.

**Phase 2 — Eliminate Pinia imports from the logic layer.** Replace direct `useUiStore()`/`useMapThemeStore()` calls in `GameEngine`, `Enemy`, `Tower`, `SkillTree` with `HostBindings` calls or constructor-injected theme data. The `SkillTree.ts:122-123` module-level `useMapThemeStore()` call becomes a `populateSkillTreeTheme(theme)` function called after the worker receives theme data. No behavior change.

**Phase 3 — Sound decoupling (full scope).** Remove `SoundManager` from `GameEngine`, `TowerManager`, and `Tower`. Route all sound through `HostBindings.playSound`. The main-thread adapter calls the existing `SoundManager`. No behavior change. (The earlier plan's Phase 3 missed `TowerManager` and `Tower` sound usage — corrected here.)

**Phase 4 — Confirm dialog relocation.** `sellSelected()` on the engine becomes a confirm-request via `HostBindings.requestConfirm`. The main-thread adapter enriches with theme data and shows the dialog. On confirm, an `action:executeSell` command is dispatched. The `sellActive === "discount"` early-return at `GameEngine.ts:605-607` stays in the engine so no dialog is shown when selling is disabled. `downgradeSelected()` currently has no confirm dialog (`GameEngine.ts:652-657`), so it needs no change. **Re-validation on `action:executeSell`:** the dialog can remain open across multiple simulation ticks. On receiving `action:executeSell` with a `towerId`, the engine re-validates that the tower still exists and `sellActive !== "discount"` before executing the sell. If validation fails, the command is silently dropped and the mirror is reconciled by the next snapshot. No behavior change from the player's perspective.

**Phase 5 — Snapshot and Command schema.** Define the `SimulationSnapshot` and `Command` types (§3.4, §3.3, §6.1, §6.2). Add `getRenderData()` to `Enemy` and `Tower`. Update render managers' `syncFromGameEngine` signatures to take snapshot arrays. The engine still runs on the main thread at this point; snapshots are produced but consumed locally. No behavior change.

**Phase 6 — Input decoupling.** `Input.ts` (the Vue composable at `src/game/Input.ts`) stops calling `engine.method()` directly and instead dispatches commands. `SvgGameRoot.vue` click/hover handlers (`SvgGameRoot.vue:175-221`) do the same. Commands go to a local dispatcher that still calls the engine directly — the dispatcher is the seam that will later forward to the worker. No behavior change.

**Phase 7 — Worker creation and loop migration.** Move `GameEngine` (and its dependencies) into a worker entry. Replace the RAF loop with a `setTimeout`-driven fixed-timestep loop. The command dispatcher from Phase 6 now forwards commands via `postMessage`. The snapshot store on the main thread receives snapshots via `postMessage`. The render loop reads from the snapshot store instead of from `gameStore`/`engine`. `gameStore` becomes a reactive mirror updated by snapshot diffs.

**Phase 8 — Render loop adaptation.** The render loop (`SvgGameRoot.vue:302-353`) reads exclusively from the snapshot store. The `renderCallback` field is removed from the engine. `lastScaledDt` is read from the snapshot (`SvgGameRoot.vue:308` currently reads `engine.value.lastScaledDt`). Camera stays on the main thread (input-driven, never needs to cross the boundary).

**Phase 9 — Persistence batching.** The engine posts `persistSave` messages through `HostBindings` when `persistDirty` is set, throttled to significant events. The main-thread adapter writes to `localStorage` via `persistStore`.

Phases 0–6 are behavior-preserving and can be done sequentially with the test suite green at every step. Phases 7–9 are the actual worker migration and should be done together to avoid an intermediate state where the engine is worker-compatible but not yet in a worker. The earlier plan's claim that "Phases 1-4 can be done sequentially with no breaking changes" holds only because Phase 0 (`HostBindings`) now precedes them.

---

## 6. Open Items — Proposals

### 6.1 Snapshot schema detail

**Proposal:**

- **Production rate:** every tick (60Hz). The snapshot is cheap to produce (typed-array reads) and the render loop wants 60Hz. Throttling is a later optimization if profiling shows it's needed.
- **Status-effect encoding:** fixed-cap array per enemy, slot-allocated. The enemy cap is 100–200, and per-enemy status effect count is bounded (slow, stun, burn, shield, heal — call it 8 slots max with headroom). A `Uint8Array` of effect-type ids and a `Float32Array` of remaining durations, both indexed by `(enemySlot * MAX_EFFECTS_PER_ENEMY) + effectSlot`. This is SAB-friendly and WASM-friendly. Variable-length spills (more than 8 effects, which shouldn't happen) are dropped with a debug warning — status effects beyond the cap are rare and uninteresting.
- **Abstraction level for the LLM-facing semantic view:** grouped, not raw. The LLM commander plane (§4.3) produces a *projection* of the snapshot: enemies are clustered by proximity and type into groups (e.g., "12 minions at chokepoint A, 3 tanks at obstacle B, 1 boss at gate C"), towers are summarized by type and threat zone, obstacles are listed with HP. This is a separate transform from the raw snapshot, applied in the commander plane before submission to the LLM. The raw snapshot stays available to the renderer; the semantic view is a different consumer at a different rate.
- **Frame format:** a single `SimulationSnapshot` object with nested typed arrays for the hot per-entity data and plain arrays/objects for the cold data (meta, spawnStates). For `postMessage` transport, the typed arrays are transferred (not copied) using the transfer-list of `postMessage` — but this requires the worker to relinquish ownership, so the worker must double-buffer or re-allocate. Alternatively, structured-clone the typed arrays (cheap for the sizes involved). For SAB transport (§4.1), no transfer — the buffer is shared.
- **Versioning:** the snapshot schema includes a `schemaVersion` field. Consumers reject snapshots with incompatible versions. This allows the schema to evolve without silent breakage.

**Still to decide:** the exact field set per entity type. Recommend defining this as a TypeScript module (`src/game/Snapshot.ts`) early, with the render managers and the LLM adapter both importing the types so the contract is enforced by the compiler.

### 6.2 Command schema completeness

**Proposal:**

- **Every public method on `GameEngine` that is called from outside the engine gets a command, with exceptions noted in §6.2.** The full list, derived from current call sites in `Input.ts` and `SvgGameRoot.vue`: `handleClick`, `setHover`, `togglePause`, `cycleSpeed`, `cycleSpeedReverse`, `upgradeSelected`, `sellSelected`, `executeSell`, `downgradeSelected`, `specializeSelected`, `cancelSelected`, `setTargeting`, `setFixedAimDir`, `cancelBuildMode`, `selectBuildType`, `selectTower`, `loadMap`, `loadRandomMap`, `start`, `stop`, `dispose`. Methods that are internal-only (`update`, `loop`, `onWaveCleared`, `onWaveStart`, `onEnemyKill`, `onBossKilled`, `earnGold`, `endGame`, `_initMap`, `_applyStartingBonuses`) do not get commands.
- **Camera is not in the snapshot.** Camera pan, zoom, and coordinate conversion (`src/composables/cameraUtils.ts`, `src/render/svg/cameraUtils.ts`) never need to cross the worker boundary. The camera is input-driven UI state; the render loop reads it directly from `gameStore.camera` on the main thread (`SvgGameRoot.vue:303`). The worker never reads or writes camera state.
- **Hover preview stays on the main thread.** `setHover` currently updates `gameStore.hoverTile` for build-preview rendering (`GameEngine.ts:482-501`). Under the new architecture, hover is pure UI — the main thread computes the tile from the mouse position and updates `gameStore.hoverTile` directly. The worker doesn't need to know about hover. The `setHover` command is dropped; the worker only needs `input:click` (for actual placement/selection).
- **Build menu selection — worker-authoritative `selectedTowerType` (DECISION, supersedes the earlier "stays main-thread" proposal).** The earlier proposal was to keep `selectBuildType` main-thread-only and let the worker infer build intent from the snapshot-mirrored `selectedTowerType`. In the implementation, `selectedTowerType` is **worker-authoritative** (`runState.selectedTowerType`), and an `action:selectBuildType` command *was* added (`src/sim/Command.ts`, applied in `src/sim/applyCommand.ts` by writing `engine.runState.selectedTowerType`). The main thread sets `gameStore.selectedTowerType` locally for immediate build-preview feedback **and** dispatches `action:selectBuildType`; the worker mirrors the value back into the snapshot `meta.selectedTowerType`, and `SnapshotStore.mirrorToGameStore` reconciles `gameStore.selectedTowerType` each frame. This divergence from the original proposal is deliberate (tracked as "Fix #1"): it lets the worker clear build mode on its own when a click lands off-grid or on an occupied tile, and on `action:cancelBuildMode`, so the main-thread preview cannot desync from the engine's placement state. `input:click` still carries no build type — the worker reads `selectedTowerType` from `runState` at click time.
- **LLM commands are added to the same schema as a category**, not a separate schema. This is the architectural payoff of §2.2. The `Command` type is a discriminated union with categories `input:*`, `action:*`, `lifecycle:*`, `llm:*`. Adding `llm:*` variants later is additive.

**Still to decide:** whether `action:executeSell` takes a `towerId` (allowing the sell to apply to whatever was selected when the dialog opened) or implicitly uses the current selection. Recommend `towerId` — selection can change between dialog-open and confirm, and the user's intent was to sell the tower they clicked.

### 6.3 Test strategy for the worker

**Proposal:**

- **Keep the existing 710 tests green at every phase.** This is the regression net. Phases 0–6 (§5) are behavior-preserving by design; the test suite should pass unchanged (modulo test-helper rewrites for the `HostBindings` injection).
- **Rewrite test helpers, not test bodies.** `tests/helpers/mock-stores.ts` and `tests/helpers/mock-managers.ts` currently construct `GameEngine` with Pinia mock stores. They are updated to construct `GameEngine` with plain state objects and a mock `HostBindings` (a simple object that records calls for assertion). Test bodies that assert on engine behavior (e.g., "after upgrade, gold decreases by cost") stay unchanged — they assert on the engine's plain state, which is what the engine now holds.
- **Add a `HostBindings` mock.** A `MockHostBindings` that records all calls (`playSound`, `notifyUi`, `schedulePersistSave`, `requestConfirm`) and allows tests to assert that the engine requested the right side effects. For `requestConfirm`, the mock can be configured to auto-resolve true or false, so tests can exercise the confirm flow without a real dialog.
- **Worker-level tests run in a Vitest environment with worker support.** Vitest can instantiate workers in jsdom (with the `--pool=forks` or `--pool=threads` option and proper worker setup). For the parts that are worker-specific (command dispatch, snapshot production, message round-trip), add a small set of integration tests that post commands and assert on received snapshots. This is a smaller, focused suite — the bulk of logic testing stays at the `GameEngine` level (which is worker-agnostic, since it just holds plain state and calls `HostBindings`).
- **Snapshot schema tests.** A dedicated test that constructs a snapshot, mutates the underlying engine, produces a new snapshot, and asserts that the diff is correct. This guards the snapshot contract that every consumer depends on.
- **Determinism tests.** A test that runs the engine with a fixed seed and a recorded command sequence, then asserts that the resulting snapshot matches a golden snapshot. This is enabled by the determinism principle (§2.5) and is the foundation for future LLM evaluation harnesses (run two strategies against the same seed, compare outcomes).
- **LLM commander plane tests.** When §4.3 lands, the commander plane is tested with a mock LLM (a script that emits canned commands) to verify the command-plane logic, prompt assembly, and response parsing. The actual LLM is never tested in CI — it is an external dependency.

**Still to decide:** whether to invest in Vitest worker-pool configuration now or defer to Phase 7. Recommend deferring — the engine-level tests cover logic until the worker actually exists.

### 6.4 When to enable COOP/COEP

**Proposal:**

- **Do not enable now.** The current architecture (plain `postMessage`) does not require cross-origin isolation. Enabling it preemptively adds infrastructure cost (CORS headers on every external resource, Vite config, potential breakage of theme SVG fetching in `src/render/themes/normalize.ts`) for no benefit.
- **Enable at the SAB move (§4.1) or the WASM move (§4.2), whichever comes first.** Both require cross-origin isolation; if SAB comes first, WASM's prerequisite is already satisfied.
- **Pre-check feasibility before committing.** Before starting the SAB/WASM work, audit every external resource the app loads:
  - Theme SVG refs fetched in `src/render/themes/normalize.ts` — these must send `Access-Control-Allow-Origin` headers, or be inlined into the theme JSON, or be proxied through the same origin.
  - Any CDN assets (fonts, images) — same requirement.
  - Third-party scripts, if any — must support CORS or be removed.
  - Vite dev server — needs `server.headers` config for COOP/COEP, and any dev-time proxy must forward the headers.
- **Fall back if pre-check fails.** If the audit reveals that CORS compliance is infeasible (e.g., a theme asset is served from a host that can't be configured), the SAB/WASM moves are blocked until the asset is inlined, proxied, or replaced. The plain `postMessage` architecture (§3) remains viable indefinitely at 100–200 entities — SAB/WASM are optimizations, not requirements.
- **`credentialless` vs `require-corp` for COEP.** Prefer `credentialless` where supported (Chrome 96+, Firefox 110+): it relaxes the CORS requirement for non-credentialed requests, making third-party assets easier to load. Fall back to `require-corp` for broader compatibility, accepting the stricter CORS requirement.

**Still to decide:** the deployment target. If the app is ever served from a CDN or behind a proxy, the COOP/COEP headers must be set at that layer, not just in Vite. This is an ops concern outside the codebase, but it should be documented when the SAB/WASM move is scoped.

---

## 7. Risks and Mitigations

### 7.1 Two-sources-of-truth tension

The worker is authoritative for simulation state; `gameStore` is a reactive mirror. Input-driven local mutations (build menu selection, camera pan, hover preview) update `gameStore` immediately for UI feedback and also post a command; the next snapshot reconciles. If the worker rejects the command (e.g., insufficient gold for placement), the snapshot will show the old state and the mirror must roll back.

**Mitigation:** the reconciliation window is one frame (~16ms). Brief UI flicker is possible but acceptable for the cases where it occurs (failed placement, failed upgrade). For high-stakes mutations (sell, upgrade), the UI can show a pending state until the snapshot confirms. The command schema includes a `commandId` that the snapshot echoes back as `lastAppliedCommandId` so the UI can detect confirmation or rejection explicitly.

### 7.2 Message serialization cost

Structured clone of the snapshot at 60Hz is the baseline transport cost. For 100–200 enemies with ~20 numeric fields each, plus towers, projectiles, and particles, the snapshot is on the order of tens of kilobytes — well within structured-clone performance budgets. The risk is if particle counts spike into the low thousands during heavy combat.

**Mitigation:** particles are already DTO-based (`src/game/ParticleSystem.ts:70`) and are the most volatile. If particle serialization becomes a bottleneck, throttle particle snapshots to 30Hz (particles are visually smooth enough at 30Hz) or cap the particle count in the snapshot (render only the N most recent). The SAB move (§4.1) is the full mitigation if structured clone is fundamentally too slow.

### 7.3 Race conditions on input

Input commands arriving while the engine is mid-update. The earlier plan flagged this.

**Mitigation:** the command queue is drained at the start of each tick, before any update logic runs. Commands are never processed mid-update. This is a single-threaded worker; there is no true parallelism. The only race is between `postMessage` arrival timing and tick boundaries, which the queue drains cleanly.

### 7.4 Theme data size

Theme JSON is large (hundreds of kilobytes of SVG sprite definitions). Posting it per-frame would be catastrophic.

**Mitigation:** theme is posted once at `lifecycle:init` (and on `lifecycle:setTheme` if mid-run switching is ever added — currently out of scope per `README.md`). The worker holds the theme reference and never re-receives it. Theme data is plain JSON with inlined SVG strings — `structuredClone`-safe, no functions or closures.

### 7.5 Transitive Pinia import coupling

Even after removing direct `useMapThemeStore()` calls from `Enemy` and `Tower`, importing `TowerManager` transitively imports `Tower` which (currently) imports `useMapThemeStore`. The worker bundle must not import any Pinia store module, or the worker will fail to initialize (Pinia requires `createPinia()` which requires a Vue app context).

**Mitigation:** Phase 2 (§5) removes the `useMapThemeStore()` calls from `Enemy.ts:116` and `Tower.ts:255` — the constructors already accept a `visualMeta` parameter (per `README.md` lines 252, 259), so the fallback to the global theme store can be replaced with a fallback to plain defaults or with the `visualMeta` always being passed. After this removal, the import of `useMapThemeStore` from `Enemy.ts:10` and `Tower.ts:33` is deleted, breaking the transitive coupling. A build-time check (a `tsconfig` for the worker entry that excludes `src/stores/**`) can enforce this boundary going forward.

### 7.6 SVG DOM write throughput

At 100–200 enemies with HP bars, status overlays, and projectiles, the SVG DOM write budget per frame is the most likely performance ceiling. This is not solved by moving logic to a worker — the worker frees the main thread to do DOM writes without logic interruption, but the DOM writes themselves are still the cost.

**Mitigation:** the worker migration (§3) is the first mitigation — it removes logic from the main thread, giving the render loop the full frame budget for DOM writes. If that is insufficient, the render loop can batch writes (set attributes on a detached fragment, then attach) or use a virtual DOM diffing approach for the entity layer. If still insufficient, the alternative-renderer move (§4.4) replaces SVG with canvas/WebGL for the hot layers while keeping SVG for static content (grid, base art).

### 7.7 LLM command validation

The LLM may emit malformed or illegal commands (route a group through a wall, target a nonexistent tower, hold formation at an invalid chokepoint). The simulation must not crash or desync.

**Mitigation:** the command plane (§4.3) validates commands before submission. The worker also validates on receipt — a command that fails validation is dropped and an error is posted back to the main thread for logging (and, in the commander plane, for re-prompting the LLM with the error). Validation is a pure function over the command and the current snapshot state.

### 7.8 Anti-cheat robustness

With full source knowledge, the LLM adversary will find optimal strategies. If the rules reward a single dominant strategy, the game becomes trivial for the LLM and boring for the human.

**Mitigation:** this is a game-design problem, not an architecture problem, but the architecture supports it: the determinism principle (§2.5) enables an evaluation harness that runs many LLM strategies against many tower configurations and surfaces dominant strategies for rebalancing. The commander-plane architecture (§4.3) makes it easy to swap LLMs and run comparative evaluations. The snapshot schema makes it easy to record and replay games for analysis.

---

## 8. Glossary

- **Spine** — the snapshot + command stream that connects all consumers and producers. §2.1.
- **Snapshot** — a plain-data representation of simulation state at a single tick, produced by the worker and consumed by the renderer, UI, and LLM adapter. §3.4.
- **Command** — a typed message expressing intent (input, action, lifecycle, LLM) flowing into the simulation. §3.3.
- **HostBindings** — the interface the simulation uses to reach the outside world (sound, UI, persistence, confirm). §3.1.
- **SpatialIndex** — the interface for spatial queries (range, nearest) that collision, pathfinding, and targeting depend on. §3.5.
- **SoA** — Structure of Arrays. Per-entity numeric data stored in typed arrays indexed by entity id, rather than as fields on class instances. §3.5.
- **Projection** — a read-only view of the snapshot tailored for a specific consumer (renderer, LLM, UI). The SVG renderer and the LLM semantic view are both projections.
- **Commander plane** — the layer that consumes abstracted snapshots, calls the LLM, and emits high-level commands. §4.3.
- **Cross-origin isolation** — the browser security state (`COOP: same-origin` + `COEP: require-corp` or `credentialless`) required for `SharedArrayBuffer` and shared `WebAssembly.Memory`. §4.1.

## 9. References

Code references throughout this document use `file:line` format. Key files:

- `src/game/GameEngine.ts` — the simulation core, currently main-thread, target for worker migration.
- `src/game/Constants.ts` — `FIXED_DT`, `MAX_ACCUM`, `VICTORY_WAVE`, `GameState` enum.
- `src/game/WaveGraphTracker.ts` — secondary Pinia-coupled module, migrates with the engine.
- `src/game/Input.ts` — Vue composable for keyboard input, stays main-thread, becomes a command producer.
- `src/game/ProjectileManager.ts`, `src/game/ParticleSystem.ts` — already have `getRenderData()` returning plain DTOs.
- `src/stores/game.ts` — Pinia store, becomes a reactive mirror of the snapshot.
- `src/stores/persist.ts` — Pinia store, `save()` stays main-thread; logic methods become pure functions.
- `src/stores/ui.ts`, `src/stores/mapTheme.ts` — UI and theme stores, stay main-thread.
- `src/towers/Tower.ts`, `src/towers/TowerManager.ts`, `src/towers/SkillTree.ts` — Pinia-coupled logic modules, migrate with the engine.
- `src/enemies/Enemy.ts`, `src/enemies/EnemyManager.ts` — same.
- `src/render/svg/*.ts` — render managers, `syncFromGameEngine` signatures updated to take snapshot arrays.
- `src/components/SvgGameRoot.vue` — owns the RAF loop and `GameEngine` lifecycle today; will own the worker and snapshot store tomorrow.
- `src/router/index.ts` — navigation guard, posts `lifecycle:dispose` instead of calling `engine.dispose()`.
- `src/render/themes/normalize.ts` — fetches external SVG refs; affected by COOP/COEP if SAB/WASM is adopted.
- `tests/helpers/mock-stores.ts`, `tests/helpers/mock-managers.ts` — test helpers, rewritten for `HostBindings` injection.
