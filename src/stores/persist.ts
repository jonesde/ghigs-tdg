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
import { useUiStore } from "@/stores/ui.js";

const OLD_STORAGE_KEY = "gempath_save_v1";
export const STORAGE_KEY = "lol_ya_tdg_save_1";
const CURRENT_SAVE_VERSION = 4;

export interface TowerUnlocks {
  levels: boolean[];
  variantA: boolean[];
  variantB: boolean[];
  addons: boolean[];
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
  [key: string]: number | null | boolean | string;
}

interface PersistStateShape {
  saveVersion: number;
  gems: number;
  highestUnlockedMap: number;
  bestWaves: Record<string, number>;
  activeWaves: Record<string, number>;
  difficulty: { multiplierTick: number };
  firstTimeMilestones: Record<string, boolean>;
  firstClears: Record<string, boolean>;
  generalAddons: GeneralAddons;
  unlocked: Record<string, TowerUnlocks>;
  runHistory: unknown[];
  randomMapRegion: number;
  randomMapLevel: number;
  randomMapStyle: string;
  randomMapSeed: number | null;
  randomMapWidth: number;
  randomMapHeight: number;
  lastSelectedThemeId: string;
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
  };
}

function defaultState(): PersistStateShape {
  return {
    saveVersion: CURRENT_SAVE_VERSION,
    gems: 0,
    highestUnlockedMap: 0,
    bestWaves: {},
    activeWaves: {},
    difficulty: { multiplierTick: 0 },
    firstTimeMilestones: {},
    firstClears: {},
    generalAddons: defaultGeneralAddons(),
    unlocked: defaultUnlocked(),
    runHistory: [],
    randomMapRegion: 1,
    randomMapLevel: 1,
    randomMapStyle: "open",
    randomMapSeed: null,
    randomMapWidth: 20,
    randomMapHeight: 20,
    lastSelectedThemeId: "default",
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

function migrateV1ToV2(parsed: Record<string, unknown>): PersistStateShape {
  const defaults = defaultState();
  const result: PersistStateShape = { ...defaults, ...parsed, saveVersion: CURRENT_SAVE_VERSION };
  result.difficulty = mergeWithDefaults(defaults.difficulty, parsed.difficulty);
  result.generalAddons = mergeWithDefaults(defaults.generalAddons, parsed.generalAddons);
  result.bestWaves = mergeWithDefaults(defaults.bestWaves, parsed.bestWaves);
  result.firstTimeMilestones = mergeWithDefaults(defaults.firstTimeMilestones, parsed.firstTimeMilestones);
  result.firstClears = mergeWithDefaults(defaults.firstClears, parsed.firstClears);
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
  result.bestWaves = mergeWithDefaults(defaults.bestWaves, parsed.bestWaves);
  result.firstTimeMilestones = mergeWithDefaults(defaults.firstTimeMilestones, parsed.firstTimeMilestones);
  result.firstClears = mergeWithDefaults(defaults.firstClears, parsed.firstClears);
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
  result.bestWaves = mergeWithDefaults(defaults.bestWaves, parsed.bestWaves);
  result.firstTimeMilestones = mergeWithDefaults(defaults.firstTimeMilestones, parsed.firstTimeMilestones);
  result.firstClears = mergeWithDefaults(defaults.firstClears, parsed.firstClears);
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

    updateBestWave(mapIndex: number, wave: number) {
      const key = `best_${mapIndex}`;
      const prev = typeof this.bestWaves[key] === "number" ? this.bestWaves[key] : 0;
      if (wave > prev) {
        this.bestWaves[key] = wave;
        this.save();
      }
    },

    maybeUnlockNextMap(mapIndex: number) {
      if (mapIndex >= 0 && mapIndex + 1 < 36) {
        this.highestUnlockedMap = Math.max(this.highestUnlockedMap, mapIndex + 1);
        this.save();
      }
    },

    saveActiveWave(mapIndex: number, wave: number) {
      if (!this.activeWaves) this.activeWaves = {};
      this.activeWaves[mapIndex] = wave;
      this.save();
    },

    clearActiveWave(mapIndex: number) {
      if (this.activeWaves && mapIndex !== undefined) {
        delete this.activeWaves[mapIndex];
        this.save();
      }
    },

    addRunToHistory(entry: unknown) {
      if (!this.runHistory) this.runHistory = [];
      this.runHistory.push(entry);
      while (this.runHistory.length > 20) this.runHistory.shift();
      this.save();
    },

    markFirstTimeMilestone(mapIndex: number, wave: number) {
      const key = `${mapIndex}_${wave}`;
      this.firstTimeMilestones[key] = true;
      this.save();
    },

    hasClaimedMilestone(mapIndex: number, wave: number): boolean {
      const key = `${mapIndex}_${wave}`;
      return !!this.firstTimeMilestones[key];
    },

    markFirstClear(mapIndex: number) {
      const key = String(mapIndex);
      this.firstClears[key] = true;
      this.save();
    },

    hasCleared(mapIndex: number): boolean {
      const key = String(mapIndex);
      return !!this.firstClears[key];
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
