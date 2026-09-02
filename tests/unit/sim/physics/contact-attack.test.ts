import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import type { AttackTarget } from "@/sim/enemies/Enemy.js";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";

function makeBaseTarget(): AttackTarget & { damage: number } {
  const target = {
    damage: 0,
    isGhost: false as const,
    takeDamage(amount: number): void {
      target.damage += amount;
    },
  };
  return target;
}

describe("Rapier contact attack flags", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;

  beforeEach(() => {
    grid = new Grid(makeBastionMap());
    physicsWorld = new PhysicsWorld(grid);
  });

  afterEach(() => {
    physicsWorld.dispose();
  });

  it("clears attackingBase when the body leaves the base collider", () => {
    const enemy = new Enemy("runner", 1, 0, grid, 1, 0, null, null, makeBaseTarget());
    physicsWorld.addEnemy(enemy);
    const baseCenter = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    enemy.body!.setTranslation({ x: baseCenter.x, y: baseCenter.y }, true);

    physicsWorld.step();
    expect(enemy.attackingBase).toBe(true);

    const spawn = grid.tileToWorld(grid.spawns[0]!.x, grid.spawns[0]!.y);
    enemy.body!.setTranslation({ x: spawn.x, y: spawn.y }, true);
    physicsWorld.step();
    expect(enemy.attackingBase).toBe(false);
  });

  it("prefers the lowest-HP overlapping tower when two colliders contact the enemy", () => {
    const enemy = new Enemy("runner", 1, 0, grid, 1);
    physicsWorld.addEnemy(enemy);

    const weakerCenter = grid.tileToWorld(3, 4);
    const strongerCenter = grid.tileToWorld(4, 4);
    const weaker = {
      id: "weak",
      tileX: 3,
      tileY: 4,
      x: weakerCenter.x,
      y: weakerCenter.y,
      isGhost: false,
      health: 10,
      takeDamage: (): void => {},
    } as unknown as Tower;
    const stronger = {
      id: "strong",
      tileX: 4,
      tileY: 4,
      x: strongerCenter.x,
      y: strongerCenter.y,
      isGhost: false,
      health: 80,
      takeDamage: (): void => {},
    } as unknown as Tower;
    physicsWorld.rebuildTowers({ towers: [weaker, stronger] } as unknown as TowerManager);

    enemy.body!.setTranslation({ x: (weakerCenter.x + strongerCenter.x) / 2, y: weakerCenter.y }, true);
    physicsWorld.step();
    expect(enemy.blockedByTower).toBe(weaker);
  });

  it("parks a sieging enemy only while its tower collider is in contact", () => {
    const enemy = new Enemy("runner", 1, 0, grid, 1);
    physicsWorld.addEnemy(enemy);
    const towerCenter = grid.tileToWorld(3, 4);
    const tower = {
      id: "siege",
      tileX: 3,
      tileY: 4,
      x: towerCenter.x,
      y: towerCenter.y,
      isGhost: false,
      health: 50,
      takeDamage: (): void => {},
    } as unknown as Tower;
    physicsWorld.rebuildTowers({ towers: [tower] } as unknown as TowerManager);
    enemy.applySiege(tower);
    expect(enemy.motionLock).toBe("none");

    enemy.body!.setTranslation({ x: towerCenter.x, y: towerCenter.y }, true);
    physicsWorld.step();
    expect(enemy.blockedByTower).toBe(tower);
    expect(enemy.motionLock).toBe("park");

    const spawn = grid.tileToWorld(grid.spawns[0]!.x, grid.spawns[0]!.y);
    enemy.body!.setTranslation({ x: spawn.x, y: spawn.y }, true);
    physicsWorld.step();
    expect(enemy.blockedByTower).toBeNull();
    expect(enemy.motionLock).toBe("none");
  });

  it("ticks tower damage from postPhysics only while contact is live", () => {
    const damage = { value: 0 };
    const enemy = new Enemy("runner", 1, 0, grid, 1);
    physicsWorld.addEnemy(enemy);
    const towerCenter = grid.tileToWorld(3, 4);
    const tower = {
      id: "dmg",
      tileX: 3,
      tileY: 4,
      x: towerCenter.x,
      y: towerCenter.y,
      isGhost: false,
      health: 50,
      takeDamage(amount: number): void {
        damage.value += amount;
      },
    } as unknown as Tower;
    physicsWorld.rebuildTowers({ towers: [tower] } as unknown as TowerManager);
    enemy.body!.setTranslation({ x: towerCenter.x, y: towerCenter.y }, true);
    physicsWorld.step();
    enemy.postPhysics(FIXED_DT, null);
    expect(damage.value).toBeGreaterThan(0);
  });
});
