// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MILESTONE_BONUS_PCT,
  MILESTONE_THRESHOLD,
  SELL_VALUE_RATIO,
  TERRAIN_HEIGHT_BONUS_PCT,
  TOWER_BASE,
  TOWER_LEVEL_DMG_MULT,
  TOWER_LEVEL_RANGE_MULT,
  TOWER_LEVEL_RATE_MULT,
  TOWER_LEVEL_SPLASH_MULT,
  TOWER_META,
  UPGRADE_COST_BASE,
} from "@/sim/Constants.js";
import { CANNON_FRAGMENT_SPLASH_TIERS } from "@/sim/ConstantsTower.js";
import { Tower } from "@/sim/towers/Tower.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

interface SaveFixture {
  gems: number;
  unlocked: Record<string, { levels: boolean[]; variantA: boolean[]; variantB: boolean[]; addons: boolean[] }>;
  generalAddons: {
    extraHealth: null;
    startingGold: null;
    sellRefundUnlocked: boolean;
    sellDiscountUnlocked: boolean;
    sellActive: null;
    upgradeCostReduction: null;
    terrainHeightBonus: null | number;
    damageMilestoneBonus: null | number;
  };
}

function makeSave(addons: boolean[] | null = null): SaveFixture {
  const unlocked: SaveFixture["unlocked"] = {};
  for (const id of Object.keys(TOWER_META)) {
    unlocked[id] = {
      levels: [true, true, true, true, true, true, true],
      variantA: [true, true, true],
      variantB: [true, true, true],
      addons: addons ?? [false, false, false],
    };
  }
  return {
    gems: 99999,
    unlocked,
    generalAddons: {
      extraHealth: null,
      startingGold: null,
      sellRefundUnlocked: false,
      sellDiscountUnlocked: false,
      sellActive: null,
      upgradeCostReduction: null,
      terrainHeightBonus: null,
      damageMilestoneBonus: null,
    },
  };
}

function makeMockGrid() {
  const map = makeBastionMap();
  return {
    tileSize: 36,
    tiles: map.tiles,
    getBase: () => ({ x: map.base.x, y: map.base.y }),
    tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
  };
}

describe("Tower", () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
  });

  describe("constructor", () => {
    it("sets type, grid coords, and world position", () => {
      const tower = new Tower("basic", 5, 3, makeSave(), makeMockGrid());
      expect(tower.type).toBe("basic");
      expect(tower.tileX).toBe(5);
      expect(tower.tileY).toBe(3);
      expect(tower.x).toBe(5 * 36 + 18);
      expect(tower.y).toBe(3 * 36 + 18);
    });

    it("starts at level 1", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      expect(tower.level).toBe(1);
    });

    it("sets totalInvested to tower cost", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      expect(tower.totalInvested).toBe(TOWER_META.basic.cost);
    });

    it("sets default targeting based on type", () => {
      const sniper = new Tower("sniper", 0, 0, makeSave(), makeMockGrid());
      expect(sniper.targeting).toBe("strong");
      const basic = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      expect(basic.targeting).toBe("first");
    });

    it("captures terrain height from grid", () => {
      const map = makeBastionMap();
      const grid = { tileSize: 36, tiles: map.tiles };
      // Bastion map has all height=1
      const tower = new Tower("basic", 0, 0, makeSave(), grid);
      expect(tower.terrainHeight).toBe(1);
    });

    it("defaults terrainHeight to 1 when no grid provided", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      expect(tower.terrainHeight).toBe(1);
    });
  });

  describe("stats computation", () => {
    it("computes level 1 stats from base values", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const towerStats = tower.stats;
      expect(towerStats.damage).toBe(TOWER_BASE.basic.damage);
      expect(towerStats.fireRate).toBe(TOWER_BASE.basic.fireRate);
      expect(towerStats.range).toBe(TOWER_BASE.basic.range);
      expect(towerStats.splash).toBe(TOWER_BASE.basic.splash || 0);
    });

    it("scales damage at level N using TOWER_LEVEL_DMG_MULT", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 3;
      const expectedDamage = TOWER_BASE.basic.damage * TOWER_LEVEL_DMG_MULT ** 2;
      expect(tower.stats.damage).toBeCloseTo(expectedDamage, 4);
    });

    it("scales fire rate at level N using TOWER_LEVEL_RATE_MULT", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 3;
      const expectedRate = TOWER_BASE.basic.fireRate * TOWER_LEVEL_RATE_MULT ** 2;
      expect(tower.stats.fireRate).toBeCloseTo(expectedRate, 4);
    });

    it("scales range at level N using TOWER_LEVEL_RANGE_MULT", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 3;
      const expectedRange = TOWER_BASE.basic.range * TOWER_LEVEL_RANGE_MULT ** 2;
      expect(tower.stats.range).toBeCloseTo(expectedRange, 4);
    });

    it("computes stats for all tower types at level 1", () => {
      for (const typeId of Object.keys(TOWER_BASE)) {
        const tower = new Tower(typeId, 0, 0, makeSave(), makeMockGrid());
        const towerStats = tower.stats;
        expect(towerStats.damage).toBe(TOWER_BASE[typeId].damage);
        expect(towerStats.fireRate).toBe(TOWER_BASE[typeId].fireRate);
        expect(towerStats.range).toBe(TOWER_BASE[typeId].range);
      }
    });

    it("includes splash for cannon at level 1", () => {
      const tower = new Tower("cannon", 0, 0, makeSave(), makeMockGrid());
      expect(tower.stats.splash).toBe(TOWER_BASE.cannon.splash);
    });

    it("scales splash radius with tower level using TOWER_LEVEL_SPLASH_MULT", () => {
      const tower = new Tower("cannon", 0, 0, makeSave(), makeMockGrid());
      tower.level = 6;
      const expectedSplash = (TOWER_BASE.cannon.splash ?? 0) * TOWER_LEVEL_SPLASH_MULT ** 5;
      expect(tower.stats.splash).toBeCloseTo(expectedSplash, 4);
    });

    it("includes chain for lightning at level 1", () => {
      const tower = new Tower("lightning", 0, 0, makeSave(), makeMockGrid());
      expect(tower.stats.chain).toBe(TOWER_BASE.lightning.chain);
    });

    it("includes slowAmt for ice at level 1", () => {
      const tower = new Tower("ice", 0, 0, makeSave(), makeMockGrid());
      expect(tower.stats.slowAmt).toBe(TOWER_BASE.ice.slowAmt);
      expect(tower.stats.slowDur).toBe(TOWER_BASE.ice.slowDur);
    });

    it("railgun fire rate is ~1/s at level 5 after rebalance", () => {
      const tower = new Tower("railgun", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      const expectedRate = TOWER_BASE.railgun.fireRate * TOWER_LEVEL_RATE_MULT ** 4;
      expect(tower.stats.fireRate).toBeCloseTo(expectedRate, 4);
      // Should be approximately 1 shot per second
      expect(tower.stats.fireRate).toBeGreaterThan(0.8);
      expect(tower.stats.fireRate).toBeLessThan(1.3);
    });
  });

  describe("variant modifications", () => {
    it("Variant A (Rapid) increases fireRate by 3x and reduces damage to 0.6x", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      tower.variant = "A";
      const towerStats = tower.stats;
      const expectedRate = TOWER_BASE.basic.fireRate * TOWER_LEVEL_RATE_MULT ** 4 * 3;
      const expectedDamage = TOWER_BASE.basic.damage * TOWER_LEVEL_DMG_MULT ** 4 * 0.6;
      expect(towerStats.fireRate).toBeCloseTo(expectedRate, 4);
      expect(towerStats.damage).toBeCloseTo(expectedDamage, 4);
    });

    it("Variant B (Heavy) reduces fireRate to 0.5x and increases damage to 2.5x", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      tower.variant = "B";
      const towerStats = tower.stats;
      const expectedRate = TOWER_BASE.basic.fireRate * TOWER_LEVEL_RATE_MULT ** 4 * 0.5;
      const expectedDamage = TOWER_BASE.basic.damage * TOWER_LEVEL_DMG_MULT ** 4 * 2.5;
      expect(towerStats.fireRate).toBeCloseTo(expectedRate, 4);
      expect(towerStats.damage).toBeCloseTo(expectedDamage, 4);
    });

    it("Variant B (Shatter) doubles ice damage", () => {
      const tower = new Tower("ice", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      tower.variant = "B";
      const baseDamage = TOWER_BASE.ice.damage * TOWER_LEVEL_DMG_MULT ** 4;
      expect(tower.stats.damage).toBeCloseTo(baseDamage * 2, 4);
    });

    it("Variant A (Marksman) sets marksman flag", () => {
      const tower = new Tower("sniper", 0, 0, makeSave(), makeMockGrid());
      tower.level = 4;
      expect(tower.specialize("A", makeSave())).toBe(true);
      expect(tower.stats.marksman).toBe(true);
    });

    it("Variant B (Piercer) sets pierce to 3", () => {
      const tower = new Tower("sniper", 0, 0, makeSave(), makeMockGrid());
      tower.level = 4;
      expect(tower.specialize("B", makeSave())).toBe(true);
      expect(tower.stats.pierce).toBe(3);
    });

    it("Variant A (Permafrost) multiplies the level-scaled splash by [1, 1.25, 1.5] per tier", () => {
      const tower = new Tower("ice", 0, 0, makeSave(), makeMockGrid());
      const baseSplash = TOWER_BASE.ice.splash!;
      tower.level = 4;
      expect(tower.specialize("A", makeSave())).toBe(true);
      expect(tower.stats.splash).toBeCloseTo(baseSplash * TOWER_LEVEL_SPLASH_MULT ** 4 * 1, 6);
      expect(tower.doUpgrade(makeSave()).ok).toBe(true);
      expect(tower.stats.splash).toBeCloseTo(baseSplash * TOWER_LEVEL_SPLASH_MULT ** 5 * 1.25, 6);
      expect(tower.doUpgrade(makeSave()).ok).toBe(true);
      expect(tower.stats.splash).toBeCloseTo(baseSplash * TOWER_LEVEL_SPLASH_MULT ** 6 * 1.5, 6);
    });

    it("Variant A (Fragment) multiplies the level-scaled splash by CANNON_FRAGMENT_SPLASH_TIERS per tier", () => {
      const tower = new Tower("cannon", 0, 0, makeSave(), makeMockGrid());
      const baseSplash = TOWER_BASE.cannon.splash!;
      tower.level = 4;
      expect(tower.specialize("A", makeSave())).toBe(true);
      expect(tower.stats.splash).toBeCloseTo(
        baseSplash * TOWER_LEVEL_SPLASH_MULT ** 4 * CANNON_FRAGMENT_SPLASH_TIERS[0]!,
        6,
      );
      expect(tower.doUpgrade(makeSave()).ok).toBe(true);
      expect(tower.stats.splash).toBeCloseTo(
        baseSplash * TOWER_LEVEL_SPLASH_MULT ** 5 * CANNON_FRAGMENT_SPLASH_TIERS[1]!,
        6,
      );
      expect(tower.doUpgrade(makeSave()).ok).toBe(true);
      expect(tower.stats.splash).toBeCloseTo(
        baseSplash * TOWER_LEVEL_SPLASH_MULT ** 6 * CANNON_FRAGMENT_SPLASH_TIERS[2]!,
        6,
      );
    });

    it("Variant A (Overload) increases chain by 2*t and damage by 1.2^t per tier", () => {
      const tower = new Tower("lightning", 0, 0, makeSave(), makeMockGrid());
      tower.level = 4;
      expect(tower.specialize("A", makeSave())).toBe(true);
      expect(tower.doUpgrade(makeSave()).ok).toBe(true);
      expect(tower.doUpgrade(makeSave()).ok).toBe(true);
      const tierIndex = tower.level - 5;
      const baseChain = TOWER_BASE.lightning.chain;
      const baseDamage = TOWER_BASE.lightning.damage * TOWER_LEVEL_DMG_MULT ** (tower.level - 1);
      expect(tower.stats.chain).toBe((baseChain ?? 0) + 2 * tierIndex);
      expect(tower.stats.damage).toBeCloseTo(baseDamage * 1.2 ** tierIndex, 4);
    });

    it("does not apply variant at level < 5", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 4;
      tower.variant = "A";
      const towerStats = tower.stats;
      const expectedRate = TOWER_BASE.basic.fireRate * TOWER_LEVEL_RATE_MULT ** 3;
      expect(towerStats.fireRate).toBeCloseTo(expectedRate, 4); // No 3x multiplier
    });
  });

  describe("addon interactions", () => {
    it("sniper addon [2] (Long Range) adds +2 range", () => {
      const save = makeSave();
      save.unlocked.sniper.addons = [false, false, true]; // sniper addon 2
      const tower = new Tower("sniper", 0, 0, save, makeMockGrid());
      const baseRange = TOWER_BASE.sniper.range;
      expect(tower.stats.range).toBeCloseTo(baseRange + 2, 4);
    });

    it("basic addon [2] (Bounce Shot) sets bounceShot flag", () => {
      const save = makeSave();
      save.unlocked.basic.addons = [false, false, true];
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      expect(tower.stats.bounceShot).toBe(true);
    });

    it("basic addon [0] (Critical Hit) sets critChance", () => {
      const save = makeSave();
      save.unlocked.basic.addons = [true, false, false];
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      expect(tower.stats.critChance).toBe(0.15);
    });

    it("basic addon [1] (Gold Rush) sets goldOnCrit", () => {
      const save = makeSave();
      save.unlocked.basic.addons = [false, true, false];
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      expect(tower.stats.goldOnCrit).toBe(1);
    });

    it("cannon addon [0] (Wide Blast) multiplies splash by 1.5", () => {
      const save = makeSave();
      save.unlocked.cannon.addons = [true, false, false];
      const tower = new Tower("cannon", 0, 0, save, makeMockGrid());
      const expectedSplash = (TOWER_BASE.cannon.splash ?? 0) * 1.5;
      expect(tower.stats.splash).toBeCloseTo(expectedSplash, 4);
    });

    it("cannon addon [1] (Stun Shell) sets splashStun", () => {
      const save = makeSave();
      save.unlocked.cannon.addons = [false, true, false];
      const tower = new Tower("cannon", 0, 0, save, makeMockGrid());
      expect(tower.stats.splashStun).toBe(0.3);
    });

    it("cannon addon [2] (Anti-Air) sets antiAir flag", () => {
      const save = makeSave();
      save.unlocked.cannon.addons = [false, false, true];
      const tower = new Tower("cannon", 0, 0, save, makeMockGrid());
      expect(tower.stats.antiAir).toBe(true);
    });

    it("lightning addon [0] (Static Field) sets staticField flag", () => {
      const save = makeSave();
      save.unlocked.lightning.addons = [true, false, false];
      const tower = new Tower("lightning", 0, 0, save, makeMockGrid());
      expect(tower.stats.staticField).toBe(true);
    });

    it("lightning addon [1] (Double Discharge) sets doubleDischarge chance", () => {
      const save = makeSave();
      save.unlocked.lightning.addons = [false, true, false];
      const tower = new Tower("lightning", 0, 0, save, makeMockGrid());
      expect(tower.stats.doubleDischarge).toBe(0.1);
    });

    it("lightning addon [2] (Burn Circuit) sets burnCircuit flag", () => {
      const save = makeSave();
      save.unlocked.lightning.addons = [false, false, true];
      const tower = new Tower("lightning", 0, 0, save, makeMockGrid());
      expect(tower.stats.burnCircuit).toBe(true);
    });

    it("ice addon [0] (Frost Aura) sets frostAura flag", () => {
      const save = makeSave();
      save.unlocked.ice.addons = [true, false, false];
      const tower = new Tower("ice", 0, 0, save, makeMockGrid());
      expect(tower.stats.frostAura).toBe(true);
    });

    it("ice addon [1] (Deep Freeze) multiplies slowAmt by 1.25", () => {
      const save = makeSave();
      save.unlocked.ice.addons = [false, true, false];
      const tower = new Tower("ice", 0, 0, save, makeMockGrid());
      const expectedSlow = (TOWER_BASE.ice.slowAmt ?? 0) * 1.25;
      expect(tower.stats.slowAmt).toBeCloseTo(expectedSlow, 4);
    });

    it("ice addon [2] (Ice Burst) sets iceBurst flag", () => {
      const save = makeSave();
      save.unlocked.ice.addons = [false, false, true];
      const tower = new Tower("ice", 0, 0, save, makeMockGrid());
      expect(tower.stats.iceBurst).toBe(true);
    });

    it("sniper addon [0] (True Shot) sets trueShot chance", () => {
      const save = makeSave();
      save.unlocked.sniper.addons = [true, false, false];
      const tower = new Tower("sniper", 0, 0, save, makeMockGrid());
      expect(tower.stats.trueShot).toBe(0.2);
    });

    it("sniper addon [1] (Mark Target) sets markTarget percentage", () => {
      const save = makeSave();
      save.unlocked.sniper.addons = [false, true, false];
      const tower = new Tower("sniper", 0, 0, save, makeMockGrid());
      expect(tower.stats.markTarget).toBe(0.25);
    });

    it("railgun addon [0] (Charge Shot) sets chargeShot flag", () => {
      const save = makeSave();
      save.unlocked.railgun.addons = [true, false, false];
      const tower = new Tower("railgun", 0, 0, save, makeMockGrid());
      expect(tower.stats.chargeShot).toBe(true);
    });

    it("railgun addon [1] (Anti-Heal) sets antiHeal flag", () => {
      const save = makeSave();
      save.unlocked.railgun.addons = [false, true, false];
      const tower = new Tower("railgun", 0, 0, save, makeMockGrid());
      expect(tower.stats.antiHeal).toBe(true);
    });

    it("railgun addon [2] (Multi-Pierce) adds 2 to pierce", () => {
      const save = makeSave();
      save.unlocked.railgun.addons = [false, false, true];
      const tower = new Tower("railgun", 0, 0, save, makeMockGrid());
      const basePierce = tower.stats.pierce;
      expect(basePierce).toBe(2);
    });
  });

  describe("terrain height bonus", () => {
    it("applies terrain height bonus when addon is active", () => {
      const save = makeSave();
      save.generalAddons.terrainHeightBonus = 0; // tier 0: +5% per level
      const map = makeBastionMap();
      const grid = { tiles: map.tiles, tileSize: 36 };
      const tower = new Tower("basic", 0, 0, save, grid);
      const baseDamage = TOWER_BASE.basic.damage;
      const expectedDamage = baseDamage * (1 + TERRAIN_HEIGHT_BONUS_PCT[0] * 1);
      expect(tower.stats.damage).toBeCloseTo(expectedDamage, 4);
    });

    it("scales with terrain height", () => {
      const save = makeSave();
      save.generalAddons.terrainHeightBonus = 1; // tier 1: +10% per level
      // Create a grid with height=3 at position
      const map = makeBastionMap();
      map.tiles[0][0].height = 3;
      const grid = { tiles: map.tiles, tileSize: 36 };
      const tower = new Tower("basic", 0, 0, save, grid);
      const baseDamage = TOWER_BASE.basic.damage;
      const expectedDamage = baseDamage * (1 + TERRAIN_HEIGHT_BONUS_PCT[1] * 3);
      expect(tower.stats.damage).toBeCloseTo(expectedDamage, 4);
    });
  });

  describe("milestone bonus", () => {
    it("applies milestone bonus when addon is active and damage threshold crossed", () => {
      const save = makeSave();
      save.generalAddons.damageMilestoneBonus = 0; // tier 0: +5% dmg per 1M
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      tower.totalDamageDealt = MILESTONE_THRESHOLD; // 1M damage
      const baseDamage = TOWER_BASE.basic.damage;
      const expectedDamage = baseDamage * (1 + MILESTONE_BONUS_PCT[0][0] * 1);
      expect(tower.stats.damage).toBeCloseTo(expectedDamage, 4);
    });

    it("scales with total damage dealt", () => {
      const save = makeSave();
      save.generalAddons.damageMilestoneBonus = 0;
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      tower.totalDamageDealt = MILESTONE_THRESHOLD * 2; // 2M damage
      const baseDamage = TOWER_BASE.basic.damage;
      const expectedDamage = baseDamage * (1 + MILESTONE_BONUS_PCT[0][0] * 2);
      expect(tower.stats.damage).toBeCloseTo(expectedDamage, 4);
    });

    it("invalidates cache when totalDamageDealt crosses a milestone threshold", () => {
      const save = makeSave();
      save.generalAddons.damageMilestoneBonus = 0; // tier 0: +5% dmg per 1M
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());

      // Below threshold — stats are cached
      tower.totalDamageDealt = MILESTONE_THRESHOLD - 1;
      const statsBelow = tower.stats;

      // Cross the threshold — should recompute without manual cache touch
      tower.totalDamageDealt = MILESTONE_THRESHOLD;
      const statsAbove = tower.stats;

      expect(statsAbove.damage).toBeGreaterThan(statsBelow.damage);
      const baseDamage = TOWER_BASE.basic.damage;
      expect(statsAbove.damage).toBeCloseTo(baseDamage * (1 + MILESTONE_BONUS_PCT[0][0] * 1), 4);
    });

    it("invalidates cache when totalDamageDealt crosses a second milestone threshold", () => {
      const save = makeSave();
      save.generalAddons.damageMilestoneBonus = 0; // tier 0: +5% dmg per 1M
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());

      tower.totalDamageDealt = MILESTONE_THRESHOLD;
      const statsAt1M = tower.stats;

      tower.totalDamageDealt = MILESTONE_THRESHOLD * 2;
      const statsAt2M = tower.stats;

      expect(statsAt2M.damage).toBeGreaterThan(statsAt1M.damage);
      const baseDamage = TOWER_BASE.basic.damage;
      expect(statsAt2M.damage).toBeCloseTo(baseDamage * (1 + MILESTONE_BONUS_PCT[0][0] * 2), 4);
    });
  });

  describe("upgradeCost", () => {
    it("computes cost for next level using UPGRADE_COST_BASE", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      // Level 1 -> 2: cost = baseCost * 2^(2-2) = baseCost * 1
      const costLevel1to2 = tower.upgradeCost(2);
      expect(costLevel1to2).toBe(TOWER_META.basic.cost * UPGRADE_COST_BASE ** 0);

      // Level 2 -> 3: cost = baseCost * 2^(3-2) = baseCost * 2
      const costLevel2to3 = tower.upgradeCost(3);
      expect(costLevel2to3).toBe(TOWER_META.basic.cost * UPGRADE_COST_BASE ** 1);

      // Level 3 -> 4: cost = baseCost * 2^(4-2) = baseCost * 4
      const costLevel3to4 = tower.upgradeCost(4);
      expect(costLevel3to4).toBe(TOWER_META.basic.cost * UPGRADE_COST_BASE ** 2);
    });

    it("costs double each level", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const costLevel1to2 = tower.upgradeCost(2);
      const costLevel2to3 = tower.upgradeCost(3);
      expect(costLevel2to3).toBe(costLevel1to2 * UPGRADE_COST_BASE);
    });
  });

  describe("canUpgrade", () => {
    it("returns ok at level 1 with unlocks", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const upgradeResult = tower.canUpgrade(makeSave());
      expect(upgradeResult.ok).toBe(true);
      expect(upgradeResult.nextLevel).toBe(2);
    });

    it("returns needVariant at level 4 without variant", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 4;
      const upgradeResult = tower.canUpgrade(makeSave());
      expect(upgradeResult.needVariant).toBe(true);
      expect(upgradeResult.ok).toBe(false);
    });

    it("returns ok at level 4 with variant chosen", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 4;
      tower.variant = "A";
      const upgradeResult = tower.canUpgrade(makeSave());
      expect(upgradeResult.ok).toBe(true);
      expect(upgradeResult.nextLevel).toBe(5);
    });

    it("returns max level reached at level 7 (absolute max)", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 7;
      tower.variant = "A";
      const upgradeResult = tower.canUpgrade(makeSave());
      expect(upgradeResult.ok).toBe(false);
    });

    it("respects maxLevelFor when save is undefined (falls back to default persist state)", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 2;
      const upgradeResult = tower.canUpgrade(undefined);
      expect(upgradeResult.ok).toBe(false);
      expect(upgradeResult.reason).toBe("Max level reached");
    });
  });

  describe("doUpgrade", () => {
    it("increments level and adds cost to totalInvested", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const upgradeCost = tower.upgradeCost(2);
      tower.doUpgrade(makeSave());
      expect(tower.level).toBe(2);
      expect(tower.totalInvested).toBe(TOWER_META.basic.cost + upgradeCost);
    });

    it("invalidates stats cache on upgrade", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const statsBefore = tower.stats;
      tower.doUpgrade(makeSave());
      const statsAfter = tower.stats;
      expect(statsAfter.damage).not.toBe(statsBefore.damage);
    });
  });

  describe("specialize", () => {
    it("sets variant, upgrades to level 5, and invalidates cache", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 4;
      const investedBefore = tower.totalInvested;
      const specializeResult = tower.specialize("A", makeSave());
      expect(specializeResult).toBe(true);
      expect(tower.variant).toBe("A");
      expect(tower.level).toBe(5);
      expect(tower.totalInvested).toBeGreaterThan(investedBefore);
    });

    it("returns false when level is not 4", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const specializeResult = tower.specialize("A", makeSave());
      expect(specializeResult).toBe(false);
    });

    it("returns false when variant is not unlocked", () => {
      const save = makeSave();
      save.unlocked.basic.variantA = [false, false, false];
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      tower.level = 4;
      const specializeResult = tower.specialize("A", save);
      expect(specializeResult).toBe(false);
    });
  });

  describe("canCancel", () => {
    it("returns true for a fresh level 1 tower", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      expect(tower.canCancel()).toBe(true);
    });

    it("returns false after upgrade to level 2", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.level = 2;
      expect(tower.canCancel()).toBe(false);
    });

    it("returns remaining ms within window", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      expect(tower.cancelRemainingMs()).toBeGreaterThan(0);
      expect(tower.cancelRemainingMs()).toBeLessThanOrEqual(60000);
    });
  });

  describe("sellValue", () => {
    it("returns totalInvested * SELL_VALUE_RATIO", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const expectedSellValue = Math.round(TOWER_META.basic.cost * SELL_VALUE_RATIO);
      expect(tower.sellValue()).toBe(expectedSellValue);
    });

    it("reflects totalInvested after upgrades", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.doUpgrade(makeSave()); // level 2
      const expectedSellValue = Math.round(tower.totalInvested * SELL_VALUE_RATIO);
      expect(tower.sellValue()).toBe(expectedSellValue);
    });
  });

  describe("selectTarget", () => {
    function makeEnemy(params: { x: number; y: number; hp: number; id?: number }) {
      return { x: params.x, y: params.y, hp: params.hp, removed: false, type: "minion", id: params.id ?? 1 };
    }

    it("returns null when no enemies provided", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      expect(tower.selectTarget([])).toBeNull();
    });

    it("selects enemies regardless of removed flag", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [makeEnemy({ x: tower.x, y: tower.y, hp: 10, id: 1 })];
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
    });

    it('picks the enemy nearest the base for "first" targeting', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [
        makeEnemy({ x: tower.x + 50, y: tower.y, hp: 10, id: 1 }),
        makeEnemy({ x: tower.x + 100, y: tower.y, hp: 10, id: 2 }),
        makeEnemy({ x: tower.x + 70, y: tower.y, hp: 10, id: 3 }),
      ];
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
      expect(target?.id).toBe(2);
    });

    it('picks the enemy farthest from the base for "last" targeting', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [
        makeEnemy({ x: tower.x + 50, y: tower.y, hp: 10, id: 1 }),
        makeEnemy({ x: tower.x + 100, y: tower.y, hp: 10, id: 2 }),
        makeEnemy({ x: tower.x + 70, y: tower.y, hp: 10, id: 3 }),
      ];
      tower.targeting = "last";
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
      expect(target?.id).toBe(1);
    });

    it('picks the nearest enemy for "closest" targeting', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [
        makeEnemy({ x: tower.x + 100, y: tower.y, hp: 10, id: 1 }),
        makeEnemy({ x: tower.x + 20, y: tower.y, hp: 10, id: 2 }),
        makeEnemy({ x: tower.x + 50, y: tower.y, hp: 10, id: 3 }),
      ];
      tower.targeting = "closest";
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
      expect(target?.x).toBeCloseTo(tower.x + 20, 0);
    });

    it('picks the highest HP enemy for "strong" targeting', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [
        makeEnemy({ x: tower.x + 50, y: tower.y, hp: 10, id: 1 }),
        makeEnemy({ x: tower.x + 100, y: tower.y, hp: 50, id: 2 }),
        makeEnemy({ x: tower.x + 70, y: tower.y, hp: 30, id: 3 }),
      ];
      tower.targeting = "strong";
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
      expect(target?.hp).toBe(50);
    });

    it('picks the enemy nearer the base for "first" targeting when positions differ', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [makeEnemy({ x: 193, y: 18, hp: 10, id: 1 }), makeEnemy({ x: 48, y: 18, hp: 10, id: 2 })];
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
      expect(target?.id).toBe(1);
    });

    it('picks the enemy farther from the base for "last" targeting when positions differ', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [makeEnemy({ x: 193, y: 18, hp: 10, id: 1 }), makeEnemy({ x: 48, y: 18, hp: 10, id: 2 })];
      tower.targeting = "last";
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
      expect(target?.id).toBe(2);
    });

    it('picks the enemy nearest the base for "first" targeting when positions are unambiguous', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      const enemies = [
        makeEnemy({ x: 2 * 36 + 18 - 1, y: 18, hp: 10, id: 1 }),
        makeEnemy({ x: 10 * 36 + 18 - 200, y: 18, hp: 10, id: 2 }),
      ];
      const target = tower.selectTarget(enemies);
      expect(target).not.toBeNull();
      expect(target?.id).toBe(2);
    });

    it('uses nav distance-to-base for "first" when it disagrees with Euclidean', () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.navDistanceToBase = (tileX: number, _tileY: number) => (tileX >= 3 ? 1 : 20);
      const enemies = [makeEnemy({ x: 18, y: 18, hp: 10, id: 1 }), makeEnemy({ x: 18 + 4 * 36, y: 18, hp: 10, id: 2 })];
      const target = tower.selectTarget(enemies);
      expect(target?.id).toBe(2);
    });
  });

  describe("currentMilestoneBonus", () => {
    it("returns zero bonus when addon is not active", () => {
      const save = makeSave();
      save.generalAddons.damageMilestoneBonus = null;
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      const bonus = tower.currentMilestoneBonus();
      expect(bonus.damagePct).toBe(0);
      expect(bonus.speedPct).toBe(0);
      expect(bonus.tiers).toBe(0);
    });

    it("returns correct tiers based on totalDamageDealt", () => {
      const save = makeSave();
      save.generalAddons.damageMilestoneBonus = 0;
      const tower = new Tower("basic", 0, 0, save, makeMockGrid());
      tower.totalDamageDealt = MILESTONE_THRESHOLD * 3;
      const bonus = tower.currentMilestoneBonus();
      expect(bonus.tiers).toBe(3);
    });
  });

  describe("new towers (Phase 5)", () => {
    it("sturdyWall has high health and no damage/range/fireRate", () => {
      const tower = new Tower("sturdyWall", 0, 0, makeSave(), makeMockGrid());
      expect(tower.maxHealth).toBe(TOWER_BASE.sturdyWall.health);
      expect(tower.stats.damage).toBe(0);
      expect(tower.stats.range).toBe(0);
      expect(tower.stats.fireRate).toBe(0);
      expect(TOWER_META.sturdyWall.cost).toBe(20);
    });

    it("shotgunTank has expected base stats and cost", () => {
      const tower = new Tower("shotgunTank", 0, 0, makeSave(), makeMockGrid());
      expect(tower.maxHealth).toBe(TOWER_BASE.shotgunTank.health);
      expect(tower.stats.damage).toBe(TOWER_BASE.shotgunTank.damage);
      expect(tower.stats.range).toBe(TOWER_BASE.shotgunTank.range);
      expect(TOWER_META.shotgunTank.cost).toBe(35);
    });

    it("sturdyWall A (Thorn Wall) sets thornReflectPct per tier", () => {
      const tower = new Tower("sturdyWall", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      tower.variant = "A";
      expect(tower.stats.thornReflectPct).toBeCloseTo(0.3, 4);
      const tier2 = new Tower("sturdyWall", 0, 0, makeSave(), makeMockGrid());
      tier2.level = 6;
      tier2.variant = "A";
      expect(tier2.stats.thornReflectPct).toBeCloseTo(0.6, 4);
      const tier3 = new Tower("sturdyWall", 0, 0, makeSave(), makeMockGrid());
      tier3.level = 7;
      tier3.variant = "A";
      expect(tier3.stats.thornReflectPct).toBeCloseTo(1.0, 4);
    });

    it("sturdyWall A reflects damage taken back at the attacker", () => {
      const tower = new Tower("sturdyWall", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      tower.variant = "A";
      const enemy = {
        hp: 100,
        takeDamage(d: number) {
          enemy.hp -= d;
        },
      };
      tower.takeDamage(10, enemy);
      // attacker takes 10 * 0.3 = 3 reflected damage
      expect(enemy.hp).toBe(97);
    });

    it("sturdyWall B (Electric Fence) sets fence damage and stun", () => {
      const tower = new Tower("sturdyWall", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      tower.variant = "B";
      expect(tower.stats.fenceDamage).toBeGreaterThan(0);
      expect(tower.stats.fenceStun).toBeGreaterThan(0);
    });

    it("shotgunTank A (Reinforced) increases max health", () => {
      const base = new Tower("shotgunTank", 0, 0, makeSave(), makeMockGrid());
      expect(base.maxHealth).toBe(TOWER_BASE.shotgunTank.health);
      const reinforced = new Tower("shotgunTank", 0, 0, makeSave(), makeMockGrid());
      reinforced.level = 4;
      const specialized = reinforced.specialize("A", makeSave());
      expect(specialized).toBe(true);
      expect(reinforced.maxHealth).toBeGreaterThan(base.maxHealth);
      expect(reinforced.stats.healthMult).toBeCloseTo(1.5, 4);
    });

    it("shotgunTank B (Repulsor) sets knockback stats", () => {
      const tower = new Tower("shotgunTank", 0, 0, makeSave(), makeMockGrid());
      tower.level = 5;
      tower.variant = "B";
      expect(tower.stats.knockbackBase).toBeGreaterThan(0);
      expect(tower.stats.knockbackScale).toBeGreaterThan(0);
    });
  });

  describe("ghost state (Phases 1 & 5)", () => {
    it("cannot upgrade or sell while ghosted", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.isGhost = true;
      const upgradeResult = tower.canUpgrade(makeSave());
      expect(upgradeResult.ok).toBe(false);
      expect(upgradeResult.reason).toContain("Ghosted");
      expect(tower.sellValue()).toBe(0);
    });

    it("restore resets health and clears ghost flag", () => {
      const map = makeBastionMap();
      const grid = { tileSize: 36, tiles: map.tiles, clearTowerGhost() {} };
      const tower = new Tower("basic", 0, 0, makeSave(), grid);
      tower.health = 1;
      tower.isGhost = true;
      tower.ghostTimer = 100;
      tower.restore();
      expect(tower.isGhost).toBe(false);
      expect(tower.health).toBe(tower.maxHealth);
      expect(tower.ghostTimer).toBe(0);
    });

    it("takeDamage below zero triggers ghost state and pending effect", () => {
      const tower = new Tower("basic", 0, 0, makeSave(), makeMockGrid());
      tower.health = 5;
      tower.takeDamage(10);
      expect(tower.isGhost).toBe(true);
      expect(tower.pendingGhostEffect).toBe(true);
    });
  });
});
