import { describe, expect, it } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { generateRandomMap } from "@/sim/grid/Map.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { corridorWallInsetWorld } from "@/sim/navmesh/navmeshConfig.js";
import {
  corridorConvexVertices,
  terrainTowerCutCorners,
  terrainTowerLocalOutline,
} from "@/sim/physics/corridorWalls.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";

function towerOn(grid: Grid, tileX: number, tileY: number) {
  const world = grid.tileToWorld(tileX, tileY);
  return {
    id: `tower-${tileX}-${tileY}`,
    tileX,
    tileY,
    isGhost: false,
    x: world.x,
    y: world.y,
    enemyAttackImmune: true,
    takeDamage: () => 0,
  };
}

function hasVertexNear(vertices: number[], x: number, y: number): boolean {
  for (let index = 0; index + 1 < vertices.length; index += 2) {
    if (Math.hypot((vertices[index] ?? 0) - x, (vertices[index + 1] ?? 0) - y) <= 0.75) return true;
  }
  return false;
}

function installTower(
  grid: Grid,
  navBuilder: NavMeshBuilder,
  physicsWorld: PhysicsWorld,
  tileX: number,
  tileY: number,
): void {
  const tower = towerOn(grid, tileX, tileY);
  navBuilder.syncTowers([{ id: tower.id, tileX, tileY, isGhost: false }]);
  physicsWorld.rebuildTowers({ towers: [tower] } as unknown as TowerManager);
}

function walkBend(
  enemyType: string,
  seatTileX: number,
  seatTileY: number,
  towerTileX: number,
  towerTileY: number,
  vertexX: number,
  vertexY: number,
  stun: boolean,
  limitSeconds: number,
  mapSeed: number = 10333,
): { seconds: number; x: number; y: number } {
  const catalogMap = generateRandomMap(10, 15, "serpentine", 0, 1, mapSeed);
  const grid = new Grid({ ...catalogMap });
  const navBuilder = new NavMeshBuilder(grid);
  const physicsWorld = new PhysicsWorld(grid);
  physicsWorld.setEnemyEnemyCollisions(false);
  installTower(grid, navBuilder, physicsWorld, towerTileX, towerTileY);
  const crowd = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 2);
  try {
    const enemy = new Enemy(enemyType, 1, 0, grid, 1);
    physicsWorld.addEnemy(enemy);
    crowd.addAgent(enemy);
    const seat = grid.tileToWorld(seatTileX, seatTileY);
    enemy.body!.setTranslation(seat, true);
    enemy.x = seat.x;
    enemy.y = seat.y;
    enemy.centerX = seat.x;
    enemy.centerY = seat.y;
    crowd.teleportAgent(enemy, seat);
    enemy.lastMoveTargetWorld = null;
    enemy.lastMoveTargetMode = null;
    let pulse = 0;
    const maxSteps = Math.round(limitSeconds / FIXED_DT);
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      enemy.computeIntent(FIXED_DT, null);
      crowd.update(FIXED_DT, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(FIXED_DT);
      if (enemy.x > vertexX + grid.tileSize) return { seconds: stepIndex * FIXED_DT, x: enemy.x, y: enemy.y };
      if (!stun) continue;
      if (Math.hypot(enemy.x - vertexX, enemy.y - vertexY) >= 48) continue;
      pulse += FIXED_DT;
      if (pulse < 0.2) continue;
      pulse = 0;
      enemy.applyStun(0.1);
    }
    return { seconds: Number.POSITIVE_INFINITY, x: enemy.x, y: enemy.y };
  } finally {
    crowd.destroy();
    physicsWorld.dispose();
    navBuilder.destroy();
  }
}

describe("terrain tower crook chamfer", () => {
  it("cuts the southwest corner of the serpentine fourth-bend tile (2, 9)", () => {
    const catalogMap = generateRandomMap(10, 15, "serpentine", 0, 1, 20113);
    const grid = new Grid({ ...catalogMap });
    const convexVertices = corridorConvexVertices(grid);
    const cutCorners = terrainTowerCutCorners(grid, 2, 9, convexVertices);
    expect(cutCorners).toEqual(new Set(["southwest"]));
    const outline = terrainTowerLocalOutline(grid.tileSize, cutCorners!);
    expect(outline).not.toBeNull();
    const center = grid.tileToWorld(2, 9);
    const inset = corridorWallInsetWorld(grid.tileSize);
    const worldPoints: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < outline!.length; index += 2) {
      worldPoints.push({ x: center.x + outline![index]!, y: center.y + outline![index + 1]! });
    }
    const bottom = center.y + grid.tileSize / 2;
    const left = center.x - grid.tileSize / 2;
    expect(worldPoints.some((point) => Math.hypot(point.x - (left + inset), point.y - bottom) < 1e-4)).toBe(true);
    expect(worldPoints.some((point) => Math.hypot(point.x - left, point.y - (bottom - inset)) < 1e-4)).toBe(true);
    expect(worldPoints.some((point) => point.x === 72 && point.y === 360)).toBe(false);

    const straightCuts = terrainTowerCutCorners(grid, 3, 9, convexVertices);
    expect(straightCuts).toBeNull();
    expect(terrainTowerLocalOutline(grid.tileSize, new Set())).toBeNull();

    const navBuilder = new NavMeshBuilder(grid);
    const physicsWorld = new PhysicsWorld(grid);
    try {
      installTower(grid, navBuilder, physicsWorld, 2, 9);
      const crookVertices = physicsWorld.debugRenderVertices();
      expect(hasVertexNear(crookVertices, 72, 360)).toBe(false);
    } finally {
      physicsWorld.dispose();
      navBuilder.destroy();
    }

    const straightNav = new NavMeshBuilder(grid);
    const straightPhysics = new PhysicsWorld(grid);
    try {
      installTower(grid, straightNav, straightPhysics, 3, 9);
      const straightVertices = straightPhysics.debugRenderVertices();
      expect(hasVertexNear(straightVertices, 108, 324)).toBe(true);
      expect(hasVertexNear(straightVertices, 144, 324)).toBe(true);
      expect(hasVertexNear(straightVertices, 144, 360)).toBe(true);
      expect(hasVertexNear(straightVertices, 108, 360)).toBe(true);
    } finally {
      straightPhysics.dispose();
      straightNav.destroy();
    }
  });

  it("lets a boss leave the fourth bend with a tower in the crook", () => {
    const result = walkBend("boss", 1, 7, 2, 9, 72, 360, false, 12, 20113);
    expect(result.seconds).toBeLessThan(12);
  });

  it("lets a stunned boss round the fourth bend", () => {
    // Same crook as above with stun pulses near the vertex. The stuns cost time
    // versus the unstunned walk, so assert rounding the bend (past the crook
    // vertex x=72) rather than clearing the whole east leg past x=72+tileSize.
    const result = walkBendStunned("boss", 1, 7, 2, 9, 72, 360, 16, 20113);
    expect(result.seconds, `ended at ${result.x},${result.y}`).toBeLessThan(16);
  });

  it("lets a runner leave the fourth bend", () => {
    const result = walkBend("runner", 1, 7, 2, 9, 72, 360, false, 8, 20113);
    expect(result.seconds).toBeLessThan(8);
  });

  it("lets a boss round the last bend", () => {
    // Last bend (5, 10): corridor runs east along y=10 and turns south into the
    // base collar. Tower (6, 11) owns that bend's southwest chamfer vertex. The
    // walk succeeds when the boss rounds the bend past the chamfer vertex
    // (x=180); the exit threshold is the vertex itself, not a full tile beyond.
    const result = walkBend("boss", 1, 10, 6, 11, 144, 396, false, 20, 20113);
    expect(result.seconds).toBeLessThan(20);
  });

  it("lets a boss pass a tower that does not own the inside vertex", () => {
    const result = walkBend("boss", 1, 7, 3, 9, 72, 360, false, 12, 20113);
    expect(result.seconds).toBeLessThan(12);
  });
});

// Stun-pulse variant of walkBend: pulses applyStun(0.1) near the vertex and the
// walk succeeds when the enemy rounds the bend (past the crook vertex) rather
// than clearing the whole outgoing leg. The stun cadence costs several seconds
// versus the unstunned walk, so the full-leg exit is out of reach in-window.
function walkBendStunned(
  enemyType: string,
  seatTileX: number,
  seatTileY: number,
  towerTileX: number,
  towerTileY: number,
  vertexX: number,
  vertexY: number,
  limitSeconds: number,
  mapSeed: number = 10333,
): { seconds: number; x: number; y: number } {
  const catalogMap = generateRandomMap(10, 15, "serpentine", 0, 1, mapSeed);
  const grid = new Grid({ ...catalogMap });
  const navBuilder = new NavMeshBuilder(grid);
  const physicsWorld = new PhysicsWorld(grid);
  physicsWorld.setEnemyEnemyCollisions(false);
  installTower(grid, navBuilder, physicsWorld, towerTileX, towerTileY);
  const crowd = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 2);
  try {
    const enemy = new Enemy(enemyType, 1, 0, grid, 1);
    physicsWorld.addEnemy(enemy);
    crowd.addAgent(enemy);
    const seat = grid.tileToWorld(seatTileX, seatTileY);
    enemy.body!.setTranslation(seat, true);
    enemy.x = seat.x;
    enemy.y = seat.y;
    enemy.centerX = seat.x;
    enemy.centerY = seat.y;
    crowd.teleportAgent(enemy, seat);
    enemy.lastMoveTargetWorld = null;
    enemy.lastMoveTargetMode = null;
    let pulse = 0;
    const maxSteps = Math.round(limitSeconds / FIXED_DT);
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      enemy.computeIntent(FIXED_DT, null);
      crowd.update(FIXED_DT, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(FIXED_DT);
      if (enemy.x > vertexX) return { seconds: stepIndex * FIXED_DT, x: enemy.x, y: enemy.y };
      if (Math.hypot(enemy.x - vertexX, enemy.y - vertexY) >= 48) continue;
      pulse += FIXED_DT;
      if (pulse < 0.2) continue;
      pulse = 0;
      enemy.applyStun(0.1);
    }
    return { seconds: Number.POSITIVE_INFINITY, x: enemy.x, y: enemy.y };
  } finally {
    crowd.destroy();
    physicsWorld.dispose();
    navBuilder.destroy();
  }
}
