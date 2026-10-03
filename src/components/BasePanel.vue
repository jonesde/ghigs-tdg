<script setup lang="ts">
import { computed, onUnmounted } from "vue";
import { dispatchCommand } from "@/sim/commandBus.js";
import { useGameStore } from "@/stores/game.js";

const gameStore = useGameStore();

const defense = computed(() => (gameStore.selectedTowerId === "base" ? gameStore.baseDefense : null));

function fireRateLabel(fireRate: number): string {
  if (!(fireRate > 0)) return "—";
  return fireRate < 1 ? `${(1 / fireRate).toFixed(2)} s/shot` : `${fireRate.toFixed(2)}/s`;
}

function handleUpgrade() {
  dispatchCommand({ commandId: 0, type: "action:upgradeSelected" });
}

function handleDowngrade() {
  dispatchCommand({ commandId: 0, type: "action:downgradeSelected" });
}

function handleTargetingChange(event: Event) {
  const mode = (event.target as HTMLSelectElement).value;
  dispatchCommand({ commandId: 0, type: "action:setTargeting", mode });
}

const canAffordUpgrade = computed(() => {
  const panel = defense.value;
  if (!panel?.canUpgrade) return false;
  return gameStore.gold >= panel.upgradeCost;
});

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
  panelStartX = gameStore.towerPanelPos.x;
  panelStartY = gameStore.towerPanelPos.y;

  currentOnMove = (moveEvent: MouseEvent) => {
    if (!dragging) return;
    gameStore.towerPanelPos = {
      x: panelStartX + (moveEvent.clientX - dragStartX),
      y: panelStartY + (moveEvent.clientY - dragStartY),
    };
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
</script>

<template>
  <div
    v-if="defense"
    class="tower-panel"
    :style="{ top: gameStore.towerPanelPos.y + 'px', left: gameStore.towerPanelPos.x + 'px' }"
  >
    <div class="panel-header" @mousedown="onHeaderMouseDown">Base Lv {{ defense.level }}</div>

    <div class="stat-row">
      <span>Health</span>
      <span>{{ Math.ceil(gameStore.baseHealth) }} / {{ Math.round(gameStore.maxBaseHealth) }}</span>
    </div>

    <template v-if="defense.shortStats">
      <div class="gun-label">Short Range</div>
      <div class="stat-row"><span>Damage</span><span>{{ Math.round(defense.shortStats.damage) }}</span></div>
      <div class="stat-row"><span>Range</span><span>{{ defense.shortStats.range.toFixed(2) }}</span></div>
      <div class="stat-row"><span>Fire Rate</span><span>{{ fireRateLabel(defense.shortStats.fireRate) }}</span></div>
    </template>

    <template v-if="defense.longStats">
      <div class="gun-label">Long Range</div>
      <div class="stat-row"><span>Damage</span><span>{{ Math.round(defense.longStats.damage) }}</span></div>
      <div class="stat-row"><span>Range</span><span>{{ defense.longStats.range.toFixed(2) }}</span></div>
      <div class="stat-row"><span>Fire Rate</span><span>{{ fireRateLabel(defense.longStats.fireRate) }}</span></div>
    </template>

    <div class="stat-row"><span>Total Damage</span><span>{{ Math.round(defense.totalDamageDealt).toLocaleString() }}</span></div>
    <div class="stat-row"><span>Wave Damage</span><span>{{ Math.round(defense.waveDamage).toLocaleString() }}</span></div>
    <div class="stat-row"><span>Previous Wave</span><span>{{ Math.round(defense.previousWaveDamage).toLocaleString() }}</span></div>

    <div class="stat-row"><span>Targeting</span><kbd>F</kbd></div>
    <select class="target-select" :value="defense.targeting" @change="handleTargetingChange">
      <option value="first">First</option>
      <option value="last">Last</option>
      <option value="closest">Closest</option>
      <option value="strong">Strongest</option>
      <option value="furthest">Furthest</option>
    </select>

    <div v-if="defense.canUpgrade">
      <button class="action-btn" :disabled="!canAffordUpgrade" @click="handleUpgrade">
        <span class="btn-content">Upgrade ({{ defense.upgradeCost }}g) → Lv {{ defense.nextLevel }}<kbd>W|U</kbd></span>
      </button>
    </div>
    <div v-else>
      <button class="action-btn" disabled>{{ defense.blockedReason || "Max level reached" }}</button>
    </div>

    <button class="action-btn downgrade-btn" :disabled="defense.level <= 1" @click="handleDowngrade">
      <span v-if="defense.level > 1" class="btn-content">
        Downgrade (Lv {{ defense.level }} → Lv {{ defense.level - 1 }}) (+{{ defense.downgradeRefund }}g)
        <kbd>S</kbd>
      </span>
      <span v-else class="btn-content">Downgrade</span>
    </button>
  </div>
</template>

<style scoped>
.tower-panel {
  position: absolute;
  width: 240px;
  padding: 10px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  z-index: 11;
  font-size: var(--font-sm);
}

.panel-header {
  font-weight: bold;
  font-size: var(--font-md);
  margin-bottom: 8px;
  cursor: grab;
  user-select: none;
  color: var(--color-accent);
}

.panel-header:active {
  cursor: grabbing;
}

.gun-label {
  margin-top: 6px;
  font-weight: bold;
  color: var(--color-text);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  color: var(--color-text-dim);
}

.stat-row span:last-child {
  color: var(--color-text);
  font-weight: 500;
}

.target-select {
  width: 100%;
  padding: 4px;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 4px;
  font-size: var(--font-sm);
}

.action-btn {
  width: 100%;
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-sm);
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.downgrade-btn {
  color: var(--color-accent);
  border-color: rgba(95, 208, 255, 0.3);
}

.btn-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 8px;
}
</style>
