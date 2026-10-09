/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { GameEngine } from "@/sim/GameEngine.js";
import type { GameRunState } from "@/sim/GameRunState.js";
import { Grid } from "@/sim/grid/Grid.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import {
  BaseDefense,
  type BaseDefenseEnemy,
  type BaseDefenseEnemyQuery,
  type BaseDefenseProjectileSpawn,
  baseSelectionId,
} from "@/sim/towers/BaseDefense.js";
import { makeMapData } from "../helpers/mock-grid";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../helpers/mock-stores";

const startingBaseHealth = getGameContent().economy.startingBaseHealth;
const baseLevelHealthMult = getGameContent().economy.baseLevelHealthMult;

// Read the live gun tiers from content so the assertions track balance tuning.
const baseDefenseContent = getGameContent().towers.baseDefense;
const levelSevenMultiplier = baseDefenseContent.levelSevenDamageMultiplier;
const levelOneShortDamage = baseDefenseContent.shortRange[0]!.damage;
const levelFourLongDamage = baseDefenseContent.longRange[0]!.damage;
const levelSevenShortDamage =
  baseDefenseContent.shortRange[baseDefenseContent.shortRange.length - 1]!.damage * levelSevenMultiplier;
const levelSevenLongDamage =
  baseDefenseContent.longRange[baseDefenseContent.longRange.length - 1]!.damage * levelSevenMultiplier;

it("does not clamp sentry fire rate at the tower cap", () => {
  const { defense } = insetDefense();
  defense.level = 7;
  defense.buildingFireRateMult = 2;
  const shortGun = defense.shortGun();
  const tierRate = baseDefenseContent.shortRange[baseDefenseContent.shortRange.length - 1]!.fireRate;
  expect(shortGun?.fireRate).toBeCloseTo(tierRate * 2, 6);
  expect(shortGun!.fireRate).toBeGreaterThan(getGameContent().towers.tuning.maxFireRate);
});

function insetDefense(): { defense: BaseDefense; runState: GameRunState } {
  const grid = new Grid(makeMapData({ width: 9, height: 9, base: { x: 4, y: 4 } }));
  const runState = { baseHealth: 0, maxBaseHealth: 0 } as GameRunState;
  const defense = new BaseDefense(grid, runState, () => {});
  return { defense, runState };
}

function enemyNear(x: number, y: number): BaseDefenseEnemy {
  return { id: 7, x, y, hp: 40, maxHp: 40, removed: false, flyingHeight: 0 };
}

const emptyQuery: BaseDefenseEnemyQuery = {
  forEachEnemyInRange() {},
  getEnemyById() {
    return null;
  },
};

const noProjectileSpawn: BaseDefenseProjectileSpawn = { spawn() {} };

const noSound = { playSound() {} };

describe("BaseDefense", () => {
  it("scales health from the level-1 pool and keeps the current ratio", () => {
    const { defense, runState } = insetDefense();
    defense.applyStartingHealth(startingBaseHealth);
    expect(runState.maxBaseHealth).toBe(startingBaseHealth);
    defense.doUpgrade(100);
    expect(runState.maxBaseHealth).toBe(startingBaseHealth * baseLevelHealthMult);
    runState.baseHealth = runState.maxBaseHealth / 2;
    defense.doUpgrade(200);
    expect(runState.maxBaseHealth).toBe(startingBaseHealth * baseLevelHealthMult ** 2);
    expect(runState.baseHealth).toBe(runState.maxBaseHealth / 2);
  });

  it("uses each extra-health tier as the level-1 pool and reaches levelOne * 3^6 at level 7", () => {
    const startingHealthBonus = getGameContent().economy.startingHealthBonus;
    const pools = [startingBaseHealth, ...startingHealthBonus.map((bonus) => startingBaseHealth + bonus)];
    for (const levelOne of pools) {
      const { defense, runState } = insetDefense();
      defense.applyStartingHealth(levelOne);
      expect(runState.maxBaseHealth).toBe(levelOne);
      defense.level = 7;
      defense.recomputeMaxHealth();
      expect(runState.maxBaseHealth).toBe(levelOne * baseLevelHealthMult ** 6);
    }
  });

  it("places short turrets on each in-bounds base corner and long turrets on the edge tiles", () => {
    const { defense } = insetDefense();
    expect(defense.shortSentries.map((turret) => [turret.tileX, turret.tileY])).toEqual([
      [3, 3],
      [5, 3],
      [3, 5],
      [5, 5],
    ]);
    expect(defense.longSentries).toHaveLength(0);

    defense.level = 4;
    defense.update(0.016, emptyQuery, noProjectileSpawn, noSound, 1);
    expect(defense.longSentries.map((turret) => [turret.tileX, turret.tileY])).toEqual([
      [4, 3],
      [3, 4],
      [4, 5],
      [5, 4],
    ]);
    defense.level = 3;
    defense.update(0.016, emptyQuery, noProjectileSpawn, noSound, 2);
    expect(defense.longSentries).toHaveLength(0);

    const edge = new BaseDefense(
      new Grid(makeMapData({ width: 8, height: 6, base: { x: 7, y: 3 } })),
      { baseHealth: 0, maxBaseHealth: 0 } as GameRunState,
      () => {},
    );
    expect(edge.shortSentries).toHaveLength(2);
    edge.level = 4;
    edge.update(0.016, emptyQuery, noProjectileSpawn, noSound, 3);
    expect(edge.longSentries).toHaveLength(3);
  });

  it("fires short-range shots at level 1, adds edge long-range turrets at level 4, and applies the level-7 multiplier", () => {
    const { defense } = insetDefense();
    defense.applyStartingHealth(startingBaseHealth);
    const corner = defense.shortSentries[0]!;
    const enemy = enemyNear(corner.x + 36, corner.y + 36);
    const spawned: { damage: number; color: string; towerType: string; towerId: string }[] = [];
    const query = {
      forEachEnemyInRange(x: number, y: number, range: number, callback: (candidate: BaseDefenseEnemy) => void) {
        const deltaX = enemy.x - x;
        const deltaY = enemy.y - y;
        if (deltaX * deltaX + deltaY * deltaY <= range * range) callback(enemy);
      },
      getEnemyById(id: number) {
        return id === enemy.id ? enemy : null;
      },
    };
    const projectiles = {
      spawn(opts: { damage: number; color: string; towerType: string; towerId: string }) {
        spawned.push(opts);
      },
    };
    defense.update(0.016, query, projectiles, noSound, 1);
    expect(spawned).toHaveLength(4);
    expect(
      spawned.every(
        (shot) => shot.damage === levelOneShortDamage && shot.color === "#e6c35c" && shot.towerType === "basic",
      ),
    ).toBe(true);
    expect(spawned.every((shot) => shot.towerId === baseSelectionId)).toBe(true);

    defense.level = 3;
    spawned.length = 0;
    for (const turret of defense.shortSentries) turret.cooldown = 0;
    defense.update(0.016, query, projectiles, noSound, 2);
    expect(spawned).toHaveLength(4);
    expect(
      spawned.every((shot) => shot.color === "#e6c35c" && shot.damage === baseDefenseContent.shortRange[2]!.damage),
    ).toBe(true);
    expect(defense.longGun()).toBeNull();

    defense.level = 4;
    spawned.length = 0;
    for (const turret of defense.shortSentries) turret.cooldown = 0;
    defense.update(0.016, query, projectiles, noSound, 3);
    expect(spawned).toHaveLength(8);
    const shortShots = spawned.filter((shot) => shot.color === "#e6c35c");
    const longShots = spawned.filter((shot) => shot.color === "#d7e4ff");
    expect(shortShots).toHaveLength(4);
    expect(longShots).toHaveLength(4);
    expect(shortShots.every((shot) => shot.damage === baseDefenseContent.shortRange[3]!.damage)).toBe(true);
    expect(longShots.every((shot) => shot.damage === levelFourLongDamage)).toBe(true);

    defense.level = 5;
    expect(defense.shortGun()!.damage).toBe(baseDefenseContent.shortRange[4]!.damage);
    defense.level = 6;
    expect(defense.shortGun()!.damage).toBe(baseDefenseContent.shortRange[5]!.damage);
    expect(defense.longGun()!.damage).toBe(baseDefenseContent.longRange[2]!.damage);
    defense.level = 7;
    expect(defense.shortGun()!.damage).toBe(levelSevenShortDamage);
    expect(defense.longGun()!.damage).toBe(levelSevenLongDamage);
  });
});

describe("GameEngine base selection", () => {
  function startEngine() {
    const persist = createTestPersistState();
    const engine = new GameEngine(persist, createTestThemeBundle(), new MockHostBindings(), 0);
    engine.loadMap(0);
    return engine;
  }

  it("selects the base instead of building on a base tile and keeps build mode on", () => {
    const engine = startEngine();
    const base = engine.grid!.getBase();
    const world = engine.grid!.tileToWorld(base.x, base.y);
    engine.runState.selectedTowerType = "basic";
    engine.handleClick(world.x, world.y);
    expect(engine.runState.selectedTowerId).toBe(baseSelectionId);
    expect(engine.runState.selectedTowerType).toBe("basic");
    expect(engine.towerManager!.towers).toHaveLength(0);
  });

  it("selects the base without a build type when not in build mode", () => {
    const engine = startEngine();
    const base = engine.grid!.getBase();
    const world = engine.grid!.tileToWorld(base.x, base.y);
    engine.handleClick(world.x, world.y);
    expect(engine.runState.selectedTowerId).toBe(baseSelectionId);
    expect(engine.runState.selectedTowerType).toBeNull();
  });

  it("selectTowerById keeps build mode on when selecting the base", () => {
    const engine = startEngine();
    engine.runState.selectedTowerType = "basic";
    engine.selectTowerById(baseSelectionId);
    expect(engine.runState.selectedTowerId).toBe(baseSelectionId);
    expect(engine.runState.selectedTowerType).toBe("basic");
  });

  it("does not sell the base", () => {
    const engine = startEngine();
    engine.selectTowerById(baseSelectionId);
    const gold = engine.runState.gold;
    engine.sellSelected();
    engine.cancelSelected();
    expect(engine.runState.selectedTowerId).toBe(baseSelectionId);
    expect(engine.runState.gold).toBe(gold);
    expect(engine.baseDefense!.level).toBe(1);
  });

  it("spends gold to raise health up to the gem cap, then refunds the paid cost", () => {
    const engine = startEngine();
    engine.runState.gold = 1000;
    engine.selectTowerById(baseSelectionId);
    const levelOne = engine.runState.maxBaseHealth;
    engine.upgradeSelected();
    expect(engine.baseDefense!.level).toBe(2);
    expect(engine.runState.gold).toBe(950);
    expect(engine.runState.maxBaseHealth).toBe(levelOne * baseLevelHealthMult);
    engine.upgradeSelected();
    expect(engine.baseDefense!.level).toBe(2);
    expect(engine.runState.gold).toBe(950);

    engine.persistState.generalAddons.upgradeCostReduction = 0;
    engine.syncPersist(engine.persistState.unlocked, engine.persistState.generalAddons, 0, {
      levels: [true, true, true, false, false, false, false],
    });
    engine.upgradeSelected();
    expect(engine.baseDefense!.level).toBe(3);
    expect(engine.runState.gold).toBe(950 - Math.floor(100 * 0.9));

    const paid = engine.baseDefense!.lastPaidCost();
    engine.persistState.generalAddons.sellActive = null;
    engine.downgradeSelected();
    expect(engine.baseDefense!.level).toBe(2);
    const sellRefund = Math.round(paid * getGameContent().towers.tuning.sellValueRatio);
    expect(engine.runState.gold).toBe(950 - Math.floor(100 * 0.9) + sellRefund);

    engine.persistState.generalAddons.sellActive = "refund";
    engine.upgradeSelected();
    const beforeRefund = engine.runState.gold;
    engine.downgradeSelected();
    expect(engine.runState.gold).toBe(beforeRefund + Math.floor(100 * 0.9));

    engine.persistState.generalAddons.sellActive = "discount";
    engine.upgradeSelected();
    const beforeDiscount = engine.runState.gold;
    engine.downgradeSelected();
    expect(engine.runState.gold).toBe(beforeDiscount);
    expect(engine.baseDefense!.level).toBe(2);

    while (engine.baseDefense!.level > 1) engine.downgradeSelected();
    const goldAtLevelOne = engine.runState.gold;
    engine.downgradeSelected();
    expect(engine.baseDefense!.level).toBe(1);
    expect(engine.runState.selectedTowerId).toBe(baseSelectionId);
    expect(engine.runState.gold).toBe(goldAtLevelOne);
  });

  it("puts base defense on the snapshot and keeps sentries out of the tower list", () => {
    const engine = startEngine();
    const snapshot = buildSnapshot(engine, 0);
    expect(snapshot.meta.baseDefense?.level).toBe(1);
    expect(snapshot.meta.baseDefense?.sentries.length).toBeGreaterThan(0);
    expect(snapshot.meta.baseDefense?.sentries.every((sentry) => sentry.sprite === "basic")).toBe(true);
    expect(snapshot.towers.some((tower) => tower.id === baseSelectionId)).toBe(false);
    expect(snapshot.meta.baseDefense?.shortStats?.damage).toBe(levelOneShortDamage);
    expect(snapshot.meta.baseDefense?.longStats).toBeNull();
  });
});
