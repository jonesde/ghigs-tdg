// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager, gameplayEnemyCap, maxPendingPerSpawn } from "@/sim/enemies/EnemyManager.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { initRunState } from "@/sim/GameRunState.js";
import { Grid } from "@/sim/grid/Grid.js";
import { mulberry32 } from "@/sim/grid/Map.js";
import { ParticleSystem } from "@/sim/ParticleSystem.js";
import {
  createDefaultPersistState,
  difficultyMultiplier,
  stampRunHistoryDate,
  workerRunDateSentinel,
} from "@/sim/PersistState.js";
import { ProjectileManager } from "@/sim/ProjectileManager.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { computeStepBudget, fixedDeltaSeconds } from "@/sim/stepBudget.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";
import { makeBastionMap, makeSplitMap } from "../../helpers/mock-grid";
import { makeParticleSystem } from "../../helpers/mock-managers";
import {
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
  mockDefaultTheme,
} from "../../helpers/mock-stores";

function makeEnemyManager(mapData: ReturnType<typeof makeBastionMap>) {
  resetEnemyId();
  const grid = new Grid(mapData);
  const particles = makeParticleSystem();
  return new EnemyManager(grid, particles, 0);
}

function makeEngine() {
  const engine = new GameEngine(
    createTestPersistState(),
    createTestThemeBundle(mockDefaultTheme),
    new MockHostBindings(),
    0,
  );
  engine.loadMap(0);
  return engine;
}

describe("Block C spawn queues and determinism", () => {
  it("bounds pending queues no matter how much overflow piles up", () => {
    const enemyManager = makeEnemyManager(makeBastionMap());
    for (let index = 0; index < gameplayEnemyCap; index++) {
      enemyManager.spawn("minion", 1, 0, 1);
    }
    for (let index = 0; index < maxPendingPerSpawn * 3; index++) {
      enemyManager.enqueueOrSpawn("minion", 1, 0, 1);
    }
    expect(enemyManager.getTotalPendingCount()).toBeLessThanOrEqual(maxPendingPerSpawn);
    expect(enemyManager.getPendingOverflowDroppedCount()).toBeGreaterThan(0);
  });

  it("drains per tick from the most-backlogged spawn so immortal base-attackers never pin freed slots", () => {
    const enemyManager = makeEnemyManager(makeSplitMap());
    for (let index = 0; index < gameplayEnemyCap / 2; index++) {
      const attacker = enemyManager.spawn("minion", 1, 0, 1);
      attacker.attackingBase = true;
      attacker.hp = 1e9;
      attacker.maxHp = 1e9;
    }
    for (let index = 0; index < gameplayEnemyCap / 2; index++) {
      enemyManager.spawn("minion", 1, 1, 1);
    }
    expect(enemyManager.enemies.length).toBe(gameplayEnemyCap);
    for (let index = 0; index < 60; index++) {
      enemyManager.enqueueOrSpawn("minion", 1, 0, 1);
    }
    expect(enemyManager.getPendingCountForSpawn(0)).toBe(60);
    for (let index = enemyManager.enemies.length - 1; index >= 0; index--) {
      if (enemyManager.enemies[index].spawnIndex === 1) enemyManager.removeDeadEnemy(index);
    }
    expect(enemyManager.enemies.length).toBe(gameplayEnemyCap / 2);
    enemyManager.drainPendingQueues();
    expect(enemyManager.enemies.length).toBe(gameplayEnemyCap);
    expect(enemyManager.getPendingCountForSpawn(0)).toBe(10);
  });

  it("counts queue plus overflow backlog in getRemainingScheduledSpawns", () => {
    const mapData = makeBastionMap();
    const enemyManager = makeEnemyManager(mapData);
    const waveManager = new WaveManager(mapData, enemyManager);
    for (let index = 0; index < gameplayEnemyCap; index++) {
      enemyManager.spawn("minion", 1, 0, 1);
    }
    waveManager.startNextWave();
    for (let index = 0; index < 25; index++) {
      enemyManager.enqueueOrSpawn("minion", 1, 0, 1);
    }
    expect(enemyManager.getTotalPendingCount()).toBe(25);
    expect(waveManager.getRemainingScheduledSpawns()).toBe(waveManager.queue.length + 25);
    expect(waveManager.getRemainingScheduledSpawns()).toBeGreaterThan(waveManager.queue.length);
  });

  it("routes timer expiry through onWaveExpired and falls back to onWaveCleared", () => {
    const mapData = makeBastionMap();
    const firstManager = makeEnemyManager(mapData);
    const firstWaves = new WaveManager(mapData, firstManager);
    firstWaves.startNextWave();
    firstManager.spawn("minion", 1, 0, 1);
    firstWaves.queue = [];
    let expiredWave: number | null = null;
    let clearedWave: number | null = null;
    firstWaves.update(
      getGameContent().economy.preEmptiveWaveTimer + 1,
      (wave) => {
        clearedWave = wave;
      },
      null,
      (wave) => {
        expiredWave = wave;
      },
    );
    expect(expiredWave).toBe(1);
    expect(clearedWave).toBeNull();
    expect(firstWaves.currentWave).toBe(2);

    const secondManager = makeEnemyManager(mapData);
    const secondWaves = new WaveManager(mapData, secondManager);
    secondWaves.startNextWave();
    secondManager.spawn("minion", 1, 0, 1);
    secondWaves.queue = [];
    let fallbackWave: number | null = null;
    secondWaves.update(
      getGameContent().economy.preEmptiveWaveTimer + 1,
      (wave) => {
        fallbackWave = wave;
      },
      null,
    );
    expect(fallbackWave).toBe(1);
  });

  it("replays identical crit/marksman rolls from the same seed", () => {
    const rollCombatSequence = (seed: number) => {
      const grid = new Grid(makeBastionMap());
      const fakeEnemies = { getEnemyById: () => null, enemies: [] };
      const manager = new ProjectileManager(fakeEnemies, makeParticleSystem(), null, grid, mulberry32(seed));
      for (let index = 0; index < 200; index++) {
        manager.spawn({
          x: 0,
          y: 0,
          damage: 10,
          speed: 100,
          range: 5,
          towerType: "basic",
          towerLevel: 1,
          targetId: 0,
          targetX: 10,
          targetY: 0,
          critChance: 0.5,
          marksman: true,
        });
      }
      return manager.projectiles.map((projectile) => [projectile.isCrit, projectile.marksman]);
    };
    expect(rollCombatSequence(12345)).toEqual(rollCombatSequence(12345));
    expect(rollCombatSequence(12345)).not.toEqual(rollCombatSequence(999));
  });

  it("replays identical lightning chains from the same seed", () => {
    const runLightning = (seed: number) => {
      const liveEnemies = [];
      for (let index = 0; index < 6; index++) {
        const enemyId = index + 1;
        liveEnemies.push({
          id: enemyId,
          x: index * 20,
          y: 0,
          removed: false,
          hp: 1000,
          maxHp: 1000,
          takeDamage(damage: number) {
            this.hp -= damage;
            return damage;
          },
          applyStun() {},
          applyBurn() {},
        });
      }
      const fakeEnemies = {
        enemies: liveEnemies,
        getEnemyById(enemyId: number) {
          return liveEnemies.find((enemy) => enemy.id === enemyId && !enemy.removed) ?? null;
        },
        getEnemiesInRange(x: number, y: number, range: number) {
          return liveEnemies.filter((enemy) => Math.hypot(enemy.x - x, enemy.y - y) <= range);
        },
        forEachEnemyInRange(x: number, y: number, range: number, callback: (enemy: unknown) => void) {
          for (const enemy of liveEnemies) {
            if (Math.hypot(enemy.x - x, enemy.y - y) <= range) callback(enemy);
          }
        },
      };
      const grid = new Grid(makeBastionMap());
      const manager = new ProjectileManager(fakeEnemies, makeParticleSystem(), null, grid, mulberry32(seed));
      manager.fireLightning({
        originX: 0,
        originY: 0,
        damage: 50,
        towerLevel: 6,
        targetId: 1,
        stunDuration: 0.5,
        doubleDischarge: 0.5,
        critChance: 0.5,
        stormcall: true,
        chain: 3,
      });
      return { effects: manager.getRenderVisualEffects(), health: liveEnemies.map((enemy) => enemy.hp) };
    };
    expect(runLightning(4242)).toEqual(runLightning(4242));
    expect(runLightning(4242)).not.toEqual(runLightning(777));
  });

  it("replays identical particle scatter from the same seed", () => {
    const scatterParticles = (seed: number) => {
      const system = new ParticleSystem(mulberry32(seed));
      system.spawn(10, 20, "#ffffff", 25, { speed: 60, life: 0.5 });
      return system.particles;
    };
    expect(scatterParticles(777)).toEqual(scatterParticles(777));
    expect(scatterParticles(777)).not.toEqual(scatterParticles(778));
  });

  it("budgets fixed steps without dropping under steady load and counts drops under overload", () => {
    const steady = computeStepBudget(0, fixedDeltaSeconds, 1);
    expect(steady.steps).toBe(1);
    expect(steady.droppedSeconds).toBe(0);
    expect(steady.accumulator).toBeCloseTo(0, 10);

    const overload = computeStepBudget(0, 10, 8);
    expect(overload.steps).toBe(64);
    expect(overload.droppedSeconds).toBeCloseTo(10 - 64 * fixedDeltaSeconds, 10);
    expect(overload.accumulator).toBeLessThan(fixedDeltaSeconds);
  });

  it("stores a date sentinel in worker runHistory until the host stamps it", () => {
    const engine = makeEngine();
    engine.endGame(false);
    const history = engine.persistState.runHistory;
    const lastEntry = history[history.length - 1];
    expect(lastEntry.date).toBe(workerRunDateSentinel);
    expect(lastEntry.date).toBe(0);
    stampRunHistoryDate(lastEntry, 123456789);
    expect(lastEntry.date).toBe(123456789);
    const alreadyStamped = { date: 111 };
    stampRunHistoryDate(alreadyStamped, 222);
    expect(alreadyStamped.date).toBe(111);
  });

  it("exposes dropped sim seconds in snapshot meta defaulting to zero", () => {
    const engine = makeEngine();
    expect(buildSnapshot(engine, 0).meta.droppedSimSeconds).toBe(0);
    engine.droppedSimSeconds = 1.5;
    expect(buildSnapshot(engine, 0).meta.droppedSimSeconds).toBe(1.5);
  });

  it("re-includes a ghosted tower in liveTowers after it is restored", () => {
    const engine = makeEngine();
    const firstTower = engine.towerManager!.build("basic", 2, 2, engine.persistState, engine.grid!);
    const secondTower = engine.towerManager!.build("basic", 4, 2, engine.persistState, engine.grid!);
    expect(firstTower).not.toBeNull();
    expect(secondTower).not.toBeNull();
    expect(engine.enemyManager!.liveTowers()).toHaveLength(2);

    firstTower!.isGhost = true;
    engine.grid!.setTowerGhost(2, 2);
    expect(engine.enemyManager!.liveTowers()).toHaveLength(1);

    firstTower!.isGhost = false;
    engine.grid!.clearTowerGhost(2, 2);
    const restored = engine.enemyManager!.liveTowers();
    expect(restored).toHaveLength(2);
    expect(restored).toContain(firstTower);
  });

  it("excludes a 0-health tower from liveTowers even when it was cached first", () => {
    const engine = makeEngine();
    const tower = engine.towerManager!.build("basic", 2, 2, engine.persistState, engine.grid!);
    expect(tower).not.toBeNull();
    const cachedLiveTowers = engine.enemyManager!.liveTowers();
    expect(cachedLiveTowers).toHaveLength(1);
    expect(cachedLiveTowers[0]).toBe(tower);

    tower!.health = 0;
    expect(engine.enemyManager!.liveTowers()).toHaveLength(0);
  });

  it("drains a pending backlog on a single engine.update without any enemy death", () => {
    const engine = makeEngine();
    const enemyManager = engine.enemyManager!;
    for (let index = 0; index < 5; index++) {
      enemyManager.enqueuePending("minion", 1, 0, 1);
    }
    expect(enemyManager.getTotalPendingCount()).toBe(5);
    const drainSpy = vi.spyOn(enemyManager, "drainPendingQueues");
    engine.update(fixedDeltaSeconds);
    expect(drainSpy).toHaveBeenCalledTimes(1);
    expect(enemyManager.getTotalPendingCount()).toBe(0);
    expect(enemyManager.enemies).toHaveLength(5);
  });

  it("exposes pending overflow drops in snapshot meta", () => {
    const engine = makeEngine();
    expect(buildSnapshot(engine, 0).meta.pendingOverflowDropped).toBe(0);
    const enemyManager = engine.enemyManager!;
    for (let index = 0; index < maxPendingPerSpawn + 1; index++) {
      enemyManager.enqueuePending("minion", 1, 0, 1);
    }
    expect(enemyManager.getPendingOverflowDroppedCount()).toBe(1);
    expect(buildSnapshot(engine, 0).meta.pendingOverflowDropped).toBe(1);
  });

  it("preserves pending overflow drops across enemy clear (endGame/killAll)", () => {
    const engine = makeEngine();
    const enemyManager = engine.enemyManager!;
    for (let index = 0; index < maxPendingPerSpawn + 1; index++) {
      enemyManager.enqueuePending("minion", 1, 0, 1);
    }
    expect(enemyManager.getPendingOverflowDroppedCount()).toBe(1);
    // clear() runs on endGame and debug killAll; per-run telemetry must survive
    // so the terminal snapshot still reports the drops that actually happened.
    enemyManager.clear();
    expect(enemyManager.getPendingOverflowDroppedCount()).toBe(1);
    expect(buildSnapshot(engine, 0).meta.pendingOverflowDropped).toBe(1);

    engine.loadMap(0);
    expect(engine.enemyManager!.getPendingOverflowDroppedCount()).toBe(0);
  });

  it("rejects unknown region ids in initRunState instead of minting undefined gold", () => {
    expect(() => initRunState({}, 0, { ...makeBastionMap(), regionId: 99 }, null)).toThrow(RangeError);
    const validState = {};
    initRunState(validState, 0, makeBastionMap(), null);
    expect(validState.gold).toBe(getGameContent().economy.startingGoldByRegion[0]);
  });

  it("clamps difficultyMultiplier at 1x for corrupt ticks", () => {
    const negativeState = createDefaultPersistState();
    negativeState.difficulty.multiplierTick = -5;
    expect(difficultyMultiplier(negativeState)).toBe(1);
    const nanState = createDefaultPersistState();
    nanState.difficulty.multiplierTick = NaN;
    expect(difficultyMultiplier(nanState)).toBe(1);
    const boostedState = createDefaultPersistState();
    boostedState.difficulty.multiplierTick = 4;
    expect(difficultyMultiplier(boostedState)).toBe(2);
  });
});
