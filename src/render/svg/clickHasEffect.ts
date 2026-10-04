import type { TowerId } from "@/sim/ConstantsTower.js";

export interface ClickEffectInput {
  progressivePlacementHold: boolean;
  placementSiteHit: boolean;
  upgradeButtonHit: boolean;
  inBounds: boolean;
  towerOnTile: boolean;
  baseTile: boolean;
  selectedTowerType: TowerId | null;
  buildable: boolean;
  gold: number;
  buildCost: number;
  // A supply drop or map cache under the cursor. Optional so older call sites compile.
  packageHit?: boolean;
}

// Mirrors GameEngine.handleClick so a main-thread press can decide whether the
// click the worker would run changes run state. Keeping the two in sync is what
// makes an inert left-drag safe to turn into a pan.
export function clickHasEffect(input: ClickEffectInput): boolean {
  if (input.progressivePlacementHold) return true;
  if (input.placementSiteHit) return true;
  if (input.upgradeButtonHit) return true;
  if (input.packageHit) return true;
  if (!input.inBounds) return input.selectedTowerType !== null;
  if (input.towerOnTile || input.baseTile) return true;
  return input.selectedTowerType !== null && input.buildable && input.gold >= input.buildCost;
}
