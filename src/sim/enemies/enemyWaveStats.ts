import { enemyBounty, enemyLevelMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";

interface EnemyCombatMeta {
  baseHp: number;
  bounty: number;
  attackDamage: number;
  attackSpeed: number;
  shield?: number | undefined;
}

export interface EnemyWaveStats {
  maxHp: number;
  attackDamage: number;
  attackDps: number;
  bounty: number;
  shield: number;
}

// Level growth keeps higher-level maps paid. laterWaveBountyMult applies only
// after bountyFullThroughWave, so the walk from the first boss to the second
// does not fund another level-2 army.
export function enemyLevelBounty(baseBounty: number, level: number, wave: number): number {
  return enemyBounty(
    baseBounty,
    level,
    wave,
    getGameContent().enemies.bountyLevelGrowth,
    getGameContent().enemies.bountyFullThroughWave,
    getGameContent().enemies.laterWaveBountyMult,
  );
}

// HP and damage scale independently: each has its own level coefficients
// (linear in level) and its own wave coefficient (linear in wave), plus a late
// additional linear steepening that starts at enemies.lateWaveStartWave and leaves
// earlier waves bit-identical. Difficulty is a single shared multiplier over both.
// HP = baseHp * enemyLevelMult(level, enemies.levelHpMult) * (1 + enemies.waveHpMult*(wave-1)) * lateHpMult(wave) * diffMult
// Damage = attackDamage * enemyLevelMult(level, enemies.levelDamageMult) * (1 + enemies.waveDamageMult*(wave-1)) * lateDamageMult(wave) * diffMult
// Shield scales with exactly the same HP factors: shielded types carry a shield
// instead of health, so the shield:HP ratio is constant across the run.
export function lateHpMult(wave: number): number {
  const pastStart = wave - getGameContent().enemies.lateWaveStartWave;
  const rawMult = getGameContent().enemies.lateWaveHpGrowth * pastStart;
  if (rawMult < 1) return 1;
  return rawMult;
}

export function lateDamageMult(wave: number): number {
  const pastStart = wave - getGameContent().enemies.lateWaveStartWave;
  const rawMult = getGameContent().enemies.lateWaveDamageGrowth * pastStart;
  if (rawMult < 1) return 1;
  return rawMult;
}

export function computeEnemyWaveStats(
  meta: EnemyCombatMeta,
  level: number,
  wave: number,
  difficultyTick: number,
  regionFactor = 1,
): EnemyWaveStats {
  const waveHpMult = 1 + getGameContent().enemies.waveHpMult * (wave - 1);
  const waveDamageMult = 1 + getGameContent().enemies.waveDamageMult * (wave - 1);
  const diffMult = ((difficultyTick || 0) * getGameContent().economy.difficultyMultTick + 1) * (regionFactor || 1);
  const levelHpMult = enemyLevelMult(level, getGameContent().enemies.levelHpMult);
  const hpMult = levelHpMult * waveHpMult * lateHpMult(wave) * diffMult;
  const attackDamage =
    meta.attackDamage *
    enemyLevelMult(level, getGameContent().enemies.levelDamageMult) *
    waveDamageMult *
    lateDamageMult(wave) *
    diffMult;
  return {
    maxHp: meta.baseHp * hpMult,
    attackDamage,
    attackDps: attackDamage * meta.attackSpeed,
    bounty: enemyLevelBounty(meta.bounty, level, wave),
    shield: meta.shield ? meta.shield * hpMult : 0,
  };
}
