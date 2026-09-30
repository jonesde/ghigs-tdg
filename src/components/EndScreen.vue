<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { generateRandomMap, getMap, getMapDisplayName } from "@/sim/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";

const props = defineProps({ won: { type: Boolean, default: false } });

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();

const title = computed(() => (props.won ? "VICTORY" : "GAME OVER"));
const titleColor = computed(() => (props.won ? "var(--color-success)" : "var(--color-danger)"));

const sectionBreakdown = computed(() => gameStore.endScreenData?.gemBreakdown || {});
const totalGems = computed(() => gameStore.endScreenData?.gems || 0);
const finalWave = computed(() => gameStore.endScreenData?.wave || 0);
const deadBosses = computed(() => gameStore.bossesKilledThisRun);
const basedBosses = computed(() => gameStore.bossesReachedBaseThisRun);

function navigate(to: string) {
  gameStore.resetToMenu();
  router.push(to);
}

function replay() {
  const latest = persistStore.getLatestRun;
  if (!latest) {
    navigate("/map-select");
    return;
  }
  gameStore.resetToMenu();
  if (latest.mapIndex === -1 && (latest as Record<string, unknown>).randomMapParams) {
    const p = (latest as Record<string, unknown>).randomMapParams as {
      width: number;
      height: number;
      level: number;
      style: string;
      regionId: number;
      seed: number;
    };
    const mapData = generateRandomMap(p.width, p.height, p.style, p.regionId, p.level, p.seed);
    gameStore.mapIndex = -1;
    gameStore.map = mapData;
    gameStore.randomMapParams = p;
  } else {
    const mapData = getMap(latest.mapIndex);
    gameStore.mapIndex = latest.mapIndex;
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

      <div v-if="sectionBreakdown.waveClears?.base" class="breakdown-section">
        <h3>Wave Clears</h3>
        <div v-for="(line, i) in formatBreakdown('waveClears')" :key="i" class="breakdown-line">{{ line }}</div>
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
  background: rgba(0, 0, 0, 0.85);
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
  background: rgba(255, 255, 255, 0.03);
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
  background: rgba(68, 255, 68, 0.06);
  border: 1px solid rgba(68, 255, 68, 0.15);
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
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.15s;
}

.end-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.end-btn.primary {
  background: rgba(68, 170, 255, 0.2);
  border-color: rgba(68, 170, 255, 0.4);
}

.end-btn.primary:hover {
  background: rgba(68, 170, 255, 0.35);
}
</style>
