import { UPGRADE_COST_REDUCTION_PCT, WAVE_GRAPH_MAX_SEND } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { GameEngine } from "@/sim/GameEngine.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { PersistState } from "./PersistState.js";
import type {
  EnemySnapshot,
  SimulationSnapshot,
  SnapshotMeta,
  StatusEffectSnapshot,
  TowerSnapshot,
  WaveGraphDot,
} from "./SimulationSnapshot.js";
import { SNAPSHOT_SCHEMA_VERSION } from "./SimulationSnapshot.js";

let nextFrameId = 1;

const EMPTY_STATUS_EFFECTS: StatusEffectSnapshot[] = Object.freeze([]) as unknown as StatusEffectSnapshot[];

export interface SnapshotCommandReceipt {
  commandId: number;
  applied: number;
  skipped: number;
  failedCommandId: number;
}

export function buildSnapshot(
  engine: GameEngine,
  lastAppliedCommandId: number,
  receipt?: SnapshotCommandReceipt,
  lastFailedCommandId?: number,
): SimulationSnapshot {
  const enemies = engine.enemyManager?.enemies ?? [];
  const towers = engine.towerManager?.towers ?? [];
  const persistState = engine.persistState;
  // Pure peek: do NOT consume here. WorkerEntry consumes particle + render-visual
  // buffers only after a successful postMessage, so effects produced on ticks the
  // renderer never drained survive to the next post instead of being discarded.
  const visualEffects = engine.projectileManager?.getRenderVisualEffects() ?? { lightning: [], stuns: [] };

  // The walkable navmesh corridor (`navMeshCorridor`) is shipped on a
  // pathVersion change, so a tower placement/sell re-ships the highlight.
  const grid = engine.grid;
  let pathVersionChanged = false;
  if (grid) {
    pathVersionChanged = grid.pathVersion !== engine.lastPostedPathVersion;
    if (pathVersionChanged) {
      engine.lastPostedPathVersion = grid.pathVersion;
    }
  }

  // Navmesh corridor highlight + nav field: ship on pathVersion change.
  let navMeshCorridor: SimulationSnapshot["navMeshCorridor"] = null;
  let navField: SimulationSnapshot["navField"] = null;
  if (pathVersionChanged) {
    if (engine.navMeshBuilder) {
      navMeshCorridor = engine.navMeshBuilder.getCorridorGeometry();
    }
    engine.navDistanceField?.ensureUpToDate(true);
    if (engine.navDistanceField) {
      const fieldSnapshot = engine.navDistanceField.getSnapshot();
      navField = {
        pathVersion: fieldSnapshot.pathVersion,
        distanceToBase: fieldSnapshot.distanceToBase,
        spawnReachable: fieldSnapshot.spawnReachable,
        pathMetrics: fieldSnapshot.pathMetrics,
      };
      if (fieldSnapshot.spawnPaths) navField.spawnPaths = fieldSnapshot.spawnPaths;
    }
  }

  // Commander grid-layout data feed: a constant map (0=terrain, 1=path, 2=base,
  // 3=spawn) built from engine.grid.tiles, plus a matching height array. Gated by
  // gridLayoutEnabled so it ships only until the commander caches it and toggles
  // the feed off. A progressive placement clears gridLayoutCache and gridHeightsCache
  // and turns the feed back on until the commander caches the new rectangle.
  let gridLayout: number[][] | undefined;
  if (grid && engine.gridLayoutEnabled) {
    if (engine.gridLayoutCache === null || engine.gridLayoutCacheRunId !== engine.runId) {
      engine.gridLayoutCache = grid.tiles.map((row) =>
        row.map((tile) => (tile.type === "path" ? 1 : tile.type === "base" ? 2 : tile.type === "spawn" ? 3 : 0)),
      );
      engine.gridLayoutCacheRunId = engine.runId;
    }
    gridLayout = engine.gridLayoutCache;
  }

  let heights: number[][] | undefined;
  if (grid && engine.gridLayoutEnabled) {
    if (engine.gridHeightsCache === null || engine.gridHeightsCacheRunId !== engine.runId) {
      engine.gridHeightsCache = grid.tiles.map((row) => row.map((tile) => tile.height));
      engine.gridHeightsCacheRunId = engine.runId;
    }
    heights = engine.gridHeightsCache;
  }

  const selectedTowerId = engine.runState.selectedTowerId;

  // Wave-graph dots only change shape every WAVE_GRAPH_INTERVAL_SECONDS (a dot
  // is flushed) or on a front-trim/dispose, so ship the dots window only when
  // the tracker's generation changed since the last posted snapshot. The worker
  // sends just the most recent WAVE_GRAPH_MAX_SEND dots; the main thread merges
  // them into its accumulation. The generation is always included so a change
  // stays detectable even when the window itself is omitted.
  const progressivePlacements =
    engine.layoutGeneration !== engine.lastPostedLayoutGeneration ? engine.progressivePlacements : undefined;
  if (progressivePlacements) engine.lastPostedLayoutGeneration = engine.layoutGeneration;

  const tracker = engine.waveGraphTracker;
  let waveGraphDots: WaveGraphDot[] | undefined;
  let waveGraphDotsGeneration = 0;
  if (tracker) {
    waveGraphDotsGeneration = tracker.getGeneration();
    if (tracker.getGeneration() !== engine.lastPostedWaveGraphGeneration) {
      waveGraphDots = tracker.getDots().slice(-WAVE_GRAPH_MAX_SEND);
      engine.lastPostedWaveGraphGeneration = waveGraphDotsGeneration;
    }
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    frameId: nextFrameId++,
    lastAppliedCommandId,
    lastFailedCommandId: lastFailedCommandId ?? receipt?.failedCommandId ?? 0,
    meta: buildMeta(
      engine,
      receipt ?? { commandId: lastAppliedCommandId, applied: 0, skipped: 0, failedCommandId: lastFailedCommandId ?? 0 },
    ),
    enemies: enemies.map((enemy) => snapshotEnemy(enemy, engine)),
    towers: towers.map((tower) => snapshotTower(tower, persistState, tower.id === selectedTowerId)),
    projectiles: engine.projectileManager?.getRenderData() ?? [],
    // Particles are a render-only main-thread effect (see Optimize.md Finding 7):
    // the worker no longer simulates them. It only buffers sparse spawn requests
    // and ships them when non-empty, so quiet ticks send nothing. Peeked (not
    // consumed) here; WorkerEntry consumes after a successful post.
    particleSpawns: engine.particleSpawner?.peekSpawns?.() ?? undefined,
    spawnStates: (engine.waveManager?.spawnStates ?? []).map((state, spawnIndex) => ({
      ...state,
      pendingCount: engine.enemyManager?.getPendingCountForSpawn(spawnIndex) ?? 0,
    })),
    navMeshCorridor,
    navField,
    lightningEffects: visualEffects.lightning.length > 0 ? visualEffects.lightning : undefined,
    stunEffects: visualEffects.stuns.length > 0 ? visualEffects.stuns : undefined,
    debugPhysics:
      engine.debugPhysicsEnabled && engine.physicsWorld
        ? { vertices: engine.physicsWorld.debugRenderVertices() }
        : null,
    waveGraphDots,
    waveGraphDotsGeneration,
    progressivePlacements,
    gridLayout,
    heights,
  };
}

function buildMeta(engine: GameEngine, receipt: SnapshotCommandReceipt): SnapshotMeta {
  const rs = engine.runState;
  const baseDefense = engine.baseDefenseSnapshot();
  return {
    state: rs.state,
    mapIndex: rs.mapIndex,
    baseHealth: rs.baseHealth,
    maxBaseHealth: rs.maxBaseHealth,
    gold: rs.gold,
    currentWave: rs.currentWave,
    waveCountdown: rs.waveCountdown,
    timeScale: rs.timeScale,
    commanderHold: rs.commanderHold,
    selectedTowerId: rs.selectedTowerId,
    selectedTowerType: rs.selectedTowerType,
    runGemsEarned: rs.runGemsEarned,
    bossesKilledThisRun: rs.bossesKilledThisRun,
    bossesReachedBaseThisRun: rs.bossesReachedBaseThisRun,
    lastScaledDt: engine.lastScaledDt,
    simSeconds: engine.simSeconds,
    droppedSimSeconds: engine.droppedSimSeconds ?? 0,
    pendingOverflowDropped: engine.enemyManager?.getPendingOverflowDroppedCount() ?? 0,
    waveTopTowers: engine.waveTopTowers,
    totalGoldEarned: engine.totalGoldEarned,
    totalHealingReceived: engine.totalHealingReceived,
    waveComposition: engine.waveManager?.waveComposition ?? {},
    endScreenData: rs.endScreenData,
    tileSize: engine.grid?.tileSize ?? 36,
    waveActive: engine.waveManager?.active ?? false,
    remainingScheduledSpawns: engine.waveManager?.getRemainingScheduledSpawns() ?? 0,
    runId: engine.runId,
    spawns: (engine.grid?.spawns ?? []).map((spawn, spawnIndex) => ({ spawnIndex, x: spawn.x, y: spawn.y })),
    spawnOrders: engine.enemyManager?.listSpawnOrders() ?? [],
    lastAppliedCommandId: receipt.commandId,
    lastAppliedCount: receipt.applied,
    lastSkippedCount: receipt.skipped,
    lastFailedCommandId: receipt.failedCommandId,
    progressivePlacementHold: engine.progressivePlacementHold,
    progressiveOffer: engine.progressiveOffer,
    progressiveUndoAvailable: engine.progressivePlacementUndo !== null,
    worldOriginX: engine.grid?.worldOriginX ?? 0,
    worldOriginY: engine.grid?.worldOriginY ?? 0,
    layoutGeneration: engine.layoutGeneration,
    ...(baseDefense !== undefined ? { baseDefense } : {}),
  };
}

function snapshotEnemy(e: Enemy, engine?: GameEngine): EnemySnapshot {
  const maxSlowRemaining = e.slowStack?.reduce((max, s) => Math.max(max, s.remaining), 0) ?? 0;
  const maxBurnRemaining = e.burnStack?.reduce((max, burnEntry) => Math.max(max, burnEntry.timer), 0) ?? 0;
  const totalBurnDps = e.burnStack?.reduce((sum, burnEntry) => sum + burnEntry.dps, 0) ?? 0;
  const tile = e.currentTile();
  const distanceToBase =
    e.flyingHeight > 0
      ? (engine?.flightDistanceField?.getDistanceToBase(tile.x, tile.y, e.flyingHeight) ?? -1)
      : (engine?.navDistanceField?.getDistanceToBase(tile.x, tile.y) ?? -1);
  return {
    id: e.id,
    type: e.type,
    x: e.x,
    y: e.y,
    radius: e.radius,
    hp: e.hp,
    maxHp: e.maxHp,
    shield: e.shield,
    maxShield: e.maxShield,
    angle: e.moveAngle,
    level: e.level,
    removed: e.removed,
    slowFactor: e.slowFactor,
    slowTimer: maxSlowRemaining,
    burnTimer: maxBurnRemaining,
    gameSeconds: e.gameSeconds,
    hitAnimTime: e.hitAnimTime,
    attackAnimTime: e.attackAnimTime,
    isBoss: e.type === "boss",
    statusEffects: buildEnemyStatusEffects(e, maxSlowRemaining, maxBurnRemaining, totalBurnDps),
    routingMode: e.routingMode,
    wave: e.wave,
    spawnIndex: e.spawnIndex,
    attackingBase: e.attackingBase,
    blockedByTowerTile: e.blockedByTower ? { x: e.blockedByTower.tileX, y: e.blockedByTower.tileY } : null,
    distanceToBase,
    flyingHeight: e.flyingHeight,
    nextCorner: e.nextCornerWorld(),
    targetingMode: e.targetingMode,
  };
}

function buildEnemyStatusEffects(
  e: Enemy,
  maxSlowRemaining: number,
  maxBurnRemaining: number,
  totalBurnDps: number,
): StatusEffectSnapshot[] {
  const hasEffects =
    e.slowFactor < 1 || e.stunTimer > 0 || maxBurnRemaining > 0 || e.shield > 0 || e.markTargetMult > 0;
  if (!hasEffects) return EMPTY_STATUS_EFFECTS;
  const effects: StatusEffectSnapshot[] = [];
  if (e.slowFactor < 1) {
    effects.push({ kind: "slow", remaining: maxSlowRemaining, magnitude: 1 - e.slowFactor });
  }
  if (e.stunTimer > 0) effects.push({ kind: "stun", remaining: e.stunTimer, magnitude: 1 });
  if (maxBurnRemaining > 0) effects.push({ kind: "burn", remaining: maxBurnRemaining, magnitude: totalBurnDps });
  if (e.shield > 0) effects.push({ kind: "shield", remaining: 0, magnitude: e.shield });
  if (e.markTargetMult > 0) effects.push({ kind: "mark", remaining: e.markTargetTimer, magnitude: e.markTargetMult });
  return effects;
}

function snapshotTower(t: Tower, persistState: PersistState, isSelected: boolean): TowerSnapshot {
  // Cheap per-tower path: only the visual/structural fields the render managers
  // and selection logic read every frame. The derived UI-decision fields
  // (sellValue, canUpgrade, levelCosts, milestoneBonus, upgradeCostAt5, stats)
  // are consumed ONLY by TowerPanel for the *selected* tower, so we compute them
  // once per tick for the single selected tower instead of every tower on the map.
  const base: TowerSnapshot = {
    id: t.id,
    type: t.type,
    x: t.x,
    y: t.y,
    tileX: t.tileX,
    tileY: t.tileY,
    level: t.level,
    variant: t.variant,
    angle: t.angle,
    cooldown: t.cooldown,
    targeting: t.targeting,
    totalInvested: t.totalInvested,
    waveDamage: t.waveDamage,
    totalDamageDealt: t.totalDamageDealt,
    fireAnimTime: t.fireAnimTime,
    fixedAimDir: t.fixedAimDir,
    isGhost: t.isGhost,
    health: t.health,
    maxHealth: t.maxHealth,
    color: t.color,
    animation: t.animation,
    base: { fixedAim: t.base.fixedAim ?? false },
    // Elapsed sim ms since place (_gameSeconds); TowerPanel cancel window uses this.
    placedAt: Math.round(t._gameSeconds * 1000),
  };

  if (!isSelected) return base;

  return {
    ...base,
    sellValue: t.sellValue(),
    canUpgrade: t.canUpgrade(persistState),
    levelCosts: [...t.levelCosts],
    milestoneBonus: t.currentMilestoneBonus(),
    upgradeCostAt5: (() => {
      const lv5Cost = t.upgradeCost(5);
      const ucrTier = persistState.generalAddons.upgradeCostReduction;
      if (ucrTier !== null && ucrTier !== undefined) {
        const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
        return Math.floor(lv5Cost * (1 - reduction));
      }
      return lv5Cost;
    })(),
    stats: {
      damage: t.stats.damage,
      range: t.stats.range,
      fireRate: t.stats.fireRate,
      splash: t.stats.splash,
      chain: t.stats.chain,
      groundOnly: t.stats.groundOnly,
    },
  };
}
