import type { GameRunState } from "@/sim/GameRunState.js";
import type { PersistState } from "@/sim/PersistState.js";
import type { WaveGraphDot } from "@/sim/SimulationSnapshot.js";
import {
  WAVE_GRAPH_COLOR_BASE_HEALTH_GREEN,
  WAVE_GRAPH_COLOR_BASE_HEALTH_RED,
  WAVE_GRAPH_COLOR_BASE_HEALTH_YELLOW,
  WAVE_GRAPH_DOT_SPACING,
  WAVE_GRAPH_INTERVAL_SECONDS,
  WAVE_GRAPH_WIDTH,
} from "./Constants.js";

interface TowerManagerRef {
  towers: { totalDamageDealt: number }[];
}

interface EnemyManagerRef {
  enemies: { hp: number }[];
}

export class WaveGraphTracker {
  private runState: GameRunState;
  private persistState: PersistState;
  private towerManager: TowerManagerRef;
  private enemyManager: EnemyManagerRef;

  private _gameTimeAccum: number = 0;
  private _dots: WaveGraphDot[] = [];
  private _containerWidth: number = 0;
  private _maxDots: number = 0;
  private _prevTotalDamage: number = 0;
  private _prevGems: number = 0;
  private _intervalDamage: number = 0;
  private _intervalGold: number = 0;
  private _intervalGems: number = 0;
  private _intervalMinBaseHealth: number = 0;
  private _waveStartThisInterval: boolean = false;
  private _lastKnownWave: number = 0;
  // Bumped whenever the dots array changes shape (push or front-trim) so the
  // serializer can ship the array only on the ticks where it actually changed,
  // not every posted frame. Mirrors the grid pathVersion gating.
  private _generation: number = 0;

  constructor(
    runState: GameRunState,
    persistState: PersistState,
    towerManager: TowerManagerRef,
    enemyManager: EnemyManagerRef,
  ) {
    this.runState = runState;
    this.persistState = persistState;
    this.towerManager = towerManager;
    this.enemyManager = enemyManager;

    this._containerWidth = WAVE_GRAPH_WIDTH;
    this._maxDots = Math.ceil(this._containerWidth / WAVE_GRAPH_DOT_SPACING);
    this._prevTotalDamage = this._sumTotalDamage();
    this._prevGems = persistState.gems;
    this._intervalMinBaseHealth = runState.baseHealth;
  }

  update(dt: number): void {
    this._gameTimeAccum += dt;

    const currentGems = this.persistState.gems;
    const gemDelta = currentGems - this._prevGems;
    if (gemDelta > 0) {
      this._intervalGems += gemDelta;
    }
    this._prevGems = currentGems;

    if (this.runState.baseHealth < this._intervalMinBaseHealth) {
      this._intervalMinBaseHealth = this.runState.baseHealth;
    }

    if (this._gameTimeAccum >= WAVE_GRAPH_INTERVAL_SECONDS) {
      this._flushInterval();
    }
  }

  onGoldBounty(amount: number): void {
    this._intervalGold += amount;
  }

  onWaveStart(wave: number): void {
    if (wave !== this._lastKnownWave) {
      this._waveStartThisInterval = true;
      this._lastKnownWave = wave;
    }
  }

  setContainerWidth(width: number): void {
    this._containerWidth = width;
    const newMaxDots = Math.ceil(width / WAVE_GRAPH_DOT_SPACING);
    if (newMaxDots < this._maxDots) {
      this._dots.splice(0, this._dots.length - newMaxDots);
      // Trim changed the dot array shape; without a bump the delta serializer
      // would not ship the shortened window.
      this._generation++;
    }
    this._maxDots = newMaxDots;
  }

  // Read-only type-level view of the live dots array; callers must not mutate.
  getDots(): readonly WaveGraphDot[] {
    return this._dots;
  }

  getGeneration(): number {
    return this._generation;
  }

  dispose(): void {
    this._dots = [];
    this._generation++;
  }

  private _flushInterval(): void {
    const currentDamage = this._sumTotalDamage();
    this._intervalDamage = Math.max(0, currentDamage - this._prevTotalDamage);
    this._prevTotalDamage = currentDamage;

    const baseHealthColor = this._computeBaseHealthColor(this._intervalMinBaseHealth);
    // Enemy-HP sum is sampled once at flush time. A mid-interval peak that decays
    // before the flush is not recorded, which is acceptable for a 5s dot curve and
    // keeps per-tick update cost O(towers) instead of O(towers + enemies).
    const intervalPeakEnemyHp = this._sumEnemyHp();

    const dot: WaveGraphDot = {
      damage: Math.round(this._intervalDamage),
      peakEnemyHp: Math.round(intervalPeakEnemyHp),
      gold: Math.round(this._intervalGold),
      gems: Math.round(this._intervalGems),
      baseHealth: this._intervalMinBaseHealth,
      baseHealthColor,
      waveStart: this._waveStartThisInterval,
    };

    this._dots.push(dot);
    if (this._dots.length > this._maxDots) {
      this._dots.splice(0, this._dots.length - this._maxDots);
    }
    this._generation++;
    // Subtract one interval (not reset) so the leftover fraction keeps the dot
    // grid anchored to elapsed sim time instead of drifting by the flush frame.
    this._gameTimeAccum -= WAVE_GRAPH_INTERVAL_SECONDS;
    this._intervalDamage = 0;
    this._intervalGold = 0;
    this._intervalGems = 0;
    this._intervalMinBaseHealth = this.runState.baseHealth;
    this._waveStartThisInterval = false;
  }

  private _computeBaseHealthColor(baseHealth: number): string {
    const maxBase = this.runState.maxBaseHealth || 1;
    const ratio = maxBase > 0 ? baseHealth / maxBase : 0;
    if (ratio > 0.5) return WAVE_GRAPH_COLOR_BASE_HEALTH_GREEN;
    if (ratio > 0.25) return WAVE_GRAPH_COLOR_BASE_HEALTH_YELLOW;
    return WAVE_GRAPH_COLOR_BASE_HEALTH_RED;
  }

  private _sumTotalDamage(): number {
    let total = 0;
    for (const tower of this.towerManager.towers) {
      total += tower.totalDamageDealt;
    }
    return total;
  }

  private _sumEnemyHp(): number {
    let total = 0;
    for (const enemy of this.enemyManager.enemies) {
      total += enemy.hp;
    }
    return total;
  }
}
