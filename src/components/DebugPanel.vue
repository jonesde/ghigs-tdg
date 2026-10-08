<script setup lang="ts">
import { ref } from "vue";
import { usePanelDrag } from "@/composables/usePanelDrag.js";
import { getGameContent } from "@/content/gameContent.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { nextTimeScale } from "@/sim/GameRunState.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();

const panelPos = ref({ x: 8, y: 48 });
const panelRef = ref<HTMLElement | null>(null);

const { onHeaderMouseDown, onHeaderTouchStart } = usePanelDrag({
  read: () => panelPos.value,
  write: (position) => {
    panelPos.value = position;
  },
  panelRef,
  clampToViewport: true,
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
  persistStore.setHighestUnlockedMap(persistStore.lastSelectedThemeId, getGameContent().maps.levels.length - 1);
}

function dbgSpeed() {
  // nextTimeScale only walks the worker-accepted time scales, so the debug
  // setTimeScale amount can never be rejected by intake validation.
  const nextSpeed = nextTimeScale(gameStore.timeScale, 1);
  dispatchCommand({ commandId: 0, type: "action:debug", kind: "setTimeScale", amount: nextSpeed });
}
</script>

<template>
  <div
    ref="panelRef"
    class="debug-panel"
    :class="{ hidden: !uiStore.debugPanelVisible }"
    :style="{ top: panelPos.y + 'px', left: panelPos.x + 'px' }"
  >
    <div class="debug-header" @mousedown="onHeaderMouseDown" @touchstart="onHeaderTouchStart">
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
    <button @click="dbgSpeed">⚡ Cycle Speed</button>
  </div>
</template>

<style scoped>
.debug-panel {
  position: absolute;
  padding: 4px;
  background: var(--color-panel);
  border: 1px solid var(--color-danger-border);
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
  background: var(--color-surface);
  border: 1px solid var(--color-line-strong);
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
  background: var(--color-surface-hover);
}

.debug-panel button {
  padding: 3px 6px;
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger-border);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-xs);
  text-align: left;
}

.debug-panel button:hover {
  background: var(--color-danger-hover);
}
</style>
