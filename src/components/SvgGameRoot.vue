<template>
  <div class="svg-wrapper">
    <svg ref="svgRoot" class="game-svg" xmlns="http://www.w3.org/2000/svg"
         :class="{ panning: panActive }" :viewBox="displayedViewBox" preserveAspectRatio="xMidYMid meet"
         @mousemove="onMouseMove" @click="onClick" @mousedown="onMouseDown" @wheel.prevent="onWheel" @contextmenu.prevent>
      <defs ref="defsLayer"></defs>

      <g ref="worldLayer" class="camera-wrapper">
        <g class="grid-layer" v-html="gridContent"></g>
        <g class="progressive-ghost" v-html="progressiveGhost"></g>
        <g ref="entityLayer" class="entity-layer"></g>
        <g ref="uiOverlayLayer" class="ui-overlay-layer"></g>
        <g ref="projectileLayer" class="projectile-layer"></g>
        <g ref="effectLayer" class="effect-layer"></g>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useInput } from "@/composables/Input.js";
import { fitFrame, frameFromCenter, TILE_SIZE, wheelZoomFactor } from "@/render/svg/cameraFrame.js";
import { type ClickEffectInput, clickHasEffect } from "@/render/svg/clickHasEffect.js";
import { EffectManager } from "@/render/svg/EffectManager.js";
import { EnemyManager } from "@/render/svg/EnemyManager.js";
import { ParticleManager } from "@/render/svg/ParticleManager.js";
import { ProjectileManager } from "@/render/svg/ProjectileManager.js";
import { SpawnManager } from "@/render/svg/SpawnManager.js";
import { isNewSnapshotRendered, snapshotAnimDt } from "@/render/svg/snapshotAnimDt.js";
import { TowerManager } from "@/render/svg/TowerManager.js";
import { UiOverlayManager } from "@/render/svg/UiOverlayManager.js";
import { useSvgStaticContent } from "@/render/svg/useSvgStaticContent.js";
import {
  easeOutCubic,
  formatViewRect,
  interpolateViewRect,
  VIEW_BOX_TWEEN_MS,
  type ViewRect,
} from "@/render/svg/viewBoxTween.js";
import type { EnemyVisualMeta, TowerVisualMeta } from "@/render/themes/index.js";
import {
  CUSTOM_PROGRESSIVE_MAP_INDEX,
  GameState,
  SELL_DISCOUNT_PCT,
  TERRAIN_HEIGHT_RANGE_BONUS,
} from "@/sim/Constants.js";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import { TOWER_BASE, TOWER_META, type TowerId, TowerIds } from "@/sim/ConstantsTower.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import {
  blockCoordinateForTile,
  placementLegal,
  progressiveBlockWorldCorner,
  progressiveConfigFromMap,
  replayProgressiveBoard,
  sitesAtRotation,
} from "@/sim/grid/ProgressiveMap.js";
import type { ThemeBundle } from "@/sim/HostBindings.js";
import { ParticleSystem } from "@/sim/ParticleSystem.js";
import type { PersistState } from "@/sim/PersistState.js";
import { SnapshotStore } from "@/sim/SnapshotStore.js";
import { WorkerCommandDispatcher } from "@/sim/WorkerCommandDispatcher.js";
import GameWorker from "@/sim/WorkerEntry.ts?worker";
import type { WorkerToMainMessage } from "@/sim/WorkerProtocol.js";
import { MainThreadHostBindings } from "@/sim-adapters/MainThreadHostBindings.js";
import { SoundManager } from "@/sound/SoundManager.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";
import { progressivePatternMarkup } from "./progressivePreview.js";

const svgRoot = ref<SVGSVGElement | null>(null);
const defsLayer = ref<SVGDefsElement | null>(null);
const worldLayer = ref<SVGGElement | null>(null);
const entityLayer = ref<SVGGElement | null>(null);
const uiOverlayLayer = ref<SVGGElement | null>(null);
const projectileLayer = ref<SVGGElement | null>(null);
const effectLayer = ref<SVGGElement | null>(null);

const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();
const themeStore = useMapThemeStore();

const { staticDefsContent, mapDefsContent, gridContent } = useSvgStaticContent(
  computed(() => gameStore.map),
  themeStore.activeTheme,
  computed(() => gameStore.grid),
);

const mouseWorldPos = ref<{ x: number; y: number } | null>(null);

const buildPreviewTilePos = computed(() => {
  if (gameStore.selectedTowerType) {
    if (gameStore.hoverTile) {
      return gameStore.hoverTile;
    }
    const grid = gameStore.grid;
    if (grid) {
      return { tileX: Math.floor(grid.width / 2), tileY: Math.floor(grid.height / 2) };
    }
  }
  return null;
});

function buildCost(towerType: TowerId): number {
  const meta = TOWER_META[towerType];
  if (!meta) return Number.POSITIVE_INFINITY;
  const discount = persistStore.generalAddons?.sellActive === "discount" ? 1 - SELL_DISCOUNT_PCT : 1;
  return Math.floor(meta.cost * discount);
}

const buildPreviewValid = computed(() => {
  const pos = buildPreviewTilePos.value;
  if (!pos || !gameStore.grid) return false;
  if (!gameStore.selectedTowerType) return false;
  return gameStore.grid.canBuild(pos.tileX, pos.tileY) && gameStore.gold >= buildCost(gameStore.selectedTowerType);
});

const buildPreviewColor = computed(() => {
  if (!gameStore.selectedTowerType) return null;
  return themeStore.getTowerVisual(gameStore.selectedTowerType)?.color ?? null;
});

const buildRangeTiles = computed((): number | null => {
  const towerType = gameStore.selectedTowerType;
  const tile = buildPreviewTilePos.value;
  if (!towerType || !tile) return null;
  const baseRange = TOWER_BASE[towerType]?.range ?? 3.5;
  const rangeTier = persistStore.generalAddons?.terrainHeightRangeBonus;
  if (typeof rangeTier !== "number") return baseRange;
  const terrainHeight = gameStore.grid?.getHeight(tile.tileX, tile.tileY) || 1;
  const bonusPerHeight = TERRAIN_HEIGHT_RANGE_BONUS[rangeTier] || 0;
  return baseRange + bonusPerHeight * terrainHeight;
});

const displayedViewBox = ref<string | undefined>(undefined);
const panActive = ref(false);

const progressiveGhost = computed(() => {
  if (!gameStore.progressivePlacementHold || !gameStore.map) return "";
  const config = progressiveConfigFromMap(gameStore.map);
  const templateIndex = gameStore.progressiveOffer[gameStore.progressiveSelectedOffer];
  if (!config || templateIndex === undefined) return "";
  const replayed = replayProgressiveBoard(config, gameStore.progressivePlacements);
  const sites = sitesAtRotation(replayed.board, replayed.catalog, templateIndex, gameStore.progressiveRotation);
  const selectedSite = gameStore.progressiveSelectedSite;
  return sites
    .map((site) => {
      const corner = progressiveBlockWorldCorner(site.blockX, site.blockY, TILE_SIZE);
      const selected =
        selectedSite !== null && selectedSite.blockX === site.blockX && selectedSite.blockY === site.blockY;
      return progressivePatternMarkup(
        replayed.catalog,
        templateIndex,
        gameStore.progressiveRotation,
        corner.x,
        corner.y,
        TILE_SIZE,
        selected,
      );
    })
    .join("");
});

let enemyManager!: EnemyManager;
let towerManager!: TowerManager;
let projectileManager!: ProjectileManager;
let particleManager!: ParticleManager;
// Finding 7: particles are a render-only main-thread effect. The worker ships
// sparse spawn requests (particleSpawns); the main thread owns this ParticleSystem,
// advances it once per posted snapshot (gated on the game clock), and feeds the
// render ParticleManager.
const mainParticleSystem = new ParticleSystem();
let effectManager!: EffectManager;
let uiOverlayManager!: UiOverlayManager;
let spawnManager!: SpawnManager;
// Last (frameId, workerGeneration) pair rendered by the render loop. Animation
// dt applies only when a new snapshot renders, because the ack gate can hold
// one snapshot across multiple rAF frames (see snapshotAnimDt).
let lastRenderedFrameId: number | null = null;
let lastRenderedWorkerGeneration: number | null = null;

// rAF lifecycle: the render loop must be stopped when the component unmounts
// (route change) so a late frame never touches managers that have been disposed.
let disposed = false;
let renderFrameHandle: number | null = null;

// Monotonic id source for click commands dispatched to the dispatcher. The
// dispatcher reassigns ids when undefined; click handlers always supply their
// own so each click carries a distinct commandId for tracing.
let nextClickCommandId = 1;
// Separate id source for sell-confirm-initiated executeSell commands (fix #7).
let nextConfirmCommandId = 1;

// Cached inverse CTM. Recomputed when the viewBox string or the element size changes.
let cachedInverseCtm: DOMMatrix | null = null;
let cachedViewBox = "";
let cachedViewW: number = 0;
let cachedViewH: number = 0;

const targetViewRect = computed((): ViewRect | null => {
  const map = gameStore.map;
  if (!map) return null;
  return {
    originX: (map.originTileX ?? 0) * TILE_SIZE,
    originY: (map.originTileY ?? 0) * TILE_SIZE,
    width: map.width * TILE_SIZE,
    height: map.height * TILE_SIZE,
  };
});

let displayedRect: ViewRect | null = null;
let viewBoxFrame: number | null = null;
let tweenStartedAt = 0;
let tweenFrom: ViewRect | null = null;
let tweenTo: ViewRect | null = null;
let snappedMapIndex: number | null = null;
let lastFitMapRect: ViewRect | null = null;
let lastFitViewportWidth = 0;
let lastFitViewportHeight = 0;

function assignDisplayedRect(rect: ViewRect): void {
  displayedRect = rect;
  const formatted = formatViewRect(rect);
  displayedViewBox.value = formatted;
  svgRoot.value?.setAttribute("viewBox", formatted);
  cachedInverseCtm = null;
  cachedViewBox = formatted;
}

function cameraFrameRect(): ViewRect | null {
  const viewport = gameStore.viewport;
  const camera = gameStore.camera;
  if (viewport.width <= 0 || viewport.height <= 0 || camera.viewHeight <= 0) return null;
  return frameFromCenter(camera.centerX, camera.centerY, camera.viewHeight, viewport.width, viewport.height);
}

function publishCameraFrame(): void {
  const rect = cameraFrameRect();
  if (!rect) return;
  assignDisplayedRect(rect);
}

function writeCameraFrame(rect: ViewRect): void {
  gameStore.setCameraFrame(rect.originX + rect.width / 2, rect.originY + rect.height / 2, rect.height);
  // Setup writes this frame before the publish watch exists. A later /game mount
  // keeps the previous viewport, so ResizeObserver does not change it and that
  // watch never runs. The SVG would stay at one unit per pixel until a zoom.
  publishCameraFrame();
}

function cancelViewBoxTween(): void {
  if (viewBoxFrame !== null) cancelAnimationFrame(viewBoxFrame);
  viewBoxFrame = null;
  tweenFrom = null;
  tweenTo = null;
}

function rectsEqual(left: ViewRect, right: ViewRect): boolean {
  return (
    left.originX === right.originX &&
    left.originY === right.originY &&
    left.width === right.width &&
    left.height === right.height
  );
}

function stepViewBoxTween(now: number): void {
  if (!tweenFrom || !tweenTo) return;
  if (!gameStore.camera.followsMap) {
    cancelViewBoxTween();
    return;
  }
  const progress = Math.min(1, (now - tweenStartedAt) / VIEW_BOX_TWEEN_MS);
  if (progress >= 1) {
    const settled = tweenTo;
    cancelViewBoxTween();
    writeCameraFrame(settled);
    return;
  }
  writeCameraFrame(interpolateViewRect(tweenFrom, tweenTo, easeOutCubic(progress)));
  viewBoxFrame = requestAnimationFrame(stepViewBoxTween);
}

function startViewBoxTween(from: ViewRect, to: ViewRect): void {
  cancelViewBoxTween();
  tweenFrom = from;
  tweenTo = to;
  tweenStartedAt = performance.now();
  viewBoxFrame = requestAnimationFrame(stepViewBoxTween);
}

watch(
  () => ({
    rect: targetViewRect.value,
    mapIndex: gameStore.mapIndex,
    style: gameStore.map?.style ?? null,
    viewportWidth: gameStore.viewport.width,
    viewportHeight: gameStore.viewport.height,
    followsMap: gameStore.camera.followsMap,
  }),
  (next) => {
    if (!next.rect) {
      cancelViewBoxTween();
      displayedRect = null;
      displayedViewBox.value = undefined;
      snappedMapIndex = null;
      lastFitMapRect = null;
      lastFitViewportWidth = 0;
      lastFitViewportHeight = 0;
      cachedInverseCtm = null;
      return;
    }
    if (next.viewportWidth <= 0 || next.viewportHeight <= 0) {
      if (next.followsMap) {
        cancelViewBoxTween();
        assignDisplayedRect(next.rect);
      }
      return;
    }
    const fit = fitFrame(next.rect, next.viewportWidth, next.viewportHeight);
    if (!next.followsMap) {
      cancelViewBoxTween();
      return;
    }
    const mapChanged = snappedMapIndex !== next.mapIndex;
    const mapRectChanged = lastFitMapRect === null || !rectsEqual(lastFitMapRect, next.rect);
    const viewportChanged =
      lastFitViewportWidth !== next.viewportWidth || lastFitViewportHeight !== next.viewportHeight;
    const currentRect = cameraFrameRect();
    // A frame write during the growth tween can retrigger this watch. The map rect
    // is unchanged, so keep interpolating instead of snapping to the fit frame.
    if (!mapChanged && !mapRectChanged && !viewportChanged && viewBoxFrame !== null) return;
    snappedMapIndex = next.mapIndex;
    lastFitMapRect = next.rect;
    lastFitViewportWidth = next.viewportWidth;
    lastFitViewportHeight = next.viewportHeight;
    // Ease when a progressive frame is not the fit and the viewport did not change.
    // That covers board growth and a placement hold handing a zoomed frame back.
    // A viewport change or a new map snaps, and an already-fit frame is left as it is.
    if (
      currentRect !== null &&
      !mapChanged &&
      next.style === "progressive" &&
      !viewportChanged &&
      !rectsEqual(currentRect, fit)
    ) {
      startViewBoxTween(currentRect, fit);
      return;
    }
    cancelViewBoxTween();
    writeCameraFrame(fit);
  },
  { immediate: true },
);

// Choosing a block needs every legal site on screen. followMap flags the current
// frame; the fit watch above eases it out to the whole board. A zoom during the
// hold clears the flag again and cancels that ease.
watch(
  () => gameStore.progressivePlacementHold,
  (holding) => {
    if (holding) gameStore.followMap();
  },
);

watch(
  () => ({
    centerX: gameStore.camera.centerX,
    centerY: gameStore.camera.centerY,
    viewHeight: gameStore.camera.viewHeight,
    viewportWidth: gameStore.viewport.width,
    viewportHeight: gameStore.viewport.height,
  }),
  () => {
    publishCameraFrame();
  },
);

// Mousedown/click deduplication — mousedown fires on button press (less likely to be dropped),
// click fires on button release (can be dropped when the main thread is blocked at high speed).
// A physical press emits BOTH events; dispatch exactly one click command per gesture by
// remembering that mousedown already handled this press. A human click usually holds the
// button longer than a fixed time window, so a time-based dedup wrongly let the paired click
// through and double-processed the same tile (placing a tower, then selecting it — which
// exits build mode). The gesture flag is timing-independent.
let mouseDownHandledGesture: boolean = false;

// Worker-owned simulation: the worker owns the engine; the main thread owns a
// SnapshotStore projection and a WorkerCommandDispatcher that posts commands.
let worker: Worker | null = null;
let dispatcher: WorkerCommandDispatcher | null = null;
const snapshotStore = new SnapshotStore(gameStore);

const updateCachedCtm = (): void => {
  if (!worldLayer.value || !svgRoot.value) return;
  const viewBox = displayedViewBox.value ?? "";
  const viewWidth = svgRoot.value.clientWidth;
  const viewHeight = svgRoot.value.clientHeight;
  if (
    cachedInverseCtm !== null &&
    viewBox === cachedViewBox &&
    viewWidth === cachedViewW &&
    viewHeight === cachedViewH
  ) {
    return;
  }
  cachedViewBox = viewBox;
  cachedViewW = viewWidth;
  cachedViewH = viewHeight;
  cachedInverseCtm = worldLayer.value.getScreenCTM()?.inverse() ?? null;
};

// rAF-throttled hover coordinates
let pendingHoverX: number = 0;
let pendingHoverY: number = 0;
let pendingHoverScheduled: boolean = false;
let lastPointerClientX = Number.NaN;
let lastPointerClientY = Number.NaN;

const scheduleHover = (clientX: number, clientY: number): void => {
  pendingHoverX = clientX;
  pendingHoverY = clientY;
  if (!pendingHoverScheduled) {
    pendingHoverScheduled = true;
    requestAnimationFrame(flushHover);
  }
};

// Hover is main-thread-only in Phase 7 — compute the hovered tile here and
// write it directly to gameStore (the worker echoes it back unchanged).
const flushHover = (): void => {
  pendingHoverScheduled = false;
  // selectBuildType sets buildHoverHeld so a flush queued before the key does not
  // replace the selected tower's tile. onMouseMove clears the flag once the pointer moves.
  if (gameStore.buildHoverHeld) return;
  if (!svgRoot.value) return;
  if (!cachedInverseCtm) updateCachedCtm();
  if (!cachedInverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = pendingHoverX;
  pt.y = pendingHoverY;
  const worldPos = pt.matrixTransform(cachedInverseCtm);

  mouseWorldPos.value = worldPos;

  const grid = gameStore.grid;
  const tile = grid
    ? grid.worldToTile(worldPos.x, worldPos.y)
    : { x: Math.floor(worldPos.x / TILE_SIZE), y: Math.floor(worldPos.y / TILE_SIZE) };
  const tileX = tile.x;
  const tileY = tile.y;
  if (grid?.inBounds(tileX, tileY)) {
    gameStore.setHoverTile({ tileX, tileY });
  } else {
    gameStore.setHoverTile(null);
  }

  gameStore.setHoverUpgradeBtn(computeHoverUpgradeBtn(worldPos.x, worldPos.y));
};

// The upgrade button hit-test that used to live on GameEngine.setHover. It
// depends only on the selected tower's tile + the grid tile size, both of which
// are available from the snapshot/grid on the main thread.
const computeHoverUpgradeBtn = (worldX: number, worldY: number): boolean => {
  const selectedTower = snapshotStore.resolveSelectedTower();
  if (!selectedTower || gameStore.selectedTowerType) return false;
  const grid = gameStore.grid;
  if (!grid) return false;
  const tileSize = grid.tileSize || TILE_SIZE;
  const buildX = grid.worldOriginX + (selectedTower.tileX + 1) * tileSize - 12;
  const buildY = grid.worldOriginY + selectedTower.tileY * tileSize + 2;
  return worldX >= buildX && worldX <= buildX + 10 && worldY >= buildY && worldY <= buildY + 10;
};

function towerOnTileAt(tileX: number, tileY: number): boolean {
  const snapshot = snapshotStore.get();
  if (!snapshot) return false;
  return snapshot.towers.some((tower) => tower.tileX === tileX && tower.tileY === tileY);
}

// Decides whether a primary-button press is a click or a pan. Mirrors the
// worker's handleClick (through clickHasEffect) so a press that would place or
// select something never turns into a drag, and an inert one never dispatches.
function clickHasEffectAt(worldX: number, worldY: number): boolean {
  const towerType = gameStore.selectedTowerType;
  const input: ClickEffectInput = {
    progressivePlacementHold: gameStore.progressivePlacementHold,
    placementSiteHit: progressivePlacementCommand(worldX, worldY) !== null,
    upgradeButtonHit: computeHoverUpgradeBtn(worldX, worldY),
    inBounds: false,
    towerOnTile: false,
    selectedTowerType: towerType,
    buildable: false,
    gold: gameStore.gold,
    buildCost: towerType ? buildCost(towerType) : Number.POSITIVE_INFINITY,
  };
  const grid = gameStore.grid;
  if (!grid) return clickHasEffect(input);
  const tile = grid.worldToTile(worldX, worldY);
  input.inBounds = grid.inBounds(tile.x, tile.y);
  input.towerOnTile = input.inBounds && towerOnTileAt(tile.x, tile.y);
  input.buildable = input.inBounds && grid.canBuild(tile.x, tile.y);
  return clickHasEffect(input);
}

const onMouseMove = (e: MouseEvent): void => {
  updateCachedCtm();
  const pointerMoved = e.clientX !== lastPointerClientX || e.clientY !== lastPointerClientY;
  lastPointerClientX = e.clientX;
  lastPointerClientY = e.clientY;
  // gameStore.selectBuildType sets buildHoverHeld. A repeat of the last pointer point
  // must not release the snapped tile; only a real move hands hover back to the pointer.
  if (gameStore.buildHoverHeld && pointerMoved) gameStore.buildHoverHeld = false;
  scheduleHover(e.clientX, e.clientY);
};

const dispatchClick = (worldX: number, worldY: number): void => {
  if (!dispatcher) return;
  const placement = progressivePlacementCommand(worldX, worldY);
  if (placement) {
    dispatcher.dispatch({ commandId: nextClickCommandId++, ...placement });
    return;
  }
  dispatcher.dispatch({ commandId: nextClickCommandId++, type: "input:click", worldX, worldY });
};

function progressivePlacementCommand(
  worldX: number,
  worldY: number,
): {
  type: "action:placeProgressiveBlock";
  templateIndex: number;
  rotation: number;
  blockX: number;
  blockY: number;
} | null {
  if (!gameStore.progressivePlacementHold || !gameStore.map || !gameStore.grid) return null;
  const config = progressiveConfigFromMap(gameStore.map);
  const templateIndex = gameStore.progressiveOffer[gameStore.progressiveSelectedOffer];
  if (!config || templateIndex === undefined) return null;
  const tile = gameStore.grid.worldToTile(worldX, worldY);
  const block = blockCoordinateForTile(gameStore.map.originTileX ?? 0, gameStore.map.originTileY ?? 0, tile.x, tile.y);
  const replayed = replayProgressiveBoard(config, gameStore.progressivePlacements);
  const legal = placementLegal(
    replayed.board,
    replayed.catalog,
    templateIndex,
    gameStore.progressiveRotation,
    block.blockX,
    block.blockY,
  );
  if (!legal) return null;
  return {
    type: "action:placeProgressiveBlock",
    templateIndex,
    rotation: gameStore.progressiveRotation,
    blockX: block.blockX,
    blockY: block.blockY,
  };
}

let panLastClientX = 0;
let panLastClientY = 0;

function worldPerPixel(): { x: number; y: number } | null {
  const viewport = gameStore.viewport;
  if (!displayedRect || viewport.width <= 0 || viewport.height <= 0) return null;
  return { x: displayedRect.width / viewport.width, y: displayedRect.height / viewport.height };
}

function clientToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!svgRoot.value) return null;
  updateCachedCtm();
  if (!cachedInverseCtm) return null;
  const point = svgRoot.value.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const world = point.matrixTransform(cachedInverseCtm);
  return { x: world.x, y: world.y };
}

function isPanButton(event: MouseEvent): boolean {
  return event.button === 2 || (event.button === 0 && event.altKey);
}

// Pan listens on window so the drag continues after the pointer leaves the svg.
// The listeners are removed on mouseup, on blur, and when the component unmounts.
function stopPan(): void {
  panActive.value = false;
  window.removeEventListener("mousemove", onPanMove);
  window.removeEventListener("mouseup", stopPan);
  window.removeEventListener("blur", stopPan);
}

function onPanMove(event: MouseEvent): void {
  if (!panActive.value) return;
  const scale = worldPerPixel();
  if (!scale) return;
  const worldDx = -(event.clientX - panLastClientX) * scale.x;
  const worldDy = -(event.clientY - panLastClientY) * scale.y;
  panLastClientX = event.clientX;
  panLastClientY = event.clientY;
  gameStore.panCamera(worldDx, worldDy);
  publishCameraFrame();
  updateCachedCtm();
  scheduleHover(event.clientX, event.clientY);
}

function startPan(event: MouseEvent): void {
  panActive.value = true;
  panLastClientX = event.clientX;
  panLastClientY = event.clientY;
  mouseDownHandledGesture = true;
  window.addEventListener("mousemove", onPanMove);
  window.addEventListener("mouseup", stopPan);
  window.addEventListener("blur", stopPan);
  event.preventDefault();
}

const onWheel = (event: WheelEvent): void => {
  const world = clientToWorld(event.clientX, event.clientY);
  if (!world) return;
  gameStore.zoomCamera(wheelZoomFactor(event.deltaY, event.deltaMode), world.x, world.y);
  publishCameraFrame();
  cachedInverseCtm = null;
};

const onMouseDown = (e: MouseEvent): void => {
  if (isPanButton(e)) {
    startPan(e);
    return;
  }
  if (e.button !== 0) return;
  const world = clientToWorld(e.clientX, e.clientY);
  if (!world) return;
  if (clickHasEffectAt(world.x, world.y)) {
    dispatchClick(world.x, world.y);
  } else {
    startPan(e);
  }
  mouseDownHandledGesture = true;
};

const onClick = (e: MouseEvent): void => {
  // mousedown already handled this press (as a click or a pan start) — skip the
  // paired click so we don't process the same tile twice. If mousedown was
  // somehow missed, fall through and dispatch here so the click is never dropped.
  if (mouseDownHandledGesture) {
    mouseDownHandledGesture = false;
    return;
  }
  const world = clientToWorld(e.clientX, e.clientY);
  if (!world) return;
  dispatchClick(world.x, world.y);
};

const resizeObserver = ref<ResizeObserver | null>(null);
const soundManager = ref<SoundManager | null>(null);

async function buildDefsImperative(staticContent: string, mapContent: string): Promise<void> {
  if (!defsLayer.value) return;
  while (defsLayer.value.firstChild) {
    defsLayer.value.removeChild(defsLayer.value.firstChild);
  }
  defsLayer.value.innerHTML = staticContent + mapContent;
}

function buildThemeBundle(): ThemeBundle {
  const defaultTowerVisuals: Record<string, TowerVisualMeta> = {};
  for (const id of Object.values(TowerIds)) {
    const visual = themeStore.getDefaultTowerVisual(id);
    if (visual) defaultTowerVisuals[id] = visual;
  }
  const defaultEnemyVisuals: Record<string, EnemyVisualMeta> = {};
  for (const type of Object.keys(ENEMY_TYPES)) {
    const visual = themeStore.getDefaultEnemyVisual(type);
    if (visual) defaultEnemyVisuals[type] = visual;
  }
  return { active: themeStore.activeTheme, defaultTowerVisuals, defaultEnemyVisuals };
}

// Wire worker → main messages. Snapshots are projected into the gameStore by
// SnapshotStore; sound/UI/persist/confirm are handled by the main-thread host.
function handleWorkerMessage(event: MessageEvent): void {
  const msg = event.data as WorkerToMainMessage;
  switch (msg.type) {
    case "snapshot":
      snapshotStore.apply(msg.snapshot);
      // Finding 7: drain sparse particle spawn requests into the main-thread
      // ParticleSystem. Each request bundles up to ~14 particles; the system
      // owns ongoing simulation + render from here on.
      if (msg.snapshot.particleSpawns) {
        for (const request of msg.snapshot.particleSpawns) {
          mainParticleSystem.spawn(request.x, request.y, request.color, request.count, {
            speed: request.speed,
            life: request.life,
            opacity: request.opacity,
          });
        }
      }
      break;
    case "playSound":
      host.playSound(msg.name);
      break;
    case "notifyUi":
      host.notifyUi(msg.event);
      break;
    case "schedulePersistSave":
      host.schedulePersistSave(msg.state);
      break;
    case "requestConfirm": {
      // The main-thread host shows the dialog. On confirm we dispatch an
      // action:executeSell command (the worker re-validates and performs the
      // sell through the command seam — fix #7). We always post the result back
      // so the worker can clear its pending-confirm entry.
      host.requestConfirm(msg.payload).then((confirmed) => {
        if (confirmed && dispatcher) {
          dispatcher.dispatch({
            commandId: nextConfirmCommandId++,
            type: "action:executeSell",
            towerId: msg.payload.towerId,
            creditAmount: msg.payload.sellValue,
          });
        }
        worker?.postMessage({ type: "confirmResult", requestId: msg.requestId, confirmed });
      });
      break;
    }
    case "workerReady":
      // Worker initialized; the simulation loop is running.
      break;
    case "gridTowerSync": {
      const grid = gameStore.grid;
      if (grid) {
        if (msg.placed) grid.registerTower(msg.x, msg.y);
        else grid.unregisterTower(msg.x, msg.y);
      }
      break;
    }
    case "workerError":
      console.error("Worker error:", msg.message, msg.stack);
      break;
  }
}

function renderLoop(): void {
  if (disposed) return;
  const snapshot = snapshotStore.get();
  if (!snapshot) {
    renderFrameHandle = requestAnimationFrame(renderLoop);
    return;
  }

  const isNewSnapshot = isNewSnapshotRendered(snapshot, lastRenderedFrameId, lastRenderedWorkerGeneration);
  const animDt = snapshotAnimDt(snapshot, lastRenderedFrameId, lastRenderedWorkerGeneration);
  lastRenderedFrameId = snapshot.frameId;
  lastRenderedWorkerGeneration = snapshot.meta.workerGeneration ?? null;

  enemyManager.syncFromGameEngine(snapshot.enemies);
  towerManager.syncFromGameEngine(snapshot.towers, animDt);
  projectileManager.syncFromGameEngine(snapshot.projectiles);
  // Finding 7: simulate + render particles on the main thread. The worker no
  // longer ships a `particles` array; instead this rAF loop advances the
  // main-thread ParticleSystem once per posted snapshot — gated on the game
  // clock (frozen while paused, scales with timeScale, no jump on tab resume)
  // — and the render ParticleManager draws from its current state.
  mainParticleSystem.update(animDt);
  particleManager.syncFromGameEngine(mainParticleSystem.getRenderData());

  // addLightningEffect re-adds with a fresh seed per call, so the spawn is gated
  // on the new-snapshot signal — not animDt, which is also 0 for a new paused
  // post whose arming tick generated bolts that must still appear. Stun dedups
  // by position key; lightning does not.
  if (isNewSnapshot) {
    effectManager.syncVisualEffectsFromSnapshot(snapshot.lightningEffects, snapshot.stunEffects);
  }

  const selectedTower = snapshotStore.resolveSelectedTower();

  effectManager.syncFromGameEngine(
    buildPreviewTilePos.value,
    gameStore.selectedTowerType || null,
    buildPreviewColor.value,
    selectedTower,
    buildPreviewValid.value,
    animDt,
    gameStore.grid,
    buildRangeTiles.value,
  );
  uiOverlayManager.syncFromGameEngine(snapshot.enemies, selectedTower, snapshot.towers);
  uiOverlayManager.syncWaveTopTowers(snapshot.towers, snapshot.meta.waveTopTowers, snapshot.meta.simSeconds ?? 0);
  if (gameStore.grid) {
    uiOverlayManager.syncPendingQueueOverlays(gameStore.grid, snapshot.spawnStates);
    uiOverlayManager.syncBaseHealthBar(gameStore.grid, snapshot.meta.baseHealth, snapshot.meta.maxBaseHealth);
  }
  spawnManager.sync(snapshot.spawnStates);

  // Backpressure handshake (P2-1): the main thread acks each rendered snapshot
  // (by frameId) so the worker may build+post the next one. The early return at the
  // top of this loop (no snapshot available yet) naturally defers acking until the
  // worker's baseline snapshot arrives.
  worker?.postMessage({ type: "snapshotAck", frameId: snapshot.frameId });

  renderFrameHandle = requestAnimationFrame(renderLoop);
}

let host: MainThreadHostBindings;

onMounted(async () => {
  const sound = new SoundManager();
  soundManager.value = sound;
  // A fresh manager defaults to enabled; apply the persisted preference so a
  // muted player stays muted across runs.
  sound.enabled = persistStore.soundEnabled;
  host = new MainThreadHostBindings(sound);

  worker = new GameWorker();
  gameStore.setWorker(worker);
  worker.addEventListener("message", handleWorkerMessage);

  dispatcher = new WorkerCommandDispatcher(worker);
  setCommandDispatcher(dispatcher);

  // Register input listeners (and their onUnmounted cleanup) before any await
  // so the lifecycle hook binds to the active component instance.
  useInput(gameStore, dispatcher, uiStore);

  const themeBundle = JSON.parse(JSON.stringify(buildThemeBundle())) as unknown as ThemeBundle;
  const persistState = JSON.parse(JSON.stringify(persistStore.$state)) as unknown as PersistState;

  const staticContent = staticDefsContent.value;
  const mapContent = mapDefsContent.value;
  await buildDefsImperative(staticContent, mapContent);

  const el = entityLayer.value;
  const uol = uiOverlayLayer.value;
  const pl = projectileLayer.value;
  const ef = effectLayer.value;
  if (!el || !uol || !pl || !ef) return;

  // The serializer no longer ships per-enemy animation payloads; the render
  // EnemyManager resolves frame timing from the same active theme + default
  // visual fallback the worker used at spawn.
  enemyManager = new EnemyManager(themeBundle.active, themeBundle.defaultEnemyVisuals);
  towerManager = new TowerManager();
  projectileManager = new ProjectileManager();
  particleManager = new ParticleManager();
  effectManager = new EffectManager();
  uiOverlayManager = new UiOverlayManager();
  spawnManager = new SpawnManager();

  enemyManager.init(el);
  towerManager.init(el);
  uiOverlayManager.init(uol);
  projectileManager.init(pl);
  particleManager.init(ef);
  effectManager.init(ef);

  if (svgRoot.value) {
    resizeObserver.value = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        gameStore.setViewport(width, height);
      }
    });
    resizeObserver.value.observe(svgRoot.value);
  }

  watch(
    () => [gameStore.viewport.width, gameStore.viewport.height],
    () => {
      cachedInverseCtm = null;
    },
  );

  // The viewBox is the camera. worldLayer stays at identity so a transform here
  // is not applied on top of that frame. The grid and the entities share this group.
  worldLayer.value?.setAttribute("transform", "translate(0,0) scale(1)");

  // The main thread builds its own static Grid from the same map data so that
  // click-coordinate conversion and path highlights work without the engine.
  if (gameStore.map) {
    const { Grid } = await import("@/sim/grid/Grid.js");
    const grid = new Grid(gameStore.map);
    gameStore.grid = grid;
  }

  worker.postMessage({
    type: "init",
    persistState,
    themeBundle,
    mapIndex: gameStore.mapIndex,
    randomMapParams: gameStore.randomMapParams ?? undefined,
    // Custom progressive runs carry no catalog index; the worker rebuilds the
    // start board from these params, so they must ride the init message.
    progressiveMapParams:
      gameStore.mapIndex === CUSTOM_PROGRESSIVE_MAP_INDEX
        ? (progressiveConfigFromMap(gameStore.map) ?? undefined)
        : undefined,
  });

  if (gameStore.map) {
    spawnManager.init(svgRoot.value!, gameStore.map.spawns.length);
  }

  requestAnimationFrame(renderLoop);
});

watch(
  () => gameStore.map,
  async (map) => {
    if (!map || !svgRoot.value || disposed || !spawnManager) return;
    const { Grid } = await import("@/sim/grid/Grid.js");
    gameStore.grid = new Grid(map);
    await nextTick();
    spawnManager.init(svgRoot.value, map.spawns.length);
  },
);

// The HUD sound button flips the persisted preference mid-run; mirror it onto
// the live manager so the next playSound respects the toggle.
watch(
  () => persistStore.soundEnabled,
  (soundEnabled) => {
    if (soundManager.value) soundManager.value.enabled = soundEnabled;
  },
);

onUnmounted(() => {
  pendingHoverScheduled = false;
  stopPan();
  cancelViewBoxTween();
  disposed = true;
  if (renderFrameHandle !== null) {
    cancelAnimationFrame(renderFrameHandle);
    renderFrameHandle = null;
  }
  // Ask the worker to flush any dirty persist state and dispose, then wait for
  // the "disposed" ack before terminating so the final flush is not dropped
  // (fix #3). A short safety timeout prevents a hung worker from blocking unmount.
  const workerRef = worker;
  if (workerRef) {
    const disposeDone = new Promise<void>((resolve) => {
      const onDisposed = (event: MessageEvent): void => {
        const data = event.data as { type?: string } | null;
        if (data && data.type === "disposed") {
          workerRef.removeEventListener("message", onDisposed);
          resolve();
        }
      };
      workerRef.addEventListener("message", onDisposed);
      workerRef.postMessage({ type: "dispose" });
      setTimeout(resolve, 500);
    });
    void disposeDone.then(() => {
      workerRef.terminate();
    });
  }
  gameStore.clearWorker();
  setCommandDispatcher(null);
  // Reset the commander selection so the pause-menu dropdown reflects reality on
  // the next /game entry (the worker is stopped as a side effect of this call).
  uiStore.setEnemyCommander("none");
  worker = null;
  dispatcher = null;
  soundManager.value?.dispose();
  resizeObserver.value?.disconnect();
  resizeObserver.value = null;

  enemyManager.dispose();
  towerManager.dispose();
  projectileManager.dispose();
  particleManager.dispose();
  effectManager.dispose();
  uiOverlayManager.dispose();
  spawnManager.dispose();
  mainParticleSystem.clear();
});
</script>

<style scoped>
.svg-wrapper {
  position: absolute;
  top: 40px;
  bottom: 64px;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.game-svg {
  width: 100%;
  height: 100%;
  cursor: crosshair;
  display: block;
  user-select: none;
}

.game-svg.panning {
  cursor: grabbing;
}
</style>
