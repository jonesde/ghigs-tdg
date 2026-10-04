<script setup lang="ts">
import { computed, ref } from "vue";
import { formatEnemyLevelMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";
import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  BOSS_CADENCE,
  ENEMY_TIER_THRESHOLDS,
  ENEMY_TYPES,
  type EnemyMeta,
  enemyLevelForWave,
  waveBossCount,
  waveUnitCount,
} from "@/sim/ConstantsEnemy.js";
import { computeEnemyWaveStats } from "@/sim/enemies/enemyWaveStats.js";
import { getMapDisplayName } from "@/sim/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const gameStore = useGameStore();
const themeStore = useMapThemeStore();
const persistStore = usePersistStore();

const WAVE_STOPS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const ENEMY_ORDER = ["minion", "runner", "tank", "shielded", "healer", "flyer", "jet", "aegis", "boss"];

function nearestStopIndex(wave: number): number {
  let bestIndex = 0;
  for (let stopIndex = 0; stopIndex < WAVE_STOPS.length; stopIndex++) {
    if (WAVE_STOPS[stopIndex]! <= wave) bestIndex = stopIndex;
  }
  return bestIndex;
}

const waveStopIndex = ref(nearestStopIndex(gameStore.currentWave));
const wave = computed(() => WAVE_STOPS[waveStopIndex.value]!);
const mapLevel = computed(() => Math.max(1, gameStore.map?.level ?? 1));
const bossCadence = computed(() => gameStore.map?.bossCadence ?? BOSS_CADENCE[0]!);
const difficultyTick = computed(() => persistStore.difficulty?.multiplierTick ?? 0);
const difficultyMult = computed(() => difficultyTick.value * DIFFICULTY_MULT_TICK + 1);

const firstWaveByType = new Map<string, number>();
for (const threshold of ENEMY_TIER_THRESHOLDS) {
  firstWaveByType.set(threshold.type, threshold.minWave);
}

function firstWaveFor(type: string): number {
  return type === "boss" ? 0 : (firstWaveByType.get(type) ?? 1);
}

function isAvailable(type: string): boolean {
  if (type === "boss") return waveBossCount(wave.value, bossCadence.value) > 0;
  return wave.value >= firstWaveFor(type);
}

function formatStat(value: number, digits = 1): string {
  return String(Number(value.toFixed(digits)));
}

function enemyNotes(type: string, meta: EnemyMeta): string {
  const parts: string[] = [];
  if (type === "boss") parts.push(`Bosses every ${bossCadence.value} waves`);
  if (meta.resist) parts.push(`${Math.round(meta.resist * 100)}% damage resist`);
  if (meta.slowResist) parts.push(`${Math.round(meta.slowResist * 100)}% slow resist`);
  if (meta.knockResist) parts.push(`${Math.round(meta.knockResist * 100)}% knockback resist`);
  if (meta.heal) parts.push(`Heals ${formatStat(meta.heal * 100)}% HP/s within ${formatStat(meta.healRange)}t`);
  if (meta.flyingHeight) parts.push(`Flies ${meta.flyingHeight}t above the ground`);
  if (!isAvailable(type) && type !== "boss") parts.push(`First appears wave ${firstWaveFor(type)}`);
  return parts.join(" · ") || "—";
}

interface EnemyHelpRow {
  type: string;
  name: string;
  color: string;
  sprite: string | null;
  available: boolean;
  hp: number;
  damage: number;
  attackSpeed: number;
  dps: number;
  moveSpeed: number;
  size: number;
  shield: number;
  bounty: number;
  notes: string;
}

const enemyRows = computed<EnemyHelpRow[]>(() => {
  const enemyLevel = enemyLevelForWave(wave.value, mapLevel.value);
  return ENEMY_ORDER.map((type) => {
    const meta = ENEMY_TYPES[type] as EnemyMeta;
    const visual = themeStore.getEnemyVisual(type);
    const waveStats = computeEnemyWaveStats(meta, enemyLevel, wave.value, difficultyTick.value);
    return {
      type,
      name: visual?.name ?? meta.name ?? type,
      color: visual?.color ?? "",
      sprite: visual?.walking?.referenceImages[0]?.svg ?? null,
      available: isAvailable(type),
      hp: waveStats.maxHp,
      damage: waveStats.attackDamage,
      attackSpeed: meta.attackSpeed,
      dps: waveStats.attackDps,
      moveSpeed: meta.speed,
      size: meta.radius,
      shield: waveStats.shield,
      bounty: waveStats.bounty,
      notes: enemyNotes(type, meta),
    };
  });
});

const contextLevel = computed(() => enemyLevelForWave(wave.value, mapLevel.value));
const contextUnitCount = computed(() => waveUnitCount(wave.value));
const contextBossCount = computed(() => waveBossCount(wave.value, bossCadence.value));
const contextMapLabel = computed(() => getMapDisplayName(gameStore.map, themeStore.activeTheme));

const spawnableTypes = computed(() =>
  ENEMY_ORDER.filter((type) => isAvailable(type)).map((type) => themeStore.getEnemyVisual(type)?.name ?? type),
);

const enemyContent = getGameContent().enemies;
const hpFormula = `HP = base × (${formatEnemyLevelMult(enemyContent.levelHpMult)}) × (1 + ${
  enemyContent.waveHpMult
} × (wave − 1)) × difficulty`;
const damageFormula = `Damage = base × (${formatEnemyLevelMult(enemyContent.levelDamageMult)}) × (1 + ${
  enemyContent.waveDamageMult
} × (wave − 1)) × difficulty`;
</script>

<template>
  <div class="help-tab-panel">
    <div class="help-slider-row">
      <label class="help-slider-label" for="help-enemy-wave">Wave</label>
      <input
        id="help-enemy-wave"
        class="help-slider"
        type="range"
        min="0"
        :max="WAVE_STOPS.length - 1"
        step="1"
        v-model.number="waveStopIndex"
      />
      <span class="help-slider-value">Wave {{ wave }}</span>
    </div>

    <div class="wave-context">
      <span class="context-chip">{{ contextMapLabel }}</span>
      <span class="context-chip">Enemy level {{ contextLevel }}</span>
      <span class="context-chip">{{ contextUnitCount }} units</span>
      <span class="context-chip" :class="{ 'context-boss': contextBossCount > 0 }">
        {{ contextBossCount > 0 ? `Boss ×${contextBossCount}` : "No boss" }}
      </span>
      <span v-if="difficultyMult > 1" class="context-chip">Difficulty ×{{ formatStat(difficultyMult, 2) }}</span>
      <span class="context-detail">Spawns: {{ spawnableTypes.join(", ") }}</span>
    </div>

    <div class="stat-table-wrap">
      <table class="stat-table">
        <thead>
          <tr>
            <th class="sprite-col"></th>
            <th class="name-col">Enemy</th>
            <th>Health</th>
            <th>Damage</th>
            <th>Atk/s</th>
            <th>DPS</th>
            <th>Move</th>
            <th>Size</th>
            <th>Shield</th>
            <th>Bounty</th>
            <th class="abilities-col">Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in enemyRows" :key="row.type" :class="{ 'row-dim': !row.available }">
            <td class="sprite-cell">
              <span v-if="row.sprite" class="sprite" :style="{ color: row.color }" v-html="row.sprite" />
              <span v-else class="sprite sprite-fallback" :style="{ color: row.color }">
                {{ row.name.slice(0, 1) }}
              </span>
            </td>
            <td class="name-col"><span class="name-main">{{ row.name }}</span></td>
            <td class="num">{{ Math.round(row.hp) }}</td>
            <td class="num">{{ formatStat(row.damage) }}</td>
            <td class="num">{{ formatStat(row.attackSpeed) }}</td>
            <td class="num">{{ formatStat(row.dps) }}</td>
            <td class="num">{{ formatStat(row.moveSpeed) }}</td>
            <td class="num">{{ formatStat(row.size, 2) }}</td>
            <td class="num">{{ row.shield > 0 ? Math.round(row.shield) : "—" }}</td>
            <td class="num">{{ row.bounty }}</td>
            <td class="abilities-col">{{ row.notes }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="help-footnote">
      {{ hpFormula }}. {{ damageFormula }}. Shield is flat and grows only with enemy level. Move is tiles per
      second, size is body diameter in tiles, and bounty is the gold dropped. Enemies attack towers and the base
      only while blocked, so Atk/s is their siege rate.
    </p>
  </div>
</template>

<style scoped>
.help-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.help-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.help-slider-label {
  font-size: var(--font-md);
  font-weight: bold;
  color: var(--color-text);
}

.help-slider {
  flex: 1;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.help-slider-value {
  min-width: 70px;
  text-align: right;
  font-size: var(--font-md);
  color: var(--color-accent);
  font-family: var(--font-mono);
}

.wave-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.context-chip {
  padding: 3px 9px;
  border-radius: 6px;
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-line);
  font-size: var(--font-sm);
  color: var(--color-text);
  white-space: nowrap;
}

.context-chip.context-boss {
  background: var(--color-danger-soft);
  border-color: var(--color-danger-border);
  color: var(--color-danger);
}

.context-detail {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
}

.stat-table-wrap {
  overflow-x: auto;
}

.stat-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-sm);
}

.stat-table th {
  text-align: left;
  font-size: var(--font-xs);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-dim);
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-line-strong);
  white-space: nowrap;
}

.stat-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-line);
  color: var(--color-text);
  vertical-align: middle;
}

.sprite-col {
  width: 40px;
}

.sprite-cell {
  width: 40px;
}

.sprite {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
}

.sprite :deep(svg) {
  width: 100%;
  height: 100%;
}

.sprite-fallback {
  font-weight: bold;
}

.name-col {
  white-space: nowrap;
}

.name-main {
  color: var(--color-text);
  font-weight: 600;
}

.num {
  font-family: var(--font-mono);
  white-space: nowrap;
  text-align: right;
}

.abilities-col {
  color: var(--color-text-dim);
}

.row-dim td {
  opacity: 0.45;
}

.help-footnote {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  line-height: 1.5;
}
</style>
