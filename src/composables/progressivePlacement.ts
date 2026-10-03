import type { Command } from "@/sim/Command.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import {
  blockCoordinateForTile,
  placementLegal,
  progressiveConfigFromMap,
  replayProgressiveBoard,
} from "@/sim/grid/ProgressiveMap.js";
import type { GameStoreLike } from "@/stores/game.js";

type PlaceProgressiveBlockCommand = Omit<Extract<Command, { type: "action:placeProgressiveBlock" }>, "commandId">;

// Build type and the selected tower are worker-owned. A main-thread clear is
// overwritten by the next snapshot, and a later click still places whatever
// build type the worker kept.
export function clearBuildAndTowerForProgressive(gameStore: GameStoreLike): void {
  if (gameStore.selectedTowerType) {
    gameStore.selectBuildType(null);
    dispatchCommand({ commandId: 0, type: "action:cancelBuildMode" });
  }
  if (gameStore.selectedTower) {
    dispatchCommand({ commandId: 0, type: "action:selectTower", towerId: null });
  }
}

// Translates a world point into a placement command when it lands on a legal
// site for the selected offer at the current rotation, or null when there is no
// hold or the site is illegal. Shared by left-click placement and right-click
// rotation so both use one legality probe.
export function progressivePlacementCommand(
  gameStore: GameStoreLike,
  worldX: number,
  worldY: number,
): PlaceProgressiveBlockCommand | null {
  if (!gameStore.progressivePlacementHold || !gameStore.map || !gameStore.grid) return null;
  const config = progressiveConfigFromMap(gameStore.map);
  const templateIndex = gameStore.progressiveOffer?.[gameStore.progressiveSelectedOffer ?? 0];
  if (!config || templateIndex === undefined) return null;
  const rotation = gameStore.progressiveRotation ?? 0;
  const tile = gameStore.grid.worldToTile(worldX, worldY);
  const block = blockCoordinateForTile(gameStore.map.originTileX ?? 0, gameStore.map.originTileY ?? 0, tile.x, tile.y);
  const replayed = replayProgressiveBoard(config, gameStore.progressivePlacements ?? []);
  if (!placementLegal(replayed.board, replayed.catalog, templateIndex, rotation, block.blockX, block.blockY)) {
    return null;
  }
  return { type: "action:placeProgressiveBlock", templateIndex, rotation, blockX: block.blockX, blockY: block.blockY };
}

// Right-click on a placement space rotates the selected block through the
// quarter-turns that have a legal site, the same action as the R key. Returns
// false when the point is not on a legal site, so the caller can keep its
// existing behavior (camera pan).
export function rotateProgressiveBlockAt(gameStore: GameStoreLike, worldX: number, worldY: number): boolean {
  if (!progressivePlacementCommand(gameStore, worldX, worldY)) return false;
  clearBuildAndTowerForProgressive(gameStore);
  gameStore.rotateProgressiveBlock?.();
  return true;
}
