<template>
  <div class="svg-wrapper">
    <svg ref="svgRoot" class="game-svg" xmlns="http://www.w3.org/2000/svg"
         :viewBox="mapViewBox" @mousemove="onMouseMove" @click="onClick" @mousedown="onMouseDown" @contextmenu.prevent>
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
import { EffectManager } from "@/render/svg/EffectManager.js";
import { EnemyManager } from "@/render/svg/EnemyManager.js";
import { ParticleManager } from "@/render/svg/ParticleManager.js";
import { ProjectileManager } from "@/render/svg/ProjectileManager.js";
import { SpawnManager } from "@/render/svg/SpawnManager.js";
import { TowerManager } from "@/render/svg/TowerManager.js";
import { UiOverlayManager } from "@/render/svg/UiOverlayManager.js";
import { useSvgStaticContent } from "@/render/svg/useSvgStaticContent.js";
import type { EnemyVisualMeta, TowerVisualMeta } from "@/render/themes/index.js";
import { GameState, SELL_DISCOUNT_PCT } from "@/sim/Constants.js";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import { TOWER_META, TowerIds } from "@/sim/ConstantsTower.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import {
  blockCoordinateForTile,
  legalSites,
  placementLegal,
  progressiveBlockWorldCorner,
  progressiveConfigForIndex,
  replayProgressiveBoard,
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

const buildPreviewValid = computed(() => {
  const pos = buildPreviewTilePos.value;
  if (!pos || !gameStore.grid) return false;
  if (!gameStore.selectedTowerType) return false;
  const meta = TOWER_META[gameStore.selectedTowerType];
  if (!meta) return false;
  const discount = persistStore.generalAddons?.sellActive === "discount" ? 1 - SELL_DISCOUNT_PCT : 1;
  const cost = Math.floor(meta.cost * discount);
  return gameStore.grid.canBuild(pos.tileX, pos.tileY) && gameStore.gold >= cost;
});

const buildPreviewColor = computed(() => {
  if (!gameStore.selectedTowerType) return null;
  return themeStore.getTowerVisual(gameStore.selectedTowerType)?.color ?? null;
});

const viewSize = ref({ w: 800, h: 600 });

const mapTileSize = 36;
const mapViewBox = computed(() => {
  const map = gameStore.map;
  if (!map) return undefined;
  const originX = (map.originTileX ?? 0) * mapTileSize;
  const originY = (map.originTileY ?? 0) * mapTileSize;
  const w = map.width * mapTileSize;
  const h = map.height * mapTileSize;
  return `${originX} ${originY} ${w} ${h}`;
});

const progressiveGhost = computed(() => {
  if (!gameStore.progressivePlacementHold || !gameStore.map) return "";
  const config = progressiveConfigForIndex(gameStore.mapIndex);
  const templateIndex = gameStore.progressiveOffer[gameStore.progressiveSelectedOffer];
  if (!config || templateIndex === undefined) return "";
  const replayed = replayProgressiveBoard(config, gameStore.progressivePlacements);
  const sites = legalSites(replayed.board, replayed.catalog, templateIndex).filter(
    (site) => site.rotation === gameStore.progressiveRotation,
  );
  return sites
    .map((site) => {
      const corner = progressiveBlockWorldCorner(site.blockX, site.blockY, mapTileSize);
      const size = 5 * mapTileSize;
      return `<rect x="${corner.x}" y="${corner.y}" width="${size}" height="${size}" fill="rgba(95,208,255,0.22)" stroke="#5fd0ff" stroke-width="2" />`;
    })
    .join("");
});

let enemyManager!: EnemyManager;
let towerManager!: TowerManager;
let projectileManager!: ProjectileManager;
let particleManager!: ParticleManager;
// Finding 7: particles are a render-only main-thread effect. The worker ships
// sparse spawn requests (particleSpawns); the main thread owns this ParticleSystem,
// simulates it each rAF frame, and feeds the render ParticleManager.
const mainParticleSystem = new ParticleSystem();
let effectManager!: EffectManager;
let uiOverlayManager!: UiOverlayManager;
let spawnManager!: SpawnManager;
// Last timestamp (ms) used to compute the per-frame particle simulation dt.
let lastParticleFrame: number = 0;

// rAF lifecycle: the render loop must be stopped when the component unmounts
// (route change) so a late frame never touches managers that have been disposed.
let disposed = false;
let renderFrameHandle: number | null = null;

let cameraTransformString = "translate(0,0) scale(1)";

// Monotonic id source for click commands dispatched to the dispatcher. The
// dispatcher reassigns ids when undefined; click handlers always supply their
// own so each click carries a distinct commandId for tracing.
let nextClickCommandId = 1;
// Separate id source for sell-confirm-initiated executeSell commands (fix #7).
let nextConfirmCommandId = 1;

// Cached inverse CTM -- only recomputed when camera or view size changes
let cachedInverseCtm: DOMMatrix | null = null;
let cachedCameraX: number = 0;
let cachedCameraY: number = 0;
let cachedCameraZoom: number = 1;
let cachedViewW: number = 0;
let cachedViewH: number = 0;

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
  if (!worldLayer.value) return;
  const cam = gameStore.camera;
  // Skip recompute only when nothing changed AND we already have a valid CTM.
  // The camera/viewSize watchers null cachedInverseCtm externally, so we must
  // recompute whenever it is null even if camera/viewSize appear unchanged.
  if (
    cachedInverseCtm !== null &&
    cam.x === cachedCameraX &&
    cam.y === cachedCameraY &&
    cam.zoom === cachedCameraZoom &&
    viewSize.value.w === cachedViewW &&
    viewSize.value.h === cachedViewH
  ) {
    return;
  }
  cachedCameraX = cam.x;
  cachedCameraY = cam.y;
  cachedCameraZoom = cam.zoom;
  cachedViewW = viewSize.value.w;
  cachedViewH = viewSize.value.h;
  cachedInverseCtm = worldLayer.value.getScreenCTM()?.inverse() ?? null;
};

// rAF-throttled hover coordinates
let pendingHoverX: number = 0;
let pendingHoverY: number = 0;
let pendingHoverScheduled: boolean = false;

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
  if (!svgRoot.value || !cachedInverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = pendingHoverX;
  pt.y = pendingHoverY;
  const worldPos = pt.matrixTransform(cachedInverseCtm);

  mouseWorldPos.value = worldPos;

  const grid = gameStore.grid;
  const tile = grid
    ? grid.worldToTile(worldPos.x, worldPos.y)
    : { x: Math.floor(worldPos.x / mapTileSize), y: Math.floor(worldPos.y / mapTileSize) };
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
  const tileSize = grid.tileSize || mapTileSize;
  const buildX = grid.worldOriginX + (selectedTower.tileX + 1) * tileSize - 12;
  const buildY = grid.worldOriginY + selectedTower.tileY * tileSize + 2;
  return worldX >= buildX && worldX <= buildX + 10 && worldY >= buildY && worldY <= buildY + 10;
};

const onMouseMove = (e: MouseEvent): void => {
  updateCachedCtm();
  scheduleHover(e.clientX, e.clientY);
};

const dispatchClick = (clientX: number, clientY: number): void => {
  if (!svgRoot.value || !worldLayer.value || !dispatcher) return;

  const inverseCtm = worldLayer.value.getScreenCTM()?.inverse() ?? null;
  if (!inverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const worldPos = pt.matrixTransform(inverseCtm);

  const placement = progressivePlacementCommand(worldPos.x, worldPos.y);
  if (placement) {
    dispatcher.dispatch({ commandId: nextClickCommandId++, ...placement });
    return;
  }
  dispatcher.dispatch({ commandId: nextClickCommandId++, type: "input:click", worldX: worldPos.x, worldY: worldPos.y });
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
  const config = progressiveConfigForIndex(gameStore.mapIndex);
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

const onMouseDown = (e: MouseEvent): void => {
  if (e.button !== 0) return;
  dispatchClick(e.clientX, e.clientY);
  mouseDownHandledGesture = true;
};

const onClick = (e: MouseEvent): void => {
  // mousedown already dispatched for this press — skip the paired click so we
  // don't process the same tile twice. If mousedown was somehow missed, fall
  // through and dispatch here so the click is never dropped.
  if (mouseDownHandledGesture) {
    mouseDownHandledGesture = false;
    return;
  }
  dispatchClick(e.clientX, e.clientY);
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

  const cam = gameStore.camera;
  cameraTransformString = `translate(${cam.x}, ${cam.y}) scale(${cam.zoom})`;
  worldLayer.value?.setAttribute("transform", cameraTransformString);

  enemyManager.syncFromGameEngine(snapshot.enemies);
  towerManager.syncFromGameEngine(snapshot.towers, snapshot.meta.lastScaledDt);
  projectileManager.syncFromGameEngine(snapshot.projectiles);
  // Finding 7: simulate + render particles on the main thread. The worker no
  // longer ships a `particles` array; instead this rAF loop advances the
  // main-thread ParticleSystem (pausing cleanly when the tab is hidden) and the
  // render ParticleManager draws from its current state.
  const particleNow = performance.now();
  const particleDt = Math.min(0.05, (particleNow - lastParticleFrame) / 1000) || 0;
  lastParticleFrame = particleNow;
  mainParticleSystem.update(particleDt);
  particleManager.syncFromGameEngine(mainParticleSystem.getRenderData());

  effectManager.syncVisualEffectsFromSnapshot(snapshot.lightningEffects, snapshot.stunEffects);

  const selectedTower = snapshotStore.resolveSelectedTower();

  effectManager.syncFromGameEngine(
    buildPreviewTilePos.value,
    gameStore.selectedTowerType || null,
    buildPreviewColor.value,
    selectedTower,
    buildPreviewValid.value,
    snapshot.meta.lastScaledDt,
    gameStore.grid,
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
        viewSize.value = { w: width, h: height };
      }
    });
    resizeObserver.value.observe(svgRoot.value);
  }

  watch(
    () => gameStore.camera,
    () => {
      cachedInverseCtm = null;
    },
    { deep: true },
  );
  watch(
    () => viewSize.value,
    () => {
      cachedInverseCtm = null;
    },
    { deep: true },
  );

  // The main thread builds its own static Grid from the same map data so that
  // click-coordinate conversion and path highlights work without the engine.
  if (gameStore.map) {
    const { Grid } = await import("@/sim/grid/Grid.js");
    const grid = new Grid(gameStore.map);
    gameStore.grid = grid;
    // The static grid is rendered in viewBox (world-pixel) space and the dynamic
    // overlays live inside worldLayer, which the render loop transforms by
    // gameStore.camera. The viewBox already scales the whole map to fit the
    // screen, so the camera must be identity here; applying fitToGrid on top
    // would scale/offset the overlays away from the grid.
    cameraTransformString = "translate(0,0) scale(1)";
    worldLayer.value?.setAttribute("transform", cameraTransformString);
    gameStore.setCamera(0, 0, 1);
  }

  worker.postMessage({
    type: "init",
    persistState,
    themeBundle,
    mapIndex: gameStore.mapIndex,
    randomMapParams: gameStore.randomMapParams ?? undefined,
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

onUnmounted(() => {
  pendingHoverScheduled = false;
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
  height: auto;
  max-height: 100%;
  cursor: crosshair;
  display: block;
  user-select: none;
}
</style>
