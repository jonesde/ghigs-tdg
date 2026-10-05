<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { dispatchCommand } from "@/sim/commandBus.js";
import { getMapDisplayName } from "@/sim/grid/Map.js";
import { buildingEffectSummaryParts, runBonusSummaryParts } from "@/sim/runBonuses.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();
const themeStore = useMapThemeStore();

const effectsOpen = ref(false);

const baseHealthRatio = computed(() =>
  gameStore.maxBaseHealth > 0 ? gameStore.baseHealth / gameStore.maxBaseHealth : 0,
);

const bonusParts = computed(() => [
  ...runBonusSummaryParts(gameStore.runBonuses),
  ...buildingEffectSummaryParts(gameStore.buildingEffects),
]);

// uiStore.showNotification stamps an absolute expiry, so one timer per
// notification replaces polling the store: on arrival schedule the remaining
// wait, and clear the toast when it fires.
let expiryTimer: number | null = null;

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function hideExpiredNotification(): void {
  clearExpiryTimer();
  uiStore.hideNotification();
}

watch(
  () => uiStore.notification,
  (notification) => {
    clearExpiryTimer();
    if (!notification) return;
    const remaining = notification.expires - Date.now();
    if (remaining <= 0) {
      hideExpiredNotification();
      return;
    }
    expiryTimer = window.setTimeout(hideExpiredNotification, remaining);
  },
  { immediate: true },
);

const barRef = ref<HTMLElement | null>(null);
let barHeightObserver: ResizeObserver | null = null;

// Publishes the bar's rendered height as --hud-height on <html> for the
// consumers that clear it: SvgGameRoot's play-area wrapper insets its top by
// the token, the notification toast offsets by it, and EnemyChat's resting
// position anchors below it. Cross-module side effect: the bar owns its own
// layout (the narrow-viewport wrap included), so it measures itself here and
// the root element is what the sibling consumers inherit.
// A zero measurement (bar not laid out yet) leaves the CSS default in place.
function publishBarHeight(): void {
  const height = barRef.value?.offsetHeight ?? 0;
  if (height > 0) document.documentElement.style.setProperty("--hud-height", `${height}px`);
}

onMounted(() => {
  publishBarHeight();
  const element = barRef.value;
  if (!element) return;
  barHeightObserver = new ResizeObserver(publishBarHeight);
  barHeightObserver.observe(element);
});

onUnmounted(() => {
  clearExpiryTimer();
  barHeightObserver?.disconnect();
  barHeightObserver = null;
  document.documentElement.style.removeProperty("--hud-height");
});
</script>

<template>
  <div class="hud-container">
    <div ref="barRef" class="hud-bar">
      <div class="hud-left">
        <span class="hud-label map-title">{{ getMapDisplayName(gameStore.map, themeStore.activeTheme) }}</span>
      </div>
      <div class="hud-center">
        <span class="hud-stat base-health" :class="{ warning: baseHealthRatio <= 0.5 && baseHealthRatio > 0.25, critical: baseHealthRatio <= 0.25 }">
          <span class="hud-icon">♥</span>
          <span class="hud-value">{{ Math.round(gameStore.baseHealth) }}</span>
        </span>
        <span class="hud-stat gold">
          <span class="hud-icon">🪙</span>
          <span class="hud-value">{{ Math.floor(gameStore.gold) }}</span>
        </span>
        <span class="hud-stat gems">
          <span class="hud-icon">💎</span>
          <span class="hud-value">{{ persistStore.gems }}</span>
        </span>
      </div>
      <div class="hud-center-extra">
        <span class="hud-btn wave-counter">
          <span class="hud-icon">☠</span>
          <span>Wave</span>
          <span class="hud-value">{{ gameStore.currentWave }}</span>
        </span>
        <button
          v-if="bonusParts.length"
          type="button"
          class="effects-chip"
          :class="{ open: effectsOpen }"
          :aria-expanded="effectsOpen"
          @click="effectsOpen = !effectsOpen"
        >
          Effects ×{{ bonusParts.length }}
          <span class="effects-pop" tabindex="0" aria-label="Active run effects">
            <span v-for="part in bonusParts" :key="part" class="effects-part">{{ part }}</span>
          </span>
        </button>
        <span v-if="gameStore.commanderHold" class="commander-hold">Paused for commander</span>
      </div>
      <div class="hud-right">
        <button
          class="hud-btn"
          :class="{ playing: !gameStore.isPaused }"
          id="pauseBtn"
          :aria-label="gameStore.isPaused ? 'Resume' : 'Pause'"
          @click="dispatchCommand({ commandId: 0, type: 'action:togglePause' })"
        >
          {{ gameStore.isPaused ? '>' : '⏸' }}
        </button>
        <button
          class="hud-btn"
          id="speedBtn"
          :aria-label="`Time speed ${gameStore.timeScale} times. Activate to speed up.`"
          @click="dispatchCommand({ commandId: 0, type: 'action:cycleSpeed', direction: 1 })"
        >
          {{ gameStore.timeScale }}×
        </button>
        <button
          class="hud-btn sound-btn"
          :class="{ muted: !persistStore.soundEnabled }"
          id="soundBtn"
          aria-label="Sound"
          :aria-pressed="persistStore.soundEnabled"
          @click="persistStore.toggleSoundEnabled()"
        >
          {{ persistStore.soundEnabled ? "🔊" : "🔇" }}
        </button>
        <button class="hud-btn stats-btn" aria-label="Statistics" @click="uiStore.toggleStatsPanel()">∑</button>
        <button
          class="hud-btn minimap-btn"
          :class="{ active: uiStore.showMinimap }"
          id="minimapBtn"
          aria-label="Minimap"
          :aria-pressed="uiStore.showMinimap"
          @click="uiStore.toggleMinimap()"
        >🗺</button>
        <button class="hud-btn" id="helpBtn" aria-label="Help" @click="uiStore.toggleHelpDialog()">🛈</button>
        <button class="hud-btn" id="menuBtn" aria-label="Pause menu" @click="uiStore.openPauseMenu()">☰</button>
      </div>
    </div>
    <transition name="notification">
      <div v-if="uiStore.notification" class="notification-toast">
        <span class="notification-message">{{ uiStore.notification?.message }}</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.hud-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  /* The bar owns its layout (40px row, auto-wrap under 720px) and publishes
     the rendered height as --hud-height; sizing itself from that token would
     make the measurement circular and pin a wrapped height past the wrap. */
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
  user-select: none;
}

.hud-container {
  position: relative;
}

.notification-toast {
  position: absolute;
  /* Clears the HUD bar below it. */
  top: calc(var(--hud-height) + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px 16px;
  z-index: 11;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  user-select: none;
}

.notification-message {
  font-size: var(--font-md);
  color: var(--color-text);
  font-weight: 500;
}

.notification-enter-active {
  transition: opacity 0.2s ease;
}

.notification-leave-active {
  transition: opacity 0.3s ease;
}

.notification-enter-from,
.notification-leave-to {
  opacity: 0;
}

.hud-left, .hud-center, .hud-right, .hud-center-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hud-label {
  font-size: var(--font-md);
  color: var(--color-text-dim);
}

.hud-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--color-surface-subtle);
  font-size: var(--font-md);
  font-weight: 600;
}

.hud-stat.base-health {
  color: var(--color-success);
}

.hud-stat.critical {
  color: var(--color-danger);
  animation: pulse 0.5s ease-in-out infinite alternate;
}

.hud-stat.warning {
  color: var(--color-warning);
}

.hud-stat.gold {
  color: var(--color-gold);
}

.hud-stat.gems {
  color: var(--color-gem);
}

.hud-btn.wave-counter {
  font-size: var(--font-xl);
  font-weight: 500;
  color: var(--color-text);
  gap: 6px;
  height: 28px;
  padding: 4px 10px;
  user-select: none;
  background: none;
  border: none;
  cursor: default;
}

.hud-btn.wave-counter .hud-value {
  font-size: var(--font-2xl);
  font-weight: 700;
}

.hud-btn.wave-counter .hud-icon {
  font-size: var(--font-2xl);
}

.effects-chip {
  position: relative;
  padding: 2px 8px;
  border: 1px solid var(--color-line-strong);
  border-radius: 4px;
  background: var(--color-surface-subtle);
  color: var(--color-text-dim);
  font-family: inherit;
  font-size: var(--font-sm);
  white-space: nowrap;
  cursor: pointer;
}

.effects-chip:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

/* Anchored to the chip's right edge: the part strings carry themed tower names
   and are nowrap, so a left-anchored popup runs off a narrow viewport. */
.effects-pop {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  flex-direction: column;
  gap: 3px;
  min-width: 170px;
  max-width: min(320px, calc(100vw - 16px));
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  color: var(--color-text);
  font-size: var(--font-md);
  font-weight: 400;
  white-space: nowrap;
  overflow-x: auto;
}

.effects-chip:hover .effects-pop,
.effects-chip:focus-within .effects-pop,
.effects-chip.open .effects-pop {
  display: flex;
}

.effects-part {
  display: block;
  text-align: left;
}

.commander-hold {
  color: var(--color-gold);
  font-size: var(--font-sm);
  font-weight: 600;
}

.hud-icon {
  font-size: var(--font-sm);
}

.hud-btn {
  background: var(--color-surface);
  border: 1px solid var(--color-line-strong);
  color: var(--color-text);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-md);
  height: 28px;
  min-width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  transition: background 0.15s;
}

.hud-btn:hover {
  background: var(--color-surface-hover);
}

.hud-btn.minimap-btn.active {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-strong);
  color: var(--color-accent);
}

.hud-btn.sound-btn.muted {
  opacity: 0.5;
}

@keyframes pulse {
  from { opacity: 1; }
  to { opacity: 0.5; }
}

@media (max-width: 720px) {
  .hud-bar {
    height: auto;
    flex-wrap: wrap;
    row-gap: 4px;
    padding: 4px 6px 6px;
  }

  .hud-left,
  .hud-right {
    flex: 1 1 100%;
    min-width: 0;
  }

  /* The wave counter, effects chip, and commander hold share the wrapped row.
     Without min-width: 0 and wrap the nowrap chip widens the bar past the
     viewport instead of letting the row reflow. */
  .hud-center,
  .hud-center-extra {
    flex: 1 1 100%;
    min-width: 0;
    flex-wrap: wrap;
    row-gap: 4px;
  }

  .hud-right {
    justify-content: flex-end;
  }

  .map-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
