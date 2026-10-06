<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import GeneratedMapDialog from "@/components/GeneratedMapDialog.vue";
import ProgressiveMapDialog from "@/components/ProgressiveMapDialog.vue";
import RegionMap from "@/components/RegionMap.vue";
import type { RegionMapNodeView } from "@/components/RegionMapNodeView.js";
import { CLEARED_CROWN_GLYPH, isClearedBestWave } from "@/components/regionMapProgress.js";
import {
  MAP_GEM_MULTIPLIERS,
  MAPS_PER_REGION,
  PROGRESSIVE_MAP_COUNT,
  PROGRESSIVE_MAP_INDEX_BASE,
} from "@/sim/Constants.js";
import { getMap, getMapDisplayName } from "@/sim/grid/Map.js";
import {
  gemMultiplierForRegionLevel,
  progressiveConfigForIndex,
  progressiveMapIndex,
  progressiveUnlockMapIndex,
  resolveGeneratedMap,
} from "@/sim/grid/ProgressiveMap.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

// Map progress is per-world; follow the selected world from the header dropdown,
// which startMap also resolves before launching a run.
const selectedThemeProgress = computed(() => persistStore.getThemeProgress(persistStore.lastSelectedThemeId));

watch(
  () => persistStore.lastSelectedThemeId,
  (id) => {
    themeStore.activeThemeId = id;
    themeStore.loadActive(id).catch((err) => console.error("Failed to load theme:", err));
  },
);

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

interface MapEntry {
  name: string;
  region: string;
  style: string;
  gemReward: number;
  width: number;
  height: number;
  locked: boolean;
  bestWave: number;
}

// Computed map entries: reactive to the selected world's progress bucket and
// the active theme's maps catalog.
const mapEntries = computed<Record<number, MapEntry>>(() => {
  const entries: Record<number, MapEntry> = {};
  const theme = themeStore.activeTheme ?? themeStore.defaultTheme;
  const maps = themeStore.resolvedMaps;
  const progress = selectedThemeProgress.value;
  for (let i = 0; i < 36; i++) {
    const map = getMap(i, maps);
    entries[i] = {
      name: getMapDisplayName(map, theme),
      region: themeStore.regionNames[map.regionId],
      style: map.style,
      gemReward: MAP_GEM_MULTIPLIERS[i],
      width: map.width,
      height: map.height,
      locked: i > progress.highestUnlockedMap,
      bestWave: typeof progress.bestWaves[`best_${i}`] === "number" ? progress.bestWaves[`best_${i}`] : 0,
    };
  }
  for (let regionId = 0; regionId < 3; regionId++) {
    for (let variantIndex = 0; variantIndex < 4; variantIndex++) {
      const index = progressiveMapIndex(regionId, variantIndex);
      const config = progressiveConfigForIndex(index, maps);
      if (!config) continue;
      const map = resolveGeneratedMap(index, maps);
      const bestKey = `best_${index}`;
      entries[index] = {
        name: getMapDisplayName(map, theme),
        region: themeStore.regionNames[map.regionId] ?? `Region ${regionId + 1}`,
        style: map.style,
        gemReward: gemMultiplierForRegionLevel(map.regionId, map.level),
        width: map.width,
        height: map.height,
        locked: progress.highestUnlockedMap < progressiveUnlockMapIndex(config),
        bestWave: typeof progress.bestWaves[bestKey] === "number" ? progress.bestWaves[bestKey] : 0,
      };
    }
  }
  return entries;
});

function getFullEntry(index: number) {
  return mapEntries.value[index];
}

function regionIdForMapIndex(mapIndex: number): number | null {
  if (mapIndex < PROGRESSIVE_MAP_INDEX_BASE) return Math.floor(mapIndex / MAPS_PER_REGION);
  return progressiveConfigForIndex(mapIndex, themeStore.resolvedMaps)?.regionId ?? null;
}

function firstMapIndexForRegion(regionId: number): number {
  return regionId * MAPS_PER_REGION;
}

function defaultRegionTab(): number {
  return Math.min(Math.floor(selectedThemeProgress.value.highestUnlockedMap / MAPS_PER_REGION), 2);
}

function savedMapIndexIsValid(mapIndex: number | null): mapIndex is number {
  return (
    typeof mapIndex === "number" &&
    Number.isInteger(mapIndex) &&
    mapIndex >= 0 &&
    mapIndex < PROGRESSIVE_MAP_INDEX_BASE + PROGRESSIVE_MAP_COUNT
  );
}

// The region tab is derived from the selected map index so the two can never
// disagree; a missing/invalid saved index falls back to the default region.
const savedMapIndex = persistStore.lastSelectedMapIndex;
const initialMapIndex = savedMapIndexIsValid(savedMapIndex) ? savedMapIndex : null;
const activeRegionTab = ref(
  initialMapIndex !== null ? (regionIdForMapIndex(initialMapIndex) ?? defaultRegionTab()) : defaultRegionTab(),
);
const selectedMapIndex = ref<number | null>(initialMapIndex ?? firstMapIndexForRegion(activeRegionTab.value));

watch(selectedMapIndex, (value) => {
  persistStore.lastSelectedMapIndex = value;
  persistStore.save();
});

const activeRegionLayout = computed(() => {
  const theme = themeStore.activeTheme ?? themeStore.defaultTheme;
  return theme?.regions.find((region) => region.id === activeRegionTab.value)?.mapLayout ?? null;
});

const activeRegionMapImage = computed(() => {
  const theme = themeStore.activeTheme ?? themeStore.defaultTheme;
  return theme?.regions.find((region) => region.id === activeRegionTab.value)?.mapImage ?? "";
});

function progressiveMapIndexForLevel(regionId: number, level: number): number | null {
  for (let variantIndex = 0; variantIndex < 4; variantIndex++) {
    const mapIndex = progressiveMapIndex(regionId, variantIndex);
    const config = progressiveConfigForIndex(mapIndex, themeStore.resolvedMaps);
    if (config && config.level === level) return mapIndex;
  }
  return null;
}

const activeRegionNodes = computed<RegionMapNodeView[]>(() => {
  const layout = activeRegionLayout.value;
  if (!layout) return [];
  const regionId = activeRegionTab.value;
  const nodeViews: RegionMapNodeView[] = [];
  for (const node of layout.nodes) {
    const mapIndex =
      node.kind === "level"
        ? regionId * MAPS_PER_REGION + (node.level - 1)
        : progressiveMapIndexForLevel(regionId, node.level);
    if (mapIndex === null) {
      console.warn(`Region ${regionId} map layout has no progressive variant at level ${node.level}`);
      continue;
    }
    const entry = getFullEntry(mapIndex);
    if (!entry) continue;
    let label = `${node.level}`;
    if (node.kind === "progressive") {
      const config = progressiveConfigForIndex(mapIndex, themeStore.resolvedMaps);
      label = config ? `P${config.entryCount}` : "P";
    }
    // firstClears is the authoritative clear record (GameEngine.endGame writes it on
    // any victory). The best-wave test only covers a debug setWave(VICTORY_WAVE)
    // jump, which records a best wave but no first clear.
    const cleared = !!selectedThemeProgress.value.firstClears[String(mapIndex)] || isClearedBestWave(entry.bestWave);
    nodeViews.push({
      kind: node.kind,
      level: node.level,
      x: node.x,
      y: node.y,
      label,
      tooltip: `${entry.name} • ${entry.style} • 💎 x${entry.gemReward} • Best Wave: ${entry.bestWave} • ${entry.width}×${entry.height}${cleared ? ` • ${CLEARED_CROWN_GLYPH} Cleared` : ""}`,
      locked: entry.locked,
      mapIndex,
      bestWave: entry.bestWave,
      cleared,
    });
  }
  return nodeViews;
});

const selectedEntry = computed(() => (selectedMapIndex.value === null ? null : getFullEntry(selectedMapIndex.value)));

function selectRegionTab(regionId: number) {
  activeRegionTab.value = regionId;
  selectedMapIndex.value = firstMapIndexForRegion(regionId);
}

function selectNode(mapIndex: number) {
  selectedMapIndex.value = mapIndex;
}

function startNode(mapIndex: number) {
  const entry = getFullEntry(mapIndex);
  if (!entry || entry.locked) return;
  startMap(mapIndex);
}

function playSelected() {
  if (selectedMapIndex.value === null) return;
  startNode(selectedMapIndex.value);
}

async function startMap(index: number) {
  persistStore.clearActiveWave(persistStore.lastSelectedThemeId, index);

  await themeStore.ensureActiveTheme();

  // Load map data into the store so SvgGameRoot can pick it up.
  const mapData = resolveGeneratedMap(index, themeStore.resolvedMaps);
  gameStore.initMap(index, mapData, null);

  router.push("/game");
}
</script>

<template>
  <div class="map-select">
    <div class="map-select-header">
      <div class="region-tabs" role="tablist" aria-label="Regions">
        <button
          v-for="(name, regionId) in themeStore.regionNames"
          :key="regionId"
          class="region-tab"
          :class="['region-' + regionId, { active: activeRegionTab === regionId }]"
          role="tab"
          :aria-selected="activeRegionTab === regionId"
          @click="selectRegionTab(regionId)"
        >
          {{ name }}
        </button>
      </div>
      <div class="header-controls">
        <select v-model="persistStore.lastSelectedThemeId" class="theme-select" @change="persistStore.save()">
          <option v-for="theme in themeStore.availableThemes" :key="theme.id" :value="theme.id">
            {{ theme.label }}
          </option>
        </select>
        <button class="header-btn" @click="openRandomDialog()">Generate</button>
        <button class="header-btn" @click="openProgressiveDialog()">Progressive</button>
        <button class="header-btn" @click="$router.push('/')"><span class="back-arrow">←</span> Back</button>
      </div>
    </div>

    <div class="region-map-wrap">
      <RegionMap
        v-if="activeRegionLayout"
        :map-image="activeRegionMapImage"
        :view-box="activeRegionLayout.viewBox"
        :connections="activeRegionLayout.connections"
        :node-views="activeRegionNodes"
        :selected-index="selectedMapIndex"
        @select="selectNode"
        @start="startNode"
      />
    </div>

    <div class="map-details">
      <template v-if="selectedEntry">
        <div class="details-info">
          <div class="details-name">{{ selectedEntry.name }}</div>
          <div class="details-meta">
            {{ selectedEntry.region }} • {{ selectedEntry.style }} • 💎 x{{ selectedEntry.gemReward }}
          </div>
          <div class="details-meta">
            Best Wave: {{ selectedEntry.bestWave }} • {{ selectedEntry.width }}×{{ selectedEntry.height }}
          </div>
        </div>
        <button class="details-play-btn" :disabled="selectedEntry.locked" @click="playSelected()">
          {{ selectedEntry.locked ? "Locked" : "Play" }}
        </button>
      </template>
    </div>

    <GeneratedMapDialog :show="showRandomDialog" @close="closeRandomDialog" />
    <ProgressiveMapDialog :show="showProgressiveDialog" @close="closeProgressiveDialog" />
  </div>
</template>

<style scoped>
.map-select {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  z-index: 50;
  background: var(--color-bg);
  overflow-y: auto;
  padding: 20px;
}

.map-select-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.header-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.theme-select {
  /* Native select arrows hug the right border and absorb padding on their left, so the
     caret is drawn in CSS instead: appearance none + right-positioned background icon. */
  appearance: none;
  padding: 8px 36px 8px 12px;
  background-color: var(--color-surface);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0h10L5 6z' fill='%23ece4d6' opacity='0.8'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  border: 1px solid var(--color-line-strong);
  color: var(--color-text);
  border-radius: 6px;
  font-size: var(--font-md);
  cursor: pointer;
  /* Chrome paints the opened list from color-scheme, not from the page background.
     Dark scheme keeps that popup dark so the light option text stays readable. */
  color-scheme: dark;
}

.theme-select option {
  background-color: var(--color-bg);
  color: var(--color-text);
}

.theme-select:hover {
  background-color: var(--color-surface-hover);
}

.header-btn {
  padding: 8px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-line-strong);
  color: var(--color-text);
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-md);
}

.header-btn:hover {
  background: var(--color-surface-hover);
}

.back-arrow {
  display: inline-block;
  transform: translateY(-2px);
}

.region-tabs {
  display: flex;
  justify-content: flex-start;
  gap: 12px;
  flex-shrink: 0;
}

@media (max-width: 1024px) {
  .map-select-header {
    flex-direction: column-reverse;
  }

  .header-controls,
  .region-tabs {
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
  }
}

.region-tab {
  padding: 8px 18px;
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  color: var(--color-text-dim);
  font-size: var(--font-md);
  font-weight: bold;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.15s;
}

.region-tab:hover {
  background: var(--color-surface-hover);
}

.region-tab.region-0 { color: var(--color-region-0); }
.region-tab.region-1 { color: var(--color-region-1); }
.region-tab.region-2 { color: var(--color-region-2); }

.region-tab.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.region-map-wrap {
  width: 100%;
  flex-shrink: 0;
}

.map-details {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
  padding: 12px 16px;
  min-height: 64px;
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  flex-shrink: 0;
}

.details-info {
  min-width: 0;
}

.details-name {
  font-weight: bold;
  font-size: var(--font-xl);
  margin-bottom: 4px;
  overflow-wrap: anywhere;
}

.details-meta {
  font-size: var(--font-lg);
  color: var(--color-text-dim);
}

.details-play-btn {
  flex-shrink: 0;
  padding: 10px 24px;
  font-size: var(--font-xl);
  font-weight: 700;
  border-radius: 6px;
  border: none;
  background: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: filter 0.15s;
}

.details-play-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.details-play-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

</style>
