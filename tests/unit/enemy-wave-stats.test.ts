// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { enemyOrder } from "@/components/enemyOrder.js";
import { getGameContent } from "@/content/gameContent.js";
import { Enemy, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { computeEnemyWaveStats, enemyLevelBounty, lateDamageMult, lateHpMult } from "@/sim/enemies/enemyWaveStats.js";
import { Grid } from "@/sim/grid/Grid.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";
import { enemyLevelForWave, waveBossCount, waveUnitCount } from "@/sim/waves/waveComposition.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { makeParticleSystem } from "../helpers/mock-managers";
import { mockDefaultTheme } from "../helpers/mock-stores";

const enemyTypes = getGameContent().enemies.types;
const difficultyMultTick = getGameContent().economy.difficultyMultTick;

const sampleCombos = [
  { level: 1, wave: 1, difficultyTick: 0 },
  { level: 3, wave: 10, difficultyTick: 0 },
  { level: 17, wave: 50, difficultyTick: 0 },
  { level: 34, wave: 100, difficultyTick: 0 },
  { level: 7, wave: 20, difficultyTick: 4 },
  { level: 12, wave: 30, difficultyTick: 9 },
];

function levelMultFromContent(level, coefficients) {
  return coefficients.intercept + coefficients.slopePerLevel * (level - 1);
}

function makeWaveManager(mapData) {
  resetEnemyId();
  const grid = new Grid(mapData);
  const particles = makeParticleSystem();
  const enemyManager = new EnemyManager(grid, particles, 0);
  return new WaveManager(mapData, enemyManager);
}

beforeEach(() => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const themeStore = useMapThemeStore();
  themeStore.defaultTheme = mockDefaultTheme;
  themeStore.activeTheme = mockDefaultTheme;
});

describe("computeEnemyWaveStats", () => {
  describe("closed-form scaling", () => {
    it("matches the content coefficients for every enemy type", () => {
      const enemyContent = getGameContent().enemies;
      for (const type of enemyOrder) {
        const meta = enemyTypes[type];
        for (const combo of sampleCombos) {
          const label = `${type} level ${combo.level} wave ${combo.wave} tick ${combo.difficultyTick}`;
          const diffMult = 1 + combo.difficultyTick * difficultyMultTick;
          const hpLevelMult = levelMultFromContent(combo.level, enemyContent.levelHpMult);
          const damageLevelMult = levelMultFromContent(combo.level, enemyContent.levelDamageMult);
          const waveHpMult = 1 + enemyContent.waveHpMult * (combo.wave - 1);
          const waveDamageMult = 1 + enemyContent.waveDamageMult * (combo.wave - 1);
          const expectedHpMult = hpLevelMult * waveHpMult * lateHpMult(combo.wave) * diffMult;
          const expectedDamage =
            meta.attackDamage * damageLevelMult * waveDamageMult * lateDamageMult(combo.wave) * diffMult;

          const stats = computeEnemyWaveStats(meta, combo.level, combo.wave, combo.difficultyTick);
          expect(stats.maxHp, `${label} hp`).toBeCloseTo(meta.baseHp * expectedHpMult, 8);
          expect(stats.attackDamage, `${label} damage`).toBeCloseTo(expectedDamage, 8);
          expect(stats.attackDps, `${label} dps`).toBeCloseTo(expectedDamage * meta.attackSpeed, 8);
          expect(stats.bounty, `${label} bounty`).toBe(enemyLevelBounty(meta.bounty, combo.level, combo.wave));
          expect(stats.shield, `${label} shield`).toBeCloseTo(meta.shield ? meta.shield * expectedHpMult : 0, 8);
        }
      }
    });

    it("scales hp and damage with difficulty ticks", () => {
      const meta = enemyTypes.minion;
      const base = computeEnemyWaveStats(meta, 5, 20, 0);
      const harder = computeEnemyWaveStats(meta, 5, 20, 2);
      expect(harder.maxHp).toBeCloseTo(base.maxHp * (1 + 2 * difficultyMultTick), 8);
      expect(harder.attackDamage).toBeCloseTo(base.attackDamage * (1 + 2 * difficultyMultTick), 8);
      expect(harder.bounty).toBe(base.bounty);
    });
  });

  describe("late steepening", () => {
    it("leaves waves at or before the start wave bit-identical", () => {
      const meta = enemyTypes.minion;
      expect(lateHpMult(1)).toBe(1);
      expect(lateHpMult(30)).toBe(1);
      expect(lateDamageMult(30)).toBe(1);
      const before = computeEnemyWaveStats(meta, 12, 30, 0);
      const hpLevelMult = 1 + 0.8 * 11;
      expect(before.maxHp).toBeCloseTo(meta.baseHp * hpLevelMult * (1 + 0.7 * 29), 8);
    });

    it("compounds to roughly two orders of magnitude by wave 100", () => {
      const mult100 = lateHpMult(100);
      expect(mult100).toBeGreaterThan(50);
      expect(mult100).toBeLessThan(150);
      const meta = enemyTypes.minion;
      const early = computeEnemyWaveStats(meta, 12, 30, 0);
      const late = computeEnemyWaveStats(meta, 45, 100, 0);
      expect(late.maxHp / early.maxHp).toBeGreaterThan(50);
    });
  });

  describe("parity with spawned enemies", () => {
    it("matches an Enemy constructed with the same level, wave, and difficulty", () => {
      const grid = new Grid(makeBastionMap());
      for (const type of enemyOrder) {
        const meta = enemyTypes[type];
        for (const combo of sampleCombos) {
          const label = `${type} level ${combo.level} wave ${combo.wave} tick ${combo.difficultyTick}`;
          const expected = computeEnemyWaveStats(meta, combo.level, combo.wave, combo.difficultyTick);
          const enemy = new Enemy(type, combo.level, 0, grid, combo.wave, combo.difficultyTick);
          expect(enemy.maxHp, `${label} hp`).toBeCloseTo(expected.maxHp, 8);
          expect(enemy.hp, `${label} hp now`).toBeCloseTo(expected.maxHp, 8);
          expect(enemy.attackDamage, `${label} damage`).toBeCloseTo(expected.attackDamage, 8);
          expect(enemy.bounty, `${label} bounty`).toBe(expected.bounty);
          expect(enemy.shield, `${label} shield`).toBe(expected.shield);
        }
      }
    });

    it("matches an EnemyManager spawn that carries the difficulty tick", () => {
      const grid = new Grid(makeBastionMap());
      const enemyManager = new EnemyManager(grid, makeParticleSystem(), 4);
      for (const type of enemyOrder) {
        const enemy = enemyManager.spawn(type, 6, 0, 30);
        expect(enemy, type).not.toBeNull();
        const expected = computeEnemyWaveStats(enemyTypes[type], 6, 30, 4);
        expect(enemy.maxHp, `${type} hp`).toBeCloseTo(expected.maxHp, 8);
        expect(enemy.attackDamage, `${type} damage`).toBeCloseTo(expected.attackDamage, 8);
      }
    });
  });

  describe("wave inputs used by the help tab", () => {
    it("derives the same enemy level as WaveManager for the current map", () => {
      const mapData = makeBastionMap();
      const waveManager = makeWaveManager(mapData);
      for (const wave of [1, 7, 10, 30, 50, 100]) {
        const orders = waveManager.generateWave(wave);
        const expectedLevel = enemyLevelForWave(wave, mapData.level);
        for (const order of orders) {
          expect(order.level, `wave ${wave}`).toBe(expectedLevel);
        }
      }
    });

    it("reports unit and boss counts consistent with generated waves", () => {
      const mapData = makeBastionMap();
      const waveManager = makeWaveManager(mapData);
      for (const wave of [1, 10, 40, 100]) {
        const orders = waveManager.generateWave(wave);
        const nonBoss = orders.filter((order) => order.type !== "boss");
        expect(nonBoss.length, `wave ${wave} non-boss count`).toBe(waveUnitCount(wave));
        const bosses = orders.filter((order) => order.type === "boss");
        expect(bosses.length, `wave ${wave} boss count`).toBe(waveBossCount(wave, mapData.bossCadence));
      }
    });
  });
});
