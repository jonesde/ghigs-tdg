import { defineStore } from "pinia";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
  MAX_REQUEST_TIMEOUT_MS,
  MIN_REQUEST_TIMEOUT_MS,
  normalizeDecisionIntervalMs,
  normalizeTemperature,
} from "@/commanders/llm/types.js";
import { PersistStateSchema } from "@/content/schemas/persist.js";
import { DEFAULT_THEME_ID } from "@/render/themes/index.js";
import { useUiStore } from "@/stores/ui.js";

const OLD_STORAGE_KEY = "gempath_save_v1";
export const STORAGE_KEY = "lol_ya_tdg_save_1";
const CURRENT_SAVE_VERSION = 5;

export interface TowerUnlocks {
  levels: boolean[];
  variantA: boolean[];
  variantB: boolean[];
  addons: boolean[];
}

// Map-keyed progress for one world (theme). Save v5 moved these out of the
// top level so each theme keeps its own campaign state; gems, difficulty, and
// skill-tree unlocks stay shared across worlds.
export interface ThemeProgress {
  highestUnlockedMap: number;
  bestWaves: Record<string, number>;
  firstTimeMilestones: Record<string, boolean>;
  firstClears: Record<string, boolean>;
}

export interface GeneralAddons {
  extraHealth: number | null;
  startingGold: number | null;
  sellRefundUnlocked: boolean;
  sellDiscountUnlocked: boolean;
  sellActive: string | null;
  upgradeCostReduction: number | null;
  terrainHeightBonus: number | null;
  terrainHeightRangeBonus: number | null;
  damageMilestoneBonus: number | null;
  slowHealing: number | null;
  progressiveThirdChoice: number | null;
  [key: string]: number | null | boolean | string;
}

interface PersistStateShape {
  saveVersion: number;
  gems: number;
  themeProgress: Record<string, ThemeProgress>;
  activeWaves: Record<string, number>;
  difficulty: { multiplierTick: number };
  generalAddons: GeneralAddons;
  unlocked: Record<string, TowerUnlocks>;
  runHistory: unknown[];
  randomMapRegion: number;
  randomMapLevel: number;
  randomMapStyle: string;
  randomMapSeed: number | null;
  randomMapWidth: number;
  randomMapHeight: number;
  progressiveMapRegion: number;
  progressiveMapLevel: number;
  progressiveMapEntries: number;
  progressiveMapSeed: number | null;
  lastSelectedThemeId: string;
  lastSelectedMapIndex: number | null;
  llmCommanders: LlmCommanderConfig[];
}

function blankTower(): TowerUnlocks {
  return {
    levels: [true, true, false, false, false, false, false],
    variantA: [false, false, false],
    variantB: [false, false, false],
    addons: [false, false, false],
  };
}

function mergeTowerUnlocks(saved: TowerUnlocks): TowerUnlocks {
  const base = blankTower();
  const merged: TowerUnlocks = { levels: [], variantA: [], variantB: [], addons: [] };
  for (const key of ["levels", "variantA", "variantB", "addons"] as const) {
    const baseArr = base[key];
    const savedArr = saved[key] ?? [];
    const length = Math.max(baseArr.length, savedArr.length);
    for (let i = 0; i < length; i++) {
      merged[key][i] = savedArr[i] ?? baseArr[i] ?? false;
    }
  }
  return merged;
}

function defaultUnlocked(): Record<string, TowerUnlocks> {
  return {
    basic: blankTower(),
    ice: blankTower(),
    sniper: blankTower(),
    cannon: blankTower(),
    lightning: blankTower(),
    railgun: blankTower(),
    sturdyWall: blankTower(),
    shotgunTank: blankTower(),
  };
}

function defaultGeneralAddons(): GeneralAddons {
  return {
    extraHealth: null,
    startingGold: null,
    sellRefundUnlocked: false,
    sellDiscountUnlocked: false,
    sellActive: null,
    upgradeCostReduction: null,
    terrainHeightBonus: null,
    terrainHeightRangeBonus: null,
    damageMilestoneBonus: null,
    slowHealing: null,
    progressiveThirdChoice: null,
  };
}

function blankThemeProgress(): ThemeProgress {
  return { highestUnlockedMap: 0, bestWaves: {}, firstTimeMilestones: {}, firstClears: {} };
}

function defaultState(): PersistStateShape {
  return {
    saveVersion: CURRENT_SAVE_VERSION,
    gems: 0,
    themeProgress: {},
    activeWaves: {},
    difficulty: { multiplierTick: 0 },
    generalAddons: defaultGeneralAddons(),
    unlocked: defaultUnlocked(),
    runHistory: [],
    randomMapRegion: 1,
    randomMapLevel: 1,
    randomMapStyle: "open",
    randomMapSeed: null,
    randomMapWidth: 20,
    randomMapHeight: 20,
    progressiveMapRegion: 1,
    progressiveMapLevel: 1,
    progressiveMapEntries: 1,
    progressiveMapSeed: null,
    lastSelectedThemeId: "default",
    lastSelectedMapIndex: null,
    llmCommanders: [],
  };
}

function mergeWithDefaults<T>(defaults: T, parsed: unknown): T {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return { ...defaults, ...(parsed as Record<string, unknown>) } as T;
  }
  return defaults;
}

function generateCommanderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `l_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function fillCommanderTimeouts(commanders: unknown): LlmCommanderConfig[] {
  if (!Array.isArray(commanders)) return [];
  const filled: LlmCommanderConfig[] = [];
  for (const entry of commanders) {
    if (typeof entry !== "object" || entry === null) continue;
    const commander = entry as LlmCommanderConfig;
    const timeout = commander.requestTimeoutMs;
    const requestTimeoutMs =
      typeof timeout === "number" &&
      Number.isInteger(timeout) &&
      timeout >= MIN_REQUEST_TIMEOUT_MS &&
      timeout <= MAX_REQUEST_TIMEOUT_MS
        ? timeout
        : DEFAULT_REQUEST_TIMEOUT_MS;
    const pauseForCommander = commander.pauseForCommander === true;
    const decisionIntervalMs = normalizeDecisionIntervalMs(commander.decisionIntervalMs);
    const reasoningEnabled = commander.reasoningEnabled === true;
    const temperatureReasoningOff = normalizeTemperature(
      commander.temperatureReasoningOff,
      DEFAULT_TEMPERATURE_REASONING_OFF,
    );
    const temperatureReasoningOn = normalizeTemperature(
      commander.temperatureReasoningOn,
      DEFAULT_TEMPERATURE_REASONING_ON,
    );
    filled.push({
      ...commander,
      requestTimeoutMs,
      pauseForCommander,
      decisionIntervalMs,
      reasoningEnabled,
      temperatureReasoningOff,
      temperatureReasoningOn,
    });
  }
  return filled;
}

// Save v4 and earlier kept map progress at the top level. Pre-world saves are
// visual-theme-only, so that progress belongs to the default world's bucket.
function legacyThemeProgress(parsed: Record<string, unknown>): ThemeProgress {
  const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    highestUnlockedMap: typeof parsed.highestUnlockedMap === "number" ? parsed.highestUnlockedMap : 0,
    bestWaves: asRecord(parsed.bestWaves) as Record<string, number>,
    firstTimeMilestones: asRecord(parsed.firstTimeMilestones) as Record<string, boolean>,
    firstClears: asRecord(parsed.firstClears) as Record<string, boolean>,
  };
}

// Combines the legacy top-level progress (v4 and earlier) with any per-theme
// buckets already present (v5). Saved buckets win over the legacy fallback so a
// hand-edited save carrying both keeps its explicit theme data.
function mergedThemeProgress(parsed: Record<string, unknown>): Record<string, ThemeProgress> {
  const result: Record<string, ThemeProgress> = { [DEFAULT_THEME_ID]: legacyThemeProgress(parsed) };
  const saved = parsed.themeProgress;
  if (typeof saved === "object" && saved !== null && !Array.isArray(saved)) {
    for (const [themeId, bucket] of Object.entries(saved as Record<string, unknown>)) {
      if (typeof bucket !== "object" || bucket === null) continue;
      result[themeId] = mergeWithDefaults(blankThemeProgress(), bucket);
    }
  }
  return result;
}

// Bare numeric keys ("0", "-1") predate per-world resume state; they resolve to
// the default world's bucket. Explicit "themeId:index" keys pass through.
function migrateActiveWaves(saved: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return result;
  for (const [key, wave] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof wave !== "number") continue;
    result[key.includes(":") ? key : `${DEFAULT_THEME_ID}:${key}`] = wave;
  }
  return result;
}

function stripLegacyProgressFields(shape: PersistStateShape): void {
  const record = shape as unknown as Record<string, unknown>;
  delete record.highestUnlockedMap;
  delete record.bestWaves;
  delete record.firstTimeMilestones;
  delete record.firstClears;
}

function migrateV1ToV2(parsed: Record<string, unknown>): PersistStateShape {
  const defaults = defaultState();
  const result: PersistStateShape = { ...defaults, ...parsed, saveVersion: CURRENT_SAVE_VERSION };
  result.difficulty = mergeWithDefaults(defaults.difficulty, parsed.difficulty);
  result.generalAddons = mergeWithDefaults(defaults.generalAddons, parsed.generalAddons);
  result.themeProgress = mergedThemeProgress(parsed);
  result.activeWaves = migrateActiveWaves(parsed.activeWaves);
  stripLegacyProgressFields(result);
  result.runHistory = Array.isArray(parsed.runHistory) ? parsed.runHistory : defaults.runHistory;
  result.unlocked = mergeWithDefaults(defaults.unlocked, parsed.unlocked) as Record<string, TowerUnlocks>;
  for (const towerId of Object.keys(defaults.unlocked)) {
    if (result.unlocked[towerId]) {
      result.unlocked[towerId] = mergeTowerUnlocks(result.unlocked[towerId]);
    }
  }
  result.llmCommanders = fillCommanderTimeouts(result.llmCommanders);
  return result;
}

function migrateCurrentVersion(parsed: Record<string, unknown>): PersistStateShape {
  const defaults = defaultState();
  const result: PersistStateShape = { ...defaults, ...parsed };
  result.difficulty = mergeWithDefaults(defaults.difficulty, parsed.difficulty);
  result.generalAddons = mergeWithDefaults(defaults.generalAddons, parsed.generalAddons);
  result.themeProgress = mergedThemeProgress(parsed);
  result.activeWaves = migrateActiveWaves(parsed.activeWaves);
  stripLegacyProgressFields(result);
  result.runHistory = Array.isArray(parsed.runHistory) ? parsed.runHistory : defaults.runHistory;
  result.unlocked = mergeWithDefaults(defaults.unlocked, parsed.unlocked) as Record<string, TowerUnlocks>;
  for (const towerId of Object.keys(defaults.unlocked)) {
    if (result.unlocked[towerId]) {
      result.unlocked[towerId] = mergeTowerUnlocks(result.unlocked[towerId]);
    }
  }
  result.llmCommanders = fillCommanderTimeouts(result.llmCommanders);
  return result;
}

function migrateV2ToV3(parsed: Record<string, unknown>): PersistStateShape {
  const defaults = defaultState();
  const result: PersistStateShape = { ...defaults, ...parsed };
  result.difficulty = mergeWithDefaults(defaults.difficulty, parsed.difficulty);
  result.generalAddons = mergeWithDefaults(defaults.generalAddons, parsed.generalAddons);
  result.themeProgress = mergedThemeProgress(parsed);
  result.activeWaves = migrateActiveWaves(parsed.activeWaves);
  stripLegacyProgressFields(result);
  result.runHistory = Array.isArray(parsed.runHistory) ? parsed.runHistory : defaults.runHistory;
  result.unlocked = mergeWithDefaults(defaults.unlocked, parsed.unlocked) as Record<string, TowerUnlocks>;
  for (const towerId of Object.keys(defaults.unlocked)) {
    if (result.unlocked[towerId]) {
      result.unlocked[towerId] = mergeTowerUnlocks(result.unlocked[towerId]);
    }
  }
  result.llmCommanders = fillCommanderTimeouts(parsed.llmCommanders);
  result.saveVersion = CURRENT_SAVE_VERSION;
  return result;
}

function migrateV3ToV4(parsed: Record<string, unknown>): PersistStateShape {
  const result = migrateCurrentVersion(parsed);
  result.saveVersion = CURRENT_SAVE_VERSION;
  return result;
}

// v4 -> v5: moves the top-level map progress into themeProgress["default"]
// (see legacyThemeProgress) and stamps the new version.
function migrateV4ToV5(parsed: Record<string, unknown>): PersistStateShape {
  const result = migrateCurrentVersion(parsed);
  result.saveVersion = CURRENT_SAVE_VERSION;
  return result;
}

export function migrateToCurrent(parsed: Record<string, unknown>): PersistStateShape {
  const version = parsed.saveVersion;
  if (version === undefined || version === null) {
    return migrateV1ToV2(parsed);
  }
  if (version === 1) {
    return migrateV1ToV2(parsed);
  }
  if (version === 2) {
    return migrateV2ToV3(parsed);
  }
  if (version === 3) {
    return migrateV3ToV4(parsed);
  }
  if (version === 4) {
    return migrateV4ToV5(parsed);
  }
  if (version === CURRENT_SAVE_VERSION) {
    return migrateCurrentVersion(parsed);
  }
  console.warn(`Unknown save version ${version}, best-effort migrating to current`);
  return migrateCurrentVersion(parsed);
}

export const usePersistStore = defineStore("persist", {
  state: () => defaultState(),

  getters: {
    difficultyMultiplier: (state) => {
      const tick = state.difficulty?.multiplierTick || 0;
      return tick * 0.25 + 1;
    },
    getLatestRun: (state) =>
      state.runHistory && state.runHistory.length > 0 ? state.runHistory[state.runHistory.length - 1] : null,
  },

  actions: {
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state));
      } catch {
        const uiStore = useUiStore();
        uiStore.showNotification("Save failed - progress may not be persisted.");
      }
    },

    load() {
      try {
        const oldRawData = localStorage.getItem(OLD_STORAGE_KEY);
        if (oldRawData) {
          try {
            const parsed = JSON.parse(oldRawData);
            const migrated = migrateToCurrent(parsed);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
            localStorage.removeItem(OLD_STORAGE_KEY);
          } catch {
            // Corrupted old save - ignore, proceed with fresh load
          }
        }
        const rawData = localStorage.getItem(STORAGE_KEY);
        if (rawData) {
          try {
            const parsed = JSON.parse(rawData);
            const migrated = migrateToCurrent(parsed);
            // Validate post-migrate shape; soft-fail leaves existing store state.
            const validated = PersistStateSchema.safeParse(migrated);
            if (!validated.success) {
              throw new Error(`Save schema invalid: ${validated.error.message}`);
            }
            this.$state = migrated;
            return;
          } catch (error) {
            // A transient parse/migrate error must not clobber already-loaded
            // good data (store already starts at defaults; a genuinely corrupt
            // save still ends up at defaults via the initial state). Leave the
            // current state untouched.
            const uiStore = useUiStore();
            uiStore.showNotification("Failed to load save - keeping current progress.");
            console.warn("persist.load failed; leaving state unchanged:", error);
            return;
          }
        }
      } catch {
        // Corrupted save - reset
      }
      this.$state = defaultState();
    },

    reset() {
      this.$state = defaultState();
      this.save();
    },

    getDifficultyTick(): number {
      return this.difficulty?.multiplierTick || 0;
    },

    setDifficultyTick(tick: number) {
      this.difficulty = { multiplierTick: tick };
      this.save();
    },

    ensureThemeProgress(themeId: string): ThemeProgress {
      let progress = this.themeProgress[themeId];
      if (!progress) {
        progress = blankThemeProgress();
        this.themeProgress[themeId] = progress;
      }
      return progress;
    },

    getThemeProgress(themeId: string): ThemeProgress {
      return this.themeProgress[themeId] ?? blankThemeProgress();
    },

    setHighestUnlockedMap(themeId: string, index: number) {
      const progress = this.ensureThemeProgress(themeId);
      progress.highestUnlockedMap = Math.max(0, Math.min(index, 35));
      this.save();
    },

    updateBestWave(themeId: string, mapIndex: number, wave: number) {
      const progress = this.ensureThemeProgress(themeId);
      const key = `best_${mapIndex}`;
      const prev = typeof progress.bestWaves[key] === "number" ? progress.bestWaves[key] : 0;
      if (wave > prev) {
        progress.bestWaves[key] = wave;
        this.save();
      }
    },

    maybeUnlockNextMap(themeId: string, mapIndex: number) {
      if (mapIndex >= 0 && mapIndex + 1 < 36) {
        const progress = this.ensureThemeProgress(themeId);
        progress.highestUnlockedMap = Math.max(progress.highestUnlockedMap, mapIndex + 1);
        this.save();
      }
    },

    saveActiveWave(themeId: string, mapIndex: number, wave: number) {
      if (!this.activeWaves) this.activeWaves = {};
      this.activeWaves[`${themeId}:${mapIndex}`] = wave;
      this.save();
    },

    clearActiveWave(themeId: string, mapIndex: number) {
      if (this.activeWaves && mapIndex !== undefined) {
        delete this.activeWaves[`${themeId}:${mapIndex}`];
        this.save();
      }
    },

    addRunToHistory(entry: unknown) {
      if (!this.runHistory) this.runHistory = [];
      this.runHistory.push(entry);
      while (this.runHistory.length > 20) this.runHistory.shift();
      this.save();
    },

    markFirstTimeMilestone(themeId: string, mapIndex: number, wave: number) {
      const progress = this.ensureThemeProgress(themeId);
      const key = `${mapIndex}_${wave}`;
      progress.firstTimeMilestones[key] = true;
      this.save();
    },

    hasClaimedMilestone(themeId: string, mapIndex: number, wave: number): boolean {
      const key = `${mapIndex}_${wave}`;
      return !!this.themeProgress[themeId]?.firstTimeMilestones[key];
    },

    markFirstClear(themeId: string, mapIndex: number) {
      const progress = this.ensureThemeProgress(themeId);
      const key = String(mapIndex);
      progress.firstClears[key] = true;
      this.save();
    },

    hasCleared(themeId: string, mapIndex: number): boolean {
      const key = String(mapIndex);
      return !!this.themeProgress[themeId]?.firstClears[key];
    },

    addLlmCommander(config: LlmCommanderConfig): void {
      this.llmCommanders.push(config);
      this.save();
    },

    updateLlmCommander(config: LlmCommanderConfig): void {
      const index = this.llmCommanders.findIndex((entry) => entry.id === config.id);
      if (index !== -1) {
        this.llmCommanders.splice(index, 1, config);
        this.save();
      }
    },

    deleteLlmCommander(id: string): void {
      this.llmCommanders = this.llmCommanders.filter((entry) => entry.id !== id);
      this.save();
    },

    generateCommanderId(): string {
      return generateCommanderId();
    },
  },
});

export type PersistStore = ReturnType<typeof usePersistStore>;
