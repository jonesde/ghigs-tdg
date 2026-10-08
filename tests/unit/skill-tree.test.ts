// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import {
  canRefund,
  canRefundBase,
  canRefundGeneral,
  countRefundableGems,
  generalAddonDefs,
  getGeneralAddonValue,
  isAvailable,
  isBaseAvailable,
  isBaseUnlocked,
  isGeneralAvailable,
  isGeneralUnlocked,
  isSellOptionPurchased,
  isUnlocked,
  maxLevelFor,
  maxLevelForBase,
  refundAllGems,
  tryRefund,
  tryRefundBase,
  tryRefundGeneral,
  tryUnlock,
  tryUnlockBase,
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
const levelCosts = getGameContent().skillTree.levelCosts;
const addonCosts = getGameContent().skillTree.addonCosts;
const generalAddonGemCosts = getGameContent().economy.generalAddonGemCosts;
const sellOptionGemCost = getGameContent().economy.sellOptionGemCost;

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
      sellActive: null,
      upgradeCostReduction: null,
      terrainHeightBonus: null,
      damageMilestoneBonus: null,
      enemyWoundDamageReduction: null,
      progressiveThirdChoice: null,
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
    it("returns levelCosts for level tier", () => {
      expect(unlockCost("level", 2)).toBe(levelCosts[2]);
      expect(unlockCost("level", 3)).toBe(levelCosts[3]);
    });

    it("returns levelCosts shifted by 4 for variant tiers", () => {
      expect(unlockCost("variantA", 0)).toBe(levelCosts[4]);
      expect(unlockCost("variantA", 1)).toBe(levelCosts[5]);
      expect(unlockCost("variantA", 2)).toBe(levelCosts[6]);
    });

    it("returns addonCosts for addon tier", () => {
      expect(unlockCost("addons", 0)).toBe(addonCosts[0]);
      expect(unlockCost("addons", 1)).toBe(addonCosts[1]);
      expect(unlockCost("addons", 2)).toBe(addonCosts[2]);
    });
  });

  describe("tryUnlock", () => {
    it("unlocks level 3 and deducts gems", () => {
      const save = freshSave();
      const cost = levelCosts[2];
      const result = tryUnlock(save, "basic", "level", 2);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - cost);
      expect(isUnlocked(save, "basic", "level", 2)).toBe(true);
    });

    it("unlocks level 4 and deducts gems", () => {
      const save = freshSave();
      const cost = levelCosts[3];
      // Unlock level 3 first
      tryUnlock(save, "basic", "level", 2);
      const result = tryUnlock(save, "basic", "level", 3);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - levelCosts[2] - cost);
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
      expect(refund).toBe(levelCosts[2]);
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
      expect(canRefund(save, "basic", "addons", 0)).toBe(addonCosts[0]);
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
      expect(result.gems).toBe(levelCosts[2]);
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
      expect(isAvailable(save, "basic", "level", 2, levelCosts[2])).toBe(true);
    });

    it("returns false when cannot afford", () => {
      const save = freshSave();
      save.gems = 0;
      expect(isAvailable(save, "basic", "level", 2, levelCosts[2])).toBe(false);
    });

    it("returns false when prerequisite not met", () => {
      const save = freshSave();
      expect(isAvailable(save, "basic", "level", 3, levelCosts[3])).toBe(false);
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

    it("returns false for sellOption when neither mode is in effect", () => {
      const save = freshSave();
      expect(isGeneralUnlocked(save, "sellOption", 0)).toBe(false);
      expect(isGeneralUnlocked(save, "sellOption", 1)).toBe(false);
    });

    it("returns true for both sellOption tiers once the single purchase is owned", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      expect(isGeneralUnlocked(save, "sellOption", 0)).toBe(true);
      expect(isGeneralUnlocked(save, "sellOption", 1)).toBe(true);
    });

    it("returns false for a sellOption tier index that names no mode", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      expect(isGeneralUnlocked(save, "sellOption", 2)).toBe(false);
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

    it("returns true for switching the sellOption once one mode is in effect", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      // Either mode stays available to switch to, owned or not.
      expect(isGeneralAvailable(save, "sellOption", 1)).toBe(true);
    });

    it("returns false for a sellOption tier index that names no mode", () => {
      const save = freshSave();
      expect(isGeneralAvailable(save, "sellOption", 2)).toBe(false);
    });
  });

  describe("tryUnlockGeneral", () => {
    it("unlocks extraHealth tier 0 and deducts gems", () => {
      const save = freshSave();
      const cost = generalAddonGemCosts.extraHealth[0];
      const result = tryUnlockGeneral(save, "extraHealth", 0);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - cost);
      expect(getGeneralAddonValue(save, "extraHealth")).toBe(0);
    });

    it("unlocks extraHealth tier 1 after tier 0", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "extraHealth", 0);
      const cost = generalAddonGemCosts.extraHealth[1];
      const result = tryUnlockGeneral(save, "extraHealth", 1);
      expect(result.ok).toBe(true);
      expect(save.gems).toBe(1000 - generalAddonGemCosts.extraHealth[0] - cost);
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

    it("buys the sell purchase for Full Refund and deducts gems", () => {
      const save = freshSave();
      const result = tryUnlockGeneral(save, "sellOption", 0);
      expect(result).toEqual({ ok: true, gems: sellOptionGemCost });
      expect(save.generalAddons.sellActive).toBe("refund");
      expect(save.gems).toBe(1000 - sellOptionGemCost);
    });

    it("buys the sell purchase for Discounted first, without needing the other mode", () => {
      const save = freshSave();
      const result = tryUnlockGeneral(save, "sellOption", 1);
      expect(result).toEqual({ ok: true, gems: sellOptionGemCost });
      expect(save.generalAddons.sellActive).toBe("discount");
      expect(save.gems).toBe(1000 - sellOptionGemCost);
    });

    it("refuses the buy when there are not enough gems", () => {
      const save = freshSave();
      save.gems = sellOptionGemCost - 1;
      expect(tryUnlockGeneral(save, "sellOption", 0).ok).toBe(false);
      expect(save.generalAddons.sellActive).toBeNull();
    });

    it("switches modes for free once the purchase is owned, in both directions", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      const gemsAfterPurchase = save.gems;

      const switchResult = tryUnlockGeneral(save, "sellOption", 1);
      expect(switchResult).toEqual({ ok: true, gems: 0 });
      expect(save.generalAddons.sellActive).toBe("discount");
      expect(save.gems).toBe(gemsAfterPurchase);

      const backResult = tryUnlockGeneral(save, "sellOption", 0);
      expect(backResult).toEqual({ ok: true, gems: 0 });
      expect(save.generalAddons.sellActive).toBe("refund");
      expect(save.gems).toBe(gemsAfterPurchase);
    });

    it("never leaves both modes owned: repeated switching charges exactly one purchase", () => {
      const save = freshSave();
      for (let index = 0; index < 6; index++) {
        tryUnlockGeneral(save, "sellOption", index % 2);
        expect(["refund", "discount"]).toContain(save.generalAddons.sellActive);
      }
      expect(save.gems).toBe(1000 - sellOptionGemCost);
    });

    it("refuses to switch to the mode already in effect", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 1);
      expect(tryUnlockGeneral(save, "sellOption", 1).ok).toBe(false);
    });

    it("unlocks all general addon categories", () => {
      const categories = [
        "extraHealth",
        "startingGold",
        "slowHealing",
        "upgradeCostReduction",
        "terrainHeightBonus",
        "damageMilestoneBonus",
        "enemyWoundDamageReduction",
        "progressiveThirdChoice",
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

    it("treats an unrecognized stored sellActive as no purchase", () => {
      const save = freshSave();
      save.generalAddons.sellActive = "nonsense";
      expect(getGeneralAddonValue(save, "sellOption")).toBeNull();
      expect(canRefundGeneral(save, "sellOption", 0)).toBe(0);
      expect(isSellOptionPurchased(save)).toBe(false);
    });
  });

  describe("general addon labels", () => {
    it("extraHealth tier labels are +100/+300/+500", () => {
      const tiers = generalAddonDefs.extraHealth.tiers;
      expect(tiers.map((tier) => tier.label)).toEqual(["+100", "+300", "+500"]);
      expect(generalAddonDefs.extraHealth.costs).toBe(generalAddonGemCosts.extraHealth);
    });

    it("slowHealing tier labels are +20/round/+50/round/+100/round", () => {
      const tiers = generalAddonDefs.slowHealing.tiers;
      expect(tiers.map((tier) => tier.label)).toEqual(["+20/round", "+50/round", "+100/round"]);
      expect(generalAddonDefs.slowHealing.costs).toBe(generalAddonGemCosts.slowHealing);
    });
  });

  describe("countRefundableGems / refundAllGems", () => {
    it("counts level costs even when a variant is unlocked", () => {
      const save = freshSave();
      tryUnlock(save, "basic", "level", 2);
      tryUnlock(save, "basic", "level", 3);
      tryUnlock(save, "basic", "variantA", 0);
      const expected = levelCosts[2] + levelCosts[3] + levelCosts[4];
      expect(countRefundableGems(save)).toBe(expected);
    });

    it("counts and refunds the single sell purchase once", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      tryUnlockGeneral(save, "sellOption", 1); // free switch, still one purchase
      const gemsBefore = save.gems;
      expect(countRefundableGems(save)).toBe(sellOptionGemCost);
      refundAllGems(save);
      expect(save.gems).toBe(gemsBefore + sellOptionGemCost);
      expect(save.generalAddons.sellActive).toBeNull();
    });
  });

  describe("sellOption refunds (one purchase, one position)", () => {
    it("reports the cost for the mode in effect only", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 1);
      expect(canRefundGeneral(save, "sellOption", 1)).toBe(sellOptionGemCost);
      expect(canRefundGeneral(save, "sellOption", 0)).toBe(0);
    });

    it("refunds the active mode and clears sellActive", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      const gemsAfterPurchase = save.gems;
      const result = tryRefundGeneral(save, "sellOption", 0);
      expect(result).toEqual({ ok: true, gems: sellOptionGemCost });
      expect(save.gems).toBe(gemsAfterPurchase + sellOptionGemCost);
      expect(save.generalAddons.sellActive).toBeNull();
    });

    it("cannot refund the mode that is not in effect, because it was never a separate purchase", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      tryUnlockGeneral(save, "sellOption", 1); // free switch to Discounted
      expect(canRefundGeneral(save, "sellOption", 0)).toBe(0);
      const result = tryRefundGeneral(save, "sellOption", 0);
      expect(result.ok).toBe(false);
      expect(save.generalAddons.sellActive).toBe("discount");
    });

    it("fails to refund a sell mode when the purchase was never made", () => {
      const save = freshSave();
      expect(canRefundGeneral(save, "sellOption", 0)).toBe(0);
      expect(tryRefundGeneral(save, "sellOption", 0).ok).toBe(false);
      expect(tryRefundGeneral(save, "sellOption", 1).ok).toBe(false);
    });

    it("refuses to refund a tier index that names no mode", () => {
      const save = freshSave();
      tryUnlockGeneral(save, "sellOption", 0);
      expect(canRefundGeneral(save, "sellOption", 2)).toBe(0);
      expect(tryRefundGeneral(save, "sellOption", 2).ok).toBe(false);
    });

    it("restores the same end state as the bulk refund", () => {
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

describe("SkillTree — Base levels", () => {
  it("treats a missing baseUnlocks field as the free short-range cap", () => {
    const save = freshSave();
    expect(isBaseUnlocked(save, 0)).toBe(true);
    expect(isBaseUnlocked(save, 1)).toBe(true);
    expect(isBaseUnlocked(save, 2)).toBe(false);
    expect(maxLevelForBase(save)).toBe(2);
    expect(canRefundBase(save, 0)).toBe(0);
    expect(canRefundBase(save, 1)).toBe(0);
  });

  it("unlocks in order and refuses level 4 before level 3", () => {
    const save = freshSave();
    expect(tryUnlockBase(save, 3).ok).toBe(false);
    expect(tryUnlockBase(save, 2).ok).toBe(true);
    expect(save.baseUnlocks.levels[2]).toBe(true);
    expect(isBaseAvailable(save, 3)).toBe(true);
    expect(tryUnlockBase(save, 3).ok).toBe(true);
  });

  it("does not refund a level while a higher one is owned, and refundAll returns the spend", () => {
    const save = freshSave();
    const gemsBefore = save.gems;
    tryUnlockBase(save, 2);
    tryUnlockBase(save, 3);
    expect(canRefundBase(save, 2)).toBe(0);
    expect(tryRefundBase(save, 2).ok).toBe(false);
    expect(tryRefundBase(save, 3).ok).toBe(true);
    expect(canRefundBase(save, 2)).toBe(16);
    const spent = gemsBefore - save.gems;
    refundAllGems(save);
    expect(save.gems).toBe(gemsBefore);
    expect(spent).toBe(16);
    expect(save.baseUnlocks.levels[2]).toBe(false);
  });
});
