<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { usePanelDrag } from "@/composables/usePanelDrag.js";
import { SELL_DISCOUNT_PCT } from "@/sim/Constants.js";
import type { TowerId } from "@/sim/ConstantsTower.js";
import { TOWER_META, TowerIds } from "@/sim/ConstantsTower.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

const discount = computed(() => {
  return persistStore.generalAddons?.sellActive === "discount" ? 1 - SELL_DISCOUNT_PCT : 1;
});

const towerList = Object.values(TowerIds) as TowerId[];

function toggleBuild(type: TowerId) {
  if (gameStore.progressivePlacementHold) return;
  const nextType = gameStore.selectedTowerType === type ? null : type;
  gameStore.selectBuildType(nextType);
  dispatchCommand({ commandId: 0, type: "action:selectBuildType", towerType: nextType });
}

function getCost(type: TowerId) {
  return Math.floor(TOWER_META[type].cost * discount.value);
}

function getTowerDisplayName(type: TowerId): string {
  return themeStore.getTowerVisual(type)?.name || type;
}

function getTowerDisplayColor(type: TowerId): string {
  return themeStore.getTowerVisual(type)?.color || "#8fbc8f";
}

function getTowerDisplayIcon(type: TowerId): string {
  return themeStore.getTowerVisual(type)?.icon || "\u2500";
}

const barRef = ref<HTMLElement | null>(null);
const barStyle = computed(() => ({ top: `${gameStore.gameShopPos.y}px`, left: `${gameStore.gameShopPos.x}px` }));

// Only the header drag comes from the shared composable. The shop also pins
// itself to whichever viewport edge it was nearest when a resize lands, which
// is a different concern than bounding a drag, so onResize stays here.
const { onHeaderMouseDown, onHeaderTouchStart } = usePanelDrag({
  read: () => gameStore.gameShopPos,
  write: (position) => {
    gameStore.gameShopPos = position;
  },
  panelRef: barRef,
  clampToViewport: true,
  clampOnResize: false,
});

let prevWidth = typeof window !== "undefined" ? window.innerWidth : 0;
let prevHeight = typeof window !== "undefined" ? window.innerHeight : 0;

// Rests the bar along the bottom edge, centered horizontally on the bar's own
// measured size. Measuring beats restating the CSS here: the CSS owns the
// layout, and a narrower or taller bar would silently move the resting spot.
function setInitialPosition(): void {
  const element = barRef.value;
  if (!element) return;
  const { offsetWidth: width, offsetHeight: height } = element;
  if (width === 0 || height === 0) return;
  gameStore.gameShopPos = { x: (window.innerWidth - width) / 2, y: window.innerHeight - height };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function onResize() {
  const el = barRef.value;
  if (!el) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (w === 0 || h === 0) return;

  const innerWidth = window.innerWidth;
  const innerHeight = window.innerHeight;
  let { x, y } = gameStore.gameShopPos;

  const pinnedLeft = x <= 20;
  const pinnedTop = y <= 20;
  const pinnedRight = x + w >= prevWidth - 20;
  const pinnedBottom = y + h >= prevHeight - 20;

  let newX = x;
  let newY = y;

  if (pinnedLeft) {
    newX = clamp(x, 0, innerWidth - w);
  } else if (pinnedRight) {
    const offsetRight = prevWidth - (x + w);
    newX = innerWidth - w - clamp(offsetRight, 0, innerWidth - w);
  } else {
    newX = clamp(x, 0, innerWidth - w);
  }

  if (pinnedTop) {
    newY = clamp(y, 0, innerHeight - h);
  } else if (pinnedBottom) {
    const offsetBottom = prevHeight - (y + h);
    newY = innerHeight - h - clamp(offsetBottom, 0, innerHeight - h);
  } else {
    newY = clamp(y, 0, innerHeight - h);
  }

  gameStore.gameShopPos = { x: newX, y: newY };

  prevWidth = innerWidth;
  prevHeight = innerHeight;
}

let initTimerId: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  initTimerId = setTimeout(() => {
    setInitialPosition();
    onResize();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", onResize);
    }
    initTimerId = null;
  }, 20);
});

onUnmounted(() => {
  if (initTimerId !== null) {
    clearTimeout(initTimerId);
    initTimerId = null;
  }
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", onResize);
  }
});
</script>

<template>
  <div class="build-bar" :style="barStyle" ref="barRef">
    <div class="build-bar-header" @mousedown="onHeaderMouseDown" @touchstart="onHeaderTouchStart">
      <span>Build Bar</span>
    </div>
    <div class="shop-bar">
      <button
        v-for="id in towerList"
        :key="id"
        type="button"
        class="shop-tower"
        :class="{ selected: gameStore.selectedTowerType === id }"
        :disabled="gameStore.gold < getCost(id)"
        :aria-pressed="gameStore.selectedTowerType === id"
        @click="toggleBuild(id)"
      >
        <span class="tower-icon" :style="{ color: getTowerDisplayColor(id) }">{{ getTowerDisplayIcon(id) }}</span>
        <span class="tower-name-wrap">
          <span v-for="word in getTowerDisplayName(id).split(' ')" :key="word" class="tower-name">{{ word }}</span>
        </span>
        <span class="tower-cost">{{ getCost(id) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.build-bar {
  position: absolute;
  z-index: 10;
  background: var(--color-panel-soft);
  border-radius: 6px 6px 0 0;
  border: 1px solid var(--color-border);
  overflow: visible;
}

.build-bar-header {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--build-bar-header-height);
  padding: 0 8px;
  cursor: grab;
  user-select: none;
}

.build-bar-header:active {
  cursor: grabbing;
}

.build-bar-header span {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.5px;
  font-weight: 500;
}

.shop-bar {
  position: relative;
  height: var(--build-bar-footer-height);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border-top: 1px solid var(--color-border);
  z-index: 19;
  overflow-x: auto;
}

.shop-tower {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  width: 150px;
  height: 48px;
  padding: 0 10px;
  border-radius: 6px;
  border: 2px solid var(--color-line);
  background: var(--color-surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.shop-tower:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.shop-tower:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.shop-tower.selected {
  background: color-mix(in srgb, var(--color-success) 25%, transparent);
  border-color: var(--color-success);
}

.shop-tower:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tower-icon {
  font-size: var(--font-xl);
  line-height: 1;
}

.tower-name-wrap {
  display: flex;
  flex-direction: column;
  margin: 2px 0;
}

.tower-name {
  font-size: var(--font-sm);
  color: var(--color-text);
  text-align: center;
  line-height: 1.2;
}

.tower-cost {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--color-gold);
}
</style>
