// @ts-nocheck
/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { WAVE_GRAPH_DOT_SPACING, WAVE_GRAPH_INTERVAL_SECONDS } from "@/sim/Constants.js";
import { ICE_AURA_RANGE, ICE_AURA_SLOW_MULT, STATIC_FIELD_RANGE, STATIC_FIELD_SLOW_AMT } from "@/sim/ConstantsTower.js";
import {
  Enemy,
  getNearestWalkableCacheStats,
  nearestWalkableTile,
  resetNearestWalkableCacheForTests,
} from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import {
  MAX_PARTICLES_PER_SPAWN,
  MAX_PENDING_PARTICLE_SPAWNS,
  NoopParticleSpawner,
  ParticleSystem,
  WorkerParticleSpawner,
} from "@/sim/ParticleSystem.js";
import { createDefaultPersistState } from "@/sim/PersistState.js";
import { ProjectileManager } from "@/sim/ProjectileManager.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { Tower } from "@/sim/towers/Tower.js";
import { WaveGraphTracker } from "@/sim/WaveGraphTracker.js";
import { makeBastionMap } from "../../helpers/mock-grid.js";

function makeTowerGrid() {
  const map = makeBastionMap();
  return {
    tileSize: 36,
    tiles: map.tiles,
    getBase: () => ({ x: map.base.x, y: map.base.y }),
    tileToWorld: (tileX: number, tileY: number) => ({ x: tileX * 36 + 18, y: tileY * 36 + 18 }),
    clearTowerGhost: () => {},
  };
}

function makeSaveWithAddon(towerType: string, addonIndex: number) {
  const save = createDefaultPersistState();
  save.unlocked[towerType].addons = [false, false, false];
  save.unlocked[towerType].addons[addonIndex] = true;
  return save;
}

function makeMockEnemy(opts: { id: number; x: number; y: number; hp?: number; maxHp?: number }) {
  return {
    id: opts.id,
    x: opts.x,
    y: opts.y,
    hp: opts.hp ?? 100,
    maxHp: opts.maxHp ?? 100,
    removed: false,
    takeDamage: vi.fn(),
    applyBurn: vi.fn(),
    applySlow: vi.fn(),
    applyStun: vi.fn(),
    applyMarkTarget: vi.fn(),
    applyAntiHeal: vi.fn(),
    applyKnockback: vi.fn(),
  };
}

describe("nearestWalkableTile memoization (Block D1-A)", () => {
  it("returns a shared result and counts memo hits for repeated lookups", () => {
    const grid = new Grid(makeBastionMap());
    resetNearestWalkableCacheForTests();
    const first = nearestWalkableTile(grid, 0, 0);
    const second = nearestWalkableTile(grid, 0, 0);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(getNearestWalkableCacheStats()).toEqual({ hits: 1, misses: 1 });
  });

  it("snaps a terrain tile to the nearest walkable tile", () => {
    const grid = new Grid(makeBastionMap());
    resetNearestWalkableCacheForTests();
    const snap = nearestWalkableTile(grid, 0, 0);
    const isWalkable = grid.isPath(snap.x, snap.y) || grid.isSpawn(snap.x, snap.y) || grid.isBase(snap.x, snap.y);
    expect(isWalkable).toBe(true);
    expect(snap).toEqual({ x: 0, y: 3 });
  });

  it("memoizes walkable tiles without recomputing a scan", () => {
    const grid = new Grid(makeBastionMap());
    resetNearestWalkableCacheForTests();
    const first = nearestWalkableTile(grid, 3, 3);
    const second = nearestWalkableTile(grid, 3, 3);
    expect(first).toEqual({ x: 3, y: 3 });
    expect(second).toBe(first);
    expect(getNearestWalkableCacheStats()).toEqual({ hits: 1, misses: 1 });
  });

  it("keeps a separate cache per grid instance", () => {
    const firstGrid = new Grid(makeBastionMap());
    const secondGrid = new Grid(makeBastionMap());
    resetNearestWalkableCacheForTests();
    nearestWalkableTile(firstGrid, 0, 0);
    nearestWalkableTile(secondGrid, 0, 0);
    expect(getNearestWalkableCacheStats()).toEqual({ hits: 0, misses: 2 });
  });
});

describe("sensor fallback contract (Block D1-B)", () => {
  it("EnemyManager.forEachSensorHits returns false with no physics world", () => {
    const grid = new Grid(makeBastionMap());
    const manager = new EnemyManager(grid, new NoopParticleSpawner(), 0);
    const seen: Enemy[] = [];
    expect(manager.forEachSensorHits("missing", (enemy) => seen.push(enemy))).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("returns false when the physics world has no matching sensor and true once registered", () => {
    const grid = new Grid(makeBastionMap());
    const physicsWorld = new PhysicsWorld(grid);
    const manager = new EnemyManager(grid, new NoopParticleSpawner(), 0);
    manager.setPhysicsWorld(physicsWorld);
    try {
      expect(manager.forEachSensorHits("missing", () => {})).toBe(false);
      physicsWorld.syncAuraSensors([{ sensorId: "present", x: 100, y: 100, radius: 50 }]);
      expect(manager.forEachSensorHits("present", () => {})).toBe(true);
    } finally {
      manager.setPhysicsWorld(null);
      physicsWorld.dispose();
    }
  });

  it("applies the frost aura through forEachEnemyInRange when the sensor is missing", () => {
    const tower = new Tower("ice", 3, 3, makeSaveWithAddon("ice", 0), makeTowerGrid());
    expect(tower.stats.frostAura).toBe(true);
    tower.targeting = "closest";
    tower.cachedTargetId = 1;
    tower.cooldown = 999;
    const appliedSlowAmounts: number[] = [];
    const cachedEnemy = { id: 1, x: tower.x + 5, y: tower.y, hp: 10, maxHp: 10, removed: false };
    const enemyManager = {
      enemies: [],
      getEnemiesInRange: vi.fn(() => []),
      forEachEnemyInRange: vi.fn((_x, _y, _range, callback) => {
        callback({
          ...cachedEnemy,
          applySlow: (amount: number) => appliedSlowAmounts.push(amount),
          takeDamage: () => 0,
        });
      }),
      getEnemyById: (id: number) => (id === 1 ? cachedEnemy : null),
      towerAt: () => null,
      forEachSensorHits: vi.fn(() => false),
    };
    tower.update(1 / 60, enemyManager, { spawn: vi.fn(), fireLightning: vi.fn() }, { playSound: vi.fn() });
    expect(enemyManager.forEachSensorHits).toHaveBeenCalledWith(`${tower.id}:frost`, expect.any(Function));
    expect(enemyManager.forEachEnemyInRange).toHaveBeenCalledTimes(1);
    expect(enemyManager.forEachEnemyInRange.mock.calls[0][2]).toBeCloseTo(ICE_AURA_RANGE * 36, 6);
    expect(appliedSlowAmounts).toEqual([tower.stats.slowAmt * ICE_AURA_SLOW_MULT]);
  });

  it("applies the static field through forEachEnemyInRange when the sensor is missing", () => {
    const tower = new Tower("lightning", 3, 3, makeSaveWithAddon("lightning", 0), makeTowerGrid());
    expect(tower.stats.staticField).toBe(true);
    tower.targeting = "closest";
    tower.cachedTargetId = 1;
    tower.cooldown = 999;
    const appliedSlowAmounts: number[] = [];
    const cachedEnemy = { id: 1, x: tower.x + 5, y: tower.y, hp: 10, maxHp: 10, removed: false };
    const enemyManager = {
      enemies: [],
      getEnemiesInRange: vi.fn(() => []),
      forEachEnemyInRange: vi.fn((_x, _y, _range, callback) => {
        callback({
          ...cachedEnemy,
          applySlow: (amount: number) => appliedSlowAmounts.push(amount),
          takeDamage: () => 0,
        });
      }),
      getEnemyById: (id: number) => (id === 1 ? cachedEnemy : null),
      towerAt: () => null,
      forEachSensorHits: vi.fn(() => false),
    };
    tower.update(1 / 60, enemyManager, { spawn: vi.fn(), fireLightning: vi.fn() }, { playSound: vi.fn() });
    expect(enemyManager.forEachEnemyInRange).toHaveBeenCalledTimes(1);
    expect(enemyManager.forEachEnemyInRange.mock.calls[0][2]).toBeCloseTo(STATIC_FIELD_RANGE * 36, 6);
    expect(appliedSlowAmounts).toEqual([STATIC_FIELD_SLOW_AMT]);
  });

  it("skips the static field fallback when the sensor is present", () => {
    const tower = new Tower("lightning", 3, 3, makeSaveWithAddon("lightning", 0), makeTowerGrid());
    tower.targeting = "closest";
    tower.cachedTargetId = 1;
    tower.cooldown = 999;
    const cachedEnemy = { id: 1, x: tower.x + 5, y: tower.y, hp: 10, maxHp: 10, removed: false };
    const enemyManager = {
      enemies: [],
      getEnemiesInRange: vi.fn(() => []),
      forEachEnemyInRange: vi.fn(),
      getEnemyById: (id: number) => (id === 1 ? cachedEnemy : null),
      towerAt: () => null,
      forEachSensorHits: vi.fn(() => true),
    };
    tower.update(1 / 60, enemyManager, { spawn: vi.fn(), fireLightning: vi.fn() }, { playSound: vi.fn() });
    expect(enemyManager.forEachSensorHits).toHaveBeenCalledWith(`${tower.id}:static`, expect.any(Function));
    expect(enemyManager.forEachEnemyInRange).not.toHaveBeenCalled();
  });

  it("healer enemy falls back to forEachEnemyInRange when its heal sensor is missing", () => {
    const grid = new Grid(makeBastionMap());
    const healer = new Enemy("healer", 1, 0, grid, 1);
    const usedRanges: number[] = [];
    const enemyManager = {
      enemies: [healer],
      getEnemiesInRange: () => [],
      forEachEnemyInRange: (_x, _y, range) => {
        usedRanges.push(range);
      },
      liveTowers: () => [],
      forEachSensorHits: () => false,
    };
    healer.computeIntent(1 / 60, enemyManager);
    expect(usedRanges).toContain(healer.healRange);
  });
});

describe("applySlow float-noise dedup (Block D1-A)", () => {
  it("merges near-identical slow strengths into one stack entry", () => {
    const grid = new Grid(makeBastionMap());
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    for (let sourceIndex = 0; sourceIndex < 50; sourceIndex++) {
      enemy.applySlow(0.3 + sourceIndex * 1e-9, 1);
    }
    expect(enemy.slowStack).toHaveLength(1);
    expect(enemy.slowStack[0].eff).toBe(0.3);
  });

  it("still keeps genuinely distinct strengths as separate entries", () => {
    const grid = new Grid(makeBastionMap());
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.applySlow(0.3, 1);
    enemy.applySlow(0.5, 2);
    expect(enemy.slowStack).toHaveLength(2);
    expect(enemy.slowFactor).toBeCloseTo(0.7 * 0.5, 6);
  });
});

describe("Tower targeting visitor paths (Block D1-D)", () => {
  it("fixed-aim with a valid cached target does not scan either range path", () => {
    const tower = new Tower("railgun", 3, 3, createDefaultPersistState(), makeTowerGrid());
    tower.fixedAimDir = "E";
    tower.cachedTargetId = 7;
    const cachedEnemy = { id: 7, x: tower.x + 50, y: tower.y, hp: 100, maxHp: 100, removed: false };
    const enemyManager = {
      enemies: [cachedEnemy],
      getEnemiesInRange: vi.fn(() => [cachedEnemy]),
      forEachEnemyInRange: vi.fn(),
      getEnemyById: (id: number) => (id === 7 ? cachedEnemy : null),
      towerAt: () => null,
    };
    const projectileManager = { spawn: vi.fn(), fireLightning: vi.fn() };
    tower.update(1 / 60, enemyManager, projectileManager, { playSound: vi.fn() });
    expect(enemyManager.getEnemiesInRange).not.toHaveBeenCalled();
    expect(enemyManager.forEachEnemyInRange).not.toHaveBeenCalled();
    expect(projectileManager.spawn).toHaveBeenCalledTimes(1);
  });

  it("fixed-aim scan falls back to the visitor when the cached target is gone", () => {
    const tower = new Tower("railgun", 3, 3, createDefaultPersistState(), makeTowerGrid());
    tower.fixedAimDir = "E";
    tower.cachedTargetId = 7;
    const forwardEnemy = { id: 8, x: tower.x + 50, y: tower.y, hp: 100, maxHp: 100, removed: false };
    const enemyManager = {
      enemies: [forwardEnemy],
      getEnemiesInRange: vi.fn(() => [forwardEnemy]),
      forEachEnemyInRange: vi.fn((_x, _y, _range, callback) => callback(forwardEnemy)),
      getEnemyById: () => null,
      towerAt: () => null,
    };
    const projectileManager = { spawn: vi.fn(), fireLightning: vi.fn() };
    tower.update(1 / 60, enemyManager, projectileManager, { playSound: vi.fn() });
    expect(enemyManager.getEnemiesInRange).not.toHaveBeenCalled();
    expect(enemyManager.forEachEnemyInRange).toHaveBeenCalledTimes(1);
    expect(projectileManager.spawn).toHaveBeenCalledTimes(1);
  });

  it("range-0 sturdy wall skips the targeting scan entirely", () => {
    const tower = new Tower("sturdyWall", 3, 3, createDefaultPersistState(), makeTowerGrid());
    expect(tower.stats.range).toBe(0);
    const enemyManager = {
      enemies: [],
      getEnemiesInRange: vi.fn(() => []),
      forEachEnemyInRange: vi.fn(),
      getEnemyById: () => null,
      towerAt: () => null,
    };
    tower.update(1 / 60, enemyManager, { spawn: vi.fn(), fireLightning: vi.fn() }, { playSound: vi.fn() });
    expect(enemyManager.getEnemiesInRange).not.toHaveBeenCalled();
    expect(enemyManager.forEachEnemyInRange).not.toHaveBeenCalled();
  });
});

describe("ProjectileManager id index (Block D1-F)", () => {
  it("resolves the contact projectile by id and retains the impact frame one tick", () => {
    const grid = new Grid(makeBastionMap());
    const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0);
    const firstEnemy = enemyManager.spawn("minion", 1, 0, 1);
    const secondEnemy = enemyManager.spawn("minion", 1, 0, 1);
    firstEnemy.x = 500;
    firstEnemy.y = 100;
    secondEnemy.x = 600;
    secondEnemy.y = 100;
    const manager = new ProjectileManager(enemyManager, new ParticleSystem(), null, {
      width: grid.width,
      height: grid.height,
      tileSize: grid.tileSize,
      tiles: grid.tiles,
      blocked: grid.blocked,
    });
    manager.spawn({
      x: 0,
      y: 0,
      damage: 10,
      speed: 10,
      range: 30,
      towerType: "basic",
      towerLevel: 1,
      targetId: firstEnemy.id,
      targetX: 500,
      targetY: 100,
    });
    manager.spawn({
      x: 0,
      y: 0,
      damage: 20,
      speed: 10,
      range: 30,
      towerType: "basic",
      towerLevel: 1,
      targetId: secondEnemy.id,
      targetX: 600,
      targetY: 100,
    });
    const renderIds = manager.getRenderData().map((entry) => entry.id);
    const secondProjectileId = renderIds[1]!;
    const firstHpBefore = firstEnemy.hp;
    const secondHpBefore = secondEnemy.hp;

    manager.postPhysics(1 / 60, [{ projectileId: secondProjectileId, enemyId: secondEnemy.id }]);
    expect(secondEnemy.hp).toBeLessThan(secondHpBefore);
    expect(firstEnemy.hp).toBe(firstHpBefore);
    expect(manager.getRenderData().map((entry) => entry.id)).toContain(secondProjectileId);

    manager.prePhysics(1 / 60);
    expect(manager.getRenderData().map((entry) => entry.id)).not.toContain(secondProjectileId);

    // The index entry is dropped with the list entry, so a stale contact for the
    // removed projectile no longer resolves.
    const staleHp = secondEnemy.hp;
    manager.postPhysics(1 / 60, [{ projectileId: secondProjectileId, enemyId: secondEnemy.id }]);
    expect(secondEnemy.hp).toBe(staleHp);
  });
});

describe("cannon splash visitor (Block D1-F3)", () => {
  it("damages nearby enemies without calling getEnemiesInRange", () => {
    const primary = makeMockEnemy({ id: 1, x: 100, y: 100 });
    const nearby = makeMockEnemy({ id: 2, x: 120, y: 100 });
    const farAway = makeMockEnemy({ id: 3, x: 400, y: 100 });
    const enemies = [primary, nearby, farAway];
    const enemyManager = {
      enemies,
      getEnemiesInRange: vi.fn(() => {
        throw new Error("splash must use the visitor, not getEnemiesInRange");
      }),
      forEachEnemyInRange(x, y, range, callback) {
        for (const enemy of enemies) {
          if (enemy.removed) continue;
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= range * range) callback(enemy);
        }
      },
      getEnemyById: (id) => enemies.find((enemy) => enemy.id === id) ?? null,
      castShapePierce: () => {},
    };
    const manager = new ProjectileManager(enemyManager, new ParticleSystem(), null, {
      width: 10,
      height: 10,
      tileSize: 36,
      tiles: [],
      blocked: new Set(),
    });
    manager.spawn({
      x: 100,
      y: 100,
      damage: 10,
      speed: 100,
      range: 5,
      towerType: "cannon",
      towerLevel: 1,
      targetId: primary.id,
      splash: 1,
    });
    manager.postPhysics(1 / 60, [{ projectileId: 1, enemyId: primary.id }]);
    expect(primary.takeDamage).toHaveBeenCalledTimes(1);
    expect(nearby.takeDamage).toHaveBeenCalledTimes(1);
    expect(farAway.takeDamage).not.toHaveBeenCalled();
    expect(enemyManager.getEnemiesInRange).not.toHaveBeenCalled();
  });
});

describe("ParticleSystem hot-loop bounds (Block D1-G)", () => {
  it("clamps a single spawn call to MAX_PARTICLES_PER_SPAWN", () => {
    const system = new ParticleSystem(() => 0.25);
    system.spawn(0, 0, "#fff", 1000, {});
    expect(system.particles).toHaveLength(MAX_PARTICLES_PER_SPAWN);
  });

  it("damping is dt-correct: two half steps match one full step", () => {
    const fullStep = new ParticleSystem(() => 0.25);
    const halfStep = new ParticleSystem(() => 0.25);
    fullStep.spawn(0, 0, "#fff", 1, { speed: 60, life: 1 });
    halfStep.spawn(0, 0, "#fff", 1, { speed: 60, life: 1 });
    fullStep.update(0.002);
    halfStep.update(0.001);
    halfStep.update(0.001);
    expect(halfStep.particles[0].deltaX).toBeCloseTo(fullStep.particles[0].deltaX, 8);
    expect(halfStep.particles[0].deltaY).toBeCloseTo(fullStep.particles[0].deltaY, 8);
    expect(halfStep.particles[0].ox).toBeCloseTo(fullStep.particles[0].ox, 4);
  });

  it("getRenderData reuses its buffer but reflects the live particle set", () => {
    const system = new ParticleSystem(() => 0.25);
    system.spawn(0, 0, "#fff", 2, {});
    const first = system.getRenderData();
    expect(first).toHaveLength(2);
    system.spawn(0, 0, "#fff", 1, {});
    const second = system.getRenderData();
    expect(second).toBe(first);
    expect(second).toHaveLength(3);
  });

  it("WorkerParticleSpawner caps the buffer with a drop-oldest policy", () => {
    const spawner = new WorkerParticleSpawner();
    for (let index = 0; index < MAX_PENDING_PARTICLE_SPAWNS + 10; index++) {
      spawner.spawn(index, index, "#fff", 1, {});
    }
    const buffered = spawner.consumeSpawns();
    expect(buffered).toHaveLength(MAX_PENDING_PARTICLE_SPAWNS);
    expect(buffered[0].x).toBe(10);
    expect(buffered[buffered.length - 1].x).toBe(MAX_PENDING_PARTICLE_SPAWNS + 9);
    expect(spawner.consumeSpawns()).toBeUndefined();
  });
});

describe("WaveGraphTracker flush semantics (Block D1-H)", () => {
  function makeTracker(enemiesRuntime = []) {
    const runState = { baseHealth: 100, maxBaseHealth: 100 };
    const persistState = { gems: 0 };
    const towerManager = { towers: [] };
    const enemyManager = { enemies: enemiesRuntime };
    return { tracker: new WaveGraphTracker(runState, persistState, towerManager, enemyManager), enemyManager };
  }

  it("keeps interval overshoot instead of resetting the accumulator to zero", () => {
    const { tracker } = makeTracker();
    tracker.update(WAVE_GRAPH_INTERVAL_SECONDS + 0.7);
    expect(tracker.getDots()).toHaveLength(1);
    tracker.update(WAVE_GRAPH_INTERVAL_SECONDS - 0.7 + 0.01);
    expect(tracker.getDots()).toHaveLength(2);
  });

  it("bumps generation when setContainerWidth trims the dot window", () => {
    const { tracker } = makeTracker();
    tracker.update(WAVE_GRAPH_INTERVAL_SECONDS);
    tracker.update(WAVE_GRAPH_INTERVAL_SECONDS);
    tracker.update(WAVE_GRAPH_INTERVAL_SECONDS);
    expect(tracker.getDots()).toHaveLength(3);
    const generationBefore = tracker.getGeneration();
    tracker.setContainerWidth(WAVE_GRAPH_DOT_SPACING);
    expect(tracker.getDots()).toHaveLength(1);
    expect(tracker.getGeneration()).toBe(generationBefore + 1);
  });

  it("samples the enemy-HP peak at flush time", () => {
    const { tracker, enemyManager } = makeTracker([{ hp: 100 }]);
    tracker.update(WAVE_GRAPH_INTERVAL_SECONDS / 2);
    enemyManager.enemies[0].hp = 500;
    tracker.update(0.001);
    enemyManager.enemies[0].hp = 10;
    tracker.update(WAVE_GRAPH_INTERVAL_SECONDS / 2);
    const dots = tracker.getDots();
    expect(dots).toHaveLength(1);
    expect(dots[0].peakEnemyHp).toBe(10);
  });
});
