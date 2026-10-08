import { getGameContent } from "@/content/gameContent.js";
import type { SpawnState } from "@/render/themes/index.js";
import type { BossAbilityId } from "@/sim/bossAbilities.js";
import { mulberry32 } from "@/sim/grid/Map.js";
import {
  enemyLevelForWave,
  progressiveEarlyWaveCount,
  progressiveEnemyLevel,
  progressiveWaveUnitCount,
  tierThresholdForWave,
  waveBossCount,
  waveUnitCount,
} from "./waveComposition.js";

const victoryWave = getGameContent().economy.victoryWave;
const betweenWavesTimer = getGameContent().economy.betweenWavesTimer;
const healerMinGap = getGameContent().enemies.healerMinGap;

interface MapRef {
  regionId: number;
  level: number;
  bossCadence: number;
  spawns: { x: number; y: number }[];
  seed: number;
  style?: string;
  entryCount?: number;
}

export interface SpawnWeightCredit {
  spawnIndex: number;
  weight: number;
  current: number;
}

// Smooth weighted round-robin. A zero-only weight list falls back to equal
// weights so a missing corridor field still emits. Lowest index wins a tie.
export function createSpawnWeightCredits(weights: readonly number[]): SpawnWeightCredit[] {
  const credits: SpawnWeightCredit[] = [];
  for (let spawnIndex = 0; spawnIndex < weights.length; spawnIndex++) {
    const weight = weights[spawnIndex] ?? 0;
    if (weight > 0) credits.push({ spawnIndex, weight, current: 0 });
  }
  if (credits.length > 0) return credits;
  for (let spawnIndex = 0; spawnIndex < weights.length; spawnIndex++) {
    credits.push({ spawnIndex, weight: 1, current: 0 });
  }
  return credits;
}

export function pickWeightedSpawn(credits: SpawnWeightCredit[]): number {
  let bestCreditIndex = 0;
  let bestCurrent = Number.NEGATIVE_INFINITY;
  let totalWeight = 0;
  for (let creditIndex = 0; creditIndex < credits.length; creditIndex++) {
    const credit = credits[creditIndex]!;
    credit.current += credit.weight;
    totalWeight += credit.weight;
    if (credit.current > bestCurrent) {
      bestCurrent = credit.current;
      bestCreditIndex = creditIndex;
    }
  }
  const picked = credits[bestCreditIndex]!;
  picked.current -= totalWeight;
  return picked.spawnIndex;
}

interface EnemyManagerRef {
  enemies: unknown[];
  spawn(type: string, level: number, spawnIndex: number, wave: number, bossAbility?: BossAbilityId): unknown;
  enqueueOrSpawn(type: string, level: number, spawnIndex: number, wave: number, bossAbility?: BossAbilityId): void;
  releaseOnePending(spawnIndex: number): void;
  hasPendingEnemies(): boolean;
  getTotalPendingCount(): number;
  getPendingCountForSpawn(spawnIndex: number): number;
  getActiveEnemyCountForSpawn(spawnIndex: number): number;
  getEnemiesInRange(x: number, y: number, range: number): unknown[];
}

export interface WaveEntry {
  type: string;
  level: number;
  delay: number;
  bossAbility?: BossAbilityId;
}

// Enemy types whose heal auras share the enemies.healerMinGap stagger discipline:
// every type here heals allies additively, so two of them in the same pack
// double the sustain the gap exists to bound.
const healerTypes: readonly string[] = ["healer", "mender"];

export function isHealerType(type: string): boolean {
  return healerTypes.includes(type);
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
  // Stamps boss abilities onto a wave's entries the moment they are generated.
  // Stamping at generation (not at wave start) is what keeps every caller of
  // startNextWave covered, including the debug tools that bypass onWaveStart.
  bossAbilityStamper: ((entries: WaveEntry[], waveNumber: number) => void) | null = null;
  // Corridor tile distance from a spawn to the base. Absent means equal weights.
  // Installed by the engine from the through-field, which walks the path and
  // treats blocking towers as traversable.
  spawnCorridorTiles: ((spawnIndex: number) => number) | null = null;
  private spawnWeightCredits: SpawnWeightCredit[] | null = null;

  constructor(map: MapRef, enemyManager: EnemyManagerRef) {
    this.map = map;
    this.regionId = map.regionId;
    this.enemyManager = enemyManager;
    this.bossCadence = map.bossCadence;
    this.rng = mulberry32(map.seed);
    this.currentWave = 0;
    this.maxWaves = victoryWave;
    this.active = false;
    this.queue = [];
    this.spawnTimer = 0;
    this.betweenTimer = betweenWavesTimer;
    this.betweenWaves = true;
    this.bossesThisWave = 0;
    this.baseReached = false;
    this.waveComposition = {};
    this._waveGameTime = 0;
    this.countdownActive = false;
    this.countdownTimer = betweenWavesTimer;
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
    this.bossAbilityStamper?.(newQueue, this.currentWave);
    this.queue.push(...newQueue);
    if (this.map.style === "progressive") this.spawnWeightCredits = createSpawnWeightCredits(this.corridorWeights());
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
    this.countdownTimer = betweenWavesTimer;
    this.betweenTimer = betweenWavesTimer;
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
    const progressive = this.map.style === "progressive";
    const baseCount = progressive
      ? progressiveWaveUnitCount(n, this.map.level, this.map.entryCount ?? 1)
      : waveUnitCount(n);
    const enemyLevel = progressive ? progressiveEnemyLevel(n, this.map.level) : enemyLevelForWave(n, this.map.level);
    const bossCount = progressive && n <= progressiveEarlyWaveCount ? 0 : waveBossCount(n, this.bossCadence);

    // Render-pool size is not a gameplay balance lever; non-boss count is purely
    // driven by wave scaling. Overflow is absorbed by EnemyManager's pending queue.
    const nonBossCount = baseCount;
    const out: WaveEntry[] = [];

    // Healers and menders share one rate limit so their additive heal auras
    // cannot stack into an unkillable pack: a healer-type drawn with fewer
    // than enemies.healerMinGap enemies since the last one goes to healerBacklog,
    // this slot is refilled by a re-roll that excludes both healer types, and
    // the backlog is emitted (oldest first) once the gap is satisfied again.
    // sinceLastHealer starts at the full gap so the wave's first healer-type
    // is not delayed. Leftover backlog at the end of the wave is intentionally
    // discarded: those slots were already filled by other enemies and the wave
    // reached maximum healer density.
    const healerBacklog: string[] = [];
    let sinceLastHealer = healerMinGap;
    for (let i = 0; i < nonBossCount; i++) {
      let type: string;
      if (healerBacklog.length > 0 && sinceLastHealer >= healerMinGap) {
        type = healerBacklog.shift()!;
      } else {
        type = this.rollType(n);
        if (isHealerType(type) && sinceLastHealer < healerMinGap) {
          healerBacklog.push(type);
          type = this.rollType(n, healerTypes);
        }
      }
      out.push({ type, level: enemyLevel, delay: 0.5 + this.rng() * 0.5 });
      sinceLastHealer = isHealerType(type) ? 0 : sinceLastHealer + 1;
    }

    for (let i = 0; i < bossCount; i++) {
      out.push({ type: "boss", level: enemyLevel, delay: 2 + i * 2 });
    }
    return out;
  }

  private rollType(wave: number, excludeTypes: readonly string[] = []): string {
    // excludeTypes drops tiers from the cumulative bands so a healer re-roll
    // always yields another type instead of re-looping on healer-types.
    const excluded = new Set(excludeTypes);
    const rand = this.rng();
    let cumulative = 0;
    for (const tier of getGameContent().enemies.tierThresholds) {
      if (excluded.has(tier.type)) continue;
      if (wave < tier.minWave) {
        // Flat bands keep their dead mass while locked, which is what preserves
        // the historical distribution: a roll that lands in that mass falls
        // through to a later unlocked band, so the mass steers draws toward the
        // last band the wave has unlocked rather than the first. Ramped bands
        // contribute nothing until their debut instead, so an intro cannot
        // reshape the waves before it.
        if (tier.rampPerWave) continue;
        cumulative += tier.threshold;
        continue;
      }
      cumulative += tierThresholdForWave(tier, wave);
      if (rand < cumulative) {
        return tier.type;
      }
    }
    // Past wave 85 the bands' total mass exceeds 1 (see tierThresholdForWave),
    // so the minion is unreachable from here on.
    return "minion";
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
        if (this.currentWave < victoryWave) {
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
    if (this._waveGameTime >= getGameContent().economy.preEmptiveWaveTimer) {
      if (this.currentWave >= victoryWave) {
        // Same wave-end notification as the branch below, minus startNextWave.
        // Dropping it here left economy.victoryWave unrewarded: GameEngine.update ends
        // the run once this parks betweenWaves with an empty field, so without
        // the callback the victory wave never reached applyWaveProgressRewards
        // and the map's best wave froze at economy.victoryWave - 1.
        (onWaveExpired ?? onWaveCleared)?.(this.currentWave);
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
      if (this.currentWave >= victoryWave) {
        this.betweenWaves = true;
      } else {
        this.saveActiveSpawns();
        this.countdownActive = true;
        this.countdownTimer = betweenWavesTimer;
        this.betweenWaves = true;
        this.betweenTimer = betweenWavesTimer;
      }
      return;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const next = this.queue.shift();
      if (!next || !getGameContent().enemies.types[next.type]) {
        return;
      }
      // Progressive lanes emit in corridor-length order: twice as far, twice as
      // many, spread by smooth weighted round-robin. Catalog maps keep the
      // backlog-weighted two-candidate draw, seeded so a map stays deterministic.
      const spawnIdx =
        this.map.style === "progressive" && this.spawnWeightCredits && this.spawnWeightCredits.length > 0
          ? pickWeightedSpawn(this.spawnWeightCredits)
          : this.pickBacklogSpawn();
      this.markSpawnUsed(spawnIdx);
      this.enemyManager.enqueueOrSpawn(next.type, next.level, spawnIdx, this.currentWave, next.bossAbility);
      this.waveComposition[next.type] = (this.waveComposition[next.type] || 0) - 1;
      this.spawnTimer = next.delay;
    }
  }

  private corridorWeights(): number[] {
    const weights: number[] = [];
    for (let spawnIndex = 0; spawnIndex < this.map.spawns.length; spawnIndex++) {
      const distance = this.spawnCorridorTiles?.(spawnIndex) ?? 0;
      weights.push(distance > 0 ? distance : 0);
    }
    return weights;
  }

  private pickBacklogSpawn(): number {
    const firstCandidate = Math.floor(this.rng() * this.map.spawns.length);
    const secondCandidate = Math.floor(this.rng() * this.map.spawns.length);
    return this.enemyManager.getPendingCountForSpawn(secondCandidate) <
      this.enemyManager.getPendingCountForSpawn(firstCandidate)
      ? secondCandidate
      : firstCandidate;
  }
}
