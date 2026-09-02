<script setup lang="ts">
import { computed, onUnmounted } from "vue";
import { UPGRADE_COST_REDUCTION_PCT } from "@/sim/Constants.js";
import { CANCEL_BUILD_WINDOW_MS, SELL_VALUE_RATIO, TOWER_META } from "@/sim/ConstantsTower.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import type { TowerSnapshot } from "@/sim/SimulationSnapshot.js";
import { VARIANT_INFO } from "@/sim/towers/SkillTree.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

// selectedTower is the worker-projected TowerSnapshot (cast to Tower by
// SnapshotStore). We read it through the snapshot shape here so the UI only
// reads plain data fields — never calls tower methods.
const tower = computed(() => gameStore.selectedTower as unknown as TowerSnapshot | null);
const upgradeCheck = computed(() => tower.value?.canUpgrade ?? null);
const sellValue = computed(() => tower.value?.sellValue ?? 0);

function getTowerName(type: string): string {
  return themeStore.getTowerVisual(type)?.name || type;
}

// Reactive damage tracking
// The selected tower is a reactive projection mirrored by SnapshotStore through
// the gameStore proxy every frame, so these fields update without a manual tick.
// `previousWaveDamage` is derived per-tower by the main-thread projection
// (SnapshotStore) from the deserialized snapshots and stamped onto the tower
// model — keyed by tower id, so it is never shared across towers and updates on
// every wave (the engine's wave-start `waveDamage` reset is what the projection
// detects). The UI only reads the plain field.
const damageStats = computed(() => {
  const selectedTower = tower.value;
  if (!selectedTower) return null;
  return {
    total: Math.round(selectedTower.totalDamageDealt),
    wave: Math.round(selectedTower.waveDamage),
    previousWave: Math.round(selectedTower.previousWaveDamage ?? 0),
  };
});

// Specialization name display (Phase 2)
const specName = computed(() => {
  const selectedTower = tower.value;
  if (!selectedTower?.variant) return null;
  const info = VARIANT_INFO[selectedTower.type];
  if (!info) {
    console.warn(`[TowerPanel] No VARIANT_INFO for tower type "${selectedTower.type}"`);
    return null;
  }
  return info[selectedTower.variant]?.name || null;
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

  currentOnMove = (event: MouseEvent) => {
    if (!dragging) return;
    gameStore.towerPanelPos = {
      x: panelStartX + (event.clientX - dragStartX),
      y: panelStartY + (event.clientY - dragStartY),
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

const milestoneTier = computed(() => persistStore.generalAddons?.damageMilestoneBonus);
const milestoneBonus = computed(() => {
  if (milestoneTier.value !== null && milestoneTier.value !== undefined && tower.value) {
    return tower.value.milestoneBonus;
  }
  return null;
});

const targetingMode = computed(() => {
  return tower.value?.targeting || "first";
});

function handleTargetingChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  targetingMode.value = target.value;
  dispatchCommand({ commandId: 0, type: "action:setTargeting", mode: target.value });
}

function handleUpgrade() {
  dispatchCommand({ commandId: 0, type: "action:upgradeSelected" });
}

function handleSell() {
  dispatchCommand({ commandId: 0, type: "action:sellSelected" });
}

function handleSpecialize(variant: string) {
  dispatchCommand({ commandId: 0, type: "action:specialize", variant: variant as "A" | "B" });
}

function handleDowngrade() {
  dispatchCommand({ commandId: 0, type: "action:downgradeSelected" });
}

function getUpgradeCost() {
  return upgradeCheck.value?.cost ?? 0;
}

const canAffordUpgrade = computed(() => {
  return upgradeCheck.value?.ok && gameStore.gold >= getUpgradeCost();
});

const sellDisabled = computed(
  () => (persistStore.generalAddons && persistStore.generalAddons.sellActive === "discount") || !!tower.value?.isGhost,
);

const downgradeRefund = computed(() => {
  if (!tower.value || tower.value.level <= 1) return 0;
  const levelCosts = tower.value.levelCosts;
  const delta = levelCosts[tower.value.level - 1] || 0;
  const isRefund = persistStore.generalAddons?.sellActive === "refund";
  return isRefund ? delta : Math.round(delta * SELL_VALUE_RATIO);
});

const variantInfo = computed(() => {
  if (tower.value) return VARIANT_INFO[tower.value.type];
  return null;
});

const variantAUnlocked = computed(() => {
  const unlocked = persistStore.unlocked[tower.value?.type];
  return unlocked?.variantA?.[0] || false;
});

const variantBUnlocked = computed(() => {
  const unlocked = persistStore.unlocked[tower.value?.type];
  return unlocked?.variantB?.[0] || false;
});

// Phase 3: level 5 cost for specialization
const lv5Cost = computed(() => {
  if (!tower.value) return 0;
  const cost = tower.value.upgradeCostAt5;
  const ucrTier = persistStore.generalAddons?.upgradeCostReduction;
  if (ucrTier !== null && ucrTier !== undefined) {
    const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
    return Math.floor(cost * (1 - reduction));
  }
  return cost;
});

const canAffordSpecialize = computed(() => {
  return gameStore.gold >= lv5Cost.value;
});

// Cancel window is sim time: snapshot placedAt is elapsed sim ms since place
// (Tower._gameSeconds), so pause freezes the window and timeScale scales it.
const canCancel = computed(() => {
  if (!tower.value) return false;
  return tower.value.placedAt < CANCEL_BUILD_WINDOW_MS && tower.value.level === 1;
});

const cancelRemaining = computed(() => {
  if (!tower.value) return 0;
  return Math.ceil(Math.max(0, CANCEL_BUILD_WINDOW_MS - tower.value.placedAt) / 1000);
});

// Phase 6: Fixed aim for railgun
const hasFixedAim = computed(() => tower.value?.base?.fixedAim || false);
const fixedAimDir = computed(() => tower.value?.fixedAimDir);

function handleFixedAim(dir: string | null) {
  dispatchCommand({ commandId: 0, type: "action:setFixedAimDir", dir: dir as "N" | "E" | "S" | "W" | null });
}
</script>

<template>
  <div v-if="tower" class="tower-panel" :style="{ top: gameStore.towerPanelPos.y + 'px', left: gameStore.towerPanelPos.x + 'px' }">
    <div class="panel-header" :style="{ color: tower.color }" @mousedown="onHeaderMouseDown">
      {{ getTowerName(tower.type) }} Lv {{ tower.level }}
      <span v-if="specName" class="spec-badge">{{ specName }}</span>
    </div>

    <div v-if="tower.isGhost" class="stat-row ghost-row"><span class="ghost-label">Ghost</span></div>
    <div v-else class="stat-row"><span>Health</span><span>{{ Math.ceil(tower.health) }} / {{ Math.round(tower.maxHealth) }}</span></div>
    <div class="stat-row"><span>Damage</span><span>{{ Math.round(tower.stats.damage) }}</span></div>
    <div class="stat-row"><span>Range</span><span>{{ tower.stats.range.toFixed(1) }}</span></div>
    <div class="stat-row"><span>Fire Rate</span><span>{{ tower.stats.fireRate < 1 ? (1 / tower.stats.fireRate).toFixed(2) + ' s/shot' : tower.stats.fireRate.toFixed(2) + '/s' }}</span></div>
    <div v-if="tower.stats.splash" class="stat-row"><span>Splash</span><span>{{ tower.stats.splash.toFixed(1) }}</span></div>
    <div v-if="tower.stats.chain" class="stat-row"><span>Chain</span><span>{{ tower.stats.chain }}</span></div>
    <div class="stat-row"><span>Total Damage</span><span>{{ damageStats?.total?.toLocaleString() ?? 0 }}</span></div>
    <div class="stat-row"><span>Wave Damage</span><span>{{ damageStats?.wave?.toLocaleString() ?? 0 }}</span></div>
    <div class="stat-row"><span>Previous Wave</span><span>{{ damageStats?.previousWave?.toLocaleString() ?? 0 }}</span></div>

    <div v-if="milestoneBonus && milestoneBonus.tiers > 0" class="milestone-bonus">
      Milestone Bonus: +{{ Math.round(milestoneBonus.damagePct) }}% dmg, +{{ Math.round(milestoneBonus.speedPct) }}% speed ({{ milestoneBonus.tiers }}×1M total)
    </div>

    <div class="stat-row"><span>Targeting</span><kbd>F</kbd></div>
    <select class="target-select" :value="targetingMode" @change="handleTargetingChange">
      <option value="first">First</option>
      <option value="last">Last</option>
      <option value="closest">Closest</option>
      <option value="strong">Strongest</option>
      <option value="furthest">Furthest</option>
    </select>

    <div v-if="hasFixedAim" class="fixed-aim-section">
      <div class="fixed-aim-title">Aim Direction:</div>
      <div class="fixed-aim-grid">
        <button class="aim-dot" :class="{ active: fixedAimDir === 'N' }" @click="handleFixedAim('N')">N</button>
      </div>
      <div class="fixed-aim-grid-h">
        <button class="aim-dot" :class="{ active: fixedAimDir === 'W' }" @click="handleFixedAim('W')">W</button>
        <button class="aim-dot auto-dot" :class="{ active: !fixedAimDir }" @click="handleFixedAim(null)">Auto</button>
        <button class="aim-dot" :class="{ active: fixedAimDir === 'E' }" @click="handleFixedAim('E')">E</button>
      </div>
      <div class="fixed-aim-grid">
        <button class="aim-dot" :class="{ active: fixedAimDir === 'S' }" @click="handleFixedAim('S')">S</button>
      </div>
    </div>

    <div v-if="upgradeCheck?.needVariant" class="variant-section">
      <div class="variant-title">Choose Specialization:</div>
      <button class="action-btn" :disabled="!variantAUnlocked || !canAffordSpecialize" @click="handleSpecialize('A')">
        <span class="btn-content">{{ variantInfo?.A?.name }} ({{ lv5Cost }}g)<kbd>E</kbd></span>
      </button>
      <button class="action-btn" :disabled="!variantBUnlocked || !canAffordSpecialize" @click="handleSpecialize('B')">
        <span class="btn-content">{{ variantInfo?.B?.name }} ({{ lv5Cost }}g)<kbd>C</kbd></span>
      </button>
    </div>
    <div v-else-if="upgradeCheck?.ok">
      <button class="action-btn" :disabled="!canAffordUpgrade" @click="handleUpgrade">
        <span class="btn-content">Upgrade ({{ getUpgradeCost() }}g) → Lv {{ upgradeCheck.nextLevel }}<kbd>W|U</kbd></span>
      </button>
    </div>
    <div v-else>
      <button class="action-btn" disabled>{{ upgradeCheck?.reason || 'Max' }}</button>
    </div>

    <button class="action-btn downgrade-btn" :disabled="tower.level <= 1 || tower.isGhost" @click="handleDowngrade">
      <span class="btn-content">Downgrade (Lv {{ tower.level }} → Lv {{ tower.level - 1 }}) (+{{ downgradeRefund }}g)<kbd v-if="tower.level > 1">S</kbd></span>
    </button>

    <button
      class="action-btn"
      :class="canCancel ? 'cancel-btn' : 'sell-btn'"
      :disabled="sellDisabled"
      @click="handleSell"
    >
      <span class="btn-content">
        <template v-if="canCancel">Cancel Build — {{ tower.totalInvested }}g ({{ cancelRemaining }}s)</template>
        <template v-else>{{ sellDisabled ? 'Selling disabled (discount mode)' : `Sell (+${sellValue}g)` }}</template>
        <kbd v-if="canCancel || tower.level <= 1">S</kbd>
      </span>
    </button>
  </div>
</template>

<style scoped>
.tower-panel {
  position: absolute;
  width: 220px;
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
}

.panel-header:active {
  cursor: grabbing;
}

.spec-badge {
  font-size: var(--font-xs);
  font-weight: normal;
  color: var(--color-accent);
  margin-left: 6px;
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

.ghost-row {
  justify-content: center;
}

.ghost-row .ghost-label {
  color: var(--color-danger);
  font-style: italic;
  font-weight: 600;
  text-align: center;
}

.milestone-bonus {
  margin-top: 6px;
  font-size: var(--font-xs);
  color: var(--color-success);
  padding: 4px;
  background: rgba(68, 255, 68, 0.08);
  border-radius: 4px;
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

.variant-section {
  margin-top: 8px;
}

.variant-title {
  font-weight: bold;
  margin-bottom: 4px;
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
  transition: background 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sell-btn {
  color: var(--color-danger);
  border-color: rgba(255, 68, 68, 0.3);
}

.cancel-btn {
  color: var(--color-success);
  border-color: rgba(68, 255, 68, 0.3);
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
}

kbd {
  font-family: inherit;
  font-size: var(--font-xs);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.5);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text);
  margin-left: 8px;
  white-space: nowrap;
}

.fixed-aim-section {
  margin-top: 8px;
  text-align: center;
}

.fixed-aim-title {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  margin-bottom: 4px;
}

.fixed-aim-grid {
  display: flex;
  justify-content: center;
}

.fixed-aim-grid-h {
  display: flex;
  justify-content: center;
  gap: 4px;
}

.aim-dot {
  width: 32px;
  height: 24px;
  margin: 2px;
  padding: 0;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-xs);
  font-weight: bold;
  transition: background 0.15s;
}

.aim-dot:hover {
  background: rgba(255, 255, 255, 0.15);
}

.aim-dot.active {
  background: rgba(95, 208, 255, 0.3);
  border-color: rgba(95, 208, 255, 0.6);
  color: #5fd0ff;
}

.auto-dot {
  width: auto;
  padding: 0 6px;
  font-size: var(--font-xs);
}
</style>
