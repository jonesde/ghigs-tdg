// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { migrateToCurrent } from "@/stores/persist.js";

describe("PersistStore save migration v2 -> v3", () => {
  function v2ShapedSave(): Record<string, unknown> {
    return {
      saveVersion: 2,
      gems: 1234,
      highestUnlockedMap: 5,
      bestWaves: { best_3: 45 },
      activeWaves: { 0: 12 },
      difficulty: { multiplierTick: 4 },
      firstTimeMilestones: { "5_20": true },
      firstClears: { "7": true },
      generalAddons: {
        extraHealth: 10,
        startingGold: null,
        sellRefundUnlocked: false,
        sellDiscountUnlocked: false,
        sellActive: null,
        upgradeCostReduction: null,
        terrainHeightBonus: null,
        terrainHeightRangeBonus: null,
        damageMilestoneBonus: null,
        slowHealing: null,
      },
      unlocked: {
        basic: {
          levels: [true, true, false, false, false, false, false],
          variantA: [false, false, false],
          variantB: [false, false, false],
          addons: [false, false, false],
        },
      },
      runHistory: [],
      randomMapRegion: 1,
      randomMapLevel: 1,
      randomMapStyle: "open",
      randomMapSeed: null,
      randomMapWidth: 20,
      randomMapHeight: 20,
      lastSelectedThemeId: "default",
    };
  }

  it("bumps saveVersion to 4", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.saveVersion).toBe(4);
  });

  it("backfills llmCommanders as an empty array (no data loss of the new field)", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(Array.isArray(result.llmCommanders)).toBe(true);
    expect(result.llmCommanders).toEqual([]);
  });

  it("preserves top-level v2 fields through the deep merge", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.gems).toBe(1234);
    expect(result.highestUnlockedMap).toBe(5);
    expect(result.bestWaves).toEqual({ best_3: 45 });
    expect(result.activeWaves).toEqual({ 0: 12 });
    expect(result.runHistory).toEqual([]);
    expect(result.lastSelectedThemeId).toBe("default");
  });

  it("preserves nested v2 fields (difficulty, generalAddons, unlocked, milestones)", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.difficulty.multiplierTick).toBe(4);
    expect(result.generalAddons.extraHealth).toBe(10);
    expect(result.firstTimeMilestones["5_20"]).toBe(true);
    expect(result.firstClears["7"]).toBe(true);
    expect(result.unlocked.basic.levels[0]).toBe(true);
    expect(result.unlocked.basic.levels[2]).toBe(false);
  });

  it("carries v2 llmCommanders through backfill instead of wiping them", () => {
    const saved = v2ShapedSave();
    saved.llmCommanders = [
      {
        id: "carried",
        name: "Carried",
        endpointUrl: "http://localhost:1234/v1",
        token: "",
        modelName: "",
        contextLimit: 32768,
        commanderInstructions: "",
        systemPrompt: "sys",
        requestTimeoutMs: 30000,
      },
    ];
    const result = migrateToCurrent(saved);
    expect(result.saveVersion).toBe(4);
    expect(result.llmCommanders).toHaveLength(1);
    expect(result.llmCommanders[0].id).toBe("carried");
    expect(result.llmCommanders[0].pauseForCommander).toBe(false);
    expect(result.llmCommanders[0].decisionIntervalMs).toBe(1000);
    expect(result.llmCommanders[0].reasoningEnabled).toBe(false);
    expect(result.llmCommanders[0].temperatureReasoningOff).toBe(0.7);
    expect(result.llmCommanders[0].temperatureReasoningOn).toBe(0.6);
  });

  it("defaults to [] when the saved v2 commanders are not parseable", () => {
    const saved = v2ShapedSave();
    saved.llmCommanders = "garbage";
    const result = migrateToCurrent(saved);
    expect(result.llmCommanders).toEqual([]);
  });
});

describe("PersistStore save migration pauseForCommander backfill", () => {
  function commander(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      name: id,
      endpointUrl: "http://localhost:1234/v1",
      token: "",
      modelName: "",
      contextLimit: 32768,
      commanderInstructions: "",
      systemPrompt: "sys",
      requestTimeoutMs: 30000,
      ...extra,
    };
  }

  it("fills a missing pauseForCommander as false and keeps an explicit true", () => {
    const result = migrateToCurrent({
      saveVersion: 4,
      llmCommanders: [
        commander("missing"),
        commander("enabled", { pauseForCommander: true }),
        commander("garbage", { pauseForCommander: "yes" }),
      ],
    });
    expect(result.saveVersion).toBe(4);
    expect(result.llmCommanders.map((entry) => entry.pauseForCommander)).toEqual([false, true, false]);
  });

  it("fills a missing reasoningEnabled as false and keeps an explicit true", () => {
    const result = migrateToCurrent({
      saveVersion: 4,
      llmCommanders: [
        commander("missing"),
        commander("enabled", { reasoningEnabled: true }),
        commander("garbage", { reasoningEnabled: "yes" }),
      ],
    });
    expect(result.saveVersion).toBe(4);
    expect(result.llmCommanders.map((entry) => entry.reasoningEnabled)).toEqual([false, true, false]);
  });

  it("fills a missing decisionIntervalMs as 1000 and rejects values outside 1s–10s", () => {
    const result = migrateToCurrent({
      saveVersion: 4,
      llmCommanders: [
        commander("missing"),
        commander("kept", { decisionIntervalMs: 5000 }),
        commander("low", { decisionIntervalMs: 500 }),
        commander("high", { decisionIntervalMs: 20000 }),
        commander("fraction", { decisionIntervalMs: 1.5 }),
      ],
    });
    expect(result.saveVersion).toBe(4);
    expect(result.llmCommanders.map((entry) => entry.decisionIntervalMs)).toEqual([1000, 5000, 1000, 1000, 1000]);
  });

  it("fills missing temperatures with 0.7/0.6 defaults and rejects values outside 0–2", () => {
    const result = migrateToCurrent({
      saveVersion: 4,
      llmCommanders: [
        commander("missing"),
        commander("kept", { temperatureReasoningOff: 1.2, temperatureReasoningOn: 0.3 }),
        commander("high", { temperatureReasoningOff: 9, temperatureReasoningOn: -1 }),
        commander("garbage", { temperatureReasoningOff: "hot", temperatureReasoningOn: null }),
      ],
    });
    expect(result.saveVersion).toBe(4);
    expect(result.llmCommanders.map((entry) => entry.temperatureReasoningOff)).toEqual([0.7, 1.2, 0.7, 0.7]);
    expect(result.llmCommanders.map((entry) => entry.temperatureReasoningOn)).toEqual([0.6, 0.3, 0.6, 0.6]);
  });
});
