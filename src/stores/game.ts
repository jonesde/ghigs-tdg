import { defineStore } from "pinia";
import {
  EDGE_BUFFER_FRACTION,
  fitFrame,
  frameFromCenter,
  framesMatch,
  panFrame,
  revealPoint,
  TILE_SIZE,
  tileMapRect,
  type ZoomFrameResult,
  zoomFrame,
} from "@/render/svg/cameraFrame.js";
import type { ViewRect } from "@/render/svg/viewBoxTween.js";
import { GameState, STARTING_BASE_HEALTH, StartingGold } from "@/sim/Constants.js";
import { Grid } from "@/sim/grid/Grid.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";
import {
  chooseAdjacentSite,
  generateProgressiveMap,
  nextUsableRotation,
  type ProgressiveSiteDirection,
  type ProgressiveStamp,
  progressiveConfigFromMap,
  progressiveEntryGold,
  replayProgressiveBoard,
  sitesAtRotation,
} from "@/sim/grid/ProgressiveMap.js";
import type { ActiveBuildingBonus } from "@/sim/mapSites.js";
import { freshActiveBuildingBonus } from "@/sim/mapSites.js";
import type { BonusPickerState, RunBonuses } from "@/sim/runBonuses.js";
import { freshRunBonuses } from "@/sim/runBonuses.js";
import type {
  BaseDefenseSnapshot,
  MapBuildingSnapshot,
  MapCacheSnapshot,
  SupplyDropSnapshot,
} from "@/sim/SimulationSnapshot.js";
import type { Tower } from "@/sim/towers/Tower.js";

export type BasePanelState = Omit<BaseDefenseSnapshot, "sentries">;

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
  waveCompletion: BreakdownEntry;
  firstClearBonus: number;
}

export interface CameraState {
  centerX: number;
  centerY: number;
  viewHeight: number;
  followsMap: boolean;
}

interface ViewportSize {
  width: number;
  height: number;
}

function defaultCamera(): CameraState {
  return { centerX: 0, centerY: 0, viewHeight: 0, followsMap: true };
}

function cameraFromFrame(frame: ViewRect, followsMap: boolean): CameraState {
  return {
    centerX: frame.originX + frame.width / 2,
    centerY: frame.originY + frame.height / 2,
    viewHeight: frame.height,
    followsMap,
  };
}

// The grid fields read by the camera rect math. Deliberately structural, not
// `Grid`: Pinia's reactive state typing (UnwrapRef) drops Grid's private members,
// so the store-held grid cannot pass as `Grid` and these call sites would fail
// the nominal private check.
interface GridRectRef {
  tileSize: number;
  width: number;
  height: number;
  worldOriginX: number;
  worldOriginY: number;
}

function readMapWorldRect(map: GeneratedMap | null, grid: GridRectRef | null): ViewRect | null {
  const tileSize = grid?.tileSize || TILE_SIZE;
  const widthTiles = map?.width ?? grid?.width;
  const heightTiles = map?.height ?? grid?.height;
  if (!widthTiles || !heightTiles) return null;
  const gridOriginX = grid && Number.isFinite(grid.worldOriginX) ? grid.worldOriginX : undefined;
  const gridOriginY = grid && Number.isFinite(grid.worldOriginY) ? grid.worldOriginY : undefined;
  const originTileX = map?.originTileX ?? (gridOriginX !== undefined ? Math.round(gridOriginX / tileSize) : 0);
  const originTileY = map?.originTileY ?? (gridOriginY !== undefined ? Math.round(gridOriginY / tileSize) : 0);
  return tileMapRect(originTileX, originTileY, widthTiles, heightTiles, tileSize);
}

function displayedFrame(camera: CameraState, viewport: ViewportSize, mapRect: ViewRect): ViewRect | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  if (camera.viewHeight > 0) {
    return frameFromCenter(camera.centerX, camera.centerY, camera.viewHeight, viewport.width, viewport.height);
  }
  return fitFrame(mapRect, viewport.width, viewport.height);
}

function shiftedCamera(
  camera: CameraState,
  viewport: ViewportSize,
  mapRect: ViewRect,
  worldDx: number,
  worldDy: number,
): CameraState | null {
  const frame = displayedFrame(camera, viewport, mapRect);
  if (!frame) return null;
  const next = panFrame(frame, worldDx, worldDy, mapRect);
  if (framesMatch(frame, next)) return null;
  const fit = fitFrame(mapRect, viewport.width, viewport.height);
  return cameraFromFrame(next, framesMatch(next, fit));
}

function revealedCamera(
  camera: CameraState,
  viewport: ViewportSize,
  mapRect: ViewRect,
  worldX: number,
  worldY: number,
): CameraState | null {
  const frame = displayedFrame(camera, viewport, mapRect);
  if (!frame) return null;
  // Vertical edges use the same world distance. The fraction is of the frame width, the screen width.
  const margin = frame.width * EDGE_BUFFER_FRACTION;
  const next = revealPoint(frame, worldX, worldY, margin, mapRect);
  if (framesMatch(frame, next)) return null;
  const fit = fitFrame(mapRect, viewport.width, viewport.height);
  return cameraFromFrame(next, framesMatch(next, fit));
}

function zoomedCamera(
  camera: CameraState,
  viewport: ViewportSize,
  mapRect: ViewRect,
  magnificationFactor: number,
  focalWorldX: number | null,
  focalWorldY: number | null,
): CameraState | null {
  const frame = displayedFrame(camera, viewport, mapRect);
  if (!frame || !Number.isFinite(magnificationFactor) || magnificationFactor <= 0) return null;
  const fit = fitFrame(mapRect, viewport.width, viewport.height);
  const focusX = focalWorldX ?? frame.originX + frame.width / 2;
  const focusY = focalWorldY ?? frame.originY + frame.height / 2;
  const result: ZoomFrameResult = zoomFrame(frame, focusX, focusY, magnificationFactor, mapRect, fit);
  if (result.reachedFit && camera.followsMap && framesMatch(frame, result.frame)) return null;
  return cameraFromFrame(result.frame, result.reachedFit);
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
  selectedTowerId: string | null;
  selectedTowerType: TowerId | null;
  baseDefense: BasePanelState | null;
  hoverTile: HoverTile | null;
  camera: CameraState;
  map?: GeneratedMap | null;
  // Structural rather than Grid: Pinia unwraps state types, which drops Grid's
  // private fields, so the store instance would not satisfy `grid?: Grid | null`.
  grid?: { worldToTile(worldX: number, worldY: number): { x: number; y: number } } | null;
  zoomCamera(magnificationFactor: number, focalWorldX: number | null, focalWorldY: number | null): void;
  panCameraByFraction(xFraction: number, yFraction: number): void;
  revealCameraPoint(worldX: number, worldY: number): void;
  selectBuildType(type: TowerId | null): void;
  selectTower(tower: Tower | null): void;
  setHoverTile(tile: HoverTile | null): void;
  progressivePlacementHold?: boolean;
  progressiveOffer?: number[];
  progressiveRotation?: number;
  progressiveSelectedOffer?: number;
  progressiveSelectedSite?: { blockX: number; blockY: number } | null;
  progressivePlacements?: ProgressiveStamp[];
  rotateProgressiveBlock?: () => void;
  selectProgressiveOffer?: (index: number) => void;
  moveProgressiveSite?: (direction: ProgressiveSiteDirection) => void;
  bonusPicker?: BonusPickerState | null;
  // Store getter: the open picker is a cache whose cards are still locked.
  bonusPickerLocked?: boolean;
  // Index into the picker's option list (bonusPickerOptions): the three cards
  // plus Leave it, or Unlock and Leave it while a cache is still sealed.
  bonusPickerSelectedOption?: number;
  selectBonusPickerOption?: (index: number) => void;
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
  selectedTowerId: string | null;
  selectedTowerType: TowerId | null;
  baseDefense: BasePanelState | null;
  towerPanelPos: TowerPanelPos;
  basePanelPos: TowerPanelPos;
  gameShopPos: TowerPanelPos;
  minimapPanelPos: TowerPanelPos;
  hoverTile: HoverTile | null;
  buildHoverHeld: boolean;
  hoverUpgradeBtn: boolean;
  frameId: number;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  milestoneRewardsClaimed: MilestoneRewardsClaimed;
  gemBreakdown: GemBreakdown;
  endScreenData: EndScreenPayload | null;
  camera: CameraState;
  viewport: ViewportSize;
  randomMapParams: Record<string, unknown> | null;
  worker: Worker | null;
  progressivePlacementHold: boolean;
  progressiveOffer: number[];
  progressiveRotation: number;
  progressiveSelectedOffer: number;
  progressiveSelectedSite: { blockX: number; blockY: number } | null;
  progressivePlacements: ProgressiveStamp[];
  progressiveUndoAvailable: boolean;
  layoutGeneration: number;
  runBonuses: RunBonuses;
  // The whole-board product every powered building pays this run, for the HUD
  // effects list. A mirror of meta.activeBuildingEffects.
  buildingEffects: ActiveBuildingBonus;
  bonusPicker: BonusPickerState | null;
  bonusPickerSelectedOption: number;
  nextBossAbilityNames: string[];
  supplyDrops: SupplyDropSnapshot[];
  mapCaches: MapCacheSnapshot[];
  mapBuildings: MapBuildingSnapshot[];
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
    selectedTowerId: null,
    selectedTowerType: null,
    baseDefense: null,
    towerPanelPos: { x: 0, y: 48 },
    basePanelPos: { x: 0, y: 48 },
    gameShopPos: { x: 0, y: 0 },
    minimapPanelPos: { x: 40, y: 80 },
    hoverTile: null,
    buildHoverHeld: false,
    hoverUpgradeBtn: false,
    frameId: 0,
    runGemsEarned: 0,
    bossesKilledThisRun: 0,
    bossesReachedBaseThisRun: 0,
    milestoneRewardsClaimed: {},
    gemBreakdown: {
      bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      firstClearBonus: 0,
    },
    endScreenData: null,
    camera: defaultCamera(),
    viewport: { width: 0, height: 0 },
    randomMapParams: null,
    worker: null,
    progressivePlacementHold: false,
    progressiveOffer: [],
    progressiveRotation: 0,
    progressiveSelectedOffer: 0,
    progressiveSelectedSite: null,
    progressivePlacements: [],
    progressiveUndoAvailable: false,
    layoutGeneration: 0,
    runBonuses: freshRunBonuses(),
    buildingEffects: freshActiveBuildingBonus(),
    bonusPicker: null,
    bonusPickerSelectedOption: 0,
    nextBossAbilityNames: [],
    supplyDrops: [],
    mapCaches: [],
    mapBuildings: [],
  }),

  getters: {
    isPlaying: (state) => state.state === GameState.PLAYING,
    isPaused: (state) => state.state === GameState.PAUSED,
    isInGame: (state) => state.state === GameState.PLAYING || state.state === GameState.PAUSED,
    claimedMilestoneSet: (state) => new Set(Object.keys(state.milestoneRewardsClaimed)),
    // True while the open picker is a cache whose cards are still gated behind the
    // gold-or-damage unlock: the picker then offers only unlock and leave, and the
    // card digits must not claim anything.
    bonusPickerLocked: (state) => {
      const picker = state.bonusPicker;
      if (picker?.source !== "cache") return false;
      const cache = state.mapCaches.find((site) => site.id === picker.id);
      return cache !== undefined && cache.hp > 0 && !cache.unlocked;
    },
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

    selectTower(tower: Tower | null) {
      this.selectedTower = tower;
    },

    selectBuildType(type: TowerId | null) {
      const enteringBuild = this.selectedTowerType == null && type != null;
      this.selectedTowerType = type;
      if (enteringBuild && this.selectedTower) {
        this.hoverTile = { tileX: this.selectedTower.tileX, tileY: this.selectedTower.tileY };
        // SvgGameRoot.flushHover skips hover writes while this is set, so a pointer flush
        // queued before this call does not replace the selected tower's tile.
        this.buildHoverHeld = true;
      }
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

    // Rewards and run-scoped state both start a run and return to the menu clear,
    // so the next run cannot inherit gems, milestones, or a half-open picker.
    resetRunRewards() {
      this.runGemsEarned = 0;
      this.bossesKilledThisRun = 0;
      this.bossesReachedBaseThisRun = 0;
      this.milestoneRewardsClaimed = {};
      this.gemBreakdown = {
        bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        firstClearBonus: 0,
      };
    },

    // Progressive placement state, the run's bonus records, and the site lists all
    // describe one board: they are rebuilt together or not at all.
    resetRunBonusesAndSites() {
      this.progressivePlacementHold = false;
      this.progressiveOffer = [];
      this.progressiveRotation = 0;
      this.progressiveSelectedOffer = 0;
      this.progressiveSelectedSite = null;
      this.progressivePlacements = [];
      this.progressiveUndoAvailable = false;
      this.layoutGeneration = 0;
      this.runBonuses = freshRunBonuses();
      this.buildingEffects = freshActiveBuildingBonus();
      this.bonusPicker = null;
      this.bonusPickerSelectedOption = 0;
      this.nextBossAbilityNames = [];
      this.supplyDrops = [];
      this.mapCaches = [];
      this.mapBuildings = [];
    },

    initMap(mapIndex: number, mapData: GeneratedMap, grid: Grid | null) {
      this.mapIndex = mapIndex;
      this.map = mapData;
      this.grid = grid;
      this.state = GameState.PLAYING;
      this.baseHealth = STARTING_BASE_HEALTH;
      this.maxBaseHealth = STARTING_BASE_HEALTH;
      const regionGold = StartingGold[mapData.regionId] ?? StartingGold[0] ?? 0;
      const entryGold =
        mapData.style === "progressive" && mapData.entryCount !== undefined
          ? progressiveEntryGold(mapData.entryCount)
          : 0;
      this.gold = regionGold + entryGold;
      this.currentWave = 0;
      this.commanderHold = false;
      this.resetRunRewards();
      this.selectedTower = null;
      this.selectedTowerId = null;
      this.selectedTowerType = null;
      this.baseDefense = null;
      this.towerPanelPos = { x: 0, y: 48 };
      this.basePanelPos = { x: 0, y: 48 };
      this.gameShopPos = { x: 0, y: 0 };
      this.minimapPanelPos = { x: 40, y: 80 };
      this.hoverTile = null;
      this.buildHoverHeld = false;
      this.endScreenData = null;
      this.camera = defaultCamera();
      this.resetRunBonusesAndSites();
    },

    rotateProgressiveBlock() {
      const config = progressiveConfigFromMap(this.map);
      const templateIndex = this.progressiveOffer[this.progressiveSelectedOffer];
      if (!config || templateIndex === undefined) return;
      const replayed = replayProgressiveBoard(config, this.progressivePlacements);
      this.progressiveRotation = nextUsableRotation(
        replayed.board,
        replayed.catalog,
        templateIndex,
        (this.progressiveRotation + 1) % 4,
      );
      this.syncProgressiveCursor();
    },

    selectProgressiveOffer(index: number) {
      if (index < 0 || index >= this.progressiveOffer.length) return;
      this.progressiveSelectedOffer = index;
      this.syncProgressiveCursor();
    },

    // The picker's cursor, reset by the snapshot when the picker identity
    // changes. Callers pass an index they already resolved from the option list.
    selectBonusPickerOption(index: number) {
      this.bonusPickerSelectedOption = Math.max(0, Math.trunc(index));
    },

    moveProgressiveSite(direction: ProgressiveSiteDirection) {
      const config = progressiveConfigFromMap(this.map);
      const templateIndex = this.progressiveOffer[this.progressiveSelectedOffer];
      if (!config || templateIndex === undefined) return;
      const replayed = replayProgressiveBoard(config, this.progressivePlacements);
      const sites = sitesAtRotation(replayed.board, replayed.catalog, templateIndex, this.progressiveRotation);
      const selectedSite = this.progressiveSelectedSite;
      const current = selectedSite
        ? sites.find((site) => site.blockX === selectedSite.blockX && site.blockY === selectedSite.blockY)
        : undefined;
      if (!current) {
        this.syncProgressiveCursor();
        return;
      }
      const nextSite = chooseAdjacentSite(sites, current, direction);
      this.progressiveSelectedSite = { blockX: nextSite.blockX, blockY: nextSite.blockY };
    },

    syncProgressiveCursor() {
      const config = progressiveConfigFromMap(this.map);
      const templateIndex = this.progressiveOffer[this.progressiveSelectedOffer];
      if (!config || templateIndex === undefined) {
        this.progressiveSelectedSite = null;
        return;
      }
      const replayed = replayProgressiveBoard(config, this.progressivePlacements);
      const rotation = nextUsableRotation(replayed.board, replayed.catalog, templateIndex, this.progressiveRotation);
      if (this.progressiveRotation !== rotation) this.progressiveRotation = rotation;
      const sites = sitesAtRotation(replayed.board, replayed.catalog, templateIndex, rotation);
      const selectedSite = this.progressiveSelectedSite;
      const siteStillLegal =
        selectedSite !== null &&
        sites.some((site) => site.blockX === selectedSite.blockX && site.blockY === selectedSite.blockY);
      if (siteStillLegal) return;
      const firstSite = sites[0];
      this.progressiveSelectedSite = firstSite ? { blockX: firstSite.blockX, blockY: firstSite.blockY } : null;
    },

    applyProgressiveLayout(layoutGeneration: number, stamps: ProgressiveStamp[]) {
      const config = progressiveConfigFromMap(this.map);
      if (!config) return;
      const map = generateProgressiveMap(config, stamps);
      this.map = map;
      this.grid = new Grid(map);
      this.syncSiteReservations();
      this.progressivePlacements = stamps.map((stamp) => ({ ...stamp }));
      this.layoutGeneration = layoutGeneration;
    },

    setViewport(width: number, height: number) {
      if (this.viewport.width === width && this.viewport.height === height) return;
      this.viewport = { width, height };
      if (width <= 0 || height <= 0) return;
      if (this.camera.followsMap || this.camera.viewHeight <= 0) return;
      const mapRect = readMapWorldRect(this.map, this.grid);
      if (!mapRect) return;
      const frame = frameFromCenter(this.camera.centerX, this.camera.centerY, this.camera.viewHeight, width, height);
      const clamped = panFrame(frame, 0, 0, mapRect);
      if (framesMatch(frame, clamped)) return;
      this.camera = cameraFromFrame(clamped, false);
    },

    // Tween and fit writer. Does not take the camera away from map following.
    // Mutates in place: replacing the camera object retriggers the fit watch, which
    // reads followsMap, and that re-entry cancels the growth tween on its first frame.
    setCameraFrame(centerX: number, centerY: number, viewHeight: number) {
      const camera = this.camera;
      if (camera.centerX === centerX && camera.centerY === centerY && camera.viewHeight === viewHeight) return;
      camera.centerX = centerX;
      camera.centerY = centerY;
      camera.viewHeight = viewHeight;
    },

    // Leaves the current frame in place and marks it as map-following. SvgGameRoot's
    // fit watch then eases that frame out to the whole board.
    followMap() {
      if (this.camera.followsMap) return;
      this.camera.followsMap = true;
    },

    zoomCamera(magnificationFactor: number, focalWorldX: number | null, focalWorldY: number | null) {
      const mapRect = readMapWorldRect(this.map, this.grid);
      if (!mapRect) return;
      const next = zoomedCamera(this.camera, this.viewport, mapRect, magnificationFactor, focalWorldX, focalWorldY);
      if (next) this.camera = next;
    },

    panCamera(worldDx: number, worldDy: number) {
      const mapRect = readMapWorldRect(this.map, this.grid);
      if (!mapRect) return;
      const next = shiftedCamera(this.camera, this.viewport, mapRect, worldDx, worldDy);
      if (next) this.camera = next;
    },

    // Pans by a fraction of the current frame, so the step feels the same on screen
    // at any zoom. A pan the map clamp absorbs leaves the camera unchanged.
    panCameraByFraction(xFraction: number, yFraction: number) {
      const mapRect = readMapWorldRect(this.map, this.grid);
      if (!mapRect) return;
      const frame = displayedFrame(this.camera, this.viewport, mapRect);
      if (!frame) return;
      const next = shiftedCamera(
        this.camera,
        this.viewport,
        mapRect,
        frame.width * xFraction,
        frame.height * yFraction,
      );
      if (next) this.camera = next;
    },

    revealCameraPoint(worldX: number, worldY: number) {
      const mapRect = readMapWorldRect(this.map, this.grid);
      if (!mapRect) return;
      const next = revealedCamera(this.camera, this.viewport, mapRect, worldX, worldY);
      if (next) this.camera = next;
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
      this.selectedTowerId = null;
      this.selectedTowerType = null;
      this.baseDefense = null;
      this.hoverTile = null;
      this.buildHoverHeld = false;
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
      this.selectedTowerId = null;
      this.selectedTowerType = null;
      this.baseDefense = null;
      this.towerPanelPos = { x: 0, y: 48 };
      this.basePanelPos = { x: 0, y: 48 };
      this.gameShopPos = { x: 0, y: 0 };
      this.minimapPanelPos = { x: 40, y: 80 };
      this.hoverTile = null;
      this.buildHoverHeld = false;
      this.hoverUpgradeBtn = false;
      this.resetRunRewards();
      this.endScreenData = null;
      this.camera = defaultCamera();
      this.randomMapParams = null;
      this.resetRunBonusesAndSites();
    },

    syncSiteReservations() {
      const grid = this.grid;
      // Input tests install a coordinate stub that is not a Grid. Skip it.
      if (!grid || typeof grid.setReservedTerrain !== "function") return;
      const keys: string[] = [];
      for (const building of this.mapBuildings) keys.push(`${building.tileX},${building.tileY}`);
      for (const cache of this.mapCaches) keys.push(`${cache.tileX},${cache.tileY}`);
      for (const drop of this.supplyDrops) keys.push(`${drop.tileX},${drop.tileY}`);
      grid.setReservedTerrain(keys);
    },
  },
});

export type GameStore = ReturnType<typeof useGameStore>;
