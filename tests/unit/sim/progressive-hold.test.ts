/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCommand } from "@/sim/applyCommand.js";
import { GameState, PRE_EMPTIVE_WAVE_TIMER, PROGRESSIVE_REROLL_GOLD_PER_WAVE } from "@/sim/Constants.js";
import { GameEngine } from "@/sim/GameEngine.js";
import {
  createProgressiveBoard,
  legalSites,
  progressiveConfigForIndex,
  templateCanExtendOpening,
} from "@/sim/grid/ProgressiveMap.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import type { WaveManager } from "@/sim/waves/WaveManager.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../../helpers/mock-stores.js";

describe("progressive placement hold", () => {
  let engine: GameEngine;

  function initEngine(mapIndex: number): GameEngine {
    engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), new MockHostBindings(), mapIndex);
    engine.loadMap(mapIndex);
    engine.runState.state = GameState.PLAYING;
    return engine;
  }

  function waveManager(): WaveManager {
    const manager = engine.waveManager as WaveManager | null;
    if (!manager) throw new Error("wave manager missing");
    return manager;
  }

  function reachWave(wave: number): void {
    const manager = waveManager();
    for (let step = manager.currentWave; step < wave; step++) {
      manager.startNextWave();
    }
  }

  beforeEach(() => {
    initEngine(36);
  });

  it("pauses on wave 3 expiry and keeps that wave until a block is placed", () => {
    reachWave(3);
    const manager = waveManager();
    manager._waveGameTime = PRE_EMPTIVE_WAVE_TIMER;
    engine.update(1 / 60);
    expect(manager.currentWave).toBe(3);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.progressiveResumeMode).toBe("expire-advance");
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(manager.countdownActive).toBe(false);
  });

  it("pauses on a natural wave 3 clear without starting the countdown", () => {
    reachWave(3);
    const manager = waveManager();
    if (!engine.enemyManager) throw new Error("enemy manager missing");
    manager.queue.length = 0;
    engine.enemyManager.clear();
    engine.update(1 / 60);
    expect(manager.currentWave).toBe(3);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.progressiveResumeMode).toBe("countdown");
    expect(manager.countdownActive).toBe(false);
    expect(engine.runState.waveCountdown).toBeNull();
  });

  it("offers two blocks, three after the addon, and does not hold on wave 100", () => {
    engine.debug("setWave", 3);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.progressiveOffer).toHaveLength(2);
    expect(engine.progressiveResumeMode).toBe("countdown");
    engine.persistState.generalAddons.progressiveThirdChoice = 0;
    engine.debug("setWave", 3);
    expect(engine.progressiveOffer).toHaveLength(3);
    engine.debug("setWave", 100);
    expect(engine.progressivePlacementHold).toBe(false);
    expect(engine.waveManager?.currentWave).toBe(100);
  });

  it("keeps the run paused after a placement and applies the pending resume on unpause", () => {
    engine.debug("setWave", 3);
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const started = createProgressiveBoard(config);
    const templateIndex = engine.progressiveOffer[0];
    if (templateIndex === undefined) throw new Error("offer was empty");
    const site = legalSites(started.board, started.catalog, templateIndex)[0];
    expect(site).toBeTruthy();
    const offer = engine.progressiveOffer.slice();
    const stampsBefore = engine.progressivePlacements.length;
    const placed = engine.placeProgressiveBlock(templateIndex, site!.rotation, site!.blockX, site!.blockY);
    expect(placed).toBe(true);
    expect(engine.progressivePlacementHold).toBe(false);
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.runState.waveCountdown).toBeNull();
    expect(engine.progressiveResumeMode).toBe("countdown");
    expect(engine.progressivePlacementUndo).toEqual({ stampCount: stampsBefore, offer });

    engine.togglePause();
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(engine.runState.waveCountdown?.nextWave).toBe(4);
    expect(engine.progressivePlacementUndo).toBeNull();
    expect(engine.progressiveResumeMode).toBeNull();
  });

  it("launches the expiry wave on unpause instead of at placement", () => {
    reachWave(3);
    const manager = waveManager();
    manager._waveGameTime = PRE_EMPTIVE_WAVE_TIMER;
    engine.update(1 / 60);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.progressiveResumeMode).toBe("expire-advance");
    const site = currentOfferSite();
    const placed = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    expect(placed).toBe(true);
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(manager.currentWave).toBe(3);
    expect(manager.active).toBe(false);

    engine.togglePause();
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(manager.currentWave).toBe(4);
    expect(engine.progressivePlacementUndo).toBeNull();
  });

  it("undoes the last placement and re-opens the same offer", () => {
    const site = firstOfferedSite();
    const offer = engine.progressiveOffer.slice();
    const stampsBefore = engine.progressivePlacements.length;
    const generationBefore = engine.layoutGeneration;
    const originBefore = { x: engine.grid?.worldOriginX, y: engine.grid?.worldOriginY };
    const widthBefore = engine.grid?.width;
    const placed = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    expect(placed).toBe(true);
    expect(engine.progressivePlacements.length).toBeGreaterThan(stampsBefore);
    expect(engine.layoutGeneration).toBe(generationBefore + 1);

    expect(applyCommand(engine, { commandId: 42, type: "action:undoProgressivePlacement" })).toBe(true);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.progressiveOffer).toEqual(offer);
    expect(engine.progressiveResumeMode).toBe("countdown");
    expect(engine.progressivePlacements).toHaveLength(stampsBefore);
    expect(engine.progressivePlacementUndo).toBeNull();
    expect(engine.grid?.width).toBe(widthBefore);
    expect(engine.grid?.worldOriginX).toBe(originBefore.x);
    expect(engine.grid?.worldOriginY).toBe(originBefore.y);
    expect(engine.layoutGeneration).toBe(generationBefore + 2);
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.undoProgressivePlacement()).toBe(false);
  });

  it("closes the undo window on unpause", () => {
    const site = firstOfferedSite();
    const placed = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    expect(placed).toBe(true);
    expect(engine.progressivePlacementUndo).not.toBeNull();
    engine.togglePause();
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(engine.progressivePlacementUndo).toBeNull();
    expect(engine.undoProgressivePlacement()).toBe(false);
  });

  it("rejects undo before any placement and while the offer hold is open", () => {
    expect(engine.progressivePlacementUndo).toBeNull();
    expect(engine.undoProgressivePlacement()).toBe(false);
    engine.debug("setWave", 3);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.undoProgressivePlacement()).toBe(false);
  });

  it("drops the pending resume and the undo stash on a debug wave skip", () => {
    const site = firstOfferedSite();
    const placed = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    expect(placed).toBe(true);
    engine.debug("skipWave");
    expect(engine.progressivePlacementUndo).toBeNull();
    expect(engine.progressiveResumeMode).toBeNull();
    expect(engine.progressivePlacementHold).toBe(false);
    expect(waveManager().advanceHeld).toBe(false);
    expect(waveManager().currentWave).toBe(4);
  });

  it("re-keys tower tiles when a placement shifts the grid origin and sells the tower cleanly", () => {
    const site = firstOfferedSite();
    const grid = engine.grid;
    const towerManager = engine.towerManager;
    if (!grid || !towerManager) throw new Error("grid or tower manager missing");
    let buildTile: { x: number; y: number } | null = null;
    for (let tileY = 0; tileY < grid.height && !buildTile; tileY++) {
      for (let tileX = 0; tileX < grid.width; tileX++) {
        if (grid.canBuild(tileX, tileY)) {
          buildTile = { x: tileX, y: tileY };
          break;
        }
      }
    }
    if (!buildTile) throw new Error("no buildable tile on the progressive board");
    const tower = towerManager.build("basic", buildTile.x, buildTile.y, engine.persistState, grid);
    if (!tower) throw new Error("tower build failed");
    const worldBefore = { x: tower.x, y: tower.y };
    const originXBefore = grid.worldOriginX;
    const originYBefore = grid.worldOriginY;
    const placed = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    expect(placed).toBe(true);
    const shiftX = Math.round((originXBefore - grid.worldOriginX) / grid.tileSize);
    const shiftY = Math.round((originYBefore - grid.worldOriginY) / grid.tileSize);
    expect(shiftX !== 0 || shiftY !== 0).toBe(true);
    expect(tower.tileX).toBe(buildTile.x + shiftX);
    expect(tower.tileY).toBe(buildTile.y + shiftY);
    expect(towerManager.towerAt(tower.tileX, tower.tileY)).toBe(tower);
    expect(towerManager.towerAt(buildTile.x, buildTile.y)).toBeUndefined();
    expect(tower.x).toBe(worldBefore.x);
    expect(tower.y).toBe(worldBefore.y);

    towerManager.sell(tower, engine.persistState);
    expect(towerManager.towers).toHaveLength(0);
    expect(towerManager.towerAt(tower.tileX, tower.tileY)).toBeUndefined();
    const towerKey = `${tower.tileX},${tower.tileY}`;
    expect(grid.blocked.has(towerKey) || grid.terrainTowers.has(towerKey)).toBe(false);
  });

  function currentOfferSite(): { templateIndex: number; rotation: number; blockX: number; blockY: number } {
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const started = createProgressiveBoard(config);
    const templateIndex = engine.progressiveOffer[0];
    if (templateIndex === undefined) throw new Error("offer was empty");
    const site = legalSites(started.board, started.catalog, templateIndex)[0];
    if (!site) throw new Error("no legal site");
    return { templateIndex, rotation: site.rotation, blockX: site.blockX, blockY: site.blockY };
  }

  function firstOfferedSite(): { templateIndex: number; rotation: number; blockX: number; blockY: number } {
    engine.debug("setWave", 3);
    return currentOfferSite();
  }

  function notifications(): string[] {
    return (engine.host as MockHostBindings).uiEvents
      .filter((event) => event.type === "showNotification")
      .map((event) => event.message);
  }

  it("refuses a placement when the walk-mesh probe fails and still accepts the same site afterward", () => {
    const site = firstOfferedSite();
    const width = engine.grid?.width;
    const originX = engine.grid?.worldOriginX;
    const originY = engine.grid?.worldOriginY;
    const pathVersion = engine.grid?.pathVersion;
    const realIsSuccess = NavMeshBuilder.prototype.isSuccess;
    let callCount = 0;
    const spy = vi.spyOn(NavMeshBuilder.prototype, "isSuccess").mockImplementation(function (this: NavMeshBuilder) {
      callCount += 1;
      if (callCount === 1) return false;
      return realIsSuccess.call(this);
    });
    let placed = true;
    try {
      placed = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    } finally {
      spy.mockRestore();
    }
    expect(placed).toBe(false);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.layoutGeneration).toBe(0);
    expect(engine.progressivePlacements).toHaveLength(0);
    expect(engine.grid?.width).toBe(width);
    expect(engine.grid?.worldOriginX).toBe(originX);
    expect(engine.grid?.worldOriginY).toBe(originY);
    expect(engine.grid?.pathVersion).toBe(pathVersion);
    expect(notifications().some((message) => message.includes("walk mesh failed"))).toBe(true);

    const placedAfter = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    expect(placedAfter).toBe(true);
    expect(engine.progressivePlacementHold).toBe(false);
    expect(engine.layoutGeneration).toBe(1);
  });

  it("restores the grid when the keeper walk mesh fails after the probe succeeds", () => {
    const site = firstOfferedSite();
    const width = engine.grid?.width;
    const originX = engine.grid?.worldOriginX;
    const originY = engine.grid?.worldOriginY;
    const pathVersion = engine.grid?.pathVersion;
    const realIsSuccess = NavMeshBuilder.prototype.isSuccess;
    let callCount = 0;
    const spy = vi.spyOn(NavMeshBuilder.prototype, "isSuccess").mockImplementation(function (this: NavMeshBuilder) {
      callCount += 1;
      if (callCount === 2) return false;
      return realIsSuccess.call(this);
    });
    let placed = true;
    try {
      placed = engine.placeProgressiveBlock(site.templateIndex, site.rotation, site.blockX, site.blockY);
    } finally {
      spy.mockRestore();
    }
    expect(placed).toBe(false);
    expect(callCount).toBe(2);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.layoutGeneration).toBe(0);
    expect(engine.progressivePlacements).toHaveLength(0);
    expect(engine.runState.map?.width).toBe(width);
    expect(engine.grid?.width).toBe(width);
    expect(engine.grid?.worldOriginX).toBe(originX);
    expect(engine.grid?.worldOriginY).toBe(originY);
    expect(engine.grid?.pathVersion).toBe(pathVersion);
    expect(notifications().some((message) => message.includes("walk mesh failed"))).toBe(true);
  });

  function boardForOffer() {
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    return createProgressiveBoard(config);
  }

  it("re-rolls every choice for the configured gold times the wave and keeps an extender", () => {
    const wave = 3;
    const cost = PROGRESSIVE_REROLL_GOLD_PER_WAVE * wave;
    engine.debug("setWave", wave);
    const goldBefore = engine.runState.gold;
    const rolled = engine.rerollProgressiveOffer();
    expect(rolled).toBe(true);
    expect(engine.runState.gold).toBe(goldBefore - cost);
    expect(engine.progressiveOffer).toHaveLength(2);
    expect(engine.progressivePlacementHold).toBe(true);
    const started = boardForOffer();
    expect(
      engine.progressiveOffer.some((templateIndex) =>
        templateCanExtendOpening(started.board, started.catalog, templateIndex),
      ),
    ).toBe(true);

    engine.persistState.generalAddons.progressiveThirdChoice = 0;
    engine.runState.gold = goldBefore;
    expect(engine.rerollProgressiveOffer()).toBe(true);
    expect(engine.progressiveOffer).toHaveLength(3);
    expect(engine.runState.gold).toBe(goldBefore - cost);
  });

  it("does not spend or draw when a re-roll is short on gold", () => {
    const left = engine;
    left.debug("setWave", 3);
    const right = initEngine(36);
    right.debug("setWave", 3);
    expect(left.progressiveOffer).toEqual(right.progressiveOffer);
    const offer = left.progressiveOffer.slice();
    const cost = PROGRESSIVE_REROLL_GOLD_PER_WAVE * 3;
    const shortGold = cost - 1;
    left.runState.gold = shortGold;
    expect(left.rerollProgressiveOffer()).toBe(false);
    expect(left.runState.gold).toBe(shortGold);
    expect(left.progressiveOffer).toEqual(offer);
    const leftNotes = (left.host as MockHostBindings).uiEvents
      .filter((event) => event.type === "showNotification")
      .map((event) => event.message);
    expect(leftNotes.some((message) => message.includes("Not enough gold"))).toBe(true);
    left.runState.gold = 500;
    right.runState.gold = 500;
    expect(left.rerollProgressiveOffer()).toBe(true);
    expect(right.rerollProgressiveOffer()).toBe(true);
    expect(left.progressiveOffer).toEqual(right.progressiveOffer);
    expect(left.runState.gold).toBe(500 - cost);
    expect(right.runState.gold).toBe(500 - cost);
  });

  it("rejects a re-roll when no hold is open", () => {
    expect(engine.rerollProgressiveOffer()).toBe(false);
    expect(engine.progressiveOffer).toEqual([]);
  });

  it("clears the selected tower when a placement hold opens and ignores tower clicks", () => {
    const grid = engine.grid;
    const towerManager = engine.towerManager;
    if (!grid || !towerManager) throw new Error("grid or tower manager missing");
    let buildTile: { x: number; y: number } | null = null;
    for (let tileY = 0; tileY < grid.height && !buildTile; tileY++) {
      for (let tileX = 0; tileX < grid.width; tileX++) {
        if (grid.canBuild(tileX, tileY)) {
          buildTile = { x: tileX, y: tileY };
          break;
        }
      }
    }
    if (!buildTile) throw new Error("no buildable tile on the progressive board");
    const tower = towerManager.build("basic", buildTile.x, buildTile.y, engine.persistState, grid);
    if (!tower) throw new Error("tower build failed");
    engine.runState.selectedTowerId = String(tower.id);
    engine.runState.selectedTowerType = "basic";
    engine.debug("setWave", 3);
    expect(engine.progressivePlacementHold).toBe(true);
    expect(engine.runState.selectedTowerId).toBeNull();
    expect(engine.runState.selectedTowerType).toBeNull();
    const world = grid.tileToWorld(tower.tileX, tower.tileY);
    engine.handleClick(world.x, world.y);
    expect(engine.runState.selectedTowerId).toBeNull();
    expect(engine.runState.selectedTowerType).toBeNull();
  });
});
