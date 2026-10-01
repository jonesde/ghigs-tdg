import type { EnemyVisualMeta, MapThemeData } from "@/render/themes/index.js";
import { GAMEPLAY_ENEMY_CAP, MAX_PENDING_PER_SPAWN } from "@/sim/Constants.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import type { BlockedApproach } from "@/sim/navmesh/NavDistanceField.js";
import type { ParticleSpawner } from "@/sim/ParticleSystem.js";
import type { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import type { SpawnOrderView } from "@/sim/SimulationSnapshot.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import type { AttackTarget } from "./Enemy.js";
import { Enemy, resetEnemyId } from "./Enemy.js";

interface PendingEnemyEntry {
  type: string;
  level: number;
  wave: number;
}

// One emerge order. Null fields mean that part of the order is unset.
// holdTile null with hold parks on the emerging unit's own spawn tile.
export interface SpawnOrder {
  hold: boolean;
  holdTile: { x: number; y: number } | null;
  waypoints: { x: number; y: number }[] | null;
  targetingMode: string | null;
  towerTile: { x: number; y: number } | null;
}

export class EnemyManager {
  grid: Grid;
  particles: ParticleSpawner;
  enemies: Enemy[];
  difficultyTick: number;
  theme: MapThemeData | null;
  defaultEnemyVisuals: Record<string, EnemyVisualMeta>;
  towerManager: TowerManager | null = null;
  baseTarget: AttackTarget | null = null;
  physicsWorld: PhysicsWorld | null = null;
  crowdManager: CrowdManager | null = null;
  private blockedApproachLookup: ((tileX: number, tileY: number) => BlockedApproach | null) | null = null;
  private distanceToBaseLookup: ((tileX: number, tileY: number) => number) | null = null;
  private flightDistanceLookup: ((tileX: number, tileY: number, flyingHeight: number) => number) | null = null;
  // Cross-module: GameEngine wires this to the ProjectileManager so burn ticks
  // (applied inside Enemy.updateStatusTimers) credit the inflicting tower's
  // totalDamageDealt/waveDamage like direct hits do.
  private damageCreditSink: ((towerId: string, amount: number) => void) | null = null;
  private idToEnemy: Map<number, Enemy>;
  private pendingQueues: Map<number, PendingEnemyEntry[]>;
  // Overflow evictions since run start. Bounded queues must stay lossless-visible:
  // the counter lets tests and the snapshot tell "merged away" apart from "never emitted".
  private pendingOverflowDropped: number = 0;
  // Once-per-tick live-tower list. Revalidated on every read by grid.pathVersion
  // (covers every tower-membership change, terrain build/sell included), tower
  // count, and a ghost/health scan, so a mid-tick death or ghost restore is never
  // served stale.
  private cachedLiveTowers: Tower[] | null = null;
  private cachedTowerCount: number = -1;
  private cachedPathVersion: number = -1;
  // Per-spawn live counts, rebuilt lazily. Spawn/death are the only writers of
  // spawnIndex membership, so invalidating on those two paths is exact.
  private cachedSpawnCounts: Map<number, number> = new Map();
  private spawnCountsDirty: boolean = true;
  private defaultSpawnOrder: SpawnOrder | null = null;
  private spawnOrdersByIndex = new Map<number, SpawnOrder>();

  constructor(
    grid: Grid,
    particles: ParticleSpawner,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
    defaultEnemyVisuals: Record<string, EnemyVisualMeta> = {},
  ) {
    this.grid = grid;
    this.particles = particles;
    this.enemies = [];
    this.difficultyTick = difficultyTick;
    this.theme = theme;
    this.defaultEnemyVisuals = defaultEnemyVisuals;
    this.idToEnemy = new Map();
    this.pendingQueues = new Map();
  }

  // Phase 1.5 plumbing: lets enemies resolve the tower (if any) on a tile. The
  // Engine wires the live TowerManager here after both managers are constructed.
  setTowerManager(towerManager: TowerManager | null): void {
    this.towerManager = towerManager;
    this.cachedLiveTowers = null;
    this.cachedPathVersion = -1;
  }

  // Wires the Rapier physics world (unconditionally). Enemies spawned
  // after this point get a backing rigid body; null clears the link.
  setPhysicsWorld(physicsWorld: PhysicsWorld | null): void {
    this.physicsWorld = physicsWorld;
  }

  // Wires the DetourCrowd wrapper. Enemies spawned after this get a crowd agent.
  setCrowdManager(crowdManager: CrowdManager | null): void {
    this.crowdManager = crowdManager;
  }

  // Tile-graph face of the wall between an unreachable tile and the base.
  // GameEngine wires this from NavDistanceField; null leaves default routing on the base.
  setBlockedApproachLookup(lookup: ((tileX: number, tileY: number) => BlockedApproach | null) | null): void {
    this.blockedApproachLookup = lookup;
  }

  blockedApproach(tileX: number, tileY: number): BlockedApproach | null {
    return this.blockedApproachLookup?.(tileX, tileY) ?? null;
  }

  setDistanceToBaseLookup(lookup: ((tileX: number, tileY: number) => number) | null): void {
    this.distanceToBaseLookup = lookup;
  }

  distanceToBase(tileX: number, tileY: number): number {
    return this.distanceToBaseLookup?.(tileX, tileY) ?? -1;
  }

  setFlightDistanceLookup(lookup: ((tileX: number, tileY: number, flyingHeight: number) => number) | null): void {
    this.flightDistanceLookup = lookup;
  }

  flightDistanceToBase(tileX: number, tileY: number, flyingHeight: number): number {
    return this.flightDistanceLookup?.(tileX, tileY, flyingHeight) ?? -1;
  }

  setDamageCreditSink(sink: ((towerId: string, amount: number) => void) | null): void {
    this.damageCreditSink = sink;
  }

  creditDamage(towerId: string, amount: number): void {
    if (!(amount > 0)) return;
    this.damageCreditSink?.(towerId, amount);
  }

  liveTowers(): Tower[] {
    if (!this.towerManager) return [];
    const towers = this.towerManager.towers;
    const cached = this.cachedLiveTowers;
    // Revalidate without allocating: a build/sell (pathVersion + length change),
    // a ghost/restore (pathVersion), or a mid-tick death (scan) invalidates the
    // cache on the spot, so callers keep the exact semantics of the old
    // recompute-every-call version.
    if (cached && this.cachedTowerCount === towers.length && this.cachedPathVersion === this.grid.pathVersion) {
      let stale = false;
      for (const tower of cached) {
        if (tower.isGhost || tower.health <= 0) {
          stale = true;
          break;
        }
      }
      if (!stale) return cached;
    }
    const live: Tower[] = [];
    for (const tower of towers) {
      if (!tower.isGhost && tower.health > 0) live.push(tower);
    }
    this.cachedLiveTowers = live;
    this.cachedTowerCount = towers.length;
    this.cachedPathVersion = this.grid.pathVersion;
    return live;
  }

  towerAt(tileX: number, tileY: number): Tower | null {
    return this.towerManager?.towerAt(tileX, tileY) ?? null;
  }

  // Remaps pending queues, spawn orders, and live enemy.spawnIndex after a
  // progressive placement moves spawn ids. Dropped ids land on the surviving
  // previous index with the smallest pending count (ties: smallest index).
  // A surviving spawn keeps its own order when a dropped id maps onto it.
  reindexSpawns(previousSpawns: Array<{ id?: number }>, nextSpawns: Array<{ id?: number }>): void {
    const nextIndexById = new Map<number, number>();
    nextSpawns.forEach((spawn, index) => {
      if (spawn.id !== undefined) nextIndexById.set(spawn.id, index);
    });
    const survivingPreviousIndexes: number[] = [];
    previousSpawns.forEach((spawn, index) => {
      if (spawn.id !== undefined && nextIndexById.has(spawn.id)) survivingPreviousIndexes.push(index);
    });
    let destinationPrevious = survivingPreviousIndexes[0] ?? 0;
    let smallestPending = Number.POSITIVE_INFINITY;
    for (const index of survivingPreviousIndexes) {
      const pending = this.getPendingCountForSpawn(index);
      if (pending < smallestPending || (pending === smallestPending && index < destinationPrevious)) {
        smallestPending = pending;
        destinationPrevious = index;
      }
    }
    const destinationSpawn = previousSpawns[destinationPrevious];
    const destinationNext =
      destinationSpawn?.id !== undefined && nextIndexById.has(destinationSpawn.id)
        ? nextIndexById.get(destinationSpawn.id)!
        : 0;
    const oldIndexToNewIndex = new Map<number, number>();
    previousSpawns.forEach((spawn, index) => {
      if (spawn.id !== undefined && nextIndexById.has(spawn.id)) {
        oldIndexToNewIndex.set(index, nextIndexById.get(spawn.id)!);
      } else {
        oldIndexToNewIndex.set(index, destinationNext);
      }
    });
    const nextQueues = new Map<number, PendingEnemyEntry[]>();
    for (const [oldIndex, queue] of this.pendingQueues) {
      const nextIndex = oldIndexToNewIndex.get(oldIndex) ?? destinationNext;
      const existing = nextQueues.get(nextIndex);
      if (existing) existing.push(...queue);
      else nextQueues.set(nextIndex, queue.slice());
    }
    this.pendingQueues = nextQueues;
    const nextOrders = new Map<number, SpawnOrder>();
    for (const [oldIndex, order] of this.spawnOrdersByIndex) {
      const spawn = previousSpawns[oldIndex];
      if (spawn?.id === undefined || !nextIndexById.has(spawn.id)) continue;
      nextOrders.set(nextIndexById.get(spawn.id)!, order);
    }
    for (const [oldIndex, order] of this.spawnOrdersByIndex) {
      const spawn = previousSpawns[oldIndex];
      if (spawn?.id !== undefined && nextIndexById.has(spawn.id)) continue;
      const nextIndex = oldIndexToNewIndex.get(oldIndex) ?? destinationNext;
      if (!nextOrders.has(nextIndex)) nextOrders.set(nextIndex, order);
    }
    this.spawnOrdersByIndex = nextOrders;
    for (const enemy of this.enemies) {
      const nextIndex = oldIndexToNewIndex.get(enemy.spawnIndex);
      if (nextIndex !== undefined) enemy.spawnIndex = nextIndex;
    }
    this.spawnCountsDirty = true;
  }

  // Tile indices stored on routes and standing orders move with the grid. World
  // positions (enemy.x/y, holdWorld) stay where they are.
  shiftLayoutIndices(shiftX: number, shiftY: number): void {
    if (shiftX === 0 && shiftY === 0) return;
    const shiftTile = (tile: { x: number; y: number }) => {
      tile.x += shiftX;
      tile.y += shiftY;
    };
    for (const enemy of this.enemies) {
      for (const tile of enemy.routeTiles) shiftTile(tile);
    }
    const shiftOrder = (order: SpawnOrder) => {
      if (order.holdTile) shiftTile(order.holdTile);
      if (order.waypoints) {
        for (const tile of order.waypoints) shiftTile(tile);
      }
      if (order.towerTile) shiftTile(order.towerTile);
    };
    if (this.defaultSpawnOrder) shiftOrder(this.defaultSpawnOrder);
    for (const order of this.spawnOrdersByIndex.values()) shiftOrder(order);
  }

  clear(): void {
    for (const enemy of this.enemies) {
      this.crowdManager?.removeAgent(enemy);
      this.physicsWorld?.removeEnemy(enemy);
    }
    this.enemies = [];
    this.idToEnemy.clear();
    this.pendingQueues.clear();
    // pendingOverflowDropped is deliberately NOT reset here: it is per-run
    // telemetry, and clear() runs on endGame and debug killAll. A fresh
    // EnemyManager is constructed per map load in GameEngine._initMap, which is
    // where the per-run reset happens.
    this.cachedLiveTowers = null;
    this.cachedTowerCount = -1;
    this.cachedPathVersion = -1;
    this.cachedSpawnCounts.clear();
    this.spawnCountsDirty = true;
    this.defaultSpawnOrder = null;
    this.spawnOrdersByIndex.clear();
    resetEnemyId();
  }

  setSpawnOrder(spawnIndex: number | undefined, order: SpawnOrder): void {
    if (spawnIndex === undefined) this.defaultSpawnOrder = order;
    else this.spawnOrdersByIndex.set(spawnIndex, order);
  }

  // Omitted spawnIndex drops the default and every per-spawn slot.
  clearSpawnOrders(spawnIndex?: number): void {
    if (spawnIndex === undefined) {
      this.defaultSpawnOrder = null;
      this.spawnOrdersByIndex.clear();
      return;
    }
    this.spawnOrdersByIndex.delete(spawnIndex);
  }

  listSpawnOrders(): SpawnOrderView[] {
    const views: SpawnOrderView[] = [];
    if (this.defaultSpawnOrder) views.push(this.viewSpawnOrder(this.defaultSpawnOrder));
    for (const [spawnIndex, order] of this.spawnOrdersByIndex) {
      views.push(this.viewSpawnOrder(order, spawnIndex));
    }
    return views;
  }

  private viewSpawnOrder(order: SpawnOrder, spawnIndex?: number): SpawnOrderView {
    const view: SpawnOrderView = {};
    if (spawnIndex !== undefined) view.spawnIndex = spawnIndex;
    if (order.hold) {
      view.hold = true;
      if (order.holdTile) view.holdTile = { x: order.holdTile.x, y: order.holdTile.y };
    }
    if (order.waypoints) view.waypoints = order.waypoints.map((tile) => ({ x: tile.x, y: tile.y }));
    if (order.targetingMode) view.targetingMode = order.targetingMode;
    if (order.towerTile) view.towerTile = { x: order.towerTile.x, y: order.towerTile.y };
    return view;
  }

  // Ground applyRoute writes the crowd target, so the agent has to exist first.
  // Flyers have no agent; their polyline is planned from the same order.
  private applySpawnOrder(enemy: Enemy): void {
    const order = this.spawnOrdersByIndex.get(enemy.spawnIndex) ?? this.defaultSpawnOrder;
    if (!order) return;
    if (order.targetingMode) enemy.targetingMode = order.targetingMode;
    if (order.towerTile) {
      const tower = this.towerAt(order.towerTile.x, order.towerTile.y);
      if (tower && !tower.isGhost) {
        enemy.applySiege(tower);
        enemy.targetingMode = null;
      }
      return;
    }
    if (order.hold) {
      const holdTile = order.holdTile ?? this.grid.spawns[enemy.spawnIndex];
      if (holdTile) enemy.applyRoute([holdTile], "hold");
      return;
    }
    if (order.waypoints) {
      if (order.waypoints.length === 0) enemy.releaseToDefault();
      else enemy.applyRoute([...order.waypoints, this.grid.base], "route");
    }
  }

  spawn(type: string, level: number, spawnIndex: number, wave: number): Enemy | null {
    const enemy = new Enemy(
      type,
      level,
      spawnIndex,
      this.grid,
      wave,
      this.difficultyTick,
      this.theme,
      this.defaultEnemyVisuals[type] ?? null,
      this.baseTarget,
    );
    this.enemies.push(enemy);
    this.idToEnemy.set(enemy.id, enemy);
    this.physicsWorld?.addEnemy(enemy);
    // Flying enemies steer by linvel along a height polyline. A crowd agent would
    // pull them back onto the path navmesh.
    if (this.crowdManager && enemy.flyingHeight <= 0) {
      this.crowdManager.addAgent(enemy);
      this.crowdManager.setBaseTarget(enemy, this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y));
    }
    enemy.towerAt = (tileX, tileY) => this.towerAt(tileX, tileY) ?? null;
    enemy.liveTowerAt = (tileX, tileY) => {
      const tower = this.towerAt(tileX, tileY);
      return tower !== null && !tower.isGhost;
    };
    this.applySpawnOrder(enemy);
    this.spawnCountsDirty = true;
    return enemy;
  }

  enqueueOrSpawn(type: string, level: number, spawnIndex: number, wave: number): void {
    if (this.enemies.length < GAMEPLAY_ENEMY_CAP) {
      this.spawn(type, level, spawnIndex, wave);
      return;
    }
    this.enqueuePending(type, level, spawnIndex, wave);
  }

  // Bounded-queue policy: spill to the least-pending spawn first (merges the
  // oldest backlogs across spawn points instead of growing one queue without
  // bound), and only when every queue is full evict the oldest lowest-level
  // non-boss entry — bosses are never merged away. Evictions are counted, never silent.
  private enqueuePending(type: string, level: number, spawnIndex: number, wave: number): void {
    let targetIndex = spawnIndex;
    const targetQueue = this.pendingQueues.get(spawnIndex);
    if (targetQueue && targetQueue.length >= MAX_PENDING_PER_SPAWN) {
      targetIndex = this.findLeastPendingSpawn(spawnIndex);
    }
    let queue = this.pendingQueues.get(targetIndex);
    if (!queue) {
      queue = [];
      this.pendingQueues.set(targetIndex, queue);
    }
    if (queue.length >= MAX_PENDING_PER_SPAWN) {
      if (!this.evictOverflowEntry(targetIndex)) {
        this.pendingOverflowDropped++;
        return;
      }
    }
    queue.push({ type, level, wave });
  }

  private findLeastPendingSpawn(preferredIndex: number): number {
    let bestIndex = preferredIndex;
    let bestCount = this.getPendingCountForSpawn(preferredIndex);
    for (const [spawnIndex, queue] of this.pendingQueues) {
      if (queue.length < bestCount) {
        bestCount = queue.length;
        bestIndex = spawnIndex;
      }
    }
    return bestIndex;
  }

  private evictOverflowEntry(spawnIndex: number): boolean {
    const queue = this.pendingQueues.get(spawnIndex);
    if (!queue || queue.length === 0) return true;
    let evictPosition = -1;
    let evictLevel = Infinity;
    for (let position = 0; position < queue.length; position++) {
      const entry = queue[position]!;
      if (entry.type === "boss") continue;
      if (entry.level < evictLevel) {
        evictLevel = entry.level;
        evictPosition = position;
      }
    }
    if (evictPosition < 0) return false;
    queue.splice(evictPosition, 1);
    this.pendingOverflowDropped++;
    return true;
  }

  releaseOnePending(spawnIndex: number): void {
    const queue = this.pendingQueues.get(spawnIndex);
    if (!queue || queue.length === 0) return;
    if (this.enemies.length >= GAMEPLAY_ENEMY_CAP) return;
    const entry = queue.shift()!;
    this.spawn(entry.type, entry.level, spawnIndex, entry.wave);
  }

  // Per-tick drain: releases backlog whenever the live count is under the cap,
  // most-backlogged spawn first. The old death-only release let immortal
  // base-attackers pin the queue forever (nothing ever died on their spawn);
  // GameEngine.update calls this every tick so the queue always makes progress.
  drainPendingQueues(): void {
    while (this.enemies.length < GAMEPLAY_ENEMY_CAP) {
      let bestIndex = -1;
      let bestCount = 0;
      for (const [spawnIndex, queue] of this.pendingQueues) {
        if (queue.length > bestCount) {
          bestCount = queue.length;
          bestIndex = spawnIndex;
        }
      }
      if (bestIndex < 0) return;
      const queue = this.pendingQueues.get(bestIndex)!;
      const entry = queue.shift()!;
      this.spawn(entry.type, entry.level, bestIndex, entry.wave);
    }
  }

  removeDeadEnemy(i: number): void {
    const enemy = this.enemies[i]!;
    this.crowdManager?.removeAgent(enemy);
    this.physicsWorld?.removeEnemy(enemy);
    this.particles.spawn(enemy.x, enemy.y, enemy.color, 12, { speed: 80, life: 0.5 });
    this.idToEnemy.delete(enemy.id);
    const removedSpawnIndex = enemy.spawnIndex;
    this.enemies.splice(i, 1);
    this.spawnCountsDirty = true;
    this.releaseOnePending(removedSpawnIndex);
  }

  hasPendingEnemies(): boolean {
    for (const queue of this.pendingQueues.values()) {
      if (queue.length > 0) return true;
    }
    return false;
  }

  getTotalPendingCount(): number {
    let total = 0;
    for (const queue of this.pendingQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  getPendingOverflowDroppedCount(): number {
    return this.pendingOverflowDropped;
  }

  getPendingCountForSpawn(spawnIndex: number): number {
    const queue = this.pendingQueues.get(spawnIndex);
    return queue ? queue.length : 0;
  }

  getActiveEnemyCountForSpawn(spawnIndex: number): number {
    if (this.spawnCountsDirty) {
      this.cachedSpawnCounts.clear();
      for (const enemy of this.enemies) {
        this.cachedSpawnCounts.set(enemy.spawnIndex, (this.cachedSpawnCounts.get(enemy.spawnIndex) ?? 0) + 1);
      }
      this.spawnCountsDirty = false;
    }
    return this.cachedSpawnCounts.get(spawnIndex) ?? 0;
  }

  // Pre-step intent pass: computeIntent per enemy, capturing preStepAttackingBase
  // so postStep can detect the attackingBase transition.
  preStep(dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      enemy.preStepAttackingBase = enemy.attackingBase;
      enemy.computeIntent(dt, this);
    }
  }

  // Post-step pass: reads back the crowd-driven body position via postPhysics,
  // handles removal (kill callback + cull), and the attackingBase transition.
  postStep(
    dt: number,
    onEnemyKill: ((enemy: Enemy) => void) | null,
    onEnemyBeginAttackBase?: ((enemy: Enemy) => void) | null,
  ): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      if (enemy.removed) {
        if (onEnemyKill) onEnemyKill(enemy);
        this.removeDeadEnemy(i);
        continue;
      }
      const wasAttackingBase = enemy.preStepAttackingBase;
      enemy.postPhysics(dt);
      if (enemy.removed) {
        if (onEnemyKill) onEnemyKill(enemy);
        this.removeDeadEnemy(i);
        continue;
      }
      if (!wasAttackingBase && enemy.attackingBase) {
        onEnemyBeginAttackBase?.(enemy);
      }
    }
  }

  forEachSensorHits(sensorId: string, callback: (enemy: Enemy) => void): boolean {
    if (!this.physicsWorld) return false;
    return this.physicsWorld.forEachSensorHits(sensorId, callback);
  }

  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void {
    if (this.physicsWorld) {
      this.physicsWorld.forEachEnemyInRange(x, y, range, cb);
      return;
    }
    const rangeSquared = range * range;
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      const deltaX = enemy.x - x;
      const deltaY = enemy.y - y;
      if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) cb(enemy);
    }
  }

  getEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    if (this.physicsWorld) return this.physicsWorld.queryEnemiesInRange(x, y, range);
    const rangeSquared = range * range;
    const result: Enemy[] = [];
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      const deltaX = enemy.x - x;
      const deltaY = enemy.y - y;
      if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) result.push(enemy);
    }
    return result;
  }

  castShapePierce(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    ballRadius: number,
    maxDistance: number,
    maxHits: number,
    cb: (enemy: Enemy) => boolean,
    groundOnly = false,
  ): void {
    if (this.physicsWorld) {
      this.physicsWorld.castShapePierce(originX, originY, dirX, dirY, ballRadius, maxDistance, maxHits, cb, groundOnly);
      return;
    }
    const length = Math.hypot(dirX, dirY) || 1;
    const unitX = dirX / length;
    const unitY = dirY / length;
    const candidates: { enemy: Enemy; projection: number }[] = [];
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      if (groundOnly && enemy.flyingHeight > 0) continue;
      const apx = enemy.x - originX;
      const apy = enemy.y - originY;
      const projection = Math.max(0, Math.min(maxDistance, apx * unitX + apy * unitY));
      const closestX = originX + unitX * projection;
      const closestY = originY + unitY * projection;
      const dist = Math.hypot(enemy.x - closestX, enemy.y - closestY);
      if (dist <= ballRadius + (enemy.radius ?? 0)) candidates.push({ enemy, projection });
    }
    candidates.sort((a, b) => a.projection - b.projection);
    let hits = 0;
    for (const candidate of candidates) {
      if (hits >= maxHits) break;
      hits++;
      const keepGoing = cb(candidate.enemy);
      if (!keepGoing) break;
    }
  }

  getEnemyById(id: number): Enemy | null {
    return this.idToEnemy.get(id) || null;
  }
}
