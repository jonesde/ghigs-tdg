<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  CUSTOM_PROGRESSIVE_MAP_INDEX,
  CUSTOM_RANDOM_MAP_INDEX,
  MAP_GEM_MULTIPLIERS,
  type MapStyle,
} from "@/sim/Constants.js";
import { generateRandomMap, getMap, getMapDisplayName } from "@/sim/grid/Map.js";
import {
  gemMultiplierForRegionLevel,
  generateProgressiveMap,
  type ProgressiveConfig,
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

const regionNames = computed(() => {
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    const activeRegion = themeStore.activeTheme?.regions.find((r) => r.id === i);
    const defaultRegion = themeStore.defaultTheme?.regions.find((r) => r.id === i);
    names.push(activeRegion?.name ?? defaultRegion?.name ?? `Region ${i + 1}`);
  }
  return names;
});

const mapDisplayName = computed(() => {
  return (map: { regionId: number; level?: number; name?: string }) => {
    if (map.name) return map.name;
    const theme = themeStore.activeTheme ?? themeStore.defaultTheme;
    if (theme) {
      const region = theme.regions.find((r) => r.id === map.regionId);
      if (region && map.level !== undefined) {
        return `${region.name} Map ${map.level}`;
      }
    }
    return `Map ${map.regionId}`;
  };
});

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

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    showRandomDialog.value = false;
    showProgressiveDialog.value = false;
  }
}

onMounted(() => window.addEventListener("keydown", onWindowKeydown));
onUnmounted(() => window.removeEventListener("keydown", onWindowKeydown));

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

// Computed map entries: reactive to highestUnlockedMap and bestWaves changes
const mapEntries = computed<Record<number, MapEntry>>(() => {
  const entries: Record<number, MapEntry> = {};
  for (let i = 0; i < 36; i++) {
    const map = getMap(i);
    entries[i] = {
      name: mapDisplayName.value(map),
      region: regionNames.value[map.regionId],
      style: map.style,
      gemReward: MAP_GEM_MULTIPLIERS[i],
      width: map.width,
      height: map.height,
      locked: i > persistStore.highestUnlockedMap,
      bestWave: typeof persistStore.bestWaves[`best_${i}`] === "number" ? persistStore.bestWaves[`best_${i}`] : 0,
    };
  }
  const theme = themeStore.activeTheme ?? themeStore.defaultTheme;
  for (let regionId = 0; regionId < 3; regionId++) {
    for (let variantIndex = 0; variantIndex < 4; variantIndex++) {
      const index = progressiveMapIndex(regionId, variantIndex);
      const config = progressiveConfigForIndex(index);
      if (!config) continue;
      const map = resolveGeneratedMap(index);
      const bestKey = `best_${index}`;
      entries[index] = {
        name: getMapDisplayName(map, theme),
        region: regionNames.value[map.regionId] ?? `Region ${regionId + 1}`,
        style: map.style,
        gemReward: gemMultiplierForRegionLevel(map.regionId, map.level),
        width: map.width,
        height: map.height,
        locked: persistStore.highestUnlockedMap < progressiveUnlockMapIndex(config),
        bestWave: typeof persistStore.bestWaves[bestKey] === "number" ? persistStore.bestWaves[bestKey] : 0,
      };
    }
  }
  return entries;
});

function getFullEntry(index: number) {
  return mapEntries.value[index];
}

const regionMapCounts = [12, 12, 12];

interface MapGroup {
  regionId: number;
  name: string;
  maps: { index: number }[];
  progressive: { index: number }[];
}

const mapsByRegion = computed<MapGroup[]>(() => {
  const groups: MapGroup[] = [];
  let start = 0;
  for (let regionIdx = 0; regionIdx < 3; regionIdx++) {
    const count = regionMapCounts[regionIdx];
    if (count === 0) continue;
    groups.push({
      regionId: regionIdx,
      name: regionNames.value[regionIdx],
      maps: Array.from({ length: count }, (_, i) => ({ index: start + i })),
      progressive: Array.from({ length: 4 }, (_, variantIndex) => ({
        index: progressiveMapIndex(regionIdx, variantIndex),
      })),
    });
    start += count;
  }
  return groups;
});

async function startMap(index: number) {
  persistStore.clearActiveWave(index);

  // Ensure theme is resolved before navigating to /game
  const themeId = persistStore.lastSelectedThemeId;
  if (themeStore.activeTheme && themeStore.activeTheme.id === themeId) {
    // Theme already loaded and matches selected id
  } else if (themeStore.defaultTheme && themeId === themeStore.defaultTheme.id) {
    // Use preloaded default theme
    themeStore.activeTheme = themeStore.defaultTheme;
  } else {
    await themeStore.loadActive(themeId).catch((err) => console.error("Failed to load theme:", err));
  }

  // Load map data into the store so SvgGameRoot can pick it up
  const mapData = resolveGeneratedMap(index);
  gameStore.initMap(index, mapData, null);

  router.push("/game");
}

const randomRegion = computed({
  get: () => persistStore.randomMapRegion,
  set: (v: number) => {
    persistStore.randomMapRegion = v;
  },
});
const randomLevel = computed({
  get: () => persistStore.randomMapLevel,
  set: (v: number) => {
    persistStore.randomMapLevel = v;
  },
});
const randomStyle = computed({
  get: () => persistStore.randomMapStyle,
  set: (v: MapStyle) => {
    persistStore.randomMapStyle = v;
  },
});
// A cleared number input arrives as "" through v-model.number; only a real finite
// number is a pinned seed, anything else restores the "Auto" placeholder state.
function normalizeSeedInput(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const randomSeed = computed({
  get: () => persistStore.randomMapSeed,
  set: (v: unknown) => {
    persistStore.randomMapSeed = normalizeSeedInput(v);
  },
});
const randomWidth = computed({
  get: () => persistStore.randomMapWidth,
  set: (v: number) => {
    persistStore.randomMapWidth = v;
  },
});
const randomHeight = computed({
  get: () => persistStore.randomMapHeight,
  set: (v: number) => {
    persistStore.randomMapHeight = v;
  },
});
const progressiveRegion = computed({
  get: () => persistStore.progressiveMapRegion,
  set: (v: number) => {
    persistStore.progressiveMapRegion = v;
  },
});
const progressiveLevel = computed({
  get: () => persistStore.progressiveMapLevel,
  set: (v: number) => {
    persistStore.progressiveMapLevel = v;
  },
});
const progressiveEntries = computed({
  get: () => persistStore.progressiveMapEntries,
  set: (v: number) => {
    persistStore.progressiveMapEntries = v;
  },
});
const progressiveSeed = computed({
  get: () => persistStore.progressiveMapSeed,
  set: (v: unknown) => {
    persistStore.progressiveMapSeed = normalizeSeedInput(v);
  },
});

const DIMENSION_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50] as const;
const STYLE_OPTIONS: MapStyle[] = ["open", "canyon", "serpentine", "split", "bastion", "battlefield"];
const ENTRY_COUNT_OPTIONS = [1, 2, 3, 4] as const;

function startRandomMap() {
  const regionId = randomRegion.value - 1;
  const level = Number(randomLevel.value);
  const style = randomStyle.value;
  const width = randomWidth.value;
  const height = randomHeight.value;
  const seed = randomSeed.value ?? Math.floor(Math.random() * 999999);

  if (level < 1 || level > 12) {
    alert("Map Level must be between 1 and 12.");
    return;
  }
  if (width < 15 || width > 50 || width % 5 !== 0) {
    alert("Width must be between 15 and 50 in steps of 5.");
    return;
  }
  if (height < 15 || height > 50 || height % 5 !== 0) {
    alert("Height must be between 15 and 50 in steps of 5.");
    return;
  }
  if (seed < 0) {
    alert("Seed must be a non-negative number.");
    return;
  }

  const mapData = generateRandomMap(width, height, style, regionId, level, seed);
  const params = { regionId, level, style, seed, width, height };

  gameStore.initMap(CUSTOM_RANDOM_MAP_INDEX, mapData, null);
  gameStore.randomMapParams = params;

  router.push("/game");
}

function startProgressiveMap() {
  const regionId = progressiveRegion.value - 1;
  const level = Number(progressiveLevel.value);
  const entryCount = progressiveEntries.value;
  const seed = progressiveSeed.value ?? Math.floor(Math.random() * 999999);

  if (level < 1 || level > 12) {
    alert("Map Level must be between 1 and 12.");
    return;
  }
  if (entryCount < 1 || entryCount > 4) {
    alert("Base Entries must be between 1 and 4.");
    return;
  }
  if (seed < 0) {
    alert("Seed must be a non-negative number.");
    return;
  }

  const config: ProgressiveConfig = { regionId, level, entryCount, seed };
  const mapData = generateProgressiveMap(config);

  gameStore.initMap(CUSTOM_PROGRESSIVE_MAP_INDEX, mapData, null);

  router.push("/game");
}
</script>

<template>
  <div class="map-select">
    <div class="map-select-header">
      <h2>Select Map</h2>
      <div class="header-controls">
        <button class="header-btn" @click="openRandomDialog()">Generate Map</button>
        <button class="header-btn" @click="openProgressiveDialog()">Progressive Run</button>
        <select v-model="persistStore.lastSelectedThemeId" class="theme-select" @change="persistStore.save()">
          <option v-for="theme in themeStore.availableThemes" :key="theme.id" :value="theme.id">
            {{ theme.label }}
          </option>
        </select>
        <button class="header-btn" @click="$router.push('/')">← Back</button>
      </div>
    </div>

    <div class="map-grid">
      <template v-for="group in mapsByRegion" :key="group.regionId">
        <div class="region-header" :class="'region-' + group.regionId">
          <span class="region-label">{{ group.name }}</span>
          <span class="region-divider"></span>
        </div>
        <div
          v-for="m in group.maps"
          :key="m.index"
          class="map-card"
          :class="{ locked: getFullEntry(m.index).locked }"
          tabindex="0"
          role="button"
          @click="!getFullEntry(m.index).locked && startMap(m.index)"
          @keydown.enter="!getFullEntry(m.index).locked && startMap(m.index)"
          @keydown.space.prevent="!getFullEntry(m.index).locked && startMap(m.index)"
        >
          <div class="map-name">{{ getFullEntry(m.index).name }}</div>
          <div class="map-region">
            {{ getFullEntry(m.index).region }} • {{ getFullEntry(m.index).style }} • 💎 x{{ getFullEntry(m.index).gemReward }}
          </div>
          <div class="map-best">Best Wave: {{ getFullEntry(m.index).bestWave }}</div>
          <div class="map-dimensions">{{ getFullEntry(m.index).width }}×{{ getFullEntry(m.index).height }}</div>
        </div>
        <div class="region-header progressive-header">
          <span class="region-label">Progressive</span>
          <span class="region-divider"></span>
        </div>
        <div
          v-for="m in group.progressive"
          :key="m.index"
          class="map-card"
          :class="{ locked: getFullEntry(m.index).locked }"
          tabindex="0"
          role="button"
          @click="!getFullEntry(m.index).locked && startMap(m.index)"
          @keydown.enter="!getFullEntry(m.index).locked && startMap(m.index)"
          @keydown.space.prevent="!getFullEntry(m.index).locked && startMap(m.index)"
        >
          <div class="map-name">{{ getFullEntry(m.index).name }}</div>
          <div class="map-region">
            {{ getFullEntry(m.index).region }} • {{ getFullEntry(m.index).style }} • 💎 x{{
              getFullEntry(m.index).gemReward
            }}
          </div>
          <div class="map-best">Best Wave: {{ getFullEntry(m.index).bestWave }}</div>
          <div class="map-dimensions">{{ getFullEntry(m.index).width }}×{{ getFullEntry(m.index).height }}</div>
        </div>
      </template>
    </div>

    <Teleport to="body">
      <div v-if="showRandomDialog" class="form-overlay" @click.self="closeRandomDialog()">
        <div class="form-dialog">
          <div class="form-dialog-header">
            <div class="form-dialog-title">
              <h3>Generated Map</h3>
              <span class="random-map-subtitle">Generate a procedural map with custom parameters</span>
            </div>
            <button class="form-close" @click="closeRandomDialog()">×</button>
          </div>
          <div class="random-map-form">
            <div class="form-row">
              <div class="form-field">
                <label for="random-region">Region</label>
                <select id="random-region" v-model.number="randomRegion">
                  <option v-for="name in regionNames" :key="name" :value="regionNames.indexOf(name) + 1">{{ name }}</option>
                </select>
              </div>
              <div class="form-field">
                <label for="random-level">Map Level</label>
                <input id="random-level" type="number" v-model.number="randomLevel" min="1" max="12" />
              </div>
              <div class="form-field">
                <label for="random-style">Generation Type</label>
                <select id="random-style" v-model="randomStyle">
                  <option v-for="s in STYLE_OPTIONS" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label for="random-seed">Map Gen Seed</label>
                <input id="random-seed" type="number" v-model.number="randomSeed" min="0" placeholder="Auto" />
              </div>
              <div class="form-field">
                <label for="random-width">Width (tiles)</label>
                <select id="random-width" v-model.number="randomWidth">
                  <option v-for="v in DIMENSION_OPTIONS" :key="v" :value="v">{{ v }}</option>
                </select>
              </div>
              <div class="form-field">
                <label for="random-height">Height (tiles)</label>
                <select id="random-height" v-model.number="randomHeight">
                  <option v-for="v in DIMENSION_OPTIONS" :key="v" :value="v">{{ v }}</option>
                </select>
              </div>
            </div>
            <div class="form-actions">
              <button class="random-play-btn" @click="startRandomMap">Play Generated Map</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showProgressiveDialog" class="form-overlay" @click.self="closeProgressiveDialog()">
        <div class="form-dialog">
          <div class="form-dialog-header">
            <div class="form-dialog-title">
              <h3>Progressive Map</h3>
              <span class="random-map-subtitle">Grow a progressive map from custom parameters</span>
            </div>
            <button class="form-close" @click="closeProgressiveDialog()">×</button>
          </div>
          <div class="random-map-form">
            <div class="form-row">
              <div class="form-field">
                <label for="progressive-region">Region</label>
                <select id="progressive-region" v-model.number="progressiveRegion">
                  <option v-for="name in regionNames" :key="name" :value="regionNames.indexOf(name) + 1">{{ name }}</option>
                </select>
              </div>
              <div class="form-field">
                <label for="progressive-level">Map Level</label>
                <input id="progressive-level" type="number" v-model.number="progressiveLevel" min="1" max="12" />
              </div>
              <div class="form-field">
                <label for="progressive-entries">Base Entries</label>
                <select id="progressive-entries" v-model.number="progressiveEntries">
                  <option v-for="entryCountOption in ENTRY_COUNT_OPTIONS" :key="entryCountOption" :value="entryCountOption">
                    {{ entryCountOption }}
                  </option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label for="progressive-seed">Map Gen Seed</label>
                <input id="progressive-seed" type="number" v-model.number="progressiveSeed" min="0" placeholder="Auto" />
              </div>
            </div>
            <div class="form-actions">
              <button class="random-play-btn" @click="startProgressiveMap">Play Progressive Map</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
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
  margin-bottom: 16px;
  flex-shrink: 0;
}

.header-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.theme-select {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 6px;
  font-size: var(--font-md);
  cursor: pointer;
  /* Chrome paints the opened list from color-scheme, not from the page background.
     Dark scheme keeps that popup dark so the light option text stays readable. */
  color-scheme: dark;
}

.theme-select option {
  background-color: #141721;
  color: var(--color-text);
}

.theme-select:hover {
  background: rgba(255, 255, 255, 0.15);
}

.map-select-header h2 {
  color: var(--color-accent);
  font-size: var(--font-2xl);
}

.header-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-md);
}

.header-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.map-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  justify-content: center;
}

@media (max-width: 720px) {
  .map-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.region-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding-bottom: 4px;
}

.region-header:first-child {
  margin-top: 0;
}

.region-label {
  font-size: var(--font-md);
  font-weight: bold;
  letter-spacing: 0.5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.region-0 .region-label { color: #6abf6a; }
.region-1 .region-label { color: #e8c96a; }
.region-2 .region-label { color: #8a7d6a; }

.region-divider {
  flex: 1;
  height: 1px;
}

.region-0 .region-divider { background: linear-gradient(to right, rgba(106, 191, 106, 0.5), transparent); }
.region-1 .region-divider { background: linear-gradient(to right, rgba(232, 201, 106, 0.5), transparent); }
.region-2 .region-divider { background: linear-gradient(to right, rgba(138, 125, 106, 0.5), transparent); }

.map-card {
  min-width: 0;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.map-card:hover:not(.locked) {
  background: rgba(95, 208, 255, 0.1);
  border-color: var(--color-accent);
}

.map-card.locked {
  opacity: 0.35;
  cursor: not-allowed;
}

.map-name {
  font-weight: bold;
  font-size: var(--font-md);
  margin-bottom: 6px;
  overflow-wrap: anywhere;
}

.map-region {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  margin-bottom: 4px;
}

.map-best {
  font-size: var(--font-sm);
  color: var(--color-gold);
  margin-bottom: 2px;
}

.map-dimensions {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
}

.form-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.form-dialog {
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px 24px;
}

.form-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}

.form-dialog-title h3 {
  font-size: var(--font-xl);
  font-weight: 700;
  color: var(--color-accent);
  margin: 0 0 4px;
}

.random-map-subtitle {
  display: block;
  font-size: var(--font-sm);
  color: var(--color-text-dim);
}

.form-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  line-height: 26px;
  font-size: 18px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  cursor: pointer;
}

.form-close:hover {
  background: rgba(255, 255, 255, 0.15);
}

.random-map-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-field label {
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-field input,
.form-field select {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: var(--color-text);
  font-size: var(--font-md);
  cursor: pointer;
  color-scheme: dark;
}

.form-field select option {
  background-color: #141721;
  color: var(--color-text);
}

.form-field input:focus,
.form-field select:focus {
  outline: none;
  border-color: var(--color-accent);
  background: rgba(255, 255, 255, 0.12);
}

.form-field input::placeholder {
  color: var(--color-text-dim);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.random-play-btn {
  padding: 10px 24px;
  font-size: var(--font-md);
  font-weight: 700;
  border-radius: 6px;
  border: 1px solid rgba(68, 170, 255, 0.4);
  background: rgba(68, 170, 255, 0.2);
  color: var(--color-accent);
  cursor: pointer;
  transition: background 0.15s;
}

.random-play-btn:hover {
  background: rgba(68, 170, 255, 0.35);
}
</style>
