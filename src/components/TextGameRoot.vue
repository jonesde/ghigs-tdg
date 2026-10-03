<template>
  <div class="text-game-root" :style="{ width: scaledWidth + 'px', height: scaledHeight + 'px' }">
    <div class="text-grid-scale" :style="scaleStyle">
      <pre ref="preEl" class="text-grid-pre" :style="preStyle">{{ gridText }}</pre>
      <canvas
        ref="canvasEl"
        class="text-grid-canvas"
        :width="canvasWidth"
        :height="canvasHeight"
        :style="canvasStyle"
      ></canvas>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { TextEnemyManager } from "@/render/text/TextEnemyManager.js";
import { TextGridBuilder } from "@/render/text/TextGridBuilder.js";
import { TextOverlayRenderer } from "@/render/text/TextOverlayRenderer.js";
import { TextPathRenderer } from "@/render/text/TextPathRenderer.js";
import { TextTowerManager } from "@/render/text/TextTowerManager.js";
import type { TextRenderScale } from "@/render/text/types.js";
import type { Grid } from "@/sim/grid/Grid.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const themeStore = useMapThemeStore();
const uiStore = useUiStore();

const FONT_SIZE = 10;
const FONT_FAMILY = "monospace";
// Collapse the line height to the font size so cells are as short as possible
// without clipping glyphs. Monospace cells are wider than tall, so to make the
// text map square we stretch the whole layer horizontally with `scaleX` (see
// `cellScaleX`) rather than adding letter-spacing — letter-spacing would break
// box-drawing connectivity between adjacent border characters.
const LINE_HEIGHT_FACTOR = 1.0;

const preEl = ref<HTMLPreElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const gridText = ref("");
const gridWidth = ref(0);
const gridHeight = ref(0);

// Measured monospace cell box. In a real browser `measureText` yields the
// advance; under jsdom it returns 0, so we fall back to a non-zero box derived
// from the font size to avoid divide-by-zero and a collapsed canvas.
// `cellWidthPx` is the *glyph advance* (no letter-spacing); the square aspect
// ratio is achieved by horizontally scaling the layer via `cellScaleX`, which
// the `<pre>` and canvas overlay both share to stay aligned.
const charAdvancePx = ref(FONT_SIZE * 0.6);
const cellHeightPx = ref(FONT_SIZE);
const cellWidthPx = computed(() => charAdvancePx.value);
// Horizontal scale that makes each cell square: stretch the (too-narrow) glyph
// advance up to the cell height. Applied as a CSS transform to the wrapper so
// box-drawing characters remain connected.
const cellScaleX = computed(() => cellHeightPx.value / charAdvancePx.value);
// Visual (post-scale) size of the whole map; the outer element reserves this so
// the panel's `max-content` width is correct despite the transform.
const scaledWidth = computed(() => Math.round(gridWidth.value * 3 * cellHeightPx.value));
const scaledHeight = computed(() => Math.round(gridHeight.value * 3 * cellHeightPx.value));

const scale = computed<TextRenderScale>(() => ({
  scaleX: (3 * cellWidthPx.value) / 36,
  scaleY: (3 * cellHeightPx.value) / 36,
  originX: gameStore.grid?.worldOriginX ?? 0,
  originY: gameStore.grid?.worldOriginY ?? 0,
}));

const canvasWidth = computed(() => Math.round(gridWidth.value * 3 * cellWidthPx.value));
const canvasHeight = computed(() => Math.round(gridHeight.value * 3 * cellHeightPx.value));

// The `<pre>` and the canvas overlay must share the exact same font metrics and
// origin, or glyphs will not sit in their cells. Drive both from one computed
// style object. The wrapper applies the horizontal `scaleX` so box borders
// stay connected; the canvas is a sibling inside that wrapper and is scaled
// identically, preserving alignment.
const preStyle = computed(() => ({
  fontFamily: FONT_FAMILY,
  fontSize: `${FONT_SIZE}px`,
  lineHeight: `${cellHeightPx.value}px`,
  margin: "0",
  color: "var(--color-text-dim)",
}));

const scaleStyle = computed(() => ({ transform: `scaleX(${cellScaleX.value})`, transformOrigin: "top left" }));

const canvasStyle = computed(() => ({ fontFamily: FONT_FAMILY, fontSize: `${FONT_SIZE}px` }));

const towerManager = new TextTowerManager();
const enemyManager = new TextEnemyManager();
const overlayRenderer = new TextOverlayRenderer();
const pathRenderer = new TextPathRenderer();

let disposed = false;
let renderFrameHandle: number | null = null;

function measureCell(): void {
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  let measuredAdvance = 0;
  if (measureCtx) {
    measureCtx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    measuredAdvance = measureCtx.measureText("M").width || 0;
  }
  if (measuredAdvance > 0) {
    charAdvancePx.value = measuredAdvance;
  } else {
    charAdvancePx.value = FONT_SIZE * 0.6;
  }
  cellHeightPx.value = FONT_SIZE * LINE_HEIGHT_FACTOR;
}

function renderFrame(): void {
  if (disposed) return;
  const snapshot = getLatestSnapshot();
  const ctx = canvasEl.value?.getContext("2d");
  if (snapshot && ctx) {
    // Match the `<pre>` font so canvas glyphs sit in the same cells. The
    // context font persists across fillText calls until changed.
    ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
    pathRenderer.render(ctx, snapshot, scale.value);
    towerManager.render(ctx, snapshot.towers, themeStore, scale.value);
    towerManager.renderBaseSentries(ctx, snapshot.meta.baseDefense?.sentries ?? [], themeStore, scale.value);
    enemyManager.render(ctx, snapshot.enemies, themeStore, scale.value);
    overlayRenderer.render(ctx, snapshot, scale.value, uiStore.debugPanelVisible);
  }
  renderFrameHandle = requestAnimationFrame(renderFrame);
}

function rebuildTextGrid(): void {
  const grid: Grid | null = gameStore.grid;
  if (!grid) return;
  gridWidth.value = grid.width;
  gridHeight.value = grid.height;
  const builder = new TextGridBuilder(grid);
  gridText.value = builder.getText();
}

// A progressive stamp replaces gameStore.map. Rebuild the character grid so the new blocks appear.
watch(
  () => gameStore.map,
  () => rebuildTextGrid(),
);

onMounted(() => {
  rebuildTextGrid();
  measureCell();
  renderFrameHandle = requestAnimationFrame(renderFrame);
});

onUnmounted(() => {
  disposed = true;
  if (renderFrameHandle !== null) {
    cancelAnimationFrame(renderFrameHandle);
    renderFrameHandle = null;
  }
});
</script>

<style scoped>
.text-game-root {
  position: relative;
  line-height: 1;
}

.text-grid-scale {
  position: relative;
}

.text-grid-pre {
  margin: 0;
  white-space: pre;
  display: block;
  user-select: none;
}

.text-grid-canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
</style>
