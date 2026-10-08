// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { GameState } from "@/sim/GameRunState.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { createTestGameStore } from "../helpers/mock-stores";

const startingBaseHealth = getGameContent().economy.startingBaseHealth;

interface GemBreakdown {
  bossKills: { base: number; afterDiff: number; afterRegion: number; afterFirstTime: number };
  milestones: { base: number; afterDiff: number; afterRegion: number; afterFirstTime: number };
  waveCompletion: { base: number; afterDiff: number; afterRegion: number; afterFirstTime: number };
  firstClearBonus: number;
}

function nonZeroGemBreakdown(): GemBreakdown {
  return {
    bossKills: { base: 10, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
    milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
    waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
    firstClearBonus: 0,
  };
}

describe("GameStore", () => {
  let store: ReturnType<typeof createTestGameStore>;

  beforeEach(() => {
    store = createTestGameStore();
  });

  describe("initial state", () => {
    it("starts with MENU state", () => {
      expect(store.state).toBe(GameState.MENU);
    });

    it("starts with base health at startingBaseHealth", () => {
      expect(store.baseHealth).toBe(startingBaseHealth);
    });

    it("starts with gold = 0", () => {
      expect(store.gold).toBe(0);
    });

    it("starts with currentWave = 0", () => {
      expect(store.currentWave).toBe(0);
    });

    it("starts with timeScale = 1", () => {
      expect(store.timeScale).toBe(1);
    });

    it("starts with null selectedTower", () => {
      expect(store.selectedTower).toBeNull();
    });

    it("starts with null selectedTowerType", () => {
      expect(store.selectedTowerType).toBeNull();
    });

    it("starts with null hoverTile", () => {
      expect(store.hoverTile).toBeNull();
    });

    it("starts with mapIndex = -1", () => {
      expect(store.mapIndex).toBe(-1);
    });

    it("starts with null map and grid", () => {
      expect(store.map).toBeNull();
      expect(store.grid).toBeNull();
    });

    it("starts with empty milestone rewards", () => {
      expect(store.milestoneRewardsClaimed).toEqual({});
    });

    it("starts with zero runGemsEarned, bossesKilledThisRun, and bossesReachedBaseThisRun", () => {
      expect(store.runGemsEarned).toBe(0);
      expect(store.bossesKilledThisRun).toBe(0);
      expect(store.bossesReachedBaseThisRun).toBe(0);
    });

    it("starts with null endScreenData and randomMapParams", () => {
      expect(store.endScreenData).toBeNull();
      expect(store.randomMapParams).toBeNull();
    });

    it("starts with initial gemBreakdown structure", () => {
      expect(store.gemBreakdown.bossKills).toEqual({ base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 });
      expect(store.gemBreakdown.milestones).toEqual({ base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 });
      expect(store.gemBreakdown.waveCompletion).toEqual({ base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 });
      expect(store.gemBreakdown.firstClearBonus).toBe(0);
    });
  });

  describe("getters", () => {
    it("isPlaying returns true when state is PLAYING", () => {
      store.setState(GameState.PLAYING);
      expect(store.isPlaying).toBe(true);
    });

    it("isPlaying returns false when state is MENU", () => {
      expect(store.isPlaying).toBe(false);
    });

    it("isPaused returns true when state is PAUSED", () => {
      store.setState(GameState.PAUSED);
      expect(store.isPaused).toBe(true);
    });

    it("isInGame returns true for PLAYING", () => {
      store.setState(GameState.PLAYING);
      expect(store.isInGame).toBe(true);
    });

    it("isInGame returns true for PAUSED", () => {
      store.setState(GameState.PAUSED);
      expect(store.isInGame).toBe(true);
    });

    it("isInGame returns false for MENU", () => {
      expect(store.isInGame).toBe(false);
    });

    it("isInGame returns false for GAME_OVER", () => {
      store.setState(GameState.GAME_OVER);
      expect(store.isInGame).toBe(false);
    });

    it("claimedMilestoneSet returns a Set of claimed wave keys", () => {
      store.claimMilestone(15);
      store.claimMilestone(30);
      const set = store.claimedMilestoneSet;
      expect(set).toBeInstanceOf(Set);
      expect(set.has("15")).toBe(true);
      expect(set.has("30")).toBe(true);
      expect(set.has("50")).toBe(false);
    });

    it("claimedMilestoneSet returns empty Set when nothing claimed", () => {
      const set = store.claimedMilestoneSet;
      expect(set).toBeInstanceOf(Set);
      expect(set.size).toBe(0);
    });
  });

  describe("addGold / setGold", () => {
    it("addGold increases gold", () => {
      store.addGold(50);
      expect(store.gold).toBe(50);
    });

    it("addGold accumulates", () => {
      store.addGold(10);
      store.addGold(20);
      expect(store.gold).toBe(30);
    });

    it("setGold sets exact value", () => {
      store.setGold(100);
      expect(store.gold).toBe(100);
    });

    it("setGold can reduce gold", () => {
      store.gold = 100;
      store.setGold(50);
      expect(store.gold).toBe(50);
    });
  });

  describe("damageBase", () => {
    it("reduces lives by the given amount", () => {
      store.damageBase(3);
      expect(store.baseHealth).toBe(startingBaseHealth - 3);
    });

    it("can reduce lives below zero", () => {
      store.damageBase(startingBaseHealth + 5);
      expect(store.baseHealth).toBe(-5);
    });
  });

  describe("setWave", () => {
    it("sets currentWave to the given value", () => {
      store.setWave(5);
      expect(store.currentWave).toBe(5);
    });
  });

  describe("selectTower / selectBuildType / setHoverTile", () => {
    it("selectTower sets selectedTower", () => {
      const tower = { id: 1 };
      store.selectTower(tower as unknown as Tower);
      expect(store.selectedTower).toStrictEqual(tower);
    });

    it("selectBuildType sets selectedTowerType", () => {
      store.selectBuildType("basic");
      expect(store.selectedTowerType).toBe("basic");
    });

    it("setHoverTile sets hoverTile", () => {
      store.setHoverTile({ tileX: 3, tileY: 4 });
      expect(store.hoverTile).toEqual({ tileX: 3, tileY: 4 });
    });

    it("snaps hover to the selected tower only when build mode starts", () => {
      store.selectedTower = { tileX: 4, tileY: 7 } as unknown as Tower;
      store.setHoverTile({ tileX: 1, tileY: 1 });
      store.selectBuildType("basic");
      expect(store.hoverTile).toEqual({ tileX: 4, tileY: 7 });
      expect(store.buildHoverHeld).toBe(true);
      expect(store.selectedTower).toMatchObject({ tileX: 4, tileY: 7 });

      store.setHoverTile({ tileX: 2, tileY: 3 });
      store.selectBuildType("ice");
      expect(store.hoverTile).toEqual({ tileX: 2, tileY: 3 });

      store.selectBuildType(null);
      expect(store.hoverTile).toEqual({ tileX: 2, tileY: 3 });
      expect(store.selectedTower).toMatchObject({ tileX: 4, tileY: 7 });
    });
  });

  describe("setState / togglePause", () => {
    it("setState changes state", () => {
      store.setState(GameState.PLAYING);
      expect(store.state).toBe(GameState.PLAYING);
    });

    it("togglePause switches PLAYING -> PAUSED", () => {
      store.setState(GameState.PLAYING);
      store.togglePause();
      expect(store.state).toBe(GameState.PAUSED);
    });

    it("togglePause switches PAUSED -> PLAYING", () => {
      store.setState(GameState.PAUSED);
      store.togglePause();
      expect(store.state).toBe(GameState.PLAYING);
    });

    it("togglePause does nothing in MENU state", () => {
      store.setState(GameState.MENU);
      store.togglePause();
      expect(store.state).toBe(GameState.MENU);
    });
  });

  describe("initMap", () => {
    it("sets mapIndex, map, and grid", () => {
      const mapData = { name: "Test Map", regionId: 0 };
      const grid = { width: 10, height: 10 } as unknown as Grid;
      store.initMap(0, mapData as unknown as GeneratedMap, grid);
      expect(store.mapIndex).toBe(0);
      expect(store.map).toStrictEqual(mapData);
      expect(store.grid).toStrictEqual(grid);
    });

    it("resets lives to 20", () => {
      store.baseHealth = 100;
      store.initMap(0, { regionId: 0 } as unknown as GeneratedMap, null);
      expect(store.baseHealth).toBe(startingBaseHealth);
    });

    it("sets gold based on startingGoldByRegion for the region", () => {
      store.initMap(0, { regionId: 0 } as unknown as GeneratedMap, null);
      expect(store.gold).toBe(getGameContent().economy.startingGoldByRegion[0]);
    });

    it("resets currentWave to 0", () => {
      store.currentWave = 50;
      store.initMap(0, { regionId: 0 } as unknown as GeneratedMap, null);
      expect(store.currentWave).toBe(0);
    });

    it("resets run rewards and milestones", () => {
      store.runGemsEarned = 100;
      store.bossesKilledThisRun = 5;
      store.bossesReachedBaseThisRun = 3;
      store.claimMilestone(15);
      store.initMap(0, { regionId: 0 } as unknown as GeneratedMap, null);
      expect(store.runGemsEarned).toBe(0);
      expect(store.bossesKilledThisRun).toBe(0);
      expect(store.bossesReachedBaseThisRun).toBe(0);
      expect(store.hasClaimedMilestone(15)).toBe(false);
    });

    it("resets selection state", () => {
      store.selectedTower = {} as never;
      store.selectedTowerType = "basic";
      store.hoverTile = { tileX: 0, tileY: 0 };
      store.initMap(0, { regionId: 0 } as unknown as GeneratedMap, null);
      expect(store.selectedTower).toBeNull();
      expect(store.selectedTowerType).toBeNull();
      expect(store.hoverTile).toBeNull();
    });

    it("resets endScreenData", () => {
      store.endScreenData = { wave: 0, gems: 0, victory: true, gemBreakdown: {} as unknown as GemBreakdown };
      store.initMap(0, { regionId: 0 } as unknown as GeneratedMap, null);
      expect(store.endScreenData).toBeNull();
    });

    it("resets gemBreakdown", () => {
      store.setGemBreakdown(nonZeroGemBreakdown());
      store.initMap(0, { regionId: 0 } as unknown as GeneratedMap, null);
      expect(store.gemBreakdown.bossKills.base).toBe(0);
      expect(store.gemBreakdown.waveCompletion.base).toBe(0);
    });
  });

  describe("panCameraByFraction", () => {
    function installSquareMap(tileCount: number) {
      const grid = {
        width: tileCount,
        height: tileCount,
        tileSize: 36,
        worldOriginX: 0,
        worldOriginY: 0,
      } as unknown as Grid;
      store.initMap(
        0,
        { regionId: 0, width: tileCount, height: tileCount, tiles: [] } as unknown as GeneratedMap,
        grid,
      );
      store.setViewport(1000, 1000);
    }

    it("pans by the frame fraction on each axis", () => {
      installSquareMap(40);
      const mapSize = 40 * 36;
      const viewHeight = mapSize / 1.44;
      store.camera = { centerX: mapSize / 2, centerY: mapSize / 2, viewHeight, followsMap: false };
      store.panCameraByFraction(0.2, -0.2);
      expect(store.camera.centerX).toBeCloseTo(mapSize / 2 + viewHeight * 0.2);
      expect(store.camera.centerY).toBeCloseTo(mapSize / 2 - viewHeight * 0.2);
      expect(store.camera.viewHeight).toBeCloseTo(viewHeight);
      expect(store.camera.followsMap).toBe(false);
    });

    it("absorbs a pan at the fit frame and keeps map following", () => {
      installSquareMap(40);
      const mapSize = 40 * 36;
      store.camera = { centerX: mapSize / 2, centerY: mapSize / 2, viewHeight: mapSize, followsMap: true };
      store.panCameraByFraction(0.2, 0);
      expect(store.camera.centerX).toBe(mapSize / 2);
      expect(store.camera.viewHeight).toBe(mapSize);
      expect(store.camera.followsMap).toBe(true);
    });

    it("clamps at the map edge without moving the camera", () => {
      installSquareMap(40);
      const mapSize = 40 * 36;
      const viewHeight = mapSize / 1.44;
      const edgeCenterX = mapSize / 2 + (mapSize - viewHeight) / 2;
      store.camera = { centerX: edgeCenterX, centerY: mapSize / 2, viewHeight, followsMap: false };
      store.panCameraByFraction(0.2, 0);
      expect(store.camera.centerX).toBeCloseTo(edgeCenterX);
      expect(store.camera.followsMap).toBe(false);
    });
  });

  describe("claimMilestone / hasClaimedMilestone", () => {
    it("claims a milestone wave", () => {
      store.claimMilestone(15);
      expect(store.hasClaimedMilestone(15)).toBe(true);
    });

    it("returns false for unclaimed milestone", () => {
      expect(store.hasClaimedMilestone(30)).toBe(false);
    });

    it("tracks multiple milestones independently", () => {
      store.claimMilestone(15);
      expect(store.hasClaimedMilestone(15)).toBe(true);
      expect(store.hasClaimedMilestone(30)).toBe(false);
    });
  });

  describe("triggerEnd", () => {
    it("sets victory state and stores end screen data", () => {
      store.triggerEnd(true, { wave: 100, gems: 50, gemBreakdown: {} as unknown as GemBreakdown });
      expect(store.state).toBe(GameState.VICTORY);
      expect(store.endScreenData?.victory).toBe(true);
      expect(store.endScreenData?.wave).toBe(100);
      expect(store.endScreenData?.gems).toBe(50);
    });

    it("sets game over state", () => {
      store.triggerEnd(false, { wave: 50, gems: 0, gemBreakdown: {} as unknown as GemBreakdown });
      expect(store.state).toBe(GameState.GAME_OVER);
      expect(store.endScreenData?.victory).toBe(false);
    });

    it("clears selection and hover on triggerEnd", () => {
      store.selectedTower = {} as never;
      store.selectedTowerType = "basic";
      store.hoverTile = { tileX: 0, tileY: 0 };
      store.triggerEnd(true, { wave: 0, gems: 0, gemBreakdown: {} as unknown as GemBreakdown });
      expect(store.selectedTower).toBeNull();
      expect(store.selectedTowerType).toBeNull();
      expect(store.hoverTile).toBeNull();
    });
  });

  describe("resetToMenu", () => {
    it("sets state to MENU", () => {
      store.setState(GameState.PLAYING);
      store.resetToMenu();
      expect(store.state).toBe(GameState.MENU);
    });

    it("resets mapIndex to -1 and clears map/grid", () => {
      store.mapIndex = 0;
      store.map = { name: "", regionId: 0 } as unknown as GeneratedMap;
      store.grid = {} as never;
      store.resetToMenu();
      expect(store.mapIndex).toBe(-1);
      expect(store.map).toBeNull();
      expect(store.grid).toBeNull();
    });

    it("clears selection and hover state", () => {
      store.selectedTower = {} as unknown as Tower;
      store.selectedTowerType = "basic";
      store.hoverTile = { tileX: 0, tileY: 0 };
      store.resetToMenu();
      expect(store.selectedTower).toBeNull();
      expect(store.selectedTowerType).toBeNull();
      expect(store.hoverTile).toBeNull();
    });

    it("clears endScreenData and randomMapParams", () => {
      store.endScreenData = { wave: 0, gems: 0, victory: false, gemBreakdown: {} as unknown as GemBreakdown };
      store.randomMapParams = {} as never;
      store.resetToMenu();
      expect(store.endScreenData).toBeNull();
      expect(store.randomMapParams).toBeNull();
    });

    it("resets all economy fields", () => {
      store.baseHealth = 5;
      store.gold = 500;
      store.currentWave = 50;
      store.timeScale = 8;
      store.runGemsEarned = 200;
      store.bossesKilledThisRun = 10;
      store.bossesReachedBaseThisRun = 4;
      store.claimMilestone(15);
      store.setGemBreakdown(nonZeroGemBreakdown());
      store.setHoverUpgradeBtn(true);
      store.resetToMenu();
      expect(store.baseHealth).toBe(startingBaseHealth);
      expect(store.gold).toBe(0);
      expect(store.currentWave).toBe(0);
      expect(store.timeScale).toBe(1);
      expect(store.runGemsEarned).toBe(0);
      expect(store.bossesKilledThisRun).toBe(0);
      expect(store.bossesReachedBaseThisRun).toBe(0);
      expect(store.hasClaimedMilestone(15)).toBe(false);
      expect(store.gemBreakdown.bossKills.base).toBe(0);
      expect(store.hoverUpgradeBtn).toBe(false);
    });
  });
});
