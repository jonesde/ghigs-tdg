<script setup lang="ts">
import { computed } from "vue";
import { clearBuildAndTowerForProgressive } from "@/composables/progressivePlacement.js";
import { themeProgressiveRerollGoldPerWave } from "@/content/themeMaps.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { generateProgressiveCatalog, progressiveConfigFromMap } from "@/sim/grid/ProgressiveMap.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { progressiveCellRects } from "./progressivePreview.js";

const gameStore = useGameStore();
const themeStore = useMapThemeStore();

// The offer cards paint with the live tiles of the active theme's region, so the
// block preview reads the same ramp the stamped map will use.
const regionVisual = computed(() => themeStore.getRegionVisual(gameStore.map?.regionId ?? 0));

const catalog = computed(() => {
  const config = progressiveConfigFromMap(gameStore.map);
  if (!config) return null;
  return generateProgressiveCatalog(config.seed);
});

// Must match the engine's rerollProgressiveOffer, which reads the active
// world's per-wave cost (theme override or the content-pack default).
const rerollCost = computed(() => {
  return themeProgressiveRerollGoldPerWave(themeStore.activeTheme?.maps) * gameStore.currentWave;
});
const rerollDisabled = computed(() => gameStore.gold < rerollCost.value);

const showPanel = computed(
  () => gameStore.progressivePlacementHold || (gameStore.progressiveUndoAvailable && gameStore.isPaused),
);

function onOfferClick(index: number) {
  clearBuildAndTowerForProgressive(gameStore);
  if (index === gameStore.progressiveSelectedOffer) {
    gameStore.rotateProgressiveBlock();
    return;
  }
  gameStore.selectProgressiveOffer(index);
}

function rerollOffer() {
  if (rerollDisabled.value) return;
  dispatchCommand({ commandId: 0, type: "action:rerollProgressiveOffer" });
}

function undoPlacement() {
  dispatchCommand({ commandId: 0, type: "action:undoProgressivePlacement" });
}

function previewCells(templateIndex: number): string {
  const templates = catalog.value;
  if (!templates) return "";
  return progressiveCellRects(templates, templateIndex, gameStore.progressiveRotation, 0, 0, 1, regionVisual.value);
}
</script>

<template>
  <div v-if="showPanel" class="progressive-placement">
    <template v-if="gameStore.progressivePlacementHold">
      <div class="progressive-title">Place a block</div>
      <div class="progressive-cards">
        <button
          v-for="(templateIndex, index) in gameStore.progressiveOffer"
          :key="`${templateIndex}-${index}`"
          type="button"
          class="progressive-card"
          :class="{ selected: index === gameStore.progressiveSelectedOffer }"
          @mousedown.prevent
          @keydown.enter.prevent
          @keydown.space.prevent
          @click="onOfferClick(index)"
        >
          <svg viewBox="0 0 5 5" width="72" height="72" aria-hidden="true" v-html="previewCells(templateIndex)"></svg>
          <span>{{ index + 1 }}</span>
        </button>
      </div>
      <button
        type="button"
        class="progressive-reroll"
        :disabled="gameStore.gold < rerollCost"
        @mousedown.prevent
        @keydown.enter.prevent
        @keydown.space.prevent
        @click="rerollOffer"
      >
        Re-roll {{ rerollCost }}g
      </button>
      <div class="progressive-hint">
        Tab cycles. Right-click a placement space, press R, or click the selected block to rotate. Arrows move the
        space. Enter or a left click on a pattern places.
      </div>
    </template>
    <template v-else>
      <div class="progressive-title">Block placed</div>
      <button
        type="button"
        class="progressive-undo"
        @mousedown.prevent
        @keydown.enter.prevent
        @keydown.space.prevent
        @click="undoPlacement"
      >
        Undo placement
      </button>
      <div class="progressive-hint">Paused. The undo goes away as soon as you resume.</div>
    </template>
  </div>
</template>

<style scoped>
.progressive-placement {
  position: absolute;
  left: 50%;
  /* 84px default build bar plus a 12px gap, so the hint is not drawn on top of the shop. */
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--color-panel-soft);
  border: 1px solid var(--color-line-strong);
  border-radius: 10px;
  color: var(--color-text);
  max-width: calc(100vw - 24px);
}

.progressive-title {
  font-size: var(--font-md);
}

.progressive-cards {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.progressive-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  cursor: pointer;
}

.progressive-card.selected {
  border-color: var(--color-accent);
}

.progressive-reroll {
  padding: 6px 12px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  cursor: pointer;
}

.progressive-reroll:disabled {
  opacity: 0.45;
  cursor: default;
}

.progressive-undo {
  padding: 6px 12px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-accent);
  border-radius: 8px;
  cursor: pointer;
}

.progressive-hint {
  font-size: var(--font-sm, 12px);
  opacity: 0.8;
  text-align: center;
}
</style>
