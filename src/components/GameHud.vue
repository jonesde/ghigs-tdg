<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { dispatchCommand } from "@/sim/commandBus.js";
import { getMapDisplayName } from "@/sim/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();
const themeStore = useMapThemeStore();

const notificationVisible = ref(false);

const baseHealthRatio = computed(() =>
  gameStore.maxBaseHealth > 0 ? gameStore.baseHealth / gameStore.maxBaseHealth : 0,
);

let checkInterval: number | null = null;

function shouldShowNotification() {
  const n = uiStore.notification;
  if (!n) return false;
  if (Date.now() > n.expires) {
    uiStore.hideNotification();
    return false;
  }
  return true;
}

function startNotificationCheck() {
  stopNotificationCheck();
  checkInterval = window.setInterval(() => {
    if (!shouldShowNotification()) {
      notificationVisible.value = false;
    } else {
      notificationVisible.value = true;
    }
  }, 200);
}

function stopNotificationCheck() {
  if (checkInterval !== null) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

watch(
  () => uiStore.notification,
  (n) => {
    if (n && shouldShowNotification()) {
      notificationVisible.value = true;
    } else {
      notificationVisible.value = false;
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (gameStore.isPlaying) {
    startNotificationCheck();
  }
});

onUnmounted(() => {
  stopNotificationCheck();
});

watch(
  () => gameStore.isPlaying,
  (playing) => {
    if (playing) {
      startNotificationCheck();
    } else {
      stopNotificationCheck();
      notificationVisible.value = false;
    }
  },
);
</script>

<template>
  <div class="hud-container">
    <div class="hud-bar">
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
          <span class="hud-value">{{ gameStore.gold }}</span>
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
        <span v-if="gameStore.commanderHold" class="commander-hold">Paused for commander</span>
      </div>
      <div class="hud-right">
        <button class="hud-btn" :class="{ playing: !gameStore.isPaused }" id="pauseBtn" @click="dispatchCommand({ commandId: 0, type: 'action:togglePause' })">
          {{ gameStore.isPaused ? '>' : '⏸' }}
        </button>
        <button class="hud-btn" id="speedBtn" @click="gameStore.cycleSpeed(); dispatchCommand({ commandId: 0, type: 'action:cycleSpeed', direction: 1 })">
          {{ gameStore.timeScale }}×
        </button>
        <button class="hud-btn stats-btn" @click="uiStore.toggleStatsPanel()">∑</button>
        <button class="hud-btn minimap-btn" :class="{ active: uiStore.showMinimap }" id="minimapBtn" @click="uiStore.toggleMinimap()">🗺</button>
        <button class="hud-btn" id="helpBtn" @click="uiStore.toggleHelpDialog()">🛈</button>
        <button class="hud-btn" id="menuBtn" @click="uiStore.openPauseMenu()">☰</button>
      </div>
    </div>
    <transition name="notification">
      <div v-if="notificationVisible" class="notification-toast">
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
  top: 48px;
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
  background: rgba(255, 255, 255, 0.05);
  font-size: var(--font-md);
  font-weight: 600;
}

.hud-stat.base-health {
  color: #5fff8a;
}

.hud-stat.critical {
  color: var(--color-danger);
  animation: pulse 0.5s ease-in-out infinite alternate;
}

.hud-stat.warning {
  color: #ffd84d;
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
  color: #d0d0ff;
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

.commander-hold {
  color: #ffd84d;
  font-size: var(--font-sm);
  font-weight: 600;
}

.hud-icon {
  font-size: var(--font-sm);
}

.hud-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
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
    background: rgba(255, 255, 255, 0.15);
  }

  .hud-btn.minimap-btn.active {
    background: rgba(95, 208, 255, 0.3);
    border-color: rgba(95, 208, 255, 0.6);
    color: #5fd0ff;
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
