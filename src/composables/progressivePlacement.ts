import { dispatchCommand } from "@/sim/commandBus.js";
import type { GameStoreLike } from "@/stores/game.js";

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
