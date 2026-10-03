// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BETWEEN_WAVES_TIMER,
  BOSS_CADENCE,
  ENEMY_TYPES,
  HEALER_MIN_GAP,
  PRE_EMPTIVE_WAVE_TIMER,
  VICTORY_WAVE,
  WAVE_COUNT_BASE,
  WAVE_COUNT_SCALE,
} from "@/sim/Constants.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap, makeMapData } from "../helpers/mock-grid";
import { makeParticleSystem } from "../helpers/mock-managers";
import { mockDefaultTheme } from "../helpers/mock-stores";

beforeEach(() => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const themeStore = useMapThemeStore();
  themeStore.defaultTheme = mockDefaultTheme;
  themeStore.activeTheme = mockDefaultTheme;
});

function makeWaveManager(mapData: ReturnType<typeof makeBastionMap>) {
  resetEnemyId();
  const grid = new Grid(mapData);
  const particles = makeParticleSystem();
  const enemyManager = new EnemyManager(grid, particles, 0);
  return new WaveManager(mapData, enemyManager);
}

function makeMultiSpawnMap() {
  const map = makeBastionMap();
  map.spawns = [
    { x: 0, y: 3 },
    { x: 1, y: 3 },
    { x: 2, y: 3 },
  ];
  return map;
}

function makeMultiSpawnWaveManager() {
  const map = makeMultiSpawnMap();
  resetEnemyId();
  const grid = new Grid(map);
  const particles = makeParticleSystem();
  const enemyManager = new EnemyManager(grid, particles, 0);
  return new WaveManager(map, enemyManager);
}
describe("WaveManager", () => {
  describe("constructor", () => {
    it("initializes with wave 0 and betweenWaves = true", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      expect(waveManager.currentWave).toBe(0);
      expect(waveManager.betweenWaves).toBe(true);
      expect(waveManager.active).toBe(false);
    });

    it("sets bossCadence from map", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      expect(waveManager.bossCadence).toBe(BOSS_CADENCE[0]);
    });

    it("sets maxWaves to VICTORY_WAVE", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      expect(waveManager.maxWaves).toBe(VICTORY_WAVE);
    });
  });

  describe("generateWave", () => {
    it("generates correct enemy count for wave 1", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(1);
      const expectedCount = WAVE_COUNT_BASE + Math.floor(1 * WAVE_COUNT_SCALE);
      expect(wave.length).toBe(expectedCount);
    });

    it("scales enemy count with wave number", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const waveOne = waveManager.generateWave(1);
      const waveTen = waveManager.generateWave(10);
      const expectedOne = WAVE_COUNT_BASE + Math.floor(1 * WAVE_COUNT_SCALE);
      const expectedTen = WAVE_COUNT_BASE + Math.floor(10 * WAVE_COUNT_SCALE);
      // Wave 10 is a boss wave (10 % 5 === 0), so it has extra bosses
      expect(waveOne.length).toBe(expectedOne);
      expect(waveTen.length).toBeGreaterThanOrEqual(expectedTen);
      expect(waveTen.length).toBeGreaterThan(waveOne.length);
    });

    it("sets enemy level based on wave and region level", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      const wave = waveManager.generateWave(10);
      const expectedLevel = Math.max(1, Math.floor(10 / 3) + map.level);
      for (const entry of wave) {
        expect(entry.level).toBe(expectedLevel);
      }
    });

    it("includes boss at boss cadence waves for region 0", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(BOSS_CADENCE[0]);
      const bosses = wave.filter((enemy) => enemy.type === "boss");
      expect(bosses.length).toBeGreaterThanOrEqual(1);
    });

    it("does not include boss at non-cadence waves", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(7); // 7 % 10 !== 0
      const bosses = wave.filter((enemy) => enemy.type === "boss");
      expect(bosses).toHaveLength(0);
    });

    it("includes extra bosses at wave 30, 60, 90...", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave30 = waveManager.generateWave(30);
      const bosses30 = wave30.filter((enemy) => enemy.type === "boss");
      const expectedBossCount = 1 + Math.floor(30 / 30);
      expect(bosses30.length).toBe(expectedBossCount);
    });

    it("does not cap non-boss count by boss count (uses render pool only as overflow queue)", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      // High wave: many bosses plus a large non-boss base count. Previously the
      // non-boss count was clamped by (ENEMY_POOL_SIZE - bossCount), thinning waves.
      const wave = waveManager.generateWave(100);
      const nonBoss = wave.filter((enemy) => enemy.type !== "boss");
      const expectedBaseCount = WAVE_COUNT_BASE + Math.floor(100 * WAVE_COUNT_SCALE);
      expect(nonBoss.length).toBe(expectedBaseCount);
    });

    it("produces deterministic waves for the same seed", () => {
      const map = makeBastionMap();
      const waveManagerA = makeWaveManager(map);
      const waveManagerB = makeWaveManager(map);
      const waveA = waveManagerA.generateWave(10);
      const waveB = waveManagerB.generateWave(10);
      expect(waveA).toEqual(waveB);
    });

    it("produces different waves for different seeds", () => {
      const mapA = makeBastionMap();
      const mapB = makeMapData({ ...mapA, seed: 9999 });
      const waveManagerA = makeWaveManager(mapA);
      const waveManagerB = makeWaveManager(mapB);
      const waveA = waveManagerA.generateWave(10);
      const waveB = waveManagerB.generateWave(10);
      expect(waveA).not.toEqual(waveB);
    });

    it("includes runners in waves >= 5", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave5 = waveManager.generateWave(5);
      const types = new Set(wave5.map((e) => e.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it("keeps tanks behind wave 15 and rolls them from wave 15 on", () => {
      for (let seed = 0; seed < 8; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 1000 + seed });
        for (let waveNumber = 1; waveNumber < 15; waveNumber++) {
          for (const entry of makeWaveManager(map).generateWave(waveNumber)) {
            expect(entry.type).not.toBe("tank");
          }
        }
      }
      let sawTank = false;
      for (let seed = 0; seed < 30; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 2000 + seed });
        if (
          makeWaveManager(map)
            .generateWave(15)
            .some((entry) => entry.type === "tank")
        )
          sawTank = true;
      }
      expect(sawTank).toBe(true);
    });

    it("keeps shielded behind wave 25 and rolls them from wave 25 on", () => {
      for (let seed = 0; seed < 8; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 3000 + seed });
        for (let waveNumber = 1; waveNumber < 25; waveNumber++) {
          for (const entry of makeWaveManager(map).generateWave(waveNumber)) {
            expect(entry.type).not.toBe("shielded");
          }
        }
      }
      let sawShielded = false;
      for (let seed = 0; seed < 30; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 4000 + seed });
        if (
          makeWaveManager(map)
            .generateWave(25)
            .some((entry) => entry.type === "shielded")
        )
          sawShielded = true;
      }
      expect(sawShielded).toBe(true);
    });

    it("keeps healers behind wave 35 and rolls them from wave 35 on", () => {
      for (let seed = 0; seed < 8; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 5000 + seed });
        for (let waveNumber = 1; waveNumber < 35; waveNumber++) {
          for (const entry of makeWaveManager(map).generateWave(waveNumber)) {
            expect(entry.type).not.toBe("healer");
          }
        }
      }
      let sawHealer = false;
      for (let seed = 0; seed < 30; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 6000 + seed });
        if (
          makeWaveManager(map)
            .generateWave(35)
            .some((entry) => entry.type === "healer")
        )
          sawHealer = true;
      }
      expect(sawHealer).toBe(true);
    });

    it("keeps at least HEALER_MIN_GAP enemies between consecutive healers", () => {
      let sawHealer = false;
      for (let seed = 0; seed < 20; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 7000 + seed });
        for (let waveNumber = 35; waveNumber <= 45; waveNumber++) {
          const wave = makeWaveManager(map).generateWave(waveNumber);
          let seenHealer = false;
          let sinceLastHealer = 0;
          for (const entry of wave) {
            if (entry.type === "healer") {
              if (seenHealer) {
                expect(sinceLastHealer).toBeGreaterThanOrEqual(HEALER_MIN_GAP);
              }
              seenHealer = true;
              sinceLastHealer = 0;
            } else {
              sinceLastHealer++;
            }
          }
          if (seenHealer) sawHealer = true;
        }
      }
      expect(sawHealer).toBe(true);
    });

    it("caps healer count at the maximum staggered density and keeps the wave length", () => {
      for (let seed = 0; seed < 20; seed++) {
        const map = makeMapData({ ...makeBastionMap(), seed: 7100 + seed });
        for (let waveNumber = 35; waveNumber <= 45; waveNumber++) {
          const wave = makeWaveManager(map).generateWave(waveNumber);
          const healerCount = wave.filter((entry) => entry.type === "healer").length;
          const nonHealerCount = wave.length - healerCount;
          expect(healerCount).toBeLessThanOrEqual(1 + Math.floor(nonHealerCount / HEALER_MIN_GAP));
          const nonBoss = wave.filter((entry) => entry.type !== "boss");
          expect(nonBoss.length).toBe(WAVE_COUNT_BASE + Math.floor(waveNumber * WAVE_COUNT_SCALE));
        }
      }
    });

    it("staggered healer waves are deterministic for the same seed", () => {
      const map = makeBastionMap();
      const waveA = makeWaveManager(map).generateWave(35);
      const waveB = makeWaveManager(map).generateWave(35);
      expect(waveA).toEqual(waveB);
    });

    it("all enemies have valid types", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      for (let waveNumber = 1; waveNumber <= 20; waveNumber++) {
        const wave = waveManager.generateWave(waveNumber);
        for (const entry of wave) {
          expect(ENEMY_TYPES[entry.type]).toBeDefined();
        }
      }
    });

    it("each entry has a delay property", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(1);
      for (const entry of wave) {
        expect(entry.delay).toBeDefined();
        expect(typeof entry.delay).toBe("number");
      }
    });
  });

  describe("startNextWave", () => {
    it("increments currentWave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.currentWave).toBe(1);
    });

    it("sets betweenWaves to false", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.betweenWaves).toBe(false);
    });

    it("sets active to true", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.active).toBe(true);
    });

    it("generates and stores the wave queue", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.queue.length).toBeGreaterThan(0);
    });

    it("counts bosses in the wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      const expectedBosses = waveManager.queue.filter((enemy) => enemy.type === "boss").length;
      expect(waveManager.bossesThisWave).toBe(expectedBosses);
    });
  });

  describe("update", () => {
    it("waits BETWEEN_WAVES_TIMER seconds before starting wave 1", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      // betweenTimer starts at BETWEEN_WAVES_TIMER, so a short update must not start a wave yet
      let startedWave: number | null = null;
      waveManager.update(0.1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(null);
      expect(waveManager.betweenWaves).toBe(true);
      // After the full build delay, wave 1 starts
      waveManager.update(BETWEEN_WAVES_TIMER + 0.1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(1);
      expect(waveManager.betweenWaves).toBe(false);
    });

    it("calls onWaveStart when starting a wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      let startedWave: number | null = null;
      waveManager.update(BETWEEN_WAVES_TIMER + 0.1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(1);
    });

    it("spawns enemies from the queue", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      const initialEnemyCount = waveManager.enemyManager.enemies.length;
      waveManager.update(10.0, null, null); // Let time pass
      expect(waveManager.enemyManager.enemies.length).toBeGreaterThan(initialEnemyCount);
    });

    it("starts countdown immediately when all enemies are dead and queue is empty", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.queue = [];
      waveManager.update(0.1, null, null);
      expect(waveManager.countdownActive).toBe(true);
      expect(waveManager.countdownTimer).toBe(BETWEEN_WAVES_TIMER);
    });

    it("does not start countdown before PRE_EMPTIVE_WAVE_TIMER when enemies remain", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.enemyManager.spawn("minion", 1, 0, 1);
      waveManager.queue = [];
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER - 1, null, null);
      expect(waveManager.countdownActive).toBe(false);
      expect(waveManager.countdownTimer).toBe(0);
    });

    it("starts next wave directly after PRE_EMPTIVE_WAVE_TIMER even when enemies remain", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.enemyManager.spawn("minion", 1, 0, 1);
      waveManager.queue = [];
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER + 1, null, null);
      expect(waveManager.countdownActive).toBe(false);
      expect(waveManager.currentWave).toBe(2);
      expect(waveManager.betweenWaves).toBe(false);
    });

    it("timer starts next wave with onWaveStart callback", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.queue = [];
      let startedWave: number | null = null;
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER + 1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(2);
      expect(waveManager.currentWave).toBe(2);
      expect(waveManager.countdownActive).toBe(false);
      expect(waveManager.betweenWaves).toBe(false);
    });

    it("pre-emptive advance calls onWaveCleared for the wave being left", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.enemyManager.spawn("minion", 1, 0, 1);
      waveManager.queue = [];
      let clearedWave: number | null = null;
      let startedWave: number | null = null;
      waveManager.update(
        PRE_EMPTIVE_WAVE_TIMER + 1,
        (wave) => {
          clearedWave = wave;
        },
        (wave) => {
          startedWave = wave;
        },
      );
      expect(clearedWave).toBe(1);
      expect(startedWave).toBe(2);
      expect(waveManager.currentWave).toBe(2);
    });
  });

  describe("waveComposition", () => {
    it("tracks type counts after starting a wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.waveComposition).toBeDefined();
      expect(typeof waveManager.waveComposition).toBe("object");
      // Should have at least one type
      const total = Object.values(waveManager.waveComposition).reduce((sum, value) => sum + value, 0);
      expect(total).toBeGreaterThan(0);
    });
  });

  describe("spawn state tracking", () => {
    it("initializes all spawn states as closed", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      expect(waveManager.spawnStates).toHaveLength(map.spawns.length);
      for (const state of waveManager.spawnStates) {
        expect(state.visualState).toBe("closed");
        expect(state.closeTransitionTimer).toBe(0);
      }
    });

    it("markSpawnUsed sets spawn to open", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.markSpawnUsed(0);
      expect(waveManager.spawnStates[0]!.visualState).toBe("open");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(0);
    });

    it("markSpawnUsed ignores out-of-range indices", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.markSpawnUsed(999);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
    });

    it("updateSpawnTimers decrements closeTransitionTimer", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.spawnStates[0]!.visualState = "transition";
      waveManager.spawnStates[0]!.closeTransitionTimer = 1;
      waveManager.updateSpawnTimers(0.4);
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBeCloseTo(0.6);
    });

    it("updateSpawnTimers transitions to closed when timer reaches zero", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.spawnStates[0]!.visualState = "transition";
      waveManager.spawnStates[0]!.closeTransitionTimer = 0.5;
      waveManager.updateSpawnTimers(0.6);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBeLessThanOrEqual(0);
    });

    it("updateSpawnTimers does not affect closed or open spawns", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.spawnStates[0]!.visualState = "closed";
      waveManager.spawnStates[0]!.closeTransitionTimer = 0.5;
      waveManager.spawnStates[1]!.visualState = "open";
      waveManager.spawnStates[1]!.closeTransitionTimer = 0.5;
      waveManager.updateSpawnTimers(1);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(0.5);
      expect(waveManager.spawnStates[1]!.visualState).toBe("open");
      expect(waveManager.spawnStates[1]!.closeTransitionTimer).toBe(0.5);
    });

    it("transitionActiveSpawnsToTransition sets open spawns to transition", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.markSpawnUsed(0);
      waveManager.markSpawnUsed(1);
      waveManager.saveActiveSpawns();
      waveManager.transitionActiveSpawnsToTransition();
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[1]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[2]!.visualState).toBe("closed");
    });

    it("closeAllSpawns resets tracked spawns to closed", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.markSpawnUsed(0);
      waveManager.saveActiveSpawns();
      waveManager.transitionActiveSpawnsToTransition();
      waveManager.closeAllSpawns();
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(0);
    });

    it("queue empty transitions all open spawns to transition", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.markSpawnUsed(1);
      waveManager.queue = [];
      waveManager.update(0.1, null, null);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[1]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[1]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[2]!.visualState).toBe("closed");
    });

    it("queue empty does not re-transition already-transitioning spawns", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.markSpawnUsed(1);
      waveManager.transitionSpawnToClosed(0);
      waveManager.queue = [];
      waveManager.update(0.1, null, null);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBeCloseTo(0.9);
      expect(waveManager.spawnStates[1]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[1]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[2]!.visualState).toBe("closed");
    });

    it("natural wave clear transitions open spawns to transition when queue is empty", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.queue = [];
      let waveCleared = false;
      waveManager.update(
        0.1,
        () => {
          waveCleared = true;
        },
        null,
      );
      expect(waveCleared).toBe(true);
      expect(waveManager.countdownActive).toBe(true);
      expect(waveManager.betweenWaves).toBe(true);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
    });

    it("pre-emptive wave transitions open spawns to transition when queue is empty", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.enemyManager.spawn("minion", 1, 0, 1);
      waveManager.queue = [];
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER + 1, null, null);
      expect(waveManager.currentWave).toBe(2);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
    });

    it("between-waves close transitions to closed then starts next wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.queue = [];
      waveManager.update(0.1, () => {}, null);
      // Queue was empty, so spawn transitions to "transition" immediately
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.betweenWaves).toBe(true);
      expect(waveManager.countdownActive).toBe(true);

      // Advance past both the 1s transition timer and the between-waves timer
      let startedWave: number | null = null;
      waveManager.update(BETWEEN_WAVES_TIMER + 0.1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(2);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
    });
  });
});
