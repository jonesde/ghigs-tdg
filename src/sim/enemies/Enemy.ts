import type RAPIER from "@dimforge/rapier2d-compat";
import type { CrowdAgent } from "recast-navigation";
import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "@/render/themes/index.js";
import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  AGENT_RESYNC_RADIUS_FRACTION,
  BOSS_STUN_REDUCTION,
  BREACH_HYSTERESIS_SECONDS,
  BREACH_REEVAL_SECONDS,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  enemyLevelBounty,
  MAX_BURN_STACKS,
  MIN_SLOW_FACTOR,
  STUCK_RECOVERY_SECONDS,
} from "@/sim/ConstantsEnemy.js";
import { decideBreach } from "@/sim/navmesh/BreachDecision.js";
import { restoreCrowdAgentVelocity } from "@/sim/navmesh/CrowdManager.js";
import { fromRecast, toRecast } from "@/sim/navmesh/coords.js";
import { launchEnemy } from "@/sim/physics/launchEnemy.js";
import type { Tower } from "@/sim/towers/Tower.js";
import {
  canTraverseTile,
  type LiveTowerAt,
  nearestTraversableNeighbor,
  nearestTraversableTile,
  planFlightRoute,
  readFlyingHeight,
  type TilePoint,
} from "./flightGrid.js";
import { isEngagementPolicy, selectTargetingTower } from "./targeting.js";

let nextId = 1;

// Enemy ids that already emitted the escaped-bounds warning. A containment hole
// shoves the same body out every tick; warn once per id instead of spamming.
const warnedOutOfBoundsIds = new Set<number>();

// Enemy ids that already emitted the unreachable-flight-goal warning. A walled-off
// goal leaves the polyline at [start] and the flyer hovering in place every tick;
// warn once per id until a plan with an actual route succeeds again.
const warnedUnreachableFlightIds = new Set<number>();

// A sustained force-field bias can shove a flyer out of its tile every tick.
// Containment must re-teleport each time, but the polyline clear + rebuild behind
// it is throttled to this cadence so the oscillation cannot force a BFS per tick.
const FLIGHT_CONTAINMENT_REPLAN_COOLDOWN_SECONDS = 0.25;

// Pin-recovery nudge strength in tiles per second of target slide speed over the
// ballistic window (scaled by body mass and tile size into an impulse).
const STUCK_NUDGE_TILES_PER_SECOND = 4;

export function resetEnemyId() {
  nextId = 1;
  warnedOutOfBoundsIds.clear();
  warnedUnreachableFlightIds.clear();
}

// Warn-once ids are per-run and per-enemy-id; resetEnemyId covers run restarts.
// Deaths inside a run recycle nothing (nextId only grows), so the per-id entry is
// dropped here to bound the set by live enemies rather than by run kills.
export function forgetUnreachableFlightWarning(enemyId: number): void {
  warnedUnreachableFlightIds.delete(enemyId);
}

function warnUnreachableFlightOnce(enemy: Enemy, detail: string): void {
  if (warnedUnreachableFlightIds.has(enemy.id)) return;
  warnedUnreachableFlightIds.add(enemy.id);
  console.warn("Flight goal unreachable; hovering until the map changes", enemy.id, enemy.type, detail);
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
  // Tower that applied this stack, for DPS-graph / milestone credit. Absent on
  // legacy/test constructions; burn still ticks, just without credit.
  sourceTowerId?: string | undefined;
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
  knockResist?: number;
  shield?: number;
  heal?: number;
  healRange?: number;
  attackDamage: number;
  attackSpeed: number;
  flyingHeight?: number;
}

interface GridRef {
  tileSize: number;
  width: number;
  height: number;
  worldOriginX?: number;
  worldOriginY?: number;
  spawns: { x: number; y: number }[];
  tileToWorld(tx: number, ty: number): { x: number; y: number };
  worldToTile(wx: number, wy: number): { x: number; y: number };
  getBase(): { x: number; y: number };
  isBase(x: number, y: number): boolean;
  isPath(x: number, y: number): boolean;
  isSpawn(x: number, y: number): boolean;
  isTerrain(x: number, y: number): boolean;
  isVoid(x: number, y: number): boolean;
  inBounds(x: number, y: number): boolean;
  getHeight(x: number, y: number): number;
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

// The cache key is tileY * width + tileX. A grown progressive grid reuses the
// same object with a new width, so a stale entry would name the wrong tile.
export function invalidateNearestWalkableCache(grid: GridRef): void {
  nearestWalkableCache.delete(grid);
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

function isOpenTile(grid: GridRef, tileX: number, tileY: number): boolean {
  return isWalkableTile(grid, tileX, tileY) && !grid.blocked.has(`${tileX},${tileY}`);
}

// Nearest walkable tile that carries no live tower. Breach decisions anchor on
// this: a body rounding a chamfered wall corner has its center inside the blocked
// tile's rectangle, and reading the open leg from that tile would report the lane
// as sealed (distance -1) and misfire the siege conversion.
// Blocked-ness changes at runtime, so the cache is stamped with pathVersion and
// rebuilt when a tower set change invalidates it.
const nearestOpenCache = new WeakMap<GridRef, { pathVersion: number; entries: Map<number, WalkableTile | null> }>();

export function invalidateNearestOpenCache(grid: GridRef): void {
  nearestOpenCache.delete(grid);
}

export function nearestOpenTile(grid: GridRef, tileX: number, tileY: number): WalkableTile | null {
  let gridCache = nearestOpenCache.get(grid);
  if (!gridCache || gridCache.pathVersion !== grid.pathVersion) {
    gridCache = { pathVersion: grid.pathVersion, entries: new Map() };
    nearestOpenCache.set(grid, gridCache);
  }
  const tileKey = tileY * grid.width + tileX;
  if (gridCache.entries.has(tileKey)) return gridCache.entries.get(tileKey) ?? null;
  let bestTile: WalkableTile | null = null;
  let bestSquaredDistance = Infinity;
  for (let rowIndex = 0; rowIndex < grid.height; rowIndex++) {
    for (let columnIndex = 0; columnIndex < grid.width; columnIndex++) {
      if (!isOpenTile(grid, columnIndex, rowIndex)) continue;
      const deltaX = columnIndex - tileX;
      const deltaY = rowIndex - tileY;
      const squaredDistance = deltaX * deltaX + deltaY * deltaY;
      if (squaredDistance < bestSquaredDistance) {
        bestSquaredDistance = squaredDistance;
        bestTile = Object.freeze({ x: columnIndex, y: rowIndex });
      }
    }
  }
  const frozen = bestTile;
  gridCache.entries.set(tileKey, frozen);
  return frozen;
}

interface EnemyManagerRef {
  enemies: Enemy[];
  getEnemiesInRange(x: number, y: number, range: number): Enemy[];
  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void;
  forEachSensorHits?(sensorId: string, callback: (enemy: Enemy) => void): boolean;
  blockedApproach?(tileX: number, tileY: number): { approachWorld: { x: number; y: number } } | null;
  liveTowers?(): Tower[];
  distanceToBase?(tileX: number, tileY: number): number;
  throughDistanceToBase?(tileX: number, tileY: number): number;
  throughBlockers?(tileX: number, tileY: number): Array<{ x: number; y: number }>;
  flightDistanceToBase?(tileX: number, tileY: number, flyingHeight: number): number;
  // Cross-module: burn ticks route their dealt damage here so the inflicting
  // tower's totalDamageDealt/waveDamage (DPS graph, milestones) include it.
  creditDamage?(towerId: string, amount: number): void;
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
  // Fraction of incoming knockback impulse ignored (0..1). Boss/tank types use
  // this instead of a mass hack so every knockback source scales uniformly.
  knockResist: number;
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
  preStepAttackingBase: boolean = false;
  targetingMode: string | null = null;
  // Impulse knockback window: crowd does not overwrite linvel while > 0.
  ballisticTimer: number = 0;
  // Motion lock: park zeroes velocity (stun/base/hold-arrived/siege-contact).
  motionLock: "none" | "park" = "none";
  // Cached last crowd move target so requestMoveTarget is not spammed every tick.
  lastMoveTargetWorld: { x: number; y: number } | null = null;
  flyingHeight: number = 0;
  // World points of the current flight polyline. Empty until computeIntent plans one.
  flightPoints: { x: number; y: number }[] = [];
  flightCursor: number = 0;
  flightBuiltPathVersion: number = -1;
  // Counts down until a containment event may clear + rebuild the polyline again.
  containmentReplanCooldownSeconds: number = 0;
  // Waypoints kept for this flyer, including the appended base. Re-filtered when the polyline rebuilds.
  routeTiles: TilePoint[] = [];
  strafeOccupancyKey: string | null = null;
  // Cross-module: EnemyManager points these at the live tower list. A missing
  // manager (unit constructions) treats every tile as tower-free.
  liveTowerAt: LiveTowerAt = () => false;
  towerAt: (tileX: number, tileY: number) => Tower | null = () => null;
  lastMoveTargetMode: string | null = null;
  // Progress tracking for the walk-only pin recovery.
  stuckTimer: number = 0;
  // Tangent side of the next pin-recovery nudge; alternates after each attempt so
  // a corner pin that does not slide one way tries the other.
  stuckNudgeSign: 1 | -1 = 1;
  // Breach-vs-detour decision cache. Re-evaluate when the enemy changes tile,
  // the tower set changes (pathVersion), or the cadence elapses, so per-tick
  // intent stays at field reads instead of a greedy descent every tick.
  breachPathVersion: number = -1;
  breachCooldownSeconds: number = 0;
  private breachSnapKey: number | null = null;
  // Seconds before another FAILED or INVALID crowd retarget. CrowdManager writes
  // this so a dead target does not fill Detour's 8-slot path queue every tick.
  crowdRetargetCooldown: number = 0;
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
    this.flyingHeight = readFlyingHeight(meta);
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
    this.knockResist = meta.knockResist || 0;
    this.shield = meta.shield ? meta.shield * level : 0;
    this.maxShield = this.shield;
    this.heal = meta.heal || 0;
    this.healRange = (meta.healRange || 0) * grid.tileSize;

    const waveMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
    const diffMult = (difficultyTick || 0) * DIFFICULTY_MULT_TICK + 1;
    this.maxHp = meta.baseHp * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
    this.hp = this.maxHp;
    this.speed = meta.speed;
    this.bounty = enemyLevelBounty(meta.bounty, level, wave);
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
    this.crowdRetargetCooldown = 0;
    this.lastProgressX = 0;
    this.lastProgressY = 0;
    this.baseTarget = baseTarget;
    this.breachPathVersion = -1;
    this.breachCooldownSeconds = 0;

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

  applyBurn(dps: number, duration: number, sourceTowerId?: string) {
    // Same/similar DPS refreshes duration; otherwise stack up to MAX_BURN_STACKS,
    // replacing the lowest-DPS entry when full so weak ticks cannot crowd out strong ones.
    const similarEntry = this.burnStack.find((entry) => Math.abs(entry.dps - dps) < 1e-6);
    if (similarEntry) {
      similarEntry.timer = Math.max(similarEntry.timer, duration);
      // The latest application owns the refreshed stack, so its tower is credited.
      similarEntry.sourceTowerId = sourceTowerId ?? similarEntry.sourceTowerId;
      return;
    }
    if (this.burnStack.length < MAX_BURN_STACKS) {
      this.burnStack.push({ dps, timer: duration, sourceTowerId });
      return;
    }
    let lowestIndex = 0;
    for (let stackIndex = 1; stackIndex < this.burnStack.length; stackIndex++) {
      if (this.burnStack[stackIndex]!.dps < this.burnStack[lowestIndex]!.dps) {
        lowestIndex = stackIndex;
      }
    }
    if (dps >= this.burnStack[lowestIndex]!.dps) {
      this.burnStack[lowestIndex] = { dps, timer: duration, sourceTowerId };
    }
  }

  // Impulse knockback along −moveAngle. Routes through the shared launchEnemy
  // protocol (impulse + ballistic window + motion-lock release) so every knockback
  // source behaves identically. Per-type knockResist scales the impulse before any
  // body work so resisted types can never be launched.
  applyKnockback(amount: number): void {
    const effectiveAmount = amount * Math.max(0, 1 - this.knockResist);
    if (effectiveAmount <= 0) return;
    if (!this.body) return;
    // Scale impulse so typical knockback amounts move the body ~`amount` world units
    // over the ballistic window against linear damping.
    const mass = Math.max(0.2, this.body.mass());
    const impulseX = -Math.cos(this.moveAngle) * effectiveAmount * mass * 8;
    const impulseY = -Math.sin(this.moveAngle) * effectiveAmount * mass * 8;
    launchEnemy(this, impulseX, impulseY);
  }

  applyMarkTarget(mult: number, duration: number) {
    this.markTargetMult = Math.max(this.markTargetMult, mult);
    this.markTargetTimer = Math.max(this.markTargetTimer, duration);
  }

  applyAntiHeal(duration: number) {
    this.antiHealTimer = Math.max(this.antiHealTimer, duration);
  }

  // Returns the total damage applied this call: shield absorbed + HP damage
  // (post-resist, pre-overkill-clamp). Callers use the return only for telemetry
  // (DPS graph / milestones); kill and gold-on-kill logic reads `removed`/`hp`.
  takeDamage(amount: number, armorPiercing: boolean = false) {
    if (amount <= 0) return 0;
    let absorbed = 0;
    if (this.shield > 0 && !armorPiercing) {
      absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount <= 0) return absorbed;
    let dmg = amount * (1 - this.resist);
    if (this.markTargetMult > 0) {
      dmg *= 1 + this.markTargetMult;
    }
    this.hp -= dmg;
    if (this.hp < 0) this.hp = 0;
    this.hitAnimTime = this._gameSeconds;
    if (this.hp <= 0) this.removed = true;
    return absorbed + dmg;
  }

  // The enemy's current tile, derived from its world-space centerline (lane-offset
  // independent). The commander uses this as the start point for routing.
  currentTile(): { x: number; y: number } {
    return this.grid.worldToTile(this.centerX, this.centerY);
  }

  nextCornerWorld(): { x: number; y: number } | null {
    if (this.flyingHeight > 0) {
      const point = this.flightPoints[this.flightCursor];
      return point ? { x: point.x, y: point.y } : null;
    }
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
    if (this.flyingHeight > 0) {
      this.applyFlightOrder(routePath, mode);
      return;
    }
    this.routingMode = mode;
    this.siegeTower = null;
    this.motionLock = "none";
    this.breachSnapKey = null;
    this.breachPathVersion = -1;
    this.breachCooldownSeconds = 0;
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
    this.motionLock = "none";
    this.breachSnapKey = null;
    this.breachPathVersion = -1;
    this.breachCooldownSeconds = 0;
    this.clearMoveTargetCache();
    if (this.flyingHeight > 0) {
      this.rebuildFlightPolyline();
      return;
    }
    const targetWorld = this.grid.tileToWorld(tower.tileX, tower.tileY);
    this.requestMoveTargetCached(targetWorld, "siege");
  }

  releaseToDefault(): void {
    if (this.attackingBase) return;
    this.routingMode = "default";
    this.holdWorld = null;
    this.routeWorld = null;
    this.siegeTower = null;
    this.blockedByTower = null;
    this.motionLock = "none";
    this.breachSnapKey = null;
    this.breachPathVersion = -1;
    this.breachCooldownSeconds = 0;
    this.routeTiles = [];
    this.strafeOccupancyKey = null;
    this.clearMoveTargetCache();
    this.clearFlightPolyline();
    const baseWorld = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    if (this.flyingHeight > 0) {
      this.rebuildFlightPolyline();
      return;
    }
    this.requestMoveTargetCached(baseWorld, "default");
  }

  private clearMoveTargetCache(): void {
    this.lastMoveTargetWorld = null;
    this.lastMoveTargetMode = null;
  }

  private requestMoveTargetCached(targetWorld: { x: number; y: number }, mode: string): void {
    const previous = this.lastMoveTargetWorld;
    if (
      previous &&
      this.lastMoveTargetMode === mode &&
      Math.hypot(previous.x - targetWorld.x, previous.y - targetWorld.y) < 1e-3
    ) {
      return;
    }
    this.lastMoveTargetWorld = { x: targetWorld.x, y: targetWorld.y };
    this.lastMoveTargetMode = mode;
    this.agent?.requestMoveTarget(toRecast(targetWorld));
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
        // Burn bypasses shields (armorPiercing) but still takes enemy resist via
        // takeDamage. Credit the applied damage to the inflicting tower so the DPS
        // graph and milestone progression include burn.
        const burnDamage = this.takeDamage(burnEntry.dps * dt, true);
        if (burnEntry.sourceTowerId) {
          enemyManager?.creditDamage?.(burnEntry.sourceTowerId, burnDamage);
        }
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

    if (this.flyingHeight > 0) {
      this.computeFlightIntent(enemyManager);
      return;
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
      this.lastProgressX = this.x;
      this.lastProgressY = this.y;
      if (chosen) {
        if (!(this.routingMode === "siege" && this.siegeTower === chosen)) this.applySiege(chosen);
      } else if (this.routingMode === "siege") {
        this.releaseToDefault();
      }
    } else if (
      !isEngagementPolicy(this.targetingMode) &&
      !this.attackingBase &&
      this.routingMode === "default" &&
      enemyManager
    ) {
      this.updateStuckRecovery(dt);
      this.evaluateBreachDecision(dt, enemyManager);
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

  // Unified breach-vs-detour decision for default routing: siege the enemy-side
  // wall when walking through it (plus the breach time at this enemy's own DPS)
  // beats the open walk around it, otherwise keep the open Detour route. Snaps
  // non-walkable tiles so a commander hold on terrain still decides from the
  // nearest corridor tile. Re-evaluates on tile change, tower-set change, or a
  // short cadence rather than every tick.
  private evaluateBreachDecision(dt: number, enemyManager: EnemyManagerRef): void {
    this.breachCooldownSeconds = Math.max(0, this.breachCooldownSeconds - dt);
    if (this.attackingBase) return;
    const readOpen = (tileX: number, tileY: number): number => enemyManager.distanceToBase?.(tileX, tileY) ?? -1;
    const readThrough = (tileX: number, tileY: number): number =>
      enemyManager.throughDistanceToBase?.(tileX, tileY) ?? -1;
    const readBlockers = (tileX: number, tileY: number): Array<{ x: number; y: number }> =>
      enemyManager.throughBlockers?.(tileX, tileY) ?? [];
    if (!enemyManager.distanceToBase || !enemyManager.throughDistanceToBase) {
      return;
    }
    const tile = this.currentTile();
    // The decision anchors on an open (tower-free) tile: a body rounding a
    // chamfered wall corner stands inside the blocked tile's rectangle, and
    // reading the open leg from that tile reports a sealed lane and misfires the
    // siege conversion. Falls back to the type-only snap for a map with no open
    // tile left, where the sealed-lane rule is genuinely correct.
    const anchor = isOpenTile(this.grid, tile.x, tile.y)
      ? tile
      : (nearestOpenTile(this.grid, tile.x, tile.y) ?? nearestWalkableTile(this.grid, tile.x, tile.y));
    if (!anchor) {
      return;
    }
    const anchorKey = anchor.y * this.grid.width + anchor.x;
    const towerSetChanged = this.grid.pathVersion !== this.breachPathVersion;
    const siegeTargetGone = this.routingMode === "siege" && (!this.siegeTower || this.siegeTower.isGhost);
    if (!towerSetChanged && !siegeTargetGone && anchorKey === this.breachSnapKey && this.breachCooldownSeconds > 0) {
      return;
    }
    this.breachCooldownSeconds = BREACH_REEVAL_SECONDS;
    const openDistance = readOpen(anchor.x, anchor.y);
    const throughDistance = readThrough(anchor.x, anchor.y);
    if (throughDistance < 0) {
      this.breachSnapKey = anchorKey;
      this.breachPathVersion = this.grid.pathVersion;
      return;
    }
    const blockers = this.blockersFromTiles(readBlockers(anchor.x, anchor.y));
    const currentlySieging = this.routingMode === "siege";
    const evaluation = decideBreach({
      openDistanceTiles: openDistance,
      throughDistanceTiles: throughDistance,
      blockers,
      enemyDamagePerSecond: this.attackDamage * this.attackSpeed,
      enemySpeedTilesPerSecond: this.speed,
      hysteresisSeconds: BREACH_HYSTERESIS_SECONDS,
      currentlySieging,
    });
    this.breachSnapKey = anchorKey;
    this.breachPathVersion = this.grid.pathVersion;
    if (evaluation.decision === "detour") {
      if (currentlySieging) this.releaseToDefault();
      return;
    }
    const siegeTile = evaluation.siegeTile;
    if (!siegeTile) return;
    const tower = this.towerAt(siegeTile.x, siegeTile.y);
    if (!tower || tower.isGhost || tower.enemyAttackImmune) return;
    if (!(currentlySieging && this.siegeTower === tower)) this.applySiege(tower);
  }

  private blockersFromTiles(
    tiles: Array<{ x: number; y: number }>,
  ): Array<{ tileX: number; tileY: number; health: number; breachable: boolean }> {
    const blockers: Array<{ tileX: number; tileY: number; health: number; breachable: boolean }> = [];
    for (const tile of tiles) {
      const tower = this.towerAt(tile.x, tile.y);
      if (!tower || tower.isGhost || tower.enemyAttackImmune) {
        blockers.push({ tileX: tile.x, tileY: tile.y, health: 0, breachable: false });
        continue;
      }
      blockers.push({ tileX: tile.x, tileY: tile.y, health: Math.max(0, tower.health), breachable: true });
    }
    return blockers;
  }

  // Walk-past rule: only a committed siege damages towers. An enemy walking
  // around a wall (default/route/hold contact) reports the contact but never
  // converts it into damage.
  private canDamageTower(tower: Tower): boolean {
    return this.routingMode === "siege" && this.siegeTower === tower && !tower.isGhost;
  }

  // Walk-only recovery for a default-routing enemy pinned on live tower contact:
  // the breach comparator chose the detour, so a physical jam re-plans the crowd
  // corridor and nudges the body along the wall face instead of converting the
  // enemy to a siege. A pin is no progress (or an INVALID agent) for
  // STUCK_RECOVERY_SECONDS; the nudge impulse rides the ballistic window so the
  // crowd steering cannot overwrite it, and the tangent side alternates between
  // attempts. Stunned enemies are excluded: launchEnemy releases the motion lock
  // a stun park must keep.
  private updateStuckRecovery(dt: number): void {
    const contactTower = this.blockedByTower && !this.blockedByTower.isGhost ? this.blockedByTower : null;
    if (!contactTower || this.stunTimer > 0) {
      this.stuckTimer = 0;
      this.lastProgressX = this.x;
      this.lastProgressY = this.y;
      return;
    }
    const progress = Math.hypot(this.x - this.lastProgressX, this.y - this.lastProgressY);
    const agentInvalid = this.agent?.state() === 0;
    if (progress >= this.grid.tileSize * 0.05 && !agentInvalid) {
      this.stuckTimer = 0;
      this.lastProgressX = this.x;
      this.lastProgressY = this.y;
      return;
    }
    this.stuckTimer += dt;
    if (this.stuckTimer < STUCK_RECOVERY_SECONDS) return;
    this.stuckTimer = 0;
    this.lastProgressX = this.x;
    this.lastProgressY = this.y;
    this.clearMoveTargetCache();
    this.applyStuckNudge(contactTower);
  }

  // Tangential impulse that breaks a static wall/corner contact: desired
  // direction toward the next crowd corner rotated ±90° (side alternates), with
  // half a unit of the tower's outward normal blended in so the push also
  // separates from the face. Magnitude targets roughly half a tile of travel over
  // the ballistic window against the 0.9 linear damping.
  private applyStuckNudge(contactTower: Tower): void {
    if (!this.body) return;
    const towerWorld = this.grid.tileToWorld(contactTower.tileX, contactTower.tileY);
    const outwardX = this.x - towerWorld.x;
    const outwardY = this.y - towerWorld.y;
    const outwardLength = Math.hypot(outwardX, outwardY) || 1;
    const corner = this.nextCornerWorld() ?? this.lastMoveTargetWorld ?? { x: 0, y: 0 };
    const desiredX = corner.x - this.x;
    const desiredY = corner.y - this.y;
    const desiredLength = Math.hypot(desiredX, desiredY) || 1;
    const side = this.stuckNudgeSign;
    const tangentX = (-desiredY / desiredLength) * side;
    const tangentY = (desiredX / desiredLength) * side;
    const blendX = tangentX + (outwardX / outwardLength) * 0.5;
    const blendY = tangentY + (outwardY / outwardLength) * 0.5;
    const blendLength = Math.hypot(blendX, blendY) || 1;
    const impulseScale = this.body.mass() * this.grid.tileSize * STUCK_NUDGE_TILES_PER_SECOND;
    launchEnemy(this, (blendX / blendLength) * impulseScale, (blendY / blendLength) * impulseScale);
    this.stuckNudgeSign = side === 1 ? -1 : 1;
  }

  // Reads stepped body, sparse agent resync, contact-driven attacks, bounds.
  postPhysics(dt: number): void {
    if (this.removed) return;
    if (this.body) {
      const pos = this.body.translation();
      this.centerX = pos.x;
      this.centerY = pos.y;
      this.x = pos.x;
      this.y = pos.y;
    } else if (this.agent) {
      // Physics-less enemy with a crowd agent: Detour still integrates the agent,
      // so mirror its position instead of dereferencing a missing body.
      const agentPos = fromRecast(this.agent.position());
      this.centerX = agentPos.x;
      this.centerY = agentPos.y;
      this.x = agentPos.x;
      this.y = agentPos.y;
    } else {
      this.integrateKinematic(dt);
    }

    // Sparse agent resync: teleporting every frame zeroes Detour steering (even
    // with set_vel restore). Only realign when the body has been shoved off the
    // agent's path (wall/tower contact) beyond a fraction of radius.
    // A parked body can still be nudged by a wall. Teleporting the crowd agent
    // onto that nudge clears the Detour move target and collapses the corridor,
    // which is how a stun at a corner leaves the agent with no path. The agent
    // is held for the park, so the resync waits until the enemy is walking again.
    const crowdAgent = this.agent;
    const crowdParked = this.stunTimer > 0 || this.motionLock === "park" || this.attackingBase;
    if (crowdAgent && !crowdParked) {
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

    if (this.flyingHeight > 0) {
      this.applyFlightAttack(dt);
    } else if (
      !this.attackingBase &&
      this.blockedByTower &&
      !this.blockedByTower.isGhost &&
      this.stunTimer <= 0 &&
      this.canDamageTower(this.blockedByTower)
    ) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.blockedByTower.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
    } else if (this.routingMode === "siege" && (!this.siegeTower || this.siegeTower.isGhost)) {
      this.releaseToDefault();
    }

    // Progressive maps keep their top-left tile at a negative world origin, so
    // the map rectangle is not [0, size*tileSize] — anchoring on 0 teleports
    // every enemy in the west/north quadrants to the map corner.
    const originX = this.grid.worldOriginX ?? 0;
    const originY = this.grid.worldOriginY ?? 0;
    const minX = originX;
    const maxX = originX + this.grid.width * this.grid.tileSize;
    const minY = originY;
    const maxY = originY + this.grid.height * this.grid.tileSize;
    if (this.x < minX || this.y < minY || this.x > maxX || this.y > maxY) {
      // Corridor walls + navmesh should keep bodies inside; this firing means a
      // containment hole. Still clamp so the sim does not NaN, but report it once
      // per enemy id so a persistent hole does not spam the console every tick.
      if (!warnedOutOfBoundsIds.has(this.id)) {
        warnedOutOfBoundsIds.add(this.id);
        console.warn("Enemy escaped world bounds; clamping", this.id, this.x, this.y);
      }
      this.x = Math.max(minX, Math.min(maxX, this.x));
      this.y = Math.max(minY, Math.min(maxY, this.y));
      this.centerX = this.x;
      this.centerY = this.y;
      if (this.body) {
        this.body.setTranslation({ x: this.x, y: this.y }, true);
        this.body.setLinvel({ x: 0, y: 0 }, true);
      }
      this.agent?.teleport(toRecast({ x: this.x, y: this.y }));
    }

    // The rectangle above includes the progressive void margin. That margin is not
    // drawn and is not a flight tile, so a center that lands there is moved onto
    // the nearest placed tile. Clearing the polyline makes the next intent rebuild,
    // throttled so a sustained force-field bias cannot force a rebuild every tick.
    if (this.flyingHeight > 0) {
      this.containmentReplanCooldownSeconds = Math.max(0, this.containmentReplanCooldownSeconds - dt);
      const occupied = this.currentTile();
      if (!canTraverseTile(this.grid, occupied.x, occupied.y, this.flyingHeight, this.liveTowerAt)) {
        const recover = nearestTraversableTile(this.grid, occupied.x, occupied.y, this.flyingHeight, this.liveTowerAt);
        if (recover) {
          const world = this.grid.tileToWorld(recover.x, recover.y);
          this.x = world.x;
          this.y = world.y;
          this.centerX = world.x;
          this.centerY = world.y;
          if (this.body) {
            this.body.setTranslation({ x: world.x, y: world.y }, true);
            this.body.setLinvel({ x: 0, y: 0 }, true);
          }
          if (this.containmentReplanCooldownSeconds <= 0) {
            this.clearFlightPolyline();
            this.containmentReplanCooldownSeconds = FLIGHT_CONTAINMENT_REPLAN_COOLDOWN_SECONDS;
          }
        } else {
          // No traversable tile exists at this height. Drop the stale polyline that was
          // steering into the void and stamp the current pathVersion so the empty-polyline
          // state does not rescan until the map changes.
          this.flightPoints = [];
          this.flightCursor = 0;
          this.flightBuiltPathVersion = this.grid.pathVersion;
          warnUnreachableFlightOnce(this, "no traversable tile in the flight grid");
        }
      }
    }

    if (this.body) {
      const linvel = this.body.linvel();
      const moveSpeedEpsilon = 1e-4;
      if (Math.hypot(linvel.x, linvel.y) >= moveSpeedEpsilon) {
        this.moveAngle = Math.atan2(linvel.y, linvel.x);
      }
    }
  }

  // Physics-less fallback: integrate toward the cached move target at the
  // enemy's effective speed so computeIntent + postPhysics form a usable loop in
  // headless constructions. Stun, base attack, and park states hold position.
  private integrateKinematic(dt: number): void {
    const target = this.lastMoveTargetWorld;
    if (!target || this.stunTimer > 0 || this.attackingBase || this.motionLock === "park") return;
    const deltaX = target.x - this.x;
    const deltaY = target.y - this.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 1e-6) return;
    const stepDistance = Math.min(distance, this.speed * this.slowFactor * this.grid.tileSize * dt);
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    this.x += directionX * stepDistance;
    this.y += directionY * stepDistance;
    this.centerX = this.x;
    this.centerY = this.y;
    this.moveAngle = Math.atan2(directionY, directionX);
  }

  clearFlightPolyline(): void {
    this.flightPoints = [];
    this.flightCursor = 0;
    this.flightBuiltPathVersion = -1;
  }

  private applyFlightOrder(routePath: { x: number; y: number }[], mode: "hold" | "route"): void {
    if (mode === "hold") {
      const holdTile = routePath[0]!;
      if (!canTraverseTile(this.grid, holdTile.x, holdTile.y, this.flyingHeight, this.liveTowerAt)) return;
      this.routingMode = "hold";
      this.siegeTower = null;
      this.motionLock = "none";
      this.clearMoveTargetCache();
      this.holdWorld = this.grid.tileToWorld(holdTile.x, holdTile.y);
      this.routeTiles = [{ x: holdTile.x, y: holdTile.y }];
      this.strafeOccupancyKey = null;
      this.rebuildFlightPolyline();
      return;
    }
    const kept = routePath.filter((tile) =>
      canTraverseTile(this.grid, tile.x, tile.y, this.flyingHeight, this.liveTowerAt),
    );
    this.routingMode = "route";
    this.siegeTower = null;
    this.motionLock = "none";
    this.clearMoveTargetCache();
    this.routeTiles = kept.map((tile) => ({ x: tile.x, y: tile.y }));
    const lastTile = kept[kept.length - 1];
    this.routeWorld = lastTile ? this.grid.tileToWorld(lastTile.x, lastTile.y) : null;
    this.strafeOccupancyKey = null;
    this.rebuildFlightPolyline();
  }

  private computeFlightIntent(enemyManager: EnemyManagerRef | null): void {
    this.applyFlightEngagement(enemyManager);
    // Version-only gate: clearFlightPolyline stamps -1 so a cleared polyline rebuilds on
    // the next intent, while a failed plan (empty points at the current pathVersion) does
    // not force a recovery rescan every tick until the map changes.
    if (this.flightBuiltPathVersion !== this.grid.pathVersion) {
      this.rebuildFlightPolyline();
    }
    this.advanceFlightCursor();
    const point = this.flightPoints[this.flightCursor];
    if (!point) return;
    this.lastMoveTargetWorld = { x: point.x, y: point.y };
    this.lastMoveTargetMode = this.routingMode;
  }

  private applyFlightEngagement(enemyManager: EnemyManagerRef | null): void {
    const policyActive =
      this.routingMode !== "hold" && this.routingMode !== "route" && isEngagementPolicy(this.targetingMode);
    const liveTowers = enemyManager?.liveTowers?.();
    if (!policyActive || !liveTowers || !enemyManager?.flightDistanceToBase) return;
    const distanceAt = (tileX: number, tileY: number) =>
      enemyManager.flightDistanceToBase?.(tileX, tileY, this.flyingHeight) ?? -1;
    const tile = this.currentTile();
    const chosen = selectTargetingTower(
      this.targetingMode,
      tile.x,
      tile.y,
      distanceAt(tile.x, tile.y),
      liveTowers,
      distanceAt,
    );
    if (chosen) {
      if (!(this.routingMode === "siege" && this.siegeTower === chosen)) this.applySiege(chosen);
    } else if (this.routingMode === "siege") {
      this.releaseToDefault();
    }
  }

  private advanceFlightCursor(): void {
    const arrivalRadius = this.grid.tileSize * 0.45;
    while (this.flightCursor < this.flightPoints.length - 1) {
      const point = this.flightPoints[this.flightCursor]!;
      if (Math.hypot(this.x - point.x, this.y - point.y) > arrivalRadius) break;
      this.flightCursor++;
    }
  }

  private rebuildFlightPolyline(): void {
    const height = this.flyingHeight;
    const liveTowerAt = this.liveTowerAt;
    const start = this.currentTile();
    let goals: TilePoint[] = [];
    if (this.routingMode === "hold" && this.holdWorld) {
      const holdTile = this.grid.worldToTile(this.holdWorld.x, this.holdWorld.y);
      if (canTraverseTile(this.grid, holdTile.x, holdTile.y, height, liveTowerAt)) goals = [holdTile];
      else {
        const neighbor = nearestTraversableNeighbor(this.grid, holdTile.x, holdTile.y, height, liveTowerAt, start);
        goals = neighbor ? [neighbor] : [];
      }
    } else if (this.routingMode === "route") {
      goals = this.routeTiles.filter((tile) => canTraverseTile(this.grid, tile.x, tile.y, height, liveTowerAt));
    } else if (this.routingMode === "siege" && this.siegeTower && !this.siegeTower.isGhost) {
      const tower = this.siegeTower;
      if (canTraverseTile(this.grid, tower.tileX, tower.tileY, height, liveTowerAt)) {
        goals = [{ x: tower.tileX, y: tower.tileY }];
      } else {
        const neighbor = nearestTraversableNeighbor(this.grid, tower.tileX, tower.tileY, height, liveTowerAt, start);
        if (!neighbor) {
          this.releaseToDefault();
          return;
        }
        goals = [neighbor];
      }
    } else {
      const base = this.grid.getBase();
      goals = [{ x: base.x, y: base.y }];
    }

    const recovering = !canTraverseTile(this.grid, start.x, start.y, height, liveTowerAt);
    let planStart = start;
    const recoveryPoints: { x: number; y: number }[] = [];
    if (recovering) {
      const recover = nearestTraversableTile(this.grid, start.x, start.y, height, liveTowerAt);
      if (!recover) {
        this.flightPoints = [];
        this.flightCursor = 0;
        this.flightBuiltPathVersion = this.grid.pathVersion;
        warnUnreachableFlightOnce(this, `mode ${this.routingMode}, no traversable tile to recover onto`);
        return;
      }
      recoveryPoints.push(this.grid.tileToWorld(recover.x, recover.y));
      planStart = recover;
    }
    const route = planFlightRoute(this.grid, planStart, goals, height, liveTowerAt);
    // planFlightRoute drops goals it cannot reach, leaving [start]: the flyer would hover
    // with no signal. A 1-point plan is only legitimate when every goal is the tile the
    // flyer already occupies (hold/park in place). Any tower build/sell/ghost/restore
    // bumps pathVersion and replans, so a real hover resolves once the wall changes.
    const distantGoal = goals.some((goal) => goal.x !== planStart.x || goal.y !== planStart.y);
    if (route.length <= 1 && distantGoal) {
      warnUnreachableFlightOnce(this, `mode ${this.routingMode}, goals ${goals.length}`);
    } else {
      warnedUnreachableFlightIds.delete(this.id);
    }
    this.flightPoints = recovering ? recoveryPoints.concat(route.slice(1)) : route;
    this.flightCursor = 0;
    this.flightBuiltPathVersion = this.grid.pathVersion;
    const current = this.flightPoints[0];
    if (!current) return;
    this.lastMoveTargetWorld = { x: current.x, y: current.y };
    this.lastMoveTargetMode = this.routingMode;
  }

  private applyFlightAttack(deltaSeconds: number): void {
    if (this.routingMode === "siege") {
      const tower = this.siegeTower;
      if (!tower || tower.isGhost) {
        this.releaseToDefault();
        return;
      }
      if (this.motionLock !== "park" || this.stunTimer > 0 || this.attackingBase || tower.enemyAttackImmune) return;
      this.attackTimer -= deltaSeconds;
      if (this.attackTimer <= 0) {
        tower.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
      return;
    }
    if (this.routingMode !== "default" && this.routingMode !== "route") return;
    if (this.attackingBase || this.stunTimer > 0) return;
    const tile = this.currentTile();
    const occupancyKey = `${tile.x},${tile.y}`;
    const tower = this.towerAt(tile.x, tile.y);
    const liveTarget = !!tower && !tower.isGhost && !tower.enemyAttackImmune;
    if (occupancyKey !== this.strafeOccupancyKey) {
      this.strafeOccupancyKey = occupancyKey;
      if (liveTarget && tower) {
        tower.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
      return;
    }
    this.attackTimer -= deltaSeconds;
    if (liveTarget && tower && this.attackTimer <= 0) {
      tower.takeDamage(this.attackDamage, this);
      this.attackAnimTime = this._gameSeconds;
      this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
    }
  }
}
