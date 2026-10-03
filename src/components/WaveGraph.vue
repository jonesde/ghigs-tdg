<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  WAVE_GRAPH_COLOR_DAMAGE,
  WAVE_GRAPH_COLOR_GEMS_EARNED,
  WAVE_GRAPH_COLOR_GOLD_EARNED,
  WAVE_GRAPH_COLOR_MAX_ENEMY_HEALTH,
  WAVE_GRAPH_DOT_OPACITY,
  WAVE_GRAPH_DOT_OPACITY_WAVE_START,
  WAVE_GRAPH_DOT_SIZE,
  WAVE_GRAPH_DOT_SPACING,
  WAVE_GRAPH_HEIGHT,
  WAVE_GRAPH_INTERVAL_SECONDS,
} from "@/sim/Constants.js";
import type { WaveGraphDot } from "@/sim/SimulationSnapshot.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const uiStore = useUiStore();

const overlayRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);

const containerWidth = ref(0);

const tooltipVisible = ref(false);
const tooltipDot = ref<{
  damage: number;
  peakEnemyHp: number;
  gold: number;
  gems: number;
  baseHealth: number;
  baseHealthColor: string;
  waveStart: boolean;
} | null>(null);
const tooltipX = ref(0);
const tooltipY = ref(0);

const tooltipPositionStyle = computed(() => ({ left: `${tooltipX.value}px`, top: `${tooltipY.value}px` }));

const hoveredDotIndex = ref<number | null>(null);

const timeAgo = computed(() => {
  // Re-evaluate each frame via gameStore.frameId so the relative time stays
  // current as new snapshots arrive (mirrors StatsPanel's getLatestSnapshot pattern).
  void gameStore.frameId;
  const dots = getLatestSnapshot()?.waveGraphDots ?? [];
  if (dots.length === 0 || hoveredDotIndex.value === null) return "";

  const intervalsAgo = dots.length - 1 - hoveredDotIndex.value;
  const totalSeconds = intervalsAgo * WAVE_GRAPH_INTERVAL_SECONDS;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `-${mm}:${ss}`;
});

interface PathData {
  d: string;
  opacity: number;
  stroke: string;
}

const paths = ref<PathData[]>(Array(5).fill({ d: "", opacity: 0, stroke: "" }));

const METRIC_COLORS: string[] = [
  WAVE_GRAPH_COLOR_DAMAGE,
  WAVE_GRAPH_COLOR_MAX_ENEMY_HEALTH,
  WAVE_GRAPH_COLOR_GOLD_EARNED,
  WAVE_GRAPH_COLOR_GEMS_EARNED,
];

let resizeObserver: ResizeObserver | null = null;

function getDots(): WaveGraphDot[] {
  return getLatestSnapshot()?.waveGraphDots ?? [];
}

function onResize(): void {
  if (!overlayRef.value) return;
  containerWidth.value = overlayRef.value.clientWidth;
  updatePaths();
}

function getMetricValue(dot: WaveGraphDot, metricIndex: number): number {
  switch (metricIndex) {
    case 0:
      return dot.damage;
    case 1:
      return dot.peakEnemyHp;
    case 2:
      return dot.gold;
    case 3:
      return dot.gems;
    case 4:
      return dot.baseHealth;
    default:
      return 0;
  }
}

function getMetricColor(metricIndex: number): string {
  if (metricIndex >= 0 && metricIndex < METRIC_COLORS.length) {
    return METRIC_COLORS[metricIndex]!;
  }
  return METRIC_COLORS[0] ?? "";
}

function computeMaxForMetric(dots: WaveGraphDot[], metricIndex: number): number {
  let max = 0;
  for (const dot of dots) {
    const value = getMetricValue(dot, metricIndex);
    if (value > max) {
      max = value;
    }
  }
  return max;
}

function buildPathD(dots: WaveGraphDot[], metricIndex: number, maxVal: number): string {
  if (dots.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i];
    if (!dot) continue;
    const x = i * WAVE_GRAPH_DOT_SPACING;
    const value = getMetricValue(dot, metricIndex);
    let y: number;
    if (value <= 0 || maxVal <= 0) {
      y = WAVE_GRAPH_HEIGHT;
    } else {
      const normalized = value / maxVal;
      y = WAVE_GRAPH_HEIGHT - normalized * WAVE_GRAPH_HEIGHT;
    }
    parts.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
  }
  return parts.join(" ");
}

function updatePaths(): void {
  const dots = getDots();
  const maxDots = Math.ceil(containerWidth.value / WAVE_GRAPH_DOT_SPACING);
  if (maxDots <= 0) return;

  const visibleStart = Math.max(0, dots.length - maxDots);
  const visibleCount = Math.min(maxDots, dots.length);

  if (visibleCount === 0) {
    for (let m = 0; m < 5; m++) {
      paths.value[m] = { d: "", opacity: 0, stroke: getMetricColor(m) };
    }
    return;
  }

  const visibleDots: WaveGraphDot[] = [];
  for (let i = 0; i < visibleCount; i++) {
    const dot = dots[visibleStart + i];
    if (dot) {
      visibleDots.push(dot);
    }
  }

  for (let m = 0; m < 5; m++) {
    const maxVal = computeMaxForMetric(visibleDots, m);
    const d = buildPathD(visibleDots, m, maxVal);

    let opacity = 0;
    let stroke = getMetricColor(m);

    if (maxVal > 0) {
      const anyWaveStart = visibleDots.some((dot) => dot.waveStart);
      opacity = anyWaveStart ? WAVE_GRAPH_DOT_OPACITY_WAVE_START : WAVE_GRAPH_DOT_OPACITY;

      if (m === 4) {
        const lastDot = visibleDots[visibleDots.length - 1];
        stroke = lastDot?.baseHealthColor ?? getMetricColor(0);
      }
    }

    paths.value[m] = { d, opacity, stroke };
  }
}

function onMouseMove(event: MouseEvent): void {
  if (!overlayRef.value) return;

  const rect = overlayRef.value.getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  const dotIndex = Math.floor(relativeX / WAVE_GRAPH_DOT_SPACING);

  const dots = getDots();
  const maxDots = Math.ceil(containerWidth.value / WAVE_GRAPH_DOT_SPACING);
  const visibleStart = Math.max(0, dots.length - maxDots);
  const actualIndex = dotIndex + visibleStart;

  if (actualIndex >= 0 && actualIndex < dots.length) {
    const dot = dots[actualIndex];
    if (!dot) return;
    tooltipDot.value = dot;
    hoveredDotIndex.value = actualIndex;
    tooltipVisible.value = true;

    let posX = event.clientX - rect.left;
    const tooltipWidth = 160;
    if (posX + tooltipWidth > rect.width) {
      posX = rect.width - tooltipWidth;
    }
    if (posX < 0) posX = 0;

    tooltipX.value = posX;
    tooltipY.value = -60;
  } else {
    tooltipVisible.value = false;
    tooltipDot.value = null;
    hoveredDotIndex.value = null;
  }
}

watch(
  () =>
    uiStore.showPauseMenu ||
    uiStore.showSkillTree ||
    uiStore.showStatsPanel ||
    uiStore.showHelpDialog ||
    uiStore.confirmDialog,
  () => {
    tooltipVisible.value = false;
    tooltipDot.value = null;
    hoveredDotIndex.value = null;
  },
);

// The engine's renderCallback no longer exists in the worker model, so drive the
// per-frame graph redraw from the mirrored frameId — same seam StatsPanel uses.
watch(() => gameStore.frameId, updatePaths, { immediate: true });

onMounted(() => {
  if (!overlayRef.value) return;

  const initialWidth = overlayRef.value.clientWidth;
  if (initialWidth > 0) {
    containerWidth.value = initialWidth;
  }

  resizeObserver = new ResizeObserver(() => {
    onResize();
  });
  resizeObserver.observe(overlayRef.value);

  onResize();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div
    v-show="gameStore.isInGame"
    ref="overlayRef"
    class="wave-graph-overlay"
    @mousemove="onMouseMove"
    @mouseleave="tooltipVisible = false"
  >
    <div class="wave-graph-separator"></div>
    <svg
      ref="svgRef"
      class="wave-graph-svg"
      :viewBox="`0 0 ${containerWidth} ${WAVE_GRAPH_HEIGHT}`"
      xmlns="http://www.w3.org/2000/svg"
      pointer-events="none"
    >
      <path
        v-for="(p, i) in paths"
        :key="i"
        :d="p.d"
        :stroke="p.stroke"
        :style="{ opacity: p.opacity }"
        fill="none"
        :stroke-width="WAVE_GRAPH_DOT_SIZE"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    <div
      v-if="tooltipVisible && tooltipDot"
      class="wave-graph-tooltip"
      :style="tooltipPositionStyle"
    >
      <div class="wg-row wg-title">
        <span class="wg-title-label">{{ timeAgo }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_DAMAGE }">
        <span class="wg-label">Damage</span><span class="wg-value">{{ tooltipDot.damage }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_MAX_ENEMY_HEALTH }">
        <span class="wg-label">Peak HP</span><span class="wg-value">{{ tooltipDot.peakEnemyHp }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_GOLD_EARNED }">
        <span class="wg-label">Gold</span><span class="wg-value">{{ tooltipDot.gold }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_GEMS_EARNED }">
        <span class="wg-label">Gems</span><span class="wg-value">{{ tooltipDot.gems }}</span>
      </div>
      <div class="wg-row" :style="{ color: tooltipDot?.baseHealthColor }">
        <span class="wg-label">Base HP</span><span class="wg-value">{{ tooltipDot?.baseHealth }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wave-graph-overlay {
  position: absolute;
  bottom: 2px;
  left: 0;
  right: 0;
  z-index: 9;
  pointer-events: all;
}

.wave-graph-separator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--color-line-strong);
  pointer-events: none;
}

.wave-graph-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.wave-graph-tooltip {
  position: absolute;
  background: var(--color-panel);
  border: 1px solid var(--color-line-strong);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: var(--font-xs);
  font-family: var(--font-main);
  color: var(--color-text);
  pointer-events: none;
  white-space: nowrap;
  z-index: 12;
}

.wg-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  line-height: 1.5;
}

.wg-title {
  justify-content: center;
  padding-bottom: 2px;
  margin-bottom: 2px;
  border-bottom: 1px solid var(--color-line);
}

.wg-title-label {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.wg-label {
  color: var(--color-text-dim);
  font-weight: 500;
}

.wg-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
