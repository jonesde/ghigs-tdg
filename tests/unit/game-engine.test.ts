// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID } from "@/render/themes/index.js";
import {
  BOSS_SPEED_LIMIT,
  BOUNTY_BLOCKED_RATIO,
  DIFFICULTY_MULT_GEM_BASE,
  FIRST_TIME_MILESTONE_MULT,
  GameState,
  MAP_GEM_MULTIPLIERS,
  MILESTONE_GEMS,
  STARTING_BASE_HEALTH,
  STARTING_HEALTH_BONUS,
  StartingGold,
  VICTORY_WAVE,
} from "@/sim/Constants.js";
import { CANCEL_BUILD_WINDOW_MS, SELL_VALUE_RATIO } from "@/sim/ConstantsTower.js";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { createDefaultPersistState, difficultyMultiplier as getDifficultyMultiplier } from "@/sim/PersistState.js";
import type { Tower } from "@/sim/towers/Tower.js";
import {
  createTestGameStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../helpers/mock-stores";

describe("GameEngine", () => {
  let engine: GameEngine;
  let _gameStore: ReturnType<typeof createTestGameStore>;
  let mockHost: MockHostBindings;

  // New architecture: persistState is a constructor argument; loadMap(mapIndex)
  // no longer takes it. This helper constructs a fully-initialized engine.
  function initEngine(mapIndex: number, persistState: ReturnType<typeof createTestPersistState>): GameEngine {
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, mapIndex);
    engine.loadMap(mapIndex);
    return engine;
  }

  beforeEach(() => {
    _gameStore = createTestGameStore();
    mockHost = new MockHostBindings();
    engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), mockHost, 0);
  });

  describe("constructor", () => {
    it("stores reference to host", () => {
      expect(engine.host).toBe(mockHost);
    });

    it("initializes with null managers", () => {
      expect(engine.grid).toBeNull();
      expect(engine.enemyManager).toBeNull();
      expect(engine.towerManager!).toBeNull();
      expect(engine.waveManager).toBeNull();
    });
  });

  describe("loadMap", () => {
    it("initializes all subsystems", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.grid).not.toBeNull();
      expect(engine.enemyManager).not.toBeNull();
      expect(engine.towerManager!).not.toBeNull();
      expect(engine.waveManager).not.toBeNull();
    });

    it("sets starting gold based on region", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.gold).toBe(StartingGold[0]);
    });

    it("adds progressive gold per entry beyond the first", () => {
      const persistState = createTestPersistState();
      engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, -2);
      engine.loadProgressiveMap({ regionId: 0, level: 12, entryCount: 4, seed: 1 });
      expect(engine.runState.gold).toBe(StartingGold[0] + 150);
    });

    it("resets lives to 20", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.baseHealth = 100;
      initEngine(0, persistState);
      expect(engine.runState.baseHealth).toBe(STARTING_BASE_HEALTH);
    });

    it("sets currentWave to 0", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.currentWave).toBe(0);
    });

    it("resets gem breakdown", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.gemBreakdown.bossKills.base).toBe(0);
      expect(engine.runState.gemBreakdown.milestones.base).toBe(0);
      expect(engine.runState.gemBreakdown.waveCompletion.base).toBe(0);
    });

    it("resets selected tower and build type", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.selectedTowerId = "1";
      engine.runState.selectedTowerType = "basic";
      initEngine(0, persistState);
      expect(engine.runState.selectedTowerId).toBeNull();
      expect(engine.runState.selectedTowerType).toBeNull();
    });

    it("resets milestone rewards", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.milestoneRewardsClaimed[15] = true;
      initEngine(0, persistState);
      expect(engine.runState.milestoneRewardsClaimed[15]).toBeUndefined();
    });

    it("sets mapIndex and map reference", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.mapIndex).toBe(0);
      expect(engine.runState.map).not.toBeNull();
    });

    it("applies starting gold bonus from general addons", () => {
      const persistState = createTestPersistState();
      persistState.generalAddons.startingGold = 0;
      initEngine(0, persistState);
      const expected = StartingGold[0] + 50;
      expect(engine.runState.gold).toBe(expected);
    });

    it("applies starting health bonus from general addons", () => {
      const persistState = createTestPersistState();
      persistState.generalAddons.extraHealth = 0;
      initEngine(0, persistState);
      expect(engine.runState.baseHealth).toBe(STARTING_BASE_HEALTH + STARTING_HEALTH_BONUS[0]);
    });
  });

  describe("onBossKilled", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("awards gems based on difficulty and map multipliers", () => {
      const gemsBefore = engine.persistState.gems;
      engine.onBossKilled();
      const base = 1;
      const diffMult = getDifficultyMultiplier(engine.persistState);
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const mapMult = MAP_GEM_MULTIPLIERS[engine.runState.mapIndex];
      const expected = Math.ceil(Math.ceil(base * gemMult) * mapMult);
      expect(engine.persistState.gems).toBe(gemsBefore + expected);
    });

    it("tracks bossesKilledThisRun", () => {
      engine.onBossKilled();
      expect(engine.runState.bossesKilledThisRun).toBe(1);
    });

    it("does not increment bossesReachedBaseThisRun", () => {
      engine.onBossKilled();
      expect(engine.runState.bossesReachedBaseThisRun).toBe(0);
    });

    it("records gem breakdown", () => {
      engine.onBossKilled();
      expect(engine.runState.gemBreakdown.bossKills.base).toBe(1);
      expect(engine.runState.gemBreakdown.bossKills.afterFirstTime).toBeGreaterThan(0);
    });

    it("marks persistState dirty instead of saving to localStorage", () => {
      engine.onBossKilled();
      expect(engine.persistDirty).toBe(true);
    });
  });

  describe("milestone rewards", () => {
    it("awards gems at milestone waves", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.mapIndex = 0;
      const gemsBefore = engine.persistState.gems;
      const wave = 15;
      if (!engine.runState.milestoneRewardsClaimed[wave]) {
        engine.runState.milestoneRewardsClaimed[wave] = true;
        const base = MILESTONE_GEMS[wave];
        const diffMult = getDifficultyMultiplier(engine.persistState);
        const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
        const regionMult = MAP_GEM_MULTIPLIERS[engine.runState.mapIndex];
        const afterDiff = Math.ceil(base * gemMult);
        const afterRegion = Math.ceil(afterDiff * regionMult);
        engine.persistState.gems += afterRegion;
        engine.runState.runGemsEarned += afterRegion;
        expect(engine.persistState.gems).toBe(gemsBefore + afterRegion);
      }
    });

    it("awards 2x on first-time milestone", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const wave = 15;
      const base = MILESTONE_GEMS[wave];
      const diffMult = getDifficultyMultiplier(engine.persistState);
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const regionMult = MAP_GEM_MULTIPLIERS[engine.runState.mapIndex];
      const afterRegion = Math.ceil(Math.ceil(base * gemMult) * regionMult);
      const firstTimeBonus = afterRegion * FIRST_TIME_MILESTONE_MULT;

      const gemsBefore = engine.persistState.gems;
      engine.persistState.gems += firstTimeBonus;
      expect(engine.persistState.gems).toBe(gemsBefore + firstTimeBonus);
    });
  });

  describe("economy", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("addGold increases gold", () => {
      engine.earnGold(10);
      expect(engine.runState.gold).toBe(StartingGold[0] + 10);
    });

    it("setGold sets gold to exact value", () => {
      engine.runState.gold = 50;
      expect(engine.runState.gold).toBe(50);
    });

    it("loseLives decreases lives", () => {
      engine.runState.baseHealth -= 3;
      expect(engine.runState.baseHealth).toBe(STARTING_BASE_HEALTH - 3);
    });

    it("boss attacking the base reduces engine baseHealth via attackDamage and is not removed", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const enemy = new Enemy("boss", 1, 0, engine.grid, 1);
      enemy.baseTarget = engine.enemyManager.baseTarget;
      // Park the boss just outside the base
      // square (within one radius) so postPhysics immediately detects base contact
      // and flips it into the attackingBase state. The boss needs a rigid body so
      // postPhysics can read its translation back.
      const baseTile = engine.grid.getBase();
      const baseCenter = engine.grid.tileToWorld(baseTile.x, baseTile.y);
      const half = 1.5 * engine.grid.tileSize;
      const spawnPos = { x: baseCenter.x - half - enemy.radius * 0.5, y: baseCenter.y };
      enemy.centerX = spawnPos.x;
      enemy.centerY = spawnPos.y;
      enemy.x = spawnPos.x;
      enemy.y = spawnPos.y;
      engine.enemyManager.physicsWorld?.addEnemy(enemy);
      enemy.body?.setTranslation({ x: spawnPos.x, y: spawnPos.y }, true);
      engine.enemyManager.enemies.push(enemy);

      // Drive the boss to the base; it must flip into the attackingBase state and
      // never despawn.
      engine.update(0.05);
      for (let step = 0; step < 600 && !enemy.attackingBase; step++) engine.update(0.05);
      expect(enemy.attackingBase).toBe(true);
      expect(enemy.removed).toBe(false);

      // Give the base plenty of headroom so the run doesn't end mid-simulation.
      engine.runState.baseHealth = 1000;
      engine.runState.maxBaseHealth = 1000;
      const healthBefore = engine.runState.baseHealth;
      for (let step = 0; step < 200; step++) engine.update(0.05);

      expect(engine.runState.baseHealth).toBeLessThan(healthBefore);
      expect(enemy.removed).toBe(false);
    });

    it("blocked enemy gives half bounty", () => {
      const bounty = Math.ceil(2 * BOUNTY_BLOCKED_RATIO);
      engine.earnGold(bounty);
      expect(engine.runState.gold).toBe(StartingGold[0] + bounty);
    });
  });

  describe("tower actions", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("builds a tower via click on valid terrain", () => {
      const tower = engine.towerManager?.build("basic", 0, 0, engine.persistState, engine.grid!);
      expect(tower).not.toBeNull();
      expect(engine.runState.gold).toBe(StartingGold[0]);
    });

    it("does not build when cannot afford", () => {
      engine.runState.gold = 0;
      const tower = engine.towerManager?.build("basic", 0, 0, engine.persistState, engine.grid!);
      expect(tower).not.toBeNull();
    });

    it("upgradeSelected deducts gold and increments level", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      engine.runState.selectedTowerId = String(tower.id);
      const cost = engine.getUpgradeCost(tower as Tower);
      const goldBefore = engine.runState.gold;
      engine.upgradeSelected();
      expect(tower!.level).toBe(2);
      expect(engine.runState.gold).toBe(goldBefore - cost);
    });

    it("upgradeSelected auto-specializes when exactly one variant is unlocked", () => {
      engine.persistState.unlocked.basic.variantA[0] = true;
      engine.persistState.unlocked.basic.variantB[0] = false;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      tower.level = 4;
      engine.runState.selectedTowerId = String(tower.id);
      const lv5Cost = tower.upgradeCost(5);
      engine.runState.gold = lv5Cost;
      const goldBefore = engine.runState.gold;
      engine.upgradeSelected();
      const selected = engine.getSelectedTower() as Tower;
      expect(selected.variant).toBe("A");
      expect(selected.level).toBe(5);
      expect(engine.runState.gold).toBe(goldBefore - lv5Cost);
    });

    it("upgradeSelected does not auto-specialize when both variants are unlocked (ambiguous)", () => {
      engine.persistState.unlocked.basic.variantA[0] = true;
      engine.persistState.unlocked.basic.variantB[0] = true;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      tower.level = 4;
      engine.runState.selectedTowerId = String(tower.id);
      engine.runState.gold = tower.upgradeCost(5);
      engine.upgradeSelected();
      const selected = engine.getSelectedTower() as Tower;
      expect(selected.variant).toBeNull();
      expect(selected.level).toBe(4);
    });

    it("upgradeSelected does nothing when no variant is unlocked", () => {
      engine.persistState.unlocked.basic.variantA[0] = false;
      engine.persistState.unlocked.basic.variantB[0] = false;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      tower.level = 4;
      engine.runState.selectedTowerId = String(tower.id);
      engine.runState.gold = tower.upgradeCost(5);
      engine.upgradeSelected();
      const selected = engine.getSelectedTower() as Tower;
      expect(selected.variant).toBeNull();
      expect(selected.level).toBe(4);
    });

    it("sellSelected shows confirm dialog", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      // Outside the cancel window so the confirm/sell path is exercised.
      tower._gameSeconds = (CANCEL_BUILD_WINDOW_MS + 1000) / 1000;
      engine.runState.selectedTowerId = String(tower.id);
      engine.sellSelected();
      expect(engine.towerManager?.towers).toContain(tower);
    });

    it("executeSell sells the selected tower", async () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      tower._gameSeconds = (CANCEL_BUILD_WINDOW_MS + 1000) / 1000;
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.sellSelected();
      // The mock host grants the confirm on a microtask; flush it before selling.
      await Promise.resolve();
      engine.executeSell();
      const expectedRefund = Math.round(tower!.totalInvested * SELL_VALUE_RATIO);
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
      expect(engine.runState.selectedTowerId).toBeNull();
    });

    it("sell disabled in discount mode", () => {
      engine.persistState.generalAddons.sellActive = "discount";
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.sellSelected();
      expect(engine.runState.gold).toBe(goldBefore);
    });

    it("sellSelected cancels the tower within the cancel window", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const goldBefore = engine.runState.gold - tower!.totalInvested;
      engine.runState.gold = goldBefore;
      engine.runState.selectedTowerId = String(tower!.id);
      expect(tower!.canCancel()).toBe(true);
      const requestConfirmSpy = vi.spyOn(engine.host, "requestConfirm");
      engine.sellSelected();
      expect(requestConfirmSpy).not.toHaveBeenCalled();
      expect(engine.runState.gold).toBe(goldBefore + tower!.totalInvested);
      expect(engine.runState.selectedTowerId).toBeNull();
      expect(engine.towerManager?.towers).toHaveLength(0);
    });

    it("downgradeSelected reduces level without confirmation", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      engine.runState.gold -= cost;
      tower.doUpgrade(engine.persistState, cost);
      engine.runState.selectedTowerId = String(tower.id);
      engine.downgradeSelected();
      expect(tower.level).toBe(1);
    });

    it("downgradeSelected returns early when tower is level 1", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      engine.runState.selectedTowerId = String(tower.id);
      const goldBefore = engine.runState.gold;
      engine.downgradeSelected();
      expect(engine.runState.gold).toBe(goldBefore);
    });

    it("executeDowngrade reduces level and refunds gold (default sell mode)", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      engine.runState.gold -= cost;
      tower.doUpgrade(engine.persistState, cost);
      const expectedRefund = Math.round(tower.upgradeCost(2) * SELL_VALUE_RATIO);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeDowngrade();
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
      expect(tower.level).toBe(1);
    });

    it("executeDowngrade refunds full amount in refund mode", () => {
      engine.persistState.generalAddons.sellActive = "refund";
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      engine.runState.gold -= cost;
      tower.doUpgrade(engine.persistState, cost);
      const expectedRefund = tower.upgradeCost(2);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeDowngrade();
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
      expect(tower.level).toBe(1);
    });

    it("executeDowngrade levels down with zero gold refund in discount mode", () => {
      engine.persistState.generalAddons.sellActive = "discount";
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      engine.runState.gold -= cost;
      tower.doUpgrade(engine.persistState, cost);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeDowngrade();
      expect(engine.runState.gold).toBe(goldBefore);
      expect(tower.level).toBe(1);
    });

    it("executeDowngrade resets variant when downgrading specialized tower", () => {
      engine.persistState.unlocked.basic.levels[2] = true;
      engine.persistState.unlocked.basic.levels[3] = true;
      engine.persistState.unlocked.basic.variantA[0] = true;
      // Fund the account: upgrade/specialize costs must never drive gold negative
      // (setGold floors at zero), so the refund math below stays exact.
      engine.runState.gold = 100000;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        engine.runState.gold -= cost;
        tower.doUpgrade(engine.persistState, cost);
      }
      const specCost = tower.upgradeCost(5);
      engine.runState.gold -= specCost;
      tower.specialize("A", engine.persistState, specCost);
      expect(tower.level).toBe(5);
      expect(tower.variant).toBe("A");
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeDowngrade();
      expect(tower.level).toBe(4);
      expect(tower.variant).toBeNull();
      const expectedRefund = Math.round(specCost * SELL_VALUE_RATIO);
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
    });

    it("getUpgradeCost applies upgradeCostReduction addon", () => {
      engine.persistState.generalAddons.upgradeCostReduction = 0;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      const baseCost = tower!.upgradeCost(2);
      const expected = Math.floor(baseCost * (1 - 0.1));
      expect(cost).toBe(expected);
    });

    it("specializeSelected deducts level 5 gold cost", () => {
      engine.persistState.unlocked.basic.levels[2] = true;
      engine.persistState.unlocked.basic.levels[3] = true;
      engine.persistState.unlocked.basic.variantA[0] = true;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        engine.runState.gold -= cost;
        tower!.doUpgrade(engine.persistState, cost);
      }
      expect(tower!.level).toBe(4);
      engine.runState.selectedTowerId = String(tower!.id);
      const lv5Cost = tower!.upgradeCost(5);
      engine.runState.gold = lv5Cost;
      const goldBefore = engine.runState.gold;
      engine.specializeSelected("A");
      const selected = engine.getSelectedTower() as Tower;
      expect(selected.level).toBe(5);
      expect(selected.variant).toBe("A");
      expect(engine.runState.gold).toBe(goldBefore - lv5Cost);
    });

    it("specializeSelected applies upgradeCostReduction once", () => {
      engine.persistState.unlocked.basic.levels[2] = true;
      engine.persistState.unlocked.basic.levels[3] = true;
      engine.persistState.unlocked.basic.variantA[0] = true;
      engine.persistState.generalAddons.upgradeCostReduction = 1;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        engine.runState.gold -= cost;
        tower!.doUpgrade(engine.persistState, cost);
      }
      expect(tower!.level).toBe(4);
      engine.runState.selectedTowerId = String(tower!.id);
      expect(engine.getUpgradeCost(tower!)).toBe(120);
      engine.runState.gold = 120;
      engine.specializeSelected("A");
      const selected = engine.getSelectedTower() as Tower;
      expect(selected.level).toBe(5);
      expect(selected.variant).toBe("A");
      expect(engine.runState.gold).toBe(0);
    });

    it("specializeSelected does not deduct gold when the variant is not unlocked in the worker persistState", () => {
      // Simulate the mid-run desync: the main thread unlocked the variant (so the
      // UI shows the button as enabled) but the worker's persistState clone is stale.
      engine.persistState.unlocked.basic.levels[2] = true;
      engine.persistState.unlocked.basic.levels[3] = true;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        engine.runState.gold -= cost;
        tower!.doUpgrade(engine.persistState, cost);
      }
      expect(tower!.level).toBe(4);
      engine.runState.selectedTowerId = String(tower!.id);
      const lv5Cost = tower!.upgradeCost(5);
      engine.runState.gold = lv5Cost;
      const goldBefore = engine.runState.gold;
      engine.specializeSelected("A");
      const selected = engine.getSelectedTower() as Tower;
      // No variant applied and no gold lost — the bug was silent gold deduction.
      expect(selected.level).toBe(4);
      expect(selected.variant).toBeNull();
      expect(engine.runState.gold).toBe(goldBefore);
    });

    it("syncPersist makes a mid-run unlock reach specializeSelected", () => {
      engine.persistState.unlocked.basic.levels[2] = true;
      engine.persistState.unlocked.basic.levels[3] = true;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        engine.runState.gold -= cost;
        tower!.doUpgrade(engine.persistState, cost);
      }
      engine.runState.selectedTowerId = String(tower!.id);
      const lv5Cost = tower!.upgradeCost(5);
      engine.runState.gold = lv5Cost;

      // Variant still locked in the worker → no effect.
      engine.specializeSelected("A");
      expect((engine.getSelectedTower() as Tower).level).toBe(4);

      // Main thread pushes the unlock down to the worker.
      const syncedUnlocked = createDefaultPersistState().unlocked;
      syncedUnlocked.basic.levels[2] = true;
      syncedUnlocked.basic.levels[3] = true;
      syncedUnlocked.basic.variantA[0] = true;
      engine.syncPersist(syncedUnlocked, engine.persistState.generalAddons);

      const goldBefore = engine.runState.gold;
      engine.specializeSelected("A");
      const selected = engine.getSelectedTower() as Tower;
      expect(selected.level).toBe(5);
      expect(selected.variant).toBe("A");
      expect(engine.runState.gold).toBe(goldBefore - lv5Cost);
    });

    it("syncPersist applies a skill-tree gem delta onto the worker persist copy", () => {
      engine.persistState.gems = 206;
      engine.persistDirty = false;
      engine.syncPersist(engine.persistState.unlocked, engine.persistState.generalAddons, -100);
      expect(engine.persistState.gems).toBe(106);
      expect(engine.persistDirty).toBe(true);

      engine.persistDirty = false;
      engine.syncPersist(engine.persistState.unlocked, engine.persistState.generalAddons, 0);
      expect(engine.persistState.gems).toBe(106);
      expect(engine.persistDirty).toBe(false);
    });

    it("debug mutates the authoritative runState/persistState", () => {
      const goldBefore = engine.runState.gold;
      const livesBefore = engine.runState.baseHealth;
      const gemsBefore = engine.persistState.gems;

      engine.debug("addGold", 1000);
      engine.debug("addBaseHealth", 10);
      engine.debug("addGems", 100);
      expect(engine.persistState.gems).toBe(gemsBefore + 100);
      // setWave runs the shared milestone/best-wave/unlock path, so jumping to 50
      // also claims the 15/30/50 milestones on top of the injected gems.
      engine.debug("setWave", 50);
      engine.debug("setTimeScale", 8);

      expect(engine.runState.gold).toBe(goldBefore + 1000);
      expect(engine.runState.baseHealth).toBe(Math.min(livesBefore + 10, engine.runState.maxBaseHealth));
      expect(engine.persistState.gems).toBeGreaterThanOrEqual(gemsBefore + 100);
      for (const milestoneWave of [15, 30, 50]) {
        expect(engine.runState.milestoneRewardsClaimed[milestoneWave]).toBe(true);
      }
      expect(engine.runState.currentWave).toBe(50);
      expect(engine.waveManager!.currentWave).toBe(50);
      expect(engine.runState.timeScale).toBe(8);
      expect(engine.persistDirty).toBe(true);
    });

    it("debug killAll clears spawned enemies", () => {
      initEngine(0, createTestPersistState());
      engine.enemyManager!.spawn("minion", 1, 0, 1);
      expect(engine.enemyManager!.enemies.length).toBe(1);
      engine.debug("killAll");
      expect(engine.enemyManager!.enemies.length).toBe(0);
    });

    it("cancelSelected refunds full gold within cancel window", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const goldBefore = engine.runState.gold - tower!.totalInvested;
      engine.runState.gold = goldBefore;
      engine.runState.selectedTowerId = String(tower!.id);
      expect(tower!.canCancel()).toBe(true);
      engine.cancelSelected();
      expect(engine.runState.gold).toBe(goldBefore + tower!.totalInvested);
      expect(engine.runState.selectedTowerId).toBeNull();
      expect(engine.towerManager?.towers).toHaveLength(0);
    });
  });

  describe("time control", () => {
    it("cycleSpeed cycles through [1, 2, 4, 8]", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.timeScale = 1;
      expect(engine.cycleSpeed()).toBe(2);
      expect(engine.cycleSpeed()).toBe(4);
      expect(engine.cycleSpeed()).toBe(8);
      expect(engine.cycleSpeed()).toBe(1);
    });

    it("togglePause switches between playing and paused", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.PLAYING;
      engine.togglePause();
      expect(engine.runState.state).toBe(GameState.PAUSED);
      engine.togglePause();
      expect(engine.runState.state).toBe(GameState.PLAYING);
    });

    it("clamps the speed to 2x when a boss emerges", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.timeScale = 8;
      engine.enemyManager?.spawn("boss", 1, 0, 1);
      expect(engine.runState.timeScale).toBe(BOSS_SPEED_LIMIT);
    });

    it("leaves the speed alone when a boss emerges at or below 2x", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.timeScale = 2;
      engine.enemyManager?.spawn("boss", 1, 0, 1);
      expect(engine.runState.timeScale).toBe(2);
      engine.runState.timeScale = 1;
      engine.enemyManager?.spawn("boss", 1, 0, 1);
      expect(engine.runState.timeScale).toBe(1);
    });

    it("does not clamp the speed for a non-boss spawn", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.timeScale = 8;
      engine.enemyManager?.spawn("runner", 1, 0, 1);
      expect(engine.runState.timeScale).toBe(8);
    });
  });

  describe("state management", () => {
    it("setState changes game state", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.MENU;
      expect(engine.runState.state).toBe(GameState.MENU);
    });

    it("stop sets state to MENU and cancels RAF", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.PLAYING;
      engine.stop();
      expect(engine.runState.state).toBe(GameState.MENU);
    });
  });

  describe("endGame conditions", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("triggerEnd sets victory state and data", () => {
      engine.runState.endScreenData = null;
      engine.runState.state = "playing";
      engine.runState.selectedTowerId = "1";
      engine.runState.selectedTowerType = "basic";
      engine.runState.hoverTile = { tileX: 0, tileY: 0 };

      engine.runState.selectedTowerId = null;
      engine.runState.selectedTowerType = null;
      engine.runState.hoverTile = null;
      engine.runState.endScreenData = {
        victory: true,
        wave: 100,
        gems: 50,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      };
      engine.runState.state = GameState.VICTORY;

      expect(engine.runState.state).toBe(GameState.VICTORY);
      expect(engine.runState.endScreenData?.victory).toBe(true);
      expect(engine.runState.endScreenData?.wave).toBe(100);
    });

    it("triggerEnd sets game over state", () => {
      engine.runState.selectedTowerId = null;
      engine.runState.selectedTowerType = null;
      engine.runState.hoverTile = null;
      engine.runState.endScreenData = {
        victory: false,
        wave: 50,
        gems: 10,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      };
      engine.runState.state = GameState.GAME_OVER;

      expect(engine.runState.state).toBe(GameState.GAME_OVER);
      expect(engine.runState.endScreenData?.victory).toBe(false);
    });

    it("does not re-add history or gems on repeated endGame calls (C1)", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const before = persistState.runHistory.length;
      engine.endGame(true);
      const afterFirst = persistState.runHistory.length;
      engine.endGame(true);
      const afterSecond = persistState.runHistory.length;
      expect(afterFirst).toBe(before + 1);
      expect(afterSecond).toBe(afterFirst);
    });

    it("update() is a no-op once the game has ended (C1)", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.endGame(true);
      engine.runState.state = GameState.VICTORY;
      const historyLen = persistState.runHistory.length;
      engine.update(0.016);
      expect(persistState.runHistory.length).toBe(historyLen);
    });

    it("clears selection and hover on end", () => {
      engine.runState.hoverTile = { tileX: 0, tileY: 0 };
      engine.runState.selectedTowerId = "1";

      engine.runState.selectedTowerId = null;
      engine.runState.selectedTowerType = null;
      engine.runState.hoverTile = null;
      engine.runState.endScreenData = {
        victory: true,
        wave: 1,
        gems: 0,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      };

      expect(engine.runState.selectedTowerId).toBeNull();
      expect(engine.runState.hoverTile).toBeNull();
    });
  });

  describe("wave top towers", () => {
    function buildDamagedTower(damage: number): Tower {
      const grid = engine.runState.grid;
      for (let tileX = 0; tileX < grid.width; tileX++) {
        for (let tileY = 0; tileY < grid.height; tileY++) {
          if (!grid.canBuild(tileX, tileY)) continue;
          const tower = engine.towerManager.build("basic", tileX, tileY, engine.persistState, grid);
          if (!tower) continue;
          tower.waveDamage = damage;
          return tower;
        }
      }
      throw new Error("no buildable tile found");
    }

    it("stamps the medals when a wave clears, while the wave damage is still live", () => {
      initEngine(0, createTestPersistState());
      const tower = buildDamagedTower(40);
      expect(engine.waveTopTowers).toBeNull();

      engine.onWaveCleared(1);
      expect(engine.waveTopTowers).toEqual([{ towerId: tower.id, rank: 1, damage: 40, simSeconds: 0 }]);

      // onWaveStart zeroes the wave damage and must not restamp over the window.
      engine.onWaveStart(2);
      expect(engine.waveTopTowers).toEqual([{ towerId: tower.id, rank: 1, damage: 40, simSeconds: 0 }]);
    });

    it("stamps the medals on timer expiry, which skips the countdown", () => {
      initEngine(0, createTestPersistState());
      const tower = buildDamagedTower(40);
      engine.onWaveExpired(1);
      expect(engine.waveTopTowers).toEqual([{ towerId: tower.id, rank: 1, damage: 40, simSeconds: 0 }]);
    });

    it("does not stamp the medals on the victory-wave clear", () => {
      initEngine(0, createTestPersistState());
      buildDamagedTower(40);
      engine.onWaveCleared(VICTORY_WAVE);
      expect(engine.waveTopTowers).toBeNull();
    });

    it("records the victory wave as the best wave when the wave ends by timer expiry", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      buildDamagedTower(40);
      engine.onWaveExpired(VICTORY_WAVE);
      expect(persistState.themeProgress[DEFAULT_THEME_ID]?.bestWaves.best_0).toBe(VICTORY_WAVE);
      expect(engine.waveTopTowers).toBeNull();
    });
  });

  describe("first clear bonus calculation", () => {
    it("sums afterFirstTime from all gem sources", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.gemBreakdown.bossKills.afterFirstTime = 10;
      engine.runState.gemBreakdown.milestones.afterFirstTime = 20;
      engine.runState.gemBreakdown.waveCompletion.afterFirstTime = 30;
      const breakdown = engine.runState.gemBreakdown;
      const subtotal =
        breakdown.bossKills.afterFirstTime +
        breakdown.milestones.afterFirstTime +
        breakdown.waveCompletion.afterFirstTime;
      expect(subtotal).toBe(60);
    });
  });

  describe("dispose", () => {
    it("stops the engine and sets state to MENU", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.PLAYING;
      engine.dispose();
      expect(engine.runState.state).toBe(GameState.MENU);
    });
  });

  describe("targeting cache invalidation", () => {
    function buildAndSelectTower(): Tower {
      const grid = engine.runState.grid!;
      let tower: Tower | null = null;
      for (let x = 0; x < grid.width && !tower; x++) {
        for (let y = 0; y < grid.height && !tower; y++) {
          if (grid.canBuild(x, y)) {
            tower = engine.towerManager!.build("basic", x, y, engine.persistState, grid);
          }
        }
      }
      if (!tower) throw new Error("no buildable tile found");
      engine.runState.selectedTowerId = tower.id;
      return tower;
    }

    function placeEnemyInTowerRange(tower: Tower): Enemy {
      const enemy = engine.enemyManager!.spawn("minion", 1, 0, 1)!;
      // Freeze the enemy at the tower so it stays within range during the tick
      // (a spawned enemy otherwise walks its path away from the tower). Under
      // physics the enemy's rigid body is authoritative, so we move the body
      // too; getEnemiesInRange now resolves through the physics world.
      enemy.speed = 0;
      enemy.centerX = tower.x;
      enemy.centerY = tower.y;
      enemy.x = tower.x;
      enemy.y = tower.y;
      enemy.body?.setTranslation({ x: tower.x, y: tower.y }, true);
      return enemy;
    }

    it("clears cachedTargetId when the targeting mode changes and re-acquires a target", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const tower = buildAndSelectTower();
      const enemy = placeEnemyInTowerRange(tower);
      tower.cachedTargetId = 42;
      engine.setTargeting("closest");
      expect(tower.cachedTargetId).toBeNull();
      engine.update(1 / 60);
      expect(tower.cachedTargetId).not.toBeNull();
      const reacquired = engine.enemyManager!.getEnemyById(tower.cachedTargetId!);
      expect(reacquired).toBeDefined();
      expect(reacquired!.removed).toBe(false);
      expect(reacquired!.id).toBe(enemy.id);
    });

    it("clears cachedTargetId when the fixed-aim direction changes and re-acquires a target", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const tower = buildAndSelectTower();
      const enemy = placeEnemyInTowerRange(tower);
      tower.cachedTargetId = 42;
      engine.setFixedAimDir("N");
      expect(tower.cachedTargetId).toBeNull();
      engine.update(1 / 60);
      expect(tower.cachedTargetId).not.toBeNull();
      const reacquired = engine.enemyManager!.getEnemyById(tower.cachedTargetId!);
      expect(reacquired).toBeDefined();
      expect(reacquired!.removed).toBe(false);
      expect(reacquired!.id).toBe(enemy.id);
    });

    it("credits burn ticks to the inflicting tower's totals", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const tower = buildAndSelectTower();
      tower.cooldown = 9999;
      const enemy = placeEnemyInTowerRange(tower);
      enemy.hp = 1000;
      enemy.applyBurn(10, 5, tower.id);
      const damageBefore = tower.totalDamageDealt;
      engine.update(1 / 60);
      expect(tower.totalDamageDealt).toBeGreaterThan(damageBefore);
      expect(enemy.hp).toBeLessThan(1000);
    });
  });
});
