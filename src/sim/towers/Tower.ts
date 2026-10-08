import type { Enemy } from "@/sim/enemies/Enemy.js";

interface AuraTarget {
  flyingHeight?: number;
  applySlow(amount: number, duration: number): void;
  applyStun?(duration: number): void;
  takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
}

import type { MapThemeAnimation, MapThemeData, TowerVisualMeta } from "@/render/themes/index.js";
import {
  MILESTONE_BONUS_PCT,
  MILESTONE_THRESHOLD_PER_LEVEL_SQUARED,
  TERRAIN_HEIGHT_BONUS_PCT,
  TERRAIN_HEIGHT_RANGE_BONUS,
} from "@/sim/Constants.js";
import {
  CANCEL_BUILD_WINDOW_MS,
  CHARGE_SHOT_COUNT,
  CHARGE_SHOT_MULT,
  ELECTRIC_FENCE_INTERVAL,
  ELECTRIC_FENCE_RANGE_TILES,
  GHOST_RESTORE_BASE_SECONDS,
  GHOST_RESTORE_MIN_SECONDS,
  GHOST_RESTORE_PER_LEVEL,
  ICE_AURA_DURATION,
  ICE_AURA_RANGE,
  ICE_AURA_SLOW_MULT,
  ICE_BURST_INTERVAL,
  ICE_BURST_RANGE,
  ICE_BURST_STUN_DURATION,
  MILESTONE_MAX_TIERS,
  PROJECTILE_SPEED_MULTIPLIER,
  SELL_VALUE_RATIO,
  STATIC_FIELD_RANGE,
  STATIC_FIELD_SLOW_AMT,
  STATIC_FIELD_SLOW_DUR,
  TERRAIN_DAMAGE_BONUS_MAX_MULT,
  TOWER_ADDON_EFFECTS,
  TOWER_BASE,
  TOWER_META,
  type TowerId,
  type TowerMeta,
  UPGRADE_COST_BASE,
} from "@/sim/ConstantsTower.js";
import type { SoundPlayer } from "@/sim/HostBindings.js";
import type { PersistState } from "@/sim/PersistState.js";
import { createDefaultPersistState } from "@/sim/PersistState.js";
import {
  computeTowerCoreStats,
  computeTowerMaxHealth,
  resolveEffectiveBase,
  type TowerBaseConfig,
} from "@/sim/towers/towerCoreStats.js";
import { getGeneralAddonValue, maxLevelFor } from "./SkillTree.js";
import { damageAgainstFlying } from "./towerFlyingDamage.js";

interface GridRef {
  tileSize: number;
  tiles?: { type: string; height: number }[][];
  getBase(): { x: number; y: number };
  tileToWorld(tx: number, ty: number): { x: number; y: number };
  worldToTile(wx: number, wy: number): { x: number; y: number };
  clearTowerGhost(x: number, y: number): void;
}

// Fixed-aim barrels look along one of four world directions. Module constant so
// the vector table is not rebuilt per fixed-aim tower per tick.
const FIXED_AIM_DIRECTION_VECTORS: Record<"N" | "E" | "S" | "W", [number, number]> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
};

// Same ordering as the old distToBase comparison in selectTarget: nav tile
// distance when both sides have one, squared Euclidean when neither does, raw
// numbers in the mixed case. True when the candidate strictly outranks the
// best, preserving the reduce tie-break where equal distances keep the earlier
// enemy. Module-level (not a method) so Tower stays structurally assignable.
export function baseDistanceRanksAhead(
  candidateNavDistance: number,
  candidateSquaredDistance: number,
  bestNavDistance: number,
  bestSquaredDistance: number,
  preferFarther: boolean,
): boolean {
  let comparison: number;
  if (candidateNavDistance >= 0 && bestNavDistance >= 0) {
    comparison = candidateNavDistance - bestNavDistance;
  } else if (candidateNavDistance < 0 && bestNavDistance < 0) {
    comparison = candidateSquaredDistance - bestSquaredDistance;
  } else if (candidateNavDistance >= 0) {
    comparison = candidateNavDistance - Math.sqrt(bestSquaredDistance);
  } else {
    comparison = Math.sqrt(candidateSquaredDistance) - bestNavDistance;
  }
  return preferFarther ? comparison > 0 : comparison < 0;
}

interface EnemyManagerRef {
  enemies: {
    x: number;
    y: number;
    removed: boolean;
    maxHp: number;
    hp: number;
    id: number;
    flyingHeight?: number;
    applySlow(amount: number, duration: number): void;
    applyStun?(duration: number): void;
    takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
  }[];
  getEnemiesInRange(
    x: number,
    y: number,
    range: number,
  ): {
    x: number;
    y: number;
    removed: boolean;
    maxHp: number;
    hp: number;
    id: number;
    flyingHeight?: number;
    applySlow(amount: number, duration: number): void;
    applyStun?(duration: number): void;
    takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
  }[];
  forEachEnemyInRange(
    x: number,
    y: number,
    range: number,
    cb: (enemy: {
      x: number;
      y: number;
      removed: boolean;
      maxHp: number;
      hp: number;
      id: number;
      flyingHeight?: number;
      applySlow(amount: number, duration: number): void;
      applyStun?(duration: number): void;
      takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
    }) => void,
  ): void;
  getEnemyById(
    id: number,
  ): { id: number; removed: boolean; x: number; y: number; hp: number; flyingHeight?: number } | null;
  towerAt(x: number, y: number): Tower | null;
  forEachSensorHits?(
    sensorId: string,
    callback: (enemy: {
      applySlow(amount: number, duration: number): void;
      applyStun?(duration: number): void;
      takeDamage(amount: number, armorPiercing?: boolean): number | undefined;
    }) => void,
  ): boolean;
}

interface ProjectileManagerRef {
  spawn(opts: {
    x: number;
    y: number;
    damage: number;
    speed: number;
    range: number;
    towerType: string;
    towerLevel: number;
    targetId: number;
    targetX?: number;
    targetY?: number;
    color?: string;
    icon?: string;
    slowAmt?: number;
    slowDur?: number;
    towerId?: string;
    napalm?: boolean;
    marksman?: boolean;
    knockbackBase?: number;
    knockbackScale?: number;
    variant?: "A" | "B" | null;
    critChance?: number;
    goldOnCrit?: number;
    bounceShot?: boolean;
    splashStun?: number;
    groundOnly?: boolean;
    armorPiercing?: boolean;
    trueShot?: number;
    markTarget?: number;
    antiHeal?: boolean;
    pierce?: number;
    pierceFalloff?: number;
    stunDur?: number;
    splash?: number;
    flyingDamageMult?: number;
    cacheId?: number;
  }): void;
  fireLightning(opts: {
    originX: number;
    originY: number;
    damage: number;
    towerLevel: number;
    targetId: number;
    stunDuration: number;
    towerId?: string;
    doubleDischarge?: number;
    burnCircuit?: boolean;
    critChance?: number;
    goldOnCrit?: number;
    range?: number;
    chain?: number;
    stormcall?: boolean;
    color?: string;
    flyingDamageMult?: number;
  }): void;
}

interface TowerStats {
  range: number;
  damage: number;
  fireRate: number;
  splash: number;
  chain: number;
  stun: number;
  pierce: number;
  pierceFalloff: number;
  slowAmt: number;
  slowDur: number;
  marksman: boolean;
  napalm: boolean;
  stormcall: boolean;
  knockbackBase: number;
  knockbackScale: number;
  thornReflectPct: number;
  fenceDamage: number;
  fenceStun: number;
  healthMult: number;
  armorPiercing: boolean;
  groundOnly: boolean;
  // Damage taken by a flying target, read per shot rather than folded into
  // `damage`: the same shot hits a ground enemy at the base value.
  flyingDamageMult: number;
  // Addon-driven stat modifiers
  critChance: number;
  goldOnCrit: number;
  bounceShot: boolean;
  frostAura: boolean;
  staticField: boolean;
  iceBurst: boolean;
  splashStun: number;
  doubleDischarge: number;
  burnCircuit: boolean;
  trueShot: number;
  markTarget: number;
  chargeShot: boolean;
  antiHeal: boolean;
}

interface CanUpgradeResult {
  ok: boolean;
  cost?: number;
  nextLevel?: number;
  reason?: string;
  needVariant?: boolean;
}

interface CacheShotTarget {
  id: number;
  x: number;
  y: number;
}

function nearestCache(
  originX: number,
  originY: number,
  rangeSquared: number,
  caches: readonly CacheShotTarget[],
  aim?: { x: number; y: number },
): CacheShotTarget | null {
  let best: CacheShotTarget | null = null;
  let bestDistance = rangeSquared;
  for (const cache of caches) {
    const deltaX = cache.x - originX;
    const deltaY = cache.y - originY;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared === 0 || distanceSquared > bestDistance) continue;
    if (aim) {
      const distance = Math.sqrt(distanceSquared);
      const dot = (deltaX / distance) * aim.x + (deltaY / distance) * aim.y;
      if (dot <= 0.5) continue;
    }
    bestDistance = distanceSquared;
    best = cache;
  }
  return best;
}

export class Tower {
  type: string;
  id: string;
  tileX: number;
  tileY: number;
  grid: GridRef;
  x: number;
  y: number;
  meta: TowerMeta;
  base: TowerBaseConfig;
  color: string;
  icon: string;
  name: string;
  animation: MapThemeAnimation | null;
  visualMeta: TowerVisualMeta | null;
  theme: MapThemeData | null;
  level: number;
  totalInvested: number;
  levelCosts: number[];
  totalDamageDealt: number;
  waveDamage: number;
  targeting: string;
  cooldown: number;
  angle: number;
  fireAnimTime: number;
  _gameSeconds: number = 0;
  variant: "A" | "B" | null;
  fixedAimDir: "N" | "E" | "S" | "W" | null;
  placedAt: number;
  addons: number[];
  save: PersistState | undefined;
  _statsCache: TowerStats | null;
  _statsCacheKey: string;
  // Per-update stats snapshot for the aura callbacks. update() assigns it once;
  // callbacks then read it instead of hitting the stats getter per enemy per tick
  // (which recomputes when save == null and is not free even when cached).
  // Optional-by-design: a required private member would break structural
  // assignability of Pinia's unwrapped store state to Tower.
  private frameStats?: TowerStats;
  // Reused scan target list for update()'s standard targeting path.
  private inRangeScratch?: { x: number; y: number; hp: number; maxHp?: number; id: number; flyingHeight?: number }[];
  terrainHeight: number;
  chargeShotCount: number;
  iceBurstTimer: number;
  fenceTimer: number;
  cachedTargetId: number | null;
  maxHealth: number;
  health: number;
  isGhost: boolean;
  ghostTimer: number;
  pendingGhostEffect: boolean;
  pendingRestoreEffect: boolean;
  // A corner body's radius overlaps the adjacent terrain cuboid. That tower is
  // not a path block, so the overlap must not damage it or count as a siege.
  enemyAttackImmune: boolean = false;
  // Run cards and adjacent map buildings. 1 until GameEngine.refreshAllTowerBonuses.
  // Crowd and combat read the product inside _computeStats; armor is incoming only.
  runDamageMult = 1;
  runFireRateMult = 1;
  runHealthMult = 1;
  runRangeMult = 1;
  runSlowMult = 1;
  siteDamageMult = 1;
  siteFireRateMult = 1;
  siteRangeMult = 1;
  siteFlyingDamageMult = 1;
  incomingDamageMult = 1;
  // Tile nav-distance to base (−1 unreachable). Null → Euclidean fallback.
  navDistanceToBase: ((tileX: number, tileY: number, flyingHeight?: number) => number) | null = null;

  private applyFrostAura?: (enemy: AuraTarget) => void = (enemy: AuraTarget): void => {
    const slowAmt = (this.frameStats ?? this.stats).slowAmt;
    enemy.applySlow(slowAmt * ICE_AURA_SLOW_MULT, ICE_AURA_DURATION);
  };
  private applyStaticField?: (enemy: AuraTarget) => void = (enemy: AuraTarget): void => {
    enemy.applySlow(STATIC_FIELD_SLOW_AMT, STATIC_FIELD_SLOW_DUR);
  };
  private applyIceBurst?: (enemy: AuraTarget) => void = (enemy: AuraTarget): void => {
    if (enemy.applyStun) enemy.applyStun(ICE_BURST_STUN_DURATION);
  };
  private applyElectricFence?: (enemy: AuraTarget) => void = (enemy: AuraTarget): void => {
    const stats = this.frameStats ?? this.stats;
    if (stats.groundOnly && (enemy.flyingHeight ?? 0) > 0) return;
    const fenceDamage = damageAgainstFlying(stats.fenceDamage, stats.flyingDamageMult, enemy.flyingHeight);
    const dealtDamage = enemy.takeDamage(fenceDamage) ?? fenceDamage;
    this.creditDamage(dealtDamage);
    if (enemy.applyStun) enemy.applyStun(stats.fenceStun);
  };

  constructor(
    type: string,
    tileX: number,
    tileY: number,
    save: PersistState | undefined,
    grid: GridRef,
    theme: MapThemeData | null = null,
    defaultVisual: TowerVisualMeta | null = null,
    placedAt: number = Date.now(),
    paidCost?: number,
  ) {
    this.type = type;
    this.id = "";
    this.tileX = tileX;
    this.tileY = tileY;
    this.grid = grid;
    const center = grid.tileToWorld(tileX, tileY);
    this.x = center.x;
    this.y = center.y;
    const towerId = type as TowerId;
    this.meta = TOWER_META[towerId]!;
    this.base = TOWER_BASE[towerId]!;
    this.theme = theme;
    const towerVisual = (theme?.towers[type] ?? null) as TowerVisualMeta | null;
    this.color = towerVisual?.color || defaultVisual?.color || "#8fbc8f";
    this.icon = towerVisual?.icon || defaultVisual?.icon || "\u2500";
    this.name = towerVisual?.name || defaultVisual?.name || type;
    this.animation = towerVisual?.animation || null;
    this.visualMeta = towerVisual;

    this.level = 1;
    const buildCost = paidCost ?? this.meta.cost;
    this.totalInvested = buildCost;
    this.levelCosts = [buildCost];
    this.totalDamageDealt = 0;
    this.waveDamage = 0;
    this.targeting = type === "sniper" ? "strong" : "first";
    this.cooldown = 0;
    this.angle = -Math.PI / 4;
    this.fireAnimTime = 0;
    this._gameSeconds = 0;
    this.variant = null;
    this.fixedAimDir = null;
    this.placedAt = placedAt;
    this.addons = save?.unlocked[type]
      ? save.unlocked[type].addons.map((unlocked, i) => (unlocked ? i : null)).filter((x) => x !== null)
      : [];
    this.save = save;
    this._statsCache = null;
    this._statsCacheKey = "";
    this.chargeShotCount = 0;
    this.iceBurstTimer = 0;
    this.fenceTimer = 0;
    this.cachedTargetId = null;
    this.isGhost = false;
    this.ghostTimer = 0;
    this.pendingGhostEffect = false;
    this.pendingRestoreEffect = false;
    const placedTile = grid?.tiles?.[tileY]?.[tileX];
    if (placedTile) {
      this.terrainHeight = placedTile.height || 1;
      this.enemyAttackImmune = placedTile.type === "terrain";
    } else {
      this.terrainHeight = 1;
      this.enemyAttackImmune = false;
    }
    this.maxHealth = this.computeMaxHealth();
    this.health = this.maxHealth;
  }

  get stats(): TowerStats {
    if (!this.save) {
      return this._computeStats();
    }
    const key = this._computeCacheKey();
    if (this._statsCache && this._statsCacheKey === key) {
      return this._statsCache;
    }

    const stats = this._computeStats();
    this._statsCache = stats;
    this._statsCacheKey = key;
    return stats;
  }

  _computeCacheKey(): string {
    const heightTier = getGeneralAddonValue(this.save!, "terrainHeightBonus");
    const rangeTier = getGeneralAddonValue(this.save!, "terrainHeightRangeBonus");
    const milestoneTier = getGeneralAddonValue(this.save!, "damageMilestoneBonus");
    const milestoneLevels =
      typeof milestoneTier === "number"
        ? Math.min(MILESTONE_MAX_TIERS, Math.floor(this.totalDamageDealt / this.currentMilestoneThreshold()))
        : -1;
    const h = typeof heightTier === "number" ? heightTier : -1;
    const r = typeof rangeTier === "number" ? rangeTier : -1;
    const m = typeof milestoneTier === "number" ? milestoneTier : -1;
    // addons are fixed at construction today; joining them keeps the key correct
    // if addon membership ever becomes runtime-mutable, at negligible cost.
    return `${h}|${r}|${m}|${milestoneLevels}|${this.level}|${this.variant ?? ""}|${this.addons.join(",")}|${this.runDamageMult}|${this.runFireRateMult}|${this.runHealthMult}|${this.runRangeMult}|${this.runSlowMult}|${this.siteDamageMult}|${this.siteFireRateMult}|${this.siteRangeMult}|${this.siteFlyingDamageMult}`;
  }

  clearStatsCache(): void {
    this._statsCache = null;
  }

  _computeStats(): TowerStats {
    const level = this.level;
    const core = computeTowerCoreStats(this.base, this.type as TowerId, level, this.variant);
    let range = core.range;
    let damage = core.damage;
    let fireRate = core.fireRate;
    let splash = core.splash;
    let chain = core.chain;
    let stun = core.stun;
    let pierce = core.pierce;
    const pierceFalloff = core.pierceFalloff;
    let slowAmt = core.slowAmt;
    const slowDur = core.slowDur;
    const marksman = core.marksman;
    const napalm = core.napalm;
    const stormcall = core.stormcall;
    const knockbackBase = core.knockbackBase;
    const knockbackScale = core.knockbackScale;
    const thornReflectPct = core.thornReflectPct;
    const fenceDamage = core.fenceDamage;
    const fenceStun = core.fenceStun;
    let healthMult = core.healthMult;
    let armorPiercing = core.armorPiercing;
    let groundOnly = core.groundOnly;

    // Apply data-driven addon effects
    const addonEffects = TOWER_ADDON_EFFECTS[this.type as TowerId];
    if (addonEffects) {
      for (const addonIdx of this.addons) {
        const effect = addonEffects[addonIdx];
        if (!effect) continue;
        if (effect.damageMult != null) damage *= effect.damageMult;
        if (effect.splashMult != null) splash *= effect.splashMult;
        if (effect.slowMult != null) slowAmt *= effect.slowMult;
        if (effect.rangeAdd != null) range += effect.rangeAdd;
        if (effect.chainAdd != null) chain += effect.chainAdd;
        if (effect.stunAdd != null) stun += effect.stunAdd;
        if (effect.pierceAdd != null) pierce += effect.pierceAdd;
        if (effect.healthMult != null) healthMult *= effect.healthMult;
        if (effect.fireRateMult != null) fireRate *= effect.fireRateMult;
        if (effect.armorPiercing) armorPiercing = true;
        if (effect.antiAir) groundOnly = false;
      }
    }

    const heightTier = this.save ? getGeneralAddonValue(this.save, "terrainHeightBonus") : null;
    if (typeof heightTier === "number") {
      const bonusPct = TERRAIN_HEIGHT_BONUS_PCT[heightTier] || 0;
      const heightBonus = Math.min(TERRAIN_DAMAGE_BONUS_MAX_MULT, 1 + bonusPct * this.terrainHeight);
      damage *= heightBonus;
    }

    const rangeTier = this.save ? getGeneralAddonValue(this.save, "terrainHeightRangeBonus") : null;
    if (typeof rangeTier === "number") {
      const bonusPerHeight = TERRAIN_HEIGHT_RANGE_BONUS[rangeTier] || 0;
      range += bonusPerHeight * this.terrainHeight;
    }

    const milestoneTier = this.save ? getGeneralAddonValue(this.save, "damageMilestoneBonus") : null;
    if (typeof milestoneTier === "number") {
      const milestoneThreshold = this.currentMilestoneThreshold();
      const tiers = Math.min(MILESTONE_MAX_TIERS, Math.floor(this.totalDamageDealt / milestoneThreshold));
      const [dmgPct, speedPct] = MILESTONE_BONUS_PCT[milestoneTier] || [0, 0];
      damage *= 1 + dmgPct * tiers;
      fireRate *= 1 + speedPct * tiers;
    }

    // Collect behavior flags from addon effects
    let critChance = 0;
    let goldOnCrit = 0;
    let bounceShot = false;
    let frostAura = false;
    let staticField = false;
    let iceBurst = false;
    let splashStun = 0;
    let doubleDischarge = 0;
    let burnCircuit = false;
    let trueShot = 0;
    let markTarget = 0;
    let chargeShot = false;
    let antiHeal = false;

    if (addonEffects) {
      for (const addonIdx of this.addons) {
        const effect = addonEffects[addonIdx];
        if (!effect) continue;
        if (effect.critChance != null) critChance = effect.critChance;
        if (effect.goldOnCrit != null) goldOnCrit = effect.goldOnCrit;
        if (effect.bounceShot) bounceShot = true;
        if (effect.frostAura) frostAura = true;
        if (effect.staticField) staticField = true;
        if (effect.iceBurst) iceBurst = true;
        if (effect.splashStun != null) splashStun = effect.splashStun;
        if (effect.doubleDischarge != null) doubleDischarge = effect.doubleDischarge;
        if (effect.burnCircuit) burnCircuit = true;
        if (effect.trueShot != null) trueShot = effect.trueShot;
        if (effect.markTarget != null) markTarget = effect.markTarget;
        if (effect.chargeShot) chargeShot = true;
        if (effect.antiHeal) antiHeal = true;
      }
    }

    damage *= this.runDamageMult * this.siteDamageMult;
    fireRate *= this.runFireRateMult * this.siteFireRateMult;
    range *= this.runRangeMult * this.siteRangeMult;
    healthMult *= this.runHealthMult;
    slowAmt *= this.runSlowMult;
    const slowedDuration = slowDur * this.runSlowMult;

    return {
      range,
      damage,
      fireRate,
      splash,
      chain,
      stun,
      pierce,
      pierceFalloff,
      slowAmt,
      slowDur: slowedDuration,
      marksman,
      napalm,
      stormcall,
      knockbackBase,
      knockbackScale,
      thornReflectPct,
      fenceDamage,
      fenceStun,
      healthMult,
      armorPiercing,
      groundOnly,
      flyingDamageMult: this.siteFlyingDamageMult,
      critChance,
      goldOnCrit,
      bounceShot,
      frostAura,
      staticField,
      iceBurst,
      splashStun,
      doubleDischarge,
      burnCircuit,
      trueShot,
      markTarget,
      chargeShot,
      antiHeal,
    };
  }

  currentMilestoneThreshold(): number {
    return this.level * this.level * MILESTONE_THRESHOLD_PER_LEVEL_SQUARED;
  }

  currentMilestoneBonus() {
    const threshold = this.currentMilestoneThreshold();
    if (!this.save) return { damagePct: 0, speedPct: 0, tiers: 0, threshold };
    const tier = getGeneralAddonValue(this.save, "damageMilestoneBonus");
    if (typeof tier !== "number") return { damagePct: 0, speedPct: 0, tiers: 0, threshold };
    const tiers = Math.min(MILESTONE_MAX_TIERS, Math.floor(this.totalDamageDealt / threshold));
    const [dmgPct, speedPct] = MILESTONE_BONUS_PCT[tier] || [0, 0];
    return { damagePct: dmgPct * tiers * 100, speedPct: speedPct * tiers * 100, tiers, threshold };
  }

  upgradeCost(nextLevel: number): number {
    return Math.round(this.meta.cost * UPGRADE_COST_BASE ** (nextLevel - 2));
  }

  canUpgrade(save: PersistState | undefined): CanUpgradeResult {
    if (this.isGhost) return { ok: false, reason: "Ghosted — cannot upgrade" };
    const cost = this.upgradeCost(this.level + 1);
    if (this.level === 4 && this.variant === null) {
      return { ok: false, reason: "Choose specialization", needVariant: true };
    }
    const effectiveSave = save ?? createDefaultPersistState();
    const maxLvl = maxLevelFor(effectiveSave, this.type, this.variant);
    if (this.level >= maxLvl) return { ok: false, reason: "Max level reached" };
    return { ok: true, cost, nextLevel: this.level + 1 };
  }

  specialize(variant: "A" | "B", save: PersistState, actualCost?: number): boolean {
    if (this.isGhost) return false;
    if (this.level !== 4) return false;
    const unlocked = save.unlocked[this.type];
    if (!unlocked) return false;
    const arr =
      variant === "A"
        ? (unlocked as { variantA: boolean[]; variantB: boolean[] }).variantA
        : (unlocked as { variantA: boolean[]; variantB: boolean[] }).variantB;
    if (!arr[0]) return false;
    this.variant = variant;
    this.level = 5;
    const cost = actualCost ?? this.upgradeCost(5);
    this.totalInvested += cost;
    this.levelCosts.push(cost);
    this.clearStatsCache();
    this.recomputeMaxHealth();
    return true;
  }

  doUpgrade(save: PersistState, actualCost?: number): CanUpgradeResult {
    const check = this.canUpgrade(save);
    if (!check.ok) return check;
    this.level++;
    const cost = actualCost ?? check.cost ?? 0;
    this.totalInvested += cost;
    this.levelCosts.push(cost);
    this.clearStatsCache();
    this.recomputeMaxHealth();
    return { ok: true };
  }

  sellValue(): number {
    if (this.isGhost) return 0;
    return Math.round(this.totalInvested * SELL_VALUE_RATIO);
  }

  canModify(): boolean {
    return !this.isGhost;
  }

  // Central credit point for damage this tower deals outside the projectile
  // pipeline (electric fence, thorn reflect). Mirrors ProjectileManager.recordDamage:
  // the stats cache key encodes totalDamageDealt, so milestones recompute lazily.
  // Public (not private): required private members break structural assignability
  // of Pinia's unwrapped store state to Tower.
  creditDamage(amount: number): void {
    if (!(amount > 0)) return;
    this.totalDamageDealt += amount;
    this.waveDamage += amount;
  }

  takeDamage(amount: number, attacker?: Enemy): void {
    if (this.enemyAttackImmune) return;
    applyIncomingDamage(this, amount, attacker);
  }

  // Terrain placement grants enemyAttackImmune against contact attacks. A boss
  // Bombard is a targeted siege hit that has to reach those towers, so it uses
  // this path and deliberately skips the immunity check.
  takeAbilityDamage(amount: number, attacker?: Enemy): void {
    applyIncomingDamage(this, amount, attacker);
  }

  restore(): void {
    this.isGhost = false;
    this.health = this.maxHealth;
    this.ghostTimer = 0;
    this.grid.clearTowerGhost(this.tileX, this.tileY);
    // Crosses into the engine: a restored tower re-powers the building it stands
    // beside, and that building's whole-board bonus reaches every other tower, so
    // the engine must recompute it. Tower has no engine reference, so the restore
    // latches here and GameEngine.update drains it, mirroring pendingGhostEffect.
    this.pendingRestoreEffect = true;
  }

  // Recomputes max health from base + level + variant health multiplier. Used so
  // that upgraded towers (and the Shotgun Tank "Reinforced" variant) become
  // tankier. Current health is scaled by the previous ratio to avoid fully
  // healing on every level/rank change. The per-level growth is independent of
  // the damage growth (levelDmgMult vs levelHealthMult), tuned separately.
  computeMaxHealth(): number {
    const healthMult = this.stats?.healthMult ?? 1;
    return computeTowerMaxHealth(this.base, this.type as TowerId, this.level, this.variant, healthMult);
  }

  recomputeMaxHealth(): void {
    const newMax = this.computeMaxHealth();
    const ratio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
    this.maxHealth = newMax;
    // Keep full float precision here: rounding every upgrade/downgrade cycle
    // accumulated drift. Display sites (TowerPanel, HP bars) round as needed.
    this.health = Math.max(0, newMax * ratio);
  }

  canCancel(): boolean {
    return this._gameSeconds * 1000 < CANCEL_BUILD_WINDOW_MS && this.level === 1;
  }

  cancelRemainingMs(): number {
    return Math.max(0, CANCEL_BUILD_WINDOW_MS - this._gameSeconds * 1000);
  }

  selectTarget(
    enemies: { x: number; y: number; hp: number; maxHp?: number; id: number; flyingHeight?: number }[],
  ): { x: number; y: number; hp: number; maxHp?: number; id: number; flyingHeight?: number } | null {
    if (enemies.length === 0) return null;
    let target: { x: number; y: number; hp: number; maxHp?: number; id: number } | null = null;

    // "first"/"last" use nav distance-to-base (maze-aware). Euclidean to the base
    // center is the fallback when the field is missing or the tile is unreachable.
    const base = this.grid.getBase();
    const baseWorld = this.grid.tileToWorld(base.x, base.y);

    switch (this.targeting) {
      case "first":
      case "last": {
        // Single pass: one base-distance read per enemy, and squared Euclidean
        // when neither side has a nav distance (no Math.hypot). The strict
        // comparison preserves the old reduce tie-break (ties keep the first).
        const preferFarther = this.targeting === "last";
        let best = enemies[0]!;
        const bestTile = this.grid.worldToTile(best.x, best.y);
        const bestNav = this.navDistanceToBase?.(bestTile.x, bestTile.y, best.flyingHeight ?? 0);
        let bestNavDistance = bestNav === undefined ? -1 : bestNav;
        const bestBaseDeltaX = best.x - baseWorld.x;
        const bestBaseDeltaY = best.y - baseWorld.y;
        let bestSquaredDistance = bestBaseDeltaX * bestBaseDeltaX + bestBaseDeltaY * bestBaseDeltaY;
        for (let index = 1; index < enemies.length; index++) {
          const candidate = enemies[index]!;
          const candidateTile = this.grid.worldToTile(candidate.x, candidate.y);
          const candidateNav = this.navDistanceToBase?.(candidateTile.x, candidateTile.y, candidate.flyingHeight ?? 0);
          const candidateNavDistance = candidateNav === undefined ? -1 : candidateNav;
          const candidateBaseDeltaX = candidate.x - baseWorld.x;
          const candidateBaseDeltaY = candidate.y - baseWorld.y;
          const candidateSquaredDistance =
            candidateBaseDeltaX * candidateBaseDeltaX + candidateBaseDeltaY * candidateBaseDeltaY;
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
        target = best;
        break;
      }
      case "closest":
        target = enemies.reduce((prevA, prevB) => {
          const da = (prevA.x - this.x) ** 2 + (prevA.y - this.y) ** 2;
          const db = (prevB.x - this.x) ** 2 + (prevB.y - this.y) ** 2;
          return da < db ? prevA : prevB;
        });
        break;
      case "strong":
        // Prefer higher maxHp (tankier type), then current hp as tie-break.
        target = enemies.reduce((prevA, prevB) => {
          const maxHpA = prevA.maxHp ?? prevA.hp;
          const maxHpB = prevB.maxHp ?? prevB.hp;
          if (maxHpA !== maxHpB) return maxHpA > maxHpB ? prevA : prevB;
          return prevA.hp > prevB.hp ? prevA : prevB;
        });
        break;
      case "furthest":
        target = enemies.reduce((prevA, prevB) => {
          const da = (prevA.x - this.x) ** 2 + (prevA.y - this.y) ** 2;
          const db = (prevB.x - this.x) ** 2 + (prevB.y - this.y) ** 2;
          return da > db ? prevA : prevB;
        });
        break;
      default:
        target = enemies[0]!;
    }
    return target;
  }

  update(
    dt: number,
    enemyManager: EnemyManagerRef,
    projectileManager: ProjectileManagerRef,
    sound: SoundPlayer,
    caches: readonly CacheShotTarget[] = [],
    onCacheHit: (cacheId: number, damage: number) => void = () => {},
  ) {
    this._gameSeconds += dt;
    if (this.cooldown > 0) this.cooldown -= dt;

    // Ghost state: advance the restore timer first, then auto-restore when it elapses.
    if (this.isGhost) {
      this.ghostTimer += dt;
      const restoreTime = Math.max(
        GHOST_RESTORE_MIN_SECONDS,
        GHOST_RESTORE_BASE_SECONDS - this.level * GHOST_RESTORE_PER_LEVEL,
      );
      if (this.ghostTimer >= restoreTime) {
        this.restore();
      }
    }
    // A ghosted tower cannot fire or apply any per-frame behavior until restored.
    if (this.isGhost) {
      return;
    }

    const stats = this.stats;
    this.frameStats = stats;

    // Data-driven frost aura (ice addon 0)
    if (stats.frostAura) {
      const tileSize = this.grid?.tileSize || 36;
      const frostRangePx = ICE_AURA_RANGE * tileSize;
      const usedSensor = enemyManager.forEachSensorHits?.(`${this.id}:frost`, this.applyFrostAura!);
      if (!usedSensor) {
        enemyManager.forEachEnemyInRange(this.x, this.y, frostRangePx, this.applyFrostAura!);
      }
    }

    // Data-driven static field (lightning addon 0)
    if (stats.staticField) {
      const tileSize = this.grid?.tileSize || 36;
      const staticFieldRangePx = STATIC_FIELD_RANGE * tileSize;
      const usedSensor = enemyManager.forEachSensorHits?.(`${this.id}:static`, this.applyStaticField!);
      if (!usedSensor) {
        enemyManager.forEachEnemyInRange(this.x, this.y, staticFieldRangePx, this.applyStaticField!);
      }
    }

    // Data-driven ice burst (ice addon 2)
    if (stats.iceBurst) {
      this.iceBurstTimer += dt;
      if (this.iceBurstTimer >= ICE_BURST_INTERVAL) {
        this.iceBurstTimer = 0;
        const tileSize = this.grid?.tileSize || 36;
        const iceBurstRangePx = ICE_BURST_RANGE * tileSize;
        enemyManager.forEachEnemyInRange(this.x, this.y, iceBurstRangePx, this.applyIceBurst!);
      }
    }

    // Electric Fence variant (sturdyWall B): zap enemies that touch the wall,
    // dealing contact damage and briefly stunning them (stopping motion + attacks).
    if (stats.fenceDamage > 0) {
      this.fenceTimer += dt;
      if (this.fenceTimer >= ELECTRIC_FENCE_INTERVAL) {
        this.fenceTimer = 0;
        const tileSize = this.grid?.tileSize || 36;
        const fenceRangePx = tileSize * ELECTRIC_FENCE_RANGE_TILES;
        enemyManager.forEachEnemyInRange(this.x, this.y, fenceRangePx, this.applyElectricFence!);
      }
    }

    // SturdyWall-style towers carry range 0 and have no projectile path: the aura,
    // burst, and fence blocks above already ran with their own ranges, so targeting
    // here could only scan every enemy and fail each range check. Skip it.
    if (stats.range <= 0) return;

    const tileSize = this.grid?.tileSize || 36;
    const rangePx = stats.range * tileSize;
    const rangeSquared = rangePx * rangePx;

    if (resolveEffectiveBase(this.base, this.type as TowerId, this.variant).fixedAim && this.fixedAimDir) {
      const [ddx, ddy] = FIXED_AIM_DIRECTION_VECTORS[this.fixedAimDir];
      this.angle = Math.atan2(ddy, ddx);

      let targetEnemy: { x: number; y: number; id: number } | null = null;
      if (this.cachedTargetId !== null) {
        const cached = enemyManager.getEnemyById(this.cachedTargetId);
        if (cached && !cached.removed && !(stats.groundOnly && (cached.flyingHeight ?? 0) > 0)) {
          const edx = cached.x - this.x;
          const edy = cached.y - this.y;
          const distSq = edx * edx + edy * edy;
          if (distSq <= rangeSquared && distSq > 0) {
            const dist = Math.sqrt(distSq);
            const dot = (edx / dist) * ddx + (edy / dist) * ddy;
            if (dot > 0.5) targetEnemy = cached;
          }
        }
      }
      if (!targetEnemy) {
        // A valid cached target returns above without scanning; the scan itself uses
        // the visitor so no in-range array is allocated. Strict `<` on squared
        // distance preserves the old first-found-wins tie-break. The holder object
        // keeps the closure-side write visible to control-flow typing.
        const scanResult: { target: { x: number; y: number; id: number } | null } = { target: null };
        let bestSquaredDistance = Infinity;
        enemyManager.forEachEnemyInRange(this.x, this.y, rangePx, (enemy) => {
          if (stats.groundOnly && (enemy.flyingHeight ?? 0) > 0) return;
          const edx = enemy.x - this.x;
          const edy = enemy.y - this.y;
          const enemySquaredDistance = edx * edx + edy * edy;
          if (enemySquaredDistance === 0) return;
          const dist = Math.sqrt(enemySquaredDistance);
          const dot = (edx / dist) * ddx + (edy / dist) * ddy;
          if (dot > 0.5 && enemySquaredDistance < bestSquaredDistance) {
            bestSquaredDistance = enemySquaredDistance;
            scanResult.target = enemy;
          }
        });
        targetEnemy = scanResult.target;
        this.cachedTargetId = targetEnemy ? targetEnemy.id : null;
      }
      if (targetEnemy) {
        const aimTarget = { x: this.x + ddx * rangePx, y: this.y + ddy * rangePx, id: 0 };
        this.fire({ kind: "enemy", ...aimTarget }, enemyManager, projectileManager, sound);
      } else {
        const cache = nearestCache(this.x, this.y, rangeSquared, caches, { x: ddx, y: ddy });
        if (cache) this.fire(cacheShotTarget(cache, onCacheHit), enemyManager, projectileManager, sound);
      }
      return;
    }

    let target: { x: number; y: number; hp: number; maxHp?: number; id: number } | null = null;
    // Sticky cache only for closest; first/last/strong/furthest re-evaluate each tick.
    const stickyTargeting = this.targeting === "closest";
    if (stickyTargeting && this.cachedTargetId !== null) {
      const cached = enemyManager.getEnemyById(this.cachedTargetId);
      if (cached && !cached.removed && !(stats.groundOnly && (cached.flyingHeight ?? 0) > 0)) {
        const dx = cached.x - this.x;
        const dy = cached.y - this.y;
        if (dx * dx + dy * dy <= rangeSquared) {
          target = cached;
        }
      }
    }
    if (!target) {
      // Visitor scan into a per-tower scratch array (allocated once) so the
      // standard targeting path does not allocate a fresh in-range array per tick.
      // Visitor order matches the array query order (both use one shape query).
      if (!this.inRangeScratch) this.inRangeScratch = [];
      const inRangeScratch = this.inRangeScratch;
      inRangeScratch.length = 0;
      enemyManager.forEachEnemyInRange(this.x, this.y, rangePx, (enemy) => {
        if (stats.groundOnly && (enemy.flyingHeight ?? 0) > 0) return;
        inRangeScratch.push(enemy);
      });
      target = this.selectTarget(inRangeScratch);
      this.cachedTargetId = target ? target.id : null;
    }
    if (target) {
      this.fire({ kind: "enemy", ...target }, enemyManager, projectileManager, sound);
      return;
    }
    const cache = nearestCache(this.x, this.y, rangeSquared, caches);
    if (cache) this.fire(cacheShotTarget(cache, onCacheHit), enemyManager, projectileManager, sound);
  }

  fire(
    target: FireTarget,
    _enemyManager: EnemyManagerRef,
    projectileManager: ProjectileManagerRef,
    sound: SoundPlayer,
  ) {
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.cooldown > 0) return;
    const stats = this.stats;
    let fireDamage = stats.damage;

    // Charge shot: every 5th shot deals 3x damage
    if (stats.chargeShot) {
      this.chargeShotCount = (this.chargeShotCount + 1) % CHARGE_SHOT_COUNT;
      if (this.chargeShotCount === 0) {
        fireDamage *= CHARGE_SHOT_MULT;
      }
    }

    const tileSize = this.grid?.tileSize || 36;
    const barrelOffset = tileSize * 0.45;
    this.fireAnimTime = this._gameSeconds;
    this.cooldown = 1 / stats.fireRate;
    if (sound) sound.playSound(`shoot_${this.type as TowerId}`);

    // A siege shot carries no on-hit effects: it lands on the cache tile, and the
    // cache takes the damage through onCacheHit instead of the projectile pipeline.
    if (target.kind === "cache") {
      if (this.type === "lightning") {
        target.onCacheHit(target.id, fireDamage);
        return;
      }
      projectileManager.spawn({
        towerId: this.id,
        x: this.x + Math.cos(this.angle) * barrelOffset,
        y: this.y + Math.sin(this.angle) * barrelOffset,
        damage: fireDamage,
        speed:
          (resolveEffectiveBase(this.base, this.type as TowerId, this.variant).projSpeed || 1) *
          tileSize *
          PROJECTILE_SPEED_MULTIPLIER,
        range: stats.range,
        towerType: this.type,
        towerLevel: this.level,
        targetId: 0,
        targetX: target.x,
        targetY: target.y,
        cacheId: target.id,
        color: this.color,
        icon: this.icon,
        variant: this.variant,
      });
      return;
    }

    if (this.type === "lightning") {
      projectileManager.fireLightning({
        originX: this.x + Math.cos(this.angle) * barrelOffset,
        originY: this.y + Math.sin(this.angle) * barrelOffset,
        damage: fireDamage,
        towerLevel: this.level,
        targetId: target.id,
        stunDuration: stats.stun,
        towerId: this.id,
        doubleDischarge: stats.doubleDischarge,
        burnCircuit: stats.burnCircuit,
        critChance: stats.critChance,
        goldOnCrit: stats.goldOnCrit,
        range: stats.range,
        chain: stats.chain,
        stormcall: stats.stormcall,
        color: this.color,
        flyingDamageMult: stats.flyingDamageMult,
      });
      return;
    }
    projectileManager.spawn({
      towerId: this.id,
      x: this.x + Math.cos(this.angle) * barrelOffset,
      y: this.y + Math.sin(this.angle) * barrelOffset,
      damage: fireDamage,
      speed:
        (resolveEffectiveBase(this.base, this.type as TowerId, this.variant).projSpeed || 1) *
        tileSize *
        PROJECTILE_SPEED_MULTIPLIER,
      range: stats.range,
      towerType: this.type,
      towerLevel: this.level,
      targetId: target.id,
      targetX: target.x,
      targetY: target.y,
      color: this.color,
      icon: this.icon,
      slowAmt: stats.slowAmt,
      slowDur: stats.slowDur,
      napalm: stats.napalm,
      marksman: stats.marksman,
      knockbackBase: stats.knockbackBase,
      knockbackScale: stats.knockbackScale,
      variant: this.variant,
      critChance: stats.critChance,
      goldOnCrit: stats.goldOnCrit,
      bounceShot: stats.bounceShot,
      splashStun: stats.splashStun,
      groundOnly: stats.groundOnly,
      armorPiercing: stats.armorPiercing,
      trueShot: stats.trueShot,
      markTarget: stats.markTarget,
      antiHeal: stats.antiHeal,
      pierce: stats.pierce,
      pierceFalloff: stats.pierceFalloff,
      stunDur: stats.stun,
      splash: stats.splash,
      flyingDamageMult: stats.flyingDamageMult,
    });
  }
}

// Shared damage entry for enemy contact hits and ability hits. Module level, not
// a method: a required private member on Tower would break the structural
// assignability of Pinia's unwrapped store state to Tower.
// Armor is applied before thorn reflect so the reflected hit uses the damage
// the tower actually took. GameEngine writes incomingDamageMult from the run.
function applyIncomingDamage(tower: Tower, amount: number, attacker?: Enemy): void {
  const incoming = amount * tower.incomingDamageMult;
  const stats = tower.stats;
  const attackerFlying = (attacker?.flyingHeight ?? 0) > 0;
  if (stats.thornReflectPct > 0 && attacker && !tower.isGhost && (!stats.groundOnly || !attackerFlying)) {
    const reflected = damageAgainstFlying(
      incoming * stats.thornReflectPct,
      stats.flyingDamageMult,
      attacker.flyingHeight,
    );
    const dealtDamage = attacker.takeDamage(reflected) ?? reflected;
    tower.creditDamage(dealtDamage);
  }
  tower.health -= incoming;
  if (tower.health < 0) tower.health = 0;
  if (tower.health <= 0 && !tower.isGhost) {
    tower.isGhost = true;
    tower.pendingGhostEffect = true;
  }
}

// Every shot is one of these: an enemy (or a free aim point, id 0) for a normal
// projectile, or a cache for the reduced siege payload that bypasses on-hit effects.
type FireTarget =
  | { kind: "enemy"; x: number; y: number; id: number }
  | { kind: "cache"; x: number; y: number; id: number; onCacheHit: (cacheId: number, damage: number) => void };

function cacheShotTarget(cache: CacheShotTarget, onCacheHit: (cacheId: number, damage: number) => void): FireTarget {
  return { kind: "cache", x: cache.x, y: cache.y, id: cache.id, onCacheHit };
}
