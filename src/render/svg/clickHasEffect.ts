import type { TowerId } from "@/content/towerIds.js";
import { baseSelectionId } from "@/sim/towers/BaseDefense.js";

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

export type RightClickAction = "cancelBuild" | "deselect" | null;

// Maximum pointer travel, in screen pixels, that still counts as a right click.
// Beyond this the press is a right-drag pan and must not exit build mode.
export const rightClickMaxDragPx = 5;

// Mirrors the Escape/X priority in Input.ts: build mode exits first (keeping any
// tower selection), otherwise an open tower or base selection deselects.
export function decideRightClickAction(buildModeActive: boolean, hasSelection: boolean): RightClickAction {
  if (buildModeActive) return "cancelBuild";
  if (hasSelection) return "deselect";
  return null;
}

export function rightPressIsClick(
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number,
  maxDragPixels: number = rightClickMaxDragPx,
): boolean {
  const deltaX = endClientX - startClientX;
  const deltaY = endClientY - startClientY;
  return deltaX * deltaX + deltaY * deltaY <= maxDragPixels * maxDragPixels;
}

// While build mode is active the base selection is bound to the hover tile: the
// hover has left the base tile (or is off the grid) and the worker-confirmed
// base selection is stale. Inputs are the snapshot's meta values, not the local
// mirror, so a selection command in flight can never be clobbered by a late
// hover write.
export function baseSelectionStale(
  selectedTowerId: string | null,
  selectedTowerType: string | null,
  hoverTile: { tileX: number; tileY: number } | null,
  baseTile: { x: number; y: number } | null,
): boolean {
  if (selectedTowerId !== baseSelectionId) return false;
  if (selectedTowerType === null) return false;
  if (!baseTile) return false;
  return hoverTile === null || hoverTile.tileX !== baseTile.x || hoverTile.tileY !== baseTile.y;
}
