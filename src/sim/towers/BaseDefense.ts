import { getGameContent } from "@/content/gameContent.js";
import { BASE_GOLD_COST, BASE_LEVEL_HEALTH_MULT } from "@/sim/Constants.js";
import { PROJECTILE_SPEED_MULTIPLIER, UPGRADE_COST_BASE } from "@/sim/ConstantsTower.js";
import type { GameRunState } from "@/sim/GameRunState.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { SoundPlayer } from "@/sim/HostBindings.js";
import { baseDistanceRanksAhead } from "@/sim/towers/Tower.js";

export const BASE_SELECTION_ID = "base";

const BASE_LEVEL_COUNT = 7;
const LONG_RANGE_UNLOCK_LEVEL = 4;
const SENTRY_BARREL_OFFSET_RATIO = 0.22;

const baseDefenseContent = getGameContent().towers.baseDefense;
const SHORT_RANGE_TIERS = baseDefenseContent.shortRange;
const LONG_RANGE_TIERS = baseDefenseContent.longRange;
const LEVEL_SEVEN_DAMAGE_MULTIPLIER = baseDefenseContent.levelSevenDamageMultiplier;

const CORNER_OFFSETS: { deltaX: number; deltaY: number }[] = [
  { deltaX: -1, deltaY: -1 },
  { deltaX: 1, deltaY: -1 },
  { deltaX: -1, deltaY: 1 },
  { deltaX: 1, deltaY: 1 },
];

export interface BaseGunStats {
  range: number;
  damage: number;
  fireRate: number;
  projSpeed: number;
}

export interface BaseDefenseEnemy {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp?: number;
  removed?: boolean;
  flyingHeight?: number;
}

export interface BaseDefenseEnemyQuery {
  forEachEnemyInRange(x: number, y: number, range: number, callback: (enemy: BaseDefenseEnemy) => void): void;
  getEnemyById(id: number): BaseDefenseEnemy | null;
}

export interface BaseDefenseProjectileSpawn {
  spawn(opts: {
    x: number;
    y: number;
    damage: number;
    speed: number;
    range: number;
    towerType: string;
    towerLevel: number;
    targetId: number;
    targetX: number;
    targetY: number;
    color: string;
    icon: string;
    towerId: string;
    flyingDamageMult?: number;
  }): void;
}

export interface BaseSentryRuntime {
  tileX: number;
  tileY: number;
  x: number;
  y: number;
  angle: number;
  fireAnimTime: number;
  shortCooldown: number;
  longCooldown: number;
  shortTargetId: number | null;
  longTargetId: number | null;
}

type GunKind = "short" | "long";

const GUN_PRESENTATION: Record<GunKind, { color: string; sound: "shoot_basic" | "shoot_sniper" }> = {
  short: { color: "#e6c35c", sound: "shoot_basic" },
  long: { color: "#d7e4ff", sound: "shoot_sniper" },
};

function scaledGun(tier: BaseGunStats, multiplier: number): BaseGunStats {
  return { range: tier.range, damage: tier.damage * multiplier, fireRate: tier.fireRate, projSpeed: tier.projSpeed };
}

// Corner sentries and the base health pool. Not a Tower: no hit points, sell, ghost,
// nav obstacle, or shop entry. One in-run level drives both guns.
export class BaseDefense {
  level = 1;
  targeting = "first";
  totalDamageDealt = 0;
  waveDamage = 0;
  previousWaveDamage = 0;
  totalInvested = 0;
  levelOneHealth = 0;
  // Fortify multiplies the level curve. 1 until a persistent health card is picked.
  runHealthMult = 1;
  // Whole-board half of the powered buildings. The sentries sit on the base, so they
  // are never adjacent to a building and these are the only building bonuses they get.
  buildingDamageMult = 1;
  buildingFireRateMult = 1;
  buildingRangeMult = 1;
  buildingFlyingDamageMult = 1;
  readonly sentries: BaseSentryRuntime[] = [];

  private levelCosts: number[] = [];
  private readonly inRangeScratch: BaseDefenseEnemy[] = [];
  private navDistanceToBase: ((tileX: number, tileY: number, flyingHeight?: number) => number) | null = null;

  constructor(
    private readonly grid: Grid,
    private readonly runState: GameRunState,
    private readonly setEngineMax: (maxHealth: number) => void,
  ) {
    this.syncSentryPositions();
  }

  setNavDistanceToBase(callback: (tileX: number, tileY: number, flyingHeight?: number) => number): void {
    this.navDistanceToBase = callback;
  }

  // Writes into runState across the ownership boundary: the engine owns the lives pool.
  applyStartingHealth(levelOneHealth: number): void {
    this.level = 1;
    this.levelOneHealth = levelOneHealth;
    this.totalInvested = 0;
    this.levelCosts = [];
    this.totalDamageDealt = 0;
    this.waveDamage = 0;
    this.previousWaveDamage = 0;
    const maxHealth = levelOneHealth * BASE_LEVEL_HEALTH_MULT ** 0 * this.runHealthMult;
    this.runState.baseHealth = maxHealth;
    this.runState.maxBaseHealth = maxHealth;
    this.setEngineMax(maxHealth);
  }

  recomputeMaxHealth(): void {
    const newMax = this.levelOneHealth * BASE_LEVEL_HEALTH_MULT ** (this.level - 1) * this.runHealthMult;
    const ratio = this.runState.maxBaseHealth > 0 ? this.runState.baseHealth / this.runState.maxBaseHealth : 1;
    const nextHealth = Math.max(0, newMax * ratio);
    this.runState.maxBaseHealth = newMax;
    this.runState.baseHealth = nextHealth;
    this.setEngineMax(newMax);
  }

  upgradeCost(nextLevel: number): number {
    return Math.round(BASE_GOLD_COST * UPGRADE_COST_BASE ** (nextLevel - 2));
  }

  canUpgrade(maxLevel: number): { ok: boolean; cost: number; reason: string | null } {
    if (this.level >= maxLevel || this.level >= BASE_LEVEL_COUNT) {
      return { ok: false, cost: 0, reason: "Max level reached" };
    }
    return { ok: true, cost: this.upgradeCost(this.level + 1), reason: null };
  }

  doUpgrade(actualCost: number): void {
    this.level += 1;
    this.totalInvested += actualCost;
    this.levelCosts.push(actualCost);
    this.recomputeMaxHealth();
  }

  lastPaidCost(): number {
    return this.levelCosts[this.levelCosts.length - 1] ?? 0;
  }

  downgrade(): number {
    if (this.level <= 1) return 0;
    const cost = this.levelCosts.pop() ?? 0;
    this.totalInvested = Math.max(0, this.totalInvested - cost);
    this.level -= 1;
    this.recomputeMaxHealth();
    return cost;
  }

  setTargeting(mode: string): void {
    this.targeting = mode;
    for (const sentry of this.sentries) {
      sentry.shortTargetId = null;
      sentry.longTargetId = null;
    }
  }

  commitWave(): void {
    this.previousWaveDamage = this.waveDamage;
    this.waveDamage = 0;
  }

  shortGun(): BaseGunStats | null {
    if (this.level < 1) return null;
    const tier = SHORT_RANGE_TIERS[Math.min(2, this.level - 1)];
    if (!tier) return null;
    const multiplier = this.level >= BASE_LEVEL_COUNT ? LEVEL_SEVEN_DAMAGE_MULTIPLIER : 1;
    return this.applyBuildingBonus(scaledGun(tier, multiplier));
  }

  longGun(): BaseGunStats | null {
    if (this.level < LONG_RANGE_UNLOCK_LEVEL) return null;
    const tier = LONG_RANGE_TIERS[Math.min(2, this.level - LONG_RANGE_UNLOCK_LEVEL)];
    if (!tier) return null;
    const multiplier = this.level >= BASE_LEVEL_COUNT ? LEVEL_SEVEN_DAMAGE_MULTIPLIER : 1;
    return this.applyBuildingBonus(scaledGun(tier, multiplier));
  }

  private applyBuildingBonus(stats: BaseGunStats): BaseGunStats {
    return {
      range: stats.range * this.buildingRangeMult,
      damage: stats.damage * this.buildingDamageMult,
      fireRate: stats.fireRate * this.buildingFireRateMult,
      projSpeed: stats.projSpeed,
    };
  }

  update(
    dt: number,
    enemyQuery: BaseDefenseEnemyQuery,
    projectileSpawn: BaseDefenseProjectileSpawn,
    sound: SoundPlayer,
    simSeconds: number,
  ): void {
    this.syncSentryPositions();
    const shortStats = this.shortGun();
    const longStats = this.longGun();
    const tileSize = this.grid.tileSize || 36;
    for (const sentry of this.sentries) {
      if (shortStats)
        this.tickGun(sentry, shortStats, "short", dt, enemyQuery, projectileSpawn, sound, simSeconds, tileSize);
      if (longStats)
        this.tickGun(sentry, longStats, "long", dt, enemyQuery, projectileSpawn, sound, simSeconds, tileSize);
    }
  }

  private tickGun(
    sentry: BaseSentryRuntime,
    stats: BaseGunStats,
    kind: GunKind,
    dt: number,
    enemyQuery: BaseDefenseEnemyQuery,
    projectileSpawn: BaseDefenseProjectileSpawn,
    sound: SoundPlayer,
    simSeconds: number,
    tileSize: number,
  ): void {
    if (kind === "short") sentry.shortCooldown -= dt;
    else sentry.longCooldown -= dt;
    if (!(stats.fireRate > 0) || !(stats.range > 0)) return;
    const rangePx = stats.range * tileSize;
    const rangeSquared = rangePx * rangePx;
    const cachedId = kind === "short" ? sentry.shortTargetId : sentry.longTargetId;
    let target: BaseDefenseEnemy | null = null;
    if (this.targeting === "closest" && cachedId !== null) {
      const cached = enemyQuery.getEnemyById(cachedId);
      if (cached && !cached.removed) {
        const deltaX = cached.x - sentry.x;
        const deltaY = cached.y - sentry.y;
        if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) target = cached;
      }
    }
    if (!target) {
      const inRange = this.inRangeScratch;
      inRange.length = 0;
      enemyQuery.forEachEnemyInRange(sentry.x, sentry.y, rangePx, (enemy) => {
        if (!enemy.removed) inRange.push(enemy);
      });
      target = this.selectTarget(inRange, sentry.x, sentry.y);
      if (kind === "short") sentry.shortTargetId = target ? target.id : null;
      else sentry.longTargetId = target ? target.id : null;
    }
    if (!target) return;
    sentry.angle = Math.atan2(target.y - sentry.y, target.x - sentry.x);
    const cooldown = kind === "short" ? sentry.shortCooldown : sentry.longCooldown;
    if (cooldown > 0) return;
    this.fire(sentry, stats, kind, target, projectileSpawn, sound, simSeconds, tileSize);
    if (kind === "short") sentry.shortCooldown = 1 / stats.fireRate;
    else sentry.longCooldown = 1 / stats.fireRate;
  }

  private fire(
    sentry: BaseSentryRuntime,
    stats: BaseGunStats,
    kind: GunKind,
    target: BaseDefenseEnemy,
    projectileSpawn: BaseDefenseProjectileSpawn,
    sound: SoundPlayer,
    simSeconds: number,
    tileSize: number,
  ): void {
    const presentation = GUN_PRESENTATION[kind];
    const barrelOffset = tileSize * SENTRY_BARREL_OFFSET_RATIO;
    projectileSpawn.spawn({
      towerId: BASE_SELECTION_ID,
      x: sentry.x + Math.cos(sentry.angle) * barrelOffset,
      y: sentry.y + Math.sin(sentry.angle) * barrelOffset,
      damage: stats.damage,
      speed: stats.projSpeed * tileSize * PROJECTILE_SPEED_MULTIPLIER,
      range: stats.range,
      towerType: "basic",
      towerLevel: this.level,
      targetId: target.id,
      targetX: target.x,
      targetY: target.y,
      color: presentation.color,
      icon: "•",
      flyingDamageMult: this.buildingFlyingDamageMult,
    });
    sentry.fireAnimTime = simSeconds;
    sound.playSound(presentation.sound);
  }

  private selectTarget(enemies: BaseDefenseEnemy[], originX: number, originY: number): BaseDefenseEnemy | null {
    if (enemies.length === 0) return null;
    const mode = this.targeting;
    if (mode === "closest" || mode === "furthest") {
      const preferFar = mode === "furthest";
      let best = enemies[0]!;
      let bestDistance = (best.x - originX) ** 2 + (best.y - originY) ** 2;
      for (let index = 1; index < enemies.length; index++) {
        const candidate = enemies[index]!;
        const distance = (candidate.x - originX) ** 2 + (candidate.y - originY) ** 2;
        const ahead = preferFar ? distance > bestDistance : distance < bestDistance;
        if (ahead) {
          best = candidate;
          bestDistance = distance;
        }
      }
      return best;
    }
    if (mode === "strong") {
      let best = enemies[0]!;
      for (let index = 1; index < enemies.length; index++) {
        const candidate = enemies[index]!;
        const bestMax = best.maxHp ?? best.hp;
        const candidateMax = candidate.maxHp ?? candidate.hp;
        if (candidateMax > bestMax || (candidateMax === bestMax && candidate.hp > best.hp)) best = candidate;
      }
      return best;
    }
    const preferFarther = mode === "last";
    const base = this.grid.getBase();
    const baseWorld = this.grid.tileToWorld(base.x, base.y);
    let best = enemies[0]!;
    const bestTile = this.grid.worldToTile(best.x, best.y);
    const bestNav = this.navDistanceToBase?.(bestTile.x, bestTile.y, best.flyingHeight ?? 0);
    let bestNavDistance = bestNav === undefined ? -1 : bestNav;
    let bestSquaredDistance = (best.x - baseWorld.x) ** 2 + (best.y - baseWorld.y) ** 2;
    for (let index = 1; index < enemies.length; index++) {
      const candidate = enemies[index]!;
      const candidateTile = this.grid.worldToTile(candidate.x, candidate.y);
      const candidateNav = this.navDistanceToBase?.(candidateTile.x, candidateTile.y, candidate.flyingHeight ?? 0);
      const candidateNavDistance = candidateNav === undefined ? -1 : candidateNav;
      const candidateSquaredDistance = (candidate.x - baseWorld.x) ** 2 + (candidate.y - baseWorld.y) ** 2;
      if (
        baseDistanceRanksAhead(
          candidateNavDistance,
          candidateSquaredDistance,
          bestNavDistance,
          bestSquaredDistance,
          preferFarther,
        )
      ) {
        best = candidate;
        bestNavDistance = candidateNavDistance;
        bestSquaredDistance = candidateSquaredDistance;
      }
    }
    return best;
  }

  private syncSentryPositions(): void {
    const base = this.grid.getBase();
    const desired: { tileX: number; tileY: number; x: number; y: number }[] = [];
    for (const offset of CORNER_OFFSETS) {
      const tileX = base.x + offset.deltaX;
      const tileY = base.y + offset.deltaY;
      if (!this.grid.inBounds(tileX, tileY) || !this.grid.isBase(tileX, tileY)) continue;
      const world = this.grid.tileToWorld(tileX, tileY);
      desired.push({ tileX, tileY, x: world.x, y: world.y });
    }
    const sameLayout =
      desired.length === this.sentries.length &&
      desired.every(
        (entry, index) => entry.tileX === this.sentries[index]!.tileX && entry.tileY === this.sentries[index]!.tileY,
      );
    if (sameLayout) {
      for (let index = 0; index < desired.length; index++) {
        this.sentries[index]!.x = desired[index]!.x;
        this.sentries[index]!.y = desired[index]!.y;
      }
      return;
    }
    this.sentries.length = 0;
    for (const entry of desired) {
      this.sentries.push({
        tileX: entry.tileX,
        tileY: entry.tileY,
        x: entry.x,
        y: entry.y,
        angle: 0,
        fireAnimTime: 0,
        shortCooldown: 0,
        longCooldown: 0,
        shortTargetId: null,
        longTargetId: null,
      });
    }
  }
}
