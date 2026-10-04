import { applyVariantOps } from "@/content/applyVariantOps.js";
import {
  TOWER_LEVEL_DMG_MULT,
  TOWER_LEVEL_HEALTH_MULT,
  TOWER_LEVEL_RANGE_MULT,
  TOWER_LEVEL_RATE_MULT,
  TOWER_LEVEL_SPLASH_MULT,
  TOWER_VARIANTS,
  type TowerId,
} from "@/sim/ConstantsTower.js";

// Shape of a tower's base config as stored on the Tower instance: a superset of
// the TOWER_BASE JSON entry (adds `pierce`, keeps optional projSpeed).
export interface TowerBaseConfig {
  range: number;
  damage: number;
  fireRate: number;
  splash?: number;
  chain?: number;
  stun?: number;
  pierce?: number;
  pierceFalloff?: number;
  slowAmt?: number;
  slowDur?: number;
  projSpeed?: number;
  fixedAim?: boolean;
  groundOnly?: boolean;
  health: number;
  knockbackBase?: number;
  knockbackScale?: number;
}

export interface TowerCoreStats {
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
}

// Merges a tower's active variant `settings` over its base entry. This is the
// single source of truth for all base stat reads, so any variant can override
// any base field (knockback, damage, health, projSpeed, …) declaratively.
export function resolveEffectiveBase(base: TowerBaseConfig, type: TowerId, variant: "A" | "B" | null): TowerBaseConfig {
  const variantConfig = variant ? TOWER_VARIANTS[type]?.[variant] : undefined;
  const variantSettings = variantConfig?.settings;
  return variantSettings ? { ...base, ...variantSettings } : base;
}

// Base + level scaling + specialization, with no add-on, terrain, milestone, or
// difficulty input. Tower._computeStats starts from this and layers the
// save-dependent bonuses on top; the help dialog reads it directly for the
// plain per-level progression.
export function computeTowerCoreStats(
  base: TowerBaseConfig,
  type: TowerId,
  level: number,
  variant: "A" | "B" | null,
): TowerCoreStats {
  const effectiveBase = resolveEffectiveBase(base, type, variant);
  let range = effectiveBase.range * TOWER_LEVEL_RANGE_MULT ** (level - 1);
  let damage = effectiveBase.damage * TOWER_LEVEL_DMG_MULT ** (level - 1);
  let fireRate = effectiveBase.fireRate * TOWER_LEVEL_RATE_MULT ** (level - 1);
  let splash = (effectiveBase.splash || 0) * TOWER_LEVEL_SPLASH_MULT ** (level - 1);
  let chain = effectiveBase.chain || 0;
  let stun = effectiveBase.stun || 0;
  let pierce = effectiveBase.pierce || 0;
  let pierceFalloff = effectiveBase.pierceFalloff || 0;
  let slowAmt = effectiveBase.slowAmt || 0;
  let slowDur = effectiveBase.slowDur || 0;
  let marksman = false;
  let napalm = false;
  let stormcall = false;
  let knockbackBase = effectiveBase.knockbackBase ?? 0;
  let knockbackScale = effectiveBase.knockbackScale ?? 0;
  let thornReflectPct = 0;
  let fenceDamage = 0;
  let fenceStun = 0;
  let healthMult = 1;
  let armorPiercing = false;
  const groundOnly = effectiveBase.groundOnly ?? false;

  if (level >= 5 && variant) {
    const variantConfig = TOWER_VARIANTS[type]?.[variant];
    if (variantConfig?.statOps?.length) {
      ({
        range,
        damage,
        fireRate,
        splash,
        chain,
        stun,
        pierce,
        pierceFalloff,
        slowAmt,
        slowDur,
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
      } = applyVariantOps(
        {
          range,
          damage,
          fireRate,
          splash,
          chain,
          stun,
          pierce,
          pierceFalloff,
          slowAmt,
          slowDur,
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
        },
        variantConfig.statOps,
        level - 5,
      ));
    }
  }

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
    slowDur,
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
  };
}

// Health growth is tuned independently of the damage growth (levelHealthMult
// vs levelDmgMult). `healthMult` carries the variant multiplier (and, for the
// live Tower, any add-on multiplier layered on top of it).
export function computeTowerMaxHealth(
  base: TowerBaseConfig,
  type: TowerId,
  level: number,
  variant: "A" | "B" | null,
  healthMult: number,
): number {
  return resolveEffectiveBase(base, type, variant).health * TOWER_LEVEL_HEALTH_MULT ** (level - 1) * healthMult;
}
