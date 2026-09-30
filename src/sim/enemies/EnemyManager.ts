import { ENEMY_POOL_SIZE } from "@/render/svg/types.js";
import type { EnemyVisualMeta, MapThemeData } from "@/render/themes/index.js";
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
  private idToEnemy: Map<number, Enemy>;
  private pendingQueues: Map<number, PendingEnemyEntry[]>;
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

  liveTowers(): Tower[] {
    if (!this.towerManager) return [];
    const live: Tower[] = [];
    for (const tower of this.towerManager.towers) {
      if (!tower.isGhost && tower.health > 0) live.push(tower);
    }
    return live;
  }

  towerAt(tileX: number, tileY: number): Tower | null {
    return this.towerManager?.towerAt(tileX, tileY) ?? null;
  }

  clear(): void {
    for (const enemy of this.enemies) {
      this.crowdManager?.removeAgent(enemy);
      this.physicsWorld?.removeEnemy(enemy);
    }
    this.enemies = [];
    this.idToEnemy.clear();
    this.pendingQueues.clear();
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

  // The crowd agent already exists. applyRoute no-ops its move request without one,
  // so this has to run after addAgent or the hold never reaches the crowd.
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
    if (this.crowdManager) {
      this.crowdManager.addAgent(enemy);
      this.crowdManager.setBaseTarget(enemy, this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y));
    }
    this.applySpawnOrder(enemy);
    return enemy;
  }

  enqueueOrSpawn(type: string, level: number, spawnIndex: number, wave: number): void {
    if (this.enemies.length < ENEMY_POOL_SIZE) {
      this.spawn(type, level, spawnIndex, wave);
      return;
    }
    if (!this.pendingQueues.has(spawnIndex)) {
      this.pendingQueues.set(spawnIndex, []);
    }
    this.pendingQueues.get(spawnIndex)!.push({ type, level, wave });
  }

  releaseOnePending(spawnIndex: number): void {
    const queue = this.pendingQueues.get(spawnIndex);
    if (!queue || queue.length === 0) return;
    if (this.enemies.length >= ENEMY_POOL_SIZE) return;
    const entry = queue.shift()!;
    this.spawn(entry.type, entry.level, spawnIndex, entry.wave);
  }

  removeDeadEnemy(i: number): void {
    const enemy = this.enemies[i]!;
    this.crowdManager?.removeAgent(enemy);
    this.physicsWorld?.removeEnemy(enemy);
    this.particles.spawn(enemy.x, enemy.y, enemy.color, 12, { speed: 80, life: 0.5 });
    this.idToEnemy.delete(enemy.id);
    const removedSpawnIndex = enemy.spawnIndex;
    this.enemies.splice(i, 1);
    this.releaseOnePending(removedSpawnIndex);
  }

  hasPendingEnemies(): boolean {
    for (const queue of this.pendingQueues.values()) {
      if (queue.length > 0) return true;
    }
    return false;
  }

  getPendingCountForSpawn(spawnIndex: number): number {
    const queue = this.pendingQueues.get(spawnIndex);
    return queue ? queue.length : 0;
  }

  getActiveEnemyCountForSpawn(spawnIndex: number): number {
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.spawnIndex === spawnIndex) count++;
    }
    return count;
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
    const handledEnemyIds = new Set<number>();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      if (enemy.removed) {
        if (onEnemyKill && !handledEnemyIds.has(enemy.id)) {
          onEnemyKill(enemy);
          handledEnemyIds.add(enemy.id);
        }
        this.removeDeadEnemy(i);
        continue;
      }
      const wasAttackingBase = enemy.preStepAttackingBase;
      enemy.postPhysics(dt);
      if (enemy.removed) {
        if (onEnemyKill && !handledEnemyIds.has(enemy.id)) {
          onEnemyKill(enemy);
          handledEnemyIds.add(enemy.id);
        }
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
    this.physicsWorld.forEachSensorHits(sensorId, callback);
    return true;
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
  ): void {
    if (this.physicsWorld) {
      this.physicsWorld.castShapePierce(originX, originY, dirX, dirY, ballRadius, maxDistance, maxHits, cb);
      return;
    }
    const length = Math.hypot(dirX, dirY) || 1;
    const unitX = dirX / length;
    const unitY = dirY / length;
    const candidates: { enemy: Enemy; projection: number }[] = [];
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
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
