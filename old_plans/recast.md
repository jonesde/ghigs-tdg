# Recast/DetourCrowd Integration Plan — Replace Pathfinding & Routing

Goal: rip-and-replace the hand-rolled BFS pathfinding (`Pathfinding.ts`), the
tile-path-following / lane-offset / contact-line steering in `Enemy.ts`, and the
commander `llm:routeGroup` waypoint routing with a **navmesh + crowd** WASM
toolset — `recast-navigation` (v0.43.1; **formerly `recast-navigation-js`**, now
renamed/modularized — confirm exact entry points, see Phase 0), which wraps
**Recast** (navmesh build), **Detour** (pathfinding), and **DetourCrowd** (local
agent avoidance + steering). Rapier2d stays as the rigid-body collision authority
for towers / base / corridor walls. This is a **first pass that reproduces the
nearest equivalent of current behavior** while unlocking new tactics (open-area
pathing, maze-building with tower obstacles, natural enemy-enemy avoidance) that
we get "for free" from the toolset. Behavior-preserving parity is **not** a
requirement — the point is more options, not a byte-identical re-implementation.

> Rollback safety: this is a rip-and-replace. `git` is the rollback if it goes
> badly. If DetourCrowd proves a poor fit, the named alternative to try next is
> **`navcat`** (Isaac Mason's pure-TS navigation/crowd lib, v0.4.1) — same author,
> lighter, no WASM. The plan is structured so the old BFS/`Enemy` motion path stays
> behind a flag during the first pass, then is deleted at flip.

## Current state (findings — verified against current code)

- **Path provisioning is grid/BFS based.** `Grid.paths` is a per-spawn array of
  tile `{x,y}` (`Grid.ts:40`); `getPathFor(spawnIndex)` returns it (`Grid.ts:248`).
  `recomputePaths` / `recomputePathsForTile` re-run BFS and bump `pathVersion`
  (`Grid.ts:219`, `:225`) whenever a tower is built/sold.
- **Reroute policy routes *through* towers.** `dijkstraWeakestPath`
  (`Pathfinding.ts:177`) weights tower tiles by remaining health so enemies walk
  *through* a tower and attack it; `canPlaceWithoutBlocking` (`Pathfinding.ts:138`)
  permits path-tile placement. This "walk through + attack" is the current tower
  interaction — it is **replaced** by tower-as-obstacle (see Approach).
- **Enemy follows tiles.** `Enemy.ts` advances `pathIdx` toward each waypoint
  center (`computeIntent`), applies a turn-invariant `laneOffset` for spread, runs
  `contactLineSteer` (base/tower pile, `:1052`) and `findLateralOpenSpot`
  (`:874`) for lateral passing, and `resolveCollisions` for overlap. `pathVersion`
  mismatch triggers `reanchorToPath` (`:461`).
- **Commander routing is tile-waypoint based.** `llm:routeGroup` → `applyRoute`
  (`:424`) sets `enemy.path` to a waypoint chain; `releaseToDefault` (`:444`) /
  `reanchorToPath` snap back. Brains (stubby `:35`/`:49`, stubbs `:168`) compute
  waypoints via `grid.computeSurroundRoute` (`Grid.ts:279`).
- **Rapier owns bodies + world collision.** `PhysicsWorld.isWalkable` (`:35`)
  defines the corridor (path∪base∪spawn); it builds base, tower, and corridor-wall
  colliders. `GameEngine` steps physics and rebuilds tower/corridor colliders on
  `pathVersion` (`GameEngine.ts:334`). Enemy bodies are dynamic circles.
- **Snapshot/renderer are decoupled.** `SnapshotSerializer` ships `enemy.x/y`
  (unchanged) plus `grid.paths`/`pathsVersion` for the minimap path highlight
  (`TextPathRenderer`). Render managers never touch the engine.
- **Tests build `GameEngine` directly** and run in jsdom; `worker-roundtrip.test.ts`
  imports `WorkerEntry`. Both must `await` any WASM init. Rapier already proved this
  pattern works (`rapierContext.ts`).

## Approach

**Division of labor (the key decision):**
- **`recast-navigation` / DetourCrowd owns:** navmesh construction, spawn→base
  pathfinding, per-agent path *following*, and **inter-agent local avoidance**
  (the "enemies look ahead and move around each other" behavior, for free, and it
  shines in open areas).
- **Rapier2d owns:** rigid-body collision with **towers, base, and corridor walls**
  (the static world). Enemy bodies remain Rapier dynamic circles; Rapier is the
  hard constraint that stops an agent at a tower/base/wall. **Enemy-enemy collision
  is delegated to Crowd** (see tradeoffs) so the two systems don't fight.

**Towers become Detour *obstacles*, not path tiles.** This is the headline new
option: placing a tower re-routes enemies *around* it (maze-building), instead of
enemies walking through and attacking it. Reachability (spawn→base still reachable
on the navmesh) replaces `canPlaceWithoutBlocking`. Enemy-attacking-tower becomes a
deferred/optional edge case (some enemy types could still target an adjacent
tower); the core win condition stays "reach base → attack base."

**Movement loop (mirrors the Rapier plan's preStep/step/postStep split):**
`crowd.update(FIXED_DT)` computes each agent's desired velocity (path follow +
avoidance) → write that as Rapier `setLinvel` on the enemy body →
`physicsWorld.step()` resolves tower/base/wall collisions → read body
`translation()` back into `enemy.x/y/centerX/centerY` (and `moveAngle` from
`linvel`).

### Decided tradeoffs

- **WASM init seam:** add `src/sim/navmesh/recastContext.ts` mirroring
  `rapierContext.ts`: `initNavMesh(): Promise<void>` (cached `await init()`) +
  `getRecast()`. `WorkerEntry` `init` handler becomes `async` and awaits both
  `initPhysics()` and `initNavMesh()` before `new GameEngine`. `package.json`:
  add `recast-navigation` only (no Vite wasm plugins — the compat-style build
  inlines WASM like Rapier's does; **verify** the v0.43 build's import/loader
  shape, since the package was restructured from `recast-navigation-js`).
- **Feature flag:** `RECAST_NAV` in `src/sim/featureFlags.ts` (default OFF, next to
  `RAPIER_PHYSICS`). Keeps ~existing tests green during the first pass; flip ON
  when the behavioral suite passes, then delete the BFS/`Enemy`-tile path. (Flag is
  a migration aid only — `git` is the real rollback per the brief.)
- **Enemy-enemy collision in Crowd, not Rapier.** Add enemy bodies to a Rapier
  collision group that excludes other enemies (or set a filter so enemy-enemy pairs
  don't generate solver contacts); Crowd's local avoidance separates them. This
  avoids the classic Detour+Rapier "two solvers fighting" jitter. Rapier keeps
  enemy-vs-tower/base/wall.
- **Navmesh is static per run** (rebuilt only on new map), covering the walkable
  corridor (path∪base∪spawn) — same set `PhysicsWorld.isWalkable` uses. Towers are
  added/removed as **Detour dynamic obstacles** at runtime; they are *not* baked
  into the navmesh, so no per-tower navmesh rebuild. Rapier tower colliders are
  still rebuilt on tower change (already wired to `pathVersion` / a new
  `navVersion`).
- **`pathVersion` semantics change.** It no longer drives BFS recompute; it (or a
  `navVersion`) bumps when Detour obstacles change, gating the Rapier tower-collider
  rebuild + the snapshot's path-highlight refresh. `recomputePaths` /
  `dijkstraWeakestPath` / `computeSurroundRoute` / `canPlaceWithoutBlocking` are
  deleted.

## Phase 0 — Tooling & async init seam

- `package.json`: add `recast-navigation` (v0.43.1). **Verify** exact subpath/exports
  (`recast-navigation` vs `@recast-navigation/core`) and the WASM loader. No Vite
  wasm plugins expected (mirror Rapier compat approach); confirm against v0.43.
- New `src/sim/navmesh/recastContext.ts`: `initNavMesh()` (cached `await init()`),
  `getRecast()` (throws if uninitialized, guarding the synchronous constructor like
  `getRapier`). Exposes `Recast`, `Detour`, `NavMesh`, `Crowd` + config helpers.
- `src/sim/featureFlags.ts`: add `export const RECAST_NAV = false;`
- `src/sim/WorkerEntry.ts` (`init` handler): `async`; `await initPhysics();
  await initNavMesh();` before `new GameEngine(...)`. `GameEngine` ctor stays
  synchronous (direct-construct tests `await` both inits in `tests/setup.ts`).
- `tests/setup.ts`: shared `beforeAll` awaiting both inits so every direct-construct
  test path is safe at flip.

## Phase 1 — `NavMeshBuilder` (`src/sim/navmesh/NavMeshBuilder.ts`)

Builds one **tiled** navmesh (+ `TileCache`) per run from the walkable tile set. We
use the **tiled** generator from the start (not solo) because the map *is* a tile grid
and, critically, **only tiled navmeshes support dynamic obstacles** — towers are added
as `TileCache` obstacles (Phase 3) with no full rebuild.

- Input geometry: for each walkable tile (same predicate as `PhysicsWorld.isWalkable`),
  emit two triangles on the z=0 plane (4 verts, 2 tris) in world space
   (`tileToWorld`). Build with `generateTileCache(positions, indices, config)` imported
   from **`recast-navigation/generators`** (the top-level `recast-navigation` does
   **not** re-export the generators). It returns `{ tileCache, navMesh, success,
   intermediates }` in one call. **Check `success` before use** — the union's failure
   branch returns `tileCache: undefined`/`navMesh: undefined`, so TS requires the guard.
   (Verified in v0.43.1 types: `TileCache` exposes `addCylinderObstacle`/`addBoxObstacle`/
   `removeObstacle` + `update(navMesh)`; there is **no** `addObstacle` method — see Phase 3.)
   The `positions`/`indices` are flat arrays; `config` is `TileCacheGeneratorConfig` —
   a **required** `expectedLayersPerTile` (use `1` for a flat 2D map) plus `cs`/`ch` cell
   size, `walkableRadius` agent clearance, `maxObstacles`, `bounds`, …. All input/output
   positions are `Vector3` with `z = 0` (the game is 2D on the z=0 plane).
- Config tuning (the riskiest tuning, esp. for 1-wide corridors): `cellSize` /
  `cellHeight` relative to `tileSize`; **`walkableRadius` set to the smallest enemy
  radius** (runner `0.05*tileSize`) so a 1-wide corridor stays navigable; larger
  enemies just collide more with Rapier walls. `agentHeight`/`maxEdgeLen` nominal.
  Validate: a packed stream through a serpentine 1-wide map must produce a connected
  navmesh with a path spawn→base.
- Open areas: Recast builds a natural navmesh over arbitrary walkable polygons — no
  special casing; this is where the "more options" payoff lands (enemies take
  organic paths and avoid each other).
- Expose `navMesh`, `tileCache`, and a `findPath(startWorld, goalWorld): Vec2[]` helper
   (Detour polyline of corridor points) for snapshot path-highlight + commander viz.
   `findPath` is **not** a single call: it must `navMeshQuery.findNearestPoly(start)` →
   `findNearestPoly(goal)` to get poly refs, then `navMeshQuery.findPath(startRef,
   endRef, startPos, endPos)`, then extract the corridor via `agentCorners`/`getPath`. A
   `NavMeshQuery` is available as `crowd.navMeshQuery` (or construct one). All args are
   `Vector3` (`z = 0`).
- Build once in `GameEngine` ctor (when `RECAST_NAV`), rebuild only on new map. The
   `Crowd` (Phase 2) is constructed from this `navMesh`; the `tileCache` is what
   `Phase 3` mutates for towers (the `NavMesh` it holds is rebuilt in place by
   `tileCache.addCylinderObstacle`/`removeObstacle` + `tileCache.update(navMesh)`).

## Phase 2 — `CrowdManager` + enemy movement split (`src/sim/navmesh/CrowdManager.ts`)

Wraps one `Crowd` derived from the `NavMesh`.
- **Spawn:** `EnemyManager.spawn` calls `const agent = crowd.addAgent(worldPos, { radius:
  enemy.radius, maxSpeed: enemy.speed * tileSize, ... })` — `addAgent` **returns** a
  `CrowdAgent` object (not an index), store it on `enemy.agent` (null-safe when flag
  OFF). `removeDeadEnemy` calls `crowd.removeAgent(enemy.agent)`. All agent/move-target
  positions are `Vector3` (`z = 0`).
- **Default target:** on spawn, `enemy.agent.requestMoveTarget(baseWorld)` (instance
  method on the `CrowdAgent`, returns `boolean` — not `crowd.agentRequestMoveTarget`).
- **Loop (in `GameEngine.update`):** `crowd.update(FIXED_DT)` → for each live enemy read
  the agent's desired velocity via `enemy.agent.velocity()` (a **method**, returns
  `Vector3`) and set Rapier `body.setLinvel(velocity, true)` (zero velocity when
  `stunTimer>0` or `attackingBase`/held) → `physicsWorld.step()` → read
  `body.translation()` into `enemy.x/y/centerX/centerY`; `moveAngle = atan2(linvel)`
  with low-speed guard.
- **Split `Enemy.update`** into `computeIntent` + `postPhysics` (as the Rapier plan
  did), branching on `RECAST_NAV`:
  - **OFF:** current tile-following + lane-offset + `contactLineSteer` (byte-identical
    to today, so existing specs stay green).
  - **ON:** `computeIntent` sets gameplay flags (status timers, slow/stun, base-contact
    `attackingBase`, hold/route mode) but **no position integration** — movement is
    Crowd-driven. `postPhysics` reads the stepped body; runs attack tick + cull; sets
    `attackingBase`/`attackTarget` via proximity to base/tower (Crowd keeps the agent
    near, Rapier/walls stop it). The manual `resolveCollisions`, `laneOffset`,
    `findLateralOpenSpot`, `findLeastBlockedLateral`, `contactLineSteer` geometry, and
    `reanchorToPath` become dead under ON.
- **Slow/stun/knockback/hold/route** re-expressed (all via the `enemy.agent`
  `CrowdAgent` instance): `slowFactor` → `agent.updateParameters({ maxSpeed })`; stun →
  `setLinvel(0)` + `agent.resetMoveTarget()` to park (or `agent.requestMoveTarget` to its
  current `agent.position()`); `applyKnockback` → `agent.teleport(targetWorld)` +
  Rapier `body.setTranslation` (path-clamped, deterministic) so the body and agent stay
  aligned; hold → `agent.requestMoveTarget(holdWorld)` then zero speed; route →
  `agent.requestMoveTarget(waypointWorld)` per waypoint (Detour paths between waypoints
  automatically, avoiding tower obstacles); release → `agent.requestMoveTarget(baseWorld)`.

## Phase 3 — Towers baked into the navmesh + reachability

- **Towers are `TileCache` obstacles (the maze tactic), not navmesh rebuilds.** The
  navmesh is **tiled** from Phase 1, so `tileCache.addCylinderObstacle(position,
  radius, height)` (or `addBoxObstacle`) adds a tower cylinder and
  `tileCache.removeObstacle(ref)` removes it. **Critical:** adding/removing an obstacle
  only *queues* a request — you must call `tileCache.update(navMesh)` to actually
  rebuild the affected tiles in place. `tileCache.update` processes up to 64 tiles per
  call and returns `{ success, status, upToDate }`; **loop `update(navMesh)` until
  `upToDate` is true** (otherwise a burst of tower placements silently stops being
  applied). The `NavMesh` the `Crowd` holds is then rebuilt in place, so agents re-path
  automatically with no full-navmesh rebuild. (This supersedes the earlier
  solo-navmesh-rebuild fallback now that tiled+TileCache is confirmed available — see the
  corrected Risks note below.) `PhysicsWorld.rebuildTowers` still adds the Rapier
  collider; both run on the same `navVersion` bump.
- **Alternative library evaluated — `navcat` (v0.4.1, pure TS):** investigated
  2026-07-15. It is a pure-TS reimplementation of Recast/Detour (same crowd /
  obstacle-avoidance internals) and needs **no WASM init**. However its `NavMesh`
  wrapper **also lacks `addObstacle`/`removeObstacle`** (same navmesh-carve gap), and
  its `addCircleObstacle` is only *local steering* avoidance, not path carving — so
  it does **not** resolve the maze-building limitation. Its only edge is dropping the
  WASM dependency, which is minor given Rapier already WASM-gates. **Not adopted**;
  recast-navigation (tiled navmesh + TileCache) remains the choice.
- Replace `canPlaceWithoutBlocking` with a Detour reachability check: before committing
  the placement, confirm a `NavMeshQuery.findPath` spawn→base still exists on the proposed
  geometry; if not, reject placement (maze can never fully wall off the base). **Do not
  mutate the live navmesh to test this** — adding the obstacle then `tileCache.update` would
  commit it. Instead either (a) test on a temporary cloned `NavMesh`/`TileCache`, or
  (b) add the cylinder → `tileCache.update(navMesh)` → `findPath`; if unreachable,
  `removeObstacle(ref)` → `tileCache.update(navMesh)` to roll back, then reject. The
  `findPath` helper from Phase 1 already wraps the `findNearestPoly`→`findPath`→corner
  extraction, so reuse it here.
- Bump `pathVersion`/`navVersion` on obstacle change to gate the Rapier tower-collider
  rebuild + snapshot highlight refresh (reuse existing `GameEngine` handling).

## Phase 4 — Base attack (proximity)

- `attackingBase`: set when the post-step body is within `radius + epsilon` of the
  base square (Crowd targets the base; Rapier base collider stops the agent at the
  face). Stop requesting further move; run the existing attack tick (damage base).
- Tower attack becomes an **optional edge case**: if an agent ends up adjacent to /
  contacting a live tower (e.g. maze forces it alongside, or avoidance fails in a
  dead-end), the existing `findAdjacentLiveTowerInContact` + proximity can mark
  `blockedByTower` and trigger an attack. Primary tower interaction is *avoidance*
  (enemies route around), which is the new tactic. `grid.blocked` and
  `findAdjacentLiveTowerInContact` usage is revisited here — keep only what the
  proximity/contact model needs.

## Phase 5 — Commander routing (`llm:routeGroup`)

- `applyRoute` / `releaseToDefault` / `reanchorToPath` / `computeSurroundRoute` are
  deleted. `applyCommand` `llm:routeGroup` → `enemy.agent.requestMoveTarget(waypointWorld)`
  for each routed enemy (waypoints = the commander-supplied tiles, converted to world
  `Vector3` with `z = 0`; Detour paths between them automatically, avoiding tower
  obstacles). `hold` → `enemy.agent.requestMoveTarget(holdWorld)` then zero speed (park);
  `releaseToDefault` → `enemy.agent.requestMoveTarget(baseWorld)`. Routing mode flags
  (`hold`/`route`/`default`) stay as the gameplay state the commanders toggle.
- Brains (stubby/stubbs/llm) keep producing **target tiles**; they no longer need to
  compute full routes around towers — Detour does that. `computeSurroundRoute` is
  removed; any brain helper that used it is simplified to "pick a target tile."

## Phase 6 — Snapshot / renderer path highlight

- `enemy.x/y` unchanged (read from body) — render managers untouched.
- Replace `grid.paths`/`pathsVersion` shipping: ship the `NavMesh` walkable corridor
  (once per run) for the static minimap highlight + optionally each enemy's current
  Detour path polyline for live routing viz. `TextPathRenderer` consumes the corridor
  instead of per-spawn BFS paths. Gate shipment on `navVersion` like today.

## Phase 7 — Delete BFS pathfinding & old motion (at flip)

- Delete `src/sim/grid/Pathfinding.ts` (`bfsShortestPath`, `dijkstraWeakestPath`,
  `canPlaceWithoutBlocking`), and from `Grid.ts` remove `paths`, `getPathFor`,
  `recomputePaths`, `recomputePathsForTile`, `computeSurroundRoute` (keep `isPath`/
  `isBase`/`isSpawn` + walkable predicate for navmesh build + tower placement).
- Delete the OFF branch of `Enemy.computeIntent`/`postPhysics`, `resolveCollisions`,
  `laneOffset*`, `findLateralOpenSpot`, `findLeastBlockedLateral`, `contactLineSteer`,
  `reanchorToPath` (ON path). Remove `enemy.path`/`pathIdx` tile-following fields.
- Retire position-exact unit specs (`enemy-routing`, `enemies`, `enemy-attack`) that
  assert closed-form trajectories; replace with behavioral specs (enemies reach base,
  avoid each other in open areas, route around tower obstacles, maze never fully
  blocks, commander waypoints honored, hold/route/knockback behave).

## Acceptance criteria at flip

1. Enemies traverse spawn→base on every map style (1-wide corridors **and** open
   areas) and reach/attack the base.
2. Enemy-enemy avoidance holds (no overlap / no two-solver jitter) — owned by Crowd.
3. Towers block: enemies route *around* a placed tower (maze); placement that would
   fully wall off the base is rejected (Detour reachability).
4. Corridor containment holds (no enemy leaves the walkable area) — Rapier walls +
   navmesh confinement.
5. Commander `llm:routeGroup` (hold/route/release) still steers enemies to target
   tiles, now pathing around obstacles automatically.
6. Behavioral integration suite (`integration.test.ts`, `worker-roundtrip.test.ts`,
   `commander.test.ts`) green under `RECAST_NAV`; position-exact specs retired.

## Files

New:
- `src/sim/navmesh/recastContext.ts` (WASM init + `getRecast`)
- `src/sim/navmesh/NavMeshBuilder.ts` (walkable-tile → `NavMesh` + `findPath`)
- `src/sim/navmesh/CrowdManager.ts` (agent lifecycle + `crowd.update` driving)
- `tests/unit/sim/navmesh/navmesh-build.test.ts` (corridor connectivity, open-area
  build, agentRadius tuning gate)
- `tests/unit/sim/navmesh/crowd-avoid.test.ts` (enemy-enemy avoidance, no overlap)
- `tests/integration/navmesh-motion.test.ts` (reach base, route around tower
  obstacle, maze reachability reject, commander waypoints)

Modify:
- `package.json` (add `recast-navigation`; no new dev plugins)
- `src/sim/featureFlags.ts` (add `RECAST_NAV`)
- `src/sim/WorkerEntry.ts` (async `init` awaiting both inits)
- `src/sim/GameEngine.ts` (own `NavMeshBuilder` + `CrowdManager`; orchestrate
  `crowd.update` → setLinvel → `physicsWorld.step` → readback; obstacle rebuild on
  `navVersion`; remove `Pathfinding` usage)
- `src/sim/grid/Grid.ts` (drop `paths`/`getPathFor`/`recomputePaths`/
  `recomputePathsForTile`/`computeSurroundRoute`; keep walkable predicate + tower
  placement helpers)
- `src/sim/grid/Pathfinding.ts` (delete at flip)
- `src/sim/enemies/Enemy.ts` (add `agent`; split `update` → `computeIntent` +
  `postPhysics` with OFF/ON branches; delete tile-following/lane-offset/contact-line
  code under ON; `applyKnockback` via agent teleport; proximity-based attack flags)
- `src/sim/enemies/EnemyManager.ts` (spawn/remove create/destroy Crowd agents;
  `forEachEnemyInRange`/`queryEnemiesInRange` still delegate to PhysicsWorld for
  gameplay queries)
- `src/sim/physics/PhysicsWorld.ts` (enemy bodies in a collision group that excludes
  enemy-enemy; tower colliders rebuilt on `navVersion`; keep base/corridor walls)
- `src/sim/applyCommand.ts` (`llm:routeGroup` → Crowd move target)
- `src/sim/Command.ts` / `src/commanders/*` (brains issue target tiles; drop
  `computeSurroundRoute` usage)
- `src/sim/SnapshotSerializer.ts` (ship navmesh corridor + per-enemy Detour path
  instead of `grid.paths`)
- `src/render/text/TextPathRenderer.ts` (consume navmesh corridor)
- `tests/setup.ts` (await both WASM inits)

## Why this fits

The sim already runs entirely in the worker (ideal for a second WASM step),
`GameEngine` already owns all managers + a fixed timestep, and the
snapshot/command "spine" + render managers consume only `enemy.x/y` — so swapping
the motion/pathing source touches `GameEngine` + `Enemy` + `Grid`/`Pathfinding` and
adds a navmesh module, with **zero** renderer changes. Rapier's existing WASM-init
and worker patterns are reused verbatim for `recast-navigation`. DetourCrowd gives
us the long-asked-for "enemies move around each other" plus open-area pathing and
tower-obstacle maze tactics without us hand-writing any of it — exactly the
"more options, have fun" goal.

## Risks / open questions (verify early)

- **`recast-navigation` v0.43 API — VERIFIED** (renamed from `recast-navigation-js`;
  already installed at `^0.43.1`). `init()` is a top-level async export; `NavMesh`/`Crowd`/
  `Recast`/`Detour`/`NavMeshQuery` are top-level named exports (re-exported from
  `@recast-navigation/core`); `generateSoloNavMesh`/`generateTileCache` come from the
  `recast-navigation/generators` subpath; the WASM loads under jsdom with no Vite wasm
  plugin (compat build). **Dynamic obstacles ARE available** via the tiled `TileCache`:
  `addCylinderObstacle`/`addBoxObstacle`/`removeObstacle` + a required `tileCache.update(navMesh)`
  call (loop until `upToDate`). The `NavMesh` wrapper itself has no `addObstacle`/
  `removeObstacle` — that is exactly why Phase 1 builds a **tiled** navmesh + `TileCache`
  rather than a solo navmesh (which would force a full rebuild per tower change). The
  earlier "rebuild the solo navmesh" fallback is therefore superseded; `navcat` (evaluated
  in Phase 3) also lacks navmesh carving and is **not** adopted.
- **1-wide corridor navmesh tuning:** `agentRadius`/`cellSize` must keep a 1-tile
  corridor navigable; validate in `navmesh-build.test.ts` before broad integration.
- **Two-solver conflict:** mitigating enemy-enemy via collision groups (Crowd owns
  avoidance) must be confirmed not to let fast enemies tunnel through slow ones in a
  tight corridor — the avoidance + Rapier wall combo is the guard.
- **Behavior change acceptance:** tower-as-obstacle (avoid, not attack-through) is a
  deliberate departure; confirm it reads as a feature, not a regression, in playtest.
- **If DetourCrowd is a poor fit:** pivot to `navcat` (pure TS, no WASM) rather than
   rebuilding all of this — the module boundaries (NavMeshBuilder/CrowdManager behind
   `RECAST_NAV`) keep that swap localized.

## Status — COMPLETE (all phases 0–7)

- `RECAST_NAV = true` in `src/sim/featureFlags.ts`. The old BFS `Pathfinding.ts` is
  deleted; `Grid.ts` retains only `isPath`/`isBase`/`isSpawn` + walkable predicate +
  tower-placement helpers + `pathVersion` (no `paths`/`getPathFor`/`recomputePaths`/
  `recomputePathsForTile`/`computeSurroundRoute`). `Enemy.path`/`pathIdx` are gone;
  `computeIntent`/`postPhysics` are the canonical (ON) methods. `SimulationSnapshot`
  ships `navMeshCorridor` (the `paths`/`pathsVersion` fields were removed);
  `TextPathRenderer` consumes the corridor only; `SvgGameRoot.vue` path-highlight block
  removed.
- Test suite is fully green under `RECAST_NAV`:
  - `npx tsc --noEmit` → zero errors.
  - `npx vitest run` → **1084 passing** (70 files).
  - `navmesh-build`, `crowd-motion`, `tower-obstacle`, `base-attack`, `commander-route`,
    `corridor-geometry` cover the new navmesh/crowd/routing behavior.
  - Deleted `tests/unit/pathfinding.test.ts` and `tests/unit/sim/enemy-routing.test.ts`
    (old BFS/perimeter model). Retired/rewrote position-exact specs in `enemies.test.ts`,
    `enemy-manager.test.ts`, `grid.test.ts`, `map.test.ts`, `applyCommand.test.ts`,
    `physics-world.test.ts`, `pre-step-queries.test.ts`, `towers.test.ts` (selectTarget now
    orders by distance-to-base, not `pathIdx`), `enemy-physics.test.ts`, `game-engine.test.ts`,
    `enemy-perimeter.test.ts`, `text-render.test.ts`, `integration/commander.test.ts`,
    `integration/physics-motion.test.ts`. Movement tests drive a real `CrowdManager`
    (`initNavMesh` + `NavMeshBuilder` + `addAgent` + `crowd.update` per tick).
- A shared test helper `tests/helpers/navmesh-test-utils.ts` `orderedPath(grid, spawnIndex)`
  provides an ordered walkable-tile list (BFS over `isPath`/`isBase`/`isSpawn`) for tests
  that previously used `getPathFor`; the start node is marked `visited` to avoid a
  reconstruction 2-cycle (a synchronous infinite loop that previously hung the suite).
- No remaining references to `getPathFor`/`recomputePaths`/`computeRoute`/`computeSurroundRoute`/
  `canPlaceWithoutBlocking`/`bfsShortestPath`/`dijkstraWeakestPath`/`reanchorToPath`/
  `contactLineSteer`/`findLateralOpenSpot`/`postPhysicsNavMesh`/`computeIntentNavMesh`/
  `preStepNavMesh`/`postStepNavMesh`/`enemy.pathIdx`/`enemy.path` anywhere in `src/` or `tests/`.
