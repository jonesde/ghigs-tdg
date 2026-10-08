<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { getGameContent } from "@/content/gameContent.js";
import type { MapStyle } from "@/content/schemas/maps.js";
import { customRandomMapIndex } from "@/sim/GameRunState.js";
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

const dimensionOptions = [15, 20, 25, 30, 35, 40, 45, 50] as const;
const styleOptions: MapStyle[] = ["open", "canyon", "serpentine", "split", "bastion", "battlefield"];
// The custom-run level range is the world's per-region level count, so the input's
// max and the validation below read the same number.
const mapsPerRegion = computed(() => getGameContent().maps.mapsPerRegion);

async function startRandomMap() {
  const regionId = randomRegion.value - 1;
  const level = Number(randomLevel.value);
  const style = randomStyle.value;
  const width = randomWidth.value;
  const height = randomHeight.value;
  const seed = randomSeed.value ?? Math.floor(Math.random() * 999999);

  if (level < 1 || level > mapsPerRegion.value) {
    alert(`Map Level must be between 1 and ${mapsPerRegion.value}.`);
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

  gameStore.initMap(customRandomMapIndex, mapData, null);
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
              <input id="random-level" type="number" v-model.number="randomLevel" min="1" :max="mapsPerRegion" />
            </div>
            <div class="form-field">
              <label for="random-style">Generation Type</label>
              <select id="random-style" v-model="randomStyle">
                <option v-for="s in styleOptions" :key="s" :value="s">{{ s }}</option>
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
                <option v-for="v in dimensionOptions" :key="v" :value="v">{{ v }}</option>
              </select>
            </div>
            <div class="form-field">
              <label for="random-height">Height (tiles)</label>
              <select id="random-height" v-model.number="randomHeight">
                <option v-for="v in dimensionOptions" :key="v" :value="v">{{ v }}</option>
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
  background: var(--color-scrim);
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
  border: 1px solid var(--color-line-strong);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.form-close:hover {
  background: var(--color-surface-hover);
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

.form-field input {
  padding: 8px 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-line-strong);
  border-radius: 6px;
  color: var(--color-text);
  font-size: var(--font-md);
  cursor: pointer;
  color-scheme: dark;
}

.form-field select {
  /* Native select arrows hug the right border and absorb padding on their left, so the
     caret is drawn in CSS instead: appearance none + right-positioned background icon. */
  appearance: none;
  padding: 8px 36px 8px 10px;
  background-color: var(--color-surface);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0h10L5 6z' fill='%23ece4d6' opacity='0.8'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  border: 1px solid var(--color-line-strong);
  border-radius: 6px;
  color: var(--color-text);
  font-size: var(--font-md);
  cursor: pointer;
  /* Chrome paints the opened list from color-scheme, not from the page background.
     Dark scheme keeps that popup dark so the light option text stays readable. */
  color-scheme: dark;
}

.form-field select option {
  background-color: var(--color-bg);
  color: var(--color-text);
}

.form-field input:focus,
.form-field select:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-surface-hover);
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
  border: none;
  background: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: filter 0.15s;
}

.random-play-btn:hover {
  filter: brightness(1.1);
}
</style>
