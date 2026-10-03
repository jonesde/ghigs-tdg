/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { BASE_LEVEL_HEALTH_MULT, STARTING_BASE_HEALTH, STARTING_HEALTH_BONUS } from "@/sim/Constants.js";
import { SELL_VALUE_RATIO } from "@/sim/ConstantsTower.js";
import { GameEngine } from "@/sim/GameEngine.js";
import type { GameRunState } from "@/sim/GameRunState.js";
import { Grid } from "@/sim/grid/Grid.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { BASE_SELECTION_ID, BaseDefense, type BaseDefenseEnemy } from "@/sim/towers/BaseDefense.js";
import { makeMapData } from "../helpers/mock-grid";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../helpers/mock-stores";

function insetDefense(): { defense: BaseDefense; runState: GameRunState } {
  const grid = new Grid(makeMapData({ width: 9, height: 9, base: { x: 4, y: 4 } }));
  const runState = { baseHealth: 0, maxBaseHealth: 0 } as GameRunState;
  const defense = new BaseDefense(grid, runState, () => {});
  return { defense, runState };
}

function enemyNear(x: number, y: number): BaseDefenseEnemy {
  return { id: 7, x, y, hp: 40, maxHp: 40, removed: false, flyingHeight: 0 };
}

describe("BaseDefense", () => {
  it("scales health from the level-1 pool and keeps the current ratio", () => {
    const { defense, runState } = insetDefense();
    defense.applyStartingHealth(STARTING_BASE_HEALTH);
    expect(runState.maxBaseHealth).toBe(STARTING_BASE_HEALTH);
    defense.doUpgrade(100);
    expect(runState.maxBaseHealth).toBe(STARTING_BASE_HEALTH * BASE_LEVEL_HEALTH_MULT);
    runState.baseHealth = runState.maxBaseHealth / 2;
    defense.doUpgrade(200);
    expect(runState.maxBaseHealth).toBe(STARTING_BASE_HEALTH * BASE_LEVEL_HEALTH_MULT ** 2);
    expect(runState.baseHealth).toBe(runState.maxBaseHealth / 2);
  });

  it("uses each extra-health tier as the level-1 pool and reaches levelOne * 3^6 at level 7", () => {
    const pools = [STARTING_BASE_HEALTH, ...STARTING_HEALTH_BONUS.map((bonus) => STARTING_BASE_HEALTH + bonus)];
    for (const levelOne of pools) {
      const { defense, runState } = insetDefense();
      defense.applyStartingHealth(levelOne);
      expect(runState.maxBaseHealth).toBe(levelOne);
      defense.level = 7;
      defense.recomputeMaxHealth();
      expect(runState.maxBaseHealth).toBe(levelOne * BASE_LEVEL_HEALTH_MULT ** 6);
    }
  });

  it("places one sentry on each in-bounds base corner", () => {
    const { defense } = insetDefense();
    expect(defense.sentries.map((sentry) => [sentry.tileX, sentry.tileY])).toEqual([
      [3, 3],
      [5, 3],
      [3, 5],
      [5, 5],
    ]);
    const edge = new BaseDefense(
      new Grid(makeMapData({ width: 8, height: 6, base: { x: 7, y: 3 } })),
      { baseHealth: 0, maxBaseHealth: 0 } as GameRunState,
      () => {},
    );
    expect(edge.sentries).toHaveLength(2);
  });

  it("fires short-range shots at level 1, adds long range at level 4, and doubles both at level 7", () => {
    const { defense } = insetDefense();
    defense.applyStartingHealth(STARTING_BASE_HEALTH);
    const sentry = defense.sentries[0]!;
    const enemy = enemyNear(sentry.x + 36, sentry.y + 36);
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
    const sound = { playSound() {} };
    defense.update(0.016, query, projectiles, sound, 1);
    expect(spawned).toHaveLength(4);
    expect(spawned.every((shot) => shot.damage === 12 && shot.color === "#e6c35c" && shot.towerType === "basic")).toBe(
      true,
    );
    expect(spawned.every((shot) => shot.towerId === BASE_SELECTION_ID)).toBe(true);

    defense.level = 3;
    spawned.length = 0;
    for (const corner of defense.sentries) corner.shortCooldown = 0;
    defense.update(0.016, query, projectiles, sound, 2);
    expect(spawned.every((shot) => shot.color === "#e6c35c")).toBe(true);
    expect(defense.longGun()).toBeNull();

    defense.level = 4;
    spawned.length = 0;
    for (const corner of defense.sentries) {
      corner.shortCooldown = 0;
      corner.longCooldown = 0;
    }
    defense.update(0.016, query, projectiles, sound, 3);
    const longShots = spawned.filter((shot) => shot.color === "#d7e4ff");
    expect(longShots).toHaveLength(4);
    expect(longShots.every((shot) => shot.damage === 30)).toBe(true);

    defense.level = 6;
    const shortAtSix = defense.shortGun()!.damage;
    const longAtSix = defense.longGun()!.damage;
    defense.level = 7;
    expect(defense.shortGun()!.damage).toBe(shortAtSix * 2);
    expect(defense.longGun()!.damage).toBe(longAtSix * 2);
    expect(defense.shortGun()!.damage).toBe(78);
    expect(defense.longGun()!.damage).toBe(200);
  });
});

describe("GameEngine base selection", () => {
  function startEngine() {
    const persist = createTestPersistState();
    const engine = new GameEngine(persist, createTestThemeBundle(), new MockHostBindings(), 0);
    engine.loadMap(0);
    return engine;
  }

  it("selects the base instead of building on a base tile", () => {
    const engine = startEngine();
    const base = engine.grid!.getBase();
    const world = engine.grid!.tileToWorld(base.x, base.y);
    engine.runState.selectedTowerType = "basic";
    engine.handleClick(world.x, world.y);
    expect(engine.runState.selectedTowerId).toBe(BASE_SELECTION_ID);
    expect(engine.runState.selectedTowerType).toBeNull();
    expect(engine.towerManager!.towers).toHaveLength(0);
  });

  it("does not sell the base", () => {
    const engine = startEngine();
    engine.selectTowerById(BASE_SELECTION_ID);
    const gold = engine.runState.gold;
    engine.sellSelected();
    engine.cancelSelected();
    expect(engine.runState.selectedTowerId).toBe(BASE_SELECTION_ID);
    expect(engine.runState.gold).toBe(gold);
    expect(engine.baseDefense!.level).toBe(1);
  });

  it("spends gold to raise health up to the gem cap, then refunds the paid cost", () => {
    const engine = startEngine();
    engine.runState.gold = 1000;
    engine.selectTowerById(BASE_SELECTION_ID);
    const levelOne = engine.runState.maxBaseHealth;
    engine.upgradeSelected();
    expect(engine.baseDefense!.level).toBe(2);
    expect(engine.runState.gold).toBe(900);
    expect(engine.runState.maxBaseHealth).toBe(levelOne * BASE_LEVEL_HEALTH_MULT);
    engine.upgradeSelected();
    expect(engine.baseDefense!.level).toBe(2);
    expect(engine.runState.gold).toBe(900);

    engine.persistState.generalAddons.upgradeCostReduction = 0;
    engine.syncPersist(engine.persistState.unlocked, engine.persistState.generalAddons, 0, {
      levels: [true, true, true, false, false, false, false],
    });
    engine.upgradeSelected();
    expect(engine.baseDefense!.level).toBe(3);
    expect(engine.runState.gold).toBe(900 - Math.floor(200 * 0.9));

    const paid = engine.baseDefense!.lastPaidCost();
    engine.persistState.generalAddons.sellActive = null;
    engine.downgradeSelected();
    expect(engine.baseDefense!.level).toBe(2);
    expect(engine.runState.gold).toBe(900 - Math.floor(200 * 0.9) + Math.round(paid * SELL_VALUE_RATIO));

    engine.persistState.generalAddons.sellActive = "refund";
    engine.upgradeSelected();
    const beforeRefund = engine.runState.gold;
    engine.downgradeSelected();
    expect(engine.runState.gold).toBe(beforeRefund + Math.floor(200 * 0.9));

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
    expect(engine.runState.selectedTowerId).toBe(BASE_SELECTION_ID);
    expect(engine.runState.gold).toBe(goldAtLevelOne);
  });

  it("puts base defense on the snapshot and keeps sentries out of the tower list", () => {
    const engine = startEngine();
    const snapshot = buildSnapshot(engine, 0);
    expect(snapshot.meta.baseDefense?.level).toBe(1);
    expect(snapshot.meta.baseDefense?.sentries.length).toBeGreaterThan(0);
    expect(snapshot.towers.some((tower) => tower.id === BASE_SELECTION_ID)).toBe(false);
    expect(snapshot.meta.baseDefense?.shortStats?.damage).toBe(12);
    expect(snapshot.meta.baseDefense?.longStats).toBeNull();
  });
});
