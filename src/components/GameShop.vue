<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FOOTER_HEIGHT, HEADER_HEIGHT, SELL_DISCOUNT_PCT } from "@/sim/Constants.js";
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

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let shopStartX = 0;
let shopStartY = 0;
let currentOnMove: ((event: MouseEvent) => void) | null = null;
let currentOnUp: (() => void) | null = null;
let currentTouchMove: ((event: TouchEvent) => void) | null = null;
let currentTouchEnd: (() => void) | null = null;

const barRef = ref<HTMLElement | null>(null);
const barStyle = computed(() => ({ top: `${gameStore.gameShopPos.y}px`, left: `${gameStore.gameShopPos.x}px` }));

let prevWidth = typeof window !== "undefined" ? window.innerWidth : 0;
let prevHeight = typeof window !== "undefined" ? window.innerHeight : 0;

function setInitialPosition() {
  if (typeof window === "undefined") return;
  // NOTE: 160 is width per button as per CSS; 84 = 20 (header/hud) + 64 (footer)
  gameStore.gameShopPos = { x: (window.innerWidth - towerList.length * 160) / 2, y: window.innerHeight - 84 };
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

function onHeaderMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  dragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  shopStartX = gameStore.gameShopPos.x;
  shopStartY = gameStore.gameShopPos.y;

  currentOnMove = (event: MouseEvent) => {
    if (!dragging) return;
    gameStore.gameShopPos = {
      x: shopStartX + (event.clientX - dragStartX),
      y: shopStartY + (event.clientY - dragStartY),
    };
  };
  currentOnUp = () => {
    dragging = false;
    cleanupDragListeners();
  };
  document.addEventListener("mousemove", currentOnMove);
  document.addEventListener("mouseup", currentOnUp);
  event.preventDefault();
  event.stopPropagation();
}

function onHeaderTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1) return;
  dragging = true;
  dragStartX = event.touches[0].clientX;
  dragStartY = event.touches[0].clientY;
  shopStartX = gameStore.gameShopPos.x;
  shopStartY = gameStore.gameShopPos.y;

  currentTouchMove = (event: TouchEvent) => {
    if (!dragging || event.touches.length !== 1) return;
    gameStore.gameShopPos = {
      x: shopStartX + (event.touches[0].clientX - dragStartX),
      y: shopStartY + (event.touches[0].clientY - dragStartY),
    };
  };
  currentTouchEnd = () => {
    dragging = false;
    cleanupTouchListeners();
  };
  document.addEventListener("touchmove", currentTouchMove, { passive: true });
  document.addEventListener("touchend", currentTouchEnd);
  event.preventDefault();
  event.stopPropagation();
}

function cleanupDragListeners() {
  if (currentOnMove) document.removeEventListener("mousemove", currentOnMove);
  if (currentOnUp) document.removeEventListener("mouseup", currentOnUp);
  currentOnMove = null;
  currentOnUp = null;
}

function cleanupTouchListeners() {
  if (currentTouchMove) document.removeEventListener("touchmove", currentTouchMove);
  if (currentTouchEnd) document.removeEventListener("touchend", currentTouchEnd);
  currentTouchMove = null;
  currentTouchEnd = null;
}

onUnmounted(() => {
  if (initTimerId !== null) {
    clearTimeout(initTimerId);
    initTimerId = null;
  }
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", onResize);
  }
  cleanupDragListeners();
  cleanupTouchListeners();
});
</script>

<template>
  <div class="build-bar" :style="barStyle" ref="barRef">
    <div class="build-bar-header" @mousedown="onHeaderMouseDown" @touchstart="onHeaderTouchStart">
      <span>Build Bar</span>
    </div>
    <div class="shop-bar">
      <div v-for="id in towerList" :key="id" class="shop-tower"
        :class="{ selected: gameStore.selectedTowerType === id, disabled: gameStore.gold < getCost(id), }"
        @click="gameStore.gold >= getCost(id) && toggleBuild(id)"
      >
        <span class="tower-icon" :style="{ color: getTowerDisplayColor(id) }">{{ getTowerDisplayIcon(id) }}</span>
        <div class="tower-name-wrap">
          <div v-for="word in getTowerDisplayName(id).split(' ')" :key="word" class="tower-name">{{ word }}</div>
        </div>
        <span class="tower-cost">{{ getCost(id) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.build-bar {
  position: absolute;
  z-index: 10;
  background: rgba(20, 24, 50, 0.7);
  border-radius: 6px 6px 0 0;
  border: 1px solid var(--color-border);
  overflow: visible;
}

.build-bar-header {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 20px;
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
  height: 64px;
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
  border: 2px solid rgba(20, 40, 50, 1);
  background: rgba(20, 40, 50, 0.5);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.shop-tower:hover {
  background: rgba(40, 80, 100, 1);
}

.shop-tower.selected {
  background: #1a5c2a;
  border-color: var(--color-success);
}

.shop-tower.disabled {
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
