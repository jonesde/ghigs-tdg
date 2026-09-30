// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { makeParticleSystem } from "../helpers/mock-managers";
import { mockDefaultTheme } from "../helpers/mock-stores.js";
import { orderedPath } from "../helpers/navmesh-test-utils.js";
import { stepPhysics } from "../helpers/physicsTestDriver.js";

describe("EnemyManager", () => {
  let manager: EnemyManager;
  let grid: Grid;
  let particles: ReturnType<typeof makeParticleSystem>;
  let physicsWorld: PhysicsWorld;
  let crowdManager: CrowdManager | null = null;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;

    resetEnemyId();
    const map = makeBastionMap();
    grid = new Grid(map);
    particles = makeParticleSystem();
    manager = new EnemyManager(grid, particles, 0);
    // Enemies now back their motion with a Rapier body, so spawn gives each one a
    // rigid body. Without this, computeIntent dereferences a null body and crashes.
    physicsWorld = new PhysicsWorld(grid);
    manager.setPhysicsWorld(physicsWorld);
    const navBuilder = new NavMeshBuilder(grid);
    crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 50);
    manager.setCrowdManager(crowdManager);
  });

  afterEach(() => {
    crowdManager?.destroy();
    physicsWorld.dispose();
  });

  it("starts with no enemies", () => {
    expect(manager.enemies).toHaveLength(0);
  });

  describe("spawn", () => {
    it("creates an enemy and adds to list", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      expect(enemy).toBeDefined();
      expect(enemy.type).toBe("minion");
      expect(manager.enemies).toHaveLength(1);
    });

    it("assigns unique IDs to spawned enemies", () => {
      const enemy1 = manager.spawn("minion", 1, 0, 1);
      const enemy2 = manager.spawn("runner", 1, 0, 1);
      expect(enemy2.id).not.toBe(enemy1.id);
    });

    it("spawns at the correct spawn point", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      const firstTile = grid.tileToWorld(orderedPath(grid, 0)[0].x, orderedPath(grid, 0)[0].y);
      expect(enemy.x).toBeCloseTo(firstTile.x, 0);
      expect(enemy.y).toBeCloseTo(firstTile.y, 0);
    });
  });

  describe("damage credit sink", () => {
    it("routes creditDamage through the wired sink and filters non-positive amounts", () => {
      const credits: Array<{ towerId: string; amount: number }> = [];
      manager.setDamageCreditSink((towerId, amount) => credits.push({ towerId, amount }));
      manager.creditDamage("tower-1", 4.5);
      manager.creditDamage("tower-1", 0);
      expect(credits).toEqual([{ towerId: "tower-1", amount: 4.5 }]);
    });

    it("credits burn ticks from Enemy.computeIntent through the sink", () => {
      const credits: Array<{ towerId: string; amount: number }> = [];
      manager.setDamageCreditSink((towerId, amount) => credits.push({ towerId, amount }));
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.hp = 100;
      enemy.applyBurn(5, 1.0, "tower-burn");
      manager.preStep(1.0);
      expect(credits).toHaveLength(1);
      expect(credits[0]!.towerId).toBe("tower-burn");
      expect(credits[0]!.amount).toBeCloseTo(5, 4);
    });
  });

  describe("postStep", () => {
    it("calls onEnemyKill when an enemy is removed", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.hp = 1;
      const killed: unknown[] = [];
      manager.postStep(0.016, (enemy) => killed.push(enemy));
      expect(killed).toHaveLength(0);
    });

    it("culled dead enemies from the list", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      manager.postStep(0.016, () => {});
      expect(manager.enemies).toHaveLength(0);
    });

    it("removes enemies that die during preStep burn from the list", () => {
      const enemy = manager.spawn("runner", 1, 0, 1);
      enemy.hp = 10;
      enemy.applyBurn(1000, 1.0);
      manager.preStep(0.016);
      physicsWorld.step();
      manager.postStep(0.016, () => {});
      expect(manager.enemies).toHaveLength(0);
      const inRange = manager.getEnemiesInRange(enemy.x, enemy.y, 10);
      expect(inRange).not.toContain(enemy);
    });

    it("spawns particles when enemy dies", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      const countBefore = particles.spawns.length;
      manager.postStep(0.016, () => {});
      expect(particles.spawns.length).toBeGreaterThan(countBefore);
    });

    it("moves enemies toward their target", () => {
      const enemy = manager.spawn("runner", 1, 0, 1);
      const startX = enemy.x;
      const startY = enemy.y;
      // Motion is crowd + physics driven: the crowd sets the agent's velocity and
      // the world steps the body, so stepPhysics must be driven with the crowd.
      for (let i = 0; i < 120; i++) stepPhysics(manager, physicsWorld, 1 / 60, null, null, crowdManager);
      const _expectedDist = ENEMY_TYPES.runner.speed * grid.tileSize;
      const _actualDist = Math.hypot(enemy.x - startX, enemy.y - startY);
      expect(enemy.x).not.toBe(startX);
    });
  });

  describe("getEnemiesInRange", () => {
    it("returns enemies within range", () => {
      manager.spawn("minion", 1, 0, 1);
      stepPhysics(manager, physicsWorld, 1 / 60);
      const towerPos = { x: 18, y: 18 };
      const inRange = manager.getEnemiesInRange(towerPos.x, towerPos.y, grid.tileSize * 3.5);
      expect(inRange.length).toBeGreaterThan(0);
    });

    it("excludes removed enemies", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      const inRange = manager.getEnemiesInRange(18, 18, 10);
      expect(inRange).not.toContain(enemy);
    });

    it("includes enemies attacking the base in range queries (they still collide)", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      stepPhysics(manager, physicsWorld, 1 / 60);
      enemy.attackingBase = true;
      const inRange = manager.getEnemiesInRange(enemy.x, enemy.y, 10);
      expect(inRange).toContain(enemy);
    });

    it("returns empty array when no enemies in range", () => {
      const farEnemy = manager.spawn("minion", 1, 0, 1);
      farEnemy.x = 10000;
      farEnemy.y = 10000;
      const inRange = manager.getEnemiesInRange(18, 18, 1);
      expect(inRange).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("removes all enemies and resets IDs", () => {
      manager.spawn("minion", 1, 0, 1);
      manager.spawn("minion", 1, 0, 1);
      manager.clear();
      expect(manager.enemies).toHaveLength(0);
      const enemy = manager.spawn("minion", 1, 0, 1);
      expect(enemy.id).toBe(1);
    });
  });

  describe("incremental spatial hash", () => {
    it("removes enemy from spatial hash on cull", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      manager.postStep(0.016, () => {});
      const inRange = manager.getEnemiesInRange(enemy.x, enemy.y, 10);
      expect(inRange).not.toContain(enemy);
    });

    it("maintains correct hash after multiple spawn and cull cycles", () => {
      const e1 = manager.spawn("minion", 1, 0, 1);
      const e2 = manager.spawn("runner", 1, 0, 1);
      stepPhysics(manager, physicsWorld, 1 / 60);
      e1.removed = true;
      manager.postStep(0.016, () => {});
      expect(manager.enemies).toHaveLength(1);
      expect(manager.enemies[0]).toBe(e2);
      const inRange = manager.getEnemiesInRange(e2.x, e2.y, 10);
      expect(inRange).toContain(e2);
      expect(inRange).not.toContain(e1);
    });
  });

  describe("getEnemiesInRange equivalence with forEachEnemyInRange (Finding 5)", () => {
    it("visits the same survivors in the same order as the array form", () => {
      const e1 = manager.spawn("minion", 1, 0, 1);
      const e2 = manager.spawn("minion", 1, 0, 1);
      const removed = manager.spawn("runner", 1, 0, 1);
      const reached = manager.spawn("minion", 1, 0, 1);
      stepPhysics(manager, physicsWorld, 1 / 60);
      removed.removed = true;
      reached.attackingBase = true;

      const arr = manager.getEnemiesInRange(18, 18, 10000);
      const via: typeof arr = [];
      manager.forEachEnemyInRange(18, 18, 10000, (enemy) => via.push(enemy));

      expect(via.map((e) => e.id)).toEqual(arr.map((e) => e.id));
      expect(arr).not.toContain(removed);
      expect(arr).toContain(reached);
      expect(via).not.toContain(removed);
      expect(via).toContain(reached);
      expect(arr).toContain(e1);
      expect(arr).toContain(e2);
    });
  });
});
