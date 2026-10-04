<script setup lang="ts">
import { computed } from "vue";
import { dispatchCommand } from "@/sim/commandBus.js";
import { bonusCard, cacheOpenGold } from "@/sim/runBonuses.js";
import { useGameStore } from "@/stores/game.js";

const gameStore = useGameStore();

const cards = computed(() => {
  const picker = gameStore.bonusPicker;
  if (!picker) return [];
  const context = { wave: gameStore.currentWave, specialistType: picker.specialistType };
  return picker.offer.map((bonusId, index) => ({ index, ...bonusCard(bonusId, gameStore.runBonuses, context) }));
});

// Null for a supply drop. A cache broken open by tower fire costs nothing, so the
// label has to read the live hp rather than the fee the engine would charge.
const cacheCost = computed<number | null>(() => {
  const picker = gameStore.bonusPicker;
  if (picker?.source !== "cache") return null;
  const cache = gameStore.mapCaches.find((site) => site.id === picker.id);
  if (!cache) return null;
  return cache.hp > 0 ? cacheOpenGold(gameStore.currentWave) : 0;
});

function pick(index: number): void {
  dispatchCommand({ commandId: 0, type: "action:pickBonus", index });
}

function dismiss(): void {
  dispatchCommand({ commandId: 0, type: "action:dismissBonus" });
}
</script>

<template>
  <div v-if="gameStore.bonusPicker" class="bonus-picker">
    <div class="bonus-card-row">
      <button v-for="card in cards" :key="card.index" class="bonus-card" type="button" @click="pick(card.index)">
        <span class="bonus-key">{{ card.index + 1 }}</span>
        <span class="bonus-name">{{ card.name }}</span>
        <span class="bonus-detail">{{ card.detail }}</span>
        <span v-if="card.change" class="bonus-change">{{ card.change }}</span>
      </button>
    </div>
    <span v-if="cacheCost !== null" class="bonus-cost">{{ cacheCost > 0 ? `${cacheCost} gold` : "Free" }}</span>
    <button class="bonus-dismiss" type="button" @click="dismiss">Leave it</button>
  </div>
</template>

<style scoped>
.bonus-picker {
  position: absolute;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%);
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(740px, calc(100vw - 16px));
  pointer-events: auto;
}

.bonus-card-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  width: 100%;
}

.bonus-card {
  width: 220px;
  max-width: 100%;
  flex: 1 1 200px;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--color-border, #6a6a6a);
  border-radius: 6px;
  background: var(--color-panel, #1c1c1c);
  color: var(--color-text, #f0f0f0);
  text-align: left;
  cursor: pointer;
}

.bonus-card:hover {
  border-color: var(--color-gold, #e0c040);
}

.bonus-key {
  font-size: var(--font-sm, 12px);
  color: var(--color-text-dim, #aaa);
}

.bonus-name {
  font-size: var(--font-lg, 18px);
  font-weight: 700;
}

.bonus-detail,
.bonus-change {
  font-size: var(--font-sm, 13px);
  color: var(--color-text-dim, #ccc);
}

.bonus-change {
  white-space: nowrap;
}

.bonus-cost {
  font-size: var(--font-sm, 13px);
  color: var(--color-text, #f0f0f0);
}

.bonus-dismiss {
  border: 1px solid var(--color-border, #6a6a6a);
  border-radius: 6px;
  background: var(--color-panel, #1c1c1c);
  color: var(--color-text, #f0f0f0);
  padding: 6px 14px;
  cursor: pointer;
}

@media (max-width: 700px) {
  .bonus-card-row {
    flex-direction: column;
    align-items: stretch;
  }

  .bonus-card {
    width: 100%;
    flex-basis: auto;
  }
}
</style>
