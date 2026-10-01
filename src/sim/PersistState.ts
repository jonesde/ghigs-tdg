import { TOTAL_MAPS } from "@/sim/Constants.js";
import type { GeneralAddons, TowerUnlocks } from "@/stores/persist.js";

// Authoritative persist state — ALL fields enumerated explicitly. The
// randomMap* / progressiveMap* / lastSelectedThemeId fields aren't written by
// the engine, but they MUST be present so the full PersistState round-trips
// through localStorage correctly.
export interface PersistState {
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
  progressiveMapRegion: number;
  progressiveMapLevel: number;
  progressiveMapEntries: number;
  progressiveMapSeed: number | null;
  lastSelectedThemeId: string;
}

const CURRENT_SAVE_VERSION = 2;

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
    progressiveMapRegion: 1,
    progressiveMapLevel: 1,
    progressiveMapEntries: 1,
    progressiveMapSeed: null,
    lastSelectedThemeId: "default",
  };
}

// Pure functions extracted from persist.ts actions. These mutate the plain
// state and return a boolean indicating whether a save is needed.

export function updateBestWave(state: PersistState, mapIndex: number, wave: number): boolean {
  const key = `best_${mapIndex}`;
  const prev = typeof state.bestWaves[key] === "number" ? state.bestWaves[key] : 0;
  if (wave > prev) {
    state.bestWaves[key] = wave;
    return true;
  }
  return false;
}

export function maybeUnlockNextMap(state: PersistState, mapIndex: number): boolean {
  if (mapIndex >= 0 && mapIndex + 1 < TOTAL_MAPS) {
    state.highestUnlockedMap = Math.max(state.highestUnlockedMap, mapIndex + 1);
    return true;
  }
  return false;
}

export function markFirstTimeMilestone(state: PersistState, mapIndex: number, wave: number): boolean {
  state.firstTimeMilestones[`${mapIndex}_${wave}`] = true;
  return true;
}

export function hasClaimedMilestone(state: PersistState, mapIndex: number, wave: number): boolean {
  return !!state.firstTimeMilestones[`${mapIndex}_${wave}`];
}

export function markFirstClear(state: PersistState, mapIndex: number): boolean {
  state.firstClears[String(mapIndex)] = true;
  return true;
}

export function hasCleared(state: PersistState, mapIndex: number): boolean {
  return !!state.firstClears[String(mapIndex)];
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

export function clearActiveWave(state: PersistState, mapIndex: number): boolean {
  delete state.activeWaves[String(mapIndex)];
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
