// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { TowerIds } from "@/content/towerIds.js";
import { Tower } from "@/sim/towers/Tower.js";
import { computeTowerCoreStats, computeTowerMaxHealth } from "@/sim/towers/towerCoreStats.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

const towerBase = getGameContent().towers.base;
const levelDmgMult = getGameContent().towers.tuning.levelDmgMult;

function makeSave(addons = [false, false, false]) {
  const unlocked = {};
  for (const id of Object.keys(getGameContent().towers.meta)) {
    unlocked[id] = {
      levels: [true, true, true, true, true, true, true],
      variantA: [true, true, true],
      variantB: [true, true, true],
      addons: [...addons],
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
      terrainHeightRangeBonus: null,
      damageMilestoneBonus: null,
      progressiveThirdChoice: null,
    },
  };
}

function makeMockGrid() {
  const map = makeBastionMap();
  return {
    tileSize: 36,
    tiles: map.tiles,
    getBase: () => ({ x: map.base.x, y: map.base.y }),
    tileToWorld: (tileX, tileY) => ({ x: tileX * 36 + 18, y: tileY * 36 + 18 }),
    worldToTile: (worldX, worldY) => ({ x: Math.floor(worldX / 36), y: Math.floor(worldY / 36) }),
  };
}

const numberFields = [
  "range",
  "damage",
  "fireRate",
  "splash",
  "chain",
  "stun",
  "pierce",
  "pierceFalloff",
  "slowAmt",
  "slowDur",
  "knockbackBase",
  "knockbackScale",
  "thornReflectPct",
  "fenceDamage",
  "fenceStun",
];

const flagFields = ["marksman", "napalm", "stormcall", "armorPiercing", "groundOnly"];

beforeEach(() => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const themeStore = useMapThemeStore();
  themeStore.defaultTheme = mockDefaultTheme;
  themeStore.activeTheme = mockDefaultTheme;
});

describe("computeTowerCoreStats", () => {
  describe("parity with Tower.stats", () => {
    it("matches a live Tower for every type, level, and specialization", () => {
      for (const towerId of Object.values(TowerIds)) {
        for (let level = 1; level <= 7; level++) {
          const variants = level >= 5 ? [null, "A", "B"] : [null];
          for (const variant of variants) {
            const label = `${towerId} level ${level}${variant ? ` variant ${variant}` : ""}`;
            const tower = new Tower(towerId, 0, 0, makeSave(), makeMockGrid());
            tower.level = level;
            if (variant) tower.variant = variant;
            tower.recomputeMaxHealth();

            const core = computeTowerCoreStats(towerBase[towerId], towerId, level, variant);
            const towerStats = tower.stats;
            for (const field of numberFields) {
              expect(towerStats[field], `${label}.${field}`).toBeCloseTo(core[field], 10);
            }
            for (const field of flagFields) {
              expect(towerStats[field], `${label}.${field}`).toBe(core[field]);
            }
            expect(towerStats.healthMult, `${label}.healthMult`).toBeCloseTo(core.healthMult, 10);

            const expectedHealth = computeTowerMaxHealth(towerBase[towerId], towerId, level, variant, core.healthMult);
            expect(tower.maxHealth, `${label}.maxHealth`).toBeCloseTo(expectedHealth, 8);
          }
        }
      }
    });

    it("keeps a clean Tower at pure core stats (no add-on or bonus layer)", () => {
      const tower = new Tower("cannon", 0, 0, makeSave(), makeMockGrid());
      tower.level = 6;
      tower.variant = "B";
      const core = computeTowerCoreStats(towerBase.cannon, "cannon", 6, "B");
      expect(tower.stats.damage).toBe(core.damage);
      expect(tower.stats.range).toBe(core.range);
      expect(tower.stats.splash).toBe(core.splash);
    });
  });

  describe("closed-form progression", () => {
    it("scales basic damage, fire rate, and range by the level multipliers", () => {
      for (let level = 1; level <= 7; level++) {
        const core = computeTowerCoreStats(towerBase.basic, "basic", level, null);
        expect(core.damage).toBeCloseTo(towerBase.basic.damage * levelDmgMult ** (level - 1), 10);
        const levelRateMult = getGameContent().towers.tuning.levelRateMult;
        expect(core.fireRate).toBeCloseTo(towerBase.basic.fireRate * levelRateMult ** (level - 1), 10);
        expect(core.range).toBeCloseTo(
          towerBase.basic.range * getGameContent().towers.tuning.levelRangeMult ** (level - 1),
          10,
        );
      }
    });

    it("applies the Rapid specialization ops at level 5 and above only", () => {
      const baseDamage = towerBase.basic.damage;
      const level4 = computeTowerCoreStats(towerBase.basic, "basic", 4, "A");
      expect(level4.damage).toBeCloseTo(baseDamage * levelDmgMult ** 3, 10);
      const level5 = computeTowerCoreStats(towerBase.basic, "basic", 5, "A");
      expect(level5.damage).toBeCloseTo(baseDamage * levelDmgMult ** 4 * 0.6, 10);
      expect(level5.fireRate).toBeCloseTo(
        towerBase.basic.fireRate * getGameContent().towers.tuning.levelRateMult ** 4 * 2,
        10,
      );
      const level7 = computeTowerCoreStats(towerBase.basic, "basic", 7, "A");
      expect(level7.damage).toBeCloseTo(baseDamage * levelDmgMult ** 6 * 0.6, 10);
    });

    it("grows max health by the health multiplier independently of damage", () => {
      for (let level = 1; level <= 7; level++) {
        expect(computeTowerMaxHealth(towerBase.ice, "ice", level, null, 1)).toBeCloseTo(
          towerBase.ice.health * getGameContent().towers.tuning.levelHealthMult ** (level - 1),
          10,
        );
      }
    });

    it("carries the variant health multiplier for Reinforced shotgun tanks", () => {
      const level7 = computeTowerCoreStats(towerBase.shotgunTank, "shotgunTank", 7, "A");
      expect(level7.healthMult).toBeGreaterThan(1);
      const health = computeTowerMaxHealth(towerBase.shotgunTank, "shotgunTank", 7, "A", level7.healthMult);
      const healthGrowth = getGameContent().towers.tuning.levelHealthMult ** 6;
      expect(health).toBeCloseTo(towerBase.shotgunTank.health * healthGrowth * level7.healthMult, 8);
    });
  });
});
