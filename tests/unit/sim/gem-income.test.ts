// @ts-nocheck
/** @vitest-environment node */

// Wave clears, pre-emptive expiry, and debug wave jumps do not pay gems.
// Wave 15 still pays the first-time milestone only. A first full clear doubles
// boss, milestone, and completion gems, with no per-wave term in that sum.

import { describe, expect, it } from "vitest";
import {
  CUSTOM_PROGRESSIVE_MAP_INDEX,
  CUSTOM_RANDOM_MAP_INDEX,
  MILESTONE_GEMS,
  VICTORY_WAVE,
} from "@/sim/Constants.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../../helpers/mock-stores.js";

function initEngine(mapIndex: number): GameEngine {
  const engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), new MockHostBindings(), mapIndex);
  engine.loadMap(mapIndex);
  return engine;
}

describe("wave clear gem income", () => {
  it("pays nothing on a clear, an expiry, or a debug wave jump before the first milestone", () => {
    const cleared = initEngine(0);
    const gemsBefore = cleared.persistState.gems;
    cleared.onWaveCleared(1);
    expect(cleared.runState.runGemsEarned).toBe(0);
    expect(cleared.persistState.gems).toBe(gemsBefore);

    const expired = initEngine(0);
    expired.onWaveExpired(3);
    expect(expired.runState.runGemsEarned).toBe(0);

    const jumped = initEngine(0);
    jumped.debug("setWave", 4);
    expect(jumped.runState.runGemsEarned).toBe(0);
  });

  it("pays only the first-time milestone on wave 15", () => {
    const engine = initEngine(0);
    engine.onWaveCleared(15);
    expect(engine.runState.gemBreakdown.milestones.base).toBe(MILESTONE_GEMS[15]);
    expect(engine.runState.gemBreakdown.milestones.afterFirstTime).toBe(MILESTONE_GEMS[15] * 2);
    expect(engine.runState.runGemsEarned).toBe(MILESTONE_GEMS[15] * 2);
    expect(engine.persistState.gems).toBeGreaterThanOrEqual(MILESTONE_GEMS[15] * 2);
  });

  it("doubles boss, milestone, and completion gems on a first full clear", () => {
    const engine = initEngine(0);
    engine.onWaveCleared(15);
    engine.waveManager.currentWave = VICTORY_WAVE;
    engine.endGame(true);

    const breakdown = engine.runState.gemBreakdown;
    const subtotal =
      breakdown.bossKills.afterFirstTime +
      breakdown.milestones.afterFirstTime +
      breakdown.waveCompletion.afterFirstTime;
    expect(breakdown.firstClearBonus).toBe(subtotal * 2);
    expect(breakdown.milestones.afterFirstTime).toBe(MILESTONE_GEMS[15] * 2);
    expect(engine.persistState.runHistory[engine.persistState.runHistory.length - 1].gems).toBe(
      engine.runState.runGemsEarned,
    );
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
