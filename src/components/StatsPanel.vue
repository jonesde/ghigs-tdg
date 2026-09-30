<script setup lang="ts">
import { computed } from "vue";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const uiStore = useUiStore();
const themeStore = useMapThemeStore();

// getLatestSnapshot() returns a module-level non-reactive variable, so this
// computed must depend on a reactive per-frame signal (gameStore.frameId,
// mirrored from the snapshot every tick) to re-evaluate as new snapshots arrive.
const snapshot = computed(() => {
  void gameStore.frameId;
  return getLatestSnapshot();
});
const towers = computed(() => snapshot.value?.towers ?? []);

const waveComposition = computed(() => {
  const comp = snapshot.value?.meta.waveComposition || {};
  const entries = Object.entries(comp)
    .filter(([, count]) => count > 0)
    .sort((entryA, entryB) => {
      const order = ["minion", "runner", "tank", "shielded", "healer", "flyer", "jet", "aegis", "boss"];
      return order.indexOf(entryA[0]) - order.indexOf(entryB[0]);
    });
  return entries;
});

interface EnemyStat {
  id: string;
  type: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  color: string;
  shape: string;
}

const activeEnemies = computed<EnemyStat[]>(() => {
  const enemies = snapshot.value?.enemies ?? [];
  return enemies
    .filter((enemy) => !enemy.removed)
    .map((enemy) => ({
      id: String(enemy.id),
      type: enemy.type,
      name: themeStore.getEnemyVisual(enemy.type)?.name || ENEMY_TYPES[enemy.type]?.name || enemy.type,
      level: enemy.level,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      color: themeStore.getEnemyVisual(enemy.type)?.color || "",
      shape: themeStore.getEnemyVisual(enemy.type)?.shape || "",
    }));
});

const totalDamageDealt = computed(() => {
  let total = 0;
  for (const tower of towers.value) {
    total += tower.totalDamageDealt || 0;
  }
  return Math.round(total);
});

const startingBaseHealth = computed(() => gameStore.maxBaseHealth);
const baseHealthLost = computed(() => Math.max(0, startingBaseHealth.value - gameStore.baseHealth));
const healingReceived = computed(() => snapshot.value?.meta.totalHealingReceived ?? 0);
const goldEarned = computed(() => snapshot.value?.meta.totalGoldEarned ?? 0);
const gemsEarned = computed(() => gameStore.runGemsEarned);
const deadBosses = computed(() => gameStore.bossesKilledThisRun);
const basedBosses = computed(() => gameStore.bossesReachedBaseThisRun);

function formatNumber(number: number) {
  return number.toLocaleString();
}

function hpPercent(enemy: EnemyStat) {
  if (!enemy.maxHp || enemy.maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100));
}
</script>

<template>
  <Teleport to="body">
    <div class="stats-overlay" @click.self="uiStore.closeStatsPanel()">
      <div class="stats-dialog">
        <div class="stats-header">
          <span>∑ Statistics</span>
          <button class="stats-close" @click="uiStore.closeStatsPanel()">✕</button>
        </div>

        <!-- Current Wave Section -->
        <div class="stats-section">
          <div class="stats-section-title">Current Wave</div>

          <div v-if="waveComposition.length > 0" class="wave-composition">
            <div class="comp-grid">
              <div v-for="[type, count] in waveComposition" :key="type" class="comp-item">
                <span class="comp-dot" :style="{ background: themeStore.getEnemyVisual(type)?.color || ENEMY_TYPES[type]?.color }"></span>
                <span class="comp-name">{{ themeStore.getEnemyVisual(type)?.name || ENEMY_TYPES[type]?.name || type }}</span>
                <span class="comp-count">x{{ count }}</span>
              </div>
            </div>
            <div class="comp-total">
              Total enemies in wave: {{ waveComposition.reduce((sum, [, count]) => sum + count, 0) }}
            </div>
          </div>
          <div v-else class="stats-empty">No active wave</div>
        </div>

        <!-- Active Enemies Section -->
        <div class="stats-section">
          <div class="stats-section-title">
            Active Enemies
            <span v-if="activeEnemies.length > 0" class="enemy-count">({{ activeEnemies.length }})</span>
          </div>
          <div v-if="activeEnemies.length > 0" class="enemy-list">
            <div v-for="enemy in activeEnemies" :key="enemy.id" class="enemy-row">
              <span class="enemy-dot" :style="{ background: enemy.color }"></span>
              <span class="enemy-name">{{ enemy.name }}</span>
              <span class="enemy-level">Lv{{ enemy.level }}</span>
              <div class="enemy-hp-bar">
                <div class="enemy-hp-fill" :style="{ width: hpPercent(enemy) + '%', background: enemy.color }"></div>
              </div>
              <span class="enemy-hp">{{ Math.ceil(enemy.hp) }}/{{ Math.ceil(enemy.maxHp) }}</span>
            </div>
          </div>
          <div v-else class="stats-empty">No active enemies</div>
        </div>

        <!-- Run Stats Section -->
        <div class="stats-section">
          <div class="stats-section-title">Run Statistics</div>
          <div class="run-stats-grid">
            <div class="stat-card">
              <div class="stat-card-icon">💎</div>
              <div class="stat-card-value">{{ formatNumber(gemsEarned) }}</div>
              <div class="stat-card-label">Gems Earned</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon">⛃</div>
              <div class="stat-card-value">{{ formatNumber(goldEarned) }}</div>
              <div class="stat-card-label">Gold Earned</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon">⚔️</div>
              <div class="stat-card-value">{{ formatNumber(totalDamageDealt) }}</div>
              <div class="stat-card-label">Damage Dealt</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-icon">♥</div>
              <div class="stat-card-value" :class="{ critical: baseHealthLost > startingBaseHealth * 0.5 }">
                {{ baseHealthLost }}
              </div>
              <div class="stat-card-label">Health Lost</div>
            </div>
            <div class="stat-card" v-if="healingReceived > 0">
              <div class="stat-card-icon">💚</div>
              <div class="stat-card-value">{{ healingReceived }}</div>
              <div class="stat-card-label">Healing Received</div>
            </div>
            <div class="stat-card" v-if="deadBosses > 0">
              <div class="stat-card-icon">💀</div>
              <div class="stat-card-value stat-dead">{{ deadBosses }}</div>
              <div class="stat-card-label">Dead Bosses</div>
            </div>
            <div class="stat-card" v-if="basedBosses > 0">
              <div class="stat-card-icon">👑</div>
              <div class="stat-card-value stat-based">{{ basedBosses }}</div>
              <div class="stat-card-label">Based Bosses</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.stats-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.stats-dialog {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px 24px;
  width: 520px;
  max-height: 85vh;
  overflow-y: auto;
}

.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-xl);
  font-weight: bold;
  color: var(--color-accent);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.stats-close {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.stats-close:hover {
  background: rgba(255, 255, 255, 0.15);
}

.stats-section {
  margin-bottom: 16px;
}

.stats-section:last-child {
  margin-bottom: 0;
}

.stats-section-title {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-text);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.enemy-count {
  font-size: var(--font-sm);
  font-weight: normal;
  color: var(--color-text-dim);
}

.stats-empty {
  font-size: var(--font-md);
  color: var(--color-text-dim);
  padding: 8px 0;
}

/* Wave Composition */
.comp-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.comp-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  font-size: var(--font-md);
}

.comp-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.comp-name {
  color: var(--color-text);
  font-weight: 500;
}

.comp-count {
  color: var(--color-accent);
  font-weight: 600;
}

.comp-total {
  font-size: var(--font-sm);
  color: var(--color-text-dim);
}

/* Enemy List */
.enemy-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

.enemy-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  font-size: var(--font-sm);
}

.enemy-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.enemy-name {
  color: var(--color-text);
  min-width: 70px;
  font-weight: 500;
}

.enemy-level {
  color: var(--color-text-dim);
  min-width: 36px;
  font-size: var(--font-xs);
}

.enemy-hp-bar {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
  min-width: 60px;
}

.enemy-hp-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.2s ease;
}

.enemy-hp {
  color: var(--color-text-dim);
  font-size: var(--font-xs);
  min-width: 70px;
  text-align: right;
  font-family: var(--font-mono);
}

/* Run Stats Grid */
.run-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.stat-card-icon {
  font-size: var(--font-2xl);
}

.stat-card-value {
  font-size: var(--font-2xl);
  font-weight: bold;
  color: var(--color-text);
  font-family: var(--font-mono);
}

.stat-card-value.critical {
  color: var(--color-danger);
}

.stat-card-value.stat-dead {
  color: var(--color-success);
}

.stat-card-value.stat-based {
  color: var(--color-danger);
}

.stat-card-label {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
