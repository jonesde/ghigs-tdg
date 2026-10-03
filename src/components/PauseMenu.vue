<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { BUILTIN_STUBBS, BUILTIN_STUBBY } from "@/commanders/index.js";
import { DIFFICULTY_MULT_GEM_BASE, DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();

const diffTick = computed(() => persistStore.difficulty?.multiplierTick || 0);
const diffMult = computed(() => diffTick.value * DIFFICULTY_MULT_TICK + 1);
const gemMult = computed(() => 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult.value - 1));

function onDiffSliderInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const tickValue = parseInt(target.value, 10);
  persistStore.setDifficultyTick(tickValue);
}

function closeMenu() {
  uiStore.closePauseMenu();
}

function endRun() {
  uiStore.showConfirm({
    title: "End Run",
    message: "End the current run and return to the main menu?",
    confirmLabel: "End Run",
    cancelLabel: "Cancel",
    onConfirm: () => {
      // Finalize gems/history/endScreen via the worker before leaving /game.
      // dispose also safety-nets endGame if this races teardown.
      dispatchCommand({ commandId: 0, type: "action:endRun" });
      router.push("/game-over");
    },
  });
}

function openSkillTree() {
  uiStore.openSkillTreeFromGame();
}

function handleCommanderChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  uiStore.setEnemyCommander(target.value as string);
}
</script>

<template>
  <div class="pause-menu" @click.self="closeMenu()">
    <div class="menu-content">
      <div class="menu-buttons">
        <button class="menu-btn primary" @click="closeMenu()">
          Resume
        </button>
        <button class="menu-btn" @click="endRun()">
          End Run
        </button>
        <button class="menu-btn" @click="openSkillTree()">
          Upgrades!
        </button>
      </div>

      <div class="difficulty-section">
        <div class="diff-header">Difficulty</div>
        <input
          type="range"
          min="0"
          max="12"
          :value="diffTick"
          @input="onDiffSliderInput"
          class="diff-slider"
        />
        <div class="diff-values">
          <span>Enemy: ×{{ diffMult.toFixed(2) }}</span>
          <span>Gems: ×{{ gemMult.toFixed(2) }}</span>
        </div>
      </div>

      <div class="commander-section">
        <div class="commander-header">Enemy Commander</div>
        <select class="commander-select" :value="uiStore.enemyCommander" @change="handleCommanderChange">
          <option value="none">No Commander</option>
          <option :value="BUILTIN_STUBBY">Sergeant Stubby</option>
          <option :value="BUILTIN_STUBBS">Commander Stubbs</option>
          <option
            v-for="commander in persistStore.llmCommanders"
            :key="commander.id"
            :value="commander.id"
          >
            {{ commander.name }}
          </option>
        </select>
      </div>

      <div class="gems-display">💎 {{ persistStore.gems }}</div>
    </div>
  </div>
</template>

<style scoped>
.pause-menu {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  background: var(--color-scrim);
}

.menu-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 40px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  min-width: 360px;
}

.menu-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.menu-btn {
  padding: 12px 24px;
  font-size: var(--font-lg);
  border-radius: 8px;
  border: 1px solid var(--color-line-strong);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.15s;
}

.menu-btn:hover {
  background: var(--color-surface-hover);
}

.menu-btn.primary {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.menu-btn.primary:hover {
  background: var(--color-accent-hover);
}

.difficulty-section {
  width: 100%;
  padding: 12px;
  background: var(--color-surface-subtle);
  border-radius: 8px;
}

.diff-header {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-text-dim);
  margin-bottom: 8px;
}

.diff-slider {
  width: 100%;
  accent-color: var(--color-accent);
}

.diff-values {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: var(--font-sm);
  color: var(--color-text-dim);
}

.gems-display {
  font-size: var(--font-xl);
  color: var(--color-gem);
}

.commander-section {
  width: 100%;
  padding: 12px;
  background: var(--color-surface-subtle);
  border-radius: 8px;
}

.commander-header {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-text-dim);
  margin-bottom: 8px;
}

.commander-select {
  width: 100%;
  padding: 8px;
  font-size: var(--font-md);
  border-radius: 8px;
  border: 1px solid var(--color-line-strong);
  background-color: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  /* Chrome paints the opened list from color-scheme, not from the page background.
     Dark scheme keeps that popup dark so the light option text stays readable. */
  color-scheme: dark;
}

.commander-select option {
  background-color: var(--color-bg);
  color: var(--color-text);
}
</style>
