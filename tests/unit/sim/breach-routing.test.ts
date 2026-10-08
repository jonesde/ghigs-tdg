// @ts-nocheck
/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";

// `#` path, `B` base, `W` live blocking tower, `.` terrain.
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

function fakeTower(tileX, tileY, health, world) {
  const damage = { value: 0 };
  return {
    tower: {
      id: `tower-${tileX}-${tileY}`,
      tileX,
      tileY,
      x: world.x,
      y: world.y,
      isGhost: false,
      health,
      maxHealth: health,
      enemyAttackImmune: false,
      takeDamage(amount) {
        damage.value += amount;
      },
    },
    damage,
  };
}

describe("breach-vs-detour intent", () => {
  let grid: Grid | null = null;
  let physicsWorld: PhysicsWorld | null = null;
  let crowd: CrowdManager | null = null;
  let navBuilder: NavMeshBuilder | null = null;
  let field: NavDistanceField | null = null;
  let enemyManager: EnemyManager | null = null;

  function setupScenario() {
    const rows = ["S###W###B", "#########"];
    grid = gridFromRows(rows, { x: 0, y: 0 }, { x: 8, y: 0 });
    navBuilder = new NavMeshBuilder(grid);
    expect(navBuilder.isSuccess()).toBe(true);
    navBuilder.addTowerObstacle(4, 0);
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
    return enemyManager;
  }

  function spawnWithTower(
    type: string,
    wallHealth: number,
  ): {
    enemy: Enemy;
    tower: { id: string; tileX: number; tileY: number };
    damage: { value: number };
    manager: EnemyManager;
  } {
    const localManager = setupScenario();
    const world = grid!.tileToWorld(4, 0);
    const { tower, damage } = fakeTower(4, 0, wallHealth, world);
    const towerManagerStub = {
      towers: [tower],
      towerAt: (tileX, tileY) => (tileX === 4 && tileY === 0 ? tower : null),
      getTowerById: (towerId) => (towerId === tower.id ? tower : null),
    };
    localManager.setTowerManager(towerManagerStub);
    physicsWorld.rebuildTowers(towerManagerStub);
    const enemy = localManager.spawn(type, 1, 0, 1);
    expect(enemy).not.toBeNull();
    return { enemy, tower, damage, manager: localManager };
  }

  beforeEach(() => {
    resetEnemyId();
  });

  afterEach(() => {
    teardown();
  });

  it("sieges a cheap wall on the short leg", () => {
    const { enemy, tower, manager } = spawnWithTower("minion", 1);
    expect(field.getDistanceToBase(0, 0)).toBe(10);
    expect(field.getThroughDistanceToBase(0, 0)).toBe(8);
    enemy.computeIntent(fixedDeltaSeconds, manager);
    expect(enemy.routingMode).toBe("siege");
    expect(enemy.siegeTower).toBe(tower);
  });

  it("detours around a high-HP wall on the short leg", () => {
    const { enemy, manager } = spawnWithTower("minion", 2000);
    enemy.computeIntent(fixedDeltaSeconds, manager);
    expect(field.getDistanceToBase(0, 0)).toBeGreaterThanOrEqual(0);
    expect(field.getThroughBlockers(0, 0)).toEqual([{ x: 4, y: 0 }]);
    expect(enemy.routingMode).toBe("default");
    expect(enemy.siegeTower).toBeNull();
  });

  it("splits boss and minion DPS on the same wall", () => {
    const bossSetup = spawnWithTower("boss", 12);
    bossSetup.enemy.computeIntent(fixedDeltaSeconds, bossSetup.manager);
    expect(bossSetup.enemy.routingMode).toBe("siege");
    teardown();

    const minionSetup = spawnWithTower("minion", 12);
    minionSetup.enemy.computeIntent(fixedDeltaSeconds, minionSetup.manager);
    expect(minionSetup.enemy.routingMode).toBe("default");
    expect(minionSetup.enemy.siegeTower).toBeNull();
  });

  it("decides from the enemy's current tile after a commander displacement", () => {
    const { enemy, manager, tower } = spawnWithTower("minion", 1);
    const nearWall = grid.tileToWorld(2, 0);
    enemy.body.setTranslation({ x: nearWall.x, y: nearWall.y }, true);
    enemy.x = nearWall.x;
    enemy.y = nearWall.y;
    enemy.centerX = nearWall.x;
    enemy.centerY = nearWall.y;
    enemy.breachCooldownSeconds = 0;
    enemy.computeIntent(fixedDeltaSeconds, manager);
    expect(enemy.routingMode).toBe("siege");
    expect(enemy.siegeTower).toBe(tower);
  });

  it("keeps explicit hold and engagement policies out of the comparator", () => {
    const { enemy, manager } = spawnWithTower("minion", 1);
    enemy.applyRoute([{ x: 1, y: 0 }], "hold");
    enemy.computeIntent(fixedDeltaSeconds, manager);
    expect(enemy.routingMode).toBe("hold");
    expect(enemy.siegeTower).toBeNull();

    enemy.releaseToDefault();
    enemy.targetingMode = "strongest";
    enemy.breachCooldownSeconds = 0;
    enemy.computeIntent(fixedDeltaSeconds, manager);
    expect(enemy.routingMode).toBe("siege");
    expect(enemy.siegeTower).not.toBeNull();
  });

  it("never sieges an immune tower, even when the open route is sealed", () => {
    grid = gridFromRows(["S##W##B"], { x: 0, y: 0 }, { x: 6, y: 0 });
    navBuilder = new NavMeshBuilder(grid);
    navBuilder.addTowerObstacle(3, 0);
    physicsWorld = new PhysicsWorld(grid);
    crowd = new CrowdManager(navBuilder.getNavMesh(), grid.tileSize, 8);
    field = new NavDistanceField(grid, navBuilder);
    field.rebuild();
    enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.setDistanceToBaseLookup((tileX, tileY) => field.getDistanceToBase(tileX, tileY));
    enemyManager.setThroughDistanceLookup(
      (tileX, tileY) => field.getThroughDistanceToBase(tileX, tileY),
      (tileX, tileY) => field.getThroughBlockers(tileX, tileY),
    );
    const world = grid.tileToWorld(3, 0);
    const immune = {
      id: "immune-wall",
      tileX: 3,
      tileY: 0,
      x: world.x,
      y: world.y,
      isGhost: false,
      health: 50,
      enemyAttackImmune: true,
      takeDamage: () => {},
    };
    const manager = {
      towers: [immune],
      towerAt: (tileX, tileY) => (tileX === 3 && tileY === 0 ? immune : null),
      getTowerById: (towerId) => (towerId === immune.id ? immune : null),
    };
    enemyManager.setTowerManager(manager);
    physicsWorld.rebuildTowers(manager);
    const enemy = enemyManager.spawn("minion", 1, 0, 1);
    crowd.addAgent(enemy);
    expect(field.getDistanceToBase(0, 0)).toBe(-1);
    enemy.computeIntent(fixedDeltaSeconds, enemyManager);
    expect(enemy.routingMode).toBe("default");
    expect(enemy.siegeTower).toBeNull();
    teardown();
  });

  it("keeps the detour when the body's center sits inside a blocked tile beside an open lane", () => {
    // A body rounding a chamfered wall corner parks its center inside the wall
    // tile's rectangle. The open leg must anchor on the nearest tower-free tile,
    // or the sealed-lane rule misfires and converts the walk-around to a siege
    // against a wall the enemy chose to pass.
    const rows = ["S###W####B", "##########", "##########"];
    grid = gridFromRows(rows, { x: 0, y: 0 }, { x: 9, y: 0 });
    grid.registerTower(4, 0);
    grid.registerTower(4, 1);
    navBuilder = new NavMeshBuilder(grid);
    navBuilder.addTowerObstacle(4, 0);
    navBuilder.addTowerObstacle(4, 1);
    physicsWorld = new PhysicsWorld(grid);
    crowd = new CrowdManager(navBuilder.getNavMesh(), grid.tileSize, 8);
    field = new NavDistanceField(grid, navBuilder);
    field.rebuild();
    enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.setDistanceToBaseLookup((tileX, tileY) => field.getDistanceToBase(tileX, tileY));
    enemyManager.setThroughDistanceLookup(
      (tileX, tileY) => field.getThroughDistanceToBase(tileX, tileY),
      (tileX, tileY) => field.getThroughBlockers(tileX, tileY),
    );
    const wallWorld = grid.tileToWorld(4, 1);
    const wall = { ...fakeTower(4, 1, 1e6, wallWorld).tower };
    const manager = {
      towers: [wall],
      towerAt: (tileX, tileY) => (tileX === 4 && tileY === 1 ? wall : null),
      getTowerById: (towerId) => (towerId === wall.id ? wall : null),
    };
    enemyManager.setTowerManager(manager);
    physicsWorld.rebuildTowers(manager);
    const enemy = enemyManager.spawn("boss", 1, 0, 1);
    crowd.addAgent(enemy);
    // Center inside the wall tile's rectangle, in the chamfer pocket corner.
    const pocket = { x: wallWorld.x + 16, y: wallWorld.y + 6 };
    enemy.body.setTranslation(pocket, true);
    enemy.x = pocket.x;
    enemy.y = pocket.y;
    enemy.centerX = pocket.x;
    enemy.centerY = pocket.y;
    crowd.teleportAgent(enemy, pocket);
    expect(field.getDistanceToBase(4, 1)).toBe(-1);
    enemy.breachCooldownSeconds = 0;
    enemy.computeIntent(fixedDeltaSeconds, enemyManager);
    expect(enemy.routingMode).toBe("default");
    expect(enemy.siegeTower).toBeNull();
    teardown();
  });

  function teardown() {
    try {
      crowd?.destroy();
    } catch {
      // Intentionally ignore teardown races between scenarios.
    }
    try {
      navBuilder?.destroy();
    } catch {
      // Intentionally ignore teardown races between scenarios.
    }
    try {
      physicsWorld?.dispose();
    } catch {
      // Intentionally ignore teardown races between scenarios.
    }
    grid = null;
    physicsWorld = null;
    crowd = null;
    navBuilder = null;
    field = null;
    enemyManager = null;
  }
});
