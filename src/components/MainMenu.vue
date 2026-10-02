<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { DIFFICULTY_MULT_GEM_BASE, DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

const diffTick = computed(() => persistStore.difficulty?.multiplierTick || 0);
const diffMult = computed(() => diffTick.value * DIFFICULTY_MULT_TICK + 1);
const gemMult = computed(() => 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult.value - 1));

const menuBackgroundSvg = computed(() => themeStore.activeTheme?.menuBackground);

onMounted(() => {
  themeStore.availableThemes.forEach((theme) => {
    themeStore.ensureThemeLoaded(theme.id).catch((err) => console.error("Failed to load theme:", err));
  });
});

function onDiffSliderInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const tickValue = parseInt(target.value, 10);
  persistStore.setDifficultyTick(tickValue);
}

function selectTheme(themeId: string) {
  persistStore.lastSelectedThemeId = themeId;
  persistStore.save();
  themeStore.loadActive(themeId).catch((err) => console.error("Failed to load theme:", err));
}

function newGame() {
  gameStore.resetToMenu();
  router.push("/map-select");
}

function openSkillTree() {
  router.push("/skill-tree");
}
</script>

<template>
  <div class="main-menu">
    <div class="menu-background" v-html="menuBackgroundSvg"></div>
    <div class="menu-row">
      <div class="menu-content">
        <h1 class="game-title">Lo! Yet Another TDG</h1>

        <div class="menu-buttons">
          <button class="menu-btn primary" @click="newGame()">
            New Game
          </button>
          <button class="menu-btn" @click="openSkillTree()">
            Upgrades!
          </button>
          <button class="menu-btn" @click="router.push('/commanders')">
            Commanders
          </button>
          <button class="menu-btn" @click="router.push('/history')">
            Run History
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

        <div class="gems-display">💎 {{ persistStore.gems }}</div>
      </div>

      <div class="theme-cards">
        <button
          v-for="theme in themeStore.availableThemes"
          :key="theme.id"
          class="theme-card"
          :class="{ selected: theme.id === persistStore.lastSelectedThemeId }"
          @click="selectTheme(theme.id)"
        >
          <span class="theme-card-bg" v-html="themeStore.loadedThemes[theme.id]?.menuBackground"></span>
          <span class="theme-card-label">{{ theme.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-menu {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  overflow: hidden;
  background: var(--color-bg);
}

.menu-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.menu-background :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.menu-row {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 24px;
  width: min(1064px, 100%);
  align-items: center;
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

.theme-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.theme-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 123px;
  width: 100%;
  overflow: hidden;
  font-size: var(--font-xl);
  font-weight: bold;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.15s;
}

.theme-card-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.theme-card-bg :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0.55;
  transition: opacity 0.15s;
}

.theme-card:hover .theme-card-bg :deep(svg) {
  opacity: 0.75;
}

.theme-card-label {
  position: relative;
  z-index: 1;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
}

.theme-card.selected {
  border-color: var(--color-accent);
  color: var(--color-accent);
  box-shadow: 0 0 16px rgba(95, 208, 255, 0.25);
}

.theme-card.selected .theme-card-bg :deep(svg) {
  opacity: 0.7;
}

.game-title {
  font-size: var(--font-title);
  color: var(--color-accent);
  text-shadow: 0 0 20px rgba(95, 208, 255, 0.3);
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
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.15s;
}

.menu-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.menu-btn.primary {
  background: rgba(95, 208, 255, 0.15);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.difficulty-section {
  width: 100%;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
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
</style>
