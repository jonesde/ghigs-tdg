import type { GameStateValue } from "@/sim/Constants.js";
import { STARTING_BASE_HEALTH, StartingGold } from "@/sim/Constants.js";
import type { TowerId } from "@/sim/ConstantsTower.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";

// Authoritative run state for the simulation. Formerly the Pinia gameStore's
// GameStateShape. In Phase 1 this replaces the Pinia store on the engine —
// there is no parallel mirror. In Phase 7 the worker constructs this object
// directly; the main-thread gameStore becomes a reactive projection.
export interface GameRunState {
  state: GameStateValue;
  mapIndex: number;
  map: GeneratedMap | null;
  grid: Grid | null;
  baseHealth: number;
  maxBaseHealth: number;
  gold: number;
  currentWave: number;
  waveCountdown: { remaining: number; nextWave: number } | null;
  timeScale: number;
  // Clock stop requested by an LLM commander. Distinct from state === "paused".
  commanderHold: boolean;
  selectedTowerId: string | null;
  selectedTowerType: TowerId | null;
  hoverTile: { tileX: number; tileY: number } | null;
  hoverUpgradeBtn: boolean;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  milestoneRewardsClaimed: Record<number, boolean>;
  gemBreakdown: GemBreakdown;
  endScreenData: EndScreenPayload | null;
  randomMapParams: Record<string, unknown> | null;
}

export interface GemBreakdown {
  bossKills: BreakdownEntry;
  milestones: BreakdownEntry;
  waveCompletion: BreakdownEntry;
  firstClearBonus: number;
}

export interface BreakdownEntry {
  base: number;
  afterDiff: number;
  afterRegion: number;
  afterFirstTime: number;
}

export interface EndScreenPayload {
  victory: boolean;
  wave: number;
  gems: number;
  gemBreakdown: GemBreakdown;
}

// Pure helpers — bodies of the corresponding gameStore actions, extracted as
// free functions so the worker can call them without a Pinia instance.

export function addGold(state: GameRunState, amount: number): void {
  state.gold += amount;
}

export function setGold(state: GameRunState, amount: number): void {
  state.gold = amount;
}

export function damageBase(state: GameRunState, amount: number): void {
  state.baseHealth -= amount;
}

export function setWave(state: GameRunState, wave: number): void {
  state.currentWave = wave;
}

export function cycleTimeScale(state: GameRunState, direction: 1 | -1): number {
  const speeds = [1, 2, 4, 8];
  let speedIndex = speeds.indexOf(state.timeScale);
  if (speedIndex < 0) {
    speedIndex = 0;
    let nearestDistance = Math.abs(speeds[0]! - state.timeScale);
    for (let candidateIndex = 1; candidateIndex < speeds.length; candidateIndex++) {
      const candidateDistance = Math.abs(speeds[candidateIndex]! - state.timeScale);
      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance;
        speedIndex = candidateIndex;
      }
    }
  }
  const next = speeds[(speedIndex + direction + speeds.length) % speeds.length]!;
  state.timeScale = next;
  return next;
}

export function togglePauseState(state: GameRunState): void {
  if (state.state === "playing") state.state = "paused";
  else if (state.state === "paused") state.state = "playing";
}

export function setGameState(state: GameRunState, newState: GameStateValue): void {
  state.state = newState;
}

export function claimMilestoneRun(state: GameRunState, wave: number): void {
  state.milestoneRewardsClaimed[wave] = true;
}

export function hasClaimedMilestoneRun(state: GameRunState, wave: number): boolean {
  return !!state.milestoneRewardsClaimed[wave];
}

export function selectBuildType(state: GameRunState, type: TowerId | null): void {
  state.selectedTowerType = type;
}

export function setHoverTile(state: GameRunState, tile: { tileX: number; tileY: number } | null): void {
  state.hoverTile = tile;
}

export function setHoverUpgradeBtn(state: GameRunState, active: boolean): void {
  state.hoverUpgradeBtn = active;
}

export function createFreshGemBreakdown(): GemBreakdown {
  return {
    bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
    milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
    waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
    firstClearBonus: 0,
  };
}

export function initRunState(state: GameRunState, mapIndex: number, mapData: GeneratedMap, grid: Grid | null): void {
  state.state = "paused";
  state.mapIndex = mapIndex;
  state.map = mapData;
  state.grid = grid;
  state.baseHealth = STARTING_BASE_HEALTH;
  state.maxBaseHealth = STARTING_BASE_HEALTH;
  state.gold = StartingGold[mapData.regionId]!;
  state.currentWave = 0;
  state.waveCountdown = null;
  state.timeScale = 1;
  state.commanderHold = false;
  state.runGemsEarned = 0;
  state.bossesKilledThisRun = 0;
  state.bossesReachedBaseThisRun = 0;
  state.milestoneRewardsClaimed = {};
  state.gemBreakdown = createFreshGemBreakdown();
  state.selectedTowerId = null;
  state.selectedTowerType = null;
  state.hoverTile = null;
  state.hoverUpgradeBtn = false;
  state.endScreenData = null;
  state.randomMapParams = null;
}

export function triggerEnd(state: GameRunState, victoryFlag: boolean, data: Omit<EndScreenPayload, "victory">): void {
  state.selectedTowerId = null;
  state.selectedTowerType = null;
  state.hoverTile = null;
  state.endScreenData = { victory: victoryFlag, ...data };
  state.state = victoryFlag ? "victory" : "game_over";
}
