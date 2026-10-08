<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { DEFAULT_THEME_ID } from "@/render/themes/index.js";
import { customProgressiveMapIndex, customRandomMapIndex } from "@/sim/GameRunState.js";
import { generateRandomMap, getMapDisplayName, progressiveMapDisplayName } from "@/sim/grid/Map.js";
import { generateProgressiveMap, type ProgressiveConfig, resolveGeneratedMap } from "@/sim/grid/ProgressiveMap.js";
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

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(timestamp: number) {
  const dateObj = new Date(timestamp);
  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = months[dateObj.getMonth()];
  const year = dateObj.getFullYear();
  const hour = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} - ${hour}:${min}`;
}

const runHistory = computed(() => [...(persistStore.runHistory || [])].reverse());

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
  world: string;
}

function entryThemeId(entry: Record<string, unknown>): string {
  return typeof entry.themeId === "string" ? entry.themeId : DEFAULT_THEME_ID;
}

function entryTheme(entry: Record<string, unknown>) {
  const themeId = entryThemeId(entry);
  return themeStore.loadedThemes[themeId] ?? themeStore.defaultTheme;
}

function entryWorldLabel(entry: Record<string, unknown>): string {
  const themeId = entryThemeId(entry);
  return themeStore.availableThemes.find((theme) => theme.id === themeId)?.label ?? entryTheme(entry)?.label ?? themeId;
}

function getMapInfo(entry: Record<string, unknown>): MapInfo | null {
  const theme = entryTheme(entry);
  const world = entryWorldLabel(entry);
  const mapIndex = entry.mapIndex as number;
  if (mapIndex === customProgressiveMapIndex && entry.progressiveMapParams) {
    const params = entry.progressiveMapParams as ProgressiveConfig;
    return {
      name: progressiveMapDisplayName(params.regionId, params.entryCount, theme),
      region: regionNames.value[params.regionId] ?? "",
      style: "progressive",
      world,
    };
  }
  if (mapIndex < 0) return null;
  const map = resolveGeneratedMap(mapIndex, theme?.maps);
  return {
    name: getMapDisplayName(map, theme),
    region: regionNames.value[map.regionId] ?? "",
    style: map.style,
    world,
  };
}

async function replayRun(entry: Record<string, unknown>) {
  gameStore.resetToMenu();

  // Runs remember the world they took place in (save v5); pre-v5 entries fall
  // back to the default world. Resolve that theme before generating the map so
  // both sides of the worker boundary use the same catalog, and switch the
  // selected world so the replay's visuals match the original run.
  const themeId = typeof entry.themeId === "string" ? entry.themeId : DEFAULT_THEME_ID;
  persistStore.lastSelectedThemeId = themeId;
  persistStore.save();
  const theme = await themeStore.loadActive(themeId).catch(() => themeStore.defaultTheme);

  if (entry.mapIndex === customRandomMapIndex && entry.randomMapParams) {
    const p = entry.randomMapParams as {
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
  } else if (entry.mapIndex === customProgressiveMapIndex && entry.progressiveMapParams) {
    const p = entry.progressiveMapParams as ProgressiveConfig;
    gameStore.mapIndex = customProgressiveMapIndex;
    gameStore.map = generateProgressiveMap(p);
  } else {
    const mapData = resolveGeneratedMap(entry.mapIndex as number, theme?.maps);
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
            <span class="map-name">{{ getMapInfo(entry)?.name || 'Generated Map' }}</span>
            <span class="result-badge" :class="entry.victory ? 'badge-victory' : 'badge-defeat'">
              {{ entry.victory ? 'Victory' : 'Defeat' }}
            </span>
            <button class="play-btn" @click="replayRun(entry)">Play Again</button>
          </div>
          <div class="card-meta">
            <span class="card-region">{{ getMapInfo(entry)?.world || '' }} • {{ getMapInfo(entry)?.region || '' }}</span>
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
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  transition: all 0.15s;
}

.history-card:hover {
  background: var(--color-accent-soft);
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
  background: var(--color-success-soft);
  color: var(--color-success);
  border: 1px solid var(--color-success-border);
}

.badge-defeat {
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border: 1px solid var(--color-danger-border);
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
  background: var(--color-surface-subtle);
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
  background: var(--color-surface-subtle);
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
  background: var(--color-success-soft);
  border: 1px solid var(--color-success-border);
}

.play-btn {
  padding: 2px 8px;
  font-size: var(--font-xs);
  font-weight: 700;
  border-radius: 4px;
  border: 1px solid var(--color-accent-border);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  cursor: pointer;
  transition: background 0.15s;
  line-height: 1.4;
}

.play-btn:hover {
  background: var(--color-accent-hover);
}
</style>
