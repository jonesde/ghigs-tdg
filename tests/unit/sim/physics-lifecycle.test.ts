// @ts-nocheck
/** @vitest-environment jsdom */

import type RAPIER from "@dimforge/rapier2d-compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "@/sim/Command.js";
import type { CommandDispatcher } from "@/sim/CommandDispatcher.js";
import {
  advanceCommandBusEpoch,
  dispatchCommand,
  getCommandBusEpoch,
  resetCommandBusForTests,
  setCommandDispatcher,
} from "@/sim/commandBus.js";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager, restoreCrowdAgentVelocity } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { initNavMesh, isNavMeshInitialized, resetNavMeshContextForTests } from "@/sim/navmesh/recastContext.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import { parseColliderTag } from "@/sim/physics/ColliderUserData.js";
import { ContactProcessor } from "@/sim/physics/ContactProcessor.js";
import { launchEnemy } from "@/sim/physics/launchEnemy.js";
import {
  getPhysicsQueryBallAllocations,
  PhysicsWorld,
  resetPhysicsQueryStatsForTests,
} from "@/sim/physics/PhysicsWorld.js";
import { initPhysics, isPhysicsInitialized, resetPhysicsContextForTests } from "@/sim/physics/rapierContext.js";
import { separateEnemiesFromTowers } from "@/sim/physics/separateEnemiesFromTowers.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import { splitGenerationCommands, stampSnapshotGeneration } from "@/sim/WorkerEntry.js";
import { makeBastionMap } from "../../helpers/mock-grid.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../../helpers/mock-stores.js";

function makeGrid(): Grid {
  return new Grid(makeBastionMap());
}

function fakeBody(userData: unknown): RAPIER.RigidBody {
  return { userData } as unknown as RAPIER.RigidBody;
}

function fakeTower(towerId: string, health: number): Tower {
  return { id: towerId, health, isGhost: false, enemyAttackImmune: false } as unknown as Tower;
}

function physicsTower(towerId: string, tileX: number, tileY: number, grid: Grid): Tower {
  const center = grid.tileToWorld(tileX, tileY);
  return {
    id: towerId,
    tileX,
    tileY,
    x: center.x,
    y: center.y,
    isGhost: false,
    health: 100,
    enemyAttackImmune: false,
  } as unknown as Tower;
}

function towerManagerWith(towers: Tower[]): TowerManager {
  return { towers } as unknown as TowerManager;
}

function spawnWiredEnemy(grid: Grid, physicsWorld: PhysicsWorld, crowdManager: CrowdManager | null): Enemy {
  const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
  enemyManager.setPhysicsWorld(physicsWorld);
  if (crowdManager) enemyManager.setCrowdManager(crowdManager);
  return enemyManager.spawn("minion", 1, 0, 1)!;
}

describe("ColliderUserData.parseColliderTag", () => {
  it("accepts fully-formed tags for every kind", () => {
    expect(parseColliderTag({ kind: "base" })).toEqual({ kind: "base" });
    expect(parseColliderTag({ kind: "corridor" })).toEqual({ kind: "corridor" });
    expect(parseColliderTag({ kind: "enemy", enemyId: 7 })).toEqual({ kind: "enemy", enemyId: 7 });
    expect(parseColliderTag({ kind: "tower", towerId: "tower-1", tileX: 2, tileY: 3 })).toEqual({
      kind: "tower",
      towerId: "tower-1",
      tileX: 2,
      tileY: 3,
    });
    expect(parseColliderTag({ kind: "projectile", projectileId: 4 })).toEqual({ kind: "projectile", projectileId: 4 });
    expect(parseColliderTag({ kind: "sensor", sensorId: "tower-1:frost" })).toEqual({
      kind: "sensor",
      sensorId: "tower-1:frost",
    });
  });

  it("returns null on shape mismatch for every kind", () => {
    expect(parseColliderTag(null)).toBeNull();
    expect(parseColliderTag({ kind: "tower" })).toBeNull();
    expect(parseColliderTag({ kind: "tower", towerId: 9, tileX: 1, tileY: 1 })).toBeNull();
    expect(parseColliderTag({ kind: "enemy", enemyId: "7" })).toBeNull();
    expect(parseColliderTag({ kind: "enemy", enemyId: Number.NaN })).toBeNull();
    expect(parseColliderTag({ kind: "projectile" })).toBeNull();
    expect(parseColliderTag({ kind: "sensor" })).toBeNull();
    expect(parseColliderTag({ kind: "sensor", sensorId: "x", ownerId: 5 })).toBeNull();
    expect(parseColliderTag({ kind: "nope" })).toBeNull();
  });
});

describe("ContactProcessor pruning", () => {
  it("removeEnemy drops base, tower, and corridor records", () => {
    const processor = new ContactProcessor({ getEnemyById: () => null, getTowerById: () => null });
    processor.handleCollision(fakeBody({ kind: "enemy", enemyId: 5 }), fakeBody({ kind: "base" }), true);
    processor.handleCollision(fakeBody({ kind: "enemy", enemyId: 5 }), fakeBody({ kind: "corridor" }), true);
    processor.handleCollision(
      fakeBody({ kind: "enemy", enemyId: 5 }),
      fakeBody({ kind: "tower", towerId: "tower-1", tileX: 1, tileY: 1 }),
      true,
    );
    expect(processor.isEnemyTouchingBase(5)).toBe(true);
    expect(processor.getEnemyTowerContact(5)).toBe("tower-1");
    expect(processor.getCorridorPinCount(5)).toBe(1);

    processor.removeEnemy(5);

    expect(processor.isEnemyTouchingBase(5)).toBe(false);
    expect(processor.getEnemyTowerContact(5)).toBeNull();
    expect(processor.getCorridorPinCount(5)).toBe(0);
  });

  it("removeTower and clearTowerContacts drop tower records but keep base contacts", () => {
    const processor = new ContactProcessor({ getEnemyById: () => null, getTowerById: () => null });
    processor.handleCollision(fakeBody({ kind: "enemy", enemyId: 6 }), fakeBody({ kind: "base" }), true);
    processor.handleCollision(
      fakeBody({ kind: "enemy", enemyId: 6 }),
      fakeBody({ kind: "tower", towerId: "tower-gone", tileX: 1, tileY: 1 }),
      true,
    );
    processor.removeTower("tower-gone");
    expect(processor.getEnemyTowerContact(6)).toBeNull();
    expect(processor.isEnemyTouchingBase(6)).toBe(true);

    processor.handleCollision(
      fakeBody({ kind: "enemy", enemyId: 6 }),
      fakeBody({ kind: "tower", towerId: "tower-other", tileX: 2, tileY: 2 }),
      true,
    );
    processor.clearTowerContacts();
    expect(processor.getEnemyTowerContact(6)).toBeNull();
    expect(processor.isEnemyTouchingBase(6)).toBe(true);
  });

  it("ignores malformed tags instead of planting contacts", () => {
    const processor = new ContactProcessor({ getEnemyById: () => null, getTowerById: () => null });
    processor.handleCollision(fakeBody({ kind: "enemy" }), fakeBody({ kind: "base" }), true);
    processor.handleCollision(
      fakeBody({ kind: "enemy", enemyId: 9 }),
      fakeBody({ kind: "tower", towerId: "tower-9" }),
      true,
    );
    expect(processor.isEnemyTouchingBase(9)).toBe(false);
    expect(processor.getEnemyTowerContact(9)).toBeNull();
  });

  it("picks the lowest tower id on equal health regardless of event order", () => {
    const towerById = new Map<string, Tower>([
      ["tower-b", fakeTower("tower-b", 50)],
      ["tower-a", fakeTower("tower-a", 50)],
    ]);
    const processor = new ContactProcessor({
      getEnemyById: () => null,
      getTowerById: (towerId) => towerById.get(towerId) ?? null,
    });
    const grid = makeGrid();
    const enemy = new Enemy("minion", 1, 0, grid, 1, 0, null, null, null);
    for (const contactOrder of [
      ["tower-b", "tower-a"],
      ["tower-a", "tower-b"],
    ]) {
      processor.clear();
      for (const towerId of contactOrder) {
        processor.handleCollision(
          fakeBody({ kind: "enemy", enemyId: enemy.id }),
          fakeBody({ kind: "tower", towerId, tileX: 1, tileY: 1 }),
          true,
        );
      }
      enemy.blockedByTower = null;
      processor.applyContactFlags([enemy]);
      expect(enemy.blockedByTower?.id).toBe("tower-a");
    }
  });

  it("corridor contacts increment the pin counter without parking", () => {
    const processor = new ContactProcessor({ getEnemyById: () => null, getTowerById: () => null });
    const grid = makeGrid();
    const enemy = new Enemy("minion", 1, 0, grid, 1, 0, null, null, null);
    processor.handleCollision(fakeBody({ kind: "enemy", enemyId: enemy.id }), fakeBody({ kind: "corridor" }), true);
    processor.handleCollision(fakeBody({ kind: "enemy", enemyId: enemy.id }), fakeBody({ kind: "corridor" }), true);
    processor.applyContactFlags([enemy]);
    expect(processor.getCorridorPinCount(enemy.id)).toBe(2);
    expect(enemy.blockedByTower).toBeNull();
    expect(enemy.motionLock).toBe("none");
  });
});

describe("PhysicsWorld contact pruning on rebuild", () => {
  it("selling a tower unparks the enemy that was touching it", () => {
    const grid = makeGrid();
    const physicsWorld = new PhysicsWorld(grid);
    try {
      const tower = physicsTower("tower-9", 4, 3, grid);
      physicsWorld.rebuildTowers(towerManagerWith([tower]));
      const processor = physicsWorld.getContactProcessor();
      const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
      enemyManager.setPhysicsWorld(physicsWorld);
      const enemy = enemyManager.spawn("minion", 1, 0, 1)!;
      enemy.routingMode = "siege";
      enemy.siegeTower = tower as Tower;
      processor.handleCollision(
        fakeBody({ kind: "enemy", enemyId: enemy.id }),
        fakeBody({ kind: "tower", towerId: "tower-9", tileX: 4, tileY: 3 }),
        true,
      );
      processor.applyContactFlags([enemy]);
      expect(enemy.blockedByTower?.id).toBe("tower-9");
      expect(enemy.motionLock).toBe("park");

      physicsWorld.rebuildTowers(towerManagerWith([]));
      processor.applyContactFlags([enemy]);

      expect(processor.getEnemyTowerContact(enemy.id)).toBeNull();
      expect(enemy.blockedByTower).toBeNull();
      expect(enemy.motionLock).toBe("none");
    } finally {
      physicsWorld.dispose();
    }
  });

  it("removeEnemy prunes contacts so dead ids cannot collide on recycle", () => {
    const grid = makeGrid();
    const physicsWorld = new PhysicsWorld(grid);
    try {
      const processor = physicsWorld.getContactProcessor();
      const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
      enemyManager.setPhysicsWorld(physicsWorld);
      const enemy = enemyManager.spawn("minion", 1, 0, 1)!;
      processor.handleCollision(
        fakeBody({ kind: "enemy", enemyId: enemy.id }),
        fakeBody({ kind: "tower", towerId: "tower-1", tileX: 1, tileY: 1 }),
        true,
      );
      expect(processor.getEnemyTowerContact(enemy.id)).toBe("tower-1");
      physicsWorld.removeEnemy(enemy);
      expect(processor.getEnemyTowerContact(enemy.id)).toBeNull();
    } finally {
      physicsWorld.dispose();
    }
  });
});

describe("PhysicsWorld query scratch Balls", () => {
  it("allocates once no matter how many queries run", () => {
    const grid = makeGrid();
    resetPhysicsQueryStatsForTests();
    const physicsWorld = new PhysicsWorld(grid);
    try {
      const allocationsBefore = getPhysicsQueryBallAllocations();
      for (let queryIndex = 0; queryIndex < 20; queryIndex++) {
        physicsWorld.queryEnemiesInRange(10, 10, 50 + queryIndex);
        physicsWorld.forEachEnemyInRange(10, 10, 50, () => {});
        physicsWorld.castShapePierce(0, 0, 1, 0, 5, 100, 3, () => true);
      }
      expect(getPhysicsQueryBallAllocations() - allocationsBefore).toBeLessThanOrEqual(1);
    } finally {
      physicsWorld.dispose();
    }
  });
});

describe("PhysicsWorld aura sensors", () => {
  it("finds an overlapping enemy through the explicit sensor groups", () => {
    const grid = makeGrid();
    const physicsWorld = new PhysicsWorld(grid);
    try {
      const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
      enemyManager.setPhysicsWorld(physicsWorld);
      const enemy = enemyManager.spawn("minion", 1, 0, 1)!;
      physicsWorld.syncAuraSensors([{ sensorId: "test-sensor", x: enemy.x, y: enemy.y, radius: grid.tileSize * 2 }]);
      // Narrow-phase pairs populate on step; the production heal-aura path reads them post-step.
      physicsWorld.step();
      const seenEnemyIds: number[] = [];
      physicsWorld.forEachSensorHits("test-sensor", (seenEnemy) => {
        seenEnemyIds.push(seenEnemy.id);
      });
      expect(seenEnemyIds).toContain(enemy.id);
    } finally {
      physicsWorld.dispose();
    }
  });
});

describe("launchEnemy protocol", () => {
  it("unparks, opens a ballistic window, and applies the impulse", () => {
    const grid = makeGrid();
    const physicsWorld = new PhysicsWorld(grid);
    try {
      const enemy = spawnWiredEnemy(grid, physicsWorld, null);
      enemy.motionLock = "park";
      launchEnemy(enemy, 500, 0);
      expect(enemy.motionLock).toBe("none");
      expect(enemy.ballisticTimer).toBeGreaterThan(0);
      const linvel = enemy.body!.linvel();
      expect(Math.hypot(linvel.x, linvel.y)).toBeGreaterThan(0);
    } finally {
      physicsWorld.dispose();
    }
  });

  it("no-ops for removed enemies and missing bodies", () => {
    const grid = makeGrid();
    const enemy = new Enemy("minion", 1, 0, grid, 1, 0, null, null, null);
    enemy.removed = true;
    expect(() => launchEnemy(enemy, 10, 10)).not.toThrow();
    expect(enemy.ballisticTimer).toBe(0);
  });
});

describe("commandBus epoch", () => {
  afterEach(() => {
    resetCommandBusForTests();
  });

  function collectingDispatcher(received: Command[]): CommandDispatcher {
    return {
      dispatch: (command) => {
        received.push(command);
      },
    };
  }

  it("flushes same-epoch queued commands on register", () => {
    resetCommandBusForTests();
    setCommandDispatcher(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      dispatchCommand({ commandId: 0, type: "action:togglePause" });
    } finally {
      warnSpy.mockRestore();
    }
    const received: Command[] = [];
    setCommandDispatcher(collectingDispatcher(received));
    expect(received).toHaveLength(1);
  });

  it("drops stale-epoch commands on flush with a warn", () => {
    resetCommandBusForTests();
    setCommandDispatcher(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      dispatchCommand({ commandId: 0, type: "action:togglePause" });
    } finally {
      warnSpy.mockRestore();
    }
    const epochBefore = getCommandBusEpoch();
    advanceCommandBusEpoch("test run boundary");
    expect(getCommandBusEpoch()).toBeGreaterThan(epochBefore);
    const received: Command[] = [];
    const flushWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      setCommandDispatcher(collectingDispatcher(received));
      expect(received).toHaveLength(0);
      expect(flushWarnSpy).toHaveBeenCalled();
    } finally {
      flushWarnSpy.mockRestore();
    }
  });

  it("teardown discards pending commands and retires the epoch", () => {
    resetCommandBusForTests();
    setCommandDispatcher(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      dispatchCommand({ commandId: 0, type: "action:togglePause" });
      setCommandDispatcher(null);
    } finally {
      warnSpy.mockRestore();
    }
    const received: Command[] = [];
    setCommandDispatcher(collectingDispatcher(received));
    expect(received).toHaveLength(0);
  });
});

describe("WorkerEntry generation helpers", () => {
  it("splits current-generation commands from stale ones", () => {
    const togglePause: Command = { commandId: 1, type: "action:togglePause" };
    const sellSelected: Command = { commandId: 2, type: "action:sellSelected" };
    const split = splitGenerationCommands(
      [
        { command: togglePause, arrivalGeneration: 3 },
        { command: sellSelected, arrivalGeneration: 4 },
      ],
      4,
    );
    expect(split.current).toEqual([sellSelected]);
    expect(split.droppedStale).toBe(1);
  });

  it("stamps the worker generation onto the snapshot meta", () => {
    const snapshot = { meta: {} };
    stampSnapshotGeneration(snapshot, 7);
    expect(snapshot.meta.workerGeneration).toBe(7);
  });
});

describe("WASM init re-entrancy", () => {
  it("double initPhysics returns the same pending promise", async () => {
    resetPhysicsContextForTests();
    const firstInit = initPhysics();
    const secondInit = initPhysics();
    expect(secondInit).toBe(firstInit);
    await firstInit;
    expect(isPhysicsInitialized()).toBe(true);
    await initPhysics();
  });

  it("double initNavMesh returns the same pending promise", async () => {
    resetNavMeshContextForTests();
    const firstInit = initNavMesh();
    const secondInit = initNavMesh();
    expect(secondInit).toBe(firstInit);
    await firstInit;
    expect(isNavMeshInitialized()).toBe(true);
    await initNavMesh();
  });
});

describe("GameEngine clampBallisticEnemiesToNavMesh", () => {
  function initClampEngine(): GameEngine {
    const engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), new MockHostBindings(), 0);
    engine.loadMap(0);
    return engine;
  }

  function driftForTile(
    engine: GameEngine,
    tileX: number,
    tileY: number,
  ): { drift: number; nearest: { x: number; y: number } } | null {
    const center = engine.grid!.tileToWorld(tileX, tileY);
    const nearest = engine.navMeshBuilder!.nearestWalkableWorld(center);
    if (!nearest) return null;
    return { drift: Math.hypot(nearest.x - center.x, nearest.y - center.y), nearest };
  }

  function findTileByDrift(engine: GameEngine, minDrift: number, maxDrift: number): { x: number; y: number } | null {
    for (let tileY = 0; tileY < engine.grid!.height; tileY++) {
      for (let tileX = 0; tileX < engine.grid!.width; tileX++) {
        if (!engine.grid!.isTerrain(tileX, tileY)) continue;
        const drift = driftForTile(engine, tileX, tileY);
        if (drift && drift.drift >= minDrift && drift.drift <= maxDrift) return { x: tileX, y: tileY };
      }
    }
    return null;
  }

  function shoveToTile(engine: GameEngine, enemy: Enemy, tileX: number, tileY: number): void {
    const center = engine.grid!.tileToWorld(tileX, tileY);
    enemy.x = center.x;
    enemy.y = center.y;
    enemy.centerX = center.x;
    enemy.centerY = center.y;
    enemy.body!.setTranslation({ x: center.x, y: center.y }, true);
  }

  function clampEnemies(engine: GameEngine): void {
    (engine as unknown as { clampBallisticEnemiesToNavMesh(): void }).clampBallisticEnemiesToNavMesh();
  }

  it("restores the crowd agent velocity across the clamp teleport", () => {
    const engine = initClampEngine();
    try {
      const tileSize = engine.grid!.tileSize;
      const farTile = findTileByDrift(engine, tileSize, Number.POSITIVE_INFINITY);
      expect(farTile).not.toBeNull();
      const enemy = engine.enemyManager!.spawn("minion", 1, 0, 1)!;
      shoveToTile(engine, enemy, farTile!.x, farTile!.y);
      enemy.ballisticTimer = 1;
      restoreCrowdAgentVelocity(enemy.agent!, { x: 30, y: 0, z: 20 });
      const velocityBefore = enemy.agent!.velocity();

      clampEnemies(engine);

      const expected = engine.navMeshBuilder!.nearestWalkableWorld({ x: enemy.x, y: enemy.y });
      expect(expected).not.toBeNull();
      const velocityAfter = enemy.agent!.velocity();
      expect(velocityAfter.x).toBeCloseTo(velocityBefore.x, 6);
      expect(velocityAfter.z).toBeCloseTo(velocityBefore.z, 6);
      const bodyPosition = enemy.body!.translation();
      expect(bodyPosition.x).toBeCloseTo(enemy.x, 6);
      expect(bodyPosition.y).toBeCloseTo(enemy.y, 6);
    } finally {
      engine.dispose();
    }
  });

  it("skips parked enemies on sub-tile drift but clamps them past a full tile", () => {
    const engine = initClampEngine();
    try {
      const tileSize = engine.grid!.tileSize;
      const midTile = findTileByDrift(engine, tileSize * 0.3, tileSize * 0.9);
      const farTile = findTileByDrift(engine, tileSize, Number.POSITIVE_INFINITY);
      expect(midTile).not.toBeNull();
      expect(farTile).not.toBeNull();
      const parkedNear = engine.enemyManager!.spawn("minion", 1, 0, 1)!;
      const parkedFar = engine.enemyManager!.spawn("minion", 1, 0, 1)!;
      const freeNear = engine.enemyManager!.spawn("minion", 1, 0, 1)!;
      shoveToTile(engine, parkedNear, midTile!.x, midTile!.y);
      shoveToTile(engine, parkedFar, farTile!.x, farTile!.y);
      shoveToTile(engine, freeNear, midTile!.x, midTile!.y);
      for (const enemy of [parkedNear, parkedFar, freeNear]) enemy.ballisticTimer = 1;
      parkedNear.motionLock = "park";
      parkedFar.motionLock = "park";
      const nearStart = { x: parkedNear.x, y: parkedNear.y };
      const farStart = { x: parkedFar.x, y: parkedFar.y };

      clampEnemies(engine);

      expect(parkedNear.x).toBe(nearStart.x);
      expect(parkedNear.y).toBe(nearStart.y);
      expect(parkedFar.x).not.toBe(farStart.x);
      expect(freeNear.x).not.toBe(nearStart.x);
      expect(parkedFar.motionLock).toBe("park");
    } finally {
      engine.dispose();
    }
  });
});

describe("separateEnemiesFromTowers velocity handling", () => {
  it("restores the crowd agent velocity across the relocate teleport", () => {
    const grid = makeGrid();
    const physicsWorld = new PhysicsWorld(grid);
    const navBuilder = new NavMeshBuilder(grid);
    const crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 8);
    try {
      const enemy = spawnWiredEnemy(grid, physicsWorld, crowdManager);
      const center = grid.tileToWorld(4, 3);
      const tower = { x: center.x, y: center.y, tileX: 4, tileY: 3, isGhost: false } as Tower;
      enemy.x = center.x;
      enemy.y = center.y;
      enemy.centerX = center.x;
      enemy.centerY = center.y;
      enemy.body!.setTranslation({ x: center.x, y: center.y }, true);
      restoreCrowdAgentVelocity(enemy.agent!, { x: 40, y: 0, z: 30 });
      const velocityBefore = enemy.agent!.velocity();

      separateEnemiesFromTowers([enemy], [tower], grid, crowdManager);

      expect(enemy.x).not.toBe(center.x);
      const velocityAfter = enemy.agent!.velocity();
      expect(velocityAfter.x).toBeCloseTo(velocityBefore.x, 6);
      expect(velocityAfter.z).toBeCloseTo(velocityBefore.z, 6);
    } finally {
      crowdManager.destroy();
      physicsWorld.dispose();
      navBuilder.destroy();
    }
  });

  it("leaves intentionally parked enemies embedded in the square alone", () => {
    const grid = makeGrid();
    const physicsWorld = new PhysicsWorld(grid);
    const navBuilder = new NavMeshBuilder(grid);
    const crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 8);
    try {
      const enemy = spawnWiredEnemy(grid, physicsWorld, crowdManager);
      const center = grid.tileToWorld(4, 3);
      const tower = { x: center.x, y: center.y, tileX: 4, tileY: 3, isGhost: false } as Tower;
      enemy.x = center.x;
      enemy.y = center.y;
      enemy.centerX = center.x;
      enemy.centerY = center.y;
      enemy.body!.setTranslation({ x: center.x, y: center.y }, true);
      enemy.motionLock = "park";

      separateEnemiesFromTowers([enemy], [tower], grid, crowdManager);

      expect(enemy.x).toBe(center.x);
      expect(enemy.y).toBe(center.y);
    } finally {
      crowdManager.destroy();
      physicsWorld.dispose();
      navBuilder.destroy();
    }
  });
});
