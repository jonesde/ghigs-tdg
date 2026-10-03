<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { CUSTOM_RANDOM_MAP_INDEX, type MapStyle } from "@/sim/Constants.js";
import { generateRandomMap } from "@/sim/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const props = defineProps<{ show: boolean }>();

const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const gameStore = useGameStore();
const themeStore = useMapThemeStore();
const persistStore = usePersistStore();

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

const DIMENSION_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50] as const;
const STYLE_OPTIONS: MapStyle[] = ["open", "canyon", "serpentine", "split", "bastion", "battlefield"];

async function startRandomMap() {
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

  await themeStore.ensureActiveTheme();

  // The worker regenerates this map in loadRandomMap with the active world's
  // noise scalars; generating here with the same catalog keeps both grids
  // identical.
  const mapData = generateRandomMap(width, height, style, regionId, level, seed, themeStore.resolvedMaps);
  const params = { regionId, level, style, seed, width, height };

  gameStore.initMap(CUSTOM_RANDOM_MAP_INDEX, mapData, null);
  gameStore.randomMapParams = params;

  router.push("/game");
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.show) {
    emit("close");
  }
}

onMounted(() => window.addEventListener("keydown", onWindowKeydown));
onUnmounted(() => window.removeEventListener("keydown", onWindowKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="form-overlay" @click.self="emit('close')">
      <div class="form-dialog">
        <div class="form-dialog-header">
          <div class="form-dialog-title">
            <h3>Generated Map</h3>
            <span class="random-map-subtitle">Generate a procedural map with custom parameters</span>
          </div>
          <button class="form-close" @click="emit('close')">×</button>
        </div>
        <div class="random-map-form">
          <div class="form-row">
            <div class="form-field">
              <label for="random-region">Region</label>
              <select id="random-region" v-model.number="randomRegion">
                <option v-for="name in themeStore.regionNames" :key="name" :value="themeStore.regionNames.indexOf(name) + 1">{{ name }}</option>
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
</template>

<style scoped>
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
