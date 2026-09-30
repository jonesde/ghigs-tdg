import { z } from "zod";
import { StatOpSchema } from "./statOps.js";

export const TowerBaseSchema = z.object({
  range: z.number(),
  damage: z.number(),
  fireRate: z.number(),
  // Optional: towers that never spawn a traveling projectile (lightning, wall)
  // omit it. Tower.fire falls back to 1 for any consumer that reads it.
  projSpeed: z.number().optional(),
  splash: z.number().optional(),
  slowAmt: z.number().optional(),
  slowDur: z.number().optional(),
  stun: z.number().optional(),
  chain: z.number().optional(),
  pierceFalloff: z.number().optional(),
  fixedAim: z.boolean().optional(),
  health: z.number(),
  knockbackBase: z.number().optional(),
  knockbackScale: z.number().optional(),
});

export const TowerMetaSchema = z.object({ cost: z.number() });

export const TowerAddonEffectSchema = z.object({
  damageMult: z.number().optional(),
  splashMult: z.number().optional(),
  slowMult: z.number().optional(),
  rangeAdd: z.number().optional(),
  chainAdd: z.number().optional(),
  stunAdd: z.number().optional(),
  pierceAdd: z.number().optional(),
  critChance: z.number().optional(),
  goldOnCrit: z.number().optional(),
  bounceShot: z.boolean().optional(),
  splashStun: z.number().optional(),
  antiAir: z.boolean().optional(),
  armorPiercing: z.boolean().optional(),
  doubleDischarge: z.number().optional(),
  burnCircuit: z.boolean().optional(),
  trueShot: z.number().optional(),
  markTarget: z.number().optional(),
  chargeShot: z.boolean().optional(),
  antiHeal: z.boolean().optional(),
  frostAura: z.boolean().optional(),
  staticField: z.boolean().optional(),
  iceBurst: z.boolean().optional(),
  healthMult: z.number().optional(),
  fireRateMult: z.number().optional(),
});

export const TowerVariantDefSchema = z.object({
  name: z.string(),
  settings: TowerBaseSchema.partial().optional(),
  statOps: z.array(StatOpSchema).optional(),
});

export const TowerTuningSchema = z.object({
  projectileSpeedMultiplier: z.number(),
  levelDmgMult: z.number(),
  levelRateMult: z.number(),
  levelRangeMult: z.number(),
  levelSplashMult: z.number(),
  upgradeCostBase: z.number(),
  sellValueRatio: z.number(),
  cancelBuildWindowMs: z.number(),
  iceAuraSlowMult: z.number(),
  iceAuraDuration: z.number(),
  iceAuraRange: z.number(),
  splashDamageRatio: z.number(),
  chainDamageFalloff: z.number(),
  chainRange: z.number(),
  napalmBurnDpsRatio: z.number(),
  napalmBurnDuration: z.number(),
  critChance: z.number(),
  goldPerCrit: z.number(),
  iceBurstStunDuration: z.number(),
  iceBurstInterval: z.number(),
  iceBurstRange: z.number(),
  stunShellDuration: z.number(),
  staticFieldSlowAmt: z.number(),
  staticFieldSlowDur: z.number(),
  staticFieldRange: z.number(),
  doubleDischargeChance: z.number(),
  burnCircuitDmgMult: z.number(),
  burnCircuitDuration: z.number(),
  trueShotChance: z.number(),
  markTargetDmgPct: z.number(),
  markTargetDuration: z.number(),
  chargeShotMult: z.number(),
  chargeShotCount: z.number(),
  multiPierceCount: z.number(),
  bounceDamageFalloff: z.number(),
  antiHealDuration: z.number(),
  marksmanChance: z.number(),
  ghostRestoreBaseSeconds: z.number(),
  ghostRestorePerLevel: z.number(),
  ghostRestoreMinSeconds: z.number(),
  terrainDamageBonusMaxMult: z.number(),
  milestoneMaxTiers: z.number(),
  ghostParticleDuration: z.number(),
  ghostParticleCount: z.number(),
  ghostOpacity: z.number(),
  electricFenceRangeTiles: z.number(),
  electricFenceInterval: z.number(),
  knockbackHpDivisor: z.number(),
});

export const TowersContentSchema = z.object({
  ids: z.array(z.string()).min(1),
  meta: z.record(z.string(), TowerMetaSchema),
  base: z.record(z.string(), TowerBaseSchema),
  tuning: TowerTuningSchema,
  variants: z.record(z.string(), z.object({ A: TowerVariantDefSchema, B: TowerVariantDefSchema })),
  addonEffects: z.record(z.string(), z.array(TowerAddonEffectSchema)),
});

export type TowersContent = z.infer<typeof TowersContentSchema>;
export type TowerBaseData = z.infer<typeof TowerBaseSchema>;
export type TowerMetaData = z.infer<typeof TowerMetaSchema>;
export type TowerAddonEffectData = z.infer<typeof TowerAddonEffectSchema>;
export type TowerVariantDef = z.infer<typeof TowerVariantDefSchema>;
export type TowerTuning = z.infer<typeof TowerTuningSchema>;
