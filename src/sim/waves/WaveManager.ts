import type { SpawnState } from "@/render/themes/index.js";
import { BETWEEN_WAVES_TIMER, PRE_EMPTIVE_WAVE_TIMER, VICTORY_WAVE } from "@/sim/Constants.js";
import { ENEMY_TYPES, WAVE_COUNT_BASE, WAVE_COUNT_SCALE } from "@/sim/ConstantsEnemy.js";
import { mulberry32 } from "@/sim/grid/Map.js";

interface MapRef {
  regionId: number;
  level: number;
  bossCadence: number;
  spawns: { x: number; y: number }[];
  seed: number;
}

interface EnemyManagerRef {
  enemies: unknown[];
  spawn(type: string, level: number, spawnIndex: number, wave: number): unknown;
  enqueueOrSpawn(type: string, level: number, spawnIndex: number, wave: number): void;
  releaseOnePending(spawnIndex: number): void;
  hasPendingEnemies(): boolean;
  getTotalPendingCount(): number;
  getPendingCountForSpawn(spawnIndex: number): number;
  getActiveEnemyCountForSpawn(spawnIndex: number): number;
  getEnemiesInRange(x: number, y: number, range: number): unknown[];
}

interface WaveEntry {
  type: string;
  level: number;
  delay: number;
}

export class WaveManager {
  spawnStates: SpawnState[];
  prevWaveSpawnIndices: Set<number>;
  map: MapRef;
  regionId: number;
  enemyManager: EnemyManagerRef;
  bossCadence: number;
  currentWave: number;
  maxWaves: number;
  active: boolean;
  queue: WaveEntry[];
  spawnTimer: number;
  betweenTimer: number;
  betweenWaves: boolean;
  bossesThisWave: number;
  baseReached: boolean;
  waveComposition: Record<string, number>;
  rng: () => number;
  _waveGameTime: number;
  countdownActive: boolean;
  countdownTimer: number;
  // Set by the engine while a progressive placement hold owns the clock. update
  // returns before the between-waves countdown or the next wave can start.
  advanceHeld: boolean;

  constructor(map: MapRef, enemyManager: EnemyManagerRef) {
    this.map = map;
    this.regionId = map.regionId;
    this.enemyManager = enemyManager;
    this.bossCadence = map.bossCadence;
    this.rng = mulberry32(map.seed);
    this.currentWave = 0;
    this.maxWaves = VICTORY_WAVE;
    this.active = false;
    this.queue = [];
    this.spawnTimer = 0;
    this.betweenTimer = BETWEEN_WAVES_TIMER;
    this.betweenWaves = true;
    this.bossesThisWave = 0;
    this.baseReached = false;
    this.waveComposition = {};
    this._waveGameTime = 0;
    this.countdownActive = false;
    this.countdownTimer = BETWEEN_WAVES_TIMER;
    this.advanceHeld = false;
    this.spawnStates = map.spawns.map(() => ({ visualState: "closed" as const, closeTransitionTimer: 0 }));
    this.prevWaveSpawnIndices = new Set();
  }

  markSpawnUsed(spawnIndex: number): void {
    if (spawnIndex >= 0 && spawnIndex < this.spawnStates.length) {
      this.spawnStates[spawnIndex]!.visualState = "open";
      this.spawnStates[spawnIndex]!.closeTransitionTimer = 0;
    }
  }

  updateSpawnTimers(dt: number): void {
    for (let i = 0; i < this.spawnStates.length; i++) {
      const state = this.spawnStates[i]!;
      if (state.visualState === "transition" && state.closeTransitionTimer > 0) {
        state.closeTransitionTimer -= dt;
        if (state.closeTransitionTimer <= 0) {
          state.visualState = "closed";
          state.closeTransitionTimer = 0;
        }
      }
    }
  }

  transitionSpawnToClosed(spawnIndex: number): void {
    if (spawnIndex >= 0 && spawnIndex < this.spawnStates.length) {
      const state = this.spawnStates[spawnIndex]!;
      if (state.visualState === "open") {
        state.visualState = "transition";
        state.closeTransitionTimer = 1;
      }
    }
  }

  startNextWave() {
    this.currentWave++;
    this.betweenWaves = false;
    const newQueue = this.generateWave(this.currentWave);
    this.queue.push(...newQueue);
    this.spawnTimer = 0;
    this._waveGameTime = 0;
    this.countdownActive = false;
    this.countdownTimer = 0;
    this.bossesThisWave = this.queue.filter((entry) => entry.type === "boss").length;
    this.active = true;
    this.waveComposition = this._countTypes(this.queue);
  }

  // Debug-only jump: parks the wave state as if `wave` had just cleared, so a
  // debug setWave keeps betweenWaves, countdown, and spawn states consistent
  // instead of only moving the counter. Live enemies and pending spawns are left
  // alone (killAll is the separate debug tool for those).
  debugJumpToWave(wave: number): void {
    this.queue.length = 0;
    this.currentWave = wave;
    this.betweenWaves = true;
    this.countdownActive = true;
    this.countdownTimer = BETWEEN_WAVES_TIMER;
    this.betweenTimer = BETWEEN_WAVES_TIMER;
    this.active = false;
    this.bossesThisWave = 0;
    this.baseReached = false;
    this.waveComposition = {};
    this._waveGameTime = 0;
    this.spawnTimer = 0;
    this.closeAllSpawns();
    for (const spawnState of this.spawnStates) {
      spawnState.visualState = "closed";
      spawnState.closeTransitionTimer = 0;
    }
    this.prevWaveSpawnIndices.clear();
  }

  // Count of enemies this wave will still produce: the unsent queue PLUS the
  // EnemyManager overflow backlog. Queue-only undercounted while the gameplay
  // cap held enemies back (commanders rushed on a "wave emerged" lie).
  getRemainingScheduledSpawns(): number {
    return this.queue.length + this.enemyManager.getTotalPendingCount();
  }

  saveActiveSpawns(): void {
    for (let i = 0; i < this.spawnStates.length; i++) {
      if (this.spawnStates[i]!.visualState === "open") {
        this.prevWaveSpawnIndices.add(i);
      }
    }
  }

  transitionActiveSpawnsToTransition(): void {
    for (const spawnIndex of this.prevWaveSpawnIndices) {
      const state = this.spawnStates[spawnIndex]!;
      if (state.visualState === "open") {
        state.visualState = "transition";
        state.closeTransitionTimer = 1;
      }
    }
  }

  // Keeps visual state for spawn ids that survived a layout change. New ids start
  // closed. prevWaveSpawnIndices follows the same ids so a closing animation does
  // not point at a recycled index.
  resizeSpawnStatesById(previousSpawns: Array<{ id?: number }>, nextSpawns: Array<{ id?: number }>): void {
    const previousIndexById = new Map<number, number>();
    previousSpawns.forEach((spawn, index) => {
      if (spawn.id !== undefined) previousIndexById.set(spawn.id, index);
    });
    this.spawnStates = nextSpawns.map((spawn) => {
      const previousIndex = spawn.id !== undefined ? previousIndexById.get(spawn.id) : undefined;
      if (previousIndex !== undefined && this.spawnStates[previousIndex]) return this.spawnStates[previousIndex]!;
      return { visualState: "closed" as const, closeTransitionTimer: 0 };
    });
    const nextIndexById = new Map<number, number>();
    nextSpawns.forEach((spawn, index) => {
      if (spawn.id !== undefined) nextIndexById.set(spawn.id, index);
    });
    const remapped = new Set<number>();
    for (const previousIndex of this.prevWaveSpawnIndices) {
      const spawnId = previousSpawns[previousIndex]?.id;
      if (spawnId === undefined) continue;
      const nextIndex = nextIndexById.get(spawnId);
      if (nextIndex !== undefined) remapped.add(nextIndex);
    }
    this.prevWaveSpawnIndices = remapped;
  }

  closeAllSpawns(): void {
    for (const spawnIndex of this.prevWaveSpawnIndices) {
      this.spawnStates[spawnIndex]!.visualState = "closed";
      this.spawnStates[spawnIndex]!.closeTransitionTimer = 0;
    }
    this.prevWaveSpawnIndices.clear();
  }

  _countTypes(queue: WaveEntry[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of queue) {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
    }
    return counts;
  }

  generateWave(n: number): WaveEntry[] {
    const baseCount = WAVE_COUNT_BASE + Math.floor(n * WAVE_COUNT_SCALE);
    const regionLevel = this.map.level;
    const enemyLevel = Math.max(1, Math.floor(n / 3) + regionLevel);

    let bossCount = 0;
    if (n % this.bossCadence === 0) {
      bossCount = 1 + Math.floor(n / 30);
    }

    // Render-pool size is not a gameplay balance lever; non-boss count is purely
    // driven by wave scaling. Overflow is absorbed by EnemyManager's pending queue.
    const nonBossCount = baseCount;
    const out: WaveEntry[] = [];

    for (let i = 0; i < nonBossCount; i++) {
      const rand = this.rng();
      let type = "minion";
      const tierThresholds = [
        { minWave: 16, threshold: 0.04, type: "aegis" as const },
        { minWave: 11, threshold: 0.05, type: "jet" as const },
        { minWave: 7, threshold: 0.07, type: "flyer" as const },
        { minWave: 15, threshold: 0.08, type: "healer" as const },
        { minWave: 12, threshold: 0.1, type: "shielded" as const },
        { minWave: 8, threshold: 0.1, type: "tank" as const },
        { minWave: 5, threshold: 0.08, type: "runner" as const },
      ];
      let cumulative = 0;
      for (const tier of tierThresholds) {
        cumulative += tier.threshold;
        if (n >= tier.minWave && rand < cumulative) {
          type = tier.type;
          break;
        }
      }
      out.push({ type, level: enemyLevel, delay: 0.5 + this.rng() * 0.5 });
    }

    for (let i = 0; i < bossCount; i++) {
      out.push({ type: "boss", level: enemyLevel, delay: 2 + i * 2 });
    }
    return out;
  }

  update(
    dt: number,
    onWaveCleared: ((wave: number) => void) | null,
    onWaveStart: ((wave: number) => void) | null,
    onWaveExpired: ((wave: number) => void) | null = null,
  ) {
    this.updateSpawnTimers(dt);
    if (this.advanceHeld) return;

    if (this.queue.length === 0 && !this.enemyManager.hasPendingEnemies() && this.enemyManager.enemies.length === 0) {
      for (let i = 0; i < this.spawnStates.length; i++) {
        if (this.spawnStates[i]!.visualState === "open") {
          if (
            this.enemyManager.getActiveEnemyCountForSpawn(i) === 0 &&
            this.enemyManager.getPendingCountForSpawn(i) === 0
          ) {
            this.transitionSpawnToClosed(i);
          }
        }
      }
    }

    if (this.betweenWaves) {
      this.betweenTimer -= dt;
      this.countdownTimer -= dt;
      if (this.betweenTimer <= 1) {
        this.transitionActiveSpawnsToTransition();
      }
      if (this.betweenTimer <= 0) {
        if (this.currentWave < VICTORY_WAVE) {
          this.closeAllSpawns();
          this.startNextWave();
          if (onWaveStart) onWaveStart(this.currentWave);
        }
      }
      return;
    }

    this._waveGameTime += dt;

    // Timer expiry: force next wave without clearing (enemies accumulate).
    // Routes through onWaveExpired (falling back to onWaveCleared), NOT the
    // killed path below, so a future economy change can price expiry
    // differently without touching this call site. Today expiry pays the same
    // progress rewards (milestones, best-wave, map unlock track waves survived,
    // not kills), which is why GameEngine.onWaveExpired shares that path.
    if (this._waveGameTime >= PRE_EMPTIVE_WAVE_TIMER) {
      if (this.currentWave >= VICTORY_WAVE) {
        this.betweenWaves = true;
        return;
      }
      const waveLeaving = this.currentWave;
      (onWaveExpired ?? onWaveCleared)?.(waveLeaving);
      if (this.advanceHeld) {
        this.betweenWaves = true;
        this.countdownActive = false;
        this.active = false;
        return;
      }
      this.saveActiveSpawns();
      this.transitionActiveSpawnsToTransition();
      this.startNextWave();
      if (onWaveStart) onWaveStart(this.currentWave);
      return;
    }

    // Natural wave clear: only when everything is done
    if (!this.queue.length && !this.enemyManager.hasPendingEnemies() && this.enemyManager.enemies.length === 0) {
      if (onWaveCleared) onWaveCleared(this.currentWave);
      if (this.advanceHeld) {
        this.betweenWaves = true;
        this.countdownActive = false;
        this.active = false;
        return;
      }
      if (this.currentWave >= VICTORY_WAVE) {
        this.betweenWaves = true;
      } else {
        this.saveActiveSpawns();
        this.countdownActive = true;
        this.countdownTimer = BETWEEN_WAVES_TIMER;
        this.betweenWaves = true;
        this.betweenTimer = BETWEEN_WAVES_TIMER;
      }
      return;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const next = this.queue.shift();
      if (!next || !ENEMY_TYPES[next.type]) {
        return;
      }
      // Backlog-weighted spawn choice: sample two candidates and emit at the
      // least-pending one (ties keep the first draw), so a uniform draw cannot
      // keep piling onto an already-choked spawn while others drain. Draws come
      // from the seeded wave rng, so emission stays deterministic per map seed.
      const firstCandidate = Math.floor(this.rng() * this.map.spawns.length);
      const secondCandidate = Math.floor(this.rng() * this.map.spawns.length);
      const spawnIdx =
        this.enemyManager.getPendingCountForSpawn(secondCandidate) <
        this.enemyManager.getPendingCountForSpawn(firstCandidate)
          ? secondCandidate
          : firstCandidate;
      this.markSpawnUsed(spawnIdx);
      this.enemyManager.enqueueOrSpawn(next.type, next.level, spawnIdx, this.currentWave);
      this.waveComposition[next.type] = (this.waveComposition[next.type] || 0) - 1;
      this.spawnTimer = next.delay;
    }
  }
}
