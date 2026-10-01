import { describe, expect, it } from "vitest";
import { applyVariantOps } from "@/content/applyVariantOps.js";
import { enemyBounty, enemyLevelHpMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";
import { loadGameContent } from "@/content/loadGameContent.js";
import { GameContentSchema } from "@/content/schemas/gameContent.js";
import { TOWER_VARIANTS, targetsLabel, towerGroundOnly } from "@/sim/ConstantsTower.js";

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

  it("deep-freezes nested content so runtime mutation cannot corrupt packs", () => {
    const content = loadGameContent();
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.towers)).toBe(true);
    expect(Object.isFrozen(content.towers.tuning)).toBe(true);
    expect(Object.isFrozen(content.towers.ids)).toBe(true);
    expect(Object.isFrozen(content.enemies.types.boss)).toBe(true);
    expect(Object.isFrozen(content.maps.levels)).toBe(true);
    expect(Object.isFrozen(content.maps.levels[0])).toBe(true);

    const originalDamageMult = content.towers.tuning.levelDmgMult;
    expect(() => {
      content.towers.tuning.levelDmgMult = 1;
    }).toThrow(TypeError);
    expect(() => {
      content.towers.ids.push("injected");
    }).toThrow(TypeError);
    expect(content.towers.tuning.levelDmgMult).toBe(originalDamageMult);
  });

  it("computes enemy level HP mult from pack coeffs", () => {
    expect(enemyLevelHpMult(1, getGameContent().enemies.levelHpMult)).toBe(1);
    expect(enemyLevelHpMult(2, getGameContent().enemies.levelHpMult)).toBeCloseTo(1.6);
    expect(enemyLevelHpMult(3, getGameContent().enemies.levelHpMult)).toBeCloseTo(2.2);
  });

  it("pays full bounty through wave 10 and a quarter of it after", () => {
    const growth = 0.5;
    const fullThrough = 10;
    const laterMult = 0.25;
    expect(enemyBounty(1, 7, 9, growth, fullThrough, laterMult)).toBe(4);
    expect(enemyBounty(50, 4, 10, growth, fullThrough, laterMult)).toBe(125);
    expect(enemyBounty(1, 7, 19, growth, fullThrough, laterMult)).toBe(1);
    expect(enemyBounty(4, 7, 19, growth, fullThrough, laterMult)).toBe(4);
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

  it("keeps groundOnly on the base entries through the Zod parse", () => {
    const content = getGameContent();
    expect(content.towers.base.cannon?.groundOnly).toBe(true);
    expect(content.towers.base.railgun?.groundOnly).toBe(true);
    expect(content.towers.base.shotgunTank?.groundOnly).toBe(true);
    expect(content.towers.base.sturdyWall?.groundOnly).toBe(true);
    expect(content.towers.base.basic?.groundOnly).toBeUndefined();
  });

  it("reads ground-only capability per tower and lifts it with the cannon Anti-Air addon", () => {
    expect(towerGroundOnly("cannon")).toBe(true);
    expect(towerGroundOnly("railgun")).toBe(true);
    expect(towerGroundOnly("shotgunTank")).toBe(true);
    expect(towerGroundOnly("sturdyWall")).toBe(true);
    expect(towerGroundOnly("basic")).toBe(false);
    expect(towerGroundOnly("ice")).toBe(false);
    expect(towerGroundOnly("sniper")).toBe(false);
    expect(towerGroundOnly("lightning")).toBe(false);
    expect(towerGroundOnly("cannon", [false, false, true])).toBe(false);
    expect(towerGroundOnly("cannon", [false, false, false])).toBe(true);
  });

  it("labels the two targeting states", () => {
    expect(targetsLabel(true)).toBe("Ground only");
    expect(targetsLabel(false)).toBe("Air & Ground");
  });
});
