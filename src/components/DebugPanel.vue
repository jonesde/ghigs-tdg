<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { dispatchCommand } from "@/sim/commandBus.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();

const panelPos = ref({ x: 8, y: 48 });

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panelStartX = 0;
let panelStartY = 0;
let currentOnMove: ((event: MouseEvent) => void) | null = null;
let currentOnUp: (() => void) | null = null;

function onHeaderMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  dragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  panelStartX = panelPos.value.x;
  panelStartY = panelPos.value.y;

  currentOnMove = (event: MouseEvent) => {
    if (!dragging) return;
    panelPos.value = { x: panelStartX + (event.clientX - dragStartX), y: panelStartY + (event.clientY - dragStartY) };
  };
  currentOnUp = () => {
    dragging = false;
    cleanupDragListeners();
  };
  document.addEventListener("mousemove", currentOnMove);
  document.addEventListener("mouseup", currentOnUp);
  event.preventDefault();
}

function cleanupDragListeners() {
  if (currentOnMove) document.removeEventListener("mousemove", currentOnMove);
  if (currentOnUp) document.removeEventListener("mouseup", currentOnUp);
  currentOnMove = null;
  currentOnUp = null;
}

onUnmounted(() => {
  cleanupDragListeners();
});

function dbgGold() {
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "addGold", amount: 1000 });
}

function dbgGems() {
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "addGems", amount: 100 });
}

function dbgBaseHealth() {
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "addBaseHealth", amount: 100 });
}

function dbgSkipWave() {
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "skipWave" });
}

function dbgKillAll() {
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "killAll" });
}

function dbgWave() {
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "setWave", amount: 50 });
}

function dbgUnlockAll() {
  // Unlock applies to the selected world's progress bucket.
  persistStore.setHighestUnlockedMap(persistStore.lastSelectedThemeId, 35);
}

function dbgSpeed() {
  // Cycle within the worker-accepted setTimeScale whitelist (1, 2, 4, 8); anything
  // else is rejected by intake validation and would leave the speed unchanged.
  const speeds = [1, 2, 4, 8];
  const currentIndex = speeds.indexOf(gameStore.timeScale);
  const nextSpeed = speeds[(currentIndex + 1 + speeds.length) % speeds.length]!;
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "setTimeScale", amount: nextSpeed });
}
</script>

<template>
  <div class="debug-panel" :class="{ hidden: !uiStore.debugPanelVisible }" :style="{ top: panelPos.y + 'px', left: panelPos.x + 'px' }">
    <div class="debug-header" @mousedown="onHeaderMouseDown">
      <span class="header-icon">⚙️</span>
      Debug
      <button class="debug-close" @click="uiStore.closeDebugPanel()" aria-label="Close debug panel">✕</button>
    </div>
    <button @click="dbgGold">🪙 +1000 Gold</button>
    <button @click="dbgGems">💎 +100 Gems</button>
    <button @click="dbgBaseHealth">❤️ +100 Health</button>
    <button @click="dbgSkipWave">⏭️ Skip Wave</button>
    <button @click="dbgKillAll">💀 Kill All</button>
    <button @click="dbgWave">🎯 Set Wave 50</button>
    <button @click="dbgUnlockAll">🔓 Unlock All Maps</button>
    <button @click="dbgSpeed">⚡ Toggle 16x Speed</button>
  </div>
</template>

<style scoped>
.debug-panel {
  position: absolute;
  padding: 4px;
  background: var(--color-panel);
  border: 1px solid rgba(255, 68, 68, 0.3);
  border-radius: 8px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--font-xs);
}

.debug-panel.hidden {
  display: none;
}

.debug-header {
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: bold;
  color: var(--color-danger);
  margin-bottom: 2px;
  cursor: grab;
  user-select: none;
  padding: 2px 4px;
}

.debug-header:active {
  cursor: grabbing;
}

.header-icon {
  font-size: var(--font-sm);
}

.debug-close {
  margin-left: auto;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  width: 18px;
  height: 18px;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  padding: 0;
  line-height: 1;
}

.debug-close:hover {
  background: rgba(255, 255, 255, 0.15);
}

.debug-panel button {
  padding: 3px 6px;
  background: rgba(255, 68, 68, 0.1);
  border: 1px solid rgba(255, 68, 68, 0.2);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-xs);
  text-align: left;
}

.debug-panel button:hover {
  background: rgba(255, 68, 68, 0.2);
}
</style>
