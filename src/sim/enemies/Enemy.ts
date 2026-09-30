import type RAPIER from "@dimforge/rapier2d-compat";
import type { CrowdAgent } from "recast-navigation";
import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "@/render/themes/index.js";
import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  AGENT_RESYNC_RADIUS_FRACTION,
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  MAX_BURN_STACKS,
  MIN_SLOW_FACTOR,
  SIEGE_STUCK_SECONDS,
} from "@/sim/ConstantsEnemy.js";
import { restoreCrowdAgentVelocity } from "@/sim/navmesh/CrowdManager.js";
import { fromRecast, toRecast } from "@/sim/navmesh/coords.js";
import { launchEnemy } from "@/sim/physics/launchEnemy.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { isEngagementPolicy, selectTargetingTower } from "./targeting.js";

let nextId = 1;

// Enemy ids that already emitted the escaped-bounds warning. A containment hole
// shoves the same body out every tick; warn once per id instead of spamming.
const warnedOutOfBoundsIds = new Set<number>();

export function resetEnemyId() {
  nextId = 1;
  warnedOutOfBoundsIds.clear();
}

export interface AttackTarget {
  takeDamage(amount: number, attacker?: Enemy): void;
  readonly isGhost: boolean;
}

// Slow strengths compare on a 4-decimal grid: many shooters compute the "same"
// effective slow through different float paths, and exact equality fragmented
// one logical stack into unbounded near-duplicate entries.
const SLOW_STACK_QUANTIZATION = 1e4;

interface SlowEntry {
  eff: number;
  remaining: number;
}

interface BurnEntry {
  dps: number;
  timer: number;
}

interface EnemyMetaRef {
  baseHp: number;
  speed: number;
  bounty: number;
  radius: number;
  walking: unknown;
  hitReaction: unknown;
  resist?: number;
  slowResist?: number;
  shield?: number;
  heal?: number;
  healRange?: number;
  attackDamage: number;
  attackSpeed: number;
}

interface GridRef {
  tileSize: number;
  width: number;
  height: number;
  spawns: { x: number; y: number }[];
  tileToWorld(tx: number, ty: number): { x: number; y: number };
  getBase(): { x: number; y: number };
  isBase(x: number, y: number): boolean;
  isPath(x: number, y: number): boolean;
  isSpawn(x: number, y: number): boolean;
  isTerrain(x: number, y: number): boolean;
  inBounds(x: number, y: number): boolean;
  blocked: Set<string>;
  pathVersion: number;
}

function isWalkableTile(grid: GridRef, tileX: number, tileY: number): boolean {
  return grid.isPath(tileX, tileY) || grid.isSpawn(tileX, tileY) || grid.isBase(tileX, tileY);
}

type WalkableTile = { readonly x: number; readonly y: number };

// Walkability is tile-type only (path|spawn|base), so a tile's snap result is
// static for the life of a map. Memoize per grid so the engagement-policy path
// does not rescan the whole grid for each terrain tower tile every tick.
// Keys are tileY * grid.width + tileX; entries are shared and frozen.
const nearestWalkableCache = new WeakMap<GridRef, Map<number, WalkableTile | null>>();
let nearestWalkableCacheHits = 0;
let nearestWalkableCacheMisses = 0;

export function resetNearestWalkableCacheForTests(): void {
  nearestWalkableCacheHits = 0;
  nearestWalkableCacheMisses = 0;
}

export function getNearestWalkableCacheStats(): { hits: number; misses: number } {
  return { hits: nearestWalkableCacheHits, misses: nearestWalkableCacheMisses };
}

// Terrain nav distance is -1. Snap to the nearest path, spawn, or base tile so
// strongestAhead sees the same distance the commander payload reports.
export function nearestWalkableTile(grid: GridRef, tileX: number, tileY: number): WalkableTile | null {
  let gridCache = nearestWalkableCache.get(grid);
  if (!gridCache) {
    gridCache = new Map();
    nearestWalkableCache.set(grid, gridCache);
  }
  const tileKey = tileY * grid.width + tileX;
  if (gridCache.has(tileKey)) {
    nearestWalkableCacheHits++;
    return gridCache.get(tileKey) ?? null;
  }
  nearestWalkableCacheMisses++;
  const snap = computeNearestWalkableTile(grid, tileX, tileY);
  gridCache.set(tileKey, snap);
  return snap;
}

function computeNearestWalkableTile(grid: GridRef, tileX: number, tileY: number): WalkableTile | null {
  if (isWalkableTile(grid, tileX, tileY)) return Object.freeze({ x: tileX, y: tileY });
  let bestTile: WalkableTile | null = null;
  let bestSquaredDistance = Infinity;
  for (let rowIndex = 0; rowIndex < grid.height; rowIndex++) {
    for (let columnIndex = 0; columnIndex < grid.width; columnIndex++) {
      if (!isWalkableTile(grid, columnIndex, rowIndex)) continue;
      const deltaX = columnIndex - tileX;
      const deltaY = rowIndex - tileY;
      const squaredDistance = deltaX * deltaX + deltaY * deltaY;
      if (squaredDistance < bestSquaredDistance) {
        bestSquaredDistance = squaredDistance;
        bestTile = Object.freeze({ x: columnIndex, y: rowIndex });
      }
    }
  }
  return bestTile;
}

interface EnemyManagerRef {
  enemies: Enemy[];
  getEnemiesInRange(x: number, y: number, range: number): Enemy[];
  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void;
  forEachSensorHits?(sensorId: string, callback: (enemy: Enemy) => void): boolean;
  blockedApproach?(tileX: number, tileY: number): { approachWorld: { x: number; y: number } } | null;
  liveTowers?(): Tower[];
  distanceToBase?(tileX: number, tileY: number): number;
}

export class Enemy {
  id: number;
  type: string;
  level: number;
  meta: EnemyMetaRef;
  maxHp: number;
  hp: number;
  speed: number;
  bounty: number;
  color: string;
  radius: number;
  // Rapier rigid body backing this enemy; assigned by PhysicsWorld.addEnemy /
  // cleared by removeEnemy.
  body: RAPIER.RigidBody | null = null;
  // DetourCrowd agent backing this enemy. Stored here so CrowdManager / resync
  // can drive it; assigned at spawn, cleared on remove.
  agent: CrowdAgent | null = null;
  shape: unknown;
  walking: MapThemeAnimation | null;
  hitReaction: MapThemeAnimation | null;
  visualMeta: EnemyVisualMeta | null;
  theme: MapThemeData | null;
  resist: number;
  slowResist: number;
  shield: number;
  maxShield: number;
  heal: number;
  healRange: number;
  spawnIndex: number;
  // Wave number passed to the constructor. Spawn orders and releaseHeld filter on it.
  wave: number;
  grid: GridRef;
  x!: number;
  y!: number;
  // Path centerline position. Under physics the rigid body owns the live position;
  // centerX/centerY are mirrored from the body each frame so gameplay logic
  // (re-anchor, contact checks, currentTile) reads one source.
  centerX: number = 0;
  centerY: number = 0;
  slowFactor!: number;
  slowStack!: SlowEntry[];
  stunTimer!: number;
  removed!: boolean;
  burnStack!: BurnEntry[];
  hitAnimTime!: number;
  _gameSeconds: number = 0;

  get gameSeconds(): number {
    return this._gameSeconds;
  }
  onPathBlocked!: boolean;
  moveAngle!: number;
  // Tower the enemy is currently attacking/blocked by (live, non-ghost), or null.
  blockedByTower: Tower | null = null;
  // True once the enemy has reached the base and is now attacking it (does not despawn).
  attackingBase: boolean = false;
  // The base attack target, wired by the EnemyManager/engine. Null until set at spawn.
  baseTarget: AttackTarget | null = null;
  // Attack ability (scaled per Phase 0; damage scales with wave/level like HP).
  attackDamage: number = 0;
  attackSpeed: number = 0;
  attackTimer: number = 0;
  attackAnimTime: number = 0;
  attackAnimation: MapThemeAnimation | null = null;
  // Commander / engine routing mode.
  // default → base; hold → park at tile; route → waypoint then base; siege → attack tower.
  routingMode: "default" | "hold" | "route" | "siege" = "default";
  holdWorld: { x: number; y: number } | null = null;
  routeWorld: { x: number; y: number } | null = null;
  // Siege target tower (live); cleared on ghost/sell/release.
  siegeTower: Tower | null = null;
  // True once a `hold` enemy has reached its hold tile (used only for hold mode).
  arrived: boolean = false;
  preStepAttackingBase: boolean = false;
  targetingMode: string | null = null;
  // Impulse knockback window: crowd does not overwrite linvel while > 0.
  ballisticTimer: number = 0;
  // Motion lock: park zeroes velocity (stun/base/hold-arrived/siege-contact).
  motionLock: "none" | "park" = "none";
  // Cached last crowd move target so requestMoveTarget is not spammed every tick.
  lastMoveTargetWorld: { x: number; y: number } | null = null;
  lastMoveTargetMode: string | null = null;
  // Progress tracking for auto-siege when stuck on a choke.
  stuckTimer: number = 0;
  lastProgressX: number = 0;
  lastProgressY: number = 0;
  markTargetMult!: number;
  markTargetTimer!: number;
  antiHealTimer!: number;
  private healTickDt: number = 0;
  private applyHealAura = (ally: Enemy): void => {
    if (ally === this) return;
    if (ally.antiHealTimer > 0) return;
    ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * this.heal * this.healTickDt);
  };

  constructor(
    type: string,
    level: number,
    spawnIndex: number,
    grid: GridRef,
    wave: number,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
    defaultVisual: EnemyVisualMeta | null = null,
    baseTarget: AttackTarget | null = null,
  ) {
    const meta = ENEMY_TYPES[type] as unknown as EnemyMetaRef;
    this.id = nextId++;
    this.body = null;
    this.type = type;
    this.level = level;
    this.meta = meta;
    this.theme = theme;
    const enemyVisual = (theme?.enemies[type] ?? null) as EnemyVisualMeta | null;
    this.color = enemyVisual?.color || defaultVisual?.color || "#e85a6a";
    this.radius = meta.radius * grid.tileSize * 0.5;
    this.shape = enemyVisual?.shape || defaultVisual?.shape || "circle";
    this.walking = enemyVisual?.walking || null;
    this.hitReaction = enemyVisual?.hitReaction || null;
    this.attackAnimation = enemyVisual?.attack || null;
    this.visualMeta = enemyVisual;
    this.resist = meta.resist || 0;
    this.slowResist = meta.slowResist || 0;
    this.shield = meta.shield ? meta.shield * level : 0;
    this.maxShield = this.shield;
    this.heal = meta.heal || 0;
    this.healRange = (meta.healRange || 0) * grid.tileSize;

    const waveMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
    const diffMult = (difficultyTick || 0) * DIFFICULTY_MULT_TICK + 1;
    this.maxHp = meta.baseHp * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
    this.hp = this.maxHp;
    this.speed = meta.speed;
    this.bounty = Math.ceil(meta.bounty * (1 + 0.5 * (level - 1)));
    this.attackDamage = meta.attackDamage * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
    this.attackSpeed = meta.attackSpeed;
    this.attackTimer = 0;
    this.blockedByTower = null;
    this.siegeTower = null;
    this.ballisticTimer = 0;
    this.motionLock = "none";
    this.lastMoveTargetWorld = null;
    this.lastMoveTargetMode = null;
    this.stuckTimer = 0;
    this.lastProgressX = 0;
    this.lastProgressY = 0;
    this.baseTarget = baseTarget;

    this.spawnIndex = spawnIndex;
    this.wave = wave;
    this.grid = grid;
    this.slowFactor = 1;
    this.slowStack = [];
    this.stunTimer = 0;
    this.burnStack = [];
    this.hitAnimTime = 0;
    this._gameSeconds = 0;
    this.moveAngle = 0;
    this.markTargetMult = 0;
    this.markTargetTimer = 0;
    this.antiHealTimer = 0;
    // Spawn at the spawn tile center; the crowd agent (added in EnemyManager.spawn)
    // drives motion toward the base.
    const spawnPoint = grid.spawns[spawnIndex]!;
    const spawn = grid.tileToWorld(spawnPoint.x, spawnPoint.y);
    this.x = spawn.x;
    this.y = spawn.y;
    this.centerX = this.x;
    this.centerY = this.y;
    this.lastProgressX = this.x;
    this.lastProgressY = this.y;

    this.removed = false;
    this.onPathBlocked = false;
  }

  applySlow(amount: number, duration: number) {
    const effectiveSlow = amount * (1 - this.slowResist);
    if (effectiveSlow <= 0) return;
    const quantizedSlow = Math.round(effectiveSlow * SLOW_STACK_QUANTIZATION) / SLOW_STACK_QUANTIZATION;
    const existing = this.slowStack.find((slowEntry) => slowEntry.eff === quantizedSlow && slowEntry.remaining > 0);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, duration);
    } else {
      this.slowStack.push({ eff: quantizedSlow, remaining: duration });
    }
    this.recalcSlow();
  }

  recalcSlow() {
    this.slowFactor = 1;
    for (const slowEntry of this.slowStack) this.slowFactor *= 1 - slowEntry.eff;
    this.slowFactor = Math.max(MIN_SLOW_FACTOR, this.slowFactor);
  }

  applyStun(duration: number) {
    if (this.type === "boss") duration *= BOSS_STUN_REDUCTION;
    this.stunTimer = Math.max(this.stunTimer, duration);
  }

  applyBurn(dps: number, duration: number) {
    // Same/similar DPS refreshes duration; otherwise stack up to MAX_BURN_STACKS,
    // replacing the lowest-DPS entry when full so weak ticks cannot crowd out strong ones.
    const similarEntry = this.burnStack.find((entry) => Math.abs(entry.dps - dps) < 1e-6);
    if (similarEntry) {
      similarEntry.timer = Math.max(similarEntry.timer, duration);
      return;
    }
    if (this.burnStack.length < MAX_BURN_STACKS) {
      this.burnStack.push({ dps, timer: duration });
      return;
    }
    let lowestIndex = 0;
    for (let stackIndex = 1; stackIndex < this.burnStack.length; stackIndex++) {
      if (this.burnStack[stackIndex]!.dps < this.burnStack[lowestIndex]!.dps) {
        lowestIndex = stackIndex;
      }
    }
    if (dps >= this.burnStack[lowestIndex]!.dps) {
      this.burnStack[lowestIndex] = { dps, timer: duration };
    }
  }

  // Impulse knockback along −moveAngle. Routes through the shared launchEnemy
  // protocol (impulse + ballistic window + motion-lock release) so every knockback
  // source behaves identically.
  applyKnockback(amount: number): void {
    if (amount <= 0) return;
    if (!this.body) return;
    // Scale impulse so typical knockback amounts move the body ~`amount` world units
    // over the ballistic window against linear damping.
    const mass = Math.max(0.2, this.body.mass());
    const impulseX = -Math.cos(this.moveAngle) * amount * mass * 8;
    const impulseY = -Math.sin(this.moveAngle) * amount * mass * 8;
    launchEnemy(this, impulseX, impulseY);
  }

  applyMarkTarget(mult: number, duration: number) {
    this.markTargetMult = Math.max(this.markTargetMult, mult);
    this.markTargetTimer = Math.max(this.markTargetTimer, duration);
  }

  applyAntiHeal(duration: number) {
    this.antiHealTimer = Math.max(this.antiHealTimer, duration);
  }

  takeDamage(amount: number, armorPiercing: boolean = false) {
    if (this.shield > 0 && !armorPiercing) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount <= 0) return 0;
    let dmg = amount * (1 - this.resist);
    if (this.markTargetMult > 0) {
      dmg *= 1 + this.markTargetMult;
    }
    this.hp -= dmg;
    if (this.hp < 0) this.hp = 0;
    this.hitAnimTime = this._gameSeconds;
    if (this.hp <= 0) this.removed = true;
    return dmg;
  }

  // The enemy's current tile, derived from its world-space centerline (lane-offset
  // independent). The commander uses this as the start point for routing.
  currentTile(): { x: number; y: number } {
    return { x: Math.floor(this.centerX / this.grid.tileSize), y: Math.floor(this.centerY / this.grid.tileSize) };
  }

  nextCornerWorld(): { x: number; y: number } | null {
    if (!this.agent) return null;
    const corners = this.agent.corners();
    if (corners.length === 0) return null;
    const first = fromRecast(corners[0]!);
    if (Math.hypot(first.x - this.x, first.y - this.y) < 1e-3) {
      if (corners.length < 2) return null;
      return fromRecast(corners[1]!);
    }
    return first;
  }

  // Routes the enemy to a waypoint chain in the given mode. Null/empty → default.
  applyRoute(routePath: { x: number; y: number }[] | null, mode: "hold" | "route"): void {
    if (this.attackingBase) return;
    if (!routePath || routePath.length === 0) {
      this.releaseToDefault();
      return;
    }
    this.routingMode = mode;
    this.arrived = false;
    this.siegeTower = null;
    this.motionLock = "none";
    this.clearMoveTargetCache();

    const targetTile = mode === "hold" ? routePath[0]! : routePath[routePath.length - 1]!;
    const targetWorld = this.grid.tileToWorld(targetTile.x, targetTile.y);
    if (mode === "hold") this.holdWorld = targetWorld;
    else this.routeWorld = targetWorld;
    this.requestMoveTargetCached(targetWorld, mode);
  }

  // Siege a live tower: path to it, park on contact, attack until ghosted.
  applySiege(tower: Tower): void {
    if (this.attackingBase) return;
    if (tower.isGhost) {
      this.releaseToDefault();
      return;
    }
    this.routingMode = "siege";
    this.siegeTower = tower;
    this.arrived = false;
    this.motionLock = "none";
    this.clearMoveTargetCache();
    const targetWorld = this.grid.tileToWorld(tower.tileX, tower.tileY);
    this.requestMoveTargetCached(targetWorld, "siege");
  }

  releaseToDefault(): void {
    if (this.attackingBase) return;
    this.routingMode = "default";
    this.arrived = false;
    this.holdWorld = null;
    this.routeWorld = null;
    this.siegeTower = null;
    this.blockedByTower = null;
    this.motionLock = "none";
    this.clearMoveTargetCache();
    const baseWorld = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    this.requestMoveTargetCached(baseWorld, "default");
  }

  private clearMoveTargetCache(): void {
    this.lastMoveTargetWorld = null;
    this.lastMoveTargetMode = null;
  }

  private requestMoveTargetCached(targetWorld: { x: number; y: number }, mode: string): void {
    if (!this.agent) return;
    const previous = this.lastMoveTargetWorld;
    if (
      previous &&
      this.lastMoveTargetMode === mode &&
      Math.hypot(previous.x - targetWorld.x, previous.y - targetWorld.y) < 1e-3
    ) {
      return;
    }
    this.agent.requestMoveTarget(toRecast(targetWorld));
    this.lastMoveTargetWorld = { x: targetWorld.x, y: targetWorld.y };
    this.lastMoveTargetMode = mode;
  }

  // Status timers: slow/burn/mark/anti-heal bookkeeping plus the heal aura.
  // Runs at the start of computeIntent so every intent pass shares one timer source.
  private updateStatusTimers(dt: number, enemyManager: EnemyManagerRef | null): void {
    this._gameSeconds += dt;

    for (let i = this.slowStack.length - 1; i >= 0; i--) {
      const slowEntry = this.slowStack[i]!;
      slowEntry.remaining -= dt;
      if (slowEntry.remaining <= 0) {
        this.slowStack.splice(i, 1);
      }
    }
    if (this.slowStack.length === 0) this.slowFactor = 1;
    else this.recalcSlow();
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
    }
    if (!this.removed) {
      for (let burnIndex = this.burnStack.length - 1; burnIndex >= 0; burnIndex--) {
        const burnEntry = this.burnStack[burnIndex]!;
        burnEntry.timer -= dt;
        this.takeDamage(burnEntry.dps * dt, true);
        if (burnEntry.timer <= 0) {
          this.burnStack.splice(burnIndex, 1);
        }
      }
    }
    if (this.removed) return;
    if (this.markTargetTimer > 0) {
      this.markTargetTimer -= dt;
      if (this.markTargetTimer <= 0) {
        this.markTargetTimer = 0;
        this.markTargetMult = 0;
      }
    }
    if (this.antiHealTimer > 0) {
      this.antiHealTimer -= dt;
      if (this.antiHealTimer <= 0) {
        this.antiHealTimer = 0;
      }
    }

    if (this.heal > 0 && this.antiHealTimer <= 0 && enemyManager) {
      this.healTickDt = dt;
      const usedSensor = enemyManager.forEachSensorHits?.(`heal-${this.id}`, this.applyHealAura);
      if (!usedSensor) {
        enemyManager.forEachEnemyInRange(this.x, this.y, this.healRange, this.applyHealAura);
      }
    }
  }

  // Sets crowd move target from routing mode (cached). No position integration.
  computeIntent(dt: number, enemyManager: EnemyManagerRef | null): void {
    if (this.removed) return;
    this.updateStatusTimers(dt, enemyManager);
    if (this.removed) return;

    if (this.stunTimer > 0) {
      this.motionLock = "park";
    } else if (
      this.motionLock === "park" &&
      !this.attackingBase &&
      this.routingMode !== "hold" &&
      this.routingMode !== "siege"
    ) {
      this.motionLock = "none";
    }

    // Siege target gone → repath to base.
    if (this.routingMode === "siege") {
      if (!this.siegeTower || this.siegeTower.isGhost) {
        this.releaseToDefault();
      }
    }

    // Engagement policy replaces stuck auto-siege. hold/route keep their explicit target;
    // the policy resumes after releaseToDefault. Missing tower lookups leave the policy idle.
    const policyActive =
      this.routingMode !== "hold" && this.routingMode !== "route" && isEngagementPolicy(this.targetingMode);
    const liveTowers = enemyManager?.liveTowers?.();
    const readDistance = enemyManager?.distanceToBase;
    if (policyActive && liveTowers && readDistance && enemyManager) {
      const distanceAt = (tileX: number, tileY: number) => {
        const snap = nearestWalkableTile(this.grid, tileX, tileY);
        if (!snap) return -1;
        return enemyManager.distanceToBase?.(snap.x, snap.y) ?? -1;
      };
      const tile = this.currentTile();
      const chosen = selectTargetingTower(
        this.targetingMode,
        tile.x,
        tile.y,
        distanceAt(tile.x, tile.y),
        liveTowers,
        distanceAt,
      );
      this.stuckTimer = 0;
      if (chosen) {
        if (!(this.routingMode === "siege" && this.siegeTower === chosen)) this.applySiege(chosen);
      } else if (this.routingMode === "siege") {
        this.releaseToDefault();
      }
    } else if (
      !isEngagementPolicy(this.targetingMode) &&
      !this.attackingBase &&
      this.routingMode === "default" &&
      enemyManager &&
      this.blockedByTower &&
      !this.blockedByTower.isGhost
    ) {
      const progress = Math.hypot(this.x - this.lastProgressX, this.y - this.lastProgressY);
      const agentInvalid = this.agent?.state() === 0;
      if (progress < this.grid.tileSize * 0.05 || agentInvalid) {
        this.stuckTimer += dt;
        if (this.stuckTimer >= SIEGE_STUCK_SECONDS) {
          this.applySiege(this.blockedByTower);
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = 0;
        this.lastProgressX = this.x;
        this.lastProgressY = this.y;
      }
    } else if (this.routingMode !== "siege") {
      this.stuckTimer = 0;
      this.lastProgressX = this.x;
      this.lastProgressY = this.y;
    }

    const baseWorld = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    switch (this.routingMode) {
      case "hold":
        this.requestMoveTargetCached(this.holdWorld ?? baseWorld, "hold");
        break;
      case "route":
        this.requestMoveTargetCached(this.routeWorld ?? baseWorld, "route");
        break;
      case "siege": {
        const tower = this.siegeTower;
        if (tower && !tower.isGhost) {
          this.requestMoveTargetCached(this.grid.tileToWorld(tower.tileX, tower.tileY), "siege");
        } else {
          this.requestMoveTargetCached(baseWorld, "default");
        }
        break;
      }
      default: {
        const tile = this.currentTile();
        // An unreachable base makes the crowd corridor end on the polygon closest to the
        // base in a straight line. On a bend that polygon is across terrain, so the enemy
        // never reaches a tower face. Aim at the blocking tower's near face instead.
        const approach = enemyManager?.blockedApproach?.(tile.x, tile.y) ?? null;
        this.requestMoveTargetCached(approach?.approachWorld ?? baseWorld, "default");
        break;
      }
    }
  }

  // Reads stepped body, sparse agent resync, contact-driven attacks, bounds.
  postPhysics(dt: number): void {
    if (this.removed) return;
    const pos = this.body!.translation();
    this.centerX = pos.x;
    this.centerY = pos.y;
    this.x = pos.x;
    this.y = pos.y;

    // Sparse agent resync: teleporting every frame zeroes Detour steering (even
    // with set_vel restore). Only realign when the body has been shoved off the
    // agent's path (wall/tower contact) beyond a fraction of radius.
    const crowdAgent = this.agent;
    if (crowdAgent) {
      const agentPos = fromRecast(crowdAgent.position());
      const drift = Math.hypot(this.x - agentPos.x, this.y - agentPos.y);
      const resyncThreshold = Math.max(this.radius * AGENT_RESYNC_RADIUS_FRACTION, this.grid.tileSize * 0.15);
      if (drift > resyncThreshold) {
        const previousVelocity = crowdAgent.velocity();
        crowdAgent.teleport(toRecast({ x: this.x, y: this.y }));
        restoreCrowdAgentVelocity(crowdAgent, previousVelocity);
        // Re-assert move target after teleport so Detour rebuilds the corridor.
        if (this.lastMoveTargetWorld) {
          crowdAgent.requestMoveTarget(toRecast(this.lastMoveTargetWorld));
        }
      }
    }

    // Attack ticks run only while Rapier contact flags are live (ContactProcessor).
    if (this.attackingBase && this.baseTarget && this.stunTimer <= 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.baseTarget.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
    }

    if (!this.attackingBase && this.blockedByTower && !this.blockedByTower.isGhost && this.stunTimer <= 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.blockedByTower.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
    } else if (this.routingMode === "siege" && (!this.siegeTower || this.siegeTower.isGhost)) {
      this.releaseToDefault();
    }

    const worldWidth = this.grid.width * this.grid.tileSize;
    const worldHeight = this.grid.height * this.grid.tileSize;
    if (this.x < 0 || this.y < 0 || this.x > worldWidth || this.y > worldHeight) {
      // Corridor walls + navmesh should keep bodies inside; this firing means a
      // containment hole. Still clamp so the sim does not NaN, but report it once
      // per enemy id so a persistent hole does not spam the console every tick.
      if (!warnedOutOfBoundsIds.has(this.id)) {
        warnedOutOfBoundsIds.add(this.id);
        console.warn("Enemy escaped world bounds; clamping", this.id, this.x, this.y);
      }
      this.x = Math.max(0, Math.min(worldWidth, this.x));
      this.y = Math.max(0, Math.min(worldHeight, this.y));
      this.centerX = this.x;
      this.centerY = this.y;
      if (this.body) {
        this.body.setTranslation({ x: this.x, y: this.y }, true);
        this.body.setLinvel({ x: 0, y: 0 }, true);
      }
      this.agent?.teleport(toRecast({ x: this.x, y: this.y }));
    }

    const linvel = this.body!.linvel();
    const moveSpeedEpsilon = 1e-4;
    if (Math.hypot(linvel.x, linvel.y) >= moveSpeedEpsilon) {
      this.moveAngle = Math.atan2(linvel.y, linvel.x);
    }
  }
}
