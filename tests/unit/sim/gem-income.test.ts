// @ts-nocheck
/** @vitest-environment node */

// Exercises the real per-wave gem award path: flat REGION_GEM_REWARDS[regionId]
// gems on every wave completion, routed through the shared
// applyWaveProgressRewards path so natural clears, pre-emptive expiry, and debug
// jumps all agree. Covers the GemBreakdown waveClears category, region 1/2 flat
// values, the endGame history payload, and the Level-3 (16 gem) wave-20 pacing.

import { describe, expect, it } from "vitest";
import {
  CUSTOM_PROGRESSIVE_MAP_INDEX,
  CUSTOM_RANDOM_MAP_INDEX,
  MILESTONE_GEMS,
  REGION_GEM_REWARDS,
  VICTORY_WAVE,
} from "@/sim/Constants.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../../helpers/mock-stores.js";

function initEngine(mapIndex: number): GameEngine {
  const engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), new MockHostBindings(), mapIndex);
  engine.loadMap(mapIndex);
  return engine;
}

describe("per-wave gem income", () => {
  it("awards the flat region reward on a natural wave clear and increments the breakdown", () => {
    const engine = initEngine(0);
    const gemsBefore = engine.persistState.gems;
    engine.onWaveCleared(1);
    expect(engine.runState.gemBreakdown.waveClears.base).toBe(REGION_GEM_REWARDS[0]);
    expect(engine.runState.gemBreakdown.waveClears.afterFirstTime).toBe(REGION_GEM_REWARDS[0]);
    expect(engine.runState.runGemsEarned).toBe(REGION_GEM_REWARDS[0]);
    expect(engine.persistState.gems).toBe(gemsBefore + REGION_GEM_REWARDS[0]);
    expect(engine.persistDirty).toBe(true);

    engine.onWaveCleared(2);
    expect(engine.runState.gemBreakdown.waveClears.base).toBe(REGION_GEM_REWARDS[0] * 2);
    expect(engine.runState.runGemsEarned).toBe(REGION_GEM_REWARDS[0] * 2);
  });

  it("awards the same flat reward on pre-emptive expiry", () => {
    const engine = initEngine(0);
    engine.onWaveExpired(3);
    expect(engine.runState.gemBreakdown.waveClears.base).toBe(REGION_GEM_REWARDS[0]);
    expect(engine.runState.runGemsEarned).toBe(REGION_GEM_REWARDS[0]);
  });

  it("awards the same flat reward on debug wave jumps", () => {
    const engine = initEngine(0);
    engine.debug("setWave", 4);
    expect(engine.runState.gemBreakdown.waveClears.base).toBe(REGION_GEM_REWARDS[0]);
    engine.debug("setWave", 5);
    expect(engine.runState.gemBreakdown.waveClears.base).toBe(REGION_GEM_REWARDS[0] * 2);
  });

  it("awards 2 gems per clear in region 1 and 4 gems per clear in region 2", () => {
    const regionOneEngine = initEngine(12);
    regionOneEngine.onWaveCleared(1);
    expect(regionOneEngine.runState.gemBreakdown.waveClears.base).toBe(REGION_GEM_REWARDS[1]);
    expect(regionOneEngine.runState.runGemsEarned).toBe(REGION_GEM_REWARDS[1]);

    const regionTwoEngine = initEngine(24);
    regionTwoEngine.onWaveCleared(1);
    expect(regionTwoEngine.runState.gemBreakdown.waveClears.base).toBe(REGION_GEM_REWARDS[2]);
    expect(regionTwoEngine.runState.runGemsEarned).toBe(REGION_GEM_REWARDS[2]);
  });

  it("reaches at least 16 gems by wave 20 on map 1 (wave clears + first-time wave-15 milestone)", () => {
    const engine = initEngine(0);
    for (let wave = 1; wave <= 20; wave++) {
      engine.onWaveCleared(wave);
    }
    expect(engine.runState.gemBreakdown.waveClears.base).toBe(20 * REGION_GEM_REWARDS[0]);
    // Wave-15 milestone pays MILESTONE_GEMS[15] base, doubled on first claim.
    expect(engine.runState.gemBreakdown.milestones.base).toBe(MILESTONE_GEMS[15]);
    expect(engine.runState.gemBreakdown.milestones.afterFirstTime).toBe(MILESTONE_GEMS[15] * 2);
    expect(engine.runState.runGemsEarned).toBe(20 * REGION_GEM_REWARDS[0] + MILESTONE_GEMS[15] * 2);
    expect(engine.runState.runGemsEarned).toBeGreaterThanOrEqual(16);
  });

  it("keeps the endGame history payload carrying the waveClears breakdown", () => {
    const engine = initEngine(0);
    engine.onWaveCleared(1);
    engine.onWaveCleared(2);
    const gemsBeforeEnd = engine.persistState.gems;
    engine.endGame(false);

    const historyEntry = engine.persistState.runHistory[engine.persistState.runHistory.length - 1];
    expect(historyEntry.gemBreakdown.waveClears.base).toBe(2 * REGION_GEM_REWARDS[0]);
    expect(historyEntry.gems).toBe(engine.runState.runGemsEarned);
    expect(engine.persistState.gems).toBeGreaterThanOrEqual(gemsBeforeEnd);
  });

  it("includes waveClears in the first-full-clear bonus subtotal", () => {
    const engine = initEngine(0);
    engine.onWaveCleared(1);
    engine.onWaveCleared(2);
    engine.waveManager.currentWave = VICTORY_WAVE;
    engine.endGame(true);

    const breakdown = engine.runState.gemBreakdown;
    const subtotal =
      breakdown.bossKills.afterFirstTime +
      breakdown.milestones.afterFirstTime +
      breakdown.waveClears.afterFirstTime +
      breakdown.waveCompletion.afterFirstTime;
    expect(breakdown.firstClearBonus).toBe(subtotal * 2);
  });
});

describe("custom map gem multipliers", () => {
  it("applies the region/level map multiplier to custom generated runs", () => {
    const engine = new GameEngine(
      createTestPersistState(),
      createTestThemeBundle(),
      new MockHostBindings(),
      CUSTOM_RANDOM_MAP_INDEX,
    );
    engine.loadRandomMap(20, 20, 12, "open", 0, 42);
    engine.onBossKilled();
    expect(engine.runState.gemBreakdown.bossKills).toEqual({
      base: 1,
      afterDiff: 1,
      afterRegion: 3,
      afterFirstTime: 3,
    });
    expect(engine.runState.runGemsEarned).toBe(3);
  });

  it("applies the same multiplier to custom progressive runs and records replay params", () => {
    const engine = new GameEngine(
      createTestPersistState(),
      createTestThemeBundle(),
      new MockHostBindings(),
      CUSTOM_PROGRESSIVE_MAP_INDEX,
    );
    engine.loadProgressiveMap({ regionId: 0, level: 12, entryCount: 1, seed: 999 });
    engine.onBossKilled();
    expect(engine.runState.gemBreakdown.bossKills.afterRegion).toBe(3);
    engine.endGame(false);
    const historyEntry = engine.persistState.runHistory[engine.persistState.runHistory.length - 1];
    expect(historyEntry.mapIndex).toBe(CUSTOM_PROGRESSIVE_MAP_INDEX);
    expect(historyEntry.progressiveMapParams).toEqual({ regionId: 0, level: 12, entryCount: 1, seed: 999 });
  });
});
