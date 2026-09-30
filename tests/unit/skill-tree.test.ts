// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { GENERAL_ADDON_GEM_COSTS, SELL_OPTION_GEM_COST } from "@/sim/Constants.js";
import {
  canRefund,
  canRefundGeneral,
  countRefundableGems,
  GENERAL_ADDON_DEFS,
  getGeneralAddonValue,
  isAvailable,
  isGeneralAvailable,
  isGeneralUnlocked,
  isUnlocked,
  maxLevelFor,
  refundAllGems,
  tryRefund,
  tryRefundGeneral,
  tryUnlock,
  tryUnlockGeneral,
  unlockCost,
} from "@/sim/towers/SkillTree.js";

type TowerId = "basic" | "ice" | "sniper" | "cannon" | "lightning" | "railgun";

interface UnlockedState {
  levels: boolean[];
  variantA: boolean[];
  variantB: boolean[];
  addons: boolean[];
}

interface SaveFixture {
  gems: number;
  unlocked: Record<TowerId, UnlockedState>;
  generalAddons: Record<string, unknown>;
}

// Read the live costs from content so the assertions track balance tuning.
const LEVEL_COSTS = getGameContent().skillTree.levelCosts;
const ADDON_COSTS = getGameContent().skillTree.addonCosts;

function freshSave(): SaveFixture {
  return {
    gems: 1000,
    unlocked: {
      basic: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
      ice: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
      sniper: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
      cannon: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
      lightning: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
      railgun: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
      sturdyWall: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
      shotgunTank: {
        levels: [true, true, false, false, false, false, false],
        variantA: [false, false, false],
        variantB: [false, false, false],
        addons: [false, false, false],
      },
    },
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

describe("SkillTree — Tower Unlocks", () => {
  describe("isUnlocked", () => {
    it("returns true for always-unlocked levels 1 and 2", () => {
      const save = freshSave();
      expect(isUnlocked(save, "basic", "level", 0)).toBe(true);
      expect(isUnlocked(save, "basic", "level", 1)).toBe(true);
    });

    it("returns false for locked levels", () => {
      const save = freshSave();
      expect(isUnlocked(save, "basic", "level", 2)).toBe(false);
      expect(isUnlocked(save, "basic", "level", 3)).toBe(false);
    });

    it("returns false for locked variants", () => {
      const save = freshSave();
      expect(isUnlocked(save, "basic", "variantA", 0)).toBe(false);
      expect(isUnlocked(save, "basic", "variantB", 0)).toBe(false);
    });

    it("returns false for locked addons", () => {
      const save = freshSave();
      expect(isUnlocked(save, "basic", "addons", 0)).toBe(false);
    });

    it("returns true after unlocking", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      expect(isUnlocked(save, "basic", "level", 2)).toBe(true);
    });
  });

  describe("unlockCost", () => {
    it("returns LEVEL_COSTS for level tier", () => {
      expect(unlockCost("level", 2)).toBe(LEVEL_COSTS[2]);
      expect(unlockCost("level", 3)).toBe(LEVEL_COSTS[3]);
    });

    it("returns LEVEL_COSTS shifted by 4 for variant tiers", () => {
      expect(unlockCost("variantA", 0)).toBe(LEVEL_COSTS[4]);
      expect(unlockCost("variantA", 1)).toBe(LEVEL_COSTS[5]);
      expect(unlockCost("variantA", 2)).toBe(LEVEL_COSTS[6]);
    });

    it("returns ADDON_COSTS for addon tier", () => {
      expect(unlockCost("addons", 0)).toBe(ADDON_COSTS[0]);
      expect(unlockCost("addons", 1)).toBe(ADDON_COSTS[1]);
      expect(unlockCost("addons", 2)).toBe(ADDON_COSTS[2]);
    });
  });

  describe("tryUnlock", () => {
    it("unlocks level 3 and deducts gems", () => {
      const save = freshSave();
      const cost = LEVEL_COSTS[2];
      const result = tryUnlock(save, "basic", "level", 2);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - cost);
      expect(isUnlocked(save, "basic", "level", 2)).toBe(true);
    });

    it("unlocks level 4 and deducts gems", () => {
      const save = freshSave();
      const cost = LEVEL_COSTS[3];
      // Unlock level 3 first
      tryUnlock(save, "basic", "level", 2);
      const result = tryUnlock(save, "basic", "level", 3);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - LEVEL_COSTS[2] - cost);
    });

    it("fails when already unlocked", () => {
      const save = freshSave();
      const result = tryUnlock(save, "basic", "level", 0);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("Already unlocked");
    });

    it("fails when not enough gems", () => {
      const save = freshSave();
      save.gems = 0;
      const result = tryUnlock(save, "basic", "level", 2);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("Not enough gems");
    });

    it("fails to unlock level 4 without level 3", () => {
      const save = freshSave();
      const result = tryUnlock(save, "basic", "level", 3);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("Unlock previous level first");
    });

    it("fails to unlock variant without level 4", () => {
      const save = freshSave();
      // Unlock only level 3 (idx 2), NOT level 4 (idx 3)
      tryUnlock(save, "basic", "level", 2);
      // Now try variant without level 4
      const result = tryUnlock(save, "basic", "variantA", 0);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("Unlock level 4 first");
    });

    it("fails to unlock variant tier 2 without tier 1", () => {
      const save = freshSave();
      // Unlock levels 1-4 but NOT variant A tier 1
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      // Try variant A tier 2 without tier 1
      const result = tryUnlock(save, "basic", "variantA", 1);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("Unlock previous tier first");
    });

    it("unlocks variant after level 4", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      const result = tryUnlock(save, "basic", "variantA", 0);
      expect(result.ok).toBe(true);
      expect(isUnlocked(save, "basic", "variantA", 0)).toBe(true);
    });

    it("unlocks addons independently of levels", () => {
      const save = freshSave();
      const result = tryUnlock(save, "basic", "addons", 0);
      expect(result.ok).toBe(true);
      expect(isUnlocked(save, "basic", "addons", 0)).toBe(true);
    });

    it("unlocks all 8 tower types", () => {
      const save = freshSave();
      for (const towerId of ["basic", "ice", "sniper", "cannon", "lightning", "railgun", "sturdyWall", "shotgunTank"]) {
        tryUnlock(save, towerId, "level", 2);
        expect(isUnlocked(save, towerId, "level", 2)).toBe(true);
      }
    });
  });

  describe("canRefund", () => {
    it("returns 0 for non-unlocked nodes", () => {
      const save = freshSave();
      expect(canRefund(save, "basic", "level", 2)).toBe(0);
    });

    it("returns cost for unlocked level 3 when level 4 is not unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      const refund = canRefund(save, "basic", "level", 2);
      expect(refund).toBe(LEVEL_COSTS[2]);
    });

    it("returns 0 for level 3 when level 4 is unlocked (dependent)", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      expect(canRefund(save, "basic", "level", 2)).toBe(0);
    });

    it("returns 0 for variant tier 1 when tier 2 is unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      tryUnlock(save, "basic", "variantA", 0);
      tryUnlock(save, "basic", "variantA", 1);
      expect(canRefund(save, "basic", "variantA", 0)).toBe(0);
    });

    it("returns cost for addon tier 1 when tier 2 is not unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "addons", 0);
      expect(canRefund(save, "basic", "addons", 0)).toBe(ADDON_COSTS[0]);
    });

    it("returns 0 for addon tier 1 when tier 2 is unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "addons", 0);
      tryUnlock(save, "basic", "addons", 1);
      expect(canRefund(save, "basic", "addons", 0)).toBe(0);
    });
  });

  describe("tryRefund", () => {
    it("refunds gems and locks the node", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      const result = tryRefund(save, "basic", "level", 2);
      expect(result.ok).toBe(true);
      expect(result.gems).toBe(LEVEL_COSTS[2]);
      expect(isUnlocked(save, "basic", "level", 2)).toBe(false);
    });

    it("fails when cannot refund (dependent unlocked)", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      const result = tryRefund(save, "basic", "level", 2);
      expect(result.ok).toBe(false);
    });

    it("fails for non-unlocked nodes", () => {
      const save = freshSave();
      const result = tryRefund(save, "basic", "level", 2);
      expect(result.ok).toBe(false);
    });
  });

  describe("maxLevelFor", () => {
    it("returns 2 when no levels unlocked beyond base", () => {
      const save = freshSave();
      expect(maxLevelFor(save, "basic", null)).toBe(2);
    });

    it("returns 3 when level 3 unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      expect(maxLevelFor(save, "basic", null)).toBe(3);
    });

    it("returns 4 when level 4 unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      expect(maxLevelFor(save, "basic", null)).toBe(4);
    });

    it("returns 5 when variant A tier 1 unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      tryUnlock(save, "basic", "variantA", 0);
      expect(maxLevelFor(save, "basic", "A")).toBe(5);
    });

    it("returns 7 when all variant tiers unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      tryUnlock(save, "basic", "variantA", 0);
      tryUnlock(save, "basic", "variantA", 1);
      tryUnlock(save, "basic", "variantA", 2);
      expect(maxLevelFor(save, "basic", "A")).toBe(7);
    });

    it("returns 4 when variant chosen but no variant tiers unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      expect(maxLevelFor(save, "basic", "A")).toBe(4);
    });
  });

  describe("isAvailable", () => {
    it("returns true for always-unlocked nodes", () => {
      const save = freshSave();
      expect(isAvailable(save, "basic", "level", 0, 0)).toBe(true);
      expect(isAvailable(save, "basic", "level", 1, 0)).toBe(true);
    });

    it("returns true when can afford and prerequisites met", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      expect(isAvailable(save, "basic", "level", 2, LEVEL_COSTS[2])).toBe(true);
    });

    it("returns false when cannot afford", () => {
      const save = freshSave();
      save.gems = 0;
      expect(isAvailable(save, "basic", "level", 2, LEVEL_COSTS[2])).toBe(false);
    });

    it("returns false when prerequisite not met", () => {
      const save = freshSave();
      expect(isAvailable(save, "basic", "level", 3, LEVEL_COSTS[3])).toBe(false);
    });
  });
});

describe("SkillTree — General Add-ons", () => {
  describe("isGeneralUnlocked", () => {
    it("returns false for null tier", () => {
      const save = freshSave();
      expect(isGeneralUnlocked(save, "extraHealth", 0)).toBe(false);
    });

    it("returns true after unlocking tier", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "extraHealth", 0);
      expect(isGeneralUnlocked(save, "extraHealth", 0)).toBe(true);
    });

    it("returns false for sellOption when neither active", () => {
      const save = freshSave();
      expect(isGeneralUnlocked(save, "sellOption", 0)).toBe(false);
      expect(isGeneralUnlocked(save, "sellOption", 1)).toBe(false);
    });

    it("returns true for sellOption refund after purchase", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      expect(isGeneralUnlocked(save, "sellOption", 0)).toBe(true);
    });
  });

  describe("isGeneralAvailable", () => {
    it("returns true for first tier when can afford", () => {
      const save = freshSave();
      expect(isGeneralAvailable(save, "extraHealth", 0)).toBe(true);
    });

    it("returns false for tier 2 when tier 1 not unlocked", () => {
      const save = freshSave();
      expect(isGeneralAvailable(save, "extraHealth", 1)).toBe(false);
    });

    it("returns true for tier 2 when tier 1 unlocked", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "extraHealth", 0);
      expect(isGeneralAvailable(save, "extraHealth", 1)).toBe(true);
    });

    it("returns true for sellOption switching after one purchased", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      // Now discount should be available for switching
      expect(isGeneralAvailable(save, "sellOption", 1)).toBe(true);
    });
  });

  describe("tryUnlockGeneral", () => {
    it("unlocks extraHealth tier 0 and deducts gems", () => {
      const save = freshSave();
      const cost = GENERAL_ADDON_GEM_COSTS.extraHealth[0];
      const result = tryUnlockGeneral(save, "extraHealth", 0);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - cost);
      expect(getGeneralAddonValue(save, "extraHealth")).toBe(0);
    });

    it("unlocks extraHealth tier 1 after tier 0", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "extraHealth", 0);
      const cost = GENERAL_ADDON_GEM_COSTS.extraHealth[1];
      const result = tryUnlockGeneral(save, "extraHealth", 1);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - GENERAL_ADDON_GEM_COSTS.extraHealth[0] - cost);
      expect(getGeneralAddonValue(save, "extraHealth")).toBe(1);
    });

    it("fails when not enough gems", () => {
      const save = freshSave();
      save.gems = 0;
      const result = tryUnlockGeneral(save, "extraHealth", 0);
      expect(result.ok).toBe(false);
    });

    it("fails when already unlocked", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "extraHealth", 0);
      const result = tryUnlockGeneral(save, "extraHealth", 0);
      expect(result.ok).toBe(false);
    });

    it("handles sellOption refund purchase", () => {
      const save = freshSave();
      const cost = SELL_OPTION_GEM_COST;
      const result = tryUnlockGeneral(save, "sellOption", 0);
      expect(result.ok).toBe(true);
      expect(save.generalAddons.sellRefundUnlocked).toBe(true);
      expect(save.generalAddons.sellActive).toBe("refund");
      expect(save.gems).toBe(1000 - cost);
    });

    it("handles sellOption discount switching (free after both unlocked)", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      const gemsAfterRefund = save.gems;
      const result = tryUnlockGeneral(save, "sellOption", 1);
      expect(result.ok).toBe(true);
      expect(save.generalAddons.sellActive).toBe("discount");
      expect(save.generalAddons.sellDiscountUnlocked).toBe(true);
      expect(save.generalAddons.sellRefundUnlocked).toBe(true);
      expect(save.gems).toBe(gemsAfterRefund - SELL_OPTION_GEM_COST);
      // Switching back to refund is free once unlocked; both flags stay true
      const gemsBeforeSwitch = save.gems;
      const backResult = tryUnlockGeneral(save, "sellOption", 0);
      expect(backResult.ok).toBe(true);
      expect(save.generalAddons.sellActive).toBe("refund");
      expect(save.generalAddons.sellRefundUnlocked).toBe(true);
      expect(save.generalAddons.sellDiscountUnlocked).toBe(true);
      expect(save.gems).toBe(gemsBeforeSwitch);
    });

    it("unlocks all general addon categories", () => {
      const categories = [
        "extraHealth",
        "startingGold",
        "slowHealing",
        "upgradeCostReduction",
        "terrainHeightBonus",
        "damageMilestoneBonus",
      ];
      for (const key of categories) {
        const save = freshSave();
        const result = tryUnlockGeneral(save, key, 0);
        expect(result.ok, `${key} tier 0 should unlock`).toBe(true);
      }
    });
  });

  describe("getGeneralAddonValue", () => {
    it("returns null when not unlocked", () => {
      const save = freshSave();
      expect(getGeneralAddonValue(save, "extraHealth")).toBeNull();
    });

    it("returns tier index when unlocked", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "extraHealth", 0);
      tryUnlockGeneral(save, "extraHealth", 1);
      expect(getGeneralAddonValue(save, "extraHealth")).toBe(1);
    });

    it("blocks unlocking a higher tier before the previous one", () => {
      const save = freshSave();
      const result = tryUnlockGeneral(save, "extraHealth", 1);
      expect(result.ok).toBe(false);
      expect(getGeneralAddonValue(save, "extraHealth")).toBeNull();
    });

    it("returns sellActive for sellOption", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      expect(getGeneralAddonValue(save, "sellOption")).toBe("refund");
    });
  });

  describe("general addon labels", () => {
    it("extraHealth tier labels are +100/+300/+500", () => {
      const tiers = GENERAL_ADDON_DEFS.extraHealth.tiers;
      expect(tiers.map((tier) => tier.label)).toEqual(["+100", "+300", "+500"]);
      expect(GENERAL_ADDON_DEFS.extraHealth.costs).toBe(GENERAL_ADDON_GEM_COSTS.extraHealth);
    });

    it("slowHealing tier labels are +20/round/+50/round/+100/round", () => {
      const tiers = GENERAL_ADDON_DEFS.slowHealing.tiers;
      expect(tiers.map((tier) => tier.label)).toEqual(["+20/round", "+50/round", "+100/round"]);
      expect(GENERAL_ADDON_DEFS.slowHealing.costs).toBe(GENERAL_ADDON_GEM_COSTS.slowHealing);
    });
  });

  describe("countRefundableGems / refundAllGems", () => {
    it("counts level costs even when a variant is unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      tryUnlock(save, "basic", "variantA", 0);
      const expected = LEVEL_COSTS[2] + LEVEL_COSTS[3] + LEVEL_COSTS[4];
      expect(countRefundableGems(save)).toBe(expected);
    });

    it("counts and refunds purchased sell options", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      tryUnlockGeneral(save, "sellOption", 1);
      const gemsBefore = save.gems;
      expect(countRefundableGems(save)).toBe(SELL_OPTION_GEM_COST * 2);
      refundAllGems(save);
      expect(save.gems).toBe(gemsBefore + SELL_OPTION_GEM_COST * 2);
      expect(save.generalAddons.sellRefundUnlocked).toBe(false);
      expect(save.generalAddons.sellDiscountUnlocked).toBe(false);
      expect(save.generalAddons.sellActive).toBeNull();
    });
  });

  describe("individual sellOption refunds (bulk parity)", () => {
    it("canRefundGeneral reports the cost of each purchased sell mode", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      expect(canRefundGeneral(save, "sellOption", 0)).toBe(SELL_OPTION_GEM_COST);
      expect(canRefundGeneral(save, "sellOption", 1)).toBe(0);
      tryUnlockGeneral(save, "sellOption", 1);
      expect(canRefundGeneral(save, "sellOption", 1)).toBe(SELL_OPTION_GEM_COST);
    });

    it("refunds the active sell mode and clears sellActive", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      const gemsAfterPurchase = save.gems;
      const result = tryRefundGeneral(save, "sellOption", 0);
      expect(result.ok).toBe(true);
      expect(result.gems).toBe(SELL_OPTION_GEM_COST);
      expect(save.gems).toBe(gemsAfterPurchase + SELL_OPTION_GEM_COST);
      expect(save.generalAddons.sellRefundUnlocked).toBe(false);
      expect(save.generalAddons.sellActive).toBeNull();
    });

    it("refunds the inactive sell mode without clearing the active selection", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      tryUnlockGeneral(save, "sellOption", 1); // active switches to discount
      const gemsAfterPurchases = save.gems;
      const result = tryRefundGeneral(save, "sellOption", 0);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(gemsAfterPurchases + SELL_OPTION_GEM_COST);
      expect(save.generalAddons.sellRefundUnlocked).toBe(false);
      expect(save.generalAddons.sellDiscountUnlocked).toBe(true);
      expect(save.generalAddons.sellActive).toBe("discount");
    });

    it("fails to refund a sell mode that was never purchased", () => {
      const save = freshSave();
      const result = tryRefundGeneral(save, "sellOption", 0);
      expect(result.ok).toBe(false);
    });

    it("restores the same end state as the bulk refund for one flag", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      const singleRefundSave = freshSave();
      tryUnlockGeneral(singleRefundSave, "sellOption", 0);
      tryRefundGeneral(save, "sellOption", 0);
      refundAllGems(singleRefundSave);
      expect(save.gems).toBe(singleRefundSave.gems);
      expect(save.generalAddons.sellActive).toBeNull();
      expect(singleRefundSave.generalAddons.sellActive).toBeNull();
    });
  });
});
