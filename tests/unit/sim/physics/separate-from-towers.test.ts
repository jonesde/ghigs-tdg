import { afterEach, describe, expect, it } from "vitest";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { separateEnemiesFromTowers } from "@/sim/physics/separateEnemiesFromTowers.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { makeMapData } from "../../../helpers/mock-grid.js";

function makeLaneMap() {
  const width = 9;
  const height = 5;
  const tiles: { type: "terrain" | "path" | "base" | "spawn"; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: "terrain" | "path" | "base" | "spawn"; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) row.push({ type: "terrain", height: 1 });
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < width; colIndex++) tiles[2]![colIndex]!.type = "path";
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 2 }],
    base: { x: 8, y: 2 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

describe("separateEnemiesFromTowers", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;
  let navBuilder: NavMeshBuilder;
  let crowdManager: CrowdManager;
  let enemyManager: EnemyManager;

  function setup(): void {
    grid = new Grid(makeLaneMap());
    physicsWorld = new PhysicsWorld(grid);
    physicsWorld.setEnemyEnemyCollisions(false);
    navBuilder = new NavMeshBuilder(grid);
    crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 8);
    enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.setCrowdManager(crowdManager);
    enemyManager.baseTarget = { isGhost: false, takeDamage: () => {} };
  }

  afterEach(() => {
    crowdManager.destroy();
    physicsWorld.dispose();
    navBuilder.destroy();
  });

  function towerAt(tileX: number, tileY: number): Tower {
    const center = grid.tileToWorld(tileX, tileY);
    return { x: center.x, y: center.y, tileX, tileY, isGhost: false } as Tower;
  }

  it("moves an enemy whose center is inside the tile to an adjacent walkable tile", () => {
    setup();
    const enemy = enemyManager.spawn("minion", 1, 0, 1)!;
    const tower = towerAt(4, 2);
    enemy.x = tower.x;
    enemy.y = tower.y;
    enemy.centerX = tower.x;
    enemy.centerY = tower.y;
    enemy.body!.setTranslation({ x: tower.x, y: tower.y }, true);

    separateEnemiesFromTowers([enemy], [tower], grid, crowdManager);

    const landing = grid.tileToWorld(3, 2);
    expect(enemy.x).toBe(landing.x);
    expect(enemy.y).toBe(landing.y);
    const distanceToFace = Math.abs(enemy.x - tower.x) - grid.tileSize / 2;
    expect(distanceToFace).toBeGreaterThan(enemy.radius);
  });

  it("leaves an enemy sitting on the west face where it is", () => {
    setup();
    const enemy = enemyManager.spawn("minion", 1, 0, 1)!;
    const tower = towerAt(4, 2);
    const faceX = tower.x - grid.tileSize / 2 - enemy.radius;
    enemy.x = faceX;
    enemy.y = tower.y;
    enemy.centerX = faceX;
    enemy.centerY = tower.y;
    enemy.body!.setTranslation({ x: faceX, y: tower.y }, true);

    separateEnemiesFromTowers([enemy], [tower], grid, crowdManager);

    expect(enemy.x).toBe(faceX);
    expect(enemy.y).toBe(tower.y);
  });

  it("lands on the west neighbor when moveAngle points east", () => {
    setup();
    const enemy = enemyManager.spawn("minion", 1, 0, 1)!;
    const tower = towerAt(4, 2);
    enemy.x = tower.x;
    enemy.y = tower.y;
    enemy.centerX = tower.x;
    enemy.centerY = tower.y;
    enemy.moveAngle = 0;
    enemy.body!.setTranslation({ x: tower.x, y: tower.y }, true);

    separateEnemiesFromTowers([enemy], [tower], grid, crowdManager);

    const west = grid.tileToWorld(3, 2);
    const east = grid.tileToWorld(5, 2);
    expect(enemy.x).toBe(west.x);
    expect(enemy.y).toBe(west.y);
    expect(enemy.x).not.toBe(east.x);
  });
});
