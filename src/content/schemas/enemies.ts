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
});

export const EnemiesContentSchema = z.object({
  types: z.record(z.string(), EnemyMetaSchema),
  levelHpMult: z.object({ intercept: z.number(), slopePerLevel: z.number() }),
  waveDamageMult: z.number(),
  bountyLevelGrowth: z.number(),
  bountyFullThroughWave: z.number(),
  laterWaveBountyMult: z.number(),
  bossStunReduction: z.number(),
  minSlowFactor: z.number(),
  maxBurnStacks: z.number(),
  knockbackBallisticSeconds: z.number(),
  agentResyncRadiusFraction: z.number(),
  stuckRecoverySeconds: z.number(),
  breachHysteresisSeconds: z.number(),
  breachReevalSeconds: z.number(),
  waveCountBase: z.number(),
  waveCountScale: z.number(),
  tierThresholds: z.array(z.object({ minWave: z.number(), threshold: z.number(), type: z.string() })),
  healerMinGap: z.number(),
  bossCadence: z.tuple([z.number(), z.number(), z.number()]),
});

export type EnemiesContent = z.infer<typeof EnemiesContentSchema>;
export type EnemyMetaData = z.infer<typeof EnemyMetaSchema>;
