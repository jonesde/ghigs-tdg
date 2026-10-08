// @ts-nocheck
/** @vitest-environment node */

// Wave clears, pre-emptive expiry, and debug wave jumps do not pay gems.
// Wave 15 still pays the first-time milestone only. A first full clear doubles
// boss, milestone, and completion gems, with no per-wave term in that sum.

import { describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { EconomyContentSchema } from "@/content/schemas/economy.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { customProgressiveMapIndex, customRandomMapIndex } from "@/sim/GameRunState.js";
import { createTestPersistState, createTestThemeBundle, MockHostBindings } from "../../helpers/mock-stores.js";

const milestoneGems = getGameContent().economy.milestoneGems;

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
    expect(engine.runState.gemBreakdown.milestones.base).toBe(milestoneGems[15]);
    expect(engine.runState.gemBreakdown.milestones.afterFirstTime).toBe(milestoneGems[15] * 2);
    expect(engine.runState.runGemsEarned).toBe(milestoneGems[15] * 2);
    expect(engine.persistState.gems).toBeGreaterThanOrEqual(milestoneGems[15] * 2);
  });

  it("doubles boss, milestone, and completion gems on a first full clear", () => {
    const engine = initEngine(0);
    engine.onWaveCleared(15);
    engine.waveManager.currentWave = getGameContent().economy.victoryWave;
    engine.endGame(true);

    const breakdown = engine.runState.gemBreakdown;
    const subtotal =
      breakdown.bossKills.afterFirstTime +
      breakdown.milestones.afterFirstTime +
      breakdown.waveCompletion.afterFirstTime;
    expect(breakdown.firstClearBonus).toBe(subtotal * 2);
    expect(breakdown.milestones.afterFirstTime).toBe(milestoneGems[15] * 2);
    expect(engine.persistState.runHistory[engine.persistState.runHistory.length - 1].gems).toBe(
      engine.runState.runGemsEarned,
    );
  });
});

describe("milestone gem payout table", () => {
  it("rejects a milestoneWaves entry with no milestoneGems key at load time", () => {
    // GameEngine reads milestoneGems[String(wave)] ?? 0, so a missing key pays
    // zero gems for that milestone without any error.
    const pack = structuredClone(getGameContent().economy);
    expect(EconomyContentSchema.safeParse(pack).success).toBe(true);

    const missingGems = structuredClone(pack);
    delete missingGems.milestoneGems[String(pack.milestoneWaves[1])];
    const parsed = EconomyContentSchema.safeParse(missingGems);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const gemIssues = parsed.error.issues.filter((issue) => issue.path.join() === "milestoneGems");
      expect(gemIssues).toHaveLength(1);
      expect(gemIssues[0]?.message).toContain(String(pack.milestoneWaves[1]));
    }
  });

  it("pays a milestone wave a positive gem count", () => {
    for (const milestoneWave of getGameContent().economy.milestoneWaves) {
      expect(getGameContent().economy.milestoneGems[String(milestoneWave)]).toBeGreaterThan(0);
    }
  });
});

describe("custom map gem multipliers", () => {
  it("applies the region/level map multiplier to custom generated runs", () => {
    const engine = new GameEngine(
      createTestPersistState(),
      createTestThemeBundle(),
      new MockHostBindings(),
      customRandomMapIndex,
    );
    engine.loadRandomMap(20, 20, 12, "open", 0, 42);
    engine.onBossKilled();
    expect(engine.runState.gemBreakdown.bossKills).toEqual({
      base: 1,
      afterDiff: 1,
      afterRegion: 1,
      afterFirstTime: 1,
    });
    expect(engine.runState.runGemsEarned).toBe(1);
  });

  it("applies the same multiplier to custom progressive runs and records replay params", () => {
    const engine = new GameEngine(
      createTestPersistState(),
      createTestThemeBundle(),
      new MockHostBindings(),
      customProgressiveMapIndex,
    );
    engine.loadProgressiveMap({ regionId: 0, level: 12, entryCount: 1, seed: 999 });
    engine.onBossKilled();
    expect(engine.runState.gemBreakdown.bossKills.afterRegion).toBe(1);
    engine.endGame(false);
    const historyEntry = engine.persistState.runHistory[engine.persistState.runHistory.length - 1];
    expect(historyEntry.mapIndex).toBe(customProgressiveMapIndex);
    expect(historyEntry.progressiveMapParams).toEqual({ regionId: 0, level: 12, entryCount: 1, seed: 999 });
  });
});
