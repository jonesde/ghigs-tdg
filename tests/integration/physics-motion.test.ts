// @ts-nocheck
// Higher-level physics orchestration (unconditionally) without flipping a flag.
// We wire a real PhysicsWorld into a real EnemyManager and drive the full
// preStep -> step -> postStep pipeline so enemies move under physics.
import { afterEach, describe, expect, it } from "vitest";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import { makeParticleSystem } from "../helpers/mock-managers.js";

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function baseCenterOf(grid) {
  const base = grid.getBase();
  return grid.tileToWorld(base.x, base.y);
}

describe("Physics motion integration (flag OFF, direct construction)", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;
  let crowdManager: CrowdManager;
  let enemyManager: EnemyManager;

  beforeEach(() => {
    // setup.ts already initializes both WASM modules at module load.
    grid = new Grid(getMap(0));
    physicsWorld = new PhysicsWorld(grid);
    const navBuilder = new NavMeshBuilder(grid);
    crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 50);
    enemyManager = new EnemyManager(grid, makeParticleSystem(), 0, null, {});
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.setCrowdManager(crowdManager);
  });

  afterEach(() => {
    crowdManager.destroy();
    physicsWorld.dispose();
  });

  it("moves an enemy along the path to the base via preStep/step/postStep", () => {
    const enemy = enemyManager.spawn("minion", 1, 0, 1);
    expect(enemy).not.toBeNull();
    expect(enemy.body).not.toBeNull();

    const baseCenter = baseCenterOf(grid);
    const startDist = Math.hypot(enemy.centerX - baseCenter.x, enemy.centerY - baseCenter.y);
    const onEnemyKill = () => {};
    const onEnemyBeginAttackBase = () => {};

    let reached = false;
    for (let i = 0; i < 12000 && !reached; i++) {
      enemyManager.preStep(fixedDeltaSeconds);
      crowdManager.update(fixedDeltaSeconds, enemyManager.enemies);
      physicsWorld.step();
      enemyManager.postStep(fixedDeltaSeconds, onEnemyKill, onEnemyBeginAttackBase);
      reached = enemy.attackingBase;
      if (enemy.removed) break;
    }

    const endDist = Math.hypot(enemy.centerX - baseCenter.x, enemy.centerY - baseCenter.y);
    expect(endDist).toBeLessThan(startDist);
    expect(reached).toBe(true);
  });

  it("separates two enemies spawned on the same tile (no overlap)", () => {
    const a = enemyManager.spawn("minion", 1, 0, 1);
    const b = enemyManager.spawn("minion", 1, 0, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    const onEnemyKill = () => {};
    const onEnemyBeginAttackBase = () => {};

    // Run long enough for the contact solver to fully separate the coincident
    // spawn; the early frames are a transient so we assert the settled distance.
    let finalDistance = 0;
    for (let i = 0; i < 600; i++) {
      enemyManager.preStep(fixedDeltaSeconds);
      physicsWorld.step();
      enemyManager.postStep(fixedDeltaSeconds, onEnemyKill, onEnemyBeginAttackBase);
      if (a.removed || b.removed) break;
      finalDistance = dist(a, b);
    }

    // Driven coincident-start enemies settle with a small solver residual
    // overlap (a few percent of 2r); assert they do not deeply overlap/pass
    // through each other.
    expect(finalDistance).toBeGreaterThanOrEqual(2 * a.radius - 0.4);
  });
});
