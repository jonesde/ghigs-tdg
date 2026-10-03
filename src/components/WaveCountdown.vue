<script setup lang="ts">
import { computed } from "vue";
import { useGameStore } from "@/stores/game.js";

const gameStore = useGameStore();

const isLast = computed(() => gameStore.waveCountdown?.remaining === 1);
</script>

<template>
  <div class="wave-countdown-overlay">
    <div class="wave-countdown-text">
      <span class="wave-countdown-label">Next Wave</span>
      <span class="wave-countdown-number" :class="{ 'countdown-final': isLast }" :key="gameStore.waveCountdown?.remaining">{{ gameStore.waveCountdown?.remaining }}</span>
    </div>
  </div>
</template>

<style scoped>
.wave-countdown-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 5;
}

.wave-countdown-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.wave-countdown-label {
  font-size: var(--font-xl);
  font-weight: 600;
  color: var(--color-text-dim);
  opacity: 0.5;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.wave-countdown-number {
  font-size: var(--font-display);
  font-weight: 700;
  color: var(--color-gold);
  opacity: 0.5;
  transition: opacity 0.3s ease, transform 0.3s ease;
  line-height: 1;
  user-select: none;
}

.countdown-final {
  color: var(--color-danger);
}
</style>
