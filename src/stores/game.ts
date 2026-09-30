import { defineStore } from "pinia";
import { GameState, STARTING_BASE_HEALTH, StartingGold } from "@/sim/Constants.js";
import { Grid } from "@/sim/grid/Grid.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";
import { generateProgressiveMap, type ProgressiveStamp, progressiveConfigForIndex } from "@/sim/grid/ProgressiveMap.js";
import type { Tower } from "@/sim/towers/Tower.js";

type GameStateValue = (typeof GameState)[keyof typeof GameState];
type TowerId = typeof import("@/sim/ConstantsTower").TowerIds[keyof typeof import("@/sim/ConstantsTower").TowerIds];

interface BreakdownEntry {
  base: number;
  afterDiff: number;
  afterRegion: number;
  afterFirstTime: number;
}

interface GemBreakdown {
  bossKills: BreakdownEntry;
  milestones: BreakdownEntry;
  waveClears: BreakdownEntry;
  waveCompletion: BreakdownEntry;
  firstClearBonus: number;
}

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface TowerPanelPos {
  x: number;
  y: number;
}

interface HoverTile {
  tileX: number;
  tileY: number;
}

interface EndScreenPayload {
  victory: boolean;
  wave: number;
  gems: number;
  gemBreakdown: GemBreakdown;
}

interface MilestoneRewardsClaimed {
  [wave: number]: boolean;
}

export interface GameStoreLike {
  state: GameStateValue;
  timeScale: number;
  selectedTower: Tower | null;
  selectedTowerType: TowerId | null;
  hoverTile: HoverTile | null;
  camera: CameraState;
  cycleSpeed(): number;
  cycleSpeedReverse(): number;
  selectBuildType(type: TowerId | null): void;
  selectTower(tower: Tower | null): void;
  setHoverTile(tile: HoverTile | null): void;
  progressivePlacementHold?: boolean;
  progressiveRotation?: number;
  rotateProgressiveBlock?: () => void;
  selectProgressiveOffer?: (index: number) => void;
}

interface GameStateShape {
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
  commanderHold: boolean;
  selectedTower: Tower | null;
  selectedTowerType: TowerId | null;
  towerPanelPos: TowerPanelPos;
  gameShopPos: TowerPanelPos;
  minimapPanelPos: TowerPanelPos;
  hoverTile: HoverTile | null;
  hoverUpgradeBtn: boolean;
  frameId: number;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  milestoneRewardsClaimed: MilestoneRewardsClaimed;
  gemBreakdown: GemBreakdown;
  endScreenData: EndScreenPayload | null;
  camera: CameraState;
  randomMapParams: Record<string, unknown> | null;
  worker: Worker | null;
  progressivePlacementHold: boolean;
  progressiveOffer: number[];
  progressiveRotation: number;
  progressiveSelectedOffer: number;
  progressivePlacements: ProgressiveStamp[];
  layoutGeneration: number;
}

export const useGameStore = defineStore("game", {
  state: (): GameStateShape => ({
    state: GameState.MENU,
    mapIndex: -1,
    map: null,
    grid: null,
    baseHealth: STARTING_BASE_HEALTH,
    maxBaseHealth: STARTING_BASE_HEALTH,
    gold: 0,
    currentWave: 0,
    waveCountdown: null,
    timeScale: 1,
    commanderHold: false,
    selectedTower: null,
    selectedTowerType: null,
    towerPanelPos: { x: 0, y: 48 },
    gameShopPos: { x: 0, y: 0 },
    minimapPanelPos: { x: 40, y: 80 },
    hoverTile: null,
    hoverUpgradeBtn: false,
    frameId: 0,
    runGemsEarned: 0,
    bossesKilledThisRun: 0,
    bossesReachedBaseThisRun: 0,
    milestoneRewardsClaimed: {},
    gemBreakdown: {
      bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      waveClears: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      firstClearBonus: 0,
    },
    endScreenData: null,
    camera: { x: 0, y: 0, zoom: 1 },
    randomMapParams: null,
    worker: null,
    progressivePlacementHold: false,
    progressiveOffer: [],
    progressiveRotation: 0,
    progressiveSelectedOffer: 0,
    progressivePlacements: [],
    layoutGeneration: 0,
  }),

  getters: {
    isPlaying: (state) => state.state === GameState.PLAYING,
    isPaused: (state) => state.state === GameState.PAUSED,
    isInGame: (state) => state.state === GameState.PLAYING || state.state === GameState.PAUSED,
    claimedMilestoneSet: (state) => new Set(Object.keys(state.milestoneRewardsClaimed)),
  },

  actions: {
    addGold(amount: number) {
      this.gold += amount;
    },

    setGold(amount: number) {
      this.gold = amount;
    },

    damageBase(amount: number) {
      this.baseHealth -= amount;
    },

    setWave(wave: number) {
      this.currentWave = wave;
    },

    cycleSpeed(): number {
      const speeds = [1, 2, 4, 8] as const;
      const speedIndex = (speeds as readonly number[]).indexOf(this.timeScale);
      this.timeScale = speeds[(speedIndex + 1) % speeds.length]!;
      return this.timeScale;
    },

    cycleSpeedReverse(): number {
      const speeds = [1, 2, 4, 8] as const;
      const speedIndex = (speeds as readonly number[]).indexOf(this.timeScale);
      this.timeScale = speeds[(speedIndex - 1 + speeds.length) % speeds.length]!;
      return this.timeScale;
    },

    selectTower(tower: Tower | null) {
      this.selectedTower = tower;
    },

    selectBuildType(type: TowerId | null) {
      this.selectedTowerType = type;
    },

    setHoverTile(tile: HoverTile | null) {
      this.hoverTile = tile;
    },

    setHoverUpgradeBtn(active: boolean) {
      this.hoverUpgradeBtn = active;
    },

    setState(newState: GameStateValue) {
      this.state = newState;
    },

    togglePause() {
      if (this.state === GameState.PLAYING) this.state = GameState.PAUSED;
      else if (this.state === GameState.PAUSED) this.state = GameState.PLAYING;
    },

    initMap(mapIndex: number, mapData: GeneratedMap, grid: Grid | null) {
      this.mapIndex = mapIndex;
      this.map = mapData;
      this.grid = grid;
      this.state = GameState.PLAYING;
      this.baseHealth = STARTING_BASE_HEALTH;
      this.maxBaseHealth = STARTING_BASE_HEALTH;
      this.gold = StartingGold[mapData.regionId]!;
      this.currentWave = 0;
      this.commanderHold = false;
      this.runGemsEarned = 0;
      this.bossesKilledThisRun = 0;
      this.bossesReachedBaseThisRun = 0;
      this.milestoneRewardsClaimed = {};
      this.gemBreakdown = {
        bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        waveClears: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        firstClearBonus: 0,
      };
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.towerPanelPos = { x: 0, y: 48 };
      this.gameShopPos = { x: 0, y: 0 };
      this.minimapPanelPos = { x: 40, y: 80 };
      this.hoverTile = null;
      this.endScreenData = null;
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.progressivePlacementHold = false;
      this.progressiveOffer = [];
      this.progressiveRotation = 0;
      this.progressiveSelectedOffer = 0;
      this.progressivePlacements = [];
      this.layoutGeneration = 0;
    },

    rotateProgressiveBlock() {
      this.progressiveRotation = (this.progressiveRotation + 1) % 4;
    },

    selectProgressiveOffer(index: number) {
      if (index < 0 || index >= this.progressiveOffer.length) return;
      this.progressiveSelectedOffer = index;
    },

    applyProgressiveLayout(layoutGeneration: number, stamps: ProgressiveStamp[]) {
      const config = progressiveConfigForIndex(this.mapIndex);
      if (!config) return;
      const map = generateProgressiveMap(config, stamps);
      this.map = map;
      this.grid = new Grid(map);
      this.progressivePlacements = stamps.map((stamp) => ({ ...stamp }));
      this.layoutGeneration = layoutGeneration;
    },

    setCamera(x: number, y: number, zoom: number) {
      this.camera = { x, y, zoom };
    },

    setWorker(worker: Worker) {
      this.worker = worker;
    },

    clearWorker() {
      this.worker = null;
    },

    claimMilestone(wave: number) {
      this.milestoneRewardsClaimed[wave] = true;
    },

    hasClaimedMilestone(wave: number): boolean {
      return !!this.milestoneRewardsClaimed[wave];
    },

    triggerEnd(victoryFlag: boolean, data: Omit<EndScreenPayload, "victory">) {
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.hoverTile = null;
      this.endScreenData = { victory: victoryFlag, ...data };
      this.state = victoryFlag ? GameState.VICTORY : GameState.GAME_OVER;
    },

    setGemBreakdown(breakdown: GemBreakdown) {
      this.gemBreakdown = breakdown;
    },

    resetToMenu() {
      this.state = GameState.MENU;
      this.mapIndex = -1;
      this.map = null;
      this.grid = null;
      this.baseHealth = STARTING_BASE_HEALTH;
      this.maxBaseHealth = STARTING_BASE_HEALTH;
      this.gold = 0;
      this.currentWave = 0;
      this.timeScale = 1;
      this.commanderHold = false;
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.towerPanelPos = { x: 0, y: 48 };
      this.gameShopPos = { x: 0, y: 0 };
      this.minimapPanelPos = { x: 40, y: 80 };
      this.hoverTile = null;
      this.hoverUpgradeBtn = false;
      this.runGemsEarned = 0;
      this.bossesKilledThisRun = 0;
      this.bossesReachedBaseThisRun = 0;
      this.milestoneRewardsClaimed = {};
      this.gemBreakdown = {
        bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        waveClears: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        firstClearBonus: 0,
      };
      this.endScreenData = null;
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.randomMapParams = null;
      this.progressivePlacementHold = false;
      this.progressiveOffer = [];
      this.progressiveRotation = 0;
      this.progressiveSelectedOffer = 0;
      this.progressivePlacements = [];
      this.layoutGeneration = 0;
    },
  },
});

export type GameStore = ReturnType<typeof useGameStore>;
