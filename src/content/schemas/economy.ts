import { z } from "zod";

export const EconomyContentSchema = z
  .object({
    startingGoldByRegion: z.tuple([z.number(), z.number(), z.number()]),
    // Per entry beyond 1.
    progressiveGoldPerEntry: z.number().int().min(0),
    victoryWave: z.number(),
    milestoneWaves: z.tuple([z.number(), z.number(), z.number()]),
    milestoneGems: z.record(z.string(), z.number()),
    bonusGemBase: z.number(),
    betweenWavesTimer: z.number(),
    preEmptiveWaveTimer: z.number(),
    difficultyMultMin: z.number(),
    difficultyMultMax: z.number(),
    difficultyMultTick: z.number(),
    regionDifficultyMult: z.number(),
    difficultyMultGemBase: z.number(),
    mapGemMultipliers: z.array(z.number()).length(36),
    firstTimeMilestoneMult: z.number(),
    firstFullClearMult: z.number(),
    generalAddonGemCosts: z.object({
      extraHealth: z.tuple([z.number(), z.number(), z.number()]),
      startingGold: z.tuple([z.number(), z.number(), z.number()]),
      slowHealing: z.tuple([z.number(), z.number(), z.number()]),
      upgradeCostReduction: z.tuple([z.number(), z.number(), z.number()]),
      terrainHeightBonus: z.tuple([z.number(), z.number(), z.number()]),
      terrainHeightRangeBonus: z.tuple([z.number(), z.number(), z.number()]),
      damageMilestoneBonus: z.tuple([z.number(), z.number(), z.number()]),
      enemyWoundDamageReduction: z.tuple([z.number(), z.number(), z.number()]),
      progressiveThirdChoice: z.tuple([z.number()]),
    }),
    slowHealingPerRound: z.tuple([z.number(), z.number(), z.number()]),
    sellOptionGemCost: z.number(),
    sellDiscountPct: z.number(),
    terrainHeightBonusPct: z.tuple([z.number(), z.number(), z.number()]),
    // Share of an enemy's attack damage removed at 1 HP, by tier. Interpolated
    // against the fraction of its max health it has lost (see Enemy.effectiveAttackDamage).
    enemyWoundDamageReductionPct: z.tuple([z.number(), z.number(), z.number()]),
    terrainHeightRangeBonus: z.tuple([z.number(), z.number(), z.number()]),
    upgradeCostReductionPct: z.tuple([z.number(), z.number(), z.number()]),
    startingGoldBonus: z.tuple([z.number(), z.number(), z.number()]),
    startingHealthBonus: z.tuple([z.number(), z.number(), z.number()]),
    startingBaseHealth: z.number(),
    baseGoldCost: z.number(),
    baseLevelHealthMult: z.number(),
    milestoneBonusPct: z.tuple([
      z.tuple([z.number(), z.number()]),
      z.tuple([z.number(), z.number()]),
      z.tuple([z.number(), z.number()]),
    ]),
    milestoneThresholdPerLevelSquared: z.number(),
  })
  .superRefine((content, context) => {
    // GameEngine pays milestoneGems[wave] ?? 0, so a milestone wave with no key
    // silently pays zero gems for that milestone.
    const gemKeys = Object.keys(content.milestoneGems);
    content.milestoneWaves.forEach((milestoneWave, milestoneIndex) => {
      if (!gemKeys.includes(String(milestoneWave))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `milestoneGems has no entry for milestoneWaves[${milestoneIndex}] (${milestoneWave})`,
          path: ["milestoneGems"],
        });
      }
    });
  });

export type EconomyContent = z.infer<typeof EconomyContentSchema>;
