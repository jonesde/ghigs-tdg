import { describe, expect, it } from "vitest";
import { applyVariantOps } from "@/content/applyVariantOps.js";
import { enemyLevelHpMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";
import { loadGameContent } from "@/content/loadGameContent.js";
import { GameContentSchema } from "@/content/schemas/gameContent.js";
import { MAP_LEVELS, TOTAL_MAPS } from "@/sim/Constants.js";
import { ENEMY_TYPES, ENEMY_WAVE_DAMAGE_MULT } from "@/sim/ConstantsEnemy.js";
import { TOWER_BASE, TOWER_LEVEL_DMG_MULT, TOWER_META, TOWER_VARIANTS, TowerIds } from "@/sim/ConstantsTower.js";

function blankStats() {
  return {
    range: 1,
    damage: 10,
    fireRate: 1,
    splash: 1,
    chain: 0,
    stun: 0,
    pierce: 0,
    pierceFalloff: 0.5,
    slowAmt: 0,
    slowDur: 0,
    marksman: false,
    napalm: false,
    stormcall: false,
    knockbackBase: 0,
    knockbackScale: 0,
    thornReflectPct: 0,
    fenceDamage: 0,
    fenceStun: 0,
    healthMult: 1,
    armorPiercing: false,
  };
}

describe("game content packs", () => {
  it("loads and validates all content packs", () => {
    const content = loadGameContent();
    expect(GameContentSchema.safeParse(content).success).toBe(true);
    expect(content.towers.ids).toContain("basic");
    expect(content.enemies.types.minion).toBeDefined();
    expect(content.maps.levels).toHaveLength(36);
    expect(content.economy.mapGemMultipliers).toHaveLength(36);
  });

  it("exposes facade constants matching pack data", () => {
    const content = getGameContent();
    expect(TOWER_BASE.basic).toEqual(content.towers.base.basic);
    expect(TOWER_META.basic?.cost).toBe(20);
    expect(ENEMY_TYPES.minion?.baseHp).toBe(8);
    expect(ENEMY_WAVE_DAMAGE_MULT).toBe(0.2);
    expect(TOWER_LEVEL_DMG_MULT).toBe(1.8);
    expect(MAP_LEVELS).toHaveLength(36);
    expect(TOTAL_MAPS).toBe(36);
    for (const id of Object.values(TowerIds)) {
      expect(TOWER_VARIANTS[id].A.name).toBeTruthy();
      expect(TOWER_VARIANTS[id].B.name).toBeTruthy();
    }
  });

  it("computes enemy level HP mult from pack coeffs", () => {
    expect(enemyLevelHpMult(1, getGameContent().enemies.levelHpMult)).toBe(1);
    expect(enemyLevelHpMult(2, getGameContent().enemies.levelHpMult)).toBeCloseTo(1.6);
    expect(enemyLevelHpMult(3, getGameContent().enemies.levelHpMult)).toBeCloseTo(2.2);
  });

  it("applies variant ops matching legacy formulas", () => {
    const basicA = applyVariantOps(blankStats(), TOWER_VARIANTS.basic.A.statOps, 0);
    expect(basicA.fireRate).toBeCloseTo(3);
    expect(basicA.damage).toBeCloseTo(6);

    const iceA0 = applyVariantOps(blankStats(), TOWER_VARIANTS.ice.A.statOps, 0);
    expect(iceA0.splash).toBeCloseTo(1);
    const iceA2 = applyVariantOps(blankStats(), TOWER_VARIANTS.ice.A.statOps, 2);
    expect(iceA2.splash).toBeCloseTo(1.5);

    const lightningA1 = applyVariantOps(
      { ...blankStats(), chain: 2, damage: 10 },
      TOWER_VARIANTS.lightning.A.statOps,
      1,
    );
    expect(lightningA1.chain).toBe(6);
    expect(lightningA1.damage).toBeCloseTo(14.4);

    const sniperA = applyVariantOps(blankStats(), TOWER_VARIANTS.sniper.A.statOps, 0);
    expect(sniperA.marksman).toBe(true);

    const wallB = applyVariantOps(blankStats(), TOWER_VARIANTS.sturdyWall.B.statOps, 1);
    expect(wallB.fenceDamage).toBe(10);
    expect(wallB.fenceStun).toBe(0.5);

    const shotgunA = applyVariantOps(blankStats(), TOWER_VARIANTS.shotgunTank.A.statOps, 2);
    expect(shotgunA.healthMult).toBe(3);

    const railB = applyVariantOps(blankStats(), TOWER_VARIANTS.railgun.B.statOps, 0);
    expect(railB.pierceFalloff).toBe(0);
  });
});
