import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import type { AttackTarget } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
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

function drive(enemyManager: EnemyManager, physicsWorld: PhysicsWorld, steps: number): void {
  for (let step = 0; step < steps; step++) {
    physicsWorld.step();
    for (const enemy of enemyManager.enemies) {
      enemy.postPhysics(FIXED_DT);
    }
  }
}

describe("postPhysics base attack", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;
  let enemyManager: EnemyManager;

  beforeEach(() => {
    grid = new Grid(makeBastionMap());
    enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    physicsWorld = new PhysicsWorld(grid);
    enemyManager.setPhysicsWorld(physicsWorld);
  });

  afterEach(() => {
    physicsWorld.dispose();
  });

  it("marks attackingBase and deals damage when the body contacts the base", () => {
    const fakeBase = makeBaseTarget();
    enemyManager.baseTarget = fakeBase;

    const enemy = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemy).not.toBeNull();
    physicsWorld.addEnemy(enemy!);

    const baseCenter = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    enemy!.body!.setTranslation({ x: baseCenter.x, y: baseCenter.y }, true);

    drive(enemyManager, physicsWorld, 4);

    expect(enemy!.attackingBase).toBe(true);
    expect(fakeBase.damage).toBeGreaterThan(0);
  });

  it("keeps attacking after the body is teleported off the base collider", () => {
    const fakeBase = makeBaseTarget();
    enemyManager.baseTarget = fakeBase;

    const enemy = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemy).not.toBeNull();
    physicsWorld.addEnemy(enemy!);

    const baseCenter = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    enemy!.body!.setTranslation({ x: baseCenter.x, y: baseCenter.y }, true);
    drive(enemyManager, physicsWorld, 4);
    expect(enemy!.attackingBase).toBe(true);
    const damageAtContact = fakeBase.damage;
    expect(damageAtContact).toBeGreaterThan(0);

    const spawn = grid.tileToWorld(grid.spawns[0]!.x, grid.spawns[0]!.y);
    enemy!.body!.setTranslation({ x: spawn.x, y: spawn.y }, true);
    enemy!.attackTimer = 0;
    drive(enemyManager, physicsWorld, 4);

    expect(enemy!.attackingBase).toBe(true);
    expect(enemy!.removed).toBe(false);
    expect(enemyManager.enemies).toContain(enemy);
    expect(fakeBase.damage).toBeGreaterThan(damageAtContact);
  });

  it("attacks a sieged tower while overlapping its collider and not the base", () => {
    enemyManager.baseTarget = makeBaseTarget();

    const enemy = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemy).not.toBeNull();
    physicsWorld.addEnemy(enemy!);

    const towerDamage = { value: 0 };
    const towerCenter = grid.tileToWorld(3, 3);
    const fakeTower = {
      id: "tower-3-3",
      tileX: 3,
      tileY: 3,
      x: towerCenter.x,
      y: towerCenter.y,
      isGhost: false as const,
      health: 100,
      takeDamage(amount: number): void {
        towerDamage.value += amount;
      },
    } as unknown as Tower;
    const towerManagerStub = {
      towers: [fakeTower],
      towerAt: (tileX: number, tileY: number) => (tileX === 3 && tileY === 3 ? fakeTower : null),
      getTowerById: (towerId: string) => (towerId === fakeTower.id ? fakeTower : null),
    } as unknown as TowerManager;
    physicsWorld.rebuildTowers(towerManagerStub);
    grid.blocked.add("3,3");
    enemy!.applySiege(fakeTower);

    enemy!.body!.setTranslation({ x: towerCenter.x, y: towerCenter.y }, true);

    drive(enemyManager, physicsWorld, 4);

    expect(enemy!.attackingBase).toBe(false);
    expect(enemy!.blockedByTower).toBe(fakeTower);
    expect(towerDamage.value).toBeGreaterThan(0);
  });
});
