<template>
  <div
    ref="panelEl"
    class="minimap-panel"
    :style="{ top: gameStore.minimapPanelPos.y + 'px', left: gameStore.minimapPanelPos.x + 'px' }"
  >
    <div class="panel-header" @mousedown="onHeaderMouseDown" @touchstart="onHeaderTouchStart">
      Minimap
      <span class="close-btn" @click="uiStore.closeMinimap()" @mousedown.stop>✕</span>
    </div>
    <div class="panel-body">
      <TextGameRoot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { usePanelDrag } from "@/composables/usePanelDrag.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";
import TextGameRoot from "./TextGameRoot.vue";

const gameStore = useGameStore();
const uiStore = useUiStore();

const panelEl = ref<HTMLElement | null>(null);

const { onHeaderMouseDown, onHeaderTouchStart } = usePanelDrag({
  read: () => gameStore.minimapPanelPos,
  write: (position) => {
    gameStore.minimapPanelPos = position;
  },
  panelRef: panelEl,
  clampToViewport: true,
});

// The default panel position is a sentinel in the upper-left. On first mount,
// after the (sized-to-content) text map has actually rendered into the DOM, snap
// it to the upper-right corner. We wait for `nextTick` because the child
// TextGameRoot sets the grid data in its own onMounted — which runs before this
// parent hook — but Vue has not yet re-laid-out the now-wide text map, so an
// immediate `offsetWidth` would read the pre-render (small) size and push the
// panel off-screen to the right.
const DEFAULT_MINIMAP_X = 40;
const DEFAULT_MINIMAP_Y = 80;
const RIGHT_MARGIN = 16;

onMounted(() => {
  if (gameStore.minimapPanelPos.x === DEFAULT_MINIMAP_X && gameStore.minimapPanelPos.y === DEFAULT_MINIMAP_Y) {
    nextTick(() => {
      const panelWidth = panelEl.value?.offsetWidth ?? 0;
      const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
      const rightX = Math.max(RIGHT_MARGIN, viewportWidth - panelWidth - RIGHT_MARGIN);
      gameStore.minimapPanelPos = { x: rightX, y: gameStore.minimapPanelPos.y };
    });
  }
});
</script>

<style scoped>
.minimap-panel {
  position: absolute;
  width: max-content;
  max-width: 95vw;
  padding: 8px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  z-index: 12;
  font-size: var(--font-sm);
}

.panel-header {
  font-weight: bold;
  font-size: var(--font-md);
  margin-bottom: 6px;
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header:active {
  cursor: grabbing;
}

.close-btn {
  cursor: pointer;
  color: var(--color-text-dim);
  font-weight: normal;
}

.close-btn:hover {
  color: var(--color-danger);
}

.panel-body {
  overflow: auto;
}
</style>
