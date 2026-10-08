import { getGameContent } from "@/content/gameContent.js";

// Gold returned for a spent amount. sellActive is generalAddons.sellActive.
// The snapshot and the worker payout both call this.
export function cashOutAmount(paid: number, sellActive: string | null | undefined): number {
  if (sellActive === "refund") return paid;
  if (sellActive === "discount") return 0;
  return Math.round(paid * getGameContent().towers.tuning.sellValueRatio);
}

// Payable gold for a tower or base upgrade. Tier is generalAddons.upgradeCostReduction
// (null until Cheaper Upgrades is bought). The snapshot and the charge both call this
// so the button shows the amount the worker deducts.
export function applyUpgradeCostReduction(rawCost: number, tier: number | null | undefined): number {
  if (tier === null || tier === undefined) return rawCost;
  const reduction = getGameContent().economy.upgradeCostReductionPct[tier] || 0;
  return Math.floor(rawCost * (1 - reduction));
}
