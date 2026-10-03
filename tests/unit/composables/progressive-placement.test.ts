import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { progressivePlacementCommand, rotateProgressiveBlockAt } from "@/composables/progressivePlacement.js";
import { Grid } from "@/sim/grid/Grid.js";
import {
  createProgressiveBoard,
  generateProgressiveMap,
  legalSites,
  progressiveConfigForIndex,
} from "@/sim/grid/ProgressiveMap.js";
import { useGameStore } from "@/stores/game.js";

const BLOCK_WORLD_SIZE = 5 * 36;

type GameStore = ReturnType<typeof useGameStore>;
type BoardSite = { templateIndex: number; rotation: number; blockX: number; blockY: number };

function blockCenterWorld(blockX: number, blockY: number): { x: number; y: number } {
  return { x: blockX * BLOCK_WORLD_SIZE + BLOCK_WORLD_SIZE / 2, y: blockY * BLOCK_WORLD_SIZE + BLOCK_WORLD_SIZE / 2 };
}

// Arms a placement hold on the map 36 start board and returns the first offer
// with at least one legal site, so probes have a real space to hit.
function setupHold(gameStore: GameStore): BoardSite {
  const config = progressiveConfigForIndex(36);
  if (!config) throw new Error("progressive config 36 missing");
  const started = createProgressiveBoard(config);
  for (let templateIndex = 0; templateIndex < started.catalog.length; templateIndex++) {
    const site = legalSites(started.board, started.catalog, templateIndex)[0];
    if (!site) continue;
    const map = generateProgressiveMap(config);
    gameStore.map = map;
    gameStore.grid = new Grid(map);
    gameStore.progressivePlacementHold = true;
    gameStore.progressiveOffer = [templateIndex];
    gameStore.progressiveSelectedOffer = 0;
    gameStore.progressiveRotation = site.rotation;
    return { templateIndex, rotation: site.rotation, blockX: site.blockX, blockY: site.blockY };
  }
  throw new Error("no legal site on the start board");
}

describe("progressivePlacementCommand", () => {
  let gameStore: GameStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    gameStore = useGameStore();
  });

  it("returns null when there is no placement hold or no map", () => {
    expect(progressivePlacementCommand(gameStore, 0, 0)).toBeNull();
    const site = setupHold(gameStore);
    gameStore.progressivePlacementHold = false;
    const world = blockCenterWorld(site.blockX, site.blockY);
    expect(progressivePlacementCommand(gameStore, world.x, world.y)).toBeNull();
  });

  it("returns the place command for the block under a legal site", () => {
    const site = setupHold(gameStore);
    const world = blockCenterWorld(site.blockX, site.blockY);
    expect(progressivePlacementCommand(gameStore, world.x, world.y)).toEqual({
      type: "action:placeProgressiveBlock",
      templateIndex: site.templateIndex,
      rotation: site.rotation,
      blockX: site.blockX,
      blockY: site.blockY,
    });
  });

  it("returns null for a block with no neighbor on the board", () => {
    setupHold(gameStore);
    const far = blockCenterWorld(12, 12);
    expect(progressivePlacementCommand(gameStore, far.x, far.y)).toBeNull();
  });
});

describe("rotateProgressiveBlockAt", () => {
  let gameStore: GameStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    gameStore = useGameStore();
  });

  it("rotates when the point is on a legal placement space", () => {
    const site = setupHold(gameStore);
    gameStore.selectedTowerType = "basic";
    const rotate = vi.spyOn(gameStore, "rotateProgressiveBlock");
    const world = blockCenterWorld(site.blockX, site.blockY);

    expect(rotateProgressiveBlockAt(gameStore, world.x, world.y)).toBe(true);
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(gameStore.selectedTowerType).toBeNull();
  });

  it("does nothing when the point is not on a legal placement space", () => {
    setupHold(gameStore);
    const rotate = vi.spyOn(gameStore, "rotateProgressiveBlock");

    expect(rotateProgressiveBlockAt(gameStore, -4000, -4000)).toBe(false);
    expect(rotate).not.toHaveBeenCalled();
  });

  it("does nothing without a placement hold", () => {
    const rotate = vi.spyOn(gameStore, "rotateProgressiveBlock");

    expect(rotateProgressiveBlockAt(gameStore, 0, 0)).toBe(false);
    expect(rotate).not.toHaveBeenCalled();
  });
});
