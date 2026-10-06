<script setup lang="ts">
import { computed } from "vue";
import { type BonusPickerOption, bonusPickerOptionCommand, bonusPickerOptions } from "@/composables/bonusPicker.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { bonusCard, cacheOpenGold } from "@/sim/runBonuses.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";

const gameStore = useGameStore();
const themeStore = useMapThemeStore();

// An intact cache opens locked: only the unlock and leave buttons show until the
// fee is paid or tower fire breaks it open.
const locked = computed(() => gameStore.bonusPickerLocked);

// One option list for the keyboard cursor, the highlight, and the buttons, so Tab
// lands on something Enter can actually take.
const options = computed(() => bonusPickerOptions(locked.value));
const selectedOption = computed(() => options.value[gameStore.bonusPickerSelectedOption] ?? options.value[0]);

const cards = computed(() => {
  const picker = gameStore.bonusPicker;
  if (!picker || locked.value) return [];
  const context = {
    wave: gameStore.currentWave,
    specialistType: picker.specialistType,
    themeTowerName: themeStore.getTowerVisual(picker.specialistType)?.name,
  };
  return picker.offer.map((bonusId, index) => ({ index, ...bonusCard(bonusId, gameStore.runBonuses, context) }));
});

const unlockGold = computed(() => cacheOpenGold(gameStore.currentWave));

// The fee line under the cards: only a broken cache still shows one, and it reads
// Free because breaking it is the free path. A cache paid for through the unlock
// button already spent its gold, so repeating the number would be misleading.
const cacheCost = computed<number | null>(() => {
  const picker = gameStore.bonusPicker;
  if (picker?.source !== "cache" || locked.value) return null;
  const cache = gameStore.mapCaches.find((site) => site.id === picker.id);
  if (!cache) return null;
  return cache.hp <= 0 ? 0 : null;
});

function choose(option: BonusPickerOption): void {
  if (option.kind === "unlock") gameStore.selectBonusPickerOption(0);
  dispatchCommand(bonusPickerOptionCommand(option, 0));
}

const hint = computed(() =>
  locked.value
    ? "Tab cycles Unlock and Leave it. Enter takes it, Esc leaves."
    : "Tab cycles the cards and Leave it. Enter takes it, 1-3 claim a card, Esc leaves.",
);
</script>

<template>
  <div v-if="gameStore.bonusPicker" class="bonus-picker">
    <div v-if="!locked" class="bonus-card-row">
      <button
        v-for="card in cards"
        :key="card.index"
        class="bonus-card"
        :class="{ selected: selectedOption?.kind === 'card' && selectedOption.cardIndex === card.index }"
        type="button"
        @mousedown.prevent
        @keydown.enter.prevent
        @keydown.space.prevent
        @click="choose({ kind: 'card', cardIndex: card.index })"
      >
        <span class="bonus-key">{{ card.index + 1 }}</span>
        <span class="bonus-name">{{ card.name }}</span>
        <span class="bonus-detail">{{ card.detail }}</span>
        <span v-if="card.change" class="bonus-change">{{ card.change }}</span>
      </button>
    </div>
    <span v-if="cacheCost !== null" class="bonus-cost">{{ cacheCost > 0 ? `${cacheCost} gold` : "Free" }}</span>
    <button
      v-if="locked"
      class="bonus-unlock"
      :class="{ selected: selectedOption?.kind === 'unlock' }"
      type="button"
      @mousedown.prevent
      @keydown.enter.prevent
      @keydown.space.prevent
      @click="choose({ kind: 'unlock', cardIndex: -1 })"
    >
      Unlock for {{ unlockGold }} gold
    </button>
    <button
      class="bonus-dismiss"
      :class="{ selected: selectedOption?.kind === 'leave' }"
      type="button"
      @mousedown.prevent
      @keydown.enter.prevent
      @keydown.space.prevent
      @click="choose({ kind: 'leave', cardIndex: -1 })"
    >
      Leave it
    </button>
    <div class="bonus-hint">{{ hint }}</div>
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

/* The keyboard cursor, the same border the block choices use for their selection. */
.bonus-card.selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
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

.bonus-dismiss.selected {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.bonus-unlock {
  border: 1px solid var(--color-gold, #e0c040);
  border-radius: 6px;
  background: var(--color-panel, #1c1c1c);
  color: var(--color-gold, #e0c040);
  padding: 8px 18px;
  font-size: var(--font-lg, 16px);
  font-weight: 600;
  cursor: pointer;
}

.bonus-unlock:hover {
  background: var(--color-surface-hover, #2a2a2a);
}

.bonus-unlock.selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.bonus-hint {
  font-size: var(--font-sm, 12px);
  color: var(--color-text-dim, #aaa);
  text-align: center;
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
