// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPersistStore } from "../helpers/mock-stores";

describe("PersistStore", () => {
  let store: ReturnType<typeof createTestPersistStore>;

  beforeEach(() => {
    localStorage.setItem = vi.fn();
    localStorage.getItem = vi.fn().mockReturnValue(null);
    localStorage.removeItem = vi.fn();
    store = createTestPersistStore();
  });

  describe("initial state", () => {
    it("starts with 0 gems", () => {
      expect(store.gems).toBe(0);
    });

    it("starts with an empty themeProgress record", () => {
      expect(store.themeProgress).toEqual({});
    });

    it("returns a blank progress bucket for an unknown world", () => {
      expect(store.getThemeProgress("default")).toEqual({
        highestUnlockedMap: 0,
        bestWaves: {},
        firstTimeMilestones: {},
        firstClears: {},
      });
    });

    it("starts with default difficulty tick 0", () => {
      expect(store.difficulty.multiplierTick).toBe(0);
    });

    it("starts with default lastSelectedThemeId and a null lastSelectedMapIndex", () => {
      expect(store.lastSelectedThemeId).toBe("default");
      expect(store.lastSelectedMapIndex).toBeNull();
    });

    it("starts with all general addons null", () => {
      expect(store.generalAddons.extraHealth).toBeNull();
      expect(store.generalAddons.startingGold).toBeNull();
      expect(store.generalAddons.upgradeCostReduction).toBeNull();
      expect(store.generalAddons.terrainHeightBonus).toBeNull();
      expect(store.generalAddons.damageMilestoneBonus).toBeNull();
      expect(store.generalAddons.slowHealing).toBeNull();
      expect(store.generalAddons.progressiveThirdChoice).toBeNull();
    });

    it("has all expected general addon keys in default state", () => {
      const expectedKeys = [
        "extraHealth",
        "startingGold",
        "sellRefundUnlocked",
        "sellDiscountUnlocked",
        "sellActive",
        "upgradeCostReduction",
        "terrainHeightBonus",
        "damageMilestoneBonus",
        "slowHealing",
        "progressiveThirdChoice",
      ];
      for (const key of expectedKeys) {
        expect(store.generalAddons).toHaveProperty(key);
      }
    });

    it("starts with all tower levels 1-2 unlocked", () => {
      for (const towerId of Object.keys(store.unlocked)) {
        expect(store.unlocked[towerId].levels[0]).toBe(true);
        expect(store.unlocked[towerId].levels[1]).toBe(true);
        expect(store.unlocked[towerId].levels[2]).toBe(false);
      }
    });
  });

  describe("difficultyMultiplier getter", () => {
    it("returns 1.0 when tick is 0", () => {
      expect(store.difficultyMultiplier).toBe(1.0);
    });

    it("returns 1.25 when tick is 1", () => {
      store.setDifficultyTick(1);
      expect(store.difficultyMultiplier).toBeCloseTo(1.25, 4);
    });

    it("returns 2.0 when tick is 4", () => {
      store.setDifficultyTick(4);
      expect(store.difficultyMultiplier).toBeCloseTo(2.0, 4);
    });

    it("returns 4.0 when tick is 12 (max)", () => {
      store.setDifficultyTick(12);
      expect(store.difficultyMultiplier).toBeCloseTo(4.0, 4);
    });

    it("formula is tick * 0.25 + 1", () => {
      for (let tick = 0; tick <= 12; tick++) {
        store.setDifficultyTick(tick);
        const expected = tick * 0.25 + 1;
        expect(store.difficultyMultiplier).toBeCloseTo(expected, 4);
      }
    });
  });

  describe("setDifficultyTick / getDifficultyTick", () => {
    it("stores and retrieves the tick value", () => {
      store.setDifficultyTick(6);
      expect(store.getDifficultyTick()).toBe(6);
    });

    it("persists via save()", () => {
      store.setDifficultyTick(3);
      expect(store.difficulty.multiplierTick).toBe(3);
    });
  });

  describe("soundEnabled", () => {
    it("starts with sound enabled", () => {
      expect(store.soundEnabled).toBe(true);
    });

    it("toggleSoundEnabled flips the flag and persists via save()", () => {
      store.toggleSoundEnabled();
      expect(store.soundEnabled).toBe(false);
      expect(localStorage.setItem).toHaveBeenCalled();
      store.toggleSoundEnabled();
      expect(store.soundEnabled).toBe(true);
    });

    it("survives a save/load round-trip", () => {
      store.toggleSoundEnabled();
      store.save();
      const persisted = JSON.parse((localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0]![1]);
      expect(persisted.soundEnabled).toBe(false);
      localStorage.getItem = vi.fn().mockReturnValue(JSON.stringify(persisted));
      store.load();
      expect(store.soundEnabled).toBe(false);
    });

    it("backfills enabled from defaults for pre-sound saves", () => {
      store.save();
      const persisted = JSON.parse((localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0]![1]);
      delete persisted.soundEnabled;
      localStorage.getItem = vi.fn().mockReturnValue(JSON.stringify(persisted));
      store.load();
      expect(store.soundEnabled).toBe(true);
    });
  });

  describe("updateBestWave", () => {
    it("stores best wave for a map", () => {
      store.updateBestWave("default", 0, 10);
      expect(store.themeProgress.default.bestWaves.best_0).toBe(10);
    });

    it("only improves (does not lower) the best wave", () => {
      store.updateBestWave("default", 0, 10);
      store.updateBestWave("default", 0, 5);
      expect(store.themeProgress.default.bestWaves.best_0).toBe(10);
    });

    it("updates when new wave is higher", () => {
      store.updateBestWave("default", 0, 10);
      store.updateBestWave("default", 0, 15);
      expect(store.themeProgress.default.bestWaves.best_0).toBe(15);
    });

    it("handles different maps independently", () => {
      store.updateBestWave("default", 0, 10);
      store.updateBestWave("default", 1, 20);
      expect(store.themeProgress.default.bestWaves.best_0).toBe(10);
      expect(store.themeProgress.default.bestWaves.best_1).toBe(20);
    });

    it("keeps different worlds independent", () => {
      store.updateBestWave("default", 0, 10);
      store.updateBestWave("aftermath", 0, 30);
      expect(store.themeProgress.default.bestWaves.best_0).toBe(10);
      expect(store.themeProgress.aftermath.bestWaves.best_0).toBe(30);
    });
  });

  describe("maybeUnlockNextMap", () => {
    it("increments highestUnlockedMap", () => {
      store.maybeUnlockNextMap("default", 0);
      expect(store.themeProgress.default.highestUnlockedMap).toBe(1);
    });

    it("does not go beyond map 35", () => {
      store.setHighestUnlockedMap("default", 35);
      store.maybeUnlockNextMap("default", 35);
      expect(store.themeProgress.default.highestUnlockedMap).toBe(35);
    });

    it("does not unlock for negative map index", () => {
      store.maybeUnlockNextMap("default", -1);
      expect(store.themeProgress.default?.highestUnlockedMap ?? 0).toBe(0);
    });

    it("uses Math.max (does not go backward)", () => {
      store.setHighestUnlockedMap("default", 5);
      store.maybeUnlockNextMap("default", 2);
      expect(store.themeProgress.default.highestUnlockedMap).toBe(5);
    });

    it("keeps different worlds independent", () => {
      store.setHighestUnlockedMap("aftermath", 10);
      store.maybeUnlockNextMap("default", 0);
      expect(store.themeProgress.default.highestUnlockedMap).toBe(1);
      expect(store.themeProgress.aftermath.highestUnlockedMap).toBe(10);
    });
  });

  describe("active waves", () => {
    it("saves and retrieves active wave", () => {
      store.saveActiveWave("default", 0, 15);
      expect(store.activeWaves["default:0"]).toBe(15);
    });

    it("clears active wave on game end", () => {
      store.saveActiveWave("default", 0, 15);
      store.clearActiveWave("default", 0);
      expect(store.activeWaves["default:0"]).toBeUndefined();
    });

    it("handles clearing non-existent wave gracefully", () => {
      expect(() => store.clearActiveWave("default", 99)).not.toThrow();
    });

    it("keeps different worlds independent", () => {
      store.saveActiveWave("default", 0, 15);
      store.saveActiveWave("the-aftermath", 0, 20);
      store.clearActiveWave("default", 0);
      expect(store.activeWaves["default:0"]).toBeUndefined();
      expect(store.activeWaves["the-aftermath:0"]).toBe(20);
    });
  });

  describe("first-time milestones", () => {
    it("returns false before marking (not yet claimed)", () => {
      expect(store.hasClaimedMilestone("default", 0, 15)).toBe(false);
    });

    it("returns true after marking", () => {
      store.markFirstTimeMilestone("default", 0, 15);
      expect(store.hasClaimedMilestone("default", 0, 15)).toBe(true);
    });

    it("tracks different maps independently", () => {
      store.markFirstTimeMilestone("default", 0, 15);
      expect(store.hasClaimedMilestone("default", 0, 15)).toBe(true);
      expect(store.hasClaimedMilestone("default", 1, 15)).toBe(false);
    });

    it("tracks different waves independently", () => {
      store.markFirstTimeMilestone("default", 0, 15);
      expect(store.hasClaimedMilestone("default", 0, 15)).toBe(true);
      expect(store.hasClaimedMilestone("default", 0, 30)).toBe(false);
    });

    it("keeps different worlds independent", () => {
      store.markFirstTimeMilestone("default", 0, 15);
      expect(store.hasClaimedMilestone("default", 0, 15)).toBe(true);
      expect(store.hasClaimedMilestone("aftermath", 0, 15)).toBe(false);
    });
  });

  describe("first clears", () => {
    it("returns false before marking (not yet cleared)", () => {
      expect(store.hasCleared("default", 0)).toBe(false);
    });

    it("returns true after marking", () => {
      store.markFirstClear("default", 0);
      expect(store.hasCleared("default", 0)).toBe(true);
    });

    it("tracks different maps independently", () => {
      store.markFirstClear("default", 0);
      expect(store.hasCleared("default", 0)).toBe(true);
      expect(store.hasCleared("default", 1)).toBe(false);
    });

    it("keeps different worlds independent", () => {
      store.markFirstClear("default", 0);
      expect(store.hasCleared("default", 0)).toBe(true);
      expect(store.hasCleared("aftermath", 0)).toBe(false);
    });
  });

  describe("save / load", () => {
    it("save writes to localStorage", () => {
      store.gems = 100;
      store.save();
      expect((localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    it("load restores from localStorage", () => {
      const testData = { gems: 50, highestUnlockedMap: 3 };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(testData)); // STORAGE_KEY
      store.load();
      expect(store.gems).toBe(50);
      expect(store.themeProgress.default.highestUnlockedMap).toBe(3);
    });

    it("load merges with defaults for missing fields", () => {
      const testData = { gems: 50 };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(testData)); // STORAGE_KEY
      store.load();
      expect(store.gems).toBe(50);
      expect(store.themeProgress.default).toEqual({
        highestUnlockedMap: 0,
        bestWaves: {},
        firstTimeMilestones: {},
        firstClears: {},
      });
    });

    it("reset restores default state", () => {
      store.gems = 999;
      store.setDifficultyTick(6);
      store.reset();
      expect(store.gems).toBe(0);
      expect(store.difficulty.multiplierTick).toBe(0);
    });
  });

  describe("schema migration on load", () => {
    it("includes saveVersion in default state", () => {
      expect(store.saveVersion).toBe(6);
    });

    it("migrates v1 data (no saveVersion) to current (v6)", () => {
      const oldData = { gems: 100, highestUnlockedMap: 5 };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(oldData)); // STORAGE_KEY
      store.load();
      expect(store.saveVersion).toBe(6);
      expect(store.gems).toBe(100);
      expect(store.baseUnlocks.levels).toEqual([true, true, false, false, false, false, false]);
      expect(store.themeProgress.default.highestUnlockedMap).toBe(5);
      expect(store.difficulty.multiplierTick).toBe(0);
      expect(store.generalAddons.extraHealth).toBeNull();
    });

    it("migrates v1 data with explicit saveVersion: 1", () => {
      const v1Data = { saveVersion: 1, gems: 200, bestWaves: { best_3: 45 } };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(v1Data)); // STORAGE_KEY
      store.load();
      expect(store.saveVersion).toBe(6);
      expect(store.gems).toBe(200);
      expect(store.themeProgress.default.bestWaves.best_3).toBe(45);
    });

    it("loads v2 data and migrates forward to current (v6)", () => {
      const v2Data = {
        saveVersion: 2,
        gems: 300,
        difficulty: { multiplierTick: 4 },
        generalAddons: {
          extraHealth: 10,
          startingGold: null,
          sellRefundUnlocked: false,
          sellDiscountUnlocked: false,
          sellActive: null,
          upgradeCostReduction: null,
          terrainHeightBonus: null,
          damageMilestoneBonus: null,
          slowHealing: null,
        },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(v2Data)); // STORAGE_KEY
      store.load();
      expect(store.saveVersion).toBe(6);
      expect(store.gems).toBe(300);
      expect(store.difficulty.multiplierTick).toBe(4);
      expect(store.generalAddons.extraHealth).toBe(10);
    });

    it("migrates a v3 commander without a timeout to 30000", () => {
      const v3Data = {
        saveVersion: 3,
        gems: 1,
        llmCommanders: [
          {
            id: "l_old",
            name: "Old",
            endpointUrl: "http://localhost/v1",
            token: "",
            modelName: "",
            contextLimit: 32768,
            commanderInstructions: "",
            systemPrompt: "sys",
          },
        ],
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(JSON.stringify(v3Data));
      store.load();
      expect(store.saveVersion).toBe(6);
      expect(store.llmCommanders[0]?.requestTimeoutMs).toBe(30000);
      expect(store.llmCommanders[0]?.decisionIntervalMs).toBe(1000);
      expect(store.llmCommanders[0]?.name).toBe("Old");
    });

    it("best-effort migrates on unknown future version", () => {
      const futureData = { saveVersion: 99, gems: 9999 };
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(futureData)); // STORAGE_KEY
      store.load();
      expect(store.gems).toBe(9999);
      expect(store.saveVersion).toBe(99);
      expect(warnSpy).toHaveBeenCalledWith("Unknown save version 99, best-effort migrating to current");
      warnSpy.mockRestore();
    });

    it("fills missing nested fields with defaults during migration", () => {
      const v1Data = { gems: 50, generalAddons: { extraHealth: 15 } };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(v1Data)); // STORAGE_KEY
      store.load();
      expect(store.gems).toBe(50);
      expect(store.generalAddons.extraHealth).toBe(15);
      expect(store.generalAddons.startingGold).toBeNull();
      expect(store.generalAddons.sellRefundUnlocked).toBe(false);
      expect(store.generalAddons.slowHealing).toBeNull();
      expect(store.generalAddons.progressiveThirdChoice).toBeNull();
    });

    it("preserves saved nested values over defaults during migration", () => {
      const v1Data = {
        gems: 50,
        difficulty: { multiplierTick: 6 },
        bestWaves: { best_10: 88 },
        firstTimeMilestones: { "5_20": true },
        firstClears: { "7": true },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(v1Data)); // STORAGE_KEY
      store.load();
      expect(store.difficulty.multiplierTick).toBe(6);
      expect(store.themeProgress.default.bestWaves.best_10).toBe(88);
      expect(store.themeProgress.default.firstTimeMilestones["5_20"]).toBe(true);
      expect(store.themeProgress.default.firstClears["7"]).toBe(true);
      expect(store.themeProgress.default.bestWaves.best_0).toBeUndefined();
    });

    it("handles corrupted save by resetting", () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce("not json");
      expect(() => store.load()).not.toThrow();
      expect(store.gems).toBe(0);
    });

    it("handles null/undefined save gracefully", () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
      expect(() => store.load()).not.toThrow();
      expect(store.gems).toBe(0);
    });
  });

  describe("key migration", () => {
    it("migrates data from old key to new key", () => {
      const oldData = { gems: 100, highestUnlockedMap: 5 };
      const migratedData = {
        saveVersion: 2,
        gems: 100,
        highestUnlockedMap: 5,
        difficulty: { multiplierTick: 0 },
        generalAddons: {
          extraHealth: null,
          startingGold: null,
          sellRefundUnlocked: false,
          sellDiscountUnlocked: false,
          sellActive: null,
          upgradeCostReduction: null,
          terrainHeightBonus: null,
          damageMilestoneBonus: null,
          slowHealing: null,
        },
        bestWaves: {},
        firstTimeMilestones: {},
        firstClears: {},
        runHistory: [],
        unlocked: {
          basic: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          ice: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          sniper: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          cannon: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          lightning: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          railgun: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
        },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(JSON.stringify(oldData)) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(migratedData)); // STORAGE_KEY (after migration)
      store.load();
      expect(store.gems).toBe(100);
      expect(store.themeProgress.default.highestUnlockedMap).toBe(5);
      expect((localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("lol_ya_tdg_save_1");
      expect((localStorage.removeItem as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("gempath_save_v1");
    });

    it("deletes old key after migration", () => {
      const oldData = { gems: 50 };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(JSON.stringify(oldData))
        .mockReturnValueOnce(null);
      store.load();
      expect((localStorage.removeItem as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect((localStorage.removeItem as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("gempath_save_v1");
    });

    it("ignores corrupted old key and loads fresh", () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("not json") // OLD_STORAGE_KEY - corrupted
        .mockReturnValueOnce(null); // STORAGE_KEY - empty
      expect(() => store.load()).not.toThrow();
      expect(store.gems).toBe(0);
    });

    it("does not touch old key when it does not exist", () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
      store.load();
      expect((localStorage.removeItem as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    });

    it("storage key has no version suffix", () => {
      store.save();
      expect((localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain("_v");
    });
  });

  describe("nested array merge on load", () => {
    it("fills missing levels indices with false when save has fewer than 7 entries", () => {
      const oldData = {
        gems: 10,
        unlocked: {
          basic: {
            levels: [true, true, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
        },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(oldData)); // STORAGE_KEY
      store.load();
      expect(store.unlocked.basic.levels.length).toBe(7);
      expect(store.unlocked.basic.levels[0]).toBe(true);
      expect(store.unlocked.basic.levels[1]).toBe(true);
      expect(store.unlocked.basic.levels[2]).toBe(false);
      expect(store.unlocked.basic.levels[3]).toBe(false);
      expect(store.unlocked.basic.levels[6]).toBe(false);
    });

    it("preserves levels beyond default length when save has more than 7 entries", () => {
      const data = {
        gems: 10,
        unlocked: {
          basic: {
            levels: [true, true, true, true, true, true, true, true],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
        },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(data)); // STORAGE_KEY
      store.load();
      expect(store.unlocked.basic.levels.length).toBe(8);
      expect(store.unlocked.basic.levels[7]).toBe(true);
    });

    it("fills missing variantA/variantB/addons indices with false", () => {
      const data = {
        gems: 10,
        unlocked: {
          basic: {
            levels: [true, true, false, false, false, false, false],
            variantA: [true],
            variantB: [false, false],
            addons: [false, true, false],
          },
        },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(data)); // STORAGE_KEY
      store.load();
      expect(store.unlocked.basic.variantA.length).toBe(3);
      expect(store.unlocked.basic.variantA[0]).toBe(true);
      expect(store.unlocked.basic.variantA[1]).toBe(false);
      expect(store.unlocked.basic.variantA[2]).toBe(false);
      expect(store.unlocked.basic.variantB.length).toBe(3);
      expect(store.unlocked.basic.variantB[0]).toBe(false);
      expect(store.unlocked.basic.variantB[1]).toBe(false);
      expect(store.unlocked.basic.variantB[2]).toBe(false);
      expect(store.unlocked.basic.addons[0]).toBe(false);
      expect(store.unlocked.basic.addons[1]).toBe(true);
      expect(store.unlocked.basic.addons[2]).toBe(false);
    });

    it("preserves saved unlock values over defaults", () => {
      const data = {
        gems: 10,
        unlocked: {
          basic: {
            levels: [false, false, true, true, true, true, true],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
        },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(data)); // STORAGE_KEY
      store.load();
      expect(store.unlocked.basic.levels[0]).toBe(false);
      expect(store.unlocked.basic.levels[1]).toBe(false);
      expect(store.unlocked.basic.levels[2]).toBe(true);
    });

    it("merges arrays element-by-element across all tower types", () => {
      const data = {
        gems: 10,
        unlocked: {
          basic: {
            levels: [true, true, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          ice: {
            levels: [true, true, true, true, true, true, true],
            variantA: [true, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          sniper: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          cannon: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          lightning: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
          railgun: {
            levels: [true, true, false, false, false, false, false],
            variantA: [false, false, false],
            variantB: [false, false, false],
            addons: [false, false, false],
          },
        },
      };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // OLD_STORAGE_KEY
        .mockReturnValueOnce(JSON.stringify(data)); // STORAGE_KEY
      store.load();
      expect(store.unlocked.basic.levels.length).toBe(7);
      expect(store.unlocked.ice.levels.length).toBe(7);
      expect(store.unlocked.ice.levels[6]).toBe(true);
      for (const towerId of Object.keys(store.unlocked)) {
        expect(store.unlocked[towerId].levels.length).toBe(7);
        expect(store.unlocked[towerId].variantA.length).toBe(3);
        expect(store.unlocked[towerId].variantB.length).toBe(3);
        expect(store.unlocked[towerId].addons.length).toBe(3);
      }
    });
  });

  describe("llmCommanders CRUD", () => {
    function sampleConfig(overrides: Record<string, unknown> = {}) {
      return {
        id: "l_1",
        name: "Test LLM",
        endpointUrl: "http://localhost:11434/v1",
        token: "",
        modelName: "",
        contextLimit: 32768,
        commanderInstructions: "",
        systemPrompt: "sys",
        requestTimeoutMs: 30000,
        pauseForCommander: false,
        decisionIntervalMs: 1000,
        reasoningEnabled: false,
        ...overrides,
      };
    }

    it("starts with an empty llmCommanders list", () => {
      expect(store.llmCommanders).toEqual([]);
    });

    it("addLlmCommander appends and persists", () => {
      store.addLlmCommander(sampleConfig());
      expect(store.llmCommanders.length).toBe(1);
      expect((localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    it("updateLlmCommander replaces the matching entry and persists", () => {
      store.addLlmCommander(sampleConfig({ name: "Original" }));
      store.updateLlmCommander(sampleConfig({ name: "Updated" }));
      expect(store.llmCommanders.length).toBe(1);
      expect(store.llmCommanders[0].name).toBe("Updated");
    });

    it("updateLlmCommander is a no-op when id is unknown", () => {
      store.updateLlmCommander(sampleConfig());
      expect(store.llmCommanders.length).toBe(0);
    });

    it("deleteLlmCommander removes the matching entry and persists", () => {
      store.addLlmCommander(sampleConfig({ id: "l_1" }));
      store.addLlmCommander(sampleConfig({ id: "l_2" }));
      store.deleteLlmCommander("l_1");
      expect(store.llmCommanders.map((entry) => entry.id)).toEqual(["l_2"]);
    });

    it("persists llmCommanders through save/load round-trip", () => {
      store.addLlmCommander(sampleConfig());
      const saved = { gems: 5, llmCommanders: store.llmCommanders };
      (localStorage.getItem as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(JSON.stringify(saved));
      const fresh = createTestPersistStore();
      fresh.load();
      expect(fresh.llmCommanders.length).toBe(1);
      expect(fresh.llmCommanders[0].id).toBe("l_1");
    });
  });
});
