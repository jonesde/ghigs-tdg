import { afterEach, describe, expect, it } from "vitest";
import type { AttackTarget } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";
import { orderedPath } from "../../../helpers/navmesh-test-utils.js";

// A minimal base attack target so Enemy.postPhysics could run its tick.
function makeBaseTarget(): AttackTarget {
  return { isGhost: false, takeDamage: () => {} };
}

function approxTarget(
  agent: { target: () => { x: number; y: number; z: number } },
  world: { x: number; y: number },
  epsilon = 1e-4,
): void {
  const t = agent.target();
  expect(Math.abs(t.x - world.x)).toBeLessThan(epsilon);
  expect(Math.abs(t.z - world.y)).toBeLessThan(epsilon);
}

describe("Commander routing drives the DetourCrowd agent", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;
  let crowdManager: CrowdManager;
  let enemyManager: EnemyManager;

  // setup.ts already initializes the WASM module at module load; this builds a
  // fresh world + crowd per test and frees them in afterEach.
  beforeEach(() => {
    grid = new Grid(makeBastionMap());
    const navBuilder = new NavMeshBuilder(grid);
    expect(navBuilder.isSuccess()).toBe(true);
    crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 50);
    enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    physicsWorld = new PhysicsWorld(grid);
    physicsWorld.setEnemyEnemyCollisions(false);
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.baseTarget = makeBaseTarget();
  });

  afterEach(() => {
    crowdManager.destroy();
    physicsWorld.dispose();
  });

  it("holds, releases, and routes a single enemy's crowd agent", () => {
    const baseWorld = grid.tileToWorld(grid.getBase().x, grid.getBase().y);

    const enemy = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemy).not.toBeNull();
    physicsWorld.addEnemy(enemy!);
    crowdManager.addAgent(enemy!);
    crowdManager.setBaseTarget(enemy!, baseWorld);

    // Hold case: route to a single tile; agent should target that tile's world point.
    const holdTile = orderedPath(grid, 0)[2]!;
    const holdWorld = grid.tileToWorld(holdTile.x, holdTile.y);
    enemy!.applyRoute([holdTile], "hold");
    expect(enemy!.routingMode).toBe("hold");
    expect(enemy!.holdWorld).toEqual(holdWorld);
    expect(enemy!.agent).not.toBeNull();
    approxTarget(enemy!.agent!, enemy!.holdWorld!);

    // Release case: revert to default; agent should target the base.
    enemy!.releaseToDefault();
    expect(enemy!.routingMode).toBe("default");
    expect(enemy!.holdWorld).toBeNull();
    expect(enemy!.routeWorld).toBeNull();
    approxTarget(enemy!.agent!, baseWorld);

    // Route case: target the destination tile of a multi-tile waypoint chain.
    const path = orderedPath(grid, 0);
    const tileA = path[1]!;
    const tileB = path[3]!;
    const tileC = path[5]!;
    const routeWorld = grid.tileToWorld(tileC.x, tileC.y);
    enemy!.applyRoute([tileA, tileB, tileC], "route");
    expect(enemy!.routingMode).toBe("route");
    expect(enemy!.routeWorld).toEqual(routeWorld);
    approxTarget(enemy!.agent!, enemy!.routeWorld!);
  });
});
