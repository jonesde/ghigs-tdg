<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { TowerId } from "@/sim/ConstantsTower.js";
import { TowerIds, targetsLabel, towerGroundOnly } from "@/sim/ConstantsTower.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import {
  BASE_LEVEL_NODES,
  canRefund,
  canRefundBase,
  canRefundGeneral,
  countRefundableGems,
  GENERAL_ADDON_CATEGORIES,
  GENERAL_ADDON_DEFS,
  getGeneralAddonValue,
  isAvailable,
  isBaseAvailable,
  isBaseUnlocked,
  isGeneralAvailable,
  isGeneralUnlocked,
  isUnlocked,
  refundAllGems,
  SKILL_TREE,
  tryRefund,
  tryRefundBase,
  tryRefundGeneral,
  tryUnlock,
  tryUnlockBase,
  tryUnlockGeneral,
} from "@/sim/towers/SkillTree.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

// Writes the skill-tree edit into the worker persist copy. That copy is what the
// next flush saves over persistStore.gems, so the gem delta has to travel with
// the unlocks. No-op when no worker is registered (skill tree opened pre-run).
function saveAndSyncPersist(gemsBefore: number): void {
  persistStore.save();
  dispatchCommand({
    commandId: 0,
    type: "action:syncPersist",
    unlocked: persistStore.unlocked,
    generalAddons: persistStore.generalAddons,
    baseUnlocks: persistStore.baseUnlocks,
    gemDelta: persistStore.gems - gemsBefore,
  });
}

const router = useRouter();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();
const uiStore = useUiStore();

const towerIds = Object.values(TowerIds) as TowerId[];

function handleBaseNodeClick(index: number, element: HTMLElement) {
  const gemsBefore = persistStore.gems;
  const result = tryUnlockBase(persistStore.$state, index);
  if (result.ok) {
    saveAndSyncPersist(gemsBefore);
  } else if (result.reason === "Already unlocked") {
    const refundGems = canRefundBase(persistStore.$state, index);
    if (refundGems > 0) {
      showBaseRefundConfirm(index, refundGems);
    } else {
      flashElement(element);
    }
  } else {
    flashElement(element);
  }
}

function handleTowerNodeClick(towerId: TowerId, tier: string, index: number, element: HTMLElement) {
  const gemsBefore = persistStore.gems;
  const result = tryUnlock(persistStore.$state, towerId, tier, index);
  if (result.ok) {
    saveAndSyncPersist(gemsBefore);
  } else if (result.reason === "Already unlocked") {
    const refundGems = canRefund(persistStore.$state, towerId, tier, index);
    if (refundGems > 0) {
      showRefundConfirm(towerId, tier, index, refundGems);
    } else {
      flashElement(element);
    }
  } else {
    flashElement(element);
  }
}

function goBack() {
  if (uiStore.showSkillTree) {
    uiStore.closeSkillTree();
  } else {
    router.push("/");
  }
}

function handleGeneralClick(key: string, type: string | number, opt: string | null, element: HTMLElement) {
  if (key === "sellOption" && type === "toggle") {
    const generalAddons = persistStore.generalAddons;
    const unlocked = generalAddons.sellRefundUnlocked && generalAddons.sellDiscountUnlocked;
    if (!unlocked) {
      flashElement(element);
      return;
    }
    const gemsBefore = persistStore.gems;
    generalAddons.sellActive = opt;
    saveAndSyncPersist(gemsBefore);
    return;
  }

  const idxNum = parseInt(type as string, 10);
  if (isGeneralUnlocked(persistStore.$state, key, idxNum)) {
    const refundGems = canRefundGeneral(persistStore.$state, key, idxNum);
    if (refundGems > 0) {
      showGeneralRefundConfirm(key, idxNum, refundGems);
    }
    return;
  }
  if (!isGeneralAvailable(persistStore.$state, key, idxNum)) {
    flashElement(element);
    return;
  }

  const gemsBefore = persistStore.gems;
  const result = tryUnlockGeneral(persistStore.$state, key, idxNum);
  if (result.ok) {
    saveAndSyncPersist(gemsBefore);
  } else {
    flashElement(element);
  }
}

function showBaseRefundConfirm(index: number, gems: number) {
  const label = BASE_LEVEL_NODES[index]?.label ?? "Base";
  uiStore.showConfirm({
    title: "Refund Unlock",
    message: `Revoke "${label}" and refund ${gems} 💎?`,
    confirmLabel: "Refund",
    cancelLabel: "Cancel",
    onConfirm: () => {
      const gemsBefore = persistStore.gems;
      tryRefundBase(persistStore.$state, index);
      saveAndSyncPersist(gemsBefore);
    },
  });
}

function showRefundConfirm(towerId: TowerId, tier: string, index: number, gems: number) {
  const label = getNodeLabel(towerId, tier, index);
  uiStore.showConfirm({
    title: "Refund Unlock",
    message: `Revoke "${label}" and refund ${gems} 💎?`,
    confirmLabel: "Refund",
    cancelLabel: "Cancel",
    onConfirm: () => {
      const gemsBefore = persistStore.gems;
      tryRefund(persistStore.$state, towerId, tier, index);
      saveAndSyncPersist(gemsBefore);
    },
  });
}

function showGeneralRefundConfirm(key: string, index: number, gems: number) {
  const def = GENERAL_ADDON_DEFS[key];
  const label = def?.tiers[index]?.label || key;
  uiStore.showConfirm({
    title: "Refund Upgrade",
    message: `Downgrade "${label}" and refund ${gems} 💎?`,
    confirmLabel: "Refund",
    cancelLabel: "Cancel",
    onConfirm: () => {
      const gemsBefore = persistStore.gems;
      tryRefundGeneral(persistStore.$state, key, index);
      saveAndSyncPersist(gemsBefore);
    },
  });
}

function getNodeLabel(towerId: TowerId, tier: string, index: number) {
  const towerDef = SKILL_TREE[towerId];
  if (!towerDef) return "";
  if (tier === "level") return `Level ${index + 1}`;
  if (tier === "variantA") return towerDef.variantA?.[index]?.label || "";
  if (tier === "variantB") return towerDef.variantB?.[index]?.label || "";
  if (tier === "addons") return towerDef.addons?.[index]?.label || "";
  return "";
}

function flashElement(element: HTMLElement) {
  if (!element) return;
  element.style.transition = "background 0.1s";
  element.style.background = "color-mix(in srgb, var(--color-danger) 30%, var(--color-bg))";
  setTimeout(() => {
    element.style.background = "";
  }, 200);
}

function showResetConfirm() {
  uiStore.showConfirm({
    title: "Reset Profile",
    message: "This will permanently wipe all gems, unlocks, and progress. Are you sure?",
    confirmLabel: "Reset",
    cancelLabel: "Cancel",
    onConfirm: () => {
      persistStore.reset();
    },
  });
}

function showRefundAllConfirm() {
  const refundGems = countRefundableGems(persistStore.$state);
  uiStore.showConfirm({
    title: "Refund All Gems",
    message: `Re-lock all unlocked upgrades and refund ${refundGems} \u{1F48E}?`,
    confirmLabel: "Refund All",
    cancelLabel: "Cancel",
    onConfirm: () => {
      const gemsBefore = persistStore.gems;
      refundAllGems(persistStore.$state);
      saveAndSyncPersist(gemsBefore);
    },
  });
}
</script>

<template>
  <div class="skill-tree">
    <div class="skill-header">
      <h2>Unlock Upgrades</h2>
      <div class="skill-gems">💎 {{ persistStore.gems }}</div>
      <button class="back-btn" @click="goBack">← Back</button>
    </div>

    <div class="skill-top">
      <div class="skill-top-col">
      <template v-for="(cat, catKey) in GENERAL_ADDON_CATEGORIES" :key="catKey">
        <div class="category-group" :class="'category-' + catKey">
          <div class="category-header">
            <span class="category-label">{{ cat.label }}</span>
            <span class="category-divider"></span>
          </div>
          <div
            v-for="key in cat.addons"
            :key="key"
            class="general-card"
          >
            <template v-for="def in [GENERAL_ADDON_DEFS[key]]">
              <div class="general-label">{{ def.label }}</div>
              <div class="general-desc">{{ def.desc }}</div>

              <!-- Sell option (special) -->
              <template v-if="def.isSellOption">
                <template v-if="!persistStore.generalAddons.sellRefundUnlocked || !persistStore.generalAddons.sellDiscountUnlocked">
                  <button
                    class="addon-btn"
                    :class="{ unavailable: !isGeneralAvailable(persistStore.$state, key, 0) }"
                    @click="handleGeneralClick(key, 0, null, $event.currentTarget)"
                  >
                    Unlock Sell Flexibility ({{ def.costs[0] }} 💎)
                  </button>
                </template>
                <template v-else>
                  <button
                    class="addon-btn"
                    :class="{ unlocked: persistStore.generalAddons.sellActive === 'refund' }"
                    @click="handleGeneralClick(key, 'toggle', 'refund', $event.currentTarget)"
                  >
                    Full Refund
                  </button>
                  <button
                    class="addon-btn"
                    :class="{ unlocked: persistStore.generalAddons.sellActive === 'discount' }"
                    @click="handleGeneralClick(key, 'toggle', 'discount', $event.currentTarget)"
                  >
                    Discounted
                  </button>
                </template>
              </template>

              <!-- Standard tier buttons -->
              <template v-else>
                <button
                  v-for="(tierDef, i) in def.tiers"
                  :key="i"
                  class="addon-btn"
                  :class="{
                    unlocked: isGeneralUnlocked(persistStore.$state, key, i),
                    unavailable: !isGeneralAvailable(persistStore.$state, key, i),
                    active: getGeneralAddonValue(persistStore.$state, key) === i,
                  }"
                  @click="handleGeneralClick(key, i, null, $event.currentTarget)"
                >
                  {{ tierDef.label }}{{ isGeneralUnlocked(persistStore.$state, key, i) ? '' : ' · ' + def.costs[i] + ' 💎' }}
                </button>
              </template>
            </template>
          </div>
        </div>
      </template>
      </div>
      <div class="skill-top-col base-unlocks">
        <div class="category-group category-base">
          <div class="category-header">
            <span class="category-label">Base</span>
            <span class="category-divider"></span>
          </div>
          <div class="base-columns">
            <div class="base-addon-cards">
              <div v-for="key in ['extraHealth', 'slowHealing']" :key="key" class="general-card">
                <template v-for="def in [GENERAL_ADDON_DEFS[key]]" :key="def.key">
                  <div class="general-label">{{ def.label }}</div>
                  <div class="general-desc">{{ def.desc }}</div>
                  <button
                    v-for="(tierDef, tierIndex) in def.tiers"
                    :key="tierIndex"
                    class="addon-btn"
                    :class="{
                      unlocked: isGeneralUnlocked(persistStore.$state, key, tierIndex),
                      unavailable: !isGeneralAvailable(persistStore.$state, key, tierIndex),
                      active: getGeneralAddonValue(persistStore.$state, key) === tierIndex,
                    }"
                    @click="handleGeneralClick(key, tierIndex, null, $event.currentTarget)"
                  >
                    {{ tierDef.label }}{{ isGeneralUnlocked(persistStore.$state, key, tierIndex) ? '' : ' · ' + def.costs[tierIndex] + ' 💎' }}
                  </button>
                </template>
              </div>
            </div>
            <div class="base-levels-card">
              <div class="skill-section">Levels</div>
              <div
                v-for="node in BASE_LEVEL_NODES"
                :key="'base-' + node.index"
                class="skill-node"
                :class="{
                  unlocked: isBaseUnlocked(persistStore.$state, node.index),
                  unavailable: !isBaseAvailable(persistStore.$state, node.index),
                }"
                @click="handleBaseNodeClick(node.index, $event.currentTarget)"
              >
                <div class="node-header">
                  <span>{{ node.label }}</span>
                  <span class="node-cost">
                    {{ isBaseUnlocked(persistStore.$state, node.index) ? '✓' : node.cost + ' 💎' }}
                  </span>
                </div>
                <div class="node-desc">{{ node.desc }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tower Skill Columns -->
    <div class="tower-skills">
      <div v-for="id in towerIds" :key="id" class="skill-col">
        <div class="skill-col-header" :style="{ color: themeStore.getDefaultTowerVisual(id)?.color }">
          {{ themeStore.getDefaultTowerVisual(id)?.icon }} {{ themeStore.getDefaultTowerVisual(id)?.name }}
        </div>
        <div class="skill-col-targets">
          {{ targetsLabel(towerGroundOnly(id, persistStore.unlocked[id]?.addons)) }}
        </div>

        <!-- Levels -->
        <div class="skill-section">Levels</div>
        <div
          v-for="i in [2, 3]"
          :key="i"
          class="skill-node"
          :class="{
            unlocked: isUnlocked(persistStore.$state, id, 'level', i),
            unavailable: !isAvailable(persistStore.$state, id, 'level', i, SKILL_TREE[id].levels.find(l => l.index === i)?.cost),
          }"
          @click="handleTowerNodeClick(id, 'level', i, $event.currentTarget)"
        >
          <div class="node-header">
            <span>Level {{ i + 1 }}</span>
            <span class="node-cost">
              {{ isUnlocked(persistStore.$state, id, 'level', i) ? '✓' : SKILL_TREE[id].levels.find(l => l.index === i)?.cost + ' 💎' }}
            </span>
          </div>
        </div>

        <!-- Specialization A -->
        <div class="skill-section">Specialization A</div>
        <div
          v-for="(node, i) in SKILL_TREE[id].variantA"
          :key="'variantA-' + i"
          class="skill-node"
          :class="{
            unlocked: isUnlocked(persistStore.$state, id, 'variantA', i),
            unavailable: !isAvailable(persistStore.$state, id, 'variantA', i, node.cost),
          }"
          @click="handleTowerNodeClick(id, 'variantA', i, $event.currentTarget)"
        >
          <div class="node-header">
            <span>{{ node.label }}</span>
            <span class="node-cost">
              {{ isUnlocked(persistStore.$state, id, 'variantA', i) ? '✓' : node.cost + ' 💎' }}
            </span>
          </div>
          <div class="node-desc">{{ node.desc }}</div>
        </div>

        <!-- Specialization B -->
        <div class="skill-section">Specialization B</div>
        <div
          v-for="(node, i) in SKILL_TREE[id].variantB"
          :key="'vb-' + i"
          class="skill-node"
          :class="{
            unlocked: isUnlocked(persistStore.$state, id, 'variantB', i),
            unavailable: !isAvailable(persistStore.$state, id, 'variantB', i, node.cost),
          }"
          @click="handleTowerNodeClick(id, 'variantB', i, $event.currentTarget)"
        >
          <div class="node-header">
            <span>{{ node.label }}</span>
            <span class="node-cost">
              {{ isUnlocked(persistStore.$state, id, 'variantB', i) ? '✓' : node.cost + ' 💎' }}
            </span>
          </div>
          <div class="node-desc">{{ node.desc }}</div>
        </div>

        <!-- Add-ons -->
        <div class="skill-section">Add-ons</div>
        <div
          v-for="(node, i) in SKILL_TREE[id].addons"
          :key="'addon-' + i"
          class="skill-node"
          :class="{
            unlocked: isUnlocked(persistStore.$state, id, 'addons', i),
            unavailable: !isAvailable(persistStore.$state, id, 'addons', i, node.cost),
          }"
          @click="handleTowerNodeClick(id, 'addons', i, $event.currentTarget)"
        >
          <div class="node-header">
            <span>{{ node.label }}</span>
            <span class="node-cost">
              {{ isUnlocked(persistStore.$state, id, 'addons', i) ? '✓' : node.cost + ' 💎' }}
            </span>
          </div>
          <div class="node-desc">{{ node.desc }}</div>
        </div>
      </div>
    </div>

    <div class="skill-footer">
      <button class="refund-all-btn" @click="showRefundAllConfirm()">Refund All Gems</button>
      <button class="reset-btn" @click="showResetConfirm()">Reset Profile</button>
    </div>
  </div>
</template>

<style scoped>
.skill-tree {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  z-index: 50;
  background: var(--color-bg);
  overflow-y: auto;
  padding: 20px;
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.skill-header h2 {
  color: var(--color-accent);
  font-size: var(--font-2xl);
}

.skill-gems {
  font-size: var(--font-xl);
  color: var(--color-gem);
}

.back-btn {
  margin-left: auto;
  padding: 8px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-line-strong);
  color: var(--color-text);
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-md);
}

.back-btn:hover {
  background: var(--color-surface-hover);
}

/* Category headers */
.category-group {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: stretch;
  gap: 12px;
}

.category-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
  padding-bottom: 4px;
}

.category-label {
  font-size: var(--font-md);
  font-weight: bold;
  letter-spacing: 0.5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.category-divider {
  flex: 1;
  height: 1px;
}

.category-economy .category-label { color: var(--color-gold); }
.category-economy .category-divider { background: linear-gradient(to right, color-mix(in srgb, var(--color-gold) 40%, transparent), transparent); }

.category-base .category-label { color: var(--color-success); }
.category-base .category-divider { background: linear-gradient(to right, color-mix(in srgb, var(--color-success) 40%, transparent), transparent); }

.skill-top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 20px;
  align-items: start;
}

.skill-top-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.skill-top-col .category-group {
  display: flex;
  width: 100%;
}

.base-unlocks .category-group {
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
}

.base-unlocks .general-card {
  width: auto;
  margin-left: 0;
  box-sizing: border-box;
}

.base-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.base-addon-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 900px) {
  .skill-top {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .base-columns {
    grid-template-columns: 1fr;
  }
}

.category-damage .category-label { color: var(--color-danger); }
.category-damage .category-divider { background: linear-gradient(to right, color-mix(in srgb, var(--color-danger) 40%, transparent), transparent); }

/* General Add-ons */
.general-addons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: stretch;
  gap: 16px 24px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.general-card {
  width: 150px;
  padding: 10px;
  margin-left: 16px;
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  border-radius: 8px;
}

.general-label {
  color: var(--color-accent);
  font-weight: bold;
  font-size: var(--font-md);
  margin-bottom: 4px;
}

.general-desc {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  margin-bottom: 8px;
}

.addon-btn {
  width: 100%;
  padding: 6px 8px;
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-xs);
  transition: all 0.15s;
}

.addon-btn:hover:not(.unavailable) {
  background: var(--color-surface-hover);
}

.addon-btn.unlocked {
  background: var(--color-success-soft);
  border-color: var(--color-success-border);
  color: var(--color-success);
}

.addon-btn.active {
  background: color-mix(in srgb, var(--color-success) 35%, var(--color-bg));
  border-color: var(--color-success);
}

.addon-btn.unavailable {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Tower Skills */
.tower-skills {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 220px));
  justify-content: center;
  gap: 16px;
  max-width: 928px;
  margin-inline: auto;
}

@media (max-width: 1000px) {
  .tower-skills {
    max-width: 456px;
  }
}

.skill-col,
.base-levels-card {
  padding: 12px;
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  border-radius: 10px;
}

.skill-col-header {
  font-weight: bold;
  font-size: var(--font-md);
  margin-bottom: 2px;
}

.skill-col-targets {
  font-size: var(--font-sm);
  color: var(--color-text-dim);
  margin-bottom: 10px;
}

.skill-section {
  font-size: var(--font-sm);
  font-weight: bold;
  color: var(--color-text-dim);
  margin: 10px 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.base-levels-card .skill-section:first-child {
  margin-top: 0;
}

.skill-node {
  padding: 6px 8px;
  margin-bottom: 4px;
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.skill-node:hover:not(.unavailable) {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.skill-node.unlocked {
  background: var(--color-success-soft);
  border-color: var(--color-success-border);
}

.skill-node.unavailable {
  opacity: 0.35;
  cursor: not-allowed;
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-sm);
}

.node-cost {
  font-size: var(--font-xs);
  color: var(--color-gem);
}

.node-desc {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  margin-top: 2px;
}

.skill-footer {
  display: flex;
  justify-content: center;
  padding: 20px 0 8px;
  flex-shrink: 0;
}

.reset-btn {
  padding: 6px 12px;
  font-size: var(--font-xs);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger-border);
  color: var(--color-danger);
  border-radius: 4px;
  cursor: pointer;
}

.reset-btn:hover {
  background: var(--color-danger-hover);
}

.refund-all-btn {
  padding: 6px 12px;
  font-size: var(--font-xs);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger-border);
  color: var(--color-danger);
  border-radius: 4px;
  cursor: pointer;
  margin-right: 8px;
}

.refund-all-btn:hover {
  background: var(--color-danger-hover);
}
</style>
