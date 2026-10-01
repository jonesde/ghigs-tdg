/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameState, PRE_EMPTIVE_WAVE_TIMER } from "@/sim/Constants.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { createProgressiveBoard, legalSites, progressiveConfigForIndex } from "@/sim/grid/ProgressiveMap.js";
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

  it("places a legal offered block and starts the between-waves countdown", () => {
    engine.debug("setWave", 3);
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const started = createProgressiveBoard(config);
    const templateIndex = engine.progressiveOffer[0];
    if (templateIndex === undefined) throw new Error("offer was empty");
    const site = legalSites(started.board, started.catalog, templateIndex)[0];
    expect(site).toBeTruthy();
    const placed = engine.placeProgressiveBlock(templateIndex, site!.rotation, site!.blockX, site!.blockY);
    expect(placed).toBe(true);
    expect(engine.progressivePlacementHold).toBe(false);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(engine.runState.waveCountdown?.nextWave).toBe(4);
  });

  function firstOfferedSite(): { templateIndex: number; rotation: number; blockX: number; blockY: number } {
    engine.debug("setWave", 3);
    const config = progressiveConfigForIndex(36);
    if (!config) throw new Error("progressive config 36 missing");
    const started = createProgressiveBoard(config);
    const templateIndex = engine.progressiveOffer[0];
    if (templateIndex === undefined) throw new Error("offer was empty");
    const site = legalSites(started.board, started.catalog, templateIndex)[0];
    if (!site) throw new Error("no legal site");
    return { templateIndex, rotation: site.rotation, blockX: site.blockX, blockY: site.blockY };
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
});
