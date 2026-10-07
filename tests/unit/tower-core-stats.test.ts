// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  TOWER_BASE,
  TOWER_LEVEL_DMG_MULT,
  TOWER_LEVEL_HEALTH_MULT,
  TOWER_LEVEL_RANGE_MULT,
  TOWER_LEVEL_RATE_MULT,
  TOWER_META,
  TowerIds,
} from "@/sim/ConstantsTower.js";
import { Tower } from "@/sim/towers/Tower.js";
import { computeTowerCoreStats, computeTowerMaxHealth } from "@/sim/towers/towerCoreStats.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

function makeSave(addons = [false, false, false]) {
  const unlocked = {};
  for (const id of Object.keys(TOWER_META)) {
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

const NUMBER_FIELDS = [
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

const FLAG_FIELDS = ["marksman", "napalm", "stormcall", "armorPiercing", "groundOnly"];

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

            const core = computeTowerCoreStats(TOWER_BASE[towerId], towerId, level, variant);
            const towerStats = tower.stats;
            for (const field of NUMBER_FIELDS) {
              expect(towerStats[field], `${label}.${field}`).toBeCloseTo(core[field], 10);
            }
            for (const field of FLAG_FIELDS) {
              expect(towerStats[field], `${label}.${field}`).toBe(core[field]);
            }
            expect(towerStats.healthMult, `${label}.healthMult`).toBeCloseTo(core.healthMult, 10);

            const expectedHealth = computeTowerMaxHealth(TOWER_BASE[towerId], towerId, level, variant, core.healthMult);
            expect(tower.maxHealth, `${label}.maxHealth`).toBeCloseTo(expectedHealth, 8);
          }
        }
      }
    });

    it("keeps a clean Tower at pure core stats (no add-on or bonus layer)", () => {
      const tower = new Tower("cannon", 0, 0, makeSave(), makeMockGrid());
      tower.level = 6;
      tower.variant = "B";
      const core = computeTowerCoreStats(TOWER_BASE.cannon, "cannon", 6, "B");
      expect(tower.stats.damage).toBe(core.damage);
      expect(tower.stats.range).toBe(core.range);
      expect(tower.stats.splash).toBe(core.splash);
    });
  });

  describe("closed-form progression", () => {
    it("scales basic damage, fire rate, and range by the level multipliers", () => {
      for (let level = 1; level <= 7; level++) {
        const core = computeTowerCoreStats(TOWER_BASE.basic, "basic", level, null);
        expect(core.damage).toBeCloseTo(TOWER_BASE.basic.damage * TOWER_LEVEL_DMG_MULT ** (level - 1), 10);
        expect(core.fireRate).toBeCloseTo(TOWER_BASE.basic.fireRate * TOWER_LEVEL_RATE_MULT ** (level - 1), 10);
        expect(core.range).toBeCloseTo(TOWER_BASE.basic.range * TOWER_LEVEL_RANGE_MULT ** (level - 1), 10);
      }
    });

    it("applies the Rapid specialization ops at level 5 and above only", () => {
      const baseDamage = TOWER_BASE.basic.damage;
      const level4 = computeTowerCoreStats(TOWER_BASE.basic, "basic", 4, "A");
      expect(level4.damage).toBeCloseTo(baseDamage * TOWER_LEVEL_DMG_MULT ** 3, 10);
      const level5 = computeTowerCoreStats(TOWER_BASE.basic, "basic", 5, "A");
      expect(level5.damage).toBeCloseTo(baseDamage * TOWER_LEVEL_DMG_MULT ** 4 * 0.6, 10);
      expect(level5.fireRate).toBeCloseTo(TOWER_BASE.basic.fireRate * TOWER_LEVEL_RATE_MULT ** 4 * 2, 10);
      const level7 = computeTowerCoreStats(TOWER_BASE.basic, "basic", 7, "A");
      expect(level7.damage).toBeCloseTo(baseDamage * TOWER_LEVEL_DMG_MULT ** 6 * 0.6, 10);
    });

    it("grows max health by the health multiplier independently of damage", () => {
      for (let level = 1; level <= 7; level++) {
        expect(computeTowerMaxHealth(TOWER_BASE.ice, "ice", level, null, 1)).toBeCloseTo(
          TOWER_BASE.ice.health * TOWER_LEVEL_HEALTH_MULT ** (level - 1),
          10,
        );
      }
    });

    it("carries the variant health multiplier for Reinforced shotgun tanks", () => {
      const level7 = computeTowerCoreStats(TOWER_BASE.shotgunTank, "shotgunTank", 7, "A");
      expect(level7.healthMult).toBeGreaterThan(1);
      const health = computeTowerMaxHealth(TOWER_BASE.shotgunTank, "shotgunTank", 7, "A", level7.healthMult);
      expect(health).toBeCloseTo(TOWER_BASE.shotgunTank.health * TOWER_LEVEL_HEALTH_MULT ** 6 * level7.healthMult, 8);
    });
  });
});
