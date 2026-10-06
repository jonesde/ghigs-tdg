import { z } from "zod";

export const EnemyMetaSchema = z.object({
  baseHp: z.number(),
  speed: z.number(),
  bounty: z.number(),
  radius: z.number(),
  shield: z.number().optional(),
  heal: z.number().optional(),
  healRange: z.number().optional(),
  resist: z.number().optional(),
  slowResist: z.number().optional(),
  knockResist: z.number().optional(),
  attackDamage: z.number(),
  attackSpeed: z.number(),
  flyingHeight: z.number().int().min(0),
  spawnIntervalSeconds: z.number().positive().optional(),
  spawnCap: z.number().int().min(1).optional(),
  spawnType: z.string().optional(),
});

export const EnemiesContentSchema = z
  .object({
    types: z.record(z.string(), EnemyMetaSchema),
    levelHpMult: z.object({ intercept: z.number(), slopePerLevel: z.number() }),
    waveHpMult: z.number(),
    lateWaveHpGrowth: z.number(),
    lateWaveStartWave: z.number(),
    lateWaveDamageGrowth: z.number(),
    levelDamageMult: z.object({ intercept: z.number(), slopePerLevel: z.number() }),
    waveDamageMult: z.number(),
    bountyLevelGrowth: z.number(),
    bountyFullThroughWave: z.number(),
    laterWaveBountyMult: z.number(),
    bossStunReduction: z.number(),
    minSlowFactor: z.number(),
    stunCapPerSecond: z.number(),
    stunWindowSeconds: z.number(),
    maxBurnStacks: z.number(),
    knockbackBallisticSeconds: z.number(),
    agentResyncRadiusFraction: z.number(),
    stuckRecoverySeconds: z.number(),
    breachHysteresisSeconds: z.number(),
    breachReevalSeconds: z.number(),
    waveCountBase: z.number(),
    waveCountScale: z.number(),
    tierThresholds: z.array(
      z.object({
        minWave: z.number(),
        threshold: z.number(),
        rampPerWave: z.number().optional(),
        maxThreshold: z.number().optional(),
        type: z.string(),
      }),
    ),
    healerMinGap: z.number(),
    bossCadence: z.tuple([z.number(), z.number(), z.number()]),
  })
  .superRefine((content, context) => {
    const knownTypes = new Set(Object.keys(content.types));
    for (const [typeName, meta] of Object.entries(content.types)) {
      const hasInterval = meta.spawnIntervalSeconds !== undefined;
      const hasCap = meta.spawnCap !== undefined;
      if (hasInterval !== hasCap) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `enemy "${typeName}" must set spawnIntervalSeconds and spawnCap together`,
          path: ["types", typeName],
        });
      }
      if (meta.spawnType !== undefined && !knownTypes.has(meta.spawnType)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `enemy "${typeName}" spawnType "${meta.spawnType}" is not a known enemy type`,
          path: ["types", typeName, "spawnType"],
        });
      }
    }
    content.tierThresholds.forEach((tier, tierIndex) => {
      const hasRamp = tier.rampPerWave !== undefined;
      const hasMax = tier.maxThreshold !== undefined;
      if (hasRamp !== hasMax) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tierThresholds[${tierIndex}] must set rampPerWave and maxThreshold together`,
          path: ["tierThresholds", tierIndex],
        });
      }
      if (tier.rampPerWave !== undefined && tier.rampPerWave <= 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tierThresholds[${tierIndex}] rampPerWave must be positive`,
          path: ["tierThresholds", tierIndex, "rampPerWave"],
        });
      }
      if (tier.maxThreshold !== undefined && tier.maxThreshold < tier.threshold) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tierThresholds[${tierIndex}] maxThreshold must be at least threshold`,
          path: ["tierThresholds", tierIndex, "maxThreshold"],
        });
      }
      if (!knownTypes.has(tier.type)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tierThresholds[${tierIndex}] type "${tier.type}" is not a known enemy type`,
          path: ["tierThresholds", tierIndex, "type"],
        });
      }
    });
  });

export type EnemiesContent = z.infer<typeof EnemiesContentSchema>;
export type EnemyMetaData = z.infer<typeof EnemyMetaSchema>;
