<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { getGameContent } from "@/content/gameContent.js";
import { DEFAULT_THEME_ID } from "@/render/themes/index.js";
import { customProgressiveMapIndex, customRandomMapIndex } from "@/sim/GameRunState.js";
import { generateRandomMap, getMap, getMapDisplayName } from "@/sim/grid/Map.js";
import { generateProgressiveMap, type ProgressiveConfig, resolveGeneratedMap } from "@/sim/grid/ProgressiveMap.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const props = defineProps({ won: { type: Boolean, default: false } });

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

const title = computed(() => (props.won ? "VICTORY" : "GAME OVER"));
const titleColor = computed(() => (props.won ? "var(--color-success)" : "var(--color-danger)"));

const sectionBreakdown = computed(() => gameStore.endScreenData?.gemBreakdown || {});
const totalGems = computed(() => gameStore.endScreenData?.gems || 0);
const finalWave = computed(() => gameStore.endScreenData?.wave || 0);
const deadBosses = computed(() => gameStore.bossesKilledThisRun);
const basedBosses = computed(() => gameStore.bossesReachedBaseThisRun);

// Campaign progression only. The custom run indexes (-1, -2) are excluded by the
// >= 0 test and the progressive catalog range (36+) by the map-count ceiling, which
// is the same one maybeUnlockNextMap enforces when it raises highestUnlockedMap. So
// the button appears exactly when mapIndex + 1 names a campaign map the player has
// reached.
const nextMapIndex = computed<number | null>(() => {
  const currentIndex = gameStore.mapIndex;
  if (currentIndex < 0 || currentIndex + 1 >= getGameContent().maps.levels.length) return null;
  const progress = persistStore.getThemeProgress(persistStore.lastSelectedThemeId);
  return currentIndex + 1 <= progress.highestUnlockedMap ? currentIndex + 1 : null;
});

const nextMapLabel = computed(() => {
  const nextIndex = nextMapIndex.value;
  if (nextIndex === null) return "";
  const theme = themeStore.activeTheme ?? themeStore.defaultTheme;
  return `Play Next: ${getMapDisplayName(getMap(nextIndex, themeStore.resolvedMaps), theme)}`;
});

function navigate(to: string) {
  gameStore.resetToMenu();
  router.push(to);
}

async function playNext() {
  // Read before resetToMenu clears mapIndex/map.
  const nextIndex = nextMapIndex.value;
  if (nextIndex === null) {
    navigate("/map-select");
    return;
  }
  persistStore.clearActiveWave(persistStore.lastSelectedThemeId, nextIndex);
  await themeStore.ensureActiveTheme();

  gameStore.initMap(nextIndex, resolveGeneratedMap(nextIndex, themeStore.resolvedMaps), null);
  router.push("/game");
}

async function replay() {
  const latest = persistStore.getLatestRun as Record<string, unknown> | null;
  if (!latest) {
    navigate("/map-select");
    return;
  }
  gameStore.resetToMenu();

  // Runs remember the world they took place in (save v5); pre-v5 entries fall
  // back to the default world. Resolve that theme before generating the map so
  // both sides of the worker boundary use the same catalog, and switch the
  // selected world so the replay's visuals match the original run.
  const themeId = typeof latest.themeId === "string" ? latest.themeId : DEFAULT_THEME_ID;
  persistStore.lastSelectedThemeId = themeId;
  persistStore.save();
  const theme = await themeStore.loadActive(themeId).catch(() => themeStore.defaultTheme);

  if (latest.mapIndex === customRandomMapIndex && latest.randomMapParams) {
    const p = latest.randomMapParams as {
      width: number;
      height: number;
      level: number;
      style: string;
      regionId: number;
      seed: number;
    };
    const mapData = generateRandomMap(p.width, p.height, p.style, p.regionId, p.level, p.seed, theme?.maps);
    gameStore.mapIndex = customRandomMapIndex;
    gameStore.map = mapData;
    gameStore.randomMapParams = p;
  } else if (latest.mapIndex === customProgressiveMapIndex && latest.progressiveMapParams) {
    const p = latest.progressiveMapParams as ProgressiveConfig;
    gameStore.mapIndex = customProgressiveMapIndex;
    gameStore.map = generateProgressiveMap(p);
  } else {
    const mapData = resolveGeneratedMap(latest.mapIndex as number, theme?.maps);
    gameStore.mapIndex = latest.mapIndex as number;
    gameStore.map = mapData;
  }
  router.push("/game");
}

function formatBreakdown(section: string) {
  const gemBreakdown = sectionBreakdown.value;
  const sectionData = gemBreakdown[section];
  if (!sectionData) return null;
  const lines: string[] = [];
  if (sectionData.base) lines.push(`Base: ${sectionData.base}`);
  if (sectionData.afterDiff && sectionData.afterDiff !== sectionData.base)
    lines.push(`After difficulty: ${sectionData.afterDiff}`);
  if (sectionData.afterRegion && sectionData.afterRegion !== sectionData.afterDiff)
    lines.push(`After region: ${sectionData.afterRegion}`);
  if (sectionData.afterFirstTime && sectionData.afterFirstTime !== sectionData.afterRegion)
    lines.push(`After first-time: ${sectionData.afterFirstTime}`);
  return lines;
}
</script>

<template>
  <div class="end-screen">
    <div class="overlay" />
    <div class="end-card">
      <h1 class="end-title" :style="{ color: titleColor }">{{ title }}</h1>

      <div class="stat-summary">
        <div class="stat-item"><span class="stat-label">Waves Cleared</span><span class="stat-value">{{ finalWave }}</span></div>
        <div class="stat-item"><span class="stat-label">Gems Earned</span><span class="stat-value gem">{{ totalGems }} 💎</span></div>
        <div class="stat-item"><span class="stat-label">Dead Bosses</span><span class="stat-value stat-dead">{{ deadBosses }}</span></div>
        <div class="stat-item"><span class="stat-label">Based Bosses</span><span class="stat-value stat-based">{{ basedBosses }}</span></div>
      </div>

      <div v-if="sectionBreakdown.bossKills?.base" class="breakdown-section">
        <h3>Boss Kills</h3>
        <div v-for="(line, i) in formatBreakdown('bossKills')" :key="i" class="breakdown-line">{{ line }}</div>
      </div>

      <div v-if="sectionBreakdown.milestones?.base" class="breakdown-section">
        <h3>Milestones</h3>
        <div v-for="(line, i) in formatBreakdown('milestones')" :key="i" class="breakdown-line">{{ line }}</div>
      </div>

      <div v-if="sectionBreakdown.waveCompletion?.base" class="breakdown-section">
        <h3>Wave Completion</h3>
        <div v-for="(line, i) in formatBreakdown('waveCompletion')" :key="i" class="breakdown-line">{{ line }}</div>
      </div>

      <div v-if="sectionBreakdown.firstClearBonus" class="breakdown-section first-clear">
        <h3>First Full Clear Bonus</h3>
        <div class="breakdown-line">+{{ sectionBreakdown.firstClearBonus }} 💎</div>
      </div>

      <div class="btn-group">
        <button class="end-btn primary" @click="replay">Play Again</button>
        <button v-if="nextMapIndex !== null" class="end-btn" @click="playNext">{{ nextMapLabel }}</button>
        <button class="end-btn" @click="navigate('/map-select')">Select Map</button>
        <button class="end-btn" @click="navigate('/skill-tree')">Upgrades!</button>
        <button class="end-btn" @click="navigate('/')">Main Menu</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.end-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.overlay {
  position: absolute;
  inset: 0;
  background: var(--color-scrim-heavy);
}

.end-card {
  position: relative;
  width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 32px 24px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  text-align: center;
}

.end-title {
  font-size: var(--font-title);
  font-weight: 800;
  margin: 0 0 20px;
  letter-spacing: 2px;
}

.stat-summary {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-bottom: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-label {
  font-size: var(--font-sm);
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.stat-value {
  font-size: var(--font-2xl);
  font-weight: 700;
  color: var(--color-text);
}

.stat-value.gem {
  color: var(--color-gem);
}

.stat-value.stat-dead {
  color: var(--color-success);
}

.stat-value.stat-based {
  color: var(--color-danger);
}

.breakdown-section {
  margin-top: 16px;
  padding: 12px;
  background: var(--color-surface-subtle);
  border-radius: 6px;
  text-align: left;
}

.breakdown-section h3 {
  font-size: var(--font-md);
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.breakdown-line {
  font-size: var(--font-md);
  padding: 2px 0;
  color: var(--color-text);
}

.first-clear {
  background: var(--color-success-soft);
  border: 1px solid var(--color-success-border);
}

.btn-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
}

.end-btn {
  padding: 10px 16px;
  font-size: var(--font-md);
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.15s;
}

.end-btn:hover {
  background: var(--color-surface-hover);
}

.end-btn.primary {
  background: var(--color-accent-soft);
  border-color: var(--color-accent-border);
  color: var(--color-accent);
}

.end-btn.primary:hover {
  background: var(--color-accent-hover);
}
</style>
