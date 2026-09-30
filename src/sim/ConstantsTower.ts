import type { TowerVariantStats } from "@/content/applyVariantOps.js";
import { getGameContent } from "@/content/gameContent.js";
import type { StatOp } from "@/content/schemas/statOps.js";

const towers = getGameContent().towers;
const tuning = towers.tuning;

export const TowerIds = {
  BASIC: "basic",
  ICE: "ice",
  SNIPER: "sniper",
  CANNON: "cannon",
  LIGHTNING: "lightning",
  RAILGUN: "railgun",
  STURDY_WALL: "sturdyWall",
  SHOTGUN_TANK: "shotgunTank",
} as const;

export type TowerId = (typeof TowerIds)[keyof typeof TowerIds];

export interface TowerMeta {
  cost: number;
}

export interface TowerBase {
  range: number;
  damage: number;
  fireRate: number;
  projSpeed?: number;
  splash?: number;
  slowAmt?: number;
  slowDur?: number;
  stun?: number;
  chain?: number;
  pierceFalloff?: number;
  fixedAim?: boolean;
  health: number;
  knockbackBase?: number;
  knockbackScale?: number;
}

export interface TowerAddonEffect {
  damageMult?: number;
  splashMult?: number;
  slowMult?: number;
  rangeAdd?: number;
  chainAdd?: number;
  stunAdd?: number;
  pierceAdd?: number;
  critChance?: number;
  goldOnCrit?: number;
  bounceShot?: boolean;
  splashStun?: number;
  antiAir?: boolean;
  armorPiercing?: boolean;
  doubleDischarge?: number;
  burnCircuit?: boolean;
  trueShot?: number;
  markTarget?: number;
  chargeShot?: boolean;
  antiHeal?: boolean;
  frostAura?: boolean;
  staticField?: boolean;
  iceBurst?: boolean;
  healthMult?: number;
  fireRateMult?: number;
}

export type { TowerVariantStats };

export interface TowerVariantConfig {
  name: string;
  settings?: Partial<TowerBase>;
  statOps?: readonly StatOp[];
}

export const TOWER_META: Record<string, TowerMeta> = towers.meta as Record<string, TowerMeta>;
export const TOWER_BASE: Record<string, TowerBase> = towers.base as Record<string, TowerBase>;

export const PROJECTILE_SPEED_MULTIPLIER = tuning.projectileSpeedMultiplier;
export const TOWER_LEVEL_DMG_MULT = tuning.levelDmgMult;
export const TOWER_LEVEL_RATE_MULT = tuning.levelRateMult;
export const TOWER_LEVEL_RANGE_MULT = tuning.levelRangeMult;
export const TOWER_LEVEL_SPLASH_MULT = tuning.levelSplashMult;
export const UPGRADE_COST_BASE = tuning.upgradeCostBase;
export const SELL_VALUE_RATIO = tuning.sellValueRatio;
export const CANCEL_BUILD_WINDOW_MS = tuning.cancelBuildWindowMs;
export const ICE_AURA_SLOW_MULT = tuning.iceAuraSlowMult;
export const ICE_AURA_DURATION = tuning.iceAuraDuration;
export const ICE_AURA_RANGE = tuning.iceAuraRange;
export const SPLASH_DAMAGE_RATIO = tuning.splashDamageRatio;
export const CHAIN_DAMAGE_FALLOFF = tuning.chainDamageFalloff;
export const CHAIN_RANGE = tuning.chainRange;
export const NAPALM_BURN_DPS_RATIO = tuning.napalmBurnDpsRatio;
export const NAPALM_BURN_DURATION = tuning.napalmBurnDuration;
export const CRIT_CHANCE = tuning.critChance;
export const GOLD_PER_CRIT = tuning.goldPerCrit;
export const ICE_BURST_STUN_DURATION = tuning.iceBurstStunDuration;
export const ICE_BURST_INTERVAL = tuning.iceBurstInterval;
export const ICE_BURST_RANGE = tuning.iceBurstRange;
export const STUN_SHELL_DURATION = tuning.stunShellDuration;
export const STATIC_FIELD_SLOW_AMT = tuning.staticFieldSlowAmt;
export const STATIC_FIELD_SLOW_DUR = tuning.staticFieldSlowDur;
export const STATIC_FIELD_RANGE = tuning.staticFieldRange;
export const DOUBLE_DISCHARGE_CHANCE = tuning.doubleDischargeChance;
export const BURN_CIRCUIT_DMG_MULT = tuning.burnCircuitDmgMult;
export const BURN_CIRCUIT_DURATION = tuning.burnCircuitDuration;
export const TRUE_SHOT_CHANCE = tuning.trueShotChance;
export const MARK_TARGET_DMG_PCT = tuning.markTargetDmgPct;
export const MARK_TARGET_DURATION = tuning.markTargetDuration;
export const CHARGE_SHOT_MULT = tuning.chargeShotMult;
export const CHARGE_SHOT_COUNT = tuning.chargeShotCount;
export const MULTI_PIERCE_COUNT = tuning.multiPierceCount;
export const BOUNCE_DAMAGE_FALLOFF = tuning.bounceDamageFalloff;
export const ANTI_HEAL_DURATION = tuning.antiHealDuration;
export const MARKSMAN_CHANCE = tuning.marksmanChance;
export const GHOST_RESTORE_BASE_SECONDS = tuning.ghostRestoreBaseSeconds;
export const GHOST_RESTORE_PER_LEVEL = tuning.ghostRestorePerLevel;
export const GHOST_RESTORE_MIN_SECONDS = tuning.ghostRestoreMinSeconds;
export const TERRAIN_DAMAGE_BONUS_MAX_MULT = tuning.terrainDamageBonusMaxMult;
export const MILESTONE_MAX_TIERS = tuning.milestoneMaxTiers;
export const GHOST_PARTICLE_DURATION = tuning.ghostParticleDuration;
export const GHOST_PARTICLE_COUNT = tuning.ghostParticleCount;
export const GHOST_OPACITY = tuning.ghostOpacity;
export const ELECTRIC_FENCE_RANGE_TILES = tuning.electricFenceRangeTiles;
export const ELECTRIC_FENCE_INTERVAL = tuning.electricFenceInterval;
export const KNOCKBACK_HP_DIVISOR = tuning.knockbackHpDivisor;

function toVariantConfig(def: {
  name: string;
  settings?: Partial<TowerBase>;
  statOps?: readonly StatOp[];
}): TowerVariantConfig {
  const config: TowerVariantConfig = { name: def.name };
  if (def.settings) config.settings = def.settings as Partial<TowerBase>;
  if (def.statOps) config.statOps = def.statOps;
  return config;
}

export const TOWER_VARIANTS: Record<TowerId, { A: TowerVariantConfig; B: TowerVariantConfig }> = Object.fromEntries(
  Object.entries(towers.variants).map(([towerId, pair]) => [
    towerId,
    { A: toVariantConfig(pair.A as TowerVariantConfig), B: toVariantConfig(pair.B as TowerVariantConfig) },
  ]),
) as Record<TowerId, { A: TowerVariantConfig; B: TowerVariantConfig }>;

export const TOWER_ADDON_EFFECTS: Record<TowerId, TowerAddonEffect[]> = towers.addonEffects as Record<
  TowerId,
  TowerAddonEffect[]
>;
