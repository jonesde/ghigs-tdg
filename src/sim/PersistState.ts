import { TOTAL_MAPS } from "@/sim/Constants.js";
import type { BaseUnlocks, GeneralAddons, ThemeProgress, TowerUnlocks } from "@/stores/persist.js";

// Authoritative persist state — ALL fields enumerated explicitly. The
// randomMap* / progressiveMap* / lastSelected* fields aren't written by
// the engine, but they MUST be present so the full PersistState round-trips
// through localStorage correctly.
export interface PersistState {
  saveVersion: number;
  gems: number;
  themeProgress: Record<string, ThemeProgress>;
  activeWaves: Record<string, number>;
  difficulty: { multiplierTick: number };
  generalAddons: GeneralAddons;
  unlocked: Record<string, TowerUnlocks>;
  baseUnlocks: BaseUnlocks;
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
  soundEnabled: boolean;
}

const CURRENT_SAVE_VERSION = 6;

function defaultBaseUnlocks(): BaseUnlocks {
  return { levels: [true, true, false, false, false, false, false] };
}

function blankTower(): TowerUnlocks {
  return {
    levels: [true, true, false, false, false, false, false],
    variantA: [false, false, false],
    variantB: [false, false, false],
    addons: [false, false, false],
  };
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

export function createDefaultPersistState(): PersistState {
  return {
    saveVersion: CURRENT_SAVE_VERSION,
    gems: 0,
    themeProgress: {},
    activeWaves: {},
    difficulty: { multiplierTick: 0 },
    generalAddons: defaultGeneralAddons(),
    unlocked: defaultUnlocked(),
    baseUnlocks: defaultBaseUnlocks(),
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
    soundEnabled: true,
  };
}

// Pure functions extracted from persist.ts actions. These mutate the plain
// state and return a boolean indicating whether a save is needed. Map progress
// is keyed per world (theme id); ensureThemeProgress creates the bucket on
// first write so callers never need to null-check.

export function ensureThemeProgress(state: PersistState, themeId: string): ThemeProgress {
  let progress = state.themeProgress[themeId];
  if (!progress) {
    progress = { highestUnlockedMap: 0, bestWaves: {}, firstTimeMilestones: {}, firstClears: {} };
    state.themeProgress[themeId] = progress;
  }
  return progress;
}

// Deep-clones the per-world progress buckets so a structured-clone (postMessage)
// or host assignment is independent of later engine mutation.
export function cloneThemeProgress(state: PersistState): Record<string, ThemeProgress> {
  const cloned: Record<string, ThemeProgress> = {};
  for (const [themeId, progress] of Object.entries(state.themeProgress)) {
    cloned[themeId] = {
      highestUnlockedMap: progress.highestUnlockedMap,
      bestWaves: { ...progress.bestWaves },
      firstTimeMilestones: { ...progress.firstTimeMilestones },
      firstClears: { ...progress.firstClears },
    };
  }
  return cloned;
}

export function updateBestWave(state: PersistState, themeId: string, mapIndex: number, wave: number): boolean {
  const progress = ensureThemeProgress(state, themeId);
  const key = `best_${mapIndex}`;
  const prev = typeof progress.bestWaves[key] === "number" ? progress.bestWaves[key] : 0;
  if (wave > prev) {
    progress.bestWaves[key] = wave;
    return true;
  }
  return false;
}

export function maybeUnlockNextMap(state: PersistState, themeId: string, mapIndex: number): boolean {
  if (mapIndex >= 0 && mapIndex + 1 < TOTAL_MAPS) {
    const progress = ensureThemeProgress(state, themeId);
    progress.highestUnlockedMap = Math.max(progress.highestUnlockedMap, mapIndex + 1);
    return true;
  }
  return false;
}

export function markFirstTimeMilestone(state: PersistState, themeId: string, mapIndex: number, wave: number): boolean {
  const progress = ensureThemeProgress(state, themeId);
  progress.firstTimeMilestones[`${mapIndex}_${wave}`] = true;
  return true;
}

export function hasClaimedMilestone(state: PersistState, themeId: string, mapIndex: number, wave: number): boolean {
  return !!state.themeProgress[themeId]?.firstTimeMilestones[`${mapIndex}_${wave}`];
}

export function markFirstClear(state: PersistState, themeId: string, mapIndex: number): boolean {
  const progress = ensureThemeProgress(state, themeId);
  progress.firstClears[String(mapIndex)] = true;
  return true;
}

export function hasCleared(state: PersistState, themeId: string, mapIndex: number): boolean {
  return !!state.themeProgress[themeId]?.firstClears[String(mapIndex)];
}

export function addRunToHistory(state: PersistState, entry: unknown): boolean {
  state.runHistory.push(entry);
  while (state.runHistory.length > 20) state.runHistory.shift();
  return true;
}

// Sentinel date the worker stamps on runHistory entries. The worker never calls
// Date.now() (wall-clock would poison deterministic replay); the host replaces
// the sentinel with the real receipt time in stampRunHistoryDate.
export const WORKER_RUN_DATE_SENTINEL = 0;

// Host-side receipt stamp: replaces sentinel/missing dates with the host's
// wall-clock. Runs on the main-thread persist-flush path, never in the worker.
export function stampRunHistoryDate(entry: unknown, nowMillis: number): void {
  if (typeof entry !== "object" || entry === null) return;
  const record = entry as Record<string, unknown>;
  if (record.date === WORKER_RUN_DATE_SENTINEL || record.date === undefined) {
    record.date = nowMillis;
  }
}

export function clearActiveWave(state: PersistState, themeId: string, mapIndex: number): boolean {
  delete state.activeWaves[`${themeId}:${mapIndex}`];
  return true;
}

// difficultyMultiplier getter (currently a Pinia getter at persist.ts):
// Clamped at both ends: a corrupt/negative tick (e.g. a hand-edited save) must
// never invert scaling below 1x, and NaN must never propagate into gem math.
export function difficultyMultiplier(state: PersistState): number {
  const rawTick = state.difficulty?.multiplierTick ?? 0;
  const safeTick = Number.isFinite(rawTick) ? Math.max(0, rawTick) : 0;
  return Math.max(1, safeTick * 0.25 + 1);
}

export function getDifficultyTick(state: PersistState): number {
  return state.difficulty?.multiplierTick ?? 0;
}
