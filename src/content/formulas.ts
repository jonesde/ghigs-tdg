import type { EnemiesContent } from "./schemas/enemies.js";

export function enemyLevelMult(level: number, coeffs: EnemiesContent["levelHpMult"]): number {
  return coeffs.intercept + coeffs.slopePerLevel * (level - 1);
}

// Level growth keeps higher-level maps paid. laterWaveBountyMult applies only
// after bountyFullThroughWave, so the walk from the first boss to the second
// does not fund another level-2 army.
export function enemyBounty(
  baseBounty: number,
  level: number,
  wave: number,
  bountyLevelGrowth: number,
  bountyFullThroughWave: number,
  laterWaveBountyMult: number,
): number {
  const levelFactor = 1 + bountyLevelGrowth * (level - 1);
  const waveFactor = wave <= bountyFullThroughWave ? 1 : laterWaveBountyMult;
  return Math.ceil(baseBounty * levelFactor * waveFactor);
}

export function formatEnemyLevelMult(coeffs: EnemiesContent["levelHpMult"]): string {
  return `${coeffs.intercept} + ${coeffs.slopePerLevel}*(level-1)`;
}
