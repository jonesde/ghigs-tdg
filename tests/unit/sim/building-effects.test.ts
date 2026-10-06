import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { Enemy as EnemyEntity } from "@/sim/enemies/Enemy.js";
import type { GameEngine } from "@/sim/GameEngine.js";
import { Grid } from "@/sim/grid/Grid.js";
import {
  activeBuildingBonus,
  BUILDING_EFFECTS,
  type BuildingBonusField,
  type BuildingKind,
  buildingDetailLines,
  type MapBuildingSite,
  neighborBonus,
  refreshBuildingActivity,
} from "@/sim/mapSites.js";
import { ProjectileManager } from "@/sim/ProjectileManager.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { Tower as TowerEntity } from "@/sim/towers/Tower.js";
import { makeMapData } from "../../helpers/mock-grid";
import { makeParticleSystem } from "../../helpers/mock-managers";
import { freshEngine } from "../../helpers/simFixtures";

function site(kind: BuildingKind, tileX: number, tileY: number, active = false): MapBuildingSite {
  return { id: tileX * 1000 + tileY, kind, tileX, tileY, active };
}

// A scripted tile lookup: only the listed tiles answer true, which is what makes the
// 8-ring test independent of board geometry.
function towerAt(tiles: readonly { x: number; y: number }[]): (tileX: number, tileY: number) => boolean {
  return (tileX, tileY) => tiles.some((tile) => tile.x === tileX && tile.y === tileY);
}

// The per-tower field a kind writes, so a test can assert against whichever kind
// the board rolled instead of assuming one.
const SITE_FIELD_ON_TOWER: Record<BuildingBonusField, (tower: Tower) => number> = {
  damageMult: (tower) => tower.siteDamageMult,
  fireRateMult: (tower) => tower.siteFireRateMult,
  rangeMult: (tower) => tower.siteRangeMult,
  flyingDamageMult: (tower) => tower.siteFlyingDamageMult,
};

// What one powered building of a kind pays the whole board, given how many buildings
// are powered. A ramp kind counts the whole board; the rest pay their own constant.
function wholeBoardMult(kind: BuildingKind, activeCount: number): number {
  const effect = BUILDING_EFFECTS[kind];
  return effect.activeMult !== 1 ? effect.activeMult : effect.boardRampMult ** activeCount;
}

describe("building activity", () => {
  it("is powered by a tower on any of the 8 tiles around it", () => {
    const ring = [
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    for (const offset of ring) {
      const building = site("armory", 5, 5);
      refreshBuildingActivity([building], towerAt([{ x: 5 + offset.x, y: 5 + offset.y }]));
      expect(building.active, `offset ${offset.x},${offset.y}`).toBe(true);
    }
  });

  it("is not powered by a tower two tiles away or one on its own tile", () => {
    const twoAway = site("armory", 5, 5);
    refreshBuildingActivity([twoAway], towerAt([{ x: 7, y: 5 }]));
    expect(twoAway.active).toBe(false);

    const ownTile = site("armory", 5, 5);
    refreshBuildingActivity([ownTile], towerAt([{ x: 5, y: 5 }]));
    expect(ownTile.active).toBe(false);
  });

  it("goes inactive again when the tower beside it is gone", () => {
    const building = site("armory", 5, 5);
    const powered = towerAt([{ x: 6, y: 5 }]);
    refreshBuildingActivity([building], powered);
    expect(building.active).toBe(true);
    refreshBuildingActivity([building], towerAt([]));
    expect(building.active).toBe(false);
  });
});

describe("activeBuildingBonus", () => {
  it("pays the active half of every powered building to the whole board", () => {
    const armory = site("armory", 5, 5, true);
    const magazine = site("magazine", 20, 5, true);
    const beacon = site("beacon", 20, 20, true);
    const bonus = activeBuildingBonus([armory, magazine, beacon]);
    expect(bonus.activeCount).toBe(3);
    expect(bonus.damageMult).toBeCloseTo(BUILDING_EFFECTS.armory.activeMult, 10);
    expect(bonus.fireRateMult).toBeCloseTo(BUILDING_EFFECTS.magazine.activeMult, 10);
    expect(bonus.rangeMult).toBeCloseTo(BUILDING_EFFECTS.beacon.activeMult, 10);
    expect(bonus.flyingDamageMult).toBe(1);
  });

  it("pays nothing for an unpowered building", () => {
    const sleeping = site("armory", 5, 5, false);
    const bonus = activeBuildingBonus([sleeping]);
    expect(bonus.activeCount).toBe(0);
    expect(bonus.damageMult).toBe(1);
  });

  it("routes each kind to its own stat", () => {
    const bonus = activeBuildingBonus([
      site("foundry", 5, 5, true),
      site("clocktower", 20, 5, true),
      site("aviary", 20, 20, true),
    ]);
    const ramp = BUILDING_EFFECTS.foundry.boardRampMult;
    expect(bonus.damageMult).toBeCloseTo(ramp ** 3, 10);
    expect(bonus.fireRateMult).toBeCloseTo(ramp ** 3, 10);
    expect(bonus.flyingDamageMult).toBeCloseTo(BUILDING_EFFECTS.aviary.activeMult, 10);
    expect(bonus.rangeMult).toBe(1);
  });

  it("counts every powered building toward a ramp, whatever its kind", () => {
    const foundryPlusArmory = activeBuildingBonus([site("foundry", 5, 5, true), site("armory", 20, 5, true)]);
    expect(BUILDING_EFFECTS.armory.activeMult).toBe(1.1);
    expect(BUILDING_EFFECTS.foundry.boardRampMult).toBe(1.01);
    // The armory pays its own whole-board half; the foundry pays one ramp over both
    // powered buildings, itself included.
    expect(foundryPlusArmory.damageMult).toBeCloseTo(1.1 * 1.01 * 1.01, 10);
  });

  it("applies one ramp per field however many ramp buildings are powered", () => {
    const twoFoundries = activeBuildingBonus([site("foundry", 5, 5, true), site("foundry", 20, 5, true)]);
    expect(twoFoundries.damageMult).toBeCloseTo(1.01 * 1.01, 10);
  });

  it("pays no ramp when the only ramp building is unpowered", () => {
    const sleepingFoundry = activeBuildingBonus([site("foundry", 5, 5, false), site("armory", 20, 5, true)]);
    expect(sleepingFoundry.damageMult).toBeCloseTo(BUILDING_EFFECTS.armory.activeMult, 10);
  });
});

describe("neighborBonus", () => {
  it("stacks the adjacent half on top of the whole-board half", () => {
    const armory = site("armory", 5, 5, true);
    const global = activeBuildingBonus([armory]);
    const adjacent = neighborBonus(6, 5, [armory], global);
    expect(adjacent.damageMult).toBeCloseTo(
      BUILDING_EFFECTS.armory.activeMult * BUILDING_EFFECTS.armory.adjacentMult,
      10,
    );
    const distant = neighborBonus(30, 30, [armory], global);
    expect(distant.damageMult).toBeCloseTo(BUILDING_EFFECTS.armory.activeMult, 10);
  });

  it("gives an adjacent tower nothing from a tethered kind", () => {
    const foundry = site("foundry", 5, 5, false);
    const bonus = neighborBonus(6, 5, [foundry]);
    expect(bonus.damageMult).toBe(1);
  });

  it("sends the aviary's adjacent bonus to flying damage only", () => {
    const aviary = site("aviary", 5, 5, false);
    const bonus = neighborBonus(6, 5, [aviary]);
    expect(bonus.flyingDamageMult).toBeCloseTo(BUILDING_EFFECTS.aviary.adjacentMult, 10);
    expect(bonus.damageMult).toBe(1);
  });

  it("reports the powered state in the detail copy", () => {
    expect(buildingDetailLines("armory", true)).toHaveLength(2);
    expect(buildingDetailLines("armory", false)).toHaveLength(3);
    expect(buildingDetailLines("foundry", true).join(" ")).toContain("×1.01");
  });
});

describe("engine building wiring", () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = freshEngine(0);
  });

  // The real reconcile already placed buildings; take the first one and a legal tile
  // in its ring, so the test drives the same placement path the player does.
  function buildingWithRoom(): { building: MapBuildingSite; towerTile: { x: number; y: number } } {
    const grid = engine.grid;
    const building = engine.mapBuildings[0];
    if (!grid || !building) throw new Error("engine placed no buildings");
    for (let deltaY = -1; deltaY <= 1; deltaY++) {
      for (let deltaX = -1; deltaX <= 1; deltaX++) {
        if (deltaX === 0 && deltaY === 0) continue;
        const tileX = building.tileX + deltaX;
        const tileY = building.tileY + deltaY;
        if (grid.isTerrain(tileX, tileY) && grid.canBuild(tileX, tileY))
          return { building, towerTile: { x: tileX, y: tileY } };
      }
    }
    throw new Error("no buildable tile beside the first building");
  }

  // A tower that stands clear of every building ring, so it only ever sees the
  // whole-board half.
  function clearOfEveryBuilding(): { x: number; y: number } {
    const grid = engine.grid;
    if (!grid) throw new Error("engine has no grid");
    const buildings = engine.mapBuildings;
    for (let tileY = 0; tileY < grid.height; tileY++) {
      for (let tileX = 0; tileX < grid.width; tileX++) {
        if (!grid.isTerrain(tileX, tileY) || !grid.canBuild(tileX, tileY)) continue;
        const clear = buildings.every(
          (building) => Math.max(Math.abs(tileX - building.tileX), Math.abs(tileY - building.tileY)) > 1,
        );
        if (clear) return { x: tileX, y: tileY };
      }
    }
    throw new Error("no tile clear of every building");
  }

  function buildAt(tileX: number, tileY: number): Tower {
    const grid = engine.grid;
    const world = grid?.tileToWorld(tileX, tileY);
    if (!grid || !world) throw new Error("engine has no grid");
    engine.runState.selectedTowerType = "basic";
    engine.runState.gold = 100000;
    engine.handleClick(world.x, world.y);
    const tower = engine.towerManager?.towerAt(tileX, tileY);
    if (!tower) throw new Error(`tower did not build at ${tileX},${tileY}`);
    return tower;
  }

  it("starts every placed building inactive until a tower stands beside it", () => {
    expect(engine.mapBuildings.length).toBeGreaterThan(0);
    expect(engine.mapBuildings.every((building) => building.active === false)).toBe(true);
    expect(engine.activeBuildings.activeCount).toBe(0);
  });

  it("powers the building and pays every tower when a tower is built beside it", () => {
    const { building, towerTile } = buildingWithRoom();
    const bystanderTile = clearOfEveryBuilding();
    const bystander = buildAt(bystanderTile.x, bystanderTile.y);
    const bystanderField = SITE_FIELD_ON_TOWER[BUILDING_EFFECTS[building.kind].field];
    expect(bystanderField(bystander)).toBe(1);

    const adjacent = buildAt(towerTile.x, towerTile.y);

    expect(building.active).toBe(true);
    expect(engine.activeBuildings.activeCount).toBe(1);
    const effect = BUILDING_EFFECTS[building.kind];
    const wholeBoard = wholeBoardMult(building.kind, engine.activeBuildings.activeCount);
    expect(engine.activeBuildings[effect.field]).toBeCloseTo(wholeBoard, 10);
    expect(SITE_FIELD_ON_TOWER[effect.field](adjacent)).toBeCloseTo(effect.adjacentMult * wholeBoard, 10);
    // The whole-board half reaches a tower standing nowhere near the building.
    expect(bystanderField(bystander)).toBeCloseTo(wholeBoard, 10);
    expect(engine.baseDefense?.buildingDamageMult).toBe(engine.activeBuildings.damageMult);
  });

  it("drops the whole-board half when the tower beside the building ghosts", () => {
    const { building, towerTile } = buildingWithRoom();
    const adjacent = buildAt(towerTile.x, towerTile.y);
    expect(building.active).toBe(true);

    // A terrain tower is immune to contact attacks, and the siege path is the one
    // that reaches it, so that is how a terrain tower dies.
    adjacent.takeAbilityDamage(adjacent.health + 1);
    expect(adjacent.isGhost).toBe(true);
    engine.update(FIXED_DT);

    expect(building.active).toBe(false);
    expect(engine.activeBuildings.activeCount).toBe(0);
    expect(engine.activeBuildings.damageMult).toBe(1);
    expect(engine.activeBuildings.fireRateMult).toBe(1);
    expect(engine.baseDefense?.buildingFireRateMult).toBe(1);
  });

  it("restores the whole-board half when the ghosted tower beside the building recovers", () => {
    const { building, towerTile } = buildingWithRoom();
    const effect = BUILDING_EFFECTS[building.kind];
    const bystanderTile = clearOfEveryBuilding();
    const bystander = buildAt(bystanderTile.x, bystanderTile.y);
    const bystanderField = SITE_FIELD_ON_TOWER[effect.field];
    expect(bystanderField(bystander)).toBe(1);

    const adjacent = buildAt(towerTile.x, towerTile.y);
    const wholeBoard = wholeBoardMult(building.kind, 1);
    expect(building.active).toBe(true);
    expect(bystanderField(bystander)).toBeCloseTo(wholeBoard, 10);
    expect(SITE_FIELD_ON_TOWER[effect.field](adjacent)).toBeCloseTo(effect.adjacentMult * wholeBoard, 10);

    adjacent.takeAbilityDamage(adjacent.health + 1);
    engine.update(FIXED_DT);
    expect(building.active).toBe(false);
    expect(bystanderField(bystander)).toBe(1);

    // Fast-forward the restore timer so Tower.update calls restore() on this tick.
    adjacent.ghostTimer = 1000;
    engine.update(FIXED_DT);

    expect(adjacent.isGhost).toBe(false);
    expect(building.active).toBe(true);
    expect(engine.activeBuildings.activeCount).toBe(1);
    expect(engine.activeBuildings[effect.field]).toBeCloseTo(wholeBoard, 10);
    // The refresh reaches the tower that powered the building again...
    expect(SITE_FIELD_ON_TOWER[effect.field](adjacent)).toBeCloseTo(effect.adjacentMult * wholeBoard, 10);
    // ...and every other tower that only ever sees the whole-board half.
    expect(bystanderField(bystander)).toBeCloseTo(wholeBoard, 10);
    expect(engine.baseDefense?.buildingDamageMult).toBe(engine.activeBuildings.damageMult);
  });

  it("drops the whole-board half when the tower beside the building is sold", async () => {
    const { building, towerTile } = buildingWithRoom();
    const adjacent = buildAt(towerTile.x, towerTile.y);
    expect(building.active).toBe(true);

    // Aged past the cancel window so the confirmed-sell path runs, then flushed.
    adjacent._gameSeconds = 10;
    engine.runState.selectedTowerId = String(adjacent.id);
    engine.sellSelected();
    await Promise.resolve();
    engine.executeSell();

    expect(building.active).toBe(false);
    expect(engine.activeBuildings.activeCount).toBe(0);
  });

  it("drops the whole-board half when the tower beside the building is cancelled", () => {
    const { building, towerTile } = buildingWithRoom();
    const adjacent = buildAt(towerTile.x, towerTile.y);
    expect(building.active).toBe(true);

    engine.runState.selectedTowerId = String(adjacent.id);
    engine.sellSelected();

    expect(engine.towerManager?.towers).toHaveLength(0);
    expect(building.active).toBe(false);
    expect(engine.activeBuildings.activeCount).toBe(0);
  });
});

describe("flying damage", () => {
  const FLYING_ENEMY_TYPE = "jet";

  function laneGrid(): Grid {
    return new Grid(makeMapData({ width: 6, height: 3, spawns: [{ x: 0, y: 1 }], base: { x: 5, y: 1 } }));
  }

  function flyingEnemy(grid: Grid): Enemy {
    const enemy = new EnemyEntity(FLYING_ENEMY_TYPE, 1, 0, grid, 1);
    const world = grid.tileToWorld(1, 1);
    enemy.x = world.x;
    enemy.y = world.y;
    enemy.centerX = world.x;
    enemy.centerY = world.y;
    // A level-1 jet dies to one arrow, which would clamp the damage and hide the
    // multiplier; the pool is raised so the applied damage is what the test reads.
    enemy.hp = 5000;
    expect(enemy.flyingHeight).toBeGreaterThan(0);
    return enemy;
  }

  function groundEnemy(grid: Grid): Enemy {
    const enemy = new EnemyEntity("runner", 1, 0, grid, 1);
    const world = grid.tileToWorld(1, 1);
    enemy.x = world.x;
    enemy.y = world.y;
    enemy.centerX = world.x;
    enemy.centerY = world.y;
    enemy.hp = 5000;
    expect(enemy.flyingHeight).toBe(0);
    return enemy;
  }

  // A real ProjectileManager driving a real Enemy, so the multiplier is proven
  // through Enemy.takeDamage rather than a spy on it. castShapePierce has to be a
  // real segment test because that is the only path a homing shot takes to a hit.
  function projectileHitting(enemy: Enemy, opts: { flyingDamageMult?: number }): number {
    const enemyManager = {
      enemies: [enemy],
      getEnemiesInRange: () => [enemy],
      forEachEnemyInRange: (_x: number, _y: number, _range: number, callback: (target: Enemy) => void) =>
        callback(enemy),
      getEnemyById: () => enemy,
      castShapePierce: (
        originX: number,
        originY: number,
        directionX: number,
        directionY: number,
        ballRadius: number,
        maxDistance: number,
        _maxHits: number,
        callback: (target: Enemy) => boolean,
        groundOnly?: boolean,
      ) => {
        if (enemy.removed || (groundOnly && enemy.flyingHeight > 0)) return;
        const length = Math.hypot(directionX, directionY) || 1;
        const unitX = directionX / length;
        const unitY = directionY / length;
        const offsetX = enemy.x - originX;
        const offsetY = enemy.y - originY;
        const along = Math.max(0, Math.min(maxDistance, offsetX * unitX + offsetY * unitY));
        const offX = offsetX - unitX * along;
        const offY = offsetY - unitY * along;
        if (Math.hypot(offX, offY) > ballRadius + enemy.radius) return;
        callback(enemy);
      },
    };
    const projectiles = new ProjectileManager(enemyManager as never, makeParticleSystem());
    const before = enemy.hp;
    projectiles.spawn({
      x: enemy.x - 5,
      y: enemy.y,
      damage: 100,
      speed: 100,
      range: 5,
      towerType: "arrow",
      towerLevel: 1,
      targetId: enemy.id,
      flyingDamageMult: opts.flyingDamageMult ?? 1,
    });
    projectiles.update(0.05);
    return before - enemy.hp;
  }

  it("hits a flying target for more and a ground target for the base damage", () => {
    const grid = laneGrid();
    const aviaryMult = BUILDING_EFFECTS.aviary.activeMult;
    expect(projectileHitting(flyingEnemy(grid), { flyingDamageMult: aviaryMult })).toBeCloseTo(100 * aviaryMult, 6);
    expect(projectileHitting(groundEnemy(grid), { flyingDamageMult: aviaryMult })).toBeCloseTo(100, 6);
  });

  it("leaves a flying target at base damage with no aviary", () => {
    const grid = laneGrid();
    expect(projectileHitting(flyingEnemy(grid), { flyingDamageMult: 1 })).toBeCloseTo(100, 6);
  });

  it("keeps the multiplier out of the tower's damage stat and hands it to the shot", () => {
    const grid = laneGrid();
    const tower = new TowerEntity("basic", 0, 0, undefined, grid);
    const baseDamage = tower.stats.damage;
    expect(tower.stats.flyingDamageMult).toBe(1);

    const aviaryMult = BUILDING_EFFECTS.aviary.adjacentMult;
    tower.siteFlyingDamageMult = aviaryMult;
    tower.clearStatsCache();
    expect(tower.stats.damage).toBe(baseDamage);
    expect(tower.stats.flyingDamageMult).toBeCloseTo(aviaryMult, 10);

    const spawn = vi.fn();
    const fireLightning = vi.fn();
    const projectileManager = { spawn, fireLightning };
    const sound = { playSound: vi.fn() } as never;

    tower.fire({ kind: "enemy", x: 50, y: 50, id: 1 }, undefined as never, projectileManager as never, sound);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]![0].flyingDamageMult).toBeCloseTo(aviaryMult, 10);

    const lightningTower = new TowerEntity("lightning", 0, 0, undefined, grid);
    lightningTower.siteFlyingDamageMult = aviaryMult;
    lightningTower.clearStatsCache();
    lightningTower.fire({ kind: "enemy", x: 50, y: 50, id: 1 }, undefined as never, projectileManager as never, sound);
    expect(fireLightning).toHaveBeenCalledTimes(1);
    expect(fireLightning.mock.calls[0]![0].flyingDamageMult).toBeCloseTo(aviaryMult, 10);
  });
});
