// @ts-nocheck
/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { corridorWallInsetWorld } from "@/sim/navmesh/navmeshConfig.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import {
  corridorConvexVertices,
  pathTowerCutCorners,
  terrainTowerCutCorners,
  terrainTowerLocalOutline,
  towerJutVertices,
} from "@/sim/physics/corridorWalls.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";

// Region 1 Map 6 wall-block scenario: a 3-row corridor with a vertical wall pair
// at one column (rows 0-1) leaves row 2 as the only ground route. Enemies the
// breach comparator sends around the block must round the pair's two S-bend
// corners — the square path-tower corners that pin large bodies today.
function gridFromRows(rows, spawn, base) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = rows.map((row) =>
    [...row].map((symbol) => {
      const type = symbol === "B" ? "base" : symbol === "S" ? "spawn" : symbol === "." ? "terrain" : "path";
      return { type, height: 1 };
    }),
  );
  const grid = new Grid({ width, height, tiles, spawns: [spawn], base });
  for (let tileY = 0; tileY < height; tileY++) {
    for (let tileX = 0; tileX < width; tileX++) {
      if (rows[tileY][tileX] === "W") grid.registerTower(tileX, tileY);
    }
  }
  return grid;
}

// Tall fake wall so the breach comparator keeps every enemy on the detour leg.
function fakeTower(tileX, tileY, health, world) {
  return {
    id: `tower-${tileX}-${tileY}`,
    tileX,
    tileY,
    x: world.x,
    y: world.y,
    isGhost: false,
    health,
    maxHealth: health,
    enemyAttackImmune: false,
    takeDamage: () => {},
  };
}

const SBEND_ROWS = ["####W##BBB", "S###W##BBB", "#######BBB"];
const WALL_TILES = [
  { tileX: 4, tileY: 0 },
  { tileX: 4, tileY: 1 },
];

describe("path-tower corner chamfer (S-bend walk-around)", () => {
  let grid: Grid | null = null;
  let physicsWorld: PhysicsWorld | null = null;
  let crowd: CrowdManager | null = null;
  let navBuilder: NavMeshBuilder | null = null;
  let field: NavDistanceField | null = null;
  let enemyManager: EnemyManager | null = null;

  function wireScenario(wallTiles) {
    navBuilder = new NavMeshBuilder(grid);
    expect(navBuilder.isSuccess()).toBe(true);
    expect(navBuilder.syncTowers(wallTiles.map((tile) => ({ id: `w${tile.tileY}`, ...tile, isGhost: false })))).toBe(
      true,
    );
    physicsWorld = new PhysicsWorld(grid);
    physicsWorld.setEnemyEnemyCollisions(false);
    crowd = new CrowdManager(navBuilder.getNavMesh(), grid.tileSize, 8);
    field = new NavDistanceField(grid, navBuilder);
    field.rebuild();
    enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.setCrowdManager(crowd);
    enemyManager.setBlockedApproachLookup((tileX, tileY) => field.getBlockedApproach(tileX, tileY));
    enemyManager.setDistanceToBaseLookup((tileX, tileY) => field.getDistanceToBase(tileX, tileY));
    enemyManager.setThroughDistanceLookup(
      (tileX, tileY) => field.getThroughDistanceToBase(tileX, tileY),
      (tileX, tileY) => field.getThroughBlockers(tileX, tileY),
    );
    const towers = wallTiles.map((tile) =>
      fakeTower(tile.tileX, tile.tileY, 1e6, grid.tileToWorld(tile.tileX, tile.tileY)),
    );
    const towerManagerStub = {
      towers,
      towerAt: (tileX, tileY) => towers.find((tower) => tower.tileX === tileX && tower.tileY === tileY) ?? null,
      getTowerById: (towerId) => towers.find((tower) => tower.id === towerId) ?? null,
    };
    enemyManager.setTowerManager(towerManagerStub);
    physicsWorld.rebuildTowers(towerManagerStub as unknown as TowerManager);
  }

  function setupScenario() {
    grid = gridFromRows(SBEND_ROWS, { x: 0, y: 1 }, { x: 8, y: 1 });
    wireScenario(WALL_TILES);
  }

  // Drives the production tick order and returns when the enemy center clears the
  // east face of the wall pair, or Infinity when it never does (the jam signature).
  function runCrossing(enemy: Enemy, crossWorldX: number, limitSeconds: number): number {
    const maxSteps = Math.round(limitSeconds / FIXED_DT);
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      enemyManager.preStep(FIXED_DT);
      crowd.update(FIXED_DT, enemyManager.enemies);
      physicsWorld.step();
      enemyManager.postStep(FIXED_DT, null, null);
      if (enemy.x > crossWorldX) return stepIndex * FIXED_DT;
      if (enemy.removed) break;
    }
    return Number.POSITIVE_INFINITY;
  }

  // Westbound variant for the real map (the spawn sits east of the wall pair).
  function runCrossingWest(enemy: Enemy, crossWorldX: number, limitSeconds: number): number {
    const maxSteps = Math.round(limitSeconds / FIXED_DT);
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      enemyManager.preStep(FIXED_DT);
      crowd.update(FIXED_DT, enemyManager.enemies);
      physicsWorld.step();
      enemyManager.postStep(FIXED_DT, null, null);
      if (enemy.x < crossWorldX) return stepIndex * FIXED_DT;
      if (enemy.removed) break;
    }
    return Number.POSITIVE_INFINITY;
  }

  beforeEach(() => {
    resetEnemyId();
  });

  afterEach(() => {
    try {
      enemyManager?.clear();
    } catch {
      // Teardown races between scenarios are expected.
    }
    try {
      crowd?.destroy();
    } catch {
      // Teardown races between scenarios are expected.
    }
    try {
      navBuilder?.destroy();
    } catch {
      // Teardown races between scenarios are expected.
    }
    try {
      physicsWorld?.dispose();
    } catch {
      // Teardown races between scenarios are expected.
    }
    grid = null;
    physicsWorld = null;
    crowd = null;
    navBuilder = null;
    field = null;
    enemyManager = null;
  });

  it("walks a boss around the wall pair on the detour leg", () => {
    setupScenario();
    // Wave-like order: escorts flow into the 1-wide channel ahead of and behind
    // the boss, so its separationWeight-2.0 avoidance pressure is present at the
    // corner the way it is in a real wave.
    for (let escortIndex = 0; escortIndex < 3; escortIndex++) enemyManager.spawn("minion", 1, 0, 1);
    const boss = enemyManager.spawn("boss", 1, 0, 1);
    expect(boss).not.toBeNull();
    for (let escortIndex = 0; escortIndex < 2; escortIndex++) enemyManager.spawn("minion", 1, 0, 1);
    boss.computeIntent(FIXED_DT, enemyManager);
    expect(boss.routingMode).toBe("default");
    // East face of the pair column sits at x=5*36=180; the tile center at 198 is
    // unambiguous "past the block" for a 5.94-radius body.
    const crossWorldX = grid.tileToWorld(5, 1).x;
    const seconds = runCrossing(boss, crossWorldX, 30);
    expect(seconds, `stuck at ${boss.x.toFixed(1)},${boss.y.toFixed(1)}`).toBeLessThan(30);
  });

  it("walks a runner around the wall pair on the detour leg", () => {
    setupScenario();
    const runner = enemyManager.spawn("runner", 1, 0, 1);
    expect(runner).not.toBeNull();
    const crossWorldX = grid.tileToWorld(5, 1).x;
    const seconds = runCrossing(runner, crossWorldX, 20);
    expect(seconds, `stuck at ${runner.x.toFixed(1)},${runner.y.toFixed(1)}`).toBeLessThan(20);
  });

  it("walks a boss past a wall pair on the real region-1 map 6 top corridor", () => {
    // Truest reproduction: real map 5 layout (battlefield, spawn top-right), with
    // two walls on interior top-corridor column 8 pushing the path to row 2. On
    // current code the boss pins on the lower wall tower's southeast corner after
    // the long approach run.
    const catalogMap = getMap(5);
    grid = new Grid({ ...catalogMap });
    const wallColumn = 8;
    grid.registerTower(wallColumn, 0);
    grid.registerTower(wallColumn, 1);
    const wallTiles = [
      { tileX: wallColumn, tileY: 0 },
      { tileX: wallColumn, tileY: 1 },
    ];
    wireScenario(wallTiles);
    const boss = enemyManager.spawn("boss", 1, 0, 1);
    expect(boss).not.toBeNull();
    for (let escortIndex = 0; escortIndex < 3; escortIndex++) enemyManager.spawn("minion", 1, 0, 1);
    // Enemies emerge top-right and walk west; crossing means clearing the pair to
    // its west side.
    const crossWorldX = grid.tileToWorld(wallColumn - 1, 1).x;
    const seconds = runCrossingWest(boss, crossWorldX, 40);
    expect(seconds, `stuck at ${boss.x.toFixed(1)},${boss.y.toFixed(1)}`).toBeLessThan(40);
  });
});

function hasVertexNear(vertices: number[], x: number, y: number): boolean {
  for (let index = 0; index + 1 < vertices.length; index += 2) {
    if (Math.hypot((vertices[index] ?? 0) - x, (vertices[index + 1] ?? 0) - y) <= 0.75) return true;
  }
  return false;
}

describe("path-tower jut chamfer derivation", () => {
  it("cuts both channel corners of the lower wall tower and none on the pair's top tile", () => {
    const grid = gridFromRows(SBEND_ROWS, { x: 0, y: 1 }, { x: 8, y: 1 });
    const jutVertices = towerJutVertices(grid);
    expect(pathTowerCutCorners(grid, 4, 1, jutVertices)).toEqual(new Set(["southwest", "southeast"]));
    // The pair's top tile shares both lower vertices with its own tower tile
    // (two solid quadrants), so its corners stay square.
    expect(pathTowerCutCorners(grid, 4, 0, jutVertices)).toBeNull();
    // A path tile without a live tower never cuts.
    expect(pathTowerCutCorners(grid, 3, 1, jutVertices)).toBeNull();
    // The terrain-side pattern stays disjoint: a path tile is never a terrain cut.
    expect(terrainTowerCutCorners(grid, 4, 1, corridorConvexVertices(grid))).toBeNull();
  });

  it("chamfers the tower collider and drops the square corner vertices", () => {
    const grid = gridFromRows(SBEND_ROWS, { x: 0, y: 1 }, { x: 8, y: 1 });
    const cutCorners = pathTowerCutCorners(grid, 4, 1, towerJutVertices(grid));
    expect(cutCorners).not.toBeNull();
    const outline = terrainTowerLocalOutline(grid.tileSize, cutCorners!);
    expect(outline).not.toBeNull();
    const center = grid.tileToWorld(4, 1);
    const inset = corridorWallInsetWorld(grid.tileSize);
    const left = center.x - grid.tileSize / 2;
    const right = center.x + grid.tileSize / 2;
    const bottom = center.y + grid.tileSize / 2;
    const worldPoints: Array<{ x: number; y: number }> = [];
    for (let index = 0; index + 1 < outline!.length; index += 2) {
      worldPoints.push({ x: center.x + outline![index]!, y: center.y + outline![index + 1]! });
    }
    expect(worldPoints.some((point) => Math.hypot(point.x - (left + inset), point.y - bottom) < 1e-4)).toBe(true);
    expect(worldPoints.some((point) => Math.hypot(point.x - (right - inset), point.y - bottom) < 1e-4)).toBe(true);
    expect(worldPoints.some((point) => point.x === left && point.y === bottom)).toBe(false);
    expect(worldPoints.some((point) => point.x === right && point.y === bottom)).toBe(false);

    const navBuilder = new NavMeshBuilder(grid);
    const physicsWorld = new PhysicsWorld(grid);
    try {
      const towers = WALL_TILES.map((tile) =>
        fakeTower(tile.tileX, tile.tileY, 1e6, grid.tileToWorld(tile.tileX, tile.tileY)),
      );
      physicsWorld.rebuildTowers({ towers } as unknown as TowerManager);
      const colliderVertices = physicsWorld.debugRenderVertices();
      // Both square corners of the lower tower (west face x=144, east face x=180,
      // bottom face y=72) are replaced by the chamfer diagonals.
      expect(hasVertexNear(colliderVertices, left, bottom)).toBe(false);
      expect(hasVertexNear(colliderVertices, right, bottom)).toBe(false);
      expect(hasVertexNear(colliderVertices, left + inset, bottom)).toBe(true);
      expect(hasVertexNear(colliderVertices, right - inset, bottom)).toBe(true);
    } finally {
      physicsWorld.dispose();
      navBuilder.destroy();
    }
  });
});
