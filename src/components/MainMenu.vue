<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import GeneratedMapDialog from "@/components/GeneratedMapDialog.vue";
import ProgressiveMapDialog from "@/components/ProgressiveMapDialog.vue";
import { DIFFICULTY_MULT_GEM_BASE, DIFFICULTY_MULT_TICK, MAPS_PER_REGION } from "@/sim/Constants.js";
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

function highestUnlockedIndex(themeId: string): number {
  const progress = persistStore.getThemeProgress(themeId);
  return Math.min(Math.max(progress.highestUnlockedMap, 0), MAPS_PER_REGION * 3 - 1);
}

// Farthest unlocked campaign map in a world's progress bucket, shown as
// "Region N · Map M" on the world card play button.
function worldProgressLabel(themeId: string): string {
  const index = highestUnlockedIndex(themeId);
  return `Region ${Math.floor(index / MAPS_PER_REGION) + 1} · Map ${(index % MAPS_PER_REGION) + 1}`;
}

function selectThemeFromKeyboard(event: KeyboardEvent, themeId: string) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectTheme(themeId);
  }
}

async function playThemeHighestMap(themeId: string) {
  const mapIndex = highestUnlockedIndex(themeId);
  // Always route through the region map: set this world and its furthest unlocked
  // map as the active values, then let the run be started from the map view.
  if (themeId !== persistStore.lastSelectedThemeId) {
    persistStore.lastSelectedThemeId = themeId;
    persistStore.save();
    await themeStore.loadActive(themeId).catch((err) => console.error("Failed to load theme:", err));
  }
  persistStore.lastSelectedMapIndex = mapIndex;
  persistStore.save();
  gameStore.resetToMenu();
  router.push("/map-select");
}

function newGame() {
  gameStore.resetToMenu();
  router.push("/map-select");
}

const showRandomDialog = ref(false);
const showProgressiveDialog = ref(false);

function openRandomDialog() {
  showRandomDialog.value = true;
  showProgressiveDialog.value = false;
}

function openProgressiveDialog() {
  showProgressiveDialog.value = true;
  showRandomDialog.value = false;
}

function closeRandomDialog() {
  showRandomDialog.value = false;
}

function closeProgressiveDialog() {
  showProgressiveDialog.value = false;
}

function openSkillTree() {
  router.push("/skill-tree");
}
</script>

<template>
  <div class="main-menu">
    <div class="menu-background" v-html="menuBackgroundSvg"></div>
    <div class="menu-scrim" aria-hidden="true"></div>
    <div class="menu-home">
      <header class="home-header">
        <h1 class="game-title">
          <span class="game-title-t1">Ground Held</span>
          <span class="game-title-t2">is</span>
          <span class="game-title-t1">Ground Stood</span>
        </h1>
      </header>

      <main class="home-grid">
        <section class="play-panel" aria-label="New Game">
          <button class="play-primary" @click="newGame()">Select Map</button>
          <div class="custom-group">
            <div class="new-game-section custom-row">
              <button class="custom-btn" @click="openProgressiveDialog()">Progressive Run</button>
              <button class="custom-btn" @click="openRandomDialog()">Generate Map</button>
            </div>
            <label class="difficulty-row" for="home-difficulty">
              <span class="difficulty-name">Difficulty</span>
              <input
                id="home-difficulty"
                type="range"
                min="0"
                max="12"
                :value="diffTick"
                @input="onDiffSliderInput"
                class="diff-slider"
              />
              <span class="diff-values">
                <span>Enemy: ×{{ diffMult.toFixed(2) }}</span>
                <span>Gems: ×{{ gemMult.toFixed(2) }}</span>
              </span>
            </label>
          </div>
        </section>

        <section class="world-rail" aria-label="Worlds">
          <div
            v-for="theme in themeStore.availableThemes"
            :key="theme.id"
            class="world-card"
            :class="{ selected: theme.id === persistStore.lastSelectedThemeId }"
            role="button"
            tabindex="0"
            :aria-label="`Select world ${theme.label}`"
            @click="selectTheme(theme.id)"
            @keydown="selectThemeFromKeyboard($event, theme.id)"
          >
            <span class="world-card-bg" v-html="themeStore.loadedThemes[theme.id]?.menuBackground" />
            <span class="world-card-scrim" aria-hidden="true"></span>
            <span class="world-card-body">
              <span class="world-card-info">
                <span class="world-card-label">{{ theme.label }}</span>
                <span v-if="theme.id === persistStore.lastSelectedThemeId" class="world-active-tag">
                  Active world
                </span>
              </span>
              <button
                class="world-play-btn"
                :disabled="themeStore.loading"
                @click.stop="playThemeHighestMap(theme.id)"
              >
                ▶ Play {{ worldProgressLabel(theme.id) }}
              </button>
            </span>
          </div>
        </section>
      </main>

      <footer class="home-footer">
        <nav class="footer-actions" aria-label="Meta">
          <button class="action-btn upgrades-btn" @click="openSkillTree()">
            Upgrades! <span class="gem-count">💎 {{ persistStore.gems }}</span>
          </button>
          <button class="action-btn ghost-btn" @click="router.push('/commanders')">Commanders</button>
          <button class="action-btn ghost-btn" @click="router.push('/history')">Run History</button>
        </nav>
      </footer>
    </div>

    <GeneratedMapDialog :show="showRandomDialog" @close="closeRandomDialog" />
    <ProgressiveMapDialog :show="showProgressiveDialog" @close="closeProgressiveDialog" />
  </div>
</template>

<style scoped>
.main-menu {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  z-index: 100;
  overflow-y: auto;
  background: var(--color-bg);
}

.menu-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.menu-background :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.62) 0%,
    rgba(0, 0, 0, 0.38) 42%,
    rgba(0, 0, 0, 0.66) 100%
  );
}

.menu-home {
  position: relative;
  z-index: 2;
  width: min(1120px, 100%);
  margin: auto 0;
  padding: 32px 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.home-header {
  display: flex;
  justify-content: center;
  margin-bottom: 52px;
}

.game-title {
  --title-shadow: 0 1px 10px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  line-height: 1;
  color: var(--color-text);
  text-shadow: var(--title-shadow);
}

.game-title-t1 {
  color: var(--title-color, var(--color-text));
  text-shadow: var(--title-shadow), 0 0 24px var(--title-color, var(--color-accent-border));
  font-size: var(--font-display);
  font-weight: 900;
  letter-spacing: 1px;
}

.game-title-t2 {
  font-size: var(--font-title);
  font-weight: 700;
  letter-spacing: 4px;
  margin: 6px 0;
}

.game-title-t1:first-of-type {
  --title-color: #5aa95a;
  transform: translateX(-48px);
}

.game-title-t1:last-of-type {
  --title-color: #9c4e36;
  transform: translateX(48px);
}

.home-footer {
  margin-top: 12px;
}

.footer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
}

.action-btn {
  padding: 10px 18px;
  font-size: var(--font-md);
  font-weight: bold;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  transition: filter 0.15s;
}

.action-btn:focus-visible,
.play-primary:focus-visible,
.custom-btn:focus-visible,
.world-card:focus-visible,
.world-play-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.upgrades-btn {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}

.upgrades-btn:hover {
  background: var(--color-accent-hover);
}

.gem-count {
  color: var(--color-gem);
  white-space: nowrap;
}

.ghost-btn {
  background: var(--color-surface);
  color: var(--color-text);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}

.ghost-btn:hover {
  background: var(--color-surface-hover);
}

.home-grid {
  display: grid;
  grid-template-columns: minmax(300px, 400px) minmax(360px, 1fr);
  gap: 32px;
  align-items: start;
}

.play-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 2px;
}

.play-primary {
  padding: 16px 24px;
  font-size: var(--font-xl);
  font-weight: 800;
  border-radius: 12px;
  border: none;
  background: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: filter 0.15s;
}

.play-primary:hover {
  filter: brightness(1.1);
}

.custom-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
  padding-top: 32px;
  border-top: 1px solid var(--color-line);
}

.new-game-section.custom-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.custom-btn {
  flex: 1 1 140px;
  padding: 10px 16px;
  font-size: var(--font-md);
  border-radius: 8px;
  border: none;
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.15s;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}

.custom-btn:hover {
  background: var(--color-surface-hover);
}

.difficulty-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 22px;
  cursor: pointer;
}

.difficulty-name {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-text-dim);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
}

.diff-slider {
  width: 100%;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.diff-values {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-sm);
  color: var(--color-text-dim);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
}

.world-rail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.world-card {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 132px;
  overflow: hidden;
  padding: 0;
  font: inherit;
  text-align: left;
  border: none;
  border-radius: 14px;
  background: var(--color-surface-subtle);
  color: var(--color-text);
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.world-card-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.world-card-bg :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  transform: scale(1);
  transition: transform 0.2s;
}

.world-card:hover .world-card-bg :deep(svg) {
  transform: scale(1.04);
}

.world-card-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.82) 0%,
    rgba(0, 0, 0, 0.66) 24%,
    rgba(0, 0, 0, 0.34) 44%,
    rgba(0, 0, 0, 0) 66%
  );
}

.world-card-body {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 18px 20px;
}

.world-card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.world-card-label {
  font-size: var(--font-xl);
  font-weight: bold;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.7);
}

.world-active-tag {
  font-size: var(--font-xs);
  font-weight: bold;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-accent);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
}

.world-play-btn {
  flex-shrink: 0;
  padding: 10px 18px;
  font-size: var(--font-md);
  font-weight: 800;
  border-radius: 999px;
  border: none;
  background: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: filter 0.15s;
}

.world-play-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.world-play-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.world-card.selected {
  box-shadow:
    0 0 0 2px var(--color-accent),
    0 0 20px var(--color-accent-hover);
}

@media (max-width: 900px) {
  .menu-home {
    padding: 24px 20px 32px;
    gap: 22px;
  }

  .home-header {
    margin-bottom: 58px;
  }

  .game-title-t1 {
    font-size: 48px;
  }

  .game-title-t2 {
    font-size: 24px;
  }

  .game-title-t1:first-of-type {
    transform: translateX(-24px);
  }

  .game-title-t1:last-of-type {
    transform: translateX(24px);
  }

  .home-footer {
    margin-top: 12px;
  }

  .home-grid {
    grid-template-columns: 1fr;
  }

  .world-card-body {
    flex-wrap: wrap;
  }
}
</style>
