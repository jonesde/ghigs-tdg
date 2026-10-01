import { onUnmounted } from "vue";
import { clearBuildAndTowerForProgressive } from "@/composables/progressivePlacement.js";
import { ZOOM_STEP } from "@/render/svg/cameraFrame.js";
import type { Command } from "@/sim/Command.js";
import type { CommandDispatcher } from "@/sim/CommandDispatcher.js";
import { GameState } from "@/sim/Constants.js";
import { type TowerId, TowerIds } from "@/sim/ConstantsTower.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { PROGRESSIVE_BLOCK_SIZE, progressiveBlockWorldCorner } from "@/sim/grid/ProgressiveMap.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import type { GameStoreLike } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import type { UiStoreLike } from "@/stores/ui.js";

const towerIdList = Object.values(TowerIds) as TowerId[];
const targetingModes = ["first", "last", "closest", "strong", "furthest"] as const;

interface CameraReveal {
  worldX: number;
  worldY: number;
}

interface InputGrid {
  width: number;
  height: number;
  tileSize?: number;
  worldOriginX?: number;
  worldOriginY?: number;
  tileToWorld?: (tileX: number, tileY: number) => { x: number; y: number };
}

function inputGrid(gameStore: GameStoreLike): InputGrid | null {
  return (gameStore as unknown as { grid: InputGrid | null }).grid ?? null;
}

function tileSizeOf(gameStore: GameStoreLike): number {
  const tileSize = inputGrid(gameStore)?.tileSize;
  return tileSize && tileSize > 0 ? tileSize : 36;
}

function tileCenter(gameStore: GameStoreLike, tileX: number, tileY: number): { x: number; y: number } {
  const grid = inputGrid(gameStore);
  if (grid?.tileToWorld) return grid.tileToWorld(tileX, tileY);
  const tileSize = tileSizeOf(gameStore);
  const originX = grid?.worldOriginX ?? 0;
  const originY = grid?.worldOriginY ?? 0;
  return { x: originX + tileX * tileSize + tileSize / 2, y: originY + tileY * tileSize + tileSize / 2 };
}

function overlayBlocksCamera(uiStore: UiStoreLike): boolean {
  return (
    uiStore.showPauseMenu ||
    uiStore.showSkillTree ||
    uiStore.showStatsPanel ||
    uiStore.showHelpDialog ||
    uiStore.debugPanelVisible ||
    !!uiStore.confirmDialog
  );
}

function applyCameraFollow(gameStore: GameStoreLike, uiStore: UiStoreLike, reveal: CameraReveal | null): void {
  if (!reveal || overlayBlocksCamera(uiStore)) return;
  gameStore.revealCameraPoint(reveal.worldX, reveal.worldY);
}

function placementSiteCenter(gameStore: GameStoreLike, blockX: number, blockY: number): { x: number; y: number } {
  const tileSize = tileSizeOf(gameStore);
  const corner = progressiveBlockWorldCorner(blockX, blockY, tileSize);
  const halfBlock = (PROGRESSIVE_BLOCK_SIZE * tileSize) / 2;
  return { x: corner.x + halfBlock, y: corner.y + halfBlock };
}

function keyboardZoomFocus(gameStore: GameStoreLike): { x: number; y: number } | null {
  if (gameStore.progressivePlacementHold && gameStore.progressiveSelectedSite) {
    const site = gameStore.progressiveSelectedSite;
    return placementSiteCenter(gameStore, site.blockX, site.blockY);
  }
  if (gameStore.selectedTower && !gameStore.selectedTowerType) {
    return tileCenter(gameStore, gameStore.selectedTower.tileX, gameStore.selectedTower.tileY);
  }
  if (gameStore.selectedTowerType && gameStore.hoverTile) {
    return tileCenter(gameStore, gameStore.hoverTile.tileX, gameStore.hoverTile.tileY);
  }
  return null;
}

// Sets the local build-type preview AND informs the worker via the command seam
// so it can place towers on input:click. The snapshot mirrors runState.selectedTowerType
// back into gameStore for the worker-cleared cases (off-grid / existing-tower clicks,
// cancelBuildMode). Fix #1.
function selectBuildType(gameStore: GameStoreLike, type: TowerId | null): void {
  gameStore.selectBuildType(type);
  dispatchCommand({ commandId: nextInputCommandId++, type: "action:selectBuildType", towerType: type });
}

/**
 * Keyboard input handler as a Vue composable.
 * Dispatches actions to Pinia datastores (host-authoritative UI state) and to
 * the simulation via the CommandDispatcher seam.
 */
const KEY_REPEAT_INTERVAL = 500;
let nextInputCommandId = 1;

export function useInput(gameStore: GameStoreLike, dispatcher: CommandDispatcher, uiStore: UiStoreLike): void {
  const lastActionByKey = new Map<string, number>();

  const dispatch = (command: Command): void => {
    dispatcher.dispatch(command);
  };

  function canActNow(key: string): boolean {
    const now = performance.now();
    const lastTime = lastActionByKey.get(key) ?? 0;
    if (now - lastTime >= KEY_REPEAT_INTERVAL) {
      lastActionByKey.set(key, now);
      return true;
    }
    return false;
  }

  const handle = (event: KeyboardEvent) => {
    const gs = gameStore;
    if (gs.state === GameState.MENU || gs.state === GameState.GAME_OVER || gs.state === GameState.VICTORY) return;
    // This listener is on window, so it also sees keys typed into the commander panel.
    // Space is cancelled for pause and would never be inserted into the field.
    if (isTextEntryTarget(event)) return;

    // A placement hold freezes the simulation clock. Pause and speed keys must not reach the
    // worker: the main-thread timeScale would change while the board stays paused.
    if (gs.progressivePlacementHold) {
      if (event.key === " " || event.key === "a" || event.key === "d") {
        event.preventDefault();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const offerLength = gs.progressiveOffer?.length ?? 0;
        if (offerLength > 0) {
          const currentIndex = gs.progressiveSelectedOffer ?? 0;
          const offset = event.shiftKey ? -1 : 1;
          const nextIndex = (currentIndex + offset + offerLength) % offerLength;
          clearBuildAndTowerForProgressive(gs);
          gs.selectProgressiveOffer?.(nextIndex);
        }
        return;
      }
      if (event.key === "r" || event.key === "R") {
        clearBuildAndTowerForProgressive(gs);
        gs.rotateProgressiveBlock?.();
        event.preventDefault();
        return;
      }
      if (event.key === "Enter") {
        if (uiStore.confirmDialog) {
          uiStore.executeConfirm();
          return;
        }
        if (
          uiStore.showPauseMenu ||
          uiStore.showSkillTree ||
          uiStore.showStatsPanel ||
          uiStore.showHelpDialog ||
          uiStore.debugPanelVisible
        ) {
          return;
        }
        const templateIndex = gs.progressiveOffer?.[gs.progressiveSelectedOffer ?? 0];
        const site = gs.progressiveSelectedSite;
        if (templateIndex === undefined || !site || gs.progressiveRotation === undefined) return;
        dispatch({
          commandId: nextInputCommandId++,
          type: "action:placeProgressiveBlock",
          templateIndex,
          rotation: gs.progressiveRotation,
          blockX: site.blockX,
          blockY: site.blockY,
        });
        event.preventDefault();
        return;
      }
      if (
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        if (!canActNow(event.key)) return;
        let direction: "up" | "down" | "left" | "right" = "down";
        if (event.key === "ArrowRight") direction = "right";
        else if (event.key === "ArrowLeft") direction = "left";
        else if (event.key === "ArrowUp") direction = "up";
        const previousSite = gs.progressiveSelectedSite ? { ...gs.progressiveSelectedSite } : null;
        gs.moveProgressiveSite?.(direction);
        const nextSite = gs.progressiveSelectedSite;
        const siteMoved =
          !!nextSite &&
          (!previousSite || nextSite.blockX !== previousSite.blockX || nextSite.blockY !== previousSite.blockY);
        if (nextSite && siteMoved) {
          const center = placementSiteCenter(gs, nextSite.blockX, nextSite.blockY);
          applyCameraFollow(gs, uiStore, { worldX: center.x, worldY: center.y });
        }
        return;
      }
      const offerDigit = parseInt(event.key, 10);
      if (offerDigit >= 1 && offerDigit <= 9) {
        event.preventDefault();
        if (offerDigit <= 3) {
          clearBuildAndTowerForProgressive(gs);
          gs.selectProgressiveOffer?.(offerDigit - 1);
        }
        return;
      }
    }

    switch (event.key) {
      case " ":
        if (uiStore.showPauseMenu) {
          uiStore.closeAllDialogs();
        } else {
          dispatch({ commandId: nextInputCommandId++, type: "action:togglePause" });
        }
        event.preventDefault();
        break;
      case "Escape":
      case "x":
        if (
          uiStore.showPauseMenu ||
          uiStore.showSkillTree ||
          uiStore.showStatsPanel ||
          uiStore.showHelpDialog ||
          uiStore.debugPanelVisible ||
          uiStore.confirmDialog
        ) {
          uiStore.closeAllDialogs();
        } else if (gs.selectedTowerType) {
          dispatch({ commandId: nextInputCommandId++, type: "action:cancelBuildMode" });
        } else if (gs.selectedTower) {
          dispatchCommand({ commandId: nextInputCommandId++, type: "action:selectTower", towerId: null });
        } else {
          uiStore.openPauseMenu();
        }
        break;
      case "Tab": {
        if (gs.selectedTowerType) {
          handleTabCycle(gs, event.shiftKey);
        } else {
          if (event.shiftKey) {
            gs.cycleSpeedReverse();
            dispatch({ commandId: nextInputCommandId++, type: "action:cycleSpeed", direction: -1 });
          } else {
            gs.cycleSpeed();
            dispatch({ commandId: nextInputCommandId++, type: "action:cycleSpeed", direction: 1 });
          }
        }
        event.preventDefault();
        break;
      }
      case "ArrowRight":
        event.preventDefault();
        if (gs.selectedTowerType) {
          if (canActNow(event.key)) applyCameraFollow(gs, uiStore, moveBuildPosition(gs, 1, 0));
        } else if (canActNow(event.key)) {
          applyCameraFollow(gs, uiStore, moveTowerSelection(gs, "right"));
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (gs.selectedTowerType) {
          if (canActNow(event.key)) applyCameraFollow(gs, uiStore, moveBuildPosition(gs, -1, 0));
        } else if (canActNow(event.key)) {
          applyCameraFollow(gs, uiStore, moveTowerSelection(gs, "left"));
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (gs.selectedTowerType) {
          if (canActNow(event.key)) applyCameraFollow(gs, uiStore, moveBuildPosition(gs, 0, -1));
        } else if (canActNow(event.key)) {
          applyCameraFollow(gs, uiStore, moveTowerSelection(gs, "up"));
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        if (gs.selectedTowerType) {
          if (canActNow(event.key)) applyCameraFollow(gs, uiStore, moveBuildPosition(gs, 0, 1));
        } else if (canActNow(event.key)) {
          applyCameraFollow(gs, uiStore, moveTowerSelection(gs, "down"));
        }
        break;
      case "PageUp":
      case "PageDown": {
        if (overlayBlocksCamera(uiStore)) break;
        const focus = keyboardZoomFocus(gs);
        const magnification = event.key === "PageUp" ? ZOOM_STEP : 1 / ZOOM_STEP;
        gs.zoomCamera(magnification, focus?.x ?? null, focus?.y ?? null);
        event.preventDefault();
        break;
      }
      case "w":
        if (canActNow(event.key) && gs.selectedTower) {
          dispatch({ commandId: nextInputCommandId++, type: "action:upgradeSelected" });
        }
        break;
      case "u":
        if (canActNow(event.key) && gs.selectedTower) {
          dispatch({ commandId: nextInputCommandId++, type: "action:upgradeSelected" });
        }
        break;
      case "e":
        if (canActNow(event.key) && gs.selectedTower) {
          handleSpecializeKey(gs, "A", dispatch);
        }
        break;
      case "c":
        if (canActNow(event.key) && gs.selectedTower) {
          handleSpecializeKey(gs, "B", dispatch);
        }
        break;
      case "a":
        if (canActNow(event.key)) {
          gs.cycleSpeedReverse();
          dispatch({ commandId: nextInputCommandId++, type: "action:cycleSpeed", direction: -1 });
        }
        break;
      case "s":
        if (canActNow(event.key) && gs.selectedTower) {
          if (gs.selectedTower.level > 1) {
            dispatch({ commandId: nextInputCommandId++, type: "action:downgradeSelected" });
          } else {
            dispatch({ commandId: nextInputCommandId++, type: "action:sellSelected" });
          }
        }
        break;
      case "d":
        if (canActNow(event.key)) {
          gs.cycleSpeed();
          dispatch({ commandId: nextInputCommandId++, type: "action:cycleSpeed", direction: 1 });
        }
        break;
      case "f":
        if (canActNow(event.key) && gs.selectedTower) {
          const currentMode = gs.selectedTower.targeting || "first";
          const currentIndex = targetingModes.indexOf(currentMode as (typeof targetingModes)[number]);
          const nextIndex = (currentIndex + 1) % targetingModes.length;
          dispatch({ commandId: nextInputCommandId++, type: "action:setTargeting", mode: targetingModes[nextIndex]! });
        }
        break;
      case "Enter":
        if (uiStore.confirmDialog) {
          uiStore.executeConfirm();
        } else if (gs.selectedTowerType && gs.hoverTile) {
          const grid = (
            gs as unknown as { grid: { tileToWorld: (tx: number, ty: number) => { x: number; y: number } } | null }
          ).grid;
          if (grid) {
            const worldPos = grid.tileToWorld(gs.hoverTile.tileX, gs.hoverTile.tileY);
            dispatch({ commandId: nextInputCommandId++, type: "input:click", worldX: worldPos.x, worldY: worldPos.y });
          }
        }
        break;
      default: {
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          const towerIndex = (digit - 1) % towerIdList.length;
          const towerType = towerIdList[towerIndex]!;
          selectBuildType(gs, gs.selectedTowerType === towerType ? null : towerType);
          if (gs.selectedTower && !gs.hoverTile) {
            gs.setHoverTile({ tileX: gs.selectedTower.tileX, tileY: gs.selectedTower.tileY });
          }
        }
        break;
      }
    }
  };

  const handleDown = (event: KeyboardEvent) => handle(event);
  const handleUp = (event: KeyboardEvent) => {
    lastActionByKey.delete(event.key);
  };
  window.addEventListener("keydown", handleDown);
  window.addEventListener("keyup", handleUp);
  onUnmounted(() => {
    window.removeEventListener("keydown", handleDown);
    window.removeEventListener("keyup", handleUp);
  });
}

function isTextEntryTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function handleSpecializeKey(
  gameStore: GameStoreLike,
  variant: "A" | "B",
  sendCommand: (command: Command) => void,
): void {
  const tower = gameStore.selectedTower;
  if (!tower) return;
  const check = (tower as unknown as { canUpgrade?: { needVariant?: boolean } }).canUpgrade;
  if (!check?.needVariant) return;
  const unlocked = usePersistStore().unlocked[tower.type];
  if (!unlocked) return;
  const unlockedVariant = variant === "A" ? !!unlocked.variantA[0] : !!unlocked.variantB[0];
  if (!unlockedVariant) return;
  sendCommand({ commandId: nextInputCommandId++, type: "action:specialize", variant });
}

function handleTabCycle(gameStore: GameStoreLike, previous: boolean): void {
  if (gameStore.selectedTowerType !== null) {
    const towerIndex = towerIdList.indexOf(gameStore.selectedTowerType);
    const offset = previous ? -1 : 1;
    const nextIndex = (towerIndex + offset + towerIdList.length) % towerIdList.length;
    selectBuildType(gameStore, towerIdList[nextIndex]!);
    return;
  }

  const towers = getNavigableTowers(gameStore);
  if (towers.length === 0) return;

  const sortedTowers = [...towers].sort((a, b) => {
    if (a.tileY !== b.tileY) return a.tileY - b.tileY;
    return a.tileX - b.tileX;
  });

  if (gameStore.selectedTower) {
    const selectedId = gameStore.selectedTower.id;
    const selectedIndex = sortedTowers.findIndex((tower) => tower.id === selectedId);
    if (selectedIndex >= 0) {
      const offset = previous ? -1 : 1;
      const nextIndex = (selectedIndex + offset + sortedTowers.length) % sortedTowers.length;
      dispatchCommand({
        commandId: nextInputCommandId++,
        type: "action:selectTower",
        towerId: sortedTowers[nextIndex]!.id,
      });
    }
  } else if (previous) {
    dispatchCommand({
      commandId: nextInputCommandId++,
      type: "action:selectTower",
      towerId: sortedTowers[sortedTowers.length - 1]!.id,
    });
  } else {
    dispatchCommand({ commandId: nextInputCommandId++, type: "action:selectTower", towerId: sortedTowers[0]!.id });
  }
}

function moveBuildPosition(gameStore: GameStoreLike, dx: number, dy: number): CameraReveal | null {
  const grid = inputGrid(gameStore);
  if (!grid) return null;

  const currentHover = gameStore.hoverTile;
  let tileX: number;
  let tileY: number;

  if (currentHover === null) {
    tileX = Math.floor(grid.width / 2);
    tileY = Math.floor(grid.height / 2);
  } else {
    tileX = currentHover.tileX + dx;
    tileY = currentHover.tileY + dy;
  }

  tileX = Math.max(0, Math.min(tileX, grid.width - 1));
  tileY = Math.max(0, Math.min(tileY, grid.height - 1));

  const towerAtNewPos = getNavigableTowers(gameStore).find((tower) => tower.tileX === tileX && tower.tileY === tileY);
  if (towerAtNewPos) {
    dispatchCommand({ commandId: nextInputCommandId++, type: "action:selectTower", towerId: towerAtNewPos.id });
  }

  gameStore.setHoverTile({ tileX, tileY });
  if (currentHover && currentHover.tileX === tileX && currentHover.tileY === tileY) return null;
  const center = tileCenter(gameStore, tileX, tileY);
  return { worldX: center.x, worldY: center.y };
}

type Direction = "up" | "down" | "left" | "right";

function buildSearchOrder(direction: Direction): Array<{ dx: number; dy: number }> {
  const searchOrder: Array<{ dx: number; dy: number }> = [];
  const maxDist = 100;

  if (direction === "up") {
    for (let dist = 1; dist <= maxDist; dist++) searchOrder.push({ dx: 0, dy: -dist });
    for (let dist = 1; dist <= maxDist; dist++) {
      for (let perp = 1; perp <= dist; perp++) {
        searchOrder.push({ dx: -perp, dy: -dist });
        searchOrder.push({ dx: perp, dy: -dist });
      }
    }
  } else if (direction === "down") {
    for (let dist = 1; dist <= maxDist; dist++) searchOrder.push({ dx: 0, dy: dist });
    for (let dist = 1; dist <= maxDist; dist++) {
      for (let perp = 1; perp <= dist; perp++) {
        searchOrder.push({ dx: -perp, dy: dist });
        searchOrder.push({ dx: perp, dy: dist });
      }
    }
  } else if (direction === "left") {
    for (let dist = 1; dist <= maxDist; dist++) searchOrder.push({ dx: -dist, dy: 0 });
    for (let dist = 1; dist <= maxDist; dist++) {
      for (let perp = 1; perp <= dist; perp++) {
        searchOrder.push({ dx: -dist, dy: -perp });
        searchOrder.push({ dx: -dist, dy: perp });
      }
    }
  } else {
    for (let dist = 1; dist <= maxDist; dist++) searchOrder.push({ dx: dist, dy: 0 });
    for (let dist = 1; dist <= maxDist; dist++) {
      for (let perp = 1; perp <= dist; perp++) {
        searchOrder.push({ dx: dist, dy: -perp });
        searchOrder.push({ dx: dist, dy: perp });
      }
    }
  }

  return searchOrder;
}

type TowerLite = { id: string; tileX: number; tileY: number };

// Tower navigation (Tab / arrow keys) reads the snapshot projection in the
// worker build (the live manager is null on the main thread). Fall back to the
// live manager when no snapshot is available (legacy / test path). Fix #5.
function getNavigableTowers(_gameStore: GameStoreLike): TowerLite[] {
  const snapshot = getLatestSnapshot();
  if (snapshot && snapshot.towers.length > 0) return snapshot.towers;
  return [];
}

function searchTowers(
  searchOrder: Array<{ dx: number; dy: number }>,
  originX: number,
  originY: number,
  towerSet: Map<string, TowerLite>,
): TowerLite | null {
  for (const offset of searchOrder) {
    const target = towerSet.get(`${originX + offset.dx},${originY + offset.dy}`);
    if (target) {
      return target;
    }
  }
  return null;
}

function moveTowerSelection(gameStore: GameStoreLike, direction: Direction): CameraReveal | null {
  const towers = getNavigableTowers(gameStore);
  if (towers.length === 0) return null;

  const selected = gameStore.selectedTower;
  if (!selected) {
    const sorted = [...towers].sort((a, b) => {
      if (direction === "up") return a.tileY - b.tileY || a.tileX - b.tileX;
      if (direction === "down") return b.tileY - a.tileY || a.tileX - b.tileX;
      if (direction === "left") return a.tileX - b.tileX || a.tileY - b.tileY;
      return b.tileX - a.tileX || a.tileY - b.tileY;
    });
    const chosen = sorted[0]!;
    dispatchCommand({ commandId: nextInputCommandId++, type: "action:selectTower", towerId: chosen.id });
    const center = tileCenter(gameStore, chosen.tileX, chosen.tileY);
    return { worldX: center.x, worldY: center.y };
  }

  const originX = selected.tileX;
  const originY = selected.tileY;
  const towerSet = new Map<string, TowerLite>();
  for (const tower of towers) {
    if (tower.id !== selected.id) {
      towerSet.set(`${tower.tileX},${tower.tileY}`, tower);
    }
  }

  const searchOrder = buildSearchOrder(direction);
  let target = searchTowers(searchOrder, originX, originY, towerSet);

  // If no tower found, wrap around to the opposite edge
  if (!target) {
    const grid = inputGrid(gameStore);
    if (grid) {
      let wrapOriginX = originX;
      let wrapOriginY = originY;

      if (direction === "right") {
        wrapOriginX = -1;
      } else if (direction === "left") {
        wrapOriginX = grid.width;
      } else if (direction === "up") {
        wrapOriginY = grid.height;
      } else {
        wrapOriginY = -1;
      }

      target = searchTowers(searchOrder, wrapOriginX, wrapOriginY, towerSet);
    }
  }

  if (!target) return null;
  dispatchCommand({ commandId: nextInputCommandId++, type: "action:selectTower", towerId: target.id });
  const center = tileCenter(gameStore, target.tileX, target.tileY);
  return { worldX: center.x, worldY: center.y };
}
