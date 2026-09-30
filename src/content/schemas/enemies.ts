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
  siegeStuckSeconds: z.number(),
  waveCountBase: z.number(),
  waveCountScale: z.number(),
  bossCadence: z.tuple([z.number(), z.number(), z.number()]),
});

export type EnemiesContent = z.infer<typeof EnemiesContentSchema>;
export type EnemyMetaData = z.infer<typeof EnemyMetaSchema>;
