// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { SELL_OPTION_GEM_COST } from "@/sim/Constants.js";
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

  it("bumps saveVersion to 7", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.saveVersion).toBe(7);
  });

  it("backfills llmCommanders as an empty array (no data loss of the new field)", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(Array.isArray(result.llmCommanders)).toBe(true);
    expect(result.llmCommanders).toEqual([]);
  });

  it("backfills progressive map preferences (no data loss of the new fields)", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.progressiveMapRegion).toBe(1);
    expect(result.progressiveMapLevel).toBe(1);
    expect(result.progressiveMapEntries).toBe(1);
    expect(result.progressiveMapSeed).toBeNull();
  });

  it("preserves top-level v2 fields through the deep merge", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.gems).toBe(1234);
    expect(result.themeProgress.default.highestUnlockedMap).toBe(5);
    expect(result.themeProgress.default.bestWaves).toEqual({ best_3: 45 });
    expect(result.activeWaves).toEqual({ "default:0": 12 });
    expect(result.runHistory).toEqual([]);
    expect(result.lastSelectedThemeId).toBe("default");
  });

  it("preserves nested v2 fields (difficulty, generalAddons, unlocked)", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.difficulty.multiplierTick).toBe(4);
    expect(result.generalAddons.extraHealth).toBe(10);
    expect(result.unlocked.basic.levels[0]).toBe(true);
    expect(result.unlocked.basic.levels[2]).toBe(false);
  });

  it("moves v2 map progress into the default world bucket", () => {
    const result = migrateToCurrent(v2ShapedSave());
    expect(result.themeProgress.default.firstTimeMilestones).toEqual({ "5_20": true });
    expect(result.themeProgress.default.firstClears).toEqual({ "7": true });
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
    expect(result.saveVersion).toBe(7);
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
    expect(result.saveVersion).toBe(7);
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
    expect(result.saveVersion).toBe(7);
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
    expect(result.saveVersion).toBe(7);
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
    expect(result.saveVersion).toBe(7);
    expect(result.llmCommanders.map((entry) => entry.temperatureReasoningOff)).toEqual([0.7, 1.2, 0.7, 0.7]);
    expect(result.llmCommanders.map((entry) => entry.temperatureReasoningOn)).toEqual([0.6, 0.3, 0.6, 0.6]);
  });
});

describe("PersistStore save migration lastSelectedMapIndex backfill", () => {
  it("migrates a v4 save to 7 and fills lastSelectedMapIndex as null when omitted", () => {
    const result = migrateToCurrent({ saveVersion: 4, gems: 10 });
    expect(result.saveVersion).toBe(7);
    expect(result.lastSelectedMapIndex).toBeNull();
  });

  it("keeps a saved lastSelectedMapIndex", () => {
    const result = migrateToCurrent({ saveVersion: 4, gems: 10, lastSelectedMapIndex: 15 });
    expect(result.saveVersion).toBe(7);
    expect(result.lastSelectedMapIndex).toBe(15);
  });
});

describe("PersistStore save migration progressiveThirdChoice backfill", () => {
  it("migrates a v4 save to 7 and fills progressiveThirdChoice when omitted", () => {
    const result = migrateToCurrent({ saveVersion: 4, gems: 10, generalAddons: { extraHealth: null } });
    expect(result.saveVersion).toBe(7);
    expect(result.generalAddons.progressiveThirdChoice).toBeNull();
    expect(result.generalAddons.extraHealth).toBeNull();
  });
});

describe("PersistStore save migration v4 -> v5", () => {
  function v4ShapedSave(): Record<string, unknown> {
    return {
      saveVersion: 4,
      gems: 77,
      highestUnlockedMap: 9,
      bestWaves: { best_2: 30 },
      firstTimeMilestones: { "1_15": true },
      firstClears: { "4": true },
      activeWaves: { 0: 7 },
      lastSelectedThemeId: "default",
    };
  }

  it("bumps saveVersion to 7", () => {
    const result = migrateToCurrent(v4ShapedSave());
    expect(result.saveVersion).toBe(7);
  });

  it("moves top-level map progress into the default world bucket", () => {
    const result = migrateToCurrent(v4ShapedSave());
    expect(result.themeProgress.default.highestUnlockedMap).toBe(9);
    expect(result.themeProgress.default.bestWaves).toEqual({ best_2: 30 });
    expect(result.themeProgress.default.firstTimeMilestones).toEqual({ "1_15": true });
    expect(result.themeProgress.default.firstClears).toEqual({ "4": true });
  });

  it("drops the legacy top-level progress fields", () => {
    const result = migrateToCurrent(v4ShapedSave());
    expect(result.highestUnlockedMap).toBeUndefined();
    expect(result.bestWaves).toBeUndefined();
    expect(result.firstTimeMilestones).toBeUndefined();
    expect(result.firstClears).toBeUndefined();
  });

  it("keeps an explicit themeProgress bucket alongside the migrated default", () => {
    const saved = v4ShapedSave();
    saved.themeProgress = {
      aftermath: { highestUnlockedMap: 12, bestWaves: {}, firstTimeMilestones: {}, firstClears: {} },
    };
    const result = migrateToCurrent(saved);
    expect(result.themeProgress.aftermath.highestUnlockedMap).toBe(12);
    expect(result.themeProgress.default.highestUnlockedMap).toBe(9);
  });

  it("keeps shared fields untouched", () => {
    const result = migrateToCurrent(v4ShapedSave());
    expect(result.gems).toBe(77);
    expect(result.activeWaves).toEqual({ "default:0": 7 });
  });

  it("rehomes bare active-wave keys into the default world bucket", () => {
    const saved = v4ShapedSave();
    saved.activeWaves = { 0: 7, "the-aftermath:3": 21 };
    const result = migrateToCurrent(saved);
    expect(result.activeWaves).toEqual({ "default:0": 7, "the-aftermath:3": 21 });
  });
});

describe("PersistStore save migration v5 -> v6", () => {
  it("fills the pre-unlocked short-range base levels when the key is missing", () => {
    const result = migrateToCurrent({ saveVersion: 5, gems: 4 });
    expect(result.saveVersion).toBe(7);
    expect(result.baseUnlocks.levels).toEqual([true, true, false, false, false, false, false]);
  });

  it("keeps an explicit false on the free levels", () => {
    const result = migrateToCurrent({
      saveVersion: 5,
      gems: 4,
      baseUnlocks: { levels: [false, true, true, false, false, false, false] },
    });
    expect(result.baseUnlocks.levels).toEqual([false, true, true, false, false, false, false]);
  });
});

describe("PersistStore save migration v6 -> v7", () => {
  // v6 tracked two independent sell-mode purchase flags. v7 is one purchase with
  // two mutually exclusive positions, carried by sellActive alone.
  function v6ShapedSave(generalAddons: Record<string, unknown>): Record<string, unknown> {
    return { saveVersion: 6, gems: 200, generalAddons };
  }

  it("keeps a single purchase on the mode in effect and refunds nothing", () => {
    const result = migrateToCurrent(
      v6ShapedSave({ sellRefundUnlocked: true, sellDiscountUnlocked: false, sellActive: "refund" }),
    );
    expect(result.saveVersion).toBe(7);
    expect(result.generalAddons.sellActive).toBe("refund");
    expect(result.gems).toBe(200);
  });

  it("collapses two held purchases onto the active mode and refunds the redundant one", () => {
    const result = migrateToCurrent(
      v6ShapedSave({ sellRefundUnlocked: true, sellDiscountUnlocked: true, sellActive: "discount" }),
    );
    expect(result.generalAddons.sellActive).toBe("discount");
    expect(result.gems).toBe(200 + SELL_OPTION_GEM_COST);
  });

  it("keeps the purchase on Full Refund when v6 recorded a flag but no active mode", () => {
    const result = migrateToCurrent(
      v6ShapedSave({ sellRefundUnlocked: false, sellDiscountUnlocked: true, sellActive: null }),
    );
    expect(result.generalAddons.sellActive).toBe("refund");
    expect(result.gems).toBe(200);
  });

  it("leaves an unbought sell option unbought", () => {
    const result = migrateToCurrent(
      v6ShapedSave({ sellRefundUnlocked: false, sellDiscountUnlocked: false, sellActive: null }),
    );
    expect(result.generalAddons.sellActive).toBeNull();
    expect(result.gems).toBe(200);
  });

  it("drops the v6 flag keys so they stop riding along in the save", () => {
    const result = migrateToCurrent(
      v6ShapedSave({ sellRefundUnlocked: true, sellDiscountUnlocked: true, sellActive: "refund" }),
    );
    expect(result.generalAddons).not.toHaveProperty("sellRefundUnlocked");
    expect(result.generalAddons).not.toHaveProperty("sellDiscountUnlocked");
  });

  it("leaves the other general addons untouched", () => {
    const result = migrateToCurrent(
      v6ShapedSave({ extraHealth: 2, sellRefundUnlocked: true, sellDiscountUnlocked: false, sellActive: "refund" }),
    );
    expect(result.generalAddons.extraHealth).toBe(2);
  });
});
