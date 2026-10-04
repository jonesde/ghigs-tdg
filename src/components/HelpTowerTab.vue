<script setup lang="ts">
import { computed, ref } from "vue";
import { TOWER_BASE, TOWER_META, TOWER_VARIANTS, type TowerId, TowerIds, targetsLabel } from "@/sim/ConstantsTower.js";
import {
  computeTowerCoreStats,
  computeTowerMaxHealth,
  type TowerBaseConfig,
  type TowerCoreStats,
} from "@/sim/towers/towerCoreStats.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";

const themeStore = useMapThemeStore();

const TOWER_ID_LIST = Object.values(TowerIds);

const towerLevel = ref(1);

function formatStat(value: number, digits = 1): string {
  return String(Number(value.toFixed(digits)));
}

function abilityText(towerId: TowerId, core: TowerCoreStats): string {
  const parts: string[] = [];
  if (core.damage <= 0 && core.fireRate <= 0) {
    parts.push("No attack — blocks the path");
  } else {
    if (core.splash > 0) parts.push(`Splash ${formatStat(core.splash, 2)}t`);
    if (core.chain > 0) parts.push(`Chain ${core.chain}`);
    if (core.slowAmt > 0) parts.push(`Slow ${Math.round(core.slowAmt * 100)}% for ${formatStat(core.slowDur)}s`);
    if (core.stun > 0) parts.push(`Stun ${formatStat(core.stun)}s`);
    if (core.pierce > 0) parts.push(`Pierce ${core.pierce}`);
    if (core.knockbackBase > 0) parts.push("Knockback");
    if (core.napalm) parts.push("Burn");
    if (core.stormcall) parts.push("Storm");
    if (core.marksman) parts.push("Marksman crit");
    if (core.armorPiercing) parts.push("Ignores shields");
    if (core.thornReflectPct > 0) parts.push(`Thorns ${Math.round(core.thornReflectPct * 100)}%`);
    if (core.fenceDamage > 0) parts.push(`Fence ${core.fenceDamage}/s, ${formatStat(core.fenceStun)}s stun`);
  }
  parts.push(`Default targeting: ${towerId === "sniper" ? "strong" : "first"}`);
  parts.push(targetsLabel(core.groundOnly));
  return parts.join(" · ");
}

interface TowerHelpRow {
  key: string;
  name: string;
  color: string;
  sprite: string | null;
  variantLabel: string | null;
  startsGroup: boolean;
  cost: number;
  health: number;
  damage: number;
  attackSpeed: number;
  dps: number;
  range: number;
  abilities: string;
}

const towerRows = computed<TowerHelpRow[]>(() => {
  const level = towerLevel.value;
  const variants: Array<"A" | "B" | null> = level >= 5 ? ["A", "B"] : [null];
  const rows: TowerHelpRow[] = [];
  for (const towerId of TOWER_ID_LIST) {
    const base = TOWER_BASE[towerId] as TowerBaseConfig;
    const visual = themeStore.getTowerVisual(towerId);
    for (const [variantIndex, variant] of variants.entries()) {
      const core = computeTowerCoreStats(base, towerId, level, variant);
      rows.push({
        key: `${towerId}-${variant ?? "base"}`,
        name: visual?.name ?? towerId,
        color: visual?.color ?? "",
        sprite: visual?.animation?.referenceImages[0]?.svg ?? null,
        variantLabel: variant ? (TOWER_VARIANTS[towerId]?.[variant]?.name ?? variant) : null,
        startsGroup: variantIndex === 0,
        cost: TOWER_META[towerId]?.cost ?? 0,
        health: computeTowerMaxHealth(base, towerId, level, variant, core.healthMult),
        damage: core.damage,
        attackSpeed: core.fireRate,
        dps: core.damage * core.fireRate,
        range: core.range,
        abilities: abilityText(towerId, core),
      });
    }
  }
  return rows;
});

function isIdle(row: TowerHelpRow): boolean {
  return row.damage <= 0 && row.attackSpeed <= 0;
}
</script>

<template>
  <div class="help-tab-panel">
    <div class="help-slider-row">
      <label class="help-slider-label" for="help-tower-level">Tower Level</label>
      <input
        id="help-tower-level"
        class="help-slider"
        type="range"
        min="1"
        max="7"
        step="1"
        v-model.number="towerLevel"
      />
      <span class="help-slider-value">Level {{ towerLevel }}</span>
    </div>

    <p v-if="towerLevel >= 5" class="help-hint">
      Levels 5-7 require a specialization, so both paths are listed with their specialization name.
    </p>

    <div class="stat-table-wrap">
      <table class="stat-table">
        <thead>
          <tr>
            <th class="sprite-col"></th>
            <th class="name-col">Tower</th>
            <th>Cost</th>
            <th>Health</th>
            <th>Damage</th>
            <th>Atk/s</th>
            <th>DPS</th>
            <th>Range</th>
            <th>Move</th>
            <th>Size</th>
            <th class="abilities-col">Abilities</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in towerRows" :key="row.key" :class="{ 'group-start': row.startsGroup }">
            <td class="sprite-cell">
              <span v-if="row.sprite" class="sprite" :style="{ color: row.color }" v-html="row.sprite" />
              <span v-else class="sprite sprite-fallback" :style="{ color: row.color }">{{ row.name.slice(0, 1) }}</span>
            </td>
            <td class="name-col">
              <span class="name-main">{{ row.name }}</span>
              <span v-if="row.variantLabel" class="variant-badge">{{ row.variantLabel }}</span>
            </td>
            <td class="num">{{ row.cost }}</td>
            <td class="num">{{ Math.round(row.health) }}</td>
            <td class="num">{{ isIdle(row) ? "—" : formatStat(row.damage) }}</td>
            <td class="num">{{ isIdle(row) ? "—" : formatStat(row.attackSpeed) }}</td>
            <td class="num">{{ isIdle(row) ? "—" : formatStat(row.dps) }}</td>
            <td class="num">{{ row.range > 0 ? formatStat(row.range) : "—" }}</td>
            <td class="num">—</td>
            <td class="num">1×1</td>
            <td class="abilities-col">{{ row.abilities }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="help-footnote">
      DPS is damage × fire rate against a single target; splash, chain, and burn hit more. Range and size are in
      tiles. These values are the plain per-level progression — skill-tree add-ons, terrain and milestone bonuses,
      and difficulty are not included.
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

.help-hint {
  font-size: var(--font-sm);
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

.stat-table tr.group-start td {
  border-top: 1px solid var(--color-line-strong);
}

.stat-table tr:first-child td {
  border-top: none;
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

.variant-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent-border);
  color: var(--color-accent);
  font-size: var(--font-xs);
}

.num {
  font-family: var(--font-mono);
  white-space: nowrap;
  text-align: right;
}

.abilities-col {
  color: var(--color-text-dim);
}

.help-footnote {
  font-size: var(--font-xs);
  color: var(--color-text-dim);
  line-height: 1.5;
}
</style>
