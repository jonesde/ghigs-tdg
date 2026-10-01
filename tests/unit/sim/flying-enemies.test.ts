import { describe, expect, it, vi } from "vitest";
import type { CommanderMemory } from "@/commanders/brain.js";
import { createLlmBrain } from "@/commanders/llm/brain.js";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";
import type { CommanderObservation } from "@/commanders/observation.js";
import enemiesContent from "@/content/data/enemies.json";
import { EnemyMetaSchema } from "@/content/schemas/enemies.js";
import { ENEMY_TYPES, FIXED_DT } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { Enemy as EnemyEntity } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { canTraverseTile, readFlyingHeight, tilesTouchedBySegment } from "@/sim/enemies/flightGrid.js";
import { writeFlightVelocities } from "@/sim/enemies/flyingSteer.js";
import { selectTargetingTower } from "@/sim/enemies/targeting.js";
import { Grid } from "@/sim/grid/Grid.js";
import { generateProgressiveMap, progressiveConfigForIndex } from "@/sim/grid/ProgressiveMap.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { Tower as TowerEntity } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";
import { createTestEngine } from "../../helpers/engine-snapshot";
import { makeBastionMap, makeMapData } from "../../helpers/mock-grid";
import { makeParticleSystem } from "../../helpers/mock-managers";

const ENEMY_GROUP = 0x0001;
const PROJECTILE_GROUP = 0x0002;
const SENSOR_GROUP = 0x0004;
const BASE_GROUP = 0x0008;
const FLYER_GROUPS_SOLO = (ENEMY_GROUP << 16) | (BASE_GROUP | PROJECTILE_GROUP | SENSOR_GROUP);
const FLYER_GROUPS_WITH_ENEMIES = FLYER_GROUPS_SOLO | ENEMY_GROUP;

function laneGrid(): Grid {
  return new Grid(makeMapData({ width: 6, height: 3, spawns: [{ x: 0, y: 1 }], base: { x: 5, y: 1 } }));
}

function placeEnemy(enemy: Enemy, tileX: number, tileY: number): void {
  const world = enemy.grid.tileToWorld(tileX, tileY);
  enemy.x = world.x;
  enemy.y = world.y;
  enemy.centerX = world.x;
  enemy.centerY = world.y;
  enemy.body?.setTranslation({ x: world.x, y: world.y }, true);
}

function damageTower(tileX: number, tileY: number, immune = false): Tower {
  const tower = {
    tileX,
    tileY,
    x: 0,
    y: 0,
    isGhost: false,
    enemyAttackImmune: immune,
    health: 100,
    takeDamage(amount: number): void {
      if (tower.enemyAttackImmune) return;
      tower.health -= amount;
    },
  };
  return tower as unknown as Tower;
}

function bindTower(enemy: Enemy, tower: Tower): void {
  enemy.towerAt = (tileX, tileY) => (tileX === tower.tileX && tileY === tower.tileY ? tower : null);
  enemy.liveTowerAt = (tileX, tileY) => tileX === tower.tileX && tileY === tower.tileY && !tower.isGhost;
}

describe("flying enemy content", () => {
  it("loads nine rows and the three flying heights", () => {
    const types = enemiesContent.types;
    expect(Object.keys(types)).toEqual([
      "minion",
      "runner",
      "tank",
      "shielded",
      "healer",
      "boss",
      "flyer",
      "jet",
      "aegis",
    ]);
    for (const typeName of ["minion", "runner", "tank", "shielded", "healer", "boss"]) {
      expect(types[typeName as keyof typeof types].flyingHeight).toBe(0);
      expect(ENEMY_TYPES[typeName]?.flyingHeight).toBe(0);
    }
    expect(types.flyer.flyingHeight).toBe(2);
    expect(types.aegis.flyingHeight).toBe(3);
    expect(types.jet.flyingHeight).toBe(5);
    expect(ENEMY_TYPES.flyer?.flyingHeight).toBe(2);
    expect(ENEMY_TYPES.aegis?.flyingHeight).toBe(3);
    expect(ENEMY_TYPES.jet?.flyingHeight).toBe(5);
    expect(readFlyingHeight({})).toBe(0);
    expect(readFlyingHeight(undefined)).toBe(0);
  });

  it("rejects a missing, negative, or fractional flyingHeight and accepts 5", () => {
    const missing = { ...enemiesContent.types.minion } as { flyingHeight?: number };
    delete missing.flyingHeight;
    expect(EnemyMetaSchema.safeParse(missing).success).toBe(false);
    expect(EnemyMetaSchema.safeParse({ ...enemiesContent.types.jet, flyingHeight: -1 }).success).toBe(false);
    expect(EnemyMetaSchema.safeParse({ ...enemiesContent.types.jet, flyingHeight: 1.5 }).success).toBe(false);
    expect(EnemyMetaSchema.safeParse({ ...enemiesContent.types.jet, flyingHeight: 5 }).success).toBe(true);
  });
});

describe("flight traversal", () => {
  const grid = laneGrid();
  const noTower = () => false;

  it("keeps flyingHeight 0 on path, spawn, and base tiles", () => {
    grid.tiles[1]![2]!.type = "path";
    grid.tiles[1]![2]!.height = 4;
    expect(canTraverseTile(grid, 0, 1, 0, noTower)).toBe(true);
    expect(canTraverseTile(grid, 5, 1, 0, noTower)).toBe(true);
    expect(canTraverseTile(grid, 2, 1, 0, noTower)).toBe(true);
    expect(canTraverseTile(grid, 1, 0, 0, noTower)).toBe(false);
  });

  it("applies stored height and a live-tower bonus per flying height", () => {
    const towerAt = (tileX: number, tileY: number) => tileX === 2 && tileY === 1;
    grid.tiles[1]![2]!.height = 1;
    expect(canTraverseTile(grid, 2, 1, 2, noTower)).toBe(true);
    expect(canTraverseTile(grid, 2, 1, 2, towerAt)).toBe(true);
    grid.tiles[1]![2]!.height = 2;
    expect(canTraverseTile(grid, 2, 1, 2, noTower)).toBe(true);
    expect(canTraverseTile(grid, 2, 1, 2, towerAt)).toBe(false);
    grid.tiles[1]![2]!.height = 3;
    expect(canTraverseTile(grid, 2, 1, 2, noTower)).toBe(false);
    expect(canTraverseTile(grid, 2, 1, 3, noTower)).toBe(true);
    expect(canTraverseTile(grid, 2, 1, 3, towerAt)).toBe(false);
    grid.tiles[1]![2]!.height = 4;
    expect(canTraverseTile(grid, 2, 1, 3, noTower)).toBe(false);
    expect(canTraverseTile(grid, 2, 1, 5, towerAt)).toBe(true);
    expect(canTraverseTile(grid, 2, 1, 5, noTower)).toBe(true);

    const base = grid.getBase();
    grid.tiles[base.y]![base.x]!.height = 4;
    expect(canTraverseTile(grid, base.x, base.y, 5, noTower)).toBe(true);
    expect(canTraverseTile(grid, base.x, base.y, 3, noTower)).toBe(false);
    expect(canTraverseTile(grid, base.x, base.y, 2, noTower)).toBe(false);
    expect(canTraverseTile(grid, base.x, base.y, 0, noTower)).toBe(true);
  });

  it("includes both side tiles when a segment passes through a corner", () => {
    const tileSize = grid.tileSize;
    const orthogonal = tilesTouchedBySegment(tileSize * 0.5, tileSize * 0.5, tileSize * 1.5, tileSize * 0.5, tileSize);
    expect(orthogonal.map((tile) => `${tile.x},${tile.y}`)).toEqual(["0,0", "1,0"]);
    const diagonal = tilesTouchedBySegment(tileSize * 0.5, tileSize * 0.5, tileSize * 1.5, tileSize * 1.5, tileSize);
    const touched = new Set(diagonal.map((tile) => `${tile.x},${tile.y}`));
    expect(touched.has("0,0")).toBe(true);
    expect(touched.has("1,0")).toBe(true);
    expect(touched.has("0,1")).toBe(true);
    expect(touched.has("1,1")).toBe(true);
  });

  it("rejects void at every flying height and keeps a shifted origin on the same tiles", () => {
    const voidGrid = laneGrid();
    voidGrid.tiles[1]![1]!.type = "void";
    voidGrid.tiles[1]![1]!.height = 1;
    expect(canTraverseTile(voidGrid, 1, 1, 0, noTower)).toBe(false);
    expect(canTraverseTile(voidGrid, 1, 1, 2, noTower)).toBe(false);
    expect(canTraverseTile(voidGrid, 1, 1, 3, noTower)).toBe(false);
    expect(canTraverseTile(voidGrid, 1, 1, 5, noTower)).toBe(false);

    const tileSize = voidGrid.tileSize;
    const worldOriginX = -4 * tileSize;
    const worldOriginY = -6 * tileSize;
    const shifted = tilesTouchedBySegment(
      worldOriginX + tileSize * 0.5,
      worldOriginY + tileSize * 0.5,
      worldOriginX + tileSize * 1.5,
      worldOriginY + tileSize * 1.5,
      tileSize,
      worldOriginX,
      worldOriginY,
    );
    const touched = new Set(shifted.map((tile) => `${tile.x},${tile.y}`));
    expect(touched.has("0,0")).toBe(true);
    expect(touched.has("1,0")).toBe(true);
    expect(touched.has("0,1")).toBe(true);
    expect(touched.has("1,1")).toBe(true);
  });
});

describe("flight routes", () => {
  it("keeps a jet chord straight over a height-4 tower and bends a flyer around a height-2 tower", () => {
    const grid = laneGrid();
    grid.tiles[1]![2]!.height = 4;
    const towerAt = (tileX: number, tileY: number) => tileX === 2 && tileY === 1;
    const jet = new EnemyEntity("jet", 1, 0, grid, 1);
    jet.liveTowerAt = towerAt;
    jet.computeIntent(FIXED_DT, null);
    expect(jet.agent).toBeNull();
    expect(jet.flightPoints).toHaveLength(2);
    const base = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    expect(jet.flightPoints[1]).toEqual(base);

    grid.tiles[1]![2]!.height = 2;
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    flyer.liveTowerAt = () => false;
    flyer.computeIntent(FIXED_DT, null);
    expect(flyer.flightPoints).toHaveLength(2);

    flyer.liveTowerAt = towerAt;
    grid.pathVersion += 1;
    flyer.clearFlightPolyline();
    flyer.computeIntent(FIXED_DT, null);
    expect(flyer.flightPoints.length).toBeGreaterThan(2);

    flyer.liveTowerAt = () => false;
    grid.pathVersion += 1;
    flyer.clearFlightPolyline();
    flyer.computeIntent(FIXED_DT, null);
    expect(flyer.flightPoints).toHaveLength(2);
  });

  it("flies the placed corridor around a void shortcut and snaps back off the margin", () => {
    const width = 7;
    const height = 5;
    const map = makeMapData({ width, height, spawns: [{ x: 0, y: 1 }], base: { x: 6, y: 1 } }) as ReturnType<
      typeof makeMapData
    > & { originTileX?: number; originTileY?: number };
    map.originTileX = -4;
    map.originTileY = -6;
    const grid = new Grid(map);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const tile = grid.tiles[row]![column]!;
        tile.type = "terrain";
        tile.height = 4;
      }
    }
    for (let column = 0; column < width; column++) {
      const margin = grid.tiles[0]![column]!;
      margin.type = "void";
      margin.height = 1;
      const corridor = grid.tiles[4]![column]!;
      corridor.type = "path";
      corridor.height = 1;
    }
    for (const row of [2, 3]) {
      const west = grid.tiles[row]![0]!;
      west.type = "path";
      west.height = 1;
      const east = grid.tiles[row]![6]!;
      east.type = "path";
      east.height = 1;
    }
    grid.tiles[1]![0]!.type = "spawn";
    grid.tiles[1]![0]!.height = 1;
    grid.tiles[1]![6]!.type = "base";
    grid.tiles[1]![6]!.height = 1;

    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    placeEnemy(flyer, 0, 1);
    flyer.computeIntent(FIXED_DT, null);
    expect(flyer.flightPoints.length).toBeGreaterThan(2);
    let usedCorridor = false;
    for (const point of flyer.flightPoints) {
      const tile = grid.worldToTile(point.x, point.y);
      expect(grid.isVoid(tile.x, tile.y)).toBe(false);
      expect(canTraverseTile(grid, tile.x, tile.y, flyer.flyingHeight, () => false)).toBe(true);
      if (tile.y === 4) usedCorridor = true;
    }
    expect(usedCorridor).toBe(true);

    placeEnemy(flyer, 3, 0);
    flyer.lastMoveTargetWorld = null;
    flyer.postPhysics(FIXED_DT);
    const landed = flyer.currentTile();
    expect(grid.isVoid(landed.x, landed.y)).toBe(false);
    expect(canTraverseTile(grid, landed.x, landed.y, flyer.flyingHeight, flyer.liveTowerAt)).toBe(true);
  });

  it("keeps a progressive spawn-to-base route off the unplaced margin", () => {
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const grid = new Grid(generateProgressiveMap(config));
    const spawn = grid.spawns[0];
    if (!spawn) throw new Error("spawn missing");
    expect(grid.worldOriginX).not.toBe(0);
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    placeEnemy(flyer, spawn.x, spawn.y);
    flyer.computeIntent(FIXED_DT, null);
    expect(flyer.flightPoints.length).toBeGreaterThan(1);
    for (const point of flyer.flightPoints) {
      const tile = grid.worldToTile(point.x, point.y);
      expect(grid.isVoid(tile.x, tile.y)).toBe(false);
    }
  });

  it("drops a height-4 waypoint for a flyer and keeps it for a jet", () => {
    const grid = laneGrid();
    grid.tiles[0]![2]!.height = 4;
    const base = grid.getBase();
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    flyer.applyRoute([{ x: 2, y: 0 }, base], "route");
    expect(flyer.routeTiles).toEqual([base]);
    const jet = new EnemyEntity("jet", 1, 0, grid, 1);
    jet.applyRoute([{ x: 2, y: 0 }, base], "route");
    expect(jet.routeTiles).toEqual([{ x: 2, y: 0 }, base]);
  });

  it("leaves a flyer on its previous mode when the hold tile is too tall", () => {
    const grid = laneGrid();
    grid.tiles[0]![2]!.height = 4;
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    expect(flyer.routingMode).toBe("default");
    expect(flyer.holdWorld).toBeNull();
    flyer.applyRoute([{ x: 2, y: 0 }], "hold");
    expect(flyer.routingMode).toBe("default");
    expect(flyer.holdWorld).toBeNull();
  });

  it("routes a flyer off a tile a new tower closed, without teleporting", () => {
    const grid = laneGrid();
    grid.tiles[1]![2]!.height = 2;
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    placeEnemy(flyer, 2, 1);
    flyer.liveTowerAt = (tileX, tileY) => tileX === 2 && tileY === 1;
    const beforeX = flyer.x;
    const beforeY = flyer.y;
    flyer.computeIntent(FIXED_DT, null);
    expect(flyer.x).toBe(beforeX);
    expect(flyer.y).toBe(beforeY);
    expect(flyer.currentTile()).toEqual({ x: 2, y: 1 });
    const recovery = flyer.flightPoints[0];
    expect(recovery).toBeDefined();
    expect(recovery).not.toEqual(grid.tileToWorld(2, 1));
    for (let step = 0; step < 4; step++) flyer.postPhysics(0.5);
    const landed = flyer.currentTile();
    expect(canTraverseTile(grid, landed.x, landed.y, flyer.flyingHeight, flyer.liveTowerAt)).toBe(true);
  });
});

describe("flight attacks", () => {
  it("hits on entry and again only after the attack interval while the center stays", () => {
    const grid = laneGrid();
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    const tower = damageTower(2, 1);
    bindTower(flyer, tower);
    placeEnemy(flyer, 2, 1);
    flyer.postPhysics(FIXED_DT);
    expect(tower.health).toBe(100 - flyer.attackDamage);
    const afterEntry = tower.health;
    flyer.postPhysics(1 / flyer.attackSpeed - 0.05);
    expect(tower.health).toBe(afterEntry);
    flyer.postPhysics(0.1);
    expect(tower.health).toBe(afterEntry - flyer.attackDamage);
  });

  it("does not strafe an immune tower or a tower the center never enters", () => {
    const grid = laneGrid();
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    const immune = damageTower(2, 1, true);
    bindTower(flyer, immune);
    placeEnemy(flyer, 2, 1);
    flyer.postPhysics(FIXED_DT);
    expect(immune.health).toBe(100);

    const aside = new EnemyEntity("flyer", 1, 0, grid, 1);
    const tower = damageTower(2, 1);
    bindTower(aside, tower);
    placeEnemy(aside, 1, 1);
    aside.postPhysics(FIXED_DT);
    expect(tower.health).toBe(100);
  });

  it("parks a siege on an enterable tower tile and on a neighbor when the tile is too tall", () => {
    const grid = laneGrid();
    const physics = new PhysicsWorld(grid);
    try {
      const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
      physics.addEnemy(flyer);
      const openTower = damageTower(2, 1);
      openTower.x = grid.tileToWorld(2, 1).x;
      openTower.y = grid.tileToWorld(2, 1).y;
      bindTower(flyer, openTower);
      placeEnemy(flyer, 2, 1);
      flyer.applySiege(openTower);
      writeFlightVelocities([flyer], grid, FIXED_DT, null);
      expect(flyer.motionLock).toBe("park");
      flyer.postPhysics(FIXED_DT);
      expect(openTower.health).toBeLessThan(100);

      const closed = new EnemyEntity("flyer", 1, 0, grid, 1);
      physics.addEnemy(closed);
      grid.tiles[1]![3]!.height = 4;
      const tallTower = damageTower(3, 1);
      tallTower.x = grid.tileToWorld(3, 1).x;
      tallTower.y = grid.tileToWorld(3, 1).y;
      bindTower(closed, tallTower);
      placeEnemy(closed, 3, 0);
      closed.applySiege(tallTower);
      writeFlightVelocities([closed], grid, FIXED_DT, null);
      expect(closed.motionLock).toBe("park");
      expect(closed.currentTile()).toEqual({ x: 3, y: 0 });
      closed.postPhysics(FIXED_DT);
      expect(tallTower.health).toBeLessThan(100);

      tallTower.isGhost = true;
      closed.computeIntent(FIXED_DT, null);
      expect(closed.routingMode).toBe("default");
      const base = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
      expect(closed.flightPoints[closed.flightPoints.length - 1]).toEqual(base);
    } finally {
      physics.dispose();
    }
  });

  it("does not strafe while routingMode is siege until the park", () => {
    const grid = laneGrid();
    const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
    const tower = damageTower(2, 1);
    tower.x = grid.tileToWorld(2, 1).x;
    tower.y = grid.tileToWorld(2, 1).y;
    bindTower(flyer, tower);
    placeEnemy(flyer, 2, 1);
    flyer.applySiege(tower);
    expect(flyer.motionLock).toBe("none");
    flyer.postPhysics(FIXED_DT);
    expect(tower.health).toBe(100);
  });
});

describe("flight physics", () => {
  it("does not shove a flyer out of a tower square or set blockedByTower", () => {
    const grid = new Grid(makeBastionMap());
    const physics = new PhysicsWorld(grid);
    try {
      const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
      physics.addEnemy(flyer);
      const towerCenter = grid.tileToWorld(3, 3);
      const tower = {
        id: "tower-flight",
        tileX: 3,
        tileY: 3,
        x: towerCenter.x,
        y: towerCenter.y,
        isGhost: false,
        health: 40,
        takeDamage: (): void => {},
      } as unknown as Tower;
      physics.rebuildTowers({ towers: [tower] } as unknown as TowerManager);
      placeEnemy(flyer, 3, 3);
      physics.step();
      const position = flyer.body!.translation();
      expect(position.x).toBeCloseTo(towerCenter.x, 2);
      expect(position.y).toBeCloseTo(towerCenter.y, 2);
      expect(flyer.blockedByTower).toBeNull();
    } finally {
      physics.dispose();
    }
  });

  it("latches a flyer on the base and then holds that position", () => {
    const grid = new Grid(makeBastionMap());
    const physics = new PhysicsWorld(grid);
    try {
      const flyer = new EnemyEntity("flyer", 1, 0, grid, 1);
      physics.addEnemy(flyer);
      const base = grid.getBase();
      placeEnemy(flyer, base.x, base.y);
      physics.step();
      expect(flyer.attackingBase).toBe(true);
      expect(flyer.motionLock).toBe("park");
      const parked = flyer.body!.translation();
      flyer.body!.setLinvel({ x: 80, y: 0 }, true);
      writeFlightVelocities([flyer], grid, FIXED_DT, null);
      physics.step();
      const held = flyer.body!.translation();
      expect(Math.hypot(held.x - parked.x, held.y - parked.y)).toBeLessThan(grid.tileSize * 0.25);
      expect(flyer.attackingBase).toBe(true);
    } finally {
      physics.dispose();
    }
  });

  it("spawns flyers without a crowd agent and keeps tower and corridor out of the flyer filter", () => {
    const engine = createTestEngine(0);
    try {
      const enemyManager = engine.enemyManager;
      if (!enemyManager) throw new Error("engine has no enemy manager");
      const jet = enemyManager.spawn("jet", 1, 0, 1);
      const minion = enemyManager.spawn("minion", 1, 0, 1);
      expect(jet).not.toBeNull();
      expect(minion).not.toBeNull();
      expect(jet!.agent).toBeNull();
      expect(minion!.agent).not.toBeNull();
      const physics = enemyManager.physicsWorld!;
      physics.setEnemyEnemyCollisions(true);
      expect(jet!.body!.collider(0).collisionGroups()).toBe(FLYER_GROUPS_WITH_ENEMIES);
      physics.setEnemyEnemyCollisions(false);
      expect(jet!.body!.collider(0).collisionGroups()).toBe(FLYER_GROUPS_SOLO);

      const grid = engine.grid!;
      const corner = grid.tileToWorld(0, 0);
      placeEnemy(jet!, 0, 0);
      jet!.ballisticTimer = 1;
      engine.update(FIXED_DT);
      expect(Math.abs(jet!.x - corner.x)).toBeLessThan(1);
      expect(Math.abs(jet!.y - corner.y)).toBeLessThan(1);
      expect(jet!.ballisticTimer).toBeGreaterThan(0);
    } finally {
      engine.dispose();
    }
  });
});

describe("flight distance", () => {
  it("ranks first and last with the flight field and ignores a tower the flyer cannot enter", () => {
    const grid = laneGrid();
    const minion = { id: 1, x: grid.tileToWorld(1, 1).x, y: grid.tileToWorld(1, 1).y, hp: 10, flyingHeight: 0 };
    const flyer = { id: 2, x: grid.tileToWorld(4, 1).x, y: grid.tileToWorld(4, 1).y, hp: 10, flyingHeight: 2 };
    const selector = {
      targeting: "first" as "first" | "last",
      grid,
      navDistanceToBase(tileX: number, _tileY: number, flyingHeight = 0): number {
        if (flyingHeight > 0) return tileX === 4 ? 12 : 8;
        return tileX === 4 ? 2 : 8;
      },
    };
    const first = TowerEntity.prototype.selectTarget.call(selector as unknown as TowerEntity, [minion, flyer]);
    expect(first?.id).toBe(minion.id);
    selector.targeting = "last";
    const last = TowerEntity.prototype.selectTarget.call(selector as unknown as TowerEntity, [minion, flyer]);
    expect(last?.id).toBe(flyer.id);

    const openTower = { tileX: 1, tileY: 1, health: 10 };
    const closedTower = { tileX: 2, tileY: 1, health: 80 };
    const distanceAt = (tileX: number) => (tileX === 2 ? -1 : 3);
    expect(selectTargetingTower("strongestAhead", 4, 1, 6, [openTower, closedTower], distanceAt)).toBe(openTower);
    expect(selectTargetingTower("strongestAhead", 4, 1, 6, [closedTower], distanceAt)).toBeNull();
  });

  it("seals a flyer's distance when a tower closes the only corridor", async () => {
    const engine = createTestEngine(0);
    try {
      const grid = engine.grid!;
      const spawn = grid.spawns[0]!;
      const base = grid.base;
      for (let tileY = 0; tileY < grid.height; tileY++) {
        for (let tileX = 0; tileX < grid.width; tileX++) grid.tiles[tileY]![tileX]!.height = 4;
      }
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const tile = grid.tiles[base.y + offsetY]?.[base.x + offsetX];
          if (tile) tile.height = 1;
        }
      }
      grid.tiles[spawn.y]![spawn.x]!.height = 1;
      const corridor: { x: number; y: number }[] = [];
      const remember = (tileX: number, tileY: number): void => {
        const tile = grid.tiles[tileY]![tileX]!;
        if (tile.type === "base" || tile.type === "spawn") return;
        tile.height = 2;
        corridor.push({ x: tileX, y: tileY });
      };
      if (spawn.x !== base.x) {
        const stepX = Math.sign(base.x - spawn.x);
        for (let tileX = spawn.x + stepX; tileX !== base.x; tileX += stepX) remember(tileX, spawn.y);
        remember(base.x, spawn.y);
      }
      if (spawn.y !== base.y) {
        const stepY = Math.sign(base.y - spawn.y);
        for (let tileY = spawn.y + stepY; tileY !== base.y; tileY += stepY) remember(base.x, tileY);
      }
      expect(corridor.length).toBeGreaterThan(0);
      const bridge = corridor[Math.floor(corridor.length / 2)]!;
      expect(grid.canBuild(bridge.x, bridge.y)).toBe(true);

      const enemyManager = engine.enemyManager;
      if (!enemyManager) throw new Error("engine has no enemy manager");
      const flyer = enemyManager.spawn("flyer", 1, 0, 1);
      expect(flyer).not.toBeNull();
      engine.update(FIXED_DT);
      const openSnapshot = buildSnapshot(engine, 0);
      const openEnemy = openSnapshot.enemies.find((enemy) => enemy.id === flyer!.id);
      const openTile = flyer!.currentTile();
      const openDistance = engine.flightDistanceField!.getDistanceToBase(openTile.x, openTile.y, 2);
      expect(openEnemy?.distanceToBase).toBe(openDistance);
      expect(openDistance).toBeGreaterThan(0);
      expect(openEnemy?.flyingHeight).toBe(2);
      expect(openSnapshot.heights?.length).toBe(grid.height);
      expect(openSnapshot.heights?.[0]?.length).toBe(grid.width);
      expect(openSnapshot.heights?.[bridge.y]?.[bridge.x]).toBe(2);
      expect(openSnapshot.heights?.[spawn.y]?.[spawn.x]).toBe(1);

      const tower = engine.towerManager!.build("basic", bridge.x, bridge.y, engine.persistState, grid);
      expect(tower).not.toBeNull();
      engine.update(FIXED_DT);
      const sealedSnapshot = buildSnapshot(engine, 0);
      const sealedEnemy = sealedSnapshot.enemies.find((enemy) => enemy.id === flyer!.id);
      const sealedTile = flyer!.currentTile();
      const sealedDistance = engine.flightDistanceField!.getDistanceToBase(sealedTile.x, sealedTile.y, 2);
      expect(sealedEnemy?.distanceToBase).toBe(sealedDistance);
      expect(sealedDistance).toBe(-1);
      expect(sealedSnapshot.heights?.[bridge.y]?.[bridge.x]).toBe(2);

      const memory = makeCommanderMemory();
      const fetchFn = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "[]" } }], usage: { prompt_tokens: 10 } }),
      }));
      const brain = createLlmBrain(makeCommanderConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
      await brain.decide(commanderObservation(flyer!.id, openDistance), memory);
      await brain.decide(commanderObservation(flyer!.id, sealedDistance), memory);
      const second = userPayload(fetchFn, 1) as {
        changedEnemies: { id: number; distanceToBase: number; flyingHeight: number }[];
      };
      expect(second.changedEnemies).toEqual([
        expect.objectContaining({ id: flyer!.id, distanceToBase: -1, flyingHeight: 2 }),
      ]);
    } finally {
      engine.dispose();
    }
  });
});

describe("flying wave rolls", () => {
  const map = makeBastionMap();
  const grid = new Grid(map);
  const enemyManager = new EnemyManager(grid, makeParticleSystem(), 0);

  function generate(seed: number, waveNumber: number): { type: string }[] {
    map.seed = seed;
    return new WaveManager(map, enemyManager).generateWave(waveNumber);
  }

  it("keeps flyer, jet, and aegis behind their minimum waves and still rolls each of them", () => {
    let sawFlyer = false;
    let sawJet = false;
    let sawAegis = false;
    for (let seed = 0; seed < 60; seed++) {
      for (let waveNumber = 1; waveNumber <= 6; waveNumber++) {
        for (const entry of generate(seed, waveNumber)) {
          expect(entry.type === "flyer" || entry.type === "jet" || entry.type === "aegis").toBe(false);
          expect(ENEMY_TYPES[entry.type]).toBeDefined();
        }
      }
      const wave12 = generate(seed, 12);
      const wave22 = generate(seed, 22);
      const wave32 = generate(seed, 32);
      for (const entry of [...wave12, ...wave22, ...wave32]) expect(ENEMY_TYPES[entry.type]).toBeDefined();
      expect(wave12.some((entry) => entry.type === "jet" || entry.type === "aegis")).toBe(false);
      expect(wave22.some((entry) => entry.type === "aegis")).toBe(false);
      if (wave12.some((entry) => entry.type === "flyer")) sawFlyer = true;
      if (wave22.some((entry) => entry.type === "jet")) sawJet = true;
      if (wave32.some((entry) => entry.type === "aegis")) sawAegis = true;
    }
    expect(sawFlyer).toBe(true);
    expect(sawJet).toBe(true);
    expect(sawAegis).toBe(true);
  });
});

function makeCommanderConfig(): LlmCommanderConfig {
  return {
    id: "llm1",
    name: "LLM 1",
    endpointUrl: "http://localhost:1234/v1",
    token: "",
    modelName: "",
    contextLimit: 32768,
    commanderInstructions: "",
    systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
    requestTimeoutMs: 30000,
    pauseForCommander: false,
    decisionIntervalMs: 1000,
    reasoningEnabled: false,
    temperatureReasoningOff: DEFAULT_TEMPERATURE_REASONING_OFF,
    temperatureReasoningOn: DEFAULT_TEMPERATURE_REASONING_ON,
  };
}

function makeCommanderMemory(): CommanderMemory {
  return {
    phase: "idle",
    seenByWave: new Map(),
    lastRushWaveNumber: null,
    lastRoutedTowerSignature: "",
    gridLayout: undefined,
    heights: undefined,
    conversation: [],
    tokenCount: 0,
    lastObservation: null,
    commanderInstructions: "",
    pendingPlayerMessages: [],
    isCompressing: false,
    rejectionNote: null,
  };
}

function commanderObservation(enemyId: number, distanceToBase: number): CommanderObservation {
  return {
    map: [[1, 2]],
    enemies: [
      {
        id: enemyId,
        type: "flyer",
        tileX: 0,
        tileY: 0,
        level: 1,
        hp: 10,
        maxHp: 10,
        routingMode: "default",
        distanceToBase,
        flyingHeight: 2,
      },
    ],
    towers: [],
    wave: {
      currentWave: 1,
      pendingEnemyCount: 0,
      spawnStates: [],
      remainingScheduledSpawns: 0,
      active: false,
      baseHealth: 40,
      maxBaseHealth: 100,
      countdownRemaining: null,
    },
  };
}

function userPayload(fetchFn: { mock: { calls: unknown[][] } }, callIndex: number): unknown {
  const calls = fetchFn.mock.calls as unknown as unknown[][];
  const init = calls[callIndex]?.[1] as { body?: string } | undefined;
  const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
  const userMessages = body.messages.filter((message) => message.role === "user");
  const userMessage = userMessages[userMessages.length - 1];
  return JSON.parse(userMessage?.content ?? "{}");
}
