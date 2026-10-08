<script setup lang="ts">
import { computed, ref } from "vue";
import { usePanelDrag } from "@/composables/usePanelDrag.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { baseSelectionId } from "@/sim/towers/BaseDefense.js";
import { useGameStore } from "@/stores/game.js";

const gameStore = useGameStore();

const panelRef = ref<HTMLElement | null>(null);

const { onHeaderMouseDown, onHeaderTouchStart } = usePanelDrag({
  read: () => gameStore.basePanelPos,
  write: (position) => {
    gameStore.basePanelPos = position;
  },
  panelRef,
  clampToViewport: true,
});

const defense = computed(() => (gameStore.selectedTowerId === baseSelectionId ? gameStore.baseDefense : null));

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
</script>

<template>
  <div
    v-if="defense"
    ref="panelRef"
    class="base-panel detail-panel"
    :style="{ top: gameStore.basePanelPos.y + 'px', left: gameStore.basePanelPos.x + 'px' }"
  >
    <div class="panel-header" @mousedown="onHeaderMouseDown" @touchstart="onHeaderTouchStart">Base Lv {{ defense.level }}</div>

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
/* Shared panel chrome (position, rows, selects, buttons) is in
   detailPanel.css. Only what differs from TowerPanel belongs here. */
.base-panel {
  width: 240px;
}

/* Identity class on the override: detailPanel.css's shared rule is also
   (0,2,0), so a bare scoped .panel-header would tie it and lose to chunk
   load order whenever the shared rule grows a conflicting property. */
.base-panel .panel-header {
  color: var(--color-accent);
}

.gun-label {
  margin-top: 6px;
  font-weight: bold;
  color: var(--color-text);
}
</style>
