<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { generateRandomMap, getMapDisplayName } from "@/sim/grid/Map.js";
import { resolveGeneratedMap } from "@/sim/grid/ProgressiveMap.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

const regionNames = computed(() => {
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    names.push(themeStore.defaultTheme?.regions.find((r) => r.id === i)?.name || `Region ${i + 1}`);
  }
  return names;
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(timestamp: number) {
  const dateObj = new Date(timestamp);
  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = MONTHS[dateObj.getMonth()];
  const year = dateObj.getFullYear();
  const hour = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} - ${hour}:${min}`;
}

const runHistory = computed(() => persistStore.runHistory || []);

function formatBreakdown(entry: Record<string, unknown>, section: string) {
  const gemBreakdown = entry.gemBreakdown as Record<
    string,
    { base: number; afterDiff: number; afterRegion: number; afterFirstTime: number }
  >;
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

interface MapInfo {
  name: string;
  region: string;
  style: string;
}

function getMapInfo(mapIndex: number) {
  if (mapIndex < 0) return null;
  const map = resolveGeneratedMap(mapIndex);
  return { name: getMapDisplayName(map, themeStore.defaultTheme), region: regionNames[map.regionId], style: map.style };
}

function replayRun(entry: Record<string, unknown>) {
  gameStore.resetToMenu();
  if (entry.mapIndex === -1 && entry.randomMapParams) {
    const p = entry.randomMapParams as {
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
    const mapData = resolveGeneratedMap(entry.mapIndex as number);
    gameStore.mapIndex = entry.mapIndex as number;
    gameStore.map = mapData;
  }
  router.push("/game");
}
</script>

<template>
  <div class="history-screen">
    <div class="history-header">
      <h2>Run History</h2>
      <button class="back-btn" @click="router.push('/')">← Back</button>
    </div>

    <div v-if="runHistory.length === 0" class="empty-state">
      <p>No runs yet. Play a map to see your history here.</p>
    </div>

    <div v-else class="history-list">
      <div v-for="(entry, index) in runHistory" :key="entry.date + '-' + index" class="history-card" :class="{ victory: entry.victory, defeat: !entry.victory }">
        <div class="card-header">
          <div class="card-title">
            <span class="map-name">{{ getMapInfo(entry.mapIndex)?.name || 'Random Map' }}</span>
            <span class="result-badge" :class="entry.victory ? 'badge-victory' : 'badge-defeat'">
              {{ entry.victory ? 'Victory' : 'Defeat' }}
            </span>
            <button class="play-btn" @click="replayRun(entry)">Play Again</button>
          </div>
          <div class="card-meta">
            <span class="card-region">{{ getMapInfo(entry.mapIndex)?.region || '' }}</span>
            <span class="card-date">{{ formatDate(entry.date) }}</span>
          </div>
        </div>

        <div class="card-stats">
          <div class="stat-item"><span class="stat-label">Wave</span><span class="stat-value">{{ entry.wave }}</span></div>
          <div class="stat-item"><span class="stat-label">Gems</span><span class="stat-value gem">{{ entry.gems }} 💎</span></div>
          <div class="stat-item"><span class="stat-label">Dead Bosses</span><span class="stat-value stat-dead">{{ entry.bossesKilled }}</span></div>
          <div class="stat-item"><span class="stat-label">Based Bosses</span><span class="stat-value stat-based">{{ entry.bossesReachedBase || 0 }}</span></div>
        </div>

        <div v-if="entry.gemBreakdown" class="card-breakdown">
          <div v-if="formatBreakdown(entry, 'bossKills')?.length" class="breakdown-section">
            <h3>Boss Kills</h3>
            <div v-for="(line, i) in formatBreakdown(entry, 'bossKills')" :key="i" class="breakdown-line">{{ line }}</div>
          </div>
          <div v-if="formatBreakdown(entry, 'milestones')?.length" class="breakdown-section">
            <h3>Milestones</h3>
            <div v-for="(line, i) in formatBreakdown(entry, 'milestones')" :key="i" class="breakdown-line">{{ line }}</div>
          </div>
          <div v-if="formatBreakdown(entry, 'waveClears')?.length" class="breakdown-section">
            <h3>Wave Clears</h3>
            <div v-for="(line, i) in formatBreakdown(entry, 'waveClears')" :key="i" class="breakdown-line">{{ line }}</div>
          </div>
          <div v-if="formatBreakdown(entry, 'waveCompletion')?.length" class="breakdown-section">
            <h3>Wave Completion</h3>
            <div v-for="(line, i) in formatBreakdown(entry, 'waveCompletion')" :key="i" class="breakdown-line">{{ line }}</div>
          </div>
          <div v-if="entry.gemBreakdown.firstClearBonus" class="breakdown-section first-clear">
            <h3>First Full Clear Bonus</h3>
            <div class="breakdown-line">+{{ entry.gemBreakdown.firstClearBonus }} 💎</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  z-index: 50;
  background: var(--color-bg);
  overflow-y: auto;
  padding: 20px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.history-header h2 {
  color: var(--color-accent);
  font-size: var(--font-2xl);
}

.back-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-md);
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-dim);
  font-size: var(--font-xl);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
}

.history-card {
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  transition: all 0.15s;
}

.history-card:hover {
  background: rgba(95, 208, 255, 0.08);
  border-color: var(--color-accent);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.map-name {
  font-weight: bold;
  font-size: var(--font-lg);
}

.result-badge {
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge-victory {
  background: rgba(68, 255, 68, 0.15);
  color: var(--color-success);
  border: 1px solid rgba(68, 255, 68, 0.3);
}

.badge-defeat {
  background: rgba(255, 68, 68, 0.15);
  color: var(--color-danger);
  border: 1px solid rgba(255, 68, 68, 0.3);
}

.card-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.card-region {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
}

.card-date {
  font-size: var(--font-sm);
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.card-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 6px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-label {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: var(--font-xl);
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

.card-breakdown {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.breakdown-section {
  margin-top: 0;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
  text-align: left;
  flex: 1 1 auto;
  min-width: 140px;
}

.breakdown-section h3 {
  font-size: var(--font-sm);
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.breakdown-line {
  font-size: var(--font-sm);
  padding: 1px 0;
  color: var(--color-text);
}

.first-clear {
  background: rgba(68, 255, 68, 0.04);
  border: 1px solid rgba(68, 255, 68, 0.1);
}

.play-btn {
  padding: 2px 8px;
  font-size: var(--font-xs);
  font-weight: 700;
  border-radius: 4px;
  border: 1px solid rgba(68, 170, 255, 0.4);
  background: rgba(68, 170, 255, 0.15);
  color: var(--color-accent);
  cursor: pointer;
  transition: background 0.15s;
  line-height: 1.4;
}

.play-btn:hover {
  background: rgba(68, 170, 255, 0.3);
}
</style>
